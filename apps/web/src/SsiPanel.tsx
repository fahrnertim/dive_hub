import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, ApiError, keys, siteQuery, ssiSitesQuery, ssiStatusQuery, unwrap, type DiveView, type SsiPushView, type SsiStatusView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Badge, Button, ConfirmButton, Dialog, Muted, Notice, Panel, RadioGroup, TextField } from './ui/index.ts';

type Existing = { remoteId: string; number: number | null; startsAt: string | null; maxDepthM: number | null; durationMinutes: number | null };

/** Digits, or what SSI's QR code says ("site:3314"). */
const SSI_ID = /^(?:site:)?\s*([1-9]\d{0,9})$/i;

/**
 * The Dive at SSI (ADR 0024): send it, update it when it changed, delete it there. Shown only when the Dive's
 * Diver is connected to SSI; otherwise it says where to connect.
 */
export function SsiPanel({ dive: d, diverName }: { dive: DiveView; diverName: string | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const status = useQuery(ssiStatusQuery(d.id));
  const [existing, setExisting] = useState<Existing | null>(null);
  const [picking, setPicking] = useState(false);
  const refresh = async (next?: SsiStatusView) => {
    if (next) queryClient.setQueryData(keys.ssi(d.id), next);
    else await queryClient.invalidateQueries({ queryKey: keys.ssi(d.id) });
    await queryClient.invalidateQueries({ queryKey: keys.ssiConnections });
  };
  const send = useMutation({
    mutationFn: async (onExisting?: 'link' | 'create') =>
      unwrap(await api.POST('/api/dives/{id}/ssi', { params: { path: { id: d.id } }, body: onExisting ? { onExisting } : {} })),
    onSuccess: async (sent) => {
      await refresh(sent.status);
      if (sent.outcome === 'exists') {
        setExisting(sent.existing);
        return;
      }
      setExisting(null);
      announce(t(`ssi.result.${sent.outcome}`, { number: sent.status.current?.remoteNumber ?? '' }));
    },
    onError: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dives/{id}/ssi', { params: { path: { id: d.id } } })),
    onSuccess: async (next) => { await refresh(next); announce(t('ssi.deleted')); },
  });

  const s = status.data;
  if (!s) return status.error ? <Panel title={t('ssi.title')}><Notice tone="danger">{errorText(status.error)}</Notice></Panel> : null;
  if (!s.connection) {
    // Nothing sent and nothing to send with: one line pointing to where to connect.
    return (
      <Panel title={t('ssi.title')}>
        <Muted>{t('ssi.notConnected', { name: diverName ?? '' })} <a href="#/account">{t('ssi.goConnect')}</a></Muted>
        {s.current && <SentState status={s} />}
      </Panel>
    );
  }
  const last = s.pushes[0];
  const signInNeeded = s.connection.state === 'needs_sign_in'
    || (send.error instanceof ApiError && send.error.code === 'ssi_sign_in_needed');

  return (
    <Panel title={t('ssi.title')}>
      <div className="ssi-body">
      {s.current ? <SentState status={s} /> : <p className="ssi-state">{t('ssi.notSent')}</p>}

      {signInNeeded && (
        <Notice tone="danger">{t('ssi.signInNeeded')} <a href="#/account">{t('ssi.goSignIn')}</a></Notice>
      )}
      {!d.site && <Muted>{t('ssi.needsSite')}</Muted>}
      {d.site && !s.siteSsiId && (
        <div className="form">
          <Muted>{t('ssi.needsSsiSiteId', { site: d.site.name })}</Muted>
          <div className="form-actions"><Button icon="site" onPress={() => setPicking(true)}>{t('ssi.chooseSsiSite')}</Button></div>
        </div>
      )}

      {send.error && !signInNeeded && <Notice tone="danger">{errorText(send.error)}</Notice>}
      {last?.state === 'failed' && !send.error && <Notice tone="danger">{t('ssi.lastFailed', { error: t(`errors.${last.failureCode ?? 'internal_error'}`) })}</Notice>}
      {last?.differences && last.differences.length > 0 && <Differences push={last} />}

      {s.siteSsiId && !signInNeeded && (
        <div className="form-actions">
          {(!s.current || !s.current.upToDate) && (
            <Button variant="primary" icon="send" isPending={send.isPending && send.variables === undefined}
              onPress={() => send.mutate(undefined)}>
              {s.current ? t('ssi.update') : t('ssi.send')}
            </Button>
          )}
          {s.current && (
            <ConfirmButton icon="delete" title={t('ssi.deleteTitle')} body={t('ssi.deleteBody', { number: s.current.remoteNumber ?? '' })}
              confirmLabel={t('ssi.delete')} onConfirm={() => remove.mutateAsync()}>
              {t('ssi.delete')}
            </ConfirmButton>
          )}
        </div>
      )}
      <Muted>{t('ssi.unconfirmedNote')}</Muted>
      {s.pushes.length > 0 && (
        <details className="extras">
          <summary>{t('ssi.history')}</summary>
          <ul className="ssi-pushes">
            {s.pushes.map((p) => (
              <li key={p.id}>
                {display.dateTime(p.createdAt)}: {t(`ssi.action.${p.action}`)}
                {p.remoteNumber !== null && `, ${t('ssi.diveNumber', { number: p.remoteNumber })}`}
                {p.state === 'failed' && <> – {t(`errors.${p.failureCode ?? 'internal_error'}`)}</>}
                {p.failureCode === 'ssi_dive_gone' && p.state === 'confirmed' && <> – {t('ssi.goneAlready')}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
      </div>

      <Dialog title={t('ssi.existsTitle')} isOpen={existing !== null} onOpenChange={(open) => !open && setExisting(null)}>
        {existing && (
          <>
            <p>{t('ssi.existsBody', {
              number: existing.number ?? '', time: existing.startsAt ?? '',
              depth: display.depth(existing.maxDepthM), minutes: existing.durationMinutes ?? '',
            })}</p>
            <p>{t('ssi.existsQuestion')}</p>
            {send.error && <Notice tone="danger">{errorText(send.error)}</Notice>}
            <div className="form-actions">
              <Button variant="primary" icon="link" isPending={send.isPending && send.variables === 'link'} isDisabled={send.isPending}
                onPress={() => send.mutate('link')}>{t('ssi.linkExisting')}</Button>
              <Button icon="send" isPending={send.isPending && send.variables === 'create'} isDisabled={send.isPending}
                onPress={() => send.mutate('create')}>{t('ssi.sendAnyway')}</Button>
              <Button onPress={() => setExisting(null)}>{t('common.cancel')}</Button>
            </div>
          </>
        )}
      </Dialog>
      {picking && d.site && <SsiSitePicker diveId={d.id} siteId={d.site.id} siteName={d.site.name} onClose={() => setPicking(false)} />}
    </Panel>
  );
}

/** Where the Dive is at SSI: its number there, and whether it changed since. */
function SentState({ status: s }: { status: SsiStatusView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  if (!s.current) return null;
  return (
    <p className="ssi-state">
      {t('ssi.sent', { number: s.current.remoteNumber ?? '', date: display.dateTime(s.current.sentAt) })}
      {s.current.upToDate ? <Badge tone="success">{t('ssi.upToDate')}</Badge> : <Badge>{t('ssi.changed')}</Badge>}
    </p>
  );
}

/** Fields SSI stored differently from what was sent (read back after sending). */
function Differences({ push }: { push: SsiPushView }) {
  const { t } = useTranslation();
  return (
    <Notice tone="info">
      <p>{t('ssi.differences')}</p>
      <ul className="ssi-pushes">
        {push.differences!.map((d) => (
          <li key={d.field}>{t(`ssi.field.${d.field}`)}: {t('ssi.sentStored', { sent: d.sent ?? t('common.none'), stored: d.stored ?? t('common.none') })}</li>
        ))}
      </ul>
    </Notice>
  );
}

/** Pick the Dive site's SSI ID from the User's SSI logbook, nearest first, or type it. */
function SsiSitePicker({ diveId, siteId, siteName, onClose }: { diveId: string; siteId: string; siteName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const suggestions = useQuery(ssiSitesQuery(diveId));
  const site = useQuery(siteQuery(siteId));
  const [chosen, setChosen] = useState('');
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const save = useMutation({
    mutationFn: async (ssiSiteId: string) => unwrap(await api.PATCH('/api/dive-sites/{id}', {
      params: { path: { id: siteId } }, body: { version: site.data!.version, ssiSiteId },
    })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.site(siteId), updated);
      await queryClient.invalidateQueries({ queryKey: keys.ssi(diveId) });
      await queryClient.invalidateQueries({ queryKey: keys.sites });
      announce(t('ssi.siteSaved'));
      onClose();
    },
  });
  const submit = () => {
    const id = typed.trim() ? SSI_ID.exec(typed.trim())?.[1] : chosen || undefined;
    setBad(!id);
    if (id) save.mutate(id);
  };
  return (
    <Dialog title={t('ssi.pickTitle', { site: siteName })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="ssi-sites">
        <p>{t('ssi.pickIntro')}</p>
        {suggestions.isPending && <Muted>{t('common.loading')}</Muted>}
        {suggestions.error && <Notice tone="danger">{errorText(suggestions.error)}</Notice>}
        {suggestions.data && suggestions.data.length === 0 && <Muted>{t('ssi.noSuggestions')}</Muted>}
        {suggestions.data && suggestions.data.length > 0 && (
          <RadioGroup
            label={t('ssi.fromLogbook')} value={chosen} onChange={(v) => { setChosen(v); setTyped(''); }}
            options={suggestions.data.map((s) => ({
              value: s.id,
              label: (
                <span className="radio-text">
                  <span translate="no">{s.name}</span>
                  <span className="field-description">
                    {[s.country, s.distanceM !== null ? t('ssi.away', { distance: display.distance(s.distanceM) }) : null, t('ssi.idIs', { id: s.id })]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
              ),
            }))}
          />
        )}
        <TextField label={t('ssi.typeId')} description={t('sites.ssiSiteIdHint')} value={typed} onChange={(v) => { setTyped(v); setBad(false); }}
          inputMode="numeric" autoComplete="off" maxLength={20} />
        {bad && <Notice tone="danger">{t(typed.trim() ? 'sites.ssiSiteIdInvalid' : 'ssi.chooseOrType')}</Notice>}
        {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
        <div className="form-actions">
          <Button variant="primary" icon="save" isPending={save.isPending} isDisabled={!site.data} onPress={submit}>{t('ssi.saveSiteId')}</Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
