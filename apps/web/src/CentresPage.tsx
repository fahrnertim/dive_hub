import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, centreQuery, centresQuery, keys, sitesQuery, unwrap, type CentreView, type DiveView, type SiteView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { usePageTitle } from './lib/page.ts';
import {
  ActionMenu, Button, ConfirmDialog, Dialog, Disclosure, Form, Icon, Muted, Notice, PageHeader, Panel, QrCode, SearchList, TextField,
  type SearchListItem,
} from './ui/index.ts';

/** Results shown at most in a picker; typing narrows them down. */
const SHOWN = 10;

/** The centre's SSI centre number, if it has one. */
const ssiNumber = (c: CentreView) => c.externalIds.find((e) => e.source === 'ssi')?.externalId;

/** What changes a centre changes the codes Dives show (ADR 0043). */
function useCentreRefresh() {
  const queryClient = useQueryClient();
  return async (updated?: CentreView) => {
    if (updated) queryClient.setQueryData(keys.centre(updated.id), updated);
    await queryClient.invalidateQueries({ queryKey: keys.centres });
    await queryClient.invalidateQueries({ queryKey: keys.dives });
  };
}

function useDebounced(text: string) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  return q;
}

/** "Another centre already has this number", with the way to it. */
function TakenNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  if (!error) return null;
  const centre = error instanceof ApiError ? error.details.centre : undefined;
  return (
    <Notice tone="danger">
      {errorText(error)}{centre && <> <a href={`#/centres/${centre.id}`}>{t('centres.open', { name: centre.name })}</a></>}
    </Notice>
  );
}

/** A code drawn for scanning, with the centre it belongs to named beside it. */
function CodeFigure({ name, text, children }: { name: string; text: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <figure className="code-figure">
      <QrCode text={text} label={t('centres.codeOf', { name })} />
      <figcaption>
        <strong translate="no">{name}</strong>
        <span>{t('centres.codeCaption')}</span>
        {children}
      </figcaption>
    </figure>
  );
}

/** The Dive centres of the instance (ADR 0043): every User sees, creates and edits them. */
export function CentresPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  usePageTitle(t('centres.title'));
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const centres = useQuery(centresQuery({ q }));
  const [creating, setCreating] = useState(false);
  const rows = centres.data?.centres ?? [];

  return (
    <>
      <PageHeader
        title={t('centres.title')} lead={t('centres.intro')}
        actions={!creating && <Button variant="primary" icon="add" onPress={() => setCreating(true)}>{t('centres.new')}</Button>}
      />
      {creating && (
        <Panel title={t('centres.new')}>
          <NewCentre onCancel={() => setCreating(false)} onCreated={(c) => { announce(t('centres.created', { name: c.displayName })); location.hash = `/centres/${c.id}`; }} />
        </Panel>
      )}
      <Panel>
        <TextField label={t('centres.search')} name="q" type="search" autoComplete="off" value={text} onChange={setText} />
        {centres.isPending && <Muted>{t('common.loading')}</Muted>}
        {centres.error && <Notice tone="danger">{errorText(centres.error)}</Notice>}
        {centres.data && rows.length === 0 && <Muted>{q ? t('centres.noMatch', { q }) : t('centres.empty')}</Muted>}
        {rows.length > 0 && (
          <ul className="diver-list centre-list">
            {rows.map((c) => (
              <li key={c.id} className="diver-row">
                <a href={`#/centres/${c.id}`} className="diver-name" translate="no">{c.displayName}</a>
                <span className="meta">
                  {[ssiNumber(c) ? t('centres.hasCode') : t('centres.noCodeShort'), t('centres.siteCount', { count: c.sites.length })].join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/**
 * A new centre: typed, or from the text of its SSI code, which the server reads (the format is the server's, ADR 0043).
 * `siteId`: the Dive site it is created for, linked in the same step.
 */
export function NewCentre({ siteId, onCreated, onCancel }: { siteId?: string; onCreated: (centre: CentreView) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useCentreRefresh();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [other, setOther] = useState<'buddy' | 'professional' | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const read = useMutation({
    mutationFn: async (text: string) => unwrap(await api.POST('/api/verification-codes/read', { body: { text } })),
    onMutate: () => { setOther(null); setExisting(null); },
    onSuccess: (found) => {
      if (found.kind !== 'centre') { setOther(found.kind); return; }
      setName(found.name);
      setNumber(found.centreNumber);
      setExisting(found.existing);
      announce(t('centres.codeRead', { name: found.name }));
    },
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/dive-centres', {
      body: {
        name: name.trim(),
        ...(number.trim() && { externalIds: [{ source: 'ssi' as const, externalId: number.trim() }] }),
        ...(siteId && { siteIds: [siteId] }),
      },
    })),
    onSuccess: async (created) => { await refresh(created); onCreated(created); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="form">
      <Form className="form" onSubmit={(e) => { e.preventDefault(); if (code.trim()) read.mutate(code.trim()); }}>
        <TextField
          label={t('centres.pasteCode')} description={t('centres.pasteCodeHint')} name="code" maxLength={1000} autoComplete="off" spellCheck="false"
          value={code} onChange={setCode}
        />
        <div className="form-actions">
          <Button type="submit" icon="code" isPending={read.isPending} isDisabled={!code.trim()}>{t('centres.readCode')}</Button>
        </div>
        {read.error && <Notice tone="danger">{errorText(read.error)}</Notice>}
        {other && <Notice tone="danger">{t(`centres.otherCode.${other}`)}</Notice>}
        {existing && <Notice>{t('centres.alreadyHere', { name: existing.name })} <a href={`#/centres/${existing.id}`}>{t('centres.open', { name: existing.name })}</a></Notice>}
      </Form>
      <Form className="form" onSubmit={submit}>
        <TextField label={t('centres.name')} description={t('centres.nameHint')} name="name" isRequired maxLength={200} autoComplete="off" value={name} onChange={setName} />
        <TextField
          label={t('centres.ssiNumberOptional')} description={t('centres.ssiNumberHint')} name="ssiNumber" inputMode="numeric" pattern="[0-9]*"
          maxLength={10} autoComplete="off" value={number} onChange={setNumber}
        />
        <TakenNotice error={create.error} />
        <div className="form-actions">
          <Button type="submit" variant="primary" icon="add" isPending={create.isPending}>{t('centres.create')}</Button>
          <Button onPress={onCancel}>{t('common.cancel')}</Button>
        </div>
      </Form>
    </div>
  );
}

/** One Dive centre: its code, its SSI centre number and the Dive sites it is responsible for. */
export function CentrePage({ id }: { id: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const refresh = useCentreRefresh();
  const centre = useQuery(centreQuery(id));
  const [editing, setEditing] = useState<'name' | 'number' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  // When editing ends (saved or cancelled), focus goes back to the button that started it.
  const renameButton = useRef<HTMLButtonElement>(null);
  const numberButton = useRef<HTMLButtonElement>(null);
  const was = useRef<typeof editing>(null);
  useEffect(() => {
    if (was.current && !editing) (was.current === 'name' ? renameButton : numberButton).current?.focus();
    was.current = editing;
  }, [editing]);
  const notFound = centre.error instanceof ApiError && centre.error.status === 404;
  usePageTitle(centre.data?.displayName ?? (notFound ? t('centres.notFound') : undefined));

  const rename = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/api/dive-centres/{id}', { params: { path: { id } }, body: { version: centre.data!.version, name: name.trim() } })),
    onSuccess: async (updated) => { await refresh(updated); setEditing(null); announce(t('centres.saved')); },
  });
  const setSsi = useMutation({
    mutationFn: async () => unwrap(await api.PUT('/api/dive-centres/{id}/external-ids/{source}', {
      params: { path: { id, source: 'ssi' } }, body: { externalId: number.trim() || null },
    })),
    onSuccess: async (updated) => { await refresh(updated); setEditing(null); announce(t('centres.saved')); },
  });
  const unlink = useMutation({
    mutationFn: async (siteId: string) => unwrap(await api.DELETE('/api/dive-centres/{id}/sites/{siteId}', { params: { path: { id, siteId } } })),
    onSuccess: async (updated) => { await refresh(updated); announce(t('centres.siteRemoved')); },
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dive-centres/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.centre(id) });
      await refresh();
    },
  });

  const back = <p><a href="#/centres" className="back-link"><Icon name="back" />{t('centres.back')}</a></p>;
  if (centre.isPending) return <Muted>{t('common.loading')}</Muted>;
  if (notFound) {
    return (
      <>
        <PageHeader title={t('centres.notFound')} />
        <Panel>
          <div className="empty-state">
            <p>{errorText(centre.error)}</p>
            <a href="#/centres" className="btn btn-secondary"><Icon name="back" />{t('centres.backToCentres')}</a>
          </div>
        </Panel>
      </>
    );
  }
  if (centre.error) return <>{back}<Notice tone="danger">{errorText(centre.error)}</Notice></>;
  const c = centre.data;
  const ssi = ssiNumber(c);

  return (
    <>
      {back}
      <PageHeader
        title={<span translate="no">{c.displayName}</span>}
        actions={editing !== 'name' && (
          <>
            <Button ref={renameButton} icon="edit" onPress={() => { setName(c.name); setEditing('name'); }}>{t('centres.rename')}</Button>
            {c.canDelete && (
              <ActionMenu
                label={t('centres.moreActions')} aria-label={t('common.forItem', { action: t('centres.moreActions'), item: c.displayName })}
                actions={[{ id: 'delete', label: t('centres.delete'), icon: 'delete', onAction: () => setDeleting(true) }]}
              />
            )}
          </>
        )}
      />
      <Panel>
        {editing === 'name' && (
          <Form className="form" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
            <TextField label={t('centres.name')} description={t('centres.nameHint')} name="name" isRequired maxLength={200} autoComplete="off" autoFocus value={name} onChange={setName} />
            {rename.error && <Notice tone="danger">{errorText(rename.error)}</Notice>}
            <div className="form-actions">
              <Button type="submit" variant="primary" icon="save" isPending={rename.isPending}>{t('centres.save')}</Button>
              <Button onPress={() => setEditing(null)}>{t('common.cancel')}</Button>
            </div>
          </Form>
        )}
        {c.verificationCode
          ? <CodeFigure name={c.displayName} text={c.verificationCode.text}><span>{t('centres.codeUse')}</span></CodeFigure>
          : <Muted>{t('centres.noCode')}</Muted>}
        {editing === 'number' ? (
          <Form className="form" onSubmit={(e) => { e.preventDefault(); setSsi.mutate(); }}>
            <TextField
              label={t('centres.ssiNumber')} description={t('centres.ssiNumberEditHint')} name="ssiNumber" maxLength={300} autoComplete="off" autoFocus
              value={number} onChange={setNumber}
            />
            <TakenNotice error={setSsi.error} />
            <div className="form-actions">
              <Button type="submit" variant="primary" icon="save" isPending={setSsi.isPending}>{t('centres.save')}</Button>
              <Button onPress={() => setEditing(null)}>{t('common.cancel')}</Button>
            </div>
          </Form>
        ) : (
          <dl className="facts">
            {/* The whole name, as the code holds it; the page's title is the display name (the API's rule per Source). */}
            {c.name !== c.displayName && (
              <div className="fact-wide">
                <dt>{t('centres.fullName')}</dt>
                <dd translate="no">{c.name}</dd>
              </div>
            )}
            <div className="fact-wide">
              <dt>{t('centres.ssiNumber')}</dt>
              <dd>
                <span translate="no">{ssi ?? t('centres.notSet')}</span>{' '}
                <Button ref={numberButton} variant="quiet" size="small" aria-label={t('common.forItem', { action: ssi ? t('centres.change') : t('centres.add'), item: t('centres.ssiNumber') })}
                  onPress={() => { setNumber(ssi ?? ''); setSsi.reset(); setEditing('number'); }}>
                  {ssi ? t('centres.change') : t('centres.add')}
                </Button>
              </dd>
            </div>
          </dl>
        )}
        <Muted>{t('centres.sharedHint')}</Muted>
      </Panel>
      <Panel title={t('centres.sites')} actions={<Button icon="add" onPress={() => setAdding(true)}>{t('centres.addSite')}</Button>}>
        <Muted>{t('centres.sitesIntro')}</Muted>
        {c.sites.length === 0 && <Muted>{t('centres.noSites')}</Muted>}
        {c.sites.length > 0 && (
          <ul className="diver-list">
            {c.sites.map((s) => (
              <li key={s.id} className="diver-row">
                <a href={`#/sites/${s.id}`} className="diver-name">{s.name}</a>
                <span className="actions">
                  <Button variant="quiet" aria-label={t('common.forItem', { action: t('centres.removeSite'), item: s.name })}
                    isPending={unlink.isPending && unlink.variables === s.id} isDisabled={unlink.isPending} onPress={() => unlink.mutate(s.id)}>
                    {t('centres.removeSite')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {unlink.error && <Notice tone="danger">{errorText(unlink.error)}</Notice>}
      </Panel>
      {adding && <AddSiteDialog centre={c} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        isOpen={deleting} onOpenChange={setDeleting}
        title={t('centres.deleteTitle')} body={t('centres.deleteBody')} confirmLabel={t('centres.deleteConfirm')}
        onConfirm={() => remove.mutateAsync()}
        onDone={() => { announce(t('centres.deleted', { name: c.displayName })); location.hash = '/centres'; }}
      />
    </>
  );
}

/** Picks a Dive site the centre is responsible for, by words of its name. */
function AddSiteDialog({ centre: c, onClose }: { centre: CentreView; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useCentreRefresh();
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const found = useQuery(sitesQuery({ q }));
  const link = useMutation({
    mutationFn: async (siteId: string) => unwrap(await api.PUT('/api/dive-centres/{id}/sites/{siteId}', { params: { path: { id: c.id, siteId } } })),
    onSuccess: async (updated, siteId) => {
      await refresh(updated);
      announce(t('centres.siteAdded', { name: updated.sites.find((s) => s.id === siteId)?.name ?? '' }));
      onClose();
    },
  });
  const linked = new Set(c.sites.map((s) => s.id));
  const sites: SiteView[] = (found.data?.sites ?? []).filter((s) => !linked.has(s.id));
  const items: SearchListItem[] = sites.slice(0, SHOWN).map((s) => ({ id: s.id, name: s.name, detail: s.waterBody ?? undefined }));
  return (
    <Dialog title={t('centres.addSiteTitle', { name: c.displayName })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="form">
        <SearchList
          label={t('sites.find')} query={text} onQueryChange={setText} autoFocus items={items} onPick={(siteId) => link.mutate(siteId)}
          isPending={link.isPending} pendingStatus={t('common.saving')} listLabel={t('centres.sites')}
          status={found.isPending ? t('sites.searching') : null}
          empty={q ? t('sites.noMatch', { q }) : t('centres.noSitesToAdd')}
        />
        {link.error && <Notice tone="danger">{errorText(link.error)}</Notice>}
        <div className="form-actions"><Button onPress={onClose}>{t('common.cancel')}</Button></div>
      </div>
    </Dialog>
  );
}

/** On a Dive site's page: the Dive centres responsible for it (ADR 0043). Any User sets them, here or on the centre. */
export function SiteCentres({ site }: { site: SiteView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useCentreRefresh();
  const centres = useQuery(centresQuery({ siteId: site.id }));
  const [adding, setAdding] = useState(false);
  const unlink = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/api/dive-centres/{id}/sites/{siteId}', { params: { path: { id, siteId: site.id } } })),
    onSuccess: async (updated) => { await refresh(updated); announce(t('centres.centreRemoved', { name: updated.displayName })); },
  });
  const rows = centres.data?.centres ?? [];
  return (
    <Panel title={t('centres.title')} actions={<Button icon="add" onPress={() => setAdding(true)}>{t('centres.addCentre')}</Button>}>
      <Muted>{t('centres.atSiteIntro')}</Muted>
      {centres.error && <Notice tone="danger">{errorText(centres.error)}</Notice>}
      {centres.data && rows.length === 0 && <Muted>{t('centres.noneAtSite')}</Muted>}
      {rows.length > 0 && (
        <ul className="diver-list">
          {rows.map((c) => (
            <li key={c.id} className="diver-row">
              <a href={`#/centres/${c.id}`} className="diver-name" translate="no">{c.displayName}</a>
              <span className="meta">{ssiNumber(c) ? t('centres.hasCode') : t('centres.noCodeShort')}</span>
              <span className="actions">
                <Button variant="quiet" aria-label={t('common.forItem', { action: t('centres.removeCentre'), item: c.displayName })}
                  isPending={unlink.isPending && unlink.variables === c.id} isDisabled={unlink.isPending} onPress={() => unlink.mutate(c.id)}>
                  {t('centres.removeCentre')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {unlink.error && <Notice tone="danger">{errorText(unlink.error)}</Notice>}
      {adding && <AddCentreDialog site={site} linked={rows} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

/** Picks a centre for the site by name, or makes a new one for it. */
function AddCentreDialog({ site, linked, onClose }: { site: SiteView; linked: CentreView[]; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useCentreRefresh();
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const [creating, setCreating] = useState(false);
  const found = useQuery(centresQuery({ q }));
  const link = useMutation({
    mutationFn: async (id: string) => unwrap(await api.PUT('/api/dive-centres/{id}/sites/{siteId}', { params: { path: { id, siteId: site.id } } })),
    onSuccess: async (updated) => { await refresh(updated); announce(t('centres.centreAdded', { name: updated.displayName })); onClose(); },
  });
  const has = new Set(linked.map((c) => c.id));
  const items: SearchListItem[] = (found.data?.centres ?? []).filter((c) => !has.has(c.id)).slice(0, SHOWN)
    .map((c) => ({ id: c.id, name: c.displayName, detail: ssiNumber(c) ? t('centres.hasCode') : t('centres.noCodeShort') }));
  return (
    <Dialog title={t('centres.addCentreTitle', { name: site.name })} isOpen onOpenChange={(open) => !open && onClose()}>
      {creating ? (
        <NewCentre siteId={site.id} onCancel={() => setCreating(false)} onCreated={(c) => { announce(t('centres.centreAdded', { name: c.displayName })); onClose(); }} />
      ) : (
        <div className="form">
          <SearchList
            label={t('centres.search')} query={text} onQueryChange={setText} autoFocus items={items} onPick={(id) => link.mutate(id)}
            listLabel={t('centres.title')} status={found.isPending ? t('common.loading') : null}
            empty={q ? t('centres.noMatch', { q }) : t('centres.noneToAdd')}
            isPending={link.isPending} pendingStatus={t('common.saving')}
          />
          {link.error && <Notice tone="danger">{errorText(link.error)}</Notice>}
          <div className="form-actions">
            <Button icon="add" isDisabled={link.isPending} onPress={() => setCreating(true)}>{t('centres.new')}</Button>
            <Button onPress={onClose}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** The element the "Send update" card points to (ADR 0043). */
export const DIVE_CODES_ID = 'verification-codes';

/**
 * On a Dive: the verification codes of the centres of its site (ADR 0043), one line until opened. Shown whenever the
 * API gives any: to verify the dive at SSI, or to show to the others who were on it.
 */
export function DiveCodes({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  // Opened by the User, or from outside (the "Send update" card points here).
  const [open, setOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const show = () => { setOpen(true); section.current?.scrollIntoView({ block: 'nearest' }); };
    const node = section.current;
    node?.addEventListener('show-codes', show);
    return () => node?.removeEventListener('show-codes', show);
  }, [d.verificationCodes.length]);
  if (d.verificationCodes.length === 0) return null;
  return (
    <section className="dive-line" id={DIVE_CODES_ID} ref={section}>
      <Disclosure
        level={2} title={t('centres.diveCodes')} isExpanded={open} onExpandedChange={setOpen}
        summary={<p className="provider-state" translate="no">{d.verificationCodes.map((v) => v.centre.displayName).join(', ')}</p>}
      >
        <div className="code-figures">
          {d.verificationCodes.map((v) => (
            <CodeFigure key={v.centre.id} name={v.centre.displayName} text={v.text}>
              <a href={`#/centres/${v.centre.id}`}>{t('centres.toCentre')}</a>
            </CodeFigure>
          ))}
        </div>
        <Muted>{t('centres.diveCodesHint')}</Muted>
      </Disclosure>
    </section>
  );
}

/** Opens the Dive's codes and brings them into view. */
export function showDiveCodes() {
  document.getElementById(DIVE_CODES_ID)?.dispatchEvent(new Event('show-codes'));
}
