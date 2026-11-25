/**
 * Optimiseur d'Équipe Boss — Tower of God: New World
 * Supporte :
 *   - 1 Équipe (+ Vaisseau optimal) avec restriction stricte de faction (ex: Zigena Vert)
 *   - 2 Équipes disjointes (10 héros distincts + 2 vaisseaux distincts) pour Boss 2 decks (ex: Data Khun Edahn)
 */
(function (global) {
  "use strict";

  const DB = global.TOG_DB || (typeof require !== "undefined" ? require("../data/db-bundle.js") : null);
  const SIM = global.TOG_SIM || (typeof require !== "undefined" ? require("./simulator.js") : null);
  if (!DB || !SIM) throw new Error("TOG_DB et TOG_SIM requis avant engine/optimizer.js.");

  const RARITY_RANK = { EX: 5, "XSR+": 4, "SSR+": 4, SSR: 3, SR: 2, R: 1 };

  function makeUnitSpec(char, overrides, globalProg) {
    const isSup = char.role === "Support" || char.role === "Tank";
    const heroBox = globalProg?.box && globalProg.box[char.id];
    const boxStats = heroBox ? {
      lb: heroBox.lb,
      ee: heroBox.ee,
      rev: heroBox.rev,
      transBoss: heroBox.transBoss || 0
    } : {};
    return Object.assign({
      charId: char.id,
      row: char.rangeType === "NEAR" ? "FRONT" : "BACK",
      set: char.recommendedSet || (isSup ? "runda" : "asura"),
      slot4: char.recommendedSlot4 || (isSup ? "magicResistRating" : "critBonusRating"),
      slot5: char.recommendedSlot5 || (isSup ? "physicalResistRating" : (char.attackType === "MAGIC" ? "magicPierceRating" : "physicalPierceRating")),
      subs: isSup ? "support_haste_acc" : "dps_pierce_focus"
    }, boxStats, overrides || {});
  }

  function hasRowAuraDuplicate(team, slotIdx, setKey) {
    const ign = DB.IGNITION_SETS[setKey];
    if (!ign || !ign.uniqueAura) return false;
    const row = SIM.getSlotRow(slotIdx);
    for (let i = 0; i < team.length; i++) {
      if (i === slotIdx) continue;
      if (ign.backRowOnly && row !== "BACK") return true;
      if (team[i].set === setKey && (!ign.sameRowOnly || SIM.getSlotRow(i) === row)) return true;
    }
    return false;
  }

  function getCandidateSetsForChar(char, team, slotIdx, globalProg, bossConfig) {
    const row = SIM.getSlotRow(slotIdx);
    const isSup = char.role === "Support" || char.role === "Tank";
    const hasCc = Number(bossConfig?.bossSkills?.ccInterval || 0) > 0;
    const souls = globalProg?.iwSoulLevels || {};
    const soulLeveled = Object.entries(souls)
      .filter(([k, v]) => Number(v) >= 15 && (k !== "doris" || row === "BACK"))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([k]) => k);
    const base = [
      char.recommendedSet,
      ...soulLeveled,
      ...(hasCc && isSup ? ["rafflesia"] : []),
      "raihanna", "asura", "mago", "sundance", "el",
      "capelinel", "runda", ...(row === "BACK" ? ["doris"] : []), "idea", "bari", "rafflesia"
    ];
    return [...new Set(base)].filter(s => DB.IGNITION_SETS[s] && !hasRowAuraDuplicate(team, slotIdx, s)).slice(0, 14);
  }

  function getEligibleCharacters(bossConfig, options, globalProg) {
    const opts = options || {};
    const allowed = bossConfig.allowedFactions;
    const ownedSet = (opts.ownedIds && opts.ownedIds.length > 0) ? new Set(opts.ownedIds) : null;
    const excludeSet = (opts.excludeIds && (opts.excludeIds instanceof Set ? opts.excludeIds : new Set(opts.excludeIds))) || null;
    const box = opts.accountBox || globalProg?.box || null;
    const boxFactions = opts.boxFactionsLoaded || globalProg?.boxFactionsLoaded || null;
    const boxFactionSet = Array.isArray(boxFactions) && boxFactions.length > 0 ? new Set(boxFactions) : null;
    const minRarity = opts.includeLowRarity ? 1 : 3;

    return DB.CHARACTERS.filter(c => {
      if (allowed && !allowed.includes(c.faction)) return false;
      if (opts.excludeCollab && c.isCollab) return false;
      if (ownedSet && !ownedSet.has(c.id)) return false;
      if (box && (!boxFactionSet || boxFactionSet.has(c.faction))) {
        if (!box[c.id] || !box[c.id].owned) return false;
      }
      if (excludeSet && excludeSet.has(c.id)) return false;
      if ((RARITY_RANK[c.rarity] || 1) < minRarity) return false;
      return true;
    });
  }

  function teamSignature(team) {
    return team.map(u => u.charId).sort().join("|");
  }

  function collectSynergyBadges(simRes) {
    const badges = [];
    const chars = simRes.units.map(u => DB.CHARACTERS.find(c => c.id === u.charId)).filter(Boolean);
    const ids = new Set(chars.map(c => c.id));
    if (chars.some(c => c.removesInvincibility)) badges.push("Purge / Dispel");
    if (chars.some(c => c.destroysBarrier)) badges.push("Brise-Barrière");
    // Synergies Vertes
    if (ids.has("636")) badges.push("-80% Rés. Vert & +160% ATQ (Ju)");
    if (ids.has("24")) badges.push("-60% Rés. Vert (Rachel)");
    if (ids.has("26")) badges.push("-60% Rés. Vert (Shane)");
    if (ids.has("25")) badges.push("-60% Rés. Vert (Yeonhee)");
    if (ids.has("52") || ids.has("643")) badges.push("-80% DÉF Boss");
    if (ids.has("12")) badges.push("+80% Pierce Mag (Lero Ro)");
    if (ids.has("125")) badges.push("+80% ATQ Vert (Lozeal)");
    if (ids.has("605")) badges.push("+80% ATQ & -100 Hâte (Traumerei)");
    // Synergies Multi-Factions
    if (ids.has("631")) badges.push("Poisson Jade & -CritRes (Soo-oh)");
    if (ids.has("43")) badges.push("-60% DÉF & -NormRes (Hwaryun SSR+)");
    if (ids.has("625")) badges.push("+300% ATQ Copy & -RésMag (Khun Flamme)");
    if (ids.has("42")) badges.push("+720% ATQ & Pierce (Narae Trésor)");
    if (ids.has("649")) badges.push("-80% DÉF & +Pierce Phys (Nen Neya)");
    if (ids.has("403") || ids.has("3005")) badges.push("Purge / +EP / +Ult Pierce (Garam)");
    if (ids.has("421") || ids.has("656")) badges.push("Lien / Âmes +ATQ (Albelda)");
    if (ids.has("651")) badges.push("Opéra +400% ATQ & -80% DÉF (Repellista)");
    if (ids.has("641")) badges.push("Carry Auto Magique (Bam Léviathan)");
    if (ids.has("53")) badges.push("Carry Accéléré (Endorsi Rebelle)");
    if (ids.has("642")) badges.push("Invocations Dark (Luslec EX)");
    if (ids.has("618")) badges.push("Lame +100% Pierce Phys (Gustang EX)");
    if (ids.has("626")) badges.push("Carry Phys + -60% RésPhys (Urek EX)");
    if (ids.has("51")) badges.push("-100% ATQ/DÉF Boss (Khun Edahn EX)");
    if (ids.has("33") || ids.has("622") || ids.has("113")) badges.push("Sauvetage Fatal / Survie");
    if (simRes.airshipId && simRes.airshipId !== "none") badges.push(`Vaisseau : ${simRes.airshipName}`);
    if (badges.length === 0 && simRes.comboLabel) badges.push(simRes.comboLabel);
    return badges;
  }

  /**
   * Choisit le meilleur Vaisseau Suspendu pour une équipe donnée
   */
  function optimizeAirshipForTeam(team, bossConfig, globalProg, excludedAirships, dt) {
    const excl = excludedAirships instanceof Set ? excludedAirships : new Set(excludedAirships || []);
    const priorityOrder = [
      "vigilantia", "aquila_nova", "tempest_hawk", "carcharias", "ignis_ira",
      "azure_tempest", "lux_imperium", "gloamspire", "red_death",
      "albatross", "epervier"
    ];
    let candidates = priorityOrder.filter(id => DB.AIRSHIPS[id] && !excl.has(id));
    if (globalProg?.airships && Object.keys(globalProg.airships).length > 0) {
      const ownedCandidates = candidates.filter(id => globalProg.airships[id]?.owned === true);
      if (ownedCandidates.length > 0) candidates = ownedCandidates;
    }
    if (candidates.length === 0) {
      const fallback = Object.keys(DB.AIRSHIPS).find(id => id !== "none" && !excl.has(id)) || "none";
      candidates.push(fallback);
    }

    let best = null;
    for (const shipId of candidates) {
      const sim = SIM.simulateBossMatch(team, bossConfig, globalProg, {
        deterministic: true,
        dt: dt || 0.25,
        airshipId: shipId
      });
      if (!best || sim.totalDamage > best.sim.totalDamage) {
        best = {
          airshipId: shipId,
          airshipName: DB.AIRSHIPS[shipId].name,
          sim
        };
      }
    }
    return best;
  }

  /**
   * Détermine quels slots tirent le meilleur parti des liens Shinsu élevés (supporte 1 ou plusieurs High Links)
   */
  function optimizeHighLinkForTeam(team, bossConfig, globalProg, highLinkBonus, airshipId, dt) {
    const bonus = Number(highLinkBonus || 0);
    const baseLv = Number(globalProg?.shinsuLevel || 1914);
    const slotLevels = (Array.isArray(globalProg?.shinsuSlotLevels) && globalProg.shinsuSlotLevels.length === 5)
      ? [...globalProg.shinsuSlotLevels].map(Number).sort((a, b) => b - a)
      : [baseLv + bonus, baseLv, baseLv, baseLv, baseLv];
    const minLv = Math.min(...slotLevels);
    const elevated = slotLevels.filter(lv => lv > minLv);

    if (elevated.length === 0) {
      const cleanTeam = team.map(u => Object.assign({}, u, { shinsuLevel: minLv, isHighLink: false }));
      return {
        highLinkSlot: -1,
        highLinkLevel: minLv,
        highLinkHeroName: null,
        highLinkSummary: null,
        team: cleanTeam,
        sim: null
      };
    }

    let best = null;
    if (elevated.length >= 3) {
      // Affectation gloutonne rapide quand 3+ slots élevés (ex: 1620/1620/1611)
      const lvMap = new Array(team.length).fill(minLv);
      const taken = new Array(team.length).fill(false);
      let curSim = null;
      const hlDt = dt || 0.30;
      for (const lv of elevated) {
        let pickIdx = -1;
        let pickSim = null;
        for (let i = 0; i < team.length; i++) {
          if (taken[i]) continue;
          const testMap = lvMap.slice();
          testMap[i] = lv;
          const trial = team.map((u, idx) => Object.assign({}, u, {
            shinsuLevel: testMap[idx],
            isHighLink: testMap[idx] > minLv
          }));
          const sim = SIM.simulateBossMatch(trial, bossConfig, globalProg, {
            deterministic: true,
            dt: hlDt,
            airshipId
          });
          if (!pickSim || sim.totalDamage > pickSim.totalDamage) {
            pickSim = sim;
            pickIdx = i;
          }
        }
        if (pickIdx >= 0) {
          taken[pickIdx] = true;
          lvMap[pickIdx] = lv;
          curSim = pickSim;
        }
      }
      const trial = team.map((u, idx) => Object.assign({}, u, {
        shinsuLevel: lvMap[idx],
        isHighLink: lvMap[idx] > minLv
      }));
      const topIdx = lvMap.indexOf(Math.max(...lvMap));
      const hlChar = DB.CHARACTERS.find(c => c.id === trial[topIdx].charId);
      const hlParts = lvMap
        .map((lv, idx) => ({ lv, idx }))
        .filter(x => x.lv > minLv)
        .sort((a, b) => b.lv - a.lv)
        .map(x => {
          const c = DB.CHARACTERS.find(ch => ch.id === trial[x.idx].charId);
          return `${c ? c.name : trial[x.idx].charId} (${x.lv})`;
        });
      best = {
        highLinkSlot: topIdx,
        highLinkLevel: lvMap[topIdx],
        highLinkHeroName: hlChar ? hlChar.name : trial[topIdx].charId,
        highLinkSummary: hlParts.join(" · "),
        slotLevels: lvMap,
        team: trial,
        sim: curSim
      };
      return best;
    }

    // Générer toutes les affectations uniques des slots > minLv (<= 20 combinaisons si elevated.length <= 2)
    const assignments = [];
    const cur = new Array(team.length).fill(minLv);
    const used = new Array(team.length).fill(false);
    function gen(eIdx, prevIdx) {
      if (eIdx === elevated.length) {
        assignments.push(cur.slice());
        return;
      }
      const startI = (eIdx > 0 && elevated[eIdx] === elevated[eIdx - 1]) ? (prevIdx + 1) : 0;
      for (let i = startI; i < team.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur[i] = elevated[eIdx];
        gen(eIdx + 1, i);
        cur[i] = minLv;
        used[i] = false;
      }
    }
    gen(0, -1);

    for (const lvMap of assignments) {
      const trial = team.map((u, idx) => Object.assign({}, u, {
        shinsuLevel: lvMap[idx],
        isHighLink: lvMap[idx] > minLv
      }));
      const sim = SIM.simulateBossMatch(trial, bossConfig, globalProg, {
        deterministic: true,
        dt: dt || 0.25,
        airshipId
      });
      if (!best || sim.totalDamage > best.sim.totalDamage) {
        const topIdx = lvMap.indexOf(Math.max(...lvMap));
        const hlChar = DB.CHARACTERS.find(c => c.id === trial[topIdx].charId);
        const hlParts = lvMap
          .map((lv, idx) => ({ lv, idx }))
          .filter(x => x.lv > minLv)
          .sort((a, b) => b.lv - a.lv)
          .map(x => {
            const c = DB.CHARACTERS.find(ch => ch.id === trial[x.idx].charId);
            return `${c ? c.name : trial[x.idx].charId} (${x.lv})`;
          });
        best = {
          highLinkSlot: topIdx,
          highLinkLevel: lvMap[topIdx],
          highLinkHeroName: hlChar ? hlChar.name : trial[topIdx].charId,
          highLinkSummary: hlParts.join(" · "),
          slotLevels: lvMap,
          team: trial,
          sim
        };
      }
    }
    return best;
  }

  /**
   * Recherche les meilleures équipes 5 héros de zéro pour un Boss donné
   */
  function findBestTeams(bossConfig, globalProg, options) {
    const t0 = Date.now();
    const opts = options || {};
    const topN = opts.topN || 10;
    const lockedSlots = opts.lockedSlots || {};
    const optimizeAirship = opts.optimizeAirship !== false;
    const highLinkBonus = Number(opts.highLinkBonus ?? globalProg?.highLinkBonus ?? 0);
    const slotArr = (Array.isArray(globalProg?.shinsuSlotLevels) && globalProg.shinsuSlotLevels.length === 5)
      ? globalProg.shinsuSlotLevels.map(Number)
      : null;
    const hasElevatedSlots = slotArr ? (Math.max(...slotArr) > Math.min(...slotArr)) : (highLinkBonus > 0);
    const isIwNone = globalProg?.iwMode === "none";
    const excludedAirships = opts.excludedAirships instanceof Set
      ? opts.excludedAirships
      : new Set(opts.excludedAirships || []);
    const eligible = getEligibleCharacters(bossConfig, opts, globalProg);

    if (eligible.length < 5) {
      return {
        elapsedMs: Date.now() - t0,
        bossId: bossConfig.id,
        eligibleCount: eligible.length,
        rankings: [],
        error: `Pas assez de héros éligibles (${eligible.length}/5).`
      };
    }

    // 1. Score individuel rapide
    const soloScores = eligible.map(ch => {
      const dummyTeam = [makeUnitSpec(ch, { row: "BACK" }, globalProg)];
      const sim = SIM.simulateBossMatch(dummyTeam, bossConfig, globalProg, { deterministic: true, dt: 0.35 });
      const hasSupValue = (
        (ch.tags || []).some(t => /Decrease|Increase|Removal|Recovery|Invincibility/i.test(t)) ||
        !!ch.skills?.passive?.carpMarkSystem ||
        !!ch.skills?.passive?.greenCrystalDebuff ||
        !!ch.skills?.passive?.elemCrystalDebuff ||
        !!ch.skills?.passive?.factionAlliesBuff ||
        !!ch.skills?.passive?.permanentAllies ||
        !!ch.skills?.passive?.blueJadeFishLink ||
        !!ch.skills?.passive?.albeldaSpiritLink ||
        !!ch.skills?.passive?.soulSystem ||
        !!ch.skills?.passive?.periodicHighestAtkStackBuff ||
        !!ch.skills?.passive?.periodicPassive ||
        !!ch.skills?.active1?.bossDebuff ||
        !!ch.skills?.active1?.bossStackDebuff ||
        !!ch.skills?.active1?.allyBuff ||
        !!ch.skills?.active1?.allyStackBuff ||
        !!ch.skills?.active2?.bossDebuff ||
        !!ch.skills?.active2?.teamBuff ||
        !!ch.skills?.active2?.allyBuff ||
        !!ch.skills?.ultimate?.bossDebuff ||
        !!ch.skills?.ultimate?.teamBuff ||
        !!ch.skills?.ultimate?.allyBuff ||
        !!ch.skills?.ultimate?.allyFlatCopyBuff ||
        ch.role === "Support"
      );
      return {
        char: ch,
        soloDamage: sim.totalDamage,
        hasSupValue,
        rarityScore: RARITY_RANK[ch.rarity] || 1
      };
    });

    soloScores.sort((a, b) => b.soloDamage - a.soloDamage);

    // Assurer un mix de Carries Physiques + Magiques + Avantage Élémentaire dans carryPool (sans contrainte de rôle)
    const physCarries = soloScores.filter(s => s.char.attackType === "PHYSICAL").slice(0, 3).map(s => s.char);
    const magCarries = soloScores.filter(s => s.char.attackType === "MAGIC").slice(0, 3).map(s => s.char);
    const advCarries = soloScores.filter(s => SIM.getFactionRelationRatio(s.char.faction, bossConfig.bossFaction) > 1.0).slice(0, 3).map(s => s.char);
    const topAllCarries = soloScores.slice(0, 4).map(s => s.char);
    const carryPool = [...new Map([...topAllCarries, ...advCarries, ...physCarries, ...magCarries].map(c => [c.id, c])).values()].slice(0, 8);

    // Sans troncature aveugle : inclure tous les EX, tous les supports/buffers investis (LB12+ / SSR+ / clés SSR), top 20 DPS et top 8 avantage élémentaire
    const keySupportSsrIds = new Set(["636", "12", "125", "418", "262", "114", "10", "101"]);
    const candidateIds = new Set();
    for (const s of soloScores.slice(0, 20)) candidateIds.add(s.char.id);
    for (const s of soloScores.filter(x => SIM.getFactionRelationRatio(x.char.faction, bossConfig.bossFaction) > 1.0).slice(0, 8)) candidateIds.add(s.char.id);
    for (const s of soloScores) {
      const boxInfo = globalProg?.box?.[s.char.id];
      const effLb = boxInfo ? boxInfo.lb : Number(globalProg?.defaultLb ?? 21);
      const isEx = s.rarityScore >= 5;
      const isBossTrans = (boxInfo?.transBoss || 0) >= 1;
      const isInvestedSup = s.hasSupValue && (effLb >= 12 || s.rarityScore >= 4 || keySupportSsrIds.has(s.char.id));
      if (isEx || isBossTrans || isInvestedSup) candidateIds.add(s.char.id);
    }
    const candidatePool = eligible.filter(c => candidateIds.has(c.id));

    if (opts.onProgress) opts.onProgress(15, `Pool sélectionné : ${candidatePool.length} héros éligibles`);

    const searchDt = candidatePool.length > 65 ? 0.55 : (candidatePool.length > 42 ? 0.40 : 0.30);
    const isShipAvailable = (shipId) => {
      if (!DB.AIRSHIPS[shipId]) return false;
      if (excludedAirships.has(shipId)) return false;
      if (globalProg?.airships && Object.keys(globalProg.airships).length > 0) {
        return globalProg.airships[shipId]?.owned === true;
      }
      return true;
    };

    const optimizeFromSeed = (seedTeam, seedCarryChar) => {
      let team = seedTeam.map(u => Object.assign({}, u));
      let seedShip = globalProg?.airshipId || "none";
      if (optimizeAirship && seedCarryChar) {
        const pref = seedCarryChar.attackType === "MAGIC" ? "aquila_nova" : "vigilantia";
        if (isShipAvailable(pref)) seedShip = pref;
      }
      let bestSim = SIM.simulateBossMatch(team, bossConfig, globalProg, { deterministic: true, dt: searchDt, airshipId: seedShip });

      for (let pass = 0; pass < 2; pass++) {
        let improved = false;
        const slotOrder = [3, 4, 0, 1, 2];
        for (const slot of slotOrder) {
          if (lockedSlots[slot]) continue;
          const usedElsewhere = new Set(team.filter((_, i) => i !== slot).map(u => u.charId));
          const pool = candidatePool;

          for (const ch of pool) {
            if (usedElsewhere.has(ch.id)) continue;
            const sets = isIwNone ? ["none"] : getCandidateSetsForChar(ch, team, slot, globalProg, bossConfig);
            const sKey = isIwNone ? "none" : (sets[0] || "idea");
            const candidateUnit = makeUnitSpec(ch, {
              row: SIM.getSlotRow(slot),
              set: sKey
            }, globalProg);
            const trial = team.map((u, i) => (i === slot ? candidateUnit : u));
            const sim = SIM.simulateBossMatch(trial, bossConfig, globalProg, { deterministic: true, dt: searchDt, airshipId: seedShip });
            if (sim.totalDamage > bestSim.totalDamage * 1.0001) {
              bestSim = sim;
              team = trial;
              improved = true;
            }
          }

          if (!isIwNone) {
            const chosenChar = DB.CHARACTERS.find(c => c.id === team[slot].charId);
            if (chosenChar) {
              for (const sKey of getCandidateSetsForChar(chosenChar, team, slot, globalProg, bossConfig)) {
                if (sKey === team[slot].set) continue;
                const trial = team.map((u, i) => (i === slot ? Object.assign({}, u, { set: sKey }) : u));
                const sim = SIM.simulateBossMatch(trial, bossConfig, globalProg, { deterministic: true, dt: searchDt, airshipId: seedShip });
                if (sim.totalDamage > bestSim.totalDamage * 1.0001) {
                  bestSim = sim;
                  team = trial;
                }
              }
            }
          }
        }
        if (!improved && pass === 0) break;
      }

      // Affiner Slot 4 & Slot 5 du Carry principal
      if (!isIwNone) {
        const topUnitIdx = bestSim.units.reduce((best, u, idx, arr) => u.totalDamage > arr[best].totalDamage ? idx : best, 0);
        const topChar = DB.CHARACTERS.find(c => c.id === team[topUnitIdx].charId);
        if (topChar) {
          const s4Opts = ["critBonusRating", "debuffAccuracy", "magicResistRating"];
          const s5Opts = [topChar.attackType === "MAGIC" ? "magicPierceRating" : "physicalPierceRating", "critRating", "physicalResistRating"];
          for (const s4 of s4Opts) {
            for (const s5 of s5Opts) {
              const trial = team.map((u, i) => (i === topUnitIdx ? Object.assign({}, u, { slot4: s4, slot5: s5 }) : u));
              const sim = SIM.simulateBossMatch(trial, bossConfig, globalProg, { deterministic: true, dt: searchDt, airshipId: seedShip });
              if (sim.totalDamage > bestSim.totalDamage * 1.0001) {
                bestSim = sim;
                team = trial;
              }
            }
          }
        }
      }

      return { team, sim: bestSim };
    };

    const distinctBySig = new Map();
    const recordCandidate = (team, sim) => {
      const sig = teamSignature(team);
      const prev = distinctBySig.get(sig);
      if (!prev || sim.totalDamage > prev.sim.totalDamage) {
        distinctBySig.set(sig, { team, sim });
      }
    };

    const fillSeedWithCarry = (carryChar, secondChar, carrySlot) => {
      const used = new Set();
      const slots = [null, null, null, null, null];
      for (const [sIdx, cid] of Object.entries(lockedSlots)) {
        const ch = DB.CHARACTERS.find(c => c.id === cid);
        if (ch) {
          slots[Number(sIdx)] = makeUnitSpec(ch, { row: SIM.getSlotRow(Number(sIdx)) }, globalProg);
          used.add(ch.id);
        }
      }
      const cIdx = carrySlot !== undefined ? carrySlot : 3;
      if (!slots[cIdx] && !used.has(carryChar.id)) {
        const cSets = isIwNone ? ["none"] : getCandidateSetsForChar(carryChar, slots.filter(Boolean), cIdx, globalProg, bossConfig);
        slots[cIdx] = makeUnitSpec(carryChar, { row: SIM.getSlotRow(cIdx), set: cSets[0] || carryChar.recommendedSet }, globalProg);
        used.add(carryChar.id);
      }
      if (secondChar && !used.has(secondChar.id)) {
        const sIdx = !slots[4] ? 4 : (!slots[3] ? 3 : slots.findIndex(x => !x));
        if (sIdx >= 0 && !slots[sIdx]) {
          const sSets = isIwNone ? ["none"] : getCandidateSetsForChar(secondChar, slots.filter(Boolean), sIdx, globalProg, bossConfig);
          slots[sIdx] = makeUnitSpec(secondChar, { row: SIM.getSlotRow(sIdx), set: sSets[0] || secondChar.recommendedSet }, globalProg);
          used.add(secondChar.id);
        }
      }
      const fillerOrder = candidatePool.filter(c => !used.has(c.id));
      for (let i = 0; i < 5; i++) {
        if (!slots[i]) {
          const pick = fillerOrder.shift() || eligible.find(c => !used.has(c.id));
          if (!pick) return null;
          used.add(pick.id);
          const sets = isIwNone ? ["none"] : getCandidateSetsForChar(pick, slots.filter(Boolean), i, globalProg, bossConfig);
          slots[i] = makeUnitSpec(pick, { row: SIM.getSlotRow(i), set: sets[0] || pick.recommendedSet }, globalProg);
        }
      }
      return slots;
    };

    const seeds = [];
    for (let i = 0; i < carryPool.length; i++) {
      const sBack = fillSeedWithCarry(carryPool[i], null, 3);
      if (sBack) seeds.push({ team: sBack, carry: carryPool[i] });
      if (i < Math.min(2, carryPool.length)) {
        const sFront = fillSeedWithCarry(carryPool[i], null, 0);
        if (sFront) seeds.push({ team: sFront, carry: carryPool[i] });
      }
    }
    if (carryPool.length >= 2) {
      const sDual1 = fillSeedWithCarry(carryPool[0], carryPool[1], 3);
      if (sDual1) seeds.push({ team: sDual1, carry: carryPool[0] });
    }

    for (let si = 0; si < seeds.length; si++) {
      const res = optimizeFromSeed(seeds[si].team, seeds[si].carry);
      recordCandidate(res.team, res.sim);
      if (opts.onProgress) {
        opts.onProgress(20 + Math.round(((si + 1) / seeds.length) * 50), `Seed ${si + 1}/${seeds.length} optimisé`);
      }
    }

    const bestBase = [...distinctBySig.values()].sort((a, b) => b.sim.totalDamage - a.sim.totalDamage)[0];
    if (bestBase) {
      for (let slot = 0; slot < 5; slot++) {
        if (lockedSlots[slot]) continue;
        const usedElsewhere = new Set(bestBase.team.filter((_, i) => i !== slot).map(u => u.charId));
        const baseSlotSet = bestBase.team[slot].set;
        for (const ch of candidatePool) {
          if (usedElsewhere.has(ch.id)) continue;
          const sets = isIwNone ? ["none"] : getCandidateSetsForChar(ch, bestBase.team, slot, globalProg, bossConfig);
          const setsToTry = isIwNone
            ? ["none"]
            : [...new Set([sets[0] || ch.recommendedSet, ...(baseSlotSet && sets.includes(baseSlotSet) ? [baseSlotSet] : [])])];
          for (const sKey of setsToTry) {
            const trial = bestBase.team.map((u, i) => (i === slot ? makeUnitSpec(ch, { row: SIM.getSlotRow(slot), set: sKey }, globalProg) : u));
            const sig = teamSignature(trial);
            const prev = distinctBySig.get(sig);
            if (!prev || setsToTry.length > 1) {
              const sim = SIM.simulateBossMatch(trial, bossConfig, globalProg, { deterministic: true, dt: 0.30 });
              recordCandidate(trial, sim);
            }
          }
        }
      }
    }

    if (opts.onProgress) opts.onProgress(80, "Optimisation du Vaisseau & précision finale...");

    // Finalistes + sélection du meilleur Vaisseau + re-simulation exacte dt=0.1s
    const topCandidates = [...distinctBySig.values()]
      .sort((a, b) => b.sim.totalDamage - a.sim.totalDamage)
      .slice(0, Math.max(topN + 2, 10));

    const exactRankings = topCandidates.map(item => {
      let chosenAirshipId = globalProg?.airshipId || "none";
      let workingTeam = item.team.map(u => Object.assign({}, u));
      let hlMeta = { highLinkSlot: -1, highLinkLevel: Number(globalProg?.shinsuLevel || 1914), highLinkHeroName: null, highLinkSummary: null };

      const initialShipId = chosenAirshipId;
      if (hasElevatedSlots) {
        const hlFirst = optimizeHighLinkForTeam(workingTeam, bossConfig, globalProg, highLinkBonus, chosenAirshipId, 0.25);
        workingTeam = hlFirst.team;
        hlMeta = hlFirst;
      }

      if (optimizeAirship) {
        const bestShip = optimizeAirshipForTeam(workingTeam, bossConfig, globalProg, excludedAirships, 0.25);
        if (bestShip) chosenAirshipId = bestShip.airshipId;
        if (hasElevatedSlots && chosenAirshipId !== initialShipId) {
          const hlRefined = optimizeHighLinkForTeam(workingTeam, bossConfig, globalProg, highLinkBonus, chosenAirshipId, 0.25);
          workingTeam = hlRefined.team;
          hlMeta = hlRefined;
        }
      }

      const exactSim = SIM.simulateBossMatch(workingTeam, bossConfig, globalProg, {
        deterministic: true,
        dt: 0.1,
        airshipId: chosenAirshipId
      });
      return {
        team: workingTeam,
        airshipId: chosenAirshipId,
        airshipName: exactSim.airshipName || (DB.AIRSHIPS[chosenAirshipId] || DB.AIRSHIPS.none).name,
        highLinkSlot: hlMeta.highLinkSlot,
        highLinkLevel: hlMeta.highLinkLevel,
        highLinkHeroName: hlMeta.highLinkHeroName,
        highLinkSummary: hlMeta.highLinkSummary,
        sim: exactSim
      };
    });

    exactRankings.sort((a, b) => (b.sim.totalDamage - a.sim.totalDamage) || (b.sim.aliveCount - a.sim.aliveCount));

    const finalTop = exactRankings.slice(0, topN).map((entry, idx) => {
      let marginalImpacts = null;
      if (idx === 0 && !opts.skipMarginal) {
        marginalImpacts = entry.team.map((_, sIdx) => {
          const reduced = entry.team.filter((__, j) => j !== sIdx);
          const rSim = SIM.simulateBossMatch(reduced, bossConfig, globalProg, {
            deterministic: true,
            dt: 0.2,
            airshipId: entry.airshipId
          });
          const lossPct = entry.sim.totalDamage > 0 ? ((entry.sim.totalDamage - rSim.totalDamage) / entry.sim.totalDamage) * 100 : 0;
          return +lossPct.toFixed(1);
        });
      }
      return {
        rank: idx + 1,
        team: entry.team,
        airshipId: entry.airshipId,
        airshipName: entry.airshipName,
        highLinkSlot: entry.highLinkSlot,
        highLinkLevel: entry.highLinkLevel,
        highLinkHeroName: entry.highLinkHeroName,
        highLinkSummary: entry.highLinkSummary,
        sim: entry.sim,
        synergies: collectSynergyBadges(entry.sim),
        marginalImpacts
      };
    });

    if (opts.onProgress) opts.onProgress(100, "Optimisation terminée !");

    return {
      elapsedMs: Date.now() - t0,
      bossId: bossConfig.id,
      bossName: bossConfig.name,
      allowedFactions: bossConfig.allowedFactions,
      eligibleCount: eligible.length,
      evaluatedDistinctCount: distinctBySig.size,
      rankings: finalTop
    };
  }

  /**
   * Optimiseur 2 Équipes Disjointes (10 héros distincts + 2 Vaisseaux distincts)
   * Idéal pour Data Khun Edahn, Boss Raid Rank, Giga Boss, Sanctuaire Diff. 2+
   */
  function findBestMultiTeam(bossConfig, globalProg, options) {
    const t0 = Date.now();
    const opts = options || {};
    const optimizeAirship = opts.optimizeAirship !== false;

    if (opts.onProgress) opts.onProgress(5, "Recherche des meilleures Équipes #1...");
    const t1Res = findBestTeams(bossConfig, globalProg, {
      ...opts,
      topN: 8,
      optimizeAirship,
      skipMarginal: true,
      onProgress: opts.onProgress
        ? (pct, msg) => opts.onProgress(Math.round(pct * 0.45), `[Team 1] ${msg}`)
        : null
    });

    if (!t1Res.rankings || t1Res.rankings.length === 0) {
      return {
        elapsedMs: Date.now() - t0,
        bossId: bossConfig.id,
        bossName: bossConfig.name,
        deckCount: 2,
        pairs: [],
        error: t1Res.error || "Impossible de former Team 1."
      };
    }

    // Sélectionner jusqu'à 4 candidats Team 1 diversifiés (carry principal ou type différent)
    const diverseT1 = [];
    const seenCarry = new Set();
    for (const r of t1Res.rankings) {
      const mainCarry = [...r.sim.units].sort((a, b) => b.totalDamage - a.totalDamage)[0]?.charId;
      if (diverseT1.length === 0 || !seenCarry.has(mainCarry)) {
        diverseT1.push(r);
        seenCarry.add(mainCarry);
      }
      if (diverseT1.length >= 4) break;
    }
    if (diverseT1.length < 3) {
      for (const r of t1Res.rankings) {
        if (!diverseT1.includes(r)) diverseT1.push(r);
        if (diverseT1.length >= 3) break;
      }
    }

    const pairs = [];
    for (let i = 0; i < diverseT1.length; i++) {
      const c1 = diverseT1[i];
      const exclHeroes = new Set(c1.team.map(u => u.charId));
      const exclShips = new Set(c1.airshipId && c1.airshipId !== "none" ? [c1.airshipId] : []);

      const t2Res = findBestTeams(bossConfig, globalProg, {
        ...opts,
        topN: 3,
        excludeIds: exclHeroes,
        excludedAirships: exclShips,
        optimizeAirship,
        skipMarginal: true,
        onProgress: opts.onProgress
          ? (pct, msg) => opts.onProgress(45 + Math.round(((i + pct / 100) / diverseT1.length) * 50), `[Team 2 · branche ${i + 1}/${diverseT1.length}] ${msg}`)
          : null
      });

      if (t2Res.rankings && t2Res.rankings[0]) {
        const c2 = t2Res.rankings[0];
        pairs.push({
          team1: c1,
          team2: c2,
          combinedDamage: c1.sim.totalDamage + c2.sim.totalDamage
        });
      }
    }

    pairs.sort((a, b) => b.combinedDamage - a.combinedDamage);

    // Calcul des impacts marginaux sur la paire #1
    if (pairs[0]) {
      for (const entry of [pairs[0].team1, pairs[0].team2]) {
        entry.marginalImpacts = entry.team.map((_, sIdx) => {
          const reduced = entry.team.filter((__, j) => j !== sIdx);
          const rSim = SIM.simulateBossMatch(reduced, bossConfig, globalProg, {
            deterministic: true,
            dt: 0.2,
            airshipId: entry.airshipId
          });
          const lossPct = entry.sim.totalDamage > 0 ? ((entry.sim.totalDamage - rSim.totalDamage) / entry.sim.totalDamage) * 100 : 0;
          return +lossPct.toFixed(1);
        });
      }
    }

    const rankedPairs = pairs.slice(0, opts.topPairs || 3).map((p, idx) => ({
      rank: idx + 1,
      combinedDamage: p.combinedDamage,
      team1: p.team1,
      team2: p.team2
    }));

    if (opts.onProgress) opts.onProgress(100, "Optimisation 2 Équipes terminée !");

    return {
      elapsedMs: Date.now() - t0,
      bossId: bossConfig.id,
      bossName: bossConfig.name,
      allowedFactions: bossConfig.allowedFactions,
      eligibleCount: t1Res.eligibleCount,
      deckCount: 2,
      pairs: rankedPairs
    };
  }

  const API = {
    makeUnitSpec,
    hasRowAuraDuplicate,
    getEligibleCharacters,
    optimizeAirshipForTeam,
    optimizeHighLinkForTeam,
    findBestTeams,
    findBestMultiTeam
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.TOG_OPT = API;
})(typeof window !== "undefined" ? window : globalThis);
