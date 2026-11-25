/**
 * Moteur de simulation de combat Boss — Tower of God: New World
 * Basé 100 % sur les tables de tog_data_decrypted.db (window.TOG_DB)
 * et le pipeline DamageCalculator (FOAMBPPLDPL).
 */
(function (global) {
  "use strict";

  const DB = global.TOG_DB || (typeof require !== "undefined" ? require("../data/db-bundle.js") : null);
  if (!DB) throw new Error("TOG_DB non chargé. Chargez data/db-bundle.js avant engine/simulator.js.");

  const CFG = DB.BATTLE_CONFIG;

  const LIMIT_BREAK_MULT = {
    0: 1.00,
    3: 1.32,
    6: 1.70,
    9: 2.18,
    12: 2.75,
    15: 3.45,
    18: 4.10,
    21: 4.75
  };

  function getLimitBreakMult(lb) {
    const n = Number(lb || 0);
    if (LIMIT_BREAK_MULT[n] !== undefined) return LIMIT_BREAK_MULT[n];
    const keys = Object.keys(LIMIT_BREAK_MULT).map(Number).sort((a, b) => a - b);
    let best = 1.0;
    for (const k of keys) {
      if (n >= k) best = LIMIT_BREAK_MULT[k];
    }
    return best;
  }

  function TruncatePoint3(value) {
    return Math.trunc(value * 1000) / 1000;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function createSeededRandom(seed) {
    let s = (seed >>> 0) || 133742;
    return function next() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function createEmptyStatBlock() {
    return {
      health: 0,
      healthRating: 0,
      attack: 0,
      attackRating: 0,
      defense: 0,
      defenseRating: 0,
      defenseResistRating: 0,
      defShred: 0,
      critRating: 0,
      critBonusRating: 0,
      critResistRating: 0,
      critReduceRating: 0,
      accuracy: 0,
      dodge: 0,
      dodgePctShred: 0,
      haste: 0,
      attackHaste: 0,
      startEnergy: 0,
      recoveryRating: 0,
      recoveryEnergy: 0,
      acquisitionEnergyRating: 0,
      magicResistRating: 0,
      physicalResistRating: 0,
      magicIncreaseRating: 0,
      physicalIncreaseRating: 0,
      lifeLeechRating: 0,
      dmgUpToLightRating: 0,
      dmgUpToDarknessRating: 0,
      dmgUpToFireRating: 0,
      dmgUpToWaterRating: 0,
      dmgUpToLandRating: 0,
      dmgDownFromLightRating: 0,
      dmgDownFromDarknessRating: 0,
      dmgDownFromFireRating: 0,
      dmgDownFromWaterRating: 0,
      dmgDownFromLandRating: 0,
      dmgUpInCampaign: 0,
      healRating: 0,
      acquisitionHealthRating: 0,
      acquisitionHealthFinal: 0,
      finalResistRating: 1.0,
      finalResist2Rating: 1.0,
      fixedDamageResistRating: 1.0,
      magicPierceRating: 0,
      physicalPierceRating: 0,
      debuffAccuracy: 0,
      debuffDodge: 0,
      cooltimeReductionRating: 0,
      ultimatePierceRating: 0,
      ultimateResistRating: 0,
      ultimateIncreaseRating: 0,
      normalPierceRating: 0,
      normalResistRating: 0,
      normalIncreaseRating: 0,
      normalBonusAtkRate: 0,
      basicAttackCoefBonus: 0,
      extraBasicHits: 0,
      shinsuCoreLevel: 0,
      overwhelmingPierceRating: 0,
      overwhelmingResistRating: 0,
      overwhelmingHealBossPierceRating: 0,
      overwhelmingHealBossResistRating: 0
    };
  }

  function addStatsInto(target, source, factor) {
    if (!source) return;
    const f = factor === undefined ? 1 : factor;
    for (const k of Object.keys(source)) {
      if (Object.prototype.hasOwnProperty.call(target, k) && typeof source[k] === "number") {
        target[k] += source[k] * f;
      }
    }
  }

  function getSlotRow(slotIndex, bossConfig) {
    const fc = Number(bossConfig?.frontCount ?? 3);
    return slotIndex < fc ? "FRONT" : "BACK";
  }

  const EMPTY_IGN_SET = {
    id: "none",
    name: "Aucun (IW 0)",
    soulLv: 0,
    bonus2p: {},
    bonus4p: {}
  };

  function getEffectiveIgnSet(setKey, soulLv) {
    const base = DB.IGNITION_SETS[setKey] || DB.IGNITION_SETS.asura;
    const lv = clamp(Math.round(Number(soulLv) || 0), 0, 30);
    return Object.assign({}, base, {
      soulLv: lv,
      bonus2p: (lv >= 15 && base.soulBonus2p) ? base.soulBonus2p : base.bonus2p,
      bonus4p: (lv >= 30 && base.soulBonus4p) ? base.soulBonus4p : base.bonus4p
    });
  }

  function getEffectiveAirship(airshipId, prog) {
    const base = DB.AIRSHIPS[airshipId] || DB.AIRSHIPS.none;
    if (!base || base.id === "none") return base;
    const info = prog?.airships && prog.airships[base.id];
    if (!info) return base;
    const level = Math.max(0, Number(info.level || 0));
    const skillLv = clamp(Number(info.skillLv || 1), 1, 5);
    const scale = skillLv / 5;
    const rarScale = DB.SHIP_STAT_SCALING?.[base.rarity] || { base: 0.10, perLv: 0.03 };
    const shipStatVal = +(rarScale.base + level * rarScale.perLv).toFixed(4);
    const scaleStats = (obj) => {
      if (!obj) return null;
      const res = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number") res[k] = v * scale;
      }
      return res;
    };
    return Object.assign({}, base, {
      name: `${base.name.replace(/\s*\(.*\)$/, "")} (Niv.${level} · Comp. ${skillLv}/5)`,
      shipGlobalStats: { healthRating: shipStatVal, attackRating: shipStatVal, defenseRating: shipStatVal },
      passiveStats: scaleStats(base.passiveStats),
      factionBonusStats: scaleStats(base.factionBonusStats),
      enemyDebuff: scaleStats(base.enemyDebuff),
      enemyAdvantageDebuff: scaleStats(base.enemyAdvantageDebuff)
    });
  }

  function getShinsuMult(level) {
    const lv = clamp(Math.round(Number(level) || 1914), 1, DB.SLOT_LEVEL_MULT.length - 1);
    return DB.SLOT_LEVEL_MULT[lv] || 1.0;
  }

  function getSlotGradeMult(level) {
    const lv = Number(level) || 1914;
    for (const g of DB.SLOT_GRADES) {
      if (lv <= g.maxLv) return g.mult;
    }
    return 2.764;
  }

  function computeTeamFactionCombo(teamConfigs) {
    const counts = {};
    for (const u of teamConfigs) {
      const char = DB.CHARACTERS.find(c => c.id === u.charId);
      if (!char) continue;
      counts[char.faction] = (counts[char.faction] || 0) + 1;
    }
    const vals = Object.values(counts).sort((a, b) => b - a);
    const max1 = vals[0] || 0;
    const max2 = vals[1] || 0;
    if (max1 >= 5) return { label: "5 Même Faction (+15% PV/ATQ)", attackRating: 0.15, healthRating: 0.15 };
    if (max1 >= 4) return { label: "4 Même Faction (+13% PV/ATQ)", attackRating: 0.13, healthRating: 0.13 };
    if (max1 >= 3 && max2 >= 2) return { label: "Synergie 3 + 2 (+10% PV/ATQ)", attackRating: 0.10, healthRating: 0.10 };
    if (max1 >= 3) return { label: "3 Même Faction (+5% PV/ATQ)", attackRating: 0.05, healthRating: 0.05 };
    return { label: "Aucune synergie (<=2)", attackRating: 0, healthRating: 0 };
  }

  function getFactionRelationRatio(attackerFaction, targetFaction) {
    if (!attackerFaction || !targetFaction || attackerFaction === "Neutral" || targetFaction === "Neutral") {
      return 1.0;
    }
    const key = `${attackerFaction}->${targetFaction}`;
    return DB.FACTION_RELATIONS[key] !== undefined ? DB.FACTION_RELATIONS[key] : 1.0;
  }

  function getCharEeStats(char, eeLevel) {
    const lv = Number(eeLevel || 0);
    if (!char.eeByLevel || lv <= 0) return null;
    const available = Object.keys(char.eeByLevel).map(Number).sort((a, b) => a - b);
    let chosen = null;
    for (const k of available) {
      if (lv >= k) chosen = char.eeByLevel[k];
    }
    return chosen;
  }

  function computeUnitTotalStats(unitConfig, teamConfigs, globalProg, bossConfig, airshipOverride) {
    const char = DB.CHARACTERS.find(c => c.id === unitConfig.charId);
    if (!char) return null;
    const prog = globalProg || {};
    const heroBox = prog.box && prog.box[char.id];
    const shinsuLevel = Number(unitConfig.shinsuLevel || prog.shinsuLevel || 1914);
    const shinsuMult = getShinsuMult(shinsuLevel);
    const gradeMult = getSlotGradeMult(shinsuLevel);
    const lbVal = unitConfig.lb !== undefined ? Number(unitConfig.lb) : Number(heroBox?.lb ?? prog.defaultLb ?? 21);
    const lbMult = getLimitBreakMult(lbVal);
    const rarPromote = DB.RARITY_PROMOTE[char.rarity] || { health: 1.0, attack: 1.0, defense: 1.0 };

    const total = createEmptyStatBlock();
    // Base stats from DB character_stat
    addStatsInto(total, char.baseStats);
    // Reset finalResist/fixed multipliers to 1.0 (baseStat starts at 1.0 in DB)
    total.finalResistRating = 1.0;
    total.finalResist2Rating = 1.0;
    total.fixedDamageResistRating = 1.0;

    total.health = Math.round((char.baseStats.health || 2000) * rarPromote.health * shinsuMult * gradeMult * lbMult);
    total.attack = Math.round((char.baseStats.attack || 160) * rarPromote.attack * shinsuMult * gradeMult * lbMult);
    total.defense = Math.round((char.baseStats.defense || 34) * rarPromote.defense * shinsuMult * gradeMult * lbMult);

    // Transcendence stat_list bonus (LB12/LB21 + Boss post-Rainbow orb)
    if (lbVal >= 21) {
      total.healthRating += 0.30;
      total.attackRating += 0.30;
      total.defenseRating += 0.30;
      total.accuracy += 300;
    } else if (lbVal >= 12) {
      total.healthRating += 0.20;
      total.attackRating += 0.20;
      total.defenseRating += 0.20;
      if (lbVal >= 15) total.accuracy += 200;
    }
    const transBoss = Math.max(0, Number(unitConfig.transBoss ?? heroBox?.transBoss ?? 0));
    if (transBoss > 0) {
      total.healthRating += 0.10 * transBoss;
      total.attackRating += 0.10 * transBoss;
      total.defenseRating += 0.10 * transBoss;
      total.critBonusRating += 0.30 * transBoss;
    }

    // Standard equipment + faction bonus (+30% from battle_config)
    const facEquipMult = unitConfig.factionEquip !== false ? (1.0 + CFG.FACTION_EQUIP_BONUS) : 1.0;
    total.attackRating += 0.22 * facEquipMult;
    total.healthRating += 0.22 * facEquipMult;
    total.defenseRating += 0.22 * facEquipMult;
    total.accuracy += Math.round(140 * facEquipMult);
    total.dodge += Math.round(110 * facEquipMult);
    total.haste += Math.round(12 * facEquipMult);

    // Exclusive Equipment (exact item_equipment_private DB stats + kit ee4)
    const eeLv = unitConfig.ee !== undefined ? Number(unitConfig.ee) : Number(heroBox?.ee ?? prog.defaultEe ?? 40);
    const dbEe = getCharEeStats(char, eeLv);
    if (dbEe) addStatsInto(total, dbEe);
    if (eeLv >= 30 && char.skills?.ee4?.permanentSelf) {
      addStatsInto(total, char.skills.ee4.permanentSelf, eeLv >= 40 ? 1.0 : 0.75);
    }

    // Ignition Set + Soul Lv (0..30) + Slot 4 + Slot 5 + Substats (ignorés si iwMode === "none")
    const iwMode = unitConfig.iwMode || prog.iwMode || "soul0";
    if (iwMode !== "none") {
      const soulLv = clamp(Math.round(Number(unitConfig.iwSoulLv ?? prog.iwSoulLevels?.[unitConfig.set] ?? 0)), 0, 30);
      const ignSet = getEffectiveIgnSet(unitConfig.set, soulLv);
      if (ignSet.bonus2p) addStatsInto(total, ignSet.bonus2p);
      if (ignSet.bonus4p && !ignSet.bonus4p.sameRowOnly && !ignSet.bonus4p.backRowOnly) {
        addStatsInto(total, ignSet.bonus4p);
      }
      const soulCurve = DB.IGNITION_SOUL_CURVES?.[unitConfig.set]?.[soulLv];
      if (soulCurve) addStatsInto(total, soulCurve);
      const slot4 = DB.SLOT4_MAIN_STATS[unitConfig.slot4];
      if (slot4) total[slot4.stat] += slot4.value;
      const slot5 = DB.SLOT5_MAIN_STATS[unitConfig.slot5];
      if (slot5) total[slot5.stat] += slot5.value;
      const subProfile = DB.SUBSTAT_PROFILES[unitConfig.subs] || DB.SUBSTAT_PROFILES.dps_balanced;
      addStatsInto(total, subProfile.stats);
    }

    // Revolution tier (0..8)
    const revTier = unitConfig.rev !== undefined ? Number(unitConfig.rev) : Number(heroBox?.rev ?? prog.revTier ?? 6);
    if (revTier > 0) {
      total.attackRating += revTier * 0.08;
      total.healthRating += revTier * 0.08;
      total.defenseRating += revTier * 0.08;
      total.accuracy += revTier * 45;
      total.haste += revTier * 3;
      total.physicalPierceRating += revTier * 0.03;
      total.magicPierceRating += revTier * 0.03;
      if (revTier >= 4) total.startEnergy += 100;
    }

    // Noyau de Shinsu + bonus collectif de Domination (+1 par perso Transcendé Boss dans l'équipe)
    const teamTransBossBonus = (Array.isArray(teamConfigs) && teamConfigs.length > 0)
      ? teamConfigs.reduce((acc, tc) => acc + Math.max(0, Number(tc.transBoss ?? prog.box?.[tc.charId]?.transBoss ?? 0)), 0)
      : transBoss;
    total.teamTransBossBonus = teamTransBossBonus;
    total.shinsuCoreLevel = Math.max(0, Number(prog.shinsuCoreLevel ?? 0)) + teamTransBossBonus;

    // Tri-Essence (réelle par classe FOR/DEX/INT si importée, sinon champs manuels)
    const triType = prog.triEssenceByType && prog.triEssenceByType[char.fightType];
    if (triType) {
      addStatsInto(total, triType);
    } else {
      total.accuracy += Number(prog.triEssenceAcc ?? 280);
    }
    const triPierce = Number(prog.triEssencePierce ?? 25) / 100;
    total.physicalPierceRating += triPierce;
    total.magicPierceRating += triPierce;
    const triRes = Number(prog.triEssenceRes ?? 35) / 100;
    total.physicalResistRating += triRes;
    total.magicResistRating += triRes;

    // Airship (avec niveau & compétence réels du Hangar si importés)
    const airshipId = airshipOverride || prog.airshipId || "none";
    const airship = getEffectiveAirship(airshipId, prog);
    if (airship) {
      if (airship.shipGlobalStats) {
        addStatsInto(total, airship.shipGlobalStats);
      }
      const targetOk = !airship.targetAttackType || airship.targetAttackType === char.attackType;
      if (targetOk && airship.passiveStats && (!airship.targetFaction || airship.targetFaction === char.faction)) {
        addStatsInto(total, airship.passiveStats);
      }
      if (airship.factionBonusStats && airship.targetFaction === char.faction) {
        addStatsInto(total, airship.factionBonusStats);
      }
    }

    // Alliance Weekly Boss Buffs (union_weeklyboss_buff)
    if (bossConfig && bossConfig.isAllianceWeekly) {
      const abLv = clamp(Number(prog.allianceBuffLv ?? 10), 0, 10);
      if (abLv > 0) {
        total.healthRating += 0.20 * abLv;
        total.attackRating += 0.05 * abLv;
        total.defenseRating += 0.10 * abLv;
        total.critRating += 0.01 * abLv;
        total.critBonusRating += 0.02 * abLv;
        total.accuracy += 10 * abLv;
        total.dodge += 10 * abLv;
      }
    }

    // Faction Combo (exact battle_faction_combos)
    const combo = computeTeamFactionCombo(teamConfigs);
    total.attackRating += combo.attackRating;
    total.healthRating += combo.healthRating;

    // Pré-combat (feuille perso) vs pool combat (passifs + buffs) pour éviter la double-multiplication d'ATQ%/DÉF%
    const baseCombatAttack = Math.round(total.attack * Math.max(0.1, 1 + total.attackRating));
    const baseCombatDefense = Math.round(total.defense * Math.max(0.1, 1 + total.defenseRating));
    const preAtkPct = total.attackRating;
    const preDefPct = total.defenseRating;

    // Permanent passive self + team permanent auras
    if (char.skills?.passive?.permanentSelf) {
      addStatsInto(total, char.skills.passive.permanentSelf);
    }
    for (const allyCfg of teamConfigs) {
      const ally = DB.CHARACTERS.find(c => c.id === allyCfg.charId);
      if (!ally) continue;
      if (ally.skills?.passive?.permanentAllies) {
        addStatsInto(total, ally.skills.passive.permanentAllies);
      }
      if (ally.skills?.passive?.factionAlliesBuff && char.faction === ally.skills.passive.factionAlliesBuff.faction) {
        const allyRev = Number(allyCfg.rev ?? prog.box?.[ally.id]?.rev ?? prog.revTier ?? 6);
        const revFactor = (ally.id === "125" && allyRev < 4) ? 0.5 : 1.0;
        addStatsInto(total, ally.skills.passive.factionAlliesBuff.stats, revFactor);
      }
      if (ally.skills?.ee4?.permanentAllies) {
        addStatsInto(total, ally.skills.ee4.permanentAllies);
      }
    }

    const passiveAttackRating = total.attackRating - preAtkPct;
    const passiveDefenseRating = total.defenseRating - preDefPct;
    total.attack = Math.round(baseCombatAttack * Math.max(0.1, 1 + passiveAttackRating));
    total.health = Math.round(total.health * Math.max(0.1, 1 + total.healthRating));
    total.defense = Math.round(baseCombatDefense * Math.max(0.1, 1 + passiveDefenseRating));

    return {
      char,
      slotLevel: shinsuLevel,
      comboLabel: combo.label,
      airshipId: airship?.id || "none",
      airshipName: airship?.name || "Aucun / Neutre",
      baseCombatAttack,
      baseCombatDefense,
      passiveAttackRating,
      passiveDefenseRating,
      total
    };
  }

  /**
   * Calcule l'état exact du Boss selon le palier de dégâts cumulés
   */
  function getBossStateForDamage(bossConfig, totalDamage, prog) {
    const sections = DB.DAMAGE_GROUPS[bossConfig.damageGroupKey];
    let active = sections[0];
    let idx = 0;
    for (let i = 0; i < sections.length; i++) {
      if (totalDamage >= sections[i].req) {
        active = sections[i];
        idx = i;
      } else {
        break;
      }
    }
    return getBossStateFromSection(bossConfig, active, idx, prog);
  }

  function getBossStateFromSection(bossConfig, sec, idx, prog) {
    const base = bossConfig.bossBaseStats || {};
    const abLv = (bossConfig.isAllianceWeekly) ? clamp(Number(prog?.allianceBuffLv ?? 10), 0, 10) : 0;
    const evaDownPct = Math.min(0.20, 0.02 * abLv);
    const atkDownPct = Math.min(0.50, 0.05 * abLv);
    const hasteDown = 2 * abLv;

    const bossSlotLevel = bossConfig.baseSlotLevel + sec.lv;
    const shMult = getShinsuMult(bossSlotLevel);
    const gradeObj = DB.SLOT_GRADES.find(g => g.id === sec.sg);
    const gradeMult = gradeObj ? gradeObj.mult : getSlotGradeMult(bossSlotLevel);
    const scaledBaseAtk = (base.attack || 160) * shMult * gradeMult;
    const scaledBaseDef = (base.defense || 36) * shMult * gradeMult;

    const rawAtk = (scaledBaseAtk + sec.atk) * (1 + sec.atkR) * (1 - atkDownPct);
    const rawDef = (scaledBaseDef + sec.def) * (1 + sec.defR);
    const rawDod = Math.max(0, ((base.dodge || 10) + sec.dod) * (1 - evaDownPct));

    // CRITICAL: stat_list stores negative values (-0.1 .. -0.999) for finalResistRating & finalResist2Rating & fixedDamageResistRating!
    const fRes1Mult = clamp(1.0 + sec.fRes1, 0.001, 1.0);
    const fRes2Mult = clamp(1.0 + sec.fRes2, 0.001, 1.0);
    const fixMult = clamp(1.0 + sec.fixRes, 0.001, 1.0);
    const ovwRes = sec.ovw > 0 ? Math.min(0.999, CFG.OVERWHELMING_BASE + Math.max(0, sec.ovw - 1) * CFG.OVERWHELMING_STEP) : 0;

    return {
      sectionIndex: idx,
      section: sec,
      slotLevel: bossConfig.baseSlotLevel + sec.lv,
      stats: {
        attack: Math.max(100, Math.round(rawAtk)),
        defense: Math.max(1, Math.round(rawDef)),
        accuracy: (base.accuracy || 10) + sec.acc,
        dodge: Math.round(rawDod),
        haste: Math.max(0, (base.haste || 0) + sec.hst - hasteDown),
        physicalResistRating: (base.physicalResistRating || 0) + sec.pRes,
        magicResistRating: (base.magicResistRating || 0) + sec.mRes,
        critResistRating: (base.critResistRating || 0) + sec.cRes,
        critReduceRating: (base.critReduceRating || 0) + sec.cRed,
        ultimateResistRating: sec.uRes || 0,
        normalResistRating: sec.nRes || 0,
        finalResist1Mult: fRes1Mult,
        finalResist2Mult: fRes2Mult,
        fixedDamageMult: fixMult,
        overwhelmingLevel: sec.ovw || 0,
        overwhelmingResistRating: ovwRes,
        debuffDodge: sec.dDod || 0,
        dmgDownFromLightRating: 0,
        dmgDownFromDarknessRating: 0,
        dmgDownFromFireRating: 0,
        dmgDownFromWaterRating: 0,
        dmgDownFromLandRating: 0
      }
    };
  }

  /**
   * Pipeline exact DamageCalculator (FOAMBPPLDPL)
   */
  const DamageCalculator = {
    hitProbability(attackerStats, targetStats, perfectAccuracy, rng) {
      if (perfectAccuracy) return { prob: 1.0, hit: true };
      const effDodge = Math.max(0, (targetStats.dodge || 0) * (1 - clamp(targetStats.dodgePctShred || 0, 0, 0.95)));
      const diff = effDodge - (attackerStats.accuracy || 0);
      let prob = 1.0;
      if (diff > 0) {
        const A = CFG.ACCURACY_CORRECT_A;
        const B = CFG.ACCURACY_CORRECT_B;
        const C = CFG.ACCURACY_CORRECT_C;
        if (diff >= A) prob = C;
        else {
          const d = diff - A;
          prob = clamp(C + (d * d) / (A * B), C, 1.0);
        }
      }
      const hit = rng ? rng() < prob : true;
      return { prob, hit };
    },

    debuffProbability(debuffAcc, debuffDodge) {
      const diff = (debuffDodge || 0) - (debuffAcc || 0);
      if (diff <= 0) return 1.0;
      const A = CFG.DEBUFF_ACCURACY_CORRECT_A;
      const B = CFG.DEBUFF_ACCURACY_CORRECT_B;
      const C = CFG.DEBUFF_ACCURACY_CORRECT_C;
      if (diff >= A) return C;
      return clamp(C + Math.pow(diff - A, 2) / (A * B), C, 1.0);
    },

    computeDamage(p) {
      const {
        attackerStats, attackerFaction, attackerSlotLevel,
        targetStats, targetFaction, targetSlotLevel,
        skillType, attackType, attackRate,
        perfectAccuracy, defIgnore, resIgnore, guaranteedCrit,
        deterministic, rng
      } = p;

      const rate = Math.max(CFG.RATE_MIN_CORRECTION, attackRate || 1.0);
      const atkScaled = Math.round(attackerStats.attack * rate);

      const hitInfo = this.hitProbability(attackerStats, targetStats, perfectAccuracy, deterministic ? null : rng);
      if (!deterministic && !hitInfo.hit) {
        return { damage: 0, missed: true, hitProb: hitInfo.prob, critProb: 0, multipliers: null };
      }
      const hitFactor = deterministic ? hitInfo.prob : 1.0;

      // 1. Défense (avec shred multiplicatif + defIgnore)
      const defShred = clamp(targetStats.defShred || 0, 0, 0.95);
      const defBypass = clamp(defIgnore || 0, 0, 0.95);
      const effDef = Math.max(1, targetStats.defense * (1.0 - defShred) * (1.0 - defBypass));
      const defRed = Math.min(CFG.DEF_MAX_REDUCTION, TruncatePoint3(1.0 / (1.0 + atkScaled / (CFG.DEF_CONSTANT * effDef))));
      const mDef = TruncatePoint3(Math.max(0.001, 1.0 - defRed));

      // 2. Type Résistance vs Perforation
      const baseRes = attackType === "MAGIC" ? (targetStats.magicResistRating || 0) : (targetStats.physicalResistRating || 0);
      const effRes = (baseRes > 0 && resIgnore) ? baseRes * (1.0 - clamp(resIgnore, 0, 0.95)) : baseRes;
      const baseInc = attackType === "MAGIC" ? (attackerStats.magicIncreaseRating || 0) : (attackerStats.physicalIncreaseRating || 0);
      const pierce = attackType === "MAGIC" ? (attackerStats.magicPierceRating || 0) : (attackerStats.physicalPierceRating || 0);
      const mType = TruncatePoint3(Math.max(0.01, 1.0 - effRes + baseInc + pierce));

      // 3. Critique
      const critProb = guaranteedCrit ? 1.0 : clamp((attackerStats.critRating || 0) - (targetStats.critResistRating || 0), 0.0, 1.0);
      const critMultFull = TruncatePoint3(Math.max(1.0, CFG.CRIT_DAMAGE_RATING_BASE + (attackerStats.critBonusRating || 0) - (targetStats.critReduceRating || 0)));
      const mCrit = deterministic ? (1.0 + critProb * (critMultFull - 1.0)) : ((rng && rng() < critProb) ? critMultFull : 1.0);

      // 4. Faction + Element Resistance Decrease (dmgDownFrom<Faction>Rating)
      const rel = getFactionRelationRatio(attackerFaction, targetFaction);
      const upKey = "dmgUpTo" + targetFaction + "Rating";
      const downKey = "dmgDownFrom" + attackerFaction + "Rating";
      const mFaction = TruncatePoint3(Math.max(0.1, rel + (attackerStats[upKey] || 0) - (targetStats[downKey] || 0)));

      // 5. Écart de niveau Shinsu
      const gap = attackerSlotLevel - targetSlotLevel;
      const mLevelGap = gap >= 0 ? 1.0 : TruncatePoint3(Math.max(0.45, 1.0 - Math.abs(gap) / 360));

      // 6. Ultime / Normal
      let mUlt = 1.0;
      if (skillType === "ULTIMATE") {
        mUlt = Math.max(0.05, 1.0 + (attackerStats.ultimateIncreaseRating || 0) + (attackerStats.ultimatePierceRating || 0) - (targetStats.ultimateResistRating || 0));
      }
      let mNormal = 1.0;
      if (skillType === "NORMAL") {
        mNormal = Math.max(0.05, 1.0 + (attackerStats.normalIncreaseRating || 0) + (attackerStats.normalPierceRating || 0) - (targetStats.normalResistRating || 0));
      }

      // 7. Résistances Finales (stat_list negatives => already converted to multiplier) & Écrasement (Overwhelming)
      const mFinal1 = targetStats.finalResist1Mult !== undefined ? targetStats.finalResist1Mult : 1.0;
      const mFinal2 = targetStats.finalResist2Mult !== undefined ? targetStats.finalResist2Mult : 1.0;
      const bossOvwLv = targetStats.overwhelmingLevel || 0;
      const playerCoreLv = attackerStats.shinsuCoreLevel || 0;
      let mOverwhelming = 1.0;
      if (bossOvwLv > playerCoreLv) {
        const diff = bossOvwLv - playerCoreLv;
        const pen = Math.min(0.999, CFG.OVERWHELMING_BASE + (diff - 1) * CFG.OVERWHELMING_STEP);
        mOverwhelming = Math.max(CFG.OVERWHELMING_MIN, 1.0 - pen + (attackerStats.overwhelmingPierceRating || 0));
      }

      const raw = atkScaled * mDef * mType * mCrit * mFaction * mLevelGap * mUlt * mNormal * mFinal1 * mFinal2 * mOverwhelming * hitFactor;
      const damage = Math.max(1, Math.floor(raw));

      return {
        damage,
        missed: false,
        hitProb: hitInfo.prob,
        critProb,
        multipliers: {
          atkScaled, mDef, mType, mCrit, mFaction, mLevelGap, mUlt, mNormal, mFinal1, mFinal2, mOverwhelming, hitProb: hitInfo.prob, critProb
        }
      };
    }
  };

  function getEffectiveHasteMult(stats, isNormal) {
    const h = stats.haste || 0;
    const ah = isNormal ? (stats.attackHaste || 0) : 0;
    return clamp(1.0 + (h + ah) / CFG.HASTE_RATING_DIV, CFG.HASTE_MIN, CFG.HASTE_MAX);
  }

  function applyActiveBuffStats(statInfo, activeBuffs) {
    const out = Object.assign({}, statInfo.total);
    let atkBonusPct = 0;
    let defBonusPct = 0;
    let flatAtkBonus = 0;
    let flatDefBonus = 0;
    for (let i = 0; i < activeBuffs.length; i++) {
      const st = activeBuffs[i].stats;
      if (!st) continue;
      for (const k of Object.keys(st)) {
        if (k === "attackRating") atkBonusPct += st[k];
        else if (k === "defenseRating") defBonusPct += st[k];
        else if (k === "attack") flatAtkBonus += st[k];
        else if (k === "defense") flatDefBonus += st[k];
        else if (Object.prototype.hasOwnProperty.call(out, k)) out[k] += st[k];
      }
    }
    if (atkBonusPct !== 0 || flatAtkBonus !== 0) {
      out.attack = Math.round(statInfo.baseCombatAttack * Math.max(0.1, 1 + statInfo.passiveAttackRating + atkBonusPct)) + flatAtkBonus;
    }
    if (defBonusPct !== 0 || flatDefBonus !== 0) {
      out.defense = Math.round(statInfo.baseCombatDefense * Math.max(0.1, 1 + statInfo.passiveDefenseRating + defBonusPct)) + flatDefBonus;
    }
    return out;
  }

  function applyBossDebuffs(baseBossStats, debuffs, bossConfig, prog, airshipOverride) {
    const out = Object.assign({}, baseBossStats);
    const byKey = {};
    for (let i = 0; i < debuffs.length; i++) {
      const d = debuffs[i];
      if (d.key) {
        byKey[d.key] = (byKey[d.key] || 0) + 1;
      }
      if (d.stats) {
        for (const k of Object.keys(d.stats)) {
          if (k === "defenseRating") {
            // Multiplicative DEF shred!
            const shred = Math.abs(d.stats[k]);
            out.defShred = 1 - (1 - (out.defShred || 0)) * (1 - clamp(shred, 0, 0.90));
          } else if (k === "dodgePctShred") {
            const shred = Math.abs(d.stats[k]);
            out.dodgePctShred = 1 - (1 - (out.dodgePctShred || 0)) * (1 - clamp(shred, 0, 0.90));
          } else if (Object.prototype.hasOwnProperty.call(out, k)) {
            out[k] += d.stats[k];
          }
        }
      }
    }
    // Airship debuffs
    const airshipId = airshipOverride || prog?.airshipId || "none";
    const airship = getEffectiveAirship(airshipId, prog);
    if (airship) {
      if (airship.enemyDebuff) addStatsInto(out, airship.enemyDebuff);
      if (airship.enemyAdvantageDebuff && airship.enemyAdvantageFaction === bossConfig.bossFaction) {
        addStatsInto(out, airship.enemyAdvantageDebuff);
      }
    }
    // Clamp by stat_bound
    out.physicalResistRating = clamp(out.physicalResistRating, -1.5, 4.99);
    out.magicResistRating = clamp(out.magicResistRating, -1.5, 4.99);
    out.dmgDownFromLandRating = clamp(out.dmgDownFromLandRating, -2.99, 2.99);
    out.dmgDownFromWaterRating = clamp(out.dmgDownFromWaterRating, -2.99, 2.99);
    out.dmgDownFromFireRating = clamp(out.dmgDownFromFireRating, -2.99, 2.99);
    out.dmgDownFromLightRating = clamp(out.dmgDownFromLightRating, -2.99, 2.99);
    out.dmgDownFromDarknessRating = clamp(out.dmgDownFromDarknessRating, -2.99, 2.99);
    out.critResistRating = clamp(out.critResistRating, -0.5, 4.99);
    out.dodge = Math.max(0, out.dodge);
    out.haste = Math.max(0, out.haste);
    return out;
  }

  /**
   * Simule un combat complet de 90 secondes contre un Boss DB
   */
  function simulateBossMatch(teamConfigs, bossConfig, globalProg, simOpts) {
    const opts = simOpts || {};
    const dt = opts.dt || 0.1;
    const duration = opts.duration || CFG.MATCH_DURATION;
    const deterministic = opts.deterministic !== false;
    const rng = deterministic ? null : createSeededRandom(opts.seed || 1337);
    const prog = globalProg || {};
    const airshipId = opts.airshipId || prog.airshipId || "none";
    const airshipObj = getEffectiveAirship(airshipId, prog);
    const sections = DB.DAMAGE_GROUPS[bossConfig.damageGroupKey];
    const bossSkills = bossConfig.bossSkills || {};

    const units = teamConfigs.map((cfg, idx) => {
      const statInfo = computeUnitTotalStats(cfg, teamConfigs, prog, bossConfig, airshipId);
      if (!statInfo) return null;
      const char = statInfo.char;
      const passive = char.skills?.passive || {};
      const iwMode = cfg.iwMode || opts.iwMode || prog.iwMode || "soul0";
      const soulLv = iwMode === "none" ? 0 : clamp(Math.round(Number(cfg.iwSoulLv ?? prog.iwSoulLevels?.[cfg.set] ?? 0)), 0, 30);
      const ignSet = iwMode === "none" ? EMPTY_IGN_SET : getEffectiveIgnSet(cfg.set, soulLv);
      const startEp = passive.startUltAtZero
        ? CFG.MAX_ENERGY
        : Math.min(CFG.MAX_ENERGY, Math.max(0, statInfo.total.startEnergy || 0));

      return {
        slotIndex: idx,
        row: cfg.row || getSlotRow(idx, bossConfig),
        cfg,
        statInfo,
        char,
        revTier: Number(cfg.rev ?? prog.box?.[char.id]?.rev ?? prog.revTier ?? 6),
        ignSet,
        energy: startEp,
        maxHp: statInfo.total.health,
        hp: statInfo.total.health,
        alive: true,
        diedAt: null,
        shieldHp: 0,
        hitBarrier: passive.selfHitBarrier || 0,
        invincibleUntil: 0,
        untargetableUntil: 0,
        concealedUntil: passive.periodicConceal ? passive.periodicConceal.duration : (passive.concealHighestAtkAtStart ? passive.concealHighestAtkAtStart.duration : 0),
        nextConcealAt: passive.periodicConceal ? passive.periodicConceal.interval : 999,
        evanOpenerAt: passive.concealHighestAtkAtStart ? passive.concealHighestAtkAtStart.duration : 999,
        ccImmuneUntil: passive.permanentStatusImmune ? 999 : (ignSet.bonus4p?.ccImmuneInitial || 0),
        stunnedUntil: 0,
        nextNormalAt: 0.2 + idx * 0.05,
        cdActive1: 1.0 + idx * 0.1,
        cdActive2: 2.5 + idx * 0.1,
        busyUntil: 0,
        ultLockedUntil: 0,
        buffs: [],
        cachedStats: null,
        statsDirty: true,
        // Set states
        asuraRage: 0,
        magoStacks: 0,
        raihannaDone: !ignSet.bonus4p?.firstHitBurst,
        nextRaiihannaEpAt: ignSet.bonus4p?.periodicEnergy ? ignSet.bonus4p.periodicEnergy.interval : 999,
        ideaLeft: ignSet.bonus4p?.ultEnergyRefund ? ignSet.bonus4p.ultEnergyRefund.maxTriggers : 0,
        rundaReadyAt: ignSet.bonus4p?.rowBarrierPulse ? (ignSet.bonus4p.rowBarrierPulse.cooldown || 5.0) : 999,
        capelinelReadyAt: ignSet.bonus4p?.rowBarrierPierce ? (ignSet.bonus4p.rowBarrierPierce.cooldown || 5.0) : 999,
        dorisReadyAt: ignSet.bonus4p?.backBarrierPulse ? (ignSet.bonus4p.backBarrierPulse.cooldown || 5.0) : 999,
        rafflesiaReadyAt: 0,
        bariShield75Done: false,
        bariHeal50Done: false,
        bariInv25Done: false,
        bergamotDone: false,
        evadeUntil: 0,
        wasConcealed: false,
        selfEnergyPerSecUntil: 0,
        selfEnergyPerSecAmt: 0,
        frostSpearsUntil: 0,
        frostSpearRate: 0,
        nextPeriodicBonusHitAt: passive.periodicBonusHit ? passive.periodicBonusHit.interval : 999,
        nextPeriodicHitBarrierAt: passive.periodicSelfHitBarrier ? passive.periodicSelfHitBarrier.cooldown : 999,
        periodicHitBarrierLeft: passive.periodicSelfHitBarrier ? passive.periodicSelfHitBarrier.hits : 0,
        // Hero specific states
        lifeFlames: passive.lifeFlamesStart || 0,
        allyLifeFlames: passive.allyLifeFlamesStart || 0,
        nextAllyLifeFlameAt: passive.allyLifeFlameInterval || 999,
        selfReviveLeft: passive.selfReviveInvuln ? 1 : 0,
        yirangBurnRate: passive.infiniteStackingBurn ? passive.infiniteStackingBurn.startRate : 0,
        yirangNextBurnAt: passive.infiniteStackingBurn ? 1.0 : 999,
        lilialPoisonStacks: [],
        lilialNextPoisonAt: passive.infiniteStackingPoison ? 1.0 : 999,
        possessionStacks: 0,
        periodicSelfStacks: 0,
        nextPeriodicSelfAt: passive.periodicSelfStackBuff ? passive.periodicSelfStackBuff.interval : 999,
        nextPeriodicAlliesAt: passive.periodicAlliesStackBuff ? passive.periodicAlliesStackBuff.interval : 999,
        periodicAlliesStacks: 0,
        nextPeriodicHighestAt: passive.periodicHighestAtkStackBuff ? passive.periodicHighestAtkStackBuff.interval : 999,
        periodicHighestStacks: 0,
        periodicPassiveNextAt: passive.periodicPassive ? passive.periodicPassive.interval : 999,
        summonNextAt: passive.spawnsPermanentSummon ? passive.spawnsPermanentSummon.interval : 999,
        permanentSummons: [],
        bloomUntil: 0,
        darkChargeActive: false,
        tempSummonUntil: 0,
        tempSummonNextAt: 999,
        carpMarkCount: 0,
        kaiserHitCounter: 0,
        kaiserWolfStacks: 0,
        fenrylReadyAt: 0,
        basicStackCount: 0,
        whiteAtkStacks: 0,
        souls: passive.soulSystem ? (passive.soulSystem.startSouls || 0) : 0,
        soulsActiveUntil: 0,
        spiritLinkBoostUntil: 0,
        doublePassiveUntil: 0,
        blueJadeFishUntil: 0,
        // Telemetry
        damageBySource: { NORMAL: 0, ACTIVE1: 0, ACTIVE2: 0, ULTIMATE: 0, DOT: 0, SUMMON: 0 },
        totalDamage: 0,
        healingDone: 0,
        damageTaken: 0,
        hitsLanded: 0,
        hitsTotal: 0,
        critsLanded: 0,
        ultimatesCast: 0,
        dispelsDone: 0,
        multSums: { mDef: 0, mType: 0, mCrit: 0, mFaction: 0, mFinal: 0, mOverwhelming: 0, hitProb: 0, n: 0 }
      };
    }).filter(Boolean);

    const bossDebuffs = [];
    const activeDots = [];
    const activeHots = [];
    let totalBossDamage = 0;
    let bossInvincibleUntil = 0;
    let nextBossInvAt = bossSkills.invincibilityInterval > 0 ? bossSkills.invincibilityInterval : 999;
    let nextBossCcAt = bossSkills.ccInterval > 0 ? bossSkills.ccInterval : 999;
    let nextBossDrainAt = bossSkills.energyDrainInterval > 0 ? bossSkills.energyDrainInterval : 999;
    let bossEnergy = 0;
    let nextBossBasicAt = bossConfig.bossBasicInterval || 2.2;
    let invincibilityDispelledCount = 0;

    let bossSectionIdx = 0;
    let cachedBossState = getBossStateFromSection(bossConfig, sections[0], 0, prog);
    let cachedEffBossStats = null;
    let bossStatsDirty = true;

    // Permanent passive boss debuffs + t=0 row barrier IW sets (Runda, Capelinel, Doris)
    for (const u of units) {
      if (u.char.skills?.passive?.bossDebuff) {
        bossDebuffs.push({ source: u.char.id, until: 999, stats: u.char.skills.passive.bossDebuff });
      }
      if (u.ignSet.bonus4p?.rowBarrierPulse) {
        const rp = u.ignSet.bonus4p.rowBarrierPulse;
        for (const ally of units) {
          if (ally.row === u.row) {
            ally.shieldHp += Math.round(u.maxHp * rp.shieldMaxHpRatio);
            ally.buffs.push({ key: "runda_row", until: rp.duration, stats: rp.stats });
            ally.statsDirty = true;
          }
        }
      }
      if (u.ignSet.bonus4p?.rowBarrierPierce) {
        const cp = u.ignSet.bonus4p.rowBarrierPierce;
        for (const ally of units) {
          if (ally.row === u.row) {
            ally.shieldHp += Math.round(u.statInfo.total.attack * cp.shieldAtkRate);
            ally.buffs.push({ key: "capelinel_row", until: cp.duration, stats: cp.allyStats });
            ally.statsDirty = true;
          }
        }
        bossDebuffs.push({ key: "capelinel_boss", until: cp.duration, stats: cp.bossStats });
        bossStatsDirty = true;
      }
      // Doris BACK row initialization
      if (u.ignSet.bonus4p?.backBarrierPulse && u.row === "BACK") {
        const bp = u.ignSet.bonus4p.backBarrierPulse;
        for (const ally of units) {
          if (ally.row === "BACK") {
            ally.shieldHp += Math.round(u.statInfo.total.attack * bp.shieldAtkRate);
            ally.buffs.push({ key: "doris_back", until: bp.duration, stats: bp.stats });
            ally.statsDirty = true;
          }
        }
      }
    }

    const getBossState = () => {
      let changed = false;
      while (bossSectionIdx + 1 < sections.length && totalBossDamage >= sections[bossSectionIdx + 1].req) {
        bossSectionIdx++;
        changed = true;
      }
      if (changed) {
        cachedBossState = getBossStateFromSection(bossConfig, sections[bossSectionIdx], bossSectionIdx, prog);
        bossStatsDirty = true;
      }
      return cachedBossState;
    };

    const getEffBossStats = (bState) => {
      if (bossStatsDirty || !cachedEffBossStats) {
        cachedEffBossStats = applyBossDebuffs(bState.stats, bossDebuffs, bossConfig, prog, airshipId);
        bossStatsDirty = false;
      }
      return cachedEffBossStats;
    };

    const getUnitStats = (u) => {
      if (u.statsDirty || !u.cachedStats) {
        u.cachedStats = applyActiveBuffStats(u.statInfo, u.buffs);
        u.statsDirty = false;
      }
      return u.cachedStats;
    };

    const addBuff = (target, key, until, stats) => {
      if (key) {
        const existing = target.buffs.find(b => b.key === key);
        if (existing) {
          existing.until = Math.max(existing.until, until);
          existing.stats = stats;
          target.statsDirty = true;
          return;
        }
      }
      target.buffs.push({ key, until, stats });
      target.statsDirty = true;
    };

    const applyLowestHpAllyBuff = (caster, cfg, keyPrefix, t) => {
      if (!cfg) return;
      const pool = units.filter(a => {
        if (!a.alive) return false;
        if (cfg.excludeSelf && a === caster) return false;
        if (cfg.onlyFaction && a.char.faction !== cfg.onlyFaction) return false;
        return true;
      }).sort((a, b) => ((a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp))) || (a.slotIndex - b.slotIndex));
      const targets = pool.slice(0, cfg.count || 1);
      for (const target of targets) {
        addBuff(target, `${keyPrefix}_${caster.slotIndex}`, t + cfg.duration, cfg.stats);
      }
      if (cfg.alsoApplyToSelf && caster.alive && !targets.includes(caster)) {
        addBuff(caster, `${keyPrefix}_self_${caster.slotIndex}`, t + cfg.duration, cfg.stats);
      }
    };

    const addBossDebuff = (key, until, stats, maxStacks) => {
      if (key && maxStacks) {
        const current = bossDebuffs.filter(d => d.key === key);
        if (current.length >= maxStacks) {
          // Refresh oldest
          let oldest = current[0];
          for (const d of current) if (d.until < oldest.until) oldest = d;
          oldest.until = until;
          bossStatsDirty = true;
          return;
        }
      } else if (key) {
        const ex = bossDebuffs.find(d => d.key === key);
        if (ex) {
          ex.until = Math.max(ex.until, until);
          ex.stats = stats;
          bossStatsDirty = true;
          return;
        }
      }
      bossDebuffs.push({ key, until, stats });
      bossStatsDirty = true;
    };

    const applyDamageAcrossBars = (u, sourceKey, perHitRate, skillObj, deterministicHit) => {
      let remFrac = 1.0;
      let guard = 0;
      let hitDmg = 0;
      let hitLanded = false;
      let hitCrit = false;
      let lastMults = null;
      const guaranteedHit = !!deterministicHit || !!skillObj?.perfectAccuracy || !!u.char.skills?.passive?.perfectAccuracyAlways;

      while (remFrac > 1e-7 && guard < 200) {
        guard++;
        const curState = getBossState();
        const curStats = getEffBossStats(curState);
        const res = DamageCalculator.computeDamage({
          attackerStats: getUnitStats(u),
          attackerFaction: u.char.faction,
          attackerSlotLevel: u.statInfo.slotLevel,
          targetStats: curStats,
          targetFaction: bossConfig.bossFaction,
          targetSlotLevel: curState.slotLevel,
          skillType: sourceKey === "ULTIMATE" ? "ULTIMATE" : (sourceKey === "NORMAL" ? "NORMAL" : "ACTIVE"),
          attackType: u.char.attackType,
          attackRate: perHitRate * remFrac,
          perfectAccuracy: guaranteedHit,
          defIgnore: skillObj?._effDefIgnore || 0,
          resIgnore: skillObj?.resIgnore || 0,
          guaranteedCrit: !!skillObj?.guaranteedCrit,
          deterministic,
          rng
        });

        if (res.missed) {
          remFrac = 0;
          break;
        }
        hitLanded = true;
        if (res.critProb >= 0.5) hitCrit = true;
        lastMults = res.multipliers;

        if (bossSectionIdx + 1 < sections.length) {
          const nextReq = sections[bossSectionIdx + 1].req;
          const need = Math.max(1, nextReq - totalBossDamage);
          if (res.damage >= need) {
            const fracUsed = need / res.damage;
            hitDmg += need;
            totalBossDamage += need;
            remFrac *= (1.0 - fracUsed);
          } else {
            hitDmg += res.damage;
            totalBossDamage += res.damage;
            remFrac = 0;
          }
        } else {
          hitDmg += res.damage;
          totalBossDamage += res.damage;
          remFrac = 0;
        }
      }
      return { hitDmg, hitLanded, hitCrit, lastMults };
    };

    const triggerCarpAndCrystalProcs = (attacker, t) => {
      // Golden Carp Ju proc whenever a Green ally uses a skill
      if (attacker.char.faction === "Land") {
        for (const ju of units) {
          if (!ju.alive || ju.char.id !== "636" || ju.carpMarkCount <= 0) continue;
          const cp = ju.char.skills.passive.carpMarkSystem;
          const procRes = applyDamageAcrossBars(ju, "DOT", cp.procAttackRate, null, false);
          if (procRes.hitLanded) {
            ju.totalDamage += procRes.hitDmg;
            ju.damageBySource.DOT += procRes.hitDmg;
            addBossDebuff("ju_carp_res", t + cp.duration, { dmgDownFromLandRating: -cp.greenResShredPerStack }, cp.maxStacks);
            for (const ally of units) {
              if (ally.alive && ally.char.faction === "Land") {
                const existing = ally.buffs.filter(b => b.key === "ju_carp_atk");
                if (existing.length < cp.maxStacks) {
                  ally.buffs.push({ key: "ju_carp_atk", until: t + cp.duration, stats: { attackRating: cp.greenAtkBuffPerStack } });
                  ally.statsDirty = true;
                } else {
                  for (const b of existing) b.until = t + cp.duration;
                }
              }
            }
          }
        }
      }
    };

    const dealUnitDamage = (u, sourceKey, attackRate, hits, skillObj, t) => {
      const uStats = getUnitStats(u);

      if (t < bossInvincibleUntil) {
        if (skillObj?.removesInvincibility || u.char.removesInvincibility) {
          bossInvincibleUntil = t;
          invincibilityDispelledCount++;
          u.dispelsDone++;
        } else {
          return 0;
        }
      }

      let effRate = attackRate;
      let defIgnore = Math.max(skillObj?.defIgnore || 0, skillObj?.selfDefIgnore || 0, u.char.skills?.passive?.targetDefIgnore || 0);
      let resIgnore = Math.max(skillObj?.resIgnore || 0, u.char.skills?.passive?.targetResIgnore || 0);
      if (skillObj?.bladeBonusRate) effRate += skillObj.bladeBonusRate;

      // Princess of Zahard Possession bonuses (respect Rev 4 cap upgrade)
      if (u.char.skills?.passive?.possessionSystem) {
        const ps = u.char.skills.passive.possessionSystem;
        if (u.possessionStacks >= ps.maxStacks) defIgnore = Math.max(defIgnore, ps.defIgnoreAtMax);
        if (sourceKey !== "NORMAL") {
          const perBuff = (u.char.id === "629" && u.revTier < 4) ? 0.30 : ps.skillBonusPerBuff;
          const cap = (u.char.id === "629" && u.revTier < 4) ? 9.0 : ps.skillBonusCap;
          const buffBonus = Math.min(cap, u.buffs.length * perBuff);
          effRate += buffBonus;
        }
      }

      // Sundance 4p & basicAttackCoefBonus
      if (sourceKey === "NORMAL" && u.ignSet.bonus4p?.normalDefIgnore) {
        defIgnore = Math.max(defIgnore, u.ignSet.bonus4p.normalDefIgnore);
        effRate += (u.ignSet.bonus4p.normalBonusAtkRate || 0);
        if (u.ignSet.bonus4p.normalBossStackBonus) {
          const nb = u.ignSet.bonus4p.normalBossStackBonus;
          const stacks = Math.min(nb.maxStacks, Math.floor(t / nb.interval));
          effRate += stacks * nb.ratePerStack;
        }
      }
      if (sourceKey === "NORMAL" && uStats.normalBonusAtkRate > 0) {
        effRate += uStats.normalBonusAtkRate;
      }
      if (sourceKey === "NORMAL" && uStats.basicAttackCoefBonus > 0) {
        effRate += uStats.basicAttackCoefBonus;
      }
      if (sourceKey !== "NORMAL" && sourceKey !== "DOT" && sourceKey !== "SUMMON" && u.char.skills?.passive?.basicStackSelf?.coefPerStackOnActive) {
        effRate += u.basicStackCount * u.char.skills.passive.basicStackSelf.coefPerStackOnActive;
      }

      // Mago 4p defIgnore at max stacks
      if (u.ignSet.bonus4p?.onSelfEnergyDrainStack && u.magoStacks >= u.ignSet.bonus4p.onSelfEnergyDrainStack.maxStacks) {
        defIgnore = Math.max(defIgnore, u.ignSet.bonus4p.onSelfEnergyDrainStack.defIgnoreAtMax);
      }

      // Raihanna 1st hit burst
      let guaranteedHit = false;
      if (!u.raihannaDone && u.ignSet.bonus4p?.firstHitBurst) {
        u.raihannaDone = true;
        effRate += u.ignSet.bonus4p.firstHitBurst.attackRatingBonus;
        if (u.ignSet.bonus4p.firstHitBurst.guaranteedHit) guaranteedHit = true;
      }

      const effSkill = skillObj ? Object.assign({}, skillObj, { _effDefIgnore: defIgnore, resIgnore }) : { _effDefIgnore: defIgnore, resIgnore };
      const nHits = Math.max(1, hits || 1);
      const perHitRate = effRate / nHits;
      let totalDmg = 0;

      for (let h = 0; h < nHits; h++) {
        const hRes = applyDamageAcrossBars(u, sourceKey, perHitRate, effSkill, guaranteedHit);
        u.hitsTotal++;
        if (hRes.hitLanded) {
          u.hitsLanded++;
          if (hRes.hitCrit) u.critsLanded++;
          totalDmg += hRes.hitDmg;
          if (hRes.lastMults) {
            const ms = u.multSums;
            ms.mDef += hRes.lastMults.mDef;
            ms.mType += hRes.lastMults.mType;
            ms.mCrit += hRes.lastMults.mCrit;
            ms.mFaction += hRes.lastMults.mFaction;
            ms.mFinal += hRes.lastMults.mFinal1 * hRes.lastMults.mFinal2;
            ms.mOverwhelming += hRes.lastMults.mOverwhelming;
            ms.hitProb += hRes.lastMults.hitProb;
            ms.n++;
          }
        }
      }

      if (totalDmg > 0) {
        u.totalDamage += totalDmg;
        u.damageBySource[sourceKey] = (u.damageBySource[sourceKey] || 0) + totalDmg;
        bossEnergy = Math.min(1000, bossEnergy + CFG.BOSS_ENERGY_DAMAGE);
        if (uStats.lifeLeechRating > 0) {
          u.hp = Math.min(u.maxHp, u.hp + Math.round(totalDmg * uStats.lifeLeechRating * 0.01));
        }
      }
      return totalDmg;
    };

    const drainBossEnergy = (caster, amount) => {
      if (!amount || amount <= 0) return;
      bossEnergy = Math.max(0, bossEnergy - amount);
      if (caster && caster.ignSet.bonus4p?.onSelfEnergyDrainStack) {
        const ms = caster.ignSet.bonus4p.onSelfEnergyDrainStack;
        if (caster.magoStacks < ms.maxStacks) {
          caster.magoStacks++;
          addBuff(caster, "mago_crit", 999, { critBonusRating: caster.magoStacks * ms.critBonusPerStack });
        }
      }
    };

    const applyBossDamageToUnit = (u, rawDmg, isBossBasic) => {
      if (!u.alive || tCurrent < u.invincibleUntil || tCurrent < u.untargetableUntil || tCurrent < u.evadeUntil) return;
      if (u.periodicHitBarrierLeft > 0) {
        u.periodicHitBarrierLeft--;
        return;
      }
      if (u.hitBarrier > 0) {
        u.hitBarrier--;
        return;
      }
      if (isBossBasic && u.ignSet.bonus4p?.basicEvaBonus && !deterministic) {
        if (rng() < u.ignSet.bonus4p.basicEvaBonus) return;
      }
      let dmg = rawDmg;
      const soak = u.char.skills?.passive?.spawnsPermanentSummon?.damageSoakRatio || 0;
      if (soak > 0) dmg = Math.round(dmg * (1 - clamp(soak, 0, 0.85)));
      if (u.char.skills?.passive?.damageTakenCapMaxHp) {
        dmg = Math.min(dmg, Math.round(u.maxHp * u.char.skills.passive.damageTakenCapMaxHp));
      }
      if (u.shieldHp > 0) {
        const absorbed = Math.min(u.shieldHp, dmg);
        u.shieldHp -= absorbed;
        dmg -= absorbed;
        if (u.shieldHp <= 0) {
          u.shieldHp = 0;
          let removedShieldBuff = false;
          let hadDoris = false;
          for (let i = u.buffs.length - 1; i >= 0; i--) {
            const k = u.buffs[i].key;
            if (k === "runda_row" || k === "capelinel_row" || k === "doris_back") {
              if (k === "doris_back") hadDoris = true;
              u.buffs.splice(i, 1);
              removedShieldBuff = true;
            }
          }
          if (removedShieldBuff) u.statsDirty = true;
          if (hadDoris) {
            drainBossEnergy(u, 300);
            if (units.some(x => x.alive && x.row === "BACK" && x.ignSet.id === "doris" && x.ignSet.soulLv >= 30)) {
              for (const ally of units) {
                if (ally.alive && ally.row === "BACK") {
                  addBuff(ally, "doris_break_30", tCurrent + 8.0, { attackHaste: 20 });
                }
              }
            }
          }
        }
      }
      if (dmg <= 0) return;
      u.hp -= dmg;
      u.damageTaken += dmg;
      u.energy = Math.min(CFG.MAX_ENERGY, u.energy + CFG.ENERGY_DAMAGE);

      // Bari 4p & Bergamot 4p HP thresholds
      const hpRatio = u.hp / Math.max(1, u.maxHp);
      if (u.ignSet.bonus4p?.hpThresholds && u.hp > 0) {
        const ht = u.ignSet.bonus4p.hpThresholds;
        if (!u.bariShield75Done && hpRatio <= 0.75) { u.bariShield75Done = true; u.hitBarrier += ht.shield75; }
        if (!u.bariHeal50Done && hpRatio <= 0.50) { u.bariHeal50Done = true; u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * ht.heal50)); }
        if (!u.bariInv25Done && hpRatio <= 0.25) { u.bariInv25Done = true; u.invincibleUntil = Math.max(u.invincibleUntil, tCurrent + ht.inv25); }
      }
      if (u.ignSet.bonus4p?.fullHealBelow30 && !u.bergamotDone && u.hp > 0 && hpRatio <= 0.30) {
        u.bergamotDone = true;
        u.hp = u.maxHp;
        if (u.ignSet.bonus4p.postTriggerStats) addBuff(u, "bergamot_4p", 999, u.ignSet.bonus4p.postTriggerStats);
      }

      // Fatal damage saves (Robadon Essence, Yihwa Life Flame, Yirang Life Flame, Self Revive)
      if (u.hp <= 0) {
        if (u.lifeFlames > 0) {
          u.lifeFlames--;
          u.hp = Math.round(u.maxHp * (u.char.skills.passive.lifeFlameHealRatio || 0.80));
          u.invincibleUntil = tCurrent + (u.char.skills.passive.lifeFlameInvuln || 2.0);
          return;
        }
        for (const saviour of units) {
          if (!saviour.alive || saviour.allyLifeFlames <= 0) continue;
          if (saviour.slotIndex !== u.slotIndex) {
            saviour.allyLifeFlames--;
            u.hp = Math.round(u.maxHp * (saviour.char.skills.passive.allyLifeFlameHealMaxHp || 0.40));
            u.invincibleUntil = Math.max(u.invincibleUntil, tCurrent + (saviour.char.skills.passive.allyLifeFlameInvuln || 2.0));
            return;
          }
        }
        if (u.selfReviveLeft > 0) {
          u.selfReviveLeft--;
          u.hp = Math.round(u.maxHp * 0.50);
          u.invincibleUntil = tCurrent + u.char.skills.passive.selfReviveInvuln;
          return;
        }
        if (u.char.skills?.passive?.immortalWhileGreenAllyAlive && units.some(a => a.alive && a.slotIndex !== u.slotIndex && a.char.faction === "Land")) {
          u.hp = 1;
          return;
        }
        u.hp = 0;
        u.alive = false;
        u.diedAt = tCurrent;
      }
    };

    const timeline = [];
    let nextTimelineAt = 0;
    let tCurrent = 0;
    const steps = Math.round(duration / dt);

    for (let step = 0; step <= steps; step++) {
      const t = +(step * dt).toFixed(2);
      tCurrent = t;

      // Expire buffs & debuffs
      let debuffRemoved = false;
      for (let i = bossDebuffs.length - 1; i >= 0; i--) {
        if (bossDebuffs[i].until <= t) {
          bossDebuffs.splice(i, 1);
          debuffRemoved = true;
        }
      }
      if (debuffRemoved) bossStatsDirty = true;

      for (const u of units) {
        if (!u.alive) continue;
        let bChanged = false;
        for (let i = u.buffs.length - 1; i >= 0; i--) {
          if (u.buffs[i].until <= t) {
            u.buffs.splice(i, 1);
            bChanged = true;
          }
        }
        if (bChanged) u.statsDirty = true;
      }

      const bState = getBossState();
      const bStats = getEffBossStats(bState);

      // Boss Invincibility / CC / Energy Drain / Attacks
      if (t >= nextBossInvAt) {
        bossInvincibleUntil = t + (bossSkills.invincibilityDuration || 4.0);
        nextBossInvAt = t + bossSkills.invincibilityInterval;
      }
      if (t >= nextBossCcAt) {
        const ccDur = bossSkills.ccDuration || 2.0;
        for (const u of units) {
          if (!u.alive || t < u.ccImmuneUntil) continue;
          const uStats = getUnitStats(u);
          const pCc = DamageCalculator.debuffProbability(bossSkills.bossDebuffAcc || 220, uStats.debuffDodge || 0);
          if (deterministic ? pCc >= 0.5 : (rng() < pCc)) {
            if (u.ignSet.bonus4p?.ccCleanseCounter && t >= u.rafflesiaReadyAt) {
              const rc = u.ignSet.bonus4p.ccCleanseCounter;
              u.rafflesiaReadyAt = t + rc.cooldown;
              u.ccImmuneUntil = Math.max(u.ccImmuneUntil, t + rc.immuneDuration);
              u.energy = Math.min(CFG.MAX_ENERGY, u.energy + (rc.energyRestore || 0));
              drainBossEnergy(u, (rc.enemyEnergyDrainPerSec || 0) * (rc.drainDuration || 1));
            } else {
              u.stunnedUntil = Math.max(u.stunnedUntil, t + ccDur);
            }
          }
        }
        nextBossCcAt = t + bossSkills.ccInterval;
      }
      if (t >= nextBossDrainAt && bossSkills.energyDrainAmount > 0) {
        for (const u of units) {
          if (u.alive && t >= u.invincibleUntil) {
            u.energy = Math.max(0, u.energy - bossSkills.energyDrainAmount);
          }
        }
        nextBossDrainAt = t + bossSkills.energyDrainInterval;
      }
      if (t >= nextBossBasicAt) {
        const frontAlive = units.filter(u => u.alive && u.row === "FRONT" && t >= u.untargetableUntil && t >= u.concealedUntil);
        const anyTargetable = units.filter(u => u.alive && t >= u.untargetableUntil && t >= u.concealedUntil);
        const targets = frontAlive.length > 0 ? frontAlive : (anyTargetable.length > 0 ? anyTargetable : units.filter(u => u.alive && t >= u.untargetableUntil));
        const isUlt = bossEnergy >= (bossConfig.bossUltEpCost || 1000);
        const mult = isUlt ? (bossConfig.bossUltRate || 3.5) : 1.0;
        if (isUlt) bossEnergy = 0;
        else bossEnergy = Math.min(1000, bossEnergy + CFG.BOSS_ENERGY_ATTACK);

        const dmgTargets = isUlt ? units.filter(u => u.alive && t >= u.untargetableUntil) : targets.slice(0, 1);
        for (const tgt of dmgTargets) {
          const uStats = getUnitStats(tgt);
          const dodgeMult = (!isUlt && tgt.ignSet.bonus4p?.basicEvaBonus) ? (1 + tgt.ignSet.bonus4p.basicEvaBonus) : 1.0;
          const res = DamageCalculator.computeDamage({
            attackerStats: { attack: bStats.attack, critRating: 0.05, critBonusRating: 0, accuracy: bStats.accuracy, physicalPierceRating: 0, magicPierceRating: 0 },
            attackerFaction: bossConfig.bossFaction,
            attackerSlotLevel: bState.slotLevel,
            targetStats: dodgeMult !== 1.0 ? Object.assign({}, uStats, { dodge: Math.round((uStats.dodge || 0) * dodgeMult) }) : uStats,
            targetFaction: tgt.char.faction,
            targetSlotLevel: tgt.statInfo.slotLevel,
            skillType: isUlt ? "ULTIMATE" : "NORMAL",
            attackType: bossConfig.bossAttackType || "PHYSICAL",
            attackRate: mult,
            deterministic,
            rng
          });
          if (!res.missed) applyBossDamageToUnit(tgt, res.damage, !isUlt);
        }
        const bHaste = clamp(1.0 + (bStats.haste || 0) / 100, CFG.HASTE_MIN, CFG.HASTE_MAX);
        nextBossBasicAt = t + (bossConfig.bossBasicInterval || 2.2) / bHaste;
      }

      // Per-Unit Tick Logic
      for (const u of units) {
        if (!u.alive) continue;
        const uStats = getUnitStats(u);
        const passive = u.char.skills?.passive || {};

        // Periodic self buffs / stacks
        if (t >= u.nextPeriodicSelfAt && passive.periodicSelfStackBuff) {
          const ps = passive.periodicSelfStackBuff;
          if (u.periodicSelfStacks < ps.maxStacks) {
            u.periodicSelfStacks++;
            u.buffs.push({ key: "pas_self_" + u.periodicSelfStacks, until: 999, stats: ps.stats });
            if (u.periodicSelfStacks === ps.maxStacks && ps.atMaxExtraStats) {
              u.buffs.push({ key: "pas_self_max", until: 999, stats: ps.atMaxExtraStats });
            }
            u.statsDirty = true;
          }
          u.nextPeriodicSelfAt = t + ps.interval;
        }
        if (t >= u.nextPeriodicAlliesAt && passive.periodicAlliesStackBuff) {
          const pa = passive.periodicAlliesStackBuff;
          if (u.periodicAlliesStacks < pa.maxStacks) {
            u.periodicAlliesStacks++;
            for (const ally of units) {
              if (ally.alive) {
                ally.buffs.push({ key: `pas_ally_${u.slotIndex}_${u.periodicAlliesStacks}`, until: 999, stats: pa.stats });
                ally.statsDirty = true;
              }
            }
          }
          u.nextPeriodicAlliesAt = t + pa.interval;
        }
        if (t >= u.nextPeriodicHighestAt && passive.periodicHighestAtkStackBuff) {
          const ph = passive.periodicHighestAtkStackBuff;
          if (u.periodicHighestStacks < ph.maxStacks) {
            u.periodicHighestStacks++;
            const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
            if (carry) {
              carry.buffs.push({ key: `pas_hi_${u.slotIndex}_${u.periodicHighestStacks}`, until: 999, stats: ph.stats });
              carry.statsDirty = true;
            }
          }
          u.nextPeriodicHighestAt = t + ph.interval;
        }
        // Evan opener +200 EP
        if (t >= u.evanOpenerAt && passive.concealHighestAtkAtStart) {
          u.evanOpenerAt = 999;
          const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
          if (carry) carry.energy = Math.min(CFG.MAX_ENERGY, carry.energy + (passive.concealHighestAtkAtStart.revealEnergy || 200));
        }
        // Periodic Passive (Garam Bell of Dawn)
        if (t >= u.periodicPassiveNextAt && passive.periodicPassive) {
          const pp = passive.periodicPassive;
          if (pp.removesInvincibility && t < bossInvincibleUntil) {
            bossInvincibleUntil = t;
            invincibilityDispelledCount++;
            u.dispelsDone++;
          }
          if (pp.allyEnergyGain) {
            for (const a of units) if (a.alive) a.energy = Math.min(CFG.MAX_ENERGY, a.energy + pp.allyEnergyGain);
          }
          if (pp.allyStackBuff) {
            const sb = pp.allyStackBuff;
            for (const a of units) {
              if (!a.alive) continue;
              const cur = a.buffs.filter(b => b.key === sb.key);
              if (cur.length < sb.maxStacks) {
                a.buffs.push({ key: sb.key, until: t + sb.duration, stats: sb.stats });
                a.statsDirty = true;
              }
            }
          }
          u.periodicPassiveNextAt = t + pp.interval;
        }
        // Albelda Spirit Link (passive ATK copy to highest ATK ally)
        if (passive.albeldaSpiritLink) {
          const carry = units.filter(a => a.alive && a.slotIndex !== u.slotIndex).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
          if (carry) {
            const linkMult = t < u.spiritLinkBoostUntil ? 2.0 : 1.0;
            addBuff(carry, `albelda_link_${u.slotIndex}`, t + 1.0, { attack: Math.round(u.statInfo.total.attack * linkMult) });
          }
        }
        // Permanent Summons spawned by Actives (Luslec Thistle / Orchid)
        for (const ps of u.permanentSummons) {
          if (t >= ps.nextAt) {
            const isBloom = t < u.bloomUntil;
            const rate = ps.attackRate + (isBloom ? (ps.bloomBonusRate || 0) : 0);
            dealUnitDamage(u, "SUMMON", rate, 1, null, t);
            ps.nextAt = t + (isBloom && ps.bloomInterval ? ps.bloomInterval : ps.interval);
          }
        }

        // Yirang infinite stacking burn tick
        if (t >= u.yirangNextBurnAt && passive.infiniteStackingBurn) {
          const ib = passive.infiniteStackingBurn;
          dealUnitDamage(u, "DOT", u.yirangBurnRate, 1, null, t);
          if (ib.eeDrainPerSec) drainBossEnergy(u, ib.eeDrainPerSec);
          u.yirangNextBurnAt = t + ib.interval;
        }

        // Periodic self Energy / Hit Barrier / Bonus Hit (Ju A1, Sachi Rev5, Kallavan, Abgrund 4p)
        if (t < u.selfEnergyPerSecUntil && u.selfEnergyPerSecAmt > 0) {
          u.energy = Math.min(CFG.MAX_ENERGY, u.energy + u.selfEnergyPerSecAmt * dt);
        }
        if (t < u.concealedUntil) {
          u.wasConcealed = true;
          if (u.ignSet.bonus4p?.stealthEnergyPerSec) {
            u.energy = Math.min(CFG.MAX_ENERGY, u.energy + u.ignSet.bonus4p.stealthEnergyPerSec * dt);
          }
          if (u.ignSet.bonus4p?.stealthHealAtkRate) {
            u.hp = Math.min(u.maxHp, u.hp + Math.round(uStats.attack * u.ignSet.bonus4p.stealthHealAtkRate * dt));
          }
        } else if (u.wasConcealed) {
          u.wasConcealed = false;
          if (u.ignSet.bonus4p?.revealCritBuff) {
            const rb = u.ignSet.bonus4p.revealCritBuff;
            addBuff(u, "abgrund_rev", t + rb.duration, { critRating: rb.critRating });
            if (rb.skillBlockHits) u.hitBarrier += rb.skillBlockHits;
          }
        }
        if (t >= u.nextPeriodicHitBarrierAt && passive.periodicSelfHitBarrier) {
          u.periodicHitBarrierLeft = passive.periodicSelfHitBarrier.hits;
          u.nextPeriodicHitBarrierAt = t + passive.periodicSelfHitBarrier.cooldown;
        }
        if (t >= u.nextPeriodicBonusHitAt && passive.periodicBonusHit) {
          dealUnitDamage(u, "ACTIVE1", passive.periodicBonusHit.attackRate, 1, null, t);
          u.nextPeriodicBonusHitAt = t + passive.periodicBonusHit.interval;
        }

        // Lilial infinite stacking poison tick
        if (t >= u.lilialNextPoisonAt && passive.infiniteStackingPoison) {
          while (u.lilialPoisonStacks.length && u.lilialPoisonStacks[0] <= t) u.lilialPoisonStacks.shift();
          if (u.lilialPoisonStacks.length > 0) {
            const pRate = u.lilialPoisonStacks.length * passive.infiniteStackingPoison.ratePerStack;
            dealUnitDamage(u, "DOT", pRate, 1, null, t);
          }
          u.lilialNextPoisonAt = t + passive.infiniteStackingPoison.interval;
        }

        // Permanent Summons (Traumerei Kraken/Cobalt, Ren Bull)
        if (t >= u.summonNextAt && passive.spawnsPermanentSummon) {
          const sm = passive.spawnsPermanentSummon;
          dealUnitDamage(u, "SUMMON", sm.attackRate, 1, null, t);
          if (sm.bossEnergyDrainPer3s) drainBossEnergy(u, sm.bossEnergyDrainPer3s * (sm.interval / 3.0));
          u.summonNextAt = t + sm.interval;
        }

        // Temp Summons (Ju Carp Drones)
        if (t < u.tempSummonUntil && t >= u.tempSummonNextAt && u.char.skills?.ultimate?.spawnsTempSummon) {
          const ts = u.char.skills.ultimate.spawnsTempSummon;
          dealUnitDamage(u, "SUMMON", ts.attackRate * ts.count, ts.count, null, t);
          if (u.char.id === "636") u.carpMarkCount = Math.min(16, u.carpMarkCount + ts.count);
          u.tempSummonNextAt = t + ts.interval;
        }

        // Periodic Ally Life Flame gain
        if (t >= u.nextAllyLifeFlameAt && passive.allyLifeFlameInterval) {
          u.allyLifeFlames = Math.min(3, u.allyLifeFlames + 1);
          u.nextAllyLifeFlameAt = t + passive.allyLifeFlameInterval;
        }

        // Raihanna periodic energy
        if (t >= u.nextRaiihannaEpAt && u.ignSet.bonus4p?.periodicEnergy) {
          u.energy = Math.min(CFG.MAX_ENERGY, u.energy + u.ignSet.bonus4p.periodicEnergy.amount);
          u.nextRaiihannaEpAt = t + u.ignSet.bonus4p.periodicEnergy.interval;
        }

        // Runda row aura energy/sec (uniquement tant que la barrière tient !)
        const hasRunda = u.shieldHp > 0 && u.buffs.some(b => b.key === "runda_row");
        if (hasRunda) u.energy = Math.min(CFG.MAX_ENERGY, u.energy + 100 * dt);

        if (t < u.stunnedUntil || t < u.busyUntil) continue;

        const cdMult = 1.0 - clamp(uStats.cooltimeReductionRating || 0, 0, 0.80);

        // 1. Ultimate
        if (u.energy >= CFG.MAX_ENERGY && t >= u.ultLockedUntil && u.char.skills?.ultimate) {
          const ult = u.char.skills.ultimate;
          u.energy = 0;
          u.ultimatesCast++;
          u.busyUntil = t + (ult.castTime || 1.2);
          if (ult.ultLockDuration) u.ultLockedUntil = t + ult.ultLockDuration;

          if (u.ideaLeft > 0 && u.ignSet.bonus4p?.ultEnergyRefund) {
            u.ideaLeft--;
            u.energy = Math.min(CFG.MAX_ENERGY, u.energy + u.ignSet.bonus4p.ultEnergyRefund.amount);
          }

          // Asura 4p rage consumption
          if (u.asuraRage > 0 && u.ignSet.bonus4p?.rageUltBuff) {
            const rb = u.ignSet.bonus4p.rageUltBuff;
            addBuff(u, "asura_rage", t + rb.duration, { attackRating: u.asuraRage * rb.atkPerStack });
            u.asuraRage = 0;
          }

          // Runda / Capelinel triggers on Ult
          if (u.ignSet.bonus4p?.rowBarrierPulse && t >= u.rundaReadyAt) {
            const rp = u.ignSet.bonus4p.rowBarrierPulse;
            for (const ally of units) {
              if (ally.alive && ally.row === u.row) {
                ally.shieldHp += Math.round(u.maxHp * rp.shieldMaxHpRatio);
                addBuff(ally, "runda_row", t + rp.duration, rp.stats);
              }
            }
            u.rundaReadyAt = t + rp.cooldown;
          }
          if (u.ignSet.bonus4p?.rowBarrierPierce && t >= u.capelinelReadyAt) {
            const cp = u.ignSet.bonus4p.rowBarrierPierce;
            for (const ally of units) {
              if (ally.alive && ally.row === u.row) {
                ally.shieldHp += Math.round(uStats.attack * cp.shieldAtkRate);
                addBuff(ally, "capelinel_row", t + cp.duration, cp.allyStats);
              }
            }
            addBossDebuff("capelinel_boss", t + cp.duration, cp.bossStats);
            u.capelinelReadyAt = t + cp.cooldown;
          }
          if (u.ignSet.bonus4p?.backBarrierPulse && u.row === "BACK" && t >= u.dorisReadyAt) {
            const bp = u.ignSet.bonus4p.backBarrierPulse;
            for (const ally of units) {
              if (ally.alive && ally.row === "BACK") {
                ally.shieldHp += Math.round(uStats.attack * bp.shieldAtkRate);
                addBuff(ally, "doris_back", t + bp.duration, bp.stats);
              }
            }
            u.dorisReadyAt = t + (bp.cooldown || 5.0);
          }

          if (ult.selfInvincibleDuration) u.invincibleUntil = Math.max(u.invincibleUntil, t + ult.selfInvincibleDuration);
          if (ult.selfUntargetableDuration) u.untargetableUntil = Math.max(u.untargetableUntil, t + ult.selfUntargetableDuration);
          if (ult.teamInvincibleDuration || ult.immortalityDuration) {
            const dur = ult.teamInvincibleDuration || ult.immortalityDuration;
            for (const a of units) if (a.alive) a.invincibleUntil = Math.max(a.invincibleUntil, t + dur);
          }
          if (ult.selfCdReduceOnUlt) {
            u.cdActive1 = Math.max(t, u.cdActive1 - ult.selfCdReduceOnUlt);
            u.cdActive2 = Math.max(t, u.cdActive2 - ult.selfCdReduceOnUlt);
          }
          if (ult.selfCooldownReduceSec) {
            u.cdActive1 = Math.max(t, u.cdActive1 - ult.selfCooldownReduceSec);
            u.cdActive2 = Math.max(t, u.cdActive2 - ult.selfCooldownReduceSec);
          }
          if (ult.selfCooldownReduceRatio) {
            u.cdActive1 = t + (u.cdActive1 - t) * (1 - ult.selfCooldownReduceRatio);
            u.cdActive2 = t + (u.cdActive2 - t) * (1 - ult.selfCooldownReduceRatio);
          }
          if (ult.resetActive2OnCast) u.cdActive2 = t;
          if (ult.resetActiveCooldownsOnUlt) {
            u.cdActive1 = t;
            u.cdActive2 = t;
          }
          if (ult.selfBarrierMaxHpRatio) {
            u.shieldHp += Math.round(u.maxHp * ult.selfBarrierMaxHpRatio);
          }
          if (ult.teamShieldAtkRate) {
            const sh = Math.round(uStats.attack * ult.teamShieldAtkRate);
            for (const a of units) if (a.alive) a.shieldHp += sh;
          }
          if (ult.teamCleanse) {
            for (const a of units) if (a.alive) a.stunnedUntil = Math.min(a.stunnedUntil, t);
          }
          if (ult.extraHitsOverDuration && (u.char.id !== "629" || u.revTier >= 5)) {
            u.frostSpearsUntil = t + ult.extraHitsOverDuration.duration;
            u.frostSpearRate = ult.extraHitsOverDuration.attackRate;
          }
          if (passive.selfEvadeAfterSkill && (u.char.id !== "629" || u.revTier >= 4)) {
            u.evadeUntil = Math.max(u.evadeUntil, t + passive.selfEvadeAfterSkill);
          }
          if (ult.spawnsTempSummon) {
            u.tempSummonUntil = t + ult.spawnsTempSummon.duration;
            u.tempSummonNextAt = t + ult.spawnsTempSummon.interval;
          }
          if (ult.selfBuff) addBuff(u, `ult_self_${u.slotIndex}`, t + ult.selfBuff.duration, ult.selfBuff.stats);
          if (ult.selfStackBuff) {
            const sb = ult.selfStackBuff;
            const cur = u.buffs.filter(b => b.key === sb.key);
            if (cur.length < sb.maxStacks) {
              u.buffs.push({ key: sb.key, until: t + sb.duration, stats: sb.stats });
              u.statsDirty = true;
            }
          }
          if (ult.darkChargePermanentBuff) {
            addBuff(u, `dc_${u.slotIndex}`, 999, ult.darkChargePermanentBuff);
          }
          if (ult.bloomDuration) u.bloomUntil = Math.max(u.bloomUntil, t + ult.bloomDuration);
          if (ult.spiritLinkBoostDuration) u.spiritLinkBoostUntil = Math.max(u.spiritLinkBoostUntil, t + ult.spiritLinkBoostDuration);
          if (ult.doublePassiveDuration) u.doublePassiveUntil = Math.max(u.doublePassiveUntil, t + ult.doublePassiveDuration);
          const teamBuffObj = ult.teamBuff || ult.allyBuff;
          if (teamBuffObj) for (const a of units) if (a.alive) addBuff(a, `ult_team_${u.slotIndex}`, t + teamBuffObj.duration, teamBuffObj.stats);
          if (ult.allyFlatCopyBuff) {
            const fc = ult.allyFlatCopyBuff;
            for (const a of units) {
              if (a.alive) addBuff(a, `ult_fc_${u.slotIndex}`, t + fc.duration, { attack: Math.round(u.statInfo.total.attack * (fc.atkRatio || 0)) });
            }
          }
          if (ult.highestAtkAllyBuff) {
            const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
            if (carry) addBuff(carry, `ult_ha_${u.slotIndex}`, t + ult.highestAtkAllyBuff.duration, ult.highestAtkAllyBuff.stats);
          }
          if (ult.lowestHpAllyBuff) applyLowestHpAllyBuff(u, ult.lowestHpAllyBuff, "ult_lh", t);
          if (ult.allyPermanentStackBuff) {
            const sb = ult.allyPermanentStackBuff;
            for (const a of units) {
              if (!a.alive) continue;
              const cur = a.buffs.filter(b => b.key === sb.key);
              if (cur.length < sb.maxStacks) {
                a.buffs.push({ key: sb.key, until: 999, stats: sb.stats });
                a.statsDirty = true;
              }
            }
          }
          if (ult.highestAtkStackBuff) {
            const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
            if (carry) {
              const sb = ult.highestAtkStackBuff;
              const cur = carry.buffs.filter(b => b.key === sb.key);
              if (cur.length < sb.maxStacks) {
                carry.buffs.push({ key: sb.key, until: t + sb.duration, stats: sb.stats });
                carry.statsDirty = true;
              }
            }
          }
          if (ult.factionPermanentStackBuff) {
            const fb = ult.factionPermanentStackBuff;
            for (const a of units) {
              if (a.alive && a.char.faction === fb.faction) {
                const cur = a.buffs.filter(b => b.key === fb.key);
                if (cur.length < fb.maxStacks) {
                  a.buffs.push({ key: fb.key, until: 999, stats: fb.stats });
                  a.statsDirty = true;
                }
              }
            }
          }
          if (ult.allyEnergyGain) {
            for (const a of units) {
              if (a.alive && (!a.char.skills?.passive?.gainEnergyOnAllyUlt || a !== u)) {
                a.energy = Math.min(CFG.MAX_ENERGY, a.energy + ult.allyEnergyGain);
              }
            }
          }
          // Ha Yura SSR+ passive: +250 EP sur chaque Ultime lancé par un allié
          for (const listener of units) {
            if (listener.alive && listener !== u && listener.char.skills?.passive?.gainEnergyOnAllyUlt) {
              listener.energy = Math.min(CFG.MAX_ENERGY, listener.energy + listener.char.skills.passive.gainEnergyOnAllyUlt);
            }
          }
          if (ult.bossDebuff) addBossDebuff(`ult_${u.slotIndex}`, t + ult.bossDebuff.duration, ult.bossDebuff.stats);
          if (ult.permanentBossStackDebuff) {
            const pb = ult.permanentBossStackDebuff;
            addBossDebuff(pb.key, 999, pb.stats, pb.maxStacks);
          }
          const healAtkR = ult.teamHealAtkRate || ult.allyHealAtkRate;
          if (healAtkR) {
            const heal = Math.round(uStats.attack * healAtkR);
            for (const a of units) if (a.alive) { a.hp = Math.min(a.maxHp, a.hp + heal); u.healingDone += heal; }
          }
          if (ult.teamHot) {
            activeHots.push({ caster: u, hot: ult.teamHot, until: t + ult.teamHot.duration, nextAt: t + (ult.teamHot.interval || 1.0) });
          }
          if (ult.enemyEnergyDrain) {
            drainBossEnergy(u, ult.enemyEnergyDrain);
          }
          // Albelda Guide of Spirits soul release
          if (passive.soulSystem && u.souls > 0 && t >= u.soulsActiveUntil) {
            const ss = passive.soulSystem;
            const spent = Math.min(ss.maxRelease || 6, u.souls + (ss.bonusRelease || 0));
            u.souls = 0;
            u.soulsActiveUntil = t + ss.duration;
            for (const a of units) {
              if (a.alive) addBuff(a, `souls_${u.slotIndex}`, t + ss.duration, { attackRating: spent * ss.atkPerSoul, defenseRating: spent * ss.defPerSoul, haste: spent * ss.hastePerSoul });
            }
          }
          // Tiara onSkill
          if (passive.onSkill?.selfStackBuff) {
            const sb = passive.onSkill.selfStackBuff;
            const cur = u.buffs.filter(b => b.key === sb.key);
            if (cur.length < sb.maxStacks) {
              u.buffs.push({ key: sb.key, until: 999, stats: sb.stats });
              u.statsDirty = true;
            }
          }
          if (passive.infiniteStackingBurn) u.yirangBurnRate += passive.infiniteStackingBurn.incPerSkillCast;
          if (passive.infiniteStackingPoison) u.lilialPoisonStacks.push(t + passive.infiniteStackingPoison.duration);
          if (passive.possessionSystem && u.possessionStacks < passive.possessionSystem.maxStacks) {
            u.possessionStacks++;
            addBuff(u, "possession", 999, { attackRating: u.possessionStacks * passive.possessionSystem.atkPerStack });
          }

          let effUltRate = ult.attackRate || 6.0;
          if (ult.consumeAccelBonusRate && u.basicStackCount > 0) {
            const isMax = u.basicStackCount >= (passive.basicStackSelf?.maxStacks || 100);
            effUltRate += u.basicStackCount * (isMax ? ult.consumeAccelBonusRate : ult.consumeAccelBonusRate * 0.5);
            u.basicStackCount = 0;
          }
          dealUnitDamage(u, "ULTIMATE", effUltRate, ult.hits || 1, ult, t);
          triggerCarpAndCrystalProcs(u, t);
          continue;
        }

        // 2. Active 1 & Active 2
        const tryCastActive = (skillObj, sourceKey) => {
          if (!skillObj) return false;
          u.busyUntil = t + (skillObj.castTime || 0.75);
          if (!passive.gainEnergyOnAllyUlt) {
            const epAdd = skillObj.epGain !== undefined ? skillObj.epGain : CFG.DEFAULT_ACTIVE_GET_ENERGY;
            u.energy = Math.min(CFG.MAX_ENERGY, u.energy + epAdd);
            if (skillObj.selfEnergyGain) u.energy = Math.min(CFG.MAX_ENERGY, u.energy + skillObj.selfEnergyGain);
          }
          if (sourceKey === "ACTIVE1" && u.char.id === "53" && u.basicStackCount > 0) {
            addBuff(u, "endorsi_od_atk", t + 10.0, { attackRating: u.basicStackCount * 0.10 });
          }
          if (skillObj.selfLifeFlameGain) u.lifeFlames = Math.min(3, u.lifeFlames + skillObj.selfLifeFlameGain);
          if (skillObj.selfConcealDuration) u.concealedUntil = Math.max(u.concealedUntil, t + skillObj.selfConcealDuration);
          if (skillObj.selfEnergyPerSec) {
            u.selfEnergyPerSecUntil = t + skillObj.selfEnergyPerSec.duration;
            u.selfEnergyPerSecAmt = skillObj.selfEnergyPerSec.amount;
          }
          if (skillObj.teamCleanse) {
            for (const a of units) if (a.alive) a.stunnedUntil = Math.min(a.stunnedUntil, t);
          }
          if (passive.selfEvadeAfterSkill && (u.char.id !== "629" || u.revTier >= 4)) {
            u.evadeUntil = Math.max(u.evadeUntil, t + passive.selfEvadeAfterSkill);
          }
          if (skillObj.selfInvincibleDuration) u.invincibleUntil = Math.max(u.invincibleUntil, t + skillObj.selfInvincibleDuration);
          if (skillObj.selfCooldownReduceSec) {
            u.cdActive1 = Math.max(t, u.cdActive1 - skillObj.selfCooldownReduceSec);
            u.cdActive2 = Math.max(t, u.cdActive2 - skillObj.selfCooldownReduceSec);
          }
          if (skillObj.spawnsPermanentSummon) {
            const sm = skillObj.spawnsPermanentSummon;
            if (!u.permanentSummons.some(p => p.key === sm.key)) {
              u.permanentSummons.push({ key: sm.key, interval: sm.interval, bloomInterval: sm.bloomInterval, attackRate: sm.attackRate, bloomBonusRate: sm.bloomBonusRate, nextAt: t + sm.interval });
            }
          }
          if (skillObj.selfBuff) addBuff(u, `${sourceKey}_self_${u.slotIndex}`, t + skillObj.selfBuff.duration, skillObj.selfBuff.stats);
          if (skillObj.selfStackBuff) {
            const sb = skillObj.selfStackBuff;
            const cur = u.buffs.filter(b => b.key === sb.key);
            if (cur.length < sb.maxStacks) {
              u.buffs.push({ key: sb.key, until: t + sb.duration, stats: sb.stats });
              u.statsDirty = true;
            } else {
              for (const b of cur) b.until = t + sb.duration;
            }
          }
          const tBuff = skillObj.teamBuff || skillObj.allyBuff;
          if (tBuff) for (const a of units) if (a.alive) addBuff(a, `${sourceKey}_team_${u.slotIndex}`, t + tBuff.duration, tBuff.stats);
          if (skillObj.allyStackBuff) {
            const sb = skillObj.allyStackBuff;
            const countAdd = sb.stacksPerCast || 1;
            for (const a of units) {
              if (!a.alive) continue;
              for (let k = 0; k < countAdd; k++) {
                const cur = a.buffs.filter(b => b.key === sb.key);
                if (cur.length < sb.maxStacks) {
                  a.buffs.push({ key: sb.key, until: t + sb.duration, stats: sb.stats });
                  a.statsDirty = true;
                } else {
                  for (const b of cur) b.until = t + sb.duration;
                }
              }
            }
          }
          if (skillObj.greenAlliesBuff) for (const a of units) if (a.alive && a.char.faction === "Land") addBuff(a, `${sourceKey}_grn_${u.slotIndex}`, t + skillObj.greenAlliesBuff.duration, skillObj.greenAlliesBuff.stats);
          if (skillObj.factionAlliesTempBuff) {
            const fb = skillObj.factionAlliesTempBuff;
            for (const a of units) if (a.alive && a.char.faction === fb.faction) addBuff(a, `${sourceKey}_fac_${u.slotIndex}`, t + fb.duration, fb.stats);
          }
          if (skillObj.teamConditionalBonus) {
            const cb = skillObj.teamConditionalBonus;
            const aliveUnits = units.filter(a => a.alive);
            const darkCnt = aliveUnits.filter(a => a.char.faction === "Dark").length;
            const physCnt = aliveUnits.filter(a => a.char.attackType === "PHYSICAL").length;
            const magCnt = aliveUnits.filter(a => a.char.attackType === "MAGIC").length;
            const dur = skillObj.allyStackBuff?.duration || 15.0;
            if (cb.minDark3 && darkCnt >= 3) for (const a of aliveUnits) addBuff(a, `${sourceKey}_cdark_${u.slotIndex}`, t + dur, cb.minDark3);
            if (cb.minPhys3 && physCnt >= 3) for (const a of aliveUnits) addBuff(a, `${sourceKey}_cphys_${u.slotIndex}`, t + dur, cb.minPhys3);
            if (cb.minMag3 && magCnt >= 3) for (const a of aliveUnits) addBuff(a, `${sourceKey}_cmag_${u.slotIndex}`, t + dur, cb.minMag3);
          }
          if (skillObj.highestAtkAllyBuff) {
            const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
            if (carry) addBuff(carry, `${sourceKey}_ha_${u.slotIndex}`, t + skillObj.highestAtkAllyBuff.duration, skillObj.highestAtkAllyBuff.stats);
          }
          if (skillObj.lowestHpAllyBuff) applyLowestHpAllyBuff(u, skillObj.lowestHpAllyBuff, `${sourceKey}_lh`, t);
          if (skillObj.highestHpPctAllyBuff) {
            const cfg = skillObj.highestHpPctAllyBuff;
            const target = units.filter(a => a.alive).sort((a, b) => ((b.hp / Math.max(1, b.maxHp)) - (a.hp / Math.max(1, a.maxHp))) || (a.slotIndex - b.slotIndex))[0];
            if (target) {
              addBuff(target, `${sourceKey}_hh_${u.slotIndex}`, t + cfg.duration, cfg.stats);
              if (cfg.statusImmune) target.ccImmuneUntil = Math.max(target.ccImmuneUntil, t + cfg.duration);
            }
          }
          if (skillObj.highestAtkPermanentStackBuff) {
            const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
            if (carry) {
              const sb = skillObj.highestAtkPermanentStackBuff;
              const cur = carry.buffs.filter(b => b.key === sb.key);
              if (cur.length < sb.maxStacks) {
                carry.buffs.push({ key: sb.key, until: 999, stats: sb.stats });
                carry.statsDirty = true;
              }
            }
          }
          if (skillObj.allyEnergyGain) {
            for (const a of units) if (a.alive) a.energy = Math.min(CFG.MAX_ENERGY, a.energy + skillObj.allyEnergyGain);
          }
          if (skillObj.teamHealMaxHpRatio) {
            for (const a of units) if (a.alive) { const hl = Math.round(a.maxHp * skillObj.teamHealMaxHpRatio); a.hp = Math.min(a.maxHp, a.hp + hl); u.healingDone += hl; }
          }
          if (skillObj.lowestAllyHealMaxHp) {
            const low = units.filter(a => a.alive).sort((a, b) => ((a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp))) || (a.slotIndex - b.slotIndex))[0];
            if (low) {
              const hl = Math.round(u.maxHp * skillObj.lowestAllyHealMaxHp);
              low.hp = Math.min(low.maxHp, low.hp + hl);
              u.healingDone += hl;
            }
          }
          if (skillObj.teamHot) {
            activeHots.push({ caster: u, hot: skillObj.teamHot, until: t + skillObj.teamHot.duration, nextAt: t + (skillObj.teamHot.interval || 1.0) });
          }
          const hAtk = skillObj.teamHealAtkRate || skillObj.allyHealAtkRate;
          if (hAtk) {
            const hl = Math.round(uStats.attack * hAtk);
            for (const a of units) if (a.alive) { a.hp = Math.min(a.maxHp, a.hp + hl); u.healingDone += hl; }
          }
          if (skillObj.bossDebuff) addBossDebuff(`${sourceKey}_${u.slotIndex}`, t + skillObj.bossDebuff.duration, skillObj.bossDebuff.stats);
          if (skillObj.ee3BossDebuff) addBossDebuff(`${sourceKey}_ee3_${u.slotIndex}`, t + skillObj.ee3BossDebuff.duration, skillObj.ee3BossDebuff.stats);
          if (skillObj.bossStackDebuff) {
            const bd = skillObj.bossStackDebuff;
            const stObj = bd.defShredPerStack ? { defenseRating: -bd.defShredPerStack } : (bd.dodgePctShredPerStack ? { dodgePctShred: bd.dodgePctShredPerStack } : bd.stats);
            const adds = bd.hitsPerCast || 1;
            for (let c = 0; c < adds; c++) addBossDebuff(bd.key, t + bd.duration, stObj, bd.maxStacks);
          }
          if (skillObj.permanentBossStackDebuff) {
            const pb = skillObj.permanentBossStackDebuff;
            const adds = pb.hitsPerCast || 1;
            for (let c = 0; c < adds; c++) addBossDebuff(pb.key, 999, pb.stats, pb.maxStacks);
          }
          if (skillObj.elementResistDebuff) {
            const er = skillObj.elementResistDebuff;
            const key = "dmgDownFrom" + er.faction + "Rating";
            addBossDebuff(er.key, t + er.duration, { [key]: -er.amount }, er.maxStacks);
          }
          const drainAmt = (skillObj.enemyEnergyDrain || 0) + (skillObj.ee2EnemyEnergyDrain || 0);
          if (drainAmt > 0) {
            drainBossEnergy(u, drainAmt);
          }
          // Soo-oh Blue Jade Fish & Nen Neya Dedication
          if (passive.onActiveSkill) {
            const oa = passive.onActiveSkill;
            if (oa.highestAtkStackBuff) {
              const carry = units.filter(a => a.alive).sort((a, b) => b.statInfo.total.attack - a.statInfo.total.attack)[0];
              if (carry) {
                addBuff(carry, oa.highestAtkStackBuff.key, t + oa.highestAtkStackBuff.duration, oa.highestAtkStackBuff.stats);
                if (passive.blueJadeFishLink) carry.blueJadeFishUntil = Math.max(carry.blueJadeFishUntil, t + oa.highestAtkStackBuff.duration);
              }
            }
            if (oa.allyStackBuff) {
              const mult = t < u.doublePassiveUntil ? 2 : 1;
              const sb = oa.allyStackBuff;
              for (let m = 0; m < mult; m++) {
                for (const a of units) {
                  if (!a.alive) continue;
                  const cur = a.buffs.filter(b => b.key === sb.key);
                  if (cur.length < sb.maxStacks) {
                    a.buffs.push({ key: sb.key, until: t + sb.duration, stats: sb.stats });
                    a.statsDirty = true;
                  }
                }
              }
            }
          }
          if (passive.soulSystem) u.souls = Math.min(passive.soulSystem.maxSouls || 5, u.souls + (passive.soulSystem.gainPerActive || 2));
          if (passive.onSkill?.selfStackBuff) {
            const sb = passive.onSkill.selfStackBuff;
            const cur = u.buffs.filter(b => b.key === sb.key);
            if (cur.length < sb.maxStacks) {
              u.buffs.push({ key: sb.key, until: 999, stats: sb.stats });
              u.statsDirty = true;
            }
          }
          if (skillObj.dot) {
            activeDots.push({ unit: u, until: t + skillObj.dot.duration, interval: skillObj.dot.interval, nextAt: t + skillObj.dot.interval, rate: skillObj.dot.rate });
          }
          const activeRate = skillObj.attackRate !== undefined ? skillObj.attackRate : 2.5;
          if (passive.infiniteStackingBurn && activeRate > 0) u.yirangBurnRate += passive.infiniteStackingBurn.incPerSkillCast;
          if (passive.infiniteStackingPoison && activeRate > 0) u.lilialPoisonStacks.push(t + passive.infiniteStackingPoison.duration);
          if (passive.possessionSystem && u.possessionStacks < passive.possessionSystem.maxStacks) {
            u.possessionStacks++;
            addBuff(u, "possession", 999, { attackRating: u.possessionStacks * passive.possessionSystem.atkPerStack });
          }
          if (activeRate > 0) {
            dealUnitDamage(u, sourceKey, activeRate, skillObj.hits || 1, skillObj, t);
            if (t < u.frostSpearsUntil && u.frostSpearRate > 0) {
              dealUnitDamage(u, sourceKey, u.frostSpearRate, 1, null, t);
            }
          }
          triggerCarpAndCrystalProcs(u, t);
          return true;
        };

        if (t >= u.cdActive1 && u.char.skills?.active1) {
          const a1 = u.char.skills.active1;
          tryCastActive(a1, "ACTIVE1");
          u.cdActive1 = t + (a1.cooldown || 8.5) * cdMult;
          continue;
        }
        if (t >= u.cdActive2 && u.char.skills?.active2) {
          const a2 = u.char.skills.active2;
          tryCastActive(a2, "ACTIVE2");
          u.cdActive2 = t + (a2.cooldown || 9.5) * cdMult;
          continue;
        }

        // 3. Normal attack
        if (t >= u.nextNormalAt) {
          const norm = u.char.skills?.normal || { attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 };
          const totalNormHits = (norm.hits || 1) + Math.min(6, Math.round(uStats.extraBasicHits || 0));
          if (!passive.gainEnergyOnAllyUlt) {
            const normEp = norm.epGain !== undefined ? norm.epGain : CFG.ENERGY_ATTACK;
            u.energy = Math.min(CFG.MAX_ENERGY, u.energy + normEp);
          }
          if (u.ignSet.bonus4p?.rageStackOnBasic) {
            u.asuraRage = Math.min(u.ignSet.bonus4p.rageStackOnBasic.maxStacks, u.asuraRage + 1);
          }
          if (u.ignSet.bonus4p?.hitBarrierOnNormal) {
            u.hitBarrier = Math.min(u.ignSet.bonus4p.hitBarrierOnNormal.maxStacks, u.hitBarrier + 1);
          }
          if (u.char.id === "636") u.carpMarkCount = Math.min(16, u.carpMarkCount + 1);
          if (passive.onHitEnemyEnergyDrain) {
            drainBossEnergy(u, passive.onHitEnemyEnergyDrain);
          }
          if (passive.basicStackSelf) {
            const bs = passive.basicStackSelf;
            if (u.basicStackCount < bs.maxStacks) {
              u.basicStackCount = Math.min(bs.maxStacks, u.basicStackCount + bs.gainPerBasic);
              addBuff(u, bs.key, t + bs.duration, {
                attackRating: u.basicStackCount * bs.atkPerStack,
                attackHaste: u.basicStackCount >= bs.maxStacks ? (bs.hasteAtMax || 0) : 0
              });
              if (u.basicStackCount >= bs.maxStacks && bs.energyAtMax) {
                u.energy = Math.min(CFG.MAX_ENERGY, u.energy + bs.energyAtMax);
              }
            }
          }
          if (passive.kaiserWolfStacks) {
            const kw = passive.kaiserWolfStacks;
            u.kaiserHitCounter += totalNormHits;
            if (u.kaiserHitCounter >= kw.everyHits && t >= u.fenrylReadyAt) {
              u.kaiserHitCounter = 0;
              u.fenrylReadyAt = t + (kw.fenrylIcd || 1.5);
              u.kaiserWolfStacks = Math.min(kw.maxStacks, u.kaiserWolfStacks + 1);
              addBuff(u, `kw_${u.slotIndex}`, 999, { physicalPierceRating: u.kaiserWolfStacks * kw.piercePerStack });
              dealUnitDamage(u, "DOT", kw.fenrylRate || 4.0, 1, null, t);
            }
          }
          if (passive.whiteMarkStacks) {
            const wm = passive.whiteMarkStacks;
            addBossDebuff("white_mag", t + wm.resDuration, { magicResistRating: wm.magResPerStack }, wm.maxResStacks);
            if (u.whiteAtkStacks < wm.maxAtkStacks) {
              u.whiteAtkStacks++;
              addBuff(u, "white_atk", 999, { attackRating: u.whiteAtkStacks * wm.atkPerHit });
            }
          }
          if (passive.greenCrystalDebuff) {
            const gc = passive.greenCrystalDebuff;
            addBossDebuff(`grn_cry_${u.slotIndex}`, t + gc.duration, { dmgDownFromLandRating: -gc.greenResShredPerStack }, gc.maxStacks);
          }
          if (passive.elemCrystalDebuff) {
            const ec = passive.elemCrystalDebuff;
            const key = "dmgDownFrom" + ec.faction + "Rating";
            addBossDebuff(`el_cry_${u.slotIndex}`, t + ec.duration, { [key]: -ec.resShredPerStack }, ec.maxStacks);
          }

          dealUnitDamage(u, "NORMAL", (norm.attackRate || 1.0) * totalNormHits, totalNormHits, norm, t);
          const hMult = getEffectiveHasteMult(uStats, true);
          u.nextNormalAt = t + (norm.interval || 1.1) / hMult;
        }
      }

      // Process generic DoTs
      for (let i = activeDots.length - 1; i >= 0; i--) {
        const d = activeDots[i];
        if (d.until <= t) {
          activeDots.splice(i, 1);
          continue;
        }
        if (t >= d.nextAt && d.unit.alive) {
          dealUnitDamage(d.unit, "DOT", d.rate, 1, null, t);
          d.nextAt = t + d.interval;
        }
      }

      // Process team HoTs
      for (let i = activeHots.length - 1; i >= 0; i--) {
        const h = activeHots[i];
        if (h.until <= t || !h.caster.alive) {
          activeHots.splice(i, 1);
          continue;
        }
        if (t >= h.nextAt) {
          const cStats = getUnitStats(h.caster);
          const hl = h.hot.atkRate
            ? Math.round(cStats.attack * h.hot.atkRate)
            : Math.round(h.caster.maxHp * (h.hot.maxHpRatio || 0));
          if (hl > 0) {
            for (const a of units) if (a.alive) { a.hp = Math.min(a.maxHp, a.hp + hl); h.caster.healingDone += hl; }
          }
          h.nextAt = t + (h.hot.interval || 1.0);
        }
      }

      if (t >= nextTimelineAt) {
        const stNow = getBossState();
        timeline.push({ t, totalDamage: totalBossDamage, tier: stNow.section.id, bossLv: stNow.slotLevel });
        nextTimelineAt = t + 3.0;
      }
    }

    const finalState = getBossState();
    const aliveCount = units.filter(u => u.alive).length;

    return {
      bossId: bossConfig.id,
      bossName: bossConfig.name,
      airshipId,
      airshipName: airshipObj.name,
      totalDamage: totalBossDamage,
      finalTier: finalState.section.id,
      finalBossLevel: finalState.slotLevel,
      teamOverwhelmingLevel: units[0]?.statInfo?.total?.shinsuCoreLevel ?? Math.max(0, Number(prog.shinsuCoreLevel || 0)),
      finalBossOverwhelmingLevel: finalState.section?.ovw ?? 0,
      aliveCount,
      teamCount: units.length,
      invincibilityDispelledCount,
      comboLabel: units[0]?.statInfo?.comboLabel || "",
      timeline,
      units: units.map(u => {
        const ms = u.multSums;
        const avgMults = ms.n > 0 ? {
          mDef: ms.mDef / ms.n,
          mType: ms.mType / ms.n,
          mCrit: ms.mCrit / ms.n,
          mFaction: ms.mFaction / ms.n,
          mFinal: ms.mFinal / ms.n,
          mOverwhelming: ms.mOverwhelming / ms.n,
          hitProb: ms.hitProb / ms.n
        } : null;
        return {
          slotIndex: u.slotIndex,
          row: u.row,
          charId: u.char.id,
          name: u.char.name,
          rarity: u.char.rarity,
          faction: u.char.faction,
          role: u.char.role,
          attackType: u.char.attackType,
          shinsuLevel: u.statInfo.slotLevel,
          isHighLink: Boolean(u.cfg.isHighLink),
          set: u.ignSet.id === "none" ? "none" : u.cfg.set,
          soulLv: u.ignSet.soulLv || 0,
          setName: u.ignSet.name,
          slot4: u.cfg.slot4,
          slot5: u.cfg.slot5,
          totalDamage: u.totalDamage,
          sharePct: totalBossDamage > 0 ? (u.totalDamage / totalBossDamage) * 100 : 0,
          damageBySource: u.damageBySource,
          healingDone: u.healingDone,
          damageTaken: u.damageTaken,
          ultimatesCast: u.ultimatesCast,
          dispelsDone: u.dispelsDone,
          alive: u.alive,
          diedAt: u.diedAt,
          baseAttack: u.statInfo.total.attack,
          baseHp: u.statInfo.total.health,
          avgMults
        };
      })
    };
  }

  const API = {
    TruncatePoint3,
    clamp,
    getSlotRow,
    getShinsuMult,
    getSlotGradeMult,
    getLimitBreakMult,
    computeTeamFactionCombo,
    getFactionRelationRatio,
    computeUnitTotalStats,
    getBossStateForDamage,
    getBossStateFromSection,
    DamageCalculator,
    simulateBossMatch
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.TOG_SIM = API;
})(typeof window !== "undefined" ? window : globalThis);
