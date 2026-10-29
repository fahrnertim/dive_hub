import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { diverSearchQuery, type ToolsPlan, type ToolsPlanDiver } from './api.ts';
import { formatRate } from './lib/assessment.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { planSketch, replaceToolsAddress, type PlanDiver, type PlanLevel, type PlanStretch, type ToolsParams, type ToolsRule } from './lib/tools.ts';
import { depthFromDisplay, depthIn, pressureFromDisplay, pressureIn } from './lib/units.ts';
import { PlanProfile } from './ToolsPlanProfile.tsx';
import { Badge, Button, Muted, Notice, NumberField, SearchList, Table, TextField, type SearchListItem } from './ui/index.ts';

/** Metres and bar are kept in the address to a tenth; a field shows what the User counts in. */
const tenth = (n: number) => Math.round(n * 10) / 10;
const MAX_ROWS = 8;
const DEFAULT_CYLINDER = { volume: 12, pressure: 200 };
const num = (v: number) => (Number.isNaN(v) ? undefined : v);
const NO_NAMES: string[] = [];
/** The search's row for someone who is no Diver here. */
const GUEST = 'guest';

type PlanQuery = Pick<ReturnType<typeof useQuery<ToolsPlan>>, 'data' | 'error'>;
type OkPlan = Extract<ToolsPlan, { status: 'ok' }>;
/** A Diver the User manages: a plan can start their SAC from their logbook. */
export interface ManagedDiver { id: string; name: string; isOwn: boolean }
/** The one set of fields that is open: a level's, a Diver's, or the search for a new Diver. */
type Open = { list: 'levels' | 'divers'; index: number } | { list: 'divers'; index: 'new' } | null;

/** The names under which a Diver is shown when none was typed. */
function useDiverName() {
  const { t } = useTranslation();
  return (d: { name: string }, index: number) => d.name.trim() || t('tools.plan.diverN', { n: index + 1 });
}

/** What both lists need to open, close and leave their fields. */
interface ListControl {
  open: Open;
  setOpen: (open: Open) => void;
  set: (change: Partial<ToolsParams>) => void;
  /** The ids of a line's pencil and of a list's "add", to move focus back to them. */
  editId: (list: 'levels' | 'divers', index: number) => string;
  addId: (list: 'levels' | 'divers') => string;
  focus: (id: string) => void;
}

/**
 * A gas plan (ADR 0033): levels and Divers in the address, each a list of lines with one set of fields open at a time;
 * the plan drawn like a dive, the answer per Diver with the controlling Diver marked, the rule's own words and where each
 * SAC came from. An estimate, not advice: the notice at the top of the page covers it.
 */
export function PlanSection({ params, plan, managed, settings }: {
  params: ToolsParams; plan: PlanQuery; managed: ManagedDiver[];
  /** The plan's rarely changed settings, under its lists. */
  settings: ReactNode;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const name = useDiverName();
  const baseId = useId();
  const [open, setOpen] = useState<Open>(null);
  const levels = params.levels ?? [];
  const divers = params.divers ?? [];
  const empty = levels.length === 0 || divers.length === 0;
  // While a change is on its way the answer is the one before it: its stretches and Divers would not be the ones listed.
  const answered = plan.data?.status === 'ok' && !empty
    && plan.data.segments.filter((s) => s.kind === 'level').length === levels.length && plan.data.divers.length === divers.length
    ? plan.data : undefined;
  // Until there is an answer (no mix or Diver yet, or a change on its way) the levels alone give the profile; not beyond the limits.
  // Kept while the levels and rates stay the same: the chart is drawn anew for new points.
  const levelsKey = levels.map((l) => `${l.depth}x${l.minutes}`).join();
  const outside = plan.data?.status === 'outside_limits' && !empty;
  const sketched = useMemo(() => {
    const segments = outside ? undefined : planSketch(levels, { descentRate: params.dr, ascentRate: params.ar });
    return segments && { segments, divers: [], leaveLastLevelAtMinute: 0, fits: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the levels by their values, not by the array of this render
  }, [levelsKey, outside, params.dr, params.ar]);
  const control: ListControl = {
    open, setOpen,
    set: (change) => replaceToolsAddress({ ...params, ...change }),
    editId: (list, index) => `${baseId}-${list}-${index}`,
    addId: (list) => `${baseId}-${list}-add`,
    // After the fields fold away: the line's pencil, or the list's "add", so the keyboard stays where the User was.
    focus: (id) => requestAnimationFrame(() => document.getElementById(id)?.focus()),
  };
  return (
    <section className="panel" aria-labelledby="tools-plan">
      <div className="panel-head"><h2 id="tools-plan">{t('tools.plan.title')}</h2></div>
      <Muted>{t('tools.plan.lead')}</Muted>
      <div className="plan-mix">
        <NumberField
          label={t('tools.plan.mix')} unit="%" placeholder="21" description={t('tools.plan.mixHint')}
          value={params.mix ?? Number.NaN} onChange={(v) => control.set({ mix: num(v) })}
          minValue={21} maxValue={40} formatOptions={{ maximumFractionDigits: 0 }}
        />
      </div>
      {answered ? <PlanProfile plan={answered} names={answered.divers.map(name)} />
        : sketched && <PlanProfile plan={sketched} names={NO_NAMES} />}
      <Levels params={params} levels={levels} divers={divers} segments={answered?.segments ?? sketched?.segments} managed={managed} control={control} />
      <DiverRows params={params} divers={divers} answered={answered} managed={managed} control={control} />
      {settings}
      {empty && <Muted>{t('tools.plan.empty')}</Muted>}
      {plan.error != null && <Notice tone="danger">{errorText(plan.error)}</Notice>}
      {plan.data && !empty && <PlanAnswer plan={plan.data} params={params} />}
    </section>
  );
}

/** A line's pencil and bin: always in sight, named for screen readers by what they act on. */
function RowActions({ id, isOpen, editLabel, removeLabel, onEdit, onRemove }: {
  id: string; isOpen: boolean; editLabel: string; removeLabel: string; onEdit: () => void; onRemove: () => void;
}) {
  return (
    <span className="plan-actions">
      <Button id={id} variant="quiet" size="small" icon="edit" aria-label={editLabel} aria-expanded={isOpen} onPress={onEdit} />
      <Button variant="quiet" size="small" icon="delete" aria-label={removeLabel} onPress={onRemove} />
    </span>
  );
}

/** The fields of the open line, under it; "Done" folds them away (they apply as they are typed: the plan lives in the address). */
function Editor({ label, onDone, children }: { label: string; onDone: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="plan-editor" role="group" aria-label={label}>
      <div className="form-grid tools-grid">{children}</div>
      <Button onPress={onDone}>{t('common.done')}</Button>
    </div>
  );
}

const newDiver = (name: string, params: ToolsParams, diverId?: string): PlanDiver => ({
  // The address separates a Diver's values with "~".
  name: name.replaceAll('~', ' ').trim(), diverId,
  volume: params.volume ?? DEFAULT_CYLINDER.volume, pressure: params.pressure ?? DEFAULT_CYLINDER.pressure,
});

/**
 * The plan's levels as a list: depth, minutes there and the run time at its end. With an answer, the way down, between
 * the levels and up (with the safety stop) are lines of their own, as the plan counts them. The first level brings the
 * User's own Diver, so a plan for oneself needs nothing more.
 */
function Levels({ params, levels, divers, segments, managed, control }: {
  params: ToolsParams; levels: PlanLevel[]; divers: PlanDiver[]; segments: PlanStretch[] | undefined; managed: ManagedDiver[]; control: ListControl;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const headingId = useId();
  const { units, locale } = display;
  const { open, setOpen, set, editId, addId, focus } = control;
  const change = (index: number, patch: Partial<PlanLevel>) => set({ levels: levels.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const minutes = (m: number) => t('tools.plan.minutes', { value: number.format(m) });

  // Every stretch of the answer in its order, or the levels alone while there is none.
  type Line = { level: number; until: number | null } | { level: null; kind: 'descent' | 'ascent' | 'safety_stop'; from: number; to: number; minutes: number; until: number };
  const lines: Line[] = [];
  if (segments) {
    let level = 0;
    let run = 0;
    for (const s of segments) {
      run += s.minutes;
      lines.push(s.kind === 'level' ? { level: level++, until: run } : { level: null, kind: s.kind, from: s.fromDepthM, to: s.depthM, minutes: s.minutes, until: run });
    }
  } else {
    levels.forEach((_l, i) => lines.push({ level: i, until: null }));
  }
  const until = (m: number | null) => m !== null && <><span className="visually-hidden">{t('tools.plan.col.until')}: </span>{minutes(m)}</>;

  const add = () => {
    const own = managed.find((d) => d.isOwn);
    set({
      levels: [...levels, { depth: levels.at(-1)?.depth ?? params.depth ?? 18, minutes: 10 }],
      ...(levels.length === 0 && divers.length === 0 && own && { divers: [newDiver(own.name, params, own.id)] }),
    });
    setOpen({ list: 'levels', index: levels.length });
  };

  return (
    <div className="plan-part" role="group" aria-labelledby={headingId}>
      <h3 className="subheading" id={headingId}>{t('tools.plan.levels')}</h3>
      {levels.length > 0 && (
        <ul className="plan-list plan-levels" aria-label={t('tools.plan.levels')}>
          <li className="plan-row plan-head" aria-hidden="true">
            <span />
            <span className="plan-num">{t('tools.plan.col.depth')}</span>
            <span className="plan-num">{t('tools.plan.col.time')}</span>
            <span className="plan-num plan-until">{t('tools.plan.col.until')}</span>
            <span />
          </li>
          {lines.map((line, at) => {
            if (line.level === null) {
              return (
                <li className="plan-row plan-quiet" key={`move-${at}`}>
                  <span>{t(`tools.plan.segment.${line.kind}`)}</span>
                  <span className="plan-num">{line.from === line.to ? display.depth(line.to) : t('tools.plan.fromTo', { from: display.depth(line.from), to: display.depth(line.to) })}</span>
                  <span className="plan-num">{minutes(line.minutes)}</span>
                  <span className="plan-num plan-until">{until(line.until)}</span>
                  <span />
                </li>
              );
            }
            const i = line.level;
            const level = levels[i]!;
            const isOpen = open?.list === 'levels' && open.index === i;
            const close = () => { setOpen(null); focus(editId('levels', i)); };
            return (
              <li className="plan-row" key={`level-${i}`}>
                <span className="plan-name">{t('tools.plan.levelN', { n: i + 1 })}</span>
                <span className="plan-num">{display.depth(level.depth)}</span>
                <span className="plan-num">{minutes(level.minutes)}</span>
                <span className="plan-num plan-until">{until(line.until)}</span>
                <RowActions
                  id={editId('levels', i)} isOpen={isOpen}
                  editLabel={t('tools.plan.editLevel', { n: i + 1 })} removeLabel={t('tools.plan.removeLevel', { n: i + 1 })}
                  onEdit={() => (isOpen ? close() : setOpen({ list: 'levels', index: i }))}
                  onRemove={() => { set({ levels: levels.filter((_, j) => j !== i) }); setOpen(null); focus(addId('levels')); }}
                />
                {isOpen && (
                  <Editor label={t('tools.plan.levelN', { n: i + 1 })} onDone={close}>
                    <NumberField
                      autoFocus label={t('tools.plan.depth')} unit={display.unit('depth')}
                      value={Math.round(depthIn(level.depth, units))}
                      onChange={(v) => !Number.isNaN(v) && change(i, { depth: tenth(depthFromDisplay(v, units)) })}
                      minValue={1} maxValue={units === 'imperial' ? 985 : 300} formatOptions={{ maximumFractionDigits: 0 }}
                    />
                    <NumberField
                      label={t('tools.plan.time')} description={t('tools.plan.timeHint')} unit="min" value={level.minutes}
                      onChange={(v) => !Number.isNaN(v) && change(i, { minutes: v })} minValue={0} maxValue={600} formatOptions={{ maximumFractionDigits: 0 }}
                    />
                  </Editor>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {levels.length < MAX_ROWS && (
        <Button id={addId('levels')} className="plan-add" variant="quiet" icon="add" onPress={add}>{t('tools.plan.addLevel')}</Button>
      )}
    </div>
  );
}

/**
 * The plan's Divers as a list: who, their cylinder and their SAC. A new one is found by name among every Diver of the
 * instance (ADR 0028) or added as a guest by the name typed; then their fields open. Only of a Diver the User manages
 * the SAC comes from the logbook: for everyone else it is typed, or 20 L/min.
 */
function DiverRows({ params, divers, answered, managed, control }: {
  params: ToolsParams; divers: PlanDiver[]; answered: OkPlan | undefined; managed: ManagedDiver[]; control: ListControl;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const headingId = useId();
  const { units } = display;
  const name = useDiverName();
  const { open, setOpen, set, editId, addId, focus } = control;
  const change = (index: number, patch: Partial<PlanDiver>) => set({ divers: divers.map((d, i) => (i === index ? { ...d, ...patch } : d)) });
  const yours = new Set(managed.map((d) => d.id));
  const finding = open?.list === 'divers' && open.index === 'new';
  const sacText = (sac: ToolsPlanDiver['sacLpm']) => {
    const value = t('tools.plan.sac', { value: sac.value });
    if (sac.source === 'logbook') return t('tools.plan.sacFromDives', { value, count: sac.basedOn ?? 0 });
    return sac.source === 'default' ? t('tools.plan.sacDefault', { value }) : value;
  };

  return (
    <div className="plan-part" role="group" aria-labelledby={headingId}>
      <h3 className="subheading" id={headingId}>{t('tools.plan.divers')}</h3>
      {divers.length > 0 && (
        <ul className="plan-list" aria-label={t('tools.plan.divers')}>
          {divers.map((diver, i) => {
            const answer = answered?.divers[i];
            const isOpen = open?.list === 'divers' && open.index === i;
            const close = () => { setOpen(null); focus(editId('divers', i)); };
            const who = !diver.diverId ? 'guest' : yours.has(diver.diverId) ? 'yours' : 'other';
            return (
              <li className="plan-row plan-diver" key={i}>
                <span className="plan-diver-text">
                  <span className="plan-name"><span translate="no">{name(diver, i)}</span>{answer?.controlling && <> <Badge>{t('tools.plan.controls')}</Badge></>}</span>
                  <span className="plan-detail">
                    {[`${diver.volume} L`, display.pressure(diver.pressure), answer ? sacText(answer.sacLpm) : diver.sac !== undefined ? t('tools.plan.sac', { value: diver.sac }) : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
                <RowActions
                  id={editId('divers', i)} isOpen={isOpen}
                  editLabel={t('tools.plan.editDiver', { name: name(diver, i) })} removeLabel={t('tools.plan.removeDiver', { name: name(diver, i) })}
                  onEdit={() => (isOpen ? close() : setOpen({ list: 'divers', index: i }))}
                  onRemove={() => { set({ divers: divers.filter((_, j) => j !== i) }); setOpen(null); focus(addId('divers')); }}
                />
                {isOpen && (
                  <Editor label={name(diver, i)} onDone={close}>
                    {who === 'guest' && <TextField label={t('tools.plan.name')} value={diver.name} onChange={(v) => change(i, { name: v.replaceAll('~', ' ') })} maxLength={80} />}
                    <NumberField
                      autoFocus={who !== 'guest'} label={t('tools.bottom.volume')} unit="L" value={diver.volume}
                      onChange={(v) => !Number.isNaN(v) && change(i, { volume: v })} minValue={1} maxValue={60} formatOptions={{ maximumFractionDigits: 1 }}
                    />
                    <NumberField
                      label={t('tools.bottom.pressure')} unit={display.unit('pressure')} value={Math.round(pressureIn(diver.pressure, units))}
                      onChange={(v) => !Number.isNaN(v) && change(i, { pressure: tenth(pressureFromDisplay(v, units)) })}
                      minValue={1} maxValue={units === 'imperial' ? 5000 : 350} formatOptions={{ maximumFractionDigits: 0 }}
                    />
                    <NumberField
                      label={t('tools.bottom.sac')} unit="L/min" description={t(`tools.plan.sacHint.${who}`)}
                      // What applies while the field is empty: the planning SAC the answer found, or the default.
                      placeholder={answer && answer.sacLpm.source !== 'request' ? String(answer.sacLpm.value) : who === 'yours' ? t('tools.plan.sacFromLogbook') : '20'}
                      value={diver.sac ?? Number.NaN} onChange={(v) => change(i, { sac: num(v) })} minValue={1} maxValue={100} formatOptions={{ maximumFractionDigits: 1 }}
                    />
                  </Editor>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {finding ? (
        <FindDiver
          taken={new Set(divers.flatMap((d) => (d.diverId ? [d.diverId] : [])))}
          onPick={(picked) => {
            set({ divers: [...divers, newDiver(picked.name, params, picked.diverId)] });
            setOpen({ list: 'divers', index: divers.length });
          }}
          onCancel={() => { setOpen(null); focus(addId('divers')); }}
        />
      ) : divers.length < MAX_ROWS && (
        <Button id={addId('divers')} className="plan-add" variant="quiet" icon="add" onPress={() => setOpen({ list: 'divers', index: 'new' })}>{t('tools.plan.addDiver')}</Button>
      )}
    </div>
  );
}

/**
 * Finds the plan's next Diver while typing (ux-search): every Diver of the instance by name, the User's own first, and
 * always a way on: the name typed as a guest, who is in this plan's address and nowhere else.
 */
function FindDiver({ taken, onPick, onCancel }: {
  taken: Set<string>; onPick: (picked: { name: string; diverId?: string }) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const query = text.trim();
  const found = useQuery(diverSearchQuery(query));
  const choices = (found.data ?? []).filter((x) => !taken.has(x.id));
  const items: SearchListItem[] = choices.map((x) => ({ id: x.id, name: x.name, detail: t(x.managed ? 'tools.plan.find.yours' : 'tools.plan.find.other') }));
  if (query) items.push({ id: GUEST, name: t('tools.plan.find.guest', { name: query }), detail: t('tools.plan.find.guestDetail') });
  return (
    <div className="plan-editor plan-find" role="group" aria-label={t('tools.plan.addDiver')}>
      <SearchList
        label={t('tools.plan.find.label')} description={t('tools.plan.find.hint')} query={text} onQueryChange={setText} autoFocus
        items={items} listLabel={t('tools.plan.divers')} status={found.isPending ? t('common.loading') : null} empty={t('tools.plan.find.empty')}
        onPick={(id) => {
          const diver = choices.find((x) => x.id === id);
          onPick(diver ? { name: diver.name, diverId: diver.id } : { name: query });
        }}
      />
      <Button onPress={onCancel}>{t('common.cancel')}</Button>
    </div>
  );
}

function PlanAnswer({ plan, params }: { plan: ToolsPlan; params: ToolsParams }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const name = useDiverName();
  const levels = params.levels ?? [];
  if (plan.status === 'outside_limits') {
    const level = plan.levelIndex === null ? undefined : levels[plan.levelIndex];
    return (
      <div className="tools-answer">
        <Notice>
          <strong>{t('tools.bottom.outside')}</strong>{' '}
          {t(`tools.plan.outsideReason.${plan.reason}`, { depth: level ? display.depth(level.depth) : '' })}
        </Notice>
      </div>
    );
  }
  const controlling = plan.divers[plan.controllingIndex]!;
  const rule = plan.used.gasRule.value.kind as ToolsRule;
  const turn = plan.divers.some((d) => d.turnPressureBar !== null);
  const lastLevel = levels.at(-1);
  const mix = params.mix ?? 21;
  const source = (s: string) => t(`tools.source.${s}` as 'tools.source.default');
  const minute = (n: number) => String(Math.max(0, Math.floor(n)));
  const rate = (r: { value: number; source: string }) => `${formatRate(r.value, display.units, display.locale)} (${source(r.source)})`;
  return (
    <div className="tools-answer">
      {plan.divers.some((d) => d.recentDiveEndedAt) && <Notice>{t('tools.plan.recent')}</Notice>}
      <Notice>{t('tools.plan.noNdl')}</Notice>
      {plan.fits ? (
        <p className="tools-result" data-testid="plan-fits">
          <span className="tools-result-label">{t('tools.plan.fits')}</span>{' '}
          <strong>{t('tools.plan.fitsUntil', { minute: minute(plan.leaveLastLevelAtMinute) })}</strong>
        </p>
      ) : (
        <Notice tone="danger">
          <strong>{t('tools.plan.doesNotFit')}</strong>{' '}
          {t('tools.plan.leaveBy', { depth: lastLevel ? display.depth(lastLevel.depth) : '', minute: minute(plan.leaveLastLevelAtMinute) })}
        </Notice>
      )}
      <p data-testid="plan-briefing">{t(turn ? 'tools.plan.briefingTurn' : 'tools.plan.briefing', { name: name(controlling, plan.controllingIndex) })}</p>
      <Table
        cards label={t('tools.plan.resultCaption')}
        head={[
          t('tools.plan.col.diver'),
          ...[t('tools.plan.col.gas'), t('tools.plan.col.end'), t('tools.plan.col.rockBottom'), ...(turn ? [t('tools.plan.col.turn')] : []), t('tools.plan.col.ascend'), t('tools.plan.col.margin')]
            .map((label) => ({ label, numeric: true as const })),
        ]}
      >
        {plan.divers.map((d, i) => <DiverResult key={i} d={d} index={i} turn={turn} />)}
      </Table>
      {plan.divers.some((d) => d.belowRockBottom) && <Notice>{t('tools.plan.belowRockBottom')}</Notice>}
      {levels.length > 1 && (
        <Muted>{t('tools.plan.rockBottomLevels', { levels: levels.map((l, i) => `${display.depth(l.depth)}: ${display.pressure(controlling.rockBottom[i]?.pressureBar ?? null)}`).join(', ') })}</Muted>
      )}
      <h3 className="subheading">{t('tools.bottom.assumptions')}</h3>
      <ul className="tools-assumptions">
        {plan.divers.map((d, i) => (
          <li key={i}>
            {d.sacLpm.basedOn !== undefined && d.sacLpm.source !== 'request'
              ? t('tools.plan.assumedSacBased', { name: name(d, i), value: d.sacLpm.value, source: source(d.sacLpm.source), count: d.sacLpm.basedOn })
              : t('tools.plan.assumedSac', { name: name(d, i), value: d.sacLpm.value, source: source(d.sacLpm.source) })}
          </li>
        ))}
        <li>{t(mix === 21 ? 'tools.plan.assumedAir' : 'tools.plan.assumedNitrox', { o2: mix, source: source(params.mix === undefined ? 'default' : 'request') })}</li>
        <li>{t('tools.assumed.rule', { rule: t(`tools.rules.${rule}.name`), source: source(plan.used.gasRule.source) })}</li>
        <li>{t('tools.assumed.water', { value: t(`tools.water.${plan.used.water.value as 'salt'}`).toLowerCase(), source: source(plan.used.water.source) })}</li>
        <li>{t('tools.plan.assumedRates', { descent: rate(plan.used.descentRateMPerMin), ascent: rate(plan.used.ascentRateMPerMin) })}</li>
        <li>{t('tools.plan.assumedModel')}</li>
      </ul>
      <Muted>{t('tools.flying')}</Muted>
    </div>
  );
}

function DiverResult({ d, index, turn }: { d: ToolsPlanDiver; index: number; turn: boolean }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const name = useDiverName();
  const highest = Math.max(...d.rockBottom.map((r) => r.pressureBar));
  return (
    <tr data-controlling={d.controlling || undefined}>
      <th scope="row">
        {name(d, index)}
        {d.controlling && <> <Badge>{t('tools.plan.controls')}</Badge></>}
      </th>
      <td className="num">{Math.round(d.litres)} L</td>
      <td className="num">{display.pressure(d.endPressureBar)}</td>
      <td className="num">{display.pressure(highest)}</td>
      {turn && <td className="num">{d.turnPressureBar === null ? '' : display.pressure(d.turnPressureBar)}</td>}
      <td className="num">{display.pressure(d.ascentPressureBar)}</td>
      <td className="num">{display.pressure(d.marginBar)}</td>
    </tr>
  );
}

/** The gas rule's controls and its words, in the Settings (ADR 0033: every rule explained, with who teaches it and when it is not enough). */
export function RuleExplanation({ rule }: { rule: NonNullable<ToolsParams['rule']> }) {
  const { t } = useTranslation();
  return (
    <div className="tools-rule" data-testid="rule-explanation">
      <p>{t(`tools.rules.${rule}.about`)}</p>
      <p>{t(`tools.rules.${rule}.limits`)}</p>
    </div>
  );
}
