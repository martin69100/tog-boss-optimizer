/**
 * CLI Runner — Tower of God: New World Boss Team Optimizer
 * Usage :
 *   node tools/run_optimizer.mjs --boss uwb_zygaena_land --shinsu 1914 --top 5
 *   node tools/run_optimizer.mjs --boss brr_data_khun_edahn --shinsu 1914 --teams 2
 *   node tools/run_optimizer.mjs --list-bosses
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DB = require(path.join(ROOT, "data", "db-bundle.js"));
const OPT = require(path.join(ROOT, "engine", "optimizer.js"));

function formatDmg(n) {
  if (n >= 1e18) return (n / 1e18).toFixed(3) + " E";
  if (n >= 1e15) return (n / 1e15).toFixed(3) + " P";
  if (n >= 1e12) return (n / 1e12).toFixed(3) + " T (" + Math.round(n / 1e6).toLocaleString("fr-FR") + " M)";
  if (n >= 1e9) return (n / 1e9).toFixed(3) + " G (" + Math.round(n / 1e6).toLocaleString("fr-FR") + " M)";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + " M";
  return Math.round(n).toLocaleString("fr-FR");
}

function parseArgs(argv) {
  const args = {
    boss: "uwb_zygaena_land",
    shinsu: 1914,
    highLinkBonus: 0,
    iwMode: "soul0",
    excludeCollab: false,
    top: 5,
    teams: null,
    autoAirship: true,
    allianceBuffs: 10,
    lb: 21,
    ee: 40,
    rev: 6,
    airship: "none",
    account: null,
    profile: null,
    listProfiles: false,
    listBosses: false,
    json: false,
    includeLow: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--boss" && argv[i + 1]) args.boss = argv[++i];
    else if (a === "--shinsu" && argv[i + 1]) args.shinsu = Number(argv[++i]);
    else if (a === "--high-link" && argv[i + 1]) args.highLinkBonus = Number(argv[++i]);
    else if (a === "--iw-mode" && argv[i + 1]) args.iwMode = argv[++i];
    else if (a === "--no-collab") args.excludeCollab = true;
    else if (a === "--account" && argv[i + 1]) args.account = argv[++i];
    else if (a === "--profile" && argv[i + 1]) args.profile = argv[++i];
    else if (a === "--list-profiles") args.listProfiles = true;
    else if (a === "--top" && argv[i + 1]) args.top = Number(argv[++i]);
    else if (a === "--teams" && argv[i + 1]) args.teams = Number(argv[++i]);
    else if (a === "--no-auto-airship") args.autoAirship = false;
    else if (a === "--alliance-buffs" && argv[i + 1]) args.allianceBuffs = Number(argv[++i]);
    else if (a === "--lb" && argv[i + 1]) args.lb = Number(argv[++i]);
    else if (a === "--ee" && argv[i + 1]) args.ee = Number(argv[++i]);
    else if (a === "--rev" && argv[i + 1]) args.rev = Number(argv[++i]);
    else if (a === "--airship" && argv[i + 1]) args.airship = argv[++i];
    else if (a === "--list-bosses") args.listBosses = true;
    else if (a === "--json") args.json = true;
    else if (a === "--include-low") args.includeLow = true;
  }
  return args;
}

function printSingleTeam(entry, labelOverride) {
  const s = entry.sim;
  const tag = labelOverride || `#${entry.rank}`;
  const domTag = s.teamOverwhelmingLevel !== undefined ? `  |  Domination ${s.teamOverwhelmingLevel} vs ${s.finalBossOverwhelmingLevel}` : "";
  console.log(`${tag}  DÉGÂTS : ${formatDmg(s.totalDamage)}  |  Palier ${s.finalTier} (Boss Lv.${s.finalBossLevel})${domTag}  |  Survie ${s.aliveCount}/${s.teamCount}  |  Dispel: ${s.invincibilityDispelledCount}`);
  console.log(`    Vaisseau : ${entry.airshipName || s.airshipName || "Aucun"}`);
  if (entry.highLinkSummary || entry.highLinkHeroName) {
    console.log(`    High Link : ${entry.highLinkSummary || `${entry.highLinkHeroName} (Shinsu Lv.${entry.highLinkLevel})`}`);
  }
  if (entry.synergies && entry.synergies.length) {
    console.log(`    Synergies : ${entry.synergies.filter(x => !x.startsWith("Vaisseau :")).join(" · ")}`);
  }
  for (let i = 0; i < s.units.length; i++) {
    const u = s.units[i];
    const marg = entry.marginalImpacts ? ` | Impact -${entry.marginalImpacts[i]}%` : "";
    const status = u.alive ? "OK" : `Mort @${u.diedAt}s`;
    const hlTag = u.isHighLink ? `[HL ${u.shinsuLevel}]` : `[Lv.${u.shinsuLevel}]`;
    const soulTag = u.soulLv > 0 ? `${u.set}(Âme ${u.soulLv})` : u.set;
    console.log(
      `    [${u.row.padEnd(5)}] ${hlTag.padEnd(10)} ${u.name.padEnd(36)} (${u.rarity.padEnd(4)} ${u.faction.padEnd(5)}) | Set: ${soulTag.padEnd(18)} | ${formatDmg(u.totalDamage).padEnd(20)} (${u.sharePct.toFixed(1).padStart(5)}%)${marg} | ${status}`
    );
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.listProfiles) {
  const profilesDir = path.join(ROOT, "data", "profiles");
  console.log("=== PROFILS COMPTE DISPONIBLES (data/profiles/) ===");
  if (fs.existsSync(profilesDir)) {
    const files = fs.readdirSync(profilesDir).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort();
    for (const f of files) {
      const p = JSON.parse(fs.readFileSync(path.join(profilesDir, f), "utf8"));
      const pid = p.profileId || path.basename(f, ".json");
      const slots = Array.isArray(p.shinsuSlotLevels) ? p.shinsuSlotLevels.join("/") : `Lv.${p.shinsuLevel || 0}`;
      const ownedCnt = Object.values(p.box || {}).filter(b => b && b.owned).length;
      const tbCnt = Object.values(p.box || {}).filter(b => b && (b.transBoss || 0) > 0).length;
      console.log(`  ${pid.padEnd(16)} | ${(p.displayName || pid).padEnd(24)} | Liens: ${slots.padEnd(26)} | Noyau ${p.shinsuCoreLevel || 0} | Box: ${ownedCnt} héros (${tbCnt} TransBoss)`);
    }
  }
  process.exit(0);
}

if (args.listBosses) {
  console.log("=== BOSS DISPONIBLES (tog_data_decrypted.db) ===");
  for (const b of DB.BOSSES) {
    const f = b.allowedFactions ? b.allowedFactions.join(",") : "Toutes";
    const secs = DB.DAMAGE_GROUPS[b.damageGroupKey].length;
    console.log(`  ${b.id.padEnd(26)} | ${b.name.padEnd(40)} | Decks: ${b.deckCount || 1} | Factions: ${f.padEnd(8)} | Paliers: ${secs}`);
  }
  process.exit(0);
}

const boss = DB.BOSSES.find(b => b.id === args.boss);
if (!boss) {
  console.error(`Boss introuvable : "${args.boss}". Utilisez --list-bosses.`);
  process.exit(1);
}

let accountData = null;
if (args.profile) {
  const profPath = path.join(ROOT, "data", "profiles", `${args.profile}.json`);
  if (!fs.existsSync(profPath)) {
    console.error(`Profil introuvable : ${profPath}. Utilisez --list-profiles.`);
    process.exit(1);
  }
  accountData = JSON.parse(fs.readFileSync(profPath, "utf8"));
} else if (args.account) {
  const accPath = path.isAbsolute(args.account) ? args.account : path.resolve(process.cwd(), args.account);
  if (!fs.existsSync(accPath)) {
    console.error(`Profil compte introuvable : ${accPath}`);
    process.exit(1);
  }
  accountData = JSON.parse(fs.readFileSync(accPath, "utf8"));
}

const teamCount = args.teams || (boss.deckCount >= 2 ? 2 : 1);
const globalProg = {
  shinsuLevel: accountData?.shinsuLevel ?? args.shinsu,
  shinsuSlotLevels: accountData?.shinsuSlotLevels ?? null,
  highLinkBonus: accountData?.highLinkBonus ?? args.highLinkBonus,
  shinsuCoreLevel: accountData?.shinsuCoreLevel ?? 0,
  iwMode: args.iwMode,
  iwSoulLevels: accountData?.iwSoulLevels ?? null,
  defaultLb: args.lb,
  defaultEe: args.ee,
  revTier: args.rev,
  triEssenceAcc: 280,
  triEssencePierce: accountData?.triEssencePierce ?? 25,
  triEssenceRes: accountData?.triEssenceRes ?? 35,
  triEssenceByType: accountData?.triEssenceByType ?? null,
  airshipId: args.airship,
  airships: accountData?.airships ?? null,
  box: accountData?.box ?? null,
  boxFactionsLoaded: accountData?.boxFactionsLoaded ?? null,
  allianceBuffLv: accountData?.allianceBuffLv ?? args.allianceBuffs
};

const excludeCollab = args.excludeCollab || Boolean(accountData?.excludeCollab);
const allowedLabel = boss.allowedFactions
  ? boss.allowedFactions.map(f => DB.FACTION_LABELS[f] || f).join(", ") + " uniquement"
  : "Toutes factions";

const shinsuSummary = globalProg.shinsuSlotLevels
  ? globalProg.shinsuSlotLevels.join("/")
  : `Lv.${globalProg.shinsuLevel}${globalProg.highLinkBonus > 0 ? ` (+HL ${globalProg.highLinkBonus})` : ""}`;
const activeSouls = globalProg.iwSoulLevels
  ? Object.entries(globalProg.iwSoulLevels).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")
  : "";
const iwLabel = globalProg.iwMode === "none" ? "IW 0 (Aucun IW)" : (activeSouls ? `Âmes [${activeSouls}]` : "Sets +20 (Âme Lv. 0)");
const collabLabel = excludeCollab ? "Exclues" : "Incluses";

if (teamCount >= 2) {
  const result = OPT.findBestMultiTeam(boss, globalProg, {
    topPairs: Math.min(3, args.top),
    optimizeAirship: args.autoAirship,
    excludeCollab,
    highLinkBonus: globalProg.highLinkBonus,
    includeLowRarity: args.includeLow
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  console.log(`================================================================================`);
  console.log(`BOSS : ${boss.name} (${boss.mode}) — MODE 2 ÉQUIPES DISJOINTES`);
  console.log(`Restriction : ${allowedLabel} | Collab : ${collabLabel} | Héros éligibles : ${result.eligibleCount} | Vaisseau Auto : ${args.autoAirship ? "OUI" : "NON"}`);
  console.log(`Progression : Shinsu ${shinsuSummary} | Noyau ${globalProg.shinsuCoreLevel}/7 | ${iwLabel}`);
  console.log(`Calcul terminé en ${result.elapsedMs} ms`);
  console.log(`================================================================================\n`);

  for (const p of result.pairs) {
    console.log(`>>> PAIRE #${p.rank} — DÉGÂTS COMBINÉS : ${formatDmg(p.combinedDamage)} <<<`);
    printSingleTeam(p.team1, `  [ÉQUIPE 1]`);
    console.log("");
    printSingleTeam(p.team2, `  [ÉQUIPE 2]`);
    console.log(`--------------------------------------------------------------------------------\n`);
  }
} else {
  const result = OPT.findBestTeams(boss, globalProg, {
    topN: args.top,
    optimizeAirship: args.autoAirship,
    excludeCollab,
    highLinkBonus: globalProg.highLinkBonus,
    includeLowRarity: args.includeLow
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  console.log(`================================================================================`);
  console.log(`BOSS : ${boss.name} (${boss.mode})`);
  console.log(`Restriction : ${allowedLabel} | Collab : ${collabLabel} | Héros éligibles : ${result.eligibleCount} | Vaisseau Auto : ${args.autoAirship ? "OUI" : "NON"}`);
  if (accountData) {
    console.log(`Compte : ${shinsuSummary} | Noyau ${globalProg.shinsuCoreLevel}/7 | ${iwLabel} | Buffs Alliance ${globalProg.allianceBuffLv}/10`);
  } else {
    console.log(`Progression : Shinsu Lv.${globalProg.shinsuLevel} | High Link : ${globalProg.highLinkBonus > 0 ? `+${globalProg.highLinkBonus}` : "Aucun"} | ${iwLabel} | LB ${args.lb} | EE +${args.ee} | Rév.${args.rev} | Buffs Alliance ${globalProg.allianceBuffLv}/10`);
  }
  console.log(`Calcul : ${result.evaluatedDistinctCount} compos distinctes évaluées en ${result.elapsedMs} ms`);
  console.log(`================================================================================\n`);

  for (const entry of result.rankings) {
    printSingleTeam(entry);
    console.log("");
  }
}
