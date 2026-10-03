import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, candidatesQuery, keys, unwrap, type CandidateView } from './api.ts';
import { deviceName } from './lib/devices.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Button, Muted, Notice, Panel } from './ui/index.ts';

/**
 * Duplicate candidates on the logbook (ADR 0016): Recordings that don't clearly belong to one Dive,
 * with the Dives they might belong to and the three decisions. Hidden when nothing waits.
 */
export function Decisions() {
  const { t } = useTranslation();
  const open = useQuery(candidatesQuery('open'));
  const discarded = useQuery(candidatesQuery('discarded'));
  const [showDiscarded, setShowDiscarded] = useState(false);
  const count = open.data?.length ?? 0;

  if (count === 0 && !showDiscarded) {
    if (!discarded.data?.length) return null;
    return (
      <p className="decisions-quiet">
        <Button variant="quiet" onPress={() => setShowDiscarded(true)}>{t('decisions.showDiscarded')}</Button>
      </p>
    );
  }
  return (
    <Panel title={t('decisions.title')}>
      {count > 0 && <p>{t('decisions.intro', { count })}</p>}
      <ul className="decisions">
        {open.data?.map((c) => <Decision key={c.id} candidate={c} />)}
      </ul>
      {showDiscarded ? <Discarded onHide={() => setShowDiscarded(false)} /> : (discarded.data?.length ?? 0) > 0 && (
        <Button variant="quiet" onPress={() => setShowDiscarded(true)}>{t('decisions.showDiscarded')}</Button>
      )}
    </Panel>
  );
}

function RecordingLine({ c }: { c: CandidateView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const r = c.recording;
  const device = r.device
    ? t('decisions.device', { name: deviceName(r.device.manufacturer, r.device.product), serial: r.device.serialNumber })
    : t('decisions.unknownDevice');
  return (
    <p className="decision-recording">
      <strong>{t('decisions.recording')}:</strong>{' '}
      {display.diveTime(r.startsAt, r.utcOffsetSeconds)} · {display.depth(r.maxDepthM)} · {display.duration(r.durationSeconds)} · {device}
      <span className="muted"> ({t(`import.reason.${c.reason}`)})</span>
    </p>
  );
}

function useDecide(c: CandidateView) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: { kind: 'attach'; diveId: string } | { kind: 'new-dive' | 'discard' | 'reopen' }) => {
      const path = { params: { path: { id: c.id } } };
      switch (action.kind) {
        case 'attach': return unwrap(await api.POST('/api/duplicate-candidates/{id}/attach', { ...path, body: { diveId: action.diveId } }));
        case 'new-dive': return unwrap(await api.POST('/api/duplicate-candidates/{id}/new-dive', path));
        case 'discard': return unwrap(await api.POST('/api/duplicate-candidates/{id}/discard', path));
        case 'reopen': return unwrap(await api.POST('/api/duplicate-candidates/{id}/reopen', path));
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['candidates'] });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
    },
  });
}

function Decision({ candidate: c }: { candidate: CandidateView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const decide = useDecide(c);
  return (
    <li className="decision">
      <RecordingLine c={c} />
      {c.dives.length > 0 && (
        <>
          <p className="muted">{t('decisions.maybe')}</p>
          <ul className="decision-dives">
            {c.dives.map((d) => (
              <li key={d.id}>
                <a href={`#/dives/${d.id}`}>
                  {d.number !== null ? t('dive.title', { number: d.number }) : t('dive.titleNoNumber')}
                </a>
                {' · '}{display.diveTime(d.startsAt, d.utcOffsetSeconds)} · {display.depth(d.maxDepthM)} · {display.duration(d.durationSeconds)}
                {' '}
                <Button variant="quiet" isDisabled={decide.isPending} onPress={() => decide.mutate({ kind: 'attach', diveId: d.id })}>
                  {t('decisions.addTo')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="form-actions">
        <Button isDisabled={decide.isPending} onPress={() => decide.mutate({ kind: 'new-dive' })}>{t('decisions.newDive')}</Button>
        <Button variant="quiet" isDisabled={decide.isPending} onPress={() => decide.mutate({ kind: 'discard' })}>{t('decisions.discard')}</Button>
      </div>
      {decide.error && <Notice tone="danger">{errorText(decide.error)}</Notice>}
    </li>
  );
}

function Discarded({ onHide }: { onHide: () => void }) {
  const { t } = useTranslation();
  const discarded = useQuery(candidatesQuery('discarded'));
  return (
    <section className="discarded">
      <h3>{t('decisions.discarded')}</h3>
      {discarded.data?.length === 0 && <Muted>{t('decisions.none')}</Muted>}
      <ul className="decisions">
        {discarded.data?.map((c) => <DiscardedItem key={c.id} candidate={c} />)}
      </ul>
      <Button variant="quiet" onPress={onHide}>{t('decisions.hideDiscarded')}</Button>
    </section>
  );
}

function DiscardedItem({ candidate: c }: { candidate: CandidateView }) {
  const { t } = useTranslation();
  const decide = useDecide(c);
  return (
    <li className="decision">
      <RecordingLine c={c} />
      <Button variant="quiet" isDisabled={decide.isPending} onPress={() => decide.mutate({ kind: 'reopen' })}>{t('decisions.reopen')}</Button>
    </li>
  );
}
