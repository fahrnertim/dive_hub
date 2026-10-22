// A Dive's exposure suit, Lead and weighting feedback (ADR 0031): in words on the dive page and in its history, and
// as a group of fields in the Dive's form.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDisplay } from './lib/display.ts';
import {
  LEAD_PLACEMENTS, SUIT_TYPES, SUIT_UNDERGARMENTS, WEIGHTING_FELT, emptyLead, hasThickness, leadTotal, wornSuit,
  type LeadEntry, type Suit, type WeightingDraft, type WeightingFeedback,
} from './lib/weighting.ts';
import { massIn } from './lib/units.ts';
import { Button, Muted, NumberField, Select } from './ui/index.ts';

/** Lead, weighting feedback and suit in words. */
export function useWeightingText() {
  const { t } = useTranslation();
  const display = useDisplay();
  return {
    /** "8 kg (6 kg on a belt, 2 kg trim)"; the parts only where they say more than the total. */
    lead(entries: LeadEntry[]): string {
      const total = Math.round(entries.reduce((sum, e) => sum + e.amountKg, 0) * 100) / 100;
      if (total === 0) return t('weighting.noLead');
      const part = (e: LeadEntry) => (e.placement ? t(`weighting.leadAt.${e.placement}`, { amount: display.mass(e.amountKg) }) : display.mass(e.amountKg));
      if (entries.length === 1) return part(entries[0]!);
      return t('weighting.leadWithParts', { total: display.mass(total), parts: entries.map(part).join(', ') });
    },
    feedback: (f: WeightingFeedback): string => (f.felt !== 'right' && f.amountKg !== null
      ? t(`weighting.feltText.${f.felt}By`, { amount: display.mass(f.amountKg) })
      : t(`weighting.feltText.${f.felt}`)),
    suit: (s: Suit): string => [
      t(`vocabulary.suitType.${s.type}`),
      s.thicknessMm !== null && display.thickness(s.thicknessMm),
      s.undergarment && t(`weighting.undergarmentText.${s.undergarment}`),
      s.hood !== null && t(s.hood ? 'weighting.withHood' : 'weighting.withoutHood'),
    ].filter(Boolean).join(', '),
  };
}

/** Suit, lead and how the weighting felt in the Dive's form. Nothing here is required: what is left empty stays unknown. */
export function WeightingFields({ draft, onChange, autoFocus, hint }: { draft: WeightingDraft; onChange: (next: WeightingDraft) => void; autoFocus?: boolean; hint?: ReactNode }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const { units } = display;
  const set = (change: Partial<WeightingDraft>) => onChange({ ...draft, ...change });
  const setLead = (key: string, change: Partial<WeightingDraft['lead'][number]>) =>
    set({ lead: draft.lead.map((e) => (e.key === key ? { ...e, ...change } : e)) });
  const total = leadTotal(draft.lead);
  const several = draft.lead.length > 1;

  return (
    <div className="weighting-fields">
      <h2 className="subheading">{t('weighting.title')}</h2>
      <div className="form-grid">
        <Select
          label={t('weighting.suit')} value={draft.suitType ?? 'unknown'}
          options={[{ id: 'unknown' as const, label: t('weighting.notKnown') }, ...SUIT_TYPES.map((s) => ({ id: s, label: t(`vocabulary.suitType.${s}`) }))]}
          onChange={(type) => set({ suitType: type === 'unknown' || type === null ? null : type })}
        />
        {hasThickness(draft.suitType) && (
          <NumberField label={t('weighting.thickness')} unit="mm" value={draft.thicknessMm} onChange={(thicknessMm) => set({ thicknessMm })} minValue={0.5} maxValue={20} formatOptions={{ maximumFractionDigits: 1 }} />
        )}
        {draft.suitType === 'drysuit' && (
          <Select
            label={t('weighting.undergarment')} value={draft.undergarment ?? 'unknown'}
            options={[{ id: 'unknown' as const, label: t('weighting.notKnown') }, ...SUIT_UNDERGARMENTS.map((u) => ({ id: u, label: t(`vocabulary.suitUndergarment.${u}`) }))]}
            onChange={(u) => set({ undergarment: u === 'unknown' || u === null ? null : u })}
          />
        )}
        {wornSuit(draft.suitType) && (
          <Select
            label={t('weighting.hood')} value={draft.hood === null ? 'unknown' : draft.hood ? 'yes' : 'no'}
            options={[{ id: 'unknown', label: t('weighting.notSaid') }, { id: 'yes', label: t('weighting.hoodYes') }, { id: 'no', label: t('weighting.hoodNo') }]}
            onChange={(hood) => set({ hood: hood === 'yes' ? true : hood === 'no' ? false : null })}
          />
        )}
      </div>
      {hint}
      {draft.lead.map((e, i) => (
        <div key={e.key} className="lead-row">
          <NumberField
            autoFocus={autoFocus === true && i === 0}
            label={several ? t('weighting.leadN', { n: i + 1 }) : t('weighting.lead')} {...(i === 0 && { description: t('weighting.leadHelp') })}
            unit={display.unit('mass')} value={e.amount} onChange={(amount) => setLead(e.key, { amount })}
            minValue={0} maxValue={Math.floor(massIn(60, units))} formatOptions={{ maximumFractionDigits: 1 }}
          />
          <Select
            label={t('weighting.placementN', { n: i + 1 })} value={e.placement ?? 'unknown'}
            options={[{ id: 'unknown' as const, label: t('weighting.notSaid') }, ...LEAD_PLACEMENTS.map((p) => ({ id: p, label: t(`vocabulary.leadPlacement.${p}`) }))]}
            onChange={(p) => setLead(e.key, { placement: p === 'unknown' || p === null ? null : p })}
          />
          {several && (
            <Button variant="quiet" size="small" icon="delete" onPress={() => set({ lead: draft.lead.filter((x) => x.key !== e.key) })}>
              {t('weighting.removeLead', { n: i + 1 })}
            </Button>
          )}
        </div>
      ))}
      <div className="form-actions">
        {draft.lead.length < 8 && <Button icon="add" onPress={() => set({ lead: [...draft.lead, emptyLead()] })}>{t('weighting.addLead')}</Button>}
        {several && total !== null && <Muted>{t('weighting.total', { total: `${new Intl.NumberFormat(display.locale, { maximumFractionDigits: 1 }).format(total)} ${display.unit('mass')}` })}</Muted>}
      </div>
      <div className="form-grid">
        <Select
          label={t('weighting.felt')} value={draft.felt ?? 'unknown'}
          options={[{ id: 'unknown' as const, label: t('weighting.notSaid') }, ...WEIGHTING_FELT.map((f) => ({ id: f, label: t(`vocabulary.weightingFelt.${f}`) }))]}
          onChange={(felt) => set({ felt: felt === 'unknown' || felt === null ? null : felt })}
        />
        {draft.felt !== null && draft.felt !== 'right' && (
          <NumberField label={t('weighting.feltAmount')} unit={display.unit('mass')} value={draft.feltAmount} onChange={(feltAmount) => set({ feltAmount })} minValue={0} maxValue={Math.floor(massIn(30, units))} formatOptions={{ maximumFractionDigits: 1 }} />
        )}
      </div>
    </div>
  );
}
