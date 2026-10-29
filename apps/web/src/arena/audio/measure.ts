// Measurements for the audition page: level, brightness, rhythm. Plain arrays in, numbers out.

/** In-place radix-2 FFT; `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const half = len / 2;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const h = i + k + half;
        const xr = re[h]! * c - im[h]! * s;
        const xi = re[h]! * s + im[h]! * c;
        re[h] = re[i + k]! - xr;
        im[h] = im[i + k]! - xi;
        re[i + k] = re[i + k]! + xr;
        im[i + k] = im[i + k]! + xi;
      }
    }
  }
}

/** Both channels mixed to one. */
export function mono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i]! += d[i]! / buf.numberOfChannels;
  }
  return out;
}

/** RMS in dBFS over [from, from + seconds). */
export function rmsDb(x: Float32Array, sr: number, from = 0, seconds = Infinity): number {
  const a = Math.floor(from * sr);
  const b = Math.min(x.length, a + Math.floor(seconds * sr));
  let e = 0;
  for (let i = a; i < b; i++) e += x[i]! * x[i]!;
  return 10 * Math.log10(e / Math.max(1, b - a) + 1e-20);
}

export function peakDb(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!));
  return 20 * Math.log10(m + 1e-20);
}

/** Power spectrum averaged over Hann frames (Welch). */
export function spectrum(x: Float32Array, n = 4096, from = 0, to = x.length): Float64Array {
  const p = new Float64Array(n / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let s = from; s + n <= to; s += n / 2) {
    for (let i = 0; i < n; i++) {
      re[i] = x[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) p[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  return p;
}

/** Spectral centroid in Hz: the power-weighted mean frequency (how bright it sounds). */
export function centroid(x: Float32Array, sr: number, from = 0, seconds = Infinity): number {
  const a = Math.floor(from * sr);
  const b = Math.min(x.length, a + Math.floor(seconds * sr));
  const p = spectrum(x, 4096, a, b);
  let num = 0;
  let den = 0;
  for (let k = 1; k < p.length; k++) {
    num += ((k * sr) / 4096) * p[k]!;
    den += p[k]!;
  }
  return den > 0 ? num / den : 0;
}

/** Times (s) where the level jumps: shots in a burst. */
export function onsets(x: Float32Array, sr: number, minGap = 0.012, ratio = 2.5): number[] {
  const hop = Math.round(sr * 0.001);
  const env: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let m = 0;
    for (let j = i; j < i + hop; j++) m = Math.max(m, Math.abs(x[j]!));
    env.push(m);
  }
  const peak = Math.max(...env, 1e-9);
  const out: number[] = [];
  let slow = 0;
  for (let i = 1; i < env.length; i++) {
    const v = env[i]!;
    if (v > peak * 0.2 && v > slow * ratio && (out.length === 0 || i / 1000 - out[out.length - 1]! >= minGap)) out.push(i / 1000);
    slow = Math.max(v, slow * 0.93);
  }
  return out;
}

/** The strongest amplitude modulation between `lo` and `hi` Hz: blade-pass, firing rate. */
export function modulation(x: Float32Array, sr: number, lo: number, hi: number): number {
  // Envelope at 1 kHz, then its spectrum.
  const rate = 1000;
  const hop = Math.round(sr / rate);
  const env: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e += Math.abs(x[j]!);
    env.push(e / hop);
  }
  let n = 1;
  while (n * 2 <= env.length) n *= 2;
  const mean = env.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const series = new Float32Array(n);
  for (let i = 0; i < n; i++) series[i] = env[i]! - mean;
  const p = spectrum(series, n, 0, n);
  let best = 0;
  let bestK = 0;
  for (let k = Math.ceil((lo * n) / rate); k <= Math.floor((hi * n) / rate) && k < p.length; k++) {
    if (p[k]! > best) {
      best = p[k]!;
      bestK = k;
    }
  }
  return (bestK * rate) / n;
}

/** Share of the energy arriving later than `after` seconds past `from`: how much is echo. */
export function lateShare(x: Float32Array, sr: number, from: number, after: number): number {
  const a = Math.floor(from * sr);
  const b = Math.floor((from + after) * sr);
  let early = 0;
  let late = 0;
  for (let i = a; i < x.length; i++) {
    const e = x[i]! * x[i]!;
    if (i < b) early += e;
    else late += e;
  }
  return late / Math.max(1e-20, early + late);
}

/** The repeat period (s) of the level between `lo` and `hi` seconds, by autocorrelation of the envelope. */
export function period(x: Float32Array, sr: number, lo: number, hi: number): number {
  const rate = 4000;
  const hop = Math.max(1, Math.round(sr / rate));
  const env: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let m = 0;
    for (let j = i; j < i + hop; j++) m = Math.max(m, Math.abs(x[j]!));
    env.push(m);
  }
  // Onset strength: only rises count, so overlapping tails do not blur the beat.
  const d = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
  let best = -Infinity;
  let bestLag = 0;
  for (let lag = Math.ceil(lo * rate); lag <= Math.floor(hi * rate); lag++) {
    let c = 0;
    for (let i = 0; i + lag < d.length; i++) c += d[i]! * d[i + lag]!;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return bestLag / rate;
}
