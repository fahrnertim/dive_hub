import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ConnectionView } from './api.ts';
import { Button, Muted, Notice, TextField } from './ui/index.ts';

// TEMPORARY (ADR 0048, "As built"): runs the owner's checks of how SSI treats a dive's number, with this Connection's own
// access, and shows what they print. Not translated on purpose. Delete this file, its line in Connections.tsx and
// `temp-number-checks-route.ts` on the server once the answers are in the ADR.
type Result = { lines: string[]; failed: string | null };

export function TempSsiNumberChecks({ connection: c }: { connection: ConnectionView }) {
  const [siteId, setSiteId] = useState('');
  const [diveId, setDiveId] = useState('');
  const [to, setTo] = useState('');
  const [lookup, setLookup] = useState('86, 87, 92');
  const run = useMutation({
    mutationFn: async (only: 'lookup' | 'checks'): Promise<Result> => {
      const numbers = lookup.split(/[^0-9]+/).filter(Boolean).map(Number);
      const dive = diveId.trim() && to.trim() ? { id: diveId.trim(), to: Number(to) } : undefined;
      const response = await fetch(`/api/connections/${c.id}/temp-ssi-number-checks`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(only === 'lookup' ? { lookup: numbers } : { ...(siteId.trim() && { siteId: siteId.trim() }), ...(dive && { dive }) }),
      });
      if (!response.ok) throw new Error(`The server answered ${response.status}`);
      return await response.json() as Result;
    },
  });
  if (c.provider !== 'ssi' || c.state !== 'active') return null;
  return (
    <div className="provider-import">
      <strong>Check numbers at SSI (temporary)</strong>
      <Muted>
        Makes a few throwaway dives dated 2000 in your SSI account, tries to change and to repeat a number, and deletes them again.
        It takes a minute. Fill in the last two fields only to set the number of one existing (for example verified) dive.
      </Muted>
      <TextField label="SSI site ID (empty: the first site of your logbook)" value={siteId} onChange={setSiteId} />
      <TextField label="SSI dive ID of one existing dive (optional)" value={diveId} onChange={setDiveId} />
      <TextField label="Number to set on that dive" value={to} onChange={setTo} inputMode="numeric" />
      <TextField label="SSI dive numbers to look up (read only)" value={lookup} onChange={setLookup} />
      <Button isPending={run.isPending} aria-label={`Look up these numbers at SSI: ${c.diverName}`} onPress={() => run.mutate('lookup')}>Look up these numbers at SSI</Button>
      <Button isPending={run.isPending} aria-label={`Run the number checks at SSI: ${c.diverName}`} onPress={() => run.mutate('checks')}>Run the number checks at SSI</Button>
      {run.error && <Notice tone="danger">{run.error.message}</Notice>}
      {run.data?.failed && <Notice tone="danger">{run.data.failed}</Notice>}
      {run.data && <pre className="temp-checks-output" role="log" aria-label="Output of the number checks">{run.data.lines.join('\n') || '(nothing printed)'}</pre>}
    </div>
  );
}
