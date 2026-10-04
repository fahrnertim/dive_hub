import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, keys, sitesQuery, unwrap, type DiveView, type SiteView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { SiteForm } from './SiteForm.tsx';
import { Button, Dialog, Muted, Notice, RadioGroup, TextField } from './ui/index.ts';

const NONE = 'none';
/** Sites listed at most; searching narrows it down. */
const SHOWN = 12;

/**
 * Chooses the Dive's site (ADR 0020): the sites near the dive's position, nearest first, or any site
 * found by name; or a new site, made from the dive's position. Saves with the Dive's version.
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
  const [chosen, setChosen] = useState<string>(d.site?.id ?? NONE);
  const [creating, setCreating] = useState(false);
  const nearby = useQuery({ ...sitesQuery({ near: d.position ?? undefined }), enabled: !!d.position && !q });
  const found = useQuery({ ...sitesQuery({ q }), enabled: !!q || !d.position });
  const list: SiteView[] = (q || !d.position ? found.data?.sites : nearby.data?.sites) ?? [];

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

  // The current site stays in the list, so the User sees what is chosen.
  const shown = list.slice(0, SHOWN);
  if (d.site && !shown.some((s) => s.id === d.site!.id)) shown.unshift({ id: d.site.id, name: d.site.name } as SiteView);
  const label = (s: SiteView) => (s.distanceM !== undefined ? t('sites.optionAway', { name: s.name, distance: display.distance(s.distanceM) }) : s.name);
  const heading = q ? t('sites.matching', { q }) : d.position ? t('sites.nearby') : t('sites.all');
  const empty = !q && d.position && nearby.data?.total === 0;

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
          <TextField label={t('sites.find')} type="search" value={text} onChange={setText} autoComplete="off" />
          {empty && <Muted>{t('sites.noneNearby', { distance: display.distance(2000) })}</Muted>}
          {q && found.data?.total === 0 && <Muted>{t('sites.noMatch', { q })}</Muted>}
          <RadioGroup
            label={heading}
            value={chosen}
            onChange={setChosen}
            options={[{ value: NONE, label: t('sites.none') }, ...shown.map((s) => ({ value: s.id, label: label(s) }))]}
          />
          {choose.error && <Notice tone="danger">{errorText(choose.error)}</Notice>}
          <div className="form-actions">
            <Button variant="primary" isPending={choose.isPending} onPress={() => choose.mutate(chosen === NONE ? null : chosen)}>{t('sites.choose')}</Button>
            <Button icon="add" isDisabled={choose.isPending} onPress={() => setCreating(true)}>{t('sites.new')}</Button>
            <Button isDisabled={choose.isPending} onPress={onClose}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
      {creating && choose.error && <Notice tone="danger">{errorText(choose.error)}</Notice>}
    </Dialog>
  );
}
