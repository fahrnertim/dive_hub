// The state of a Dive's Waiting push (ADR 0056): waiting to go out, held for something the User has to do, or stopped
// for good with Retry. A logbook row gets a small icon and the words; the Dive's page and the deleted dives get the words
// and Retry. The queue's own texts name the Provider and, for a stop, say why in the problem's words.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { api, keys, unwrap, type ProblemCode } from './api.ts';
import { useErrorText, useProblemText } from './lib/display.ts';
import { focusFirstIn } from './lib/focus.ts';
import { diveHref } from './lib/logbook.ts';
import { useProviderText } from './lib/providers.ts';
import { Button, Icon, Notice, type IconName } from './ui/index.ts';

/** What the API says about one entry; the fields of `WaitingPushView` the texts need. */
export interface WaitingPush {
  provider: string;
  action: 'send' | 'delete';
  state: 'waiting' | 'held' | 'stopped';
  reason: string | null;
  dueAt: string;
}

const HELD_REASONS = ['sign_in', 'requirements', 'exists', 'removes_verification'] as const;
type HeldReason = (typeof HELD_REASONS)[number];
const isHeldReason = (reason: string | null): reason is HeldReason => HELD_REASONS.includes(reason as HeldReason);

const ICON: Record<WaitingPush['state'], IconName> = { waiting: 'waiting', held: 'warning', stopped: 'danger' };

/** Whole minutes until the entry goes out, at least one: "in 5 min" right after a delete. */
const minutesUntil = (dueAt: string, now: number) => Math.max(1, Math.ceil((Date.parse(dueAt) - now) / 60_000));

/** The words for the entry, in the Provider's name; an unknown reason is told as plain waiting. */
function useWaitingText(push: WaitingPush, providerName: string) {
  const pt = useProviderText({ id: push.provider, name: providerName });
  const problemText = useProblemText();
  const [now] = useState(() => Date.now());
  if (push.state === 'stopped') {
    const reason = problemText((push.reason ?? 'internal_error') as ProblemCode, { id: push.provider, name: providerName });
    return pt(`waitingPush.stopped.${push.action}`, { reason });
  }
  if (push.state === 'held' && isHeldReason(push.reason)) return pt(`waitingPush.held.${push.reason}`);
  return push.action === 'delete'
    ? pt('waitingPush.deleting', { minutes: minutesUntil(push.dueAt, now) })
    : pt('waitingPush.waiting');
}

/**
 * Retry for a stopped entry: it waits again, due now. `itemName` tells the buttons of a list apart. The lists
 * refresh, so the entry shows its new state.
 */
function Retry({ diveId, provider, itemName, settled }: {
  diveId: string; provider: string; itemName: string | undefined; settled: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/dives/{id}/providers/{provider}/retry', { params: { path: { id: diveId, provider } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      await queryClient.invalidateQueries({ queryKey: keys.deletedDives });
      await queryClient.invalidateQueries({ queryKey: keys.connections });
      // The button is gone now (the entry waits again): focus moves to the words, which say so (WCAG 2.4.3, 4.1.3).
      requestAnimationFrame(() => settled.current?.focus());
    },
    // The entry may be settled meanwhile (404): the lists then show how it ended.
    onError: async () => { await queryClient.invalidateQueries({ queryKey: keys.dives }); await queryClient.invalidateQueries({ queryKey: keys.deletedDives }); },
  });
  const label = t('provider.waitingPush.retry');
  return (
    <>
      <Button
        size="small" isPending={retry.isPending} onPress={() => retry.mutate()}
        {...(itemName && { 'aria-label': t('common.forItem', { action: label, item: itemName }) })}
      >
        {label}
      </Button>
      {retry.error && <Notice tone="danger">{errorText(retry.error)}</Notice>}
    </>
  );
}

/** The fix for a held `requirements` entry: the Dive's page (from the logbook), or the requirements under the words. */
function FixLink({ diveId, variant, anchor }: { diveId: string; variant: 'row' | 'panel'; anchor: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const label = t('provider.waitingPush.fix');
  if (variant === 'row') return <a href={diveHref(diveId, undefined)}>{label}</a>;
  const show = () => {
    const needs = anchor.current?.closest('.waiting-push-panel')?.parentElement?.querySelector<HTMLElement>('.provider-needs');
    if (!needs) return;
    if (!focusFirstIn(needs)) { needs.tabIndex = -1; needs.focus(); }
    needs.scrollIntoView({ block: 'nearest' });
  };
  return <Button variant="quiet" size="small" onPress={show}>{label}</Button>;
}

/**
 * One entry of a Dive's queue. `row`: the icon and the words in a logbook row, with Retry for a stopped one when it
 * gets `diveId`. `panel`: the words with Retry where it applies, on the Dive's page and in the deleted dives. A held
 * entry that lacks something links to where it is fixed.
 */
export function WaitingPushState({ push, providerName, variant, diveId, itemName }: {
  push: WaitingPush; providerName: string; variant: 'row' | 'panel'; diveId?: string | undefined; itemName?: string | undefined;
}) {
  const text = useWaitingText(push, providerName);
  const words = useRef<HTMLSpanElement>(null);
  const icon = <Icon name={push.action === 'delete' && push.state === 'waiting' ? 'delete' : ICON[push.state]} />;
  const state = <span ref={words} tabIndex={-1} className="waiting-push-text">{text}</span>;
  const retry = push.state === 'stopped' && diveId && <Retry diveId={diveId} provider={push.provider} itemName={itemName} settled={words} />;
  const fix = push.state === 'held' && push.reason === 'requirements' && diveId && <FixLink diveId={diveId} variant={variant} anchor={words} />;
  if (variant === 'row') {
    return (
      // The row opens the Dive on a click; the controls are its own.
      <span className={`waiting-push waiting-push-${push.state}`} onClick={(e) => e.stopPropagation()}>{icon}{state}{retry}{fix}</span>
    );
  }
  return (
    <div className={`waiting-push-panel waiting-push-${push.state}`}>
      <p className="waiting-push">{icon}{state}</p>
      {retry}{fix}
    </div>
  );
}
