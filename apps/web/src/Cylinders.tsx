// A Dive's Cylinders (ADR 0045): on the dive page as lines of text, and in the Dive's form as a group of fields each,
// typed, filled from the cylinder catalogue or copied from the last dive.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, cylinderCatalogueQuery, unwrap, type DiveView } from './api.ts';
import {
  emptyDraft, fromCatalogue, fromLastDive, isBlank, type CatalogueCylinder, type CylinderDraft, type CylinderMaterial, type CylinderView,
} from './lib/cylinders.ts';
import { deviceName } from './lib/devices.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { mixName } from './lib/logbook.ts';
import { Badge, Button, Muted, Notice, NumberField, Select } from './ui/index.ts';

const MATERIALS: CylinderMaterial[] = ['aluminium', 'steel', 'carbon'];
const PRESSURE_CHANNEL = /^tankPressure(?::(\d+))?$/;

/** A Cylinder in words: what it is, what it held, and its pressures. */
export function useCylinderText() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (c: Pick<CylinderView, 'volumeL' | 'workingPressureBar' | 'material' | 'gas' | 'startPressureBar' | 'endPressureBar'>) => {
    const start = c.startPressureBar === null ? null : display.pressure(c.startPressureBar);
    const end = c.endPressureBar === null ? null : display.pressure(c.endPressureBar);
    const pressures = start && end
      ? t('cylinders.startAndEnd', { start, end, used: display.pressure(c.startPressureBar! - c.endPressureBar!) })
      : start ? t('cylinders.startOnly', { start }) : end ? t('cylinders.endOnly', { end }) : null;
    const parts = [
      c.volumeL !== null && display.volume(c.volumeL),
      c.material && t(`vocabulary.cylinderMaterial.${c.material}`),
      c.workingPressureBar !== null && display.pressure(c.workingPressureBar),
      c.gas && mixName(c.gas, t('dive.air')),
    ].filter(Boolean).join(', ');
    return [parts, pressures].filter(Boolean).join(': ') || t('cylinders.unknown');
  };
}

/** The Dive's Cylinders as the dive page lists them; nothing when it has none. */
export function CylinderList({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  const text = useCylinderText();
  const display = useDisplay();
  if (d.cylinders.length === 0) return null;
  return (
    <>
      <h2 className="subheading">{t('cylinders.title')}</h2>
      <ul className="cylinder-list">
        {d.cylinders.map((c, i) => (
          <li key={i}>
            {text(c)}
            {c.fromPod && <> <Badge>{t('cylinders.fromPod')}</Badge></>}
          </li>
        ))}
      </ul>
      {d.sac && (
        <p className="cylinder-sac">
          {d.sac.barPerMinute === null
            ? t('cylinders.sac', { sac: display.gasRate(d.sac.litresPerMinute) })
            : t('cylinders.sacWithDrop', { sac: display.gasRate(d.sac.litresPerMinute), drop: display.pressureRate(d.sac.barPerMinute) })}
        </p>
      )}
      {d.sacMissing && <Muted>{t(`cylinders.noSac.${d.sacMissing}`)}</Muted>}
    </>
  );
}

/** What is wrong with a Cylinder as typed, in words; null when it can be saved. */
export function useCylinderProblem() {
  const { t } = useTranslation();
  return (c: CylinderDraft): string | null => {
    if (c.endPressure > c.startPressure) return t('cylinders.endAboveStart');
    if (c.o2 + (Number.isNaN(c.he) ? 0 : c.he) > 100) return t('cylinders.gasOver100');
    return null;
  };
}

/** The Cylinders in the Dive's form. */
export function CylinderFields({ dive: d, drafts, onChange, autoFocus }: {
  dive: DiveView; drafts: CylinderDraft[]; onChange: (next: CylinderDraft[]) => void; autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const problem = useCylinderProblem();
  const { units } = display;
  const catalogue = useQuery(cylinderCatalogueQuery());
  const last = useMutation({
    mutationFn: async () => unwrap(await api.GET('/api/dives/{id}/same-as-last', { params: { path: { id: d.id } } })),
    onSuccess: (found) => { if (found.cylinders.length > 0) onChange(fromLastDive(found.cylinders, units)); },
  });

  const entryName = (c: CatalogueCylinder) => {
    const pressure = display.pressure(c.workingPressureBar);
    if (c.tradeName) return t('cylinders.catalogueNamed', { name: c.tradeName, volume: display.volume(c.volumeL), pressure });
    const material = t(`vocabulary.cylinderMaterial.${c.material}`);
    return c.twin ? t('cylinders.catalogueTwin', { material, volume: display.volume(c.volumeL / 2), pressure })
      : t('cylinders.catalogueEntry', { material, volume: display.volume(c.volumeL), pressure });
  };
  // The tank pods of the Dive's Recordings: one option per pressure series.
  const pods = d.recordings.flatMap((r, n) => {
    const device = r.device ? deviceName(r.device.manufacturer, r.device.product) : t('dive.recordingN', { n: n + 1 });
    const channels = r.channels.filter((c) => PRESSURE_CHANNEL.test(c));
    return channels.map((channel, i) => ({
      id: `${r.id} ${channel}`, series: { recordingId: r.id, channel },
      label: channels.length > 1 ? t('cylinders.podN', { n: i + 1, device }) : t('cylinders.pod', { device }),
    }));
  });
  const untyped = drafts.every(isBlank);
  const set = (key: string, change: Partial<CylinderDraft>) => onChange(drafts.map((c) => (c.key === key ? { ...c, ...change } : c)));

  return (
    <div className="cylinder-fields">
      <h2 className="subheading">{t('cylinders.title')}</h2>
      {drafts.map((c, i) => {
        const wrong = problem(c);
        return (
          <fieldset key={c.key} className="cylinder-fieldset">
            <legend>
              {t('cylinders.n', { n: i + 1 })}
              {c.loaded?.fromPod && c.series && <> <Badge>{t('cylinders.fromPod')}</Badge></>}
            </legend>
            <div className="form-grid">
              {catalogue.data && (
                <Select
                  label={t('cylinders.catalogue')} value={null}
                  options={catalogue.data.map((entry) => ({ id: entry.id, label: entryName(entry) }))}
                  onChange={(id) => {
                    const entry = catalogue.data.find((e) => e.id === id);
                    if (entry) onChange(drafts.map((x) => (x.key === c.key ? fromCatalogue(x, entry, units) : x)));
                  }}
                />
              )}
              <NumberField autoFocus={autoFocus === true && i === 0} label={t('cylinders.volume')} unit="L" value={c.volumeL} onChange={(volumeL) => set(c.key, { volumeL })} minValue={0.1} maxValue={100} formatOptions={{ maximumFractionDigits: 1 }} />
              <NumberField label={t('cylinders.workingPressure')} unit={display.unit('pressure')} value={c.workingPressure} onChange={(workingPressure) => set(c.key, { workingPressure })} minValue={1} maxValue={units === 'imperial' ? 7250 : 500} formatOptions={{ maximumFractionDigits: 0 }} />
              <Select
                label={t('cylinders.material')} value={c.material ?? 'unknown'}
                options={[{ id: 'unknown' as const, label: t('cylinders.materialUnknown') }, ...MATERIALS.map((m) => ({ id: m, label: t(`vocabulary.cylinderMaterial.${m}`) }))]}
                onChange={(material) => set(c.key, { material: material === 'unknown' || material === null ? null : material })}
              />
              <NumberField label={t('cylinders.oxygen')} unit="%" value={c.o2} onChange={(o2) => set(c.key, { o2 })} minValue={1} maxValue={100} formatOptions={{ maximumFractionDigits: 0 }} />
              <NumberField label={t('cylinders.helium')} unit="%" value={c.he} onChange={(he) => set(c.key, { he })} minValue={0} maxValue={99} formatOptions={{ maximumFractionDigits: 0 }} />
              <NumberField label={t('cylinders.startPressure')} unit={display.unit('pressure')} value={c.startPressure} onChange={(startPressure) => set(c.key, { startPressure })} minValue={0} maxValue={units === 'imperial' ? 7250 : 500} formatOptions={{ maximumFractionDigits: 0 }} />
              <NumberField label={t('cylinders.endPressure')} unit={display.unit('pressure')} value={c.endPressure} onChange={(endPressure) => set(c.key, { endPressure })} minValue={0} maxValue={units === 'imperial' ? 7250 : 500} formatOptions={{ maximumFractionDigits: 0 }} />
              {pods.length > 0 && (
                <Select
                  label={t('cylinders.series')}
                  value={c.series ? `${c.series.recordingId} ${c.series.channel}` : 'none'}
                  options={[{ id: 'none', label: t('cylinders.noSeries') }, ...pods.map((p) => ({ id: p.id, label: p.label }))]}
                  onChange={(id) => set(c.key, { series: pods.find((p) => p.id === id)?.series ?? null })}
                />
              )}
            </div>
            {/* One line with the way to remove it: a problem coming or going moves nothing under the pointer on its way to Save. */}
            <div className="cylinder-foot">
              <Button variant="quiet" size="small" icon="delete" onPress={() => onChange(drafts.filter((x) => x.key !== c.key))}>
                {t('cylinders.remove', { n: i + 1 })}
              </Button>
              {wrong && <p className="field-error" role="alert">{wrong}</p>}
            </div>
          </fieldset>
        );
      })}
      <div className="form-actions">
        <Button icon="add" onPress={() => onChange([...drafts, emptyDraft()])}>{t('cylinders.add')}</Button>
        {/* Copies into the form only: nothing is saved until the User saves (ADR 0031). Offered while there is nothing to lose. */}
        {untyped && <Button isPending={last.isPending} onPress={() => last.mutate()}>{t('cylinders.sameAsLast')}</Button>}
      </div>
      {untyped && last.data?.cylinders.length === 0 && <Muted>{t('cylinders.lastHasNone')}</Muted>}
      {last.error && <Notice tone="danger">{errorText(last.error)}</Notice>}
    </div>
  );
}
