# Listening & probing metrics from a speaker-labelled transcript.
# Labels per segment: C = counsellor, P = parent, M = both in one segment (time split 50/50), N = noise/unclear (ignored).
# Dual-channel transcripts carry labels already; mono ones get them from the scorer (scores/<v>/<call>.json "speakers").
import re

OPEN = re.compile(r"^\s*(what|how|why|which|where|when|who|whom|whose|tell me|could you tell|can you tell|can you share|could you share|"
                  r"may i know|can i know|could you explain|can you explain|describe|walk me)\b", re.I)
SENT = re.compile(r"[^?.!]*\?")
FILLER = re.compile(r"^\s*((so|and|okay|ok|alright|all right|yeah|yes|right|now|then|ma'?am|mam|sir|madam|actually|basically|just|you know|firstly|"
                    r"can i understand|i wanted to (understand|ask|know))\b[\s,]*)+", re.I)
is_open = lambda q: bool(OPEN.search(FILLER.sub("", q.strip(" ,"))) or re.search(r"\b(where|what|which|how|why|when)\b[^?]*\?$", q, re.I))

def labels_for(transcript, score=None):
    segs = transcript["segments"]
    if segs and all(s.get("speaker") in ("Counsellor", "Parent") for s in segs):
        return "".join("C" if s["speaker"] == "Counsellor" else "P" for s in segs), "channels"
    lab = (score or {}).get("speakers")
    if lab and len(lab) == len(segs): return lab, "inferred"
    return None, None

def compute(transcript, labels, source):
    segs = transcript["segments"]; talk = {"C": 0.0, "P": 0.0}; mixed = 0.0
    questions = open_q = 0; runs = []; cur = None
    for s, l in zip(segs, labels):
        d = max(0.0, s["end"] - s["start"])
        if l in "CP": talk[l] += d
        elif l == "M": talk["C"] += d / 2; talk["P"] += d / 2; mixed += d
        if l == "C":
            qs = SENT.findall(s["text"]); questions += len(qs); open_q += sum(1 for q in qs if is_open(q))
        # counsellor monologues: consecutive C segments with < 1.5 s gaps
        if l == "C" and cur and s["start"] - cur[1] < 1.5: cur[1] = s["end"]
        elif l == "C": cur = [s["start"], s["end"]]; runs.append(cur)
        elif l in "PM": cur = None
    spoken = talk["C"] + talk["P"]; minutes = max(spoken, 1) / 60
    parent_turns = sum(1 for i, l in enumerate(labels) if l == "P" and (i == 0 or labels[i - 1] != "P"))
    return {
        "source": source,                                     # "channels" (exact) or "inferred" (labelled from text)
        "counsellor_talk_pct": round(100 * talk["C"] / spoken) if spoken else None,
        "counsellor_sec": round(talk["C"]), "parent_sec": round(talk["P"]),
        "longest_monologue_sec": round(max((e - b for b, e in runs), default=0)),
        "questions": questions, "open_questions": open_q,
        "questions_per_min": round(questions / minutes, 1),
        "parent_turns": parent_turns,
        "mixed_pct": round(100 * mixed / spoken) if spoken else 0,
        "timeline": [[round(s["start"], 1), round(s["end"], 1), l] for s, l in zip(segs, labels) if l in "CPM"],
    }

def band(value, good_max, watch_max):
    return None if value is None else "good" if value <= good_max else "watch" if value <= watch_max else "poor"
