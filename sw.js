// Service worker: bewaart de app zelf, zodat hij ook opent waar geen bereik is (langs het veld).
// De gegevens zelf staan in de browser (localStorage) en in Supabase; verzoeken aan Supabase en kaartdiensten gaan altijd naar het netwerk.
const CACHE = "teamplanner-v34";
const SHELL = [
  "./", "index.html", "privacy.html", "manifest.webmanifest",
  "css/style.css?v=34", "js/i18n.js?v=34", "js/config.js?v=34", "js/app.js?v=34",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("teamplanner-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && !SHELL.includes(req.url)) return; // Supabase, OpenStreetMap, tekstherkenning: altijd via het netwerk
  if (req.mode === "navigate") {
    // Eerst het netwerk (dan krijg je altijd de nieuwste versie), zonder bereik de bewaarde pagina.
    const page = url.pathname.endsWith("privacy.html") ? "privacy.html" : "index.html";
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(page, c)); } return r; })
      .catch(() => caches.match(page)));
    return;
  }
  // Bestanden met een versienummer veranderen niet: eerst uit de bewaarde kopie, anders van het netwerk.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && own) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  })));
});
