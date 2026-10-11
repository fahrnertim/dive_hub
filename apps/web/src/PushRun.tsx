import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Label, ProgressBar } from 'react-aria-components';
import {
  ApiError, cancelPushRun, connectionsQuery, continuePushRun, keys, pushRunActive, pushRunPreviewQuery, pushRunQuery, pushRunsQuery,
  startPushRun, type ConnectionView, type LogbookParams, type ProviderView, type PushRunChoices, type PushRunDetail, type PushRunView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText, useProblemText } from './lib/display.ts';
import { logbookHref, toggled } from './lib/logbook.ts';
import { useProviders } from './lib/providers.ts';
import { ActionMenu, Button, Checkbox, Dialog, Disclosure, LinkButton, Muted, Notice } from './ui/index.ts';

/** What a run is for, as a Provider-shaped name for texts. */
const named = (p: ProviderView | undefined, id: string) => ({ id, name: p?.name ?? id });

/** The Connections the logbook's list can be sent over: the Provider takes runs, and the list shows the Connection's Diver. */
function useRunConnections(params: LogbookParams) {
  const connections = useQuery(connectionsQuery());
  const providers = useProviders();
  const runs = useQuery(pushRunsQuery());
  const eligible = (connections.data ?? [])
    .filter((c) => (!params.diverId || c.diverId === params.diverId) && providers.data?.find((p) => p.id === c.provider)?.limits.run)
    .map((c) => ({
      connection: c,
      provider: providers.data?.find((p) => p.id === c.provider),
      active: runs.data?.some((r) => r.connectionId === c.id && pushRunActive(r)) ?? false,
    }));
  return eligible;
}

/**
 * "Send to SSI…" in the logbook's toolbar (ADR 0047): one button per Connection whose Provider takes runs and whose Diver
 * the list shows (a menu when there are several). It opens the dialog that says what would go, before anything is sent.
 */
export function SendToProvider({ params }: { params: LogbookParams }) {
  const { t } = useTranslation();
  const options = useRunConnections(params);
  const [open, setOpen] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (options.length === 0) return null;
  const label = (o: (typeof options)[number]) => t('pushRun.send', { name: o.provider?.name ?? o.connection.provider });
  const chosen = options.find((o) => o.connection.id === open);
  const single = options.length === 1 ? options[0] : undefined;
  return (
    <div className="logbook-send">
      <span className="field-label logbook-send-spacer" aria-hidden="true">&nbsp;</span>
      {single ? (
        <Button
          ref={trigger} variant="secondary" icon="send" isDisabled={single.active} onPress={() => setOpen(single.connection.id)}
        >
          {label(single)}
        </Button>
      ) : (
        <ActionMenu
          label={t('pushRun.sendMenu')} icon="send"
          actions={options.map((o) => ({ id: o.connection.id, label: label(o), onAction: () => { if (!o.active) setOpen(o.connection.id); } }))}
        />
      )}
      {chosen && (
        <SendDialog connection={chosen.connection} provider={chosen.provider} params={params} onClose={() => { setOpen(null); trigger.current?.focus(); }} />
      )}
    </div>
  );
}

function SendDialog({ connection, provider, params, onClose }: {
  connection: ConnectionView; provider: ProviderView | undefined; params: LogbookParams; onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const name = provider?.name ?? connection.provider;
  const [choices, setChoices] = useState<PushRunChoices>({
    list: { siteId: params.siteId, q: params.q, only: params.only?.join(',') || undefined },
    updates: false, updatesRemovingVerification: false, numbers: false,
  });
  const preview = useQuery(pushRunPreviewQuery(connection.id, choices));
  const start = useMutation({
    mutationFn: () => startPushRun(connection.id, choices),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: keys.pushRuns });
      announce(t('pushRun.started', { count: run.counts.total, name }));
      onClose();
    },
    onError: async (e) => {
      // Another run is going on this Connection: the strip shows it.
      if (e instanceof ApiError && e.code === 'push_run_active') await queryClient.invalidateQueries({ queryKey: keys.pushRuns });
    },
  });
  const p = preview.data;
  const set = (change: Partial<PushRunChoices>) => { start.reset(); setChoices((c) => ({ ...c, ...change })); };
  const minutes = p ? Math.ceil(p.estimatedSeconds / 60) : 0;
  const siteGroups = new Map<string, { siteId: string | null; name: string | null; count: number }>();
  for (const d of p?.blocked.dives ?? []) {
    const key = d.siteId ?? '';
    const group = siteGroups.get(key) ?? { siteId: d.siteId, name: d.siteName, count: 0 };
    group.count += 1;
    siteGroups.set(key, group);
  }
  const blockedHidden = p ? p.blocked.total - p.blocked.dives.length : 0;
  return (
    <Dialog title={t('pushRun.title', { name })} isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <div className="push-run-dialog">
        <p>{t('pushRun.intro', { name, diver: connection.diverName })}</p>
        {preview.isError && <Notice tone="danger">{errorText(preview.error)}</Notice>}
        {!p && !preview.isError && <Muted>{t('pushRun.loading')}</Muted>}
        {p && (
          <>
            <p className="push-run-count" aria-live="polite">
              <strong>{p.counts.create > 0 || p.send > 0 ? t('pushRun.new', { count: p.counts.create }) : t('pushRun.nothing')}</strong>
            </p>
            {p.counts.update > 0 && (
              <Checkbox isSelected={choices.updates} onChange={(updates) => set({ updates, ...(!updates && { updatesRemovingVerification: false }) })}>
                <span>{t('pushRun.updates')}<small className="field-hint">{t('pushRun.updatesHint', { count: p.counts.update + p.counts.updateRemovingVerification, name })}</small></span>
              </Checkbox>
            )}
            {p.counts.update + p.counts.updateRemovingVerification > 0 && !params.only?.includes('changed-since-sent') && (
              <Muted>
                <a href={logbookHref({ ...params, only: toggled(params.only, 'changed-since-sent'), page: undefined })} onClick={onClose}>
                  {t('pushRun.showChanged')}
                </a>
              </Muted>
            )}
            {p.counts.updateRemovingVerification > 0 && (
              <Checkbox isSelected={choices.updatesRemovingVerification} isDisabled={!choices.updates} onChange={(updatesRemovingVerification) => set({ updatesRemovingVerification })}>
                <span>{t('pushRun.updatesRemoving', { name })}<small className="field-hint">{t('pushRun.updatesRemovingHint', { count: p.counts.updateRemovingVerification })}</small></span>
              </Checkbox>
            )}
            {p.counts.number > 0 && (
              <>
                <Checkbox isSelected={choices.numbers} onChange={(numbers) => set({ numbers })}>
                  <span>{t('pushRun.numbers', { name })}<small className="field-hint">{t('pushRun.numbersHint', { count: p.counts.number })}</small></span>
                </Checkbox>
                {p.counts.numberRemovingVerification > 0 && <Muted>{t('pushRun.numbersRemoving', { count: p.counts.numberRemovingVerification, name })}</Muted>}
                {p.counts.numberTaken > 0 && <Muted>{t('pushRun.numberTaken', { count: p.counts.numberTaken })}</Muted>}
              </>
            )}
            {(p.blocked.total > 0 || p.leftOut.upToDate > 0 || p.beyondCeiling > 0) && (
              <div className="push-run-leftout">
                <h3>{t('pushRun.leftOut')}</h3>
                <ul>
                  {p.blocked.total > 0 && (
                    <li>
                      {t('pushRun.blocked', { count: p.blocked.total, name })}
                      <ul>
                        {[...siteGroups.values()].map((g) => (
                          <li key={g.siteId ?? 'none'}>
                            {g.siteId
                              ? <a href={`#/sites/${g.siteId}`}>{t('pushRun.blockedAt', { count: g.count, site: g.name ?? '', name })}</a>
                              : <a href="#/?only=no-site">{t('pushRun.blockedNoSite', { count: g.count })}</a>}
                          </li>
                        ))}
                        {blockedHidden > 0 && <li>+{blockedHidden}</li>}
                      </ul>
                    </li>
                  )}
                  {p.leftOut.upToDate > 0 && <li>{t('pushRun.upToDate', { count: p.leftOut.upToDate, name })}</li>}
                  {p.beyondCeiling > 0 && <li>{t('pushRun.beyondCeiling', { count: p.beyondCeiling, max: p.limits.maxDives })}</li>}
                </ul>
              </div>
            )}
            {p.withLeftOut > 0 && <Muted>{t('pushRun.withLeftOut', { count: p.withLeftOut, name })}</Muted>}
            {(provider?.notices ?? []).map((n) => <Muted key={n}>{t(`provider.notice.${n}`, { name })}</Muted>)}
            {p.send > 0 && <Muted>{minutes < 1 ? t('pushRun.estimateShort') : t('pushRun.estimate', { count: minutes })}</Muted>}
          </>
        )}
        {start.isError && <Notice tone="danger">{errorText(start.error)}</Notice>}
        <div className="form-actions">
          <Button variant="primary" isPending={start.isPending} isDisabled={!p || p.send === 0} onPress={() => start.mutate()}>
            {t('pushRun.confirm', { count: p?.send ?? 0 })}
          </Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

const DISMISSED = 'pushRunDismissed';
const dismissedRuns = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DISMISSED) ?? '[]') as string[]; } catch { return []; }
};
const rememberDismissed = (id: string) => {
  try { localStorage.setItem(DISMISSED, JSON.stringify([id, ...dismissedRuns()].slice(0, 20))); } catch { /* the strip comes back after a reload; harmless */ }
};

/**
 * The newest run, in a strip above the logbook: progress while it goes, then what it did. A stopped run stays until it
 * is continued or dismissed, and says why (no toast; it doesn't time out). The logbook is refreshed when a run ends.
 */
export function PushRunStrip() {
  const runs = useQuery(pushRunsQuery());
  const [dismissed, setDismissed] = useState<string[]>(dismissedRuns);
  const queryClient = useQueryClient();
  const run = runs.data?.find((r) => pushRunActive(r)) ?? runs.data?.find((r) => !dismissed.includes(r.id));
  const status = run?.status;
  const seen = useRef<{ id: string; active: boolean } | null>(null);
  const { t } = useTranslation();
  const providers = useProviders();
  const name = run ? (providers.data?.find((p) => p.id === run.provider)?.name ?? run.provider) : '';
  useEffect(() => {
    if (!run) return;
    const active = pushRunActive(run);
    // A run seen going and then ended: the logbook shows what changed, and the end is said once.
    if (seen.current?.id === run.id && seen.current.active && !active) {
      void queryClient.invalidateQueries({ queryKey: keys.dives });
      void queryClient.invalidateQueries({ queryKey: keys.connections });
      announce(runSummary(t, run, name));
    }
    seen.current = { id: run.id, active };
  }, [run, status, queryClient, t, name]);
  if (!run) return null;
  const dismiss = () => { rememberDismissed(run.id); setDismissed(dismissedRuns()); };
  return pushRunActive(run)
    ? <ActiveStrip run={run} name={name} />
    : <EndedStrip run={run} name={name} onDismiss={dismiss} />;
}

function runSummary(translate: TFunction, run: PushRunView, name: string) {
  const t = translate as unknown as (key: string, options: Record<string, unknown>) => string;
  const values = { sent: run.counts.sent, total: run.counts.total, name };
  return run.status === 'cancelled' ? t('pushRun.cancelled', values) : run.status === 'stopped' ? t('pushRun.stopped', values) : t('pushRun.done', values);
}

function ActiveStrip({ run, name }: { run: PushRunView; name: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => cancelPushRun(run.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.pushRuns }),
  });
  const done = run.counts.sent + run.counts.skipped + run.counts.failed;
  const stopping = run.cancelRequested || stop.isSuccess;
  return (
    <div className="strip push-run-strip">
      <ProgressBar value={done} minValue={0} maxValue={Math.max(run.counts.total, 1)} className="push-run-progress" aria-label={t('pushRun.progress', { name })}>
        {({ percentage }) => (
          <>
            <Label>{t('pushRun.progress', { name })}: {t('pushRun.progressOf', { done, total: run.counts.total })}</Label>
            <div className="push-run-bar"><div className="push-run-fill" style={{ width: `${percentage}%` }} /></div>
          </>
        )}
      </ProgressBar>
      {stopping
        ? <Muted>{t('pushRun.stopping')}</Muted>
        : <Button size="small" isPending={stop.isPending} onPress={() => stop.mutate()}>{t('pushRun.stop')}</Button>}
      {stop.isError && <Notice tone="danger">{errorText(stop.error)}</Notice>}
    </div>
  );
}

function EndedStrip({ run, name, onDismiss }: { run: PushRunView; name: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const problemText = useProblemText();
  const queryClient = useQueryClient();
  const resume = useMutation({
    mutationFn: () => continuePushRun(run.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.pushRuns }),
  });
  const unsent = run.counts.skipped + run.counts.failed;
  const provider = named(undefined, run.provider);
  const summary = runSummary(t, run, name);
  // A stop that signing in fixes: "Continue" would fail until then, so the way on comes first.
  const needsSignIn = run.status === 'stopped' && (run.stopCode === 'provider_sign_in_needed' || run.stopCode === 'provider_wrong_credentials');
  const body = (
    <>
      <div className="push-run-head">
        <p>{summary}{run.status === 'stopped' && run.stopCode && <> {problemText(run.stopCode, { id: provider.id, name })}</>}</p>
        <div className="push-run-actions">
          {needsSignIn && <LinkButton href="#/account" size="small" variant="primary" icon="signIn">{t('pushRun.signIn', { name })}</LinkButton>}
          {run.status === 'stopped' && (
            <Button size="small" variant={needsSignIn ? 'secondary' : 'primary'} isPending={resume.isPending} onPress={() => resume.mutate()}>{t('pushRun.continue')}</Button>
          )}
          <Button size="small" variant="quiet" onPress={onDismiss}>{t('pushRun.dismiss')}</Button>
        </div>
      </div>
      {resume.isError && <Notice tone="danger">{errorText(resume.error)}</Notice>}
      {unsent > 0 && <Disclosure title={t('pushRun.details', { count: unsent })}><RunItems id={run.id} name={name} provider={provider} /></Disclosure>}
    </>
  );
  return run.status === 'stopped'
    ? <Notice tone="danger">{body}</Notice>
    : <div className="strip push-run-strip push-run-ended">{body}</div>;
}

/** Every Dive of a run that was not sent, with the reason. Read only when the list is opened. */
function RunItems({ id, name, provider }: { id: string; name: string; provider: { id: string; name: string } }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const problemText = useProblemText();
  const run = useQuery(pushRunQuery(id));
  const unsent = (run.data?.items ?? []).filter((i: PushRunDetail['items'][number]) => i.state === 'skipped' || i.state === 'failed');
  const reason = (i: PushRunDetail['items'][number]) => {
    if (!i.reason) return '';
    return i.state === 'failed'
      ? `${t('pushRun.failed')}: ${problemText(i.reason as Parameters<typeof problemText>[0], provider)}`
      : (t as unknown as (key: string, options: Record<string, unknown>) => string)(`pushRun.reason.${i.reason}`, { name });
  };
  if (!run.data) return <Muted>{t('pushRun.loading')}</Muted>;
  return (
    <ul className="push-run-items">
      {unsent.map((i) => (
        <li key={i.diveId}>
          <a href={`#/dives/${i.diveId}`}>
            {i.dive.number ? `#${i.dive.number} ` : ''}{t('pushRun.diveLine', { when: display.dateTime(i.dive.startsAt), site: i.dive.siteName ?? t('pushRun.noSite') })}
          </a>
          {' '}<span className="muted">{reason(i)}</span>
        </li>
      ))}
    </ul>
  );
}
