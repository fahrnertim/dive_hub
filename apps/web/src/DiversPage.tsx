import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, devicesQuery, diverSearchQuery, diversQuery, externalDiversQuery, keys, meQuery, unwrap, type DeviceView, type DiverView, type ExternalDiverView,
} from './api.ts';
import { deviceName } from './lib/devices.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { announce } from './lib/announce.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import { Button, Dialog, Form, Muted, Notice, PageHeader, Panel, SearchList, Select, Table, TextField, type SearchListItem } from './ui/index.ts';

/** The Divers whose logbooks the User keeps, their Devices (ADR 0016), and the other divers Users dived with (ADR 0028). */
export function DiversPage() {
  const { t } = useTranslation();
  usePageTitle(t('divers.title'));
  return (
    <>
      <PageHeader title={t('divers.title')} />
      <Divers />
      <OtherDivers />
      <Devices />
    </>
  );
}

function Divers() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const divers = useQuery(diversQuery());
  const sameName = useSameName();
  const list = useRef<HTMLUListElement>(null);
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
      {divers.isPending && <Muted>{t('common.loading')}</Muted>}
      {divers.error && <Notice tone="danger">{errorText(divers.error)}</Notice>}
      <ul className="diver-list" ref={list}>
        {divers.data?.map((d, index) => <DiverRow key={d.id} diver={d} list={list} index={index} count={divers.data.length} />)}
      </ul>
      <Form className="form-inline" onSubmit={submit}>
        <TextField
          label={t('divers.add')} name="name" isRequired maxLength={100} autoComplete="off" value={name} onChange={setName}
          description={sameName(divers.data, name) ?? ''}
        />
        <Button type="submit" icon="add" isPending={create.isPending}>{t('divers.create')}</Button>
      </Form>
      {create.error && <Notice tone="danger">{errorText(create.error)}</Notice>}
    </Panel>
  );
}

/** A warning when another Diver already has this name (still allowed; UI review C9). */
function useSameName() {
  const { t } = useTranslation();
  return (divers: DiverView[] | undefined, name: string, except?: string) => {
    const wanted = name.trim().toLocaleLowerCase();
    const twin = wanted && divers?.find((d) => d.id !== except && d.name.toLocaleLowerCase() === wanted);
    return twin ? t('divers.sameName', { name: twin.name }) : undefined;
  };
}

function DiverRow({ diver: d, list, index, count }: { diver: DiverView; list: RefObject<HTMLUListElement | null>; index: number; count: number }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(d.name);
  const all = useQuery(diversQuery());
  const sameName = useSameName();
  // When renaming ends (saved or cancelled), focus goes back to "Rename" (UI review B1).
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (wasRenaming.current && !renaming) renameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.divers });
  const rename = useMutation({
    mutationFn: async (name: string) => unwrap(await api.PATCH('/api/divers/{id}', { params: { path: { id: d.id } }, body: { name } })),
    onSuccess: () => { setRenaming(false); void refresh(); },
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/divers/{id}', { params: { path: { id: d.id } } })),
    onSuccess: async () => {
      await refresh();
      refocusAfterRemoval(list.current, index, count);
    },
  });
  const empty = d.diveCount === 0 && d.deviceCount === 0;

  return (
    <li className="diver-row">
      {renaming ? (
        <Form
          className="form-inline"
          onSubmit={(e) => { e.preventDefault(); rename.mutate(newName.trim()); }}
        >
          <TextField
            label={t('divers.newName')} name="name" value={newName} onChange={setNewName} isRequired maxLength={100} autoComplete="off" autoFocus
            description={sameName(all.data, newName, d.id) ?? ''}
          />
          <Button type="submit" variant="primary" icon="save" isPending={rename.isPending}>{t('divers.save')}</Button>
          <Button onPress={() => setRenaming(false)}>{t('common.cancel')}</Button>
        </Form>
      ) : (
        <>
          <span className="diver-name">{d.name}{d.isOwn && ` (${t('divers.own')})`}</span>
          <a href={`#/?diver=${d.id}`} className="meta">{t('divers.dives', { count: d.diveCount })}</a>
          <span className="actions">
            <Button ref={renameButton} variant="quiet" aria-label={t('common.forItem', { action: t('divers.rename'), item: d.name })} onPress={() => { setNewName(d.name); setRenaming(true); }}>
              {t('divers.rename')}
            </Button>
            {!d.isOwn && empty && (
              <Button variant="quiet" aria-label={t('common.forItem', { action: t('divers.delete'), item: d.name })} isPending={remove.isPending} onPress={() => remove.mutate()}>
                {t('divers.delete')}
              </Button>
            )}
          </span>
        </>
      )}
      {(rename.error ?? remove.error) && <Notice tone="danger">{errorText(rename.error ?? remove.error)}</Notice>}
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

  return (
    <Panel title={t('divers.others')}>
      <Muted>{t('divers.othersIntro')}</Muted>
      <TextField label={t('divers.findOther')} name="q" type="search" autoComplete="off" value={q} onChange={setQ} />
      {others.isPending && <Muted>{t('common.loading')}</Muted>}
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
    </Panel>
  );
}

function OtherDiverRow({ diver: d, list, index, count }: { diver: ExternalDiverView; list: RefObject<HTMLUListElement | null>; index: number; count: number }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const admin = useQuery(meQuery()).data?.user.role === 'admin';
  const [newName, setNewName] = useState(d.name);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (wasRenaming.current && !renaming) renameButton.current?.focus();
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
          <span className="diver-name">{d.name}</span>
          <span className="meta">{[
            ...d.accounts.map((source) => t('divers.hasAccount', { name: t(`divers.service.${source}`) })),
            d.inUse ? t('divers.onDives') : t('divers.onNoDive'),
          ].join(' · ')}</span>
          <span className="actions">
            <Button ref={renameButton} variant="quiet" aria-label={t('common.forItem', { action: t('divers.rename'), item: d.name })} onPress={() => { setNewName(d.name); setRenaming(true); }}>
              {t('divers.rename')}
            </Button>
            {admin && (
              <Button variant="quiet" aria-label={t('common.forItem', { action: t('divers.merge'), item: d.name })} onPress={() => setMerging(true)}>
                {t('divers.merge')}
              </Button>
            )}
            {d.canDelete && !d.inUse && (
              <Button variant="quiet" aria-label={t('common.forItem', { action: t('divers.delete'), item: d.name })} isPending={remove.isPending} onPress={() => remove.mutate()}>
                {t('divers.delete')}
              </Button>
            )}
          </span>
        </>
      )}
      {(rename.error ?? remove.error) && <Notice tone="danger">{errorText(rename.error ?? remove.error)}</Notice>}
      {merging && <MergeDialog diver={d} onClose={() => setMerging(false)} />}
    </li>
  );
}

function Devices() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const devices = useQuery(devicesQuery());
  const divers = useQuery(diversQuery());
  return (
    <Panel title={t('divers.devices')}>
      <Muted>{t('divers.devicesIntro')}</Muted>
      {/* Said once here, not under every device's select (UI review A2). */}
      {(divers.data?.length ?? 0) > 1 && (devices.data?.length ?? 0) > 0 && <Muted>{t('divers.assignHint')}</Muted>}
      {devices.isPending && <Muted>{t('common.loading')}</Muted>}
      {devices.error && <Notice tone="danger">{errorText(devices.error)}</Notice>}
      {devices.data?.length === 0 && <Muted>{t('divers.noDevices')}</Muted>}
      {devices.data && devices.data.length > 0 && divers.data && (
        <Table cards
          label={t('divers.devices')}
          head={[t('divers.deviceName'), t('divers.serial'), { label: t('divers.recordings'), numeric: true }, t('divers.lastUsed'), t('divers.belongsTo')]}
        >
          {devices.data.map((d) => <DeviceRow key={d.id} device={d} divers={divers.data} />)}
        </Table>
      )}
    </Panel>
  );
}

function DeviceRow({ device: d, divers }: { device: DeviceView; divers: DiverView[] }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const assign = useMutation({
    mutationFn: async (diverId: string) => unwrap(await api.PATCH('/api/devices/{id}', { params: { path: { id: d.id } }, body: { diverId } })),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.devices });
      await queryClient.invalidateQueries({ queryKey: keys.divers });
    },
  });
  return (
    <tr>
      <td translate="no">{deviceName(d.manufacturer, d.product)}</td>
      <td translate="no">{d.serialNumber}</td>
      <td className="num">{d.recordingCount}</td>
      <td className="date">{d.lastUsedAt ? display.dateTime(d.lastUsedAt) : t('common.none')}</td>
      <td className="device-owner">
        <Select
          label={<span className="visually-hidden">{t('divers.belongsToDevice', { device: `${deviceName(d.manufacturer, d.product)} ${d.serialNumber}` })}</span>}
          size="small"
          value={d.diverId}
          onChange={(diverId) => diverId && diverId !== d.diverId && assign.mutate(diverId)}
          options={divers.map((v) => ({ id: v.id, label: v.name }))}
        />
        {assign.error && <Notice tone="danger">{errorText(assign.error)}</Notice>}
      </td>
    </tr>
  );
}
