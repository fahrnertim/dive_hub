import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { divesQuery } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Muted, Notice, Panel, Table } from './ui/index.ts';

export function DiveList() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const dives = useQuery(divesQuery());

  return (
    <Panel title={t('logbook.title')}>
      {dives.isPending && <Muted>{t('common.loading')}</Muted>}
      {dives.error && <Notice tone="danger">{errorText(dives.error)}</Notice>}
      {dives.data?.length === 0 && <Muted>{t('logbook.empty')}</Muted>}
      {dives.data && dives.data.length > 0 && (
        <Table
          label={t('logbook.title')}
          head={[
            { label: t('logbook.number'), numeric: true }, t('logbook.date'),
            { label: t('logbook.maxDepth'), numeric: true }, { label: t('logbook.duration'), numeric: true },
          ]}
        >
          {dives.data.map((d) => (
            // The date is the link (keyboard and screen readers); the whole row is a larger click target.
            <tr key={d.id} className="row-link" onClick={() => { location.hash = `/dives/${d.id}`; }}>
              <td className="num">{d.number ?? t('common.none')}</td>
              <td><a href={`#/dives/${d.id}`}>{display.diveTime(d.startsAt, d.utcOffsetSeconds)}</a></td>
              <td className="num">{display.depth(d.maxDepthM)}</td>
              <td className="num">{display.duration(d.durationSeconds)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
