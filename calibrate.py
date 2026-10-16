# How well does the model's scoring agree with human-reviewed (gold) scores?
#   calibrate.py [--rubric v1] [--include-drafts]
# Run after every rubric / prompt change; results are appended to calibration/history.jsonl so you can see the trend.
import argparse, datetime, json, os
from common import P, load_rubric, weighted_score

ap = argparse.ArgumentParser(); ap.add_argument("--rubric", default="v1"); ap.add_argument("--include-drafts", action="store_true")
a = ap.parse_args()
rubric, _ = load_rubric(a.rubric); CRIT = [c["id"] for c in rubric["criteria"]]
SD = P("scores", rubric["version"])
gold = [json.load(open(P("gold", f))) for f in sorted(os.listdir(P("gold"))) if f.endswith(".json")]
gold = [g for g in gold if g["reviewed"] or a.include_drafts]
pairs = [(g, json.load(open(os.path.join(SD, g["call"] + ".json")))) for g in gold if os.path.exists(os.path.join(SD, g["call"] + ".json"))]
if not pairs: raise SystemExit(f"no overlap between gold ({len(gold)} calls{'' if a.include_drafts else ', reviewed only'}) and scores/{rubric['version']}/")

rows, crit = [], {c: {"n": 0, "exact": 0, "within1": 0, "model_minus_gold": 0} for c in CRIT}
out_ok = flag_tp = flag_fp = flag_fn = 0
for g, m in pairs:
    for c in CRIT:
        gv, mv = g["ratings"].get(c), m["ratings_num"].get(c); k = crit[c]; k["n"] += 1
        if gv is None or mv is None: k["exact"] += gv == mv; k["within1"] += gv == mv; continue
        k["exact"] += gv == mv; k["within1"] += abs(gv - mv) <= 1; k["model_minus_gold"] += mv - gv
    gs, ms = weighted_score(g["ratings"], rubric), m["score"]
    out_ok += g["outcome"] == m["outcome"]
    gf, mf = set(g["flags"]), {f["type"] for f in m["red_flags"]}
    flag_tp += len(gf & mf); flag_fp += len(mf - gf); flag_fn += len(gf - mf)
    rows.append((abs((gs or 0) - (ms or 0)), g["call"], gs, ms, g["outcome"], m["outcome"], sorted(gf), sorted(mf)))

n = len(pairs); mae = sum(r[0] for r in rows) / n
print(f"Rubric {rubric['version']} · {n} calls compared ({'incl. drafts' if a.include_drafts else 'human-reviewed only'})\n")
print(f"{'Criterion':<16}{'exact':>7}{'±1':>7}{'bias':>7}   (bias > 0 = model scores higher than reviewers)")
for c in CRIT:
    k = crit[c]; print(f"{c:<16}{k['exact']/k['n']:>7.0%}{k['within1']/k['n']:>7.0%}{k['model_minus_gold']/k['n']:>+7.2f}")
prec = flag_tp / (flag_tp + flag_fp) if flag_tp + flag_fp else None; rec = flag_tp / (flag_tp + flag_fn) if flag_tp + flag_fn else None
print(f"\nOverall score: mean abs diff {mae:.1f} points · Outcome agreement {out_ok/n:.0%} · Red flags: precision {prec if prec is None else f'{prec:.0%}'}, recall {rec if rec is None else f'{rec:.0%}'}")
print("\nBiggest disagreements:")
for r in sorted(rows, reverse=True)[:5]:
    print(f"  {r[1][:10]} gold {r[2]} vs model {r[3]} · outcome {r[4]!r} vs {r[5]!r} · flags {r[6]} vs {r[7]}")

os.makedirs(P("calibration"), exist_ok=True)
prompts = sorted({str(m.get("prompt_sha")) for _, m in pairs}); models = sorted({m.get("model") for _, m in pairs})
with open(P("calibration", "history.jsonl"), "a") as f:
    f.write(json.dumps({"at": datetime.datetime.now().isoformat(timespec="seconds"), "rubric": rubric["version"], "prompt_sha": prompts, "model": models,
                        "n": n, "drafts_included": a.include_drafts, "score_mae": round(mae, 1), "outcome_agreement": round(out_ok / n, 2),
                        "flag_precision": prec, "flag_recall": rec,
                        "criteria": {c: {"exact": round(crit[c]["exact"] / crit[c]["n"], 2), "bias": round(crit[c]["model_minus_gold"] / crit[c]["n"], 2)} for c in CRIT}}) + "\n")
