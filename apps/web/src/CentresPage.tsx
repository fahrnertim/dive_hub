import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, centreQuery, centresQuery, keys, sitesQuery, unwrap, type CentreView, type SiteView } from './api.ts';
import { CodeScanner } from './CodeScanner.tsx';
import { CodeFigure } from './DiveCodes.tsx';
import { announce } from './lib/announce.ts';
import { ssiNumber, useCentreRefresh, useDebounced } from './lib/centres.ts';
import { useErrorText } from './lib/display.ts';
import { usePageTitle } from './lib/page.ts';
import { NewCentre, TakenNotice } from './NewCentre.tsx';
import {
  ActionMenu, BackLink, Button, ConfirmDialog, Dialog, Form, Muted, NotFoundPage, Notice, PageHeader, Panel, SEARCH_SHOWN, SearchList, TextField,
  type SearchListItem,
} from './ui/index.ts';

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
  // A scanned code gives the number; the server says whether it is a centre's code at all.
  const scan = useMutation({
    mutationFn: async (text: string) => unwrap(await api.POST('/api/verification-codes/read', { body: { text } })),
    onSuccess: (found) => { if (found.kind === 'centre') setNumber(found.centreNumber); },
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

  const back = { href: '#/centres', label: t('centres.back') };
  if (centre.isPending) return <Muted>{t('common.loading')}</Muted>;
  if (notFound) return <NotFoundPage title={t('centres.notFound')} message={errorText(centre.error)} back={{ href: '#/centres', label: t('centres.backToCentres') }} />;
  if (centre.error) return <><BackLink {...back} /><Notice tone="danger">{errorText(centre.error)}</Notice></>;
  const c = centre.data;
  const ssi = ssiNumber(c);

  return (
    <>
      <PageHeader
        back={back}
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
            <CodeScanner onText={(text) => scan.mutate(text)}>
              <Button type="submit" variant="primary" icon="save" isPending={setSsi.isPending}>{t('centres.save')}</Button>
              <Button onPress={() => setEditing(null)}>{t('common.cancel')}</Button>
            </CodeScanner>
            {scan.error && <Notice tone="danger">{errorText(scan.error)}</Notice>}
            {scan.data && scan.data.kind !== 'centre' && <Notice tone="danger">{t(`centres.otherCode.${scan.data.kind}`)}</Notice>}
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
                  onPress={() => { setNumber(ssi ?? ''); setSsi.reset(); scan.reset(); setEditing('number'); }}>
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
  const items: SearchListItem[] = sites.slice(0, SEARCH_SHOWN).map((s) => ({ id: s.id, name: s.name, detail: s.waterBody ?? undefined }));
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
