import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, keys, sitesQuery, unwrap, type DiveView, type SiteView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { SiteForm } from './SiteForm.tsx';
import { Badge, Button, Dialog, Notice, SearchList, type SearchListItem } from './ui/index.ts';

/** Results shown at most, without scrolling (ux-search); typing narrows them down. */
const SHOWN = 10;
/** The row that makes a new site from what was typed, where nothing matches (no dead end). */
const NEW = '__new__';
/** Sites within this distance of the dive's position are offered first (ADR 0020). */
const NEARBY_M = 2000;

/**
 * Chooses the Dive's site (ADR 0020): a search field with the results under it, updated while typing. Before
 * typing, the sites near the dive's position, nearest first; then the sites matching the words. Picking one saves
 * it at once (with the Dive's version); "Remove dive site" clears it; a new site is made from the dive's position.
 */
export function SitePicker({ dive: d, onClose }: { dive: DiveView; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const [creating, setCreating] = useState(false);
  const nearby = useQuery({ ...sitesQuery({ near: d.position ?? undefined }), enabled: !!d.position && !q });
  const found = useQuery({ ...sitesQuery({ q }), enabled: !!q || !d.position });
  const results = q || !d.position ? found : nearby;
  const sites: SiteView[] = results.data?.sites ?? [];
  const total = results.data?.total ?? 0;

  const choose = useMutation({
    mutationFn: async (siteId: string | null) =>
      unwrap(await api.PATCH('/api/dives/{id}', { params: { path: { id: d.id } }, body: { version: d.version, siteId } })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.dive(d.id), updated);
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      await queryClient.invalidateQueries({ queryKey: keys.sites });
      await queryClient.invalidateQueries({ queryKey: keys.revisions(d.id) });
      announce(updated.site ? t('sites.chosen', { name: updated.site.name }) : t('sites.cleared'));
      onClose();
    },
  });

  const detail = (s: SiteView) => [
    s.distanceM !== undefined ? t('sites.away', { distance: display.distance(s.distanceM) }) : null,
    s.country ? display.country(s.country) : null,
    s.waterBody,
  ].filter(Boolean).join(' · ');
  const items: SearchListItem[] = sites.slice(0, SHOWN).map((s) => ({
    id: s.id, name: s.name, detail: detail(s) || undefined,
    ...(s.id === d.site?.id && { badge: <Badge>{t('sites.current')}</Badge> }),
  }));
  // The current site stays in view, so the User sees what is chosen.
  if (d.site && !q && !items.some((i) => i.id === d.site!.id)) {
    items.unshift({ id: d.site.id, name: d.site.name, badge: <Badge>{t('sites.current')}</Badge> });
  }
  // Nothing matches what was typed: offer to make it, with the name filled in.
  const searching = results.isFetching && results.isPlaceholderData;
  if (q && results.data && total === 0 && !searching) items.push({ id: NEW, name: t('sites.createNamed', { name: q }) });

  const status = (q || !d.position) && !results.data ? t('sites.searching')
    : q ? [
      total === 0 ? t('sites.noMatch', { q }) : t('sites.matchCount', { count: total, q }),
      total > SHOWN ? t('sites.showingFirst', { shown: SHOWN }) : null,
    ].filter(Boolean).join(' ')
    : d.position ? (total === 0 ? t('sites.noneNearby', { distance: display.distance(NEARBY_M) }) : t('sites.nearbyFirst'))
    : total > SHOWN ? `${t('sites.allByName')} ${t('sites.showingFirst', { shown: SHOWN })}` : t('sites.allByName');

  const pick = (id: string) => {
    if (id === NEW) { setCreating(true); return; }
    if (id === d.site?.id) { onClose(); return; }
    choose.mutate(id);
  };

  return (
    <Dialog title={t('sites.pickerTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      {creating ? (
        <SiteForm
          initial={{ name: text.trim(), position: d.position }}
          submitLabel={t('sites.createAndChoose')}
          onSaved={(site) => choose.mutate(site.id)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div className="form">
          <SearchList
            label={t('sites.find')} query={text} onQueryChange={setText} autoFocus
            items={items} onPick={pick} isPending={choose.isPending} pendingStatus={t('sites.choosing')}
            listLabel={q ? t('sites.matching', { q }) : d.position ? t('sites.nearby') : t('sites.all')}
            status={searching ? t('sites.searching') : status}
          />
          {choose.error && <Notice tone="danger">{errorText(choose.error)}</Notice>}
          <div className="form-actions">
            <Button icon="add" isDisabled={choose.isPending} onPress={() => setCreating(true)}>{t('sites.new')}</Button>
            {d.site && <Button isPending={choose.isPending && choose.variables === null} isDisabled={choose.isPending} onPress={() => choose.mutate(null)}>{t('sites.removeSite')}</Button>}
            <Button isDisabled={choose.isPending} onPress={onClose}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
      {creating && choose.error && <Notice tone="danger">{errorText(choose.error)}</Notice>}
    </Dialog>
  );
}
