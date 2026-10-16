# Shared helpers: paths, rubric loading, transcript formatting, weighted scoring.
import json, os, yaml
D = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(D, *a)

def load_rubric(version="v1"):
    return yaml.safe_load(open(P("rubric", f"{version}.yaml"))), open(P("rubric", f"{version}.yaml")).read()

def load_facts():
    return yaml.safe_load(open(P("rubric", "facts.yaml"))), open(P("rubric", "facts.yaml")).read()

def calls_by_id():
    return {c["name"]: c for c in json.load(open(P("calls.json")))}

def resolve(ids):
    """Accept full call names or unique prefixes."""
    calls = calls_by_id(); out = []
    for i in ids:
        m = [k for k in calls if k.startswith(i)]
        if len(m) != 1: raise SystemExit(f"call id {i!r} matched {len(m)} calls")
        out.append(m[0])
    return out

def transcript_text(cid):
    t = json.load(open(P("transcripts", cid + ".json")))
    lines = [f"[{int(s['start'])//60}:{int(s['start'])%60:02d}] {s['speaker'] + ': ' if s.get('speaker') else ''}{s['text']}" for s in t["segments"]]
    return t, "\n".join(lines)

def weighted_score(ratings, rubric):
    w = {c["id"]: c["weight"] for c in rubric["criteria"]}
    got = sum(w[k] * v for k, v in ratings.items() if v is not None and k in w)
    pos = sum(w[k] * 2 for k, v in ratings.items() if v is not None and k in w)
    return round(100 * got / pos) if pos else None
