# In-session scoring: Claude (in Claude Code) reads the transcripts and writes the scores. No API key or API spend.
#   score.py next [--n 10] [--min-sec 30] [--ids file.json] [--force]   write the next unscored calls to work/next.md for Claude to read
#   score.py save work/results.json                                        validate Claude's scores and save to scores/<version>/<call>.json
# results.json is a list of objects with: call, summary, outcome, crm_outcome_suggested, intent,
#   ratings {criterion: {rating: "2"|"1"|"0"|"NA", evidence: [{t, quote}], note}}, red_flags [{type, detail, t}],
#   coaching, lead_details {parent_name, child_name, child_age_or_dob, current_school_grade, grade_sought, campus, needs, siblings},
#   transcript_quality ("good"|"fair"|"poor"), transcript_issues,
#   speakers: one letter per transcript line, C counsellor / P parent / M both / N unclear (skip for dual-channel calls)
import argparse, datetime, json, os
from common import P, load_rubric, calls_by_id, resolve, transcript_text, weighted_score

ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["next", "save"]); ap.add_argument("file", nargs="?")
ap.add_argument("--rubric", default="v1"); ap.add_argument("--n", type=int, default=10); ap.add_argument("--min-sec", type=int, default=30)
ap.add_argument("--ids"); ap.add_argument("--force", action="store_true"); ap.add_argument("--scorer", default="Claude (Claude Code session)")
a = ap.parse_args()
rubric, _ = load_rubric(a.rubric); OUT = P("scores", rubric["version"]); os.makedirs(OUT, exist_ok=True)
CRIT = [c["id"] for c in rubric["criteria"]]; FLAGS = {f["id"] for f in rubric["red_flags"]}; calls = calls_by_id()
LEAD = ["parent_name", "child_name", "child_age_or_dob", "current_school_grade", "grade_sought", "campus", "needs", "siblings"]

if a.cmd == "next":
    if a.ids: ids = resolve(json.load(open(a.ids)))
    else:
        ids = [f[:-5] for f in os.listdir(P("transcripts")) if (calls[f[:-5]]["duration"] or 0) >= a.min_sec]
        ids.sort(key=lambda i: calls[i]["start_time"] or "")
    ids = [i for i in ids if a.force or not os.path.exists(os.path.join(OUT, i + ".json"))][: a.n]
    os.makedirs(P("work"), exist_ok=True); parts = [f"# Calls to score – rubric {rubric['version']} ({len(ids)} calls)\n\nRubric: rubric/{rubric['version']}.yaml · Facts: rubric/facts.yaml · Save with: score.py save work/results.json\n"]
    for cid in ids:
        c = calls[cid]; t, _ = transcript_text(cid)
        txt = "\n".join(f"{i:>3} [{int(g['start'])//60}:{int(g['start'])%60:02d}] {g['speaker'] + ': ' if g.get('speaker') else ''}{g['text']}" for i, g in enumerate(t["segments"]))
        who = (c["caller"] if c["type"] == "Outgoing" else c["receiver"]) or c["caller"] or c["receiver"]
        parts.append(f"\n## {cid}\ncounsellor: {who} · {c['type']} · {c['start_time']} · {int(c['duration'] or 0)}s · CRM outcome: {c['call_outcome'] or '—'} · "
                     f"intent: {c['intent'] or '—'} · speaker labels: {'yes' if any(s.get('speaker') for s in t['segments']) else 'no (mono)'}\n\n{txt}\n")
    open(P("work", "next.md"), "w").write("".join(parts))
    left = sum(1 for f in os.listdir(P("transcripts")) if (calls[f[:-5]]["duration"] or 0) >= a.min_sec and not os.path.exists(os.path.join(OUT, f)))
    print(f"work/next.md: {len(ids)} calls · {left} transcribed calls ≥{a.min_sec}s still unscored")

else:
    items = json.load(open(a.file)); errs = []
    def check(r):
        e = []; cid = r.get("call")
        if cid not in calls: return [f"unknown call {cid!r}"]
        if r.get("outcome") not in rubric["outcomes"]: e.append(f"outcome {r.get('outcome')!r}")
        if r.get("crm_outcome_suggested") not in rubric["crm_outcomes"]: e.append(f"crm_outcome_suggested {r.get('crm_outcome_suggested')!r}")
        if r.get("intent") not in ("Hot", "Warm", "Cold", "Unknown"): e.append(f"intent {r.get('intent')!r}")
        for c in CRIT:
            v = r.get("ratings", {}).get(c)
            if not v or v.get("rating") not in ("2", "1", "0", "NA") or not v.get("note"): e.append(f"rating {c}")
        e += [f"flag type {f.get('type')!r}" for f in r.get("red_flags", []) if f.get("type") not in FLAGS]
        if set(r.get("lead_details", {})) - set(LEAD): e.append("lead_details keys")
        if r.get("transcript_quality") not in ("good", "fair", "poor"): e.append("transcript_quality")
        segs = json.load(open(P("transcripts", cid + ".json")))["segments"]; sp = r.get("speakers", "").replace(" ", "")
        if not all(g.get("speaker") for g in segs):   # mono: the scorer must label who speaks on each line
            if len(sp) != len(segs) or set(sp) - set("CPMN"): e.append(f"speakers: need {len(segs)} letters from CPMN, got {len(sp)}")
        return [f"{cid[:10]}: {x}" for x in e]
    for r in items: errs += check(r)
    if errs: raise SystemExit("Not saved – fix these:\n  " + "\n  ".join(errs))
    for r in items:
        ratings = {k: (None if v["rating"] == "NA" else int(v["rating"])) for k, v in r["ratings"].items()}
        rec = {"rubric": rubric["version"], "model": a.scorer, "scored_at": datetime.datetime.now().isoformat(timespec="seconds"),
               "score": weighted_score(ratings, rubric), "ratings_num": ratings, **r,
               "lead_details": {k: r.get("lead_details", {}).get(k, "") for k in LEAD}, "speakers": r.get("speakers", "").replace(" ", "")}
        json.dump(rec, open(os.path.join(OUT, r["call"] + ".json"), "w"), ensure_ascii=False, indent=1)
        print(f"{r['call'][:10]} {rec['score']:>3} · {r['outcome']} · {len(r['red_flags'])} flags")
