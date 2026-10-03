import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDateTime } from '@internationalized/date';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, keys, unwrap, type DiveValues, type DiveView, type OverridableField } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { useFormatValue } from './lib/dive-values.ts';
import { depthFromDisplay, depthIn, temperatureFromDisplay, temperatureIn } from './lib/units.ts';
import { Button, DateTimeField, Form, Notice, NumberField, Select, TextArea } from './ui/index.ts';

type WaterType = NonNullable<DiveValues['waterType']>;
const WATER_TYPES: WaterType[] = ['fresh', 'salt', 'brackish', 'en13319', 'custom'];

/** The form's values, in the User's display units (feet, °F, minutes, local time at the site). */
interface Draft {
  number: number;
  start: CalendarDateTime;
  offsetHours: number;
  durationMin: number;
  maxDepth: number;
  avgDepth: number;
  waterTemperature: number;
  waterType: WaterType | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const numberOrNaN = (n: number | null) => (n === null ? Number.NaN : n);
const nanToNull = (n: number) => (Number.isNaN(n) ? null : n);

/** The dive's local wall-clock time: UTC plus its offset (or the browser's, if unknown). */
function localStart(s: DiveValues['startsAt']) {
  const offset = s.utcOffsetSeconds ?? -new Date(s.at).getTimezoneOffset() * 60;
  const local = new Date(Date.parse(s.at) + offset * 1000);
  return {
    start: new CalendarDateTime(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes()),
    offsetHours: offset / 3600,
  };
}

function draftOf(v: DiveValues, units: 'metric' | 'imperial'): Draft {
  return {
    number: numberOrNaN(v.number),
    ...localStart(v.startsAt),
    durationMin: Math.round(v.durationSeconds / 60),
    maxDepth: v.maxDepthM === null ? Number.NaN : round1(depthIn(v.maxDepthM, units)),
    avgDepth: v.avgDepthM === null ? Number.NaN : round1(depthIn(v.avgDepthM, units)),
    waterTemperature: v.waterTemperatureC === null ? Number.NaN : round1(temperatureIn(v.waterTemperatureC, units)),
    waterType: v.waterType,
  };
}

/** Draft fields → the Dive value they edit. */
const FIELD_OF: Record<keyof Draft, OverridableField> = {
  number: 'number', start: 'startsAt', offsetHours: 'startsAt', durationMin: 'durationSeconds',
  maxDepth: 'maxDepthM', avgDepth: 'avgDepthM', waterTemperature: 'waterTemperatureC', waterType: 'waterType',
};

export function DiveEditForm({ dive: d, onDone }: { dive: DiveView; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const format = useFormatValue();
  const queryClient = useQueryClient();
  const { units } = display;
  const [draft, setDraft] = useState(() => draftOf(d.values, units));
  const [notes, setNotes] = useState(d.notes ?? '');
  const [touched, setTouched] = useState<Set<OverridableField>>(new Set());
  const [reset, setReset] = useState<Set<OverridableField>>(new Set());

  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    const field = FIELD_OF[key];
    setDraft((old) => ({ ...old, [key]: value }));
    setTouched((old) => new Set(old).add(field));
    setReset((old) => { const next = new Set(old); next.delete(field); return next; });
  };
  const resetToRecording = (field: OverridableField) => {
    if (!d.fromRecording) return;
    const fromRecording = draftOf(d.fromRecording, units);
    const keys = (Object.keys(FIELD_OF) as (keyof Draft)[]).filter((k) => FIELD_OF[k] === field);
    setDraft((old) => ({ ...old, ...Object.fromEntries(keys.map((k) => [k, fromRecording[k]])) }));
    setTouched((old) => { const next = new Set(old); next.delete(field); return next; });
    setReset((old) => new Set(old).add(field));
  };

  const save = useMutation({
    mutationFn: async () => {
      const set: Partial<DiveValues> = {};
      for (const field of touched) {
        switch (field) {
          case 'number': set.number = nanToNull(draft.number); break;
          case 'startsAt': {
            const s = draft.start;
            const offsetSeconds = Math.round(draft.offsetHours * 4) * 900; // quarter hours
            const at = new Date(Date.UTC(s.year, s.month - 1, s.day, s.hour, s.minute) - offsetSeconds * 1000).toISOString();
            set.startsAt = { at, utcOffsetSeconds: offsetSeconds };
            break;
          }
          case 'durationSeconds': set.durationSeconds = (nanToNull(draft.durationMin) ?? 0) * 60; break;
          case 'maxDepthM': set.maxDepthM = Number.isNaN(draft.maxDepth) ? null : depthFromDisplay(draft.maxDepth, units); break;
          case 'avgDepthM': set.avgDepthM = Number.isNaN(draft.avgDepth) ? null : depthFromDisplay(draft.avgDepth, units); break;
          case 'waterTemperatureC':
            set.waterTemperatureC = Number.isNaN(draft.waterTemperature) ? null : temperatureFromDisplay(draft.waterTemperature, units);
            break;
          case 'waterType': set.waterType = draft.waterType; break;
        }
      }
      return unwrap(await api.PATCH('/api/dives/{id}', {
        params: { path: { id: d.id } },
        body: { version: d.version, set, reset: [...reset], notes: notes.trim() === '' ? null : notes },
      }));
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.dive(d.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.revisions(d.id) });
      void queryClient.invalidateQueries({ queryKey: keys.dives, exact: true });
      onDone();
    },
  });
  const changedMeanwhile = save.error instanceof ApiError && save.error.code === 'dive_changed';

  /** The field's description: what the recording says, or that it goes back to that on save. */
  const hint = (field: OverridableField): string => {
    const recorded = format(field, d.fromRecording?.[field]);
    return reset.has(field) ? t('dive.willReset', { value: recorded }) : t('dive.fromRecording', { value: recorded });
  };
  /** Below a field set by hand: the mark, and the way back to the recording's value. */
  const origin = (field: OverridableField): ReactNode => {
    const overridden = (d.overrides.includes(field) || touched.has(field)) && !reset.has(field);
    if (!overridden || !d.fromRecording) return null;
    return (
      <span className="field-origin">
        <span className="badge">{t('dive.edited')}</span>
        <Button variant="quiet" onPress={() => resetToRecording(field)}>
          {t('dive.resetToRecording')} ({format(field, d.fromRecording[field])})
        </Button>
      </span>
    );
  };

  return (
    <Form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="form-grid">
        <div className="field-block">
          <NumberField label={t('dive.number')} description={hint('number')} value={draft.number} onChange={(n) => change('number', n)} minValue={0} maxValue={100_000} step={1} />
          {origin('number')}
        </div>
        <div className="field-block">
          <DateTimeField label={t('dive.start')} description={hint('startsAt')} value={draft.start} onChange={(v) => v && change('start', v as CalendarDateTime)} isRequired />
          <NumberField
            label={t('dive.utcOffset')} value={draft.offsetHours} onChange={(n) => change('offsetHours', n)}
            minValue={-12} maxValue={14} step={0.25} formatOptions={{ signDisplay: 'always', maximumFractionDigits: 2 }}
          />
          {origin('startsAt')}
        </div>
        <div className="field-block">
          <NumberField label={t('dive.duration')} description={hint('durationSeconds')} unit={display.unit('minutes')} value={draft.durationMin} onChange={(n) => change('durationMin', n)} minValue={0} maxValue={2880} isRequired />
          {origin('durationSeconds')}
        </div>
        <div className="field-block">
          <NumberField label={t('dive.maxDepth')} description={hint('maxDepthM')} unit={display.unit('depth')} value={draft.maxDepth} onChange={(n) => change('maxDepth', n)} minValue={0} formatOptions={{ maximumFractionDigits: 1 }} />
          {origin('maxDepthM')}
        </div>
        <div className="field-block">
          <NumberField label={t('dive.avgDepth')} description={hint('avgDepthM')} unit={display.unit('depth')} value={draft.avgDepth} onChange={(n) => change('avgDepth', n)} minValue={0} formatOptions={{ maximumFractionDigits: 1 }} />
          {origin('avgDepthM')}
        </div>
        <div className="field-block">
          <NumberField label={t('dive.waterTemperature')} description={hint('waterTemperatureC')} unit={display.unit('temperature')} value={draft.waterTemperature} onChange={(n) => change('waterTemperature', n)} formatOptions={{ maximumFractionDigits: 1 }} />
          {origin('waterTemperatureC')}
        </div>
        <div className="field-block">
          <Select<WaterType>
            label={t('dive.waterType')}
            description={hint('waterType')}
            value={draft.waterType}
            onChange={(v) => change('waterType', v)}
            options={WATER_TYPES.map((w) => ({ id: w, label: t(`vocabulary.waterType.${w}`) }))}
          />
          {origin('waterType')}
        </div>
      </div>
      <TextArea label={t('dive.notes')} value={notes} onChange={setNotes} maxLength={20_000} />
      {save.error && (
        <Notice tone="danger">
          <p>{changedMeanwhile ? t('dive.changedMeanwhile') : errorText(save.error)}</p>
          {changedMeanwhile && (
            <Button onPress={() => { void queryClient.invalidateQueries({ queryKey: keys.dive(d.id) }); onDone(); }}>{t('dive.reload')}</Button>
          )}
        </Notice>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" isPending={save.isPending}>{t('dive.save')}</Button>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
      </div>
    </Form>
  );
}
