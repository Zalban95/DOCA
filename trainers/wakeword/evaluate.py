"""Score a wake-word model on clips it was not trained on, and print one `@result {...}` line.

  --pos DIR          clips of the word (synthetic, held out)        → how many it hears
  --pos-person DIR   the person's own clips of the word              → how many it hears (the one that matters)
  --neg DIR          near words, synthetic, held out                 → how many wake it wrongly
  --neg-person DIR   the person's own other words ("docker")         → how many wake it wrongly
A clip counts as heard when the model's score passes the threshold at any moment of it (0.5, openWakeWord's default).
The person's clips were partly in training (repeated); those held out are the honest number — train.py holds a fifth out.
"""
import argparse, glob, json, os

import numpy as np
import soundfile as sf
from openwakeword.model import Model


def scores(model, name, files):
    out = []
    for f in files:
        x, rate = sf.read(f, dtype='int16')
        if x.ndim > 1: x = x[:, 0]
        pad = np.zeros(16000, np.int16)
        model.reset()
        best = 0.0
        for p in model.predict_clip(np.concatenate([pad, x, pad]), padding=1):
            best = max(best, float(p.get(name, 0)))
        out.append(best)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--threshold', type=float, default=0.5)
    for k in ('pos', 'pos-person', 'neg', 'neg-person'): ap.add_argument(f'--{k}', action='append', default=[])
    a = ap.parse_args()
    model = Model(wakeword_models=[a.model], inference_framework='onnx')
    name = os.path.splitext(os.path.basename(a.model))[0]
    res = {'threshold': a.threshold}
    for key, dirs in (('heard', a.pos), ('heardPerson', a.pos_person), ('falseNear', a.neg), ('falsePerson', a.neg_person)):
        files = sorted(f for d in dirs for f in glob.glob(os.path.join(d, '*.wav')))
        if not files: continue
        s = scores(model, name, files)
        hit = sum(v >= a.threshold for v in s)
        res[key] = {'of': len(files), 'n': hit, 'share': round(hit / len(files), 3)}
        if key == 'heardPerson': res['personScores'] = [round(v, 3) for v in s]
    print('@result ' + json.dumps(res), flush=True)


if __name__ == '__main__':
    main()
