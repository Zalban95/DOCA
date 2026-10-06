"""Train a wake-word model for one word (TODO H8.4; docs/experiments/wake-model.md).

openWakeWord's method — a small classifier over a frozen speech embedding — with the data made here, so any word a
person or an edition chooses gets its own model:

  positives   the word spoken by synthetic voices: Piper's LibriTTS-R generator (hundreds of speakers, three speeds),
              any extra clips given (the hub's own Kokoro voices, the person's recordings, repeated to count)
  negatives   near words made from the word itself (one sound changed, a sound added or dropped) and any given ("docker",
              "coca-cola"), spoken by the same voices; plus openWakeWord's precomputed features of 2,000 hours of other
              audio, and its validation set for false starts per hour
  augmented   with room echoes and everyday noise, then trained and exported as ONNX by openWakeWord's own trainer

Usage (modules/wakeword runs it as a job, one at a time):
    python train.py --word doca --out OUT --data DATA [--positives DIR …] [--negatives DIR …] [--near "docker,coca cola"]
                    [--samples 8000] [--steps 30000]
DATA holds piper-sample-generator/, data/*.npy, rir/ and noise/ (fetched once by modules/wakeword/setup).
Prints progress lines `@stage name` and, at the end, one JSON line `@result {...}` with the model path and its scores.
"""
import argparse, json, os, random, shutil, subprocess, sys, uuid

import yaml


def near_words(word):
    """Words one sound away, which must not wake: other first consonants, other vowels, a sound added or dropped.
    Spelling variants that sound the same (c/k, ck) are left out — they are the word."""
    w = word.lower()
    alike = lambda s: s.replace('ck', 'k').replace('c', 'k').replace('q', 'k')
    vowels, cons = 'aeiou', ['b', 'd', 'g', 'k', 'p', 't', 'm', 'n', 'l', 'r', 's', 'f', 'v']
    out = set()
    for i, ch in enumerate(w):
        pool = vowels if ch in vowels else cons
        for r in pool:
            if r != ch: out.add(w[:i] + r + w[i + 1:])
    out |= {w[:-1], w + 'r', w + 's', w + 'ter', w[:-1] + 'ker', 'the ' + w[1:], w[0] + 'o' + w[1:]}
    return sorted(x for x in out if x and alike(x) != alike(w) and len(x) > 2)


def generate(gen_path, model, texts, n, out_dir, batch):
    sys.path.insert(0, gen_path)
    from generate_samples import generate_samples  # piper-sample-generator v2 (the layout openWakeWord expects)
    os.makedirs(out_dir, exist_ok=True)
    have = len(os.listdir(out_dir))
    if have >= n: return
    generate_samples(text=texts, max_samples=n - have, batch_size=batch, noise_scales=[0.98], noise_scale_ws=[0.98],
                     length_scales=[0.75, 1.0, 1.25], output_dir=out_dir, auto_reduce_batch_size=True, model=model,
                     file_names=[uuid.uuid4().hex + '.wav' for _ in range(n - have)])


def tts_clips(url, texts, out_dir, speeds=(0.8, 0.9, 1.0, 1.15, 1.3)):
    """The word in every voice of an OpenAI-compatible speech service (the hub's Kokoro): accents Piper's English
    voices lack — an Italian "doca" is said differently. 16 kHz mono wav."""
    import io, itertools, urllib.request
    import numpy as np, soundfile as sf
    from math import gcd
    from scipy.signal import resample_poly
    os.makedirs(out_dir, exist_ok=True)
    if len(os.listdir(out_dir)) > 50: return
    try: voices = json.load(urllib.request.urlopen(f'{url}/v1/audio/voices', timeout=20))
    except Exception as e: print(f'  no voices from {url}: {e}', flush=True); return
    voices = [v for v in (voices.get('voices', voices) if isinstance(voices, dict) else voices) if isinstance(v, str) and '_v0' not in v]
    n = 0
    for v, sp, t in itertools.product(voices, speeds, texts):
        body = json.dumps({'model': 'kokoro', 'input': t, 'voice': v, 'speed': sp, 'response_format': 'wav'}).encode()
        try: raw = urllib.request.urlopen(urllib.request.Request(f'{url}/v1/audio/speech', data=body, headers={'Content-Type': 'application/json'}), timeout=60).read()
        except Exception: continue
        x, rate = sf.read(io.BytesIO(raw), dtype='float32')
        if x.ndim > 1: x = x.mean(1)
        g = gcd(rate, 16000)
        sf.write(os.path.join(out_dir, f'tts_{n}.wav'), resample_poly(x, 16000 // g, rate // g) if rate != 16000 else x, 16000)
        n += 1
    print(f'  {n} clips from the speech service', flush=True)


def add_clips(dirs, train_dir, test_dir, repeat=1, test_share=0.2):
    """Extra clips (16 kHz mono wav): most to training, repeated `repeat` times so a few count; some held out."""
    for d in dirs:
        files = sorted(f for f in os.listdir(d) if f.endswith('.wav'))
        random.Random(7).shuffle(files)
        cut = max(1, int(len(files) * test_share)) if len(files) > 4 else 0
        for k, f in enumerate(files):
            if k < cut: shutil.copy(os.path.join(d, f), os.path.join(test_dir, f'x_{k}_{f}'))
            else:
                for r in range(repeat): shutil.copy(os.path.join(d, f), os.path.join(train_dir, f'x_{r}_{k}_{f}'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--word', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--data', required=True)
    ap.add_argument('--positives', nargs='*', default=[])
    ap.add_argument('--person', nargs='*', default=[], help='the person\'s own clips of the word: repeated, weighed more')
    ap.add_argument('--negatives', nargs='*', default=[])
    ap.add_argument('--near', default='')
    ap.add_argument('--tts', default='', help='an OpenAI-compatible speech service whose voices also say the word')
    ap.add_argument('--samples', type=int, default=8000)
    ap.add_argument('--steps', type=int, default=30000)
    ap.add_argument('--negative-weight', type=int, default=300, help='how hard false wakes are punished; higher hears less')
    ap.add_argument('--false-per-hour', type=float, default=0.5, help='the false wakes per hour the best model may have')
    ap.add_argument('--layer', type=int, default=64)
    ap.add_argument('--keep-features', action='store_true', help='train again on the features already computed')
    a = ap.parse_args()

    name = ''.join(c for c in a.word.lower() if c.isalnum()) or 'word'
    work = os.path.abspath(os.path.join(a.out, name))
    gen = os.path.join(a.data, 'piper-sample-generator')
    voice = os.path.join(gen, 'models', 'en_US-libritts_r-medium.pt')
    dirs = {k: os.path.join(work, name, k) for k in ('positive_train', 'positive_test', 'negative_train', 'negative_test')}
    for d in dirs.values(): os.makedirs(d, exist_ok=True)

    near = sorted(set(near_words(a.word) + [x.strip() for x in a.near.split(',') if x.strip()]))
    variants = [a.word, a.word.capitalize(), f'{a.word}!', f'{a.word}?', f'hey {a.word}']
    print(f'@stage voices: the word ({a.samples}) and {len(near)} near words', flush=True)
    if a.tts:
        tts_dir = os.path.join(work, 'tts')
        tts_clips(a.tts.rstrip('/'), [a.word, f'{a.word.capitalize()}.', f'{a.word.capitalize()}!', f'{a.word.capitalize()}?'], tts_dir)
        a.positives.append(tts_dir)
    add_clips(a.positives, dirs['positive_train'], dirs['positive_test'])
    add_clips(a.person, dirs['positive_train'], dirs['positive_test'], repeat=40)
    add_clips(a.negatives, dirs['negative_train'], dirs['negative_test'], repeat=20)
    generate(gen, voice, variants, a.samples, dirs['positive_train'], 50)
    generate(gen, voice, variants, max(500, a.samples // 10), dirs['positive_test'], 50)
    generate(gen, voice, near, a.samples, dirs['negative_train'], 25)
    generate(gen, voice, near, max(500, a.samples // 10), dirs['negative_test'], 25)

    cfg = {
        'model_name': name, 'target_phrase': [a.word], 'custom_negative_phrases': near,
        'n_samples': a.samples, 'n_samples_val': max(500, a.samples // 10), 'tts_batch_size': 50,
        'augmentation_batch_size': 16, 'augmentation_rounds': 1,
        'piper_sample_generator_path': gen, 'output_dir': work,
        'rir_paths': [os.path.join(a.data, 'rir')],
        'background_paths': [os.path.join(a.data, 'noise')], 'background_paths_duplication_rate': [1],
        'false_positive_validation_data_path': os.path.join(a.data, 'data', 'validation_set_features.npy'),
        'feature_data_files': {'ACAV100M_sample': os.path.join(a.data, 'data', 'openwakeword_features_ACAV100M_2000_hrs_16bit.npy')},
        'batch_n_per_class': {'ACAV100M_sample': 1024, 'adversarial_negative': 50, 'positive': 50},
        'model_type': 'dnn', 'layer_size': a.layer, 'steps': a.steps, 'max_negative_weight': a.negative_weight,
        'target_false_positives_per_hour': a.false_per_hour,
    }
    cfg_path = os.path.join(work, 'config.yml')
    yaml.safe_dump(cfg, open(cfg_path, 'w'))

    import openwakeword
    trainer = os.path.join(os.path.dirname(openwakeword.__file__), 'train.py')
    env = {**os.environ, 'TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD': '1'}
    have = all(os.path.exists(os.path.join(work, name, f'{k}_features_{t}.npy')) for k in ('positive', 'negative') for t in ('train', 'test'))
    if not (a.keep_features and have):
      print('@stage augmenting and computing features', flush=True)
      subprocess.run([sys.executable, trainer, '--training_config', cfg_path, '--augment_clips', '--overwrite'], check=True, env=env)   # a run cut short leaves half its features: always rebuilt
    print('@stage training', flush=True)
    # Its last step converts the model to TFLite as well, with onnx_tf, which DOCA does not use: a failure after the
    # ONNX model is written is not a failed training.
    done = subprocess.run([sys.executable, trainer, '--training_config', cfg_path, '--train_model'], env=env)
    model = os.path.join(work, f'{name}.onnx')
    if done.returncode != 0 and not os.path.exists(model): raise SystemExit(f'training failed (exit {done.returncode})')
    if not os.path.exists(model): raise SystemExit(f'the trainer finished without {model}')
    print('@result ' + json.dumps({'word': a.word, 'model': model, 'near': near}), flush=True)


if __name__ == '__main__':
    main()
