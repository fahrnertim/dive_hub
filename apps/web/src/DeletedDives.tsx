import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, deletedDivesQuery, diversQuery, keys, unwrap, type DeletedDiveView } from './api.ts';
import { announce } from './lib/announce.ts';
import { deletedNoticeKey, updateDeletion, useDeletion, type JustDeleted } from './lib/deletion.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { focusHeading, refocusAfterRemoval } from './lib/focus.ts';
import { Button, ConfirmButton, Muted, Notice, Panel } from './ui/index.ts';

/** "Dive 9", or the Dive's time when it has no number. */
function useDiveName() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (d: Pick<DeletedDiveView, 'number' | 'startsAt' | 'utcOffsetSeconds'>) =>
    d.number !== null ? t('dive.title', { number: d.number }) : display.diveTime(d.startsAt, d.utcOffsetSeconds);
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

/**
 * At the top of the logbook (ADR 0026): the Dive just deleted, with "Undo"; otherwise a reminder while deleted dives are
 * still in SSI. Both can be dismissed; the reminder comes back on the next visit, as long as the dive is in SSI.
 */
export function DeletedNotices() {
  const { t } = useTranslation();
  const { justDeleted, reminderDismissed, listOpen } = useDeletion();
  const deleted = useQuery(deletedDivesQuery());
  // Offered only while that Dive is still deleted (it may have been restored from the list).
  const entry = justDeleted && deleted.data?.dives.find((d) => d.id === justDeleted.id);
  if (justDeleted && entry) return <JustDeletedNotice key={entry.id} just={justDeleted} dive={entry} />;
  const inSsi = deleted.data?.dives.filter((d) => d.ssi).length ?? 0;
  // The open list says it on each dive.
  if (inSsi === 0 || reminderDismissed || listOpen) return null;
  return (
    <Notice tone="info">
      <p>{t('deleted.ssiReminder', { count: inSsi })}</p>
      <div className="form-actions">
        <Button onPress={() => updateDeletion({ listOpen: true })}>{t('deleted.showList')}</Button>
        <Button variant="quiet" onPress={() => { updateDeletion({ reminderDismissed: true }); focusHeading(); }}>{t('common.dismiss')}</Button>
      </div>
    </Notice>
  );
}

function JustDeletedNotice({ just, dive: d }: { just: JustDeleted; dive: DeletedDiveView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const restore = useRestore(d, () => focusHeading());
  return (
    <Notice tone="success">
      <p>{t(deletedNoticeKey(just.ssi), { name: just.name, number: just.remoteNumber ?? '' })}</p>
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
 * At the bottom of the logbook: "Show deleted dives", and the list to restore them from, marking those still in SSI with
 * "Delete in SSI" (ADR 0026). Opening moves focus to the list's heading, closing back to the button.
 */
export function DeletedDives() {
  const { t } = useTranslation();
  const deleted = useQuery(deletedDivesQuery());
  const { listOpen } = useDeletion();
  const list = useRef<HTMLUListElement>(null);
  const show = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(listOpen);
  const dives = deleted.data?.dives ?? [];
  const count = dives.length;
  useEffect(() => {
    if (listOpen && !wasOpen.current) focusHeading(list.current);
    if (!listOpen && wasOpen.current) show.current?.focus();
    wasOpen.current = listOpen;
  }, [listOpen]);

  if (count === 0) return null;
  if (!listOpen) {
    return (
      <div className="decisions-quiet">
        <Button ref={show} variant="quiet" onPress={() => updateDeletion({ listOpen: true })}>{t('deleted.show', { count })}</Button>
      </div>
    );
  }
  return (
    <Panel title={t('deleted.title')}>
      <Muted>{t('deleted.intro')}</Muted>
      <ul className="decisions" ref={list}>
        {dives.map((d, index) => <DeletedRow key={d.id} dive={d} list={list} index={index} count={count} />)}
      </ul>
      <Button variant="quiet" onPress={() => updateDeletion({ listOpen: false })}>{t('deleted.hide')}</Button>
    </Panel>
  );
}

function DeletedRow({ dive: d, list, index, count }: {
  dive: DeletedDiveView; list: RefObject<HTMLUListElement | null>; index: number; count: number;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const divers = useQuery(diversQuery());
  const name = useDiveName()(d);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const restore = useRestore(d, () => refocusAfterRemoval(list.current, index, count));
  const removeInSsi = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dives/{id}/ssi', { params: { path: { id: d.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.deletedDives });
      announce(t('ssi.deleted'));
    },
  });
  const diverName = (divers.data?.length ?? 0) > 1 ? divers.data?.find((v) => v.id === d.diverId)?.name : undefined;
  const facts = [
    ...(d.number !== null ? [display.diveTime(d.startsAt, d.utcOffsetSeconds)] : []),
    d.site?.name, display.depth(d.maxDepthM), display.duration(d.durationSeconds), diverName,
  ].filter(Boolean);
  return (
    <li className="decision">
      <div className="decision-recording">
        <p><strong>{name}</strong>{facts.length > 0 && ` · ${facts.join(' · ')}`}</p>
        <p className="muted">{t('deleted.deletedOn', { date: display.dateTime(d.deletedAt) })}</p>
        {d.ssi && <p>{t('deleted.stillInSsi', { number: d.ssi.remoteNumber ?? '' })}</p>}
      </div>
      <div className="form-actions">
        <Button
          ref={restoreButton} icon="undo" aria-label={t('common.forItem', { action: t('deleted.restore'), item: name })}
          isPending={restore.isPending} onPress={() => restore.mutate()}
        >
          {t('deleted.restore')}
        </Button>
        {d.ssi && (
          <ConfirmButton
            icon="delete" aria-label={t('common.forItem', { action: t('ssi.delete'), item: name })}
            title={t('ssi.deleteTitle')} body={t('deleted.ssiDeleteBody', { number: d.ssi.remoteNumber ?? '' })}
            confirmLabel={t('ssi.delete')} onConfirm={() => removeInSsi.mutateAsync()}
            onDone={() => requestAnimationFrame(() => restoreButton.current?.focus())}
          >
            {t('ssi.delete')}
          </ConfirmButton>
        )}
      </div>
      {restore.error && <Notice tone="danger">{errorText(restore.error)}</Notice>}
    </li>
  );
}
