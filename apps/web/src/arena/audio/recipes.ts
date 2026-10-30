// Weapon reports and impacts, synthesised from physical layers: the bullet's supersonic crack
// (N-wave), the muzzle blast (shaped noise with a body resonance), the pressure punch of the blast
// wave (Friedlander), the gun's mechanism, and the tail that rolls back off the terrain.
//
// Heavy reports and blasts (tank guns, artillery, rockets, shells and bombs) keep those parts apart as
// four buffers, so the engine can weigh them by distance: the transient (crack, flash, the front of
// the blast wave) is lost first with range, the tail rolls on, and a sub-bass thump under the
// heaviest carries furthest. Mixed 1:1:1 without the sub, they are the single report.

import { Biquad, decay, filter, finish, friedlander, glide, mode, noise, nwave, patter, rand, rumble, samples, sweep, type Rand, type Samples } from './dsp';

/** A heavy sound in parts. Transient, body and tail share one length and one scale; the sub is its own. */
export interface Layered {
  transient: Samples;
  body: Samples;
  tail: Samples;
  sub: Samples | null;
}

/** Three parts of one sound, empty, to add into. */
function parts(sr: number, len: number): [Samples, Samples, Samples] {
  return [samples(sr, len), samples(sr, len), samples(sr, len)];
}

/** Finish parts that make one sound together: the same filters and fade, one scale (the mix's peak). */
function together(t: Samples, b: Samples, l: Samples, sr: number, sub: Samples | null, peak = 0.9): Layered {
  const fade = Math.min(t.length, Math.round(sr * 0.004));
  for (const buf of [t, b, l]) {
    filter(buf, new Biquad('highpass', sr, 20), new Biquad('highpass', sr, 20));
    for (let i = 0; i < fade; i++) buf[buf.length - 1 - i]! *= i / fade;
  }
  let max = 0;
  for (let i = 0; i < t.length; i++) max = Math.max(max, Math.abs(t[i]! + b[i]! + l[i]!));
  const k = max > 0 ? peak / max : 1;
  for (const buf of [t, b, l]) for (let i = 0; i < buf.length; i++) buf[i]! *= k;
  return { transient: t, body: b, tail: l, sub };
}

/** The parts summed back into one buffer (the sub left out), for the single-buffer registry. */
function mixdown(x: Layered): Samples {
  const out = new Float32Array(x.body.length);
  for (let i = 0; i < out.length; i++) out[i] = x.transient[i]! + x.body[i]! + x.tail[i]!;
  return out;
}

interface Thump {
  /** Where the pitch settles, Hz. */
  hz: number;
  /** How far above it the first instant starts, as a share of `hz`. */
  drop: number;
  /** Decay, ms. */
  tau: number;
}

/**
 * The sub-bass thump under the heaviest: a sine near 40 Hz that drops into place, with its first
 * harmonics, so a phone's small speaker (which cannot play 40 Hz) still gives the sense of it, and a
 * soft saturation for weight. On the web on an iPhone it is the only rumble there is.
 */
function thump(sr: number, r: Rand, o: Thump): Samples {
  const len = Math.min(2, (o.tau / 1000) * 6 + 0.05);
  const out = samples(sr, len);
  const hz0 = o.hz * (0.97 + r() * 0.06);
  glide(out, sr, 0, len, (t) => hz0 * (1 + o.drop * Math.exp(-t / 0.035)), (t) => Math.min(1, t / 0.004) * Math.exp(-t / (o.tau / 1000)), [1, 0.55, 0.3, 0.14], 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * 1.4);
  return finish(out, sr);
}

interface Report {
  /** Buffer length, seconds. */
  len: number;
  /** N-wave length in ms and level; `lead`: seconds it arrives ahead of the blast. */
  crack?: { ms: number; amp: number; lead: number };
  /** Muzzle blast: attack and decays in ms, band centre and Q, low-pass for the broad part, and the bright flash share. */
  blast: { attack: number; tau: number; tau2: number; mix2: number; hz: number; q: number; lp: number; amp: number; bright: number };
  /** Blast wave positive phase, ms. */
  punch: { ms: number; amp: number };
  /** Body modes: [Hz, decay ms, level]. */
  body: [number, number, number][];
  /** Mechanism (bolt, feed, chain): seconds after the shot, base Hz. */
  mech?: { at: number; hz: number; amp: number };
  tail?: { len: number; hz: number; amp: number; bumps: number };
}

const REPORTS: Record<string, Report> = {
  // 5.56 x 45 (M4A1, M249): a hard, bright snap; little body.
  '5.56': {
    len: 0.42,
    crack: { ms: 0.22, amp: 1, lead: 0.004 },
    blast: { attack: 0.3, tau: 9, tau2: 40, mix2: 0.3, hz: 1900, q: 0.9, lp: 3500, amp: 0.9, bright: 0.6 },
    punch: { ms: 0.35, amp: 0.55 },
    body: [[3300, 3, 0.12], [1150, 8, 0.1]],
    mech: { at: 0.055, hz: 2600, amp: 0.04 },
    tail: { len: 0.3, hz: 1100, amp: 0.12, bumps: 3 },
  },
  // 7.62 x 51 / 54R (M240, PKM, PKT): heavier crack, a fuller bark.
  '7.62': {
    len: 0.55,
    crack: { ms: 0.32, amp: 1, lead: 0.005 },
    blast: { attack: 0.4, tau: 14, tau2: 60, mix2: 0.35, hz: 900, q: 0.8, lp: 1800, amp: 1, bright: 0.45 },
    punch: { ms: 0.6, amp: 0.8 },
    body: [[2300, 4, 0.1], [460, 26, 0.24]],
    mech: { at: 0.06, hz: 2100, amp: 0.05 },
    tail: { len: 0.4, hz: 800, amp: 0.16, bumps: 4 },
  },
  // 12.7 x 99 (M2, NSVT): a slow, heavy thump with a chest-deep body.
  '12.7': {
    len: 0.85,
    crack: { ms: 0.5, amp: 0.9, lead: 0.006 },
    blast: { attack: 0.6, tau: 22, tau2: 95, mix2: 0.4, hz: 620, q: 0.8, lp: 1200, amp: 1, bright: 0.35 },
    punch: { ms: 1.3, amp: 0.95 },
    body: [[190, 55, 0.35], [1500, 6, 0.1]],
    mech: { at: 0.07, hz: 900, amp: 0.1 },
    tail: { len: 0.6, hz: 520, amp: 0.22, bumps: 5 },
  },
  // 23 x 115 (GSh-23): fired so fast the shots fuse into a tearing buzz.
  '23': {
    len: 0.5,
    crack: { ms: 0.7, amp: 0.8, lead: 0.005 },
    blast: { attack: 0.6, tau: 18, tau2: 70, mix2: 0.35, hz: 520, q: 0.9, lp: 1100, amp: 1, bright: 0.3 },
    punch: { ms: 1.6, amp: 0.95 },
    body: [[150, 40, 0.3]],
    tail: { len: 0.35, hz: 450, amp: 0.18, bumps: 3 },
  },
  // 25 x 137 (M242 Bushmaster): a deep "dunk" and the chain's clank.
  '25': {
    len: 1.05,
    crack: { ms: 0.85, amp: 0.75, lead: 0.006 },
    blast: { attack: 0.8, tau: 28, tau2: 130, mix2: 0.45, hz: 420, q: 0.9, lp: 900, amp: 1, bright: 0.3 },
    punch: { ms: 2, amp: 1 },
    body: [[118, 75, 0.38], [265, 40, 0.2]],
    mech: { at: 0.09, hz: 640, amp: 0.14 },
    tail: { len: 0.85, hz: 400, amp: 0.26, bumps: 5 },
  },
  // 30 x 165 (2A42, 2A72) and 30 x 113 (M230).
  '30': {
    len: 1.05,
    crack: { ms: 1, amp: 0.75, lead: 0.006 },
    blast: { attack: 0.8, tau: 30, tau2: 140, mix2: 0.45, hz: 360, q: 0.9, lp: 850, amp: 1, bright: 0.28 },
    punch: { ms: 2.3, amp: 1 },
    body: [[104, 80, 0.4], [235, 45, 0.22]],
    mech: { at: 0.08, hz: 560, amp: 0.12 },
    tail: { len: 0.9, hz: 380, amp: 0.28, bumps: 5 },
  },
  // 35 x 228 (Oerlikon KDA, Bushmaster III).
  '35': {
    len: 1.1,
    crack: { ms: 1.15, amp: 0.7, lead: 0.006 },
    blast: { attack: 0.9, tau: 32, tau2: 150, mix2: 0.45, hz: 320, q: 0.9, lp: 800, amp: 1, bright: 0.26 },
    punch: { ms: 2.7, amp: 1 },
    body: [[96, 90, 0.42], [210, 48, 0.22]],
    mech: { at: 0.06, hz: 520, amp: 0.1 },
    tail: { len: 0.95, hz: 360, amp: 0.3, bumps: 5 },
  },
  // 40 mm grenade (M320, GP-34): low velocity, no crack; the tube's hollow "thoonk".
  '40': {
    len: 0.45,
    blast: { attack: 0.5, tau: 10, tau2: 40, mix2: 0.3, hz: 260, q: 2.5, lp: 600, amp: 0.7, bright: 0.05 },
    punch: { ms: 1.2, amp: 0.5 },
    body: [[205, 32, 0.6], [98, 40, 0.3], [620, 10, 0.12]],
    tail: { len: 0.2, hz: 400, amp: 0.06, bumps: 2 },
  },
  // 84 mm recoilless (Carl-Gustaf, AT4): a violent, broadband back-blast.
  '84': {
    len: 1.7,
    blast: { attack: 0.2, tau: 26, tau2: 170, mix2: 0.5, hz: 750, q: 0.55, lp: 3200, amp: 1, bright: 0.9 },
    punch: { ms: 3.5, amp: 1 },
    body: [[72, 140, 0.42], [150, 70, 0.2]],
    tail: { len: 1.4, hz: 520, amp: 0.32, bumps: 6 },
  },
  // 100 mm 2A70: a low-pressure gun, a big boom without the tank gun's crack.
  '100': {
    len: 2,
    blast: { attack: 1, tau: 45, tau2: 260, mix2: 0.5, hz: 190, q: 0.7, lp: 520, amp: 1, bright: 0.2 },
    punch: { ms: 5, amp: 1 },
    body: [[48, 220, 0.5], [86, 120, 0.3]],
    tail: { len: 1.6, hz: 260, amp: 0.32, bumps: 6 },
  },
  // 105 mm M35: the APFSDS shock wave cracks ahead of the boom.
  '105': {
    len: 2.2,
    crack: { ms: 0.8, amp: 0.35, lead: 0.004 },
    blast: { attack: 0.9, tau: 55, tau2: 300, mix2: 0.5, hz: 160, q: 0.7, lp: 520, amp: 1, bright: 0.28 },
    punch: { ms: 6, amp: 1 },
    body: [[44, 240, 0.55], [80, 130, 0.3]],
    tail: { len: 1.8, hz: 240, amp: 0.34, bumps: 7 },
  },
  // 120 mm M256 and L55: the huge low boom, sub-bass and a pressure punch.
  '120': {
    len: 2.5,
    crack: { ms: 1, amp: 0.35, lead: 0.004 },
    blast: { attack: 1, tau: 62, tau2: 360, mix2: 0.55, hz: 125, q: 0.7, lp: 480, amp: 1, bright: 0.25 },
    punch: { ms: 7.5, amp: 1 },
    body: [[38, 300, 0.6], [70, 150, 0.35]],
    tail: { len: 2, hz: 220, amp: 0.36, bumps: 7 },
  },
  // 125 mm 2A46 and 2A75.
  '125': {
    len: 2.6,
    crack: { ms: 1.05, amp: 0.35, lead: 0.004 },
    blast: { attack: 1, tau: 66, tau2: 380, mix2: 0.55, hz: 115, q: 0.7, lp: 460, amp: 1, bright: 0.24 },
    punch: { ms: 8, amp: 1 },
    body: [[36, 310, 0.6], [66, 160, 0.35]],
    tail: { len: 2.1, hz: 210, amp: 0.36, bumps: 7 },
  },
  // 152 mm 2A64 and 155 mm M284: a deep thud and a long rolling tail.
  '152': {
    len: 3.6,
    blast: { attack: 1.5, tau: 70, tau2: 480, mix2: 0.6, hz: 85, q: 0.6, lp: 320, amp: 1, bright: 0.15 },
    punch: { ms: 12, amp: 1 },
    body: [[30, 420, 0.6], [54, 220, 0.35]],
    tail: { len: 3.3, hz: 170, amp: 0.5, bumps: 11 },
  },
  '155': {
    len: 3.8,
    blast: { attack: 1.5, tau: 72, tau2: 500, mix2: 0.6, hz: 82, q: 0.6, lp: 310, amp: 1, bright: 0.15 },
    punch: { ms: 13, amp: 1 },
    body: [[29, 440, 0.6], [52, 230, 0.35]],
    tail: { len: 3.5, hz: 165, amp: 0.5, bumps: 12 },
  },
  // 81 and 82 mm mortars: the tube's ring and a short boom.
  mortar: {
    len: 1.4,
    blast: { attack: 0.8, tau: 25, tau2: 120, mix2: 0.4, hz: 170, q: 1.8, lp: 600, amp: 0.8, bright: 0.1 },
    punch: { ms: 3, amp: 0.8 },
    body: [[150, 60, 0.5], [92, 90, 0.35], [460, 15, 0.12]],
    tail: { len: 1.1, hz: 300, amp: 0.25, bumps: 5 },
  },
};

function report(p: Report, sr: number, r: Rand): Samples {
  const [t, b, l] = reportParts(p, sr, r);
  for (let i = 0; i < b.length; i++) b[i] = t[i]! + b[i]! + l[i]!;
  return finish(b, sr);
}

/** A report's transient (crack, flash, blast wave), body (muzzle blast, modes, mechanism) and tail. */
function reportParts(p: Report, sr: number, r: Rand): [Samples, Samples, Samples] {
  const [t, body, tail] = parts(sr, p.len);
  const lead = p.crack?.lead ?? 0;
  if (p.crack) nwave(t, sr, 0, p.crack.ms * (0.92 + r() * 0.16), p.crack.amp, r);
  const b = p.blast;
  const env = decay(b.attack, b.tau, b.tau2, b.mix2);
  const blastLen = Math.min(p.len - lead, (b.tau2 || b.tau) * 0.006 + 0.05);
  noise(body, sr, lead, blastLen, env, [new Biquad('bandpass', sr, b.hz * (0.95 + r() * 0.1), b.q)], b.amp * 1.6, r);
  noise(body, sr, lead, blastLen, env, [new Biquad('lowpass', sr, b.lp, 0.7)], b.amp * 0.6, r);
  if (b.bright > 0) noise(t, sr, lead, 0.03, decay(0.1, Math.max(1.5, b.tau * 0.12)), [new Biquad('highpass', sr, 2500)], b.bright, r);
  friedlander(t, sr, lead, p.punch.ms, p.punch.amp);
  for (const [hz, tau, amp] of p.body) mode(body, sr, lead, hz * (0.97 + r() * 0.06), tau, amp, r, Math.min(4, 2000 / hz));
  if (p.mech) clank(body, sr, lead + p.mech.at * (0.9 + r() * 0.2), p.mech.hz, p.mech.amp, r);
  if (p.tail) rumble(tail, sr, lead + 0.01, p.tail.len, p.tail.hz, p.tail.amp, p.tail.bumps, r);
  return [t, body, tail];
}

function layeredReport(key: string, sub: Thump | null): (sr: number, r: Rand) => Layered {
  return (sr, r) => {
    const [t, b, l] = reportParts(REPORTS[key]!, sr, r);
    return together(t, b, l, sr, sub ? thump(sr, r, sub) : null);
  };
}

/** A metal mechanism: a few inharmonic modes and a short scrape. */
function clank(out: Samples, sr: number, at: number, hz: number, amp: number, r: Rand): void {
  const ratios = [1, 1.47, 2.09, 2.76, 3.9];
  ratios.forEach((k, i) => mode(out, sr, at, hz * k * (0.97 + r() * 0.06), 14 - i * 2.2, amp / (1 + i * 0.5), r, 0.3));
  noise(out, sr, at, 0.02, decay(0.2, 4), [new Biquad('bandpass', sr, hz * 2, 1.5)], amp * 0.8, r);
}

/** A launch: an eject pop, then the motor lights and its hiss recedes downrange. */
function missile(sr: number, r: Rand, kind: 'atgm' | 'manpads'): Samples {
  const len = kind === 'atgm' ? 2.8 : 2.6;
  const out = samples(sr, len);
  // Eject charge: a soft thump out of the tube.
  friedlander(out, sr, 0, kind === 'atgm' ? 2 : 1.6, 0.5);
  mode(out, sr, 0, kind === 'atgm' ? 230 : 300, 24, 0.4, r, 1);
  noise(out, sr, 0, 0.08, decay(0.3, 12), [new Biquad('bandpass', sr, 900, 0.8)], 0.5, r);
  const lit = (kind === 'atgm' ? 0.18 : 0.32) + r() * 0.05;
  friedlander(out, sr, lit, kind === 'atgm' ? 1.5 : 1, 0.85);
  noise(out, sr, lit, 0.06, decay(0.2, 18), [new Biquad('highpass', sr, 1200)], 0.9, r);
  const burn = len - lit;
  const recede = kind === 'atgm' ? 0.9 : 0.55;
  const env = (t: number) => Math.min(1, t / 0.04) * Math.exp(-t / recede);
  if (kind === 'atgm') {
    sweep(out, sr, lit, burn, env, (t) => 2600 * Math.exp(-t / 1.4) + 700, 0.8, 1.1, r);
    noise(out, sr, lit, burn, env, [new Biquad('lowpass', sr, 320, 0.7)], 0.45, r);
  } else {
    // The motor screams: a narrow band and a tone falling as it pulls away.
    sweep(out, sr, lit, burn, env, (t) => 2300 * Math.exp(-t / 1.6) + 600, 4, 1.4, r);
    glide(out, sr, lit, burn, (t) => 820 + 430 * Math.exp(-t / 0.7), (t) => env(t) * 0.8, [1, 0.5, 0.33, 0.2], 0.22);
    noise(out, sr, lit, burn, (t) => env(t) * Math.exp(-t / 0.4), [new Biquad('highpass', sr, 3000)], 0.35, r);
  }
  patter(out, sr, lit, burn * 0.6, (t) => 50 * Math.exp(-t / 0.4), 1500, 5000, 0.08, r);
  return finish(out, sr);
}

/**
 * One rocket of a ripple: the ignition crack and a roar tearing away (Hydra 70, S-8; `heavy`: 122 mm,
 * whose roar also rolls back off the ground over a low push under the launch).
 */
function rocket(sr: number, r: Rand, heavy: boolean): Layered {
  const burn = heavy ? 1.8 : 1.3;
  const [t, b, l] = parts(sr, heavy ? 2.2 : burn);
  friedlander(t, sr, 0, heavy ? 2.5 : 1.2, 0.8);
  noise(t, sr, 0, 0.05, decay(0.1, 8), [new Biquad('highpass', sr, 1500)], 0.7, r);
  const tau = heavy ? 0.6 : 0.35;
  const env = (x: number) => Math.min(1, x / 0.025) * Math.exp(-x / tau);
  sweep(b, sr, 0.005, burn - 0.01, env, (x) => 5000 * Math.exp(-x / 0.35) + 900, 0.6, 1.3, r);
  noise(b, sr, 0.005, burn - 0.01, env, [new Biquad('lowpass', sr, heavy ? 300 : 420, 0.7)], heavy ? 0.9 : 0.7, r);
  patter(b, sr, 0.01, burn * 0.7, (x) => 120 * Math.exp(-x / 0.3), 1500, 5000, 0.15, r);
  if (heavy) rumble(l, sr, 0.08, 2.1, 240, 0.35, 6, r);
  return together(t, b, l, sr, heavy ? thump(sr, r, { hz: 48, drop: 0.5, tau: 160 }) : null);
}

/**
 * A quadcopter launching and running in: brushless motors whine at slightly different speeds, so
 * they beat and buzz; the pitch sweeps as it passes (doppler). `low`: a pusher-prop loitering munition.
 */
function drone(sr: number, r: Rand, low: boolean): Samples {
  const len = 2.6;
  const out = samples(sr, len);
  const base = low ? 180 : 330;
  const motors = low ? 1 : 4;
  const spin = (t: number) => (t < 0.25 ? 0.35 + 0.65 * Math.sin((t / 0.25) * (Math.PI / 2)) : 1);
  const doppler = (t: number) => 0.98 - 0.08 * Math.tanh((t - 1.3) * 2.5);
  const env = (t: number) => Math.min(1, t / 0.2) * (1 - 0.75 * Math.max(0, (t - 1.2) / (len - 1.2)));
  for (let m = 0; m < motors; m++) {
    const f0 = base * (1 + m * 0.013 + (r() - 0.5) * 0.008);
    glide(out, sr, 0, len, (t) => f0 * spin(t) * doppler(t), env, [1, 0.55, 0.4, 0.3, 0.22, 0.16, 0.12, 0.09], 0.22 / Math.sqrt(motors));
  }
  // Commutation whine high above the motors, and the prop wash.
  glide(out, sr, 0, len, (t) => base * 7.1 * spin(t) * doppler(t), (t) => env(t) * 0.5, [1], 0.05);
  sweep(out, sr, 0, len, (t) => env(t) * 0.8, (t) => 1800 * doppler(t), 0.7, 0.35, r);
  return finish(out, sr, 0.8);
}

/** An incoming shell's whistle; the buffer ends where the round lands. */
function whistle(sr: number, r: Rand): Samples {
  const len = 3;
  const out = samples(sr, len);
  const wob = 2 + r() * 3;
  const hz = (t: number) => (1350 - 730 * (t / len) ** 1.3) * (1 + 0.015 * Math.sin(2 * Math.PI * wob * t));
  const env = (t: number) => 0.05 + 0.95 * (t / len) ** 2.2;
  glide(out, sr, 0, len, hz, env, [1, 0.3, 0.12], 0.6);
  sweep(out, sr, 0, len, (t) => env(t) * (0.4 + 0.6 * Math.max(0, (t - (len - 0.5)) / 0.5)), (t) => hz(t) * 1.6, 1.2, 0.5, r);
  return finish(out, sr);
}

// --- Impacts ----------------------------------------------------------------------------------

interface Blast {
  len: number;
  punch: number;
  bright: number;
  tau: number;
  tau2: number;
  hz: number;
  sub: number;
  subTau: number;
  debris: number;
  tail: number;
  tailHz: number;
}

/** A blast's transient (blast wave, flash), body (fireball, ground mode, debris) and tail. */
function explosionParts(sr: number, r: Rand, o: Blast): [Samples, Samples, Samples] {
  const [t, b, l] = parts(sr, o.len);
  friedlander(t, sr, 0, o.punch, 1);
  noise(t, sr, 0, 0.04, decay(0.1, 4), [new Biquad('highpass', sr, 1800)], o.bright, r);
  const env = decay(0.6, o.tau, o.tau2, 0.5);
  const blastLen = Math.min(o.len, o.tau2 * 0.006 + 0.05);
  noise(b, sr, 0, blastLen, env, [new Biquad('bandpass', sr, o.hz, 0.7)], 1.6, r);
  noise(b, sr, 0, blastLen, env, [new Biquad('lowpass', sr, o.hz * 2.8, 0.7)], 0.7, r);
  mode(b, sr, 0, o.sub, o.subTau, 0.55, r, 3);
  if (o.debris > 0) patter(b, sr, 0.2, o.len - 0.3, (x) => o.debris * Math.exp(-x / 0.55), 400, 3200, 0.12, r);
  rumble(l, sr, 0.03, o.tail, o.tailHz, 0.42, Math.round(o.tail * 3.5), r);
  return [t, b, l];
}

function explosion(o: Blast, sub: Thump | null): (sr: number, r: Rand) => Layered {
  return (sr, r) => {
    const [t, b, l] = explosionParts(sr, r, o);
    return together(t, b, l, sr, sub ? thump(sr, r, sub) : null);
  };
}

function keHit(sr: number, r: Rand): Samples {
  const out = samples(sr, 1.1);
  friedlander(out, sr, 0, 0.6, 1);
  noise(out, sr, 0, 0.02, decay(0.05, 2.5), [new Biquad('highpass', sr, 2000)], 0.9, r);
  // A struck steel hull: inharmonic modes, the highs dying first.
  const modes: [number, number, number][] = [[470, 180, 0.35], [1130, 120, 0.3], [1720, 95, 0.25], [2540, 70, 0.2], [3810, 45, 0.15], [5230, 30, 0.1]];
  for (const [hz, tau, a] of modes) mode(out, sr, 0, hz * (0.96 + r() * 0.08), tau, a, r, 0.2);
  mode(out, sr, 0, 72, 70, 0.5, r, 2);
  friedlander(out, sr, 0.001, 3, 0.6);
  noise(out, sr, 0.005, 0.4, decay(1, 70), [new Biquad('bandpass', sr, 3200, 0.8)], 0.3, r);
  return finish(out, sr);
}

function bounce(sr: number, r: Rand): Samples {
  const out = samples(sr, 1);
  friedlander(out, sr, 0, 0.5, 0.7);
  for (const [hz, tau, a] of [[820, 60, 0.3], [1960, 40, 0.22], [3100, 25, 0.15]] as const) mode(out, sr, 0, hz * (0.95 + r() * 0.1), tau, a, r, 0.2);
  // The ricochet: a tumbling whine falling away.
  const f0 = 2800 + r() * 800;
  const hz = (t: number) => f0 * (950 / f0) ** Math.min(1, t / 0.6);
  const env = (t: number) => Math.min(1, t / 0.015) * Math.exp(-t / 0.25) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 34 * t));
  glide(out, sr, 0.03, 0.9, hz, env, [1, 0.2], 0.35);
  sweep(out, sr, 0.03, 0.9, env, hz, 6, 0.25, r);
  return finish(out, sr);
}

function cookOff(sr: number, r: Rand): Layered {
  const [t, b, l] = explosionParts(sr, r, { len: 4.2, punch: 9, bright: 0.6, tau: 110, tau2: 520, hz: 110, sub: 32, subTau: 380, debris: 70, tail: 3.8, tailHz: 160 });
  // Ammunition cooking off: pops and bangs for a few seconds, over a crackling fire.
  const pops = 7 + Math.floor(r() * 6);
  for (let i = 0; i < pops; i++) {
    const at = 0.35 + r() * 3.3;
    const a = 0.2 + r() * 0.3;
    friedlander(b, sr, at, 1 + r() * 2, a);
    noise(b, sr, at, 0.2, decay(0.3, 15 + r() * 25), [new Biquad('bandpass', sr, 400 + r() * 800, 0.8)], a * 1.2, r);
  }
  patter(l, sr, 0.3, 3.8, () => 80, 800, 4000, 0.06, r);
  noise(l, sr, 0.2, 4, (x) => Math.min(1, x / 0.6) * 0.3, [new Biquad('lowpass', sr, 260, 0.7)], 0.4, r);
  return together(t, b, l, sr, thump(sr, r, { hz: 34, drop: 0.7, tau: 420 }));
}

function collapse(sr: number, r: Rand): Samples {
  const out = samples(sr, 3.8);
  friedlander(out, sr, 0, 1.5, 0.6);
  noise(out, sr, 0, 0.1, decay(0.2, 20), [new Biquad('bandpass', sr, 1800, 1)], 0.6, r);
  // Floors going: a swelling rumble, then concrete, brick and glass coming down.
  noise(out, sr, 0.02, 3.7, (t) => Math.min(1, t / 0.4) * Math.exp(-Math.max(0, t - 0.4) / 1.3), [new Biquad('lowpass', sr, 180, 0.7), new Biquad('lowpass', sr, 300, 0.7)], 1.6, r);
  const bump = (t: number) => Math.exp(-(((t - 0.6) / 0.7) ** 2));
  patter(out, sr, 0.05, 3.5, (t) => 220 * bump(t), 250, 2200, 0.22, r);
  patter(out, sr, 0.1, 3, (t) => 120 * bump(t), 1500, 5000, 0.08, r);
  noise(out, sr, 0.1, 3.5, (t) => bump(t) * 0.8, [new Biquad('bandpass', sr, 2500, 0.7)], 0.08, r);
  return finish(out, sr);
}

function smallArmsLanding(sr: number, r: Rand): Samples {
  const out = samples(sr, 0.9);
  const snaps = 6 + Math.floor(r() * 4);
  for (let i = 0; i < snaps; i++) nwave(out, sr, r() * 0.6, 0.18 + r() * 0.17, 0.4 + r() * 0.6, r);
  const hits = 3 + Math.floor(r() * 3);
  for (let i = 0; i < hits; i++) {
    const t = 0.02 + r() * 0.65;
    noise(out, sr, t, 0.08, decay(0.3, 12), [new Biquad('lowpass', sr, 900, 0.7)], 0.3, r);
    mode(out, sr, t, 300 + r() * 200, 15, 0.2, r, 0.5);
  }
  const t0 = r() * 0.4;
  sweep(out, sr, t0, 0.35, (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.12), (t) => 2600 - 1400 * Math.min(1, t / 0.35), 5, 0.15, r);
  return finish(out, sr);
}

// --- Registry ---------------------------------------------------------------------------------

export interface SoundDef {
  make: (sr: number, r: Rand) => Samples;
  /** Bright, short sounds render at the context rate; heavy, low ones at up to 32 kHz to save memory. */
  low: boolean;
  /** Takes with different noise, rotated so repeats do not sound looped. */
  variants: number;
}

const rep = (key: string, low: boolean, variants: number): SoundDef => ({ make: (sr, r) => report(REPORTS[key]!, sr, r), low, variants });

export interface LayeredDef {
  make: (sr: number, r: Rand) => Layered;
  low: boolean;
  variants: number;
  /** The sub's level against the rest, at the source (it carries further; see the engine). */
  sub: number;
}

/** The thump under a tank gun, and the deeper, longer one under a howitzer or a shell landing. */
const TANK: Thump = { hz: 42, drop: 0.6, tau: 190 };
const GUN: Thump = { hz: 36, drop: 0.7, tau: 300 };

/** Tank guns, artillery and rockets, and the blasts at the other end: played in layers. */
export const LAYERED: Record<string, LayeredDef> = {
  '100': { make: layeredReport('100', null), low: true, variants: 1, sub: 0 },
  '105': { make: layeredReport('105', { ...TANK, hz: 46 }), low: true, variants: 1, sub: 0.25 },
  '120': { make: layeredReport('120', TANK), low: true, variants: 1, sub: 0.4 },
  '125': { make: layeredReport('125', TANK), low: true, variants: 1, sub: 0.4 },
  '152': { make: layeredReport('152', GUN), low: true, variants: 1, sub: 0.45 },
  '155': { make: layeredReport('155', GUN), low: true, variants: 1, sub: 0.45 },
  mortar: { make: layeredReport('mortar', null), low: true, variants: 1, sub: 0 },
  rocket: { make: (sr, r) => rocket(sr, r, false), low: false, variants: 2, sub: 0 },
  rocket122: { make: (sr, r) => rocket(sr, r, true), low: true, variants: 2, sub: 0.2 },
  he: { make: explosion({ len: 1.9, punch: 3.2, bright: 0.8, tau: 45, tau2: 220, hz: 260, sub: 55, subTau: 160, debris: 60, tail: 1.7, tailHz: 240 }, null), low: true, variants: 2, sub: 0 },
  shell: { make: explosion({ len: 2.9, punch: 8, bright: 0.5, tau: 80, tau2: 420, hz: 150, sub: 36, subTau: 300, debris: 90, tail: 2.7, tailHz: 190 }, GUN), low: true, variants: 2, sub: 0.4 },
  rocket_hit: { make: explosion({ len: 1.6, punch: 2.8, bright: 0.8, tau: 40, tau2: 200, hz: 280, sub: 60, subTau: 140, debris: 50, tail: 1.4, tailHz: 260 }, null), low: true, variants: 2, sub: 0 },
  bomb: { make: explosion({ len: 3.2, punch: 14, bright: 0.4, tau: 120, tau2: 600, hz: 90, sub: 27, subTau: 450, debris: 100, tail: 3, tailHz: 150 }, { hz: 32, drop: 0.8, tau: 450 }), low: true, variants: 1, sub: 0.55 },
  mine: { make: explosion({ len: 1.8, punch: 4, bright: 0.9, tau: 40, tau2: 200, hz: 220, sub: 60, subTau: 140, debris: 140, tail: 1.4, tailHz: 260 }, null), low: true, variants: 1, sub: 0 },
  big: { make: cookOff, low: true, variants: 1, sub: 0.45 },
};

/** A layered sound as one buffer (its parts summed, no sub), for anything that wants it whole. */
const whole = (key: string): SoundDef => {
  const def = LAYERED[key]!;
  return { make: (sr, r) => finish(mixdown(def.make(sr, r)), sr), low: def.low, variants: def.variants };
};

export const SOUNDS: Record<string, SoundDef> = {
  '5.56': rep('5.56', false, 3),
  '7.62': rep('7.62', false, 3),
  '12.7': rep('12.7', false, 2),
  '23': rep('23', false, 2),
  '25': rep('25', false, 2),
  '30': rep('30', false, 2),
  '35': rep('35', false, 2),
  '40': rep('40', false, 2),
  '84': rep('84', true, 1),
  '100': whole('100'),
  '105': whole('105'),
  '120': whole('120'),
  '125': whole('125'),
  '152': whole('152'),
  '155': whole('155'),
  mortar: whole('mortar'),
  atgm: { make: (sr, r) => missile(sr, r, 'atgm'), low: false, variants: 1 },
  manpads: { make: (sr, r) => missile(sr, r, 'manpads'), low: false, variants: 1 },
  rocket: whole('rocket'),
  rocket122: whole('rocket122'),
  fpv: { make: (sr, r) => drone(sr, r, false), low: false, variants: 1 },
  loiter: { make: (sr, r) => drone(sr, r, true), low: false, variants: 1 },
  whistle: { make: whistle, low: false, variants: 1 },
  ke_hit: { make: keHit, low: false, variants: 2 },
  bounce: { make: bounce, low: false, variants: 2 },
  he: whole('he'),
  shell: whole('shell'),
  rocket_hit: whole('rocket_hit'),
  bomb: whole('bomb'),
  mine: whole('mine'),
  big: whole('big'),
  building: { make: collapse, low: true, variants: 1 },
  small: { make: smallArmsLanding, low: false, variants: 3 },
};

function seed(key: string, take: number): Rand {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return rand((h ^ (take * 0x9e3779b1)) >>> 0);
}

/** Synthesises one take of a sound. Same key, rate and take: the same samples. */
export function synth(key: string, sr: number, take: number): Samples {
  const def = SOUNDS[key] ?? SOUNDS['7.62']!;
  return def.make(sr, seed(key, take));
}

/** Synthesises one take of a layered sound, all its parts at once. */
export function synthLayers(key: string, sr: number, take: number): Layered {
  return LAYERED[key]!.make(sr, seed(key, take));
}
