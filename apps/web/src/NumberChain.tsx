import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { keys, pushRunPreviewQuery, startPushRun, type PushRunChoices, type PushRunPreview } from './api.ts';
import { announce } from './lib/announce.ts';
import { accountHref } from './lib/account-tabs.ts';
import { useErrorText } from './lib/display.ts';
import { Button, ConfirmButton, Dialog, Muted, Notice } from './ui/index.ts';

/** Every number a run would set, in the order they go (ADR 0052): the User sees them before anything is sent. */
export function NumberPlanList({ plan, name }: { plan: PushRunPreview['numberPlan']; name: string }) {
  const { t } = useTranslation();
  const numberOf = (diveId: string) => plan.find((s) => s.diveId === diveId)?.number ?? '';
  return (
    <ol className="push-run-numbers">
      {plan.map((s) => (
        <li key={s.diveId}>
          <span>{t('pushRun.numberStep', { number: s.number ?? '', from: s.from ?? '', to: s.to, name })}</span>
          {s.with === 'update' && <small className="field-hint">{t('pushRun.numberWithUpdate')}</small>}
          {s.sharesWith && <small className="field-hint">{t('pushRun.numberShares', { to: s.to, other: numberOf(s.sharesWith), name })}</small>}
        </li>
      ))}
    </ol>
  );
}

/** What a number held only at the Provider holds back, and the way on: make that dive a dive here (ADR 0030, 0052). */
export function HeldAtProvider({ held, name, onNavigate }: { held: PushRunPreview['heldAtProvider']; name: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  if (held.length === 0) return null;
  return (
    <div className="push-run-held">
      <p>{t('pushRun.heldAtProvider', { count: held.length, name })}</p>
      <ul>
        {held.slice(0, 5).map((h) => (
          <li key={h.diveId}>{t('pushRun.heldLine', { wanted: h.wanted, when: h.holder?.startsAt ?? '?', name })}</li>
        ))}
      </ul>
      <p><a href={accountHref('connections')} onClick={onNavigate}>{t('pushRun.heldImport', { name })}</a></p>
    </div>
  );
}

/**
 * "Set the number with the dives in its way" (ADR 0052): the same preview as a run, for this Dive and the Dives that have
 * the numbers it needs, one after another, with the numbers shown; the User starts it as a run.
 */
export function NumberChainDialog({ connectionId, diveId, name, onClose }: { connectionId: string; diveId: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  // The preview shows every number, confirmed or not; the start asks first where a verification can go.
  const choices: PushRunChoices = {
    list: {}, ids: [diveId], withHolders: true, updates: false, updatesRemovingVerification: false, numbers: true, numbersRemovingVerification: true,
  };
  const preview = useQuery(pushRunPreviewQuery(connectionId, choices));
  const p = preview.data;
  const start = useMutation({
    mutationFn: () => startPushRun(connectionId, choices),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: keys.pushRuns });
      announce(t('pushRun.started', { count: run.counts.total, name }));
      onClose();
    },
  });
  const removing = p?.counts.numberRemovingVerification ?? 0;
  const label = t('pushRun.chainConfirm', { count: p?.send ?? 0 });
  return (
    <Dialog title={t('pushRun.chainTitle', { name })} isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <div className="push-run-dialog">
        {preview.isError && <Notice tone="danger">{errorText(preview.error)}</Notice>}
        {!p && !preview.isError && <Muted>{t('pushRun.loading')}</Muted>}
        {p && (
          <>
            {p.numberPlan.length > 0
              ? <NumberPlanList plan={p.numberPlan} name={name} />
              : <p>{t('pushRun.chainNothing')}</p>}
            <HeldAtProvider held={p.heldAtProvider} name={name} onNavigate={onClose} />
            {p.counts.numberTaken > 0 && <Muted>{t('pushRun.chainBlocked', { count: p.counts.numberTaken })}</Muted>}
          </>
        )}
        {start.isError && <Notice tone="danger">{errorText(start.error)}</Notice>}
        <div className="form-actions">
          {removing > 0 ? (
            <ConfirmButton
              variant="primary" isDisabled={!p || p.send === 0} tone="primary"
              title={t('pushRun.verificationTitle', { name })} body={t('pushRun.verificationBody', { count: removing, name })}
              confirmLabel={label} onConfirm={() => start.mutateAsync()}
            >
              {label}
            </ConfirmButton>
          ) : (
            <Button variant="primary" isPending={start.isPending} isDisabled={!p || p.send === 0} onPress={() => start.mutate()}>{label}</Button>
          )}
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
