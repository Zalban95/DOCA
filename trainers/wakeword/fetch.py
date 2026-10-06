"""Fetch what training a wake word needs, once per machine, into DATA (modules/wakeword runs it after the environment).

  piper-sample-generator/   Piper's synthetic voices (v2.0.0, the layout openWakeWord's trainer imports) + LibriTTS-R
  data/                      openWakeWord's precomputed features: 2,000 h of other audio (~17 GB) and the false-start
                             validation set
  rir/                       room echoes (MIT impulse responses), 16 kHz
  noise/                     everyday sounds (ESC-50), 16 kHz

Each part is skipped when it is already there, so a broken download resumes from where it stopped. Python and git
only — no shell, no ffmpeg — so it runs the same on Linux, macOS and Windows. Prints `@stage …` lines for the panel.
"""
import io, json, os, subprocess, sys, urllib.request, zipfile

import numpy as np
import soundfile as sf

GEN_REPO = 'https://github.com/rhasspy/piper-sample-generator'
GEN_MODEL = 'https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt'
FEATURES = 'https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/'
ESC50 = 'https://github.com/karoldvl/ESC-50/archive/master.zip'
RIR_LIST = 'https://huggingface.co/api/datasets/davidscripka/MIT_environmental_impulse_responses/tree/main/16khz'
RIR_FILE = 'https://huggingface.co/datasets/davidscripka/MIT_environmental_impulse_responses/resolve/main/'
RATE = 16000


def stage(text): print(f'@stage {text}', flush=True)


def download(url, path):
    """Resumable: a partial file continues with a Range request."""
    have = os.path.getsize(path) if os.path.exists(path) else 0
    req = urllib.request.Request(url, headers={'Range': f'bytes={have}-'} if have else {})
    try: r = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        if e.code == 416: return   # already whole
        raise
    if have and r.status != 206: have = 0   # the server ignored the range: start again
    total = int(r.headers.get('Content-Length') or 0) + have
    with open(path, 'ab' if have else 'wb') as f:
        done, last = have, 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk: break
            f.write(chunk); done += len(chunk)
            if total and done - last > total / 20: print(f'  {done >> 20} of {total >> 20} MB', flush=True); last = done


def resample(x, rate):
    if rate == RATE: return x
    from scipy.signal import resample_poly
    from math import gcd
    g = gcd(rate, RATE)
    return resample_poly(x, RATE // g, rate // g)


def main(data):
    os.makedirs(data, exist_ok=True)
    gen = os.path.join(data, 'piper-sample-generator')
    if not os.path.exists(os.path.join(gen, 'generate_samples.py')):
        stage('Piper voices: the generator')
        subprocess.run(['git', 'clone', '-q', GEN_REPO, gen], check=True)
        subprocess.run(['git', '-C', gen, 'checkout', '-q', 'v2.0.0'], check=True)
    src = os.path.join(gen, 'generate_samples.py')
    code = open(src).read()
    if 'weights_only=False' not in code:   # its model is a pickled module (a trusted release file), which torch ≥ 2.6 refuses by default
        open(src, 'w').write(code.replace('torch.load(model_path)', 'torch.load(model_path, weights_only=False)'))
    model = os.path.join(gen, 'models', 'en_US-libritts_r-medium.pt')
    if not os.path.exists(model) or os.path.getsize(model) < 100 << 20:
        stage('Piper voices: the LibriTTS-R model (200 MB)')
        download(GEN_MODEL, model)

    feats = os.path.join(data, 'data')
    os.makedirs(feats, exist_ok=True)
    for name, size in [('validation_set_features.npy', 150 << 20), ('openwakeword_features_ACAV100M_2000_hrs_16bit.npy', 16 << 30)]:
        path = os.path.join(feats, name)
        if os.path.exists(path) and os.path.getsize(path) >= size: continue
        stage(f'other audio: {name} ({size >> 20} MB)')
        download(FEATURES + name, path)

    rir = os.path.join(data, 'rir')
    if not os.path.isdir(rir) or len(os.listdir(rir)) < 200:
        stage('room echoes (MIT impulse responses)')
        os.makedirs(rir, exist_ok=True)
        # Plain 16 kHz wavs in the dataset's repository: listed by the Hub's API and fetched as files (the datasets
        # library would decode them only with torchcodec).
        listing = json.load(urllib.request.urlopen(RIR_LIST, timeout=60))
        for f in listing:
            if f.get('type') == 'file' and f['path'].endswith('.wav'):
                dest = os.path.join(rir, os.path.basename(f['path']))
                if not os.path.exists(dest): download(RIR_FILE + f['path'], dest)

    noise = os.path.join(data, 'noise')
    if not os.path.isdir(noise) or len(os.listdir(noise)) < 1000:
        stage('everyday sounds (ESC-50, 600 MB)')
        os.makedirs(noise, exist_ok=True)
        tmp = os.path.join(data, 'esc50.zip')
        download(ESC50, tmp)
        with zipfile.ZipFile(tmp) as z:
            for n in z.namelist():
                if not n.endswith('.wav') or '/audio/' not in n: continue
                x, rate = sf.read(io.BytesIO(z.read(n)), dtype='float32')
                if x.ndim > 1: x = x.mean(1)
                sf.write(os.path.join(noise, os.path.basename(n)), resample(x, rate), RATE)
        os.remove(tmp)
    # openWakeWord's two shared feature models (melspectrogram, speech embedding) are not in its package: fetched on
    # first use into the package's resources — training needs them, and the panel serves them to screens.
    import openwakeword.utils as oww
    res = os.path.join(os.path.dirname(oww.__file__), 'resources', 'models')
    if not all(os.path.exists(os.path.join(res, f)) for f in ('melspectrogram.onnx', 'embedding_model.onnx')):
        stage('the shared feature models (3 MB)')
        oww.download_models(model_names=['__feature_models_only__'])
    print('@result {"ready": true}', flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
