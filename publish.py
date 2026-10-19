# Build the encrypted website in docs/ (served by GitHub Pages). Nothing readable leaves this Mac:
# the call data and every recording are encrypted with AES-256-GCM under a random data key, and that key is
# wrapped with a key derived from the team password (PBKDF2-SHA256, 600k iterations). The browser does the reverse.
#   publish.py                     rebuild docs/ with the current scores (same data key, same password)
#   publish.py --new-password      generate a new team password (old password stops working for new publishes)
#   publish.py --rotate            new data key AND new password; use when someone should lose access
#   publish.py --out DIR --password-file F --key-file K    build elsewhere (e.g. a test site)
#   publish.py --portal            switch the site to the sign-in portal: only the app shell is published, the calls live in
#                                  Supabase (sync_portal.py). Reads url and anon_key from ~/.gems_portal.json.
# Password: ~/.gems_audit_password (created on first run). Data key: ~/.gems_audit_datakey. Both chmod 600, never in git.
import argparse, base64, gzip, hashlib, hmac, json, os, secrets, shutil
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from common import P
from build_report import build_data, copy_web

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=P("docs")); ap.add_argument("--rubric", default="v1")
ap.add_argument("--password-file", default=os.path.expanduser("~/.gems_audit_password"))
ap.add_argument("--key-file", default=os.path.expanduser("~/.gems_audit_datakey"))
ap.add_argument("--new-password", action="store_true"); ap.add_argument("--rotate", action="store_true")
ap.add_argument("--portal", action="store_true")
a = ap.parse_args()

if a.portal:   # the anon key is meant to be public: the database's row-level security decides what each person sees
    cfg = json.load(open(os.path.expanduser("~/.gems_portal.json")))
    for f in ("data.enc", "key.json"):
        if os.path.exists(os.path.join(a.out, f)): os.remove(os.path.join(a.out, f))
    shutil.rmtree(os.path.join(a.out, "a"), ignore_errors=True)
    copy_web(a.out)
    json.dump({"mode": "portal", "url": cfg["url"], "anon_key": cfg["anon_key"]}, open(os.path.join(a.out, "site.json"), "w"))
    open(os.path.join(a.out, ".nojekyll"), "w").write("")
    open(os.path.join(a.out, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
    raise SystemExit(f"{a.out}: portal shell published (sign-in via {cfg['url']}). Run sync_portal.py to load the calls.")
ITER = 600_000
b64 = lambda b: base64.b64encode(b).decode()

def secret_file(path, make):
    if not os.path.exists(path):
        old = os.umask(0o077); open(path, "w").write(make()); os.umask(old)
    os.chmod(path, 0o600); return open(path).read().strip()

if a.rotate or a.new_password:
    for f in ([a.password_file, a.key_file] if a.rotate else [a.password_file]):
        if os.path.exists(f): os.remove(f)
# 4 groups of 5 characters from a 31-letter unambiguous alphabet ≈ 99 bits; easy to read out and type
ALPHA = "abcdefghjkmnpqrstuvwxyz23456789"
password = secret_file(a.password_file, lambda: "-".join("".join(secrets.choice(ALPHA) for _ in range(5)) for _ in range(4)))
dek = base64.b64decode(secret_file(a.key_file, lambda: b64(secrets.token_bytes(32))))
enc = lambda data: (lambda iv: iv + AESGCM(dek).encrypt(iv, data, None))(secrets.token_bytes(12))

# Wrap the data key with the password-derived key.
salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
kek = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
keyjson = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "wrapped": b64(AESGCM(kek).encrypt(iv, dek, None))}

DATA = build_data(a.rubric)
os.makedirs(os.path.join(a.out, "a"), exist_ok=True)
keep = set()
for c in DATA["calls"]:
    src = P("recordings", c["id"] + ".mp3")
    if not os.path.exists(src) or os.path.getsize(src) < 2000: c["audio"] = None; continue
    name = hmac.new(dek, c["id"].encode(), hashlib.sha256).hexdigest()[:24]   # file names don't reveal call IDs
    c["audio"] = name; keep.add(name + ".enc")
    dst = os.path.join(a.out, "a", name + ".enc")
    if not os.path.exists(dst) or a.rotate or os.path.getmtime(dst) < os.path.getmtime(src):
        open(dst, "wb").write(enc(open(src, "rb").read()))
for f in os.listdir(os.path.join(a.out, "a")):
    if f not in keep: os.remove(os.path.join(a.out, "a", f))   # drop recordings no longer published

open(os.path.join(a.out, "data.enc"), "wb").write(enc(gzip.compress(json.dumps(DATA, ensure_ascii=False).encode(), mtime=0)))
json.dump(keyjson, open(os.path.join(a.out, "key.json"), "w"))
copy_web(a.out)                                                     # app shell (index.html, app.js, app.css) holds no call data
json.dump({"mode": "encrypted"}, open(os.path.join(a.out, "site.json"), "w"))
open(os.path.join(a.out, ".nojekyll"), "w").write("")
open(os.path.join(a.out, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(a.out) for f in fs) / 1e6
print(f"{a.out}: {len(DATA['calls'])} calls, {len(keep)} encrypted recordings, {size:.1f} MB. Password is in {a.password_file}"
      + (" (NEW – share it with the team)" if a.rotate or a.new_password else ""))
