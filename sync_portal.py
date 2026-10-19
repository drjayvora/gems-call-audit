# Push the audited calls to the portal (Supabase), where each person signs in and sees only what their role allows.
#   sync_portal.py [--rubric v1] [--no-audio]
# Needs ~/.gems_portal.json: {"url": "https://<project>.supabase.co", "anon_key": "...", "service_key": "<service_role key>"} (chmod 600, never in git).
# Writes: callers (staff: name and email only, so the admin's school and Exotel mapping is kept), calls, counsellor personas,
# the rubric, and any recordings not uploaded yet (private bucket "recordings", <call id>.mp3).
import argparse, json, os, urllib.error, urllib.parse, urllib.request
from common import P
from build_report import build_data

ap = argparse.ArgumentParser(); ap.add_argument("--rubric", default="v1"); ap.add_argument("--no-audio", action="store_true"); a = ap.parse_args()
CFG = json.load(open(os.path.expanduser("~/.gems_portal.json")))
URL, KEY = CFG["url"].rstrip("/"), CFG["service_key"]
HDR = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def req(method, path, body=None, headers={}, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(URL + path, data=data, method=method, headers={**HDR, "Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp: out = resp.read()
    except urllib.error.HTTPError as e: raise SystemExit(f"{method} {path}: {e.code} {e.read().decode()[:300]}")
    return json.loads(out) if out else None

def upsert(table, rows, cols=None):
    q = f"?on_conflict=id" + (f"&columns={','.join(cols)}" if cols else "")
    for i in range(0, len(rows), 200):
        req("POST", f"/rest/v1/{table}{q}", rows[i:i + 200], {"Prefer": "resolution=merge-duplicates,return=minimal"})

D = build_data(a.rubric, everyone=True)
reps = D["counsellors"]
upsert("staff", [{"id": r["id"], "name": r["name"], "email": r["email"]} for r in reps.values()], ["id", "name", "email"])
for c in D["calls"]: c["rep_name"] = reps[c["rep"]]["name"]
upsert("calls", [{"id": c["id"], "rep": c["rep"], "at": c["when"], "rubric": D["rubric"], "data": c} for c in D["calls"]])
upsert("counsellors", [{"id": r["id"], "data": r} for r in reps.values()])
meta = {k: D[k] for k in ("rubric", "bands", "criteria", "flags", "outcomes", "listening")}
req("POST", "/rest/v1/meta?on_conflict=rubric", [{"rubric": D["rubric"], "data": meta, "generated": D["generated"]}], {"Prefer": "resolution=merge-duplicates,return=minimal"})

up = 0
if not a.no_audio:
    have, off = set(), 0
    while True:   # list what's already in the bucket
        page = req("POST", "/storage/v1/object/list/recordings", {"prefix": "", "limit": 1000, "offset": off})
        have |= {o["name"] for o in page}; off += 1000
        if len(page) < 1000: break
    for c in D["calls"]:
        f, name = P("recordings", c["id"] + ".mp3"), c["id"] + ".mp3"
        if c.get("audio") and name not in have and os.path.exists(f):
            req("POST", f"/storage/v1/object/recordings/{urllib.parse.quote(name)}", raw=open(f, "rb").read(), headers={"Content-Type": "audio/mpeg", "x-upsert": "true"}); up += 1
print(f"portal: {len(D['calls'])} calls, {len(reps)} callers, {up} recordings uploaded ({D['rubric']})")
