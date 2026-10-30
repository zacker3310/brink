import { useEffect, useRef, useState } from 'react';
import type { FrameState, RatioState } from './pacing';
import type { BattleStage, StagePerf } from './stage';

// The frame-time overlay (battle menu, Show Frame Time), for measuring on a phone
// (docs/device-testing.md). Read twice a second, off the frame loop, and drawn with plain DOM and a
// small 2D chart, so it never asks the field for a frame itself. Times are JavaScript on the main
// thread; the GPU's time is not measured. The counts are what three.js has uploaded, not memory.

const STATE: Record<FrameState, string> = {
  lost: 'Context Lost',
  suspended: 'Suspended',
  playback: 'Combat Playback',
  camera: 'Camera Transition',
  interaction: 'Interaction',
  ambient: 'Ambient Animation',
  idle: 'Idle',
};

const RATIO: Record<RatioState, string> = { fixed: 'Fixed', adapting: 'Adapting', frozen: 'Frozen' };

/** The chart's scale: 0 to 50 ms, with lines at 60 and 30 a second. */
const CHART_MS = 50;
const W = 184;
const H = 34;

const ms = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

export function PerfOverlay({ stage }: { stage: () => BattleStage | null }) {
  const [p, setP] = useState<StagePerf | null>(null);
  const [rate, setRate] = useState(0);
  const chart = useRef<HTMLCanvasElement>(null);
  // The stage is rebuilt on a quality change or a lost context: always read the current one.
  const current = useRef(stage);
  current.current = stage;

  useEffect(() => {
    let last: { s: BattleStage; draws: number; t: number } | null = null;
    const read = () => {
      const s = current.current();
      if (!s) return;
      const now = s.perf();
      const t = performance.now();
      if (last && last.s === s && t > last.t) setRate(Math.max(0, Math.round(((now.draws - last.draws) * 1000) / (t - last.t))));
      last = { s, draws: now.draws, t };
      setP(now);
      const c = chart.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (c.width !== W * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const y = (v: number) => H - (Math.min(CHART_MS, v) / CHART_MS) * H;
      g.fillStyle = '#f3f5f6';
      const xs = s.trace(Math.floor(W / 2));
      xs.forEach((v, i) => {
        const top = y(v);
        g.fillRect(W - (xs.length - i) * 2, top, 1.5, H - top);
      });
      g.strokeStyle = '#b4bfc6';
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      for (const v of [1000 / 60, 1000 / 30]) {
        g.beginPath();
        g.moveTo(0, Math.round(y(v)) + 0.5);
        g.lineTo(W, Math.round(y(v)) + 0.5);
        g.stroke();
      }
    };
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, []);

  const rows: [string, string][] = p
    ? [
        ['Frame', `${ms(p.interval50)} ms · p95 ${ms(p.interval95)}`],
        ['Drawing', `${STATE[p.state]} · ${rate}/s`],
        ['JavaScript', `${ms(p.p50)} ms · p95 ${ms(p.p95)}`],
        ['Render Call', `${ms(p.render50)} ms · p95 ${ms(p.render95)}`],
        ['HUD', `${ms(p.dom50)} ms · p95 ${ms(p.dom95)}`],
        ['Engine', `${ms(p.engine50)} ms · p95 ${ms(p.engine95)}`],
        ['Pixel Ratio', `${p.ratio.toFixed(2)} of ${p.ratioMax.toFixed(1)} · ${p.lowPower ? 'Low Power' : RATIO[p.ratioState]}`],
        ['Draw Calls', `${p.calls} · ${Math.round(p.triangles / 1000)}k tris`],
        ['Uploaded', `${p.geometries} geo · ${p.textures} tex`],
      ]
    : [];
  return (
    <div className="safe-top pointer-events-none absolute top-0 left-0 z-10" data-testid="arena-perf">
      <div className="mt-[132px] ml-2 w-[204px] rounded-xl bg-black/85 px-2.5 py-2 text-[12px] leading-[16px] text-white">
        <div className="font-semibold">Frame Time</div>
        <canvas ref={chart} className="mt-1 block" style={{ width: W, height: H }} aria-label="Real frame intervals, with lines at 60 and 30 a second" role="img" />
        <dl className="mt-1 grid grid-cols-[76px_1fr] gap-x-1.5 tabular-nums">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate font-semibold" data-testid={`perf-${k.toLowerCase().replace(/ /g, '-')}`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-muted">Main-thread time, not GPU time. Counts, not memory.</p>
      </div>
    </div>
  );
}
