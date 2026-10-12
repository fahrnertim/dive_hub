import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Label, ProgressBar } from 'react-aria-components';
import {
  ApiError, cancelPushRun, connectionsQuery, continuePushRun, dismissPushRun, keys, pushRunActive, pushRunPreviewQuery, pushRunQuery, pushRunsQuery,
  siteQuery, startPushRun, type ConnectionView, type LogbookParams, type ProviderView, type PushRunChoices, type PushRunDetail, type PushRunView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText, useProblemText } from './lib/display.ts';
import { logbookHref, toggled, type LogbookFilter } from './lib/logbook.ts';
import { useProviders } from './lib/providers.ts';
import { accountHref } from './lib/account-tabs.ts';
import { ActionMenu, Button, Checkbox, Dialog, Disclosure, Icon, LinkButton, Muted, Notice, RadioGroup } from './ui/index.ts';

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
export function SendToProvider({ params, filterName }: { params: LogbookParams; filterName: (filter: LogbookFilter) => string }) {
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
        <SendDialog connection={chosen.connection} provider={chosen.provider} params={params} filterName={filterName} onClose={() => { setOpen(null); trigger.current?.focus(); }} />
      )}
    </div>
  );
}

/** What the dialog can send: the logbook's list as it is now, every Dive not at the Provider yet, or the ones changed since sent. */
type Scope = 'list' | 'new' | 'changed';
const SCOPES: readonly Scope[] = ['list', 'new', 'changed'];
const NO_CHOICES = { updates: false, updatesRemovingVerification: false, numbers: false };
const sameList = (a: PushRunChoices['list'], b: PushRunChoices['list']) => a.siteId === b.siteId && a.q === b.q && a.only === b.only;

/** A scope's label with the number of Dives in it and what it is, read together by screen readers. */
const scopeLabel = (label: string, count: number | undefined, hint: string | undefined): ReactNode => (
  <span className="radio-text">
    <span>{label}{count !== undefined && <>{' '}<span className="push-run-scope-count">({count})</span></>}</span>
    {hint && <span className="field-description">{hint}</span>}
  </span>
);

/**
 * The dialog before a run (ADR 0047), which owns what is sent (UI/UX pass, option A2): it asks which Dives, lists the ones
 * that would go with a checkbox each, and sends exactly the ticked ones. The logbook behind it is never changed.
 */
function SendDialog({ connection, provider, params, filterName, onClose }: {
  connection: ConnectionView; provider: ProviderView | undefined; params: LogbookParams; filterName: (filter: LogbookFilter) => string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const name = provider?.name ?? connection.provider;
  const site = useQuery({ ...siteQuery(params.siteId ?? ''), enabled: !!params.siteId });
  const listNow = { siteId: params.siteId, q: params.q, only: params.only?.join(',') || undefined };
  const filtered = !!(listNow.siteId || listNow.q || listNow.only);
  const lists: Record<Scope, PushRunChoices['list']> = { list: listNow, new: { only: 'not-at-provider' }, changed: { only: 'changed-since-sent' } };
  // A scope that is the list itself is not offered twice.
  const offered = SCOPES.filter((s) => s === 'list' || !sameList(lists[s], listNow));
  const [scope, setScope] = useState<Scope>(filtered ? 'list' : 'new');
  const [choices, setChoices] = useState(NO_CHOICES);
  // The Dives the User took out of the run (by id); a new scope starts with all of them in.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const sizes = {
    list: useQuery(pushRunPreviewQuery(connection.id, { list: lists.list, ...NO_CHOICES })),
    new: useQuery(pushRunPreviewQuery(connection.id, { list: lists.new, ...NO_CHOICES })),
    changed: useQuery(pushRunPreviewQuery(connection.id, { list: lists.changed, ...NO_CHOICES })),
  };
  const request: PushRunChoices = { list: lists[scope], ...choices };
  const preview = useQuery(pushRunPreviewQuery(connection.id, request));
  const p = preview.data;
  const dives = p?.dives ?? [];
  const goes = dives.filter((d) => !left.has(d.diveId));
  const takenOut = dives.length - goes.length;
  // Taking one out sends the ticked Dives by id; else the list, as the preview counted it.
  const toSend: PushRunChoices = takenOut > 0 ? { ...request, ids: goes.map((d) => d.diveId) } : request;
  const start = useMutation({
    mutationFn: () => startPushRun(connection.id, toSend),
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
  const set = (change: Partial<typeof NO_CHOICES>) => { start.reset(); setChoices((c) => ({ ...c, ...change })); };
  const chooseScope = (next: Scope) => { start.reset(); setLeft(new Set()); setScope(next); };
  const tick = (diveId: string, on: boolean) => {
    start.reset();
    setLeft((l) => { const next = new Set(l); if (on) next.delete(diveId); else next.add(diveId); return next; });
  };
  const minutes = p && p.send > 0 ? Math.ceil((p.estimatedSeconds * goes.length) / p.send / 60) : 0;
  const siteGroups = new Map<string, { siteId: string | null; name: string | null; count: number }>();
  for (const d of p?.blocked.dives ?? []) {
    const key = d.siteId ?? '';
    const group = siteGroups.get(key) ?? { siteId: d.siteId, name: d.siteName, count: 0 };
    group.count += 1;
    siteGroups.set(key, group);
  }
  const blockedHidden = p ? p.blocked.total - p.blocked.dives.length : 0;
  const listHint = filtered
    ? [
      listNow.siteId && site.data?.name ? t('pushRun.scopeSite', { site: site.data.name }) : null,
      listNow.q ? t('pushRun.scopeSearch', { q: listNow.q }) : null,
      ...(params.only ?? []).map(filterName),
    ].filter(Boolean).join(' · ')
    : undefined;
  const hints: Record<Scope, string | undefined> = {
    list: listHint, new: t('pushRun.scopeNewHint', { name }), changed: t('pushRun.scopeChangedHint', { name }),
  };
  const labels: Record<Scope, string> = {
    list: filtered ? t('pushRun.scopeList') : t('pushRun.scopeAll', { diver: connection.diverName }),
    new: t('pushRun.scopeNew', { name }), changed: t('pushRun.scopeChanged'),
  };
  const updatable = p ? p.counts.update + p.counts.updateRemovingVerification : 0;
  const showUpdates = !!p && p.counts.update > 0;
  const showRemoving = !!p && p.counts.updateRemovingVerification > 0;
  const showNumbers = !!p && p.counts.number > 0;
  const onChangedList = (lists[scope].only ?? '').split(',').includes('changed-since-sent');
  return (
    <Dialog title={t('pushRun.title', { name })} isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <div className="push-run-dialog">
        <RadioGroup
          label={t('pushRun.which', { diver: connection.diverName })} value={scope} onChange={(v) => chooseScope(v as Scope)}
          options={offered.map((s) => ({ value: s, label: scopeLabel(labels[s], sizes[s].data?.inScope, hints[s]) }))}
        />
        {preview.isError && <Notice tone="danger">{errorText(preview.error)}</Notice>}
        {!p && !preview.isError && <Muted>{t('pushRun.loading')}</Muted>}
        {p && (
          <>
            <p className="push-run-count" aria-live="polite">
              <strong>{p.counts.create > 0 || p.send > 0 ? t('pushRun.new', { count: p.counts.create }) : t('pushRun.nothing')}</strong>
            </p>
            {dives.length > 0 && (
              <Disclosure
                title={t('pushRun.showDives', { count: dives.length })}
                summary={takenOut > 0 ? <Muted>{t('pushRun.takenOut', { count: takenOut })}</Muted> : undefined}
              >
                <div className="push-run-dives" role="group" aria-label={t('pushRun.divesToSend')}>
                  <div className="push-run-dives-actions">
                    <Button size="small" variant="quiet" onPress={() => { start.reset(); setLeft(new Set()); }}>{t('pushRun.selectAll')}</Button>
                    <Button size="small" variant="quiet" onPress={() => { start.reset(); setLeft(new Set(dives.map((d) => d.diveId))); }}>{t('pushRun.selectNone')}</Button>
                  </div>
                  <ul>
                    {dives.map((d) => (
                      <li key={d.diveId}>
                        <Checkbox isSelected={!left.has(d.diveId)} onChange={(on) => tick(d.diveId, on)}>
                          <span>{d.number ? `#${d.number} ` : ''}{t('pushRun.diveLine', { when: display.dateTime(d.startsAt), site: d.siteName ?? t('pushRun.noSite') })}</span>
                        </Checkbox>
                      </li>
                    ))}
                  </ul>
                </div>
              </Disclosure>
            )}
            {(showUpdates || showRemoving || showNumbers) && (
              <fieldset className="push-run-risky">
                <legend><Icon name="warning" />{t('pushRun.risky', { name })}</legend>
                {showUpdates && (
                  <Checkbox isSelected={choices.updates} onChange={(updates) => set({ updates, ...(!updates && { updatesRemovingVerification: false }) })}>
                    <span>{t('pushRun.updates')}<small className="field-hint">{t('pushRun.updatesHint', { count: updatable, name })}</small></span>
                  </Checkbox>
                )}
                {updatable > 0 && !onChangedList && (
                  <Muted>
                    <a href={logbookHref({ ...params, only: toggled(params.only, 'changed-since-sent'), page: undefined })} onClick={onClose}>
                      {t('pushRun.showChanged')}
                    </a>
                  </Muted>
                )}
                {showRemoving && (
                  <Checkbox isSelected={choices.updatesRemovingVerification} isDisabled={!choices.updates} onChange={(updatesRemovingVerification) => set({ updatesRemovingVerification })}>
                    <span>{t('pushRun.updatesRemoving', { name })}<small className="field-hint">{t('pushRun.updatesRemovingHint', { count: p.counts.updateRemovingVerification })}</small></span>
                  </Checkbox>
                )}
                {showNumbers && (
                  <>
                    <Checkbox isSelected={choices.numbers} onChange={(numbers) => set({ numbers })}>
                      <span>{t('pushRun.numbers', { name })}<small className="field-hint">{t('pushRun.numbersHint', { count: p.counts.number })}</small></span>
                    </Checkbox>
                    {p.counts.numberRemovingVerification > 0 && <Muted>{t('pushRun.numbersRemoving', { count: p.counts.numberRemovingVerification, name })}</Muted>}
                    {p.counts.numberTaken > 0 && <Muted>{t('pushRun.numberTaken', { count: p.counts.numberTaken })}</Muted>}
                  </>
                )}
              </fieldset>
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
            {goes.length > 0 && <Muted>{minutes < 1 ? t('pushRun.estimateShort') : t('pushRun.estimate', { count: minutes })}</Muted>}
          </>
        )}
        {start.isError && <Notice tone="danger">{errorText(start.error)}</Notice>}
        <div className="form-actions">
          <Button variant="primary" isPending={start.isPending} isDisabled={!p || preview.isPlaceholderData || goes.length === 0} onPress={() => start.mutate()}>
            {t('pushRun.confirm', { count: goes.length })}
          </Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** A run going, as a mark beside "Logbook" in the navigation: done of total, the whole sentence for screen readers. */
export function RunMark() {
  const { t } = useTranslation();
  const runs = useQuery(pushRunsQuery());
  const providers = useProviders();
  const run = runs.data?.find((r) => pushRunActive(r));
  if (!run) return null;
  const name = providers.data?.find((p) => p.id === run.provider)?.name ?? run.provider;
  const done = run.counts.sent + run.counts.skipped + run.counts.failed;
  return (
    <span className="count run-mark">
      <Icon name="send" />
      <span aria-hidden="true">{done}/{run.counts.total}</span>
      <span className="visually-hidden">{t('pushRun.inNav', { name, done, total: run.counts.total })}</span>
    </span>
  );
}

/**
 * The newest run, in a strip above the logbook: progress while it goes, then what it did. A stopped run stays until it
 * is continued or dismissed, and says why (no toast; it doesn't time out). Dismissing is stored with the run on the
 * server, so no browser shows it again. The logbook is refreshed when a run ends. Runs that are not in the strip are
 * listed under "Earlier runs" (the kept five of each Connection), dismissed or not.
 */
export function PushRunStrip() {
  const runs = useQuery(pushRunsQuery());
  const queryClient = useQueryClient();
  // The strip is for what is going or the newest run; an older run never takes its place when that is dismissed.
  const newest = runs.data?.[0];
  const run = runs.data?.find((r) => pushRunActive(r)) ?? (newest && !newest.dismissedAt ? newest : undefined);
  const status = run?.status;
  const seen = useRef<{ id: string; active: boolean } | null>(null);
  const { t } = useTranslation();
  const providers = useProviders();
  const nameOf = (provider: string) => providers.data?.find((p) => p.id === provider)?.name ?? provider;
  const name = run ? nameOf(run.provider) : '';
  const dismiss = useMutation({
    mutationFn: (id: string) => dismissPushRun(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.pushRuns }),
  });
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
  const earlier = (runs.data ?? []).filter((r) => r.id !== run?.id && !pushRunActive(r));
  return (
    <>
      {run && (pushRunActive(run)
        ? <ActiveStrip run={run} name={name} />
        : <EndedStrip run={run} name={name} onDismiss={() => dismiss.mutate(run.id)} dismissError={dismiss.error} />)}
      {earlier.length > 0 && <EarlierRuns runs={earlier} nameOf={nameOf} />}
    </>
  );
}

/** The runs the strip isn't showing: when, what they did, and a "Not sent" list each, as in the strip. */
function EarlierRuns({ runs, nameOf }: { runs: PushRunView[]; nameOf: (provider: string) => string }) {
  const { t } = useTranslation();
  const display = useDisplay();
  return (
    <div className="push-run-earlier">
      <Disclosure title={t('pushRun.earlier', { count: runs.length })}>
        <ul>
          {runs.map((r) => {
            const name = nameOf(r.provider);
            const unsent = r.counts.skipped + r.counts.failed;
            return (
              <li key={r.id}>
                <p>{t('pushRun.earlierLine', { when: display.dateTime(r.createdAt), summary: runSummary(t, r, name) })}</p>
                {unsent > 0 && <Disclosure title={t('pushRun.details', { count: unsent })}><RunItems id={r.id} name={name} provider={named(undefined, r.provider)} /></Disclosure>}
              </li>
            );
          })}
        </ul>
      </Disclosure>
    </div>
  );
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

function EndedStrip({ run, name, onDismiss, dismissError }: { run: PushRunView; name: string; onDismiss: () => void; dismissError: Error | null }) {
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
          {needsSignIn && <LinkButton href={accountHref('connections')} size="small" variant="primary" icon="signIn">{t('pushRun.signIn', { name })}</LinkButton>}
          {run.status === 'stopped' && (
            <Button size="small" variant={needsSignIn ? 'secondary' : 'primary'} isPending={resume.isPending} onPress={() => resume.mutate()}>{t('pushRun.continue')}</Button>
          )}
          <Button size="small" variant="quiet" onPress={onDismiss}>{t('pushRun.dismiss')}</Button>
        </div>
      </div>
      {resume.isError && <Notice tone="danger">{errorText(resume.error)}</Notice>}
      {dismissError && <Notice tone="danger">{errorText(dismissError)}</Notice>}
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
