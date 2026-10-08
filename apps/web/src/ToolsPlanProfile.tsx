import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type uPlot from 'uplot';
import type { ToolsPlan } from './api.ts';
import { useDisplay } from './lib/display.ts';
import { DepthPlot, PressureStrip, token } from './ProfilePlot.tsx';
import { Muted } from './ui/index.ts';

/** The plan has no temperature axis: both plots keep only a little room on the right. */
const RIGHT_SPACE = 16;

/**
 * A gas plan drawn like a dive (ADR 0033): its depth over the run time, with the minute to leave the last level by as a
 * dashed line, and under it each Diver's pressure falling over the same minutes. The picture for sighted users: the
 * list of levels and the table of the Divers say the same in text.
 */
export function PlanProfile({ plan, names }: { plan: Extract<ToolsPlan, { status: 'ok' }>; names: string[] }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const summaryId = useId();
  const pressureId = useId();
  const plotRef = useRef<uPlot | null>(null);

  // A point where each stretch ends. A stretch of no minutes moves the point before it: two points at one moment draw nothing.
  const { points, lines } = useMemo(() => {
    const minutes = [0];
    const depthsM = [plan.segments[0]?.fromDepthM ?? 0];
    const kept = [0];
    let at = 0;
    plan.segments.forEach((s, i) => {
      at += s.minutes;
      if (s.minutes <= 0) {
        depthsM[depthsM.length - 1] = s.depthM;
        kept[kept.length - 1] = i + 1;
        return;
      }
      minutes.push(at);
      depthsM.push(s.depthM);
      kept.push(i + 1);
    });
    return {
      points: { minutes, depthsM },
      lines: plan.divers.map((d) => ({ minutes, bar: kept.map((k) => Math.max(0, d.pressuresBar[k] ?? 0)) })),
    };
  }, [plan.segments, plan.divers]);

  const runtime = points.minutes.at(-1) ?? 0;
  const leaveAt = plan.leaveLastLevelAtMinute > 0 && plan.leaveLastLevelAtMinute < runtime ? plan.leaveLastLevelAtMinute : null;
  const marker = useRef<{ minute: number | null; late: boolean }>({ minute: null, late: false });
  useEffect(() => {
    marker.current = { minute: leaveAt, late: !plan.fits };
    plotRef.current?.redraw(false);
  }, [leaveAt, plan.fits]);
  /** Over the profile: the minute to leave the last level by, dashed (and in the danger colour when the plan stays longer). */
  const drawMarker = useCallback((u: uPlot) => {
    const { minute, late } = marker.current;
    if (minute === null) return;
    const ratio = devicePixelRatio || 1;
    const x = Math.round(u.valToPos(minute, 'x', true));
    u.ctx.save();
    u.ctx.strokeStyle = token(u.root, late ? '--color-danger' : '--color-text-muted', '#4e6578');
    u.ctx.lineWidth = 2 * ratio;
    u.ctx.setLineDash([6 * ratio, 4 * ratio]);
    u.ctx.beginPath();
    u.ctx.moveTo(x, u.bbox.top);
    u.ctx.lineTo(x, u.bbox.top + u.bbox.height);
    u.ctx.stroke();
    u.ctx.restore();
  }, []);

  const deepest = Math.max(...points.depthsM);
  return (
    <div className="profile-figure plan-profile">
      <DepthPlot
        {...points} syncKey="plan" draw={drawMarker} plotRef={plotRef} rightSpace={RIGHT_SPACE}
        label={t('tools.plan.profile')} describedBy={summaryId}
      />
      <p id={summaryId} className="visually-hidden">
        {t('tools.plan.profileSummary', { depth: display.depth(deepest), minutes: Math.round(runtime) })}
      </p>
      {leaveAt !== null && <Muted>{t('tools.plan.marker', { minute: Math.floor(leaveAt) })}</Muted>}
      <PressureStrip
        series={lines} labels={names} range={[0, runtime]} syncKey="plan" describedBy={pressureId}
        title={t('tools.plan.pressure')} axisTitle={t('tools.plan.pressureAxis')} rightSpace={RIGHT_SPACE}
      />
      <p id={pressureId} className="visually-hidden">{t('tools.plan.pressureSummary')}</p>
    </div>
  );
}
