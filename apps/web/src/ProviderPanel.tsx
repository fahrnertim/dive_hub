import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, ApiError, keys, providerSitesQuery, providerStatusQuery, siteQuery, unwrap,
  type DiveView, type ProviderStatusView, type ProviderView, type PushView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText, useProblemText } from './lib/display.ts';
import { exporting, useProviders, useProviderText } from './lib/providers.ts';
import { Badge, Button, ConfirmButton, Dialog, Muted, Notice, Panel, SearchList, type SearchListItem } from './ui/index.ts';

type Existing = { remoteId: string; number: number | null; startsAt: string | null; maxDepthM: number | null; durationMinutes: number | null };
type SiteSource = NonNullable<NonNullable<NonNullable<ProviderView['data']['dives']>['export']>['needsSiteIdFrom']>;

/**
 * Where a Dive site keeps its External ID at a site Source, and what a typed ID may look like. Only SSI's is typed by
 * Users (ADR 0021): digits, or what SSI's QR code says ("site:3314").
 */
const SITE_ID: Partial<Record<SiteSource, { field: 'ssiSiteId'; pattern: RegExp }>> = {
  ssi: { field: 'ssiSiteId', pattern: /^(?:site:)?\s*([1-9]\d{0,9})$/i },
};

/** The Dive at every Provider that takes dives (ADR 0027): one panel each, rendered from what the Provider offers. */
export function ProviderPanels({ dive, diverName }: { dive: DiveView; diverName: string | undefined }) {
  const providers = useProviders();
  return <>{exporting(providers.data).map((p) => <ProviderPanel key={p.id} provider={p} dive={dive} diverName={diverName} />)}</>;
}

/**
 * The Dive at one Provider (ADR 0024, 0027): send it, update it when it changed, delete it there, as far as the
 * Provider offers. Shown only when the Dive's Diver is connected; otherwise it says where to connect.
 */
function ProviderPanel({ provider: p, dive: d, diverName }: { provider: ProviderView; dive: DiveView; diverName: string | undefined }) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const problemText = useProblemText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const exports = p.data.dives!.export!;
  const status = useQuery(providerStatusQuery(d.id, p.id));
  const [existing, setExisting] = useState<Existing | null>(null);
  const [picking, setPicking] = useState(false);
  const can = (op: (typeof exports.operations)[number]) => exports.operations.includes(op);
  const refresh = async (next?: ProviderStatusView) => {
    if (next) queryClient.setQueryData(keys.providerStatus(d.id, p.id), next);
    else await queryClient.invalidateQueries({ queryKey: keys.providerStatus(d.id, p.id) });
    await queryClient.invalidateQueries({ queryKey: keys.connections });
  };
  const send = useMutation({
    mutationFn: async (onExisting?: 'link' | 'create') =>
      unwrap(await api.POST('/api/dives/{id}/providers/{provider}', { params: { path: { id: d.id, provider: p.id } }, body: onExisting ? { onExisting } : {} })),
    onSuccess: async (sent) => {
      await refresh(sent.status);
      if (sent.outcome === 'exists') {
        setExisting(sent.existing);
        return;
      }
      setExisting(null);
      announce(exports.delivery === 'handed_over' ? pt('handedOverResult') : pt(`result.${sent.outcome}`, { number: sent.status.current?.remoteNumber ?? '' }));
    },
    onError: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dives/{id}/providers/{provider}', { params: { path: { id: d.id, provider: p.id } } })),
    onSuccess: async (next) => { await refresh(next); announce(pt('deleted')); },
  });

  const s = status.data;
  if (!s) return status.error ? <Panel title={p.name}><Notice tone="danger">{errorText(status.error)}</Notice></Panel> : null;
  if (!s.connection) {
    // Nothing sent and nothing to send with: one line pointing to where to connect.
    return (
      <Panel title={p.name}>
        <Muted>{pt('notConnected', { diver: diverName ?? '' })} <a href="#/account">{pt('goConnect')}</a></Muted>
        {s.current && <SentState provider={p} status={s} />}
      </Panel>
    );
  }
  const last = s.pushes[0];
  const handedOver = s.pushes.find((x) => x.state === 'handed_over');
  const signInNeeded = s.connection.state === 'needs_sign_in'
    || (send.error instanceof ApiError && send.error.code === 'provider_sign_in_needed');
  const needsSiteId = !!exports.needsSiteIdFrom;
  const siteId = exports.needsSiteIdFrom ? SITE_ID[exports.needsSiteIdFrom] : undefined;
  const ready = !needsSiteId || !!s.siteExternalId;
  const failure = (x: PushView) => problemText(x.failureCode ?? 'internal_error', p);

  return (
    <Panel title={p.name}>
      <div className="provider-body">
      {s.current ? <SentState provider={p} status={s} />
        : handedOver && !can('update') ? <p className="provider-state">{pt('handedOver', { date: display.dateTime(handedOver.createdAt) })}</p>
        : <p className="provider-state">{pt('notSent')}</p>}

      {signInNeeded && (
        <Notice tone="danger">{pt('signInNeeded')} <a href="#/account">{pt('goSignIn')}</a></Notice>
      )}
      {needsSiteId && !d.site && <Muted>{pt('needsSite')}</Muted>}
      {needsSiteId && d.site && !s.siteExternalId && (
        <div className="form">
          <Muted>{pt('needsSiteId', { site: d.site.name })}</Muted>
          {siteId && p.data.diveSites?.import?.operations.includes('find') && (
            <div className="form-actions"><Button icon="site" onPress={() => setPicking(true)}>{pt('chooseSite')}</Button></div>
          )}
        </div>
      )}

      {send.error && !signInNeeded && <Notice tone="danger">{errorText(send.error)}</Notice>}
      {last?.state === 'failed' && !send.error && <Notice tone="danger">{pt('lastFailed', { error: failure(last) })}</Notice>}
      {last?.differences && last.differences.length > 0 && <Differences provider={p} push={last} />}

      {ready && !signInNeeded && (
        <div className="form-actions">
          {(!s.current || !s.current.upToDate) && (
            <Button variant="primary" icon="send" isPending={send.isPending && send.variables === undefined}
              onPress={() => send.mutate(undefined)}>
              {s.current && can('update') ? pt('update') : pt('send')}
            </Button>
          )}
          {s.current && can('delete') && (
            <ConfirmButton icon="delete" title={pt('deleteTitle')} body={pt('deleteBody', { number: s.current.remoteNumber ?? '' })}
              confirmLabel={pt('delete')} onConfirm={() => remove.mutateAsync()}>
              {pt('delete')}
            </ConfirmButton>
          )}
        </div>
      )}
      {p.notices.map((n) => <Muted key={n}>{pt(`notice.${n}`)}</Muted>)}
      {s.pushes.length > 0 && (
        <details className="extras">
          <summary>{pt('history')}</summary>
          <ul className="provider-pushes">
            {s.pushes.map((x) => (
              <li key={x.id}>
                {display.dateTime(x.createdAt)}: {x.state === 'handed_over' ? pt('handedOverAction') : pt(`action.${x.action}`)}
                {x.remoteNumber !== null && `, ${pt('diveNumber', { number: x.remoteNumber })}`}
                {x.state === 'failed' && <> – {failure(x)}</>}
                {x.remoteGone && x.state === 'confirmed' && <> – {pt('goneAlready')}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
      </div>

      <Dialog title={pt('existsTitle')} isOpen={existing !== null} onOpenChange={(open) => !open && setExisting(null)}>
        {existing && (
          <>
            <p>{pt('existsBody', {
              number: existing.number ?? '', time: existing.startsAt ?? '',
              depth: display.depth(existing.maxDepthM), minutes: existing.durationMinutes ?? '',
            })}</p>
            <p>{pt('existsQuestion')}</p>
            {send.error && <Notice tone="danger">{errorText(send.error)}</Notice>}
            <div className="form-actions">
              <Button variant="primary" icon="link" isPending={send.isPending && send.variables === 'link'} isDisabled={send.isPending}
                onPress={() => send.mutate('link')}>{pt('linkExisting')}</Button>
              <Button icon="send" isPending={send.isPending && send.variables === 'create'} isDisabled={send.isPending}
                onPress={() => send.mutate('create')}>{pt('sendAnyway')}</Button>
              <Button onPress={() => setExisting(null)}>{t('common.cancel')}</Button>
            </div>
          </>
        )}
      </Dialog>
      {picking && d.site && siteId && (
        <SitePicker provider={p} siteId={siteId} diveId={d.id} diveSiteId={d.site.id} siteName={d.site.name} onClose={() => setPicking(false)} />
      )}
    </Panel>
  );
}

/** Where the Dive is at the Provider: its number there, and whether it changed since. */
function SentState({ provider: p, status: s }: { provider: ProviderView; status: ProviderStatusView }) {
  const pt = useProviderText(p);
  const display = useDisplay();
  if (!s.current) return null;
  return (
    <p className="provider-state">
      {pt('sent', { number: s.current.remoteNumber ?? '', date: display.dateTime(s.current.sentAt) })}
      {s.current.upToDate ? <Badge tone="success">{pt('upToDate')}</Badge> : <Badge>{pt('changed')}</Badge>}
    </p>
  );
}

/** Fields the Provider stored differently from what was sent (read back after sending). */
function Differences({ provider: p, push }: { provider: ProviderView; push: PushView }) {
  const { t, i18n } = useTranslation();
  const pt = useProviderText(p);
  // The Provider's read-back fields; one this client doesn't know shows by its name.
  const field = (name: string) => (i18n.exists(`provider.field.${name}`) ? pt(`field.${name}` as 'field.site') : name);
  return (
    <Notice tone="info">
      <p>{pt('differences')}</p>
      <ul className="provider-pushes">
        {push.differences!.map((x) => (
          <li key={x.field}>{field(x.field)}: {pt('sentStored', { sent: x.sent ?? t('common.none'), stored: x.stored ?? t('common.none') })}</li>
        ))}
      </ul>
    </Notice>
  );
}

/** Results shown at most, without scrolling (ux-search). */
const SHOWN = 10;
/** The row that saves a site ID typed into the search field. */
const TYPED = '__typed__';

/**
 * Pick the Dive site's ID at the Provider from its sites (SSI: the sites in the User's logbook), nearest first, narrowed
 * while typing a name or an ID; or use an ID typed in. Picking saves at once (ux-search).
 */
function SitePicker({ provider: p, siteId: idOf, diveId, diveSiteId, siteName, onClose }: {
  provider: ProviderView; siteId: NonNullable<(typeof SITE_ID)[SiteSource]>; diveId: string; diveSiteId: string; siteName: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const suggestions = useQuery(providerSitesQuery(diveId, p.id));
  const site = useQuery(siteQuery(diveSiteId));
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: async (externalId: string) => unwrap(await api.PATCH('/api/dive-sites/{id}', {
      params: { path: { id: diveSiteId } }, body: { version: site.data!.version, [idOf.field]: externalId },
    })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.site(diveSiteId), updated);
      await queryClient.invalidateQueries({ queryKey: keys.diveProviders(diveId) });
      await queryClient.invalidateQueries({ queryKey: keys.sites });
      announce(pt('siteSaved'));
      onClose();
    },
  });

  const query = text.trim();
  const typedId = idOf.pattern.exec(query)?.[1];
  const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const all = suggestions.data ?? [];
  const matching = query ? all.filter((s) => fold(s.name).includes(fold(query)) || s.id === typedId) : all;
  const items: SearchListItem[] = matching.slice(0, SHOWN).map((s) => ({
    id: s.id, name: s.name,
    detail: [s.country, s.distanceM !== null ? pt('away', { distance: display.distance(s.distanceM) }) : null, pt('idIs', { id: s.id })]
      .filter(Boolean).join(' · '),
  }));
  // An ID typed in that isn't among the Provider's sites can still be used.
  if (typedId && !matching.some((s) => s.id === typedId)) items.push({ id: TYPED, name: pt('useTypedId', { id: typedId }) });

  const status = suggestions.isPending ? t('common.loading')
    : !query ? (all.length === 0 ? pt('noSuggestions') : pt('fromLogbook'))
    : items.length === 0 ? pt('noLogbookMatch', { q: query })
    : matching.length > SHOWN ? t('sites.showingFirst', { shown: SHOWN }) : null;

  return (
    <Dialog title={pt('pickTitle', { site: siteName })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="provider-sites">
        <p>{pt('pickIntro')}</p>
        {suggestions.error && <Notice tone="danger">{errorText(suggestions.error)}</Notice>}
        <SearchList
          label={pt('findOrType')} description={t('sites.ssiSiteIdHint')} query={text} onQueryChange={setText} autoFocus
          items={items} onPick={(id) => save.mutate(id === TYPED ? typedId! : id)} isPending={save.isPending} pendingStatus={t('sites.choosing')} isDisabled={!site.data}
          listLabel={pt('fromLogbook')} status={status}
        />
        {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
        <div className="form-actions">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
