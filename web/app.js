/* GEMS Call Audit – single-page app. Screens: #/ dashboard · #/calls · #/call/<id> · #/counsellors · #/counsellor/<id>
   Data comes from data.json (local, plain) or data.enc (GitHub Pages, AES-GCM, unlocked with the team password).
   Design rule: visuals first, words second – short labels, details on hover or behind "show more". */
"use strict";
const $ = s => document.querySelector(s);
const SVG = "http://www.w3.org/2000/svg";
const h = (t, a = {}, ...kids) => {
  const e = t.startsWith("svg:") ? document.createElementNS(SVG, t.slice(4)) : document.createElement(t);
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.setAttribute("class", v); else if (k === "style") e.style.cssText = v;
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
const RATING = { 2: ["Met", "good"], 1: ["Partly", "watch"], 0: ["Missed", "poor"], null: ["N/A", "na"] };
const band3 = (v, good, ok) => v == null ? "na" : v >= good ? "good" : v >= ok ? "watch" : "poor";
const scoreBand = s => band3(s, D.bands.good, D.bands.needs_work);
const L = () => D.listening || {};
const talkBand = v => v == null ? "na" : v <= L().talk_pct.good_max ? "good" : v <= L().talk_pct.watch_max ? "watch" : "poor";
const monoBand = v => v == null ? "na" : v <= L().monologue_sec.good_max ? "good" : v <= L().monologue_sec.watch_max ? "watch" : "poor";
const openBand = v => band3(v, L().open_questions_min, L().open_questions_min / 2);
const repName = id => (D.counsellors[id] || { name: id }).name;
const first = id => repName(id).split(" ")[0];
const isLead = c => c.outcome !== "Not a lead";
// Quality averages only count real admission conversations (not dropped calls or non-leads like job seekers).
const counts = c => c.outcome !== "Not a lead" && c.outcome !== "Call dropped / unclear";
const COLORS = { good: "#1E7B4F", watch: "#D99A1E", poor: "#B42318", na: "#C9D0D8" };
const OUT_COLORS = { "Visit booked": "#1E7B4F", "Callback scheduled": "#00A3E0", "Callback – no date": "#7FCFEF", "Handed to campus": "#041E42",
  "Not interested": "#B42318", "Not a lead": "#A29366", "Call dropped / unclear": "#C9D0D8" };

/* ---------- aggregates ---------- */
function aggregate() {
  const stats = calls => {
    const leads = calls.filter(isLead), real = calls.filter(counts), withM = real.filter(c => c.metrics), long = withM.filter(c => c.dur >= 120);
    const crit = {}; for (const k of D.criteria) { const v = real.map(c => c.ratings[k.id]?.r).filter(x => x != null); crit[k.id] = v.length ? Math.round(50 * avg(v)) : null; }
    const flags = {}; calls.forEach(c => c.flags.forEach(f => flags[f.type] = (flags[f.type] || 0) + 1));
    const sorted = calls.map(c => c.when).sort();
    return {
      n: calls.length, real: real.length, score: round(avg(real.map(c => c.score).filter(x => x != null))),
      visits: calls.filter(c => c.outcome === "Visit booked").length, visit: pct(calls.filter(c => c.outcome === "Visit booked").length, leads.length),
      talk: round(avg(withM.map(c => c.metrics.counsellor_talk_pct))), mono: round(avg(withM.map(c => c.metrics.longest_monologue_sec))),
      openq: long.length ? +avg(long.map(c => c.metrics.open_questions)).toFixed(1) : null,
      flagged: calls.filter(c => c.flags.length).length, flags, crit,
      outcomes: calls.reduce((o, c) => (o[c.outcome] = (o[c.outcome] || 0) + 1, o), {}), from: sorted[0], to: sorted.slice(-1)[0],
    };
  };
  const by = {}; for (const id of Object.keys(D.counsellors)) by[id] = []; for (const c of D.calls) (by[c.rep] ||= []).push(c);
  return { team: stats(D.calls), reps: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...stats(v), calls: v }])) };
}

/* ---------- visual components ---------- */
function ring(v, size = 64, band = scoreBand(v), label) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, f = v == null ? 0 : Math.max(0, Math.min(100, v)) / 100;
  return h("div", { class: "ring", style: `width:${size}px;height:${size}px`, title: label || "Quality score out of 100" },
    h("svg:svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size },
      h("svg:circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "#EEF1F4", "stroke-width": 7 }),
      h("svg:circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: COLORS[band], "stroke-width": 7, "stroke-linecap": "round",
        "stroke-dasharray": `${c * f} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` })),
    h("span", { style: `font-size:${Math.round(size / 3.1)}px` }, v ?? "–"));
}
// horizontal gauge with a green target zone and a value marker
function gauge(v, { max = 100, zone = [0, 0], fmt = x => x, band = "na", label } = {}) {
  const p = x => `${Math.max(0, Math.min(100, 100 * x / max))}%`;
  return h("div", { class: "gauge", title: label },
    h("div", { class: "g-track" }, h("div", { class: "g-zone", style: `left:${p(zone[0])};width:calc(${p(zone[1])} - ${p(zone[0])})` }),
      v != null ? h("div", { class: `g-fill ${band}`, style: `width:${p(v)}` }) : null),
    h("div", { class: "g-val" }, v == null ? "–" : fmt(v)));
}
const talkGauge = v => gauge(v, { zone: [0, L().talk_pct.good_max], fmt: x => `${x}%`, band: talkBand(v), label: `Counsellor talk share. Target ≤ ${L().talk_pct.good_max}%` });
const monoGauge = v => gauge(v, { max: 180, zone: [0, L().monologue_sec.good_max], fmt: mmss, band: monoBand(v), label: `Longest monologue. Target ≤ ${mmss(L().monologue_sec.good_max)}` });
const openGauge = v => gauge(v, { max: 10, zone: [L().open_questions_min, 10], fmt: x => x, band: openBand(v), label: `Open questions per call. Target ${L().open_questions_min}+` });
function metricRow(icon, label, g, hint) { return h("div", { class: "metric" }, h("div", { class: "m-l" }, h("span", { class: "m-i" }, icon), label, hint ? h("span", { class: "hint", title: hint }, "?") : null), g); }
function stackBar(parts, total) {   // parts: [[label, value, color]]
  return h("div", {}, h("div", { class: "stack" }, parts.filter(p => p[1]).map(([l, v, col]) => h("span", { style: `flex:${v};background:${col}`, title: `${l}: ${v}` }, 100 * v / total >= 9 ? v : ""))),
    h("div", { class: "legend" }, parts.filter(p => p[1]).map(([l, v, col]) => h("span", {}, h("i", { style: `background:${col}` }), `${l} ${v}`))));
}
function hbar(label, value, max, { href, color = "var(--navy)", fmt = x => x } = {}) {
  return h("div", { class: "bar-row" }, href ? h("a", { class: "lbl", href }, label) : h("span", { class: "lbl", title: label }, label),
    h("div", { class: "track" }, h("div", { class: "fill", style: `width:${max ? 100 * value / max : 0}%;background:${color}` })), h("span", { class: "val" }, fmt(value)));
}
const card = (title, ...kids) => h("section", { class: "card" }, title ? h("h2", {}, title) : null, ...kids);
const pill = (txt, cls) => h("span", { class: `pill ${cls}` }, txt);
const avatar = (id, lg) => h("div", { class: `avatar${lg ? " lg" : ""}` }, initials(repName(id)));

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
        cols.map(c => h("td", { class: c.cls || "" }, c.cell(r))))) : h("tr", {}, h("td", { colspan: cols.length, class: "empty" }, "No calls match.")))));
  };
  draw(); return wrap;
}
const callCols = (o = {}) => [
  { key: "when", label: "When", sort: c => c.when, desc: true, cell: c => h("span", { class: "num" }, fmtWhen(c.when)) },
  o.noRep ? null : { key: "rep", label: "Counsellor", sort: c => repName(c.rep), cell: c => first(c.rep) },
  { key: "outcome", label: "Outcome", sort: c => c.outcome, cell: c => h("span", { class: "out" }, h("i", { style: `background:${OUT_COLORS[c.outcome] || "#ccc"}` }), c.outcome) },
  { key: "dur", label: "Length", cls: "r hide-sm", sort: c => c.dur, cell: c => h("span", { class: "num" }, mmss(c.dur)) },
  { key: "talk", label: "Talk", cls: "r", sort: c => c.metrics?.counsellor_talk_pct, cell: c => c.metrics ? pill(`${c.metrics.counsellor_talk_pct}%`, talkBand(c.metrics.counsellor_talk_pct)) : "–" },
  { key: "flags", label: "⚑", cls: "c hide-sm", sort: c => c.flags.length, desc: true, cell: c => c.flags.length ? h("span", { class: "flagn", title: c.flags.map(f => D.flags[f.type]).join(", ") }, c.flags.length) : "" },
  { key: "score", label: "Score", cls: "r", sort: c => c.score, cell: c => h("span", { class: `score ${scoreBand(c.score)}` }, c.score ?? "–") },
].filter(Boolean);

/* ---------- screens ---------- */
function repCard(id) {
  const s = AGG.reps[id];
  return h("a", { class: "card rep-card", href: `#/counsellor/${id}` },
    h("div", { class: "rc-top" }, avatar(id), h("div", { class: "rc-name" }, h("b", {}, repName(id)), h("span", { class: "muted small" }, `${s.n} calls audited`)), ring(s.score, 58)),
    h("div", { class: "metrics" },
      metricRow("🗣", "Talk share", talkGauge(s.talk), "Share of speaking time taken by the counsellor. Lower is better: the parent should talk."),
      metricRow("❓", "Open questions", openGauge(s.openq), "Average open questions (what / how / why / tell me) per call of 2+ minutes."),
      metricRow("📅", "Visits booked", gauge(s.visit, { zone: [50, 100], fmt: x => `${x}%`, band: band3(s.visit, 50, 30) }), "Share of genuine leads that ended with a campus visit booked.")));
}

function viewDashboard() {
  const t = AGG.team, ids = Object.keys(D.counsellors);
  const days = {}; D.calls.filter(counts).forEach(c => (days[c.when.slice(0, 10)] ||= []).push(c.score));
  const dayKeys = Object.keys(days).sort().slice(-14);
  const topFlags = Object.entries(t.flags).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const heatCell = v => h("td", { class: `heat ${band3(v, 75, 55)}` }, v ?? "–");
  return [
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Dashboard"), h("p", { class: "muted" }, `${t.n} calls audited · ${t.real} admission conversations · ${fmtDate(t.from)} – ${fmtDate(t.to)}`))),
    h("div", { class: "kpis" },
      h("div", { class: "kpi kpi-ring" }, ring(t.score, 62), h("div", {}, h("div", { class: "l" }, "Avg quality score"), h("div", { class: "s" }, `Good = ${D.bands.good}+`))),
      h("div", { class: "kpi" }, h("div", { class: "v" }, t.visit != null ? `${t.visit}%` : "–"), h("div", { class: "l" }, "Visits booked"), h("div", { class: "s" }, `${t.visits} visits`)),
      h("div", { class: "kpi" }, h("div", { class: "l", style: "margin-bottom:8px" }, "🗣 Counsellor talk share"), talkGauge(t.talk)),
      h("div", { class: "kpi" }, h("div", { class: "l", style: "margin-bottom:8px" }, "❓ Open questions / call"), openGauge(t.openq))),
    h("div", { class: "rep-cards" }, ids.map(repCard)),
    h("div", { class: "grid g-2 section" },
      card("Rubric heatmap", h("p", { class: "card-note" }, "% of full marks. Green ≥ 75 · amber 55–74 · red < 55"),
        h("div", { class: "table-wrap" }, h("table", { class: "heatmap" },
          h("thead", {}, h("tr", {}, h("th", {}, ""), ids.map(id => h("th", { class: "c" }, h("a", { href: `#/counsellor/${id}` }, first(id)))), h("th", { class: "c" }, "Team"))),
          h("tbody", {}, D.criteria.map(k => h("tr", {}, h("td", { title: k.look_for }, k.name), ids.map(id => heatCell(AGG.reps[id].crit[k.id])), heatCell(t.crit[k.id]))))))),
      card("Quality score by day", h("div", { class: "cols" }, dayKeys.map(d => { const v = round(avg(days[d])); return h("div", { class: "col", title: `${fmtDate(d)}: ${v} (${days[d].length} calls)` }, h("span", { class: "v" }, v), h("div", { class: "b", style: `height:${v}%;background:${COLORS[scoreBand(v)]}` })); })),
        h("div", { class: "col-labels" }, dayKeys.map(d => h("span", {}, fmtDate(d)))))),
    h("div", { class: "grid g-2 section" },
      card("Outcomes", stackBar(D.outcomes.map(o => [o, t.outcomes[o] || 0, OUT_COLORS[o]]), t.n)),
      card("Top red flags", topFlags.length ? h("div", { class: "bars" }, topFlags.map(([k, v]) => hbar(D.flags[k], v, topFlags[0][1], { href: `#/calls?flag=${k}`, color: "var(--poor)" }))) : h("p", { class: "muted" }, "None"))),
  ];
}

function viewCalls(q) {
  const f = { q: q.get("q") || "", rep: q.get("rep") || "", outcome: q.get("outcome") || "", flag: q.get("flag") || "", band: q.get("band") || "" };
  const setQ = () => { const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); history.replaceState(null, "", `#/calls${p.toString() ? "?" + p : ""}`); draw(); };
  const sel = (key, label, opts) => h("select", { onchange: e => { f[key] = e.target.value; setQ(); }, "aria-label": label },
    h("option", { value: "" }, label), opts.map(([v, t]) => { const o = h("option", { value: v }, t); if (f[key] === v) o.selected = true; return o; }));
  const host = h("div", {});
  const draw = () => {
    const needle = f.q.toLowerCase();
    const rows = D.calls.filter(c => (!f.rep || c.rep === f.rep) && (!f.outcome || c.outcome === f.outcome) && (!f.flag || c.flags.some(x => x.type === f.flag))
      && (!f.band || scoreBand(c.score) === f.band) && (!needle || [c.summary, c.coaching, JSON.stringify(c.lead || {})].join(" ").toLowerCase().includes(needle)));
    host.replaceChildren(h("p", { class: "muted small" }, `${rows.length} of ${D.calls.length} calls`),
      h("section", { class: "card flush" }, sortableTable(callCols(), rows, { initial: ["when", -1], rowHref: c => `#/call/${c.id}` })));
  };
  draw();
  return [
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Calls")), exportButton()),
    h("div", { class: "filters" }, h("input", { type: "search", placeholder: "Search…", value: f.q, oninput: e => { f.q = e.target.value; setQ(); } }),
      sel("rep", "All counsellors", Object.values(D.counsellors).map(r => [r.id, r.name])),
      sel("outcome", "All outcomes", D.outcomes.map(o => [o, o])),
      sel("band", "All scores", [["good", `Good (${D.bands.good}+)`], ["watch", "Average"], ["poor", `Low (< ${D.bands.needs_work})`]]),
      f.flag ? h("button", { class: "btn btn-outline", onclick: () => { f.flag = ""; setQ(); location.reload(); } }, `⚑ ${D.flags[f.flag]} ✕`) : null),
    host,
  ];
}

function viewCall(id) {
  const c = D.calls.find(x => x.id === id); if (!c) return notFound();
  const m = c.metrics, total = Math.max(c.dur, ...(c.segs.map(s => s[0] + 1)), 1);
  const audio = h("audio", { controls: true, preload: "metadata" }), head = h("div", { class: "head", style: "left:0" });
  const status = h("div", { class: "muted small" }, c.audio ? "Loading recording…" : "No recording.");
  const seek = t => { if (t == null) return; audio.currentTime = t; audio.play().catch(() => {}); };
  const ts = t => { const s = parseTs(t); return s == null ? null : h("button", { class: "ts", onclick: e => { e.stopPropagation(); seek(s); }, title: "Play from here" }, `▶ ${t}`); };
  if (c.audio) AUDIO_URL(c).then(u => { audio.src = u; status.remove(); }, () => { status.textContent = "Couldn't load the recording."; });
  const tl = h("div", { class: "timeline", title: "Who spoke when. Click to jump.", onclick: e => { const r = e.currentTarget.getBoundingClientRect(); seek(total * (e.clientX - r.left) / r.width); } },
    (m?.timeline || []).map(([s, e, l]) => h("span", { class: l, style: `left:${100 * s / total}%;width:${Math.max(.3, 100 * (e - s) / total)}%` })), head);
  const lines = c.segs.map(([s, l, txt]) => h("div", { class: "line", "data-t": s }, h("button", { class: "ts", onclick: () => seek(s) }, mmss(s)),
    h("span", { class: `who ${l}` }, { C: "Counsellor", P: "Parent", M: "Both" }[l] || ""), h("span", { class: "txt" }, txt)));
  const tx = h("div", { class: "transcript" }, lines);
  audio.ontimeupdate = () => {
    head.style.left = `${100 * audio.currentTime / total}%`;
    let cur = null; for (const ln of lines) { if (+ln.dataset.t <= audio.currentTime + .2) cur = ln; else break; }
    lines.forEach(ln => ln.classList.toggle("now", ln === cur));
    if (cur && txBox.open) { const top = cur.offsetTop - tx.offsetTop - 100; if (Math.abs(tx.scrollTop - top) > 60) tx.scrollTop = top; }
  };
  const detail = h("div", { class: "crit-detail", hidden: true });
  const tiles = D.criteria.map(k => { const r = c.ratings[k.id] || {}; const [lbl, cls] = RATING[r.r ?? null];
    return h("button", { class: `tile ${cls}`, title: r.note || "", onclick: e => {
      const on = e.currentTarget.classList.toggle("open"); tilesBox.querySelectorAll(".tile").forEach(x => x !== e.currentTarget && x.classList.remove("open"));
      detail.hidden = !on; detail.replaceChildren(h("b", {}, k.name, " — ", lbl), h("p", {}, r.note || ""), ...(r.ev || []).map(x => h("div", { class: "ev" }, ts(x.t), " “", x.quote, "”")));
    } }, h("span", { class: "t-name" }, k.name), h("span", { class: "t-val" }, lbl)); });
  const tilesBox = h("div", { class: "tiles" }, tiles);
  const txBox = h("details", { class: "card" }, h("summary", {}, h("b", {}, "Transcript"), h("span", { class: "muted small" }, ` · ${c.segs.length} lines`)), tx);
  const lead = Object.entries(c.lead || {}).filter(([, v]) => v);
  return [
    h("div", { class: "crumb" }, h("a", { href: "#/calls" }, "Calls"), " / ", h("a", { href: `#/counsellor/${c.rep}` }, repName(c.rep))),
    h("div", { class: "call-head" },
      h("div", { class: "who-line" }, avatar(c.rep), h("div", {}, h("h1", {}, repName(c.rep)),
        h("div", { class: "meta-row" }, h("span", { class: "out" }, h("i", { style: `background:${OUT_COLORS[c.outcome]}` }), h("b", {}, c.outcome)), h("span", {}, fmtWhen(c.when)), h("span", {}, mmss(c.dur)), h("span", {}, c.type)))),
      ring(c.score, 72)),
    h("div", { class: "player" }, status, audio, tl,
      h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--c)" }), "Counsellor"), h("span", {}, h("i", { style: "background:var(--p)" }), "Parent"), h("span", {}, h("i", { style: "background:var(--m)" }), "Both"))),
    h("div", { class: "grid g-side" },
      h("div", { class: "grid", style: "align-content:start" },
        card(null, h("p", { class: "lead-line" }, c.summary), c.coaching ? h("div", { class: "coach" }, h("b", {}, "💡 Coach: "), c.coaching) : null),
        card("Rubric", h("p", { class: "card-note" }, "Tap a tile for the reason and the moment in the call."), tilesBox, detail),
        txBox),
      h("div", { class: "grid", style: "align-content:start" },
        card("Listening", m ? [
          h("div", { class: "talk-split" }, h("div", { style: `width:${m.counsellor_talk_pct}%;background:var(--c)` }, `${m.counsellor_talk_pct}%`), h("div", { style: `width:${100 - m.counsellor_talk_pct}%;background:var(--p)` }, `${100 - m.counsellor_talk_pct}%`)),
          h("div", { class: "legend", style: "margin:6px 0 12px" }, h("span", {}, h("i", { style: "background:var(--c)" }), "Counsellor"), h("span", {}, h("i", { style: "background:var(--p)" }), "Parent")),
          h("div", { class: "metrics" }, metricRow("🗣", "Talk share", talkGauge(m.counsellor_talk_pct)), metricRow("⏱", "Longest monologue", monoGauge(m.longest_monologue_sec)),
            metricRow("❓", "Open questions", openGauge(m.open_questions))),
          h("p", { class: "faint small", style: "margin:10px 0 0" }, m.source === "channels" ? "Measured from separate audio channels." : "Estimated from the transcript.")] : h("p", { class: "muted" }, "Not available.")),
        c.flags.length ? card("Red flags", h("div", { class: "flag-list" }, c.flags.map(f => h("div", { class: "flag", title: f.detail }, h("span", {}, "⚑ ", D.flags[f.type] || f.type), ts(f.t))))) : null,
        h("details", { class: "card" }, h("summary", {}, h("b", {}, "CRM & lead details")),
          h("dl", { class: "kv", style: "margin-top:12px" }, h("dt", {}, "CRM outcome"), h("dd", {}, c.crm_outcome || pill("Not logged", "poor")),
            c.crm_suggest ? [h("dt", {}, "Should be"), h("dd", {}, c.crm_suggest)] : null, c.intent ? [h("dt", {}, "Intent"), h("dd", {}, c.intent)] : null,
            c.lead_id ? [h("dt", {}, "Lead"), h("dd", {}, h("a", { href: `https://gemseducation.m.frappe.cloud/crm/leads/${c.lead_id}`, target: "_blank", rel: "noopener" }, c.lead_id))] : null,
            lead.map(([k, v]) => [h("dt", {}, k.replace(/_/g, " ")), h("dd", {}, v)]))),
        reviewCard(c))),
  ];
}

function viewCounsellors() {
  return [h("div", { class: "page-head" }, h("h1", {}, "Counsellors")), h("div", { class: "rep-cards" }, Object.keys(D.counsellors).map(repCard))];
}

function viewCounsellor(id) {
  const s = AGG.reps[id]; if (!s) return notFound();
  const t = AGG.team, p = D.counsellors[id]?.persona, fn = D.counsellors[id]?.funnel, withM = s.calls.filter(c => c.metrics);
  const chips = (arr, cls) => h("div", { class: "chips" }, (arr || []).map(x => h("span", { class: `chip ${cls}`, title: x.detail || "" }, x.title)));
  const dots = (get, max, zone, fmt, bandFn) => h("div", {}, h("div", { class: "dots" }, zone ? h("div", { class: "zone", style: `left:${100 * zone[0] / max}%;width:${100 * (zone[1] - zone[0]) / max}%` }) : null,
    withM.map(c => { const v = get(c); return h("a", { href: `#/call/${c.id}`, class: bandFn(v), title: `${fmtWhen(c.when)} · ${fmt(v)}`, style: `left:${Math.min(100, 100 * Math.min(v, max) / max)}%` }); })),
    h("div", { class: "scale" }, h("span", {}, fmt(0)), h("span", {}, `${fmt(max)}+`)));
  const funnel = fn ? [["Calls logged", fn.logged], ["Connected", fn.recorded], ["Audited (30s+)", fn.audited], ["Visits booked", s.visits]] : [];
  return [
    h("div", { class: "crumb" }, h("a", { href: "#/counsellors" }, "Counsellors")),
    h("div", { class: "page-head" }, h("div", { class: "who-line" }, avatar(id, true), h("div", {}, h("h1", {}, repName(id)), h("p", { class: "muted" }, `${s.n} calls audited · ${fmtDate(s.from)} – ${fmtDate(s.to)}`))), ring(s.score, 76)),
    p?.headline ? h("p", { class: "headline" }, p.headline) : null,
    h("div", { class: "grid g-3" },
      card("👍 Good at", chips(p?.strengths, "plus")), card("🎯 Work on", chips(p?.development, "minus")),
      card("💡 Coaching focus", p?.coaching_plan?.length ? h("ol", { class: "list" }, p.coaching_plan.slice(0, 3).map(x => h("li", {}, x))) : h("p", { class: "muted" }, "—"))),
    h("div", { class: "grid g-2 section" },
      card("Listening", h("div", { class: "metrics" }, metricRow("🗣", "Talk share", talkGauge(s.talk), "Average share of speaking time taken by the counsellor."),
          metricRow("⏱", "Longest monologue", monoGauge(s.mono), "Average of each call's longest uninterrupted stretch."), metricRow("❓", "Open questions", openGauge(s.openq), "Average per call of 2+ minutes.")),
        withM.length ? [h("h3", {}, "Talk share, call by call"), dots(c => c.metrics.counsellor_talk_pct, 100, [0, L().talk_pct.good_max], v => `${v}%`, talkBand)] : null),
      card("Rubric vs team", h("p", { class: "card-note" }, "Bar = " + first(id) + " · gold line = team"),
        h("div", { class: "bars" }, D.criteria.map(k => { const v = s.crit[k.id], tv = t.crit[k.id];
          return h("div", { class: "bar-row", title: k.look_for }, h("span", { class: "lbl" }, k.name),
            h("div", { class: "track" }, h("div", { class: "fill", style: `width:${v ?? 0}%;background:${COLORS[band3(v, 75, 55)]}` }), tv != null ? h("div", { class: "marker", style: `left:calc(${tv}% - 1px)` }) : null),
            h("span", { class: "val" }, v == null ? "–" : `${v}%`)); })))),
    h("div", { class: "grid g-2 section" },
      card("Call funnel", h("div", { class: "funnel" }, funnel.map(([l, v], i) => h("div", { class: "f-row" }, h("span", { class: "lbl" }, l),
        h("div", { class: "f-bar", style: `width:${Math.max(4, 100 * v / (funnel[0][1] || 1))}%;background:${["#041E42", "#0B4F8A", "#00A3E0", "#1E7B4F"][i]}` }, v))))),
      card("Outcomes", stackBar(D.outcomes.map(o => [o, s.outcomes[o] || 0, OUT_COLORS[o]]), s.n))),
    h("div", { class: "section" }, h("section", { class: "card flush" }, h("h2", {}, "Calls"), sortableTable(callCols({ noRep: true }), s.calls, { initial: ["when", -1], rowHref: c => `#/call/${c.id}` }))),
  ];
}

const notFound = () => [h("h1", {}, "Not found"), h("p", {}, h("a", { href: "#/" }, "Back to the dashboard"))];

/* ---------- reviews (kept in this browser, exported as JSON → ingest_reviews.py) ---------- */
const REV_KEY = () => "callaudit.reviews." + D.rubric;
function exportButton() {
  const n = Object.keys(store.get(REV_KEY(), {})).length;
  return n ? h("button", { class: "btn btn-outline", onclick: () => {
    const rs = Object.values(store.get(REV_KEY(), {}));
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), rubric: D.rubric, reviews: rs }, null, 1)], { type: "application/json" })), download: `call-reviews-${D.rubric}-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  } }, `Export ${n} review${n === 1 ? "" : "s"}`) : null;
}
function reviewCard(c) {
  const saved = store.get(REV_KEY(), {})[c.id], base = saved || c.gold || { ratings: Object.fromEntries(D.criteria.map(k => [k.id, c.ratings[k.id]?.r ?? null])), outcome: c.outcome, flags: c.flags.map(f => f.type), comment: "" };
  const sel = {}; const rows = D.criteria.map(k => { const s = h("select", {}, [2, 1, 0, null].map(v => { const o = h("option", { value: String(v) }, RATING[v][0]); if ((base.ratings[k.id] ?? null) === v) o.selected = true; return o; })); sel[k.id] = s; return h("tr", {}, h("td", {}, k.name), h("td", {}, s)); });
  const out = h("select", {}, D.outcomes.map(o => { const e = h("option", { value: o }, o); if (o === base.outcome) e.selected = true; return e; }));
  const fl = h("div", { class: "flagbox" }, Object.entries(D.flags).map(([k, n]) => { const i = h("input", { type: "checkbox", value: k }); i.checked = base.flags.includes(k); return h("label", {}, i, " ", n); }));
  const who = h("input", { type: "text", placeholder: "Your name", value: store.get("callaudit.reviewer", "") });
  const cm = h("textarea", { placeholder: "What did the audit get wrong?" }); cm.value = base.comment || "";
  const msg = h("span", { class: "muted small" });
  return h("details", { class: "card review" }, h("summary", {}, h("b", {}, saved ? "✓ Your review" : "✎ Correct this audit")),
    h("table", { style: "margin-top:10px" }, rows, h("tr", {}, h("td", {}, "Outcome"), h("td", {}, out))), h("h3", {}, "Red flags"), fl, h("h3", {}, "Comment"), cm,
    h("div", { style: "display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap" }, who, h("button", { class: "btn btn-primary", onclick: () => {
      if (!who.value.trim()) { msg.textContent = "Add your name first."; who.focus(); return; }
      store.set("callaudit.reviewer", who.value.trim());
      const all = store.get(REV_KEY(), {});
      all[c.id] = { call: c.id, rubric: D.rubric, reviewer: who.value.trim(), at: new Date().toISOString(), outcome: out.value, comment: cm.value.trim(),
        ratings: Object.fromEntries(D.criteria.map(k => [k.id, sel[k.id].value === "null" ? null : +sel[k.id].value])), flags: [...fl.querySelectorAll("input:checked")].map(i => i.value) };
      msg.textContent = store.set(REV_KEY(), all) ? "Saved. Export it from the Calls page." : "Couldn't save (browser storage is blocked).";
    } }, "Save"), msg));
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
  view.replaceChildren(...[nodes].flat().filter(Boolean)); window.scrollTo(0, 0);
  document.title = `${parts[0] === "counsellor" ? repName(parts[1]) : parts[0] === "call" ? "Call" : { dashboard: "Dashboard", calls: "Calls", counsellors: "Counsellors" }[nav] || "Not found"} · GEMS Call Audit`;
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
