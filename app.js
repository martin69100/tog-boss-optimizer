/**
 * Interface Web interactive — ToG: New World Optimiseur Boss
 * 100 % compatible file:// (utilise window.TOG_DB, window.TOG_SIM, window.TOG_OPT)
 */
(function () {
  "use strict";

  const DB = window.TOG_DB;
  const SIM = window.TOG_SIM;
  const OPT = window.TOG_OPT;

  const BOX_STORAGE_KEY = "tog_optimizer_owned_box_v1";
  const PROFILES_CUSTOM_STORAGE_KEY = "tog_optimizer_profiles_v2";
  const ACTIVE_PROFILE_STORAGE_KEY = "tog_optimizer_active_profile_v1";

  let ownedIds = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(BOX_STORAGE_KEY) || "null");
    if (Array.isArray(saved)) ownedIds = new Set(saved);
  } catch (e) {}

  let customProfiles = {};
  try {
    const savedMap = JSON.parse(localStorage.getItem(PROFILES_CUSTOM_STORAGE_KEY) || "null");
    if (savedMap && typeof savedMap === "object") customProfiles = savedMap;
  } catch (e) {}

  const profilesMap = Object.assign(
    {},
    window.TOG_PROFILES || (window.TOG_ACCOUNT ? { [window.TOG_ACCOUNT.profileId || "default"]: window.TOG_ACCOUNT } : {}),
    customProfiles
  );

  let activeProfileId = null;
  try {
    const savedActive = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    if (savedActive && profilesMap[savedActive]) activeProfileId = savedActive;
  } catch (e) {}
  if (!activeProfileId) {
    const defId = window.TOG_DEFAULT_PROFILE_ID;
    activeProfileId = (defId && profilesMap[defId]) ? defId : (Object.keys(profilesMap)[0] || null);
  }
  let loadedAccount = activeProfileId ? profilesMap[activeProfileId] : null;

  let currentBossId = "uc_boss_2";
  let sandboxTeam = [];

  const $ = (id) => document.getElementById(id);

  function populateProfileSelector() {
    const sel = $("selectAccountProfile");
    if (!sel) return;
    sel.innerHTML = "";
    const entries = Object.entries(profilesMap);
    if (entries.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Aucun profil";
      sel.appendChild(opt);
      return;
    }
    for (const [id, prof] of entries) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = prof.displayName || id;
      if (id === activeProfileId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function renderAccountSummary() {
    const el = $("accountSummaryText");
    if (!el) return;
    if (!loadedAccount) {
      el.textContent = "Aucun profil chargé (mode manuel global). Lancez tools/import_screenshots.mjs --profile <nom> ou importez un JSON.";
      return;
    }
    const useIt = $("chkUseAccount")?.checked;
    const label = loadedAccount.displayName || activeProfileId || "Compte";
    const slots = (loadedAccount.shinsuSlotLevels || []).join("/");
    const souls = Object.entries(loadedAccount.iwSoulLevels || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ") || "0";
    const ships = Object.entries(loadedAccount.airships || {}).filter(([, s]) => s.owned && s.level > 0).map(([k, s]) => `${k} ${s.level} (${s.skillLv}/5)`).join(", ");
    el.textContent = `[${label}] ${useIt ? "ACTIF" : "INACTIF"} · Liens ${slots || loadedAccount.shinsuLevel} · Noyau ${loadedAccount.shinsuCoreLevel || 0} · Âmes: ${souls}${ships ? ` · Vaisseaux: ${ships}` : ""}`;
  }

  function applyAccountToForm() {
    if (!loadedAccount) return;
    if ($("progShinsu") && loadedAccount.shinsuLevel) $("progShinsu").value = String(loadedAccount.shinsuLevel);
    if ($("progHighLink") && loadedAccount.highLinkBonus !== undefined) $("progHighLink").value = String(loadedAccount.highLinkBonus);
    if ($("chkExcludeCollab") && loadedAccount.excludeCollab !== undefined) $("chkExcludeCollab").checked = Boolean(loadedAccount.excludeCollab);
    if ($("progAllianceBuffs") && loadedAccount.allianceBuffLv !== undefined) {
      $("progAllianceBuffs").value = String(loadedAccount.allianceBuffLv);
      if ($("allianceBuffVal")) $("allianceBuffVal").textContent = String(loadedAccount.allianceBuffLv);
    }
    renderAccountSummary();
  }

  function fmtDmg(n) {
    if (n >= 1e18) return (n / 1e18).toFixed(3) + " E";
    if (n >= 1e15) return (n / 1e15).toFixed(3) + " P";
    if (n >= 1e12) return (n / 1e12).toFixed(3) + " T (" + Math.round(n / 1e6).toLocaleString("fr-FR") + " M)";
    if (n >= 1e9) return (n / 1e9).toFixed(3) + " G (" + Math.round(n / 1e6).toLocaleString("fr-FR") + " M)";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + " M";
    return Math.round(n).toLocaleString("fr-FR");
  }

  function fmtNum(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + " T";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + " G";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + " M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + " k";
    return String(Math.round(n));
  }

  function getSelectedBoss() {
    return DB.BOSSES.find(b => b.id === currentBossId) || DB.BOSSES[0];
  }

  function getGlobalProg() {
    const useAcc = Boolean($("chkUseAccount")?.checked && loadedAccount);
    return {
      shinsuLevel: Number($("progShinsu").value) || 1914,
      shinsuSlotLevels: useAcc ? (loadedAccount.shinsuSlotLevels || null) : null,
      highLinkBonus: Math.max(0, Number($("progHighLink")?.value || 0)),
      shinsuCoreLevel: useAcc ? Number(loadedAccount.shinsuCoreLevel || 0) : 0,
      iwMode: $("progIwMode")?.value || "soul0",
      iwSoulLevels: useAcc ? (loadedAccount.iwSoulLevels || null) : null,
      defaultLb: Number($("progLb").value) || 21,
      defaultEe: Number($("progEe").value) || 40,
      revTier: Number($("progRev").value) || 6,
      airshipId: $("progAirship").value || "none",
      airships: useAcc ? (loadedAccount.airships || null) : null,
      box: useAcc ? (loadedAccount.box || null) : null,
      boxFactionsLoaded: useAcc ? (loadedAccount.boxFactionsLoaded || null) : null,
      allianceBuffLv: Number($("progAllianceBuffs").value) || 10,
      triEssenceAcc: Number($("progTriAcc").value) || 280,
      triEssencePierce: Number($("progTriPierce").value) || 25,
      triEssenceRes: Number($("progTriRes").value) || 35,
      triEssenceByType: useAcc ? (loadedAccount.triEssenceByType || null) : null
    };
  }

  function initSelectors() {
    $("dbStatsBadge").textContent = `${DB.meta.characterCount} héros · ${DB.meta.bossCount} boss · tog_data_decrypted.db`;

    const bossSelect = $("bossSelect");
    bossSelect.innerHTML = "";
    const byMode = new Map();
    for (const b of DB.BOSSES) {
      if (!byMode.has(b.mode)) byMode.set(b.mode, []);
      byMode.get(b.mode).push(b);
    }
    for (const [mode, list] of byMode.entries()) {
      const og = document.createElement("optgroup");
      og.label = mode;
      for (const b of list) {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = `${b.name}${b.deckCount >= 2 ? ` (${b.deckCount} teams)` : ""}`;
        if (b.id === currentBossId) opt.selected = true;
        og.appendChild(opt);
      }
      bossSelect.appendChild(og);
    }

    const airSel = $("progAirship");
    airSel.innerHTML = "";
    for (const ship of Object.values(DB.AIRSHIPS)) {
      const opt = document.createElement("option");
      opt.value = ship.id;
      opt.textContent = ship.name;
      airSel.appendChild(opt);
    }
  }

  function renderBossInfo() {
    const boss = getSelectedBoss();
    const secs = DB.DAMAGE_GROUPS[boss.damageGroupKey];
    const eligibleAll = DB.CHARACTERS.filter(c => !boss.allowedFactions || boss.allowedFactions.includes(c.faction));

    $("bossDescription").textContent = boss.description;
    const restPill = $("bossRestrictionPill");
    if (boss.allowedFactions) {
      const f = boss.allowedFactions[0];
      restPill.textContent = `${DB.FACTION_LABELS[f] || f} uniquement (${eligibleAll.length} héros)`;
      restPill.className = `pill faction-${f}`;
    } else {
      restPill.textContent = `Toutes factions (${eligibleAll.length} héros)`;
      restPill.className = "pill";
    }

    const elemPill = $("bossElementPill");
    elemPill.textContent = `Boss : ${DB.FACTION_LABELS[boss.bossFaction] || boss.bossFaction} (${boss.bossAttackType})`;
    elemPill.className = `pill faction-${boss.bossFaction}`;

    $("allianceBuffField").style.display = boss.isAllianceWeekly ? "flex" : "none";
    $("optModeSelect").value = (boss.deckCount >= 2) ? "2" : "1";

    const slider = $("palierSlider");
    slider.max = String(secs.length);
    if (Number(slider.value) > secs.length) slider.value = String(Math.min(132, secs.length));
    $("palierMaxLabel").textContent = String(secs.length);

    renderPalierInspector();
    renderBoxDrawer();
  }

  function renderPalierInspector() {
    const boss = getSelectedBoss();
    const secs = DB.DAMAGE_GROUPS[boss.damageGroupKey];
    const pIdx = Math.max(0, Math.min(secs.length - 1, Number($("palierSlider").value) - 1));
    const sec = secs[pIdx];
    const st = SIM.getBossStateFromSection(boss, sec, pIdx, getGlobalProg());

    $("palierLabel").textContent = String(sec.id);
    $("palierLvBadge").textContent = `Boss Lv. ${st.slotLevel}`;

    const items = [
      ["Seuil Dégâts", fmtNum(sec.req)],
      ["DÉF Effective", fmtNum(st.stats.defense)],
      ["ATQ Boss", fmtNum(st.stats.attack)],
      ["Esquive (Dodge)", String(st.stats.dodge)],
      ["Précision Boss", String(st.stats.accuracy)],
      ["Rés. Phys / Mag", `${Math.round(st.stats.physicalResistRating * 100)}% / ${Math.round(st.stats.magicResistRating * 100)}%`],
      ["Rés. Crit / Réd.", `${Math.round(st.stats.critResistRating * 100)}% / ${Math.round(st.stats.critReduceRating * 100)}%`],
      ["Overwhelming", `Nv.${sec.ovw} (-${Math.round(st.stats.overwhelmingResistRating * 100)}%)`],
      ["Rés. Finale", `×${(st.stats.finalResist1Mult * st.stats.finalResist2Mult).toExponential(1)}`]
    ];

    $("palierStatsGrid").innerHTML = items.map(([k, v]) => `<div class="mini-stat"><span>${k}</span><strong>${v}</strong></div>`).join("");
  }

  function renderBoxDrawer() {
    const boss = getSelectedBoss();
    const exclCollab = Boolean($("chkExcludeCollab")?.checked);
    const useAcc = Boolean($("chkUseAccount")?.checked && loadedAccount?.box);
    const boxFactions = loadedAccount?.boxFactionsLoaded || [];
    const eligible = DB.CHARACTERS.filter(c => (!boss.allowedFactions || boss.allowedFactions.includes(c.faction)) && !(exclCollab && c.isCollab));
    $("boxEligibleCount").textContent = String(eligible.length);
    const grid = $("boxHeroGrid");
    grid.innerHTML = "";
    for (const c of eligible) {
      const lbl = document.createElement("label");
      lbl.className = "box-hero-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const accAllows = !useAcc || (boxFactions.length && !boxFactions.includes(c.faction)) || Boolean(loadedAccount.box[c.id]?.owned);
      cb.checked = ownedIds.size > 0 ? ownedIds.has(c.id) : accAllows;
      cb.addEventListener("change", () => {
        if (ownedIds.size === 0) {
          for (const x of DB.CHARACTERS) ownedIds.add(x.id);
        }
        if (cb.checked) ownedIds.add(c.id);
        else ownedIds.delete(c.id);
        localStorage.setItem(BOX_STORAGE_KEY, JSON.stringify([...ownedIds]));
      });
      const txt = document.createElement("span");
      txt.textContent = `${c.name} (${c.rarity})`;
      lbl.appendChild(cb);
      lbl.appendChild(txt);
      grid.appendChild(lbl);
    }
  }

  function buildUnitsHtml(entry) {
    return entry.sim.units.map((u, idx) => {
      const marg = entry.marginalImpacts ? ` · Impact -${entry.marginalImpacts[idx]}%` : "";
      const hlBadge = u.isHighLink ? ` · <strong>HL Lv.${u.shinsuLevel}</strong>` : ` · Lv.${u.shinsuLevel}`;
      const setLabel = u.soulLv > 0 ? `${u.set} (Âme ${u.soulLv})` : u.set;
      return `
        <div class="hero-chip">
          <div class="hero-chip-head">
            <span>${u.name}</span>
            <span class="pill faction-${u.faction}">${u.rarity}</span>
          </div>
          <div class="hero-chip-meta">[${u.row}]${hlBadge} · Set: <strong>${setLabel}</strong> · ${u.alive ? "Survie OK" : `Mort @${u.diedAt}s`}</div>
          <div><strong>${fmtDmg(u.totalDamage)}</strong> (${u.sharePct.toFixed(1)}%${marg})</div>
          <div class="share-bar-bg"><div class="share-bar-fill" style="width:${Math.min(100, u.sharePct).toFixed(1)}%"></div></div>
        </div>
      `;
    }).join("");
  }

  function renderRankings(result) {
    const grid = $("rankingsGrid");
    if (!result.rankings || result.rankings.length === 0) {
      grid.innerHTML = `<p class="muted">${result.error || "Aucune composition trouvée."}</p>`;
      return;
    }

    grid.innerHTML = "";
    for (const entry of result.rankings) {
      const sim = entry.sim;
      const card = document.createElement("div");
      card.className = `rank-card ${entry.rank === 1 ? "rank-1" : ""}`;
      const synHtml = entry.synergies.map(s => `<span class="syn-tag">${s}</span>`).join("");

      card.innerHTML = `
        <div class="rank-top">
          <div class="rank-title">
            <span class="rank-num">#${entry.rank}</span>
            <span class="dmg-big">${fmtDmg(sim.totalDamage)}</span>
            <span class="badge-subtle">Palier ${sim.finalTier} (Boss Lv.${sim.finalBossLevel})</span>
            <span class="badge-subtle">Domination ${sim.teamOverwhelmingLevel ?? 0} vs ${sim.finalBossOverwhelmingLevel ?? 0}</span>
            <span class="badge-subtle">Survie ${sim.aliveCount}/${sim.teamCount}</span>
            <span class="badge-subtle">Dispel ${sim.invincibilityDispelledCount}</span>
            <span class="badge-subtle">Vaisseau : ${entry.airshipName || sim.airshipName}</span>
          </div>
          <button type="button" class="btn-secondary btn-load-sandbox">Inspecter / Simuler</button>
        </div>
        <div class="synergy-row">${synHtml}</div>
        <div class="team-5-row">${buildUnitsHtml(entry)}</div>
      `;

      card.querySelector(".btn-load-sandbox").addEventListener("click", () => {
        sandboxTeam = entry.team.map(u => Object.assign({}, u));
        if (entry.airshipId) $("progAirship").value = entry.airshipId;
        renderSandboxSlots();
        runSandboxSim(entry.airshipId);
        document.getElementById("sandboxSlots").scrollIntoView({ behavior: "smooth", block: "start" });
      });

      grid.appendChild(card);
    }
  }

  function renderMultiRankings(result) {
    const grid = $("rankingsGrid");
    if (!result.pairs || result.pairs.length === 0) {
      grid.innerHTML = `<p class="muted">${result.error || "Aucune paire trouvée."}</p>`;
      return;
    }

    grid.innerHTML = "";
    for (const pair of result.pairs) {
      const card = document.createElement("div");
      card.className = `rank-card ${pair.rank === 1 ? "rank-1" : ""}`;

      const renderSubTeam = (entry, idxLabel) => {
        const s = entry.sim;
        const synHtml = entry.synergies.map(x => `<span class="syn-tag">${x}</span>`).join("");
        return `
          <div class="pair-subcard">
            <div class="pair-subhead">
              <div class="rank-title">
                <span class="rank-num">${idxLabel}</span>
                <strong>${fmtDmg(s.totalDamage)}</strong>
                <span class="badge-subtle">Palier ${s.finalTier} (Lv.${s.finalBossLevel})</span>
                <span class="badge-subtle">Survie ${s.aliveCount}/${s.teamCount}</span>
                <span class="badge-subtle">Vaisseau : ${entry.airshipName || s.airshipName}</span>
              </div>
              <button type="button" class="btn-secondary btn-inspect-${idxLabel === "Équipe 1" ? "1" : "2"}">Inspecter ${idxLabel}</button>
            </div>
            <div class="synergy-row">${synHtml}</div>
            <div class="team-5-row">${buildUnitsHtml(entry)}</div>
          </div>
        `;
      };

      card.innerHTML = `
        <div class="rank-top">
          <div class="rank-title">
            <span class="rank-num">Paire #${pair.rank}</span>
            <span class="dmg-big">Total Combiné : ${fmtDmg(pair.combinedDamage)}</span>
            <span class="badge-subtle">10 Héros distincts + 2 Vaisseaux distincts</span>
          </div>
        </div>
        ${renderSubTeam(pair.team1, "Équipe 1")}
        ${renderSubTeam(pair.team2, "Équipe 2")}
      `;

      card.querySelector(".btn-inspect-1").addEventListener("click", () => {
        sandboxTeam = pair.team1.team.map(u => Object.assign({}, u));
        if (pair.team1.airshipId) $("progAirship").value = pair.team1.airshipId;
        renderSandboxSlots();
        runSandboxSim(pair.team1.airshipId);
        document.getElementById("sandboxSlots").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      card.querySelector(".btn-inspect-2").addEventListener("click", () => {
        sandboxTeam = pair.team2.team.map(u => Object.assign({}, u));
        if (pair.team2.airshipId) $("progAirship").value = pair.team2.airshipId;
        renderSandboxSlots();
        runSandboxSim(pair.team2.airshipId);
        document.getElementById("sandboxSlots").scrollIntoView({ behavior: "smooth", block: "start" });
      });

      grid.appendChild(card);
    }
  }

  function ensureSandboxTeamValid() {
    const boss = getSelectedBoss();
    const eligible = DB.CHARACTERS.filter(c => !boss.allowedFactions || boss.allowedFactions.includes(c.faction));
    const eligibleSet = new Set(eligible.map(c => c.id));
    if (sandboxTeam.length !== 5 || sandboxTeam.some(u => !eligibleSet.has(u.charId))) {
      sandboxTeam = eligible.slice(0, 5).map((c, idx) => OPT.makeUnitSpec(c, { row: SIM.getSlotRow(idx, boss) }));
    }
  }

  function renderSandboxSlots() {
    ensureSandboxTeamValid();
    const boss = getSelectedBoss();
    const eligible = DB.CHARACTERS.filter(c => !boss.allowedFactions || boss.allowedFactions.includes(c.faction));
    const wrap = $("sandboxSlots");
    wrap.innerHTML = "";

    sandboxTeam.forEach((unit, idx) => {
      const box = document.createElement("div");
      box.className = "slot-editor";
      box.innerHTML = `
        <div class="slot-editor-title">
          <span>Slot ${idx + 1} (${SIM.getSlotRow(idx, boss)})</span>
        </div>
        <select class="sel-char"></select>
        <select class="sel-set"></select>
        <select class="sel-slot4"></select>
        <select class="sel-slot5"></select>
      `;

      const selChar = box.querySelector(".sel-char");
      for (const c of eligible) {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = `${c.name} (${c.rarity} ${c.role})`;
        if (c.id === unit.charId) o.selected = true;
        selChar.appendChild(o);
      }
      selChar.addEventListener("change", () => {
        const ch = DB.CHARACTERS.find(x => x.id === selChar.value);
        if (ch) {
          sandboxTeam[idx] = OPT.makeUnitSpec(ch, { row: SIM.getSlotRow(idx, boss) });
          renderSandboxSlots();
          runSandboxSim();
        }
      });

      const selSet = box.querySelector(".sel-set");
      for (const s of Object.values(DB.IGNITION_SETS)) {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name;
        if (s.id === unit.set) o.selected = true;
        selSet.appendChild(o);
      }
      selSet.addEventListener("change", () => {
        sandboxTeam[idx].set = selSet.value;
        runSandboxSim();
      });

      const sel4 = box.querySelector(".sel-slot4");
      for (const s4 of Object.values(DB.SLOT4_MAIN_STATS)) {
        const o = document.createElement("option");
        o.value = s4.id;
        o.textContent = "S4: " + s4.label;
        if (s4.id === unit.slot4) o.selected = true;
        sel4.appendChild(o);
      }
      sel4.addEventListener("change", () => {
        sandboxTeam[idx].slot4 = sel4.value;
        runSandboxSim();
      });

      const sel5 = box.querySelector(".sel-slot5");
      for (const s5 of Object.values(DB.SLOT5_MAIN_STATS)) {
        const o = document.createElement("option");
        o.value = s5.id;
        o.textContent = "S5: " + s5.label;
        if (s5.id === unit.slot5) o.selected = true;
        sel5.appendChild(o);
      }
      sel5.addEventListener("change", () => {
        sandboxTeam[idx].slot5 = sel5.value;
        runSandboxSim();
      });

      wrap.appendChild(box);
    });
  }

  function renderTimelineSvg(timeline) {
    const box = $("timelineChart");
    if (!timeline || timeline.length < 2) {
      box.innerHTML = "";
      return;
    }
    const w = 480, h = 155, pad = 26;
    const maxD = Math.max(1, timeline[timeline.length - 1].totalDamage);
    const pts = timeline.map(p => {
      const x = pad + (p.t / 90) * (w - pad * 2);
      const y = h - pad - (p.totalDamage / maxD) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    box.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
        <polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${pts}" />
        <text x="${pad}" y="14" fill="#93a4bf" font-size="11">Progression des Dégâts (0s → 90s) · Max: ${fmtNum(maxD)}</text>
        <text x="${pad}" y="${h - 6}" fill="#93a4bf" font-size="10">0s</text>
        <text x="${w - pad - 18}" y="${h - 6}" fill="#93a4bf" font-size="10">90s</text>
      </svg>
    `;
  }

  function runSandboxSim(airshipOverride) {
    ensureSandboxTeamValid();
    const boss = getSelectedBoss();
    const sim = SIM.simulateBossMatch(sandboxTeam, boss, getGlobalProg(), {
      deterministic: true,
      dt: 0.1,
      airshipId: airshipOverride || undefined
    });

    $("sandboxSummaryKPIs").innerHTML = `
      <div class="kpi"><span>Dégâts Totaux (90s)</span><strong>${fmtDmg(sim.totalDamage)}</strong></div>
      <div class="kpi"><span>Palier Atteint</span><strong>Palier ${sim.finalTier} (Lv.${sim.finalBossLevel})</strong></div>
      <div class="kpi"><span>Domination</span><strong>${sim.teamOverwhelmingLevel ?? 0} contre ${sim.finalBossOverwhelmingLevel ?? 0}</strong></div>
      <div class="kpi"><span>Survie</span><strong>${sim.aliveCount}/${sim.teamCount}</strong></div>
      <div class="kpi"><span>Vaisseau</span><strong>${sim.airshipName}</strong></div>
    `;

    $("sandboxTableBody").innerHTML = sim.units.map(u => `
      <tr>
        <td><strong>${u.name}</strong>${u.isHighLink ? ` <span class="badge-subtle">HL Lv.${u.shinsuLevel}</span>` : ""}</td>
        <td>${u.row}</td>
        <td>${u.soulLv > 0 ? `${u.set} (Âme ${u.soulLv})` : u.set}</td>
        <td>${fmtDmg(u.totalDamage)}</td>
        <td>${u.sharePct.toFixed(1)}%</td>
        <td>${u.ultimatesCast}</td>
        <td>${u.alive ? "OK" : `Mort @${u.diedAt}s`}</td>
      </tr>
    `).join("");

    const carry = [...sim.units].sort((a, b) => b.totalDamage - a.totalDamage)[0];
    if (carry && carry.avgMults) {
      const m = carry.avgMults;
      $("multDiagnostics").innerHTML = [
        ["Carry Principal", carry.name],
        ["mDef (DÉF Boss)", `×${m.mDef.toFixed(3)}`],
        ["mType (Rés/Pierce)", `×${m.mType.toFixed(3)}`],
        ["mCrit (Critique)", `×${m.mCrit.toFixed(3)}`],
        ["mFaction (Élément)", `×${m.mFaction.toFixed(3)}`],
        ["Précision (Hit%)", `${(m.hitProb * 100).toFixed(1)}%`],
        ["Overwhelming", `×${m.mOverwhelming.toFixed(4)}`],
        ["Rés. Finale", `×${m.mFinal.toExponential(2)}`]
      ].map(([k, v]) => `<div class="mini-stat"><span>${k}</span><strong>${v}</strong></div>`).join("");
    }
    renderTimelineSvg(sim.timeline);
  }

  function runOptimization() {
    const boss = getSelectedBoss();
    const prog = getGlobalProg();
    const modeTeams = Number($("optModeSelect").value) || 1;
    const autoAirship = $("chkAutoAirship").checked;
    const wrap = $("optProgressWrap");
    const bar = $("optProgressBar");
    wrap.classList.remove("hidden");
    bar.style.width = "10%";
    $("optStatusText").textContent = "Optimisation en cours...";

    setTimeout(() => {
      const excludeCollab = Boolean($("chkExcludeCollab")?.checked);
      const eligible = DB.CHARACTERS.filter(c => (!boss.allowedFactions || boss.allowedFactions.includes(c.faction)) && !(excludeCollab && c.isCollab));
      const useBox = ownedIds.size > 0 ? [...ownedIds].filter(id => eligible.some(e => e.id === id)) : null;

      if (modeTeams >= 2) {
        const result = OPT.findBestMultiTeam(boss, prog, {
          topPairs: 3,
          optimizeAirship: autoAirship,
          excludeCollab,
          highLinkBonus: prog.highLinkBonus,
          ownedIds: useBox && useBox.length >= 10 ? useBox : null,
          onProgress: (pct, msg) => {
            bar.style.width = pct + "%";
            $("optStatusText").textContent = msg;
          }
        });
        $("optStatusText").textContent = `Mode 2 Équipes terminé en ${result.elapsedMs} ms (${result.eligibleCount} héros éligibles)`;
        renderMultiRankings(result);
        if (result.pairs && result.pairs[0]) {
          sandboxTeam = result.pairs[0].team1.team.map(u => Object.assign({}, u));
          if (result.pairs[0].team1.airshipId) $("progAirship").value = result.pairs[0].team1.airshipId;
          renderSandboxSlots();
          runSandboxSim(result.pairs[0].team1.airshipId);
        }
      } else {
        const result = OPT.findBestTeams(boss, prog, {
          topN: 10,
          optimizeAirship: autoAirship,
          excludeCollab,
          highLinkBonus: prog.highLinkBonus,
          ownedIds: useBox && useBox.length >= 5 ? useBox : null,
          onProgress: (pct, msg) => {
            bar.style.width = pct + "%";
            $("optStatusText").textContent = msg;
          }
        });
        $("optStatusText").textContent = `${result.evaluatedDistinctCount} compos distinctes évaluées en ${result.elapsedMs} ms (${result.eligibleCount} héros éligibles)`;
        renderRankings(result);
        if (result.rankings && result.rankings[0]) {
          sandboxTeam = result.rankings[0].team.map(u => Object.assign({}, u));
          if (result.rankings[0].airshipId) $("progAirship").value = result.rankings[0].airshipId;
          renderSandboxSlots();
          runSandboxSim(result.rankings[0].airshipId);
        }
      }
    }, 30);
  }

  function bindEvents() {
    $("bossSelect").addEventListener("change", () => {
      currentBossId = $("bossSelect").value;
      renderBossInfo();
      renderSandboxSlots();
      runOptimization();
    });

    $("palierSlider").addEventListener("input", renderPalierInspector);
    $("progAllianceBuffs").addEventListener("input", () => {
      $("allianceBuffVal").textContent = $("progAllianceBuffs").value;
      renderPalierInspector();
    });

    document.querySelectorAll("[data-shinsu]").forEach(btn => {
      btn.addEventListener("click", () => {
        $("progShinsu").value = btn.getAttribute("data-shinsu");
      });
    });

    $("btnToggleBox").addEventListener("click", () => {
      $("boxDrawer").classList.toggle("hidden");
    });
    $("btnBoxAll").addEventListener("click", () => {
      ownedIds = new Set();
      localStorage.removeItem(BOX_STORAGE_KEY);
      renderBoxDrawer();
    });
    $("btnBoxReset").addEventListener("click", () => {
      ownedIds = new Set();
      localStorage.removeItem(BOX_STORAGE_KEY);
      renderBoxDrawer();
    });

    $("btnOptimize").addEventListener("click", runOptimization);
    $("btnRunSandbox").addEventListener("click", () => runSandboxSim());
    if ($("chkExcludeCollab")) {
      $("chkExcludeCollab").addEventListener("change", renderBoxDrawer);
    }
    if ($("chkUseAccount")) {
      $("chkUseAccount").checked = Boolean(loadedAccount);
      $("chkUseAccount").addEventListener("change", () => {
        if ($("chkUseAccount").checked) applyAccountToForm();
        else renderAccountSummary();
        renderBoxDrawer();
        runOptimization();
      });
    }
    if ($("selectAccountProfile")) {
      $("selectAccountProfile").addEventListener("change", () => {
        const id = $("selectAccountProfile").value;
        activeProfileId = id || null;
        loadedAccount = id && profilesMap[id] ? profilesMap[id] : null;
        try {
          if (id) localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
        } catch (e) {}
        if ($("chkUseAccount") && loadedAccount) $("chkUseAccount").checked = true;
        applyAccountToForm();
        renderBoxDrawer();
        runOptimization();
      });
    }
    if ($("inputAccountJson")) {
      $("inputAccountJson").addEventListener("change", (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result || "{}"));
            const rawId = parsed.profileId || file.name.replace(/\.json$/i, "") || "custom";
            const id = String(rawId).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "custom";
            parsed.profileId = id;
            if (!parsed.displayName) parsed.displayName = id;
            profilesMap[id] = parsed;
            customProfiles[id] = parsed;
            localStorage.setItem(PROFILES_CUSTOM_STORAGE_KEY, JSON.stringify(customProfiles));
            activeProfileId = id;
            localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
            loadedAccount = parsed;
            if ($("chkUseAccount")) $("chkUseAccount").checked = true;
            populateProfileSelector();
            applyAccountToForm();
            renderBoxDrawer();
            runOptimization();
          } catch (err) {
            alert("JSON de profil invalide : " + err.message);
          }
        };
        reader.readAsText(file, "utf8");
      });
    }
  }

  initSelectors();
  populateProfileSelector();
  bindEvents();
  if (loadedAccount) applyAccountToForm();
  else renderAccountSummary();
  renderBossInfo();
  renderSandboxSlots();
  runOptimization();
})();
