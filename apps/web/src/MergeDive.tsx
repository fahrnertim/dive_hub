import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, diveProvidersQuery, keys, mergeCandidatesQuery, unwrap, type DiveView, type LogbookCheckView, type MergeCandidateView, type ProviderView } from './api.ts';
import { announce } from './lib/announce.ts';
import { deleteChoice } from './lib/deletion.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { useNames, useProviders, useProviderText } from './lib/providers.ts';
import { Button, Dialog, Muted, Notice } from './ui/index.ts';

/**
 * On the dive page (ADR 0038): another Dive of the same Diver at the same time, which may be the same dive logged twice
 * (a logbook entry and its computer's file, or two entries). Says so and offers to merge the two.
 */
export function MergeHint({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const candidates = useQuery(mergeCandidatesQuery(d.id));
  const [merging, setMerging] = useState<MergeCandidateView | null>(null);
  // A pair the User said are two dives isn't hinted at again (ADR 0038).
  const open = (candidates.data ?? []).filter((c) => !c.answered);
  if (open.length === 0) return null;
  return (
    <>
      {open.map((c) => {
        const facts = [
          display.diveTime(c.startsAt, c.utcOffsetSeconds, c.utcOffsetSource), display.duration(c.durationSeconds),
          ...(c.maxDepthM !== null ? [display.depth(c.maxDepthM)] : []), c.site?.name,
          c.recordings > 0 ? t('merge.withRecording') : t('merge.withoutRecording'),
        ].filter(Boolean);
        return (
          <Notice key={c.id} tone="info">
            <p>{t('merge.hint', { facts: facts.join(' · ') })}</p>
            <div className="form-actions">
              <Button icon="merge" onPress={() => setMerging(c)}>{t('merge.action')}</Button>
              <a href={`#/dives/${c.id}`} className="btn btn-quiet">{t('merge.open')}</a>
            </div>
          </Notice>
        );
      })}
      {merging && <MergeDialog dive={d} other={merging} onClose={() => setMerging(null)} />}
    </>
  );
}

/** What the dialog says about the copy at a Provider of the Dive that isn't kept, in the Provider's words. */
function CopySentence({ provider: p, number, canDelete }: { provider: ProviderView; number: number | null; canDelete: boolean }) {
  const pt = useProviderText(p);
  return <p>{pt(canDelete ? 'deleteAsk' : 'deleteCannot', { number: number ?? '' })}</p>;
}

/**
 * Merges the two Dives after saying which is kept and what happens to the other (ADR 0038). Where both are at a Provider,
 * the dialog asks whether to delete the other one's dive there too, as the delete dialog does (ADR 0026, 0027); if that
 * fails, nothing is merged.
 */
export function MergeDialog({ dive: d, other, onClose, stay, onMerged }: {
  dive: Pick<DiveView, 'id' | 'version'>; other: Pick<MergeCandidateView, 'id' | 'version' | 'keeps' | 'bothAt' | 'at'> | LogbookCheckView['other'];
  onClose: () => void;
  /** On the logbook: stay there instead of opening the kept Dive. */
  stay?: boolean; onMerged?: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const names = useNames();
  const queryClient = useQueryClient();
  const providers = useProviders();
  const providerOf = (id: string) => providers.data?.find((p) => p.id === id) ?? { id, name: id } as ProviderView;
  const keepsThis = other.keeps === d.id;
  const leaving = keepsThis ? other.id : d.id;
  // Only where both Dives are at a Provider is there a dive left over at it.
  const statuses = useQuery({ ...diveProvidersQuery(leaving), enabled: other.bothAt.length > 0 });
  const all = other.bothAt.length === 0 ? { ask: [], cannot: [] } : deleteChoice(statuses.data) ?? (statuses.error ? { ask: [], cannot: [] } : undefined);
  const choice = all && { ask: all.ask.filter((c) => other.bothAt.includes(c.provider)), cannot: all.cannot.filter((c) => other.bothAt.includes(c.provider)) };
  const moves = other.at.filter((c) => !other.bothAt.includes(c.provider));
  const merge = useMutation({
    mutationFn: async (alsoThere: boolean) => unwrap(await api.POST('/api/dives/{id}/merge', {
      params: { path: { id: d.id } },
      body: { version: d.version, otherId: other.id, otherVersion: other.version, alsoAt: alsoThere ? choice!.ask.map((c) => c.provider) : [] },
    })),
    onSuccess: async (kept) => {
      queryClient.setQueryData(keys.dive(kept.id), kept);
      queryClient.removeQueries({ queryKey: keys.dive(leaving) });
      if (kept.id !== d.id && !stay) location.hash = `#/dives/${kept.id}`;
      await queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'dives' && q.queryKey[1] === leaving) });
      announce(t('merge.done'));
      onClose();
      onMerged?.();
    },
  });
  const asking = (choice?.ask.length ?? 0) > 0;

  return (
    <Dialog title={t('merge.title')} isOpen onOpenChange={(open) => !open && !merge.isPending && onClose()}>
      <p>{t(keepsThis ? 'merge.keepsThis' : 'merge.keepsOther')}</p>
      {keepsThis && moves.length > 0 && <p>{t('merge.linkMoves', { name: names(moves.map((c) => providerOf(c.provider).name)) })}</p>}
      <p>{t('merge.other')}</p>
      {choice?.ask.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} number={c.remoteNumber} canDelete />)}
      {choice?.cannot.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} number={c.remoteNumber} canDelete={false} />)}
      {!choice && <Muted>{t('common.loading')}</Muted>}
      {merge.error && (
        <Notice tone="danger">
          {errorText(merge.error)}{merge.error instanceof ApiError && ` ${t('merge.nothingMerged')}`}
        </Notice>
      )}
      {/* The button pressed is pending, the others wait (page rules); `variables` says which: there too or not. */}
      <div className="form-actions">
        {asking && (
          <Button variant="primary" icon="merge" isPending={merge.isPending && merge.variables} isDisabled={merge.isPending && !merge.variables} onPress={() => merge.mutate(true)}>
            {t('merge.confirmBoth', { name: names(choice!.ask.map((c) => providerOf(c.provider).name)) })}
          </Button>
        )}
        {choice && (
          <Button variant={asking ? 'secondary' : 'primary'} icon="merge" isPending={merge.isPending && !merge.variables} isDisabled={merge.isPending && merge.variables} onPress={() => merge.mutate(false)}>
            {asking ? t('merge.confirmHere') : t('merge.confirm')}
          </Button>
        )}
        <Button isDisabled={merge.isPending} onPress={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}
