// A deterministic, state-aware schematic choice for the balance harness.
// Scores express useful effects for THIS builder, not optimal human play.
module.exports = function pickSchematic(D, run) {
  const m=run.mods, next=run.depth+1, built=(run.stats && run.stats.placed)||{};
  const health=run.integrity/Math.max(1,run.maxIntegrity);
  const charges=next>=5, poor=(run.inv.ironPlate||0)<30;
  const score={
    s_beltfree: m.beltFree ? 0 : poor ? 95 : 65,
    s_extract: 38, s_smelt: 48, s_coal: m.coalX2 ? 0 : 42,
    s_plate: health<.55 ? 100 : 35,
    s_damp: 60 + Math.min(25,run.instability/4),
    s_repair: m.autoRepair ? 0 : next>=4 ? 68 : 30,
    s_drill: 75, s_salvage: 0, // builder scraps before descent; nothing remains to salvage
    s_survey: m.fullReveal ? 0 : 15,
    s_charge: m.chargeX2 ? 0 : charges ? 90 : 25,
    s_over: m.overCheap ? 0 : 18,
    s_veins: m.richVeins ? 0 : 32,
    s_gear: 2, // the builder cannot route bronze recipes
    s_conduit: built.tunnel ? 28 : 0,
    s_yoke: 0, s_gate: 0, s_grind: 0, // these machines are outside this builder's repertoire
    s_boiler: 0, // no deliberate magma siting
    s_echo: m.echoCharge ? 0 : charges ? 52 : 12,
    s_chute: m.refund>=D.CHUTE_REFUND ? 0 : poor ? 70 : 44,
    s_jury: health>.8 ? 12 : -10,
    s_insure: m.insurance ? 0 : health<.4 ? 110 : 58,
    s_loop: m.closedLoop ? 0 : (built.damper||0)>0 ? 74 : 20,
    s_whisper: 0, // no cursor lure actions in the bot
  };
  for (const card of D.SCHEMATICS) if (!(card.id in score))
    throw new Error('Balance policy has no evaluation for '+card.id);
  return run.pendingOffers.reduce((best,id)=>score[id]>score[best] ? id : best);
};
