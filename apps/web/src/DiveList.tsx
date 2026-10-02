import { useQuery } from '@tanstack/react-query';
import { divesQuery } from './api.ts';
import { formatDepth, formatDuration, formatLocalDateTime } from './format.ts';

export function DiveList() {
  const dives = useQuery(divesQuery());

  return (
    <section className="card">
      <h2>Logbook</h2>
      {dives.isPending && <p className="hint">Loading…</p>}
      {dives.error && <p className="error">{dives.error.message}</p>}
      {dives.data?.length === 0 && <p className="hint">No dives yet. Import a FIT file above.</p>}
      {dives.data && dives.data.length > 0 && (
        <table className="dives">
          <thead>
            <tr><th>#</th><th>Date</th><th>Max depth</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {dives.data.map((d) => (
              <tr key={d.id} onClick={() => { location.hash = `/dives/${d.id}`; }}>
                <td>{d.number ?? '–'}</td>
                <td><a href={`#/dives/${d.id}`}>{formatLocalDateTime(d.startsAt, d.utcOffsetSeconds)}</a></td>
                <td>{formatDepth(d.maxDepthM)}</td>
                <td>{formatDuration(d.durationSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
