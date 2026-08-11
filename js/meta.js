/* DEEPCORE — meta.js
   Foundry meta-progression: profile load/save (localStorage-guarded),
   core awards, upgrade purchases, and consolidated metaEffects for Sim.newRun.
   DOM-free; localStorage only behind typeof guards. Never throws on bad data. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;

  function upgradeDef(id) {
    for (let i = 0; i < D.META_UPGRADES.length; i++) {
      if (D.META_UPGRADES[i].id === id) return D.META_UPGRADES[i];
    }
    return null;
  }

  function newProfile() {
    return { cores: 0, upgrades: {}, bestDepth: 0, wins: 0, runs: 0, totalCores: 0 };
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
    return f;
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

  DC.Meta = { load, save, newProfile, award, canBuy, buy, effects };
})();
