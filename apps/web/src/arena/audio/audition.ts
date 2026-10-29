// The audition page (apps/web/audio.html, dev only): every sound at three ranges, the loops, the
// radio, a busy firefight, and an offline measurement through the same engine.

import type { RadioCall } from '@brink/arena/v2';
import { BattleAudio, type Direction } from './engine';
import { centroid, lateShare, modulation, mono, onsets, peakDb, period, rmsDb } from './measure';
import { audio, setMuted } from '../../sfx';

const CALIBRES = ['5.56', '7.62', '12.7', '23', '25', '30', '35', '40', '84', '100', '105', '120', '125', '152', '155', 'atgm', 'rocket', 'manpads', 'fpv'];
const BURST: Record<string, number> = { '5.56': 6, '7.62': 8, '12.7': 5, '23': 24, '25': 4, '30': 5, '35': 4, rocket: 8 };
const IMPACTS = ['ke_hit', 'bounce', 'he', 'big', 'shell', 'rockets', 'bombs', 'mine', 'building', 'small'];
const CALLS: RadioCall[] = ['contact', 'destroyed', 'taking_fire', 'man_down', 'smoke', 'splash', 'vehicle_hit', 'air_threat', 'moving', 'dismount'];
const DIRS: Direction[] = ['front', 'left', 'right', 'rear'];
const RANGES: [string, number][] = [['near', 2], ['mid', 12], ['far', 35]];
const BIOMES = ['temperate', 'steppe', 'desert', 'winter', 'urban'];
const WEATHERS = ['clear', 'overcast', 'rain', 'fog', 'snow'];

interface LoopDef {
  id: string;
  label: string;
  speed: number;
  start: (a: BattleAudio, x: number, y: number, load: number) => void;
}

const LOOP_DEFS: LoopDef[] = [
  { id: 'abrams', label: 'M1A2 (AGT1500 turbine)', speed: 2, start: (a, x, y, l) => a.engine('abrams', 'turbine', x, y, l) },
  { id: 'leopard', label: 'Leopard 2 (MTU diesel)', speed: 2, start: (a, x, y, l) => a.engine('leopard', 'diesel', x, y, l) },
  { id: 'ah64', label: 'AH-64 rotor, 4 x 289 rpm', speed: 8, start: (a, x, y) => a.rotor('ah64', 4, 289, x, y) },
  { id: 'uh60', label: 'UH-60 rotor, 4 x 258 rpm', speed: 8, start: (a, x, y) => a.rotor('uh60', 4, 258, x, y) },
  { id: 'mi8', label: 'Mi-8 rotor, 5 x 192 rpm', speed: 7, start: (a, x, y) => a.rotor('mi8', 5, 192, x, y) },
  { id: 'ka52', label: 'Ka-52 coaxial, 3 + 3 blades', speed: 8, start: (a, x, y) => a.rotor('ka52', 3, 255, x, y, { coaxial: true }) },
  { id: 'fpv', label: 'FPV quadcopter', speed: 7, start: (a, x, y) => a.drone('fpv', 'fpv', x, y) },
  { id: 'uav', label: 'Recon UAV', speed: 5, start: (a, x, y) => a.drone('uav', 'uav', x, y) },
];

const L = { x: 15, y: 22 };
/** A cell `d` from the listener, a little to the right and ahead. */
const cell = (d: number): [number, number] => [L.x + d * 0.6, L.y - d * 0.8];
const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

const live = new BattleAudio({ radio: true });
let zoom = 0.3;
live.setListener({ ...L, zoom });

// --- Meter ------------------------------------------------------------------------------------

let analyser: AnalyserNode | null = null;
const meter = { max: -Infinity, frames: 0, loud: 0, maxVoices: 0, radio: 0 };
function sample(): number {
  const out = live.output;
  const ctx = audio();
  if (!out || !ctx) return -Infinity;
  if (!analyser || analyser.context !== ctx) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    out.connect(analyser);
  }
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let e = 0;
  for (const v of buf) e += v * v;
  return 10 * Math.log10(e / buf.length + 1e-20);
}

// --- Loops moving past ------------------------------------------------------------------------

const running = new Map<string, { def: LoopDef; t: number; load: number }>();
let flyPast = true;

function stepLoops(dt: number): void {
  for (const r of running.values()) {
    r.t += dt;
    // Past the listener and back along a line 3 cells ahead.
    const span = 40;
    const s = (r.t * r.def.speed) % (span * 2);
    const x = flyPast ? L.x - span / 2 + (s < span ? s : span * 2 - s) : L.x + 3;
    r.def.start(live, x, L.y - 3, r.load);
  }
}

// --- Battle -----------------------------------------------------------------------------------

let battleOn = false;
let battleT = 0;
function battle(dt: number): void {
  if (!battleOn) return;
  battleT -= dt;
  if (battleT > 0) return;
  battleT = rnd(0.06, 0.28);
  const x = L.x + rnd(-14, 14);
  const y = L.y + rnd(-18, 18);
  const p = Math.random();
  if (p < 0.34) live.shot(pick(['5.56', '5.56', '7.62']), x, y, { burst: Math.round(rnd(3, 10)) });
  else if (p < 0.46) live.shot('12.7', x, y, { burst: Math.round(rnd(3, 7)) });
  else if (p < 0.58) live.shot(pick(['25', '30', '35']), x, y, { burst: Math.round(rnd(2, 6)) });
  else if (p < 0.64) live.shot(pick(['120', '125']), x, y);
  else if (p < 0.68) {
    live.shot('atgm', x, y);
    const tx = x + rnd(-8, 8);
    const ty = y + rnd(-8, 8);
    setTimeout(() => live.impact(pick(['ke_hit', 'he', 'big']), tx, ty), rnd(1200, 2200));
  } else if (p < 0.72) {
    const s = rnd(1.5, 3);
    live.incoming(x, y, s);
    setTimeout(() => live.impact('shell', x, y), s * 1000);
  } else if (p < 0.8) live.impact(pick(['small', 'small', 'he', 'bounce']), L.x + rnd(-3, 3), L.y + rnd(-3, 3));
  else if (p < 0.83) live.shot(pick(['84', '40', 'rocket']), x, y, { burst: 1 });
  else if (p < 0.9) {
    const call = pick(CALLS);
    if (live.radio(call, { dir: pick(DIRS) })) meter.radio++;
  }
}

function startBattle(on: boolean): void {
  battleOn = on;
  for (const def of LOOP_DEFS.filter((d) => ['abrams', 'leopard', 'ah64', 'fpv'].includes(d.id))) {
    if (on) running.set(def.id, { def, t: Math.random() * 10, load: 0.7 });
    else {
      running.delete(def.id);
      live.stop(def.id);
    }
  }
}

// --- Frame ------------------------------------------------------------------------------------

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  stepLoops(dt);
  battle(dt);
  live.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  const db = sample();
  if (Number.isFinite(db)) {
    meter.frames++;
    meter.max = Math.max(meter.max, db);
    if (db > -60) meter.loud++;
  }
  meter.maxVoices = Math.max(meter.maxVoices, live.voiceCount);
  const el = document.getElementById('meter');
  if (el) el.textContent = `${Number.isFinite(db) ? db.toFixed(1) : '-inf'} dBFS  ${live.voiceCount} voices  radio clips ${live.radioClips}`;
}, 50);

// --- Offline measurement ------------------------------------------------------------------------

export interface Row {
  name: string;
  rms: number;
  peak: number;
  centroid: number;
  /** First onset, seconds: the arrival delay. */
  arrives?: number;
  note?: string;
}

async function render(seconds: number, play: (a: BattleAudio) => void | Promise<void>, radio = false): Promise<{ x: Float32Array; sr: number }> {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const a = new BattleAudio({ radio, context: ctx });
  a.setListener({ x: 0, y: 0, zoom: 0 });
  await play(a);
  const buf = await ctx.startRendering();
  a.dispose();
  return { x: mono(buf), sr };
}

async function measure(): Promise<Row[]> {
  const rows: Row[] = [];
  const row = (name: string, x: Float32Array, sr: number, note?: string) => {
    const on = onsets(x, sr);
    const t0 = on[0] ?? 0;
    rows.push({ name, rms: rmsDb(x, sr, t0, 1), peak: peakDb(x), centroid: centroid(x, sr, t0, 1), arrives: t0, note });
  };
  for (const c of CALIBRES) {
    for (const [label, d] of RANGES) {
      if (label !== 'near' && !['5.56', '7.62', '12.7', '30', '120', '155'].includes(c)) continue;
      const { x, sr } = await render(3, (a) => a.shot(c, d, 0));
      // Energy later than 150 ms after arrival: the echo's share.
      const t0 = onsets(x, sr)[0] ?? 0;
      row(`${c} ${label} (${d} cells)`, x, sr, `after 150 ms ${(lateShare(x, sr, t0, 0.15) * 100).toFixed(0)}%`);
    }
  }
  for (const k of IMPACTS) {
    const { x, sr } = await render(3, (a) => a.impact(k, 4, 0));
    row(`impact ${k}`, x, sr);
  }
  // Cyclic rates: onsets in a burst at 1 cell.
  for (const [c, n] of [['5.56', 8], ['7.62', 8], ['12.7', 6], ['25', 5], ['30', 5], ['35', 3]] as const) {
    const { x, sr } = await render(3, (a) => a.shot(c, 1, 0, { burst: n }));
    const on = onsets(x, sr);
    const gaps = on.slice(1).map((t, i) => t - on[i]!);
    const mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
    row(`burst ${c} x${n}`, x, sr, `${on.length} onsets, mean gap ${(mean * 1000).toFixed(0)} ms = ${mean ? (60 / mean).toFixed(0) : '-'} rpm`);
  }
  {
    // One round of the twin 35 mm is a pair: the second gun's blast lands inside the first's.
    const { x, sr } = await render(1.5, (a) => a.shot('35', 1, 0));
    const on = onsets(x.subarray(0, Math.floor(sr * 0.1)), sr, 0.02, 1.3);
    row('35 one round (twin KDA)', x, sr, `second gun ${on.length > 1 ? `${((on[1]! - on[0]!) * 1000).toFixed(0)} ms` : 'not found'} after the first`);
  }
  {
    // Too fast to count shot by shot: the beat shows in the envelope's autocorrelation.
    const { x, sr } = await render(3, (a) => a.shot('23', 1, 0, { burst: 24 }));
    const p = period(x.subarray(0, Math.floor(sr * 0.45)), sr, 0.01, 0.03);
    row('burst 23 x24', x, sr, `beat ${(p * 1000).toFixed(1)} ms = ${(60 / p).toFixed(0)} rpm; expect 17.6 ms (3,400 rpm)`);
  }
  {
    // A ripple of rockets: each motor crackles, so take the envelope's slow modulation instead.
    const { x, sr } = await render(3, (a) => a.shot('rocket', 1, 0, { burst: 8 }));
    const f = modulation(x.subarray(0, Math.floor(sr * 0.75)), sr, 4, 40);
    row('burst rocket x8', x, sr, `ripple ${f.toFixed(1)} Hz = every ${(1000 / f).toFixed(0)} ms; expect 85 ms`);
  }
  // Loops: blade-pass and firing-rate modulation, turbine brightness.
  const loops: [string, number, number, (a: BattleAudio) => void, string][] = [
    ['AH-64 rotor', 8, 40, (a) => a.rotor('r', 4, 289, 3, 0), 'expect 4 x 289 / 60 = 19.3 Hz'],
    ['UH-60 rotor', 8, 40, (a) => a.rotor('r', 4, 258, 3, 0), 'expect 17.2 Hz'],
    ['Mi-8 rotor', 8, 40, (a) => a.rotor('r', 5, 192, 3, 0), 'expect 16.0 Hz'],
    ['Ka-52 coaxial', 8, 40, (a) => a.rotor('r', 3, 255, 3, 0, { coaxial: true }), 'expect 12.8 Hz per rotor'],
    ['diesel idle', 40, 250, (a) => a.engine('e', 'diesel', 3, 0, 0), 'firing 12 x 720 / 120 = 72 Hz'],
    ['diesel full', 40, 250, (a) => a.engine('e', 'diesel', 3, 0, 1), 'firing 12 x 1800 / 120 = 180 Hz'],
    ['turbine idle', 40, 250, (a) => a.engine('e', 'turbine', 3, 0, 0), ''],
    ['turbine full', 40, 250, (a) => a.engine('e', 'turbine', 3, 0, 1), ''],
    ['FPV', 40, 250, (a) => a.drone('d', 'fpv', 3, 0), ''],
    ['UAV', 2, 40, (a) => a.drone('d', 'uav', 3, 0), 'wobble 5.3 Hz'],
  ];
  for (const [name, lo, hi, play, note] of loops) {
    const { x, sr } = await render(4.5, play);
    const tail = x.subarray(Math.floor(sr * 0.4));
    rows.push({ name, rms: rmsDb(tail, sr), peak: peakDb(tail), centroid: centroid(tail, sr), note: `modulation ${modulation(tail, sr, lo, hi).toFixed(1)} Hz${note ? `; ${note}` : ''}` });
  }
  {
    const { x, sr } = await render(3.2, (a) => a.incoming(3, 0, 2.5));
    row('incoming 2.5 s', x, sr);
  }
  for (const [call, dir] of [['contact', 'left'], ['man_down', undefined], ['destroyed', undefined]] as const) {
    const { x, sr } = await render(
      2.5,
      async (a) => {
        await a.loadRadio();
        a.radio(call, dir ? { dir } : undefined);
      },
      true,
    );
    row(`radio ${call}${dir ? ` ${dir}` : ''}`, x, sr);
  }
  return rows;
}

// --- Everything, for the headless check ---------------------------------------------------------

/** Mute and dispose: everything stops, nothing new starts, and unmuting brings the loops back. */
async function checks(): Promise<Record<string, number | boolean>> {
  running.set('abrams', { def: LOOP_DEFS[0]!, t: 0, load: 0.6 });
  live.ambience('steppe', 'clear');
  live.shot('12.7', 16, 20, { burst: 5 });
  await wait(300);
  const before = live.voiceCount;
  setMuted(true);
  await wait(300);
  const muted = live.voiceCount;
  live.shot('120', 15, 20);
  live.impact('he', 15, 20);
  const mutedRadio = live.radio('contact', { dir: 'front' });
  await wait(100);
  const afterShot = live.voiceCount;
  setMuted(false);
  await wait(600);
  const unmuted = live.voiceCount;
  running.delete('abrams');
  live.stop('abrams');
  const other = new BattleAudio({ radio: false });
  other.engine('t', 'diesel', 15, 20, 0.5);
  other.shot('7.62', 15, 20, { burst: 5 });
  const otherBefore = other.voiceCount;
  other.dispose();
  other.shot('7.62', 15, 20, { burst: 5 });
  other.engine('t2', 'diesel', 15, 20, 0.5);
  other.update(0.016);
  return { before, muted, afterShot, mutedRadio, unmuted, otherBefore, disposedVoices: other.voiceCount, disposedOutput: other.output === null };
}

async function everything(): Promise<typeof meter & { state: string; sampleRate: number; radioClips: number }> {
  live.ambience('temperate', 'rain');
  const radioDone = (async () => {
    await live.loadRadio();
    for (const call of CALLS) {
      for (const dir of call === 'contact' ? DIRS : [undefined]) {
        if (live.radio(call, dir ? { dir } : undefined)) meter.radio++;
        await wait(2600);
      }
    }
  })();
  for (const c of CALIBRES) {
    for (const [, d] of RANGES) {
      const [x, y] = cell(d);
      live.shot(c, x, y, { burst: BURST[c] ?? 1 });
      await wait(150);
    }
  }
  for (const k of IMPACTS) {
    for (const [, d] of RANGES) {
      const [x, y] = cell(d);
      live.impact(k, x, y);
      await wait(150);
    }
  }
  live.incoming(...cell(6), 2);
  await wait(2100);
  for (const def of LOOP_DEFS) {
    running.set(def.id, { def, t: 0, load: 0.8 });
    await wait(1200);
    running.delete(def.id);
    live.stop(def.id);
  }
  live.setNight(true);
  startBattle(true);
  await wait(6000);
  startBattle(false);
  live.setNight(false);
  await radioDone;
  const ctx = audio();
  return { ...meter, state: ctx?.state ?? 'none', sampleRate: ctx?.sampleRate ?? 0, radioClips: live.radioClips };
}

declare global {
  interface Window {
    audition?: { everything: typeof everything; measure: typeof measure; checks: typeof checks };
  }
}
window.audition = { everything, measure, checks };

// --- Page -------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function section(title: string): HTMLElement {
  const s = el('section');
  s.append(el('h2', title));
  document.getElementById('app')!.append(s);
  return s;
}

function button(parent: HTMLElement, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', label, cls);
  b.type = 'button';
  b.addEventListener('click', () => {
    audio();
    onClick();
  });
  parent.append(b);
  return b;
}

function grid(title: string, names: string[], play: (name: string, d: number) => void): void {
  const s = section(title);
  for (const name of names) {
    const r = el('div', '', 'row');
    r.append(el('span', name, 'name'));
    for (const [label, d] of RANGES) button(r, label, () => play(name, d));
    s.append(r);
  }
}

function page(): void {
  const top = section('Listener');
  const z = el('input');
  z.type = 'range';
  z.min = '0';
  z.max = '1';
  z.step = '0.05';
  z.value = String(zoom);
  z.addEventListener('input', () => {
    zoom = Number(z.value);
    live.setListener({ ...L, zoom });
  });
  const zl = el('label', 'Zoom (0 close, 1 whole field) ');
  zl.append(z);
  top.append(zl, el('div', '', 'meter'));
  top.querySelector('.meter')!.id = 'meter';
  const bt = el('div', '', 'row');
  button(bt, 'Battle: start', () => startBattle(true), 'wide');
  button(bt, 'Battle: stop', () => startBattle(false), 'wide');
  button(bt, 'Night on', () => live.setNight(true));
  button(bt, 'Night off', () => live.setNight(false));
  top.append(bt);

  grid('Weapon reports', CALIBRES, (c, d) => {
    const [x, y] = cell(d);
    live.shot(c, x, y, { burst: BURST[c] ?? 1 });
  });
  grid('Impacts', IMPACTS, (k, d) => {
    const [x, y] = cell(d);
    live.impact(k, x, y);
  });
  const inc = section('Incoming');
  const ir = el('div', '', 'row');
  for (const s of [1, 2, 3.5]) {
    button(ir, `${s} s, then shell`, () => {
      const [x, y] = cell(6);
      live.incoming(x, y, s);
      setTimeout(() => live.impact('shell', x, y), s * 1000);
    }, 'wide');
  }
  inc.append(ir);

  const lp = section('Engines, rotors, drones');
  const fly = el('label', 'Fly past (doppler) ');
  const fc = el('input');
  fc.type = 'checkbox';
  fc.checked = flyPast;
  fc.addEventListener('change', () => (flyPast = fc.checked));
  fly.append(fc);
  lp.append(fly);
  for (const def of LOOP_DEFS) {
    const r = el('div', '', 'row');
    r.append(el('span', def.label, 'name'));
    button(r, 'start', () => running.set(def.id, { def, t: 0, load: 0.5 }));
    button(r, 'stop', () => {
      running.delete(def.id);
      live.stop(def.id);
    });
    if (def.id === 'abrams' || def.id === 'leopard') {
      const load = el('input');
      load.type = 'range';
      load.min = '0';
      load.max = '1';
      load.step = '0.05';
      load.value = '0.5';
      load.addEventListener('input', () => {
        const run = running.get(def.id);
        if (run) run.load = Number(load.value);
      });
      const ll = el('label', 'load ');
      ll.append(load);
      r.append(ll);
    }
    lp.append(r);
  }

  const rs = section('Radio');
  const rr = el('div', '', 'row wrap');
  for (const call of CALLS) {
    for (const dir of call === 'contact' ? DIRS : [undefined]) {
      button(rr, dir ? `${call} ${dir}` : call, () => {
        void live.loadRadio().then(() => live.radio(call, dir ? { dir } : undefined));
      });
    }
  }
  rs.append(rr);

  const am = section('Ambience');
  const ar = el('div', '', 'row wrap');
  for (const b of BIOMES) for (const w of WEATHERS) button(ar, `${b}, ${w}`, () => live.ambience(b, w));
  am.append(ar);

  const ms = section('Measure (offline, same engine)');
  const out = el('pre');
  button(ms, 'Render and measure', () => {
    out.textContent = 'Rendering...';
    void measure().then((rows) => {
      out.textContent = rows
        .map((r) => `${r.name.padEnd(26)} rms ${r.rms.toFixed(1).padStart(6)} dB  peak ${r.peak.toFixed(1).padStart(6)} dB  centroid ${r.centroid.toFixed(0).padStart(5)} Hz${r.arrives !== undefined ? `  arrives ${(r.arrives * 1000).toFixed(0)} ms` : ''}${r.note ? `  ${r.note}` : ''}`)
        .join('\n');
    });
  }, 'wide');
  ms.append(out);
}

page();
