# Transcribe recordings locally with MLX Whisper -> transcripts/<call name>.json
#   transcribe.py [ids.json] [--force]
# Mono recordings: one mixed track, no speaker labels (the scorer infers speakers).
# Dual-channel recordings: each channel transcribed separately and labelled Counsellor / Parent, then merged by time.
import functools, json, os, re, sys, time, av, numpy as np, mlx_whisper
from common import P, load_facts, calls_by_id, resolve
MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
# Which channel holds whom. Exotel puts the first leg on channel 0: the counsellor on outgoing (click-to-call rings the
# agent first), the parent on incoming. VERIFY with one real dual-channel call and flip here if it's the other way round.
CHANNELS = {"Outgoing": ["Counsellor", "Parent"], "Incoming": ["Parent", "Counsellor"]}
facts, _ = load_facts()
# Keep the prompt short and free of place names: a glossary-style prompt made Whisper insert campuses nobody said.
PROMPT = "GEMS school admissions call between a counsellor and a parent about admission, grade, fees, transport and a campus visit."
FIX = [(re.compile(rf"\b{k}\b", re.I), v) for k, v in facts.get("corrections", {}).items()]   # brand/curriculum misspellings only
fix = lambda t: functools.reduce(lambda x, kv: kv[0].sub(kv[1], x), FIX, t)

def load(path):
    """Return a list of 16 kHz float32 arrays, one per real channel (duplicated stereo collapses to mono)."""
    c = av.open(path); n = c.streams.audio[0].channels
    r = av.AudioResampler(format="fltp", layout="stereo" if n == 2 else "mono", rate=16000)
    a = np.concatenate([f.to_ndarray() for fr in c.decode(audio=0) for f in r.resample(fr)], axis=1).astype(np.float32)
    if n == 2 and not np.allclose(a[0], a[1], atol=1e-3): return [a[0], a[1]]
    return [a.mean(axis=0)]

def run(audio, dual):
    kw = dict(word_timestamps=True, hallucination_silence_threshold=2.0) if dual else {}   # each channel is mostly silence in dual mode
    r = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL, initial_prompt=PROMPT, condition_on_previous_text=False, temperature=(0.0, 0.2, 0.4), **kw)
    segs = [{"start": round(s["start"], 1), "end": round(s["end"], 1), "text": fix(s["text"].strip())} for s in r["segments"] if s["text"].strip()]
    if dual:   # Whisper invents "Thank you." on silence: drop segments where this channel is near-silent
        fr = np.sqrt(np.mean(audio[: len(audio) // 320 * 320].reshape(-1, 320) ** 2, axis=1))   # 20 ms frame RMS
        floor = 0.08 * np.percentile(fr, 95)
        loud = lambda s: np.percentile(fr[int(s["start"] * 50): max(int(s["end"] * 50), int(s["start"] * 50) + 1)], 90) > floor
        segs = [s for s in segs if loud(s)]
    return r, segs

def merge_runs(segs, gap=1.0):
    """Join consecutive segments from the same speaker separated by short pauses (Whisper over-splits)."""
    out = []
    for s in segs:
        if out and out[-1].get("speaker") == s.get("speaker") and s["start"] - out[-1]["end"] < gap and len(out[-1]["text"]) < 400:
            out[-1]["text"] += " " + s["text"]; out[-1]["end"] = s["end"]
        else: out.append(dict(s))
    return out

if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if not x.startswith("--")]; force = "--force" in sys.argv
    os.makedirs(P("transcripts"), exist_ok=True); calls = calls_by_id()
    ids = resolve(json.load(open(args[0]))) if args else sorted(f[:-4] for f in os.listdir(P("recordings")) if os.path.getsize(P("recordings", f)) > 2000)
    for i, cid in enumerate(ids, 1):
        out = P("transcripts", cid + ".json")
        if os.path.exists(out) and not force: continue
        t = time.time(); chans = load(P("recordings", cid + ".mp3"))
        if len(chans) == 2:
            names = CHANNELS.get(calls[cid]["type"], ["Speaker A", "Speaker B"]); segs = []; lang = None
            for name, audio in zip(names, chans):
                r, ss = run(audio, True); lang = lang or r.get("language"); segs += [{**s, "speaker": name} for s in ss]
            segs = merge_runs(sorted(segs, key=lambda s: s["start"]))
        else:
            r, segs = run(chans[0], False); lang = r.get("language")
        json.dump({"call": cid, "model": MODEL, "channels": len(chans), "language": lang, "audio_sec": round(len(chans[0]) / 16000),
                   "segments": segs}, open(out, "w"), ensure_ascii=False, indent=1)
        print(f"[{i}/{len(ids)}] {cid[:10]} {len(chans)}ch {len(chans[0])/16000:.0f}s audio in {time.time()-t:.0f}s lang={lang}", flush=True)
