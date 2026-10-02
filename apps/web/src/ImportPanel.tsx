import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { importsQuery, keys, uploadFile, type ImportView } from './api.ts';

const RESULT_LABEL: Record<string, string> = {
  created: 'new dive',
  attached: 'added to existing dive',
  updated: 'updated',
  unchanged: 'already imported',
  'duplicate-candidate': 'needs your decision',
  skipped: 'skipped',
  failed: 'failed',
};

export function ImportPanel() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const imports = useQuery(importsQuery());

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadFile(file);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.imports }),
  });

  // When an Import finishes, the logbook may have new dives.
  const running = imports.data?.some((i) => i.status === 'pending' || i.status === 'processing');
  useEffect(() => {
    if (!running) void queryClient.invalidateQueries({ queryKey: keys.dives });
  }, [running, queryClient]);

  const send = (list: FileList | null) => {
    if (list && list.length > 0) upload.mutate(Array.from(list));
  };

  return (
    <section className="card">
      <h2>Import</h2>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <p><strong>Drop Garmin FIT files or zips here</strong>, or click to choose.</p>
        <p className="hint">“Export Original” zips from Garmin Connect and files copied from the watch both work.</p>
        <input ref={input} type="file" accept=".fit,.zip" multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
      </div>
      {upload.isPending && <p className="hint">Uploading…</p>}
      {upload.error && <p className="error">{upload.error.message}</p>}
      {imports.data && imports.data.length > 0 && (
        <ul className="imports">
          {imports.data.slice(0, 8).map((i) => <ImportRow key={i.id} item={i} />)}
        </ul>
      )}
    </section>
  );
}

function ImportRow({ item }: { item: ImportView }) {
  return (
    <li>
      <span className="name">{item.uploadName}</span>
      <span className={`status ${item.status}`}>{item.status}</span>
      {item.error && <span className="error">{item.error}</span>}
      {item.outcome.map((o, n) => (
        <span key={n} className="outcome">
          {o.diveId ? <a href={`#/dives/${o.diveId}`}>{RESULT_LABEL[o.result] ?? o.result}</a> : (RESULT_LABEL[o.result] ?? o.result)}
          {o.message && ` (${o.message})`}
        </span>
      ))}
    </li>
  );
}
