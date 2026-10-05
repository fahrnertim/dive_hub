import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, keys, unwrap, type Position, type ProviderView, type RequirementView, type SiteView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { countryOptions } from './lib/geo.ts';
import { depthFromDisplay, depthIn } from './lib/units.ts';
import { releaseLeaveGuard, useLeaveGuard } from './lib/leave-guard.ts';
import { typedSiteId, useProviders, useProviderText } from './lib/providers.ts';
import { Button, Form, Muted, Notice, NumberField, Select, TextArea, TextField } from './ui/index.ts';

const NO_COUNTRY = 'none';
const NO_WATER = 'none';

type WaterType = NonNullable<SiteView['waterType']>;
const WATER_TYPES: WaterType[] = ['salt', 'fresh', 'brackish'];

interface Draft {
  name: string;
  country: string | null;
  waterBody: string;
  latitude: number;
  longitude: number;
  description: string;
  /** In the User's units, as typed. */
  maxDepth: number;
  waterType: WaterType | null;
  /** The site's External IDs Users may type, by Source, as typed. */
  externalIds: Record<string, string>;
}

/**
 * The site IDs a Provider needs and Users may type (ADR 0029), one field each: SSI's today. The form learns them from
 * GET /api/providers, so it knows no Provider's field or ID format itself.
 */
export function typedSources(providers: ProviderView[] | undefined) {
  const seen = new Set<string>();
  return (providers ?? []).flatMap((p) => (p.data.dives?.export?.requirements ?? [])
    .filter((r) => r.type === 'site_external_id' && r.typed && !seen.has(r.source) && seen.add(r.source))
    .map((r) => ({ provider: p, requirement: r })));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const draftOf = (s: Partial<SiteView>, units: 'metric' | 'imperial'): Draft => ({
  name: s.name ?? '',
  country: s.country ?? null,
  waterBody: s.waterBody ?? '',
  latitude: s.position?.latitude ?? Number.NaN,
  longitude: s.position?.longitude ?? Number.NaN,
  description: s.description ?? '',
  maxDepth: s.maxDepthM == null ? Number.NaN : round1(depthIn(s.maxDepthM, units)),
  waterType: s.waterType ?? null,
  externalIds: Object.fromEntries((s.externalIds ?? []).map((e) => [e.source, e.externalId])),
});

/** One typed site ID field, worded by the Provider that needs it. */
function ExternalIdField({ provider: p, requirement: r, value, invalid, onChange }: {
  provider: ProviderView; requirement: RequirementView; value: string; invalid: boolean; onChange: (v: string) => void;
}) {
  const pt = useProviderText(p);
  return (
    <>
      <TextField
        label={pt('siteIdLabel')} name={`externalId-${r.source}`} description={pt('siteIdHint')} autoComplete="off"
        maxLength={40} value={value} onChange={onChange}
      />
      {invalid && <Notice tone="danger">{pt('siteIdInvalid')}</Notice>}
    </>
  );
}

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
  const typed = typedSources(useProviders().data);
  const start = draftOf(site ?? initial ?? {}, display.units);
  const [draft, setDraft] = useState(start);
  const [half, setHalf] = useState(false);
  const [bad, setBad] = useState<string[]>([]);
  /** A site this form created whose IDs didn't save: submitting again edits it instead of creating another. */
  const created = useRef<SiteView | null>(null);
  // The "both or neither" message stays until the next submit: clearing it as a field commits (on blur)
  // would move the buttons under a pointer that is pressing one.
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const changed = JSON.stringify(draft) !== JSON.stringify(start);


  // The form opens with focus on its first field (page rules: focus never falls to the page).
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);

  const save = useMutation({
    mutationFn: async ({ ids, ...body }: {
      name: string; position: Position | null; country: string | null; waterBody: string | null; description: string | null;
      maxDepthM: number | null; waterType: WaterType | null; ids: Record<string, string | null>;
    }) => {
      const target = site ?? created.current;
      let saved = target
        ? unwrap(await api.PATCH('/api/dive-sites/{id}', { params: { path: { id: target.id } }, body: { version: target.version, ...body } }))
        : unwrap(await api.POST('/api/dive-sites', { body }));
      if (!site) created.current = saved;
      // A site's typed IDs have their own route and don't change its version (ADR 0029).
      for (const [source, externalId] of Object.entries(ids)) {
        if ((saved.externalIds.find((e) => e.source === source)?.externalId ?? null) === externalId) continue;
        saved = unwrap(await api.PUT('/api/dive-sites/{id}/external-ids/{source}', {
          params: { path: { id: saved.id, source: source as 'ssi' } }, body: { externalId },
        }));
      }
      return saved;
    },
    onSuccess: (saved) => {
      releaseLeaveGuard();
      queryClient.setQueryData(keys.site(saved.id), saved);
      // Close at once; lists, nearby sites and the history refresh behind it (waiting kept the form open).
      void queryClient.invalidateQueries({ queryKey: keys.sites, predicate: (q) => q.queryKey[1] !== saved.id || q.queryKey.length > 2 });
      // A Dive's water type is its site's (ADR 0025), and its site's name shows on it.
      if (site) void queryClient.invalidateQueries({ queryKey: keys.dives });
      onSaved(saved);
    },
  });
  useLeaveGuard(changed && !save.isSuccess, t('sites.unsavedQuestion'));
  const stale = save.error instanceof ApiError && save.error.code === 'site_changed';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const position = positionOf(draft);
    const ids = Object.fromEntries(typed.map(({ requirement: r }) => {
      const text = (draft.externalIds[r.source] ?? '').trim();
      return [r.source, text ? typedSiteId(r, text) : null];
    }));
    const invalid = Object.entries(ids).filter(([, v]) => v === undefined).map(([source]) => source);
    setHalf(position === 'half');
    setBad(invalid);
    if (position === 'half' || invalid.length > 0) return;
    save.mutate({
      name: draft.name.trim(), position, country: draft.country,
      waterBody: draft.waterBody.trim() || null, description: draft.description.trim() || null,
      maxDepthM: Number.isNaN(draft.maxDepth) ? null : Math.round(depthFromDisplay(draft.maxDepth, display.units) * 100) / 100,
      waterType: draft.waterType,
      ids: ids as Record<string, string | null>,
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
      <div className="form-grid">
        {/* Every Dive here takes this water type (ADR 0025); the field says so (client contract). */}
        <Select
          label={t('sites.waterType')}
          description={t('sites.waterTypeHint')}
          value={draft.waterType ?? NO_WATER}
          onChange={(v) => set('waterType', !v || v === NO_WATER ? null : v as WaterType)}
          options={[{ id: NO_WATER, label: t('sites.notKnown') }, ...WATER_TYPES.map((w) => ({ id: w, label: t(`vocabulary.waterType.${w}`) }))]}
        />
        <NumberField
          label={t('sites.maxDepth')} unit={display.unit('depth')} value={draft.maxDepth} onChange={(v) => set('maxDepth', v)}
          minValue={0.1} maxValue={depthIn(400, display.units)} formatOptions={{ maximumFractionDigits: 1 }}
        />
      </div>
      {typed.length > 0 && (
        <div className="form-grid">
          {typed.map(({ provider, requirement }) => (
            <ExternalIdField
              key={requirement.source} provider={provider} requirement={requirement} invalid={bad.includes(requirement.source)}
              value={draft.externalIds[requirement.source] ?? ''}
              onChange={(v) => set('externalIds', { ...draft.externalIds, [requirement.source]: v })}
            />
          ))}
        </div>
      )}
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
