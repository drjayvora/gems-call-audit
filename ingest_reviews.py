# Merge reviewer corrections exported from audit_report.html into gold/ (the human-reviewed answer key).
#   ingest_reviews.py ~/Downloads/call-reviews-*.json
# The previous gold file for a call is kept in gold/_history/ so nothing is lost.
import datetime, json, os, shutil, sys
from common import P
os.makedirs(P("gold", "_history"), exist_ok=True); n = 0
for path in sys.argv[1:]:
    for r in json.load(open(path))["reviews"]:
        g = P("gold", r["call"] + ".json")
        if os.path.exists(g): shutil.copy(g, P("gold", "_history", f"{r['call']}.{datetime.datetime.now():%Y%m%d%H%M%S}.json"))
        old = json.load(open(g)) if os.path.exists(g) else {}
        json.dump({"call": r["call"], "reviewed": True, "reviewer": r["reviewer"], "reviewed_at": r["at"], "rubric": r["rubric"],
                   "ratings": r["ratings"], "outcome": r["outcome"], "flags": r["flags"], "comment": r["comment"],
                   "notes": old.get("notes", {})}, open(g, "w"), ensure_ascii=False, indent=1); n += 1
print(f"{n} reviews written to gold/. Next: calibrate.py to see model-vs-reviewer agreement.")
