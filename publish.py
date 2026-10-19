# Build the encrypted website in docs/ (served by GitHub Pages). Nothing readable leaves this Mac.
# Logins: one password for corporate (every call) and one per school (only calls made by that school's team).
# Each school's calls and recordings are encrypted with AES-256-GCM under that school's own data key; calls by callers
# with no school (the central desk) use a separate key that only corporate holds. A login's data keys are wrapped with
# a key derived from its password (PBKDF2-SHA256, 600k iterations), so a school password opens that school and nothing else.
#   publish.py                         rebuild docs/ with the current scores (same keys, same passwords)
#   publish.py --new-password NAME     new password for one login (corporate, or a school's short name as in config.yaml)
#   publish.py --rotate                new data keys AND new passwords for everyone; use when someone should lose access
#   publish.py --passwords             print every login's password
#   publish.py --out DIR --password-file F --key-file K --schools-file S    build elsewhere (e.g. a test site)
# Which callers belong to which school comes from the CRM: each user's User Permission on CRM Territory (the school they
# can see in the CRM). A caller with two schools shows in both. `schools:` in config.yaml can add more, e.g.
#   schools: {GEMS Millennium School - Indirapuram: [neha.s]}
# Corporate password and key: ~/.gems_audit_password, ~/.gems_audit_datakey (unchanged from the single-password site).
# School passwords and keys: ~/.gems_audit_schools.json. All chmod 600, never in git.
import argparse, base64, gzip, hashlib, hmac, json, os, re, secrets, shutil, urllib.parse, urllib.request
import yaml
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from common import P
from build_report import build_data, copy_web

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=P("docs")); ap.add_argument("--rubric", default="v1")
ap.add_argument("--password-file", default=os.path.expanduser("~/.gems_audit_password"))
ap.add_argument("--key-file", default=os.path.expanduser("~/.gems_audit_datakey"))
ap.add_argument("--schools-file", default=os.path.expanduser("~/.gems_audit_schools.json"))
ap.add_argument("--new-password", metavar="NAME"); ap.add_argument("--rotate", action="store_true")
ap.add_argument("--passwords", action="store_true")
a = ap.parse_args()
ITER = 600_000
b64 = lambda b: base64.b64encode(b).decode()
# 4 groups of 5 characters from a 31-letter unambiguous alphabet ≈ 99 bits; easy to read out and type
ALPHA = "abcdefghjkmnpqrstuvwxyz23456789"
new_pw = lambda: "-".join("".join(secrets.choice(ALPHA) for _ in range(5)) for _ in range(4))
new_key = lambda: b64(secrets.token_bytes(32))
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def secret_file(path, make):
    if not os.path.exists(path):
        old = os.umask(0o077); open(path, "w").write(make()); os.umask(old)
    os.chmod(path, 0o600); return open(path).read().strip()

def crm_schools():   # {school (CRM territory): [caller id]} from User Permission, the same mapping that limits what they see in the CRM
    tok = os.environ.get("T") or open(os.path.expanduser("~/.gems_crm_token")).read().strip()
    q = urllib.parse.urlencode({"fields": json.dumps(["user", "for_value"]), "filters": json.dumps([["allow", "=", "CRM Territory"]]), "limit_page_length": 1000})
    rows = json.load(urllib.request.urlopen(urllib.request.Request(f"https://gemseducation.m.frappe.cloud/api/resource/User%20Permission?{q}", headers={"Authorization": tok}), timeout=60))["data"]
    out = {}
    for r in rows: out.setdefault(r["for_value"], []).append(r["user"].split("@")[0])
    return out
# Short names for the sign-in list: "GEMS Millennium School - Indirapuram" -> "GMS Indirapuram"
SHORT = {"GEMS Millennium School": "GMS", "GEMS Modern Academy": "GMA", "GEMS School of Excellence": "GSE", "Little GEMS": "Little GEMS"}
short = lambda t: (lambda brand, _, place: f"{SHORT.get(brand.strip(), brand.strip())} {place.strip()}" if place else t)(*t.partition(" - "))

cfg = yaml.safe_load(open(P("config.yaml"))) if os.path.exists(P("config.yaml")) else {}
SCHOOLS = crm_schools()
for s, reps in (cfg.get("schools") or {}).items(): SCHOOLS.setdefault(s, []).extend(r for r in reps or [] if r not in SCHOOLS[s])
schools_of = {}
for s, reps in SCHOOLS.items():
    for r in reps: schools_of.setdefault(r, []).append(s)

if a.rotate:
    for f in (a.password_file, a.key_file, a.schools_file):
        if os.path.exists(f): os.remove(f)
if a.new_password == "corporate" and os.path.exists(a.password_file): os.remove(a.password_file)
password = secret_file(a.password_file, new_pw)
corp_dek = base64.b64decode(secret_file(a.key_file, new_key))
store = json.loads(secret_file(a.schools_file, lambda: "{}"))
if a.new_password and a.new_password != "corporate":
    match = [s for s in SCHOOLS if a.new_password in (s, short(s))]
    if not match: raise SystemExit(f"{a.new_password!r} isn't a school (schools: {', '.join(map(short, SCHOOLS))})")
    a.new_password = match[0]
    store.pop(a.new_password, None)   # new password and a new data key, so the old password opens nothing new
for s in SCHOOLS: store.setdefault(s, {}); store[s].setdefault("password", new_pw()); store[s].setdefault("dek", new_key())
store.setdefault("_central", {}).setdefault("dek", new_key())   # calls by callers with no school: corporate only
old = os.umask(0o077); json.dump(store, open(a.schools_file, "w"), indent=1); os.umask(old); os.chmod(a.schools_file, 0o600)
if a.passwords:
    print(f"Corporate (all schools): {password}"); [print(f"{short(s)}: {store[s]['password']}") for s in sorted(SCHOOLS, key=short)]; raise SystemExit

KEYS = {"_central": base64.b64decode(store["_central"]["dek"]), **{s: base64.b64decode(store[s]["dek"]) for s in SCHOOLS}}
enc = lambda key, data: (lambda iv: iv + AESGCM(key).encrypt(iv, data, None))(secrets.token_bytes(12))

def wrap(pw, payload):   # payload = which data file to open and the data keys it needs, wrapped with the password-derived key
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    kek = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode())
    return {"v": 2, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "wrapped": b64(AESGCM(kek).encrypt(iv, json.dumps(payload).encode(), None))}

DATA = build_data(a.rubric, everyone=True)
for d in ("a", "d", "k"): os.makedirs(os.path.join(a.out, d), exist_ok=True)
keep, AUDIO = set(), {}   # AUDIO[(call, school)] = encrypted file name; a caller with two schools gets one copy per school
for c in DATA["calls"]:
    ks = schools_of.get(c["rep"]) or ["_central"]; c["k"] = ks[0]
    src = P("recordings", c["id"] + ".mp3")
    if not os.path.exists(src) or os.path.getsize(src) < 2000: c["audio"] = None; continue
    for k in ks:
        name = hmac.new(corp_dek, f"{k}:{c['id']}".encode(), hashlib.sha256).hexdigest()[:24]   # names don't reveal call IDs; a new school means a new file
        AUDIO[(c["id"], k)] = name; keep.add(name + ".enc")
        dst = os.path.join(a.out, "a", name + ".enc")
        if not os.path.exists(dst) or a.rotate or a.new_password or os.path.getmtime(dst) < os.path.getmtime(src):
            open(dst, "wb").write(enc(KEYS[k], open(src, "rb").read()))
    c["audio"] = AUDIO[(c["id"], c["k"])]
for f in os.listdir(os.path.join(a.out, "a")):
    if f not in keep: os.remove(os.path.join(a.out, "a", f))   # drop recordings no longer published

pack = lambda d: gzip.compress(json.dumps(d, ensure_ascii=False).encode(), mtime=0)
def subset(calls, s):   # the same data object, cut down to one school's calls (and their copy of each recording)
    calls = [{**c, "k": s, "audio": AUDIO.get((c["id"], s))} for c in calls]
    reps = {c["rep"] for c in calls}
    return {**DATA, "calls": calls, "counsellors": {k: v for k, v in DATA["counsellors"].items() if k in reps}}

logins = [{"id": "corporate", "name": "Corporate (all schools)"}]
open(os.path.join(a.out, "d", "corporate.enc"), "wb").write(enc(corp_dek, pack(DATA)))
json.dump(wrap(password, {"data": "d/corporate.enc", "data_key": "corporate", "keys": {"corporate": b64(corp_dek), **{k: b64(v) for k, v in KEYS.items()}}}),
          open(os.path.join(a.out, "k", "corporate.json"), "w"))
counts = {}
for s in sorted(SCHOOLS, key=short):
    calls = [c for c in DATA["calls"] if s in (schools_of.get(c["rep"]) or [])]; counts[short(s)] = len(calls); sid = slug(short(s))
    open(os.path.join(a.out, "d", sid + ".enc"), "wb").write(enc(KEYS[s], pack({**subset(calls, s), "login": s})))
    json.dump(wrap(store[s]["password"], {"data": f"d/{sid}.enc", "data_key": s, "keys": {s: store[s]["dek"]}}), open(os.path.join(a.out, "k", sid + ".json"), "w"))
    logins.append({"id": sid, "name": short(s)})
live = {l["id"] + ext for l in logins for ext in (".enc", ".json")}
for d in ("d", "k"):
    for f in os.listdir(os.path.join(a.out, d)):
        if f not in live: os.remove(os.path.join(a.out, d, f))   # schools removed from config.yaml stop opening
for f in ("data.enc", "key.json"):   # the single-password layout
    if os.path.exists(os.path.join(a.out, f)): os.remove(os.path.join(a.out, f))

copy_web(a.out)                                                     # app shell (index.html, app.js, app.css) holds no call data
json.dump({"mode": "encrypted", "logins": logins}, open(os.path.join(a.out, "site.json"), "w"))
open(os.path.join(a.out, ".nojekyll"), "w").write("")
open(os.path.join(a.out, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(a.out) for f in fs) / 1e6
central = sum(1 for c in DATA["calls"] if c["k"] == "_central")
print(f"{a.out}: {len(DATA['calls'])} calls ({central} central desk / no school), {len(keep)} encrypted recordings, {size:.1f} MB")
print("  " + ", ".join(f"{s}: {n}" for s, n in counts.items()) if counts else "  no schools in config.yaml yet: only the corporate login works")
print(f"Passwords: publish.py --passwords" + (" (NEW passwords issued: share them privately)" if a.rotate or a.new_password else ""))
