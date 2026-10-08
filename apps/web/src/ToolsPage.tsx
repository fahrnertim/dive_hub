import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { diversQuery, toolsBottomTimeQuery, toolsGasQuery, type ToolsBottomTime, type ToolsGas } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { usePageTitle } from './lib/page.ts';
import { replaceToolsAddress, TOOLS_WATERS, type ToolsParams } from './lib/tools.ts';
import { depthFromDisplay, depthIn, pressureFromDisplay, pressureIn } from './lib/units.ts';
import { Checkbox, Disclosure, Muted, NumberField, Notice, PageHeader, Select } from './ui/index.ts';

/** Metres and bar are kept in the address to a tenth; a field shows what the User counts in. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** What applies while a setting is empty (ADR 0032); the answer says where its own value came from. */
const DEFAULTS = { gf: 85, sac: 20, reserveBar: 50, altitudeM: 0, pw: 1.4, pc: 1.6 };

/** The settings that, once in the address, keep their section open. */
const SETTINGS = ['water', 'altitude', 'reserve', 'sac', 'gf', 'pw', 'pc', 'narcotic'] as const;

const num = (v: number) => (Number.isNaN(v) ? undefined : v);

/**
 * Gas numbers and a bottom time for a planned dive (ADR 0032). Limits computed from the inputs and the Diver's own
 * settings, not advice: the notice is on the page before anything is typed, and every answer says what it assumed.
 * One set of inputs feeds both answers.
 */
export function ToolsPage({ params }: { params: ToolsParams }) {
  const { t } = useTranslation();
  usePageTitle(t('tools.title'));
  const divers = useQuery(diversQuery());
  const own = divers.data?.find((d) => d.isOwn)?.id;
  const gas = useQuery(toolsGasQuery(params));
  const bottom = useQuery(toolsBottomTimeQuery(params, own, !divers.isPending));
  return (
    <>
      <PageHeader title={t('tools.title')} lead={t('tools.lead')} />
      <Notice>{t('tools.notice')}</Notice>
      <Inputs params={params} assumed={bottom.data} />
      <GasSection params={params} gas={gas} />
      <BottomTimeSection params={params} bottom={bottom} />
    </>
  );
}

function Inputs({ params, assumed }: { params: ToolsParams; assumed: ToolsBottomTime | undefined }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const { units } = display;
  const set = (change: Partial<ToolsParams>) => replaceToolsAddress({ ...params, ...change });
  const used = assumed?.used;
  /** A default as the field's placeholder, in the User's units. */
  const inDepth = (m: number) => String(Math.round(depthIn(m, units)));
  const inPressure = (bar: number) => String(Math.round(pressureIn(bar, units)));
  return (
    <Section title={t('tools.dive.title')} id="tools-dive">
      <div className="form-grid tools-grid">
        <NumberField label={t('tools.mix.oxygen')} unit="%" value={params.o2 ?? Number.NaN} onChange={(v) => set({ o2: num(v) })} minValue={1} maxValue={100} formatOptions={{ maximumFractionDigits: 0 }} />
        <NumberField label={t('tools.mix.helium')} unit="%" placeholder="0" value={params.he ?? Number.NaN} onChange={(v) => set({ he: num(v) })} minValue={0} maxValue={99} formatOptions={{ maximumFractionDigits: 0 }} />
        <NumberField
          label={t('tools.mix.depth')} unit={display.unit('depth')}
          value={params.depth === undefined ? Number.NaN : Math.round(depthIn(params.depth, units))}
          onChange={(v) => set({ depth: Number.isNaN(v) ? undefined : tenth(depthFromDisplay(v, units)) })}
          minValue={1} maxValue={units === 'imperial' ? 985 : 300} formatOptions={{ maximumFractionDigits: 0 }}
        />
      </div>
      <fieldset className="tools-cylinder">
        <legend>{t('tools.bottom.cylinder')}</legend>
        <div className="form-grid tools-grid">
          <NumberField label={t('tools.bottom.volume')} unit="L" value={params.volume ?? Number.NaN} onChange={(v) => set({ volume: num(v) })} minValue={1} maxValue={60} formatOptions={{ maximumFractionDigits: 1 }} />
          <NumberField
            label={t('tools.bottom.pressure')} unit={display.unit('pressure')}
            value={params.pressure === undefined ? Number.NaN : Math.round(pressureIn(params.pressure, units))}
            onChange={(v) => set({ pressure: Number.isNaN(v) ? undefined : tenth(pressureFromDisplay(v, units)) })}
            minValue={1} maxValue={units === 'imperial' ? 5000 : 350} formatOptions={{ maximumFractionDigits: 0 }}
          />
        </div>
      </fieldset>
      <Disclosure title={t('tools.settings.title')} defaultExpanded={SETTINGS.some((k) => params[k] !== undefined)}>
        <Muted>{t('tools.settings.hint')}</Muted>
        <div className="form-grid tools-grid">
          <Select
            label={t('tools.mix.water')} value={params.water ?? 'salt'}
            options={TOOLS_WATERS.map((w) => ({ id: w, label: t(`tools.water.${w}`) }))}
            onChange={(water) => set({ water: water ?? undefined })}
          />
          <NumberField
            label={t('tools.mix.altitude')} unit={display.unit('depth')} placeholder={inDepth(used?.altitudeM.value ?? DEFAULTS.altitudeM)}
            value={params.altitude === undefined ? Number.NaN : Math.round(depthIn(params.altitude, units))}
            onChange={(v) => set({ altitude: Number.isNaN(v) ? undefined : Math.round(depthFromDisplay(v, units)) })}
            minValue={0} maxValue={units === 'imperial' ? 16400 : 5000} formatOptions={{ maximumFractionDigits: 0 }}
          />
          <NumberField
            label={t('tools.bottom.reserve')} unit={display.unit('pressure')} placeholder={inPressure(used?.reserveBar.value ?? DEFAULTS.reserveBar)}
            value={params.reserve === undefined ? Number.NaN : Math.round(pressureIn(params.reserve, units))}
            onChange={(v) => set({ reserve: Number.isNaN(v) ? undefined : tenth(pressureFromDisplay(v, units)) })}
            minValue={0} maxValue={units === 'imperial' ? 2900 : 200} formatOptions={{ maximumFractionDigits: 0 }}
          />
          <NumberField label={t('tools.bottom.sac')} unit="L/min" placeholder={String(used?.sacLpm.value ?? DEFAULTS.sac)} value={params.sac ?? Number.NaN} onChange={(v) => set({ sac: num(v) })} minValue={1} maxValue={100} formatOptions={{ maximumFractionDigits: 1 }} />
          <NumberField label={t('tools.bottom.gf')} unit="%" placeholder={String(used?.gfHigh.value ?? DEFAULTS.gf)} value={params.gf ?? Number.NaN} onChange={(v) => set({ gf: num(v) })} minValue={20} maxValue={100} formatOptions={{ maximumFractionDigits: 0 }} />
          <NumberField label={t('tools.limits.working')} unit="bar" placeholder={String(DEFAULTS.pw)} value={params.pw ?? Number.NaN} onChange={(v) => set({ pw: num(v) })} minValue={1} maxValue={2} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} />
          <NumberField label={t('tools.limits.contingency')} unit="bar" placeholder={String(DEFAULTS.pc)} value={params.pc ?? Number.NaN} onChange={(v) => set({ pc: num(v) })} minValue={1} maxValue={2} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} />
        </div>
        <Checkbox isSelected={params.narcotic !== false} onChange={(narcotic) => set({ narcotic })}>{t('tools.limits.narcotic')}</Checkbox>
      </Disclosure>
    </Section>
  );
}

function GasSection({ params, gas }: { params: ToolsParams; gas: { data?: ToolsGas | undefined; error: unknown } }) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const bar = (n: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} bar`;
  const limit = (n: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(n);
  const g = gas.data;
  return (
    <Section title={t('tools.gas.title')} id="tools-gas">
      {params.o2 === undefined && <Muted>{t('tools.gas.empty')}</Muted>}
      {gas.error != null && <Notice tone="danger">{errorText(gas.error)}</Notice>}
      {g && (
        <>
          {g.hypoxic && <Notice>{t('tools.gas.hypoxic')}</Notice>}
          <dl className="facts">
            <div><dt>{t('tools.gas.mod', { ppo2: limit(g.ppO2Limits.working) })}</dt><dd>{display.depth(g.modWorkingM)}</dd></div>
            <div><dt>{t('tools.gas.mod', { ppo2: limit(g.ppO2Limits.contingency) })}</dt><dd>{display.depth(g.modContingencyM)}</dd></div>
            {g.atDepth && (
              <>
                <div><dt>{t('tools.gas.ppo2At', { depth: display.depth(g.atDepth.depthM) })}</dt><dd>{bar(g.atDepth.ppO2)}</dd></div>
                <div><dt>{t('tools.gas.bestMix', { depth: display.depth(g.atDepth.depthM) })}</dt><dd>{g.atDepth.bestMixPercent} %</dd></div>
                <div><dt>{t('tools.gas.ead')}</dt><dd>{display.depth(g.atDepth.eadM)}</dd></div>
                <div><dt>{t('tools.gas.end')}</dt><dd>{display.depth(g.atDepth.endM)}</dd></div>
              </>
            )}
          </dl>
          <Muted>{t('tools.gas.rounded')}</Muted>
        </>
      )}
    </Section>
  );
}

function BottomTimeSection({ params, bottom }: { params: ToolsParams; bottom: { data?: ToolsBottomTime | undefined; error: unknown } }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const b = bottom.data;
  return (
    <Section title={t('tools.bottom.title')} id="tools-bottom">
      {(params.o2 === undefined || params.depth === undefined) && <Muted>{t('tools.bottom.empty')}</Muted>}
      {bottom.error != null && <Notice tone="danger">{errorText(bottom.error)}</Notice>}
      {b && <BottomTimeAnswer b={b} />}
    </Section>
  );
}

function BottomTimeAnswer({ b }: { b: ToolsBottomTime }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const source = (s: string) => t(`tools.source.${s}` as 'tools.source.default');
  const { used } = b;
  const minutes = (n: number | null) => (n === null ? t('tools.bottom.noLimit') : t('tools.bottom.minutes', { count: Math.floor(n) }));
  return (
    <div className="tools-answer">
      {b.recentDiveEndedAt && <Notice>{t('tools.bottom.recent', { when: display.dateTime(b.recentDiveEndedAt) })}</Notice>}
      {b.status === 'outside_limits' ? (
        <Notice>
          <strong>{t('tools.bottom.outside')}</strong>{' '}
          {t(`tools.bottom.outsideReason.${b.reason ?? 'depth'}`, { mod: b.modM == null ? '' : display.depth(b.modM) })}
        </Notice>
      ) : (
        <>
          <p className="tools-result">
            <span className="tools-result-label">{t('tools.bottom.result')}</span>{' '}
            <strong data-testid="bottom-time">{t('tools.bottom.minutes', { count: b.minutes ?? 0 })}</strong>
          </p>
          <p>{t('tools.bottom.limitedBy', { limits: (b.binding ?? []).map((l) => t(`tools.limit.${l}`)).join(` ${t('tools.bottom.and')} `) })}</p>
          {b.ppO2AboveWorking && <Notice>{t('tools.bottom.aboveWorking', { ppo2: b.ppO2AtDepth })}</Notice>}
          <table className="table tools-limits">
            <caption className="visually-hidden">{t('tools.bottom.limits')}</caption>
            <tbody>
              <tr><th scope="row">{t('tools.limit.ndl')}</th><td>{minutes(b.limits?.ndl ?? null)}</td></tr>
              <tr><th scope="row">{t('tools.limit.oxygen')}</th><td>{minutes(b.limits?.oxygen ?? null)}</td></tr>
              <tr><th scope="row">{t('tools.limit.gas')}</th><td>{b.limits?.gas == null ? t('tools.bottom.noCylinder') : minutes(b.limits.gas)}</td></tr>
            </tbody>
          </table>
          {b.otu !== undefined && <Muted>{t('tools.bottom.otu', { otu: Math.round(b.otu) })}</Muted>}
        </>
      )}
      <h3 className="subheading">{t('tools.bottom.assumptions')}</h3>
      <ul className="tools-assumptions">
        <li>{t('tools.assumed.gf', { value: used.gfHigh.value, source: source(used.gfHigh.source) })}</li>
        <li>{t('tools.assumed.sac', { value: used.sacLpm.value, source: source(used.sacLpm.source) })}</li>
        <li>{t('tools.assumed.water', { value: t(`tools.water.${used.water.value}`).toLowerCase(), source: source(used.water.source) })}</li>
        <li>{used.altitudeM.source === 'default' ? t('tools.assumed.noAltitude') : t('tools.assumed.altitude', { value: display.depth(used.altitudeM.value), source: source(used.altitudeM.source) })}</li>
        <li>{t('tools.assumed.reserve', { value: display.pressure(used.reserveBar.value), source: source(used.reserveBar.source) })}</li>
        <li>{t('tools.assumed.model')}</li>
      </ul>
      <Muted>{t('tools.flying')}</Muted>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h2 id={id}>{title}</h2></div>
      {children}
    </section>
  );
}
