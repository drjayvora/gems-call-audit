/* GEMS Call Audit – single-page app. Screens: #/ dashboard · #/calls · #/call/<id> · #/counsellors · #/counsellor/<id>
   Data comes from data.json (local, plain) or data.enc (GitHub Pages, AES-GCM, unlocked with the team password). */
"use strict";
const $ = s => document.querySelector(s);
const h = (t, a = {}, ...kids) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const round = v => v == null ? null : Math.round(v);
const pct = (n, d) => d ? Math.round(100 * n / d) : null;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const parseTs = t => { const m = /^(\d+):(\d{2})$/.exec(String(t || "").trim()); return m ? +m[1] * 60 + +m[2] : null; };
const dt = s => new Date(String(s).replace(" ", "T"));
const fmtDate = s => dt(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fmtWhen = s => dt(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const initials = n => n.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

let D, AUDIO_URL, AGG;
const RATING = { 2: ["Met", "good"], 1: ["Partial", "watch"], 0: ["Missed", "poor"], null: ["N/A", "na"] };
const scoreBand = s => s == null ? "na" : s >= D.bands.good ? "good" : s >= D.bands.needs_work ? "watch" : "poor";
const scoreBadge = (s, lg) => h("span", { class: `score ${scoreBand(s)}${lg ? " lg" : ""}`, title: "Quality score (0–100)" }, s ?? "–");
const L = () => D.listening || {};
const talkBand = v => v == null ? "na" : v <= L().talk_pct.good_max ? "good" : v <= L().talk_pct.watch_max ? "watch" : "poor";
const monoBand = v => v == null ? "na" : v <= L().monologue_sec.good_max ? "good" : v <= L().monologue_sec.watch_max ? "watch" : "poor";
const openBand = v => v == null ? "na" : v >= L().open_questions_min ? "good" : v >= L().open_questions_min / 2 ? "watch" : "poor";
const repName = id => (D.counsellors[id] || { name: id }).name;
const isLead = c => c.outcome !== "Not a lead";

/* ---------- aggregates ---------- */
function aggregate() {
  const by = {};
  const stats = calls => {
    const leads = calls.filter(isLead), withM = calls.filter(c => c.metrics), long = withM.filter(c => c.dur >= 120);
    const crit = {}; for (const k of D.criteria) { const v = calls.map(c => c.ratings[k.id]?.r).filter(x => x != null); crit[k.id] = v.length ? Math.round(50 * avg(v)) : null; }
    const flags = {}; calls.forEach(c => c.flags.forEach(f => flags[f.type] = (flags[f.type] || 0) + 1));
    return {
      n: calls.length, score: round(avg(calls.map(c => c.score).filter(x => x != null))),
      visit: pct(leads.filter(c => c.outcome === "Visit booked").length, leads.length),
      talk: round(avg(withM.map(c => c.metrics.counsellor_talk_pct))), mono: round(avg(withM.map(c => c.metrics.longest_monologue_sec))),
      openq: long.length ? +avg(long.map(c => c.metrics.open_questions)).toFixed(1) : null,
      qpm: withM.length ? +avg(withM.map(c => c.metrics.questions_per_min)).toFixed(1) : null,
      crm: pct(calls.filter(c => c.crm_outcome).length, calls.length), flagged: calls.filter(c => c.flags.length).length,
      flags, crit, outcomes: calls.reduce((o, c) => (o[c.outcome] = (o[c.outcome] || 0) + 1, o), {}),
      from: calls.map(c => c.when).sort()[0], to: calls.map(c => c.when).sort().slice(-1)[0],
    };
  };
  for (const c of D.calls) (by[c.rep] ||= []).push(c);
  const reps = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...stats(v), calls: v }]));
  return { team: stats(D.calls), reps };
}

/* ---------- small components ---------- */
const kpi = (v, l, s) => h("div", { class: "kpi" }, h("div", { class: "v" }, v ?? "–"), h("div", { class: "l" }, l), s ? h("div", { class: "s" }, s) : null);
const card = (title, ...kids) => h("section", { class: "card" }, title ? h("h2", {}, title) : null, ...kids);
function barRow(label, value, { max = 100, fmt = v => v, cls = "", zone, marker, href } = {}) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, 100 * value / max));
  return h("div", { class: "bar-row" },
    href ? h("a", { class: "lbl", href }, label) : h("span", { class: "lbl", title: label }, label),
    h("div", { class: "track" },
      zone ? h("div", { class: "zone", style: `left:${100 * zone[0] / max}%;width:${100 * (zone[1] - zone[0]) / max}%` }) : null,
      h("div", { class: `fill ${cls}`, style: `width:${w}%` }),
      marker != null ? h("div", { class: "marker", style: `left:calc(${100 * marker / max}% - 1px)`, title: `Team: ${fmt(marker)}` }) : null),
    h("span", { class: "val" }, value == null ? "–" : fmt(value)));
}
function stat(v, l, band) { return h("div", { class: `stat ${band || ""}` }, h("div", { class: "v" }, v ?? "–"), h("div", { class: "l" }, l)); }
function talkSplit(c) {
  const m = c.metrics; if (!m) return h("p", { class: "muted small" }, "Speaker labels not available for this call.");
  const cp = m.counsellor_talk_pct;
  return h("div", { class: "talk-split", title: `Counsellor ${cp}% · Parent ${100 - cp}%` },
    h("div", { style: `width:${cp}%;background:var(--c)` }, cp >= 18 ? `Counsellor ${cp}%` : ""),
    h("div", { style: `width:${100 - cp}%;background:var(--p)` }, 100 - cp >= 18 ? `Parent ${100 - cp}%` : ""));
}
function sortableTable(cols, rows, { initial, rowHref } = {}) {
  let key = initial?.[0], dir = initial?.[1] ?? 1;
  const wrap = h("div", { class: "table-wrap" });
  const draw = () => {
    const col = cols.find(c => c.key === key); const sorted = [...rows];
    if (col) sorted.sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x == null) - (y == null) || (x < y ? -1 : x > y ? 1 : 0) * dir; });
    wrap.replaceChildren(h("table", {},
      h("thead", {}, h("tr", {}, cols.map(c => h("th", { class: `${c.sort ? "sortable" : ""} ${c.cls || ""}`, onclick: c.sort ? () => { dir = key === c.key ? -dir : (c.desc ? -1 : 1); key = c.key; draw(); } : null },
        c.label, key === c.key ? (dir > 0 ? " ↑" : " ↓") : "")))),
      h("tbody", {}, sorted.length ? sorted.map(r => h("tr", { class: rowHref ? "link" : "", onclick: rowHref ? e => { if (!e.target.closest("a")) location.hash = rowHref(r); } : null },
        cols.map(c => h("td", { class: c.cls || "" }, c.cell(r))))) : h("tr", {}, h("td", { colspan: cols.length, class: "empty" }, "No calls match these filters.")))));
  };
  draw(); return wrap;
}
const callCols = (opts = {}) => [
  { key: "when", label: "When", sort: c => c.when, desc: true, cell: c => h("span", { class: "num" }, fmtWhen(c.when)) },
  opts.noRep ? null : { key: "rep", label: "Counsellor", sort: c => repName(c.rep), cell: c => h("a", { href: `#/counsellor/${c.rep}` }, repName(c.rep)) },
  { key: "type", label: "Type", cls: "hide-sm", sort: c => c.type, cell: c => c.type },
  { key: "dur", label: "Length", cls: "r hide-sm", sort: c => c.dur, cell: c => h("span", { class: "num" }, mmss(c.dur)) },
  { key: "outcome", label: "Outcome", sort: c => c.outcome, cell: c => c.outcome },
  { key: "talk", label: "Talk %", cls: "r hide-sm", sort: c => c.metrics?.counsellor_talk_pct, cell: c => c.metrics ? h("span", { class: `pill ${talkBand(c.metrics.counsellor_talk_pct)}` }, `${c.metrics.counsellor_talk_pct}%`) : "–" },
  { key: "flags", label: "Flags", cls: "c", sort: c => c.flags.length, desc: true, cell: c => c.flags.length ? h("span", {}, h("i", { class: "flag-dot" }), c.flags.length) : "" },
  { key: "score", label: "Score", cls: "r", sort: c => c.score, cell: c => scoreBadge(c.score) },
].filter(Boolean);

/* ---------- screens ---------- */
function viewDashboard() {
  const t = AGG.team;
  const days = {}; D.calls.forEach(c => (days[c.when.slice(0, 10)] ||= []).push(c.score));
  const dayKeys = Object.keys(days).sort().slice(-14);
  const repRows = Object.entries(AGG.reps).map(([id, s]) => ({ id, ...s }));
  const attention = [...D.calls].filter(c => c.flags.some(f => f.type === "hot_lead_risk") || c.score < D.bands.needs_work).sort((a, b) => a.score - b.score).slice(0, 6);
  return [
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Dashboard"), h("p", { class: "muted" }, `${t.n} audited calls · ${fmtDate(t.from)} – ${fmtDate(t.to)} · rubric ${D.rubric}`))),
    h("div", { class: "kpis" },
      kpi(t.score, "Average quality score", `Good is ${D.bands.good}+`), kpi(t.visit != null ? `${t.visit}%` : null, "Visit booked", "of genuine leads"),
      kpi(t.talk != null ? `${t.talk}%` : null, "Counsellor talk share", `Target ≤ ${L().talk_pct?.good_max}%`),
      kpi(t.openq, "Open questions per call", `Target ${L().open_questions_min}+ (calls ≥ 2 min)`),
      kpi(t.flagged, "Calls with red flags", `${t.n ? pct(t.flagged, t.n) : 0}% of calls`), kpi(`${t.crm}%`, "CRM outcome logged", "on audited calls")),
    h("div", { class: "grid g-2" },
      card("Rubric performance (team)", h("p", { class: "card-note" }, "Average rating as % of full marks, all audited calls."),
        h("div", { class: "bars" }, D.criteria.map(k => barRow(k.name, t.crit[k.id], { fmt: v => `${v}%`, cls: "" })))),
      card("Talk share by counsellor", h("p", { class: "card-note" }, `Share of speaking time taken by the counsellor. Green zone = target (≤ ${L().talk_pct?.good_max}%).`),
        h("div", { class: "bars" }, repRows.sort((a, b) => (a.talk ?? 999) - (b.talk ?? 999)).map(r => barRow(repName(r.id), r.talk, { fmt: v => `${v}%`, zone: [0, L().talk_pct?.good_max], href: `#/counsellor/${r.id}`, cls: `b-${talkBand(r.talk)}` }))))),
    h("div", { class: "section" }, h("section", { class: "card flush" }, h("h2", {}, "Counsellors"),
      sortableTable([
        { key: "name", label: "Counsellor", sort: r => repName(r.id), cell: r => h("a", { href: `#/counsellor/${r.id}` }, repName(r.id)) },
        { key: "n", label: "Calls", cls: "r", sort: r => r.n, desc: true, cell: r => r.n },
        { key: "visit", label: "Visit booked", cls: "r hide-sm", sort: r => r.visit, desc: true, cell: r => r.visit != null ? `${r.visit}%` : "–" },
        { key: "talk", label: "Talk %", cls: "r", sort: r => r.talk, cell: r => r.talk != null ? h("span", { class: `pill ${talkBand(r.talk)}` }, `${r.talk}%`) : "–" },
        { key: "openq", label: "Open Qs / call", cls: "r hide-sm", sort: r => r.openq, desc: true, cell: r => r.openq ?? "–" },
        { key: "flags", label: "Flagged calls", cls: "r hide-sm", sort: r => r.flagged, desc: true, cell: r => r.flagged },
        { key: "score", label: "Score", cls: "r", sort: r => r.score, desc: true, cell: r => scoreBadge(r.score) },
      ], repRows, { initial: ["score", -1], rowHref: r => `#/counsellor/${r.id}` }))),
    h("div", { class: "grid g-3 section" },
      card("Quality score by day", h("div", { class: "cols" }, dayKeys.map(d => { const v = round(avg(days[d])); return h("div", { class: "col" }, h("span", { class: "v" }, v), h("div", { class: "b", style: `height:${v}%;background:${v >= D.bands.good ? "var(--navy)" : v >= D.bands.needs_work ? "var(--cyan)" : "var(--gold)"}` })); })),
        h("div", { class: "col-labels" }, dayKeys.map(d => h("span", {}, fmtDate(d))))),
      card("Outcomes", h("div", { class: "bars" }, D.outcomes.filter(o => t.outcomes[o]).map(o => barRow(o, t.outcomes[o], { max: t.n, fmt: v => v, cls: o === "Visit booked" ? "cyan" : "" })))),
      card("Red flags", Object.keys(t.flags).length ? h("div", { class: "bars" }, Object.entries(t.flags).sort((a, b) => b[1] - a[1]).map(([k, v]) => barRow(D.flags[k] || k, v, { max: Math.max(...Object.values(t.flags)), fmt: v => v, href: `#/calls?flag=${k}` }))) : h("p", { class: "muted" }, "No red flags."))),
    h("div", { class: "section" }, h("section", { class: "card flush" }, h("h2", {}, "Needs attention"), h("p", { class: "card-note", style: "padding:0 20px" }, "Lowest-scoring calls and hot leads at risk."),
      sortableTable(callCols(), attention, { rowHref: c => `#/call/${c.id}` }))),
  ];
}

function viewCalls(q) {
  const f = { q: q.get("q") || "", rep: q.get("rep") || "", outcome: q.get("outcome") || "", flag: q.get("flag") || "", band: q.get("band") || "", type: q.get("type") || "" };
  const setQ = () => { const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); history.replaceState(null, "", `#/calls${p.toString() ? "?" + p : ""}`); draw(); };
  const sel = (key, label, opts) => h("select", { onchange: e => { f[key] = e.target.value; setQ(); }, "aria-label": label },
    h("option", { value: "" }, label), opts.map(([v, t]) => { const o = h("option", { value: v }, t); if (f[key] === v) o.selected = true; return o; }));
  const search = h("input", { type: "search", placeholder: "Search summary, names, notes…", value: f.q, oninput: e => { f.q = e.target.value; setQ(); } });
  const host = h("div", { class: "section" });
  const draw = () => {
    const needle = f.q.toLowerCase();
    const rows = D.calls.filter(c => (!f.rep || c.rep === f.rep) && (!f.outcome || c.outcome === f.outcome) && (!f.type || c.type === f.type)
      && (!f.flag || c.flags.some(x => x.type === f.flag)) && (!f.band || scoreBand(c.score) === f.band)
      && (!needle || [c.summary, c.coaching, repName(c.rep), JSON.stringify(c.lead || {})].join(" ").toLowerCase().includes(needle)));
    host.replaceChildren(h("p", { class: "muted small" }, `${rows.length} of ${D.calls.length} calls`),
      h("section", { class: "card flush" }, sortableTable(callCols(), rows, { initial: ["when", -1], rowHref: c => `#/call/${c.id}` })));
  };
  draw();
  return [
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Calls"), h("p", { class: "muted" }, "Every audited call. Click a row for the full analysis.")), exportButton()),
    h("div", { class: "filters" }, search,
      sel("rep", "All counsellors", Object.values(D.counsellors).map(r => [r.id, r.name])),
      sel("outcome", "All outcomes", D.outcomes.map(o => [o, o])),
      sel("flag", "Any flag", Object.entries(D.flags).map(([k, v]) => [k, v])),
      sel("band", "Any score", [["good", `Good (${D.bands.good}+)`], ["watch", "Needs work"], ["poor", `Poor (< ${D.bands.needs_work})`]]),
      sel("type", "In & out", [["Outgoing", "Outgoing"], ["Incoming", "Incoming"]])),
    host,
  ];
}

function viewCall(id) {
  const c = D.calls.find(x => x.id === id); if (!c) return notFound();
  const m = c.metrics, total = Math.max(c.dur, ...(c.segs.map(s => s[0] + 1)));
  const audio = h("audio", { controls: true, preload: "metadata" }), head = h("div", { class: "head", style: "left:0" });
  const status = h("div", { class: "muted small" }, c.audio ? "Loading recording…" : "No recording for this call.");
  const seek = t => { if (t == null) return; audio.currentTime = t; audio.play().catch(() => {}); };
  const ts = t => { const s = parseTs(t); return s == null ? null : h("button", { class: "ts", onclick: () => seek(s), title: "Play from here" }, t); };
  if (c.audio) AUDIO_URL(c).then(u => { audio.src = u; status.remove(); }, () => { status.textContent = "Couldn't load this recording."; });
  const tl = h("div", { class: "timeline", title: "Who spoke when — click to jump", onclick: e => { const r = e.currentTarget.getBoundingClientRect(); seek(total * (e.clientX - r.left) / r.width); } },
    (m?.timeline || []).map(([s, e, l]) => h("span", { class: l, style: `left:${100 * s / total}%;width:${Math.max(.3, 100 * (e - s) / total)}%` })), head);
  const lines = c.segs.map(([s, l, txt]) => h("div", { class: "line", "data-t": s },
    h("span", {}, h("button", { class: "ts", onclick: () => seek(s) }, mmss(s))),
    h("span", { class: `who ${l}` }, { C: "Counsellor", P: "Parent", M: "Both", N: "" }[l] || ""), h("span", { class: "txt" }, txt)));
  const tx = h("div", { class: "transcript" }, lines);
  let follow = true;
  audio.ontimeupdate = () => {
    head.style.left = `${100 * audio.currentTime / total}%`;
    let cur = null; for (const ln of lines) { if (+ln.dataset.t <= audio.currentTime + .2) cur = ln; else break; }
    lines.forEach(ln => ln.classList.toggle("now", ln === cur));
    if (cur && follow) { const top = cur.offsetTop - tx.offsetTop - 120; if (Math.abs(tx.scrollTop - top) > 60) tx.scrollTop = top; }
  };
  const followBox = h("label", { class: "check small" }, h("input", { type: "checkbox", checked: true, onchange: e => follow = e.target.checked }), "Follow playback");
  const crits = D.criteria.map(k => { const r = c.ratings[k.id] || {}; const [lbl, cls] = RATING[r.r ?? null];
    return h("div", { class: "crit" }, h("div", { class: "crit-top" }, h("span", {}, h("span", { class: "crit-name" }, k.name), h("span", { class: "crit-w" }, `weight ×${k.w}`)), h("span", { class: `pill ${cls}` }, lbl)),
      h("p", {}, r.note || ""), (r.ev || []).map(e => h("span", { class: "ev" }, ts(e.t), " “", e.quote, "”"))); });
  const lead = Object.entries(c.lead || {}).filter(([, v]) => v);
  return [
    h("div", { class: "crumb" }, h("a", { href: "#/calls" }, "Calls"), " / ", h("a", { href: `#/counsellor/${c.rep}` }, repName(c.rep))),
    h("div", { class: "call-head" },
      h("div", {}, h("h1", {}, `${repName(c.rep)} · ${c.outcome}`),
        h("div", { class: "meta-row" }, h("span", {}, fmtWhen(c.when)), h("span", {}, c.type), h("span", {}, mmss(c.dur)),
          c.lead_id ? h("a", { href: `https://gemseducation.m.frappe.cloud/crm/leads/${c.lead_id}`, target: "_blank", rel: "noopener" }, `CRM lead ${c.lead_id}`) : null,
          c.intent ? h("span", { class: "tag cyan" }, `Intent: ${c.intent}`) : null, c.gold ? h("span", { class: "tag navy" }, "Human-reviewed") : null)),
      h("div", { style: "text-align:right" }, scoreBadge(c.score, true), h("div", { class: "muted small" }, "Quality score"))),
    h("div", { class: "player" }, status, audio, tl,
      h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--c)" }), "Counsellor"), h("span", {}, h("i", { style: "background:var(--p)" }), "Parent"), h("span", {}, h("i", { style: "background:var(--m)" }), "Both / overlapping"))),
    h("div", { class: "grid g-side" },
      h("div", { class: "grid" },
        card("Summary", h("p", { style: "margin:0" }, c.summary), c.coaching ? [h("h3", {}, "Coaching"), h("div", { class: "coach" }, c.coaching)] : null),
        card("Rubric", h("p", { class: "card-note" }, "Each criterion with the evidence behind the rating. Click a timestamp to hear it."), crits),
        card("Transcript", h("div", { style: "display:flex;justify-content:space-between;gap:10px;margin:-6px 0 10px" }, h("span", { class: "muted small" }, c.tq ? `Transcript quality: ${c.tq}${c.ti ? " — " + c.ti : ""}` : ""), followBox), tx)),
      h("div", { class: "grid", style: "align-content:start" },
        card("Listening & probing",
          m ? [talkSplit(c), h("div", { class: "stat-grid" },
            stat(`${m.counsellor_talk_pct}%`, "Counsellor talk", talkBand(m.counsellor_talk_pct)), stat(mmss(m.longest_monologue_sec), "Longest monologue", monoBand(m.longest_monologue_sec)),
            stat(m.questions, "Questions asked"), stat(m.open_questions, "Open questions", c.dur >= 120 ? openBand(m.open_questions) : ""),
            stat(m.questions_per_min, "Questions / min"), stat(m.parent_turns, "Parent turns")),
            h("p", { class: "muted small", style: "margin:10px 0 0" }, m.source === "channels" ? "Measured from separate counsellor/parent audio channels." :
              `Estimated from the transcript (single-channel recording)${m.mixed_pct ? `; ${m.mixed_pct}% of speech had both voices in one line` : ""}.`)]
            : h("p", { class: "muted" }, "Not available for this call.")),
        card("Red flags", c.flags.length ? h("ul", { class: "flags" }, c.flags.map(f => h("li", {}, h("b", {}, D.flags[f.type] || f.type), f.detail ? ` — ${f.detail} ` : " ", f.t ? ts(f.t) : null))) : h("p", { class: "muted", style: "margin:0" }, "None.")),
        card("CRM", h("dl", { class: "kv" }, h("dt", {}, "Outcome logged"), h("dd", {}, c.crm_outcome || h("span", { class: "pill poor" }, "Not logged")),
          c.crm_suggest ? [h("dt", {}, "Suggested"), h("dd", {}, c.crm_suggest)] : null, h("dt", {}, "Intent logged"), h("dd", {}, c.crm_intent || "—"))),
        card("Lead details captured", lead.length ? h("dl", { class: "kv" }, lead.map(([k, v]) => [h("dt", {}, k.replace(/_/g, " ")), h("dd", {}, v)])) : h("p", { class: "muted", style: "margin:0" }, "Nothing captured.")),
        reviewCard(c))),
  ];
}

function viewCounsellors() {
  const reps = Object.entries(AGG.reps).sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  return [
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Counsellors"), h("p", { class: "muted" }, "Each counsellor's profile: strengths, gaps, listening habits and what to coach next."))),
    h("div", { class: "rep-cards" }, reps.map(([id, s]) => {
      const { plus, minus } = strengths(id); const p = D.counsellors[id]?.persona;
      return h("a", { class: "card rep-card", href: `#/counsellor/${id}` },
        h("div", { class: "top" }, h("div", { class: "who-line" }, h("div", { class: "avatar" }, initials(repName(id))), h("div", {}, h("b", {}, repName(id)), h("div", { class: "muted small" }, `${s.n} call${s.n === 1 ? "" : "s"} audited`))), scoreBadge(s.score)),
        p?.headline ? h("p", { class: "small", style: "margin:12px 0 0" }, p.headline) : null,
        h("div", { class: "stat-grid" }, stat(s.talk != null ? `${s.talk}%` : "–", "Talk share", talkBand(s.talk)), stat(s.visit != null ? `${s.visit}%` : "–", "Visit booked")),
        h("div", { class: "small", style: "margin-top:12px" }, plus[0] ? h("div", {}, "▲ ", h("b", {}, plus[0].name)) : null, minus[0] ? h("div", { class: "muted" }, "▼ ", minus[0].name) : null));
    })),
  ];
}

function strengths(id) {
  const s = AGG.reps[id], t = AGG.team;
  const diffs = D.criteria.filter(k => s.crit[k.id] != null).map(k => ({ ...k, v: s.crit[k.id], d: s.crit[k.id] - (t.crit[k.id] ?? 0) }));
  return { plus: [...diffs].sort((a, b) => b.v - a.v || b.d - a.d).filter(x => x.v >= 60).slice(0, 3), minus: [...diffs].sort((a, b) => a.v - b.v || a.d - b.d).filter(x => x.v < 75).slice(0, 3) };
}

function viewCounsellor(id) {
  const s = AGG.reps[id]; if (!s) return notFound();
  const t = AGG.team, p = D.counsellors[id]?.persona, { plus, minus } = strengths(id), lt = L();
  const withM = s.calls.filter(c => c.metrics);
  const dots = (get, max, zone, fmt) => h("div", {}, h("div", { class: "dots" }, zone ? h("div", { class: "zone", style: `left:${100 * zone[0] / max}%;width:${100 * (zone[1] - zone[0]) / max}%` }) : null,
    withM.map(c => h("a", { href: `#/call/${c.id}`, title: `${fmtWhen(c.when)} · ${fmt(get(c))}`, style: `left:${Math.min(100, 100 * get(c) / max)}%` }))),
    h("div", { class: "scale" }, h("span", {}, fmt(0)), h("span", {}, fmt(max))));
  const items = (arr, cls) => arr.map(x => h("div", { class: `item ${cls}` }, h("b", {}, x.title), h("div", { class: "small" }, x.detail),
    x.calls?.length ? h("div", { class: "small", style: "margin-top:4px" }, "Calls: ", x.calls.map((cid, i) => [i ? ", " : "", h("a", { href: `#/call/${D.calls.find(c => c.id.startsWith(cid))?.id || cid}` }, `#${i + 1}`)])) : null));
  return [
    h("div", { class: "crumb" }, h("a", { href: "#/counsellors" }, "Counsellors")),
    h("div", { class: "page-head" },
      h("div", { class: "who-line" }, h("div", { class: "avatar lg" }, initials(repName(id))),
        h("div", {}, h("h1", {}, repName(id)), h("p", { class: "muted" }, `${s.n} audited call${s.n === 1 ? "" : "s"} · ${fmtDate(s.from)} – ${fmtDate(s.to)}`))),
      scoreBadge(s.score, true)),
    s.n < 10 ? h("div", { class: "caution" }, `Based on ${s.n} call${s.n === 1 ? "" : "s"} so far. Treat this profile as early signals; it firms up after about 10 audited calls.`) : null,
    h("div", { class: "kpis section" },
      kpi(s.score, "Quality score", `Team ${t.score}`), kpi(s.visit != null ? `${s.visit}%` : null, "Visit booked", `Team ${t.visit ?? "–"}%`),
      kpi(s.talk != null ? `${s.talk}%` : null, "Talk share", `Target ≤ ${lt.talk_pct?.good_max}% · team ${t.talk}%`),
      kpi(s.openq, "Open questions / call", `Target ${lt.open_questions_min}+ · team ${t.openq ?? "–"}`),
      kpi(s.mono != null ? mmss(s.mono) : null, "Avg longest monologue", `Target ≤ ${mmss(lt.monologue_sec?.good_max || 60)}`),
      kpi(`${s.crm}%`, "CRM outcome logged")),
    h("div", { class: "grid g-2" },
      card("Persona", p ? [h("p", { class: "persona-head" }, p.headline), h("p", { style: "margin:0" }, p.summary),
        p.listening ? [h("h3", {}, "As a listener"), h("p", { style: "margin:0" }, p.listening)] : null,
        h("p", { class: "faint small", style: "margin:12px 0 0" }, `Written ${p.updated} from ${p.based_on_calls} calls.`)]
        : h("p", { class: "muted" }, "No written persona yet. Strengths and gaps below are calculated from rubric scores.")),
      card("Coaching plan", p?.coaching_plan?.length ? h("ol", { class: "list" }, p.coaching_plan.map(x => h("li", {}, x)))
        : minus.length ? h("ol", { class: "list" }, minus.map(x => h("li", {}, `Work on ${x.name.toLowerCase()}: ${x.look_for}`))) : h("p", { class: "muted" }, "Nothing flagged yet."))),
    h("div", { class: "grid g-2 section" },
      card("Strengths", h("div", { class: "sw" }, p?.strengths?.length ? items(p.strengths, "plus") : plus.length ? plus.map(x => h("div", { class: "item plus" }, h("b", {}, x.name), h("div", { class: "small" }, `${x.v}% of full marks (team ${t.crit[x.id]}%)`))) : h("p", { class: "muted" }, "Not enough data yet."))),
      card("What needs work", h("div", { class: "sw" }, p?.development?.length ? items(p.development, "minus") : minus.length ? minus.map(x => h("div", { class: "item minus" }, h("b", {}, x.name), h("div", { class: "small" }, `${x.v}% of full marks (team ${t.crit[x.id]}%)`))) : h("p", { class: "muted" }, "Nothing below target.")))),
    h("div", { class: "grid g-2 section" },
      card("Rubric vs team", h("p", { class: "card-note" }, "Bar = this counsellor, gold line = team average."),
        h("div", { class: "bars" }, D.criteria.map(k => barRow(k.name, s.crit[k.id], { fmt: v => `${v}%`, marker: t.crit[k.id], cls: (s.crit[k.id] ?? 0) >= (t.crit[k.id] ?? 0) ? "cyan" : "" })))),
      card("Listening & probing", h("p", { class: "card-note" }, "Each dot is one call; click to open it. Green zone = target."),
        withM.length ? [h("h3", { style: "margin-top:0" }, "Counsellor talk share"), dots(c => c.metrics.counsellor_talk_pct, 100, [0, lt.talk_pct?.good_max], v => `${v}%`),
          h("h3", {}, "Longest monologue"), dots(c => Math.min(c.metrics.longest_monologue_sec, 180), 180, [0, lt.monologue_sec?.good_max], v => mmss(v)),
          h("h3", {}, "Open questions per call"), dots(c => Math.min(c.metrics.open_questions, 12), 12, [lt.open_questions_min, 12], v => `${v}`),
          h("h3", {}, "Questions per minute"), dots(c => Math.min(c.metrics.questions_per_min, 8), 8, null, v => `${v}`)]
          : h("p", { class: "muted" }, "No speaker data yet."))),
    h("div", { class: "grid g-2 section" },
      card("Outcomes", h("div", { class: "bars" }, D.outcomes.filter(o => s.outcomes[o]).map(o => barRow(o, s.outcomes[o], { max: s.n, fmt: v => v, cls: o === "Visit booked" ? "cyan" : "" })))),
      card("Red flags", Object.keys(s.flags).length ? h("div", { class: "bars" }, Object.entries(s.flags).map(([k, v]) => barRow(D.flags[k] || k, v, { max: s.n, fmt: v => v, href: `#/calls?rep=${id}&flag=${k}` }))) : h("p", { class: "muted" }, "None."))),
    h("div", { class: "section" }, h("section", { class: "card flush" }, h("h2", {}, "Calls"), sortableTable(callCols({ noRep: true }), s.calls, { initial: ["when", -1], rowHref: c => `#/call/${c.id}` }))),
  ];
}

const notFound = () => [h("h1", {}, "Not found"), h("p", {}, h("a", { href: "#/" }, "Back to the dashboard"))];

/* ---------- reviews (kept in this browser, exported as JSON → ingest_reviews.py) ---------- */
const REV_KEY = () => "callaudit.reviews." + D.rubric;
function exportButton() {
  const n = Object.keys(store.get(REV_KEY(), {})).length;
  return h("button", { class: "btn btn-outline", onclick: () => {
    const rs = Object.values(store.get(REV_KEY(), {})); if (!rs.length) { alert("No reviews saved in this browser yet."); return; }
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), rubric: D.rubric, reviews: rs }, null, 1)], { type: "application/json" })), download: `call-reviews-${D.rubric}-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  } }, `Export reviews (${n})`);
}
function reviewCard(c) {
  const saved = store.get(REV_KEY(), {})[c.id], base = saved || c.gold || { ratings: Object.fromEntries(D.criteria.map(k => [k.id, c.ratings[k.id]?.r ?? null])), outcome: c.outcome, flags: c.flags.map(f => f.type), comment: "" };
  const sel = {}; const rows = D.criteria.map(k => { const s = h("select", {}, [2, 1, 0, null].map(v => { const o = h("option", { value: String(v) }, RATING[v][0]); if ((base.ratings[k.id] ?? null) === v) o.selected = true; return o; })); sel[k.id] = s; return h("tr", {}, h("td", {}, k.name), h("td", {}, s)); });
  const out = h("select", {}, D.outcomes.map(o => { const e = h("option", { value: o }, o); if (o === base.outcome) e.selected = true; return e; }));
  const fl = h("div", { class: "flagbox" }, Object.entries(D.flags).map(([k, n]) => { const i = h("input", { type: "checkbox", value: k }); i.checked = base.flags.includes(k); return h("label", {}, i, " ", n); }));
  const who = h("input", { type: "text", placeholder: "Your name", value: store.get("callaudit.reviewer", "") });
  const cm = h("textarea", { placeholder: "What did the audit get wrong? (helps improve the rubric)" }); cm.value = base.comment || "";
  const msg = h("span", { class: "muted small" });
  return h("details", { class: "card review" }, h("summary", {}, h("b", {}, saved ? "Your review (saved)" : "Review this audit")),
    h("p", { class: "card-note", style: "margin-top:10px" }, "Correct anything the audit got wrong. Reviews stay in this browser until exported from the Calls page."),
    h("table", {}, rows, h("tr", {}, h("td", {}, "Outcome"), h("td", {}, out))), h("h3", {}, "Red flags"), fl, h("h3", {}, "Comment"), cm,
    h("div", { style: "display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap" }, who, h("button", { class: "btn btn-primary", onclick: () => {
      if (!who.value.trim()) { msg.textContent = "Add your name first."; who.focus(); return; }
      store.set("callaudit.reviewer", who.value.trim());
      const all = store.get(REV_KEY(), {});
      all[c.id] = { call: c.id, rubric: D.rubric, reviewer: who.value.trim(), at: new Date().toISOString(), outcome: out.value, comment: cm.value.trim(),
        ratings: Object.fromEntries(D.criteria.map(k => [k.id, sel[k.id].value === "null" ? null : +sel[k.id].value])), flags: [...fl.querySelectorAll("input:checked")].map(i => i.value) };
      msg.textContent = store.set(REV_KEY(), all) ? "Saved in this browser." : "Couldn't save (browser storage is blocked).";
    } }, "Save review"), msg));
}

/* ---------- router ---------- */
function route() {
  const [path, query] = (location.hash.slice(1) || "/").split("?"); const parts = path.split("/").filter(Boolean);
  const q = new URLSearchParams(query || ""); const view = $("#view");
  let nodes, nav;
  if (!parts.length) { nodes = viewDashboard(); nav = "dashboard"; }
  else if (parts[0] === "calls") { nodes = viewCalls(q); nav = "calls"; }
  else if (parts[0] === "call") { nodes = viewCall(parts[1]); nav = "calls"; }
  else if (parts[0] === "counsellors") { nodes = viewCounsellors(); nav = "counsellors"; }
  else if (parts[0] === "counsellor") { nodes = viewCounsellor(decodeURIComponent(parts[1] || "")); nav = "counsellors"; }
  else nodes = notFound();
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === nav));
  view.querySelectorAll("audio").forEach(a => { a.pause(); if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src); });
  view.replaceChildren(...[nodes].flat()); window.scrollTo(0, 0);
  document.title = `${{ dashboard: "Dashboard", calls: parts[0] === "call" ? "Call" : "Calls", counsellors: parts[0] === "counsellor" ? repName(parts[1]) : "Counsellors" }[nav] || "Not found"} · GEMS Call Audit`;
}
function start(data, audioUrl) {
  D = data; AUDIO_URL = audioUrl; AGG = aggregate();
  $("#gate").hidden = true; $("#top").hidden = false; $("#view").hidden = false;
  window.addEventListener("hashchange", route); route();
}

/* ---------- boot ---------- */
(async () => {
  let mode = "encrypted";
  try { mode = (await (await fetch("site.json", { cache: "no-store" })).json()).mode; } catch {}
  if (mode === "plain") { start(await (await fetch("data.json", { cache: "no-store" })).json(),   // load audio into memory so seeking works on any server
    c => fetch(`audio/${c.audio}.mp3`).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(b => URL.createObjectURL(b))); return; }
  const KEY = "callaudit.unlock", b64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0)), u8b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
  let DEK;
  const get = async u => { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r; };
  const dec = async u => { const b = new Uint8Array(await (await get(u)).arrayBuffer()); return crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, DEK, b.slice(12)); };
  async function unwrap(pass) {   // password -> PBKDF2 -> key-encryption key -> data key (throws DOMException if the password is wrong)
    const k = await (await get("key.json")).json();
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    const kek = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(k.salt), iterations: k.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(k.iv) }, kek, b64(k.wrapped));
  }
  async function open(raw) {
    DEK = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const gz = await dec("data.enc");
    const data = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
    $("#lock").hidden = false;
    $("#lock").onclick = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch {} location.hash = ""; location.reload(); };
    start(data, c => dec(`a/${c.audio}.enc`).then(b => URL.createObjectURL(new Blob([b], { type: "audio/mpeg" }))));
  }
  const showGate = msg => { $("#gate").hidden = false; $("#gateErr").textContent = msg || ""; $("#pw").focus(); };
  const reset = () => { const b = $("#unlockBtn"); b.disabled = false; b.textContent = "Unlock"; };
  $("#gateForm").onsubmit = async e => {
    e.preventDefault(); const b = $("#unlockBtn"); b.disabled = true; b.textContent = "Unlocking…"; $("#gateErr").textContent = "";
    let raw;
    try { raw = await unwrap($("#pw").value); }
    catch (err) { reset(); return showGate(err instanceof DOMException ? "Wrong password." : "Couldn't reach the site's data. Check your connection and try again."); }
    try { ($("#remember").checked ? localStorage : sessionStorage).setItem(KEY, u8b64(raw)); } catch {}
    try { await open(raw); } catch { reset(); showGate("The data couldn't be decrypted. The site may be mid-update; reload in a minute."); }
  };
  let saved = null; try { saved = sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch {}
  if (saved) open(b64(saved)).catch(() => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch {} showGate("Please enter the password again."); });
  else showGate();
})();
