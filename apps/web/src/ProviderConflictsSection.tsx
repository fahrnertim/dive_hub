import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, connectionsQuery, keys, providerConflictsQuery, unwrap, type ConflictChoices, type ConflictEntryView, type ConflictsOfConnection,
} from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { ProviderConflicts, useConflictValueText } from './ProviderConflicts.tsx';
import { Candidates, CandidateRow, type Fact } from './ReviewRows.tsx';
import { Button, Icon, Muted, Notice, Panel } from './ui/index.ts';

/** What choosing for one Dive came to; the notice says it to screen readers as it appears. */
type Told = { key: string; text: string };
/** What the User chose: a way out of an `exists` answer, or a choice per Conflict field. */
type Decision = { onExisting: 'link' | 'create' } | { conflicts: ConflictChoices };

/** How long the page waits before it asks again while choices are queued; the worker sends within a minute. */
const WHILE_QUEUED_MS = 5000;

/**
 * What waits for the User's choice on the Review page (ADR 0056): Dives a run or a fetch left with Conflicts (values
 * changed both here and at the Provider since the last exchange; one choice per field, Dive Hub's preselected), and Dives
 * the Provider already has a dive for ("Link to it" or "Create a new one"). A choice queues the Dive, due now: the worker
 * sends it. The entry stays listed until then, shown as waiting, so it can't be chosen for twice.
 */
export function ProviderConflictsSection() {
  const { t } = useTranslation();
  // What is queued is the server's to say (`queued`), so a reload or a second device sees it too.
  const conflicts = useQuery({
    ...providerConflictsQuery(),
    refetchInterval: (q) => (q.state.data?.some((g) => g.entries.some((e) => e.queued)) ? WHILE_QUEUED_MS : false),
  });
  const connections = useQuery(connectionsQuery());
  const [told, setTold] = useState<Told[]>([]);
  const groups = (conflicts.data ?? []).filter((g) => g.entries.length > 0);
  const tell = (n: Told) => setTold((all) => [...all.filter((a) => a.key !== n.key), n]);
  const diverOf = (g: ConflictsOfConnection) => connections.data?.find((c) => c.id === g.connectionId)?.diverName ?? '';
  return (
    <>
      {told.map((n) => (
        <Notice key={n.key} tone="info">
          <p>{n.text}</p>
          <Button variant="quiet" onPress={() => setTold((all) => all.filter((a) => a.key !== n.key))}>{t('common.close')}</Button>
        </Notice>
      ))}
      {groups.map((g) => (
        <Group
          key={g.connectionId} group={g} diver={groups.length > 1 ? diverOf(g) : undefined} onTold={tell} />
      ))}
    </>
  );
}

function Group({ group: g, diver, onTold }: { group: ConflictsOfConnection; diver: string | undefined; onTold: (n: Told) => void }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const valueText = useConflictValueText();
  const queryClient = useQueryClient();
  const nameOf = (e: ConflictEntryView) => (e.number !== null ? t('dive.title', { number: e.number }) : display.diveTime(e.startsAt, e.utcOffsetSeconds, e.utcOffsetSource));
  // One Dive at a time: the other Dives' buttons wait while one is queued (page rules).
  const decide = useMutation({
    mutationFn: async ({ entry, decision }: { entry: ConflictEntryView; decision: Decision }) =>
      unwrap(await api.POST('/api/dives/{id}/providers/{provider}/decision', { params: { path: { id: entry.diveId, provider: g.provider } }, body: decision })),
    onSuccess: async (_, { entry, decision }) => {
      const dive = nameOf(entry);
      const key = 'onExisting' in decision ? (decision.onExisting === 'link' ? 'exists-link' : 'exists-create') : 'conflicts';
      onTold({ key: entry.diveId, text: t(`conflicts.queued.${key}`, { dive, name: g.providerName }) });
      await queryClient.invalidateQueries({ queryKey: keys.providerConflicts });
      // The Dive's state at the Provider now says it waits.
      await queryClient.invalidateQueries({ queryKey: keys.dives });
    },
  });
  const choosing = (e: ConflictEntryView) => decide.isPending && decide.variables?.entry.diveId === e.diveId;
  /** Which way out of an `exists` answer is being queued for the entry. */
  const chosenWay = (e: ConflictEntryView) => (choosing(e) && decide.variables && 'onExisting' in decide.variables.decision ? decide.variables.decision.onExisting : null);
  const otherChoosing = (e: ConflictEntryView) => decide.isPending && decide.variables?.entry.diveId !== e.diveId;
  const factsOf = (e: ConflictEntryView): Fact[] => [
    { key: 'time', text: display.diveTime(e.startsAt, e.utcOffsetSeconds, e.utcOffsetSource) },
    { key: 'depth', text: display.depth(e.maxDepthM) }, { key: 'duration', text: display.duration(e.durationSeconds) },
    { key: 'site', text: e.site?.name },
  ];
  const row = (e: ConflictEntryView) => (
    <Candidates>
      <CandidateRow
        facts={factsOf(e)} marked={new Set()}
        title={<a className="candidate-title" href={`#/dives/${e.diveId}`}>{e.number !== null ? t('dive.title', { number: e.number }) : t('dive.titleNoNumber')}</a>}
      />
    </Candidates>
  );
  /** The entry after the choice: it waits for the worker, and says so where the choice was. */
  const waiting = <p className="waiting-push"><Icon name="waiting" /><span>{t('provider.waitingPush.waiting', { name: g.providerName })}</span></p>;

  const clashes = g.entries.filter((e) => e.kind === 'conflict');
  const existing = g.entries.filter((e) => e.kind === 'exists');
  const title = (key: 'title' | 'existsTitle', count: number) => (diver !== undefined
    ? t(`conflicts.${key}Connection`, { name: g.providerName, diver, count })
    : t(`conflicts.${key}`, { name: g.providerName, count }));
  return (
    <>
      {clashes.length > 0 && (
        <Panel title={title('title', clashes.length)} attention>
          <p className="muted">{t('conflicts.intro', { name: g.providerName })}</p>
          <ul className="decisions">
            {clashes.map((e) => (
              <li key={e.diveId} className="decision">
                {row(e)}
                {e.queued ? waiting : (
                  <ProviderConflicts
                    key={e.fields.map((f) => f.field).join()} item={nameOf(e)} conflicts={e.fields} providerName={g.providerName}
                    isPending={choosing(e)} isDisabled={otherChoosing(e)}
                    onSend={(conflicts) => decide.mutate({ entry: e, decision: { conflicts } })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {existing.length > 0 && (
        <Panel title={title('existsTitle', existing.length)} attention>
          <Muted>{t('conflicts.existsIntro', { name: g.providerName })}</Muted>
          <ul className="decisions">
            {existing.map((e) => (
              <li key={e.diveId} className="decision">
                {row(e)}
                <p className="provider-conflict-question">
                  {t('conflicts.exists', { name: g.providerName })}
                  {e.existing && (
                    <>
                      {' '}
                      <span className="muted">
                        {t(e.existing.remoteNumber !== null ? 'conflicts.existsDive' : 'conflicts.existsDiveNoNumber', {
                          name: g.providerName, number: e.existing.remoteNumber ?? 0, time: valueText('startsAt', e.existing.startsAt),
                        })}
                      </span>
                    </>
                  )}
                </p>
                {e.queued ? waiting : (
                  <div className="form-actions">
                    {(['link', 'create'] as const).map((onExisting) => (
                      <Button
                        key={onExisting} variant={onExisting === 'link' ? 'primary' : 'secondary'} icon={onExisting === 'link' ? 'link' : 'add'}
                        isPending={chosenWay(e) === onExisting} isDisabled={decide.isPending && chosenWay(e) !== onExisting}
                        aria-label={t('common.forItem', { action: t(`conflicts.${onExisting}`), item: nameOf(e) })}
                        onPress={() => decide.mutate({ entry: e, decision: { onExisting } })}
                      >
                        {t(`conflicts.${onExisting}`)}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {decide.error && <Notice tone="danger">{errorText(decide.error)}</Notice>}
    </>
  );
}
