// Nep-Supabase voor de tests: een kleine database in localStorage, met dezelfde regels als supabase/schema.sql
// (versienummer omhoog bij elke wijziging) en een schakelaar om "geen internet" na te bootsen.
(function () {
  const KEY = "fakedb";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "null") || { teams: [], team_versions: [], availability: [], team_members: [], team_invites: [] };
  const store = db => localStorage.setItem(KEY, JSON.stringify(db));
  const offline = () => localStorage.getItem("fake.offline") === "1";
  const USER = { id: "u1", email: "coach@example.org" };
  const pick = (row, cols) => { if (!cols || cols === "*") return { ...row }; const o = {}; cols.split(",").forEach(c => o[c.trim()] = row[c.trim()]); return o; };
  function builder(table) {
    const q = { table, filters: [], op: "select", cols: "*", single: false, wantRows: false };
    const b = {
      select(c) { if (q.op === "select") q.cols = c || "*"; else { q.wantRows = true; q.cols = c || "*"; } return b; },
      update(v) { q.op = "update"; q.val = v; return b; }, insert(v) { q.op = "insert"; q.val = v; return b; }, delete() { q.op = "delete"; return b; },
      eq(k, v) { q.filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; }, single() { q.single = true; return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    function run() {
      if (offline()) return { data: null, error: { message: "TypeError: Failed to fetch" } };
      const db = load(); const rows = db[table] = db[table] || [];
      const match = r => q.filters.every(([k, v]) => String(r[k]) === String(v));
      let out;
      if (q.op === "select") out = rows.filter(match).map(r => pick(r, q.cols));
      else if (q.op === "insert") {
        const r = { ...q.val }; if (table === "teams") Object.assign(r, { id: "t" + (rows.length + 1), owner: USER.id, rev: 0, share_token: "tok" + Date.now(), avail_open: false, avail_matches: [] });
        if (table === "team_versions") Object.assign(r, { id: Date.now() + Math.random(), created_at: new Date().toISOString() });
        rows.push(r); out = [pick(r, q.cols)];
      } else if (q.op === "update") {
        out = [];
        rows.filter(match).forEach(r => {
          if (table === "teams" && q.val.data && JSON.stringify(q.val.data) !== JSON.stringify(r.data)) r.rev++;
          Object.assign(r, q.val); out.push(pick(r, q.cols));
        });
      } else { const keep = rows.filter(r => !match(r)); out = rows.filter(match); db[table] = keep; }
      store(db);
      if (q.single) return out.length ? { data: out[0], error: null } : { data: null, error: { message: "not found" } };
      return { data: q.op === "select" || q.wantRows ? out : null, error: null };
    }
    return b;
  }
  window.supabase = { createClient() {
    return {
      auth: {
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        async getSession() { return { data: { session: { user: USER } } }; },
        async signOut() {}
      },
      from: builder,
      async rpc(name) {
        if (offline()) return { data: null, error: { message: "TypeError: Failed to fetch" } };
        if (name === "teamplanner_schema") return { data: 2, error: null };
        if (name === "team_people") return { data: [{ user_id: USER.id, email: USER.email, is_owner: true }], error: null };
        return { data: null, error: { message: "unknown rpc" } };
      },
      storage: { from() { return { list: async () => ({ data: [] }), remove: async () => ({}), upload: async () => ({ error: { message: "niet in test" } }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }; } }
    };
  } };
})();
