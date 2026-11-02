"""Builds the demo-video soundtrack from the captured timeline.

Usage: python3 scripts/demo-video/mix.py <timeline.json> <voice_dir> <out_dir>
Writes voice.wav (dialogue only), music.wav (synthesized pad, already ducked), sfx.wav and mix.wav,
all 48 kHz stereo. Sound effects only mark clicks, state changes and milestones — no coin or
reward sounds for transactions. Everything is synthesized here; no third-party music is used.
"""
import json
import sys
import wave

import numpy as np

SR = 48_000


def read_wav(path):
    with wave.open(path, 'rb') as w:
        raw = w.readframes(w.getnframes())
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
        if w.getnchannels() == 2:
            data = data.reshape(-1, 2).mean(axis=1)
        assert w.getframerate() == SR, path
    return data


def write_wav(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def place(track, clip, at, gain=1.0):
    i = int(round(at * SR))
    if i >= len(track):
        return
    n = min(len(clip), len(track) - i)
    track[i:i + n] += clip[:n] * gain


def env(n, attack, release):
    e = np.ones(n, dtype=np.float32)
    a = min(int(attack * SR), n // 2)
    r = min(int(release * SR), n - a)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def tone(freq, dur, decay=None, harmonics=((1, 1.0),), attack=0.005):
    t = np.arange(int(dur * SR)) / SR
    wave_ = sum(a * np.sin(2 * np.pi * freq * h * t) for h, a in harmonics)
    shape = np.exp(-t / decay) if decay else np.ones_like(t)
    a = int(attack * SR)
    if a:
        shape[:a] *= np.linspace(0, 1, a)
    return (wave_ * shape).astype(np.float32)


def lowpass(x, cutoff):
    """One-pole low-pass magnitude response applied in the frequency domain (zero phase)."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec /= np.sqrt(1 + (f / cutoff) ** 2)
    return np.fft.irfft(spec, n=len(x)).astype(np.float32)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def music(duration, sections):
    """Soft pad + sparse plucks. sections: list of (start, end, mood)."""
    n = int(duration * SR)
    pad = np.zeros(n, dtype=np.float32)
    pluck = np.zeros(n, dtype=np.float32)
    bright = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]]   # Cmaj7 Am7 Fmaj7 G
    dark = [[57, 60, 64], [52, 55, 59], [53, 57, 60], [55, 59, 62]]                      # Am Em F G
    resolve = [[53, 57, 60, 64], [55, 59, 62, 65], [60, 64, 67, 72], [60, 64, 67, 72]]  # F G7 C C
    bar = 4.0
    for start, end, mood in sections:
        chords = dark if mood == 'dark' else resolve if mood == 'end' else bright
        t = start
        k = 0
        while t < end - 0.05:
            dur = min(bar, end - t)
            chord = chords[k % len(chords)]
            for note in chord:
                f = midi(note - 12 if mood == 'dark' else note)
                seg = tone(f, dur + 1.2, harmonics=((1, 1.0), (2, 0.18), (3, 0.05)), attack=0.0)
                seg *= env(len(seg), 1.1, 1.4) * 0.045
                # Gentle detuned twin for width.
                seg += tone(f * 1.004, dur + 1.2, attack=0.0) * env(len(seg), 1.1, 1.4) * 0.025
                place(pad, seg, t)
            bass = tone(midi(chord[0] - 24), dur + 0.8, harmonics=((1, 1.0), (2, 0.25)), attack=0.0) * env(int((dur + 0.8) * SR), 0.6, 1.0) * 0.06
            place(pad, bass, t)
            if mood in ('calm', 'end'):
                pattern = [0, 2, 1, 3, 2, 1, 3, 0]
                for j, idx in enumerate(pattern):
                    at = t + j * (dur / len(pattern))
                    if at < end:
                        place(pluck, tone(midi(chord[idx % len(chord)] + 12), 1.2, decay=0.35, harmonics=((1, 1.0), (2, 0.3), (4, 0.08))) * 0.035, at)
            t += bar
            k += 1
    out = lowpass(pad, 2200) + lowpass(pluck, 4200)
    return out


def main():
    timeline_path, voice_dir, out_dir = sys.argv[1:4]
    tl = json.load(open(timeline_path))
    duration = tl['duration']
    n = int(round(duration * SR))
    voice = np.zeros(n, dtype=np.float32)
    for line in tl['lines']:
        clip = read_wav(f"{voice_dir}/{line['id']}.wav")
        peak = np.max(np.abs(clip)) or 1
        place(voice, clip / peak * 0.85, line['start'])

    sfx = np.zeros(n, dtype=np.float32)
    for act in tl['acts']:
        at = act['at']
        if act['k'] == 'click':
            tick = tone(1800, 0.05, decay=0.012, harmonics=((1, 1.0), (2.7, 0.4))) * 0.11
            place(sfx, tick, at)
        elif act['k'] == 'milestone':
            for i, note in enumerate([76, 79, 84]):  # soft bell arpeggio for a learning milestone
                place(sfx, tone(midi(note), 1.4, decay=0.45, harmonics=((1, 1.0), (2.01, 0.25), (3.98, 0.08))) * 0.08, at + i * 0.09)
        elif act['k'] == 'overlay' and act.get('kind') == 'rewind':
            m = int(1.6 * SR)
            noise = np.random.default_rng(7).standard_normal(m).astype(np.float32)
            sweep = lowpass(noise, 1400) * np.linspace(0, 1, m) ** 2 * np.linspace(1, 0, m) ** 0.5
            place(sfx, sweep * 0.5, at)
            place(sfx, tone(midi(64), 1.2, decay=0.6) * 0.05, at + 1.4)
            place(sfx, tone(midi(60), 1.4, decay=0.7) * 0.05, at + 1.55)
        elif act['k'] == 'scene' and act['scene'] in ('graduation', 'security', 'ending'):
            place(sfx, tone(midi(72), 2.0, decay=0.9, harmonics=((1, 1.0), (2, 0.2))) * 0.035, at)

    ch = {c['id']: c for c in tl['chapters']}
    sections = [
        (0, ch['intro']['end'], 'calm'),
        (ch['transfer']['start'], ch['cards']['end'], 'calm'),
        (ch['graduation']['start'], ch['payday']['end'], 'calm'),
        (ch['security']['start'], ch['security']['end'], 'dark'),
        (ch['ending']['start'], duration, 'end'),
    ]
    bgm = music(duration, sections)
    # Duck the music under speech with a smoothed envelope.
    speaking = np.zeros(n, dtype=np.float32)
    for line in tl['lines']:
        speaking[int(line['start'] * SR):int(line['end'] * SR)] = 1
    duck = 1 - 0.6 * lowpass(speaking, 3.0)
    fade = np.ones(n, dtype=np.float32)
    fade[:int(1.5 * SR)] = np.linspace(0, 1, int(1.5 * SR))
    fade[-int(3.5 * SR):] = np.linspace(1, 0, int(3.5 * SR))
    bgm = bgm * duck * fade * 0.33  # about 20 dB under speech, 10 dB under it in pauses

    def stereo(x, width=0.0):
        return np.stack([x, x], axis=1)

    write_wav(f'{out_dir}/voice.wav', stereo(voice))
    write_wav(f'{out_dir}/sfx.wav', stereo(sfx))
    write_wav(f'{out_dir}/music.wav', stereo(bgm))
    mix = voice + sfx + bgm
    mix /= max(1.0, np.max(np.abs(mix)) / 0.97)
    write_wav(f'{out_dir}/mix.wav', stereo(mix))
    rms = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
    print(f'duration={duration:.2f}s voice_rms={rms(voice):.1f}dB music_rms={rms(bgm):.1f}dB sfx_peak={np.max(np.abs(sfx)):.2f}')


if __name__ == '__main__':
    main()
