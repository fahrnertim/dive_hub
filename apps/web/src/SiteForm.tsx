import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, keys, unwrap, type Position, type SiteView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { countryOptions } from './lib/geo.ts';
import { releaseLeaveGuard, useLeaveGuard } from './lib/leave-guard.ts';
import { Button, Form, Muted, Notice, NumberField, Select, TextArea, TextField } from './ui/index.ts';

const NO_COUNTRY = 'none';

interface Draft {
  name: string;
  country: string | null;
  waterBody: string;
  latitude: number;
  longitude: number;
  description: string;
}

const draftOf = (s: Partial<SiteView>): Draft => ({
  name: s.name ?? '',
  country: s.country ?? null,
  waterBody: s.waterBody ?? '',
  latitude: s.position?.latitude ?? Number.NaN,
  longitude: s.position?.longitude ?? Number.NaN,
  description: s.description ?? '',
});

/** Both or neither: a half position is no position (ADR 0020). */
function positionOf(d: Draft): Position | null | 'half' {
  const lat = !Number.isNaN(d.latitude);
  const lon = !Number.isNaN(d.longitude);
  if (lat && lon) return { latitude: d.latitude, longitude: d.longitude };
  return lat || lon ? 'half' : null;
}

/**
 * Creates a Dive site, or edits one (with its version, ADR 0020). Says that every User sees the site.
 * `initial` prefills a new site, e.g. with a dive's position or the words searched for.
 */
export function SiteForm({ site, initial, submitLabel, onSaved, onCancel }: {
  site?: SiteView;
  initial?: Partial<SiteView>;
  submitLabel: string;
  onSaved: (site: SiteView) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const start = draftOf(site ?? initial ?? {});
  const [draft, setDraft] = useState(start);
  const [half, setHalf] = useState(false);
  // The "both or neither" message stays until the next submit: clearing it as a field commits (on blur)
  // would move the buttons under a pointer that is pressing one.
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const changed = JSON.stringify(draft) !== JSON.stringify(start);


  // The form opens with focus on its first field (page rules: focus never falls to the page).
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);

  const save = useMutation({
    mutationFn: async (body: { name: string; position: Position | null; country: string | null; waterBody: string | null; description: string | null }) => (site
      ? unwrap(await api.PATCH('/api/dive-sites/{id}', { params: { path: { id: site.id } }, body: { version: site.version, ...body } }))
      : unwrap(await api.POST('/api/dive-sites', { body }))),
    onSuccess: async (saved) => {
      releaseLeaveGuard();
      queryClient.setQueryData(keys.site(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: keys.sites });
      onSaved(saved);
    },
  });
  useLeaveGuard(changed && !save.isSuccess, t('sites.unsavedQuestion'));
  const stale = save.error instanceof ApiError && save.error.code === 'site_changed';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const position = positionOf(draft);
    setHalf(position === 'half');
    if (position === 'half') return;
    save.mutate({
      name: draft.name.trim(), position, country: draft.country,
      waterBody: draft.waterBody.trim() || null, description: draft.description.trim() || null,
    });
  };

  return (
    <Form className="form" ref={form} onSubmit={submit}>
      <Muted>{t('sites.sharedHint')}</Muted>
      <TextField label={t('sites.name')} name="name" isRequired maxLength={120} autoComplete="off" value={draft.name} onChange={(v) => set('name', v)} />
      <div className="form-grid">
        <Select
          label={t('sites.country')}
          value={draft.country ?? NO_COUNTRY}
          onChange={(v) => set('country', !v || v === NO_COUNTRY ? null : v)}
          options={[{ id: NO_COUNTRY, label: t('sites.noCountry') }, ...countryOptions(display.locale)]}
        />
        <TextField label={t('sites.waterBody')} name="waterBody" maxLength={120} autoComplete="off" value={draft.waterBody} onChange={(v) => set('waterBody', v)} />
      </div>
      <div className="form-grid">
        <NumberField
          label={t('sites.latitude')} value={draft.latitude} onChange={(v) => set('latitude', v)}
          minValue={-90} maxValue={90} formatOptions={{ maximumFractionDigits: 6 }}
          description={t('sites.latitudeHint')}
        />
        <NumberField
          label={t('sites.longitude')} value={draft.longitude} onChange={(v) => set('longitude', v)}
          minValue={-180} maxValue={180} formatOptions={{ maximumFractionDigits: 6 }}
          description={t('sites.longitudeHint')}
        />
      </div>
      {half && <Notice tone="danger">{t('sites.positionHalf')}</Notice>}
      <TextArea label={t('sites.description')} name="description" maxLength={5000} value={draft.description} onChange={(v) => set('description', v)} />
      {save.error && (
        <Notice tone="danger">
          {stale ? t('sites.changedMeanwhile') : errorText(save.error)}
        </Notice>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" icon="save" isPending={save.isPending}>{submitLabel}</Button>
        <Button onPress={() => { if (!changed || confirm(t('sites.unsavedQuestion'))) onCancel(); }}>{t('common.cancel')}</Button>
      </div>
    </Form>
  );
}
