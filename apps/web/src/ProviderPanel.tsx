import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, ApiError, buddiesQuery, keys, providerSitesQuery, providerStatusQuery, unwrap,
  type DiveView, type ProviderStatusView, type ProviderView, type PushView, type RequirementView, type UnmetView,
} from './api.ts';
import { showDiveCodes } from './CentresPage.tsx';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText, useProblemText } from './lib/display.ts';
import { exporting, typedSiteId, useNames, useProviders, useProviderText, waitsForUser } from './lib/providers.ts';
import { Badge, Button, ConfirmButton, Dialog, Disclosure, Muted, Notice, SearchList, type SearchListItem } from './ui/index.ts';

type Existing = { remoteId: string; number: number | null; startsAt: string | null; maxDepthM: number | null; durationMinutes: number | null };

/** The requirement an unmet item is about, as the Provider declares it (ADR 0029). */
const requirementOf = (p: ProviderView, u: UnmetView): RequirementView | undefined =>
  p.data.dives?.export?.requirements.find((r) => r.type === u.type && r.source === u.source);

/** The Dive at every Provider that takes dives (ADR 0027): one line each, rendered from what the Provider offers. */
export function ProviderPanels({ dive, diverName }: { dive: DiveView; diverName: string | undefined }) {
  const providers = useProviders();
  return <>{exporting(providers.data).map((p) => <ProviderPanel key={p.id} provider={p} dive={dive} diverName={diverName} />)}</>;
}

/**
 * The Dive at one Provider (ADR 0024, 0027): send it, update it when it changed, delete it there, as far as the
 * Provider offers. What it needs first comes from its requirements (ADR 0029), each with its own way to fix it.
 * Shown only when the Dive's Diver is connected; otherwise it says where to connect.
 * One line that says where the Dive is at the Provider, and opens for the rest (UI redesign, slice A). It opens by
 * itself when something waits for the User: the Dive changed since it was sent, or the last sending failed.
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
  const [verificationRemoved, setVerificationRemoved] = useState(false);
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
      // Said again after the update, with the way to the code (ADR 0043).
      setVerificationRemoved(sent.outcome === 'updated' && !!status.data?.current?.updateRemovesVerification);
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
  const waiting = !!s && waitsForUser(s);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (waiting) setOpen(true);
  }, [waiting]);
  if (!s) return status.error ? <Line title={p.name}><Notice tone="danger">{errorText(status.error)}</Notice></Line> : null;
  if (!s.connection) {
    // Nothing sent and nothing to send with: one line pointing to where to connect.
    return (
      <Line title={p.name}>
        <p className="muted">{pt('notConnected', { diver: diverName ?? '' })} <a href="#/account">{pt('goConnect')}</a></p>
        {s.current && <SentState provider={p} status={s} />}
      </Line>
    );
  }
  const last = s.pushes[0];
  const handedOver = s.pushes.find((x) => x.state === 'handed_over');
  const signInNeeded = s.connection.state === 'needs_sign_in'
    || (send.error instanceof ApiError && send.error.code === 'provider_sign_in_needed');
  const ready = !s.unmet.some((u) => u.severity === 'blocking');
  const failure = (x: PushView) => problemText(x.failureCode ?? 'internal_error', p);

  const state = s.current ? <SentState provider={p} status={s} />
    : handedOver && !can('update') ? <p className="provider-state">{pt('handedOver', { date: display.dateTime(handedOver.createdAt) })}</p>
    : <p className="provider-state">{pt('notSent')}</p>;

  return (
    <section className="dive-line">
      <Disclosure level={2} title={p.name} summary={state} isExpanded={open} onExpandedChange={setOpen}>
      <div className="provider-body">

      {signInNeeded && (
        <Notice tone="danger">{pt('signInNeeded')} <a href="#/account">{pt('goSignIn')}</a></Notice>
      )}
      <Requirements provider={p} dive={d} status={s} />

      {send.error && !signInNeeded && <Notice tone="danger">{errorText(send.error)}</Notice>}
      {last?.state === 'failed' && !send.error && <Notice tone="danger">{pt('lastFailed', { error: failure(last) })}</Notice>}
      {last?.leftOut && last.leftOut.length > 0 && last.state !== 'failed' && <LeftOut provider={p} push={last} />}
      {last?.differences && last.differences.length > 0 && <Differences provider={p} push={last} />}

      {ready && !signInNeeded && s.current?.updateRemovesVerification && can('update') && (
        <Notice>{pt('removesVerification')} <VerifyAgain dive={d} /></Notice>
      )}
      {verificationRemoved && !s.current?.updateRemovesVerification && (
        <Notice>{pt('removedVerification')} <VerifyAgain dive={d} /></Notice>
      )}
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
      </Disclosure>

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
    </section>
  );
}

/** Where the Dive's site has a centre with a code: the way to it, to verify the dive again (ADR 0043). */
function VerifyAgain({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  if (d.verificationCodes.length === 0) return null;
  return <Button variant="quiet" size="small" icon="code" onPress={showDiveCodes}>{t('centres.showCode', { count: d.verificationCodes.length })}</Button>;
}

/** A Provider's line when there is nothing to open: its name, and what there is to say beside it. */
function Line({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dive-line">
      <div className="dive-line-plain">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

/**
 * What the Provider needs and the Dive lacks (ADR 0029), each with its fix: a resolver per requirement type. A type
 * this client doesn't know shows the Provider's own description and that it can't be fixed here.
 */
function Requirements({ provider: p, dive: d, status: s }: { provider: ProviderView; dive: DiveView; status: ProviderStatusView }) {
  const pt = useProviderText(p);
  const names = useNames();
  const [picking, setPicking] = useState<RequirementView | null>(null);
  const [finding, setFinding] = useState<UnmetView | null>(null);
  if (s.unmet.length === 0) return null;
  const sites = s.unmet.filter((u) => u.type === 'site_external_id');
  const people = s.unmet.filter((u) => u.type === 'diver_mapping');
  const unknown = s.unmet.filter((u) => u.type !== 'site_external_id' && u.type !== 'diver_mapping');
  const canFindPeople = !!p.data.buddies?.import?.operations.includes('find') && !!s.connection;
  const canFindSites = !!p.data.diveSites?.import?.operations.includes('find') && !!s.connection;

  return (
    <div className="provider-needs">
      {sites.map((u) => {
        const r = requirementOf(p, u);
        if (!u.siteId || !d.site) return <Muted key={u.source}>{pt('needsSite')}</Muted>;
        return (
          <div className="form" key={u.source}>
            <Muted>{pt('needsSiteId', { site: d.site.name })}</Muted>
            {r?.typed && canFindSites
              ? <div className="form-actions"><Button icon="site" onPress={() => setPicking(r)}>{pt('chooseSite')}</Button></div>
              : !r?.typed && <Muted>{pt('cannotFixHere')}</Muted>}
          </div>
        );
      })}
      {people.length > 0 && (
        <div className="form">
          <Muted>{pt(people.some((u) => u.severity === 'blocking') ? 'peopleUnknownBlocking' : 'peopleUnknown', {
            names: names(people.map((u) => u.diverName ?? '')),
          })}</Muted>
          {canFindPeople && people.some((u) => u.fixes?.includes('diver_external_id')) && (
            <ul className="provider-people">
              {people.map((u) => (
                <li key={u.diverId}>
                  <Button icon="link" onPress={() => setFinding(u)}>{pt('findInList', { diver: u.diverName ?? '' })}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {unknown.map((u) => (
        <Muted key={`${u.type}-${u.source}`}>{requirementOf(p, u)?.description ?? u.type} {pt('cannotFixHere')}</Muted>
      ))}
      {picking && d.site && (
        <SitePicker provider={p} requirement={picking} diveId={d.id} diveSiteId={d.site.id} siteName={d.site.name} onClose={() => setPicking(null)} />
      )}
      {finding && s.connection && (
        <BuddyPicker provider={p} unmet={finding} connectionId={s.connection.id} diveId={d.id} onClose={() => setFinding(null)} />
      )}
    </div>
  );
}

/** Who the last Push couldn't carry, and why (ADR 0029). */
function LeftOut({ provider: p, push }: { provider: ProviderView; push: PushView }) {
  const pt = useProviderText(p);
  const names = useNames();
  const of = (reason: 'no_reference' | 'not_at_provider') => push.leftOut!.filter((l) => l.reason === reason).map((l) => l.name);
  return (
    <Notice tone="info">
      {of('no_reference').length > 0 && <p>{pt('leftOut.no_reference', { names: names(of('no_reference')) })}</p>}
      {of('not_at_provider').length > 0 && <p>{pt('leftOut.not_at_provider', { names: names(of('not_at_provider')) })}</p>}
    </Notice>
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
 * The `site_external_id` resolver: pick the Dive site's ID at the Provider from its sites (SSI: the sites in the User's
 * logbook), nearest first, narrowed while typing a name or an ID; or use an ID typed in. Picking saves at once on the
 * Dive site (ux-search).
 */
function SitePicker({ provider: p, requirement: r, diveId, diveSiteId, siteName, onClose }: {
  provider: ProviderView; requirement: RequirementView; diveId: string; diveSiteId: string; siteName: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const suggestions = useQuery(providerSitesQuery(diveId, p.id));
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: async (externalId: string) => unwrap(await api.PUT('/api/dive-sites/{id}/external-ids/{source}', {
      params: { path: { id: diveSiteId, source: r.source as 'ssi' } }, body: { externalId },
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
  const typedId = typedSiteId(r, query);
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
          label={pt('findOrType')} description={pt('siteIdHint')} query={text} onQueryChange={setText} autoFocus
          items={items} onPick={(id) => save.mutate(id === TYPED ? typedId! : id)} isPending={save.isPending} pendingStatus={t('sites.choosing')}
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

/**
 * The `diver_mapping` resolver: find the Participant in the account's own list of people at the Provider (SSI's buddy
 * list) and take that entry's account for the Diver (ADR 0029). Entries without an account, or already someone's
 * here, can't be picked.
 */
function BuddyPicker({ provider: p, unmet: u, connectionId, diveId, onClose }: {
  provider: ProviderView; unmet: UnmetView; connectionId: string; diveId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const buddies = useQuery(buddiesQuery(connectionId));
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: async (account: string) => unwrap(await api.PUT('/api/divers/{id}/external-ids/{source}', {
      params: { path: { id: u.diverId!, source: u.source as 'ssi' } }, body: { externalId: account },
    })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.diveProviders(diveId) });
      await queryClient.invalidateQueries({ queryKey: keys.buddies(connectionId) });
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      announce(pt('buddyLinked', { diver: u.diverName ?? '' }));
      onClose();
    },
  });

  const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const query = text.trim();
  const all = buddies.data ?? [];
  const matching = query ? all.filter((b) => fold(b.name).includes(fold(query))) : all;
  const pickable = matching.filter((b) => b.account && !b.diver);
  const items: SearchListItem[] = pickable.slice(0, SHOWN).map((b) => ({ id: b.account!, name: b.name }));
  const status = buddies.isPending ? t('common.loading')
    : pickable.length > SHOWN ? t('sites.showingFirst', { shown: SHOWN }) : null;
  const empty = buddies.isPending ? t('common.loading') : all.length === 0 ? pt('noBuddies') : pt('noBuddyMatch', { q: query });
  const taken = save.error instanceof ApiError && save.error.code === 'diver_external_id_taken' ? save.error.details.diver : undefined;

  return (
    <Dialog title={pt('findTitle', { diver: u.diverName ?? '' })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="provider-sites">
        <p>{pt('findIntro', { diver: u.diverName ?? '' })}</p>
        {buddies.error && <Notice tone="danger">{errorText(buddies.error)}</Notice>}
        <SearchList
          label={pt('findInListLabel')} query={text} onQueryChange={setText} autoFocus
          items={items} onPick={(account) => save.mutate(account)} isPending={save.isPending} pendingStatus={t('common.saving')}
          listLabel={pt('buddyList')} status={status} empty={empty}
        />
        {taken ? <Notice tone="danger">{pt('accountTaken', { diver: taken.name })}</Notice>
          : save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
        <Muted>{pt('notInList')}</Muted>
        <div className="form-actions">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
