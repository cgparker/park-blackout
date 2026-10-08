"""Makes the 3D game's music and sound effects in public3d/audio/.

Two kinds of sound:
- Cut from CC0 packs (OpenGameArt and Kenney). The packs are not in this repo. Fetch them with --fetch,
  which puts each one in its own folder under --src, then run again without it. SOURCES records where
  each came from; public3d/LICENSES.md lists them.
- Made here, from noise and tones: the dart shots, the power going down and coming back, the "?" cue
  when a raptor notices a troop, and the sting when a troop is lost. No source recordings.

Everything is mono MP3: phones play it everywhere, and mono halves the memory a decoded track takes.
One-shots are matched for loudness (their loud part sits at -18 dBFS RMS, peaks at most -1 dBFS), music
at -18 LUFS and ambience at -30 LUFS. The game sets each sound's level on top (AUDIO in src/config.ts).

Usage:
  python3 scripts/audio3d.py --src /path/to/packs --fetch   # download the packs once
  python3 scripts/audio3d.py --src /path/to/packs           # write public3d/audio/*.mp3
Needs ffmpeg with libmp3lame, numpy, and scipy.
"""
import argparse
import os
import struct
import subprocess
import sys
import tempfile
import urllib.request
import wave
import zipfile

import numpy as np
from scipy import signal

SR = 44100
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'public3d', 'audio')
TABLE = os.path.join(ROOT, 'src', 'audio', 'files.ts')
OGA = 'https://opengameart.org/sites/default/files/'

# Pack folder -> (page, download). Every one is CC0 1.0.
SOURCES = {
    'bamboo-blitz': ('https://opengameart.org/content/bamboo-blitz', OGA + 'bamboo_blitz.flac'),
    'determined-pursuit': ('https://opengameart.org/content/determined-pursuit-epic-orchestra-loop', OGA + 'determined_pursuit_loop.wav'),
    'suspicious-loop': ('https://opengameart.org/content/suspicious-loop', OGA + 'sus_corner_loop.mp3'),
    'jungle-thriller': ('https://opengameart.org/content/jungle-thriller', OGA + 'jungle_thriller_0.mp3'),
    'kenney-music-jingles': ('https://kenney.nl/assets/music-jingles', 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip'),
    't-rex-calls': ('https://opengameart.org/content/t-rex-calls', OGA + 't-rex_calls.mp3'),
    'creature-sfx-1': ('https://opengameart.org/content/80-cc0-creature-sfx', OGA + '80-CC0-creature-SFX_0.zip'),
    'creature-sfx-2': ('https://opengameart.org/content/80-cc0-creture-sfx-2', OGA + '80-CC0-creature-sfx-2.zip'),
    'metal-wood-sfx': ('https://opengameart.org/content/100-cc0-metal-and-wood-sfx', OGA + '100-CC0-wood-metal-SFX.zip'),
    'breaking-sfx': ('https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx', OGA + 'sfx_breaking_and_falling.zip'),
    'kenney-impact-sounds': ('https://kenney.nl/assets/impact-sounds', 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip'),
    'sirens': ('https://opengameart.org/content/sirens-and-alarm-noise', OGA + 'siren_0.mp3'),
    'sfx-loops': ('https://opengameart.org/content/30-cc0-sfx-loops', OGA + 'sfx_loops.zip'),
    'crickets': ('https://opengameart.org/content/crickets-ambient-noise-loopable', OGA + 'crickets_1.mp3'),
    'forest-ambience': ('https://opengameart.org/node/23888', OGA + 'Forest_Ambience.mp3'),
    'kenney-interface-sounds': ('https://kenney.nl/assets/interface-sounds', 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip'),
    'kenney-rpg-audio': ('https://kenney.nl/assets/rpg-audio', 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip'),
}

# One-shots cut from the packs: output name, pack, file inside it (zips are unpacked to x/), and changes.
# trim: (start, end) seconds. semitones: pitch and speed together, like a slower, bigger animal. fade: seconds out.
SFX = [
    ('ui_tap', 'kenney-interface-sounds', 'x/Audio/click_001.ogg', {}),
    ('ui_select', 'kenney-interface-sounds', 'x/Audio/select_007.ogg', {}),
    ('ui_order', 'kenney-interface-sounds', 'x/Audio/pluck_001.ogg', {}),
    ('ui_error', 'kenney-interface-sounds', 'x/Audio/error_004.ogg', {}),
    ('ui_ready', 'kenney-interface-sounds', 'x/Audio/confirmation_001.ogg', {}),
    ('ui_tip', 'kenney-interface-sounds', 'x/Audio/drop_002.ogg', {}),
    ('secured_chime', 'kenney-interface-sounds', 'x/Audio/confirmation_003.ogg', {}),
    ('build', 'metal-wood-sfx', 'x/hammer_01.ogg', {}),
    ('reinforce', 'kenney-impact-sounds', 'x/Audio/impactPunch_heavy_001.ogg', {}),
    ('tower', 'metal-wood-sfx', 'x/metal_close_01.ogg', {}),
    ('coin', 'kenney-rpg-audio', 'x/Audio/handleCoins2.ogg', {}),
    ('jeep_door', 'kenney-impact-sounds', 'x/Audio/impactMetal_heavy_002.ogg', {}),
    ('jeep_wreck', 'breaking-sfx', 'x/bfh1_metal_falling_01.ogg', {}),
    ('engineer_work_1', 'metal-wood-sfx', 'x/tools_01.ogg', {}),
    ('engineer_work_2', 'metal-wood-sfx', 'x/tools_04.ogg', {}),
    ('engineer_work_3', 'metal-wood-sfx', 'x/tools_07.ogg', {}),
    ('fence_chain_1', 'kenney-impact-sounds', 'x/Audio/impactMetal_light_000.ogg', {}),
    ('fence_chain_2', 'kenney-impact-sounds', 'x/Audio/impactMetal_light_002.ogg', {}),
    ('fence_chain_3', 'kenney-impact-sounds', 'x/Audio/impactMetal_light_004.ogg', {}),
    ('fence_concrete_1', 'kenney-impact-sounds', 'x/Audio/impactPunch_heavy_000.ogg', {}),
    ('fence_concrete_2', 'kenney-impact-sounds', 'x/Audio/impactPunch_heavy_003.ogg', {}),
    ('fence_breach', 'metal-wood-sfx', 'x/metal_falling_01.ogg', {}),
    ('dino_down', 'kenney-impact-sounds', 'x/Audio/impactSoft_heavy_000.ogg', {}),
    ('raptor_call_1', 'creature-sfx-1', 'x/scream_01.ogg', {}),
    ('raptor_call_2', 'creature-sfx-1', 'x/roar_03.ogg', {}),
    ('raptor_hiss', 'creature-sfx-2', 'x/breath_02.ogg', {}),
    ('raptor_bite_1', 'creature-sfx-1', 'x/eat_01.ogg', {}),
    ('raptor_bite_2', 'creature-sfx-1', 'x/eat_04.ogg', {}),
    ('raptor_bite_3', 'creature-sfx-2', 'x/attack_05.ogg', {}),
    ('raptor_die', 'creature-sfx-2', 'x/die_04.ogg', {}),
    ('trex_roar', 't-rex-calls', 't-rex_calls.mp3', {'trim': (4.2, 6.6), 'fade': 0.5}),
    ('trex_growl', 't-rex-calls', 't-rex_calls.mp3', {'trim': (16.0, 17.3), 'fade': 0.3}),
    ('trex_die', 't-rex-calls', 't-rex_calls.mp3', {'trim': (36.7, 39.6), 'fade': 1.2}),
    ('trex_bite', 'creature-sfx-1', 'x/eat_02.ogg', {'semitones': -6}),
    ('trike_bellow', 'creature-sfx-2', 'x/grunt_06.ogg', {'semitones': -3}),
    ('guest_cry', 'creature-sfx-2', 'x/human_04.ogg', {}),
    ('alarm_siren', 'sirens', 'siren_0.mp3', {'trim': (26.25, 30.2), 'fade': 0.6}),
    ('alarm_warning', 'sfx-loops', 'x/alarm_02.ogg', {}),
    ('jingle_win', 'kenney-music-jingles', 'x/Audio/Pizzicato jingles/jingles_PIZZI10.ogg', {}),
    ('jingle_lose', 'kenney-music-jingles', 'x/Audio/Pizzicato jingles/jingles_PIZZI07.ogg', {}),
]

# Loops: (name, pack, file, target LUFS, bitrate, seam). The game loops each one without a gap. Where a source
# was itself an MP3 its loop point may be a few samples off, so every loop's last `seam` seconds are blended into its
# start: the join can't click, and music is shortened by too little to hear.
LOOPS = [
    ('music_day', 'bamboo-blitz', 'bamboo_blitz.flac', -18, '96k', 0.02),
    ('music_chase', 'determined-pursuit', 'determined_pursuit_loop.wav', -18, '96k', 0.02),
    ('music_sneak', 'suspicious-loop', 'sus_corner_loop.mp3', -18, '96k', 0.02),
    ('music_tension', 'jungle-thriller', 'jungle_thriller_0.mp3', -18, '96k', 0.02),
    ('amb_day', 'forest-ambience', 'Forest_Ambience.mp3', -30, '64k', 0.5),
    ('amb_night', 'crickets', 'crickets_1.mp3', -30, '64k', 0.5),
]


# ---------------------------------------------------------------- input and output

def fetch(src):
    for slug, (_, url) in SOURCES.items():
        folder = os.path.join(src, slug)
        os.makedirs(folder, exist_ok=True)
        name = os.path.basename(url)
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            print('fetching', url)
            urllib.request.urlretrieve(url, path)
        if name.endswith('.zip'):
            with zipfile.ZipFile(path) as z:
                for member in z.namelist():
                    if member.startswith('/') or '..' in member.split('/'):
                        raise SystemExit(f'{path}: unsafe path {member}')
                z.extractall(os.path.join(folder, 'x'))


def decode(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).astype(np.float64)


def write_wav(x, path):
    with wave.open(path, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def encode(x, name, bitrate='96k'):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'a.wav')
        write_wav(x, wav)
        out = os.path.join(OUT, f'{name}.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', bitrate, '-ac', '1', out], check=True)
    return out


def mp3_frames(path):
    """Audio frames in an MP3, from its Info header. With the sample count, the game works out where the sound starts
    in what the browser decodes: some browsers drop the encoder's lead-in and padding, some keep them."""
    data = open(path, 'rb').read()
    i = data.find(b'Info')
    if i < 0 or i > 200:
        raise RuntimeError(f'{path}: no Info header')
    flags = struct.unpack('>I', data[i + 4: i + 8])[0]
    if not flags & 1:
        raise RuntimeError(f'{path}: Info header without a frame count')
    return struct.unpack('>I', data[i + 8: i + 12])[0]


def lufs(x):
    """Integrated loudness, measured by ffmpeg's EBU R128 meter."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'a.wav')
        write_wav(x, wav)
        err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'],
                             capture_output=True, text=True).stderr
    for line in reversed(err.splitlines()):
        if line.strip().startswith('I:'):
            return float(line.split()[1])
    raise RuntimeError('no loudness reading')


# ---------------------------------------------------------------- shaping

def db(v):
    return 10 ** (v / 20)


def fade(x, seconds_in=0.003, seconds_out=0.01):
    x = x.copy()
    a = min(len(x), int(seconds_in * SR))
    b = min(len(x), int(seconds_out * SR))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def trim_silence(x, floor=db(-50)):
    """Drops near silence at both ends, so a sound starts the moment it's played."""
    loud = np.where(np.abs(x) > floor * np.abs(x).max())[0]
    if not len(loud):
        return x
    a = max(0, loud[0] - int(0.002 * SR))
    b = min(len(x), loud[-1] + int(0.02 * SR))
    return x[a:b]


def varispeed(x, semitones):
    """Pitch and speed together, as a tape slowed down."""
    ratio = 2 ** (semitones / 12)
    up, down = 1000, int(round(1000 * ratio))
    g = np.gcd(up, down)
    return signal.resample_poly(x, up // g, down // g)


def level_oneshot(x, rms_db=-18.0, peak_db=-1.0):
    """The loud part (frames within 20 dB of the loudest) at rms_db, with the peak no higher than peak_db."""
    n = 1024
    k = max(1, len(x) // n)
    frames = x[: k * n].reshape(k, n) if len(x) >= n else x.reshape(1, -1)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    loud = rms[rms > rms.max() * db(-20)]
    g = db(rms_db) / max(np.sqrt((loud ** 2).mean()), 1e-9)
    g = min(g, db(peak_db) / max(np.abs(x).max(), 1e-9))
    return x * g


def seamless(x, seconds):
    """Blends the last `seconds` into the start, equal power, and drops them: the end now runs into the start."""
    n = int(seconds * SR)
    t = np.linspace(0, np.pi / 2, n)
    y = x[: len(x) - n].copy()
    y[:n] = x[:n] * np.sin(t) + x[len(x) - n:] * np.cos(t)
    return y


def level_loop(x, target_lufs, peak_db=-1.0):
    g = db(target_lufs - lufs(x))
    g = min(g, db(peak_db) / max(np.abs(x).max(), 1e-9))
    return x * g


# ---------------------------------------------------------------- made here

rng = np.random.default_rng(7)


def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def bandpass(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def lowpass(x, hi, order=2):
    sos = signal.butter(order, hi, btype='low', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def click(seconds=0.012, hz=1400):
    t = t_axis(seconds)
    return np.sin(2 * np.pi * hz * t) * np.exp(-t / 0.003)


def dart_light():
    """A tranq rifle: a click and a short, bright puff of air."""
    t = t_axis(0.2)
    air = bandpass(rng.standard_normal(len(t)), 2200, 6500) * np.exp(-t / 0.035)
    whiff = bandpass(rng.standard_normal(len(t)), 1200, 3000) * np.exp(-((t - 0.05) / 0.04) ** 2) * 0.35
    x = air + whiff
    x[: len(click())] += click() * 0.5
    return x


def dart_heavy():
    """A heavy dart gun: a low thump under a bigger puff."""
    t = t_axis(0.32)
    f = 55 + 85 * np.exp(-t / 0.04)
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.06)
    air = bandpass(rng.standard_normal(len(t)), 700, 2600) * np.exp(-t / 0.05) * 0.8
    x = thump + air
    x[: len(click(hz=900))] += click(hz=900) * 0.6
    return x


def hum(f, t, harmonics=((1, 1.0), (2, 0.5), (3, 0.3), (5, 0.12))):
    phase = 2 * np.pi * np.cumsum(f) / SR
    return sum(a * np.sin(h * phase) for h, a in harmonics)


def relay():
    """The clunk of a big switch."""
    t = t_axis(0.12)
    body = np.sin(2 * np.pi * 70 * t) * np.exp(-t / 0.03)
    snap = bandpass(rng.standard_normal(len(t)), 1500, 5000) * np.exp(-t / 0.008) * 0.6
    return body + snap


def power_down():
    """The grid going down: a clunk, then the hum winds down and dies, with a few crackles."""
    t = t_axis(1.8)
    f = 25 + 95 * np.exp(-t / 0.45)
    x = hum(f, t) * np.exp(-t / 0.55) * 0.6
    crackle = (rng.random(len(t)) > 0.9985) * rng.standard_normal(len(t)) * np.exp(-t / 0.25)
    x += bandpass(crackle, 1000, 6000) * 2.5
    r = relay()
    x[: len(r)] += r
    return x


def power_up():
    """Power coming back: a clunk, then the hum rises and settles, with a faint whine over it."""
    t = t_axis(1.3)
    f = 120 - 90 * np.exp(-t / 0.25)
    rise = np.clip(t / 0.35, 0, 1)
    x = hum(f, t) * rise * 0.45
    whine = np.sin(2 * np.pi * np.cumsum(1800 + 1400 * np.clip(t / 0.6, 0, 1)) / SR) * rise * 0.04
    x = x + whine
    x *= np.clip((1.3 - t) / 0.35, 0, 1)
    r = relay()
    x[: len(r)] += r
    return x


def notice():
    """The "?" when a raptor notices a troop: two soft notes going up."""
    out = np.zeros(int(0.36 * SR))
    for start, hz in ((0.0, 880.0), (0.11, 1174.7)):
        t = t_axis(0.24)
        note = np.sin(2 * np.pi * hz * t) * np.minimum(t / 0.01, 1) * np.exp(-t / 0.05)
        a = int(start * SR)
        out[a: a + len(note)] += fade(note, 0, 0.02)
    return out


def troop_lost():
    """A troop is lost: two low notes, a half step down, like a muted horn."""
    out = np.zeros(int(0.85 * SR))
    for start, hz, length in ((0.0, 164.8, 0.32), (0.3, 155.6, 0.55)):
        t = t_axis(length)
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5 * t)
        phase = 2 * np.pi * np.cumsum(hz * vib) / SR
        note = sum(np.sin(h * phase) / h ** 1.4 for h in range(1, 8))
        note *= np.minimum(t / 0.03, 1) * np.exp(-t / (length * 0.6))
        a = int(start * SR)
        out[a: a + len(note)] += fade(note, 0, 0.06)
    return lowpass(out, 1400)


MADE = [
    ('dart_light', dart_light),
    ('dart_heavy', dart_heavy),
    ('power_down', power_down),
    ('power_up', power_up),
    ('notice', notice),
    ('troop_lost', troop_lost),
]


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='folder with one subfolder per pack (see SOURCES)')
    ap.add_argument('--fetch', action='store_true', help='download the packs into --src and stop')
    args = ap.parse_args()
    if args.fetch:
        fetch(args.src)
        return
    os.makedirs(OUT, exist_ok=True)
    rows = []

    def add(name, x, bitrate='96k'):
        rows.append((name, len(x), encode(x, name, bitrate)))

    for name, pack, rel, opt in SFX:
        x = decode(os.path.join(args.src, pack, rel))
        if 'trim' in opt:
            a, b = opt['trim']
            x = x[int(a * SR): int(b * SR)]
        else:
            x = trim_silence(x)
        if 'semitones' in opt:
            x = varispeed(x, opt['semitones'])
        x = fade(x, 0.003, opt.get('fade', 0.01))
        add(name, level_oneshot(x))
    for name, make in MADE:
        add(name, level_oneshot(fade(make(), 0.002, 0.02)))
    for name, pack, rel, target, bitrate, seam in LOOPS:
        add(name, level_loop(seamless(decode(os.path.join(args.src, pack, rel)), seam), target), bitrate)

    total = 0
    lines = []
    for name, samples, path in sorted(rows):
        size = os.path.getsize(path)
        total += size
        print(f'{name:18s} {samples / SR:7.2f} s {size / 1024:8.1f} KB')
        lines.append(f'  {name}: {{ samples: {samples}, frames: {mp3_frames(path)} }},')
    with open(TABLE, 'w') as f:
        f.write('// Written by scripts/audio3d.py. Do not edit: run the script again.\n')
        f.write(f'// Every sound in public3d/audio/: its length in samples at {SR} Hz, and its MP3 frames.\n')
        f.write('export const FILES = {\n' + '\n'.join(lines) + '\n} as const;\n\n')
        f.write('export type FileId = keyof typeof FILES;\n')
    print(f'{len(rows)} files, {total / 1048576:.2f} MB')


if __name__ == '__main__':
    sys.exit(main())
