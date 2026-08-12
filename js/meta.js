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
  const SAVE_V = 2;
  const DAILY_HISTORY_MAX = 60;   // ~2 months of dailies, then the oldest drop
  const MAX_DEPTH_KEY = 999;      // the Mantle is endless; the record isn't

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
    };
  }

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

  DC.Meta = {
    load, save, newProfile, award, canBuy, buy, effects,
    // M-RECAP
    SAVE_V, DAILY_HISTORY_MAX,
    dailyKey, dailySeed, dailyEntry, dailyHistory, recordDaily,
    bestSplit, bestSplits, recordSplit, recordSplits,
  };
})();
