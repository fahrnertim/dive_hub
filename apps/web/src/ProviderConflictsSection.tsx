import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, connectionsQuery, keys, providerConflictsQuery, unwrap, type ConflictChoices, type ConflictEntryView, type ConflictsOfConnection,
} from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { useFieldNames } from './lib/providers.ts';
import { ProviderConflicts } from './ProviderConflicts.tsx';
import { Candidates, CandidateRow, type Fact } from './ReviewRows.tsx';
import { Button, Notice, Panel } from './ui/index.ts';

/** What sending one Dive with the User's choices came to; the notice says it to screen readers as it appears. */
type Told = { key: string; tone: 'info' | 'success'; text: string };

/**
 * Dives a run left with Conflicts on the Review page (ADR 0056): values changed both here and at the Provider since the
 * last exchange, which the run left out. One choice per field, Dive Hub's preselected; "Send with these choices" sends
 * the Dive again with them, and the entry is gone. Beside the gone dives, built the same way.
 */
export function ProviderConflictsSection() {
  const { t } = useTranslation();
  const conflicts = useQuery(providerConflictsQuery());
  const connections = useQuery(connectionsQuery());
  const [told, setTold] = useState<Told[]>([]);
  const groups = (conflicts.data ?? []).filter((g) => g.entries.length > 0);
  const tell = (n: Told) => setTold((all) => [...all.filter((a) => a.key !== n.key), n]);
  const diverOf = (g: ConflictsOfConnection) => connections.data?.find((c) => c.id === g.connectionId)?.diverName ?? '';
  return (
    <>
      {told.map((n) => (
        <Notice key={n.key} tone={n.tone}>
          <p>{n.text}</p>
          <Button variant="quiet" onPress={() => setTold((all) => all.filter((a) => a.key !== n.key))}>{t('common.close')}</Button>
        </Notice>
      ))}
      {groups.map((g) => (
        <Group key={g.connectionId} group={g} diver={groups.length > 1 ? diverOf(g) : undefined} onTold={tell} />
      ))}
    </>
  );
}

function Group({ group: g, diver, onTold }: { group: ConflictsOfConnection; diver: string | undefined; onTold: (n: Told) => void }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const fieldNames = useFieldNames();
  const queryClient = useQueryClient();
  const nameOf = (e: ConflictEntryView) => (e.number !== null ? t('dive.title', { number: e.number }) : display.diveTime(e.startsAt, e.utcOffsetSeconds, e.utcOffsetSource));
  // One Dive at a time: the other Dives' buttons wait while one is sent (page rules).
  const send = useMutation({
    mutationFn: async ({ entry, choices }: { entry: ConflictEntryView; choices: ConflictChoices }) =>
      unwrap(await api.POST('/api/dives/{id}/providers/{provider}', { params: { path: { id: entry.diveId, provider: g.provider } }, body: { conflicts: choices } })),
    onSuccess: async (sent, { entry }) => {
      const key = entry.diveId;
      const dive = nameOf(entry);
      if (sent.outcome === 'conflicts') onTold({ key, tone: 'info', text: t('conflicts.again', { dive }) });
      else {
        const taken = sent.taken ?? [];
        const text = t('conflicts.sent', { dive, name: g.providerName });
        onTold({ key, tone: 'success', text: taken.length > 0 ? `${text} ${t('provider.taken', { name: g.providerName, fields: fieldNames(taken) })}` : text });
      }
      await queryClient.invalidateQueries({ queryKey: keys.providerConflicts });
      // The Dive's state at the Provider changed, and values taken from it are in the Dive.
      await queryClient.invalidateQueries({ queryKey: ['dives'] });
    },
  });
  const count = g.entries.length;
  const heading = diver !== undefined ? t('conflicts.titleConnection', { name: g.providerName, diver, count }) : t('conflicts.title', { count });
  return (
    <Panel title={heading} attention>
      <p className="muted">{t('conflicts.intro', { name: g.providerName })}</p>
      <ul className="decisions">
        {g.entries.map((e) => {
          const facts: Fact[] = [
            { key: 'time', text: display.diveTime(e.startsAt, e.utcOffsetSeconds, e.utcOffsetSource) },
            { key: 'depth', text: display.depth(e.maxDepthM) }, { key: 'duration', text: display.duration(e.durationSeconds) },
            { key: 'site', text: e.site?.name },
          ];
          return (
            <li key={e.diveId} className="decision">
              <Candidates>
                <CandidateRow
                  facts={facts} marked={new Set()}
                  title={<a className="candidate-title" href={`#/dives/${e.diveId}`}>{e.number !== null ? t('dive.title', { number: e.number }) : t('dive.titleNoNumber')}</a>}
                />
              </Candidates>
              <ProviderConflicts
                key={e.fields.map((f) => f.field).join()} item={nameOf(e)} conflicts={e.fields} providerName={g.providerName}
                isPending={send.isPending && send.variables.entry.diveId === e.diveId}
                isDisabled={send.isPending && send.variables.entry.diveId !== e.diveId}
                onSend={(choices) => send.mutate({ entry: e, choices })}
              />
            </li>
          );
        })}
      </ul>
      {send.error && <Notice tone="danger">{errorText(send.error)}</Notice>}
    </Panel>
  );
}
