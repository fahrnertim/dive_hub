import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, diverSearchQuery, diversQuery, externalDiversQuery, keys, meQuery, unwrap, type DiverView, type ExternalDiverView,
} from './api.ts';
import { DiverCodesDialog, TakeCodeDialog } from './DiverCodes.tsx';
import { useSameName } from './lib/divers.ts';
import { useErrorText } from './lib/display.ts';
import { announce } from './lib/announce.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import { ActionMenu, Button, ConfirmDialog, Dialog, DiverAvatar, Form, Muted, Notice, PageHeader, Panel, RowsSkeleton, SearchList, TextField, type MenuAction, type SearchListItem } from './ui/index.ts';

/** The Divers whose logbooks the User keeps, and the other divers Users dived with (ADR 0028). Their Devices are in Settings. */
export function DiversPage({ open }: { open?: string | undefined }) {
  const { t } = useTranslation();
  usePageTitle(t('divers.title'));
  return (
    <>
      <PageHeader title={t('divers.title')} />
      <Divers open={open} />
      <OtherDivers />
    </>
  );
}

/**
 * `open` is the address's `certifications` from before the Diver pages: `own` or a Diver's id. Once the list is here
 * the address is replaced (so Back doesn't come round to it again) by that Diver's page with the section open, or by
 * the list when nobody has that id.
 */
function Divers({ open }: { open: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const divers = useQuery(diversQuery());
  const target = open ? divers.data?.find((d) => (open === 'own' ? d.isOwn : d.id === open)) : undefined;
  // The list stays behind the skeleton only while the address is on its way to a page; an unknown id shows the list at once.
  const leaving = !!target;
  useEffect(() => {
    if (!open || !divers.data) return;
    location.replace(target ? `#/divers/${target.id}?open=certifications` : '#/divers');
  }, [open, divers.data, target]);
  const sameName = useSameName();
  const create = useMutation({
    mutationFn: async (name: string) => unwrap(await api.POST('/api/divers', { body: { name } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.divers }),
  });
  const [name, setName] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: (created) => { setName(''); announce(t('divers.added', { name: created.name })); },
    });
  };

  return (
    <Panel title={t('divers.logbooks')}>
      <Muted>{t('divers.intro')}</Muted>
      {(divers.isPending || leaving) && <RowsSkeleton rows={3} />}
      {divers.error && <Notice tone="danger">{errorText(divers.error)}</Notice>}
      <ul className="diver-list">
        {!leaving && divers.data?.map((d) => <DiverRow key={d.id} diver={d} />)}
      </ul>
      <Form className="form-inline" onSubmit={submit}>
        <TextField
          label={t('divers.add')} name="name" isRequired maxLength={100} autoComplete="off" value={name} onChange={setName}
          description={sameName(divers.data, name) ?? t('divers.addHint')}
        />
        <Button type="submit" icon="add" isPending={create.isPending}>{t('divers.create')}</Button>
      </Form>
      {create.error && <Notice tone="danger">{errorText(create.error)}</Notice>}
    </Panel>
  );
}

/** A kept Diver: the name leads to their page, the dive count to their logbook, and the cards are counted. */
function DiverRow({ diver: d }: { diver: DiverView }) {
  const { t } = useTranslation();
  return (
    <li className="diver-row reveal">
      <DiverAvatar inline name={d.name} diverId={d.id} />
      <span className="diver-name"><a href={`#/divers/${d.id}`}>{d.name}</a>{d.isOwn && <span className="meta"> ({t('divers.own')})</span>}</span>
      <a href={`#/?diver=${d.id}`} className="meta">{t('divers.dives', { count: d.diveCount })}</a>
      <span className="meta">{d.certifications.count > 0 ? t('divers.cards', { count: d.certifications.count }) : t('certifications.summaryNone')}</span>
    </li>
  );
}

/** Admins: merges an external Diver into another Diver, the same person (ADR 0028), picked by name. */
function MergeDialog({ diver: d, onClose }: { diver: ExternalDiverView; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const found = useQuery(diverSearchQuery(text.trim()));
  const merge = useMutation({
    mutationFn: async (into: string) => unwrap(await api.POST('/api/admin/divers/{id}/merge', { params: { path: { id: d.id } }, body: { into } })),
    onSuccess: async (_answer, into) => {
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('divers.merged', { name: d.name, into: found.data?.find((x) => x.id === into)?.name ?? '' }));
      onClose();
    },
  });
  const items: SearchListItem[] = (found.data ?? []).filter((x) => x.id !== d.id).map((x) => ({
    id: x.id, name: x.name, detail: x.managed ? t('participants.yours') : x.external ? t('participants.external') : t('participants.otherUser'),
  }));
  return (
    <Dialog title={t('divers.mergeTitle', { name: d.name })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="provider-sites">
        <p>{t('divers.mergeIntro', { name: d.name })}</p>
        <SearchList
          label={t('participants.who')} query={text} onQueryChange={setText} autoFocus items={items} onPick={(id) => merge.mutate(id)}
          isPending={merge.isPending} pendingStatus={t('common.saving')} listLabel={t('participants.divers')}
          status={found.isPending ? t('common.loading') : null}
          empty={text.trim() ? t('participants.noMatch', { q: text.trim() }) : t('participants.typeName')}
        />
        {merge.error && <Notice tone="danger">{errorText(merge.error)}</Notice>}
        <div className="form-actions"><Button onPress={onClose}>{t('common.cancel')}</Button></div>
      </div>
    </Dialog>
  );
}

/**
 * People Users dived with who keep no logbook here (ADR 0028): every User sees and renames them; whoever added one, or
 * an admin, deletes one while no dive lists it. Narrowed by name while typing.
 */
function OtherDivers() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const others = useQuery(externalDiversQuery(q.trim()));
  const list = useRef<HTMLUListElement>(null);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async (n: string) => unwrap(await api.POST('/api/external-divers', { body: { name: n } })),
    onSuccess: async (created) => {
      setName('');
      announce(t('divers.added', { name: created.name }));
      await queryClient.invalidateQueries({ queryKey: keys.divers });
    },
  });
  const rows = others.data?.divers ?? [];
  const [scanning, setScanning] = useState(false);
  // The Diver a code was just taken for: its codes open, whichever list it is in.
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);

  return (
    <Panel title={t('divers.others')} actions={<Button icon="code" onPress={() => setScanning(true)}>{t('diverCodes.scan')}</Button>}>
      <Muted>{t('divers.othersIntro')}</Muted>
      <TextField label={t('divers.findOther')} name="q" type="search" autoComplete="off" value={q} onChange={setQ} />
      {others.isPending && <RowsSkeleton rows={3} />}
      {others.error && <Notice tone="danger">{errorText(others.error)}</Notice>}
      {others.data && rows.length === 0 && <Muted>{q.trim() ? t('divers.noOtherMatch', { q: q.trim() }) : t('divers.noOthers')}</Muted>}
      {rows.length > 0 && (
        <ul className="diver-list" ref={list}>
          {rows.map((d, index) => <OtherDiverRow key={d.id} diver={d} list={list} index={index} count={rows.length} />)}
        </ul>
      )}
      <Form className="form-inline" onSubmit={(e) => { e.preventDefault(); create.mutate(name.trim()); }}>
        <TextField label={t('divers.addOther')} name="otherName" isRequired maxLength={100} autoComplete="off" value={name} onChange={setName} />
        <Button type="submit" icon="add" isPending={create.isPending}>{t('divers.createOther')}</Button>
      </Form>
      {create.error && <Notice tone="danger">{errorText(create.error)}</Notice>}
      {scanning && <TakeCodeDialog onClose={() => setScanning(false)} onTaken={(diver) => { setScanning(false); setTaken(diver); }} />}
      {taken && <DiverCodesDialog diverId={taken.id} name={taken.name} onClose={() => setTaken(null)} />}
    </Panel>
  );
}

function OtherDiverRow({ diver: d, list, index, count }: { diver: ExternalDiverView; list: RefObject<HTMLUListElement | null>; index: number; count: number }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [codes, setCodes] = useState(false);
  const admin = useQuery(meQuery()).data?.user.role === 'admin';
  const [newName, setNewName] = useState(d.name);
  const [deleting, setDeleting] = useState(false);
  // When renaming ends (saved or cancelled), focus goes back to the row's actions (UI review B1).
  const actionsBox = useRef<HTMLSpanElement>(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (wasRenaming.current && !renaming) actionsBox.current?.querySelector('button')?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.divers });
  const rename = useMutation({
    mutationFn: async (n: string) => unwrap(await api.PATCH('/api/external-divers/{id}', { params: { path: { id: d.id } }, body: { name: n } })),
    onSuccess: () => { setRenaming(false); void refresh(); },
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/external-divers/{id}', { params: { path: { id: d.id } } })),
    onSuccess: async () => {
      await refresh();
      announce(t('divers.removed', { name: d.name }));
      refocusAfterRemoval(list.current, index, count);
    },
  });

  // The row's secondary actions in one menu; the dialogs and the rename field are the ones they always were.
  const actions: MenuAction[] = [
    { id: 'codes', label: t('diverCodes.open'), icon: 'code', onAction: () => setCodes(true) },
    { id: 'rename', label: t('divers.rename'), icon: 'edit', onAction: () => { setNewName(d.name); setRenaming(true); } },
    ...(admin ? [{ id: 'merge', label: t('divers.merge'), icon: 'merge' as const, onAction: () => setMerging(true) }] : []),
    ...(d.canDelete && !d.inUse ? [{ id: 'delete', label: t('divers.delete'), icon: 'delete' as const, onAction: () => setDeleting(true) }] : []),
  ];

  return (
    <li className="diver-row">
      {renaming ? (
        <Form className="form-inline" onSubmit={(e) => { e.preventDefault(); rename.mutate(newName.trim()); }}>
          <TextField label={t('divers.newName')} name="name" value={newName} onChange={setNewName} isRequired maxLength={100} autoComplete="off" autoFocus />
          <Button type="submit" variant="primary" icon="save" isPending={rename.isPending}>{t('divers.save')}</Button>
          <Button onPress={() => setRenaming(false)}>{t('common.cancel')}</Button>
        </Form>
      ) : (
        <>
          <DiverAvatar inline name={d.name} diverId={d.id} />
          <span className="diver-name">{d.name}</span>
          <span className="meta">{[
            ...d.accounts.map((source) => t('divers.hasAccount', { name: t(`divers.service.${source}`) })),
            d.inUse ? t('divers.onDives') : t('divers.onNoDive'),
          ].join(' · ')}</span>
          <span className="actions" ref={actionsBox}>
            <ActionMenu label={t('divers.actions')} aria-label={t('common.forItem', { action: t('divers.actions'), item: d.name })} actions={actions} />
          </span>
        </>
      )}
      {rename.error && <Notice tone="danger">{errorText(rename.error)}</Notice>}
      {merging && <MergeDialog diver={d} onClose={() => setMerging(false)} />}
      <ConfirmDialog
        isOpen={deleting} onOpenChange={setDeleting} title={t('divers.deleteTitle', { name: d.name })} body={t('divers.deleteBody', { name: d.name })}
        confirmLabel={t('divers.delete')} onConfirm={() => remove.mutateAsync()}
      />
      {codes && <DiverCodesDialog diverId={d.id} name={d.name} onClose={() => setCodes(false)} />}
    </li>
  );
}
