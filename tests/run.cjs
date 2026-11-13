// Tests voor de planners en de belangrijkste schermen. Draaien: npm test (of: node tests/run.cjs).
// De app draait in een echte browser (Playwright) zonder Supabase, dus met de gegevens in de browser.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
let failed = 0, passed = 0;
function check(name, ok, info) { if (ok) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name + (info ? "  →  " + info : "")); } }

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
  }).listen(0);
  const url = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  // Zonder Supabase: lege configuratie en geen externe scripts.
  await page.route("**/js/config.js*", r => r.fulfill({ contentType: "text/javascript", body: "window.TEAMPLANNER_CONFIG = {};" }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.goto(url); await page.waitForFunction(() => window.__tp);

  const ev = (fn, arg) => page.evaluate(fn, arg);
  // Een team van 13 spelers, 10 wedstrijden in de toekomst, afwisselend thuis en uit.
  const team = () => {
    const names = ["Daan", "Sem", "Liam", "Noah", "Finn", "Luuk", "Mees", "Jesse", "Bram", "Ties", "Mila", "Saar", "Joep"];
    const pos = [["K"], ["V"], ["V"], ["V", "M"], ["M"], ["M"], ["M", "A"], ["A"], ["A"], ["R", "V"], ["M"], ["V"], ["A", "M"]];
    const players = names.map((n, i) => ({ id: "p" + i, name: n, parent: "", positions: pos[i], canDrive: i !== 3, canFlag: i !== 5, canWash: true, seats: 3 }));
    const d0 = new Date(); d0.setDate(d0.getDate() + 3);
    const matches = Array.from({ length: 10 }, (_, i) => { const d = new Date(d0); d.setDate(d.getDate() + 7 * i);
      return { id: "m" + i, date: d.toISOString().slice(0, 10), time: "10:00", home: i % 2 === 0, opponent: "Club " + i + " JO15-1", address: "", travel: i % 2 ? 30 : 0, absent: i === 4 ? ["p7"] : [] }; });
    return { settings: { club: "VV Test", team: "JO15-2", onField: 11, matchMinutes: 70, blocks: 4, formation: "4-3-3", arriveBefore: 45, washPerMatch: true }, players, matches };
  };

  console.log("Taakschema");
  const strict = team(); strict.settings.washWithDuty = false; // eerlijkheid van het wassen los van "wastas mee met wie al een taak heeft"
  const duty = await ev(T => {
    const tp = window.__tp; tp.S = T; tp.setAvail([]); tp.planDuties();
    const S = tp.S; const res = { perMatchOk: true, absentOk: true, capOk: true, issues: 0, counts: {} };
    S.players.forEach(p => res.counts[p.id] = { drive: 0, flag: 0, wash: 0 });
    S.matches.forEach(m => {
      const all = [...(m.duties.drive || []), ...(m.duties.flag || []), ...(m.duties.wash || [])];
      const per = {}; all.forEach(id => per[id] = (per[id] || 0) + 1);
      if (Object.values(per).some(n => n > 1) && !m.home) { /* rijden + wastas mee mag */ }
      if ((m.duties.flag || []).some(id => (m.duties.drive || []).includes(id))) res.perMatchOk = false;
      if (all.some(id => (m.absent || []).includes(id))) res.absentOk = false;
      res.issues += tp.dutyIssues(m).length;
      Object.entries(m.duties).forEach(([k, ids]) => ids.forEach(id => res.counts[id][k]++));
    });
    return res;
  }, strict);
  check("geen gezin krijgt grensrechter én rijden op één dag", duty.perMatchOk);
  check("afwezige kinderen: hun ouders krijgen geen taak", duty.absentOk);
  check("bij elke wedstrijd is alles ingevuld", duty.issues === 0, duty.issues + " meldingen");
  const spread = k => { const v = Object.values(duty.counts).map(c => c[k]); return Math.max(...v) - Math.min(...v); };
  check("wassen eerlijk verdeeld (verschil hoogstens 1)", spread("wash") <= 1, "verschil " + spread("wash"));
  const flags = Object.entries(duty.counts).filter(([id]) => id !== "p5").map(([, c]) => c.flag);
  check("grensrechter eerlijk verdeeld onder wie kan", Math.max(...flags) - Math.min(...flags) <= 1);
  check("wie niet kan rijden, rijdt nooit", duty.counts.p3.drive === 0);

  const cancel = await ev(T => {
    const tp = window.__tp; tp.S = T; tp.planDuties(); const S = tp.S;
    S.matches[0].cancelled = true; tp.planDuties();
    return { duties: S.matches[0].duties, issues: tp.dutyIssues(S.matches[0]).length, text: tp.matchText(S.matches[0]) };
  }, team());
  check("afgelaste wedstrijd heeft geen taken en geen meldingen", !cancel.duties && cancel.issues === 0);
  check("bericht van een afgelaste wedstrijd zegt dat hij is afgelast", /Afgelast|Cancelled|Abgesagt|Annulé/.test(cancel.text), cancel.text);

  console.log("Wisselschema");
  const lu = await ev(T => {
    const tp = window.__tp; tp.S = T; const S = tp.S; const out = { fieldOk: true, keeperOk: true, spread: 0 };
    for (let i = 0; i < 6; i++) {
      const m = S.matches[i]; tp.planLineup(m); m.played = true;
      const C = m.lineup.durs.length; const ids = Object.keys(m.lineup.cells);
      for (let b = 0; b < C; b++) {
        const on = ids.filter(id => m.lineup.cells[id][b] !== "-");
        if (on.length !== Math.min(11, ids.length)) out.fieldOk = false;
        if (on.filter(id => m.lineup.cells[id][b] === "K").length !== 1) out.keeperOk = false;
      }
    }
    const st = tp.seasonStats(null); const field = Object.entries(st).filter(([id]) => id !== "p0").map(([id, x]) => x.min / Math.max(1, x.avail));
    out.spread = Math.round((Math.max(...field) - Math.min(...field)) * 100);
    out.keeper = st.p0.keeper;
    return out;
  }, team());
  check("elk blok precies 11 spelers in het veld", lu.fieldOk);
  check("elk blok precies één keeper", lu.keeperOk);
  check("speeltijd eerlijk verdeeld over 6 wedstrijden (verschil < 15%)", lu.spread < 15, lu.spread + "%");

  const replan = await ev(T => {
    const tp = window.__tp; tp.S = T; const S = tp.S; const m = S.matches[1]; tp.planLineup(m);
    const before = JSON.stringify(m.lineup.cells.p1.slice(0, 2));
    tp.planLineup(m, { from: 2, exclude: ["p1"] });
    const C = m.lineup.durs.length; const ids = Object.keys(m.lineup.cells); let ok = true;
    for (let b = 2; b < C; b++) if (ids.filter(id => m.lineup.cells[id][b] !== "-").length !== 11) ok = false;
    return { kept: JSON.stringify(m.lineup.cells.p1.slice(0, 2)) === before, out: m.lineup.cells.p1.slice(2).every(c => c === "-"), ok };
  }, team());
  check("opnieuw indelen tijdens de wedstrijd laat eerdere blokken staan", replan.kept);
  check("geblesseerde speler staat de rest van de wedstrijd op de bank", replan.out);
  check("na opnieuw indelen nog steeds 11 in het veld", replan.ok);

  const swap = await ev(T => {
    const tp = window.__tp; tp.S = T; const S = tp.S; const m = S.matches[1]; tp.planLineup(m);
    const ids = Object.keys(m.lineup.cells); const on = ids.find(id => m.lineup.cells[id][0] !== "-" && m.lineup.cells[id][0] !== "K"); const off = ids.find(id => m.lineup.cells[id][0] === "-");
    const a = tp.lineupMinutes(m, on), b = tp.lineupMinutes(m, off);
    m.live = { acc: 5 * 60000, since: null, halfDone: false, swaps: [] }; // 5e minuut, blok 1 duurt 17,5 min
    tp.liveSwap(m, on, off);
    return { outLost: a - tp.lineupMinutes(m, on), inGot: tp.lineupMinutes(m, off) - b };
  }, team());
  check("wissel tijdens de wedstrijd telt de echte minuten", Math.abs(swap.outLost - 12.5) < 0.01 && Math.abs(swap.inGot - 12.5) < 0.01, JSON.stringify(swap));

  const count = await ev(T => {
    const tp = window.__tp; T.matches[0].date = "2020-01-04"; T.matches[0].lineup = { cells: { p1: ["CV"] }, durs: [70], matchMinutes: 70 }; tp.S = T; const S = tp.S;
    const a = tp.counts(S.matches[0]); S.matches[0].cancelled = true; return { past: a, cancelled: tp.counts(S.matches[0]) };
  }, team());
  check("voorbije wedstrijd telt mee, ook zonder vinkje gespeeld", count.past === true);
  check("afgelaste wedstrijd telt niet mee", count.cancelled === false);

  console.log("Overig");
  const misc = await ev(() => {
    const tp = window.__tp;
    const rows = tp.parseProgram("za 14 nov 10:30 VV Test JO15-2 - SC Joure JO15-1\nza 21 nov 12:00 Heerenveen JO15-3 - VV Test JO15-2");
    tp.S = { settings: { club: "VV Test", team: "JO15-2", arriveBefore: 45 }, players: [], matches: [] };
    const tm = tp.times({ home: false, time: "10:30", travel: 28 });
    return { n: rows.length, homes: rows.map(r => r.home), depart: tm.depart, arrive: tm.arrive };
  });
  check("programma plakken herkent 2 wedstrijden, thuis en uit", misc.n === 2 && misc.homes[0] === true && misc.homes[1] === false, JSON.stringify(misc));
  check("vertrektijd naar beneden afgerond op 5 minuten", misc.depart === "09:15" && misc.arrive === "09:45", misc.depart);

  console.log("Schermen");
  await ev(T => { localStorage.setItem("teamplanner.v1", JSON.stringify(T)); }, team());
  await page.reload(); await page.waitForFunction(() => window.__tp);
  for (const tab of ["planning", "matches", "players", "lineup", "season", "settings"]) {
    await page.click(`nav.tabs button[data-tab="${tab}"]`);
    const txt = await page.textContent("main");
    check("tabblad " + tab + " zonder kapotte tekst", !/\$\{|undefined|NaN/.test(txt), (txt.match(/.{20}(\$\{|undefined|NaN).{20}/) || [])[0]);
  }
  check("voorbeeldteam-knop verborgen als het team al gegevens heeft", !(await page.$('[data-act="sample"]')));
  // Alles wissen en terugzetten via eerdere versies
  await page.click('[data-act="reset"]'); await page.click('[data-act="reset"]');
  await page.waitForFunction(() => window.__tp.S.players.length === 0);
  await page.click('nav.tabs button[data-tab="settings"]'); await page.click('[data-act="versions"]');
  const ver = await page.$('[data-act="restorever"]'); check("na alles wissen staat er een eerdere versie", !!ver);
  if (ver) { await ver.click(); await page.click('[data-act="restorever"]'); await page.waitForTimeout(200); }
  check("eerdere versie terugzetten brengt de spelers terug", (await ev(() => window.__tp.S.players.length)) === 13);
  // Wedstrijdmodus
  await page.click('nav.tabs button[data-tab="lineup"]'); await page.click('[data-act="genlineup"]');
  await page.click('[data-act="golive"]');
  check("wedstrijdmodus toont de klok", !!(await page.$("#live-clock")));
  await page.click('[data-act="liveclock"]'); await page.waitForTimeout(2300);
  const clock = await page.textContent("#live-clock"); check("klok loopt", clock !== "00:00", clock);
  await page.click('[data-act="liveend"]'); await page.click('[data-act="liveend"]');
  check("wedstrijd afgelopen: gemarkeerd als gespeeld", await ev(() => window.__tp.S.matches.some(m => m.played)));
  const shot = path.join(__dirname, "screens"); fs.mkdirSync(shot, { recursive: true });
  await page.click('nav.tabs button[data-tab="planning"]'); await page.screenshot({ path: path.join(shot, "planning.png"), fullPage: true });
  check("geen JavaScript-fouten", errors.length === 0, errors.join(" | "));

  console.log("Online opslaan, offline en gelijktijdig wijzigen (met een nep-Supabase)");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage();
  const errs2 = []; pg.on("pageerror", e => errs2.push(e.message));
  await pg.route("**/js/config.js*", r => r.fulfill({ contentType: "text/javascript", body: 'window.TEAMPLANNER_CONFIG = { supabaseUrl: "https://fake.supabase.co", supabaseAnonKey: "x" };' }));
  await pg.route("**/supabase-js@*/**", r => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "fake-supabase.js"), "utf8") }));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr)/, r => r.abort());
  await pg.goto(url);
  await pg.evaluate(T => localStorage.setItem("fakedb", JSON.stringify({ teams: [{ id: "t1", owner: "u1", name: "VV Test JO15-2", data: T, rev: 5, share_token: "abc", avail_open: false, avail_matches: [] }], team_versions: [] })), team());
  await pg.reload(); await pg.waitForFunction(() => window.__tp && window.__tp.S.players.length === 13);
  const db = () => pg.evaluate(() => JSON.parse(localStorage.getItem("fakedb")));
  const addPlayer = async name => { await pg.click('nav.tabs button[data-tab="players"]'); await pg.click("#bulkbox summary").catch(() => {}); await pg.fill("#bulk-text", name); await pg.click('[data-act="bulkadd"]'); };
  await addPlayer("Online Olaf"); await pg.waitForTimeout(1500);
  let d = await db(); check("wijziging komt online aan en het versienummer gaat omhoog", d.teams[0].data.players.some(p => p.name === "Online Olaf") && d.teams[0].rev === 6, "rev " + d.teams[0].rev);
  // Geen internet: wijzigen, pagina herladen, wijziging blijft staan en gaat later alsnog mee.
  await pg.evaluate(() => localStorage.setItem("fake.offline", "1"));
  await addPlayer("Offline Otto"); await pg.waitForTimeout(1500);
  check("zonder internet meldt de app dat het op het apparaat bewaard is", /bewaard|opnieuw/.test(await pg.textContent("#sync")), await pg.textContent("#sync"));
  await pg.reload(); await pg.waitForFunction(() => window.__tp && window.__tp.S.players.length > 0);
  check("na herladen zonder internet staat de wijziging er nog", await pg.evaluate(() => window.__tp.S.players.some(p => p.name === "Offline Otto")));
  await pg.evaluate(() => { localStorage.setItem("fake.offline", "0"); window.dispatchEvent(new Event("online")); }); await pg.waitForTimeout(1500);
  d = await db(); check("weer internet: de offline wijziging is alsnog opgeslagen", d.teams[0].data.players.some(p => p.name === "Offline Otto"));
  // Iemand anders slaat tussendoor op.
  await pg.evaluate(() => { const x = JSON.parse(localStorage.getItem("fakedb")); x.teams[0].data.players.push({ id: "z", name: "Andere Anna", positions: [] }); x.teams[0].rev += 1; localStorage.setItem("fakedb", JSON.stringify(x)); });
  await addPlayer("Mijn Max"); await pg.waitForTimeout(1500);
  check("gelijktijdig wijzigen: de app vraagt welke versie je houdt", !!(await pg.$('[data-act="conflictmine"]')));
  d = await db(); check("en overschrijft de ander niet stilletjes", d.teams[0].data.players.some(p => p.name === "Andere Anna") && !d.teams[0].data.players.some(p => p.name === "Mijn Max"));
  if (await pg.$('[data-act="conflictmine"]')) { await pg.click('[data-act="conflictmine"]'); await pg.waitForTimeout(1500); }
  d = await db(); check("mijn versie houden: opgeslagen, en de andere staat bij eerdere versies", d.teams[0].data.players.some(p => p.name === "Mijn Max") && d.team_versions.some(v => v.data.players.some(p => p.name === "Andere Anna")));
  await pg.click('nav.tabs button[data-tab="settings"]');
  check("instellingen tonen coaches en team verwijderen", !!(await pg.$('[data-act="people"]')) && !!(await pg.$('[data-act="delteam"]')));
  await pg.screenshot({ path: path.join(shot, "instellingen.png"), fullPage: true });
  check("geen JavaScript-fouten (online)", errs2.length === 0, errs2.join(" | "));

  await browser.close(); server.close();
  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
