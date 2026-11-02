import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { allButDive, api, ApiError, continuationCandidateQuery, diveProvidersQuery, keys, unwrap, type ContinuationCandidateView, type DiveView } from './api.ts';
import { announce } from './lib/announce.ts';
import { deleteChoice, type CopyAt } from './lib/deletion.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { diveTargets, useJoinNames, useProviderOf, useProviders, useProviderText, type ProviderRef } from './lib/providers.ts';
import { CopySentence } from './MergeDive.tsx';
import { Button, Dialog, Notice, RowsSkeleton } from './ui/index.ts';

/** One of the Dives of an append, as the dialog names it. */
export type AppendSide = Pick<ContinuationCandidateView, 'id' | 'version' | 'number' | 'startsAt' | 'utcOffsetSeconds' | 'utcOffsetSource' | 'durationSeconds' | 'maxDepthM' | 'site'>;
type Side = Omit<AppendSide, 'id' | 'version'>;

/** "Dive 85 · Oct 26, 2026, 07:05 · 20 min · 7.1 m · Hausriff": a Dive told from the one before or after it. */
function useSideText() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (d: Side) => [
    d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber'),
    display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource), display.duration(d.durationSeconds),
    ...(d.maxDepthM !== null ? [display.depth(d.maxDepthM)] : []), d.site?.name,
  ].filter(Boolean).join(' · ');
}

/** What the dialog warns about a Provider the kept Dive is at: it is outdated there until the update is sent. */
function OutdatedSentence({ provider: p }: { provider: ProviderRef }) {
  return <p>{useProviderText(p)('appendOutdated')}</p>;
}

/** The dive page's Dive as the later side of an append. */
const sideOf = (d: DiveView): AppendSide => ({
  id: d.id, version: d.version, number: d.values.number, startsAt: d.values.startsAt.at, utcOffsetSeconds: d.values.startsAt.utcOffsetSeconds,
  utcOffsetSource: d.utcOffsetSource, durationSeconds: d.values.durationSeconds, maxDepthM: d.values.maxDepthM, site: d.site,
});

/**
 * The dive page's menu item "Append to the previous dive…" and its dialog (ADR 0063): offered when the Dive before this
 * one may be appended to (GET /dives/{id}/continuation-candidate), with no time limit.
 */
export function useAppend(diveId: string) {
  const { t } = useTranslation();
  const previous = useQuery(continuationCandidateQuery(diveId));
  const [open, setOpen] = useState(false);
  return {
    actions: previous.data ? [{ id: 'append', label: t('append.menu'), icon: 'append' as const, onAction: () => setOpen(true) }] : [],
    dialog: (d: DiveView) => open && previous.data && (
      <AppendDialog
        kept={previous.data} later={[{ ...sideOf(d), breakSeconds: previous.data.breakSeconds }]}
        bothAt={previous.data.bothAt} deletesItself={previous.data.deletesItself} onClose={() => setOpen(false)}
      />
    ),
  };
}

/**
 * Appending later Dives to the one before them as its continuation (ADR 0063), asked first: which stays (the earliest),
 * which go to "Deleted dives", how long each surface break was. Where both are at a Provider, it asks whether to delete
 * the later ones there too, as the merge dialog does (ADR 0038); where their Connection deletes there by itself, it says
 * so. It warns that the kept Dive is outdated at the Providers it is at, until the update is sent. If a delete fails,
 * nothing is appended. From the dive page (one later Dive, this one) it opens the kept Dive; from a logbook check
 * (`stay`, a chain of them) it stays there.
 */
export function AppendDialog({ kept, later, bothAt, deletesItself, onClose, stay, onAppended }: {
  kept: AppendSide; later: (AppendSide & { breakSeconds: number })[];
  /** Providers the kept Dive and a later one are both at; of those, where a later one's Connection deletes by itself. */
  bothAt: string[]; deletesItself: string[];
  onClose: () => void;
  /** On the Review page: stay there instead of opening the kept Dive. */
  stay?: boolean; onAppended?: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const joinNames = useJoinNames();
  const sideText = useSideText();
  const queryClient = useQueryClient();
  const providerOf = useProviderOf();
  const targets = diveTargets(useProviders().data).map((p) => p.id);
  const statuses = useQueries({ queries: later.map((l) => diveProvidersQuery(l.id)) });
  const keptStatuses = useQuery(diveProvidersQuery(kept.id));
  const none = { ask: [], cannot: [], itself: [] };
  const inBoth = (list: CopyAt[]) => list.filter((c) => bothAt.includes(c.provider));
  // Per later Dive what the dialog says about its copies; nothing until every one is known.
  const choices = statuses.map((s, i) => {
    const all = deleteChoice(s.data, deletesItself) ?? (s.error ? none : undefined);
    return all && { dive: later[i]!.id, ask: inBoth(all.ask), cannot: inBoth(all.cannot), itself: inBoth(all.itself) };
  });
  const choice = choices.every((c) => c !== undefined) ? choices.filter((c) => c !== undefined) : undefined;
  const ask = [...new Set(choice?.flatMap((c) => c.ask.map((a) => a.provider)) ?? [])];
  // The kept Dive is at every Provider any of them is at now (a link moves to it where it has none).
  const outdated = [...new Set([...(keptStatuses.data ?? []), ...statuses.flatMap((s) => s.data ?? [])].filter((s) => s.current).map((s) => s.provider))]
    .filter((provider) => targets.includes(provider));
  const laterIds = later.map((l) => l.id);
  const append = useMutation({
    mutationFn: async (alsoThere: boolean) => unwrap(await api.POST('/api/dives/{id}/continuation', {
      params: { path: { id: kept.id } },
      body: { version: kept.version, dives: later.map((l) => ({ id: l.id, version: l.version })), alsoAt: alsoThere ? ask : [] },
    })),
    onSuccess: async (result) => {
      queryClient.setQueryData(keys.dive(result.id), result);
      for (const id of laterIds) queryClient.removeQueries({ queryKey: keys.dive(id) });
      if (!stay) location.hash = `#/dives/${result.id}`;
      await queryClient.invalidateQueries(allButDive(...laterIds));
      announce(t('append.done', { count: later.length }));
      onClose();
      onAppended?.();
    },
  });
  const asking = ask.length > 0;
  const count = later.length;
  const sentences = (how: 'ask' | 'cannot' | 'itself') => choice?.flatMap((c) => c[how].map((a) => (
    <CopySentence key={`${c.dive}:${a.provider}`} provider={providerOf(a.provider)} number={a.remoteNumber} how={how} />
  )));

  return (
    <Dialog
      title={stay ? t('append.titleCheck', { count, dives: count + 1 }) : t('append.title')}
      isOpen onOpenChange={(open) => !open && !append.isPending && onClose()}
    >
      <p><strong>{t('append.stays')}</strong> {sideText(kept)}</p>
      {later.map((l) => <p key={l.id}><strong>{t('append.goes')}</strong> {sideText(l)}</p>)}
      <p>{t('append.break', { count, duration: joinNames(later.map((l) => display.duration(l.breakSeconds))) })}</p>
      <p>{t('append.takes', { count })}</p>
      <p>{t('append.other', { count })}</p>
      {sentences('ask')}
      {sentences('cannot')}
      {sentences('itself')}
      {outdated.map((provider) => <OutdatedSentence key={provider} provider={providerOf(provider)} />)}
      {!choice && <RowsSkeleton rows={2} />}
      {append.error && (
        <Notice tone="danger">
          {errorText(append.error)}{append.error instanceof ApiError && ` ${t('append.nothingAppended')}`}
        </Notice>
      )}
      {/* The button pressed is pending, the others wait (page rules); `variables` says which: there too or not. */}
      <div className="form-actions">
        {asking && (
          <Button variant="primary" icon="append" isPending={append.isPending && append.variables} isDisabled={append.isPending && !append.variables} onPress={() => append.mutate(true)}>
            {t('append.confirmBoth', { name: joinNames(ask.map((provider) => providerOf(provider).name)) })}
          </Button>
        )}
        {choice && (
          <Button variant={asking ? 'secondary' : 'primary'} icon="append" isPending={append.isPending && !append.variables} isDisabled={append.isPending && append.variables} onPress={() => append.mutate(false)}>
            {asking ? t('append.confirmHere') : t('append.confirm')}
          </Button>
        )}
        <Button isDisabled={append.isPending} onPress={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}
