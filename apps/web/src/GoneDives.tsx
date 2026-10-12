import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, goneDivesQuery, keys, unwrap, type ConnectionView, type GoneDivesOfConnection, type GoneDiveView, type ProviderView,
} from './api.ts';
import { DeleteDiveDialog } from './DeleteDive.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { useProviderText, useProviders } from './lib/providers.ts';
import { Candidates, CandidateRow, type Fact } from './ReviewRows.tsx';
import { Button, Notice, Panel } from './ui/index.ts';

/** What one choice found when it asked the Provider again (ADR 0051). */
type Told = { key: string; tone: 'info' | 'success' | 'danger'; text: string };

/**
 * Dives gone at a Provider on the Review page (ADR 0051): the remote dive is no longer in the Provider's logbook. Two
 * choices per Dive and neither is a default; both first ask the Provider again, and only a second read that agrees
 * counts. "Delete here too" then goes through the Dive's own delete dialog. Never "all", never a delete unasked.
 */
export function GoneDivesSections() {
  const { t } = useTranslation();
  const gone = useQuery(goneDivesQuery());
  const providers = useProviders();
  const [told, setTold] = useState<Told[]>([]);
  const [deleting, setDeleting] = useState<{ dive: GoneDiveView; name: string }>();
  const groups = gone.data ?? [];
  const tell = (n: Told) => setTold((all) => [...all.filter((a) => a.key !== n.key), n]);
  return (
    <>
      {told.map((n) => (
        <Notice key={n.key} tone={n.tone}>
          <p>{n.text}</p>
          <Button variant="quiet" onPress={() => setTold((all) => all.filter((a) => a.key !== n.key))}>{t('common.close')}</Button>
        </Notice>
      ))}
      {groups.map((g) => (
        <Group
          key={g.connectionId} group={g} provider={providers.data?.find((p) => p.id === g.provider)}
          several={groups.filter((x) => x.provider === g.provider).length > 1} onTold={tell}
          onDelete={(dive, name) => setDeleting({ dive, name })}
        />
      ))}
      {deleting && <DeleteDiveDialog dive={{ id: deleting.dive.diveId, version: deleting.dive.version }} name={deleting.name} onClose={() => setDeleting(undefined)} />}
    </>
  );
}

function Group({ group: g, provider, several, onTold, onDelete }: {
  group: GoneDivesOfConnection; provider: ProviderView | undefined; several: boolean;
  onTold: (n: Told) => void; onDelete: (dive: GoneDiveView, name: string) => void;
}) {
  const { t } = useTranslation();
  const p = provider ?? ({ id: g.provider, name: g.provider } as ProviderView);
  const display = useDisplay();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const nameOf = (d: GoneDiveView) => (d.number !== null ? t('dive.title', { number: d.number }) : display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource));
  // The Dive being confirmed and what for: one at a time, the other buttons wait (page rules).
  const confirm = useMutation({
    mutationFn: async ({ dive }: { dive: GoneDiveView; then: 'keep' | 'delete' }) =>
      unwrap(await api.POST('/api/connections/{id}/gone-dives/confirm', { params: { path: { id: g.connectionId } }, body: { diveIds: [dive.diveId] } })),
    onSuccess: async (answer, { dive, then }) => {
      const result = answer.results[0]?.confirmation;
      const name = nameOf(dive);
      const key = dive.diveId;
      if (answer.empty) onTold({ key, tone: 'info', text: t('gone.empty', { name: p.name }) });
      else if (result === 'there') onTold({ key, tone: 'info', text: t('gone.there', { dive: name, name: p.name }) });
      else if (result === 'not_waiting') onTold({ key, tone: 'info', text: t('gone.notWaiting', { dive: name }) });
      else if (result === 'gone' && then === 'keep') onTold({ key, tone: 'success', text: t('gone.kept', { dive: name, name: p.name }) });
      else if (result === 'gone') onDelete(dive, name);
      announce(t('gone.confirmed'));
      await queryClient.invalidateQueries({ queryKey: keys.goneDives });
      // The Dive's state at the Provider changed.
      await queryClient.invalidateQueries({ queryKey: ['dives'] });
    },
  });
  const heading = several ? t('gone.titleDiver', { name: p.name, diver: g.diverName }) : t('gone.title', { name: p.name });
  return (
    <Panel title={heading} attention>
      <p className="muted">{t('gone.intro', { name: p.name })}</p>
      {g.warning && <Notice tone="info">{t('gone.warning', { name: p.name })}</Notice>}
      <ul className="decisions">
        {g.dives.map((d) => {
          const facts: Fact[] = [
            { key: 'time', text: display.diveTime(d.startsAt, d.utcOffsetSeconds, d.utcOffsetSource) },
            { key: 'depth', text: display.depth(d.maxDepthM) }, { key: 'duration', text: display.duration(d.durationSeconds) },
            { key: 'site', text: d.site?.name },
            { key: 'remote', text: d.remoteNumber !== null ? t('gone.remoteNumber', { name: p.name, number: d.remoteNumber }) : undefined },
          ];
          const name = nameOf(d);
          const mine = confirm.isPending && confirm.variables.dive.diveId === d.diveId;
          return (
            <li key={d.diveId} className="decision">
              <Candidates>
                <CandidateRow
                  facts={facts} marked={new Set()}
                  title={<a className="candidate-title" href={`#/dives/${d.diveId}`}>{d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber')}</a>}
                />
              </Candidates>
              <div className="form-actions">
                <Button
                  icon="delete" aria-label={t('common.forItem', { action: t('gone.delete'), item: name })}
                  isPending={mine && confirm.variables.then === 'delete'} isDisabled={confirm.isPending && !(mine && confirm.variables.then === 'delete')}
                  onPress={() => confirm.mutate({ dive: d, then: 'delete' })}
                >
                  {t('gone.delete')}
                </Button>
                <Button
                  variant="quiet" aria-label={t('common.forItem', { action: t('gone.keep'), item: name })}
                  isPending={mine && confirm.variables.then === 'keep'} isDisabled={confirm.isPending && !(mine && confirm.variables.then === 'keep')}
                  onPress={() => confirm.mutate({ dive: d, then: 'keep' })}
                >
                  {t('gone.keep')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm.error && <Notice tone="danger">{errorText(confirm.error)}</Notice>}
    </Panel>
  );
}

/**
 * "Check for dives deleted in SSI" under the Connection (ADR 0051): one read of the account's logbook, which stores what
 * it finds and changes no Dive; the findings wait on the Review page. Works whatever the import setting is.
 */
export function GoneCheck({ provider: p, connection: c }: { provider: ProviderView; connection: ConnectionView }) {
  const pt = useProviderText(p);
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/connections/{id}/gone-dives/check', { params: { path: { id: c.id } } })),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: keys.goneDives }),
  });
  const found = check.data;
  return (
    <div className="provider-import-part">
      <div className="form-actions">
        <Button
          variant="quiet" icon="siteImport" isPending={check.isPending} onPress={() => check.mutate()}
          aria-label={t('common.forItem', { action: pt('goneCheck'), item: c.accountLabel })}
        >
          {pt('goneCheck')}
        </Button>
      </div>
      {check.isPending && <p className="muted">{pt('timesReading')}</p>}
      {check.error && <Notice tone="danger">{errorText(check.error)}</Notice>}
      {found && !check.isPending && (
        <Notice tone="info">
          {found.empty ? <p>{pt('goneEmpty')}</p>
            : found.gone === 0 ? <p>{pt('goneNone')}</p>
              : <p>{pt('goneFound' as 'goneFound_one', { count: found.gone })} <a href="#/review">{t('gone.see')}</a></p>}
          {found.warning && <p>{pt('goneWarning')}</p>}
        </Notice>
      )}
    </div>
  );
}
