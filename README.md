# Call quality audit

Pulls call logs and Exotel recordings from the CRM, transcribes them on this Mac (Whisper), has Claude score each call against a rubric inside a Claude Code session (no API key, no API spend), and builds a review page where managers correct the scores. Their corrections become the answer key that keeps the scorer honest as the rubric evolves.

## The loop

```
pull_calls.py  →  fetch_recordings.py  →  transcribe.py  →  score.py  →  publish.py
                                                              ↑              │ managers review on the website,
                                         edit rubric/*.yaml   │              ▼ click "Export reviews"
                                                     calibrate.py  ←  ingest_reviews.py  (gold/ = human answer key)
```

| Step | Command (from this folder) |
|---|---|
| New calls + recordings | `python3 pull_calls.py && python3 fetch_recordings.py` |
| Transcribe new recordings (local, ~20× real time) | `.venv/bin/python transcribe.py` |
| Score new calls | Ask Claude in Claude Code: "score the next 10 calls". Claude runs `score.py next --n 10`, reads `work/next.md`, writes `work/results.json` and runs `score.py save work/results.json`, which checks every field against the rubric before saving |
| Preview the site locally (no password) | `.venv/bin/python build_report.py`, then `python3 -m http.server 8765 --directory local_site` and open http://localhost:8765 |
| Publish the encrypted site | `.venv/bin/python publish.py`, then commit and push `docs/` |
| Load reviewers' corrections | `.venv/bin/python ingest_reviews.py ~/Downloads/call-reviews-*.json` |
| Check scorer vs reviewers | `.venv/bin/python calibrate.py` (add `--include-drafts` to include the 10 unreviewed pilot labels) |

## Improving the scorer

1. **Get ~30 calls human-reviewed** across all counsellors and outcomes. That's the answer key (`gold/`).
2. Run `calibrate.py`. It shows, per criterion, how often Claude agrees with reviewers and whether it scores high or low (bias), plus outcome and red-flag agreement and the biggest disagreements.
3. Change one thing: a criterion's anchors in `rubric/v1.yaml` (a wording change is fine within a version), a fact in `rubric/facts.yaml`, or the instructions in `score.py`.
4. Ask Claude to re-score the reviewed calls (`score.py next --ids gold_ids.json --force`) and re-run `calibrate.py`. Keep the change if agreement improves. `calibration/history.jsonl` keeps every run.
5. When you change what's being measured (add or remove a criterion, change weights), copy to `rubric/v2.yaml` with `version: v2`. Scores are stored per version, so v1 and v2 never mix.

**Fill in `rubric/facts.yaml` first.** Fee policy, campus status and approved brand claims decide whether "Knowledge & accuracy" is fair. Anything a counsellor says that isn't there gets flagged as unverifiable.

## Files

- `rubric/v1.yaml`: criteria, weights, Met/Partial/Missed anchors, red flags, outcomes.
- `rubric/facts.yaml`: approved facts, plus brand-word spelling corrections for transcripts (never place names: a Whisper glossary prompt once inserted campuses nobody said).
- `calls.json`: CRM call logs. `recordings/`: Exotel MP3s. `transcripts/`: Whisper output.
- `scores/<version>/`: Claude's scores with evidence quotes. `gold/`: human-reviewed scores (`reviewed: true`), or the pilot drafts.
- Credentials are read from `~/.gems_crm_token` and `~/.gems_exotel_token`. They're never stored in this folder.

## Dual-channel recordings

`transcribe.py` detects stereo recordings automatically and labels each line Counsellor or Parent. The channel order in `CHANNELS` (top of `transcribe.py`) is a best guess. **Check it on the first dual-channel call** and swap it if the labels come out reversed.

## The encrypted website (GitHub Pages)

`docs/` is the published site. It holds only encrypted files, so the repo and the site can be public. Without a password, nobody can read the call data or play recordings.

**Logins:** the sign-in screen has a list: **Corporate (all schools)** plus one entry per school, each with its own password.
- Corporate sees every call, including the central desk.
- A school sees only calls made by its own team. The team comes from the CRM: each user's User Permission on CRM Territory, the same setting that limits which school they see in the CRM. A user with two schools shows in both. `publish.py` reads it fresh every time, so fixing a mapping in the CRM fixes the site on the next publish.

Callers with no school in the CRM (the central desk) are visible to corporate only. To add someone the CRM doesn't map, list them in `config.yaml`:

```yaml
schools:
  GEMS Millennium School - Indirapuram: [neha.s]   # CRM territory: [CRM user id = email before the @]
```

- **Publish after scoring:** `.venv/bin/python publish.py`, then commit and push `docs/`. The site updates within a minute or two.
- **Passwords:** `.venv/bin/python publish.py --passwords` prints them. Corporate's is `~/.gems_audit_password` (the original team password). A school's password is created the first time a user is mapped to it, and all of them are kept in `~/.gems_audit_schools.json`. Share them privately, never in the repo.
- **How it works:** each school's calls and recordings are encrypted with AES-256-GCM under that school's own data key. Central desk calls use a key only corporate holds. `docs/k/<login>.json` holds a login's data keys, wrapped with a key derived from its password (PBKDF2-SHA256, 600,000 iterations). The browser derives the same key, unwraps that login's keys and decrypts locally. A school password can't open another school's data or recordings. Recording file names are keyed hashes, so they don't reveal call IDs.
- **"Stay unlocked on this device"** keeps that login's keys in the browser until someone clicks **Lock**. Leave it off on shared computers.
- **Changing access:**
  - `publish.py --new-password "GMS Indirapuram"` (or `corporate`) issues a new password, and a new data key, for one login.
  - `publish.py --rotate` replaces every key and password.

  Either way, old versions remain in git history and still open with the old password, so treat a change as protecting **new** data only.
- **Reviews** are still saved in each reviewer's browser and exported as JSON (`ingest_reviews.py`), because a static site can't store them centrally.

## The website

The site is one page with five screens. Unlock once and move between them:

- **Dashboard** (`#/`): team KPIs, rubric performance, talk share by counsellor, the counsellor table, score by day, outcomes, red flags, and calls needing attention.
- **Calls** (`#/calls`): every audited call, with search and filters (counsellor, outcome, flag, score band, direction) and sortable columns.
- **Call detail** (`#/call/<id>`): the recording with a who-spoke-when timeline, a transcript that follows playback, the rubric with clickable evidence timestamps, listening and probing metrics, red flags, CRM comparison, lead details, and a review form.
- **Counsellors** (`#/counsellors`) and **counsellor profile** (`#/counsellor/<id>`): persona, coaching plan, strengths and gaps, rubric vs team, listening dots per call, outcomes, flags and their calls.

**Code:** `web/` (index.html, app.css, app.js). **Data:** `build_report.py::build_data()`. **Personas:** `personas/<counsellor>.json`, written in-session; git-ignored because they're HR-sensitive, and only published encrypted.

**Talk-to-listen:** `metrics.py` computes counsellor talk %, the longest monologue, questions, open questions and parent turns from speaker labels. Dual-channel recordings carry exact labels. For mono recordings the scorer labels each transcript line (`speakers`: C/P/M/N), and the site marks those figures as estimated. Targets are under `listening:` in `rubric/v1.yaml`.
