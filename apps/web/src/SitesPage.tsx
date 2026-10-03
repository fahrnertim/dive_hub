import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, keys, siteQuery, sitesQuery, unwrap, type SiteView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { mapsUrl } from './lib/geo.ts';
import { logbookHref } from './lib/logbook.ts';
import { usePageTitle } from './lib/page.ts';
import { SiteForm } from './SiteForm.tsx';
import { ActionMenu, Button, ConfirmDialog, Icon, Muted, Notice, PageHeader, Panel, Table, TextField } from './ui/index.ts';

/** "Egypt · Red Sea": where a site is, in words. */
function useSitePlace() {
  const display = useDisplay();
  return (s: Pick<SiteView, 'country' | 'waterBody'>) =>
    [s.country && display.country(s.country), s.waterBody].filter(Boolean).join(' · ');
}

/** The instance's Dive sites (ADR 0020): searchable, and new ones created here. */
export function SitesPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const place = useSitePlace();
  usePageTitle(t('sites.title'));
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const sites = useQuery(sitesQuery({ q: q || undefined }));
  const any = useQuery(sitesQuery());
  const newButton = useRef<HTMLButtonElement>(null);
  const close = () => { setCreating(false); requestAnimationFrame(() => newButton.current?.focus()); };

  return (
    <>
      <PageHeader
        title={t('sites.title')}
        lead={t('sites.intro')}
        actions={!creating && <Button ref={newButton} variant="primary" icon="add" onPress={() => setCreating(true)}>{t('sites.new')}</Button>}
      />
      {creating && (
        <Panel title={t('sites.new')}>
          <SiteForm
            initial={{ name: text.trim() }}
            submitLabel={t('sites.create')}
            onSaved={(site) => { location.hash = `/sites/${site.id}`; }}
            onCancel={close}
          />
        </Panel>
      )}
      <Panel>
        {/* A search field only when there is something to search (page rules). */}
        {(any.data?.length ?? 0) > 0 && (
          <div className="logbook-search">
            <TextField label={t('sites.search')} description={t('sites.searchHint')} type="search" value={text} onChange={setText} autoComplete="off" />
          </div>
        )}
        {sites.isPending && <Muted>{t('common.loading')}</Muted>}
        {sites.error && <Notice tone="danger">{errorText(sites.error)}</Notice>}
        {sites.data?.length === 0 && <Muted>{q ? t('sites.noMatch', { q }) : t('sites.empty')}</Muted>}
        {sites.data && sites.data.length > 0 && (
          <Table
            stacked
            label={t('sites.title')}
            head={[t('sites.name'), t('sites.where'), { label: t('sites.yourDives'), numeric: true }]}
          >
            {sites.data.map((s) => (
              <tr key={s.id}>
                <td className="cell-main"><a href={`#/sites/${s.id}`}>{s.name}</a></td>
                <td className="cell-sub">{place(s) || t('common.none')}</td>
                <td className="num cell-sub">{t('sites.dives', { count: s.diveCount })}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/** One Dive site: where it is, the User's dives there; anyone edits, its creator or an admin deletes. */
export function SitePage({ id }: { id: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const place = useSitePlace();
  const queryClient = useQueryClient();
  const site = useQuery(siteQuery(id));
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const notFound = site.error instanceof ApiError && site.error.status === 404;
  usePageTitle(site.data?.name ?? (notFound ? t('sites.notFound') : undefined));
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/dive-sites/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.site(id) });
      await queryClient.invalidateQueries({ queryKey: keys.sites });
    },
  });

  const back = <p><a href="#/sites" className="back-link"><Icon name="back" />{t('sites.back')}</a></p>;
  if (site.isPending) return <Muted>{t('common.loading')}</Muted>;
  if (notFound) {
    return (
      <>
        <PageHeader title={t('sites.notFound')} />
        <Panel>
          <div className="empty-state">
            <p>{errorText(site.error)}</p>
            <a href="#/sites" className="btn btn-secondary"><Icon name="back" />{t('sites.backToSites')}</a>
          </div>
        </Panel>
      </>
    );
  }
  if (site.error) return <>{back}<Notice tone="danger">{errorText(site.error)}</Notice></>;
  const s = site.data;
  const deletable = s.canDelete && !s.inUse;

  return (
    <>
      {back}
      <PageHeader
        title={s.name}
        meta={place(s) && <p className="title-meta">{place(s)}</p>}
        actions={!editing && (
          <>
            <Button ref={editButton} icon="edit" onPress={() => setEditing(true)}>{t('sites.edit')}</Button>
            {deletable && (
              <ActionMenu
                label={t('sites.moreActions')} aria-label={t('common.forItem', { action: t('sites.moreActions'), item: s.name })}
                actions={[{ id: 'delete', label: t('sites.delete'), icon: 'delete', onAction: () => setDeleting(true) }]}
              />
            )}
          </>
        )}
      />
      <Panel>
        {editing ? (
          <SiteForm
            key={s.version}
            site={s}
            submitLabel={t('sites.save')}
            onSaved={() => { setEditing(false); announce(t('sites.saved')); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <dl className="facts">
              <div className="fact-wide">
                <dt>{t('sites.position')}</dt>
                <dd>
                  {s.position ? (
                    <>
                      {display.position(s.position)}{' '}
                      <a href={mapsUrl(s.position)} target="_blank" rel="noopener noreferrer" className="external-link">
                        {t('sites.openInMaps')}<Icon name="external" />
                      </a>
                    </>
                  ) : t('sites.noPosition')}
                </dd>
              </div>
              <div>
                <dt>{t('sites.yourDives')}</dt>
                <dd>
                  {s.diveCount > 0
                    ? <a href={logbookHref({ siteId: s.id })}>{t('sites.dives', { count: s.diveCount })}</a>
                    : t('sites.noDivesYet')}
                </dd>
              </div>
            </dl>
            <h2 className="subheading">{t('sites.description')}</h2>
            {s.description ? <p className="notes">{s.description}</p> : <Muted>{t('sites.noDescription')}</Muted>}
            <Muted>{t('sites.sharedHint')}</Muted>
            {s.canDelete && s.inUse && <Muted>{t('sites.inUse')}</Muted>}
          </>
        )}
      </Panel>
      <ConfirmDialog
        isOpen={deleting} onOpenChange={setDeleting}
        title={t('sites.deleteTitle')} body={t('sites.deleteBody')} confirmLabel={t('sites.deleteConfirm')}
        onConfirm={() => remove.mutateAsync()}
        onDone={() => { announce(t('sites.deleted', { name: s.name })); location.hash = '/sites'; }}
      />
    </>
  );
}
