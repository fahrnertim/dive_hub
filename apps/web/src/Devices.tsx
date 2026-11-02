import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, devicesQuery, diversQuery, keys, unwrap, type DeviceView, type DiverView } from './api.ts';
import { deviceName } from './lib/devices.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Muted, Notice, Panel, RowsSkeleton, Select, Table } from './ui/index.ts';

/** The dive computers the User's recordings came from, and whose Diver each one belongs to (ADR 0016); a section of Settings. */
export function Devices() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const devices = useQuery(devicesQuery());
  const divers = useQuery(diversQuery());
  return (
    <Panel>
      <Muted>{t('divers.devicesIntro')}</Muted>
      {/* Said once here, not under every device's select (UI review A2). */}
      {(divers.data?.length ?? 0) > 1 && (devices.data?.length ?? 0) > 0 && <Muted>{t('divers.assignHint')}</Muted>}
      {devices.isPending && <RowsSkeleton rows={3} />}
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
