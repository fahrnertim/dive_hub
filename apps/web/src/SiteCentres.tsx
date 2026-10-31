import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, centresQuery, unwrap, type CentreView, type SiteView } from './api.ts';
import { announce } from './lib/announce.ts';
import { ssiNumber, useCentreRefresh, useDebounced } from './lib/centres.ts';
import { useErrorText } from './lib/display.ts';
import { NewCentre } from './NewCentre.tsx';
import { Button, Dialog, Muted, Notice, Panel, SEARCH_SHOWN, SearchList, type SearchListItem } from './ui/index.ts';

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
  const items: SearchListItem[] = (found.data?.centres ?? []).filter((c) => !has.has(c.id)).slice(0, SEARCH_SHOWN)
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
