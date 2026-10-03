import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { divesQuery, diversQuery } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { usePageTitle } from './lib/page.ts';
import { Muted, Notice, Panel, Select, Table } from './ui/index.ts';

const ALL = 'all';

/** The logbook: Dives of the User's Divers, newest first; with several Divers, a filter and a column. */
export function DiveList({ diverId }: { diverId?: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dives = useQuery(divesQuery(diverId));
  const divers = useQuery(diversQuery());
  const several = (divers.data?.length ?? 0) > 1;
  const nameOf = new Map(divers.data?.map((d) => [d.id, d.name]));
  usePageTitle(t('logbook.title'));

  return (
    <Panel
      title={t('logbook.title')}
      level={1}
      actions={several && (
        <div className="logbook-filter">
          <Select
            label={t('divers.filter')}
            value={diverId ?? ALL}
            onChange={(v) => { location.hash = !v || v === ALL ? '/' : `/?diver=${v}`; }}
            options={[{ id: ALL, label: t('divers.allDivers') }, ...(divers.data ?? []).map((d) => ({ id: d.id, label: d.name }))]}
          />
        </div>
      )}
    >
      {dives.isPending && <Muted>{t('common.loading')}</Muted>}
      {dives.error && <Notice tone="danger">{errorText(dives.error)}</Notice>}
      {dives.data?.length === 0 && <Muted>{t('logbook.empty')}</Muted>}
      {dives.data && dives.data.length > 0 && (
        <Table
          label={t('logbook.title')}
          head={[
            { label: t('logbook.number'), numeric: true }, t('logbook.date'), ...(several ? [t('dive.diver')] : []),
            { label: t('logbook.maxDepth'), numeric: true }, { label: t('logbook.duration'), numeric: true },
          ]}
        >
          {dives.data.map((d) => (
            // The date is the link (keyboard and screen readers); the whole row is a larger click target.
            <tr key={d.id} className="row-link" onClick={() => { location.hash = `/dives/${d.id}`; }}>
              <td className="num">{d.number ?? t('common.none')}</td>
              <td><a href={`#/dives/${d.id}`}>{display.diveTime(d.startsAt, d.utcOffsetSeconds)}</a></td>
              {several && <td>{nameOf.get(d.diverId) ?? t('common.none')}</td>}
              <td className="num">{display.depth(d.maxDepthM)}</td>
              <td className="num">{display.duration(d.durationSeconds)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
