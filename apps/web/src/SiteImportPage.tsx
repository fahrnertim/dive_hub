import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, keys, siteImportsQuery, unwrap, type SiteImportArea, type SiteImportView } from './api.ts';
import { LANGUAGES, pickLanguage } from './i18n/languages.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { countryOptions } from './lib/geo.ts';
import { usePageTitle } from './lib/page.ts';
import { Badge, Button, Checkbox, Form, Icon, Muted, Notice, NumberField, PageHeader, Panel, RadioGroup, Select } from './ui/index.ts';

type Source = SiteImportView['sources'][number];
type AreaKind = SiteImportArea['kind'];

const NO_COUNTRY = 'none';
const ODBL_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';
const running = (i: SiteImportView) => i.status === 'queued' || i.status === 'running';

/**
 * An admin imports Dive sites from open data (ADR 0021): Wikidata (CC0) and OpenStreetMap (ODbL, whose
 * obligations the admin confirms first), for a country, a box or everywhere. The import runs on the server;
 * this page follows it.
 */
export function SiteImportPage() {
  const { t } = useTranslation();
  usePageTitle(t('siteImport.title'));
  return (
    <>
      <p><a href="#/admin" className="back-link"><Icon name="back" />{t('nav.admin')}</a></p>
      <PageHeader title={t('siteImport.title')} lead={t('siteImport.intro')} />
      <StartImport />
      <LatestImports />
    </>
  );
}

function StartImport() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const imports = useQuery(siteImportsQuery());
  const busy = imports.data?.some(running) ?? false;
  const [sources, setSources] = useState<Record<Source, boolean>>({ osm: true, wikidata: true });
  const [kind, setKind] = useState<AreaKind>('country');
  const [country, setCountry] = useState<string | null>(null);
  const [box, setBox] = useState({ south: Number.NaN, west: Number.NaN, north: Number.NaN, east: Number.NaN });
  const [language, setLanguage] = useState<string>(pickLanguage(i18n.language, []));
  const [odbl, setOdbl] = useState(false);
  // Says what is missing; set on submit only, so nothing moves under a pointer while fields commit.
  const [problem, setProblem] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: async (body: { sources: Source[]; area: SiteImportArea; language: string; confirmOdbl: boolean }) =>
      unwrap(await api.POST('/api/admin/site-imports', { body })),
    onSuccess: async () => {
      announce(t('siteImport.started'));
      await queryClient.invalidateQueries({ queryKey: keys.siteImports });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const chosen = (['osm', 'wikidata'] as const).filter((s) => sources[s]);
    const area: SiteImportArea | null = kind === 'world' ? { kind }
      : kind === 'country' ? (country ? { kind, country } : null)
      : Object.values(box).some(Number.isNaN) || box.south >= box.north ? null : { kind, ...box };
    const missing = chosen.length === 0 ? t('siteImport.needSource')
      : !area ? (kind === 'country' ? t('siteImport.needCountry') : t('siteImport.needBox'))
      : sources.osm && !odbl ? t('siteImport.needOdbl') : null;
    setProblem(missing);
    if (missing || !area) return;
    start.mutate({ sources: chosen, area, language, confirmOdbl: sources.osm && odbl });
  };

  return (
    <Panel title={t('siteImport.new')}>
      <Form className="form" onSubmit={submit}>
        <fieldset className="field-set">
          <legend className="field-label">{t('siteImport.sources')}</legend>
          <Checkbox isSelected={sources.wikidata} onChange={(v) => setSources((s) => ({ ...s, wikidata: v }))}>{t('siteImport.sourceWikidata')}</Checkbox>
          <Checkbox isSelected={sources.osm} onChange={(v) => setSources((s) => ({ ...s, osm: v }))}>{t('siteImport.sourceOsm')}</Checkbox>
        </fieldset>
        {sources.osm && (
          // Standing terms that wait for the admin's confirmation: tinted, not a Notice (which announces itself).
          <div className="terms">
            <p><strong>{t('siteImport.odblTitle')}</strong></p>
            <p>{t('siteImport.odblCredit')}</p>
            <p>{t('siteImport.odblShareAlike')}</p>
            <p>
              <Trans
                i18nKey="siteImport.odblMore"
                components={{ license: <a href={ODBL_URL} target="_blank" rel="noopener noreferrer" className="external-link" /> }}
              />
            </p>
            <Checkbox isSelected={odbl} onChange={setOdbl}>{t('siteImport.odblConfirm')}</Checkbox>
          </div>
        )}
        <RadioGroup
          label={t('siteImport.area')}
          value={kind}
          onChange={(v) => setKind(v as AreaKind)}
          options={[
            { value: 'country', label: t('siteImport.areaCountry') },
            { value: 'box', label: t('siteImport.areaBoxOption') },
            { value: 'world', label: t('siteImport.areaWorld') },
          ]}
        />
        {kind === 'country' && (
          <Select
            label={t('sites.country')}
            value={country ?? NO_COUNTRY}
            onChange={(v) => setCountry(!v || v === NO_COUNTRY ? null : v)}
            options={[{ id: NO_COUNTRY, label: t('siteImport.chooseCountry') }, ...countryOptions(display.locale)]}
          />
        )}
        {kind === 'box' && (
          <>
            <Muted>{t('siteImport.boxHint')}</Muted>
            <div className="form-grid">
              <NumberField label={t('siteImport.south')} value={box.south} onChange={(v) => setBox((b) => ({ ...b, south: v }))} minValue={-90} maxValue={90} formatOptions={{ maximumFractionDigits: 6 }} />
              <NumberField label={t('siteImport.north')} value={box.north} onChange={(v) => setBox((b) => ({ ...b, north: v }))} minValue={-90} maxValue={90} formatOptions={{ maximumFractionDigits: 6 }} />
              <NumberField label={t('siteImport.west')} value={box.west} onChange={(v) => setBox((b) => ({ ...b, west: v }))} minValue={-180} maxValue={180} formatOptions={{ maximumFractionDigits: 6 }} />
              <NumberField label={t('siteImport.east')} value={box.east} onChange={(v) => setBox((b) => ({ ...b, east: v }))} minValue={-180} maxValue={180} formatOptions={{ maximumFractionDigits: 6 }} />
            </div>
          </>
        )}
        {kind === 'world' && <Muted>{t('siteImport.worldHint')}</Muted>}
        <Select
          label={t('siteImport.language')}
          description={t('siteImport.languageHint')}
          value={language}
          onChange={(v) => setLanguage(v || 'en')}
          options={Object.entries(LANGUAGES).map(([id, label]) => ({ id, label }))}
        />
        {problem && <Notice tone="danger">{problem}</Notice>}
        {start.error && <Notice tone="danger">{errorText(start.error)}</Notice>}
        {busy && <Muted>{t('siteImport.busy')}</Muted>}
        <div className="form-actions">
          <Button type="submit" variant="primary" icon="siteImport" isPending={start.isPending} isDisabled={busy}>{t('siteImport.start')}</Button>
        </div>
      </Form>
    </Panel>
  );
}

function LatestImports() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const imports = useQuery(siteImportsQuery());
  // Says when a run finishes, for screen readers (the badge changes silently).
  const statuses = useRef(new Map<string, SiteImportView['status']>());
  useEffect(() => {
    for (const i of imports.data ?? []) {
      const before = statuses.current.get(i.id);
      if (before && before !== i.status && !running(i)) announce(i.status === 'done' ? t('siteImport.finished') : t('siteImport.failedNow'));
      statuses.current.set(i.id, i.status);
    }
  }, [imports.data, t]);

  return (
    <Panel title={t('siteImport.latest')}>
      {imports.error && <Notice tone="danger">{errorText(imports.error)}</Notice>}
      {imports.data?.length === 0 && <Muted>{t('siteImport.none')}</Muted>}
      {imports.data && imports.data.length > 0 && (
        <ul className="site-imports">{imports.data.map((i) => <ImportItem key={i.id} item={i} />)}</ul>
      )}
    </Panel>
  );
}

const STATUS_TONE = { queued: 'neutral', running: 'neutral', done: 'success', failed: 'danger' } as const;
const COUNTED = ['created', 'updated', 'unchanged', 'kept', 'linked', 'skippedNoName', 'skippedDeleted', 'gone'] as const;

function ImportItem({ item: i }: { item: SiteImportView }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const area = i.area.kind === 'country' ? display.country(i.area.country)
    : i.area.kind === 'box' ? t('siteImport.areaBox', {
      southWest: display.position({ latitude: i.area.south, longitude: i.area.west }),
      northEast: display.position({ latitude: i.area.north, longitude: i.area.east }),
    })
    : t('siteImport.areaWorld');
  const sources = i.sources.map((s) => t(`siteImport.sourceName.${s}`)).join(', ');
  const progress = i.status !== 'running' ? null
    : i.progress.step === 'saving' ? t('siteImport.saving', { done: i.progress.done, total: i.progress.total })
    : i.progress.step === 'waiting' ? null : t('siteImport.fetching', { source: t(`siteImport.sourceName.${i.progress.step}`) });
  const counts = i.counts && COUNTED.filter((k) => i.counts![k] > 0).map((k) => t(`siteImport.count.${k}`, { count: i.counts![k] }));

  return (
    <li>
      <div className="site-import-head">
        <strong>{sources} · {area}</strong>
        <Badge tone={STATUS_TONE[i.status]}>{t(`siteImport.status.${i.status}`)}</Badge>
      </div>
      <p className="meta">{display.dateTime(i.createdAt)}</p>
      {progress && <p>{progress}</p>}
      {counts && <p>{counts.length > 0 ? counts.join(', ') : t('siteImport.nothingFound')}</p>}
      {i.failureCode && <p className="import-error">{t(`errors.${i.failureCode}`)}</p>}
      {i.findings.length > 0 && (
        <>
          <p>{t('siteImport.nearIntro', { count: i.findings.length })}</p>
          <ul className="site-import-findings">
            {i.findings.map((f) => (
              <li key={f.siteId}>
                <a href={`#/sites/${f.siteId}`}>{f.name}</a>
                {' '}{t('siteImport.nearOf', { distance: display.distance(f.distanceM) })}{' '}
                <a href={`#/sites/${f.nearSiteId}`}>{f.nearName}</a>
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}
