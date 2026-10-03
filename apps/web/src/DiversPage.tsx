import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, devicesQuery, diversQuery, keys, unwrap, type DeviceView, type DiverView } from './api.ts';
import { deviceName } from './lib/devices.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { announce } from './lib/announce.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import { Button, Form, Muted, Notice, PageHeader, Panel, Select, Table, TextField } from './ui/index.ts';

/** The Divers whose logbooks the User keeps, and their Devices (ADR 0016). */
export function DiversPage() {
  const { t } = useTranslation();
  usePageTitle(t('divers.title'));
  return (
    <>
      <PageHeader title={t('divers.title')} />
      <Divers />
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
      <td>{d.lastUsedAt ? display.dateTime(d.lastUsedAt) : t('common.none')}</td>
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
