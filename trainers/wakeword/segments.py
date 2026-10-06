"""Split a person's recordings into utterances, one wav each (16 kHz mono), by the pauses between them.

A voice message that says "doca, doca, what time is it, docker" becomes four clips; the hub then labels each one by
transcribing it (modules/wakeword/samples.js): the word is a positive, anything else a near miss. Usage:
    python segments.py OUT_DIR file1.webm file2.wav …
"""
import os, subprocess, sys
import numpy as np
import soundfile as sf

RATE, FRAME = 16000, 320            # 20 ms frames
MIN_SPEECH, MAX_SPEECH, GAP = 0.18, 3.0, 0.25   # seconds


def load(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ar', str(RATE), '-ac', '1', '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def split(x):
    """Frames over an energy floor learnt from the recording itself; joined across gaps shorter than GAP."""
    n = len(x) // FRAME
    e = np.sqrt((x[:n * FRAME].reshape(n, FRAME) ** 2).mean(1) + 1e-12)
    floor = np.percentile(e, 20)
    on = e > max(floor * 4, np.percentile(e, 60) * 0.5, 0.004)
    out, start, quiet = [], None, 0
    for i, v in enumerate(on):
        if v:
            if start is None: start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet * FRAME / RATE >= GAP:
                out.append((start, i - quiet + 1)); start, quiet = None, 0
    if start is not None: out.append((start, n))
    pad = int(0.12 * RATE)
    return [(max(0, a * FRAME - pad), min(len(x), b * FRAME + pad)) for a, b in out
            if MIN_SPEECH <= (b - a) * FRAME / RATE <= MAX_SPEECH]


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for path in sys.argv[2:]:
        x = load(path)
        base = os.path.splitext(os.path.basename(path))[0]
        for k, (a, b) in enumerate(split(x)):
            sf.write(os.path.join(out, f'{base}_{k:03d}.wav'), x[a:b], RATE)
            print(f'{base}_{k:03d}.wav {a / RATE:.2f} {b / RATE:.2f}')
