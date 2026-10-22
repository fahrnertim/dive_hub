import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cylinderCatalogueQuery, type LeadEstimate } from './api.ts';
import { useCatalogueName } from './Cylinders.tsx';
import { useDisplay, useErrorText } from './lib/display.ts';
import { LEAD_MATERIALS, LEAD_WATERS, replaceToolsAddress, type LeadCylinder, type ToolsParams } from './lib/tools.ts';
import { massFromDisplay } from './lib/units.ts';
import { SUIT_TYPES, SUIT_UNDERGARMENTS, hasThickness, wornSuit } from './lib/weighting.ts';
import { Button, Muted, Notice, NumberField, Select } from './ui/index.ts';

interface ManagedDiver { id: string; name: string; isOwn: boolean }
type LeadQuery = { data?: LeadEstimate | undefined; error: unknown };

/** What the weight check says before any answer: the reserve is the server's own default until it tells us otherwise. */
const DEFAULT_RESERVE_BAR = 50;
const MAX_CYLINDERS = 4;
const NONE = 'unknown';

/**
 * The lead calculator (ADR 0031): the planned conditions as a form, the answer with its range and reasons, and the weight
 * check, which is on the page in every state. The estimate is a starting point; nothing here is stored or filled into a Dive.
 */
export function LeadSection({ params, estimate, managed, diverId }: {
  params: ToolsParams; estimate: LeadQuery; managed: ManagedDiver[]; diverId: string | undefined;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const name = managed.find((d) => d.id === diverId)?.name ?? '';
  const answer = estimate.data;
  return (
    <>
      <Panel title={t('tools.leadCalc.conditions')} id="tools-lead-conditions">
        <Conditions params={params} managed={managed} diverId={diverId} />
      </Panel>
      <Panel title={t('tools.leadCalc.answer')} id="tools-lead-answer">
        {estimate.error != null && <Notice tone="danger">{errorText(estimate.error)}</Notice>}
        {answer ? <Answer a={answer} name={name} /> : estimate.error == null && <Muted>{t('tools.leadCalc.empty', { name })}</Muted>}
      </Panel>
      <WeightCheck a={answer} />
    </>
  );
}

function Panel({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2></div>
      {children}
    </section>
  );
}

function Conditions({ params, managed, diverId }: { params: ToolsParams; managed: ManagedDiver[]; diverId: string | undefined }) {
  const { t } = useTranslation();
  const set = (change: Partial<ToolsParams>) => replaceToolsAddress({ ...params, tool: 'lead', ...change });
  const suit = params.suit ?? null;
  const cylinders: LeadCylinder[] = params.cylinders ?? [{ volumeL: Number.NaN }];
  const setCylinder = (i: number, change: Partial<LeadCylinder>) =>
    set({ cylinders: cylinders.map((c, n) => (n === i ? { ...c, ...change } : c)) });
  const choose = { id: NONE, label: t('tools.leadCalc.choose') } as const;
  return (
    <>
      <div className="form-grid tools-grid">
        {managed.length > 1 && (
          <Select
            label={t('tools.leadCalc.diver')} value={diverId ?? null}
            options={managed.map((d) => ({ id: d.id, label: d.name }))}
            onChange={(diver) => set({ diver: diver && !managed.find((d) => d.id === diver)?.isOwn ? diver : undefined })}
          />
        )}
        <Select
          label={t('tools.leadCalc.water')} value={params.leadWater ?? NONE}
          options={[choose, ...LEAD_WATERS.map((w) => ({ id: w, label: t(`vocabulary.waterType.${w}`) }))]}
          onChange={(w) => set({ leadWater: w === NONE || w === null ? undefined : w })}
        />
        <Select
          label={t('weighting.suit')} value={suit ?? NONE}
          options={[choose, ...SUIT_TYPES.map((s) => ({ id: s, label: t(`vocabulary.suitType.${s}`) }))]}
          onChange={(s) => set({ suit: s === NONE || s === null ? undefined : s })}
        />
        {hasThickness(suit) && (
          <NumberField
            label={t('weighting.thickness')} unit="mm" value={params.thicknessMm ?? Number.NaN}
            onChange={(v) => set({ thicknessMm: Number.isNaN(v) ? undefined : v })} minValue={0.5} maxValue={20} formatOptions={{ maximumFractionDigits: 1 }}
          />
        )}
        {suit === 'drysuit' && (
          <Select
            label={t('weighting.undergarment')} value={params.undergarment ?? NONE}
            options={[choose, ...SUIT_UNDERGARMENTS.map((u) => ({ id: u, label: t(`vocabulary.suitUndergarment.${u}`) }))]}
            onChange={(u) => set({ undergarment: u === NONE || u === null ? undefined : u })}
          />
        )}
        {wornSuit(suit) && (
          <Select
            label={t('weighting.hood')} value={params.hood === undefined ? NONE : params.hood ? 'yes' : 'no'}
            options={[{ id: NONE, label: t('weighting.notSaid') }, { id: 'yes', label: t('weighting.hoodYes') }, { id: 'no', label: t('weighting.hoodNo') }]}
            onChange={(h) => set({ hood: h === 'yes' ? true : h === 'no' ? false : undefined })}
          />
        )}
      </div>
      {cylinders.map((c, i) => (
        <CylinderRow
          key={i} n={i + 1} cylinder={c} onChange={(change) => setCylinder(i, change)}
          onRemove={cylinders.length > 1 ? () => set({ cylinders: cylinders.filter((_, n) => n !== i) }) : undefined}
        />
      ))}
      {cylinders.length < MAX_CYLINDERS && (
        <div className="form-actions">
          <Button icon="add" onPress={() => set({ cylinders: [...cylinders, { volumeL: Number.NaN }] })}>{t('cylinders.add')}</Button>
        </div>
      )}
    </>
  );
}

/** One planned Cylinder: from the catalogue, or its size and material typed. */
function CylinderRow({ n, cylinder, onChange, onRemove }: {
  n: number; cylinder: LeadCylinder; onChange: (change: Partial<LeadCylinder>) => void; onRemove: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const catalogue = useQuery(cylinderCatalogueQuery());
  const entryName = useCatalogueName();
  return (
    <fieldset className="tools-cylinder">
      <legend>{t('cylinders.n', { n })}</legend>
      <div className="form-grid tools-grid">
        {catalogue.data && (
          <Select
            label={t('cylinders.catalogue')} value={null}
            options={catalogue.data.map((entry) => ({ id: entry.id, label: entryName(entry) }))}
            onChange={(id) => {
              const entry = catalogue.data.find((e) => e.id === id);
              if (entry) onChange({ volumeL: entry.volumeL, material: entry.material });
            }}
          />
        )}
        <NumberField
          label={t('cylinders.volume')} unit="L" value={cylinder.volumeL}
          onChange={(volumeL) => onChange({ volumeL })} minValue={0.1} maxValue={100} formatOptions={{ maximumFractionDigits: 1 }}
        />
        <Select
          label={t('cylinders.material')} value={cylinder.material ?? NONE}
          options={[{ id: NONE, label: t('cylinders.materialUnknown') }, ...LEAD_MATERIALS.map((m) => ({ id: m, label: t(`vocabulary.cylinderMaterial.${m}`) }))]}
          onChange={(m) => onChange({ material: m === NONE || m === null ? undefined : m })}
        />
      </div>
      {onRemove && <Button variant="quiet" size="small" icon="delete" onPress={onRemove}>{t('cylinders.remove', { n })}</Button>}
    </fieldset>
  );
}

function Answer({ a, name }: { a: LeadEstimate; name: string }) {
  const { t } = useTranslation();
  const display = useDisplay();
  // Every amount in the answer is already in the unit asked for and rounded: show it, don't convert it again.
  const amount = (n: number) => display.mass(massFromDisplay(n, display.units));
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${amount(Math.abs(n))}`;
  const { basis } = a;
  return (
    <div className="tools-answer">
      {a.total === null || a.range === null ? (
        <Notice>
          <strong>{t('tools.leadCalc.noNumber')}</strong>{' '}
          {t('tools.leadCalc.noNumberBody', { name })}{' '}
          <a href="#/divers">{t('tools.leadCalc.addBodyWeight')}</a>
        </Notice>
      ) : (
        <>
          <p className="tools-result">
            <span className="tools-result-label">{t('tools.leadCalc.startingPoint')}</span>{' '}
            <strong data-testid="lead-total">{amount(a.total)}</strong>
          </p>
          <p data-testid="lead-range">{t('tools.leadCalc.range', { low: amount(a.range.low), high: amount(a.range.high) })}</p>
          <p>{t('tools.leadCalc.confidence', { level: t(`tools.leadCalc.level.${a.confidence}`) })}</p>
          <Muted>{t('tools.leadCalc.notCertain')}</Muted>
        </>
      )}
      {basis?.kind === 'dives' && (
        <>
          <p>{t('tools.leadCalc.basisDives', { count: basis.dives.length, name })}</p>
          <ul className="tools-assumptions">
            {basis.dives.map((d) => (
              <li key={d.diveId}>
                <a href={`#/dives/${d.diveId}`}>
                  {d.number === null ? t('tools.leadCalc.diveLabel', { date: display.date(d.startsAt) }) : t('tools.leadCalc.diveLabelNumbered', { number: d.number, date: display.date(d.startsAt) })}
                </a>
                {': '}{t('tools.leadCalc.diveLine', { carried: amount(d.carried), needed: amount(d.needed) })}
              </li>
            ))}
          </ul>
        </>
      )}
      {basis?.kind === 'rule_of_thumb' && (
        <>
          <p>{t('tools.leadCalc.basisRule', { rule: amount(basis.rule) })}</p>
          {basis.personalOffset !== null && <p>{t('tools.leadCalc.basisOffset', { offset: signed(basis.personalOffset), count: basis.offsetFromSuits })}</p>}
        </>
      )}
      {a.total !== null && (
        <>
          <h3 className="subheading">{t('tools.leadCalc.adjustments')}</h3>
          <ul className="tools-assumptions">
            {a.adjustments.map((adj) => (
              <li key={adj.kind}>
                {adj.kind === 'cylinder' && <>{t('tools.leadCalc.cylinder', { amount: signed(adj.amount) })}. {t('tools.leadCalc.cylinderReason')}</>}
                {adj.kind === 'water' && <>{t('tools.leadCalc.waterAdjustment', { water: t(`vocabulary.waterTypeInSentence.${adj.water}`), amount: signed(adj.amount) })}. {t('tools.leadCalc.waterReason')}</>}
                {adj.kind === 'personal_offset' && <>{t('tools.leadCalc.offset', { amount: signed(adj.amount) })}. {t('tools.leadCalc.offsetReason')}</>}
              </li>
            ))}
          </ul>
        </>
      )}
      <Muted>
        {t('tools.leadCalc.reserve', {
          pressure: display.pressure(a.reserve.bar), source: t(a.reserve.fromDives ? 'tools.leadCalc.reserveFromDives' : 'tools.leadCalc.reserveAssumed'),
        })}
      </Muted>
      <Missing a={a} name={name} />
      {a.leftOut.noWaterType > 0 && (
        <Notice>
          {t('tools.leadCalc.leftOut', { count: a.leftOut.noWaterType })} <a href="#/sites">{t('tools.leadCalc.toSites')}</a>
        </Notice>
      )}
    </div>
  );
}

/** What the answer had to assume, each with where to put it right. */
function Missing({ a, name }: { a: LeadEstimate; name: string }) {
  const { t } = useTranslation();
  // With no number the notice above already says it, with the same way to add it.
  const missing = a.total === null ? a.missing.filter((m) => m.kind !== 'body_weight') : a.missing;
  if (missing.length === 0) return null;
  const dives = (ids: string[]) => (
    <ul className="tools-assumptions">
      {ids.map((id, i) => <li key={id}><a href={`#/dives/${id}`}>{t('tools.leadCalc.openDive', { n: i + 1 })}</a></li>)}
    </ul>
  );
  return (
    <>
      <h3 className="subheading">{t('tools.leadCalc.missing')}</h3>
      <ul className="tools-assumptions">
        {missing.map((m) => (
          <li key={m.kind + (m.kind === 'cylinder_material' ? String(m.planned) : '')}>
            {m.kind === 'body_weight' && <>{t('tools.leadCalc.missingBodyWeight', { name })} <a href="#/divers">{t('tools.leadCalc.addBodyWeight')}</a></>}
            {m.kind === 'cylinder_material' && (m.planned
              ? t('tools.leadCalc.missingMaterialPlanned')
              : <>{t('tools.leadCalc.missingMaterialDives', { count: m.diveIds.length })}{dives(m.diveIds)}</>)}
            {m.kind === 'cylinder' && <>{t('tools.leadCalc.missingCylinder', { count: m.diveIds.length })}{dives(m.diveIds)}</>}
            {m.kind === 'suit_thickness' && t('tools.leadCalc.missingThickness')}
            {m.kind === 'suit_undergarment' && t('tools.leadCalc.missingUndergarment')}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Always on the page, with or without a number: the estimate is where to start, this is how to finish. */
function WeightCheck({ a }: { a: LeadEstimate | undefined }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const pressure = display.pressure(a?.weightCheck.reserveBar ?? DEFAULT_RESERVE_BAR);
  const steps = a?.weightCheck.steps ?? (['eye_level_empty_bc', 'neutral_at_5m_at_reserve'] as const);
  return (
    <Panel title={t('tools.leadCalc.check')} id="tools-lead-check">
      <p>{t('tools.leadCalc.checkIntro')}</p>
      <ol className="tools-assumptions">
        {steps.map((s) => <li key={s}>{t(`tools.leadCalc.step.${s}`, { pressure })}</li>)}
      </ol>
    </Panel>
  );
}
