# Build audit_report.html: dashboard + per-call cards with audio, transcript, model scores and a review form.
#   build_report.py [--rubric v1]
# Shows model scores from scores/<version>/ where they exist, otherwise the draft gold scores from gold/.
# Reviewers' corrections are kept in their browser and exported as JSON -> ingest_reviews.py.
import argparse, datetime, json, os
from common import P, load_rubric, calls_by_id, weighted_score

def build_data(version="v1"):
  rubric, _ = load_rubric(version); calls = calls_by_id(); SD = P("scores", rubric["version"])
  ld = lambda d, f: json.load(open(os.path.join(d, f)))
  model = {f[:-5]: ld(SD, f) for f in os.listdir(SD) if f.endswith(".json") and not f.startswith("_")} if os.path.isdir(SD) else {}
  gold = {f[:-5]: ld(P("gold"), f) for f in os.listdir(P("gold")) if f.endswith(".json")} if os.path.isdir(P("gold")) else {}
  rows = []
  for cid in sorted(set(model) | set(gold)):
      c = calls[cid]; m, g = model.get(cid), gold.get(cid)
      t = ld(P("transcripts"), cid + ".json") if os.path.exists(P("transcripts", cid + ".json")) else {"segments": []}
      if m:
          src = {"source": "model", "score": m["score"], "outcome": m["outcome"], "summary": m["summary"], "coaching": m["coaching"],
                 "ratings": {k: {"r": m["ratings_num"][k], "note": v["note"], "ev": v["evidence"]} for k, v in m["ratings"].items()},
                 "flags": m["red_flags"], "lead": m.get("lead_details"), "intent": m.get("intent"), "crm_suggest": m.get("crm_outcome_suggested"),
                 "tq": m.get("transcript_quality"), "model": m.get("model")}
      else:
          src = {"source": "draft", "score": weighted_score(g["ratings"], rubric), "outcome": g["outcome"], "summary": g.get("comment", ""), "coaching": "",
                 "ratings": {k: {"r": v, "note": g.get("notes", {}).get(k, ""), "ev": []} for k, v in g["ratings"].items()},
                 "flags": [{"type": f, "detail": "", "t": ""} for f in g["flags"]]}
      rows.append({"id": cid, "rep": ((c["caller"] if c["type"] == "Outgoing" else c["receiver"]) or c["caller"] or c["receiver"] or "").split("@")[0].replace(".", " ").title(),
                   "when": c["start_time"], "type": c["type"], "dur": int(c["duration"] or 0), "crm_outcome": c["call_outcome"], "crm_intent": c["intent"],
                   "lead_id": c["reference_docname"], "segs": [[s["start"], s.get("speaker", ""), s["text"]] for s in t["segments"]],
                   "gold": g if g and g.get("reviewed") else None, **src})
  DATA = {"generated": datetime.datetime.now().strftime("%d %b %Y %I:%M %p"), "rubric": rubric["version"], "bands": rubric["bands"],
          "criteria": [{"id": c["id"], "name": c["name"], "w": c["weight"]} for c in rubric["criteria"]],
          "flags": {f["id"]: f["name"] for f in rubric["red_flags"]}, "outcomes": rubric["outcomes"], "calls": rows}
  return DATA

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--rubric", default="v1"); a = ap.parse_args()
    DATA = build_data(a.rubric); rows = DATA["calls"]
    html = open(P("report_template.html")).read().replace("/*__DATA__*/null", json.dumps(DATA, ensure_ascii=False).replace("</", "<\\/"))
    open(P("audit_report.html"), "w").write(html)
    print(f"audit_report.html · {len(rows)} calls · {sum(r['source'] == 'model' for r in rows)} model-scored · {sum(1 for r in rows if r['gold'])} human-reviewed")
