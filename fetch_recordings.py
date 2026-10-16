# Download Exotel recordings for every call log that has one -> recordings/<call name>.mp3 (skips existing).
import base64, json, os, sys, urllib.request, concurrent.futures as F
D = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(D, "recordings"); os.makedirs(OUT, exist_ok=True)
AUTH = "Basic " + base64.b64encode(open(os.path.expanduser("~/.gems_exotel_token")).read().strip().encode()).decode()
calls = [c for c in json.load(open(os.path.join(D, "calls.json"))) if c["recording_url"]]
if len(sys.argv) > 1: calls = calls[:int(sys.argv[1])]
def fetch(c):
    p = os.path.join(OUT, c["name"] + ".mp3")
    if os.path.exists(p) and os.path.getsize(p) > 0: return c["name"], "exists", os.path.getsize(p)
    try:
        b = urllib.request.urlopen(urllib.request.Request(c["recording_url"], headers={"Authorization": AUTH}), timeout=120).read()
    except Exception as e: return c["name"], f"error {e}", 0
    open(p + ".part", "wb").write(b); os.replace(p + ".part", p)
    return c["name"], "ok", len(b)
res = list(F.ThreadPoolExecutor(8).map(fetch, calls))
bad = [r for r in res if r[1] not in ("ok", "exists")]
print(f"{len(res) - len(bad)}/{len(res)} recordings on disk, {sum(r[2] for r in res) / 1e6:.1f} MB")
for r in bad[:20]: print(" ", r[0], r[1])
