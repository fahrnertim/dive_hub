import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { diveQuery } from './api.ts';
import { DepthProfile } from './DepthProfile.tsx';
import { formatDepth, formatDuration, formatLocalDateTime } from './format.ts';

type Summary = Record<string, unknown>;
const n = (v: unknown) => (typeof v === 'number' ? v : undefined);

export function DiveDetail({ id }: { id: string }) {
  const dive = useQuery(diveQuery(id));
  const [selected, setSelected] = useState<string>();

  if (dive.isPending) return <p className="hint">Loading…</p>;
  if (dive.error) return <p className="error">{dive.error.message}</p>;
  const d = dive.data;
  const recording = d.recordings.find((r) => r.id === selected) ?? d.recordings.find((r) => r.isPrimary) ?? d.recordings[0];
  const s: Summary = recording?.summary ?? {};
  const gases = (s.gases as { o2: number; he: number }[] | undefined) ?? [];

  return (
    <section className="card">
      <p><a href="#/">← Logbook</a></p>
      <h2>Dive {d.number ?? ''} · {formatLocalDateTime(d.startsAt, d.utcOffsetSeconds)}</h2>
      <dl className="facts">
        <div><dt>Max depth</dt><dd>{formatDepth(d.maxDepthM)}</dd></div>
        <div><dt>Avg depth</dt><dd>{formatDepth(d.avgDepthM)}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(d.durationSeconds)}</dd></div>
        {n(s.minTemperatureC) !== undefined && <div><dt>Water</dt><dd>{n(s.minTemperatureC)}–{n(s.maxTemperatureC)} °C</dd></div>}
        {gases.length > 0 && (
          <div><dt>Gas</dt><dd>{gases.map((g) => (g.he > 0 ? `${g.o2}/${g.he}` : g.o2 === 21 ? 'Air' : `EAN${g.o2}`)).join(', ')}</dd></div>
        )}
        {n(s.gfLow) !== undefined && <div><dt>Gradient factors</dt><dd>{n(s.gfLow)}/{n(s.gfHigh)}</dd></div>}
        {typeof s.waterType === 'string' && <div><dt>Water type</dt><dd>{s.waterType}</dd></div>}
      </dl>

      {d.recordings.length > 1 && (
        <div className="recordings">
          Recordings:{' '}
          {d.recordings.map((r, i) => (
            <button key={r.id} className={r.id === recording?.id ? 'active' : ''} onClick={() => setSelected(r.id)}>
              {i + 1}{r.isPrimary ? ' (primary)' : ''}
            </button>
          ))}
        </div>
      )}
      {recording && <DepthProfile recordingId={recording.id} />}
    </section>
  );
}
