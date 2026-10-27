import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, keys, unwrap, type ConnectionView, type ProviderView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { useProviderText } from './lib/providers.ts';
import { SendDivesDialog } from './PushRun.tsx';
import { Button, Muted, Notice, RadioGroup, Switch } from './ui/index.ts';

type Interval = 60 | 360 | 1440;
/** The interval chosen when the fetch is turned on (the owner's choice, ADR 0056), else the shortest the Provider offers. */
const PRESELECTED: Interval = 360;
const INTERVAL_TEXT = { 60: 'everyHour', 360: 'every6Hours', 1440: 'onceADay' } as const;
const isInterval = (m: number): m is Interval => m === 60 || m === 360 || m === 1440;

type Settings = { sendChanges?: boolean; sendNewDives?: boolean; deleteAtProvider?: boolean; fetchEveryMinutes?: Interval | null };

/**
 * What a Connection does by itself (ADR 0056), under the Connection: the settings (saved at once, only what the
 * Provider offers), when it last fetched and how many Dives wait, and the offer to send the new Dives of a large Import.
 */
export function ProviderAutomation({ provider: p, connection: c, several }: { provider: ProviderView; connection: ConnectionView; several: boolean }) {
  const pt = useProviderText(p);
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const headingId = useId();
  const offerId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [sending, setSending] = useState(false);
  const save = useMutation({
    mutationFn: async (body: Settings) => unwrap(await api.PATCH('/api/connections/{id}', { params: { path: { id: c.id } }, body })),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConnectionView[]>(keys.connections, (all) => all?.map((x) => (x.id === updated.id ? updated : x)));
      announce(pt('automation.saved'));
    },
  });
  const dismiss = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/connections/{id}/unsent-dives/dismiss', { params: { path: { id: c.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.connections });
      // The offer, with the button that was pressed, is gone: focus stays in the section.
      requestAnimationFrame(() => heading.current?.focus());
    },
  });
  const { offers, lastFetch, unsentDives, waiting } = c;
  const intervals = offers.fetchEvery.filter(isInterval);
  const hasSettings = offers.sendChanges || offers.sendNewDives || offers.deleteAtProvider || intervals.length > 0;
  if (!hasSettings && !lastFetch && unsentDives.length === 0) return null;

  const queued = [
    ...(waiting.waiting > 0 ? [pt('automation.queueWaiting', { count: waiting.waiting })] : []),
    ...(waiting.held > 0 ? [pt('automation.queueHeld', { count: waiting.held })] : []),
    ...(waiting.stopped > 0 ? [pt('automation.queueStopped', { count: waiting.stopped })] : []),
  ];
  const deleteHelpId = `${headingId}-delete-help`;
  const askImport = () => {
    // The import under this one asks for what a fetch left to the User.
    const target = document.getElementById(`import-${c.id}`);
    if (!target) return;
    target.tabIndex = -1;
    target.focus();
    target.scrollIntoView({ block: 'start' });
  };

  return (
    <section className="provider-import" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1}>{several ? pt('automation.titleDiver', { diver: c.diverName }) : pt('automation.title')}</h3>
      {unsentDives.length > 0 && (
        <div role="group" aria-labelledby={offerId}>
          <Notice tone="info">
            <p id={offerId}>{pt('automation.unsent' as 'automation.unsent_one', { count: unsentDives.length })}</p>
            <div className="form-actions">
              <Button variant="primary" icon="send" onPress={() => setSending(true)}>{pt('automation.unsentSend')}</Button>
              <Button isPending={dismiss.isPending} onPress={() => dismiss.mutate()}>{t('common.dismiss')}</Button>
            </div>
            {dismiss.error && <Notice tone="danger">{errorText(dismiss.error)}</Notice>}
          </Notice>
        </div>
      )}
      {hasSettings && (
        <div className="provider-settings">
          {offers.sendChanges && (
            <Switch isSelected={c.sendChanges} onChange={(sendChanges) => save.mutate({ sendChanges })}>
              {pt('automation.sendChanges')}
            </Switch>
          )}
          {offers.sendNewDives && (
            <Switch isSelected={c.sendNewDives} onChange={(sendNewDives) => save.mutate({ sendNewDives })}>
              {pt('automation.sendNewDives')}
            </Switch>
          )}
          {offers.deleteAtProvider && (
            <>
              <Switch
                isSelected={c.deleteAtProvider} aria-describedby={deleteHelpId}
                onChange={(deleteAtProvider) => save.mutate({ deleteAtProvider })}
              >
                {pt('automation.deleteAtProvider')}
              </Switch>
              <p id={deleteHelpId} className="muted provider-settings-help">{pt('automation.deleteHelp')}</p>
            </>
          )}
          {intervals.length > 0 && (
            <>
              <Switch
                isSelected={c.fetchEveryMinutes !== null}
                onChange={(on) => save.mutate({ fetchEveryMinutes: on ? (intervals.includes(PRESELECTED) ? PRESELECTED : intervals[0]!) : null })}
              >
                {pt('automation.fetch')}
              </Switch>
              {c.fetchEveryMinutes !== null && (
                <RadioGroup
                  label={pt('automation.fetchEvery')} value={String(c.fetchEveryMinutes)}
                  onChange={(value) => save.mutate({ fetchEveryMinutes: Number(value) as Interval })}
                  options={intervals.map((m) => ({ value: String(m), label: pt(`automation.${INTERVAL_TEXT[m]}`) }))}
                />
              )}
              {c.fetchEveryMinutes !== null && c.diveImport?.mode === 'off' && <Muted>{pt('automation.fetchNeedsImport')}</Muted>}
            </>
          )}
          {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
        </div>
      )}
      {lastFetch && (
        <div className="provider-fetch-summary">
          <p>
            {pt('automation.lastFetch', {
              when: display.dateTime(lastFetch.at), new: lastFetch.created, updated: lastFetch.updated, waiting: lastFetch.waitingForYou,
            })}
          </p>
          {lastFetch.waitingForYou > 0 && c.diveImport && (
            <Button variant="quiet" size="small" onPress={askImport}>{pt('automation.askImport')}</Button>
          )}
        </div>
      )}
      {queued.length > 0 && <p className="muted">{new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(queued)}</p>}
      {sending && <SendDivesDialog connection={c} provider={p} ids={unsentDives} onClose={() => setSending(false)} />}
    </section>
  );
}
