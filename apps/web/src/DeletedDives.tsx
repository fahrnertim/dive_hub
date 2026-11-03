import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, deletedDivesQuery, diveQuery, diversQuery, keys, restorePreviewQuery, unwrap, type DeletedDiveView } from './api.ts';
import { announce } from './lib/announce.ts';
import { deletedNotice, updateDeletion, useDeletion, type JustDeleted } from './lib/deletion.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { focusHeading, refocusAfterRemoval } from './lib/focus.ts';
import { reviewHref } from './lib/review.ts';
import { diveTargets, useJoinNames, useProviderOf, useProviders, useProviderText, useProviderTexts, type ProviderRef } from './lib/providers.ts';
import { WaitingPushState } from './WaitingPush.tsx';
import { ActionMenu, Button, ConfirmButton, ConfirmDialog, Dialog, LinkButton, Muted, Notice, Panel, RowsSkeleton, type MenuAction } from './ui/index.ts';

/** "Dive 9", or the Dive's time when it has no number. */
function useDiveName() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (d: Pick<DeletedDiveView, 'number' | 'startsAt' | 'utcOffsetSeconds' | 'utcOffsetSource'>) =>
    d.number !== null ? t('dive.title', { number: d.number }) : display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource);
}

/** Restoring changes every list and count, like deleting did. `name` says what comes back, for the announcement. */
function useRestore(d: DeletedDiveView, onRestored: () => void, name?: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const own = useDiveName()(d);
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/dives/{id}/restore', { params: { path: { id: d.id } }, body: { version: d.version } })),
    onSuccess: async (restored) => {
      queryClient.setQueryData(keys.dive(d.id), restored);
      await queryClient.invalidateQueries();
      updateDeletion({ justDeleted: undefined });
      announce(t('deleted.restored', { name: name ?? own }));
      onRestored();
    },
  });
}

/**
 * At the top of the logbook (ADR 0026): the Dive just deleted, with "Undo"; otherwise a reminder while deleted dives are
 * still at a Provider. Both can be dismissed; the reminder comes back on the next visit, as long as the dive is there.
 */
export function DeletedNotices() {
  const { t } = useTranslation();
  const { justDeleted, reminderDismissed } = useDeletion();
  const deleted = useQuery(deletedDivesQuery());
  const joinNames = useJoinNames();
  const providerOf = useProviderOf();
  // Offered only while that Dive is still deleted (it may have been restored from the list).
  const entry = justDeleted && deleted.data?.find((d) => d.id === justDeleted.id);
  if (justDeleted && entry) return <JustDeletedNotice key={entry.id} just={justDeleted} dive={entry} />;
  const still = deleted.data?.filter((d) => d.stillAt.length > 0) ?? [];
  if (still.length === 0 || reminderDismissed) return null;
  const where = [...new Set(still.flatMap((d) => d.stillAt.map((s) => providerOf(s.provider).name)))];
  return (
    <Notice tone="info">
      <p>{t('deleted.reminder', { count: still.length, name: joinNames(where) })}</p>
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
  const joinNames = useJoinNames();
  const restore = useRestore(d, () => focusHeading());
  const notice = deletedNotice(just.copies);
  return (
    <Notice tone="success">
      <p>{t(notice.key, { name: just.name, provider: joinNames(notice.copies.map((c) => c.name)), number: notice.copies[0]?.remoteNumber ?? '' })}</p>
      {just.byThemselves.length > 0 && <p>{t('deleted.noticeItself', { provider: joinNames(just.byThemselves) })}</p>}
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
  const joinNames = useJoinNames();
  const list = useRef<HTMLUListElement>(null);
  const dives = deleted.data ?? [];
  const byId = new Map(dives.map((d) => [d.id, d]));
  // The Dives of one append are one entry, under the earliest of them (ADR 0063).
  const entries = dives.filter((d) => !d.appendedWith.some((id) => {
    const other = byId.get(id);
    return other !== undefined && Date.parse(other.startsAt) < Date.parse(d.startsAt);
  }));
  const count = entries.length;
  if (count === 0) return null;
  return (
    <Panel title={t('deleted.title')}>
      <Muted>{t('deleted.intro', { name: joinNames(diveTargets(providers.data).map((p) => p.name)) })}</Muted>
      <ul className="decisions" ref={list}>
        {entries.map((d, index) => (
          <DeletedRow key={d.id} dive={d} appended={d.appendedWith.flatMap((id) => byId.get(id) ?? [])} list={list} index={index} count={count} />
        ))}
      </ul>
    </Panel>
  );
}

function DeletedRow({ dive: d, appended, list, index, count }: {
  dive: DeletedDiveView;
  /** The other Dives deleted by the same append (ADR 0063): one entry, restored together. */
  appended: DeletedDiveView[];
  list: RefObject<HTMLUListElement | null>; index: number; count: number;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const divers = useQuery(diversQuery());
  const providerOf = useProviderOf();
  const joinNames = useJoinNames();
  const providerTexts = useProviderTexts();
  const nameOf = useDiveName();
  const group = [d, ...appended];
  const name = joinNames(group.map(nameOf));
  const [asking, setAsking] = useState(false);
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
  const removed = () => refocusAfterRemoval(list.current, index, count);
  const restore = useRestore(d, removed, name);
  // The Dive it was appended to, by its name; one deleted since is "another dive".
  const kept = useQuery({ ...diveQuery(d.continuedInto ?? ''), enabled: d.continuedInto !== null });
  const keptName = kept.data && nameOf({
    number: kept.data.values.number, startsAt: kept.data.values.startsAt.at, utcOffsetSeconds: kept.data.values.startsAt.utcOffsetSeconds, utcOffsetSource: kept.data.utcOffsetSource,
  });
  const diverName = (divers.data?.length ?? 0) > 1 ? divers.data?.find((v) => v.id === d.diverId)?.name : undefined;
  // A Dive's facts after its name; in an append's entry each line starts with the name.
  const facts = (g: DeletedDiveView, named: boolean) => [
    ...(named ? [nameOf(g)] : []),
    ...(g.number !== null || named ? [display.diveTime(g.startsAt, g.utcOffsetSeconds, g.utcOffsetSource)] : []),
    g.site?.name, display.depth(g.maxDepthM), display.duration(g.durationSeconds), diverName,
  ].filter(Boolean).join(' · ');
  const own = facts(d, false);
  // One "Delete in …" per Provider copy of the entry's Dives; none while the Provider's automatic delete waits.
  const deleteWaits = (g: DeletedDiveView, provider: string) =>
    g.waiting.some((w) => w.provider === provider && w.action === 'delete' && w.state === 'waiting');
  const copies = group.flatMap((g) => g.stillAt.filter((c) => !deleteWaits(g, c.provider)).map((c) => ({
    slot: `${g.id}:${c.provider}`, provider: providerOf(c.provider), diveId: g.id, name: nameOf(g), remoteNumber: c.remoteNumber,
  })));
  const [deleting, setDeleting] = useState<string>();
  const afterDelete = () => { focusRestore.current = true; requestAnimationFrame(() => restoreButton.current?.focus()); };
  const menuAction = (c: (typeof copies)[number]): MenuAction => ({
    id: c.slot, icon: 'delete', label: t('common.forItem', { action: providerTexts(c.provider, 'delete'), item: c.name }), onAction: () => setDeleting(c.slot),
  });
  return (
    <li className="decision">
      <div className="decision-recording">
        {appended.length === 0 ? <p><strong>{name}</strong>{own && ` · ${own}`}</p> : (
          <>
            <p><strong>{t('deleted.appendedGroup', { dives: group.length, name: keptName ?? t('deleted.anotherDive') })}</strong></p>
            {group.map((g) => <p key={g.id}>{facts(g, true)}</p>)}
          </>
        )}
        <p className="muted">{t('deleted.deletedOn', { date: display.dateTime(d.deletedAt) })}</p>
        {/* Not deleted by hand (ADR 0038, 0063): where it went, so the row explains itself. */}
        {d.mergedInto && <p>{t('deleted.mergedInto')} <a href={`#/dives/${d.mergedInto}`}>{t('deleted.openKept')}</a></p>}
        {d.movedTo && <p>{t('deleted.movedTo')} <a href={`#/dives/${d.movedTo}`}>{t('deleted.openMoved')}</a></p>}
        {d.continuedInto && (
          <p>
            {appended.length === 0 && `${t('deleted.continuedInto', { name: keptName ?? t('deleted.anotherDive') })} `}
            <a href={`#/dives/${d.continuedInto}`}>{t('deleted.openKept')}</a>
          </p>
        )}
        {group.flatMap((g) => g.waiting.map((w) => (
          <WaitingPushState key={`${g.id}:${w.provider}`} push={w} providerName={providerOf(w.provider).name} variant="panel" diveId={g.id} itemName={nameOf(g)} />
        )))}
        {group.flatMap((g) => g.stillAt.map((c) => (
          <p key={`${g.id}:${c.provider}`}>{t('deleted.stillAt', { name: providerOf(c.provider).name, number: c.remoteNumber ?? '' })}</p>
        )))}
      </div>
      <div className="form-actions">
        {/* Restoring an appended Dive undoes its whole append and the later ones: the dialog says so first (ADR 0063). */}
        <Button
          ref={restoreButton} icon="undo" aria-label={t('common.forItem', { action: t('deleted.restore'), item: name })}
          isPending={restore.isPending} onPress={() => (d.continuedInto ? setAsking(true) : restore.mutate())}
        >
          {t('deleted.restore')}
        </Button>
        {copies.length <= 1 && copies.map(({ slot, ...c }) => <DeleteThere key={slot} {...c} onDone={afterDelete} />)}
        {/* Restore and more than one "Delete in …" are more than two actions: the deletes go in one menu, as on the Divers page. */}
        {copies.length > 1 && (
          <ActionMenu label={t('common.actions')} aria-label={t('common.forItem', { action: t('common.actions'), item: name })} actions={copies.map(menuAction)} />
        )}
      </div>
      {restore.error && <Notice tone="danger">{errorText(restore.error)}</Notice>}
      {copies.length > 1 && copies.map(({ slot, ...c }) => (
        <DeleteDialog key={slot} {...c} isOpen={deleting === slot} onOpenChange={(open) => setDeleting(open ? slot : undefined)} onDone={afterDelete} />
      ))}
      {asking && <RestoreDialog dive={d} name={name} keptName={keptName} onClose={() => setAsking(false)} onRestored={removed} />}
    </li>
  );
}

/**
 * Before restoring a Dive an append took (ADR 0063): which Dives come back, each with its Recording, also those of later
 * appends to the same Dive, which restoring takes back out as well (GET /dives/{id}/restore-preview).
 */
function RestoreDialog({ dive: d, name, keptName, onClose, onRestored }: {
  dive: DeletedDiveView; name: string; keptName: string | undefined; onClose: () => void; onRestored: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const joinNames = useJoinNames();
  const nameOf = useDiveName();
  const deleted = useQuery(deletedDivesQuery());
  const preview = useQuery(restorePreviewQuery(d.id));
  const restore = useRestore(d, () => { onClose(); onRestored(); }, name);
  const named = (id: string) => {
    const found = deleted.data?.find((g) => g.id === id);
    return found ? nameOf(found) : t('dive.titleNoNumber');
  };
  const comesBack = preview.data?.comesBack ?? [];
  // The Dives of later appends to the same Dive: they come back too.
  const ownAppend = new Set([d.id, ...d.appendedWith]);
  const later = comesBack.filter((id) => !ownAppend.has(id));
  return (
    <Dialog title={t('deleted.restoreTitle', { name })} isOpen onOpenChange={(open) => !open && !restore.isPending && onClose()}>
      {preview.isPending && <RowsSkeleton rows={2} />}
      {preview.error && <Notice tone="danger">{errorText(preview.error)}</Notice>}
      {preview.data && (
        <>
          <p>{t('deleted.comesBack', { count: comesBack.length, names: joinNames(comesBack.map(named)) })}</p>
          {later.length > 0 && <p>{t('deleted.alsoOut', { count: later.length, names: joinNames(later.map(named)) })}</p>}
          {keptName && <p>{t('deleted.keptKeeps', { count: comesBack.length, name: keptName })}</p>}
        </>
      )}
      {restore.error && <Notice tone="danger">{errorText(restore.error)}</Notice>}
      <div className="form-actions">
        {preview.data && (
          <Button variant="primary" icon="undo" isPending={restore.isPending} onPress={() => restore.mutate()}>{t('deleted.restore')}</Button>
        )}
        <Button isDisabled={restore.isPending} onPress={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}

/** The request behind "Delete in SSI" for a deleted Dive still there. */
function useDeleteThere(p: ProviderRef, diveId: string) {
  const pt = useProviderText(p);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dives/{id}/providers/{provider}', { params: { path: { id: diveId, provider: p.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.deletedDives });
      announce(pt('deleted'));
    },
  });
}

interface DeleteThereProps { provider: ProviderRef; diveId: string; name: string; remoteNumber: number | null; onDone: () => void }

/** "Delete in SSI" for a deleted Dive still there: asks first, since the Provider may not bring it back. */
function DeleteThere({ provider: p, diveId, name, remoteNumber, onDone }: DeleteThereProps) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const remove = useDeleteThere(p, diveId);
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

/** The same question opened from the row's menu. */
function DeleteDialog({ provider: p, diveId, remoteNumber, onDone, isOpen, onOpenChange }: DeleteThereProps & {
  isOpen: boolean; onOpenChange: (open: boolean) => void;
}) {
  const pt = useProviderText(p);
  const remove = useDeleteThere(p, diveId);
  return (
    <ConfirmDialog
      isOpen={isOpen} onOpenChange={onOpenChange} title={pt('deleteTitle')} body={pt('deleteBodyDeleted', { number: remoteNumber ?? '' })}
      confirmLabel={pt('delete')} onConfirm={() => remove.mutateAsync()} onDone={onDone}
    />
  );
}
