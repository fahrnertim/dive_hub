import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { samplesQuery } from './api.ts';

/** Depth over time (depth axis pointing down) with water temperature, drawn with uPlot. */
export function DepthProfile({ recordingId }: { recordingId: string }) {
  const samples = useQuery(samplesQuery(recordingId));
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    const depth = samples.data?.series.find((s) => s.channel === 'depth');
    if (!el || !depth) return;
    const temperature = samples.data!.series.find((s) => s.channel === 'temperature');

    // Align temperature to the depth time axis (both come from the same records).
    const tempByOffset = new Map(temperature?.offsetsMs.map((o, i) => [o, temperature.values[i]!]));
    const x = depth.offsetsMs.map((o) => o / 60_000);
    const data: uPlot.AlignedData = [
      x,
      depth.values.map((v) => -v),
      depth.offsetsMs.map((o) => tempByOffset.get(o) ?? null),
    ];
    const style = getComputedStyle(el);
    const accent = style.getPropertyValue('--accent').trim() || '#2563eb';
    const muted = style.getPropertyValue('--muted').trim() || '#94a3b8';
    const text = style.getPropertyValue('--text').trim() || '#0f172a';

    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 320,
        scales: { x: { time: false }, temp: { auto: true } },
        axes: [
          { label: 'Minutes', stroke: text },
          { label: 'Depth (m)', stroke: text, values: (_u, ticks) => ticks.map((t) => `${Math.abs(t)}`) },
          { scale: 'temp', side: 1, label: '°C', stroke: muted, grid: { show: false } },
        ],
        series: [
          { label: 'Time', value: (_u, v) => (v == null ? '–' : `${v.toFixed(1)} min`) },
          { label: 'Depth', stroke: accent, fill: `${accent}22`, width: 2, value: (_u, v) => (v == null ? '–' : `${Math.abs(v).toFixed(1)} m`) },
          { label: 'Temperature', scale: 'temp', stroke: muted, width: 1, value: (_u, v) => (v == null ? '–' : `${v} °C`) },
        ],
      },
      data,
      el,
    );
    const resize = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 320 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.destroy();
    };
  }, [samples.data]);

  if (samples.error) return <p className="error">{samples.error.message}</p>;
  return <div ref={container} className="profile" aria-label="Depth profile" />;
}
