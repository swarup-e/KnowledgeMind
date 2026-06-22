"use strict";

const $ = (sel) => document.querySelector(sel);
const TITLES = { dashboard: "Dashboard", graph: "Knowledge Graph", assistant: "Assistant" };

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const dt = (ts) => new Date(ts * 1000);
const fmtTime = (ts) => dt(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ts) => dt(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

function typeBadge(t) {
  const k = (t || "").toLowerCase();
  const cls = k === "hard" ? "badge-hard" : k === "soft" ? "badge-soft" : "badge-tentative";
  return `<span class="badge ${cls}">${esc(t)}</span>`;
}
const srcBadge = (s) => `<span class="badge badge-src">${esc(s)}</span>`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ---- views -------------------------------------------------------------- */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  $("#page-title").textContent = TITLES[name];
  if (name === "dashboard") loadDashboard();
  if (name === "graph") loadGraph();
}

async function loadStatus() {
  try {
    const s = await getJSON("/api/status");
    const chip = $("#mode-chip");
    if (s.assistant_mode === "live") { chip.textContent = "● Live"; chip.className = "chip chip-live"; }
    else { chip.textContent = "Demo mode"; chip.className = "chip chip-demo"; }
  } catch { $("#mode-chip").textContent = "offline"; }
}

/* ---- dashboard ---------------------------------------------------------- */
async function loadDashboard() {
  let commitments = [], conflicts = [], real = 0, dup = 0;
  try {
    const [c1, c2] = await Promise.all([getJSON("/api/commitments"), getJSON("/api/conflicts")]);
    commitments = c1.commitments || [];
    conflicts = c2.conflicts || []; real = c2.real_count; dup = c2.duplicate_count;
  } catch (e) { toast("Could not load data"); }

  const sources = new Set(commitments.map((c) => c.source));
  $("#kpis").innerHTML = [
    kpi(commitments.length, "Commitments tracked"),
    kpi(real, "Active conflicts", real > 0),
    kpi(dup, "Same-event duplicates"),
    kpi(sources.size, "Channels"),
  ].join("");

  // conflicts
  const cf = $("#conflicts");
  if (!conflicts.length) {
    cf.innerHTML = emptyState("✅", "No conflicts detected", "Your schedule is clear across all channels.");
  } else {
    cf.innerHTML = conflicts.map(conflictCard).join("");
  }

  // timeline grouped by day
  const tl = $("#timeline");
  if (!commitments.length) {
    tl.innerHTML = emptyState("🗓️", "No commitments yet", "Run a scan to ingest your channels.");
  } else {
    let html = "", lastDay = "";
    for (const c of commitments) {
      const day = fmtDay(c.start_ts);
      if (day !== lastDay) { html += `<div class="day-label">${day}</div>`; lastDay = day; }
      const who = c.who && c.who !== "(self)" ? `· with ${esc(c.who)}` : "";
      html += `<div class="tl">
        <div class="time">${fmtTime(c.start_ts)}</div>
        <div class="body">
          <div class="t">${esc(c.description)}</div>
          <div class="m">${srcBadge(c.source)} ${typeBadge(c.commitment_type)} <span>${who}</span></div>
        </div></div>`;
    }
    tl.innerHTML = html;
  }
}

const kpi = (num, lbl, alert) =>
  `<div class="kpi ${alert ? "alert" : ""}"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
const emptyState = (big, title, sub) =>
  `<div class="empty"><div class="big">${big}</div><strong>${title}</strong><div>${sub}</div></div>`;

function conflictCard(c) {
  const dup = c.same_event;
  const tag = dup ? "Same event" : "Conflict";
  const title = dup ? "Possible duplicate across channels" : "Scheduling conflict";
  return `<div class="card conflict ${dup ? "dup" : ""}">
    <div class="conflict-head">
      <svg viewBox="0 0 24 24" class="icon"><path d="M10.3 3.3l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.7-2.7l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <h3>${title}</h3><span class="tag">${tag}</span>
    </div>
    <div class="vs">
      <div class="leg"><div class="t">${esc(trunc(c.a_desc, 40))}</div>
        <div class="m">${srcBadge(c.a_src)} <span>${fmtTime(c.a_start)}</span></div></div>
      <div class="x">overlaps</div>
      <div class="leg"><div class="t">${esc(trunc(c.b_desc, 40))}</div>
        <div class="m">${srcBadge(c.b_src)} <span>${fmtTime(c.b_start)}</span></div></div>
    </div>
    <div class="m" style="margin-top:11px;color:var(--text-muted);font-size:12.5px">
      ${Math.round(c.overlap_minutes)} min overlap${dup ? " · likely the same real event (entity de-dup is future work)" : ""}
    </div>
  </div>`;
}

async function runScan() {
  const btn = $("#scan-btn"); btn.disabled = true;
  try {
    const r = await postJSON("/api/scan");
    toast(`Scan complete · ${r.commitments} commitments · ${r.conflicts} conflict(s)`);
    const active = document.querySelector(".nav-item.active").dataset.view;
    if (active === "dashboard") loadDashboard();
    if (active === "graph") loadGraph();
  } catch { toast("Scan failed"); }
  btn.disabled = false;
}

/* ---- knowledge graph (bipartite SVG) ------------------------------------ */
async function loadGraph() {
  let commitments = [], conflicts = [];
  try {
    const [c1, c2] = await Promise.all([getJSON("/api/commitments"), getJSON("/api/conflicts")]);
    commitments = c1.commitments || []; conflicts = c2.conflicts || [];
  } catch { $("#graph").innerHTML = emptyState("⚠️", "Could not load graph", ""); return; }
  if (!commitments.length) { $("#graph").innerHTML = emptyState("🕸️", "Graph is empty", "Run a scan first."); return; }
  $("#graph").innerHTML = buildGraphSVG(commitments, conflicts);
}

function buildGraphSVG(commitments, conflicts) {
  const whoOf = (c) => (c.who && c.who !== "(self)") ? c.who : "You";
  const persons = [];
  for (const c of commitments) { const w = whoOf(c); if (!persons.includes(w)) persons.push(w); }
  persons.sort((a, b) => (a === "You" ? -1 : b === "You" ? 1 : a.localeCompare(b)));

  const topPad = 34, gap = 70, leftX = 90, cardX = 430, cardW = 300, cardH = 46;
  const rows = commitments.length;
  const H = topPad * 2 + (rows - 1) * gap + cardH;
  const W = cardX + cardW + 100;
  const commY = (j) => topPad + j * gap;
  const span = rows <= 1 ? 0 : (rows - 1) * gap;
  const personY = (i) => topPad + cardH / 2 + (persons.length <= 1 ? span / 2 : (i * span) / (persons.length - 1));

  const idx = new Map();
  commitments.forEach((c, j) => idx.set(c.description + "@" + c.start_ts, j));

  let edges = "", nodes = "", conflictEdges = "";

  // person→commitment edges
  commitments.forEach((c, j) => {
    const pi = persons.indexOf(whoOf(c));
    const x1 = leftX + 22, y1 = personY(pi), x2 = cardX, y2 = commY(j) + cardH / 2;
    const mx = (x1 + x2) / 2;
    edges += `<path class="gedge" d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
  });

  // conflict edges (right side bulge)
  conflicts.forEach((cf) => {
    const ja = idx.get(cf.a_desc + "@" + cf.a_start), jb = idx.get(cf.b_desc + "@" + cf.b_start);
    if (ja === undefined || jb === undefined) return;
    const x = cardX + cardW, ya = commY(ja) + cardH / 2, yb = commY(jb) + cardH / 2;
    const bulge = x + 56 + Math.abs(ya - yb) * 0.12;
    const stroke = cf.same_event ? "var(--warn)" : "var(--danger)";
    conflictEdges += `<path class="gconflict" style="stroke:${stroke}" d="M${x} ${ya} C ${bulge} ${ya}, ${bulge} ${yb}, ${x} ${yb}"/>`;
    conflictEdges += `<text class="gconflict-label" style="fill:${stroke}" x="${bulge - 6}" y="${(ya + yb) / 2}">${Math.round(cf.overlap_minutes)}m</text>`;
  });

  // person nodes
  persons.forEach((p, i) => {
    const y = personY(i), init = p === "You" ? "★" : p.slice(0, 1).toUpperCase();
    nodes += `<g>
      <circle class="gperson" cx="${leftX}" cy="${y}" r="20"/>
      <text class="gperson-init" x="${leftX}" y="${y + 4}" text-anchor="middle">${esc(init)}</text>
      <text class="gnode-label" x="${leftX}" y="${y + 36}" text-anchor="middle">${esc(trunc(p, 12))}</text>
    </g>`;
  });

  // commitment cards
  commitments.forEach((c, j) => {
    const y = commY(j), cls = c.source === "calendar" ? "cal" : "chat";
    nodes += `<g>
      <rect class="gcard ${cls}" x="${cardX}" y="${y}" width="${cardW}" height="${cardH}" rx="10"/>
      <text class="gnode-label" x="${cardX + 14}" y="${y + 19}">${esc(trunc(c.description, 34))}</text>
      <text class="gnode-sub" x="${cardX + 14}" y="${y + 36}">${esc(c.source)} · ${esc(c.commitment_type)}</text>
    </g>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet">
    ${edges}${conflictEdges}${nodes}</svg>`;
}

/* ---- assistant ---------------------------------------------------------- */
function addMsg(role, html) {
  const t = $("#chat-thread");
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.innerHTML = html;
  t.appendChild(el); t.scrollTop = t.scrollHeight;
  return el;
}
function routeChips(log) {
  if (!Array.isArray(log) || !log.length) return "";
  const chips = log.map((e) => {
    const label = e.action || e.tool || e.step || e.node || "step";
    const raw = JSON.stringify(e).toUpperCase();
    const cloud = /CLOUD/.test(raw), local = /LOCAL/.test(raw);
    const cls = cloud ? "badge-cloud" : "badge-local";
    const word = cloud ? "CLOUD" : local ? "LOCAL" : "—";
    return `<span class="badge ${cls}">${esc(label)} · ${word}</span>`;
  }).join("");
  return `<div class="route">${chips}</div>`;
}

async function sendChat(e) {
  e.preventDefault();
  const input = $("#chat-input"), msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  addMsg("user", `<div class="bubble">${esc(msg)}</div>`);
  const pending = addMsg("bot", `<div class="bubble">…</div>`);
  try {
    const r = await postJSON("/api/chat", { message: msg, level: $("#chat-level").value });
    const note = r.demo_mode ? `<div class="demo-note">demo response · add a model for live answers</div>` : "";
    pending.innerHTML = `<div class="bubble">${esc(r.answer)}</div>${routeChips(r.routing_log)}${note}`;
  } catch {
    pending.innerHTML = `<div class="bubble">Sorry — the assistant is unavailable.</div>`;
  }
  $("#chat-thread").scrollTop = $("#chat-thread").scrollHeight;
}

/* ---- init --------------------------------------------------------------- */
function init() {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view)));
  $("#scan-btn").addEventListener("click", runScan);
  $("#chat-form").addEventListener("submit", sendChat);
  addMsg("bot", `<div class="bubble">Hi! I'm KnowledgeMind. Ask about your schedule, or try “Do I have any conflicts this week?” Personal-data tasks always run on-device.</div>`);
  loadStatus();
  showView("dashboard");
}
document.addEventListener("DOMContentLoaded", init);
