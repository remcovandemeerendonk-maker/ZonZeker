"""
Muziek en geluidseffecten voor de ZonZeker-promo, volledig zelf gesynthetiseerd (geen samples,
dus vrij te gebruiken). Vrolijke tropical house op 120 BPM, met effecten op de momenten uit
promo/timeline.json.

    python3 promo/music.py   → promo/out/audio.wav (stereo, 44,1 kHz)
"""
import json
import math
import os
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "timeline.json")))
SR = 44100
DUR = TL["duration"]
N = int(DUR * SR)
BEAT = 60 / TL["bpm"]
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def buf():
    return np.zeros((2, N))


def place(dst, sig, t, gain=1.0, pan=0.0):
    """Mix een mono (of stereo) signaal in op tijd t, met pan -1..1."""
    i = int(round(t * SR))
    if i >= N:
        return
    if sig.ndim == 1:
        l = math.cos((pan + 1) * math.pi / 4)
        r = math.sin((pan + 1) * math.pi / 4)
        sig = np.vstack([sig * l, sig * r])
    n = min(sig.shape[1], N - i)
    dst[:, i : i + n] += gain * sig[:, :n]


def env_adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, hold=None):
    t = np.arange(n) / SR
    hold = hold if hold is not None else n / SR - r
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel)


def saw(f, n, bright=1.0, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    f = f * 2 ** (detune / 1200)
    kmax = int(min(24, (SR / 2) / f))
    for k in range(1, kmax + 1):
        out += np.sin(2 * np.pi * k * f * t + k * 0.3) / (k ** (1 + 1.2 / bright))
    return out


def lowpass_ma(x, width):
    if width <= 1:
        return x
    k = np.ones(int(width)) / int(width)
    return np.convolve(x, k, mode="same")


def highpass(x):
    return x - lowpass_ma(x, 6)


def noise(n):
    return rng.uniform(-1, 1, n)


# ---------- instrumenten ----------

def pad_chord(notes, length, bright):
    n = int(length * SR)
    out = np.zeros((2, n))
    e = env_adsr(n, a=0.12, d=0.6, s=0.8, r=0.35)
    for m in notes:
        f = mtof(m)
        out[0] += saw(f, n, bright, -8) * e
        out[1] += saw(f, n, bright, +8) * e
    return out * 0.085


def pluck(m, length=0.5, bright=1.4):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    s = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.05) + 0.2 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.03)
    return s * np.exp(-t / (0.16 * bright)) * np.minimum(1, t / 0.002)


def marimba(m, length=0.9):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.42)
    s += 0.35 * np.sin(2 * np.pi * 3.93 * f * t) * np.exp(-t / 0.06)
    s += 0.12 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t / 0.02)
    return s * np.minimum(1, t / 0.0015)


def bass(m, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    return s * env_adsr(n, a=0.004, d=0.12, s=0.65, r=0.05)


def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    freq = 46 + 120 * np.exp(-t / 0.032)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    s = np.sin(phase) * np.exp(-t / 0.26)
    s[:120] += noise(120) * 0.4 * np.linspace(1, 0, 120)
    return s


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    nz = highpass(lowpass_ma(noise(n), 3))
    e = np.exp(-t / 0.11) * 0.6
    for off in (0.0, 0.011, 0.022):
        e += np.where(t >= off, np.exp(-(t - off) / 0.004), 0)
    return nz * e * 0.8


def hat(open_=False):
    n = int((0.35 if open_ else 0.08) * SR)
    t = np.arange(n) / SR
    nz = highpass(highpass(noise(n)))
    return nz * np.exp(-t / (0.16 if open_ else 0.022))


def shaker():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    nz = highpass(highpass(noise(n)))
    return nz * np.minimum(1, t / 0.008) * np.exp(-t / 0.035)


# ---------- effecten ----------

def bell(f, length=1.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.5) + 0.4 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / 0.18)
    return s * np.minimum(1, t / 0.001)


def sparkle(dst, t0, gain=0.22):
    for i, m in enumerate([88, 91, 95, 100, 103, 107]):
        place(dst, bell(mtof(m)), t0 + i * 0.045, gain * (0.8 ** i), pan=(-0.6 if i % 2 else 0.6))


def swept_noise(length, f_from, f_to, env):
    """Ruis die van dof naar helder (of andersom) gaat: blokgewijs gefilterd."""
    n = int(length * SR)
    nz = noise(n)
    out = np.zeros(n)
    block = 1024
    for b in range(0, n, block):
        p = b / n
        f = f_from * (f_to / f_from) ** p
        width = max(1, int(SR / (2.2 * f)))
        seg = nz[max(0, b - width) : b + block + width]
        filt = lowpass_ma(seg, width)
        off = b - max(0, b - width)
        out[b : b + block] = filt[off : off + block][: len(out[b : b + block])]
    return out * env(np.arange(n) / n)


def whoosh(dst, t_peak, gain=0.5, up=True):
    length = 1.1
    sig = swept_noise(length, 300 if up else 4000, 5000 if up else 300, lambda p: np.sin(np.pi * p) ** 2)
    n = len(sig)
    pan = np.linspace(-0.8, 0.8, n)
    st = np.vstack([sig * np.cos((pan + 1) * np.pi / 4), sig * np.sin((pan + 1) * np.pi / 4)])
    place(dst, st * 2.2, t_peak - length * 0.55, gain)


def riser(dst, t0, t1, gain=0.25):
    length = t1 - t0
    sig = swept_noise(length, 200, 7000, lambda p: p ** 2)
    n = len(sig)
    t = np.arange(n) / SR
    f = 220 * (8 ** (t / length))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / length) ** 2 * 0.25
    place(dst, sig * 2 + tone, t0, gain)


def tap_sound(dst, t0, gain=0.45):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 380 + 520 * np.exp(-t / 0.025)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.045)
    s[:60] += noise(60) * 0.3
    place(dst, s, t0, gain)


def key_click(dst, t0, gain=0.16, pan=0.0):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    s = highpass(noise(n)) * np.exp(-t / 0.004) + 0.4 * np.sin(2 * np.pi * 2900 * t) * np.exp(-t / 0.006)
    place(dst, s, t0, gain, pan)


def tick(dst, t0, gain=0.12, pitch=0):
    n = int(0.04 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * (1700 + pitch) * t) * np.exp(-t / 0.008)
    place(dst, s, t0, gain)


# ---------- effectketen ----------

def delay(x, time, fb=0.35, repeats=4, pingpong=True):
    out = x.copy()
    d = int(time * SR)
    cur = x
    for i in range(1, repeats + 1):
        cur = cur * fb
        shifted = np.zeros_like(x)
        shifted[:, d * i :] = cur[:, : N - d * i]
        if pingpong and i % 2:
            shifted = shifted[::-1]
        out += shifted
    return out


def reverb(x, length=1.6, mix=0.25):
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    size = 1 << int(math.ceil(math.log2(N + n)))
    for ch in range(2):
        ir = noise(n) * np.exp(-t / (length / 5))
        ir = lowpass_ma(ir, 4)
        ir /= np.sqrt(np.sum(ir ** 2))
        y = np.fft.irfft(np.fft.rfft(x[ch], size) * np.fft.rfft(ir, size), size)[:N]
        out[ch] = y
    return x + mix * out


def sidechain(kick_times, depth=0.55, rel=0.16):
    g = np.ones(N)
    t = np.arange(N) / SR
    for kt in kick_times:
        i = int(kt * SR)
        j = min(N, i + int(0.5 * SR))
        g[i:j] = np.minimum(g[i:j], 1 - depth * np.exp(-(t[i:j] - kt) / rel))
    return g


# ---------- arrangement ----------

CHORDS = [  # (pad-akkoord, basnoot) per maat
    ([53, 57, 60, 64], 41),  # Fmaj7
    ([55, 59, 62, 64], 43),  # G6
    ([52, 55, 59, 62], 40),  # Em7
    ([57, 60, 64, 67], 45),  # Am7
]
MELODY = [  # (tel, midi) per maat, herhaalt elke 4 maten
    [(0, 76), (0.75, 79), (1.5, 81), (2.5, 84), (3, 81)],
    [(0, 74), (0.75, 79), (1.5, 83), (2.5, 81), (3, 79)],
    [(0, 76), (0.75, 79), (1.5, 83), (2.5, 86), (3, 83)],
    [(0, 84), (0.75, 83), (1.5, 81), (2.5, 79), (3.25, 76)],
]
ARP_STEPS = [0, 0.75, 1.5, 2, 2.75, 3.5]  # 3-3-2-ritme

DROP = 8.0
END_DRUMS = 32.0
bars = int(math.ceil(DUR / BAR))

pads, arps, leads, basses, drums = buf(), buf(), buf(), buf(), buf()
kick_times = []

for b in range(bars):
    t0 = b * BAR
    chord, root = CHORDS[b % 4]
    grey = 4.0 <= t0 < 8.0
    outro = t0 >= END_DRUMS
    # Pad: dof in het grijze stuk, open daarna
    bright = 0.5 if grey else (1.0 if t0 < DROP else 1.4)
    length = BAR + 0.4 if not (outro and t0 + BAR >= DUR - 0.1) else DUR - t0
    place(pads, pad_chord(chord if not (outro and b == bars - 1) else CHORDS[0][0], length, bright), t0, 1.0)

    # Arpeggio
    if not grey or t0 >= 6.0:
        for i, st in enumerate(ARP_STEPS):
            m = chord[i % len(chord)] + 12
            g = 0.16 if t0 < DROP else 0.2
            place(arps, pluck(m, 0.45, 1.0 if t0 < DROP else 1.3), t0 + st * BEAT, g, pan=0.35 if i % 2 else -0.35)

    # Melodie (marimba) in het tweede deel en de outro
    if 16.0 <= t0 < 32.0 or t0 >= 32.0 and t0 < 36.0:
        for st, m in MELODY[b % 4]:
            place(leads, marimba(m), t0 + st * BEAT, 0.24, pan=0.1)

    # Bas en drums vanaf de drop tot het eindscherm
    if DROP <= t0 < END_DRUMS:
        place(basses, bass(root, 0.42), t0, 0.5)
        for st in (1.5, 2.5, 3.5):
            place(basses, bass(root + (12 if st == 2.5 else 0), 0.22), t0 + st * BEAT, 0.42)
        for beat in range(4):
            kt = t0 + beat * BEAT
            kick_times.append(kt)
            place(drums, kick(), kt, 0.85)
            place(drums, hat(), kt + BEAT / 2, 0.16, pan=0.3)
            if beat in (1, 3):
                place(drums, clap(), kt, 0.45, pan=-0.05)
            for s16 in range(4):
                place(drums, shaker(), kt + s16 * BEAT / 4, 0.05 + (0.03 if s16 == 2 else 0), pan=-0.4)
        if t0 >= 16.0:
            place(drums, hat(open_=True), t0 + 3.5 * BEAT, 0.08, pan=0.4)

# Opbouw naar de drop: rommel van claps die aanzwelt
for i in range(16):
    t = 7.0 + i * BEAT / 4
    place(drums, clap(), t, 0.08 + 0.3 * (i / 15) ** 2, pan=0)
# Korte fill voor het eindscherm
for i in range(4):
    place(drums, clap(), END_DRUMS - BEAT + i * BEAT / 4, 0.2 + 0.08 * i)

sc = sidechain(kick_times)
music = pads * sc + delay(arps, 0.375, 0.32, 3) * (0.6 + 0.4 * sc) + delay(leads, 0.375, 0.25, 2) + basses * sc
music = reverb(music, 1.8, 0.28) + drums

# Afsluitend akkoord met belletje
place(music, pluck(65 + 12, 1.0) * 0.5, END_DRUMS, 0.3)

# ---------- geluidseffecten op de beelden ----------
fx = buf()
for t in TL["sparkle"]:
    sparkle(fx, t)
for i, t in enumerate(TL["whoosh"]):
    whoosh(fx, t, 0.42, up=(i == 0))
riser(fx, 5.6, DROP - 0.02, 0.22)
# klap van de zon die doorbreekt
place(fx, bell(mtof(84), 1.6), 6.05, 0.12)

S = TL["slider"]
prev = None
for f in range(int(S["start"] * 30) - 6, int(S["end"] * 30) + 6):
    t = f / 30
    p = min(1, max(0, (t - S["start"]) / (S["end"] - S["start"])))
    e = 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2
    v = round((S["from"] + (S["to"] - S["from"]) * e) * 2) / 2
    if prev is not None and v != prev:
        tick(fx, t, 0.13, pitch=int(v * 60))
    prev = v

T = TL["typing"]
for i in range(len(T["text"])):
    key_click(fx, T["start"] + i * T["interval"], 0.17, pan=(-0.2 + 0.4 * rng.random()))
for t in TL["taps"]:
    tap_sound(fx, t, 0.5)

mix = music * 0.9 + reverb(fx, 1.0, 0.18)

# ---------- master ----------
t = np.arange(N) / SR
fade = np.clip(t / 0.04, 0, 1) * np.clip((DUR - t) / 2.2, 0, 1)
mix *= fade
# Eerst op niveau brengen, dan alleen de pieken zacht afronden (geen platgeslagen mix).
mix /= np.percentile(np.abs(mix), 99.95)
mix = np.tanh(mix * 0.9) / np.tanh(0.9)
mix *= 0.89 / np.max(np.abs(mix))

os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
out = os.path.join(HERE, "out", "audio.wav")
pcm = (mix.T * 32767).astype("<i2")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("klaar:", out)
