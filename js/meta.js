/* DEEPCORE — meta.js
   Foundry meta-progression: profile load/save (localStorage-guarded),
   core awards, upgrade purchases, and consolidated metaEffects for Sim.newRun.
   Also (SPEC3 M-RECAP) the retention record: best per-stratum splits and the
   Daily Shaft history, plus the pure date/seed helpers the Daily runs on.
   DOM-free; localStorage only behind typeof guards. Never throws on bad data.
   Nothing here reads a clock of its own — dailyKey takes the timestamp as an
   argument so the whole module stays a pure function of its inputs. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;

  // Save schema version. v1 profiles (everything shipped before M-RECAP) have
  // no `v` and none of the fields below; sanitize() fills them from
  // newProfile(), so an old save loads with empty history and no ghosts
  // rather than failing. SAVE_KEY is deliberately NOT bumped: a version bump
  // would orphan every existing profile to add two optional fields.
  // v3 (M-EVENTS) adds the logbook and the cat flag. Same story as v2: the
  // fields are optional, sanitize() fills them from newProfile(), so a v1 or
  // v2 profile loads with an empty book and no cat rather than failing — and
  // SAVE_KEY still does not move, because orphaning every existing profile to
  // add two optional fields is not a migration, it is a deletion.
  // v4 (M-ONBOARD Part 2) adds `tutorialSeen`. Same story a third time: the
  // field is optional and sanitize() defaults it to false, so a v1/v2/v3
  // profile loads and plays exactly as it did. A returning player is not shown
  // the induction on the strength of that default either — eligibility is
  // `!tutorialSeen && runs === 0`, and any save old enough to lack the field
  // has runs on it (see DC.Tutorial.eligible).
  // v5 (M-ACHIEVE + M-RIGSKINS) adds the trophy shelf, the Company Ledger's
  // lifetime counters, the schematics-seen set and the livery. A fourth time,
  // the same story: every field is optional, sanitize() defaults it, a v1..v4
  // profile loads with an empty shelf, a zeroed ledger and Company Amber, and
  // SAVE_KEY does not move.
  const SAVE_V = 5;
  const DAILY_HISTORY_MAX = 60;   // ~2 months of dailies, then the oldest drop
  const MAX_DEPTH_KEY = 999;      // the Mantle is endless; the record isn't
  // The logbook's ceiling. Deliberately NOT DC.Events.LOGS.length: meta.js
  // loads whether or not js/events.js does, and a save must not be able to
  // grow an unbounded array of integers just because a corrupt file said so.
  const LOGBOOK_MAX = 64;

  function upgradeDef(id) {
    for (let i = 0; i < D.META_UPGRADES.length; i++) {
      if (D.META_UPGRADES[i].id === id) return D.META_UPGRADES[i];
    }
    return null;
  }

  function newProfile() {
    return {
      v: SAVE_V,
      cores: 0, upgrades: {}, bestDepth: 0, wins: 0, runs: 0, totalCores: 0,
      bestSplits: {},     // depth -> best (lowest) seconds spent in that stratum
      dailyHistory: [],   // [{date, depth, timeSec, won, cores}] oldest first
      // M-EVENTS: indices into DC.Events.LOGS, ascending — the jigsaw, and
      // the one meta flag that is a companion rather than an upgrade.
      logbook: [],
      catFound: false,
      // M-ONBOARD Part 2: the first-run induction has been seen through or
      // waved away. Either way it never comes back.
      tutorialSeen: false,
      // M-ACHIEVE: trophy ids in shelf order, the schematic ids ever dealt,
      // and the lifetime counters the Ledger is composed from. Every number
      // in `life` is ADDED at award time from a real run counter; nothing
      // here is ever typed.
      trophies: [],
      schemsSeen: [],
      life: newLife(),
      // M-RIGSKINS: which livery the chrome wears. Unlocks are not stored —
      // they are a pure function of the rest of the profile (liveryUnlocked).
      skin: 'amber',
      // M-SOUND: the M key. Optional and off by default; engine.js owns it.
      muted: false,
    };
  }

  // The Ledger's counters. Keys are the contract with engine.recordRun.
  const LIFE_KEYS = ['timeSec', 'breaches', 'deaths', 'abandons', 'repairs',
                     'overdrives', 'quakes', 'delivered', 'placed', 'lures', 'wages'];
  const LIFE_MAX = 1e9;
  function newLife() {
    const o = {};
    for (let i = 0; i < LIFE_KEYS.length; i++) o[LIFE_KEYS[i]] = 0;
    return o;
  }
  function trophyDef(id) { return (D.TROPHY_BY_ID && D.TROPHY_BY_ID[id]) || null; }
  function trophyIndex(id) {
    for (let i = 0; i < D.TROPHIES.length; i++) if (D.TROPHIES[i].id === id) return i;
    return D.TROPHIES.length;
  }
  function liveryDef(id) { return (D.LIVERY_BY_ID && D.LIVERY_BY_ID[id]) || null; }

  function storage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* access can throw (privacy modes) */ }
    return null;
  }

  // Merge parsed JSON onto a fresh profile, keeping only sane values.
  function sanitize(p) {
    const f = newProfile();
    if (!p || typeof p !== 'object') return f;
    const nums = ['cores', 'bestDepth', 'wins', 'runs', 'totalCores'];
    for (let i = 0; i < nums.length; i++) {
      const k = nums[i];
      if (typeof p[k] === 'number' && isFinite(p[k]) && p[k] >= 0) f[k] = Math.floor(p[k]);
    }
    if (p.upgrades && typeof p.upgrades === 'object') {
      for (const id in p.upgrades) {
        const def = upgradeDef(id);
        const lv = p.upgrades[id];
        if (def && typeof lv === 'number' && isFinite(lv) && lv > 0) {
          f.upgrades[id] = Math.min(Math.floor(lv), def.max);
        }
      }
    }
    // ---- M-RECAP fields (absent in every v1 save; defaults above stand) ----
    if (p.bestSplits && typeof p.bestSplits === 'object') {
      for (const k in p.bestSplits) {
        const d = parseInt(k, 10);
        const v = p.bestSplits[k];
        if (d >= 1 && d <= MAX_DEPTH_KEY && typeof v === 'number' && isFinite(v) && v > 0) {
          f.bestSplits[String(d)] = Math.round(v * 10) / 10;
        }
      }
    }
    if (Array.isArray(p.dailyHistory)) {
      for (let i = 0; i < p.dailyHistory.length; i++) {
        const e = sanitizeDaily(p.dailyHistory[i]);
        if (e && !dailyEntry(f, e.date)) f.dailyHistory.push(e);
      }
      if (f.dailyHistory.length > DAILY_HISTORY_MAX) {
        f.dailyHistory = f.dailyHistory.slice(-DAILY_HISTORY_MAX);
      }
    }
    // ---- M-EVENTS fields (absent in v1 and v2 saves) ----
    if (Array.isArray(p.logbook)) {
      for (let i = 0; i < p.logbook.length; i++) {
        const n = p.logbook[i];
        if (typeof n === 'number' && isFinite(n) && n >= 0 && n < LOGBOOK_MAX &&
            f.logbook.indexOf(Math.floor(n)) < 0) f.logbook.push(Math.floor(n));
      }
      f.logbook.sort(function (a, b) { return a - b; });
    }
    f.catFound = !!p.catFound;
    // ---- M-ONBOARD field (absent in v1, v2 and v3 saves) ----
    f.tutorialSeen = !!p.tutorialSeen;
    // ---- M-ACHIEVE / M-RIGSKINS fields (absent in v1..v4 saves) ----
    // Trophies are kept in SHELF order regardless of the order they were won
    // in, and an id data.js no longer knows is dropped rather than kept as a
    // ghost on the shelf.
    if (Array.isArray(p.trophies) && D.TROPHIES) {
      for (let i = 0; i < D.TROPHIES.length; i++) {
        if (p.trophies.indexOf(D.TROPHIES[i].id) >= 0) f.trophies.push(D.TROPHIES[i].id);
      }
    }
    if (Array.isArray(p.schemsSeen) && D.SCHEMATICS) {
      for (let i = 0; i < D.SCHEMATICS.length; i++) {
        if (p.schemsSeen.indexOf(D.SCHEMATICS[i].id) >= 0) f.schemsSeen.push(D.SCHEMATICS[i].id);
      }
    }
    if (p.life && typeof p.life === 'object') {
      for (let i = 0; i < LIFE_KEYS.length; i++) {
        const k = LIFE_KEYS[i], v = p.life[k];
        if (typeof v === 'number' && isFinite(v) && v >= 0) f.life[k] = Math.min(Math.floor(v), LIFE_MAX);
      }
    }
    // A livery the profile has not earned (or one that no longer exists)
    // falls back to Company Amber — the save is never the way to a skin.
    if (typeof p.skin === 'string' && liveryDef(p.skin) && liveryUnlocked(f, p.skin)) f.skin = p.skin;
    // ---- M-SOUND field (absent in every save before it) ----
    f.muted = !!p.muted;
    f.v = SAVE_V;
    return f;
  }

  // One Daily Shaft result. Anything malformed is dropped rather than repaired
  // — a corrupt row must never become a fake record.
  function sanitizeDaily(e) {
    if (!e || typeof e !== 'object') return null;
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
    const num = (v, max) => (typeof v === 'number' && isFinite(v) && v >= 0)
      ? Math.min(Math.floor(v), max) : 0;
    return {
      date: e.date,
      depth: num(e.depth, MAX_DEPTH_KEY),
      timeSec: num(e.timeSec, 1e7),
      won: !!e.won,
      cores: num(e.cores, 1e6),
    };
  }

  function load() {
    const ls = storage();
    if (!ls) return newProfile();
    let raw = null;
    try { raw = ls.getItem(D.SAVE_KEY); } catch (e) { return newProfile(); }
    if (!raw) return newProfile();
    try { return sanitize(JSON.parse(raw)); } catch (e) { return newProfile(); }
  }

  function save(profile) {
    const ls = storage();
    if (!ls) return;
    try { ls.setItem(D.SAVE_KEY, JSON.stringify(profile)); } catch (e) { /* quota etc. */ }
  }

  function award(profile, result) {
    const cores = result && typeof result.cores === 'number' ? Math.max(0, result.cores) : 0;
    profile.cores += cores;
    profile.totalCores += cores;
    profile.runs++;
    if (result && typeof result.depth === 'number' && result.depth > profile.bestDepth) {
      profile.bestDepth = result.depth;
    }
    if (result && result.won) profile.wins++;
    save(profile);
  }

  function level(profile, id) {
    return (profile.upgrades && profile.upgrades[id]) || 0;
  }

  function canBuy(profile, id) {
    const def = upgradeDef(id);
    if (!def) return false;
    const lv = level(profile, id);
    return lv < def.max && profile.cores >= def.costs[lv];
  }

  function buy(profile, id) {
    if (!canBuy(profile, id)) return false;
    const def = upgradeDef(id);
    const lv = level(profile, id);
    profile.cores -= def.costs[lv];
    profile.upgrades[id] = lv + 1;
    save(profile);
    return true;
  }

  // Consolidated effects for Sim.newRun (shape per SPEC §10).
  function effects(profile) {
    const L = (id) => level(profile, id);
    return {
      startBonus: {
        ironPlate: 20 * L('m_stock'),
        gear: 4 * L('m_stock'),
        copperPlate: L('m_deep') ? 10 : 0,
        charge: L('m_deep') ? 2 : 0,
      },
      integrityBonus: 25 * L('m_hull'),
      instMult: Math.pow(0.88, L('m_damp')),          // 12% slower per level, multiplicative
      drillMult: Math.pow(1.12, L('m_torque')),       // 12% faster per level, multiplicative
      repairCost: L('m_fix') ? 1 : D.REPAIR_COST,
      scanBonus: L('m_scan') ? 8 : 0,
      salvage: L('m_salv') ? 0.4 : 0,
      offerCount: L('m_schem') ? 4 : 3,
    };
  }

  // ================= M-RECAP: the Daily Shaft & ghost splits =================

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 'YYYY-MM-DD' in UTC for a wall-clock timestamp. The caller owns the clock
  // (engine passes Date.now()); this stays a pure function so the seed a date
  // produces is the same on every machine in every timezone.
  function dailyKey(ms) {
    const d = new Date(typeof ms === 'number' && isFinite(ms) ? ms : 0);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  // FNV-1a over the date string, folded into a positive 31-bit seed — the same
  // range engine.js draws a random seed from, so Sim.newRun sees nothing new.
  function dailySeed(key) {
    const s = String(key);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 1);
  }

  function dailyHistory(profile) {
    if (!profile) return [];
    if (!Array.isArray(profile.dailyHistory)) profile.dailyHistory = [];
    return profile.dailyHistory;
  }

  // The ranked attempt for a date, or null. Presence of one is exactly what
  // makes every later attempt that day practice.
  function dailyEntry(profile, date) {
    const h = dailyHistory(profile);
    for (let i = 0; i < h.length; i++) if (h[i] && h[i].date === date) return h[i];
    return null;
  }

  // Records a Daily result. First attempt of the date ranks and is kept;
  // anything after it is practice and is dropped on the floor (returns false).
  function recordDaily(profile, entry) {
    const e = sanitizeDaily(entry);
    if (!profile || !e) return false;
    if (dailyEntry(profile, e.date)) return false;
    const h = dailyHistory(profile);
    h.push(e);
    while (h.length > DAILY_HISTORY_MAX) h.shift();
    save(profile);
    return true;
  }

  function bestSplits(profile) {
    if (!profile) return {};
    if (!profile.bestSplits || typeof profile.bestSplits !== 'object') profile.bestSplits = {};
    return profile.bestSplits;
  }

  // Best-ever seconds spent clearing `depth`, or 0 when you have never cleared
  // it (0 = "no ghost to race", which is what render checks).
  function bestSplit(profile, depth) {
    const v = bestSplits(profile)[String(depth)];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;
  }

  // Keeps the lower time. Returns true when the record actually moved.
  function recordSplit(profile, depth, sec) {
    const d = Math.floor(depth);
    if (!profile || !(d >= 1 && d <= MAX_DEPTH_KEY)) return false;
    if (!(typeof sec === 'number' && isFinite(sec) && sec > 0)) return false;
    const v = Math.round(sec * 10) / 10;
    const cur = bestSplit(profile, d);
    if (cur && cur <= v) return false;
    bestSplits(profile)[String(d)] = v;
    return true;
  }

  // ===================== M-EVENTS: the logbook & the cat =====================

  function logbook(profile) {
    if (!profile) return [];
    if (!Array.isArray(profile.logbook)) profile.logbook = [];
    return profile.logbook;
  }

  // Files a found log entry. Returns true only when the book actually grew,
  // which is what the Foundry's "NEW" mark and the save write both key on.
  function recordLog(profile, index) {
    const i = Math.floor(index);
    if (!profile || !(i >= 0 && i < LOGBOOK_MAX)) return false;
    const b = logbook(profile);
    if (b.indexOf(i) >= 0) return false;
    b.push(i);
    b.sort(function (a, b2) { return a - b2; });
    save(profile);
    return true;
  }
  function hasLog(profile, index) {
    return logbook(profile).indexOf(Math.floor(index)) >= 0;
  }

  // The cat is not an upgrade and cannot be bought: it is found once, in one
  // vignette, and then it is simply yours.
  function catFound(profile) { return !!(profile && profile.catFound); }
  function findCat(profile) {
    if (!profile || profile.catFound) return false;
    profile.catFound = true;
    save(profile);
    return true;
  }

  // ===================== M-ONBOARD: the induction, once =====================
  // Not an upgrade and not a reward — a one-way door. It is set the moment the
  // player skips or finishes, rather than at the end of the run, because a rig
  // that dies on stratum 1 must not be taught to place an extractor twice.
  function tutorialSeen(profile) { return !!(profile && profile.tutorialSeen); }
  function seeTutorial(profile) {
    if (!profile || profile.tutorialSeen) return false;
    profile.tutorialSeen = true;
    save(profile);
    return true;
  }

  // Whole-run version: engine hands over run.splits at award time. Saves once.
  function recordSplits(profile, splits) {
    if (!profile || !Array.isArray(splits)) return 0;
    let n = 0;
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i];
      if (s && recordSplit(profile, s.depth, s.sec)) n++;
    }
    if (n) save(profile);
    return n;
  }

  // ===================== M-ACHIEVE: the trophy shelf =====================

  function trophies(profile) {
    if (!profile) return [];
    if (!Array.isArray(profile.trophies)) profile.trophies = [];
    return profile.trophies;
  }
  function hasTrophy(profile, id) { return trophies(profile).indexOf(id) >= 0; }
  function allTrophies(profile) {
    if (!D.TROPHIES || !D.TROPHIES.length) return false;
    for (let i = 0; i < D.TROPHIES.length; i++) {
      if (!hasTrophy(profile, D.TROPHIES[i].id)) return false;
    }
    return true;
  }
  // Puts a trophy on the shelf. Returns true only when it is NEW — the
  // engine's "◈ trophy" line and the save write both key on that, so a run
  // that earns FIRST LIGHT for the ninth time says nothing.
  function awardTrophy(profile, id) {
    if (!profile || !trophyDef(id) || hasTrophy(profile, id)) return false;
    const t = trophies(profile);
    t.push(id);
    // shelf order, always
    t.sort(function (a, b) { return trophyIndex(a) - trophyIndex(b); });
    save(profile);
    return true;
  }

  function schemsSeen(profile) {
    if (!profile) return [];
    if (!Array.isArray(profile.schemsSeen)) profile.schemsSeen = [];
    return profile.schemsSeen;
  }
  // Marks a hand of schematics as dealt. Returns how many were new.
  function seeSchematics(profile, ids) {
    if (!profile || !Array.isArray(ids)) return 0;
    const seen = schemsSeen(profile);
    let n = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (typeof id !== 'string' || seen.indexOf(id) >= 0) continue;
      let known = false;
      for (let j = 0; j < D.SCHEMATICS.length; j++) if (D.SCHEMATICS[j].id === id) known = true;
      if (!known) continue;
      seen.push(id);
      n++;
    }
    if (n) save(profile);
    return n;
  }
  function allSchemsSeen(profile) {
    const seen = schemsSeen(profile);
    for (let i = 0; i < D.SCHEMATICS.length; i++) {
      if (seen.indexOf(D.SCHEMATICS[i].id) < 0) return false;
    }
    return D.SCHEMATICS.length > 0;
  }

  function life(profile) {
    if (!profile) return newLife();
    if (!profile.life || typeof profile.life !== 'object') profile.life = newLife();
    for (let i = 0; i < LIFE_KEYS.length; i++) {
      if (typeof profile.life[LIFE_KEYS[i]] !== 'number') profile.life[LIFE_KEYS[i]] = 0;
    }
    return profile.life;
  }
  // Adds one run's worth of counters to the lifetime ledger. `delta` holds
  // DELTAS (the engine owns idempotence — the Mantle path awards twice and
  // hands over only what is new the second time). Saves once.
  function recordRun(profile, delta) {
    if (!profile || !delta || typeof delta !== 'object') return false;
    const L = life(profile);
    let moved = false;
    for (let i = 0; i < LIFE_KEYS.length; i++) {
      const k = LIFE_KEYS[i], v = delta[k];
      if (typeof v === 'number' && isFinite(v) && v > 0) {
        L[k] = Math.min(L[k] + Math.floor(v), LIFE_MAX);
        moved = true;
      }
    }
    if (moved) save(profile);
    return moved;
  }

  // The end-of-run check. `facts` is what the engine knows about the finished
  // run: { won, timeSec, depth, repairs, overdrives, daily, egg }. Returns the
  // ids that are NEW on the shelf, in shelf order. Pure apart from the shelf
  // write; every rule here names a counter that exists.
  function checkTrophies(profile, facts) {
    if (!profile) return [];
    facts = facts || {};
    const won = [];
    const give = function (id) { if (awardTrophy(profile, id)) won.push(id); };
    if (facts.won) {
      give('first_win');
      if (typeof facts.timeSec === 'number' && facts.timeSec < D.SUB15_SEC) give('sub15');
      if (!(facts.repairs > 0)) give('no_repair');
      if (!(facts.overdrives > 0)) give('scenic');
      if (facts.daily) give('daily_win');
      if (facts.egg) give('high_score');
    }
    if (typeof facts.depth === 'number' && facts.depth >= D.TROPHY_DEPTH) give('depth12');
    if (profile.bestDepth >= D.TROPHY_DEPTH) give('depth12');
    if (profile.runs >= D.LIVERY_RUNS) give('company_man');
    if (profile.totalCores >= D.SHAREHOLDER_CORES) give('shareholder');
    if (profile.catFound) give('cat');
    if (allSchemsSeen(profile)) give('schems_all');
    if (DC.Events && Array.isArray(DC.Events.LOGS) && DC.Events.LOGS.length &&
        logbook(profile).length >= DC.Events.LOGS.length) give('logbook_full');
    return won;
  }

  // ---- the Company Ledger ----
  // Lifetime stats as the form the Company files them on. Every value is
  // composed from a profile counter; the labels are the only prose. Rows are
  // {label, value, note} — render draws the leaders, never the numbers.
  function fmtN(n) {
    n = Math.floor(n || 0);
    let s = String(n), out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    return s + out;
  }
  function fmtHours(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h + 'h ' + pad2(m) + 'm';
  }
  function ledger(profile) {
    const p = profile || newProfile();
    const L = life(p);
    const deaths = L.deaths, dailyWins = dailyHistory(p).filter(function (e) { return e && e.won; }).length;
    return [
      { label: 'SHIFTS LOGGED',                    value: fmtN(p.runs) },
      { label: 'SHIFTS CONCLUDED AT THE CORE',     value: fmtN(p.wins),
        note: p.runs ? Math.round(100 * p.wins / p.runs) + '% of quota' : 'no data' },
      { label: 'HOURS ON THE CLOCK',               value: fmtHours(L.timeSec), note: 'unpaid' },
      { label: 'STRATA BREACHED',                  value: fmtN(L.breaches),
        note: fmtN(L.breaches * D.DEPTH_M) + ' m of hole' },
      { label: 'TOTAL VALUE EXTRACTED',            value: fmtN(L.delivered) + ' units' },
      { label: 'STRUCTURES ERECTED',               value: fmtN(L.placed) },
      { label: 'STRUCTURES RETURNED',              value: fmtN(0 * L.placed), note: 'see clause 9' },
      { label: 'SEISMIC EVENTS',                   value: fmtN(L.quakes), note: 'not our fault' },
      { label: 'REPAIRS INVOICED TO OPERATOR',     value: fmtN(L.repairs) },
      { label: 'OVERDRIVE INCIDENTS',              value: fmtN(L.overdrives), note: 'noted' },
      { label: 'CORES REMITTED TO HEAD OFFICE',    value: fmtN(p.totalCores) + ' ◈' },
      { label: 'CORES RETAINED BY OPERATOR',       value: fmtN(p.cores) + ' ◈', note: 'audit pending' },
      { label: 'EMPLOYEE COMPENSATION DISBURSED',  value: (L.wages / 100).toFixed(2) },
      { label: 'CONDOLENCE LETTERS SENT',          value: fmtN(deaths), note: deaths ? 'bulk rate' : '' },
      { label: 'RESIGNATIONS ACCEPTED',            value: fmtN(L.abandons) },
      { label: 'DAILY SHAFTS RANKED',              value: fmtN(dailyHistory(p).length),
        note: dailyWins ? fmtN(dailyWins) + ' concluded' : '' },
      { label: 'LIVESTOCK FED',                    value: fmtN(L.lures) },
      { label: 'CATS ON PAYROLL',                  value: fmtN(p.catFound ? 1 : 0),
        note: p.catFound ? 'unauthorised' : '' },
      { label: 'COMMENDATIONS ON FILE',            value: fmtN(trophies(p).length) + ' / ' + fmtN(D.TROPHIES.length) },
    ];
  }

  // ===================== M-RIGSKINS: liveries =====================
  // Unlocks are DERIVED, never stored: a skin is yours exactly while the
  // profile says so, which is also what makes a hand-edited save honest.
  function liveryUnlocked(profile, id) {
    const def = liveryDef(id);
    if (!def || !profile) return false;
    switch (id) {
      case 'amber':    return true;
      case 'orange':   return dailyHistory(profile).some(function (e) { return e && e.won; });
      case 'gunmetal': return profile.runs >= D.LIVERY_RUNS;
      // TWELVE DOWN itself: the trophy lands the moment the rig arrives on
      // stratum 12 (or from bestDepth at award), so the livery follows it.
      case 'void':     return hasTrophy(profile, 'depth12');
      case 'gold':     return allTrophies(profile);
    }
    return false;
  }
  function liveries(profile) {
    return D.LIVERIES.map(function (l) {
      return { id: l.id, name: l.name, unlock: l.unlock, unlocked: liveryUnlocked(profile, l.id) };
    });
  }
  // The livery the chrome should wear. Falls back to Company Amber if the
  // chosen one is somehow no longer earned.
  function livery(profile) {
    const id = profile && typeof profile.skin === 'string' ? profile.skin : 'amber';
    return liveryUnlocked(profile, id) ? id : 'amber';
  }
  function setLivery(profile, id) {
    if (!profile || !liveryUnlocked(profile, id)) return false;
    if (profile.skin === id) return true;
    profile.skin = id;
    save(profile);
    return true;
  }
  // [S] on the Foundry: the next unlocked livery after the current one.
  function cycleLivery(profile) {
    if (!profile) return 'amber';
    const cur = livery(profile);
    const n = D.LIVERIES.length;
    let i = 0;
    for (let k = 0; k < n; k++) if (D.LIVERIES[k].id === cur) i = k;
    for (let k = 1; k <= n; k++) {
      const id = D.LIVERIES[(i + k) % n].id;
      if (liveryUnlocked(profile, id)) { setLivery(profile, id); return id; }
    }
    return cur;
  }

  DC.Meta = {
    load, save, newProfile, award, canBuy, buy, effects,
    // M-RECAP
    SAVE_V, DAILY_HISTORY_MAX,
    dailyKey, dailySeed, dailyEntry, dailyHistory, recordDaily,
    bestSplit, bestSplits, recordSplit, recordSplits,
    // M-EVENTS
    LOGBOOK_MAX,
    logbook, recordLog, hasLog, catFound, findCat,
    // M-ONBOARD
    tutorialSeen, seeTutorial,
    // M-ACHIEVE
    LIFE_KEYS,
    trophies, hasTrophy, awardTrophy, allTrophies, checkTrophies,
    schemsSeen, seeSchematics, allSchemsSeen,
    life, recordRun, ledger, fmtN,
    // M-RIGSKINS
    liveryUnlocked, liveries, livery, setLivery, cycleLivery,
  };
})();
