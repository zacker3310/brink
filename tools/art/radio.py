"""Radio calls for the battle: Kokoro TTS lines, filtered to sound like a squad net.

Writes apps/web/public/art/radio/<call>-<n>.mp3 (contact-<dir>-<n>.mp3 for directions) and
manifest.json. Needs `pip install kokoro-onnx soundfile` and ffmpeg with libmp3lame; the model
files come from the kokoro-onnx releases (model-files-v1.0: kokoro-v1.0.onnx, voices-v1.0.bin).

    python -I tools/art/radio.py --model <dir>/kokoro-v1.0.onnx --voices <dir>/voices-v1.0.bin

Chain per take: TTS, trim, band-pass 300 to 3,400 Hz with a presence lift, light RMS compression,
tanh saturation, a static bed with crackle, a squelch click on key-up and a noise tail on release,
peak-normalised, mono MP3.
"""

import argparse
import json
import os
import subprocess
import tempfile
import zlib

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'art', 'radio'))

# (call, direction or None, take, text, voice, speed). Two takes a call, two voices a call.
LINES = [
    ('contact', 'front', 1, 'Contact front!', 'am_michael', 1.2),
    ('contact', 'front', 2, 'Contact front!', 'am_onyx', 1.2),
    ('contact', 'left', 1, 'Contact left!', 'am_adam', 1.2),
    ('contact', 'left', 2, 'Contact left!', 'am_eric', 1.2),
    ('contact', 'right', 1, 'Contact right!', 'am_eric', 1.2),
    ('contact', 'right', 2, 'Contact right!', 'am_michael', 1.2),
    ('contact', 'rear', 1, 'Contact rear!', 'am_onyx', 1.2),
    ('contact', 'rear', 2, 'Contact rear!', 'am_adam', 1.2),
    ('destroyed', None, 1, 'Target destroyed.', 'am_adam', 1.15),
    ('destroyed', None, 2, 'Good kill, target down.', 'am_michael', 1.15),
    ('taking_fire', None, 1, 'Taking fire!', 'am_eric', 1.25),
    ('taking_fire', None, 2, "We're under fire!", 'am_onyx', 1.25),
    ('man_down', None, 1, 'Man down!', 'am_michael', 1.2),
    ('man_down', None, 2, 'Casualty, need a medic!', 'am_adam', 1.25),
    ('smoke', None, 1, 'Smoke out!', 'am_onyx', 1.2),
    ('smoke', None, 2, 'Popping smoke!', 'am_eric', 1.2),
    ('splash', None, 1, 'Splash, over.', 'am_adam', 1.1),
    ('splash', None, 2, 'Rounds on target.', 'am_onyx', 1.15),
    ('vehicle_hit', None, 1, "We're hit!", 'am_fenrir', 1.25),
    ('vehicle_hit', None, 2, 'Vehicle hit, still in the fight.', 'am_michael', 1.25),
    ('air_threat', None, 1, 'Air threat, helo inbound!', 'am_michael', 1.25),
    ('air_threat', None, 2, 'Enemy aircraft!', 'am_adam', 1.2),
    ('moving', None, 1, 'Moving.', 'am_onyx', 1.1),
    ('moving', None, 2, 'Oscar Mike.', 'am_eric', 1.1),
    ('dismount', None, 1, 'Dismount, dismount!', 'am_adam', 1.25),
    ('dismount', None, 2, 'Troops out!', 'am_michael', 1.2),
]


def name_of(call, direction, take):
    stem = call.replace('_', '-')
    return f'{stem}-{direction}-{take}.mp3' if direction else f'{stem}-{take}.mp3'


def db(x):
    return 10 ** (x / 20)


def shape(x, sr, gain):
    """Zero-phase filter in the frequency domain: gain(f) is the magnitude response."""
    n = len(x)
    size = 1 << int(np.ceil(np.log2(n + sr // 10)))
    spec = np.fft.rfft(x, size)
    f = np.fft.rfftfreq(size, 1 / sr)
    return np.fft.irfft(spec * gain(f), size)[:n]


def butter_hp(f, fc, order):
    with np.errstate(divide='ignore'):
        return 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-6)) ** (2 * order))


def butter_lp(f, fc, order):
    return 1 / np.sqrt(1 + (f / fc) ** (2 * order))


def bell(f, fc, gain_db, octaves):
    # Gaussian in log frequency: a peaking EQ without phase.
    lf = np.log2(np.maximum(f, 1) / fc)
    return db(gain_db * np.exp(-0.5 * (lf / (octaves / 2.355)) ** 2))


def band(x, sr, lo=300, hi=3400, order=4):
    return shape(x, sr, lambda f: butter_hp(f, lo, order) * butter_lp(f, hi, order))


def rms_env(x, sr, ms):
    w = max(1, int(sr * ms / 1000))
    k = np.ones(w) / w
    return np.sqrt(np.convolve(x * x, k, mode='same') + 1e-12)


def compress(x, sr, threshold_db=-20.0, ratio=3.0, ms=8):
    env = 20 * np.log10(rms_env(x, sr, ms))
    over = np.maximum(env - threshold_db, 0)
    gain = db(-over * (1 - 1 / ratio))
    # Smooth the gain so it does not crackle on syllables.
    gain = np.convolve(gain, np.ones(int(sr * 0.004)) / int(sr * 0.004), mode='same')
    return x * gain


def trim(x, sr, floor_db=-42):
    level = rms_env(x, sr, 6)
    on = np.nonzero(level > db(floor_db) * np.max(np.abs(x)))[0]
    if len(on) == 0:
        return x
    a = max(0, on[0] - int(sr * 0.01))
    b = min(len(x), on[-1] + int(sr * 0.03))
    return x[a:b]


def static(n, sr, rng, level_db):
    hiss = band(rng.standard_normal(n), sr, 400, 3800, 2)
    hiss *= db(level_db) / (np.sqrt(np.mean(hiss * hiss)) + 1e-12)
    # Crackle: sparse impulses of random size, about 30 a second.
    crack = np.zeros(n)
    hits = rng.random(n) < 30 / sr
    crack[hits] = rng.standard_normal(int(hits.sum())) * db(level_db + 14)
    crack = band(crack, sr, 600, 3600, 2)
    return hiss + crack


def click(sr, rng, freq=1150, ms=5, level=0.7):
    n = int(sr * ms / 1000)
    t = np.arange(n) / sr
    ring = np.sin(2 * np.pi * freq * t + rng.random() * 6.28) * np.exp(-t / 0.0012)
    ring[:2] += [1.0, -0.6]
    return ring * level


def process(voice, sr, rng):
    v = trim(voice, sr)
    v = v / (np.max(np.abs(v)) + 1e-9) * 0.9
    v = shape(v, sr, lambda f: butter_hp(f, 300, 4) * butter_lp(f, 3400, 4) * bell(f, 1800, 4.0, 1.2))
    v = compress(v, sr)
    v = v / (np.max(np.abs(v)) + 1e-9)
    drive = 2.2
    v = np.tanh(drive * v) / np.tanh(drive)
    v = band(v, sr, 260, 3600, 3)

    key = int(sr * 0.075)
    gap = int(sr * 0.035)
    tail = int(sr * 0.16)
    n = key + len(v) + gap + tail
    out = np.zeros(n)
    out += static(n, sr, rng, -34)
    # Key-up: the click, then the carrier hiss a little louder until the voice comes in.
    c = click(sr, rng)
    out[: len(c)] += c
    out[:key] += static(key, sr, rng, -27) * np.linspace(1, 0.3, key)
    out[key : key + len(v)] += v * 0.8
    # Release: a squelch burst with a sharp start and a quick fade, then a last small click.
    s0 = key + len(v) + gap
    burst = band(rng.standard_normal(tail), sr, 500, 3800, 2)
    burst *= db(-15) / (np.sqrt(np.mean(burst * burst)) + 1e-12)
    env = np.minimum(1, np.arange(tail) / (sr * 0.003)) * np.exp(-np.arange(tail) / (sr * 0.07))
    out[s0 : s0 + tail] += burst * env
    c2 = click(sr, rng, 900, 4, 0.35)
    out[n - len(c2) :] += c2
    out = band(out, sr, 250, 3800, 2)
    fade = int(sr * 0.002)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out / (np.max(np.abs(out)) + 1e-9) * db(-1)


def encode(wav, mp3, kbps):
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '22050',
         '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', '-map_metadata', '-1', '-id3v2_version', '0',
         '-write_id3v1', '0', mp3],
        check=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--work', default=None, help='scratch folder for the WAVs')
    ap.add_argument('--kbps', type=int, default=40)
    args = ap.parse_args()

    tts = Kokoro(args.model, args.voices)
    work = args.work or tempfile.mkdtemp(prefix='radio-')
    os.makedirs(args.out, exist_ok=True)
    calls = {}
    clips = {}
    for call, direction, take, text, voice, speed in LINES:
        name = name_of(call, direction, take)
        samples, sr = tts.create(text, voice=voice, speed=speed, lang='en-us')
        rng = np.random.default_rng(zlib.crc32(name.encode()))
        out = process(np.asarray(samples, dtype=np.float64), sr, rng)
        wav = os.path.join(work, name.replace('.mp3', '.wav'))
        sf.write(wav, out.astype(np.float32), sr, subtype='PCM_16')
        mp3 = os.path.join(args.out, name)
        encode(wav, mp3, args.kbps)
        size = os.path.getsize(mp3)
        calls.setdefault(call, {}).setdefault(direction or 'any', []).append(name)
        clips[name] = {'text': text, 'voice': voice, 'seconds': round(len(out) / sr, 2), 'bytes': size}
        print(f'{name:28s} {voice:11s} {len(out) / sr:5.2f} s {size / 1024:5.1f} KB  {text}')

    manifest = {
        'source': 'Kokoro-82M (hexgrad, Apache-2.0) via kokoro-onnx (MIT), radio-filtered by tools/art/radio.py',
        'calls': calls,
        'clips': clips,
    }
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    total = sum(c['bytes'] for c in clips.values())
    print(f'{len(clips)} clips, {total / 1024:.1f} KB')


if __name__ == '__main__':
    main()
