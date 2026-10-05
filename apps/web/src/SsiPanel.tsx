import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, ApiError, keys, siteQuery, ssiSitesQuery, ssiStatusQuery, unwrap, type DiveView, type SsiPushView, type SsiStatusView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Badge, Button, ConfirmButton, Dialog, Muted, Notice, Panel, SearchList, type SearchListItem } from './ui/index.ts';

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

/** Results shown at most, without scrolling (ux-search). */
const SSI_SHOWN = 10;
/** The row that saves an SSI site ID typed into the search field. */
const TYPED = '__typed__';

/**
 * Pick the Dive site's SSI ID from the sites in the User's SSI logbook, nearest first, narrowed while typing a name
 * or an ID; or use an ID typed in ("site:3314" from SSI's QR code works too). Picking saves at once (ux-search).
 */
function SsiSitePicker({ diveId, siteId, siteName, onClose }: { diveId: string; siteId: string; siteName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const suggestions = useQuery(ssiSitesQuery(diveId));
  const site = useQuery(siteQuery(siteId));
  const [text, setText] = useState('');
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

  const query = text.trim();
  const typedId = SSI_ID.exec(query)?.[1];
  const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const all = suggestions.data ?? [];
  const matching = query ? all.filter((s) => fold(s.name).includes(fold(query)) || s.id === typedId) : all;
  const items: SearchListItem[] = matching.slice(0, SSI_SHOWN).map((s) => ({
    id: s.id, name: s.name,
    detail: [s.country, s.distanceM !== null ? t('ssi.away', { distance: display.distance(s.distanceM) }) : null, t('ssi.idIs', { id: s.id })]
      .filter(Boolean).join(' · '),
  }));
  // An ID typed in that isn't in the logbook can still be used.
  if (typedId && !matching.some((s) => s.id === typedId)) items.push({ id: TYPED, name: t('ssi.useTypedId', { id: typedId }) });

  const status = suggestions.isPending ? t('common.loading')
    : !query ? (all.length === 0 ? t('ssi.noSuggestions') : t('ssi.fromLogbook'))
    : items.length === 0 ? t('ssi.noLogbookMatch', { q: query })
    : matching.length > SSI_SHOWN ? t('sites.showingFirst', { shown: SSI_SHOWN }) : null;

  return (
    <Dialog title={t('ssi.pickTitle', { site: siteName })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="ssi-sites">
        <p>{t('ssi.pickIntro')}</p>
        {suggestions.error && <Notice tone="danger">{errorText(suggestions.error)}</Notice>}
        <SearchList
          label={t('ssi.findOrType')} description={t('sites.ssiSiteIdHint')} query={text} onQueryChange={setText} autoFocus
          items={items} onPick={(id) => save.mutate(id === TYPED ? typedId! : id)} isPending={save.isPending} pendingStatus={t('sites.choosing')} isDisabled={!site.data}
          listLabel={t('ssi.fromLogbook')} status={status}
        />
        {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
        <div className="form-actions">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
