(() => {
"use strict";
// ---------- state ----------
const LS_KEY = "teamplanner.v1";
const DEFAULTS = () => ({
  settings: { club: "", team: "", homeAddress: "", arriveBefore: 45, matchMinutes: 60, blocks: 4, onField: 8,
    formation: "3-2-2", seatsDefault: 3, flagAway: false, washPerMatch: true, keeperFull: true },
  players: [], matches: [], updatedAt: 0
});
let S = DEFAULTS();
// mode: loading | local | login | newteam | cloud | shared | error
let mode = "loading", sb = null, user = null, teams = [], teamId = null, saveTimer = null, saving = false, errorText = "";
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
function save() {
  if (!canEdit()) return;
  S.updatedAt = Date.now();
  try { localStorage.setItem(cacheKey(), JSON.stringify(S)); } catch (e) {}
  if (mode !== "cloud") return;
  setSync("Opslaan…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushRemote, 800);
}
async function pushRemote() {
  if (mode !== "cloud") return;
  saving = true;
  const name = [S.settings.club, S.settings.team].filter(Boolean).join(" ") || "Mijn team";
  const { error } = await sb.from("teams").update({ data: S, name, updated_at: new Date().toISOString() }).eq("id", teamId);
  saving = false;
  if (error) { setSync("Niet opgeslagen. Controleer je internet."); return; }
  const t = teams.find(x => x.id === teamId); if (t) t.name = name;
  setSync("Opgeslagen");
}
function setSync(t) { const el = document.getElementById("sync"); if (el) el.textContent = t; }

async function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get("kijk"); shareToken = token;
  const cfg = window.TEAMPLANNER_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  if (token) {
    if (!sb) { mode = "error"; errorText = "Deze kijklink werkt alleen op de online versie van de planner."; return render(); }
    const { data, error } = await sb.rpc("get_shared_team", { token });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) { mode = "error"; errorText = "Deze kijklink werkt niet (meer). Vraag de coach om een nieuwe link."; return render(); }
    S = normalize(row.data); avail = row.availability || []; round = { open: !!row.avail_open, matches: row.avail_matches || [] }; mode = "shared"; ui.tab = "planning"; render(); setSync("Alleen bekijken");
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
async function loadTeams() {
  const { data, error } = await sb.from("teams").select("id,name,share_token,updated_at,avail_open,avail_matches").order("created_at");
  if (error) { mode = "error"; errorText = "Kan je teams niet laden: " + error.message; return render(); }
  teams = data || [];
  if (!teams.length) { mode = "newteam"; return render(); }
  let pick = null; try { pick = localStorage.getItem("teamplanner.team"); } catch (e) {}
  await loadTeam(teams.find(t => t.id === pick) ? pick : teams[0].id);
}
async function loadTeam(id) {
  mode = "loading"; render();
  const { data, error } = await sb.from("teams").select("data").eq("id", id).single();
  if (error) { mode = "error"; errorText = "Kan dit team niet laden: " + error.message; return render(); }
  teamId = id; S = normalize(data.data); mode = "cloud";
  const t = teams.find(x => x.id === id) || {}; round = { open: !!t.avail_open, matches: t.avail_matches || [] };
  await loadAvail();
  try { localStorage.setItem("teamplanner.team", id); } catch (e) {}
  ui.editMatch = ui.editPlayer = ui.lineupMatch = null;
  render(); setSync("Opgeslagen");
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
  await loadAvail();
  if (!await setRound(false, round.matches)) return;
  const ids = round.matches;
  S.matches.filter(m => ids.includes(m.id)).forEach(m => {
    const abs = S.players.filter(p => cannotDo(m.id, p.id, "absent")).map(p => p.id);
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
  const up = sorted().filter(m => m.date >= todayStr());
  if (round.open) {
    const fam = S.players; const done = fam.filter(p => avail.some(a => a.player === p.id && round.matches.includes(a.match)));
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
  if (!round.open) return `<div class="notice">Het schema staat vast. Kun je niet op je beurt? Ruil zelf met een andere ouder en laat het de coach weten.</div>`;
  const ms = sorted().filter(m => round.matches.includes(m.id));
  const list = S.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  let pid = ui.avChild; if (!pid) { try { pid = localStorage.getItem("teamplanner.child." + shareToken); } catch (e) {} }
  const p = pById(pid);
  const box = (m, what, label) => `<label><input type="checkbox" name="${m.id}" value="${what}" ${p && cannotDo(m.id, p.id, what) ? "checked" : ""}> ${label}</label>`;
  // "ouder is er niet" wordt bewaard als: kan niet rijden, vlaggen en wassen
  const parentBox = m => `<label><input type="checkbox" name="${m.id}" value="parent" ${p && ["drive", "flag", "wash"].every(w => cannotDo(m.id, p.id, w)) ? "checked" : ""}> Ouder is er niet (geen taak)</label>`;
  return `<form class="card" id="availform"><h3>Geef door wie er niet is</h3>
    <p class="small muted">De coach maakt het schema voor de komende wedstrijden. Vink per wedstrijd aan of je kind er niet is, of dat jij als ouder er niet bent (dan krijg je die dag geen taak). Je kunt het aanpassen tot de coach het schema maakt.</p>
    <label class="f">Mijn kind<select id="av-child" data-act="avchild"><option value="">Kies…</option>${list.map(x => `<option value="${x.id}" ${p && p.id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    ${p ? `<div class="stack">${ms.map(m => `<div class="card" style="padding:10px"><strong>${esc(fmtDate(m.date))} · ${m.home ? "thuis tegen" : "uit bij"} ${esc(m.opponent)}</strong>
      <div class="checks">${box(m, "absent", esc(p.name) + " is er niet")}${parentBox(m)}</div></div>`).join("")}</div>
      <div class="row"><button class="btn primary" type="submit">Doorgeven</button></div>` : ""}
  </form>`;
}
async function submitAvail(f) {
  const pid = document.getElementById("av-child").value; if (!pid) return;
  const fd = new FormData(f);
  const entries = round.matches.map(mid => { const v = fd.getAll(mid); const c = v.filter(x => x !== "parent"); if (v.includes("parent")) c.push("drive", "flag", "wash"); return { match: mid, cannot: c }; });
  const { data, error } = await sb.rpc("submit_availability", { token: shareToken, p_player: pid, entries });
  if (error || data === false) { toast("Doorgeven lukte niet. Misschien heeft de coach het schema al gemaakt."); return; }
  avail = avail.filter(a => a.player !== pid || !round.matches.includes(a.match)).concat(entries.map(e => ({ player: pid, match: e.match, cannot: e.cannot })));
  toast("Doorgegeven, dank je wel!"); render();
}
async function createTeam(fd) {
  const fromLocal = fd.has("fromLocal");
  const data = fromLocal ? (readLocal(LS_KEY) || DEFAULTS()) : DEFAULTS();
  const club = (fd.get("club") || "").trim(), team = (fd.get("team") || "").trim(), address = (fd.get("address") || "").trim();
  if (club) data.settings.club = club; if (team) data.settings.team = team; if (address) data.settings.homeAddress = address;
  const age = +((team.match(/(?:JO|MO|O)\s?(\d{1,2})/i) || [])[1] || 0);
  const pre = !fromLocal && age ? (age <= 9 ? 0 : age <= 11 ? 1 : age === 13 ? 2 : age <= 15 && age >= 14 ? 3 : age <= 17 && age >= 16 ? 4 : age >= 18 ? 5 : -1) : -1;
  if (pre >= 0) { const P = PRESETS[pre]; Object.assign(data.settings, { onField: P[1], matchMinutes: P[2], blocks: P[3], formation: P[4] }); }
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
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || mode !== "cloud" || saving || saveTimer && S.updatedAt > Date.now() - 1500) return;
  const { data } = await sb.from("teams").select("data").eq("id", teamId).single();
  if (data && data.data && (data.data.updatedAt || 0) > (S.updatedAt || 0)) { S = normalize(data.data); render(); toast("Bijgewerkt met de laatste wijzigingen."); }
});

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const POS = { K: "Keeper", R: "Reservekeeper", V: "Verdediger", M: "Middenvelder", A: "Aanvaller" };
const DUTY = { drive: "Rijden", flag: "Grensrechter", wash: "Wassen" };
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const toMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmt = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const fmtDate = d => { try { return new Date(d + "T12:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return d; } };
const byDate = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
const sorted = () => S.matches.slice().sort(byDate);
const pById = id => S.players.find(p => p.id === id);
const pName = id => (pById(id) || {}).name || "?";
const parentLabel = id => { const p = pById(id); if (!p) return "?"; return p.parent ? p.parent + " (" + p.name + ")" : "ouder " + p.name; };
const present = m => S.players.filter(p => !(m.absent || []).includes(p.id));
const isPast = m => m.date < todayStr();
function times(m) {
  const ko = toMin(m.time), arrive = ko - (+S.settings.arriveBefore || 0);
  // vertrektijd altijd naar beneden afronden op 5 minuten (10:43 wordt 10:40)
  const depart = m.home ? null : Math.floor((arrive - (+m.travel || 0)) / 5) * 5;
  return { ko: fmt(ko), arrive: fmt(arrive), depart: depart == null ? null : fmt(depart) };
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
// Geeft { minutes, km, label, query } of gooit een Error met een Nederlandse melding.
async function calcTravel(address, opponent) {
  if (!S.settings.homeAddress) throw new Error("Vul eerst het adres van je eigen sportcomplex in bij Instellingen.");
  const hc = S.settings.homeCoords;
  const home = hc && hc.address === S.settings.homeAddress ? hc : await geocode(S.settings.homeAddress);
  if (!home) throw new Error("Het adres van je eigen sportcomplex is niet gevonden. Pas het aan bij Instellingen (bv. straat en plaats).");
  const tries = [address, clubFromTeam(opponent) && clubFromTeam(opponent) + " sportpark", clubFromTeam(opponent)].filter(Boolean);
  let dest = null, query = "";
  if (!address) { const c = await findOpponentClub(opponent, home); if (c) { dest = { lat: c.lat, lon: c.lon, label: c.name + (c.city ? ", " + c.city : "") }; query = c.name; } }
  if (!dest) for (const q of tries) { await sleep(1100); dest = await geocode(q); if (dest) { query = q; break; } }
  if (!dest) throw new Error("Het adres van de uitclub is niet gevonden. Vul het adres in (straat en plaats).");
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${home.lon},${home.lat};${dest.lon},${dest.lat}?overview=false`);
  const j = r.ok ? await r.json() : null;
  if (!j || !j.routes || !j.routes.length) throw new Error("Er is geen route gevonden.");
  return { minutes: Math.ceil(j.routes[0].duration / 60), km: Math.round(j.routes[0].distance / 1000), label: dest.label, query };
}
// Voetbalclubs zoeken in OpenStreetMap (Overpass). Geeft [{name, lat, lon, city, street}].
const OVERPASS = "https://overpass-api.de/api/interpreter";
const qlSafe = x => x.replace(/[^\p{L}\p{N}'-]/gu, "");
async function searchClubs(q) {
  const words = String(q || "").toLowerCase().replace(/\b(vv|sv|v\.v\.|s\.v\.|fc|rksv|vvv|sc|cvv|asv|voetbalvereniging)\b/g, " ").split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return [];
  const rx = words.map(qlSafe).filter(Boolean).join(".*"); if (!rx) return [];
  const ql = `[out:json][timeout:25];area["ISO3166-1"="NL"][admin_level=2]->.nl;
(nwr["sport"~"soccer"]["club"]["name"~"${rx}",i](area.nl);
 nwr["sport"~"soccer"]["leisure"~"sports_centre|pitch|stadium|sports_hall"]["name"~"${rx}",i](area.nl););
out center tags 60;`;
  const r = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(ql), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!r.ok) throw new Error("De clublijst is nu niet bereikbaar. Probeer het zo nog eens.");
  const j = await r.json(); const out = [];
  (j.elements || []).forEach(e => {
    const t = e.tags || {}; const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
    if (!t.name || lat == null) return;
    const item = { name: t.name, lat, lon, club: !!t.club, city: t["addr:city"] || t["addr:place"] || "", street: t["addr:street"] ? t["addr:street"] + (t["addr:housenumber"] ? " " + t["addr:housenumber"] : "") : "" };
    const dup = out.find(o => o.name.toLowerCase() === item.name.toLowerCase() && distKm(o, item) < 2);
    if (dup) { if (item.club && !dup.club) Object.assign(dup, item); return; }
    out.push(item);
  });
  return out.sort((a, b) => (b.club - a.club) || a.name.localeCompare(b.name)).slice(0, 25);
}
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
  return `<div class="f"><span>Zoek je club in de lijst van voetbalclubs</span>
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
  try { const list = await searchClubs(name); if (!list.length) return null;
    if (home) list.sort((a, b) => distKm(home, a) - distKm(home, b));
    return list[0]; } catch (e) { return null; }
}
async function calcMissingTravel() {
  const list = sorted().filter(m => !m.home && m.date >= todayStr() && !+m.travel);
  if (!list.length) { toast("Alle uitwedstrijden hebben al een reistijd."); return; }
  let ok = 0, fail = [];
  for (const m of list) {
    toast("Reistijd berekenen: " + (m.opponent || "") + "…");
    try { const r = await calcTravel(m.address, m.opponent); m.travel = r.minutes; m.km = r.km; m.travelPlace = r.label; if (!m.address) m.address = r.label.split(",").slice(0, 3).join(","); ok++; }
    catch (e) { fail.push(m.opponent); if (/eigen sportcomplex/.test(e.message)) { toast(e.message); break; } }
  }
  save(); render();
  toast(ok + " reistijd(en) berekend." + (fail.length ? " Niet gevonden: " + fail.join(", ") + ". Vul daar het adres in." : ""));
}
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2200); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Gekopieerd. Plak het in de groepsapp."); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Gekopieerd."); } catch (e2) { toast("Selecteer en kopieer de tekst handmatig."); } ta.remove(); }
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
    if (m.locked || (onlyFuture && m.date < today)) { tally(m, i); return; }
    const pres = present(m).filter(p => !cannotDo(m.id, p.id, "absent")); const used = new Set(); const duties = { drive: [], flag: [], wash: [] };
    const pick = (duty, can) => {
      const cands = pres.filter(p => can(p) && count[p.id] && !cannotDo(m.id, p.id, duty));
      if (!cands.length) return null;
      cands.sort((a, b) => (used.has(a.id) - used.has(b.id)) || (count[a.id][duty] - count[b.id][duty]) ||
        (last[a.id][duty] - last[b.id][duty]) || a.name.localeCompare(b.name));
      const c = cands[0]; used.add(c.id); return c;
    };
    if (!m.home) {
      let cap = 0; const need = pres.length; const taken = [];
      while (cap < need) {
        const c = pick("drive", p => p.canDrive && !taken.includes(p.id));
        if (!c) break; taken.push(c.id); duties.drive.push(c.id); cap += Math.max(1, +c.seats || +S.settings.seatsDefault || 3);
      }
    }
    if (m.home || S.settings.flagAway) { const c = pick("flag", p => p.canFlag); if (c) duties.flag.push(c.id); }
    if (S.settings.washPerMatch) { const c = pick("wash", p => p.canWash); if (c) duties.wash.push(c.id); }
    m.duties = duties; tally(m, i);
  });
}
function dutyIssues(m) {
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
  const keys = ["V", "M", "A"]; const slots = [];
  parts.forEach((n, i) => { for (let k = 0; k < n; k++) slots.push(keys[Math.min(i, 2)]); });
  const need = Math.max(0, (+S.settings.onField || 8) - 1);
  while (slots.length < need) slots.push("M");
  return slots.slice(0, need);
}
function blockMin() { return (+S.settings.matchMinutes || 60) / Math.max(1, +S.settings.blocks || 1); }
function lineupMinutes(m, pid) {
  if (!m.lineup || !m.lineup.cells || !m.lineup.cells[pid]) return 0;
  const bm = (+m.lineup.matchMinutes || +S.settings.matchMinutes || 60) / Math.max(1, m.lineup.cells[pid].length);
  return m.lineup.cells[pid].filter(c => c && c !== "-").length * bm;
}
function seasonStats(beforeMatch) {
  const st = {}; S.players.forEach(p => st[p.id] = { min: 0, keeper: 0, games: 0, avail: 0 });
  sorted().forEach(m => {
    if (!m.lineup) return;
    if (beforeMatch) { if (m.id === beforeMatch.id || byDate(m, beforeMatch) >= 0) return; }
    else if (!m.played) return;
    Object.keys(m.lineup.cells || {}).forEach(pid => {
      if (!st[pid]) return; const min = lineupMinutes(m, pid);
      st[pid].min += min; st[pid].avail += (+m.lineup.matchMinutes || 60); if (min > 0) st[pid].games++;
      st[pid].keeper += m.lineup.cells[pid].filter(c => c === "K").length;
    });
  });
  return st;
}
const useReserve = m => m.useReserve ?? (S.settings.keeperFull === false);
function planLineup(m) {
  const pres = present(m); const B = Math.max(1, +S.settings.blocks || 4); const onField = Math.max(1, +S.settings.onField || 8);
  const bm = blockMin(); const season = seasonStats(m); const slots = slotsFor();
  const cells = {}; pres.forEach(p => cells[p.id] = Array(B).fill("-"));
  const planned = id => season[id].min + cells[id].filter(c => c !== "-").length * bm;
  const half = Math.ceil(B / 2); const keepers = [];
  const order = (a, b) => planned(a.id) - planned(b.id) || season[a.id].min - season[b.id].min || a.name.localeCompare(b.name);
  // Keeper eerst, dan reservekeeper, dan wie het minst gespeeld heeft.
  const has = (p, k) => (p.positions || []).includes(k);
  const pickKeeper = exclude => {
    const tiers = [pres.filter(p => has(p, "K")), pres.filter(p => has(p, "R")), pres];
    for (const tier of tiers) {
      const pool = tier.filter(p => !exclude.includes(p.id));
      if (pool.length) return pool.sort((a, b) => season[a.id].keeper - season[b.id].keeper || order(a, b))[0].id;
    }
    return null;
  };
  // Keeper wisselt alleen in de rust. Per wedstrijd kies je of de reservekeeper de tweede helft keept.
  // Wie niet getraind heeft, begint op de bank; geldt ook voor de keeper als er een (reserve)keeper is die wel trainde.
  const missed = id => (m.missedTraining || []).includes(id);
  const best = pickKeeper([]);
  const trained = pres.filter(p => (has(p, "K") || has(p, "R")) && !missed(p.id))
    .sort((a, b) => (has(b, "K") - has(a, "K")) || season[a.id].keeper - season[b.id].keeper || order(a, b))[0];
  keepers[0] = keepers[1] = best;
  if (best && missed(best) && trained) { keepers[0] = trained.id; keepers[1] = best; }
  else if (useReserve(m)) {
    const others = pres.filter(p => p.id !== keepers[0]);
    const r = others.filter(p => has(p, "R")).concat(others.filter(p => has(p, "K")))
      .sort((a, b) => (has(b, "R") - has(a, "R")) || season[a.id].keeper - season[b.id].keeper || order(a, b))[0];
    if (r) keepers[1] = r.id;
  }
  for (let b = 0; b < B; b++) {
    const k = keepers[Math.min(1, Math.floor(b / half))];
    if (k) cells[k][b] = "K";
    const satLast = id => b > 0 && cells[id][b - 1] === "-";
    const cands = pres.filter(p => p.id !== k).sort((x, y) =>
      (b === 0 ? missed(x.id) - missed(y.id) : 0) || (planned(x.id) - planned(y.id)) || (satLast(y.id) - satLast(x.id)) || order(x, y));
    const chosen = cands.slice(0, onField - (k ? 1 : 0));
    const free = slots.slice(); const left = [];
    const flex = p => (p.positions || []).filter(x => x !== "K" && x !== "R");
    chosen.slice().sort((x, y) => (flex(x).length || 9) - (flex(y).length || 9)).forEach(p => {
      const prev = b > 0 ? cells[p.id][b - 1] : null; const ps = flex(p);
      let i = prev && ps.includes(prev) ? free.indexOf(prev) : -1;
      if (i < 0) i = free.findIndex(s => ps.includes(s));
      if (i < 0) { left.push(p); return; }
      cells[p.id][b] = free.splice(i, 1)[0];
    });
    left.forEach(p => { cells[p.id][b] = free.length ? free.shift() : "M"; });
  }
  m.lineup = { cells, matchMinutes: +S.settings.matchMinutes || 60, created: Date.now() };
}

// ---------- WhatsApp text ----------
function matchText(m) {
  const t = times(m); const d = m.duties || {};
  const lines = [];
  lines.push("⚽ " + fmtDate(m.date) + " · " + (m.home ? "Thuis tegen " : "Uit bij ") + (m.opponent || "?"));
  lines.push("Aftrap " + t.ko + ", aanwezig " + t.arrive + (m.home ? " op ons complex" : ""));
  if (!m.home) { lines.push("Vertrek vanaf " + (S.settings.club || "de club") + ": " + t.depart); if (m.address) lines.push("Adres: " + m.address); }
  if ((d.drive || []).length) lines.push("Rijden: " + d.drive.map(parentLabel).join(", "));
  if ((d.flag || []).length) lines.push("Grensrechter: " + d.flag.map(parentLabel).join(", "));
  if ((d.wash || []).length) lines.push("Wassen: " + d.wash.map(parentLabel).join(", "));
  if ((m.absent || []).length) lines.push("Afwezig: " + m.absent.map(pName).join(", "));
  return lines.join("\n");
}

// ---------- rendering ----------
const TABS = [["planning", "Planning"], ["matches", "Wedstrijden"], ["players", "Spelers"], ["lineup", "Wissels"], ["season", "Seizoen"], ["settings", "Instellingen"]];
function render() {
  const s = S.settings; const inTeam = ["local", "cloud", "shared"].includes(mode);
  document.getElementById("brand").innerHTML = inTeam ? esc(s.team || "Teamplanner") + "<small>" + esc(s.club || "Jeugdvoetbal") + "</small>" : "Teamplanner<small>Jeugdvoetbal</small>";
  const tabs = mode === "shared" ? TABS.filter(t => t[0] === "planning") : inTeam ? TABS : [];
  document.getElementById("tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${l}</button>`).join("");
  const main = document.getElementById("main");
  const st = { el: document.activeElement && document.activeElement.id };
  if (!inTeam) { main.innerHTML = ({ loading: vLoading, login: vLogin, newteam: vNewTeam, error: vError }[mode] || vLoading)(); return; }
  if (mode === "shared") ui.tab = "planning";
  main.innerHTML = ({ planning: vPlanning, matches: vMatches, players: vPlayers, lineup: vLineup, season: vSeason, settings: vSettings }[ui.tab] || vPlanning)();
  if (st.el) { const el = document.getElementById(st.el); if (el) el.focus(); }
}
function vLoading() { return `<div class="card empty"><p class="muted">Laden…</p></div>`; }
function vError() { return `<div class="card empty"><h2>Dat lukt niet</h2><p class="muted">${esc(errorText)}</p><a class="btn" href="${location.pathname}">Naar de beginpagina</a></div>`; }
function vLogin() {
  return `<form class="card" id="loginform" style="max-width:460px;justify-self:center;width:100%"><h2>Inloggen</h2>
    <p class="muted">Plan rijders, grensrechters, de was en een eerlijk wisselschema voor je jeugdteam. Je logt in met je e-mailadres, zonder wachtwoord.</p>
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
    <p class="muted">Kies je club en vul je team in. Je kunt later meer teams toevoegen.</p>
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
  </div>`;
}
function emptyStart() {
  return `<div class="card empty"><h2>Welkom, coach</h2>
  <p class="muted">Voer je spelers in met de posities en wat hun ouders kunnen doen, zet je wedstrijden erin en de planner maakt het rij-, grensrechter-, was- en wisselschema.</p>
  <div class="row" style="justify-content:center"><button class="btn primary" data-act="go" data-tab="settings">Begin met mijn team</button>
  <button class="btn" data-act="sample">Bekijk met voorbeeldteam</button></div></div>`;
}
function dutyRow(label, ids, extra) {
  return `<div class="duty"><span>${label}</span><div class="names">${ids && ids.length ? ids.map(id => `<span class="pill">${esc(parentLabel(id))}</span>`).join("") : '<span class="muted small">niemand</span>'}${extra || ""}</div></div>`;
}
function matchCard(m, isNext) {
  const t = times(m); const d = m.duties || {}; const issues = dutyIssues(m);
  return `<article class="card ${isNext ? "next" : ""}">
    <div class="row between"><span class="date">${esc(fmtDate(m.date))}${isNext ? " · eerstvolgende" : ""}</span>
      <span class="row">${m.locked ? '<span class="pill lock">vastgezet</span>' : ""}<span class="pill ${m.home ? "home" : "away"}">${m.home ? "THUIS" : "UIT"}</span></span></div>
    <div class="opp">${m.home ? "" : "@ "}${esc(m.opponent || "Tegenstander?")}</div>
    <div class="times">
      ${m.home ? "" : `<div class="time key"><span>Vertrek thuisclub</span><b>${t.depart}</b></div>`}
      <div class="time ${m.home ? "key" : ""}"><span>Aanwezig</span><b>${t.arrive}</b></div>
      <div class="time"><span>Aftrap</span><b>${t.ko}</b></div>
      ${m.home ? "" : `<div class="time"><span>Reistijd</span><b>${+m.travel || 0}′</b></div>`}
    </div>
    <div class="duties">
      ${m.home ? "" : dutyRow("Rijden", d.drive)}
      ${(m.home || S.settings.flagAway) ? dutyRow("Grensrechter", d.flag) : ""}
      ${S.settings.washPerMatch ? dutyRow("Wassen", d.wash) : ""}
      ${(m.absent || []).length ? `<div class="duty"><span>Afwezig</span><div class="names">${m.absent.map(id => `<span class="pill warn">${esc(pName(id))}</span>`).join("")}</div></div>` : ""}
    </div>
    ${ui.editDuties === m.id && canEdit() ? dutyEditor(m) : ""}
    ${!m.home && !+m.travel && canEdit() ? `<div class="notice">Nog geen reistijd, dus de vertrektijd klopt niet. <button class="btn" data-act="calcall">Bereken reistijden</button></div>` : ""}
    ${issues.map(i => `<div class="notice">${esc(i)}</div>`).join("")}
    <div class="row">
      <button class="btn" data-act="copy" data-id="${m.id}">Kopieer voor WhatsApp</button>
      ${!m.home && m.address ? `<a class="btn ghost" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(m.address)}" target="_blank" rel="noopener">Route</a>` : ""}
      ${canEdit() ? `<button class="btn ghost" data-act="editmatch" data-id="${m.id}">Wijzig / afwezigen</button>
      <button class="btn ghost" data-act="lock" data-id="${m.id}">${m.locked ? "Losmaken" : "Vastzetten"}</button>
      <button class="btn ghost" data-act="tolineup" data-id="${m.id}">Wisselschema</button>
      <button class="btn ghost" data-act="editduties" data-id="${m.id}">${ui.editDuties === m.id ? "Klaar met ruilen" : "Taken ruilen"}</button>` : ""}
    </div></article>`;
}
function dutyEditor(m) {
  const d = m.duties || {}; const fams = S.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  const sel = (duty, i, val) => `<select id="de-${m.id}-${duty}-${i}" data-act="dutyset" data-m="${m.id}" data-d="${duty}" data-i="${i}" aria-label="${DUTY[duty]} ${i + 1}">
    <option value="">${val ? "— weghalen —" : "+ toevoegen"}</option>${fams.map(p => `<option value="${p.id}" ${p.id === val ? "selected" : ""}>${esc(parentLabel(p.id))}</option>`).join("")}</select>`;
  const row = (duty, multi) => { const cur = d[duty] || []; const slots = multi ? cur.concat([""]) : (cur.length ? cur : [""]);
    return `<div class="duty"><span>${DUTY[duty]}</span><div class="stack">${slots.map((v, i) => sel(duty, i, v)).join("")}</div></div>`; };
  return `<div class="card" style="padding:10px;background:var(--bg)"><p class="small muted">Ruilen ouders onderling? Pas het hier aan. Deze wedstrijd blijft daarna zoals jij hem instelt.</p><div class="duties">
    ${m.home ? "" : row("drive", true)}${(m.home || S.settings.flagAway) ? row("flag", false) : ""}${S.settings.washPerMatch ? row("wash", false) : ""}</div></div>`;
}
function vPlanning() {
  if (!S.players.length && !S.matches.length) return canEdit() ? emptyStart() : `<div class="card empty"><p class="muted">De coach heeft nog geen wedstrijden ingepland.</p></div>`;
  const today = todayStr(); const up = sorted().filter(m => m.date >= today);
  const noDuty = up.filter(m => !m.duties).length;
  return `<div class="row between"><div><h2>Komende wedstrijden</h2><p class="muted small">Aanwezig ${S.settings.arriveBefore} min voor de aftrap. Bij uitwedstrijden rekent de planner de vertrektijd vanaf de thuisclub uit.</p></div>
    ${canEdit() ? `<button class="btn primary" data-act="plan">${noDuty ? "Maak taakschema" : "Taakschema opnieuw verdelen"}</button>` : ""}</div>
    <p class="muted small" ${canEdit() ? "" : "hidden"}>Vastgezette en gespeelde wedstrijden blijven zoals ze zijn. De rest wordt eerlijk verdeeld: wie het minst vaak aan de beurt was, gaat voor.</p>
    ${roundCard()}${parentCard()}
    ${up.length ? up.map((m, i) => matchCard(m, i === 0)).join("") : `<div class="card empty"><p class="muted">Nog geen komende wedstrijden.</p>${canEdit() ? '<button class="btn primary" data-act="newmatch">Wedstrijd toevoegen</button>' : ""}</div>`}
    ${up.length ? `<div class="row"><button class="btn" data-act="copyall">Kopieer hele schema</button>${canEdit() && up.some(m => !m.home && !+m.travel) ? '<button class="btn" data-act="calcall">Bereken ontbrekende reistijden</button>' : ""}</div>` : ""}`;
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
    <datalist id="opps">${known.map(x => `<option value="${esc(x.opponent)}">`).join("")}</datalist>
    <div class="grid2" id="awayfields" ${m.home !== false ? "hidden" : ""}>
      <label class="f">Adres uitclub<input id="mf-addr" name="address" value="${esc(m.address || "")}" placeholder="Sportpark, straat, plaats"></label>
      <label class="f">Reistijd vanaf eigen sportcomplex (min)<span class="row" style="flex-wrap:nowrap"><input id="mf-travel" name="travel" type="number" min="0" step="1" value="${esc(m.travel ?? "")}"><button class="btn" type="button" data-act="calctravel">Bereken</button></span></label>
    </div>
    <p class="small muted" id="travel-info" ${m.home !== false ? "hidden" : ""}>${m.travelPlace ? "Berekend naar: " + esc(m.travelPlace) + (m.km ? " (" + m.km + " km)" : "") : "Laat je het adres leeg, dan zoekt de planner op de naam van de club."}</p>
    ${maps ? `<p class="small"><a href="${maps}" target="_blank" rel="noopener">Reistijd opzoeken in Google Maps</a></p>` : `<p class="small muted">Tip: vul je thuisadres in bij Instellingen, dan krijg je hier een link naar de route.</p>`}
    ${S.players.length ? `<div class="f"><span class="small muted">Afwezig (ziek, vakantie, …)</span><div class="checks">${S.players.map(p => `<label><input type="checkbox" name="absent" value="${p.id}" ${(m.absent || []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></div>` : ""}
    <div class="row"><button class="btn primary" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="cancel">Annuleren</button>
    ${isNew ? "" : `<button class="btn ${ui.arm === "delm" + m.id ? "arm" : "danger"}" type="button" data-act="delmatch" data-id="${m.id}">${ui.arm === "delm" + m.id ? "Zeker weten? Tik nogmaals" : "Verwijderen"}</button>`}</div>
  </form>`;
}
function vMatches() {
  const list = sorted();
  const editing = ui.editMatch ? (ui.editMatch === "new" ? {} : S.matches.find(m => m.id === ui.editMatch)) : null;
  return `<div class="row between"><h2>Wedstrijden</h2><button class="btn primary" data-act="newmatch">Wedstrijd toevoegen</button></div>
    ${editing ? matchForm(editing) : ""}
    <details class="card" id="importbox" ${ui.importRows ? "open" : ""}><summary>Programma plakken vanaf de clubsite</summary>
      <p class="small muted">Open het programma van je team op de clubsite of in de Voetbal.nl-app, selecteer de wedstrijden, kopieer ze en plak ze hieronder. Het formaat maakt niet uit: de planner zoekt zelf de datum, aftrap en de twee teams, ook als die op aparte regels staan. Klopt er iets niet, pas het dan aan in de lijst hieronder.${ownKeys().length ? "" : " Vul eerst je club in bij Instellingen, dan herkent hij thuis en uit."}</p>
      <textarea id="imp-text" aria-label="Geplakt programma" placeholder="za 2 nov 10:30  VV Balk JO15-2 - SC Joure JO15-1">${esc(ui.importText || "")}</textarea>
      <div class="row"><button class="btn" type="button" data-act="parse">Lees programma</button></div>
      ${ui.importRows ? (ui.importRows.length ? `<div class="tablewrap"><table><thead><tr><th></th><th>Datum</th><th>Aftrap</th><th>T/U</th><th>Tegenstander</th></tr></thead><tbody>
        ${ui.importRows.map((r, i) => `<tr style="${r.dup ? "opacity:.55" : ""}"><td><input type="checkbox" id="imp-on-${i}" data-act="impon" data-i="${i}" ${r.dup ? "" : "checked"} aria-label="Toevoegen"></td><td>${esc(fmtDate(r.date))}</td><td>${r.time}</td>
        <td><select id="imp-home-${i}" data-act="imphome" data-i="${i}" style="width:84px"><option value="1" ${r.home ? "selected" : ""}>Thuis</option><option value="0" ${r.home ? "" : "selected"}>Uit</option></select>${r.unsure ? ' <span class="pill warn">?</span>' : ""}</td>
        <td>${esc(r.opponent)}${r.dup ? ' <span class="pill">staat er al</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
        <div class="row"><button class="btn primary" type="button" data-act="import">Geselecteerde wedstrijden toevoegen</button></div>
        <p class="small muted">Vul daarna bij uitwedstrijden het adres en de reistijd in via Wijzig.</p>`
        : `<div class="notice">Geen wedstrijden gevonden. Zorg dat bij elke wedstrijd een datum, een aftrap (bv. 10:30) en de twee teams staan.</div>`) : ""}
    </details>
    ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Datum</th><th></th><th>Tegenstander</th><th>Aftrap</th><th>Aanwezig</th><th>Vertrek</th><th></th></tr></thead><tbody>
    ${list.map(m => { const t = times(m); return `<tr style="${isPast(m) ? "opacity:.6" : ""}"><td>${esc(fmtDate(m.date))}</td><td><span class="pill ${m.home ? "home" : "away"}">${m.home ? "T" : "U"}</span></td><td>${esc(m.opponent)}</td><td>${t.ko}</td><td>${t.arrive}</td><td>${t.depart || "–"}</td><td><button class="btn ghost small" data-act="editmatch" data-id="${m.id}">Wijzig</button></td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="muted">Nog geen wedstrijden. Voeg het programma toe zoals het op de clubsite staat.</p>`}`;
}
function playerForm(p) {
  const isNew = !p.id;
  return `<form class="card" id="playerform" data-id="${p.id || ""}"><h3>${isNew ? "Nieuwe speler" : esc(p.name)}</h3>
    <div class="grid2">
      <label class="f">Naam speler<input id="pf-name" name="name" value="${esc(p.name || "")}" required></label>
      <label class="f">Naam ouder(s)<input id="pf-parent" name="parent" value="${esc(p.parent || "")}" placeholder="bv. Sanne & Mark"></label>
    </div>
    <div class="f"><span class="small muted">Posities</span><div class="checks">${Object.entries(POS).map(([k, l]) => `<label><input type="checkbox" name="pos" value="${k}" ${(p.positions || []).includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
    <div class="f"><span class="small muted">Wat kunnen de ouders doen?</span><div class="checks">
      <label><input type="checkbox" name="canDrive" ${p.canDrive !== false ? "checked" : ""}> Rijden</label>
      <label><input type="checkbox" name="canFlag" ${p.canFlag !== false ? "checked" : ""}> Grensrechter</label>
      <label><input type="checkbox" name="canWash" ${p.canWash !== false ? "checked" : ""}> Wassen</label></div></div>
    <label class="f" style="max-width:240px">Plekken voor kinderen in de auto (incl. eigen kind)<input id="pf-seats" name="seats" type="number" min="1" max="8" value="${esc(p.seats || S.settings.seatsDefault)}"></label>
    <div class="row"><button class="btn primary" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="cancel">Annuleren</button>
    ${isNew ? "" : `<button class="btn ${ui.arm === "delp" + p.id ? "arm" : "danger"}" type="button" data-act="delplayer" data-id="${p.id}">${ui.arm === "delp" + p.id ? "Zeker weten? Tik nogmaals" : "Verwijderen"}</button>`}</div>
  </form>`;
}
function vPlayers() {
  const editing = ui.editPlayer ? (ui.editPlayer === "new" ? {} : pById(ui.editPlayer)) : null;
  const list = S.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="row between"><h2>Spelers <span class="muted" style="font-size:18px">${S.players.length}</span></h2><button class="btn primary" data-act="newplayer">Speler toevoegen</button></div>
    ${editing ? playerForm(editing) : ""}
    ${list.length ? list.map(p => `<div class="card"><div class="player-line">
      <div><strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.parent || "")}</span>
      <div class="names" style="margin-top:4px">${(p.positions || []).map(k => `<span class="pill">${POS[k]}</span>`).join("") || '<span class="muted small">geen posities</span>'}</div></div>
      <div class="names">${["canDrive", "canFlag", "canWash"].map((k, i) => `<span class="pill ${p[k] ? "ok" : "warn"}">${p[k] ? "✓" : "✗"} ${["Rijden", "Grens", "Wassen"][i]}</span>`).join("")}
      <button class="btn ghost" data-act="editplayer" data-id="${p.id}">Wijzig</button></div></div></div>`).join("")
      : `<p class="muted">Nog geen spelers.</p>`}`;
}
function vLineup() {
  const list = sorted();
  if (!list.length || !S.players.length) return `<h2>Wisselschema</h2><p class="muted">Voeg eerst spelers en wedstrijden toe.</p>`;
  if (!ui.lineupMatch || !list.find(m => m.id === ui.lineupMatch)) ui.lineupMatch = (list.find(m => m.date >= todayStr()) || list[list.length - 1]).id;
  const m = list.find(x => x.id === ui.lineupMatch); const pres = present(m);
  const B = m.lineup ? (Object.values(m.lineup.cells)[0] || []).length : +S.settings.blocks; const bm = (m.lineup ? m.lineup.matchMinutes : +S.settings.matchMinutes) / Math.max(1, B);
  const season = seasonStats(m);
  let table = "";
  if (m.lineup) {
    const counts = Array(B).fill(0); Object.values(m.lineup.cells).forEach(r => r.forEach((c, b) => { if (c !== "-") counts[b]++; }));
    const rows = pres.filter(p => m.lineup.cells[p.id]).sort((a, b) => a.name.localeCompare(b.name));
    const missing = pres.filter(p => !m.lineup.cells[p.id]);
    table = `<div class="tablewrap"><table><thead><tr><th>Speler</th>${Array.from({ length: B }, (_, b) => `<th class="c">${Math.round(b * bm)}′–${Math.round((b + 1) * bm)}′</th>`).join("")}<th class="c">Deze wedstrijd</th><th class="c">Seizoen vooraf</th></tr></thead><tbody>
      ${rows.map(p => `<tr><td><strong>${esc(p.name)}</strong>${(m.missedTraining || []).includes(p.id) ? ' <span class="pill" title="Niet getraind">NG</span>' : ""}</td>${m.lineup.cells[p.id].map((c, b) => `<td class="c ${c === "-" ? "bench" : "cell-" + c}"><select id="lu-${p.id}-${b}" data-act="cell" data-p="${p.id}" data-b="${b}" aria-label="${esc(p.name)} blok ${b + 1}">${["K", "V", "M", "A", "-"].map(o => `<option value="${o}" ${o === c ? "selected" : ""}>${o === "-" ? "wissel" : o}</option>`).join("")}</select></td>`).join("")}
      <td class="c">${Math.round(lineupMinutes(m, p.id))}′</td><td class="c">${Math.round(season[p.id] ? season[p.id].min : 0)}′</td></tr>`).join("")}
      <tr><td class="muted small">Op het veld</td>${counts.map(n => `<td class="c ${n !== +S.settings.onField ? "" : "muted"}" style="${n !== +S.settings.onField && pres.length >= +S.settings.onField ? "color:var(--bad);font-weight:700" : ""}">${n}</td>`).join("")}<td></td><td></td></tr>
      </tbody></table></div>
      ${missing.length ? `<div class="notice">Nog niet ingedeeld: ${missing.map(p => esc(p.name)).join(", ")}. Maak het schema opnieuw.</div>` : ""}
      <p class="small muted">K = keeper, V = verdediger, M = middenveld, A = aanval. Pas een vakje aan als je iets anders wilt; de minuten rekenen mee.</p>`;
  }
  const att = `<details class="card" ${ui.attOpen ? "open" : ""} id="attbox"><summary>Wie is er? ${S.players.length - pres.length ? `<span class="pill warn">${S.players.length - pres.length} afwezig</span>` : ""} ${(m.missedTraining || []).length ? `<span class="pill">${m.missedTraining.length} niet getraind</span>` : ""}</summary>
    <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Speler</th><th class="c">Aanwezig</th><th class="c">Niet getraind</th></tr></thead><tbody>
    ${S.players.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => { const ab = (m.absent || []).includes(p.id), mt = (m.missedTraining || []).includes(p.id);
      return `<tr><td>${esc(p.name)}</td><td class="c"><input type="checkbox" id="att-${p.id}" data-act="att" data-p="${p.id}" ${ab ? "" : "checked"} ${m.played ? "disabled" : ""} aria-label="${esc(p.name)} aanwezig"></td>
      <td class="c"><input type="checkbox" id="mt-${p.id}" data-act="mt" data-p="${p.id}" ${mt ? "checked" : ""} ${ab || m.played ? "disabled" : ""} aria-label="${esc(p.name)} niet getraind"></td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="small muted">Wie niet getraind heeft, begint op de bank, tenzij er anders te weinig spelers zijn. Daarna telt alleen het eerlijk verdelen van de speelminuten.</p></details>`;
  return `<h2>Wisselschema</h2>
    ${att}
    <div class="card"><div class="grid2">
      <label class="f">Wedstrijd<select id="lu-match" data-act="pickmatch">${list.map(x => `<option value="${x.id}" ${x.id === m.id ? "selected" : ""}>${esc(fmtDate(x.date))} · ${x.home ? "thuis" : "uit"} · ${esc(x.opponent)}${x.played ? " ✓" : ""}</option>`).join("")}</select></label>
      <div class="f"><span>Beschikbaar</span><strong style="font-size:18px">${pres.length} spelers <span class="muted small">voor ${S.settings.onField} plekken, ${B} blokken van ${Math.round(bm)} min</span></strong></div>
    </div>
    <div class="checks"><label><input type="checkbox" id="lu-reserve" data-act="usereserve" ${useReserve(m) ? "checked" : ""} ${m.played ? "disabled" : ""}> Reservekeeper keept de tweede helft${S.players.some(p => (p.positions || []).includes("R")) ? "" : ' <span class="muted small">(geef bij Spelers eerst iemand de positie reservekeeper)</span>'}</label></div>
    <div class="row"><button class="btn primary" data-act="genlineup">${m.lineup ? "Opnieuw maken" : "Maak wisselschema"}</button>
    ${m.lineup ? `<button class="btn ${m.played ? "" : ""}" data-act="played">${m.played ? "✓ Gespeeld (telt mee)" : "Markeer als gespeeld"}</button><button class="btn ghost" data-act="copylineup">Kopieer opstelling</button>` : ""}</div>
    <p class="small muted">Kinderen met de minste speelminuten dit seizoen krijgen voorrang. Wie het vorige blok wisselde, gaat er het volgende blok weer in. Een gespeelde wedstrijd telt mee voor het seizoensoverzicht.</p></div>
    ${table}`;
}
function vSeason() {
  if (!S.players.length) return `<h2>Seizoen</h2><p class="muted">Nog geen spelers.</p>`;
  const st = seasonStats(null); const max = Math.max(1, ...Object.values(st).map(x => x.min));
  const playedN = S.matches.filter(m => m.played).length;
  const dc = {}; S.players.forEach(p => dc[p.id] = { drive: 0, flag: 0, wash: 0 });
  S.matches.forEach(m => Object.entries(m.duties || {}).forEach(([k, ids]) => (ids || []).forEach(id => { if (dc[id]) dc[id][k]++; })));
  const rows = S.players.slice().sort((a, b) => st[b.id].min - st[a.id].min);
  const avg = rows.reduce((s, p) => s + st[p.id].min, 0) / rows.length;
  return `<h2>Seizoen</h2>
  <p class="muted small">${playedN} gespeelde wedstrijd(en) met wisselschema. Gemiddeld ${Math.round(avg)} speelminuten per kind.</p>
  <div class="tablewrap"><table><thead><tr><th>Speler</th><th>Speelminuten</th><th class="c">Min</th><th class="c">% van mogelijk</th><th class="c">Keeper-blokken</th></tr></thead><tbody>
  ${rows.map(p => { const x = st[p.id]; return `<tr><td>${esc(p.name)}</td><td><div class="bar"><i style="width:${(x.min / max * 100).toFixed(0)}%"></i></div></td><td class="c">${Math.round(x.min)}</td><td class="c">${x.avail ? Math.round(x.min / x.avail * 100) + "%" : "–"}</td><td class="c">${x.keeper}</td></tr>`; }).join("")}
  </tbody></table></div>
  <h3>Taken per gezin (hele seizoen, ook gepland)</h3>
  <div class="tablewrap"><table><thead><tr><th>Gezin</th><th class="c">Rijden</th><th class="c">Grensrechter</th><th class="c">Wassen</th><th class="c">Totaal</th></tr></thead><tbody>
  ${S.players.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => { const d = dc[p.id]; return `<tr><td>${esc(parentLabel(p.id))}</td><td class="c">${p.canDrive ? d.drive : "–"}</td><td class="c">${p.canFlag ? d.flag : "–"}</td><td class="c">${p.canWash ? d.wash : "–"}</td><td class="c"><strong>${d.drive + d.flag + d.wash}</strong></td></tr>`; }).join("")}
  </tbody></table></div>`;
}
function vSettings() {
  const s = S.settings;
  return `<h2>Instellingen</h2>
  <form class="card" id="settingsform"><h3>Club en team</h3>
    ${clubSearchBlock("sf")}
    <div class="grid2">
      <label class="f">Club<input id="sf-club" name="club" value="${esc(s.club)}" placeholder="bv. VV De Meeuwen"></label>
      <label class="f">Team<input id="sf-team" name="team" value="${esc(s.team)}" placeholder="bv. JO11-2"></label>
    </div>
    <label class="f">Adres eigen sportcomplex (vertrekpunt bij uitwedstrijden, bv. Sportpark De Wissel, Balk)<input id="sf-addr" name="homeAddress" value="${esc(s.homeAddress)}"></label>
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
    <div class="checks"><label><input type="checkbox" name="flagAway" ${s.flagAway ? "checked" : ""}> Ook grensrechter bij uitwedstrijden</label>
    <label><input type="checkbox" name="washPerMatch" ${s.washPerMatch ? "checked" : ""}> Wassen na elke wedstrijd</label></div>
    <h3>Keeper</h3>
    <div class="checks"><label><input type="checkbox" name="keeperFull" ${s.keeperFull !== false ? "checked" : ""}> Standaard staat de keeper de hele wedstrijd in het doel</label></div>
    <p class="small muted">Per wedstrijd kies je bij Wissels of de reservekeeper de tweede helft keept. De keeper wisselt alleen in de rust. Is de keeper afwezig, dan keept de reservekeeper. Een keeper die de hele wedstrijd staat, maakt meer speelminuten. Het wisselschema verdeelt de rest eerlijk over de veldspelers.</p>
    <div class="row"><button class="btn primary" type="submit">Opslaan</button></div>
  </form>
  ${accountCard()}
  <div class="card"><h3>Back-up</h3>
    <details><summary>Back-up maken of terugzetten</summary><div class="stack" style="margin-top:8px">
      <textarea id="backup" aria-label="Back-up">${esc(JSON.stringify(S))}</textarea>
      <div class="row"><button class="btn" data-act="copybackup">Kopieer back-up</button><button class="btn" data-act="restore">Zet tekst hierboven terug</button></div></div></details>
    <div class="row"><button class="btn ${ui.arm === "reset" ? "arm" : "danger"}" data-act="reset">${ui.arm === "reset" ? "Zeker weten? Alles wordt gewist" : "Alles wissen"}</button>
    <button class="btn ghost" data-act="sample">Voorbeeldteam laden</button></div>
  </div>`;
}

// label, onField, minutes, blocks, formation
const PRESETS = [["6 tegen 6", 6, 40, 4, "2-1-2"], ["8 tegen 8", 8, 60, 4, "3-2-2"], ["JO13 11×11", 11, 60, 4, "4-3-3"],
  ["JO14/JO15 11×11", 11, 70, 4, "4-3-3"], ["JO16/JO17 11×11", 11, 80, 4, "4-3-3"], ["JO19 11×11", 11, 90, 6, "4-3-3"]];

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
  const stop = /^(vv|sv|v\.v\.|s\.v\.|fc|rksv|vvv|sc|cvv|asv|voetbalvereniging|de|het)$/i;
  return String(S.settings.club || "").toLowerCase().split(/\s+/).filter(w => w.length > 1 && !stop.test(w));
}
const TEAMCODE = /\b(?:JO|MO|O|JM)\s?\d{1,2}(?:\s?-\s?\d{1,2})?\b|\b(?:VR|Vrouwen|Heren|Senioren|Zondag|Zaterdag)\s?\d{0,2}\b/i;
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
function loadSample() {
  const names = [["Daan", "K,V"], ["Sem", "V"], ["Liam", "V,M"], ["Noah", "M"], ["Finn", "M,A"], ["Luuk", "A"], ["Mees", "V,M,A"], ["Jesse", "K,M"], ["Bram", "A,M"], ["Ties", "V"], ["Mila", "M,A"]];
  const players = names.map(([n, pos], i) => ({ id: uid(), name: n, parent: "", positions: pos.split(","), canDrive: i % 4 !== 1, canFlag: i % 3 !== 2, canWash: i % 5 !== 3, seats: i % 3 === 0 ? 4 : 3 }));
  const base = new Date(); base.setDate(base.getDate() + ((6 - base.getDay() + 7) % 7 || 7));
  const opp = [["SV Oranje JO11-1", 1, "", 0, "09:00"], ["VV Zuidwijk JO11-3", 0, "Sportpark Zuid, Zuidwijk", 25, "10:30"], ["FC Polder JO11-2", 1, "", 0, "08:45"], ["RKSV De Hoeve JO11-1", 0, "Sportlaan 4, Hoeve", 35, "11:00"], ["SC Dijkzicht JO11-2", 1, "", 0, "09:30"], ["VV Zuidwijk JO11-3", 0, "Sportpark Zuid, Zuidwijk", 25, "09:15"]];
  const matches = opp.map(([o, h, a, t, time], i) => { const d = new Date(base); d.setDate(d.getDate() + 7 * i);
    return { id: uid(), date: d.toISOString().slice(0, 10), time, home: !!h, opponent: o, address: a, travel: t, absent: i === 1 ? [players[3].id] : [] }; });
  S = normalize({ settings: { club: "VV Voorbeeld", team: "JO11-2 (voorbeeld)", homeAddress: "Sportpark Voorbeeld, Dorp" }, players, matches });
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
    case "newplayer": ui.editPlayer = "new"; render(); window.scrollTo(0, 0); break;
    case "editplayer": ui.editPlayer = id; render(); window.scrollTo(0, 0); break;
    case "delplayer": if (armed("delp" + id)) { S.players = S.players.filter(x => x.id !== id); ui.editPlayer = null; save(); render(); } break;
    case "genlineup": { const mm = S.matches.find(x => x.id === ui.lineupMatch); planLineup(mm); save(); render(); toast("Wisselschema gemaakt."); break; }
    case "played": { const mm = S.matches.find(x => x.id === ui.lineupMatch); mm.played = !mm.played; save(); render(); break; }
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
    case "logout": sb.auth.signOut(); break;
    case "copyshare": copy(shareUrl()); break;
    case "rotate": if (armed("rotate")) newShareLink(); break;
    case "calctravel": {
      const info = document.getElementById("travel-info"), btn = t; btn.disabled = true; info.hidden = false; info.textContent = "Bezig met berekenen…";
      const addr = document.getElementById("mf-addr").value.trim(), opp = document.getElementById("mf-opp").value.trim();
      calcTravel(addr, opp).then(r => {
        document.getElementById("mf-travel").value = r.minutes;
        ui.travelCalc = { minutes: r.minutes, km: r.km, label: r.label, addr };
        info.textContent = "Berekend naar: " + r.label + " (" + r.km + " km, " + r.minutes + " min). Klopt de plek niet? Vul het adres in en bereken opnieuw.";
      }).catch(e => { info.textContent = e.message || "Berekenen lukte niet."; }).finally(() => { btn.disabled = false; });
      break; }
    case "calcall": calcMissingTravel(); break;
    case "editduties": ui.editDuties = ui.editDuties === id ? null : id; render(); break;
    case "roundopen": { const ids = sorted().filter(m => m.date >= todayStr()).map(m => m.id);
      setRound(true, ids).then(ok => { if (ok) { render(); toast("Ronde geopend voor " + ids.length + " wedstrijden. Kopieer het bericht voor de ouders."); } }); break; }
    case "roundcopy": copy(roundText()); break;
    case "roundrefresh": loadAvail().then(() => { render(); toast("Bijgewerkt."); }); break;
    case "roundclose": if (armed("roundclose")) closeRound(); break;
    case "clubsearch": doClubSearch(t.dataset.p); break;
    case "clubpick": pickClub(t.dataset.p, +t.dataset.i); break;
    case "copybackup": copy(document.getElementById("backup").value); break;
    case "restore": try { S = normalize(JSON.parse(document.getElementById("backup").value)); save(); render(); toast("Back-up teruggezet."); } catch (x) { toast("Die tekst is geen geldige back-up."); } break;
    case "reset": if (armed("reset")) { S = DEFAULTS(); save(); ui.tab = "planning"; render(); toast("Alles gewist."); } break;
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
    const on = Object.entries(m.lineup.cells).filter(([, r]) => r[b] !== "-").sort((x, y) => "KVMA".indexOf(x[1][b]) - "KVMA".indexOf(y[1][b]));
    const off = Object.entries(m.lineup.cells).filter(([, r]) => r[b] === "-");
    out.push("Blok " + (b + 1) + ": " + on.map(([id, r]) => pName(id) + " (" + r[b] + ")").join(", ") + (off.length ? " | wissel: " + off.map(([id]) => pName(id)).join(", ") : ""));
  }
  return out.join("\n");
}
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "mf-home") { document.getElementById("awayfields").hidden = t.value === "1"; return; }
  if (t.id === "mf-opp") { const k = S.matches.find(x => x.opponent === t.value && !x.home); if (k) { const a = document.getElementById("mf-addr"), tr = document.getElementById("mf-travel"); if (!a.value) a.value = k.address || ""; if (!tr.value) tr.value = k.travel || ""; } return; }
  if (t.dataset.act === "imphome") { const r = ui.importRows[+t.dataset.i]; r.home = t.value === "1"; r.unsure = false; return; }
  if (t.dataset.act === "pickteam") { loadTeam(t.value); return; }
  if (t.dataset.act === "pickmatch") { ui.lineupMatch = t.value; render(); return; }
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
  if (t.dataset.act === "avchild") { ui.avChild = t.value; try { localStorage.setItem("teamplanner.child." + shareToken, t.value); } catch (x) {} render(); return; }
  if (t.dataset.act === "usereserve") { const m = S.matches.find(x => x.id === ui.lineupMatch); m.useReserve = t.checked;
    if (m.lineup && !m.played) { planLineup(m); toast("Wisselschema aangepast."); } save(); render(); return; }
  if (t.dataset.act === "cell") { const m = S.matches.find(x => x.id === ui.lineupMatch); m.lineup.cells[t.dataset.p][+t.dataset.b] = t.value; save(); render(); }
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
    m.date = fd.get("date"); m.time = fd.get("time"); m.home = fd.get("home") === "1"; m.opponent = (fd.get("opponent") || "").trim();
    const newAddr = m.home ? "" : (fd.get("address") || "").trim();
    if (newAddr !== (m.address || "")) { m.travelPlace = ui.travelCalc && ui.travelCalc.addr === newAddr ? ui.travelCalc.label : ""; }
    m.address = newAddr; m.travel = m.home ? 0 : +fd.get("travel") || 0; m.absent = fd.getAll("absent");
    if (ui.travelCalc && !m.home && +ui.travelCalc.minutes === m.travel) { m.km = ui.travelCalc.km; m.travelPlace = ui.travelCalc.label; }
    ui.travelCalc = null;
    if (!id) S.matches.push(m);
    if (m.duties) Object.keys(m.duties).forEach(k => m.duties[k] = (m.duties[k] || []).filter(pid => !m.absent.includes(pid)));
    ui.editMatch = null; save(); render(); toast("Wedstrijd opgeslagen. Verdeel het taakschema opnieuw als er iets veranderd is.");
  } else if (f.id === "playerform") {
    const id = f.dataset.id; const p = id ? pById(id) : { id: uid() };
    p.name = (fd.get("name") || "").trim(); p.parent = (fd.get("parent") || "").trim(); p.positions = fd.getAll("pos");
    p.canDrive = fd.has("canDrive"); p.canFlag = fd.has("canFlag"); p.canWash = fd.has("canWash"); p.seats = +fd.get("seats") || +S.settings.seatsDefault;
    if (!id) S.players.push(p); ui.editPlayer = null; save(); render(); toast("Speler opgeslagen.");
  } else if (f.id === "settingsform") {
    const s = S.settings;
    ["club", "team", "homeAddress", "formation"].forEach(k => s[k] = (fd.get(k) || "").trim());
    ["arriveBefore", "matchMinutes", "blocks", "onField", "seatsDefault"].forEach(k => s[k] = +fd.get(k) || s[k]);
    s.flagAway = fd.has("flagAway"); s.washPerMatch = fd.has("washPerMatch"); s.keeperFull = fd.has("keeperFull");
    const pk = ui.clubPick; if (pk && pk.address === s.homeAddress) s.homeCoords = { lat: pk.lat, lon: pk.lon, address: pk.address, label: pk.name };
    ui.clubPick = null; ui.clubSearch = null;
    save(); render(); toast("Instellingen opgeslagen.");
  }
});

window.__tp = { get S() { return S; }, parseProgram, searchClubs, calcTravel, planDuties, planLineup, seasonStats, times };
render(); init();
})();
