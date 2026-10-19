# Assemble everything the website shows into one data object, and build a local, unencrypted copy of the site.
#   build_report.py [--rubric v1]      -> local_site/ (open with: python3 -m http.server 8765 --directory local_site)
# publish.py reuses build_data() for the encrypted GitHub Pages copy in docs/.
import argparse, collections, datetime, json, os, shutil
import yaml
from common import P, load_rubric, calls_by_id, weighted_score
from metrics import labels_for, compute

WEB = P("web")
rep_id = lambda email: (email or "unknown").split("@")[0]
rep_name = lambda email: rep_id(email).replace(".", " ").title()

def build_data(version="v1", everyone=False):   # everyone: skip the config.yaml counsellor list (the portal filters per user)
    rubric, _ = load_rubric(version); calls = calls_by_id(); SD = P("scores", rubric["version"])
    ld = lambda d, f: json.load(open(os.path.join(d, f)))
    model = {f[:-5]: ld(SD, f) for f in os.listdir(SD) if f.endswith(".json") and not f.startswith("_")} if os.path.isdir(SD) else {}
    gold = {f[:-5]: ld(P("gold"), f) for f in os.listdir(P("gold")) if f.endswith(".json")} if os.path.isdir(P("gold")) else {}
    cfg = yaml.safe_load(open(P("config.yaml"))) if os.path.exists(P("config.yaml")) else {}
    allow = set() if everyone else set(cfg.get("counsellors") or []); min_sec = cfg.get("min_audit_sec", 30)
    owner = lambda c: rep_id((c["caller"] if c["type"] == "Outgoing" else c["receiver"]) or c["caller"] or c["receiver"])
    rows, reps = [], {}
    for cid in sorted(set(model) | set(gold)):
        c = calls[cid]; m, g = model.get(cid), gold.get(cid)
        if allow and owner(c) not in allow: continue
        t = ld(P("transcripts"), cid + ".json") if os.path.exists(P("transcripts", cid + ".json")) else {"segments": []}
        if m:
            src = {"source": "model", "score": m["score"], "outcome": m["outcome"], "summary": m["summary"], "coaching": m["coaching"],
                   "ratings": {k: {"r": m["ratings_num"][k], "note": v["note"], "ev": v["evidence"]} for k, v in m["ratings"].items()},
                   "flags": m["red_flags"], "lead": m.get("lead_details"), "intent": m.get("intent"), "crm_suggest": m.get("crm_outcome_suggested"),
                   "tq": m.get("transcript_quality"), "ti": m.get("transcript_issues"), "model": m.get("model")}
        else:
            src = {"source": "draft", "score": weighted_score(g["ratings"], rubric), "outcome": g["outcome"], "summary": g.get("comment", ""), "coaching": "",
                   "ratings": {k: {"r": v, "note": g.get("notes", {}).get(k, ""), "ev": []} for k, v in g["ratings"].items()},
                   "flags": [{"type": f, "detail": "", "t": ""} for f in g["flags"]]}
        labels, lsrc = labels_for(t, m)
        email = (c["caller"] if c["type"] == "Outgoing" else c["receiver"]) or c["caller"] or c["receiver"]
        rid = rep_id(email); reps.setdefault(rid, {"id": rid, "name": rep_name(email), "email": email})
        rows.append({"id": cid, "rep": rid, "when": c["start_time"], "type": c["type"], "dur": int(c["duration"] or 0),
                     "crm_outcome": c["call_outcome"], "crm_intent": c["intent"], "lead_id": c["reference_docname"],
                     "segs": [[s["start"], (labels[i] if labels else ""), s["text"]] for i, s in enumerate(t["segments"])],
                     "metrics": compute(t, labels, lsrc) if labels else None,
                     "audio": cid if os.path.exists(P("recordings", cid + ".mp3")) else None,
                     "gold": g if g and g.get("reviewed") else None, **src})
    # call funnel per counsellor: all logged calls -> recorded (connected) -> long enough to audit -> audited
    fun = collections.defaultdict(lambda: {"logged": 0, "recorded": 0, "auditable": 0})
    for c in calls.values():
        o = owner(c)
        if allow and o not in allow: continue
        f = fun[o]; f["logged"] += 1
        if c["recording_url"] and os.path.exists(P("recordings", c["name"] + ".mp3")) and os.path.getsize(P("recordings", c["name"] + ".mp3")) > 2000:
            f["recorded"] += 1; f["auditable"] += (c["duration"] or 0) >= min_sec
    for rid in (allow or set(reps)):
        email = next((c["caller"] or c["receiver"] for c in calls.values() if owner(c) == rid), rid + "@")
        reps.setdefault(rid, {"id": rid, "name": rep_name(email), "email": email})
    for rid, r in reps.items():   # counsellor personas written during scoring sessions (personas/<id>.json)
        f = P("personas", rid + ".json"); r["persona"] = json.load(open(f)) if os.path.exists(f) else None
        r["funnel"] = {**fun[rid], "audited": sum(1 for x in rows if x["rep"] == rid)}
    return {"generated": datetime.datetime.now().strftime("%d %b %Y, %I:%M %p"), "rubric": rubric["version"], "bands": rubric["bands"],
            "criteria": [{"id": c["id"], "name": c["name"], "w": c["weight"], "look_for": c["look_for"]} for c in rubric["criteria"]],
            "flags": {f["id"]: f["name"] for f in rubric["red_flags"]}, "outcomes": rubric["outcomes"],
            "listening": rubric.get("listening", {}), "counsellors": reps, "calls": rows}

def copy_web(out):
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(WEB): shutil.copy(os.path.join(WEB, f), os.path.join(out, f))

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--rubric", default="v1"); a = ap.parse_args()
    DATA = build_data(a.rubric); out = P("local_site"); copy_web(out)
    json.dump(DATA, open(os.path.join(out, "data.json"), "w"), ensure_ascii=False)
    json.dump({"mode": "plain"}, open(os.path.join(out, "site.json"), "w"))
    if not os.path.islink(os.path.join(out, "audio")): os.symlink("../recordings", os.path.join(out, "audio"))
    print(f"local_site/ · {len(DATA['calls'])} calls · {len(DATA['counsellors'])} counsellors · "
          f"{sum(1 for r in DATA['counsellors'].values() if r['persona'])} personas · serve: python3 -m http.server 8765 --directory local_site")
