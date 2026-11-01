import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { allButDive, api, ApiError, continuationCandidateQuery, diveProvidersQuery, keys, unwrap, type ContinuationCandidateView, type DiveView } from './api.ts';
import { announce } from './lib/announce.ts';
import { deleteChoice, type CopyAt } from './lib/deletion.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { diveTargets, useJoinNames, useProviderOf, useProviders, useProviderText, type ProviderRef } from './lib/providers.ts';
import { CopySentence } from './MergeDive.tsx';
import { Button, Dialog, Muted, Notice } from './ui/index.ts';

/** One of the two Dives of an append, as the dialog names it. */
type Side = Pick<ContinuationCandidateView, 'number' | 'startsAt' | 'utcOffsetSeconds' | 'utcOffsetSource' | 'durationSeconds' | 'maxDepthM' | 'site'>;

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
    dialog: (d: DiveView) => open && previous.data && <AppendDialog dive={d} previous={previous.data} onClose={() => setOpen(false)} />,
  };
}

/**
 * Appending this Dive to the one before it as its continuation (ADR 0063), asked first: which stays (the earlier one),
 * which goes to "Deleted dives", how long the surface break was. Where both are at a Provider, it asks whether to delete
 * this one there too, as the merge dialog does (ADR 0038); where its Connection deletes there by itself, it says so. It
 * warns that the kept Dive is outdated at the Providers it is at, until the update is sent. If a delete fails, nothing
 * is appended.
 */
export function AppendDialog({ dive: d, previous, onClose }: { dive: DiveView; previous: ContinuationCandidateView; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const joinNames = useJoinNames();
  const sideText = useSideText();
  const queryClient = useQueryClient();
  const providerOf = useProviderOf();
  const targets = diveTargets(useProviders().data).map((p) => p.id);
  const statuses = useQuery(diveProvidersQuery(d.id));
  const keptStatuses = useQuery(diveProvidersQuery(previous.id));
  const none = { ask: [], cannot: [], itself: [] };
  const all = deleteChoice(statuses.data, previous.deletesItself) ?? (statuses.error ? none : undefined);
  const inBoth = (list: CopyAt[]) => list.filter((c) => previous.bothAt.includes(c.provider));
  const choice = all && { ask: inBoth(all.ask), cannot: inBoth(all.cannot), itself: inBoth(all.itself) };
  // The kept Dive is at every Provider either one is at now (a link moves to it where it has none).
  const outdated = [...new Set([...(keptStatuses.data ?? []), ...(statuses.data ?? [])].filter((s) => s.current).map((s) => s.provider))]
    .filter((provider) => targets.includes(provider));
  const append = useMutation({
    mutationFn: async (alsoThere: boolean) => unwrap(await api.POST('/api/dives/{id}/continuation', {
      params: { path: { id: previous.id } },
      body: { version: previous.version, dives: [{ id: d.id, version: d.version }], alsoAt: alsoThere ? choice!.ask.map((c) => c.provider) : [] },
    })),
    onSuccess: async (kept) => {
      queryClient.setQueryData(keys.dive(kept.id), kept);
      queryClient.removeQueries({ queryKey: keys.dive(d.id) });
      location.hash = `#/dives/${kept.id}`;
      await queryClient.invalidateQueries(allButDive(d.id));
      announce(t('append.done'));
      onClose();
    },
  });
  const asking = (choice?.ask.length ?? 0) > 0;
  const current: Side = {
    number: d.values.number, startsAt: d.values.startsAt.at, utcOffsetSeconds: d.values.startsAt.utcOffsetSeconds, utcOffsetSource: d.utcOffsetSource,
    durationSeconds: d.values.durationSeconds, maxDepthM: d.values.maxDepthM, site: d.site,
  };

  return (
    <Dialog title={t('append.title')} isOpen onOpenChange={(open) => !open && !append.isPending && onClose()}>
      <p><strong>{t('append.stays')}</strong> {sideText(previous)}</p>
      <p><strong>{t('append.goes')}</strong> {sideText(current)}</p>
      <p>{t('append.break', { duration: display.duration(previous.breakSeconds) })}</p>
      <p>{t('append.takes')}</p>
      <p>{t('append.other')}</p>
      {choice?.ask.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} number={c.remoteNumber} how="ask" />)}
      {choice?.cannot.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} number={c.remoteNumber} how="cannot" />)}
      {choice?.itself.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} number={c.remoteNumber} how="itself" />)}
      {outdated.map((provider) => <OutdatedSentence key={provider} provider={providerOf(provider)} />)}
      {!choice && <Muted>{t('common.loading')}</Muted>}
      {append.error && (
        <Notice tone="danger">
          {errorText(append.error)}{append.error instanceof ApiError && ` ${t('append.nothingAppended')}`}
        </Notice>
      )}
      {/* The button pressed is pending, the others wait (page rules); `variables` says which: there too or not. */}
      <div className="form-actions">
        {asking && (
          <Button variant="primary" icon="append" isPending={append.isPending && append.variables} isDisabled={append.isPending && !append.variables} onPress={() => append.mutate(true)}>
            {t('append.confirmBoth', { name: joinNames(choice!.ask.map((c) => providerOf(c.provider).name)) })}
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
