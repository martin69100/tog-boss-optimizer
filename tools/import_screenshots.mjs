/**
 * Importateur local de screenshots/frames via Windows WinRT OCR (fr-FR)
 * Lecture 100% passive de fichiers image (.png / .jpg / .bmp) — aucune interaction jeu.
 *
 * Usage :
 *   node tools/import_screenshots.mjs <dossier-ou-images...> --profile martin --name "Martin (HorizonFR)"
 *   node tools/import_screenshots.mjs <dossier-ou-images...> [--out data/my-account.json]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildProfilesBundle } from "./build_profiles_bundle.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OCR_PS1 = path.join(__dirname, "ocr_winrt.ps1");

const IW_GRID_ORDER = [
  "celina", "doris", "bergamot", "el",
  "runda", "raihanna", "abgrund", "idea",
  "sundance", "sela", "alocasia", "rafflesia",
  "bari", "mago", "asura", "capelinel"
];

function parseCliArgs(argv) {
  const inputs = [];
  let outPath = null;
  let profileId = null;
  let displayName = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) {
      outPath = path.resolve(argv[++i]);
    } else if (a === "--profile" && argv[i + 1]) {
      profileId = argv[++i].trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    } else if (a === "--name" && argv[i + 1]) {
      displayName = argv[++i].trim();
    } else if (!a.startsWith("-")) {
      inputs.push(a);
    }
  }
  if (!outPath) {
    outPath = profileId
      ? path.join(ROOT_DIR, "data", "profiles", `${profileId}.json`)
      : path.join(ROOT_DIR, "data", "my-account.json");
  }
  return { inputs, outPath, profileId, displayName };
}

function cleanOcrNumber(raw) {
  const s = String(raw || "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/\s+/g, "");
  // Strip commas separating thousands: 20,957 or 1,302
  const noComma = s.replace(/,/g, "");
  return Number(noComma);
}

function parseNivValue(text) {
  const cleaned = String(text || "").replace(/[Oo]/g, "0");
  // Match Niv. 30, Ni". 15, NiV. 16, etc.
  const m = cleaned.match(/Ni[vwV"'.:\-\s]*(\d{1,4})/i);
  if (m) return Number(m[1]);
  // Fallback standalone 0..30 number if nothing else matched
  const nums = cleaned.match(/\b(\d{1,2})\b/g);
  if (nums && nums.length === 1) return Number(nums[0]);
  return null;
}

function parseShinsuLink(doc) {
  const topConcat = `${doc.extras?.shinsuTopRaw || ""} ${doc.extras?.shinsuTopInv || ""} ${doc.fullText || ""}`;
  const slotMatches = [...`${doc.extras?.shinsuTopRaw || ""}\n${doc.extras?.shinsuTopInv || ""}`
    .replace(/[Oo]/g, "0")
    .matchAll(/Niv\.?\s*(\d{3,4})/gi)].map(m => Number(m[1]));

  // Deduplicate keeping top OCR pass priority (raw is more accurate than inv for clean white on blue)
  const rawMatches = [...String(doc.extras?.shinsuTopRaw || "")
    .replace(/[Oo]/g, "0")
    .matchAll(/Niv\.?\s*(\d{3,4})/gi)].map(m => Number(m[1]));

  const slots = (rawMatches.length === 5 ? rawMatches : slotMatches.slice(0, 5))
    .filter(n => n >= 100 && n <= 3500)
    .sort((a, b) => b - a);

  let coreLevel = null;
  const coreStr = `${doc.extras?.shinsuCoreInv || ""} ${doc.fullText || ""}`.replace(/[Oo]/g, "0");
  const coreMatch = coreStr.match(/Niv\.?\s*(\d{1,3})\s*\/\s*\d{1,3}/i);
  if (coreMatch) coreLevel = Number(coreMatch[1]);

  return {
    shinsuSlotLevels: slots.length === 5 ? slots : null,
    shinsuLevel: slots.length === 5 ? Math.min(...slots) : null,
    highLinkBonus: slots.length === 5 ? (Math.max(...slots) - Math.min(...slots)) : null,
    shinsuCoreLevel: coreLevel
  };
}

function parseIwSoul(doc) {
  const grid = doc.extras?.iwSoulGrid;
  if (!Array.isArray(grid) || grid.length < 16) return null;
  const out = {};
  for (const cell of grid) {
    const idx = cell.row * 4 + cell.col;
    const key = IW_GRID_ORDER[idx];
    if (!key) continue;
    // Prefer invText (handles background contrast reliably), fallback rawText
    let val = parseNivValue(cell.invText);
    if (val === null || val < 0 || val > 30) val = parseNivValue(cell.rawText);
    if (val !== null && val >= 0 && val <= 30) {
      out[key] = val;
    }
  }
  return Object.keys(out).length >= 12 ? out : null;
}

function parseTriNumberToken(raw, slotIdx) {
  let norm = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/0\/0|o\/o|%/gi, "%")
    .replace(/\.([Ii])/, ".1")
    .replace(/[Oo]/g, "0");
  // OCR sometimes reads leading '+' before 20,957 or 15,939 as '4' (giving 420,957 or 415,939)
  if (slotIdx === 0 && /^4\d{2},\d{3}$/.test(norm)) {
    norm = norm.slice(1);
  }
  const mPct = norm.match(/(\d+(?:[.,]\d+)?)%/);
  if (mPct) return Number(mPct[1].replace(",", ".")) / 100;
  const mNum = norm.match(/[+]?(\d[\d,.]*)/);
  if (mNum) {
    const val = Number(mNum[1].replace(/,/g, ""));
    if (!Number.isNaN(val)) return val;
  }
  return null;
}

function parseTriEssence(doc) {
  const text = `${doc.fullText || ""} ${doc.raw1x?.fullText || ""}`;
  let fightType = null;
  if (/Tank et Guerrier|avec l'essence FOR/i.test(text)) fightType = "STR";
  else if (/Assassin et Distance|essence de DEX\./i.test(text)) fightType = "DEX";
  else if (/Mage et Soutien|essence d'INT\./i.test(text)) fightType = "INT";
  if (!fightType) return null;

  const statKeys = [
    "health", "accuracy", "haste", "attack", "defense", "dodge",
    "healthRating", "attackRating", "defenseRating"
  ];

  // Collect candidate numeric tokens with normalized full-image Y coordinates
  // from triValuesOcr (fx=0.55, fy=0.32, fh=0.66, scale=3, pad=28), lines (scale=2, pad=24), and raw1x (scale=1, pad=8)
  const candidates = [];
  if (doc.extras?.triValuesOcr?.lines) {
    const cropH = doc.height * 0.66;
    const fy = doc.height * 0.32;
    for (const l of doc.extras.triValuesOcr.lines) {
      if (/Stat|Essence|obtenu|appliqu|Soutien|Guerrier|Assassin/i.test(l.text)) continue;
      if (!/\d/.test(l.text)) continue;
      const yFull = fy + (l.y - 28) / 3;
      candidates.push({ yNorm: yFull / doc.height, text: l.text, prio: 1 });
    }
    void cropH;
  }
  for (const l of (doc.lines || [])) {
    if (l.x > doc.width * 2 * 0.50 && /\d/.test(l.text)) {
      const yFull = (l.y - 24) / 2;
      if (yFull > doc.height * 0.38) candidates.push({ yNorm: yFull / doc.height, text: l.text, prio: 2 });
    }
  }
  for (const l of (doc.raw1x?.lines || [])) {
    if (l.x > doc.width * 0.50 && /\d/.test(l.text)) {
      const yFull = l.y - 8;
      if (yFull > doc.height * 0.38) candidates.push({ yNorm: yFull / doc.height, text: l.text, prio: 3 });
    }
  }

  // Row center Y positions in Tri-Essence panel: row0 ~ 0.445, step ~ 0.0612
  const stats = {};
  for (let i = 0; i < statKeys.length; i++) {
    const expectedY = 0.445 + i * 0.0612;
    const near = candidates
      .filter(c => Math.abs(c.yNorm - expectedY) < 0.025)
      .sort((a, b) => (a.prio - b.prio) || (Math.abs(a.yNorm - expectedY) - Math.abs(b.yNorm - expectedY)));
    for (const cand of near) {
      const val = parseTriNumberToken(cand.text, i);
      if (val !== null) {
        stats[statKeys[i]] = +val.toFixed(4);
        break;
      }
    }
  }
  return { fightType, stats };
}

function parseHangar(doc, existingAirships) {
  const cards = doc.extras?.hangarCards;
  if (!Array.isArray(cards)) return null;
  const out = Object.assign({}, existingAirships || {});
  for (const c of cards) {
    const textAll = `${c.invText || ""} ${c.rawText || ""}`;
    if (/Non\s*obtenu/i.test(textAll)) {
      out[c.id] = { owned: false, level: 0, skillLv: 0 };
      continue;
    }
    let lv = parseNivValue(c.invText);
    if (lv === null) lv = parseNivValue(c.rawText);
    if (lv !== null && lv >= 0 && lv <= 50) {
      const prev = existingAirships?.[c.id];
      const skillLv = c.id === "albatross" || c.id === "epervier"
        ? 5
        : (prev?.skillLv || Math.max(1, Math.min(5, c.greenBars || 1)));
      out[c.id] = { owned: true, level: lv, skillLv };
    }
  }
  return out;
}

function writeAccountProfileJs(accountObj, jsonOutPath) {
  const jsPath = path.join(path.dirname(jsonOutPath), "account-profile.js");
  const js = `// Auto-generated by tools/import_screenshots.mjs\n(function (global) {\n  "use strict";\n  const ACC = ${JSON.stringify(accountObj)};\n  if (typeof module !== "undefined" && module.exports) module.exports = ACC;\n  global.TOG_ACCOUNT = ACC;\n})(typeof window !== "undefined" ? window : globalThis);\n`;
  fs.writeFileSync(jsPath, js, "utf8");
  return jsPath;
}

function main() {
  const { inputs, outPath, profileId, displayName } = parseCliArgs(process.argv.slice(2));
  if (inputs.length === 0) {
    console.error('Usage: node tools/import_screenshots.mjs <dossier-ou-images...> --profile <nom> [--name "Nom affiché"] [--out ...]');
    process.exit(1);
  }

  let account = {
    profileId: profileId || "custom",
    displayName: displayName || profileId || "Compte Importé",
    updatedAt: new Date().toISOString(),
    shinsuLevel: 1600,
    shinsuSlotLevels: [1600, 1600, 1600, 1600, 1600],
    highLinkBonus: 0,
    shinsuCoreLevel: 0,
    excludeCollab: true,
    allianceBuffLv: 10,
    iwSoulLevels: {},
    triEssenceByType: {},
    triEssencePierce: 25,
    triEssenceRes: 35,
    airships: {},
    boxFactionsLoaded: [],
    box: {}
  };

  if (fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
      account = Object.assign(account, prev);
    } catch { }
  }

  const rawOut = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", OCR_PS1, ...inputs],
    { encoding: "utf8", maxBuffer: 25 * 1024 * 1024 }
  );
  const ocrDocsRaw = JSON.parse(rawOut);
  const ocrDocs = Array.isArray(ocrDocsRaw) ? ocrDocsRaw : [ocrDocsRaw];

  const report = [];
  for (const doc of ocrDocs) {
    const fileBase = path.basename(doc.file);
    if (doc.extras?.shinsuTopRaw || /lien de shinsu/i.test(doc.fullText || "")) {
      const sl = parseShinsuLink(doc);
      if (sl.shinsuSlotLevels) {
        account.shinsuSlotLevels = sl.shinsuSlotLevels;
        account.shinsuLevel = sl.shinsuLevel;
        account.highLinkBonus = sl.highLinkBonus;
      }
      if (sl.shinsuCoreLevel !== null) account.shinsuCoreLevel = sl.shinsuCoreLevel;
      report.push({ file: fileBase, type: "shinsu_link", data: sl });
    } else if (doc.extras?.iwSoulGrid) {
      const souls = parseIwSoul(doc);
      if (souls) account.iwSoulLevels = Object.assign({}, account.iwSoulLevels, souls);
      report.push({ file: fileBase, type: "iw_soul", count: souls ? Object.keys(souls).length : 0, data: souls });
    } else if (doc.extras?.hangarCards) {
      const ships = parseHangar(doc, account.airships);
      if (ships) account.airships = ships;
      report.push({ file: fileBase, type: "hangar", count: ships ? Object.keys(ships).length : 0, data: ships });
    } else if (doc.extras?.triValuesOcr || /Stats d.essence|Essence de|Essence d/i.test(doc.fullText || "")) {
      const tri = parseTriEssence(doc);
      if (tri) account.triEssenceByType[tri.fightType] = tri.stats;
      report.push({ file: fileBase, type: "tri_essence", data: tri });
    } else {
      report.push({ file: fileBase, type: "unrecognized_or_box_grid" });
    }
  }

  if (profileId) account.profileId = profileId;
  if (displayName) account.displayName = displayName;
  else if (profileId && !account.displayName) account.displayName = profileId;
  account.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(account, null, 2), "utf8");
  if (profileId === "martin") {
    fs.writeFileSync(path.join(ROOT_DIR, "data", "my-account.json"), JSON.stringify(account, null, 2), "utf8");
  }
  const bundleInfo = buildProfilesBundle(ROOT_DIR);

  console.log("=== OCR IMPORT REPORT ===");
  for (const r of report) {
    console.log(`  - ${r.file} -> ${r.type}`, r.data ? JSON.stringify(r.data) : "");
  }
  console.log(`Saved JSON: ${outPath}`);
  console.log(`Built Web Bundle: ${bundleInfo.outBundlePath} (${bundleInfo.profileIds.join(", ")})`);
}

main();
