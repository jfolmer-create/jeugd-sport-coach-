(() => {
const t = (x, v) => (window.I18N ? window.I18N.t(x, v) : x);
"use strict";
// ---------- state ----------
const LS_KEY = "teamplanner.v1";
const DEFAULTS = () => ({
  settings: { club: "", team: "", homeAddress: "", arriveBefore: 45, matchMinutes: 60, blocks: 4, onField: 8,
    formation: "3-2-2", seatsDefault: 3, flagAway: false, washPerMatch: true, keeperFull: true, leaderDriveOne: true },
  players: [], matches: [], updatedAt: 0
});
let S = DEFAULTS();
// mode: loading | local | login | newteam | cloud | shared | error
let mode = "loading", sb = null, user = null, teams = [], teamId = null, saveTimer = null, saving = false, errorText = "";
// opslaan: baseRev = versie van de database waar onze gegevens op voortbouwen; dirty = nog niet verstuurde wijzigingen
let baseRev = null, dirty = false, retryN = 0, retryTimer = null, conflict = null, offline = false, schemaVersion = 0;
const SCHEMA_NEEDED = 2;
const hasRev = () => schemaVersion >= 2;
// beschikbaarheidsronde: wat ouders doorgeven en welke wedstrijden open staan
let avail = [], round = { open: false, matches: [] }, shareToken = null;
const cannotDo = (mid, pid, what) => avail.some(a => a.match === mid && a.player === pid && (a.cannot || []).includes(what));
const ui = { tab: "planning", editMatch: null, editPlayer: null, lineupMatch: null, arm: null, loginSent: false, loginEmail: "" };
try { const t = localStorage.getItem("teamplanner.tab"); if (t) ui.tab = t; } catch (e) {}
const canEdit = () => mode === "local" || mode === "cloud";
const cacheKey = () => mode === "cloud" ? LS_KEY + "." + teamId : LS_KEY;

function normalize(x) {
  const d = DEFAULTS();
  x = x && typeof x === "object" ? x : {};
  return { settings: Object.assign(d.settings, x.settings || {}), players: Array.isArray(x.players) ? x.players : [],
    matches: Array.isArray(x.matches) ? x.matches : [], updatedAt: x.updatedAt || 0 };
}
function readLocal(key) { try { const raw = localStorage.getItem(key); return raw ? normalize(JSON.parse(raw)) : null; } catch (e) { return null; } }
// Niet-verstuurde wijzigingen per team: { base: versie waarop ze voortbouwen }. Zo gaat er offline niets verloren.
const pendKey = id => "teamplanner.pending." + id;
function readPending(id) { try { const r = localStorage.getItem(pendKey(id)); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function writeLS(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} }
function save() {
  if (!canEdit()) return;
  S.updatedAt = Date.now();
  writeLS(cacheKey(), S);
  if (mode !== "cloud") { autoLocalVersion(); return; }
  if (!readPending(teamId)) writeLS(pendKey(teamId), { base: baseRev });
  dirty = true; setSync("Opslaan…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushRemote, 800);
}
const teamName = () => [S.settings.club, S.settings.team].filter(Boolean).join(" ") || "Mijn team";
async function pushRemote() {
  clearTimeout(saveTimer); saveTimer = null;
  if (mode !== "cloud" || !dirty || conflict) return;
  if (saving) { saveTimer = setTimeout(pushRemote, 500); return; }
  saving = true; dirty = false;
  const tid = teamId, name = teamName();
  let res;
  try {
    let q = sb.from("teams").update(hasRev() ? { data: S, name } : { data: S, name, updated_at: new Date().toISOString() }).eq("id", tid);
    if (hasRev() && baseRev != null) q = q.eq("rev", baseRev);
    res = await q.select(hasRev() ? "rev" : "id");
  } catch (e) { res = { error: e }; }
  saving = false;
  if (tid !== teamId) return;
  if (res.error) { dirty = true; return scheduleRetry(); }
  if (!res.data || !res.data.length) { dirty = true; return showConflict(); }
  if (hasRev()) baseRev = res.data[0].rev;
  retryN = 0; offline = false; clearTimeout(retryTimer);
  const t = teams.find(x => x.id === tid); if (t) t.name = name;
  if (dirty) { saveTimer = setTimeout(pushRemote, 800); return; }
  writeLS(pendKey(tid), null); setSync("Opgeslagen");
}
// Geen internet of de database gaf een fout: wijzigingen blijven op dit apparaat en we proberen het later opnieuw.
function scheduleRetry() {
  offline = true; retryN++;
  setSync(navigator.onLine === false ? "Offline: bewaard op dit apparaat" : "Nog niet opgeslagen, probeert opnieuw…");
  clearTimeout(retryTimer); retryTimer = setTimeout(pushRemote, Math.min(60000, 4000 * 2 ** Math.min(retryN, 4)));
}
window.addEventListener("online", () => { if (mode !== "cloud") return; if (dirty) pushRemote(); else if (offline) refreshIfNewer(); });
// Iemand anders (een mede-coach of je andere apparaat) heeft intussen opgeslagen.
async function showConflict() {
  const { data, error } = await sb.from("teams").select("data,rev").eq("id", teamId).single();
  if (error) return scheduleRetry();
  conflict = { remote: normalize(data.data), rev: data.rev };
  setSync("Niet opgeslagen: kies een versie"); render(); window.scrollTo(0, 0);
}
async function resolveConflict(keepMine) {
  if (!conflict) return;
  const c = conflict;
  if (keepMine) { await snapshot("versie van de ander, bij gelijktijdig wijzigen", c.remote); baseRev = c.rev; conflict = null; dirty = true; render(); pushRemote(); }
  else { await snapshot("jouw versie, bij gelijktijdig wijzigen", S); S = c.remote; baseRev = c.rev; conflict = null; dirty = false;
    writeLS(cacheKey(), S); writeLS(pendKey(teamId), null); setSync("Opgeslagen"); render(); }
  toast(keepMine ? "Jouw versie is opgeslagen. De andere staat bij Eerdere versies." : "De andere versie staat nu hier. Die van jou staat bij Eerdere versies.");
}
function conflictCard() {
  if (!conflict) return "";
  return `<div class="card conflict"><h3>Iemand anders heeft ook iets gewijzigd</h3>
    <p class="small">Terwijl jij bezig was, is dit team op een ander apparaat of door een mede-coach opgeslagen. Je wijzigingen zijn nog niet opgeslagen. Kies welke versie je houdt; de andere bewaart de app bij Instellingen → Eerdere versies.</p>
    <div class="row"><button class="btn primary" data-act="conflictmine">Mijn versie houden</button><button class="btn" data-act="conflicttheirs">Hun versie gebruiken</button></div></div>`;
}
async function refreshIfNewer() {
  if (mode !== "cloud" || saving || dirty || conflict || !teamId) return;
  try {
    if (hasRev()) {
      const { data, error } = await sb.from("teams").select("rev").eq("id", teamId).single();
      if (error) return; offline = false;
      if (data.rev === baseRev) { setSync("Opgeslagen"); return; }
      const r = await sb.from("teams").select("data,rev").eq("id", teamId).single();
      if (r.error || dirty) return;
      S = normalize(r.data.data); baseRev = r.data.rev; writeLS(cacheKey(), S); render(); setSync("Opgeslagen"); toast("Bijgewerkt met de laatste wijzigingen.");
    } else {
      const { data } = await sb.from("teams").select("data").eq("id", teamId).single();
      if (data && data.data && (data.data.updatedAt || 0) > (S.updatedAt || 0)) { S = normalize(data.data); render(); toast("Bijgewerkt met de laatste wijzigingen."); }
    }
  } catch (e) {}
}
// ---------- eerdere versies ----------
// Online bewaart de database zelf elk uur een versie; daarnaast bewaren we er een vóór elke grote stap.
async function snapshot(reason, data) {
  data = data || S;
  if (mode === "cloud") {
    if (!hasRev()) return;
    try { await sb.from("team_versions").insert({ team_id: teamId, data, reason }); } catch (e) {}
    return;
  }
  if (mode !== "local") return;
  let list = []; try { list = JSON.parse(localStorage.getItem("teamplanner.versions") || "[]"); } catch (e) {}
  list.unshift({ at: Date.now(), reason, data }); writeLS("teamplanner.versions", list.slice(0, 15));
}
function autoLocalVersion() {
  let list = []; try { list = JSON.parse(localStorage.getItem("teamplanner.versions") || "[]"); } catch (e) {}
  if (!list.length || Date.now() - list[0].at > 3600e3) snapshot("automatisch");
}
async function loadVersions() {
  ui.versions = { loading: true }; render();
  if (mode === "cloud") {
    const { data, error } = await sb.from("team_versions").select("id,reason,created_at").eq("team_id", teamId).order("created_at", { ascending: false }).limit(40);
    ui.versions = error ? { error: "Versies ophalen lukte niet." } : { list: (data || []).map(v => ({ id: v.id, at: Date.parse(v.created_at), reason: v.reason })) };
  } else {
    let list = []; try { list = JSON.parse(localStorage.getItem("teamplanner.versions") || "[]"); } catch (e) {}
    ui.versions = { list: list.map((v, i) => ({ id: i, at: v.at, reason: v.reason })) };
  }
  render();
}
async function restoreVersion(id) {
  let data = null;
  if (mode === "cloud") { const r = await sb.from("team_versions").select("data").eq("id", id).single(); if (r.error) { toast("Terugzetten lukte niet."); return; } data = r.data.data; }
  else { try { data = JSON.parse(localStorage.getItem("teamplanner.versions") || "[]")[+id].data; } catch (e) {} }
  if (!data) { toast("Die versie is er niet meer."); return; }
  await snapshot("vóór terugzetten");
  S = normalize(data); save(); ui.versions = null; render(); toast("Versie teruggezet. De versie van vlak daarvoor staat ook in de lijst.");
}
function versionsCard() {
  if (mode === "cloud" && !hasRev()) return "";
  const v = ui.versions; const when = at => new Date(at).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<div class="card"><h3>Eerdere versies</h3>
    <p class="small muted">De app bewaart automatisch elk uur een versie, en altijd vlak vóór grote stappen zoals alles wissen, een back-up terugzetten of een nieuw seizoen. Iets per ongeluk kwijt? Zet hier een eerdere versie terug.</p>
    ${!v ? `<div class="row"><button class="btn" data-act="versions">Toon eerdere versies</button></div>`
      : v.loading ? `<p class="small muted">Laden…</p>` : v.error ? `<div class="notice">${esc(v.error)}</div>`
      : v.list.length ? `<div class="stack">${v.list.map(x => `<div class="row between version"><span>${esc(when(x.at))} <span class="muted small">${esc(x.reason || "")}</span></span>
        <button class="btn ${ui.arm === "ver" + x.id ? "arm" : "ghost"}" data-act="restorever" data-id="${x.id}">${ui.arm === "ver" + x.id ? "Zeker? Tik nogmaals" : "Terugzetten"}</button></div>`).join("")}</div>`
      : `<p class="small muted">Nog geen eerdere versies.</p>`}
  </div>`;
}
function setSync(t) { const el = document.getElementById("sync"); if (el) el.textContent = t; }

async function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get("kijk"); shareToken = token;
  // Uitnodiging als mede-coach: bewaren tot na het inloggen (de inloglink komt terug zonder ?uitnodiging=).
  const inv = params.get("uitnodiging");
  if (inv) { writeLS("teamplanner.invite", inv); history.replaceState(null, "", location.pathname); }
  const cfg = window.TEAMPLANNER_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  if (token) {
    if (!sb) { mode = "error"; errorText = "Deze kijklink werkt alleen op de online versie van de planner."; return render(); }
    let data = null, error = null;
    try { ({ data, error } = await sb.rpc("get_shared_team", { token })); } catch (e) { error = e; }
    let row = Array.isArray(data) ? data[0] : data;
    // Offline: laat de laatst bekeken versie zien.
    if (error && !row) { try { row = JSON.parse(localStorage.getItem("teamplanner.shared." + token)); } catch (e) {} if (row) offline = true; }
    else if (row) writeLS("teamplanner.shared." + token, row);
    if (!row) { mode = "error"; errorText = error ? "Geen verbinding. Probeer het opnieuw als je internet hebt." : "Deze kijklink werkt niet (meer). Vraag de coach om een nieuwe link."; return render(); }
    S = normalize(row.data); avail = row.availability || []; round = { open: !!row.avail_open, matches: row.avail_matches || [] }; mode = "shared"; ui.tab = "planning"; render(); setSync(offline ? "Offline: laatst bekeken versie" : "Alleen bekijken");
    return;
  }
  if (!sb) { S = readLocal(LS_KEY) || DEFAULTS(); mode = "local"; render(); setSync("Op dit apparaat"); return; }
  sb.auth.onAuthStateChange((event, session) => {
    const u = session ? session.user : null;
    if (u && (!user || u.id !== user.id)) { user = u; loadTeams(); }
    if (!u && user) { user = null; teams = []; teamId = null; mode = "login"; render(); }
  });
  const { data } = await sb.auth.getSession();
  if (data && data.session) { if (!user) { user = data.session.user; await loadTeams(); } }
  else if (!user) { mode = "login"; render(); }
}
async function checkSchema() {
  try { const { data, error } = await sb.rpc("teamplanner_schema"); if (!error) { schemaVersion = +data || 1; writeLS("teamplanner.schema", String(schemaVersion)); return; }
    if (error && /fetch|network/i.test(error.message || "")) throw error; schemaVersion = 1; }
  catch (e) { schemaVersion = +(localStorage.getItem("teamplanner.schema") || 1); }
}
async function acceptInvite() {
  let tok = null; try { tok = localStorage.getItem("teamplanner.invite"); } catch (e) {}
  if (!tok || !hasRev()) return null;
  writeLS("teamplanner.invite", null);
  const { data, error } = await sb.rpc("accept_invite", { p_token: tok });
  if (error || !data) { toast("Deze uitnodiging werkt niet (meer). Vraag om een nieuwe link."); return null; }
  toast("Je bent nu coach van dit team."); return data;
}
async function loadTeams() {
  await checkSchema();
  const joined = await acceptInvite();
  let data = null, error = null;
  try { ({ data, error } = await sb.from("teams").select(hasRev() ? "id,name,share_token,updated_at,avail_open,avail_matches,owner" : "id,name,share_token,updated_at,avail_open,avail_matches").order("created_at")); } catch (e) { error = e; }
  if (error) {
    // Geen verbinding: werk verder met wat er op dit apparaat staat.
    let cached = null; try { cached = JSON.parse(localStorage.getItem("teamplanner.teams." + user.id)); } catch (e) {}
    if (!cached || !cached.length) { mode = "error"; errorText = "Kan je teams niet laden: " + (error.message || "geen verbinding"); return render(); }
    data = cached; offline = true;
  } else writeLS("teamplanner.teams." + user.id, data || []);
  teams = data || [];
  if (joined && teams.find(t => t.id === joined)) writeLS("teamplanner.team", joined);
  if (!teams.length) { mode = "newteam"; return render(); }
  let pick = null; try { pick = localStorage.getItem("teamplanner.team"); } catch (e) {}
  await loadTeam(teams.find(t => t.id === pick) ? pick : teams[0].id);
}
async function loadTeam(id) {
  if (dirty && mode === "cloud") await pushRemote();
  clearTimeout(retryTimer); conflict = null; ui.people = null; ui.versions = null; ui.invite = null;
  mode = "loading"; render();
  let data = null, error = null;
  try { ({ data, error } = await sb.from("teams").select(hasRev() ? "data,rev" : "data").eq("id", id).single()); } catch (e) { error = e; }
  const cached = readLocal(LS_KEY + "." + id), pend = readPending(id);
  if (error) {
    if (!cached) { mode = "error"; errorText = "Kan dit team niet laden: " + (error.message || "geen verbinding"); return render(); }
    teamId = id; S = cached; mode = "cloud"; offline = true; baseRev = pend ? pend.base : null; dirty = !!pend;
    if (dirty) scheduleRetry();
  } else {
    teamId = id; mode = "cloud"; offline = false;
    if (pend && cached) {
      // Er stonden nog wijzigingen op dit apparaat die nooit zijn aangekomen: nu alsnog versturen (bij een botsing vraagt de app wat je wilt).
      S = cached; baseRev = hasRev() ? pend.base : null; dirty = true; setTimeout(pushRemote, 50);
    } else { S = normalize(data.data); baseRev = hasRev() ? data.rev : null; dirty = false; writeLS(LS_KEY + "." + id, S); }
  }
  const t = teams.find(x => x.id === id) || {}; round = { open: !!t.avail_open, matches: t.avail_matches || [] };
  if (!offline) await loadAvail();
  try { localStorage.setItem("teamplanner.team", id); } catch (e) {}
  ui.editMatch = ui.editPlayer = ui.lineupMatch = null; ui.live = null;
  render(); setSync(offline ? "Offline: bewaard op dit apparaat" : dirty ? "Opslaan…" : "Opgeslagen");
}
async function loadAvail() {
  if (mode !== "cloud") return;
  const { data } = await sb.from("availability").select("player_id,match_id,cannot").eq("team_id", teamId);
  avail = (data || []).map(a => ({ player: a.player_id, match: a.match_id, cannot: a.cannot || [] }));
}
async function setRound(open, matches) {
  const { error } = await sb.from("teams").update({ avail_open: open, avail_matches: matches }).eq("id", teamId);
  if (error) { toast("Dat lukte niet: " + error.message); return false; }
  round = { open, matches }; const t = teams.find(x => x.id === teamId); if (t) { t.avail_open = open; t.avail_matches = matches; }
  return true;
}
async function closeRound() {
  await loadAvail(); await snapshot("vóór sluiten beschikbaarheidsronde");
  if (!await setRound(false, round.matches)) return;
  const ids = round.matches;
  S.matches.filter(m => ids.includes(m.id)).forEach(m => {
    const abs = families().filter(p => cannotDo(m.id, p.id, "absent")).map(p => p.id);
    m.absent = [...new Set([...(m.absent || []), ...abs])];
    if (m.duties) Object.keys(m.duties).forEach(k => m.duties[k] = (m.duties[k] || []).filter(pid => !m.absent.includes(pid) && !cannotDo(m.id, pid, k)));
  });
  planDuties();
  S.matches.filter(m => ids.includes(m.id)).forEach(m => m.locked = true);
  const gaps = S.matches.filter(m => ids.includes(m.id) && dutyIssues(m).length).length;
  save(); render(); toast("Ronde gesloten en taken ingedeeld." + (gaps ? " Let op: bij " + gaps + " wedstrijd(en) ontbreekt nog iemand, zie de meldingen." : ""));
}
function roundText() {
  const ms = sorted().filter(m => round.matches.includes(m.id));
  return "Hoi allemaal! Het programma voor de komende periode is bekend (" + ms.length + " wedstrijden" + (ms.length ? ", " + fmtDate(ms[0].date) + " t/m " + fmtDate(ms[ms.length - 1].date) : "") + ").\n" +
    "Geef via deze link door wanneer je kind er niet is, of wanneer jij als ouder er niet bent:\n" + shareUrl() + "\n" +
    "Daarna maak ik het taakschema. Kun je dan niet op je beurt, ruil dan zelf met een andere ouder.";
}
function roundCard() {
  if (mode !== "cloud") return "";
  const up = sorted().filter(m => m.date >= todayStr() && !m.cancelled);
  if (round.open) {
    const fam = families(); const done = fam.filter(p => avail.some(a => a.player === p.id && round.matches.includes(a.match)));
    const todo = fam.filter(p => !done.includes(p));
    return `<div class="card"><div class="row between"><h3>Beschikbaarheid ouders</h3><span class="pill ok">ronde open</span></div>
      <p class="small">${round.matches.length} wedstrijden. <strong>${done.length} van ${fam.length}</strong> gezinnen hebben gereageerd.${todo.length ? ` <span class="muted">Nog niet: ${todo.map(p => esc(p.name)).join(", ")}.</span>` : ""}</p>
      <div class="row"><button class="btn" data-act="roundcopy">Kopieer bericht voor ouders</button><button class="btn ghost" data-act="roundrefresh">Vernieuwen</button>
      <button class="btn ${ui.arm === "roundclose" ? "arm" : "primary"}" data-act="roundclose">${ui.arm === "roundclose" ? "Zeker? Ouders kunnen daarna niets meer doorgeven" : "Sluiten en taken indelen"}</button></div></div>`;
  }
  return `<div class="card"><h3>Beschikbaarheid ouders</h3>
    <p class="small muted">Nieuw blok wedstrijden bekend? Open een ronde voor alle komende wedstrijden (${up.length}) en stuur de link naar de ouders. Zij geven door wanneer hun kind er niet is. Daarna sluit je de ronde en deelt de planner de taken in. Wedstrijden die al vaststonden, houden hun indeling. Vanaf dan ruilen ouders onderling.</p>
    <div class="row"><button class="btn" data-act="roundopen" ${up.length ? "" : "disabled"}>Ronde openen</button></div></div>`;
}
function parentCard() {
  if (mode !== "shared") return "";
  if (!round.open) return `<div class="notice">${t("Het schema staat vast. Kun je niet op je beurt? Ruil zelf met een andere ouder en laat het de coach weten.")}</div>`;
  const ms = sorted().filter(m => round.matches.includes(m.id));
  const list = S.players.filter(p => !p.guest && !p.inactive).sort((a, b) => a.name.localeCompare(b.name));
  let pid = ui.avChild; if (!pid) { try { pid = localStorage.getItem("teamplanner.child." + shareToken); } catch (e) {} }
  const p = pById(pid);
  const box = (m, what, label) => `<label><input type="checkbox" name="${m.id}" value="${what}" ${p && cannotDo(m.id, p.id, what) ? "checked" : ""}> ${label}</label>`;
  // "ouder is er niet" wordt bewaard als: kan niet rijden, vlaggen en wassen
  const parentBox = m => `<label><input type="checkbox" name="${m.id}" value="parent" ${p && ["drive", "flag", "wash"].every(w => cannotDo(m.id, p.id, w)) ? "checked" : ""}> ${t("Ouder is er niet (geen taak)")}</label>`;
  return `<form class="card" id="availform"><h3>${t("Geef door wie er niet is")}</h3>
    <p class="small muted">${t("De coach maakt het schema voor de komende wedstrijden. Vink per wedstrijd aan of je kind er niet is, of dat jij als ouder er niet bent (dan krijg je die dag geen taak). Je kunt het aanpassen tot de coach het schema maakt.")}</p>
    <label class="f">${t("Mijn kind")}<select id="av-child" data-act="avchild"><option value="">${t("Kies…")}</option>${list.map(x => `<option value="${x.id}" ${p && p.id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    ${p ? `<div class="stack">${ms.map(m => `<div class="card" style="padding:10px"><strong>${esc(fmtDate(m.date))} · ${m.home ? t("thuis tegen") : t("uit bij")} ${esc(m.opponent)}</strong>
      <div class="checks">${box(m, "absent", t("{name} is er niet", { name: esc(p.name) }))}${parentBox(m)}</div></div>`).join("")}</div>
      <div class="row"><button class="btn primary" type="submit">${t("Doorgeven")}</button></div>` : ""}
  </form>`;
}
async function submitAvail(f) {
  const pid = document.getElementById("av-child").value; if (!pid) return;
  const fd = new FormData(f);
  const entries = round.matches.map(mid => { const v = fd.getAll(mid); const c = v.filter(x => x !== "parent"); if (v.includes("parent")) c.push("drive", "flag", "wash"); return { match: mid, cannot: c }; });
  const { data, error } = await sb.rpc("submit_availability", { token: shareToken, p_player: pid, entries });
  if (error || data === false) { toast(t("Doorgeven lukte niet. Misschien heeft de coach het schema al gemaakt.")); return; }
  avail = avail.filter(a => a.player !== pid || !round.matches.includes(a.match)).concat(entries.map(e => ({ player: pid, match: e.match, cannot: e.cannot })));
  toast(t("Doorgegeven, dank je wel!")); render();
}
// ---------- logo en teamfoto ----------
function resizeImage(file, max, type, quality) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas");
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error("Omzetten mislukt")), type, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Dit bestand is geen afbeelding die de browser kan lezen.")); };
    img.src = url;
  });
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function uploadMedia(kind, file) {
  const isLogo = kind === "logo";
  toast(isLogo ? "Logo uploaden…" : "Teamfoto uploaden…");
  try {
    const blob = await resizeImage(file, isLogo ? 256 : 1600, isLogo ? "image/png" : "image/jpeg", 0.85);
    const key = isLogo ? "logoUrl" : "photoUrl"; let url;
    if (mode === "cloud") {
      const path = teamId + "/" + kind + "-" + Date.now() + (isLogo ? ".png" : ".jpg");
      const { error } = await sb.storage.from("team-media").upload(path, blob, { contentType: blob.type });
      if (error) throw new Error("Uploaden lukte niet (" + error.message + "). Is het databasescript al opnieuw uitgevoerd?");
      url = sb.storage.from("team-media").getPublicUrl(path).data.publicUrl;
      await removeMedia(kind, true);
    } else {
      url = await blobToDataUrl(isLogo ? blob : await resizeImage(file, 800, "image/jpeg", 0.75));
    }
    S.settings[key] = url; save(); render(); toast(isLogo ? "Logo opgeslagen." : "Teamfoto opgeslagen.");
  } catch (e) { toast(e.message || "Uploaden lukte niet."); }
}
async function removeMedia(kind, quiet) {
  const key = kind === "logo" ? "logoUrl" : "photoUrl"; const url = S.settings[key];
  if (url && mode === "cloud" && url.includes("/team-media/")) {
    const path = decodeURIComponent(url.split("/team-media/")[1].split("?")[0]);
    await sb.storage.from("team-media").remove([path]);
  }
  if (!quiet) { S.settings[key] = ""; save(); render(); toast("Verwijderd."); }
}
async function createTeam(fd) {
  const fromLocal = fd.has("fromLocal");
  const data = fromLocal ? (readLocal(LS_KEY) || DEFAULTS()) : DEFAULTS();
  const club = (fd.get("club") || "").trim(), team = (fd.get("team") || "").trim(), address = (fd.get("address") || "").trim();
  if (club) data.settings.club = club; if (team) data.settings.team = team; if (address) data.settings.homeAddress = address;
  const age = +((team.match(/(?:JO|MO|O)\s?(\d{1,2})/i) || [])[1] || 0);
  const sp = SPORTS[fd.get("sport")] ? fd.get("sport") : "voetbal"; data.settings.sport = sp;
  const pre = !fromLocal && age ? (sp === "hockey" ? (age <= 10 ? 0 : age <= 12 ? 1 : age <= 14 ? 2 : 3) : (age <= 9 ? 0 : age <= 12 ? 1 : age === 13 ? 2 : age <= 15 && age >= 14 ? 3 : age <= 17 && age >= 16 ? 4 : age >= 18 ? 5 : -1)) : -1;
  if (pre >= 0) { const P = presetsFor(sp)[pre]; Object.assign(data.settings, { onField: P[1], matchMinutes: P[2], blocks: P[3], formation: P[4] }); }
  const pk = ui.clubPick; if (pk && pk.address === data.settings.homeAddress) data.settings.homeCoords = { lat: pk.lat, lon: pk.lon, address: pk.address, label: pk.name };
  ui.clubPick = null; ui.clubSearch = null;
  const name = [data.settings.club, data.settings.team].filter(Boolean).join(" ");
  const { data: row, error } = await sb.from("teams").insert({ name: name || "Mijn team", data }).select("id,name,share_token,updated_at,avail_open,avail_matches").single();
  if (error) { toast("Team aanmaken lukte niet: " + error.message); return; }
  teams.push(row); ui.tab = fromLocal ? "planning" : "settings"; await loadTeam(row.id);
}
async function newShareLink() {
  const tok = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
  const { error } = await sb.from("teams").update({ share_token: tok }).eq("id", teamId);
  if (error) { toast("Nieuwe link maken lukte niet."); return; }
  teams.find(t => t.id === teamId).share_token = tok; render(); toast("Nieuwe kijklink gemaakt. De oude werkt niet meer.");
}
const shareUrl = () => { const t = teams.find(x => x.id === teamId); return t ? location.origin + location.pathname + "?kijk=" + t.share_token : ""; };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || mode !== "cloud") return;
  if (dirty) pushRemote(); else refreshIfNewer();
});

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Posities: een hele linie (V/M/A) of een specifieke plek. Wie een hele linie heeft, kan op elke plek in die linie.
const POS_GROUPS_INIT = [
  ["Keeper", { K: "Keeper", R: "Reservekeeper" }],
  ["Verdediging", { V: "Hele verdediging", LB: "Linksback", CV: "Centrale verdediger", RB: "Rechtsback" }],
  ["Middenveld", { M: "Heel middenveld", LM: "Linksmidden", VM: "Verdedigende mid", CM: "Middenmid", AM: "Aanvallende mid", RM: "Rechtsmidden" }],
  ["Aanval", { A: "Hele aanval", LA: "Linksbuiten", SP: "Spits", RA: "Rechtsbuiten" }]];
const POS_GROUPS = POS_GROUPS_INIT;
const POS_BASE = Object.assign({}, ...POS_GROUPS_INIT.map(g => ({ ...g[1] })));
const POS_HOCKEY = { V: "Hele achterlinie", LB: "Linksachter", CV: "Centrale verdediger", RB: "Rechtsachter", M: "Heel middenveld", LM: "Linkshalf", VM: "Verdedigende mid", CM: "Midmid", AM: "Aanvallende mid", RM: "Rechtshalf", A: "Hele voorhoede", LA: "Linksbuiten", SP: "Midvoor", RA: "Rechtsbuiten" };
let POS = {};
// Labels hangen af van de sport; de codes blijven hetzelfde, zodat een wisselschema altijd leesbaar blijft.
function setSportLabels() {
  POS_GROUPS.forEach(g => Object.keys(g[1]).forEach(k => { g[1][k] = (isHockey() && POS_HOCKEY[k]) || POS_BASE[k]; }));
  POS = Object.assign({}, ...POS_GROUPS.map(g => g[1]));
}
const LINE = { LB: "V", CV: "V", RB: "V", LM: "M", VM: "M", CM: "M", AM: "M", RM: "M", LA: "A", SP: "A", RA: "A", V: "V", M: "M", A: "A", K: "K" };
const lineOf = c => LINE[c] || c;
const POS_ORDER = ["K", "LB", "CV", "RB", "V", "VM", "LM", "CM", "RM", "AM", "M", "LA", "SP", "RA", "A"];
const fits = (p, slot) => { const ps = p.positions || []; return ps.includes(slot) || ps.includes(lineOf(slot)); };
const prefOptions = cur => `<option value="">Geen voorkeur</option>` + POS_GROUPS.slice(1).map(([g, o]) => `<optgroup label="${g}">${Object.entries(o).map(([k, l]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${l}</option>`).join("")}</optgroup>`).join("");
// ---------- sport ----------
const SPORTS = { voetbal: "Voetbal", hockey: "Hockey" };
const sport = () => (S && S.settings && SPORTS[S.settings.sport]) ? S.settings.sport : "voetbal";
const isHockey = () => sport() === "hockey";
const flagWord = () => isHockey() ? "Scheidsrechter" : "Grensrechter"; // bij jeugdhockey fluiten ouders, bij voetbal vlaggen ze
const DUTY = { drive: "Rijden", flag: "Grensrechter", wash: "Wassen" };
const dutyName = k => t(k === "flag" ? flagWord() : DUTY[k]);
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const toMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmt = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const fmtDate = d => { try { return new Date(d + "T12:00").toLocaleDateString(window.I18N ? I18N.locale : "nl-NL", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return d; } };
const byDate = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
const sorted = () => S.matches.slice().sort(byDate);
const pById = id => S.players.find(p => p.id === id);
const pName = id => (pById(id) || {}).name || "?";
const parentLabel = id => { const p = pById(id); if (!p) return "?"; return p.parent ? p.parent + " (" + p.name + ")" : t("ouders van {name}", { name: p.name }); };
// Gastspeler: doet alleen mee in wedstrijden waar je hem bij zet, en de ouders krijgen geen taken.
// Niet meer actief (inactiveFrom = datum): telt vanaf die dag niet meer mee; de geschiedenis blijft staan.
const activeAt = (p, m) => !(p.inactiveFrom && m.date >= p.inactiveFrom);
const squad = m => S.players.filter(p => activeAt(p, m) && (!p.guest || (m.guests || []).includes(p.id)));
const present = m => squad(m).filter(p => !(m.absent || []).includes(p.id));
const families = () => S.players.filter(p => !p.guest && !p.inactiveFrom);
const nrTag = p => p && p.nr ? `<span class="nr">${esc(p.nr)}</span> ` : "";
const isPast = m => m.date < todayStr();
function times(m) {
  const ko = toMin(m.time), arrive = ko - (+S.settings.arriveBefore || 0);
  // vertrektijd altijd naar beneden afronden op 5 minuten (10:43 wordt 10:40)
  const depart = m.home ? null : Math.floor((arrive - (+m.travel || 0)) / 5) * 5;
  return { ko: fmt(ko), arrive: fmt(arrive), depart: depart == null ? null : +m.travel ? fmt(depart) : "?" };
}
// ---------- reistijd (OpenStreetMap: Nominatim + OSRM) ----------
const geoCache = {};
const clubFromTeam = name => String(name || "").replace(TEAMCODE, " ").replace(/\s+/g, " ").trim();
async function geocode(q) {
  const key = q.toLowerCase().trim(); if (geoCache[key]) return geoCache[key];
  const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl,be,de&accept-language=nl&q=" + encodeURIComponent(q));
  if (!r.ok) throw new Error("zoeken mislukt");
  const j = await r.json(); if (!j.length) return null;
  return geoCache[key] = { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// OpenStreetMap vindt "Kruistraat 3-5, 8471 HH Wolvega (Sportpark Molenwiek)" niet in één keer.
// Daarom proberen we het adres ook in eenvoudigere vormen: zonder haakjes, met één huisnummer, zonder postcode, alleen postcode.
function addressVariants(a) {
  if (!a) return [];
  const clean = a.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/^[, ]+|[, ]+$/g, "");
  const oneNr = clean.replace(/(\d+)\s*[a-zA-Z]?\s*[-–\/]\s*\d+\s*[a-zA-Z]?\b/, "$1");
  const pcRe = /\b(\d{4})\s?([A-Za-z]{2})\b/; const pc = oneNr.match(pcRe);
  const noPc = oneNr.replace(pcRe, "").replace(/\s+/g, " ").replace(/,\s*,/g, ",").replace(/^[, ]+|[, ]+$/g, "");
  const parts = noPc.split(",").map(x => x.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts[parts.length - 1] : "";
  const street = parts[0] || "";
  const out = [a, clean, oneNr, noPc];
  if (pc) out.push(pc[1] + " " + pc[2].toUpperCase() + (city ? ", " + city : ""));
  if (street && city) out.push(street.replace(/\s*\d+.*$/, "") + ", " + city);
  const inside = (a.match(/\(([^)]*)\)/) || [])[1]; if (inside && city) out.push(inside + ", " + city);
  return [...new Set(out.map(x => x.trim()).filter(Boolean))];
}
// Geeft { minutes, km, label, query } of gooit een Error met een Nederlandse melding.
async function calcTravel(address, opponent) {
  const home = await ensureHome();
  if (!home) throw new Error("Je eigen sportcomplex is niet gevonden. Kies je club of vul het adres in bij Instellingen.");
  const tries = [...addressVariants(address), clubFromTeam(opponent) && clubFromTeam(opponent) + " sportpark", clubFromTeam(opponent)].filter(Boolean);
  let dest = null, query = "";
  let shared = null;
  if (!address) { shared = await sharedClub(opponent); if (shared) { dest = { lat: shared.lat, lon: shared.lon, label: shared.name + ", " + shared.address + " (gedeeld adresboek, " + shared.votes + (shared.votes == 1 ? " coach" : " coaches") + ")" }; query = shared.address; } }
  if (!address && !dest) { const c = await findOpponentClub(opponent, home); if (c) { dest = { lat: c.lat, lon: c.lon, label: c.name + (c.city ? ", " + c.city : "") }; query = c.name; } }
  if (!dest) for (const q of tries) { await sleep(1100); dest = await geocode(q); if (dest) { query = q; break; } }
  if (!dest) throw new Error("Het adres van de uitclub is niet gevonden. Vul het adres in (straat en plaats).");
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${home.lon},${home.lat};${dest.lon},${dest.lat}?overview=false`);
  const j = r.ok ? await r.json() : null;
  if (!j || !j.routes || !j.routes.length) throw new Error("Er is geen route gevonden.");
  if (shared) shareClub(opponent, shared.address, shared.lat, shared.lon); // gebruiken telt als bevestiging
  return { minutes: Math.ceil(j.routes[0].duration / 60), km: Math.round(j.routes[0].distance / 1000), label: dest.label, query, lat: dest.lat, lon: dest.lon, address: shared ? shared.address : "" };
}
// Gedeeld adresboek van clubs (Supabase). Elke coach die een adres invult of gebruikt, is één stem;
// het adres met de meeste stemmen geldt voor iedereen.
const clubKey = opp => normName(clubFromTeam(opp));
async function sharedClub(opponent) {
  if (!sb || !user) return null; const key = clubKey(opponent); if (!key) return null;
  try { const { data } = await sb.rpc("club_location", { p_key: key }); const row = Array.isArray(data) ? data[0] : data; return row && row.address ? row : null; } catch (e) { return null; }
}
async function shareClub(opponent, address, lat, lon) {
  if (!sb || !user || !address || lat == null) return; const key = clubKey(opponent); if (!key) return;
  try { await sb.from("club_location_votes").upsert({ key, user_id: user.id, name: clubFromTeam(opponent), address, lat, lon, updated_at: new Date().toISOString() }); } catch (e) {}
}
// Eigen sportcomplex: opgeslagen coördinaten, anders het adres, anders de club opzoeken op naam.
async function ensureHome() {
  const st = S.settings, hc = st.homeCoords;
  if (hc && (!st.homeAddress || hc.address === st.homeAddress)) return hc;
  let home = null;
  if (st.homeAddress) { try { home = await geocode(st.homeAddress); } catch (e) {} }
  if (home) { st.homeCoords = { lat: home.lat, lon: home.lon, address: st.homeAddress, label: home.label }; save(); return st.homeCoords; }
  if (!st.club) return null;
  const c = bestByName(await searchClubs(st.club).catch(() => []), st.club); if (!c) return null;
  const address = await addressFor(c);
  st.homeAddress = st.homeAddress || address;
  st.homeCoords = { lat: c.lat, lon: c.lon, address: st.homeAddress, label: c.name }; save();
  return st.homeCoords;
}
const normName = x => String(x || "").toLowerCase().replace(/\b(vv|sv|v\.v\.|s\.v\.|fc|rksv|vvv|sc|cvv|asv|voetbalvereniging|sportvereniging|hc|mhc|hv|mhv|hockeyclub|hockeyvereniging)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, "");
function nameScore(c, q) { const a = normName(c.name), b = normName(q); if (!b) return 0; return a === b ? 3 : a.startsWith(b) || b.startsWith(a) ? 2 : a.includes(b) ? 1 : 0; }
function bestByName(list, q, near) {
  if (!list || !list.length) return null;
  return list.slice().sort((a, b) => (nameScore(b, q) - nameScore(a, q)) || (b.club - a.club) || (near ? distKm(near, a) - distKm(near, b) : 0))[0];
}
// Voetbalclubs zoeken in OpenStreetMap (Overpass). Geeft [{name, lat, lon, city, street}].
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const qlSafe = x => x.replace(/[^\p{L}\p{N}'-]/gu, "");
const sportTag = () => ((mode === "newteam" ? ui.newSport : sport()) === "hockey") ? "field_hockey|hockey" : "soccer";
async function searchClubs(q, near) {
  const words = String(q || "").toLowerCase().replace(/\b(vv|sv|v\.v\.|s\.v\.|fc|rksv|vvv|sc|cvv|asv|voetbalvereniging|hc|mhc|hv|mhv|hockeyclub|hockeyvereniging)\b/g, " ").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
  if (!words.length) return [];
  const rx = words.map(qlSafe).filter(Boolean).join(".*"); if (!rx) return [];
  // zoekgebied: rond het eigen sportcomplex (snel), anders heel Nederland
  const bb = near ? [near.lat - 1.2, near.lon - 1.8, near.lat + 1.2, near.lon + 1.8].map(x => x.toFixed(3)).join(",") : "50.7,3.2,53.7,7.3";
  const ql = `[out:json][timeout:25][bbox:${bb}];
(nwr["club"]["sport"~"${sportTag()}"]["name"~"${rx}",i];
 nwr["club"="sport"]["name"~"${rx}",i]["sport"!~"."];
 nwr["sport"~"${sportTag()}"]["leisure"~"sports_centre|pitch|stadium|sports_hall"]["name"~"${rx}",i];
 nwr["leisure"~"sports_centre|pitch|stadium"]["operator"~"${rx}",i];);
out center tags 80;`;
  let j = null;
  for (const ep of OVERPASS) {
    try { const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(ql), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (r.ok) { j = await r.json(); break; } } catch (e) {}
  }
  if (!j) throw new Error("De clublijst is nu niet bereikbaar. Probeer het zo nog eens.");
  const out = [];
  (j.elements || []).forEach(e => {
    const t = e.tags || {}; const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
    if (!t.name || lat == null) return;
    const nm = rxTest(rx, t.name) ? t.name : (t.operator || t.name);
    const item = { name: nm, lat, lon, club: !!t.club || nm !== t.name, city: t["addr:city"] || t["addr:place"] || "", street: t["addr:street"] ? t["addr:street"] + (t["addr:housenumber"] ? " " + t["addr:housenumber"] : "") : "" };
    const dup = out.find(o => o.name.toLowerCase() === item.name.toLowerCase() && distKm(o, item) < 2);
    if (dup) { if (item.club && !dup.club) Object.assign(dup, item); return; }
    out.push(item);
  });
  return out.sort((a, b) => (b.club - a.club) || a.name.localeCompare(b.name)).slice(0, 25);
}
function rxTest(rx, x) { try { return new RegExp(rx, "i").test(x); } catch (e) { return true; } }
function distKm(a, b) { const R = 6371, r = Math.PI / 180; const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
async function addressFor(c) {
  if (c.street && c.city) return c.street + ", " + c.city;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&addressdetails=1&accept-language=nl&lat=${c.lat}&lon=${c.lon}`);
    const j = await r.json(); const a = j.address || {};
    const place = a.village || a.town || a.city || a.municipality || c.city || "";
    return [a.road ? a.road + (a.house_number ? " " + a.house_number : "") : "", place].filter(Boolean).join(", ") || c.name;
  } catch (e) { return c.city ? c.name + ", " + c.city : c.name; }
}
function clubSearchBlock(p) {
  return `<div class="f"><span>Zoek je club in OpenStreetMap</span>
    <div class="row" style="flex-wrap:nowrap"><input id="${p}-cs" placeholder="bv. Balk" aria-label="Clubnaam zoeken" data-cs="${p}"><button class="btn" type="button" data-act="clubsearch" data-p="${p}">Zoek</button></div>
    <div id="${p}-csr" class="stack"></div></div>`;
}
function renderClubResults(p) {
  const el = document.getElementById(p + "-csr"); if (!el) return;
  const st = ui.clubSearch || {};
  if (st.loading) { el.innerHTML = `<p class="small muted">Zoeken…</p>`; return; }
  if (st.error) { el.innerHTML = `<div class="notice">${esc(st.error)}</div>`; return; }
  if (!st.results) { el.innerHTML = ""; return; }
  if (!st.results.length) { el.innerHTML = `<p class="small muted">Geen club gevonden. Probeer een ander deel van de naam, of vul je club en adres hieronder zelf in.</p>`; return; }
  el.innerHTML = `<div class="names">${st.results.map((c, i) => `<button class="btn" type="button" data-act="clubpick" data-p="${p}" data-i="${i}">${esc(c.name)}${c.city ? ` <span class="muted small">${esc(c.city)}</span>` : ""}</button>`).join("")}</div>
    <p class="small muted">Clubs uit OpenStreetMap (© OpenStreetMap-bijdragers). Staat je club er niet bij? Vul hem hieronder zelf in.</p>`;
}
async function doClubSearch(p) {
  const q = (document.getElementById(p + "-cs") || {}).value || "";
  ui.clubSearch = { loading: true }; renderClubResults(p);
  try { ui.clubSearch = { results: await searchClubs(q) }; } catch (e) { ui.clubSearch = { error: e.message }; }
  renderClubResults(p);
}
async function pickClub(p, i) {
  const c = ui.clubSearch.results[i]; const clubIn = document.getElementById(p + "-club"), addrIn = document.getElementById(p + "-addr");
  if (clubIn) clubIn.value = c.name;
  if (addrIn) addrIn.value = "Adres opzoeken…";
  const address = await addressFor(c);
  if (addrIn) addrIn.value = address;
  ui.clubPick = { name: c.name, lat: c.lat, lon: c.lon, address };
  document.getElementById(p + "-csr").innerHTML = `<p class="small" style="color:var(--ok)">✓ ${esc(c.name)} gekozen. Controleer het adres hieronder.</p>`;
}
async function findOpponentClub(opponent, home) {
  const name = clubFromTeam(opponent); if (!name) return null;
  // losse woorden zonder clubafkortingen en cijfers, langste eerst (bv. "Olympia'28" -> "olympia")
  const words = normWords(name).filter(w => w.length > 2 && !/^\d+$/.test(w)).sort((a, b) => b.length - a.length);
  for (const q of [name, words[0]].filter((x, i, a) => x && a.indexOf(x) === i)) {
    try {
      const list = await searchClubs(q, home);
      const c = bestByName(list, name, home);
      if (c && (nameScore(c, name) > 0 || q === words[0])) return c;
    } catch (e) {}
  }
  // laatste poging: adreszoeker rond het eigen sportcomplex
  for (const q of [name + (isHockey() ? " hockey" : " voetbal"), name, words[0] && words[0] + (isHockey() ? " hockey" : " voetbal")].filter(Boolean)) {
    await sleep(1100);
    const g = await geocodeNear(q, home).catch(() => null);
    if (g) return { name: g.label.split(",")[0], lat: g.lat, lon: g.lon, city: (g.label.split(",").slice(-4, -3)[0] || "").trim() };
  }
  return null;
}
function normWords(x) { return String(x || "").toLowerCase().replace(/\b(vv|sv|v\.v\.|s\.v\.|fc|rksv|vvv|sc|cvv|asv|voetbalvereniging|hc|mhc|hv|mhv|hockeyclub|hockeyvereniging)\b/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
async function geocodeNear(q, near) {
  const vb = near ? `&viewbox=${near.lon - 1.5},${near.lat + 1},${near.lon + 1.5},${near.lat - 1}&bounded=1` : "";
  const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&accept-language=nl" + vb + "&q=" + encodeURIComponent(q));
  if (!r.ok) return null; const j = await r.json(); if (!j.length) return null;
  return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
}
let travelBusy = false; const travelTried = new Set();
function autoTravel() {
  if (!canEdit() || travelBusy) return;
  const list = sorted().filter(m => !m.home && m.date >= todayStr() && !+m.travel && !travelTried.has(m.id));
  if (list.length) calcMissingTravel(true);
}
async function calcMissingTravel(quiet) {
  if (travelBusy) return; travelBusy = true;
  const list = sorted().filter(m => !m.home && m.date >= todayStr() && !+m.travel && (!quiet || !travelTried.has(m.id)));
  if (!list.length) { travelBusy = false; if (!quiet) toast("Alle uitwedstrijden hebben al een reistijd."); return; }
  let ok = 0, fail = [];
  for (const m of list) {
    travelTried.add(m.id);
    setSync("Reistijd berekenen: " + (m.opponent || "") + "…"); if (!quiet) toast("Reistijd berekenen: " + (m.opponent || "") + "…");
    if (!m.address) { const k = S.matches.find(x => x !== m && !x.home && x.address && clubFromTeam(x.opponent).toLowerCase() === clubFromTeam(m.opponent).toLowerCase()); if (k) m.address = k.address; }
    try { const r = await calcTravel(m.address, m.opponent); m.travel = r.minutes; m.km = r.km; m.travelPlace = r.label; if (!m.address) m.address = r.address || r.label.split(",").slice(0, 3).join(","); ok++; }
    catch (e) { fail.push(m.opponent); if (/eigen sportcomplex/.test(e.message)) { toast(e.message); break; } }
  }
  travelBusy = false; save(); render();
  toast(ok + " reistijd(en) berekend." + (fail.length ? " Niet gevonden: " + fail.join(", ") + ". Vul daar het adres in via Wijzig." : ""));
}
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2200); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t("Gekopieerd. Plak het in de groepsapp.")); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(t("Gekopieerd.")); } catch (e2) { toast("Selecteer en kopieer de tekst handmatig."); } ta.remove(); }
}

// ---------- duty planner ----------
function planDuties(onlyFuture = true) {
  const list = sorted(); const today = todayStr();
  const count = {}, last = {};
  S.players.forEach(p => { count[p.id] = { drive: 0, flag: 0, wash: 0 }; last[p.id] = { drive: -99, flag: -99, wash: -99 }; });
  const tally = (m, i) => {
    const d = m.duties || {};
    (d.drive || []).forEach(id => { if (count[id]) { count[id].drive++; last[id].drive = i; } });
    ["flag", "wash"].forEach(k => (d[k] || []).forEach(id => { if (count[id]) { count[id][k]++; last[id][k] = i; } }));
  };
  list.forEach((m, i) => {
    if (m.cancelled) { m.duties = null; return; }
    if (m.locked || (onlyFuture && m.date < today)) { tally(m, i); return; }
    const pres = present(m).filter(p => !cannotDo(m.id, p.id, "absent")); const used = new Set(); const duties = { drive: [], flag: [], wash: [] };
    // Eén taak per gezin per wedstrijd; alleen gezinnen met "twee ouders helpen" kunnen er twee krijgen.
    const nUsed = {}; const use = id => { used.add(id); nUsed[id] = (nUsed[id] || 0) + 1; };
    const room = p => (nUsed[p.id] || 0) < (p.twoParents ? 2 : 1);
    const pick = (duty, can) => {
      const cands = pres.filter(p => !p.guest && can(p) && room(p) && count[p.id] && !cannotDo(m.id, p.id, duty));
      if (!cands.length) return null;
      cands.sort((a, b) => (used.has(a.id) - used.has(b.id)) || (count[a.id][duty] - count[b.id][duty]) ||
        (last[a.id][duty] - last[b.id][duty]) || a.name.localeCompare(b.name));
      const c = cands[0]; use(c.id); return c;
    };
    if (!m.home) {
      let cap = 0; const need = pres.length; const taken = [];
      // leiders die altijd rijden gaan eerst mee, buiten de eerlijke verdeling om
      let leaders = pres.filter(p => !p.guest && p.leader && p.leaderDrives && !cannotDo(m.id, p.id, "drive"));
      if (S.settings.leaderDriveOne && leaders.length > 1)
        leaders = [leaders.sort((a, b) => (count[a.id].drive - count[b.id].drive) || (last[a.id].drive - last[b.id].drive) || a.name.localeCompare(b.name))[0]];
      leaders.forEach(p => {
        taken.push(p.id); use(p.id); duties.drive.push(p.id); cap += Math.max(1, +p.seats || +S.settings.seatsDefault || 3);
      });
      while (cap < need) {
        const c = pick("drive", p => p.canDrive && !taken.includes(p.id) && !(p.leader && p.leaderDrives));
        if (!c) break; taken.push(c.id); duties.drive.push(c.id); cap += Math.max(1, +c.seats || +S.settings.seatsDefault || 3);
      }
    }
    const free = p => !(p.leader && p.leaderNoOther);
    if (m.home || S.settings.flagAway) { const c = pick("flag", p => p.canFlag && free(p)); if (c) duties.flag.push(c.id); }
    if (S.settings.washPerMatch) {
      let c = null;
      // Standaard neemt een ouder die die dag al rijdt of vlagt de wastas mee naar huis (dat is handig); eerlijk verdeeld onder hen.
      if (S.settings.washWithDuty !== false) {
        const cands = pres.filter(p => used.has(p.id) && p.canWash && free(p) && count[p.id] && !cannotDo(m.id, p.id, "wash"))
          .sort((a, b) => (count[a.id].wash - count[b.id].wash) || (last[a.id].wash - last[b.id].wash) || a.name.localeCompare(b.name));
        c = cands[0] || null;
      }
      if (!c) c = pick("wash", p => p.canWash && free(p));
      if (c) duties.wash.push(c.id);
    }
    m.duties = duties; tally(m, i);
  });
}
function dutyIssues(m) {
  if (m.cancelled) return [];
  const out = []; const d = m.duties || {}; const n = present(m).length;
  if (!m.home) {
    const cap = (d.drive || []).reduce((s, id) => s + (+((pById(id) || {}).seats) || +S.settings.seatsDefault || 3), 0);
    if (cap < n) out.push("Te weinig plekken: " + cap + " voor " + n + " kinderen");
  }
  if ((m.home || S.settings.flagAway) && !(d.flag || []).length) out.push("Nog geen grensrechter");
  if (S.settings.washPerMatch && !(d.wash || []).length) out.push("Nog niemand voor de was");
  return out;
}

// ---------- lineup planner ----------
function slotsFor() {
  const parts = String(S.settings.formation || "").split("-").map(n => parseInt(n, 10)).filter(n => n >= 0);
  const D = { 1: ["CV"], 2: ["CV", "CV"], 3: ["LB", "CV", "RB"], 4: ["LB", "CV", "CV", "RB"], 5: ["LB", "CV", "CV", "CV", "RB"] };
  const Mi = { 1: ["CM"], 2: ["LM", "RM"], 3: ["LM", "CM", "RM"], 4: ["LM", "CM", "CM", "RM"], 5: ["LM", "CM", "CM", "CM", "RM"] };
  const At = { 1: ["SP"], 2: ["SP", "SP"], 3: ["LA", "SP", "RA"], 4: ["LA", "SP", "SP", "RA"] };
  const pick = (map, n, fill) => map[n] || Array(n).fill(fill);
  const slots = []; const L = parts.length;
  parts.forEach((n, i) => {
    if (i === 0) slots.push(...pick(D, n, "CV"));
    else if (i === L - 1 && L > 1) slots.push(...pick(At, n, "SP"));
    else if (L > 3 && i < L - 2) slots.push(...(n === 1 ? ["VM"] : Array(n).fill("VM"))); // bv. de 2 in 4-2-3-1
    else if (L > 3) slots.push(...(n === 1 ? ["AM"] : n === 3 ? ["LM", "AM", "RM"] : pick(Mi, n, "CM")));
    else slots.push(...pick(Mi, n, "CM"));
  });
  const need = Math.max(0, (+S.settings.onField || 8) - 1);
  while (slots.length < need) slots.push("CM");
  return slots.slice(0, need);
}
function blockMin() { return (+S.settings.matchMinutes || 60) / Math.max(1, +S.settings.blocks || 1); }
// Minuten per kolom van een wisselschema. Oude schema's hebben gelijke blokken; nieuwe kunnen een gehalveerd laatste blok hebben.
function lineupDurs(m) {
  const L = m.lineup; const n = (Object.values(L.cells || {})[0] || []).length;
  if (Array.isArray(L.durs) && L.durs.length === n) return L.durs;
  const bm = (+L.matchMinutes || +S.settings.matchMinutes || 60) / Math.max(1, n); return Array(n).fill(bm);
}
function lineupMinutes(m, pid) {
  if (!m.lineup || !m.lineup.cells || !m.lineup.cells[pid]) return 0;
  const d = lineupDurs(m); return Math.max(0, m.lineup.cells[pid].reduce((t, c, i) => t + (c && c !== "-" ? d[i] || 0 : 0), 0) + ((m.lineup.adj || {})[pid] || 0));
}
function seasonStats(beforeMatch) {
  const st = {}; S.players.forEach(p => st[p.id] = { min: 0, keeper: 0, games: 0, avail: 0 });
  sorted().forEach(m => {
    if (!m.lineup || m.cancelled) return;
    // Voor het plannen tellen ook eerdere, al geplande schema's mee. Voor het seizoensoverzicht: gespeeld, of de datum is voorbij.
    if (beforeMatch) { if (m.id === beforeMatch.id || byDate(m, beforeMatch) >= 0) return; }
    else if (!counts(m)) return;
    Object.keys(m.lineup.cells || {}).forEach(pid => {
      if (!st[pid]) return; const min = lineupMinutes(m, pid);
      st[pid].min += min; st[pid].avail += (+m.lineup.matchMinutes || 60); if (min > 0) st[pid].games++;
      st[pid].keeper += m.lineup.cells[pid].filter(c => c === "K").length;
    });
  });
  return st;
}
const counts = m => !!m.lineup && !m.cancelled && (m.played || isPast(m));
const useReserve = m => m.useReserve ?? (S.settings.keeperFull === false);
// Maak het wisselschema. Met opts.from > 0 blijven de blokken daarvoor staan en wordt alleen de rest opnieuw ingedeeld
// (tijdens de wedstrijd: bij een blessure of een speler die later komt). opts.exclude = spelers die niet meer kunnen spelen.
function planLineup(m, opts = {}) {
  const old = opts.from > 0 && m.lineup ? m.lineup : null; const from = old ? opts.from : 0;
  const out = new Set(old ? (opts.exclude || old.out || []) : []);
  const pres = present(m); const avail = pres.filter(p => !out.has(p.id));
  const B = Math.max(1, +S.settings.blocks || 4); const onField = Math.max(1, +S.settings.onField || 8);
  const bm = blockMin(); const season = seasonStats(m); const slots = slotsFor();
  { const own = pres.filter(p => !p.guest); const avgMin = own.length ? own.reduce((a, p) => a + season[p.id].min, 0) / own.length : 0;
    pres.filter(p => p.guest).forEach(p => { season[p.id] = Object.assign({}, season[p.id], { min: avgMin }); }); }
  // Komt de bank niet eerlijk uit (sommigen zouden twee blokken zitten), dan halveren we het laatste blok:
  // dan zitten er een paar spelers een half blok extra in plaats van twee spelers een heel blok.
  const benchN = Math.max(0, pres.length - onField), fieldN = Math.max(1, pres.length - 1);
  const split = S.settings.splitLast !== false && B >= 2 && benchN > 0 && (B * benchN) % fieldN !== 0;
  const durs = old ? lineupDurs(m) : split ? Array(B - 1).fill(bm).concat([bm / 2, bm / 2]) : Array(B).fill(bm);
  const C = durs.length; const Bn = old ? (C > B ? B : C) : B; const base = c => Math.min(c, Bn - 1);
  const adj = old ? Object.assign({}, old.adj || {}) : {};
  const cells = {}; pres.forEach(p => cells[p.id] = old && old.cells[p.id] ? old.cells[p.id].slice(0, from).concat(Array(C - from).fill("-")) : Array(C).fill("-"));
  const planned = id => season[id].min + (adj[id] || 0) + cells[id].reduce((t, c, i) => t + (c !== "-" ? durs[i] : 0), 0);
  const half = Math.ceil(Bn / 2); const keepers = [];
  const order = (a, b) => planned(a.id) - planned(b.id) || season[a.id].min - season[b.id].min || a.name.localeCompare(b.name);
  // Keeper eerst, dan reservekeeper, dan wie het minst gespeeld heeft.
  const has = (p, k) => (p.positions || []).includes(k);
  const pickKeeper = exclude => {
    const tiers = [avail.filter(p => has(p, "K")), avail.filter(p => has(p, "R")), avail];
    for (const tier of tiers) {
      const pool = tier.filter(p => !exclude.includes(p.id));
      if (pool.length) return pool.sort((a, b) => season[a.id].keeper - season[b.id].keeper || order(a, b))[0].id;
    }
    return null;
  };
  // Keeper wisselt alleen in de rust. Per wedstrijd kies je of de reservekeeper de tweede helft keept.
  // Wie niet getraind heeft, begint op de bank; geldt ook voor de keeper als er een (reserve)keeper is die wel trainde.
  const missed = id => (m.missedTraining || []).includes(id);
  if (old) {
    // Houd de keepers van het bestaande schema aan, behalve wie niet meer kan.
    const oldK = b => Object.keys(old.cells).find(id => old.cells[id][b] === "K");
    const k0 = oldK(Math.max(0, from - 1)); const sub = !k0 || out.has(k0) ? pickKeeper([]) : k0;
    for (let b = 0; b < C; b++) { const k = oldK(b); keepers[b] = b < from ? k : (k && !out.has(k) && cells[k] ? k : sub); }
  } else {
    const best = pickKeeper([]);
    const trained = avail.filter(p => (has(p, "K") || has(p, "R")) && !missed(p.id))
      .sort((a, b) => (has(b, "K") - has(a, "K")) || season[a.id].keeper - season[b.id].keeper || order(a, b))[0];
    let k1 = best, k2 = best;
    if (best && missed(best) && trained) { k1 = trained.id; k2 = best; }
    else if (useReserve(m)) {
      const others = avail.filter(p => p.id !== k1);
      const r = others.filter(p => has(p, "R")).concat(others.filter(p => has(p, "K")))
        .sort((a, b) => (has(b, "R") - has(a, "R")) || season[a.id].keeper - season[b.id].keeper || order(a, b))[0];
      if (r) k2 = r.id;
    }
    for (let b = 0; b < C; b++) keepers[b] = Math.floor(base(b) / half) >= 1 ? k2 : k1;
  }
  for (let b = from; b < C; b++) {
    const k = keepers[b];
    if (k) cells[k][b] = "K";
    const satLast = id => b > 0 && cells[id][b - 1] === "-";
    const cands = avail.filter(p => p.id !== k).sort((x, y) =>
      (b === 0 ? missed(x.id) - missed(y.id) : 0) || (planned(x.id) - planned(y.id)) || (satLast(y.id) - satLast(x.id)) || order(x, y));
    const chosen = cands.slice(0, onField - (k ? 1 : 0));
    const free = slots.slice(); const left = [];
    const flex = p => new Set(free.filter(s => fits(p, s))).size;
    const prefIdx = p => !p.pref ? -1 : LINE[p.pref] === p.pref ? free.findIndex(s => lineOf(s) === p.pref) : free.indexOf(p.pref);
    // 1) voorkeursplek (wie het minst flexibel is, gaat voor); 2) zelfde plek als vorig blok; 3) een specifiek aangevinkte plek; 4) elke plek in een aangevinkte linie.
    const rest = [];
    chosen.slice().sort((x, y) => (flex(x) || 99) - (flex(y) || 99)).forEach(p => {
      const i = prefIdx(p);
      if (i < 0) { rest.push(p); return; }
      cells[p.id][b] = free.splice(i, 1)[0];
    });
    rest.sort((x, y) => (flex(x) || 99) - (flex(y) || 99)).forEach(p => {
      const prev = b > 0 ? cells[p.id][b - 1] : null; const ps = p.positions || [];
      let i = prev && fits(p, prev) ? free.indexOf(prev) : -1;
      if (i < 0) i = free.findIndex(s => ps.includes(s));
      if (i < 0) i = free.findIndex(s => fits(p, s));
      if (i < 0) { left.push(p); return; }
      cells[p.id][b] = free.splice(i, 1)[0];
    });
    left.forEach(p => { cells[p.id][b] = free.length ? free.shift() : "CM"; });
  }
  m.lineup = { cells, durs, matchMinutes: old ? old.matchMinutes : +S.settings.matchMinutes || 60, created: old ? old.created : Date.now(), adj, out: [...out] };
}

// Een vakje in het wisselschema aanpassen. Komt een plek daardoor dubbel te staan, dan ruilt degene die er stond mee
// (hij krijgt de oude plek van deze speler, of gaat naar de bank). Geeft terug wie er meeruilde.
function setCell(m, pid, b, v) {
  const cells = m.lineup.cells; const old = cells[pid][b]; if (old === v) return null;
  cells[pid][b] = v; if (v === "-") return null;
  const max = v === "K" ? 1 : slotsFor().filter(x => x === v).length || 1;
  const holders = Object.keys(cells).filter(id => id !== pid && cells[id][b] === v);
  if (holders.length + 1 <= max) return null;
  const other = holders[0]; cells[other][b] = old; return other;
}
function swapCells(m, a, c, b) { const cells = m.lineup.cells; const x = cells[a][b]; cells[a][b] = cells[c][b]; cells[c][b] = x; }
const fitsSlot = (p, slot) => slot === "-" || (slot === "K" ? ((p.positions || []).includes("K") || (p.positions || []).includes("R")) : fits(p, slot));
// Opstelling van één blok als veld: aanval boven, keeper onder. Tik twee spelers aan om ze te ruilen.
const PITCH_ROWS = [["LA", "SP", "A", "RA"], ["AM"], ["LM", "CM", "M", "RM"], ["VM"], ["LB", "CV", "V", "RB"], ["K"]];
function pitchView(m) {
  const d = lineupDurs(m); const C = d.length; const b = Math.min(ui.pitchBlock || 0, C - 1); const cells = m.lineup.cells;
  const at = d.map((_, i) => d.slice(0, i).reduce((a, x) => a + x, 0));
  const ids = present(m).filter(p => cells[p.id]).map(p => p.id);
  const chip = id => { const p = pById(id); const c = cells[id][b]; const off = p && !fitsSlot(p, c);
    return `<button type="button" class="pchip ${ui.pick === id ? "picked" : ""} ${off ? "off" : ""} ${c === "K" ? "keeper" : ""}" data-act="pick" data-id="${id}" aria-pressed="${ui.pick === id}"><b>${c === "-" ? "" : esc(c)}${p && p.nr ? " · " + esc(p.nr) : ""}</b>${esc(shortName(id))}${off ? " ⚠" : ""}</button>`; };
  const rows = PITCH_ROWS.map(r => ids.filter(id => r.includes(cells[id][b])).sort((x, y) => r.indexOf(cells[x][b]) - r.indexOf(cells[y][b]))).filter(r => r.length);
  const bench = ids.filter(id => cells[id][b] === "-");
  const offN = ids.filter(id => { const p = pById(id); return p && !fitsSlot(p, cells[id][b]); }).length;
  return `<div class="card"><div class="row between"><h3>Opstelling</h3><span class="small muted">${Math.round(at[b])}′–${Math.round(at[b] + d[b])}′</span></div>
    <div class="blocktabs" role="tablist">${d.map((_, i) => `<button type="button" role="tab" class="btn ${i === b ? "primary" : ""}" aria-selected="${i === b}" data-act="pitchblock" data-b="${i}">Blok ${i + 1}</button>`).join("")}</div>
    <div class="pitch">${rows.map(r => `<div class="prow">${r.map(chip).join("")}</div>`).join("")}</div>
    <div class="benchrow"><span class="small muted">Bank</span>${bench.map(chip).join("") || '<span class="small muted">niemand</span>'}</div>
    <p class="small muted">${ui.pick ? `<strong>${esc(pName(ui.pick))}</strong> gekozen: tik op de speler waarmee hij ruilt.` : "Tik op een speler en daarna op een andere om ze in dit blok te ruilen, ook met de bank."}${offN ? " ⚠ = staat niet op een plek die bij Spelers is aangevinkt." : ""}</p></div>`;
}
// Voornaam, met de eerste letter van de achternaam als er twee dezelfde voornamen zijn.
function shortName(id) {
  const p = pById(id); if (!p) return "?"; const parts = p.name.trim().split(/\s+/); const first = parts[0];
  const dup = S.players.some(x => x.id !== id && x.name.trim().split(/\s+/)[0] === first);
  return dup && parts.length > 1 ? first + " " + parts[parts.length - 1][0] + "." : first;
}
// ---------- wedstrijdmodus (langs het veld) ----------
// m.live = { acc: gespeelde ms, since: starttijd als de klok loopt, halfDone, swaps: [{ b, out, in, t }] }
const liveOf = m => (m.live = m.live || { acc: 0, since: null, halfDone: false, swaps: [] });
const liveMs = m => { const L = liveOf(m); return L.acc + (L.since ? Date.now() - L.since : 0); };
const liveTotal = m => lineupDurs(m).reduce((a, x) => a + x, 0);
function liveBlock(m, min) {
  const d = lineupDurs(m); let at = 0;
  for (let b = 0; b < d.length; b++) { if (min < at + d[b] - 1e-9) return { b, start: at, end: at + d[b] }; at += d[b]; }
  return { b: d.length, start: at, end: at };
}
// Wie staat er in blok b in het veld (met de wissels die tijdens dat blok anders gingen dan gepland)?
function fieldAt(m, b, withSwaps = true) {
  const f = {}; Object.entries(m.lineup.cells).forEach(([id, r]) => { if (r[b] && r[b] !== "-") f[id] = r[b]; });
  if (withSwaps) (liveOf(m).swaps || []).filter(x => x.b === b).forEach(x => { const pos = f[x.out]; if (pos) { delete f[x.out]; f[x.in] = pos; } });
  return f;
}
const clockText = ms => { const sec = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); };
let audio = null, wakeLock = null, liveTimer = null;
function beep() {
  try { navigator.vibrate && navigator.vibrate([300, 120, 300]); } catch (e) {}
  try { if (!audio) return; const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.25, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6); o.start(); o.stop(audio.currentTime + 0.6); } catch (e) {}
}
async function keepAwake(on) {
  try { if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ui.live) { const m = S.matches.find(x => x.id === ui.live); if (m && liveOf(m).since) keepAwake(true); } });
function liveTick() {
  const m = ui.live && S.matches.find(x => x.id === ui.live && x.lineup);
  if (!m || mode === "shared") { clearInterval(liveTimer); liveTimer = null; return; }
  const L = liveOf(m); const total = liveTotal(m);
  let min = liveMs(m) / 60000;
  if (L.since && !L.halfDone && min >= total / 2) { L.acc = total / 2 * 60000; L.since = null; L.halfDone = true; save(); beep(); keepAwake(false); render(); toast("Rust! Tik op Start voor de tweede helft."); return; }
  if (L.since && min >= total) { L.acc = total * 60000; L.since = null; save(); beep(); keepAwake(false); render(); toast("Speeltijd voorbij. Tik op Wedstrijd afgelopen als het klaar is."); return; }
  const blk = liveBlock(m, min);
  if (ui.liveBlock != null && blk.b !== ui.liveBlock) { ui.liveBlock = blk.b; if (L.since) beep(); render(); return; }
  ui.liveBlock = blk.b;
  const c = document.getElementById("live-clock"); if (c) c.textContent = clockText(liveMs(m));
  const n = document.getElementById("live-next"); if (n) n.textContent = blk.b < lineupDurs(m).length - 1 ? "over " + clockText((blk.end - min) * 60000) : "";
}
function startLiveTimer() { if (!liveTimer) liveTimer = setInterval(liveTick, 1000); }
function liveSwap(m, outId, inId) {
  const min = liveMs(m) / 60000; const blk = liveBlock(m, min); if (blk.b >= lineupDurs(m).length) return false;
  const left = blk.end - min; const adj = m.lineup.adj = m.lineup.adj || {};
  adj[outId] = (adj[outId] || 0) - left; adj[inId] = (adj[inId] || 0) + left;
  liveOf(m).swaps.push({ b: blk.b, out: outId, in: inId, t: Math.round(min * 10) / 10 });
  return true;
}
function liveInjured(m, pid) {
  const min = liveMs(m) / 60000; const blk = liveBlock(m, min); const C = lineupDurs(m).length;
  const f = fieldAt(m, blk.b);
  if (f[pid] && blk.b < C) {
    const out = new Set(m.lineup.out || []); out.add(pid);
    const bench = present(m).filter(p => !f[p.id] && !out.has(p.id)).sort((a, b) => lineupMinutes(m, a.id) - lineupMinutes(m, b.id));
    if (bench.length) liveSwap(m, pid, bench[0].id);
    else { const adj = m.lineup.adj = m.lineup.adj || {}; adj[pid] = (adj[pid] || 0) - (blk.end - min); }
  }
  const ex = [...new Set([...(m.lineup.out || []), pid])];
  if (blk.b + 1 < C) planLineup(m, { from: blk.b + 1, exclude: ex }); else m.lineup.out = ex;
}
function liveLate(m, pid) {
  m.absent = (m.absent || []).filter(x => x !== pid);
  const blk = liveBlock(m, liveMs(m) / 60000); const C = lineupDurs(m).length;
  if (blk.b + 1 < C) planLineup(m, { from: blk.b + 1, exclude: m.lineup.out || [] });
  else m.lineup.cells[pid] = m.lineup.cells[pid] || Array(C).fill("-");
}
function vLive(m) {
  const L = liveOf(m); const d = lineupDurs(m); const C = d.length; const total = liveTotal(m);
  const min = liveMs(m) / 60000; const blk = liveBlock(m, min); ui.liveBlock = blk.b; startLiveTimer();
  const f = blk.b < C ? fieldAt(m, blk.b) : {}; const outSet = new Set(m.lineup.out || []);
  const onIds = Object.keys(f).sort((a, b) => POS_ORDER.indexOf(f[a]) - POS_ORDER.indexOf(f[b]) || pName(a).localeCompare(pName(b)));
  const bench = present(m).filter(p => !f[p.id]).sort((a, b) => a.name.localeCompare(b.name));
  let next = "";
  if (blk.b < C - 1) {
    const nf = fieldAt(m, blk.b + 1, false); const ins = Object.keys(nf).filter(id => !f[id]), outs = Object.keys(f).filter(id => !nf[id]);
    next = `<div class="card live-next"><h3>Volgende wissel <span class="muted" id="live-next">over ${clockText((blk.end - min) * 60000)}</span></h3>
      ${ins.length || outs.length ? `<div class="duty"><span>Erin</span><div><strong>${ins.map(id => esc(pName(id)) + ` <span class="muted small">${esc(nf[id])}</span>`).join(", ") || "–"}</strong></div></div>
      <div class="duty"><span>Eruit</span><div>${outs.map(id => esc(pName(id))).join(", ") || "–"}</div></div>` : `<p class="small muted">Geen wissels, alleen eventueel andere posities.</p>`}</div>`;
  }
  const running = !!L.since; const ended = min >= total - 1e-9;
  const half = L.halfDone ? "2e helft" : "1e helft";
  const opt = list => list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const onPlayers = onIds.map(pById).filter(Boolean);
  const absentKids = squad(m).filter(p => (m.absent || []).includes(p.id));
  return `<div class="live">
    <div class="row between"><button class="btn ghost" data-act="liveexit">← Terug</button><span class="date">${esc(fmtDate(m.date))} · ${m.home ? "thuis" : "uit"} · ${esc(m.opponent)}</span></div>
    <div class="card live-clock-card"><div class="live-clock" id="live-clock">${clockText(liveMs(m))}</div>
      <p class="small muted">${ended ? "Speeltijd voorbij" : half + " · blok " + Math.min(C, blk.b + 1) + " van " + C}${L.swaps.length ? " · " + L.swaps.length + " wissel(s) anders dan gepland" : ""}</p>
      <div class="row" style="justify-content:center">${ended ? "" : `<button class="btn primary big" data-act="liveclock">${running ? "Pauze" : min > 0 ? (L.halfDone && Math.abs(min - total / 2) < 0.02 ? "Start 2e helft" : "Verder") : "Start wedstrijd"}</button>`}
      <button class="btn ${ui.arm === "liveend" ? "arm" : ""}" data-act="liveend">${ui.arm === "liveend" ? "Zeker? Minuten tellen dan mee" : "Wedstrijd afgelopen"}</button></div></div>
    ${next}
    <div class="card"><h3>In het veld</h3><div class="live-field">${onIds.map(id => `<div><span class="pill cell-${lineOf(f[id])}">${esc(f[id])}</span> ${nrTag(pById(id))}${esc(pName(id))}</div>`).join("") || '<p class="small muted">–</p>'}</div></div>
    <div class="card"><h3>Bank</h3><p>${bench.map(p => esc(p.name) + (outSet.has(p.id) ? ' <span class="pill warn">kan niet verder</span>' : "")).join(", ") || '<span class="muted small">niemand</span>'}</p></div>
    ${ended ? "" : `<details class="card"><summary>Nu anders wisselen</summary>
      <div class="grid2"><label class="f">Eruit<select id="lv-out">${opt(onPlayers)}</select></label><label class="f">Erin<select id="lv-in">${opt(bench.filter(p => !outSet.has(p.id)))}</select></label></div>
      <div class="row"><button class="btn" data-act="liveswap">Wissel nu</button></div>
      <p class="small muted">De minuten tellen mee zoals het echt ging. Het volgende blok gaat weer volgens het schema.</p></details>
    <details class="card"><summary>Blessure of moet weg</summary>
      <label class="f">Speler<select id="lv-inj">${opt(onPlayers.concat(bench.filter(p => !outSet.has(p.id))))}</select></label>
      <div class="row"><button class="btn" data-act="liveinj">Kan niet verder spelen</button></div>
      <p class="small muted">Staat de speler in het veld, dan komt degene van de bank met de minste minuten erin. De rest van het schema wordt opnieuw verdeeld.</p></details>
    ${absentKids.length ? `<details class="card"><summary>Speler komt later</summary>
      <label class="f">Speler<select id="lv-late">${opt(absentKids)}</select></label>
      <div class="row"><button class="btn" data-act="livelate">Is er nu, doet mee</button></div>
      <p class="small muted">De speler doet mee vanaf het volgende blok; de rest van het schema wordt opnieuw verdeeld.</p></details>` : ""}`}
  </div>`;
}

// ---------- WhatsApp text ----------
function prevWash(m) {
  const before = sorted().filter(x => byDate(x, m) < 0 && x.duties && (x.duties.wash || []).length);
  return before.length ? before[before.length - 1].duties.wash : [];
}
// Bericht voor de groepsapp (WhatsApp: *vet*, _schuin_).
function matchText(m) {
  const tm = times(m); const d = m.duties || {}; const st = S.settings;
  const own = [st.club, st.team].filter(Boolean).join(" ") || t("Wij");
  const day = (() => { try { return new Date(m.date + "T12:00").toLocaleDateString(window.I18N ? I18N.locale : "nl-NL", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return m.date; } })();
  const names = ids => ids.map(pName).join(" & "); const pl = ids => joinParents(ids);
  const L = [];
  const ball = isHockey() ? "🏑" : "⚽";
  if (m.cancelled) return "❌ *" + t("Afgelast:") + "* " + day + ", " + (m.home ? own + " – " + (m.opponent || "?") : (m.opponent || "?") + " – " + own) + "\n" + t("Er hoeft niemand te rijden, te vlaggen of te wassen.");
  L.push(ball + " *" + t("Wedstrijd {day}", { day }) + "* " + ball);
  if (m.moved) L.push("📅 " + t("Let op: deze wedstrijd is verplaatst."));
  L.push("");
  L.push("🏟️ *" + (m.home ? own + " – " + (m.opponent || "?") : (m.opponent || "?") + " – " + own) + "*" + " " + (m.home ? t("(thuis)") : t("(uit)")));
  if (!m.home) {
    L.push("🚗 " + t("Vertrek vanaf ons sportcomplex:") + " " + (tm.depart === "?" ? t("volgt nog") : "*" + tm.depart + "*"));
    if ((d.drive || []).length) L.push("   " + t("Rijders:") + " " + pl(d.drive));
    if (m.address) L.push("📍 " + m.address);
  }
  L.push("⏰ " + t("Aanwezig:") + " *" + tm.arrive + "* " + (m.home ? t("in de kleedkamer") : t("bij {club}", { club: m.opponent ? clubFromTeam(m.opponent) || m.opponent : t("de uitclub") })));
  L.push("🟢 " + t("Aftrap:") + " *" + tm.ko + "*");
  if ((d.flag || []).length) L.push((isHockey() ? "🟨 " : "🚩 ") + t(flagWord() + ":") + " " + pl(d.flag));
  const pw = prevWash(m).filter(id => pById(id));
  if (st.washPerMatch) {
    if (pw.length) L.push("🧺 " + t("Wastas mee naar de wedstrijd:") + " *" + names(pw) + "*");
    if ((d.wash || []).length) L.push("🧺 " + t("Wastas mee naar huis (wassen):") + " *" + names(d.wash) + "*");
  }
  if ((m.absent || []).length) L.push("🤕 " + t("Afwezig:") + " " + m.absent.map(pName).join(", "));
  L.push("");
  L.push(t("Kun je niet op je beurt? Ruil even met een andere ouder. Zet 'm op, {team}! 💪", { team: st.team || t("team") }));
  return L.join("\n");
}

// ---------- rendering ----------
const TABS = [["planning", "Planning"], ["matches", "Wedstrijden"], ["players", "Spelers"], ["lineup", "Wissels"], ["season", "Seizoen"], ["settings", "Instellingen"]];
function render() {
  setSportLabels(); PRESETS = presetsFor(sport());
  const ls = document.getElementById("lang");
  if (ls && window.I18N && !ls.options.length) ls.innerHTML = Object.entries(I18N.LANGS).map(([k, l]) => `<option value="${k}" ${k === I18N.lang ? "selected" : ""}>${l}</option>`).join("");
  const s = S.settings; const inTeam = ["local", "cloud", "shared"].includes(mode);
  document.getElementById("brand").innerHTML = (inTeam && s.logoUrl ? `<img class="logo" src="${esc(s.logoUrl)}" alt="">` : "") +
    "<span>" + (inTeam ? esc(s.team || "Teamplanner") + "<small>" + esc(s.club || (isHockey() ? "Jeugdhockey" : "Jeugdvoetbal")) + "</small>" : "Teamplanner<small>Jeugdsport</small>") + "</span>";
  const tabs = mode === "shared" ? TABS.filter(t => t[0] === "planning") : inTeam ? TABS : [];
  document.getElementById("tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${mode === "shared" ? t(l) : l}</button>`).join("");
  const main = document.getElementById("main");
  const st = { el: document.activeElement && document.activeElement.id };
  if (!inTeam) { main.innerHTML = ({ loading: vLoading, login: vLogin, newteam: vNewTeam, error: vError }[mode] || vLoading)(); return; }
  if (mode === "shared") ui.tab = "planning";
  const live = ui.live && canEdit() && S.matches.find(x => x.id === ui.live && x.lineup);
  document.body.classList.toggle("live-on", !!live);
  main.innerHTML = conflictCard() + schemaBanner() + (live ? vLive(live) : ({ planning: vPlanning, matches: vMatches, players: vPlayers, lineup: vLineup, season: vSeason, settings: vSettings }[ui.tab] || vPlanning)());
  setTimeout(autoTravel, 300);
  if (canEdit() && ui.tab === "settings" && !S.settings.homeAddress && S.settings.club && !ui.homeTried) {
    ui.homeTried = true; ensureHome().then(h => { if (h) { render(); toast("Adres van je sportcomplex gevonden. Controleer het even."); } });
  }
  if (st.el) { const el = document.getElementById(st.el); if (el) el.focus(); }
}
// De database is ouder dan deze versie van de app: het script moet opnieuw draaien.
function schemaBanner() {
  if (mode !== "cloud" || !schemaVersion || schemaVersion >= SCHEMA_NEEDED) return "";
  return `<div class="notice"><strong>De database moet bijgewerkt worden.</strong> Open Supabase → SQL Editor → New query, plak de inhoud van <em>supabase/schema.sql</em> uit de repository en klik op Run. Tot die tijd werken mede-coaches, eerdere versies en de controle op gelijktijdig wijzigen niet.</div>`;
}
function vLoading() { return `<div class="card empty"><p class="muted">${t("Laden…")}</p></div>`; }
function vError() { return `<div class="card empty"><h2>Dat lukt niet</h2><p class="muted">${esc(errorText)}</p><a class="btn" href="${location.pathname}">Naar de beginpagina</a></div>`; }
function vLogin() {
  return `<form class="card" id="loginform" style="max-width:460px;justify-self:center;width:100%"><h2>Inloggen</h2>
    ${(() => { try { return localStorage.getItem("teamplanner.invite"); } catch (e) { return null; } })() ? `<div class="notice">Je bent uitgenodigd als coach van een team. Log in met je e-mailadres; daarna zie je het team meteen.</div>` : ""}
    <p class="muted">Plan rijders, grensrechters, de was en een eerlijk wisselschema voor je jeugdteam. Je logt in met je e-mailadres, zonder wachtwoord.</p>
    <p class="small"><a href="privacy.html">Wat bewaart de app en wie ziet wat?</a></p>
    ${ui.loginSent ? `<div class="notice">We hebben een mail gestuurd naar ${esc(ui.loginEmail)}. Open die mail op dit apparaat en tik op de link om in te loggen. Geen mail gezien? Kijk ook bij spam.</div>
      <details><summary>Staat er een code in de mail?</summary><div class="stack" style="margin-top:8px">
      <label class="f">Code uit de mail<input id="lf-code" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
      <div class="row"><button class="btn primary" type="submit">Inloggen met code</button></div></div></details>
      <div class="row"><button class="btn ghost" type="button" data-act="loginreset">Ander e-mailadres</button></div>`
    : `<label class="f">E-mailadres<input id="lf-email" name="email" type="email" autocomplete="email" required value="${esc(ui.loginEmail)}"></label>
      <div class="row"><button class="btn primary" type="submit">Stuur inloglink</button></div>`}
  </form>`;
}
function vNewTeam() {
  const local = readLocal(LS_KEY); const hasLocal = local && (local.players.length || local.matches.length);
  return `<form class="card" id="newteamform" style="max-width:520px;justify-self:center;width:100%"><h2>${teams.length ? "Nieuw team" : "Welkom, coach"}</h2>
    <p class="muted">Kies je sport en je club, en vul je team in. Je kunt later meer teams toevoegen.</p>
    <label class="f" style="max-width:240px">Sport<select id="nt-sport" name="sport" data-act="ntsport">${Object.entries(SPORTS).map(([k, l]) => `<option value="${k}" ${(ui.newSport || "voetbal") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${clubSearchBlock("nt")}
    <div class="grid2">
      <label class="f">Club<input id="nt-club" name="club" required placeholder="bv. VV Balk"></label>
      <label class="f">Team<input id="nt-team" name="team" required placeholder="bv. JO15-2"></label>
    </div>
    <label class="f">Adres eigen sportcomplex<input id="nt-addr" name="address" placeholder="bv. Sportpark De Wissel, Balk"></label>
    ${hasLocal ? `<div class="checks"><label><input type="checkbox" name="fromLocal" checked> Neem de gegevens over die al in deze browser staan (${local.players.length} spelers, ${local.matches.length} wedstrijden)</label></div>` : ""}
    <div class="row"><button class="btn primary" type="submit">Team aanmaken</button>${teams.length ? '<button class="btn ghost" type="button" data-act="cancelnewteam">Annuleren</button>' : ""}</div>
  </form>`;
}
function accountCard() {
  if (mode === "local") return `<div class="card"><h3>Gegevens</h3><p class="small muted">Je gegevens staan alleen in deze browser. Maak af en toe een back-up hieronder.</p></div>`;
  const url = shareUrl();
  return `<div class="card"><h3>Team en account</h3>
    <p class="small muted">Ingelogd als ${esc(user && user.email)}. Alles wordt online bewaard, zodat je het op je telefoon en computer ziet.</p>
    <div class="grid2"><label class="f">Team<select id="team-pick" data-act="pickteam">${teams.map(t => `<option value="${t.id}" ${t.id === teamId ? "selected" : ""}>${esc(t.name || "Naamloos team")}</option>`).join("")}</select></label></div>
    <div class="row"><button class="btn" data-act="newteam">Nieuw team</button><button class="btn ghost" data-act="logout">Uitloggen</button></div>
    <h3>Kijklink voor ouders</h3>
    <p class="small muted">Met deze link zien ouders de komende wedstrijden, tijden en taken. Ze kunnen niets wijzigen en zien geen wisselschema's.</p>
    <input id="share-url" readonly value="${esc(url)}" aria-label="Kijklink">
    <div class="row"><button class="btn primary" data-act="copyshare">Kopieer kijklink</button><button class="btn ${ui.arm === "rotate" ? "arm" : "ghost"}" data-act="rotate">${ui.arm === "rotate" ? "Zeker? De oude link stopt" : "Nieuwe link maken"}</button></div>
  </div>
  ${coachesCard()}`;
}
const isOwner = () => { const t = teams.find(x => x.id === teamId); return !t || !t.owner || !user || t.owner === user.id; };
// ---------- nieuw seizoen en spelers naar een ander team ----------
function seasonCard() {
  if (!canEdit() || !S.players.length) return "";
  const others = mode === "cloud" ? teams.filter(t => t.id !== teamId) : [];
  return `<div class="card"><h3>Nieuw seizoen of nieuwe periode</h3>
    <p class="small muted">Begin opnieuw met dezelfde spelers. Voorbije wedstrijden gaan weg, dus speelminuten en taken tellen weer vanaf nul. De huidige stand bewaart de app eerst bij Eerdere versies.</p>
    <div class="checks"><label><input type="checkbox" id="ns-future"> Ook alle komende wedstrijden weghalen</label></div>
    <div class="row"><button class="btn ${ui.arm === "newseason" ? "arm" : ""}" data-act="newseason">${ui.arm === "newseason" ? "Zeker? Tik nogmaals" : "Start nieuwe periode"}</button></div>
    ${others.length ? `<h3>Spelers naar een ander team</h3>
    <p class="small muted">Nieuwe teamindeling? Kopieer spelers met hun posities en ouders naar een ander team van jou. Hier blijven ze staan tot je ze bij Spelers verwijdert.</p>
    <details><summary>Spelers kiezen</summary><div class="checks" style="margin-top:8px">${S.players.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<label><input type="checkbox" name="cp" value="${p.id}"> ${esc(p.name)}</label>`).join("")}</div></details>
    <div class="grid2"><label class="f">Naar team<select id="cp-team">${others.map(t => `<option value="${t.id}">${esc(t.name || "Naamloos team")}</option>`).join("")}</select></label></div>
    <div class="row"><button class="btn" data-act="copyplayers">Kopieer naar dat team</button></div>` : ""}
  </div>`;
}
async function newSeason() {
  const all = document.getElementById("ns-future") && document.getElementById("ns-future").checked;
  await snapshot("vóór nieuwe periode");
  const today = todayStr(); const before = S.matches.length;
  S.matches = all ? [] : S.matches.filter(m => m.date >= today);
  S.matches.forEach(m => { delete m.lineup; delete m.played; delete m.live; });
  if (mode === "cloud" && round.open) await setRound(false, []);
  save(); render(); toast((before - S.matches.length) + " wedstrijd(en) weggehaald. Succes met de nieuwe periode!");
}
async function copyPlayers() {
  const ids = [...document.querySelectorAll('input[name="cp"]:checked')].map(x => x.value); const target = document.getElementById("cp-team").value;
  if (!ids.length) { toast("Kies eerst spelers."); return; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await sb.from("teams").select(hasRev() ? "data,rev" : "data").eq("id", target).single();
    if (error) { toast("Dat team kon niet geladen worden."); return; }
    const T = normalize(data.data); const have = new Set(T.players.map(p => p.name.toLowerCase())); let n = 0;
    S.players.filter(p => ids.includes(p.id) && !have.has(p.name.toLowerCase())).forEach(p => {
      const c = JSON.parse(JSON.stringify(p)); c.id = uid(); T.players.push(c); n++; });
    T.updatedAt = Date.now();
    let q = sb.from("teams").update({ data: T }).eq("id", target); if (hasRev()) q = q.eq("rev", data.rev);
    const r = await q.select("id");
    if (r.error) { toast("Kopiëren lukte niet: " + r.error.message); return; }
    if (r.data && r.data.length) { writeLS(LS_KEY + "." + target, null); toast(n + " speler(s) gekopieerd" + (n < ids.length ? " (" + (ids.length - n) + " stond(en) er al)." : ".")); return; }
  }
  toast("Dat team werd tegelijk gewijzigd. Probeer het nog eens.");
}
// ---------- mede-coaches ----------
function coachesCard() {
  if (mode !== "cloud" || !hasRev()) return "";
  const pp = ui.people;
  return `<div class="card"><h3>Coaches van dit team</h3>
    <p class="small muted">Nodig je mede-trainer of leider uit. Die logt in met een eigen e-mailadres en kan daarna alles in dit team zien en wijzigen. De uitnodigingslink werkt 14 dagen; deel hem alleen met de coaches zelf, niet in de oudergroep.</p>
    ${!pp ? `<div class="row"><button class="btn" data-act="people">Toon coaches</button></div>` : pp.loading ? `<p class="small muted">Laden…</p>`
      : `<div class="stack">${pp.list.map(x => `<div class="row between version"><span>${esc(x.email || "onbekend")} ${x.is_owner ? '<span class="pill">eigenaar</span>' : ""}${user && x.user_id === user.id ? ' <span class="muted small">(jij)</span>' : ""}</span>
        ${!x.is_owner && isOwner() && x.user_id !== user.id ? `<button class="btn ${ui.arm === "kick" + x.user_id ? "arm" : "ghost danger"}" data-act="kick" data-id="${x.user_id}">${ui.arm === "kick" + x.user_id ? "Zeker? Tik nogmaals" : "Weghalen"}</button>` : ""}</div>`).join("")}</div>`}
    ${ui.invite ? `<input id="invite-url" readonly value="${esc(ui.invite)}" aria-label="Uitnodigingslink"><div class="row"><button class="btn primary" data-act="copyinvite">Kopieer uitnodiging</button></div>`
      : `<div class="row"><button class="btn" data-act="invite">Mede-coach uitnodigen</button></div>`}
  </div>`;
}
async function loadPeople() {
  ui.people = { loading: true }; render();
  const { data, error } = await sb.rpc("team_people", { p_team: teamId });
  ui.people = error ? null : { list: data || [] }; if (error) toast("Coaches ophalen lukte niet."); render();
}
async function makeInvite() {
  const tok = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  const { error } = await sb.from("team_invites").insert({ team_id: teamId, token: tok });
  if (error) { toast("Uitnodiging maken lukte niet: " + error.message); return; }
  ui.invite = location.origin + location.pathname + "?uitnodiging=" + tok; render();
}
const inviteText = () => "Hoi! Wil je samen met mij het schema van " + teamName() + " bijhouden in de Teamplanner? Open deze link en log in met je e-mailadres (de link werkt 14 dagen):\n" + ui.invite;
async function kickCoach(uid) {
  const { error } = await sb.from("team_members").delete().eq("team_id", teamId).eq("user_id", uid);
  if (error) { toast("Weghalen lukte niet."); return; }
  toast("Coach weggehaald."); loadPeople();
}
// ---------- team verwijderen, team verlaten, account opheffen ----------
function dangerCard() {
  if (mode !== "cloud") return "";
  const own = isOwner();
  return `<div class="card"><h3>Team of account verwijderen</h3>
    <p class="small muted">${own ? "Verwijder je dit team, dan verdwijnen alle spelers, wedstrijden, versies, het logo, de teamfoto en wat ouders hebben doorgegeven. De kijklink werkt dan niet meer. Dit kan niet ongedaan worden; maak eerst een back-up als je twijfelt." : "Je bent mede-coach van dit team. Verlaat je het team, dan zie je het niet meer; de gegevens blijven bij de eigenaar."}</p>
    <div class="row">${own ? `<button class="btn ${ui.arm === "delteam" ? "arm" : "danger"}" data-act="delteam">${ui.arm === "delteam" ? "Zeker? " + esc(teamName()) + " wordt helemaal verwijderd" : "Dit team verwijderen"}</button>`
      : `<button class="btn ${ui.arm === "leaveteam" ? "arm" : "danger"}" data-act="leaveteam">${ui.arm === "leaveteam" ? "Zeker? Tik nogmaals" : "Team verlaten"}</button>`}</div>
    <p class="small muted">Je account opheffen verwijdert je e-mailadres en alle teams waarvan jij de eigenaar bent. Bij teams waar je mede-coach bent, word je weggehaald.</p>
    <div class="row"><button class="btn ${ui.arm === "delaccount" ? "arm" : "danger"}" data-act="delaccount" ${hasRev() ? "" : "disabled"}>${ui.arm === "delaccount" ? "Zeker? Je account en eigen teams verdwijnen" : "Account opheffen"}</button></div>
  </div>`;
}
async function removeTeamMedia(id) {
  try { const { data } = await sb.storage.from("team-media").list(id); if (data && data.length) await sb.storage.from("team-media").remove(data.map(f => id + "/" + f.name)); } catch (e) {}
}
async function deleteTeam() {
  await removeTeamMedia(teamId);
  const { error } = await sb.from("teams").delete().eq("id", teamId);
  if (error) { toast("Verwijderen lukte niet: " + error.message); return; }
  writeLS(LS_KEY + "." + teamId, null); writeLS(pendKey(teamId), null);
  toast("Team verwijderd."); teamId = null; dirty = false; await loadTeams();
}
async function leaveTeam() {
  const { error } = await sb.from("team_members").delete().eq("team_id", teamId).eq("user_id", user.id);
  if (error) { toast("Dat lukte niet: " + error.message); return; }
  writeLS(LS_KEY + "." + teamId, null); toast("Je bent geen coach meer van dit team."); teamId = null; dirty = false; await loadTeams();
}
async function deleteAccount() {
  for (const t of teams.filter(t => t.owner === user.id)) await removeTeamMedia(t.id);
  const { error } = await sb.rpc("delete_my_account");
  if (error) { toast("Opheffen lukte niet: " + error.message); return; }
  try { Object.keys(localStorage).filter(k => k.startsWith("teamplanner.")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  dirty = false; await sb.auth.signOut(); user = null; teams = []; teamId = null; mode = "login"; render(); toast("Je account is opgeheven.");
}
function emptyStart() {
  return `<div class="card empty"><h2>Welkom, coach</h2>
  <p class="muted">Voer je spelers in met de posities en wat hun ouders kunnen doen, zet je wedstrijden erin en de planner maakt het rij-, grensrechter-, was- en wisselschema.</p>
  <div class="row" style="justify-content:center"><button class="btn primary" data-act="go" data-tab="settings">Begin met mijn team</button>
  <button class="btn" data-act="sample">Bekijk met voorbeeldteam</button></div></div>`;
}
// "ouders van Bram, Daan en Finn" in plaats van drie keer "ouders van".
function joinParents(ids) {
  const and = " " + t("en") + " "; const list = arr => arr.length > 1 ? arr.slice(0, -1).join(", ") + and + arr[arr.length - 1] : arr.join("");
  const ps = ids.map(pById).filter(Boolean); const named = ps.filter(p => p.parent), kids = ps.filter(p => !p.parent);
  const parts = named.map(p => p.parent + " (" + p.name + ")");
  if (kids.length) parts.push(t("ouders van {name}", { name: list(kids.map(p => p.name)) }));
  return list(parts);
}
function dutyRow(label, ids, extra) {
  return `<div class="duty"><span>${label}</span><div>${ids && ids.length ? esc(joinParents(ids)) : `<span class="muted">${t("niemand")}</span>`}${extra || ""}</div></div>`;
}
function matchCard(m, isNext) {
  const tm = times(m); const d = m.duties || {}; const issues = dutyIssues(m);
  if (m.cancelled) return `<article class="card cancelled">
    <div class="row between"><span class="date">${esc(fmtDate(m.date))}</span><span class="pill warn">${t("AFGELAST")}</span></div>
    <div class="opp"><bdi><s>${m.home ? "" : "@ "}${esc(m.opponent || t("Tegenstander?"))}</s></bdi></div>
    <div class="row actions"><button class="btn" data-act="copy" data-id="${m.id}">${t("Kopieer bericht")}</button>
    ${canEdit() ? `<button class="btn ghost" data-act="editmatch" data-id="${m.id}">Wijzig</button>` : ""}</div></article>`;
  return `<article class="card ${isNext ? "next" : ""}">
    <div class="row between"><span class="date">${esc(fmtDate(m.date))}${isNext ? " · " + t("eerstvolgende") : ""}</span>
      <span class="row">${m.moved ? `<span class="pill warn">${t("verplaatst")}</span>` : ""}${m.locked ? `<span class="pill lock">${t("vastgezet")}</span>` : ""}<span class="pill ${m.home ? "home" : "away"}">${m.home ? t("THUIS") : t("UIT")}</span></span></div>
    <div class="opp"><bdi>${m.home ? "" : "@ "}${esc(m.opponent || t("Tegenstander?"))}</bdi></div>
    <div class="times">
      ${m.home ? "" : `<div class="time key"><span>${t("Vertrek")}</span><b>${tm.depart}</b></div>`}
      <div class="time ${m.home ? "key" : ""}"><span>${t("Aanwezig")}</span><b>${tm.arrive}</b></div>
      <div class="time"><span>${t("Aftrap")}</span><b>${tm.ko}</b></div>
      ${m.home ? "" : `<div class="time"><span>${t("Reistijd")}</span><b>${+m.travel || "?"}${+m.travel ? "′" : ""}</b></div>`}
    </div>
    <div class="duties">
      ${m.home ? "" : dutyRow(t("Rijden"), d.drive)}
      ${(m.home || S.settings.flagAway) ? dutyRow(t(flagWord()), d.flag) : ""}
      ${S.settings.washPerMatch ? dutyRow(t("Wassen"), d.wash) : ""}
      ${(m.absent || []).length ? `<div class="duty"><span>${t("Afwezig")}</span><div class="warn-ink">${m.absent.map(id => esc(pName(id))).join(", ")}</div></div>` : ""}
    </div>
    ${ui.editDuties === m.id && canEdit() ? dutyEditor(m) : ""}
    ${!m.home && !+m.travel && canEdit() ? `<div class="notice">Nog geen reistijd, dus de vertrektijd klopt niet. <button class="btn" data-act="calcall">Bereken reistijden</button></div>` : ""}
    ${issues.map(i => `<div class="notice">${esc(i)}</div>`).join("")}
    <div class="row actions">
      <button class="btn" data-act="copy" data-id="${m.id}">${t("Kopieer bericht")}</button>
      ${!m.home && m.address ? `<a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(m.address)}" target="_blank" rel="noopener">${t("Route")}</a>` : ""}
      ${canEdit() ? `<button class="btn ghost" data-act="more" data-id="${m.id}" aria-expanded="${ui.more === m.id}">${ui.more === m.id ? t("Minder ▴") : t("Meer ▾")}</button>` : ""}
    </div>
    ${canEdit() && ui.more === m.id ? `<div class="row actions more">
      <button class="btn ghost" data-act="editmatch" data-id="${m.id}">Wijzig / afwezigen</button>
      <button class="btn ghost" data-act="tolineup" data-id="${m.id}">Wisselschema</button>
      <button class="btn ghost" data-act="editduties" data-id="${m.id}">${ui.editDuties === m.id ? "Klaar met ruilen" : "Taken ruilen"}</button>
      <button class="btn ghost" data-act="lock" data-id="${m.id}">${m.locked ? "Losmaken" : "Vastzetten"}</button>
    </div>` : ""}</article>`;
}
function dutyEditor(m) {
  const d = m.duties || {}; const fams = S.players.filter(p => !p.guest && activeAt(p, m)).sort((a, b) => a.name.localeCompare(b.name));
  const sel = (duty, i, val) => `<select id="de-${m.id}-${duty}-${i}" data-act="dutyset" data-m="${m.id}" data-d="${duty}" data-i="${i}" aria-label="${dutyName(duty)} ${i + 1}">
    <option value="">${val ? "— weghalen —" : "+ toevoegen"}</option>${fams.map(p => `<option value="${p.id}" ${p.id === val ? "selected" : ""}>${esc(parentLabel(p.id))}</option>`).join("")}</select>`;
  const row = (duty, multi) => { const cur = d[duty] || []; const slots = multi ? cur.concat([""]) : (cur.length ? cur : [""]);
    return `<div class="duty"><span>${dutyName(duty)}</span><div class="stack">${slots.map((v, i) => sel(duty, i, v)).join("")}</div></div>`; };
  return `<div class="card" style="padding:10px;background:var(--bg)"><p class="small muted">Ruilen ouders onderling? Pas het hier aan. Deze wedstrijd blijft daarna zoals jij hem instelt.</p><div class="duties">
    ${m.home ? "" : row("drive", true)}${(m.home || S.settings.flagAway) ? row("flag", false) : ""}${S.settings.washPerMatch ? row("wash", false) : ""}</div></div>`;
}
function vPlanning() {
  if (!S.players.length && !S.matches.length) return canEdit() ? emptyStart() : `<div class="card empty"><p class="muted">${t("De coach heeft nog geen wedstrijden ingepland.")}</p></div>`;
  const today = todayStr(); const up = sorted().filter(m => m.date >= today);
  const noDuty = up.filter(m => !m.duties && !m.cancelled).length;
  return `${S.settings.photoUrl ? `<img class="teamphoto" src="${esc(S.settings.photoUrl)}" alt="Teamfoto ${esc(S.settings.team)}">` : ""}
    <div class="row between"><div><h2>${t("Komende wedstrijden")}</h2><p class="muted small">${t("Aanwezig {n} min voor de aftrap. Bij uitwedstrijden rekent de planner de vertrektijd vanaf de thuisclub uit.", { n: S.settings.arriveBefore })}</p></div>
    ${canEdit() ? `<button class="btn primary" data-act="plan">${noDuty ? "Maak taakschema" : "Taakschema opnieuw verdelen"}</button>` : ""}</div>
    <p class="muted small" ${canEdit() ? "" : "hidden"}>Vastgezette en gespeelde wedstrijden blijven zoals ze zijn. De rest wordt eerlijk verdeeld: wie het minst vaak aan de beurt was, gaat voor.</p>
    ${roundCard()}${parentCard()}
    ${up.length ? up.map(m => matchCard(m, m === up.find(x => !x.cancelled))).join("") : `<div class="card empty"><p class="muted">${t("Nog geen komende wedstrijden.")}</p>${canEdit() ? '<button class="btn primary" data-act="newmatch">Wedstrijd toevoegen</button>' : ""}</div>`}
    ${mode === "shared" ? `<p class="small muted"><a href="privacy.html">${t("Privacy")}</a></p>` : ""}
    ${up.length ? `<div class="row"><button class="btn" data-act="copyall">${t("Kopieer hele schema")}</button>${canEdit() && up.some(m => !m.home && !+m.travel) ? '<button class="btn" data-act="calcall">Bereken ontbrekende reistijden</button>' : ""}</div>` : ""}`;
}
function matchForm(m) {
  const isNew = !m.id; const known = [...new Map(S.matches.filter(x => !x.home && x.opponent).map(x => [x.opponent, x])).values()];
  const maps = S.settings.homeAddress && m.address ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(S.settings.homeAddress)}&destination=${encodeURIComponent(m.address)}&travelmode=driving` : "";
  return `<form class="card" id="matchform" data-id="${m.id || ""}"><h3>${isNew ? "Nieuwe wedstrijd" : "Wedstrijd wijzigen"}</h3>
    <div class="grid2">
      <label class="f">Datum<input id="mf-date" type="date" name="date" value="${esc(m.date || "")}" required></label>
      <label class="f">Aftrap<input id="mf-time" type="time" name="time" value="${esc(m.time || "10:00")}" required></label>
      <label class="f">Thuis of uit<select id="mf-home" name="home"><option value="1" ${m.home !== false ? "selected" : ""}>Thuis</option><option value="0" ${m.home === false ? "selected" : ""}>Uit</option></select></label>
      <label class="f">Tegenstander<input id="mf-opp" name="opponent" list="opps" value="${esc(m.opponent || "")}" placeholder="bv. SV Oranje JO11-1" required></label>
    </div>
    ${isNew ? "" : `<div class="checks"><label><input type="checkbox" name="cancelled" ${m.cancelled ? "checked" : ""}> Afgelast (taken vervallen; wie aan de beurt was, komt een volgende keer weer aan de beurt na Taakschema opnieuw verdelen)</label></div>`}
    <datalist id="opps">${known.map(x => `<option value="${esc(x.opponent)}">`).join("")}</datalist>
    <div class="grid2" id="awayfields" ${m.home !== false ? "hidden" : ""}>
      <label class="f">Adres uitclub<input id="mf-addr" name="address" value="${esc(m.address || "")}" placeholder="Sportpark, straat, plaats"></label>
      <label class="f">Reistijd vanaf eigen sportcomplex (min)<span class="row" style="flex-wrap:nowrap"><input id="mf-travel" name="travel" type="number" min="0" step="1" value="${esc(m.travel ?? "")}"><button class="btn" type="button" data-act="calctravel">Bereken</button></span></label>
    </div>
    <p class="small muted" id="travel-info" ${m.home !== false ? "hidden" : ""}>${m.travelPlace ? "Berekend naar: " + esc(m.travelPlace) + (m.km ? " (" + m.km + " km)" : "") : "Laat je het adres leeg, dan zoekt de planner op de naam van de club."}</p>
    ${maps ? `<p class="small"><a href="${maps}" target="_blank" rel="noopener">Reistijd opzoeken in Google Maps</a></p>` : `<p class="small muted">Tip: vul je thuisadres in bij Instellingen, dan krijg je hier een link naar de route.</p>`}
    ${S.players.some(p => p.guest) ? `<div class="f"><span class="small muted">Gastspelers bij deze wedstrijd</span><div class="checks">${S.players.filter(p => p.guest).map(p => `<label><input type="checkbox" name="guests" value="${p.id}" ${(m.guests || []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>` : ""}
    ${S.players.length ? `<div class="f"><span class="small muted">Afwezig (ziek, vakantie, …)</span><div class="checks">${S.players.filter(p => !p.guest && activeAt(p, { date: m.date || todayStr() })).map(p => `<label><input type="checkbox" name="absent" value="${p.id}" ${(m.absent || []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>` : ""}
    <div class="row"><button class="btn primary" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="cancel">Annuleren</button>
    ${isNew ? "" : `<button class="btn ${ui.arm === "delm" + m.id ? "arm" : "danger"}" type="button" data-act="delmatch" data-id="${m.id}">${ui.arm === "delm" + m.id ? "Zeker weten? Tik nogmaals" : "Verwijderen"}</button>`}</div>
  </form>`;
}
function vMatches() {
  const list = sorted();
  const editing = ui.editMatch ? (ui.editMatch === "new" ? {} : S.matches.find(m => m.id === ui.editMatch)) : null;
  return `<div class="row between"><h2>Wedstrijden</h2><button class="btn primary" data-act="newmatch">Wedstrijd toevoegen</button></div>
    ${editing ? matchForm(editing) : ""}
    <details class="card" id="importbox" ${ui.importRows ? "open" : ""}><summary>Programma plakken of screenshot uploaden</summary>
      <p class="small muted">Open het programma van je team op de clubsite of in de app van je bond (bv. Voetbal.nl of de KNHB Match-app), selecteer de wedstrijden, kopieer ze en plak ze hieronder. Het formaat maakt niet uit: de planner zoekt zelf de datum, aftrap en de twee teams, ook als die op aparte regels staan. Klopt er iets niet, pas het dan aan in de lijst hieronder.${ownKeys().length ? "" : " Vul eerst je club in bij Instellingen, dan herkent hij thuis en uit."}</p>
      <textarea id="imp-text" aria-label="Geplakt programma" placeholder="za 2 nov 10:30  VV Balk JO15-2 - SC Joure JO15-1">${esc(ui.importText || "")}</textarea>
      <div class="row"><button class="btn" type="button" data-act="parse">Lees programma</button>
        <label class="btn ghost">📷 Screenshot uploaden<input type="file" accept="image/*" multiple data-ocr hidden></label></div>
      <p class="small muted">Een screenshot werkt ook: de planner leest de tekst op je telefoon uit (dat duurt de eerste keer even). Controleer daarna wel de lijst.</p>
      ${ui.importRows ? (ui.importRows.length ? `<div class="tablewrap"><table><thead><tr><th></th><th>Datum</th><th>Aftrap</th><th>T/U</th><th>Tegenstander</th></tr></thead><tbody>
        ${ui.importRows.map((r, i) => `<tr style="${r.dup ? "opacity:.55" : ""}"><td><input type="checkbox" id="imp-on-${i}" data-act="impon" data-i="${i}" ${r.dup ? "" : "checked"} aria-label="Toevoegen"></td><td>${esc(fmtDate(r.date))}</td><td>${r.time}</td>
        <td><select id="imp-home-${i}" data-act="imphome" data-i="${i}" style="width:84px"><option value="1" ${r.home ? "selected" : ""}>Thuis</option><option value="0" ${r.home ? "" : "selected"}>Uit</option></select>${r.unsure ? ' <span class="pill warn">?</span>' : ""}</td>
        <td>${esc(r.opponent)}${r.dup ? ' <span class="pill">staat er al</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
        <div class="row"><button class="btn primary" type="button" data-act="import">Geselecteerde wedstrijden toevoegen</button></div>
        <p class="small muted">Vul daarna bij uitwedstrijden het adres en de reistijd in via Wijzig.</p>`
        : `<div class="notice">Geen wedstrijden gevonden. Zorg dat bij elke wedstrijd een datum, een aftrap (bv. 10:30) en de twee teams staan.</div>`) : ""}
    </details>
    ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Datum</th><th></th><th>Tegenstander</th><th>Aftrap</th><th>Aanwezig</th><th>Vertrek</th><th></th></tr></thead><tbody>
    ${list.map(m => { const t = times(m); return `<tr style="${isPast(m) ? "opacity:.6" : ""}"><td>${esc(fmtDate(m.date))}</td><td><span class="pill ${m.home ? "home" : "away"}">${m.home ? "T" : "U"}</span></td><td>${m.cancelled ? "<s>" + esc(m.opponent) + "</s> " + '<span class="pill warn">afgelast</span>' : esc(m.opponent)}${m.moved && !m.cancelled ? ' <span class="pill warn">verplaatst</span>' : ""}</td><td>${t.ko}</td><td>${t.arrive}</td><td>${t.depart || "–"}</td><td><button class="btn ghost small" data-act="editmatch" data-id="${m.id}">Wijzig</button></td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="muted">Nog geen wedstrijden. Voeg het programma toe zoals het op de clubsite staat.</p>`}`;
}
function playerForm(p) {
  const isNew = !p.id;
  return `<form class="card" id="playerform" data-id="${p.id || ""}"><h3>${isNew ? "Nieuwe speler" : esc(p.name)}</h3>
    <div class="grid2">
      <label class="f">Naam speler<input id="pf-name" name="name" value="${esc(p.name || "")}" required></label>
      <label class="f">Naam ouder(s)<input id="pf-parent" name="parent" value="${esc(p.parent || "")}" placeholder="bv. Sanne & Mark"></label>
      <label class="f">Rugnummer (mag leeg)<input id="pf-nr" name="nr" inputmode="numeric" maxlength="3" value="${esc(p.nr || "")}"></label>
    </div>
    <div class="f"><span class="small muted">Soort speler</span><div class="checks" style="flex-direction:column">
      <label><input type="checkbox" name="guest" ${p.guest ? "checked" : ""}> Gastspeler van een ander team: doet alleen mee in wedstrijden waar je hem bij zet (bij Wissels → Wie is er?), en de ouders krijgen geen taken</label>
      ${isNew ? "" : `<label><input type="checkbox" name="inactive" ${p.inactiveFrom ? "checked" : ""}> Niet meer actief (gestopt of naar een ander team)${p.inactiveFrom ? " sinds " + esc(fmtDate(p.inactiveFrom)) : ""}: telt niet meer mee voor nieuwe schema's; de speelminuten en taken tot nu toe blijven staan</label>`}</div></div>
    <div class="f"><span class="small muted">Posities</span>${POS_GROUPS.map(([g, o]) => `<div class="small muted" style="margin-top:6px">${g}</div><div class="checks">${Object.entries(o).map(([k, l]) => `<label><input type="checkbox" name="pos" value="${k}" ${(p.positions || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>`).join("")}</div>
    <label class="f" style="max-width:260px">Voorkeurspositie<select id="pf-pref" name="pref">${prefOptions(p.pref || "")}</select></label>
    <div class="f"><span class="small muted">Wat kunnen de ouders doen?</span><div class="checks">
      <label><input type="checkbox" name="canDrive" ${p.canDrive !== false ? "checked" : ""}> Rijden</label>
      <label><input type="checkbox" name="canFlag" ${p.canFlag !== false ? "checked" : ""}> ${flagWord()}</label>
      <label><input type="checkbox" name="canWash" ${p.canWash !== false ? "checked" : ""}> Wassen</label></div>
      <div class="checks"><label><input type="checkbox" name="twoParents" ${p.twoParents ? "checked" : ""}> Twee ouders die allebei helpen: dit gezin kan op één wedstrijddag twee taken krijgen</label></div></div>
    <div class="f"><span class="small muted">Leider of trainer</span><div class="checks" style="flex-direction:column">
      <label><input type="checkbox" name="leader" ${p.leader ? "checked" : ""}> Een ouder is leider of trainer van het team</label>
      <label><input type="checkbox" name="leaderDrives" ${p.leader === undefined || p.leaderDrives !== false ? "checked" : ""}> Rijdt naar uitwedstrijden (telt niet mee in de verdeling; bij twee leiders kies je bij Instellingen of er één of allebei rijden)</label>
      <label><input type="checkbox" name="leaderNoOther" ${p.leader === undefined || p.leaderNoOther !== false ? "checked" : ""}> Geen grensrechter of wassen</label></div></div>
    <label class="f" style="max-width:240px">Plekken voor kinderen in de auto (incl. eigen kind)<input id="pf-seats" name="seats" type="number" min="1" max="8" value="${esc(p.seats || S.settings.seatsDefault)}"></label>
    <div class="row"><button class="btn primary" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="cancel">Annuleren</button>
    ${isNew ? "" : `<button class="btn ${ui.arm === "delp" + p.id ? "arm" : "danger"}" type="button" data-act="delplayer" data-id="${p.id}">${ui.arm === "delp" + p.id ? "Zeker weten? Tik nogmaals" : "Verwijderen"}</button>`}</div>
  </form>`;
}
function vPlayers() {
  const editing = ui.editPlayer ? (ui.editPlayer === "new" ? {} : pById(ui.editPlayer)) : null;
  const rank = p => (p.inactiveFrom ? 2 : p.guest ? 1 : 0);
  const list = S.players.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return `<div class="row between"><h2>Spelers <span class="muted" style="font-size:18px">${families().length}</span></h2><button class="btn primary" data-act="newplayer">Speler toevoegen</button></div>
    ${editing ? playerForm(editing) : ""}
    <details class="card" id="bulkbox" ${S.players.length ? "" : "open"}><summary>Meerdere spelers tegelijk toevoegen</summary>
      <p class="small muted">Zet één naam per regel. Wil je de ouders er meteen bij, zet die dan achter een streepje, bv. <em>Daan de Vries - Sanne &amp; Mark</em>. Kopiëren uit een WhatsApp-lijst of Excel mag ook. Daarna tik je hieronder per speler de posities aan.</p>
      <textarea id="bulk-text" aria-label="Namen van spelers" placeholder="Daan de Vries - Sanne & Mark\nLotte Bakker\nSem Jansen"></textarea>
      <div class="row"><button class="btn primary" type="button" data-act="bulkadd">Spelers toevoegen</button></div>
    </details>
    ${list.length ? `<p class="small muted">Tik op Posities om aan te geven waar een speler kan staan (★ = voorkeur). Voor ouders, taken en leiders gebruik je Wijzig.</p>` : ""}
    ${list.length ? list.map(p => { const open = ui.openPlayer === p.id; const ps = POS_ORDER.concat("R").filter(k => (p.positions || []).includes(k));
      return `<div class="card player ${p.inactiveFrom ? "stopped" : ""}"><div class="player-line">
      <div class="player-name">${nrTag(p)}<strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.parent || "")}</span></div>
      <div class="names">${p.inactiveFrom ? `<span class="pill">niet meer actief</span>` : ""}${p.guest ? `<span class="pill away">gastspeler</span>` : ""}${p.leader ? `<span class="pill home">Leider</span>` : ""}${p.guest || p.inactiveFrom ? "" : ["canDrive", "canFlag", "canWash"].filter(k => !p[k]).map(k => `<span class="pill warn">geen ${({ canDrive: "rijden", canFlag: flagWord().toLowerCase(), canWash: "was" })[k]}</span>`).join("")}</div></div>
      <div class="player-line"><div class="names">${ps.length ? ps.map(k => `<span class="pill ${p.pref === k ? "home" : ""}" title="${esc(POS[k] || k)}">${p.pref === k ? "★ " : ""}${k}</span>`).join("") : `<span class="pill warn">nog geen posities</span>`}</div>
      <div class="row"><button class="btn ${open ? "primary" : ""}" data-act="openplayer" data-id="${p.id}" aria-expanded="${open}">${open ? "Klaar" : "Posities"}</button><button class="btn ghost" data-act="editplayer" data-id="${p.id}">Wijzig</button></div></div>
      ${open ? `<div class="posedit">${POS_GROUPS.map(([g, o]) => `<div class="names posrow"><span class="small muted posgroup">${g}</span>${Object.entries(o).map(([k, l]) => { const on = (p.positions || []).includes(k); return `<button type="button" class="pill postog ${on ? "home" : ""}" aria-pressed="${on}" data-act="togpos" data-id="${p.id}" data-pos="${k}">${p.pref === k ? "★ " : on ? "✓ " : ""}${l}</button>`; }).join("")}</div>`).join("")}
      <label class="small muted prefline">Voorkeur <select data-act="setpref" data-id="${p.id}" aria-label="Voorkeurspositie ${esc(p.name)}">${prefOptions(p.pref || "")}</select></label></div>` : ""}</div>`; }).join("")
      : `<p class="muted">Nog geen spelers.</p>`}`;
}
function vLineup() {
  const list = sorted().filter(x => !x.cancelled);
  if (!list.length || !S.players.length) return `<h2>Wisselschema</h2><p class="muted">Voeg eerst spelers en wedstrijden toe.</p>`;
  if (!ui.lineupMatch || !list.find(m => m.id === ui.lineupMatch)) ui.lineupMatch = (list.find(m => m.date >= todayStr()) || list[list.length - 1]).id;
  const m = list.find(x => x.id === ui.lineupMatch); const pres = present(m);
  const B = m.lineup ? (Object.values(m.lineup.cells)[0] || []).length : +S.settings.blocks; const bm = blockMin();
  const durs = m.lineup ? lineupDurs(m) : Array(B).fill(bm); const startAt = durs.map((_, i) => durs.slice(0, i).reduce((a, x) => a + x, 0));
  const season = seasonStats(m);
  let table = "";
  if (m.lineup) {
    const counts = Array(B).fill(0); Object.values(m.lineup.cells).forEach(r => r.forEach((c, b) => { if (c !== "-") counts[b]++; }));
    const rows = pres.filter(p => m.lineup.cells[p.id]).sort((a, b) => a.name.localeCompare(b.name));
    const missing = pres.filter(p => !m.lineup.cells[p.id]);
    const cellOpts = ["K"].concat([...new Set(slotsFor())]);
    table = `<div class="tablewrap"><table><thead><tr><th>Speler</th>${durs.map((d, b) => `<th class="c">${Math.round(startAt[b])}′–${Math.round(startAt[b] + d)}′</th>`).join("")}<th class="c">Deze wedstrijd</th><th class="c">Seizoen vooraf</th></tr></thead><tbody>
      ${rows.map(p => `<tr><td><strong>${esc(p.name)}</strong>${(m.missedTraining || []).includes(p.id) ? ' <span class="pill" title="Niet getraind">NG</span>' : ""}</td>${m.lineup.cells[p.id].map((c, b) => `<td class="c ${c === "-" ? "bench" : "cell-" + lineOf(c)} ${fitsSlot(p, c) ? "" : "offpos"}"><select id="lu-${p.id}-${b}" data-act="cell" data-p="${p.id}" data-b="${b}" aria-label="${esc(p.name)} blok ${b + 1}" title="${esc(POS[c] || "")}">${cellOpts.concat(cellOpts.includes(c) ? [] : [c]).concat("-").map(o => `<option value="${o}" ${o === c ? "selected" : ""}>${o === "-" ? "wissel" : o}</option>`).join("")}</select></td>`).join("")}
      <td class="c">${Math.round(lineupMinutes(m, p.id))}′</td><td class="c">${Math.round(season[p.id] ? season[p.id].min : 0)}′</td></tr>`).join("")}
      <tr><td class="muted small">Op het veld</td>${counts.map(n => `<td class="c ${n !== +S.settings.onField ? "" : "muted"}" style="${n !== +S.settings.onField && pres.length >= +S.settings.onField ? "color:var(--bad);font-weight:700" : ""}">${n}</td>`).join("")}<td></td><td></td></tr>
      </tbody></table></div>
      ${missing.length ? `<div class="notice">Nog niet ingedeeld: ${missing.map(p => esc(p.name)).join(", ")}. Maak het schema opnieuw.</div>` : ""}
      <p class="small muted">${["K"].concat(cellOpts.filter(o => o !== "K")).map(o => o + " = " + (POS[o] || o).toLowerCase()).join(", ")}. Pas een vakje aan als je iets anders wilt; de minuten rekenen mee.</p>`;
  }
  const att = `<details class="card" ${ui.attOpen ? "open" : ""} id="attbox"><summary>Wie is er? ${squad(m).length - pres.length ? `<span class="pill warn">${squad(m).length - pres.length} afwezig</span>` : ""}${(m.guests || []).filter(pById).length ? ` <span class="pill">${(m.guests || []).filter(pById).length} gast</span>` : ""} ${(m.missedTraining || []).length ? `<span class="pill">${m.missedTraining.length} niet getraind</span>` : ""}</summary>
    <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Speler</th><th class="c">Aanwezig</th><th class="c">Niet getraind</th></tr></thead><tbody>
    ${squad(m).sort((a, b) => a.name.localeCompare(b.name)).map(p => { const ab = (m.absent || []).includes(p.id), mt = (m.missedTraining || []).includes(p.id);
      return `<tr><td>${esc(p.name)}${p.guest ? ' <span class="pill">gast</span>' : ""}</td><td class="c"><input type="checkbox" id="att-${p.id}" data-act="att" data-p="${p.id}" ${ab ? "" : "checked"} ${m.played ? "disabled" : ""} aria-label="${esc(p.name)} aanwezig"></td>
      <td class="c"><input type="checkbox" id="mt-${p.id}" data-act="mt" data-p="${p.id}" ${mt ? "checked" : ""} ${ab || m.played ? "disabled" : ""} aria-label="${esc(p.name)} niet getraind"></td></tr>`; }).join("")}
    </tbody></table></div>
    ${S.players.some(p => p.guest) ? `<div class="f"><span class="small muted">Gastspelers erbij</span><div class="checks">${S.players.filter(p => p.guest).map(p => `<label><input type="checkbox" id="gst-${p.id}" data-act="guest" data-p="${p.id}" ${(m.guests || []).includes(p.id) ? "checked" : ""} ${m.played ? "disabled" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>`
      : `<p class="small muted">Leen je een speler van een ander team? Voeg hem toe bij Spelers en vink daar Gastspeler aan.</p>`}
    <p class="small muted">Wie niet getraind heeft, begint op de bank, tenzij er anders te weinig spelers zijn. Daarna telt alleen het eerlijk verdelen van de speelminuten.</p></details>`;
  return `<h2>Wisselschema</h2>
    ${att}
    <div class="card"><div class="grid2">
      <label class="f">Wedstrijd<select id="lu-match" data-act="pickmatch">${list.map(x => `<option value="${x.id}" ${x.id === m.id ? "selected" : ""}>${esc(fmtDate(x.date))} · ${x.home ? "thuis" : "uit"} · ${esc(x.opponent)}${x.played ? " ✓" : ""}</option>`).join("")}</select></label>
      <div class="f"><span class="small muted" style="display:block">Beschikbaar</span><strong style="font-size:18px">${pres.length} spelers</strong> <strong><span class="muted small">voor ${S.settings.onField} plekken, ${S.settings.blocks} blokken van ${String(Math.round(bm * 10) / 10).replace(".", ",")} min</span></strong></div>
    </div>
    <div class="checks"><label><input type="checkbox" id="lu-reserve" data-act="usereserve" ${useReserve(m) ? "checked" : ""} ${m.played ? "disabled" : ""}> Reservekeeper keept de tweede helft${S.players.some(p => (p.positions || []).includes("R")) ? "" : ' <span class="muted small">(geef bij Spelers eerst iemand de positie reservekeeper)</span>'}</label></div>
    <div class="row"><button class="btn primary" data-act="genlineup" ${m.played ? "disabled" : ""}>${m.lineup ? "Opnieuw maken" : "Maak wisselschema"}</button>
    ${m.lineup ? `<button class="btn ${m.played ? "" : ""}" data-act="played">${m.played ? "✓ Gespeeld (telt mee)" : "Markeer als gespeeld"}</button><button class="btn ghost" data-act="copylineup">Kopieer opstelling</button>${m.played ? "" : '<button class="btn" data-act="golive">⏱ Wedstrijdmodus</button>'}` : ""}</div>
    <p class="small muted">Kinderen met de minste speelminuten dit seizoen krijgen voorrang. Wie het vorige blok wisselde, gaat er het volgende blok weer in. Een gespeelde wedstrijd telt mee voor het seizoensoverzicht.</p></div>
    ${m.lineup ? pitchView(m) : ""}
    ${table ? `<details class="card tablecard" ${ui.tableOpen === false ? "" : "open"} id="lutable"><summary>Hele schema als tabel</summary>${table}</details>` : ""}`;
}
function vSeason() {
  if (!S.players.length) return `<h2>Seizoen</h2><p class="muted">Nog geen spelers.</p>`;
  const st = seasonStats(null); const max = Math.max(1, ...Object.values(st).map(x => x.min));
  const playedN = S.matches.filter(counts).length;
  const dc = {}; S.players.forEach(p => dc[p.id] = { drive: 0, flag: 0, wash: 0 });
  S.matches.forEach(m => Object.entries(m.duties || {}).forEach(([k, ids]) => (ids || []).forEach(id => { if (dc[id]) dc[id][k]++; })));
  const rows = S.players.filter(p => !(p.guest && !st[p.id].games) && !(p.inactiveFrom && !st[p.id].games)).sort((a, b) => st[b.id].min - st[a.id].min);
  const own = rows.filter(p => !p.guest && !p.inactiveFrom); const avg = own.length ? own.reduce((s, p) => s + st[p.id].min, 0) / own.length : 0;
  const tag = p => (p.guest ? ' <span class="pill">gast</span>' : "") + (p.inactiveFrom ? ' <span class="pill">gestopt</span>' : "");
  return `<h2>Seizoen</h2>
  <p class="muted small">${playedN} gespeelde wedstrijd(en) met wisselschema. Gemiddeld ${Math.round(avg)} speelminuten per kind. Een wedstrijd telt mee zodra je hem als gespeeld markeert of de datum voorbij is; afgelaste wedstrijden tellen niet mee.</p>
  <div class="tablewrap"><table><thead><tr><th>Speler</th><th>Speelminuten</th><th class="c">Min</th><th class="c">% van mogelijk</th><th class="c">Keeper-blokken</th></tr></thead><tbody>
  ${rows.map(p => { const x = st[p.id]; return `<tr><td>${esc(p.name)}${tag(p)}</td><td><div class="bar"><i style="width:${(x.min / max * 100).toFixed(0)}%"></i></div></td><td class="c">${Math.round(x.min)}</td><td class="c">${x.avail ? Math.round(x.min / x.avail * 100) + "%" : "–"}</td><td class="c">${x.keeper}</td></tr>`; }).join("")}
  </tbody></table></div>
  <h3>Taken per gezin (hele seizoen, ook gepland)</h3>
  <div class="tablewrap"><table><thead><tr><th>Gezin</th><th class="c">Rijden</th><th class="c">${flagWord()}</th><th class="c">Wassen</th><th class="c">Totaal</th></tr></thead><tbody>
  ${S.players.filter(p => !p.guest && !(p.inactiveFrom && !(dc[p.id].drive + dc[p.id].flag + dc[p.id].wash))).sort((a, b) => a.name.localeCompare(b.name)).map(p => { const d = dc[p.id]; return `<tr><td>${esc(parentLabel(p.id))}${tag(p)}</td><td class="c">${p.canDrive ? d.drive : "–"}</td><td class="c">${p.canFlag ? d.flag : "–"}</td><td class="c">${p.canWash ? d.wash : "–"}</td><td class="c"><strong>${d.drive + d.flag + d.wash}</strong></td></tr>`; }).join("")}
  </tbody></table></div>`;
}
function vSettings() {
  const s = S.settings;
  return `<h2>Instellingen</h2>
  <div class="card"><h3>Logo en teamfoto</h3>
    <p class="small muted">Het logo staat bovenin de app, de teamfoto boven de wedstrijden. Ouders zien ze ook via de kijklink. Een foto staat openbaar online: wie het adres van de foto heeft, kan hem bekijken. Vraag daarom eerst toestemming aan de ouders en volg de beeldregels van je club.</p>
    <div class="media-grid">
      <div class="stack"><span class="small muted">Clublogo</span>
        <div class="media-prev logo-prev">${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="Clublogo">` : '<span class="muted small">Nog geen logo</span>'}</div>
        <label class="btn" for="up-logo">${s.logoUrl ? "Ander logo" : "Logo kiezen"}</label><input id="up-logo" type="file" accept="image/*" data-upload="logo" hidden>
        ${s.logoUrl ? '<button class="btn ghost danger" data-act="rmmedia" data-kind="logo">Logo verwijderen</button>' : ""}</div>
      <div class="stack"><span class="small muted">Teamfoto</span>
        <div class="media-prev photo-prev">${s.photoUrl ? `<img src="${esc(s.photoUrl)}" alt="Teamfoto">` : '<span class="muted small">Nog geen teamfoto</span>'}</div>
        <label class="btn" for="up-photo">${s.photoUrl ? "Andere foto" : "Foto kiezen"}</label><input id="up-photo" type="file" accept="image/*" data-upload="photo" hidden>
        ${s.photoUrl ? '<button class="btn ghost danger" data-act="rmmedia" data-kind="photo">Foto verwijderen</button>' : ""}</div>
    </div></div>
  <form class="card" id="settingsform"><h3>Club en team</h3>
    ${clubSearchBlock("sf")}
    <div class="grid2">
      <label class="f">Sport<select id="sf-sport" name="sport">${Object.entries(SPORTS).map(([k, l]) => `<option value="${k}" ${sport() === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f">Club<input id="sf-club" name="club" value="${esc(s.club)}" placeholder="bv. VV De Meeuwen"></label>
      <label class="f">Team<input id="sf-team" name="team" value="${esc(s.team)}" placeholder="bv. JO11-2"></label>
    </div>
    <label class="f">Adres eigen sportcomplex (vertrekpunt bij uitwedstrijden)<input id="sf-addr" name="homeAddress" value="${esc(s.homeAddress)}" placeholder="${s.club ? "Wordt automatisch opgezocht…" : "Vul eerst je club in"}"></label>
    ${s.homeCoords && s.homeCoords.label ? `<p class="small muted">Gevonden: ${esc(s.homeCoords.label)}. Klopt het niet? Pas het adres aan en sla op, of zoek je club hierboven opnieuw.</p>` : ""}
    <label class="f" style="max-width:240px">Aanwezig voor de aftrap (min)<input id="sf-arr" name="arriveBefore" type="number" min="0" step="5" value="${esc(s.arriveBefore)}"></label>
    <h3>Wedstrijdvorm</h3>
    <div class="grid2">
      <label class="f">Speelduur (min)<input id="sf-dur" name="matchMinutes" type="number" min="10" value="${esc(s.matchMinutes)}"></label>
      <label class="f">Wisselmomenten: aantal blokken<input id="sf-blocks" name="blocks" type="number" min="1" max="12" value="${esc(s.blocks)}"></label>
      <label class="f">Spelers op het veld (incl. keeper)<input id="sf-onf" name="onField" type="number" min="4" max="11" value="${esc(s.onField)}"></label>
      <label class="f">Opstelling zonder keeper (V-M-A)<input id="sf-form" name="formation" value="${esc(s.formation)}" placeholder="3-2-2"></label>
    </div>
    <div class="f"><span class="small muted">Snel instellen per leeftijd (controleer het reglement van je competitie)</span>
    <div class="row">${PRESETS.map((p, i) => `<button class="btn" type="button" data-act="preset" data-i="${i}">${p[0]}</button>`).join("")}</div></div>
    <h3>Taken</h3>
    <div class="grid2"><label class="f">Standaard plekken per auto (kinderen)<input id="sf-seats" name="seatsDefault" type="number" min="1" max="8" value="${esc(s.seatsDefault)}"></label></div>
    <div class="checks"><label><input type="checkbox" name="flagAway" ${s.flagAway ? "checked" : ""}> Ook ${flagWord().toLowerCase()} bij uitwedstrijden</label>
    <label><input type="checkbox" name="washPerMatch" ${s.washPerMatch ? "checked" : ""}> Wassen na elke wedstrijd</label>
    <label><input type="checkbox" name="washWithDuty" ${s.washWithDuty !== false ? "checked" : ""}> De wastas gaat mee met een ouder die die dag al rijdt of een andere taak heeft</label>
    <label><input type="checkbox" name="leaderDriveOne" ${s.leaderDriveOne !== false ? "checked" : ""}> Bij meerdere leiders rijdt er per uitwedstrijd één (om de beurt)</label></div>
    <h3>Keeper</h3>
    <div class="checks"><label><input type="checkbox" name="keeperFull" ${s.keeperFull !== false ? "checked" : ""}> Standaard staat de keeper de hele wedstrijd in het doel</label></div>
    <div class="checks"><label><input type="checkbox" name="splitLast" ${s.splitLast !== false ? "checked" : ""}> Laatste blok halveren als de bank anders niet eerlijk uitkomt (dan zitten meer spelers een half blok extra, in plaats van een paar spelers een heel blok extra)</label></div>
    <p class="small muted">Per wedstrijd kies je bij Wissels of de reservekeeper de tweede helft keept. De keeper wisselt alleen in de rust. Is de keeper afwezig, dan keept de reservekeeper. Een keeper die de hele wedstrijd staat, maakt meer speelminuten. Het wisselschema verdeelt de rest eerlijk over de veldspelers.</p>
    <div class="row"><button class="btn primary" type="submit">Opslaan</button></div>
  </form>
  ${accountCard()}
  ${versionsCard()}
  ${seasonCard()}
  <p class="small muted"><a href="privacy.html">Privacy: wat de app bewaart en wie wat ziet</a></p>
  <div class="card"><h3>Back-up</h3>
    <details><summary>Back-up maken of terugzetten</summary><div class="stack" style="margin-top:8px">
      <textarea id="backup" aria-label="Back-up">${esc(JSON.stringify(S))}</textarea>
      <div class="row"><button class="btn" data-act="copybackup">Kopieer back-up</button><button class="btn" data-act="restore">Zet tekst hierboven terug</button></div></div></details>
    <div class="row"><button class="btn ${ui.arm === "reset" ? "arm" : "danger"}" data-act="reset">${ui.arm === "reset" ? "Zeker? Alle spelers en wedstrijden worden gewist" : "Alles wissen"}</button>
    ${teamEmpty() ? '<button class="btn ghost" data-act="sample">Voorbeeldteam laden</button>' : ""}</div>
  </div>
  ${dangerCard()}`;
}

// label, onField, minutes, blocks, formation
const PRESETS_VOETBAL = [["6 tegen 6", 6, 40, 4, "2-1-2"], ["8 tegen 8", 8, 60, 4, "3-2-2"], ["JO13 11×11", 11, 60, 4, "4-3-3"],
  ["JO14/JO15 11×11", 11, 70, 4, "4-3-3"], ["JO16/JO17 11×11", 11, 80, 4, "4-3-3"], ["JO19 11×11", 11, 90, 6, "4-3-3"]];
const PRESETS_HOCKEY = [["6-tal (JO9/JO10)", 6, 50, 4, "2-2-1"], ["8-tal (JO11/JO12)", 8, 60, 4, "3-2-2"], ["11-tal (JO14)", 11, 70, 4, "4-3-3"], ["11-tal (JO16/JO18)", 11, 70, 4, "4-3-3"]];
let PRESETS = PRESETS_VOETBAL;
const presetsFor = sp => sp === "hockey" ? PRESETS_HOCKEY : PRESETS_VOETBAL;

// ---------- screenshot uitlezen (OCR met Tesseract, draait in de browser; er gaat geen beeld naar een server) ----------
const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("laden mislukt")); document.head.appendChild(s); }); }
async function readScreenshots(files) {
  try {
    toast("Screenshot uitlezen…");
    if (!window.Tesseract) await loadScript((window.OCR_PATHS && OCR_PATHS.script) || TESS);
    const opts = Object.assign({ logger: x => { if (x.status === "recognizing text") toast("Screenshot uitlezen… " + Math.round(x.progress * 100) + "%"); } }, (window.OCR_PATHS && OCR_PATHS.options) || {});
    const worker = await Tesseract.createWorker("nld", 1, opts);
    let text = "";
    for (const f of files) { const { data } = await worker.recognize(f); text += (text ? "\n\n" : "") + data.text; }
    await worker.terminate();
    ui.importText = text.trim(); ui.importRows = parseProgram(ui.importText); ui.importRows.forEach(r => r.on = !r.dup); render();
    const box = document.getElementById("importbox"); if (box) { box.open = true; box.scrollIntoView({ block: "start" }); }
    toast(ui.importRows.length ? ui.importRows.length + " wedstrijd(en) gevonden. Controleer de lijst." : "Geen wedstrijden herkend. Probeer een scherpere screenshot, of plak de tekst.");
  } catch (e) { toast("Uitlezen lukte niet (" + (e.message || e) + "). Plak de tekst dan in het vak."); }
}
// ---------- program import (pasted text from a club site) ----------
const MONTHS = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
function seasonYear(month) { const n = new Date(); const start = n.getMonth() + 1 >= 7 ? n.getFullYear() : n.getFullYear() - 1; return month >= 7 ? start : start + 1; }
function findDate(s) {
  let m = s.match(/\b(\d{1,2})[-\/.](\d{1,2})(?:[-\/.](\d{2,4}))?\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
    let y = m[3] ? +m[3] : seasonYear(+m[2]); if (y < 100) y += 2000;
    return { iso: y + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0"), raw: m[0] };
  }
  m = s.match(/\b(\d{1,2})\s+(jan|feb|mrt|maa|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; const y = m[3] ? +m[3] : seasonYear(mo);
    return { iso: y + "-" + String(mo).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0"), raw: m[0] }; }
  return null;
}
function ownKeys() {
  const stop = /^(vv|sv|v\.v\.|s\.v\.|fc|rksv|vvv|sc|cvv|asv|voetbalvereniging|hc|mhc|hv|mhv|hockeyclub|hockeyvereniging|de|het)$/i;
  return String(S.settings.club || "").toLowerCase().split(/\s+/).filter(w => w.length > 1 && !stop.test(w));
}
const TEAMCODE = /\b(?:JO|MO|O|JM)\s?\d{1,2}(?:\s?-\s?\d{1,2})?\b|\b(?:VR|Vrouwen|Heren|Dames|Senioren|Zondag|Zaterdag)\s?\d{0,2}\b|\b[JM][A-F]\d{1,2}\b/i;
const NOT_TEAM = /^(veld|uitslag|scheidsrechter|scheids|accommodatie|locatie|wedstrijd|programma|thuis|uit|competitie|beker|oefen|vriendschappelijk|kleedkamer|aanvang|datum|tijd|sportpark|afgelast|status|klasse|poule|info|route|details|verzamelen|vertrek)\b/i;
const WEEKDAY = /\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|do|vr|za|zo)\b\.?/ig;
function parseProgram(text) {
  const out = []; let curDate = null; const keys = ownKeys();
  const ownTeam = String(S.settings.team || "").toLowerCase().replace(/\s/g, "");
  let cur = null; // { time, teams: [], date }
  const finish = () => {
    if (!cur || !cur.time || cur.teams.length < 2 || !(cur.date || curDate)) return;
    const [a, b] = cur.teams; const date = cur.date || curDate;
    const score = x => { const l = x.toLowerCase(); let sc = keys.some(k => l.includes(k)) ? 1 : 0; if (sc && ownTeam && l.replace(/\s/g, "").includes(ownTeam)) sc++; return sc; };
    const sa = score(a), sb = score(b);
    const home = sa > sb ? true : sb > sa ? false : null;
    const opponent = home === false ? a : b;
    const known = S.matches.find(x => x.opponent === opponent && !x.home);
    out.push({ date, time: cur.time, home: home !== false, unsure: home === null, opponent,
      address: known ? known.address : "", travel: known ? known.travel : 0,
      dup: S.matches.some(x => x.date === date && x.opponent === opponent) });
    cur = null;
  };
  String(text || "").split(/\r?\n/).forEach(rawLine => {
    let line = rawLine.replace(/ /g, " ").trim(); if (!line) return;
    const d = findDate(line);
    if (d) { line = line.replace(d.raw, " "); curDate = d.iso; if (cur && !cur.date) cur.date = curDate; }
    const t = line.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
    if (t) {
      line = line.replace(t[0], " ");
      const time = String(t[1]).padStart(2, "0") + ":" + t[2];
      if (cur && cur.time && cur.teams.length < 2) cur = null;
      if (!cur) cur = { time: null, teams: [], date: curDate };
      cur.time = time; if (!cur.date && curDate) cur.date = curDate;
    }
    const frags = line.replace(WEEKDAY, " ").split(/\t|\s{2,}|\s[-–—|]\s|\s(?:vs\.?|tegen)\s/i)
      .map(f => f.replace(/[()\[\],;]/g, " ").replace(/\s+/g, " ").trim()).filter(f => f.length >= 3 && /[a-z]/i.test(f) && !NOT_TEAM.test(f));
    let teams = frags.filter(f => TEAMCODE.test(f) || keys.some(k => f.toLowerCase().includes(k)));
    if (!teams.length && frags.length && cur) teams = frags.filter(f => f.split(" ").length <= 6 && !/\d{4}/.test(f));
    teams.forEach(f => {
      if (!cur) cur = { time: null, teams: [], date: curDate };
      if (cur.teams.length < 2) cur.teams.push(f);
      if (cur.teams.length === 2 && cur.time) finish();
    });
    if (cur && cur.time && cur.teams.length === 2) finish();
  });
  finish();
  return out;
}

// ---------- sample ----------
const teamEmpty = () => !S.players.length && !S.matches.length;
function loadSample() {
  if (!teamEmpty()) { toast("Het voorbeeldteam kan alleen in een leeg team. Je eigen gegevens blijven staan."); return; }
  const names = [["Daan", "K,V"], ["Sem", "V"], ["Liam", "V,M"], ["Noah", "M"], ["Finn", "M,A"], ["Luuk", "A"], ["Mees", "V,M,A"], ["Jesse", "K,M"], ["Bram", "A,M"], ["Ties", "V"], ["Mila", "M,A"]];
  const players = names.map(([n, pos], i) => ({ id: uid(), name: n, parent: "", positions: pos.split(","), canDrive: i % 4 !== 1, canFlag: i % 3 !== 2, canWash: i % 5 !== 3, seats: i % 3 === 0 ? 4 : 3 }));
  const base = new Date(); base.setDate(base.getDate() + ((6 - base.getDay() + 7) % 7 || 7));
  const opp = [["SV Oranje JO11-1", 1, "", 0, "09:00"], ["VV Zuidwijk JO11-3", 0, "Sportpark Zuid, Zuidwijk", 25, "10:30"], ["FC Polder JO11-2", 1, "", 0, "08:45"], ["RKSV De Hoeve JO11-1", 0, "Sportlaan 4, Hoeve", 35, "11:00"], ["SC Dijkzicht JO11-2", 1, "", 0, "09:30"], ["VV Zuidwijk JO11-3", 0, "Sportpark Zuid, Zuidwijk", 25, "09:15"]];
  const matches = opp.map(([o, h, a, t, time], i) => { const d = new Date(base); d.setDate(d.getDate() + 7 * i);
    return { id: uid(), date: d.toISOString().slice(0, 10), time, home: !!h, opponent: o, address: a, travel: t, absent: i === 1 ? [players[3].id] : [] }; });
  const keep = { logoUrl: S.settings.logoUrl || "", photoUrl: S.settings.photoUrl || "" };
  S = normalize({ settings: { ...keep, club: "VV Voorbeeld", team: "JO11-2 (voorbeeld)", homeAddress: "Sportpark Voorbeeld, Dorp" }, players, matches });
  planDuties(); save(); ui.tab = "planning"; render(); toast("Voorbeeldteam geladen. Wis het via Instellingen.");
}

// ---------- events ----------
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab],[data-act]"); if (!t) return;
  if (t.matches("nav.tabs button")) { ui.tab = t.dataset.tab; ui.arm = null; try { localStorage.setItem("teamplanner.tab", ui.tab); } catch (x) {} render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.act, id = t.dataset.id; if (!a || t.tagName === "SELECT") return;
  const armed = k => { if (ui.arm === k) { ui.arm = null; return true; } ui.arm = k; render(); return false; };
  const m = id && S.matches.find(x => x.id === id);
  switch (a) {
    case "more": ui.more = ui.more === id ? null : id; render(); break;
    case "go": ui.tab = t.dataset.tab; render(); break;
    case "sample": loadSample(); break;
    case "plan": planDuties(); save(); render(); toast("Taakschema verdeeld."); break;
    case "copy": copy(matchText(m)); break;
    case "copyall": copy(sorted().filter(x => x.date >= todayStr()).map(matchText).join("\n\n")); break;
    case "lock": m.locked = !m.locked; save(); render(); break;
    case "editmatch": ui.tab = "matches"; ui.editMatch = id; render(); window.scrollTo(0, 0); break;
    case "newmatch": ui.tab = "matches"; ui.editMatch = "new"; render(); window.scrollTo(0, 0); break;
    case "tolineup": ui.tab = "lineup"; ui.lineupMatch = id; render(); window.scrollTo(0, 0); break;
    case "cancel": ui.editMatch = ui.editPlayer = null; ui.arm = null; render(); break;
    case "delmatch": if (armed("delm" + id)) { S.matches = S.matches.filter(x => x.id !== id); ui.editMatch = null; save(); render(); } break;
    case "togpos": { const p = pById(id); if (!p) break; p.positions = p.positions || [];
      const k = t.dataset.pos; p.positions = p.positions.includes(k) ? p.positions.filter(x => x !== k) : p.positions.concat(k);
      if (p.pref && !fits(p, p.pref)) p.pref = "";
      save(); render(); break; }
    case "bulkadd": { const el = document.getElementById("bulk-text"); const have = new Set(S.players.map(p => p.name.toLowerCase())); let n = 0, dup = 0;
      (el.value || "").split(/\r?\n/).forEach(line => {
        line = line.replace(/^\s*(\d+[.)]?|[-*•])\s+/, "").trim(); if (!line) return;
        const parts = line.split(/\t|;|\s+[-–]\s+/); const name = (parts[0] || "").trim(); if (!name) return;
        if (have.has(name.toLowerCase())) { dup++; return; } have.add(name.toLowerCase());
        S.players.push({ id: uid(), name, parent: (parts[1] || "").trim(), positions: [], canDrive: true, canFlag: true, canWash: true, leader: false, leaderDrives: false, leaderNoOther: false, seats: +S.settings.seatsDefault }); n++;
      });
      save(); render(); toast(n ? n + (n == 1 ? " speler" : " spelers") + " toegevoegd." + (dup ? " " + dup + (dup == 1 ? " stond er al in." : " stonden er al in.") : "") : (dup ? "Deze spelers staan er al in." : "Geen namen gevonden.")); break; }
    case "openplayer": ui.openPlayer = ui.openPlayer === id ? null : id; render(); break;
    case "newplayer": ui.editPlayer = "new"; render(); window.scrollTo(0, 0); break;
    case "editplayer": ui.editPlayer = id; render(); window.scrollTo(0, 0); break;
    case "delplayer": if (armed("delp" + id)) { S.players = S.players.filter(x => x.id !== id); ui.editPlayer = null; save(); render(); } break;
    case "genlineup": { const mm = S.matches.find(x => x.id === ui.lineupMatch); if (mm.played) { toast("Deze wedstrijd is gespeeld. Haal eerst het vinkje Gespeeld weg als je het schema echt opnieuw wilt maken."); break; } planLineup(mm); save(); render(); toast("Wisselschema gemaakt."); break; }
    case "played": { const mm = S.matches.find(x => x.id === ui.lineupMatch); mm.played = !mm.played; save(); render(); break; }
    case "pitchblock": ui.pitchBlock = +t.dataset.b; ui.pick = null; render(); break;
    case "pick": { const mm = S.matches.find(x => x.id === ui.lineupMatch); if (!mm || !mm.lineup) break;
      if (!ui.pick) { ui.pick = id; render(); break; }
      if (ui.pick === id) { ui.pick = null; render(); break; }
      const bb = Math.min(ui.pitchBlock || 0, lineupDurs(mm).length - 1); swapCells(mm, ui.pick, id, bb); const a1 = ui.pick; ui.pick = null; save(); render(); toast(pName(a1) + " en " + pName(id) + " geruild."); break; }
    case "golive": { const mm = S.matches.find(x => x.id === ui.lineupMatch); if (!mm || !mm.lineup) break; ui.live = mm.id; ui.liveBlock = null; render(); window.scrollTo(0, 0); break; }
    case "liveexit": ui.live = null; keepAwake(false); render(); break;
    case "liveclock": { const mm = S.matches.find(x => x.id === ui.live); const L = liveOf(mm);
      try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (x) {}
      if (L.since) { L.acc += Date.now() - L.since; L.since = null; keepAwake(false); } else { L.since = Date.now(); keepAwake(true); }
      save(); render(); break; }
    case "liveswap": { const mm = S.matches.find(x => x.id === ui.live); const o = document.getElementById("lv-out").value, i = document.getElementById("lv-in").value;
      if (!o || !i) break; if (liveSwap(mm, o, i)) { save(); render(); toast(pName(i) + " erin, " + pName(o) + " eruit."); } break; }
    case "liveinj": { const mm = S.matches.find(x => x.id === ui.live); const pid = document.getElementById("lv-inj").value; if (!pid) break;
      liveInjured(mm, pid); save(); render(); toast("Schema aangepast: " + pName(pid) + " speelt niet meer mee."); break; }
    case "livelate": { const mm = S.matches.find(x => x.id === ui.live); const pid = document.getElementById("lv-late").value; if (!pid) break;
      liveLate(mm, pid); save(); render(); toast(pName(pid) + " doet mee vanaf het volgende blok."); break; }
    case "liveend": if (armed("liveend")) { const mm = S.matches.find(x => x.id === ui.live); const L = liveOf(mm);
      if (L.since) { L.acc += Date.now() - L.since; L.since = null; } mm.played = true; ui.live = null; keepAwake(false); save(); render(); toast("Wedstrijd afgelopen. De speelminuten tellen mee."); } break;
    case "copylineup": { const mm = S.matches.find(x => x.id === ui.lineupMatch); copy(lineupText(mm)); break; }
    case "preset": { const p = PRESETS[+t.dataset.i]; const f = document.getElementById("settingsform");
      f.onField.value = p[1]; f.matchMinutes.value = p[2]; f.blocks.value = p[3]; f.formation.value = p[4]; toast(p[0] + " ingevuld. Tik op Opslaan."); break; }
    case "parse": ui.importText = document.getElementById("imp-text").value; ui.importRows = parseProgram(ui.importText); ui.importRows.forEach(r => r.on = !r.dup); render(); break;
    case "impon": ui.importRows[+t.dataset.i].on = t.checked; break;
    case "import": { const rows = (ui.importRows || []).filter(r => r.on);
      rows.forEach(r => S.matches.push({ id: uid(), date: r.date, time: r.time, home: r.home, opponent: r.opponent, address: r.home ? "" : r.address, travel: r.home ? 0 : r.travel, absent: [] }));
      ui.importRows = null; ui.importText = ""; save(); render(); toast(rows.length + " wedstrijd(en) toegevoegd."); break; }
    case "loginreset": ui.loginSent = false; render(); break;
    case "newteam": mode = "newteam"; render(); break;
    case "cancelnewteam": mode = "cloud"; render(); break;
    case "logout": if (dirty) toast("Er zijn nog wijzigingen die niet zijn opgeslagen. Probeer het als je internet hebt."); else sb.auth.signOut(); break;
    case "copyshare": copy(shareUrl()); break;
    case "rotate": if (armed("rotate")) newShareLink(); break;
    case "people": loadPeople(); break;
    case "newseason": if (armed("newseason")) newSeason(); break;
    case "copyplayers": copyPlayers(); break;
    case "invite": makeInvite(); break;
    case "copyinvite": copy(inviteText()); break;
    case "kick": if (armed("kick" + id)) kickCoach(id); break;
    case "delteam": if (armed("delteam")) deleteTeam(); break;
    case "leaveteam": if (armed("leaveteam")) leaveTeam(); break;
    case "delaccount": if (armed("delaccount")) deleteAccount(); break;
    case "calctravel": {
      const info = document.getElementById("travel-info"), btn = t; btn.disabled = true; info.hidden = false; info.textContent = "Bezig met berekenen…";
      const addr = document.getElementById("mf-addr").value.trim(), opp = document.getElementById("mf-opp").value.trim();
      calcTravel(addr, opp).then(r => {
        document.getElementById("mf-travel").value = r.minutes;
        ui.travelCalc = { minutes: r.minutes, km: r.km, label: r.label, addr, lat: r.lat, lon: r.lon };
        info.textContent = "Berekend naar: " + r.label + " (" + r.km + " km, " + r.minutes + " min). Klopt de plek niet? Vul het adres in en bereken opnieuw.";
      }).catch(e => { info.textContent = e.message || "Berekenen lukte niet."; }).finally(() => { btn.disabled = false; });
      break; }
    case "calcall": calcMissingTravel(); break;
    case "rmmedia": if (armed("rm" + t.dataset.kind)) removeMedia(t.dataset.kind); break;
    case "editduties": ui.editDuties = ui.editDuties === id ? null : id; render(); break;
    case "roundopen": { const ids = sorted().filter(m => m.date >= todayStr() && !m.cancelled).map(m => m.id);
      setRound(true, ids).then(ok => { if (ok) { render(); toast("Ronde geopend voor " + ids.length + " wedstrijden. Kopieer het bericht voor de ouders."); } }); break; }
    case "roundcopy": copy(roundText()); break;
    case "roundrefresh": loadAvail().then(() => { render(); toast("Bijgewerkt."); }); break;
    case "roundclose": if (armed("roundclose")) closeRound(); break;
    case "clubsearch": doClubSearch(t.dataset.p); break;
    case "clubpick": pickClub(t.dataset.p, +t.dataset.i); break;
    case "copybackup": copy(document.getElementById("backup").value); break;
    case "restore": { let d; try { d = normalize(JSON.parse(document.getElementById("backup").value)); } catch (x) { toast("Die tekst is geen geldige back-up."); break; }
      snapshot("vóór back-up terugzetten").then(() => { S = d; save(); render(); toast("Back-up teruggezet. De vorige stand staat bij Eerdere versies."); }); break; }
    case "reset": if (armed("reset")) snapshot("vóór alles wissen").then(() => { S = DEFAULTS(); save(); ui.tab = "planning"; render(); toast("Alles gewist. Per ongeluk? Zet het terug bij Eerdere versies."); }); break;
    case "versions": loadVersions(); break;
    case "restorever": if (armed("ver" + id)) restoreVersion(id); break;
    case "conflictmine": resolveConflict(true); break;
    case "conflicttheirs": resolveConflict(false); break;
  }
});
async function login(fd) {
  if (!ui.loginSent) {
    ui.loginEmail = (fd.get("email") || "").trim();
    const { error } = await sb.auth.signInWithOtp({ email: ui.loginEmail, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) { toast("Versturen lukte niet: " + error.message); return; }
    ui.loginSent = true; render();
  } else {
    const { error } = await sb.auth.verifyOtp({ email: ui.loginEmail, token: (fd.get("code") || "").trim(), type: "email" });
    if (error) toast("Die code klopt niet of is verlopen.");
  }
}
function lineupText(m) {
  const B = (Object.values(m.lineup.cells)[0] || []).length; const out = ["Opstelling " + fmtDate(m.date) + " " + (m.home ? "vs " : "@ ") + m.opponent];
  for (let b = 0; b < B; b++) {
    const on = Object.entries(m.lineup.cells).filter(([, r]) => r[b] !== "-").sort((x, y) => POS_ORDER.indexOf(x[1][b]) - POS_ORDER.indexOf(y[1][b]));
    const off = Object.entries(m.lineup.cells).filter(([, r]) => r[b] === "-");
    out.push("Blok " + (b + 1) + ": " + on.map(([id, r]) => pName(id) + " (" + r[b] + ")").join(", ") + (off.length ? " | wissel: " + off.map(([id]) => pName(id)).join(", ") : ""));
  }
  return out.join("\n");
}
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "lang") { I18N.set(t.value); render(); return; }
  if (t.id === "nt-sport") { ui.newSport = t.value; return; }
  if (t.id === "mf-home") { document.getElementById("awayfields").hidden = t.value === "1"; return; }
  if (t.id === "mf-opp") { const k = S.matches.find(x => x.opponent === t.value && !x.home); if (k) { const a = document.getElementById("mf-addr"), tr = document.getElementById("mf-travel"); if (!a.value) a.value = k.address || ""; if (!tr.value) tr.value = k.travel || ""; } return; }
  if (t.dataset.act === "imphome") { const r = ui.importRows[+t.dataset.i]; r.home = t.value === "1"; r.unsure = false; return; }
  if (t.dataset.act === "setpref") { const p = pById(t.dataset.id); if (!p) return; p.pref = t.value; p.positions = p.positions || [];
    if (p.pref && !fits(p, p.pref)) p.positions.push(p.pref); save(); render(); return; }
  if (t.dataset.act === "pickteam") { loadTeam(t.value); return; }
  if (t.dataset.act === "pickmatch") { ui.lineupMatch = t.value; ui.pitchBlock = 0; ui.pick = null; render(); return; }
  if (t.dataset.act === "guest") {
    const m = S.matches.find(x => x.id === ui.lineupMatch); const pid = t.dataset.p; ui.attOpen = true;
    m.guests = (m.guests || []).filter(x => x !== pid); if (t.checked) m.guests.push(pid);
    if (m.lineup && !m.played) { planLineup(m); toast("Wisselschema aangepast."); }
    save(); render(); return;
  }
  if (t.dataset.act === "att" || t.dataset.act === "mt") {
    const m = S.matches.find(x => x.id === ui.lineupMatch); const pid = t.dataset.p; ui.attOpen = true;
    const key = t.dataset.act === "att" ? "absent" : "missedTraining"; const on = t.dataset.act === "att" ? !t.checked : t.checked;
    m[key] = (m[key] || []).filter(x => x !== pid); if (on) m[key].push(pid);
    if (key === "absent") {
      if (on) m.missedTraining = (m.missedTraining || []).filter(x => x !== pid);
      if (m.duties) Object.keys(m.duties).forEach(k => m.duties[k] = (m.duties[k] || []).filter(x => !m.absent.includes(x)));
    }
    if (m.lineup && !m.played) { planLineup(m); toast(key === "absent" && on ? "Wisselschema aangepast. Kijk ook even naar het taakschema." : "Wisselschema aangepast."); }
    save(); render(); return;
  }
  if (t.dataset.act === "dutyset") { const m = S.matches.find(x => x.id === t.dataset.m); m.duties = m.duties || { drive: [], flag: [], wash: [] };
    const arr = (m.duties[t.dataset.d] || []).slice(); arr[+t.dataset.i] = t.value; m.duties[t.dataset.d] = arr.filter(Boolean);
    m.locked = true; save(); render(); return; }
  if (t.hasAttribute("data-ocr") && t.files && t.files.length) { readScreenshots([...t.files]); t.value = ""; return; }
  if (t.dataset.upload && t.files && t.files[0]) { uploadMedia(t.dataset.upload, t.files[0]); t.value = ""; return; }
  if (t.dataset.act === "avchild") { ui.avChild = t.value; try { localStorage.setItem("teamplanner.child." + shareToken, t.value); } catch (x) {} render(); return; }
  if (t.dataset.act === "usereserve") { const m = S.matches.find(x => x.id === ui.lineupMatch); m.useReserve = t.checked;
    if (m.lineup && !m.played) { planLineup(m); toast("Wisselschema aangepast."); } save(); render(); return; }
  if (t.dataset.act === "cell") { const m = S.matches.find(x => x.id === ui.lineupMatch); const sw = setCell(m, t.dataset.p, +t.dataset.b, t.value); save(); render(); if (sw) toast(pName(sw) + " ruilt mee."); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.cs) { e.preventDefault(); doClubSearch(e.target.dataset.cs); }
});
document.addEventListener("submit", e => {
  e.preventDefault(); const f = e.target; const fd = new FormData(f);
  if (f.id === "loginform") { login(fd); return; }
  if (f.id === "availform") { submitAvail(f); return; }
  if (f.id === "newteamform") { createTeam(fd); return; }
  if (f.id === "matchform") {
    const id = f.dataset.id; const m = id ? S.matches.find(x => x.id === id) : { id: uid() };
    const wasCancelled = !!m.cancelled; m.cancelled = fd.has("cancelled");
    if (id && (m.date !== fd.get("date") || m.time !== fd.get("time")) && (m.duties || m.locked)) m.moved = true;
    if (m.cancelled && !wasCancelled) { m.duties = null; m.locked = false; m.moved = false; }
    m.date = fd.get("date"); m.time = fd.get("time"); m.home = fd.get("home") === "1"; m.opponent = (fd.get("opponent") || "").trim();
    const newAddr = m.home ? "" : (fd.get("address") || "").trim();
    if (newAddr !== (m.address || "")) { m.travelPlace = ui.travelCalc && ui.travelCalc.addr === newAddr ? ui.travelCalc.label : ""; }
    m.address = newAddr; m.travel = m.home ? 0 : +fd.get("travel") || 0; m.absent = fd.getAll("absent"); m.guests = fd.getAll("guests");
    if (ui.travelCalc && !m.home && +ui.travelCalc.minutes === m.travel) { m.km = ui.travelCalc.km; m.travelPlace = ui.travelCalc.label;
      if (ui.travelCalc.addr && ui.travelCalc.addr === m.address) shareClub(m.opponent, m.address, ui.travelCalc.lat, ui.travelCalc.lon); }
    ui.travelCalc = null;
    if (!id) S.matches.push(m);
    if (m.duties) Object.keys(m.duties).forEach(k => m.duties[k] = (m.duties[k] || []).filter(pid => !m.absent.includes(pid)));
    ui.editMatch = null; save(); render(); toast(m.cancelled && !wasCancelled ? "Wedstrijd afgelast. Tik bij Planning op Taakschema opnieuw verdelen, dan schuiven de beurten door." : "Wedstrijd opgeslagen. Verdeel het taakschema opnieuw als er iets veranderd is.");
  } else if (f.id === "playerform") {
    const id = f.dataset.id; const p = id ? pById(id) : { id: uid() };
    p.name = (fd.get("name") || "").trim(); p.parent = (fd.get("parent") || "").trim(); p.positions = fd.getAll("pos"); p.pref = fd.get("pref") || ""; if (p.pref && !fits(p, p.pref)) p.positions.push(p.pref);
    p.canDrive = fd.has("canDrive"); p.canFlag = fd.has("canFlag"); p.canWash = fd.has("canWash"); p.twoParents = fd.has("twoParents");
    p.leader = fd.has("leader"); p.leaderDrives = fd.has("leaderDrives"); p.leaderNoOther = fd.has("leaderNoOther"); p.seats = +fd.get("seats") || +S.settings.seatsDefault;
    p.nr = (fd.get("nr") || "").trim().slice(0, 3); p.guest = fd.has("guest");
    const stop = fd.has("inactive");
    if (stop && !p.inactiveFrom) {
      p.inactiveFrom = todayStr(); p.inactive = true;
      // uit de komende wedstrijden halen: taken vervallen, niet-gespeelde wisselschema's opnieuw
      S.matches.filter(m => m.date >= p.inactiveFrom && !m.played).forEach(m => {
        if (m.duties) Object.keys(m.duties).forEach(k => m.duties[k] = (m.duties[k] || []).filter(x => x !== p.id));
        if (m.lineup && m.lineup.cells[p.id]) planLineup(m); });
    } else if (!stop && p.inactiveFrom) { delete p.inactiveFrom; p.inactive = false; }
    if (p.guest) S.matches.filter(m => m.date >= todayStr() && !m.played && m.duties).forEach(m => Object.keys(m.duties).forEach(k => m.duties[k] = (m.duties[k] || []).filter(x => x !== p.id)));
    if (!id) S.players.push(p); ui.editPlayer = null; save(); render(); toast(stop && p.inactiveFrom === todayStr() ? "Opgeslagen. Kijk bij Planning of er nu een taak open staat." : "Speler opgeslagen.");
  } else if (f.id === "settingsform") {
    const s = S.settings;
    ["club", "team", "homeAddress", "formation"].forEach(k => s[k] = (fd.get(k) || "").trim());
    if (SPORTS[fd.get("sport")]) s.sport = fd.get("sport");
    ["arriveBefore", "matchMinutes", "blocks", "onField", "seatsDefault"].forEach(k => s[k] = +fd.get(k) || s[k]);
    s.flagAway = fd.has("flagAway"); s.washPerMatch = fd.has("washPerMatch"); s.washWithDuty = fd.has("washWithDuty"); s.keeperFull = fd.has("keeperFull"); s.splitLast = fd.has("splitLast"); s.leaderDriveOne = fd.has("leaderDriveOne");
    const pk = ui.clubPick; if (pk && pk.address === s.homeAddress) s.homeCoords = { lat: pk.lat, lon: pk.lon, address: pk.address, label: pk.name };
    else if (s.homeCoords && s.homeCoords.address !== s.homeAddress) { s.homeCoords = null; S.matches.forEach(m => { if (!m.home && m.date >= todayStr() && !m.locked) m.travel = 0; }); travelTried.clear(); }
    ui.clubPick = null; ui.clubSearch = null;
    save(); render(); toast("Instellingen opgeslagen.");
  }
});

window.__tp = { setCell, get S() { return S; }, set S(x) { S = normalize(x); }, setAvail(a) { avail = a; }, render, lineupMinutes, liveSwap, liveInjured, liveLate, counts, dutyIssues, matchText, parseProgram, searchClubs, calcTravel, planDuties, planLineup, seasonStats, times };
// Offline: de app zelf (pagina, code, opmaak) wordt bewaard zodat hij ook zonder bereik opent.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
render(); init();
})();
