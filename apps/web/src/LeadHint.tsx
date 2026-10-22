import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { diversQuery, leadEstimateQuery } from './api.ts';
import type { CylinderDraft } from './lib/cylinders.ts';
import { useDisplay } from './lib/display.ts';
import { toolsHref, type LeadCylinder, type LeadWater, type ToolsParams } from './lib/tools.ts';
import { massFromDisplay } from './lib/units.ts';
import type { WeightingDraft } from './lib/weighting.ts';
import { Muted } from './ui/index.ts';

const orUndefined = <T,>(v: T | null) => (v === null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : v);

/**
 * "Last time with this suit: 8 kg, felt right" (ADR 0031): what the Diver carried the last time, from the lead estimate's
 * basis. It asks only when the Dive has a water type (its site's, ADR 0025), a suit and Cylinders with a size, and only for
 * a Diver the User keeps. Nothing is filled in from it, and with no earlier Dive with this suit there is no hint; the number
 * for these conditions, with its range and the weight check, is on the Tools page.
 */
export function LeadHint({ diveId, diverId, water, weighting, cylinders }: {
  diveId: string; diverId: string; water: LeadWater | null; weighting: WeightingDraft; cylinders: CylinderDraft[];
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const divers = useQuery(diversQuery());
  const own = divers.data?.find((d) => d.id === diverId)?.isOwn !== false;
  const params: ToolsParams = {
    tool: 'lead', ...(!own && { diver: diverId }), leadWater: water ?? undefined, suit: weighting.suitType ?? undefined,
    thicknessMm: orUndefined(weighting.thicknessMm), hood: orUndefined(weighting.hood), undergarment: orUndefined(weighting.undergarment),
    cylinders: cylinders.map((c): LeadCylinder => ({ volumeL: c.volumeL, ...(c.material && { material: c.material }) })),
  };
  const mayAsk = divers.data?.some((d) => d.id === diverId) === true;
  const estimate = useQuery(leadEstimateQuery(params, mayAsk ? diverId : undefined, display.units === 'imperial' ? 'lb' : 'kg'));
  const basis = estimate.data?.basis;
  // The Dive being edited may be among the Dives the estimate rests on: it is not "last time".
  const last = basis?.kind === 'dives'
    ? basis.dives.filter((d) => d.diveId !== diveId).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0]
    : undefined;
  if (!last) return null;
  // The answer's amounts are already in the unit asked for and rounded.
  const amount = (n: number) => display.mass(massFromDisplay(n, display.units));
  return (
    <div className="lead-hint" data-testid="lead-hint">
      <p>
        {last.needed === last.carried
          ? t('weighting.hint.right', { carried: amount(last.carried) })
          : t('weighting.hint.needed', { carried: amount(last.carried), needed: amount(last.needed) })}{' '}
        <a href={`#/dives/${last.diveId}`}>{t('weighting.hint.open')}</a>
      </p>
      <Muted>
        {t('weighting.hint.notFilled')} <a href={toolsHref(params)}>{t('weighting.hint.calculator')}</a>
      </Muted>
    </div>
  );
}
