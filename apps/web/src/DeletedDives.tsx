import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, deletedDivesQuery, diversQuery, keys, unwrap, type DeletedDiveView, type ProviderView } from './api.ts';
import { announce } from './lib/announce.ts';
import { deletedNotice, updateDeletion, useDeletion, type JustDeleted } from './lib/deletion.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { focusHeading, refocusAfterRemoval } from './lib/focus.ts';
import { reviewHref } from './lib/review.ts';
import { exporting, useNames, useProviders, useProviderText } from './lib/providers.ts';
import { Button, ConfirmButton, LinkButton, Muted, Notice, Panel } from './ui/index.ts';

/** "Dive 9", or the Dive's time when it has no number. */
function useDiveName() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (d: Pick<DeletedDiveView, 'number' | 'startsAt' | 'utcOffsetSeconds' | 'utcOffsetSource'>) =>
    d.number !== null ? t('dive.title', { number: d.number }) : display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource);
}

/** Restoring changes every list and count, like deleting did. */
function useRestore(d: DeletedDiveView, onRestored: () => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const name = useDiveName()(d);
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/dives/{id}/restore', { params: { path: { id: d.id } }, body: { version: d.version } })),
    onSuccess: async (restored) => {
      queryClient.setQueryData(keys.dive(d.id), restored);
      await queryClient.invalidateQueries();
      updateDeletion({ justDeleted: undefined });
      announce(t('deleted.restored', { name }));
      onRestored();
    },
  });
}

/** A Provider by its id, from what the server says it has; a name it no longer lists stays the id. */
function useProviderOf() {
  const providers = useProviders();
  return (id: string) => providers.data?.find((p) => p.id === id) ?? { id, name: id } as ProviderView;
}

/**
 * At the top of the logbook (ADR 0026): the Dive just deleted, with "Undo"; otherwise a reminder while deleted dives are
 * still at a Provider. Both can be dismissed; the reminder comes back on the next visit, as long as the dive is there.
 */
export function DeletedNotices() {
  const { t } = useTranslation();
  const { justDeleted, reminderDismissed } = useDeletion();
  const deleted = useQuery(deletedDivesQuery());
  const names = useNames();
  const providerOf = useProviderOf();
  // Offered only while that Dive is still deleted (it may have been restored from the list).
  const entry = justDeleted && deleted.data?.dives.find((d) => d.id === justDeleted.id);
  if (justDeleted && entry) return <JustDeletedNotice key={entry.id} just={justDeleted} dive={entry} />;
  const still = deleted.data?.dives.filter((d) => d.stillAt.length > 0) ?? [];
  if (still.length === 0 || reminderDismissed) return null;
  const where = [...new Set(still.flatMap((d) => d.stillAt.map((s) => providerOf(s.provider).name)))];
  return (
    <Notice tone="info">
      <p>{t('deleted.reminder', { count: still.length, name: names(where) })}</p>
      <div className="form-actions">
        <LinkButton href={reviewHref('deleted')}>{t('deleted.showList')}</LinkButton>
        <Button variant="quiet" onPress={() => { updateDeletion({ reminderDismissed: true }); focusHeading(); }}>{t('common.dismiss')}</Button>
      </div>
    </Notice>
  );
}

function JustDeletedNotice({ just, dive: d }: { just: JustDeleted; dive: DeletedDiveView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const names = useNames();
  const restore = useRestore(d, () => focusHeading());
  const notice = deletedNotice(just.copies);
  return (
    <Notice tone="success">
      <p>{t(notice.key, { name: just.name, provider: names(notice.copies.map((c) => c.name)), number: notice.copies[0]?.remoteNumber ?? '' })}</p>
      {restore.error && <p>{errorText(restore.error)}</p>}
      <div className="form-actions">
        <Button icon="undo" isPending={restore.isPending} onPress={() => restore.mutate()}>{t('common.undo')}</Button>
        <Button variant="quiet" isDisabled={restore.isPending} onPress={() => { updateDeletion({ justDeleted: undefined }); focusHeading(); }}>
          {t('common.dismiss')}
        </Button>
      </div>
    </Notice>
  );
}

/**
 * The Review page's "Deleted dives" (ADR 0026, 0027): the list to restore them from, marking those still at a Provider
 * with "Delete in …". Nothing while there are none.
 */
export function DeletedDives() {
  const { t } = useTranslation();
  const deleted = useQuery(deletedDivesQuery());
  const providers = useProviders();
  const names = useNames();
  const list = useRef<HTMLUListElement>(null);
  const dives = deleted.data?.dives ?? [];
  const count = dives.length;
  if (count === 0) return null;
  return (
    <Panel title={t('deleted.title')}>
      <Muted>{t('deleted.intro', { name: names(exporting(providers.data).map((p) => p.name)) })}</Muted>
      <ul className="decisions" ref={list}>
        {dives.map((d, index) => <DeletedRow key={d.id} dive={d} list={list} index={index} count={count} />)}
      </ul>
    </Panel>
  );
}

function DeletedRow({ dive: d, list, index, count }: {
  dive: DeletedDiveView; list: RefObject<HTMLUListElement | null>; index: number; count: number;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const divers = useQuery(diversQuery());
  const providerOf = useProviderOf();
  const name = useDiveName()(d);
  const restoreButton = useRef<HTMLButtonElement>(null);
  // After "Delete in …" the focus goes to Restore once the row shows the dive gone there: the dialog closing and the row
  // losing that button both move focus, later than a frame when the machine is busy.
  const focusRestore = useRef(false);
  useEffect(() => {
    if (focusRestore.current && d.stillAt.length === 0) {
      focusRestore.current = false;
      restoreButton.current?.focus();
    }
  }, [d.stillAt.length]);
  const restore = useRestore(d, () => refocusAfterRemoval(list.current, index, count));
  const diverName = (divers.data?.length ?? 0) > 1 ? divers.data?.find((v) => v.id === d.diverId)?.name : undefined;
  const facts = [
    ...(d.number !== null ? [display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource)] : []),
    d.site?.name, display.depth(d.maxDepthM), display.duration(d.durationSeconds), diverName,
  ].filter(Boolean);
  return (
    <li className="decision">
      <div className="decision-recording">
        <p><strong>{name}</strong>{facts.length > 0 && ` · ${facts.join(' · ')}`}</p>
        <p className="muted">{t('deleted.deletedOn', { date: display.dateTime(d.deletedAt) })}</p>
        {/* Not deleted by hand (ADR 0038): where it went, so the row explains itself. */}
        {d.mergedInto && <p>{t('deleted.mergedInto')} <a href={`#/dives/${d.mergedInto}`}>{t('deleted.openKept')}</a></p>}
        {d.movedTo && <p>{t('deleted.movedTo')} <a href={`#/dives/${d.movedTo}`}>{t('deleted.openMoved')}</a></p>}
        {d.stillAt.map((c) => <p key={c.provider}>{t('deleted.stillAt', { name: providerOf(c.provider).name, number: c.remoteNumber ?? '' })}</p>)}
      </div>
      <div className="form-actions">
        <Button
          ref={restoreButton} icon="undo" aria-label={t('common.forItem', { action: t('deleted.restore'), item: name })}
          isPending={restore.isPending} onPress={() => restore.mutate()}
        >
          {t('deleted.restore')}
        </Button>
        {d.stillAt.map((c) => (
          <DeleteThere key={c.provider} provider={providerOf(c.provider)} diveId={d.id} name={name} remoteNumber={c.remoteNumber}
            onDone={() => { focusRestore.current = true; requestAnimationFrame(() => restoreButton.current?.focus()); }} />
        ))}
      </div>
      {restore.error && <Notice tone="danger">{errorText(restore.error)}</Notice>}
    </li>
  );
}

/** "Delete in SSI" for a deleted Dive still there: asks first, since the Provider may not bring it back. */
function DeleteThere({ provider: p, diveId, name, remoteNumber, onDone }: {
  provider: ProviderView; diveId: string; name: string; remoteNumber: number | null; onDone: () => void;
}) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dives/{id}/providers/{provider}', { params: { path: { id: diveId, provider: p.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.deletedDives });
      announce(pt('deleted'));
    },
  });
  return (
    <ConfirmButton
      icon="delete" aria-label={t('common.forItem', { action: pt('delete'), item: name })}
      title={pt('deleteTitle')} body={pt('deleteBodyDeleted', { number: remoteNumber ?? '' })}
      confirmLabel={pt('delete')} onConfirm={() => remove.mutateAsync()} onDone={onDone}
    >
      {pt('delete')}
    </ConfirmButton>
  );
}
