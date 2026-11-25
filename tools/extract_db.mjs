/**
 * Extracteur ETL lecture-seule (100 % officiel DB) :
 *   - data/tog_data_decrypted.db
 *   - data/hero-kits.json
 * Génère : data/db-bundle.js (UMD / global window.TOG_DB, 100 % compatible file:// et Node.js)
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function resolveFirstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates.find(Boolean);
}

const DB_PATH = resolveFirstExisting([
  process.env.TOG_DB_PATH,
  path.join(ROOT_DIR, "data", "tog_data_decrypted.db"),
  "C:\\Users\\marti\\Desktop\\tognw-decrypt-db\\tog_data_decrypted.db"
]);
const HERO_KITS_PATH = path.join(ROOT_DIR, "data", "hero-kits.json");
const OUT_PATH = path.join(ROOT_DIR, "data", "db-bundle.js");

const FACTION_ID_TO_KEY = {
  1: "Light",
  2: "Dark",
  3: "Fire",
  4: "Water",
  5: "Land",
  99: "Neutral"
};

const FACTION_LABELS = {
  Light: "Jaune (Lumière)",
  Dark: "Violet (Ténèbres)",
  Fire: "Rouge (Feu)",
  Water: "Bleu (Eau)",
  Land: "Vert (Terre)",
  Neutral: "Neutre"
};

const ROLE_ID_TO_NAME = {
  4001: "Tank",
  4002: "Warrior",
  4003: "Assassin",
  4004: "Ranged",
  4005: "Mage",
  4006: "Support"
};

const RARITY_FROM_DB = (rb, sub) => {
  if (rb === 5) return "EX";
  if (rb === 4) return sub === 401 ? "XSR+" : "SSR+";
  if (rb === 3) return "SSR";
  if (rb === 2) return "SR";
  return "R";
};

function normStr(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function loadHeroKits() {
  if (!fs.existsSync(HERO_KITS_PATH)) {
    throw new Error(`Fichier manquant : ${HERO_KITS_PATH}`);
  }
  return JSON.parse(fs.readFileSync(HERO_KITS_PATH, "utf8"));
}

// Héros issus de collaborations limitées (indisponibles hors événement collab)
const COLLAB_CHAR_IDS = new Set([
  "24",  // [Seven Knights] Rachel
  "25",  // [Seven Knights] Yeonhee
  "26",  // [Seven Knights] Shane
  "30",  // [Seven Deadly Sins] Meliodas
  "31",  // [Seven Deadly Sins] Elizabeth
  "32",  // [Seven Deadly Sins] Escanor
  "35",  // [Hololive] Mori Calliope
  "36",  // [Hololive] Tokoyami Towa
  "608", // [Teenage Mercenary] Ijin Yu
  "609", // [Teenage Mercenary] Alice
  "610", // [Teenage Mercenary] 002
  "611"  // [Teenage Mercenary] 003
]);

/**
 * Kits audités pour les héros Verts (Land) à fort impact Boss (tog_data_decrypted.db)
 */
const GREEN_KIT_OVERRIDES = {
  "52": {
    // [Chef de Famille] Yirang Yeon (EX, Mage, PHYSICAL)
    removesInvincibility: true,
    destroysBarrier: true,
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Flamme Écarlate", attackRate: 1.0, hits: 1, interval: 1.12, epGain: 50 },
      active1: {
        name: "Flame That Saves All",
        attackRate: 0,
        hits: 0,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        teamHealMaxHpRatio: 1.00,
        teamCleanse: true,
        selfLifeFlameGain: 1
      },
      active2: {
        name: "Flame That Burns All",
        attackRate: 20.0,
        hits: 5,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        perfectAccuracy: true,
        removesInvincibility: true,
        destroysBarrier: true,
        enemyEnergyDrain: 400, // Rev4: Steal 80 Energy x 5 hits
        bossDebuff: { duration: 12.0, stats: { defenseRating: -0.80, physicalResistRating: -0.80, dodgePctShred: 0.80 } }
      },
      ultimate: {
        name: "Master of Flames",
        attackRate: 58.0, // 5 * (1000% + 160% boss bonus)
        hits: 5,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfInvincibleDuration: 6.0,
        resetActiveCooldownsOnUlt: true // Rev7
      },
      passive: {
        name: "Eternal Flame",
        permanentStatusImmune: true,
        permanentSelf: { attackRating: 8.0 },
        infiniteStackingBurn: { startRate: 5.6, incPerSkillCast: 4.0, interval: 1.0, eeDrainPerSec: 50 },
        bossDebuff: { haste: -50 },
        lifeFlamesStart: 3, // Rev5 + EE4 2s invuln
        lifeFlameInvuln: 2.0,
        lifeFlameHealRatio: 0.80
      }
    }
  },
  "636": {
    // [Golden Carp] Ju (SSR, Ranged, MAGIC)
    recommendedSet: "el",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Tir d'Eau", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Exit With a Pop",
        attackRate: 2.5,
        hits: 1,
        cooldown: 11.0,
        castTime: 0.7,
        epGain: 100,
        selfInvincibleDuration: 2.0,
        selfConcealDuration: 10.0,
        selfEnergyGain: 300, // EE4
        selfEnergyPerSec: { duration: 10.0, amount: 50 }
      },
      active2: {
        name: "Bang Bang",
        attackRate: 2.5,
        hits: 1,
        cooldown: 10.0,
        castTime: 0.7,
        epGain: 100,
        selfBuff: { duration: 10.0, stats: { attackHaste: 40, normalBonusAtkRate: 2.0 } }
      },
      ultimate: {
        name: "Special Move! Carp Drone Trio",
        attackRate: 6.0,
        hits: 1,
        castTime: 1.1,
        epCost: 1000,
        perfectAccuracy: true,
        selfBuff: { duration: 15.0, stats: { attackHaste: 60, normalPierceRating: 0.40 } },
        spawnsTempSummon: { key: "carp_drones", duration: 15.0, interval: 0.75, attackRate: 1.2, count: 3 }
      },
      passive: {
        name: "Golden Carp Branch Head",
        carpMarkSystem: {
          procAttackRate: 3.0,
          duration: 10.0,
          maxStacks: 16,
          greenResShredPerStack: 0.05, // -80% Green Element Res at 16 stacks!
          greenAtkBuffPerStack: 0.10    // +160% ATK to all Green allies at 16 stacks!
        }
      }
    }
  },
  "24": {
    // [Phoenix Incarnate] Rachel (SSR+, Ranged, MAGIC)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Tir Phénix", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Flames of Regeneration",
        attackRate: 2.5,
        hits: 1,
        cooldown: 9.0,
        castTime: 0.75,
        epGain: 100,
        teamHot: { duration: 8.0, interval: 1.0, atkRate: 2.0 },
        selfBuff: { duration: 8.0, stats: { finalResistRating: 0.30 } }
      },
      active2: {
        name: "Barrage",
        attackRate: 11.2, // 160 + 320 + 640
        hits: 3,
        cooldown: 9.5,
        castTime: 0.85,
        epGain: 100,
        selfBuff: { duration: 10.0, stats: { critRating: 0.40 } }
      },
      ultimate: {
        name: "Wings of Flame",
        attackRate: 20.0, // 800 + 200 + 1000 Phoenix Blaze cap
        hits: 3,
        castTime: 1.2,
        epCost: 1000,
        guaranteedCrit: true,
        perfectAccuracy: true
      },
      passive: {
        name: "Crystal of Immortality",
        permanentSelf: { critRating: 0.40, critBonusRating: 0.30 },
        greenCrystalDebuff: {
          maxStacks: 6,
          greenResShredPerStack: 0.10, // -60% Green Element Res
          duration: 15.0
        },
        phoenixBlazeRate: 2.5
      }
    }
  },
  "605": {
    // [Chef de Famille] Traumerei (EX, Support, MAGIC)
    destroysBarrier: true,
    recommendedSet: "doris",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Onde Anima", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Gaze",
        attackRate: 2.5,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        bossDebuff: { duration: 10.0, stats: { physicalResistRating: -0.20, magicResistRating: -0.20, haste: -100 } },
        teamBuff: { duration: 10.0, stats: { physicalResistRating: 0.30, magicResistRating: 0.30 } }
      },
      active2: {
        name: "Ruler of All Things",
        attackRate: 2.5,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        selfInvincibleDuration: 4.0,
        teamHot: { duration: 10.0, interval: 1.0, atkRate: 4.0 },
        teamBuff: { duration: 8.0, stats: { attackRating: 0.80, defenseRating: 0.80 } }
      },
      ultimate: {
        name: "Unleash: All Creatures",
        attackRate: 24.0,
        hits: 12,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        destroysBarrier: true,
        allyPermanentStackBuff: { key: "traumerei_rev6_mp", maxStacks: 5, stats: { magicPierceRating: 0.30 } }
      },
      passive: {
        name: "Lo Po Bia Family Head",
        spawnsPermanentSummon: { key: "kraken_cobalt", interval: 2.0, attackRate: 4.8, bossEnergyDrainPer3s: 120, damageSoakRatio: 0.60 }
      }
    }
  },
  "643": {
    // [Serpent Master's Offspring] Lilial (SSR+, Warrior, MAGIC)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Crocs de Vipère", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Relentless Pursuer",
        attackRate: 6.0,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        enemyEnergyDrain: 200,
        bossDebuff: { duration: 8.0, stats: { haste: -40 } }
      },
      active2: {
        name: "Fangs of the Myriad Serpent",
        attackRate: 18.0,
        hits: 3,
        cooldown: 9.5,
        castTime: 0.8,
        epGain: 100,
        bossDebuff: { duration: 8.0, stats: { defenseRating: -0.80, physicalResistRating: -0.40, magicResistRating: -0.40 } }
      },
      ultimate: {
        name: "Venom Burst",
        attackRate: 30.0,
        hits: 5,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfBarrierMaxHpRatio: 2.0,
        selfCdReduceOnUlt: 6.0
      },
      passive: {
        name: "Ten Thousand Venoms Immunity",
        damageTakenCapMaxHp: 0.03,
        perfectAccuracyAlways: true,
        infiniteStackingPoison: { duration: 10.0, ratePerStack: 1.0, interval: 1.0 }
      }
    }
  },
  "629": {
    // [Enigmatic] Princess of Zahard (SSR+, Warrior, PHYSICAL)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Lame d'Aiguille", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Possession: Rotala Red",
        attackRate: 4.0,
        hits: 1,
        cooldown: 8.0,
        castTime: 0.7,
        epGain: 100,
        dot: { duration: 8.0, interval: 1.0, rate: 1.0, damageType: "NORMAL" },
        selfStackBuff: { key: "blood_fairy", duration: 15.0, maxStacks: 5, stats: { physicalPierceRating: 0.27 } }
      },
      active2: {
        name: "Possession: Fairy of the Sixteenth Lake",
        attackRate: 15.0,
        hits: 5,
        cooldown: 9.0,
        castTime: 0.8,
        epGain: 100,
        selfStackBuff: { key: "azure_fairy", duration: 15.0, maxStacks: 5, stats: { haste: 20 } }
      },
      ultimate: {
        name: "Possession: Argen Glacier",
        attackRate: 22.0,
        hits: 6,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfInvincibleDuration: 3.0,
        bossDebuff: { duration: 10.0, stats: { physicalResistRating: -0.60 } },
        extraHitsOverDuration: { duration: 15.0, interval: 1.5, attackRate: 1.5 }
      },
      passive: {
        name: "Empty One",
        possessionSystem: {
          maxStacks: 10,
          atkPerStack: 0.80,
          cdReduceAtMax: 1.5,
          defIgnoreAtMax: 0.40,
          critAtMax: 0.30,
          accPctAtMax: 0.25,
          skillBonusPerBuff: 0.50,
          skillBonusCap: 15.0
        },
        selfEvadeAfterSkill: 2.0
      }
    }
  },
  "33": {
    // [Healing Flame] Yihwa Yeon (SSR+, Support, MAGIC)
    removesInvincibility: true,
    recommendedSet: "runda",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Étincelle", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Protection Flame",
        attackRate: 3.0,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        teamHot: { duration: 6.0, interval: 1.0, maxHpRatio: 0.025 },
        teamBuff: { duration: 6.0, stats: { defenseRating: 0.80 } }
      },
      active2: {
        name: "Enhancing Flame",
        attackRate: 2.5,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        lowestAllyHealMaxHp: 1.00,
        lowestHpAllyBuff: { duration: 15.0, stats: { defenseRating: 0.90 } },
        highestHpPctAllyBuff: { duration: 15.0, statusImmune: true, stats: { attackRating: 1.00 } }
      },
      ultimate: {
        name: "Surging Flame",
        attackRate: 6.0,
        hits: 1,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        removesInvincibility: true,
        enemyEnergyDrain: 450,
        teamHealAtkRate: 10.0,
        teamHot: { duration: 6.0, interval: 1.0, maxHpRatio: 0.025 },
        teamBuff: { duration: 6.0, stats: { defenseRating: 0.80 } }
      },
      passive: {
        name: "Life Flame",
        allyLifeFlamesStart: 2,
        allyLifeFlameInterval: 20.0,
        allyLifeFlameHealMaxHp: 0.40,
        allyLifeFlameInvuln: 2.0,
        selfReviveInvuln: 4.0
      }
    }
  },
  "125": {
    // [Proud Waves] Lozeal (SSR, Support, MAGIC)
    recommendedSet: "capelinel",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Vague Douce", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Shinsu Snare",
        attackRate: 6.2,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        bossDebuff: { duration: 8.0, stats: { defenseRating: -0.40 } }
      },
      active2: {
        name: "Healing Shinsu",
        attackRate: 2.5,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        teamHealAtkRate: 6.0,
        teamCleanse: true,
        lowestHpAllyBuff: { count: 2, duration: 7.0, onlyFaction: "Land", stats: { defenseRating: 0.80 } }
      },
      ultimate: {
        name: "Whirlpool",
        attackRate: 6.0,
        hits: 1,
        castTime: 1.15,
        epCost: 1000,
        perfectAccuracy: true,
        teamCleanse: true,
        teamHot: { duration: 13.0, interval: 1.0, atkRate: 3.0 }
      },
      passive: {
        name: "Shinsu Blessing",
        factionAlliesBuff: { faction: "Land", stats: { attackRating: 0.80 } } // Rev4: +80% ATK to Green allies
      }
    }
  },
  "12": {
    // [Regular] Lero Ro (SSR, Support, MAGIC)
    recommendedSet: "runda",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Éclair", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Lightning Zone",
        attackRate: 3.2,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 150, // EE1 +50 energy
        dot: { duration: 6.0, interval: 1.0, rate: 3.2, damageType: "NORMAL" }
      },
      active2: {
        name: "Lightning Beast",
        attackRate: 2.5,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        teamBuff: { duration: 8.0, stats: { normalIncreaseRating: 1.20 } }
      },
      ultimate: {
        name: "Shinsu Barrier",
        attackRate: 6.0,
        hits: 1,
        castTime: 1.15,
        epCost: 1000,
        perfectAccuracy: true,
        teamShieldAtkRate: 8.0,
        teamBuff: { duration: 6.0, stats: { defenseRating: 2.00 } },
        lowestHpAllyBuff: { duration: 6.0, excludeSelf: true, alsoApplyToSelf: true, stats: { attackRating: 0.80, defenseRating: 0.80 } }
      },
      passive: {
        name: "Shinsu Amplification",
        permanentAllies: { magicPierceRating: 0.32 }, // Base 16% + Rev5 16%
        periodicAlliesStackBuff: { interval: 5.0, maxStacks: 4, stats: { magicPierceRating: 0.12 } } // +48% -> +80% total Magic Pierce!
      }
    }
  },
  "423": {
    // [Silence of Rose] Sachi (SSR+, Mage, MAGIC)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Ronce Sanglante", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 },
      active1: {
        name: "Vine Bind",
        attackRate: 18.0,
        hits: 3,
        cooldown: 4.5, // EE3+EE4 greatly reduced CD
        castTime: 0.75,
        epGain: 100,
        bossStackDebuff: { key: "sachi_def", duration: 10.0, maxStacks: 3, defShredPerStack: 0.50 }
      },
      active2: {
        name: "Thorn Vine Path",
        attackRate: 4.0,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        teamBuff: { duration: 10.0, stats: { haste: 20 } }
      },
      ultimate: {
        name: "Silence of Rose",
        attackRate: 48.0,
        hits: 3,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        enemyEnergyDrain: 300,
        dot: { duration: 12.0, interval: 1.0, rate: 8.0, damageType: "NORMAL" },
        bossDebuff: { duration: 12.0, stats: { haste: -60 } }
      },
      passive: {
        name: "Spell",
        periodicSelfStackBuff: { interval: 8.0, maxStacks: 6, stats: { attackRating: 1.00 } },
        periodicSelfHitBarrier: { cooldown: 10.0, hits: 8 },
        bossDebuff: { debuffDodge: -150 }
      }
    }
  },
  "622": {
    // [Field Commander] Robadon (SSR+, Tank, PHYSICAL)
    recommendedSet: "runda",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Poing Sylvestre", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Gran Abuelo - Return",
        attackRate: 2.5,
        hits: 1,
        cooldown: 7.5,
        castTime: 0.7,
        epGain: 100,
        enemyEnergyDrain: 200
      },
      active2: {
        name: "Gran Abuelo - Initiation",
        attackRate: 15.0,
        hits: 3,
        cooldown: 9.5,
        castTime: 0.8,
        epGain: 100,
        enemyEnergyDrain: 200,
        bossDebuff: { duration: 10.0, stats: { haste: -40 } }
      },
      ultimate: {
        name: "Primal Punch",
        attackRate: 36.0,
        hits: 2,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        teamInvincibleDuration: 8.0, // Guardian Branch dmg-to-1 area 8s
        teamHot: { duration: 8.0, interval: 1.0, atkRate: 4.0 }
      },
      passive: {
        name: "Essence of Flora",
        permanentStatusImmune: true,
        allyLifeFlamesStart: 4,
        allyLifeFlameHealMaxHp: 0.25,
        allyLifeFlameInvuln: 3.0,
        immortalWhileGreenAllyAlive: true
      }
    }
  },
  "3000": {
    // [Adventurer] Zahard (XSR+, Warrior, PHYSICAL)
    destroysBarrier: true,
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Aiguille Dorée", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Black-Hole Sphere",
        attackRate: 5.5,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        selfBuff: { duration: 8.0, stats: { magicResistRating: 0.40, physicalResistRating: 0.40 } }
      },
      active2: {
        name: "Golden Needle",
        attackRate: 6.0,
        hits: 3,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        selfBuff: { duration: 8.0, stats: { dodge: 200 } },
        bossStackDebuff: { key: "zahard_eva", duration: 12.0, maxStacks: 10, dodgePctShredPerStack: 0.05 } // -50% EVA
      },
      ultimate: {
        name: "Lecalicus / Coelacanth",
        attackRate: 12.0,
        hits: 3,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        destroysBarrier: true,
        bossDebuff: { duration: 10.0, stats: { defenseRating: -0.30 } }
      },
      passive: {
        name: "Needle of War",
        greenAlliesCdReduceOnTransform: 8.0,
        destroysBarrier: true
      }
    }
  },
  "259": {
    // [Data] Zahard (SSR+, Warrior, PHYSICAL)
    destroysBarrier: true,
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Lecalicus", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Black-Hole Sphere",
        attackRate: 6.0,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        selfBuff: { duration: 10.0, stats: { magicResistRating: 0.40, physicalResistRating: 0.40 } }
      },
      active2: {
        name: "Golden Needle",
        attackRate: 6.0,
        hits: 3,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        guaranteedCrit: true,
        selfBuff: { duration: 10.0, stats: { dodge: 200 } }
      },
      ultimate: {
        name: "Coelacanth / Leviathan",
        attackRate: 14.0,
        hits: 3,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        destroysBarrier: true,
        bossDebuff: { duration: 10.0, stats: { defenseRating: -0.30 } }
      },
      passive: {
        name: "Needle of War",
        permanentSelf: { attackRating: 1.60 }, // Rev4 conversion from MagRes
        destroysBarrier: true
      }
    }
  },
  "633": {
    // [Chimera] Rashut (SSR+, Mage, MAGIC)
    recommendedSet: "mago",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Griffe Chimérique", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 },
      active1: {
        name: "Scarlet Storm",
        attackRate: 32.0,
        hits: 4,
        cooldown: 9.0,
        castTime: 0.8,
        epGain: 100
      },
      active2: {
        name: "Crimson Burst",
        attackRate: 48.0,
        hits: 4,
        cooldown: 10.0,
        castTime: 0.85,
        epGain: 100,
        enemyEnergyDrain: 800,
        selfHitBarrier: 6
      },
      ultimate: {
        name: "Blood Wing",
        attackRate: 64.0,
        hits: 4,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfUntargetableDuration: 8.0,
        selfBuff: { duration: 8.0, stats: { accuracy: 300, magicPierceRating: 0.40 } },
        dot: { duration: 8.0, interval: 1.0, rate: 8.0, damageType: "NORMAL" },
        resetActive2OnCast: true
      },
      passive: {
        name: "Bloody Chain",
        permanentSelf: { lifeLeechRating: 1.00 },
        dot: { duration: 90.0, interval: 1.0, rate: 6.0, damageType: "NORMAL", eeDrainPerSec: 200 },
        periodicSelfStackBuff: { interval: 1.5, maxStacks: 20, stats: { attackRating: 0.40 } } // up to +800% ATK!
      }
    }
  },
  "617": {
    // [Capricious Tactician] Yasratcha (SSR+, Assassin, MAGIC)
    recommendedSet: "mago",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Griffes Félines", attackRate: 1.0, hits: 1, interval: 1.0, epGain: 50 },
      active1: {
        name: "Purple Flash Strike",
        attackRate: 17.0,
        hits: 5,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        enemyEnergyDrain: 600
      },
      active2: {
        name: "Daze",
        attackRate: 12.0,
        hits: 4,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 600, // +500 self energy
        selfBuff: { duration: 12.0, stats: { magicPierceRating: 0.40 } }
      },
      ultimate: {
        name: "Purple Dragon Strike",
        attackRate: 26.0, // 1600% + 5*200% Laceration
        hits: 2,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfInvincibleDuration: 3.0
      },
      passive: {
        name: "Feline Sight",
        permanentSelf: { ultimatePierceRating: 0.40 }, // 1 stack EE4 sur boss unique
        bossDebuff: { magicResistRating: -1.00 } // 5 stacks x -20% irremovable!
      }
    }
  },
  "102": {
    // [Punisher] Ren (SSR+, Mage, MAGIC)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Fouet d'Anima", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 },
      active1: {
        name: "Summon Eel",
        attackRate: 28.0, // 3*800% + Bull 400%
        hits: 4,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100
      },
      active2: {
        name: "Lick",
        attackRate: 2.5,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 340
      },
      ultimate: {
        name: "Excitement",
        attackRate: 22.0, // 1200% + Bull 5*200%
        hits: 6,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfInvincibleDuration: 2.5,
        resIgnore: 0.60,
        bossDebuff: { duration: 10.0, stats: { magicResistRating: -0.40 } }
      },
      passive: {
        name: "Summon Minotaur",
        permanentSelf: { physicalResistRating: 0.40, magicResistRating: 0.40 },
        spawnsPermanentSummon: { key: "ren_bull", interval: 1.2, attackRate: 2.4 }
      }
    }
  },
  "26": {
    // [Infernal Blademaster] Shane (SSR, Warrior, MAGIC)
    recommendedSet: "sundance",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Lame Démoniaque", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: {
        name: "Demon Slaying Arts",
        attackRate: 9.6,
        hits: 6,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        bossStackDebuff: { key: "shane_critres", duration: 8.0, maxStacks: 6, stats: { critResistRating: -0.08 } }
      },
      active2: {
        name: "Soul Slash",
        attackRate: 6.0,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100
      },
      ultimate: {
        name: "Demonic Awakening",
        attackRate: 12.0,
        hits: 6,
        castTime: 1.15,
        epCost: 1000,
        perfectAccuracy: true
      },
      passive: {
        name: "Crystal of Soul Absorption",
        permanentSelf: { critRating: 0.38, attackRating: 0.90 },
        greenCrystalDebuff: {
          maxStacks: 6,
          greenResShredPerStack: 0.10, // -60% Green Element Res
          duration: 15.0
        }
      }
    }
  },
  "25": {
    // [Doomsday Herald] Yeonhee (SSR, Support, MAGIC)
    recommendedSet: "capelinel",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Éclat de Cristal", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Access Denied",
        attackRate: 8.0,
        hits: 10,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100
      },
      active2: {
        name: "Dream Call",
        attackRate: 1.6,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100
      },
      ultimate: {
        name: "Calamity Call",
        attackRate: 6.0,
        hits: 1,
        castTime: 1.15,
        epCost: 1000,
        perfectAccuracy: true,
        bossDebuff: { duration: 10.0, stats: { magicResistRating: -0.40 } }
      },
      passive: {
        name: "Lucid Dreaming Crystal",
        permanentSelf: { startEnergy: 300 },
        greenCrystalDebuff: {
          maxStacks: 6,
          greenResShredPerStack: 0.10, // -60% Green Element Res
          duration: 15.0
        }
      }
    }
  },
  "34": {
    // [Shinsu of the Heart] Endorsi (SSR, Tank, MAGIC)
    recommendedSet: "runda",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Coup de Coeur", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 50 },
      active1: {
        name: "Heart Dart",
        attackRate: 12.0,
        hits: 3,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 100,
        bossDebuff: { duration: 10.0, stats: { defenseRating: -0.50, magicResistRating: -0.20 } }
      },
      active2: {
        name: "Heart Zone",
        attackRate: 2.0,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 100,
        dot: { duration: 11.0, interval: 1.0, rate: 2.0, damageType: "NORMAL" }
      },
      ultimate: {
        name: "Surfing Heart",
        attackRate: 12.0,
        hits: 1,
        castTime: 1.15,
        epCost: 1000,
        perfectAccuracy: true,
        selfBuff: { duration: 10.0, stats: { healthRating: 2.00, defenseRating: 1.20 } }
      },
      passive: {
        name: "Jewel Heart",
        permanentSelf: { defenseRating: 3.60 } // 90% x 4 Green allies
      }
    }
  },
  "627": {
    // [Corrupted Time] Aria (SSR+, Warrior, PHYSICAL)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Coup Temporel", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 50 },
      active1: { name: "Chrono Strike", attackRate: 60.0, hits: 6, cooldown: 9.5, castTime: 0.8, epGain: 100 },
      active2: { name: "Time Distortion", attackRate: 8.0, hits: 1, cooldown: 9.0, castTime: 0.75, epGain: 100, enemyEnergyDrain: 200 },
      ultimate: { name: "Spell of Time", attackRate: 50.0, hits: 10, castTime: 1.2, epCost: 1000, perfectAccuracy: true },
      passive: { name: "Broken Clock", permanentSelf: { attackRating: 0.80, haste: 25 } }
    }
  },
  "404": {
    // [Essence of Nothingness] Kallavan (SSR+, Tank, PHYSICAL)
    recommendedSet: "raihanna",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Poing Vide", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 },
      active1: { name: "Rush Bomber", attackRate: 18.5, hits: 5, cooldown: 7.5, castTime: 0.75, epGain: 100, selfBuff: { duration: 10.0, stats: { defenseRating: 0.80 } } },
      active2: { name: "Manifested Resolve", attackRate: 8.0, hits: 2, cooldown: 8.5, castTime: 0.75, epGain: 100, selfBuff: { duration: 10.0, stats: { physicalResistRating: 0.40, magicResistRating: 0.40 } } },
      ultimate: { name: "Atomic Explosion", attackRate: 16.0, hits: 4, castTime: 1.2, epCost: 1000, perfectAccuracy: true },
      passive: {
        name: "Mastery of Nothingness",
        periodicSelfStackBuff: { interval: 4.5, maxStacks: 5, stats: { attackRating: 1.00, defenseRating: 0.60, ultimatePierceRating: 0.15 } },
        periodicBonusHit: { interval: 4.5, attackRate: 4.0 }
      }
    }
  },
  "11": {
    // [Regular] Ha Yuri (SSR+, Assassin, PHYSICAL)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Aiguille Rose", attackRate: 1.0, hits: 1, interval: 1.0, epGain: 50 },
      active1: { name: "Integrity", attackRate: 12.0, hits: 4, cooldown: 8.5, castTime: 0.75, epGain: 100, perfectAccuracy: true, selfBuff: { duration: 10.0, stats: { physicalPierceRating: 0.60 } } },
      active2: { name: "I Choose You", attackRate: 7.6, hits: 3, cooldown: 9.5, castTime: 0.75, epGain: 100, selfInvincibleDuration: 2.5 },
      ultimate: { name: "Rose Strike", attackRate: 24.0, hits: 4, castTime: 1.2, epCost: 1000, perfectAccuracy: true },
      passive: { name: "Regular Strength", periodicSelfStackBuff: { interval: 5.0, maxStacks: 8, stats: { attackRating: 0.60 } } }
    }
  },
  "402": {
    // [Red Snake] Shilial (SSR, Mage, PHYSICAL)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Morsure Serpent", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 },
      active1: { name: "Wicked Extortion", attackRate: 9.6, hits: 8, cooldown: 8.5, castTime: 0.75, epGain: 100, bossDebuff: { duration: 10.0, stats: { dodge: -40, accuracy: -40 } } },
      active2: { name: "Black Snakefish Venom", attackRate: 4.0, hits: 1, cooldown: 9.5, castTime: 0.75, epGain: 500, selfBuff: { duration: 12.0, stats: { accuracy: 160, dodge: 160 } } },
      ultimate: { name: "Venomous Breath", attackRate: 18.0, hits: 3, castTime: 1.15, epCost: 1000, perfectAccuracy: true, dot: { duration: 5.0, interval: 1.0, rate: 2.0, damageType: "NORMAL" } },
      passive: { name: "Black Snakefish's Cunning", permanentSelf: { attackRating: 0.96, accuracy: 160, dodge: 160 } }
    }
  },
  "13": {
    // [Child] Endorsi (SSR, Mage, PHYSICAL)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Estocade", attackRate: 1.0, hits: 1, interval: 1.08, epGain: 50 },
      active1: { name: "Hidden Talent", attackRate: 23.0, hits: 9, cooldown: 8.5, castTime: 0.8, epGain: 100, dot: { duration: 4.0, interval: 1.0, rate: 1.0, damageType: "NORMAL" } },
      active2: { name: "Girl Revolution", attackRate: 2.5, hits: 1, cooldown: 10.0, castTime: 0.7, epGain: 100, enemyEnergyDrain: 100 },
      ultimate: { name: "Enforcement", attackRate: 14.2, hits: 2, castTime: 1.15, epCost: 1000, perfectAccuracy: true },
      passive: { name: "Princess Gem", permanentSelf: { attackRating: 0.50 } }
    }
  },
  "104": {
    // [Insightful One] Laure (SSR, Mage, MAGIC)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Vague d'Oreiller", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 50 },
      active1: { name: "Shinsu Shield", attackRate: 2.5, hits: 1, cooldown: 10.0, castTime: 0.75, epGain: 300 },
      active2: { name: "Close-Range Shinsu", attackRate: 9.0, hits: 1, cooldown: 9.0, castTime: 0.75, epGain: 100 },
      ultimate: { name: "Cry of Piercing Water", attackRate: 10.0, hits: 1, castTime: 1.15, epCost: 1000, perfectAccuracy: true },
      passive: {
        name: "Beauty Sleep",
        permanentSelf: { attackRating: 2.00, magicPierceRating: 0.30 }
      }
    }
  }
};

/**
 * Kits audités pour les héros clés non-Verts (tog_data_decrypted.db)
 */
const BOSS_KIT_OVERRIDES = {
  "53": {
    // [Rebellious Princess] Endorsi (SSR+ Dark Ranged MAGIC)
    recommendedSet: "sundance",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Chakram Rapide", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 60 },
      active1: {
        name: "Overdrive",
        attackRate: 2.0,
        hits: 1,
        cooldown: 9.0,
        castTime: 0.6,
        epGain: 120,
        selfBuff: { duration: 10.0, stats: { normalPierceRating: 0.80, attackHaste: 60, accuracy: 120, critRating: 0.50 } }
      },
      active2: {
        name: "Chakram Wheel",
        attackRate: 4.0,
        hits: 4,
        cooldown: 9.5,
        castTime: 0.6,
        epGain: 120,
        selfBuff: { duration: 10.0, stats: { extraBasicHits: 4, basicAttackCoefBonus: 10.0 } },
        bossStackDebuff: { key: "endorsi_mag_res", duration: 8.0, maxStacks: 10, hitsPerCast: 5, stats: { magicResistRating: -0.10, normalResistRating: -0.10 } }
      },
      ultimate: {
        name: "Final Lap",
        attackRate: 100.0,
        hits: 10,
        castTime: 2.0,
        fixedCastTime: true,
        epCost: 1000,
        perfectAccuracy: true,
        guaranteedCrit: true,
        selfInvincibleDuration: 3.0,
        consumeAccelBonusRate: 2.0,
        selfBuff: { duration: 3.0, stats: { ultimatePierceRating: 1.50 } }
      },
      passive: {
        name: "Accelerator",
        basicStackSelf: {
          key: "endorsi_acc",
          gainPerBasic: 15,
          maxStacks: 100,
          duration: 12.0,
          atkPerStack: 0.06,
          hasteAtMax: 60,
          coefPerStackOnActive: 0.05,
          energyAtMax: 500
        }
      },
      ee4: { name: "EE +4", permanentSelf: { critRating: 0.25, accuracy: 90 } }
    }
  },
  "50": {
    // [Red Lantern] Shilial (SSR+ Dark Assassin MAGIC)
    recommendedSet: "abgrund",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Éventail Rouge", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 60 },
      active1: {
        name: "Illusive Scent",
        attackRate: 0,
        hits: 0,
        cooldown: 8.5,
        castTime: 0.7,
        epGain: 120,
        selfConcealDuration: 8.0,
        selfEnergyPerSec: { duration: 8.0, amount: 120 },
        selfBuff: { duration: 8.0, stats: { attackRating: 3.0, haste: 80, cooltimeReductionRating: 0.50 } },
        bossDebuff: { duration: 8.0, stats: { defenseRating: -0.40, magicResistRating: -0.40, dodgePctShred: 0.40 } }
      },
      active2: {
        name: "Fan-Chasing Shadow",
        attackRate: 12.0,
        hits: 2,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120,
        selfBuff: { duration: 12.0, stats: { magicPierceRating: 0.60 } }
      },
      ultimate: {
        name: "Special Skill",
        attackRate: 72.0,
        hits: 9,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfInvincibleDuration: 3.0
      },
      passive: {
        name: "Blade Behind the Smile",
        permanentSelf: { magicPierceRating: 0.60 },
        infiniteStackingPoison: { duration: 10.0, ratePerStack: 8.8, interval: 1.0 },
        periodicSelfStackBuff: { interval: 1.5, maxStacks: 10, stats: { attackRating: 0.80 } }
      },
      ee4: { name: "EE +4", permanentSelf: { accuracy: 80, critRating: 0.12 } }
    }
  },
  "37": {
    // [FUG Executive] Ha Yura (SSR+ Dark Support PHYSICAL)
    recommendedSet: "runda",
    recommendedSlot4: "magicResistRating",
    recommendedSlot5: "physicalResistRating",
    skills: {
      normal: { name: "Chant du FUG", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 0 },
      active1: {
        name: "#whatsinmybag",
        attackRate: 0,
        hits: 0,
        cooldown: 8.5,
        castTime: 0.7,
        epGain: 0,
        teamCleanse: true,
        allyStackBuff: { key: "yura_bag", duration: 15.0, maxStacks: 3, stats: { healthRating: 0.20, attackRating: 0.80, defenseRating: 1.20 } },
        teamConditionalBonus: {
          minDark3: { dmgUpToLightRating: 0.40 },
          minPhys3: { physicalPierceRating: 0.40 },
          minMag3: { magicPierceRating: 0.40 }
        }
      },
      active2: {
        name: "Fanatic's Contract",
        attackRate: 4.0,
        hits: 1,
        cooldown: 9.5,
        castTime: 0.7,
        epGain: 0,
        bossDebuff: { duration: 18.0, stats: { physicalResistRating: -0.40, magicResistRating: -0.40 } }
      },
      ultimate: {
        name: "Siren's Aria",
        attackRate: 4.0,
        hits: 2,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        allyEnergyGain: 1000,
        immortalityDuration: 8.0,
        allyBuff: { duration: 8.0, stats: { attackHaste: 60, cooltimeReductionRating: 0.35 } }
      },
      passive: {
        name: "All Lights on Me",
        gainEnergyOnAllyUlt: 250,
        permanentAllies: { attackHaste: 15 }
      }
    }
  },
  "626": {
    // [Wolhaiksong] Urek Mazino (EX Water Warrior PHYSICAL)
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Poing de Shinsu", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 60 },
      active1: {
        name: "Power Unleashed",
        attackRate: 10.0,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.8,
        epGain: 120,
        selfEnergyGain: 1000,
        selfBuff: { duration: 12.0, stats: { critRating: 0.80, physicalPierceRating: 0.40, physicalResistRating: 0.80, finalResistRating: 0.50 } }
      },
      active2: {
        name: "Absolute Violence",
        attackRate: 8.0,
        hits: 1,
        cooldown: 10.0,
        castTime: 0.8,
        epGain: 120,
        dot: { duration: 10.0, interval: 1.0, rate: 4.0, damageType: "NORMAL" },
        bossDebuff: { duration: 10.0, stats: { physicalResistRating: -0.60, critResistRating: -0.60 } }
      },
      ultimate: {
        name: "The Gorgons' Fists",
        attackRate: 44.0,
        hits: 2,
        castTime: 1.5,
        epCost: 1000,
        perfectAccuracy: true
      },
      passive: {
        name: "He Who Defies the Tower's Rules",
        permanentStatusImmune: true,
        permanentSelf: { attackRating: 6.0, defenseRating: 6.0, healthRating: 6.0 }
      },
      ee4: { name: "EE +4", permanentSelf: { critBonusRating: 0.25, physicalPierceRating: 0.20, accuracy: 120 } }
    }
  },
  "647": {
    // [FUG Elder] Khel Hellam (SSR+ Fire Ranged MAGIC)
    destroysBarrier: true,
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Flèche Ancienne", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 60 },
      active1: {
        name: "Ancient Power",
        attackRate: 1.6,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 120,
        selfEnergyPerSec: { duration: 10.0, amount: 200 },
        selfBuff: { duration: 10.0, stats: { critRating: 0.60, ultimatePierceRating: 0.60, normalBonusAtkRate: 1.60 } }
      },
      active2: {
        name: "Guiding Arrow",
        attackRate: 20.0,
        hits: 5,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120,
        dot: { duration: 3.0, interval: 1.0, rate: 6.0, damageType: "NORMAL" },
        bossDebuff: { duration: 12.0, stats: { defenseRating: -0.80 } }
      },
      ultimate: {
        name: "Massacre Light Storm",
        attackRate: 120.0,
        hits: 10,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfStackBuff: { key: "khel_rev5", duration: 999, maxStacks: 10, stats: { attackRating: 0.80 } }
      },
      passive: {
        name: "Power to See Fate",
        destroysBarrier: true,
        permanentSelf: { accuracy: 200, dodge: 150 }
      },
      ee4: { name: "EE +4", permanentSelf: { accuracy: 80, critRating: 0.12 } }
    }
  },
  "654": {
    // [4th Corps Commander] Po Bidau Lyborick Khun (SSR+ Water Ranged MAGIC)
    recommendedSet: "el",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Lance Électrique", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 60 },
      active1: {
        name: "Shinsu Manifestation: Water Vapor",
        attackRate: 2.5,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 120,
        selfHitBarrier: 6,
        selfInvincibleDuration: 4.0
      },
      active2: {
        name: "Lightning Spear - Lanzas Pequeñas",
        attackRate: 20.0,
        hits: 5,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120
      },
      ultimate: {
        name: "Lightning Spear - Tormenta Lanza",
        attackRate: 40.0,
        hits: 5,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        guaranteedCrit: true,
        selfInvincibleDuration: 3.0
      },
      passive: {
        name: "Electric Enchantment",
        permanentSelf: { attackHaste: 20 },
        periodicSelfStackBuff: { interval: 5.0, maxStacks: 4, stats: { attackRating: 2.0 } },
        elemCrystalDebuff: { faction: "Water", resShredPerStack: 0.10, maxStacks: 10, duration: 10.0 },
        bossDebuff: { magicResistRating: -0.40, critReduceRating: -0.40 }
      },
      ee4: { name: "EE +4", permanentSelf: { accuracy: 80, critRating: 0.12 } }
    }
  },
  "652": {
    // [Ruler of the 44th Floor] Khun Royale Elliot (SSR+ Light Mage MAGIC)
    recommendedSet: "raihanna",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Éclat de Glace", attackRate: 1.0, hits: 1, interval: 1.15, epGain: 60 },
      active1: {
        name: "Ice Wall",
        attackRate: 0,
        hits: 0,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 120,
        selfInvincibleDuration: 6.0,
        selfEnergyPerSec: { duration: 10.0, amount: 120 },
        selfBuff: { duration: 10.0, stats: { haste: 60 } }
      },
      active2: {
        name: "Blizzard",
        attackRate: 22.4,
        hits: 4,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120,
        enemyEnergyDrain: 120,
        bossDebuff: { duration: 8.0, stats: { haste: -120 } }
      },
      ultimate: {
        name: "Absolute Zero",
        attackRate: 50.0,
        hits: 5,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfBuff: { duration: 10.0, stats: { accuracy: 200 } }
      },
      passive: { name: "Ruler of Ice", permanentSelf: { accuracy: 55 } },
      ee4: { name: "EE +4", permanentSelf: { accuracy: 80, critRating: 0.12 } }
    }
  },
  "653": {
    // [Noble Swordsman] White (SSR+ Light Warrior PHYSICAL)
    destroysBarrier: true,
    recommendedSet: "asura",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Lame d'Arie", attackRate: 1.0, hits: 1, interval: 1.08, epGain: 60 },
      active1: {
        name: "Telekinetic Sword",
        attackRate: 8.0,
        hits: 1,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 120,
        enemyEnergyDrain: 400,
        dot: { duration: 15.0, interval: 1.0, rate: 8.0, damageType: "NORMAL" },
        bossDebuff: { duration: 15.0, stats: { physicalResistRating: -0.80 } }
      },
      active2: {
        name: "One with the Sword",
        attackRate: 0,
        hits: 0,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120,
        selfBuff: { duration: 15.0, stats: { attackRating: 4.0, defenseRating: 4.0, physicalPierceRating: 0.40, critBonusRating: 0.60, ultimatePierceRating: 0.60 } }
      },
      ultimate: {
        name: "Severing Slash - Release",
        attackRate: 56.0,
        hits: 1,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        guaranteedCrit: true,
        destroysBarrier: true,
        selfInvincibleDuration: 6.0
      },
      passive: {
        name: "Inherited Will of the Sword",
        lifeFlamesStart: 4,
        lifeFlameInvuln: 3.0,
        lifeFlameHealRatio: 1.0,
        permanentSelf: { attackRating: 2.0, critBonusRating: 0.60, ultimatePierceRating: 0.20 }
      },
      ee4: { name: "EE +4", permanentSelf: { accuracy: 80, critRating: 0.12 } }
    }
  },
  "49": {
    // [The One Who Shone] Mago (SSR+ Water Warrior PHYSICAL)
    recommendedSet: "mago",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "physicalPierceRating",
    skills: {
      normal: { name: "Éclat Pur", attackRate: 1.0, hits: 1, interval: 1.1, epGain: 60 },
      active1: {
        name: "Crystallization",
        attackRate: 0,
        hits: 0,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 120,
        selfBuff: { duration: 12.0, stats: { attackRating: 2.0 } }
      },
      active2: {
        name: "Irresistible Charm",
        attackRate: 20.0,
        hits: 5,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120,
        enemyEnergyDrain: 1000
      },
      ultimate: {
        name: "Pure Light",
        attackRate: 63.0,
        hits: 3,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        guaranteedCrit: true
      },
      passive: {
        name: "Hope Reversal",
        damageTakenCapMaxHp: 0.05,
        permanentSelf: { attackRating: 1.2 },
        bossDebuff: { haste: -120 }
      },
      ee4: { name: "EE +4", permanentSelf: { accuracy: 80, critRating: 0.12 } }
    }
  },
  "648": {
    // [God of FUG] V (EX Water Mage MAGIC — tooltips exacts DB 648101..648931)
    name: "[God of FUG] V",
    recommendedSet: "el",
    recommendedSlot4: "critBonusRating",
    recommendedSlot5: "magicPierceRating",
    skills: {
      normal: { name: "Shinsu du FUG", attackRate: 1.0, hits: 1, interval: 1.05, epGain: 60 },
      active1: {
        name: "Vague Obscure (DB 648201)",
        attackRate: 40.0,
        hits: 5,
        cooldown: 8.5,
        castTime: 0.75,
        epGain: 120,
        enemyEnergyDrain: 200,
        selfBuff: { duration: 10.0, stats: { attackRating: 2.0 } }
      },
      active2: {
        name: "Tempête de Shinsu (DB 648301 + Rév4)",
        attackRate: 40.0,
        hits: 5,
        cooldown: 9.5,
        castTime: 0.75,
        epGain: 120,
        bossDebuff: { duration: 10.0, stats: { magicResistRating: -0.50 } }
      },
      ultimate: {
        name: "God of FUG (DB 648101 + Rév7 + EE)",
        attackRate: 70.0,
        hits: 5,
        castTime: 1.2,
        epCost: 1000,
        perfectAccuracy: true,
        selfInvincibleDuration: 5.0,
        selfBuff: { duration: 10.0, stats: { magicPierceRating: 1.0, haste: 70 } }
      },
      passive: {
        name: "Pouvoir du Dieu de FUG (DB 648401)",
        permanentStatusImmune: true,
        permanentSelf: { attackRating: 8.0 }
      }
    }
  }
};

const ALL_KIT_OVERRIDES = { ...GREEN_KIT_OVERRIDES, ...BOSS_KIT_OVERRIDES };

/**
 * Sets d'Armes d'Ignition réels (16 sets DB + 4 mixes 2+2)
 */
const IGNITION_TYPE_TO_KEY = {
  1: "celina",
  2: "doris",
  3: "bergamot",
  4: "el",
  5: "runda",
  6: "raihanna",
  7: "abgrund",
  8: "idea",
  9: "sundance",
  10: "sela",
  11: "alocasia",
  12: "rafflesia",
  13: "bari",
  14: "mago",
  15: "asura",
  16: "capelinel"
};

const IGNITION_EFFECTS = {
  celina: {
    id: "celina", name: "Celina (4p · Tank / Résistance Crit)", roleTag: "Tank Défensif", category: "support",
    summary: "2p: +40% Réd. Dégâts Crit | 4p: Bouclier défensif périodique.",
    bonus2p: { critReduceRating: 0.40 },
    bonus4p: {}
  },
  sundance: {
    id: "sundance", name: "Sundance (4p · Auto-Attaque)", roleTag: "DPS Auto-Attaque", category: "dps",
    summary: "2p: +50 ACC & +12% Pierce Auto (Âme 15: +55 / +15%) | 4p: Auto-attaques ignorent 20% DÉF + +200% ATQ sup. (+100%/5s max 3 ; Âme 30: 30% DÉF +250% max 4).",
    bonus2p: { accuracy: 50, normalPierceRating: 0.12 },
    soulBonus2p: { accuracy: 55, normalPierceRating: 0.15 },
    bonus4p: { normalDefIgnore: 0.20, normalBonusAtkRate: 2.00, normalBossStackBonus: { interval: 5.0, maxStacks: 3, ratePerStack: 1.0 } },
    soulBonus4p: { normalDefIgnore: 0.30, normalBonusAtkRate: 2.50, normalBossStackBonus: { interval: 5.0, maxStacks: 4, ratePerStack: 1.0 } }
  },
  mago: {
    id: "mago", name: "Mago (4p · Drain EP & Crit)", roleTag: "DPS Drain EP", category: "dps",
    summary: "2p: +10% ATQ & +10% Crit | 4p: Sur drain EP : +10% Dégâts Crit/stack (max +50%) + ignore 20% DÉF.",
    bonus2p: { attackRating: 0.10, critRating: 0.10 },
    bonus4p: { onSelfEnergyDrainStack: { maxStacks: 5, critBonusPerStack: 0.10, defIgnoreAtMax: 0.20 } }
  },
  asura: {
    id: "asura", name: "Asura (4p · Rage Ultime +400% ATQ)", roleTag: "DPS Burst Ultime", category: "dps",
    summary: "2p: +15% Pierce Ultime | 4p: +1 Rage/auto (max 8) ; Ultime donne +50% ATQ/stack (max +400%, 5s).",
    bonus2p: { ultimatePierceRating: 0.15 },
    bonus4p: { rageStackOnBasic: { maxStacks: 8 }, rageUltBuff: { duration: 5.0, atkPerStack: 0.50 } }
  },
  capelinel: {
    id: "capelinel", name: "Capelinel (4p · Rangée +30% Pierce / -30% Rés)", roleTag: "Support Perforation", category: "support",
    uniqueAura: true, sameRowOnly: true,
    summary: "2p: +35 ACC Effet & +10 Vélocité | 4p: Bouclier rangée +30% Pierce Phys/Mag ; -30% Rés. Phys/Mag Boss.",
    bonus2p: { debuffAccuracy: 35, haste: 10 },
    bonus4p: {
      sameRowOnly: true, uniqueAura: true,
      rowBarrierPierce: {
        cooldown: 5.0, duration: 10.0, shieldAtkRate: 8.0,
        allyStats: { physicalPierceRating: 0.30, magicPierceRating: 0.30 },
        bossStats: { physicalResistRating: -0.30, magicResistRating: -0.30 }
      }
    }
  },
  runda: {
    id: "runda", name: "Runda (4p · Rangée +100 EP/s & +50% DÉF)", roleTag: "Support Batterie", category: "support",
    uniqueAura: true, sameRowOnly: true,
    summary: "2p: +30% PV Max (Âme 15: +50%) | 4p: Bouclier rangée (Âme 30: 100% PV Max) +50% DÉF & +100 EP/s.",
    bonus2p: { healthRating: 0.30 },
    soulBonus2p: { healthRating: 0.50 },
    bonus4p: {
      sameRowOnly: true, uniqueAura: true,
      rowBarrierPulse: { cooldown: 5.0, duration: 10.0, shieldMaxHpRatio: 0.30, energyPerSec: 100, stats: { defenseRating: 0.50 } }
    },
    soulBonus4p: {
      sameRowOnly: true, uniqueAura: true,
      rowBarrierPulse: { cooldown: 5.0, duration: 10.0, shieldMaxHpRatio: 1.00, energyPerSec: 100, stats: { defenseRating: 0.50 } }
    }
  },
  doris: {
    id: "doris", name: "Doris (4p · Ligne Arrière +40 Vélocité)", roleTag: "Support Vélocité BACK", category: "support",
    uniqueAura: true, backRowOnly: true,
    summary: "2p: +20 Vélocité (Âme 15: +30) | 4p: Bouclier Ligne Arrière (10s) donnant +40 Vélocité (non-cumulable).",
    bonus2p: { haste: 20 },
    soulBonus2p: { haste: 30 },
    bonus4p: {
      backRowOnly: true, uniqueAura: true,
      backBarrierPulse: { duration: 10.0, shieldAtkRate: 8.0, enemyEnergyDrainOnBreak: 300, stats: { haste: 40 } }
    },
    soulBonus4p: {
      backRowOnly: true, uniqueAura: true,
      backBarrierPulse: { duration: 10.0, shieldAtkRate: 8.0, enemyEnergyDrainOnBreak: 300, stats: { haste: 40 } }
    }
  },
  el: {
    id: "el", name: "El (4p · Vitesse Auto & Hit Barrier)", roleTag: "DPS Auto / Survie", category: "dps",
    summary: "2p: +20 Vitesse d'Attaque & +10% Pierce Normal (Âme 15: +25 / +15%) | 4p: +1 Hit Barrier (3s, max 3) sur auto-attaque.",
    bonus2p: { attackHaste: 20, normalPierceRating: 0.10 },
    soulBonus2p: { attackHaste: 25, normalPierceRating: 0.15 },
    bonus4p: { hitBarrierOnNormal: { maxStacks: 3, duration: 3.0 } }
  },
  raihanna: {
    id: "raihanna", name: "Raihanna (4p · Burst & +300 EP/10s)", roleTag: "Burst + Batterie Self", category: "dps",
    summary: "2p: +20% ATQ | 4p: 1er coup garanti +300% ATQ + Immunité CC 5s, puis +300 EP / 10s.",
    bonus2p: { attackRating: 0.20 },
    bonus4p: { ccImmuneInitial: 5.0, firstHitBurst: { attackRatingBonus: 3.00, guaranteedHit: true }, periodicEnergy: { interval: 10.0, amount: 300 } }
  },
  abgrund: {
    id: "abgrund", name: "Abgrund (4p · Furtivité & Crit)", roleTag: "Assassin / Camouflage", category: "dps",
    summary: "2p: +10% Crit & +30% Dégâts Crit | 4p: +200 EP/s en camouflage ; à la révélation +50% Crit (8s).",
    bonus2p: { critRating: 0.10, critBonusRating: 0.30 },
    bonus4p: { stealthEnergyPerSec: 200, stealthHealAtkRate: 3.0, revealCritBuff: { duration: 8.0, critRating: 0.50, skillBlockHits: 3 } }
  },
  idea: {
    id: "idea", name: "Idea (4p · +500 EP 1ère Ult)", roleTag: "Support / Cycle EP", category: "support",
    summary: "2p: +65 Rés. Effet | 4p: Restaure +500 EP après la 1ère Ultime.",
    bonus2p: { debuffDodge: 65 },
    bonus4p: { ultEnergyRefund: { amount: 500, maxTriggers: 1 } }
  },
  rafflesia: {
    id: "rafflesia", name: "Rafflesia (4p · Anti-CC & -500 EP Boss)", roleTag: "Anti-CC + Drain EP", category: "support",
    summary: "2p: +15% PV & +15 Vélocité | 4p: Purifie CC (CD 6s), +200 EP & -100 EP/s au Boss (5s).",
    bonus2p: { healthRating: 0.15, haste: 15 },
    bonus4p: { ccCleanseCounter: { cooldown: 6.0, immuneDuration: 2.0, energyRestore: 200, enemyEnergyDrainPerSec: 100, drainDuration: 5.0 } }
  },
  bari: {
    id: "bari", name: "Bari (4p · Survie 75%/50%/25%)", roleTag: "Tank / Survie", category: "support",
    summary: "2p: +35 Rés. Effet & +10 Vélocité (Âme 15: +55 / +20) | 4p: Paliers PV 75% (3 Blocks), 50% (soin), 25% (Invuln 2s).",
    bonus2p: { debuffDodge: 35, haste: 10 },
    soulBonus2p: { debuffDodge: 55, haste: 20 },
    bonus4p: { hpThresholds: { shield75: 3, heal50: 0.05, inv25: 2.0 } }
  },
  sela: {
    id: "sela", name: "Sela (4p · DÉF + Rés. Phys/Mag)", roleTag: "Tank / Résistance", category: "support",
    summary: "2p: +30% DÉF & +35 Rés. Effet | 4p: +12% Rés. Phys/Mag.",
    bonus2p: { defenseRating: 0.30, debuffDodge: 35 },
    bonus4p: { physicalResistRating: 0.12, magicResistRating: 0.12 }
  },
  bergamot: {
    id: "bergamot", name: "Bergamot (4p · Vol de Vie & Soin)", roleTag: "Bruiser / Sustain", category: "support",
    summary: "2p: +20% Vol de Vie & +35 ACC | 4p: Sous 30% PV : soin 100% + +20% Vol de Vie & +20% ACC.",
    bonus2p: { lifeLeechRating: 0.20, accuracy: 35 },
    bonus4p: { fullHealBelow30: true, postTriggerStats: { lifeLeechRating: 0.20, accuracyPctBonus: 0.20 } }
  },
  alocasia: {
    id: "alocasia", name: "Alocasia (4p · Esquive Auto)", roleTag: "Tank Esquive", category: "support",
    summary: "2p: +55 Esquive | 4p: +50% Esquive contre les auto-attaques.",
    bonus2p: { dodge: 55 },
    bonus4p: { basicEvaBonus: 0.50 }
  },
  myeongwol: {
    id: "myeongwol", name: "Myeongwol (4p · Vol de Vie & Soin)", roleTag: "Bruiser / Sustain", category: "support",
    summary: "2p: +20% Vol de Vie & +35 ACC | 4p: Sous 30% PV : soin 100% + +20% Vol de Vie & +20% ACC.",
    bonus2p: { lifeLeechRating: 0.20, accuracy: 35 },
    bonus4p: { fullHealBelow30: true, postTriggerStats: { lifeLeechRating: 0.20, accuracyPctBonus: 0.20 } }
  },
  raihanna_abgrund: {
    id: "raihanna_abgrund", name: "Mix 2p Raihanna + 2p Abgrund", roleTag: "DPS Hybride 2+2", category: "dps",
    summary: "2p Raihanna (+20% ATQ) + 2p Abgrund (+10% Crit & +30% Dégâts Crit).",
    bonus2p: { attackRating: 0.20, critRating: 0.10, critBonusRating: 0.30 }, bonus4p: {}
  },
  raihanna_mago: {
    id: "raihanna_mago", name: "Mix 2p Raihanna + 2p Mago", roleTag: "DPS ATQ/Crit 2+2", category: "dps",
    summary: "2p Raihanna (+20% ATQ) + 2p Mago (+10% ATQ & +10% Crit).",
    bonus2p: { attackRating: 0.30, critRating: 0.10 }, bonus4p: {}
  },
  sundance_el: {
    id: "sundance_el", name: "Mix 2p Sundance + 2p El", roleTag: "DPS Auto 2+2", category: "dps",
    summary: "2p Sundance (+50 ACC & +12% Pierce Normal) + 2p El (+20 ATK SPD & +10% Pierce Normal).",
    bonus2p: { accuracy: 50, normalPierceRating: 0.22, attackHaste: 20 }, bonus4p: {}
  },
  raihanna_asura: {
    id: "raihanna_asura", name: "Mix 2p Raihanna + 2p Asura", roleTag: "DPS Ultime 2+2", category: "dps",
    summary: "2p Raihanna (+20% ATQ) + 2p Asura (+15% Pierce Ultime).",
    bonus2p: { attackRating: 0.20, ultimatePierceRating: 0.15 }, bonus4p: {}
  }
};

const SLOT4_MAIN_STATS = {
  critBonusRating: { id: "critBonusRating", label: "Dégâts Critiques (+48%)", stat: "critBonusRating", value: 0.48 },
  magicResistRating: { id: "magicResistRating", label: "Résistance Magique (+35%)", stat: "magicResistRating", value: 0.35 },
  debuffDodge: { id: "debuffDodge", label: "Résistance Effet (+140)", stat: "debuffDodge", value: 140 },
  debuffAccuracy: { id: "debuffAccuracy", label: "Précision Effet (+140)", stat: "debuffAccuracy", value: 140 },
  critReduceRating: { id: "critReduceRating", label: "Réduction Dégâts Crit (+35%)", stat: "critReduceRating", value: 0.35 }
};

const SLOT5_MAIN_STATS = {
  physicalPierceRating: { id: "physicalPierceRating", label: "Perforation Physique (+40%)", stat: "physicalPierceRating", value: 0.40 },
  magicPierceRating: { id: "magicPierceRating", label: "Perforation Magique (+40%)", stat: "magicPierceRating", value: 0.40 },
  critRating: { id: "critRating", label: "Taux Critique (+32%)", stat: "critRating", value: 0.32 },
  physicalResistRating: { id: "physicalResistRating", label: "Résistance Physique (+35%)", stat: "physicalResistRating", value: 0.35 },
  critResistRating: { id: "critResistRating", label: "Résistance Critique (+32%)", stat: "critResistRating", value: 0.32 }
};

const SUBSTAT_PROFILES = {
  dps_balanced: {
    id: "dps_balanced", label: "DPS Équilibré (ACC + Pierce + Crit + ATQ%)",
    stats: { accuracy: 240, physicalPierceRating: 0.20, magicPierceRating: 0.20, critRating: 0.18, critBonusRating: 0.30, attackRating: 0.25, haste: 12 }
  },
  dps_pierce_focus: {
    id: "dps_pierce_focus", label: "Focus Perforation & Précision",
    stats: { accuracy: 300, physicalPierceRating: 0.30, magicPierceRating: 0.30, critRating: 0.12, critBonusRating: 0.20, attackRating: 0.20, haste: 10 }
  },
  dps_crit_focus: {
    id: "dps_crit_focus", label: "Focus Critique & ATQ%",
    stats: { accuracy: 200, physicalPierceRating: 0.12, magicPierceRating: 0.12, critRating: 0.26, critBonusRating: 0.42, attackRating: 0.30, haste: 12 }
  },
  support_haste_acc: {
    id: "support_haste_acc", label: "Support (Vélocité + Rés. Effet + ACC)",
    stats: { accuracy: 240, haste: 28, debuffDodge: 120, debuffAccuracy: 80, cooltimeReductionRating: 0.12, physicalResistRating: 0.22, magicResistRating: 0.22 }
  }
};

function extractStatFromRow(row) {
  if (!row) return {};
  return {
    health: row._health || 0,
    healthRating: row._healthRating || 0,
    attack: row._attack || 0,
    attackRating: row._attackRating || 0,
    defense: row._defense || 0,
    defenseRating: row._defenseRating || 0,
    critRating: row._critRating || 0,
    critBonusRating: row._critBonusRating || 0,
    accuracy: row._accuracy || 0,
    dodge: row._dodge || 0,
    haste: row._haste || 0,
    recoveryRating: row._recoveryRating || 0,
    magicResistRating: row._magicResistRating || 0,
    physicalResistRating: row._physicalResistRating || 0,
    magicIncreaseRating: row._magicIncreaseRating || 0,
    physicalIncreaseRating: row._physicalIncreaseRating || 0,
    lifeLeechRating: row._lifeLeechRating || 0,
    critResistRating: row._critResistRating || 0,
    critReduceRating: row._critReduceRating || 0,
    magicPierceRating: row._magicPierceRating || 0,
    physicalPierceRating: row._physicalPierceRating || 0,
    finalResistRating: row._finalResistRating || 0,
    finalResist2Rating: row._finalResist2Rating || 0,
    debuffAccuracy: row._debuffAccuracy || 0,
    debuffDodge: row._debuffDodge || 0,
    cooltimeReductionRating: row._cooltimeReductionRating || 0,
    ultimatePierceRating: row._ultimatePierceRating || 0,
    ultimateResistRating: row._ultimateResistRating || 0,
    ultimateIncreaseRating: row._ultimateIncreaseRating || 0,
    normalPierceRating: row._normalPierceRating || 0,
    normalResistRating: row._normalResistRating || 0,
    normalIncreaseRating: row._normalIncreaseRating || 0,
    fixedDamageResistRating: row._fixedDamageResistRating || 0,
    healRating: row._healRating || 0
  };
}

function slimStatObj(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== 0 && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function buildSectionGroup(db, tableName, groupCol, groupId) {
  const rows = db.prepare(`
    SELECT d._damageSectionID as id, d._requiredDamage as req, d._damageExponent as exp,
           d._overwhelming as ovw, d._bossLvIncrease as lvInc, d._slotGrade as sg, d._stat as statId
    FROM "${tableName}" d
    WHERE d."${groupCol}" = ?
    ORDER BY d._damageSectionID
  `).all(groupId);

  const statStmt = db.prepare("SELECT * FROM stat_list WHERE _unique_key = ?");
  let cumLv = 0;
  return rows.map((r, idx) => {
    cumLv += (idx === 0 ? 0 : (r.lvInc || 10));
    const st = statStmt.get(String(r.statId)) || {};
    const prev = rows[idx - 1];
    const reqVal = idx === 0 ? 0 : (prev.req * Math.pow(10, prev.exp || 0));
    return {
      id: r.id,
      req: reqVal,
      lv: cumLv,
      ovw: r.ovw || 0,
      sg: r.sg || 1,
      atk: st._attack || 0,
      atkR: st._attackRating || 0,
      def: st._defense || 0,
      defR: st._defenseRating || 0,
      acc: st._accuracy || 0,
      dod: st._dodge || 0,
      hst: st._haste || 0,
      mRes: st._magicResistRating || 0,
      pRes: st._physicalResistRating || 0,
      cRes: st._critResistRating || 0,
      cRed: st._critReduceRating || 0,
      fRes1: st._finalResistRating || 0,
      fRes2: st._finalResist2Rating || 0,
      uRes: st._ultimateResistRating || 0,
      nRes: st._normalResistRating || 0,
      fixRes: st._fixedDamageResistRating || 0,
      dDod: st._debuffDodge || 0
    };
  });
}

function extractEeStats(db, charId) {
  const rows = db.prepare("SELECT * FROM item_equipment_private WHERE _characterId = ? ORDER BY CAST(_unique_key AS INTEGER)").all(Number(charId));
  const byLevel = {};
  for (const row of rows) {
    const levels = JSON.parse(row._levels || "[]");
    const fields = {
      healthRating: JSON.parse(row._healthRatings || "[0]"),
      attackRating: JSON.parse(row._attackRatings || "[0]"),
      defenseRating: JSON.parse(row._defenseRatings || "[0]"),
      critRating: JSON.parse(row._critRatings || "[0]"),
      critBonusRating: JSON.parse(row._critBonusRatings || "[0]"),
      accuracy: JSON.parse(row._accuracys || "[0]"),
      dodge: JSON.parse(row._dodges || "[0]"),
      haste: JSON.parse(row._hastes || "[0]"),
      recoveryRating: JSON.parse(row._recoveryRatings || "[0]"),
      magicResistRating: JSON.parse(row._magicResistRatings || "[0]"),
      physicalResistRating: JSON.parse(row._physicalResistRatings || "[0]"),
      magicIncreaseRating: JSON.parse(row._magicIncreaseRatings || "[0]"),
      physicalIncreaseRating: JSON.parse(row._physicalIncreaseRatings || "[0]"),
      lifeLeechRating: JSON.parse(row._lifeLeechRatings || "[0]")
    };
    levels.forEach((lv, i) => {
      if ([0, 10, 20, 30, 40].includes(lv)) {
        const s = {};
        for (const [k, arr] of Object.entries(fields)) {
          const val = arr[Math.min(i, arr.length - 1)] || 0;
          if (val !== 0) s[k] = val;
        }
        byLevel[lv] = s;
      }
    });
  }
  return byLevel;
}

function main() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const heroKits = loadHeroKits();

  // 1. BATTLE_CONFIG
  const bcRows = db.prepare("SELECT _configType, _intValue, _stringValue FROM battle_config").all();
  const bcMap = {};
  for (const r of bcRows) {
    bcMap[r._configType] = r._stringValue ? r._stringValue : r._intValue;
  }
  const BATTLE_CONFIG = {
    MATCH_DURATION: bcMap.BattleTimeLimit || 90,
    MAX_ENERGY: bcMap.Energy_Limit || 1000,
    ENERGY_ATTACK: bcMap.Energy_Attack || 50,
    ENERGY_DAMAGE: bcMap.Energy_Damage || 20,
    ENERGY_KILL: bcMap.Energy_Kill || 200,
    DEFAULT_ACTIVE_GET_ENERGY: bcMap.DefaultActiveSkillGetEnergy || 100,
    BOSS_ENERGY_ATTACK: bcMap.BossEnergy_Attack || 50,
    BOSS_ENERGY_DAMAGE: bcMap.BossEnergy_Damage || 5,
    HASTE_RATING_DIV: bcMap.HasteRating || 100,
    HASTE_MIN: 0.40,
    HASTE_MAX: 2.50,
    ACCURACY_CORRECT_A: bcMap.Accuracy_CorrectA || 350,
    ACCURACY_CORRECT_B: bcMap.Accuracy_CorrectB || 470,
    ACCURACY_CORRECT_C: bcMap.Accuracy_CorrectC || 0.15,
    DEBUFF_ACCURACY_CORRECT_A: bcMap.DebuffAccuracy_CorrectA || 300,
    DEBUFF_ACCURACY_CORRECT_B: bcMap.DebuffAccuracy_CorrectB || 375,
    DEBUFF_ACCURACY_CORRECT_C: bcMap.DebuffAccuracy_CorrectC || 0.20,
    CRIT_DAMAGE_RATING_BASE: bcMap.CritDamageRating || 1.5,
    FACTION_EQUIP_BONUS: bcMap.factionBuffRate || 0.30,
    DEF_CONSTANT: 2.0,
    RATE_MIN_CORRECTION: 0.1,
    STAT_RATIO_CAP: 5.0,
    DEF_MAX_REDUCTION: 0.999,
    OVERWHELMING_MIN: 0.001,
    OVERWHELMING_BASE: 0.25,
    OVERWHELMING_STEP: 0.05
  };

  // 2. STAT_BOUNDS
  const STAT_BOUNDS = {};
  for (const r of db.prepare("SELECT _statType, _statMin, _statMax FROM stat_bound").all()) {
    STAT_BOUNDS[r._statType] = { min: r._statMin, max: r._statMax };
  }

  // 3. FACTION_RELATIONS
  const FACTION_RELATIONS = {};
  for (const r of db.prepare("SELECT _faction, _advantageFaction, _damageRatio FROM battle_faction_relation").all()) {
    const a = FACTION_ID_TO_KEY[r._faction];
    const b = FACTION_ID_TO_KEY[r._advantageFaction];
    if (a && b) FACTION_RELATIONS[`${a}->${b}`] = r._damageRatio;
  }

  // 4. FACTION_COMBOS
  const FACTION_COMBOS = db.prepare(`
    SELECT c._num as num, s._healthRating as hp, s._attackRating as atk
    FROM battle_faction_combos c
    JOIN stat_list s ON s._unique_key = CAST(c._stat AS TEXT)
    WHERE c._factionCheckType = 1
  `).all();

  // 5. RARITY_PROMOTE & SLOT_GRADES & SLOT_LEVEL_MULT (1..3000)
  const RARITY_PROMOTE = {};
  for (const r of db.prepare("SELECT _unique_key, _desc, _healthPromote, _attackPromote, _defensePromote FROM character_rarity").all()) {
    const k = r._desc === "ST" ? "EX" : (r._desc === "SSR_PLUS" ? "SSR+" : r._desc);
    RARITY_PROMOTE[k] = { health: r._healthPromote, attack: r._attackPromote, defense: r._defensePromote };
  }
  RARITY_PROMOTE["XSR+"] = RARITY_PROMOTE["SSR+"];

  const SLOT_GRADES = db.prepare("SELECT CAST(_unique_key AS INTEGER) as id, _desc as label, _limitLevel as maxLv, _healthIncrese as mult FROM slot_grade ORDER BY id").all();

  const slRows = db.prepare("SELECT CAST(_unique_key AS INTEGER) as lv, _healthIncrese as h, _calculationType as ct FROM slot_level WHERE CAST(_unique_key AS INTEGER) <= 3000 ORDER BY lv").all();
  const SLOT_LEVEL_MULT = [1.0]; // index 0 unused
  let mult = 1.0;
  for (const r of slRows) {
    if (r.lv === 1) {
      mult = 1.0;
    } else if (r.ct === 0) {
      if (r.h === 0) mult *= (bcMap.normalGrowth || 1.02);
      else if (r.h === 1) mult *= (bcMap.hugeGrowth || 1.17);
      else if (r.h === 10) mult *= (bcMap["401normalGrowth"] || 1.007);
      else if (r.h === 11) mult *= (bcMap["401hugeGrowth"] || 1.05);
    } else if (r.ct === 1) {
      if (r.h === 20) mult *= 1.003;
      else if (r.h === 21) mult *= 1.01;
    }
    SLOT_LEVEL_MULT[r.lv] = Number(mult.toPrecision(7));
  }

  // 6. UNION_WEEKLYBOSS_BUFFS
  const UNION_WEEKLYBOSS_BUFFS = db.prepare("SELECT _unique_key as id, _desc as desc, _skillStringValue as stepVal, _maxLv as maxLv, _variationIcon as stat, _buffType as buffType FROM union_weeklyboss_buff WHERE _enable = 1 AND _buffType IN (0, 3) ORDER BY CAST(_unique_key AS INTEGER)").all();

  // 7. AIRSHIPS (hero-kits.json + ship_info de tog_data_decrypted.db)
  const AIRSHIPS = JSON.parse(JSON.stringify(heroKits.airships || {}));
  if (!AIRSHIPS.gloamspire) {
    AIRSHIPS.gloamspire = {
      id: "gloamspire",
      name: "Gloamspire (SSR+ Violet/Dark · DB Lv.5)",
      rarity: "SSR+",
      targetFaction: "Dark",
      targetAttackType: null,
      verified: true,
      source: "DB ship_info",
      summary: "+30% ATQ et +40% Dégâts Critiques pour les alliés Violet (Dark).",
      passiveStats: { attackRating: 0.30, critBonusRating: 0.40 },
      factionBonusStats: {},
      enemyDebuff: null,
      enemyAdvantageFaction: "Light",
      enemyAdvantageDebuff: null,
      active: null
    };
  }
  if (!AIRSHIPS.red_death) {
    AIRSHIPS.red_death = {
      id: "red_death",
      name: "Red Death (SSR+ Rouge/Fire · DB Lv.5)",
      rarity: "SSR+",
      targetFaction: "Fire",
      targetAttackType: null,
      verified: true,
      source: "DB ship_info",
      summary: "+30% ATQ et +40% Dégâts Critiques pour les alliés Rouge (Fire).",
      passiveStats: { attackRating: 0.30, critBonusRating: 0.40 },
      factionBonusStats: {},
      enemyDebuff: null,
      enemyAdvantageFaction: "Land",
      enemyAdvantageDebuff: null,
      active: null
    };
  }
  for (const s of db.prepare("SELECT _unique_key, _desc, _faction, _rarityBorn FROM ship_info WHERE _visible = 1").all()) {
    const slug = s._desc.replace(/^Airship_Name_/, "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (AIRSHIPS[slug]) {
      AIRSHIPS[slug].dbId = s._unique_key;
    }
  }

  // 7b. IGNITION_SOUL_CURVES (cumulative stats 0..30 per IW set from ignition_soul_lv)
  const IGNITION_SOUL_CURVES = {};
  const soulStatMap = { 2: "healthRating", 4: "attackRating", 6: "defenseRating" };
  for (const sKey of Object.values(IGNITION_TYPE_TO_KEY)) {
    IGNITION_SOUL_CURVES[sKey] = [{ healthRating: 0, attackRating: 0, defenseRating: 0, skillUp: 0 }];
  }
  const soulLvRows = db.prepare("SELECT _ignitionType, _level, _statType, _statValue, _setSkillUp FROM ignition_soul_lv ORDER BY _ignitionType, _level").all();
  for (const r of soulLvRows) {
    const sKey = IGNITION_TYPE_TO_KEY[r._ignitionType];
    const stKey = soulStatMap[r._statType];
    if (!sKey || !stKey) continue;
    const curve = IGNITION_SOUL_CURVES[sKey];
    const prev = curve[r._level - 1] || { healthRating: 0, attackRating: 0, defenseRating: 0, skillUp: 0 };
    const next = {
      healthRating: +(prev.healthRating + (stKey === "healthRating" ? r._statValue : 0)).toFixed(4),
      attackRating: +(prev.attackRating + (stKey === "attackRating" ? r._statValue : 0)).toFixed(4),
      defenseRating: +(prev.defenseRating + (stKey === "defenseRating" ? r._statValue : 0)).toFixed(4),
      skillUp: Math.max(prev.skillUp, r._setSkillUp || 0)
    };
    curve[r._level] = next;
  }

  // 7c. SHIP_STAT_SCALING (ship_stat)
  const shipStatRow = db.prepare("SELECT _mainStats, _mainAddStats FROM ship_stat WHERE _unique_key = '1'").get();
  const mainBases = shipStatRow ? JSON.parse(shipStatRow._mainStats) : [0.06, 0.08, 0.10, 0.10];
  const mainAdds = shipStatRow ? JSON.parse(shipStatRow._mainAddStats) : [0.024, 0.027, 0.03, 0.03];
  const SHIP_STAT_SCALING = {
    R: { base: mainBases[0] ?? 0.06, perLv: mainAdds[0] ?? 0.024 },
    SR: { base: mainBases[1] ?? 0.08, perLv: mainAdds[1] ?? 0.027 },
    SSR: { base: mainBases[2] ?? 0.10, perLv: mainAdds[2] ?? 0.03 },
    "SSR+": { base: mainBases[3] ?? 0.10, perLv: mainAdds[3] ?? 0.03 }
  };

  // 8. CHARACTERS (all playable NORMAL heroes)
  const dbChars = db.prepare(`
    SELECT _unique_key, _desc, _name, _faction, _role, _quality, _fightType, _rarityBorn, _subRarity,
           _statStart, _popularIgnition1
    FROM character_info
    WHERE _visible = 1 AND _type = 'NORMAL' AND _rarityBorn >= 3
    ORDER BY _faction, _rarityBorn DESC, CAST(_unique_key AS INTEGER)
  `).all();

  const statStmt = db.prepare("SELECT * FROM character_stat WHERE _unique_key = ?");
  const CHARACTERS = [];
  const unmatchedLog = [];

  for (const d of dbChars) {
    const dbId = String(d._unique_key);
    const faction = FACTION_ID_TO_KEY[d._faction];
    const role = ROLE_ID_TO_NAME[d._role];
    const rarity = RARITY_FROM_DB(d._rarityBorn, d._subRarity);
    const attackType = d._quality === 2001 ? "PHYSICAL" : "MAGIC";

    const dbStatRow = statStmt.get(String(d._statStart));
    const baseStats = slimStatObj(extractStatFromRow(dbStatRow));
    const eeByLevel = extractEeStats(db, dbId);
    const override = ALL_KIT_OVERRIDES[dbId];
    const kit = heroKits.heroes?.[dbId];

    if (!kit) {
      // Fallback propre si la DB contient un nouveau héros absent de hero-kits.json
      const fallbackNameRaw = (d._desc || "").split(",")[0].trim() || d._name.replace(/^Character_Name_|_2$/g, "");
      const fallbackName = `[DB #${dbId}] ${fallbackNameRaw}`;
      const popSet = IGNITION_TYPE_TO_KEY[d._popularIgnition1] || (role === "Support" || role === "Tank" ? "runda" : "el");
      const isCaster = role === "Mage" || role === "Support" || role === "Ranged";
      const fallbackSkills = override ? override.skills : {
        normal: { name: "Attaque de base", attackRate: 1.0, hits: 1, interval: 1.08, epGain: 50 },
        active1: { name: "Compétence 1", attackRate: 4.5, hits: 1, cooldown: 8.5, castTime: 0.75, epGain: 100 },
        active2: { name: "Compétence 2", attackRate: 8.0, hits: 2, cooldown: 9.5, castTime: 0.8, epGain: 100 },
        ultimate: { name: "Coup Spécial", attackRate: 18.0, hits: 3, castTime: 1.2, epCost: 1000, perfectAccuracy: true }
      };
      CHARACTERS.push({
        id: dbId,
        name: (override && override.name) || fallbackName,
        dbDesc: d._desc,
        rarity,
        faction,
        isCollab: COLLAB_CHAR_IDS.has(dbId),
        role,
        fightType: d._fightType === 3001 ? "STR" : (d._fightType === 3002 ? "DEX" : "INT"),
        attackType,
        rangeType: isCaster ? "FAR" : "NEAR",
        removesInvincibility: !!(override && override.removesInvincibility),
        destroysBarrier: !!(override && override.destroysBarrier),
        recommendedSet: (override && override.recommendedSet) || popSet,
        recommendedSlot4: (override && override.recommendedSlot4) || (role === "Support" ? "magicResistRating" : "critBonusRating"),
        recommendedSlot5: (override && override.recommendedSlot5) || (role === "Support" ? "physicalResistRating" : (attackType === "MAGIC" ? "magicPierceRating" : "physicalPierceRating")),
        tags: [],
        baseStats,
        eeByLevel,
        skills: fallbackSkills
      });
      unmatchedLog.push({ dbId, desc: d._desc, faction, role, rarity, fallbackName });
      continue;
    }

    let skills = override ? override.skills : JSON.parse(JSON.stringify(kit.skills || {}));
    // Ajuster Narae Trésor (42) : sans limite de stacks sur 90s (~18 stacks)
    if (dbId === "42" && skills?.passive?.periodicHighestAtkStackBuff) {
      skills = JSON.parse(JSON.stringify(skills));
      skills.passive.periodicHighestAtkStackBuff.maxStacks = 18;
    }

    CHARACTERS.push({
      id: dbId,
      name: (override && override.name) || kit.name,
      dbDesc: d._desc,
      rarity,
      faction,
      isCollab: COLLAB_CHAR_IDS.has(dbId),
      role,
      fightType: d._fightType === 3001 ? "STR" : (d._fightType === 3002 ? "DEX" : "INT"),
      attackType,
      rangeType: kit.rangeType || (["Tank", "Warrior", "Assassin"].includes(role) ? "NEAR" : "FAR"),
      removesInvincibility: override ? !!override.removesInvincibility : !!kit.removesInvincibility,
      destroysBarrier: override ? !!override.destroysBarrier : !!kit.destroysBarrier,
      recommendedSet: override ? override.recommendedSet : (kit.recommendedSet || "asura"),
      recommendedSlot4: override ? override.recommendedSlot4 : (kit.recommendedSlot4 || (role === "Support" ? "magicResistRating" : "critBonusRating")),
      recommendedSlot5: override ? override.recommendedSlot5 : (kit.recommendedSlot5 || (role === "Support" ? "physicalResistRating" : (attackType === "MAGIC" ? "magicPierceRating" : "physicalPierceRating"))),
      tags: kit.tags || [],
      baseStats,
      eeByLevel,
      skills
    });
  }

  // 9. DAMAGE_GROUPS + BOSSES
  const DAMAGE_GROUPS = {};
  const loadGroup = (key, table, col, id) => {
    if (!DAMAGE_GROUPS[key]) {
      DAMAGE_GROUPS[key] = buildSectionGroup(db, table, col, id);
    }
    return key;
  };

  const getBossBase = (charId) => {
    const c = db.prepare("SELECT _unique_key, _desc, _faction, _role, _quality, _statStart FROM character_info WHERE _unique_key = ?").get(String(charId));
    const s = c ? statStmt.get(String(c._statStart)) : null;
    return {
      charId: String(charId),
      faction: FACTION_ID_TO_KEY[c?._faction] || "Neutral",
      attackType: c?._quality === 2001 ? "PHYSICAL" : "MAGIC",
      baseStats: slimStatObj(extractStatFromRow(s))
    };
  };

  const BOSSES = [];

  // Mode 1: Union Weekly Boss (Zigena x5 factions, DEFAULT = uwb_zygaena_land)
  const zygaenaBase = getBossBase("10551");
  const uwbGroupKey = loadGroup("uwb_1", "union_weeklyboss_damagedefine", "_damageSectionGroupID", 1);
  const uwbOrder = [5, 1, 2, 3, 4]; // Land (Vert) FIRST as default!
  for (const fid of uwbOrder) {
    const fKey = FACTION_ID_TO_KEY[fid];
    BOSSES.push({
      id: `uwb_zygaena_${fKey.toLowerCase()}`,
      name: `Zigena — ${FACTION_LABELS[fKey]}`,
      mode: "Boss Hebdomadaire d'Alliance (Zigena)",
      deckCount: 1,
      allowedFactions: [fKey],
      bossFaction: "Neutral",
      baseSlotLevel: 1, // Lv 1 + (sec-1)*10 => sec 131 (>=10T) = Lv 1301 (exact match IG!)
      damageGroupKey: uwbGroupKey,
      bossAttackType: zygaenaBase.attackType,
      bossBaseStats: zygaenaBase.baseStats,
      bossBasicInterval: 2.2,
      bossUltEpCost: 1000,
      bossUltRate: 5.0,
      bossHpShieldInterval: 18.0,
      bossHpShieldRatio: 2.0,
      bossSkills: {
        invincibilityInterval: 16.0,
        invincibilityDuration: 4.0,
        invincibilityName: "Armure / Régénération Zigena",
        ccInterval: 12.0,
        ccDuration: 2.0,
        ccName: "Onde de Choc",
        bossDebuffAcc: 220,
        energyDrainInterval: 14.0,
        energyDrainAmount: 250
      },
      isAllianceWeekly: true,
      description: `Zigena (Boss d'Alliance) — Restriction stricte : uniquement les personnages ${FACTION_LABELS[fKey]} sont autorisés. 500 paliers exacts (union_weeklyboss_damagedefine + stat_list).`
    });
  }

  // Mode 2: Boss Raid Rank (Labo Souterrain)
  const brrNames = {
    "1": "Data Zahard",
    "2": "Data Mascheny",
    "3": "Data Urek Mazino",
    "4": "Data Khun Edahn",
    "5": "Data Gustang"
  };
  for (const r of db.prepare("SELECT * FROM bossraid_rank_info ORDER BY CAST(_unique_key AS INTEGER)").all()) {
    const tids = JSON.parse(r._phase1TroopID || "[]");
    const tr = db.prepare("SELECT _enemy2Id FROM battle_troop WHERE _unique_key = ?").get(String(tids[0]));
    const bBase = getBossBase(tr ? tr._enemy2Id : "7006");
    const gKey = loadGroup(`brr_${r._damageSectionGroupID}`, "bossraid_rank_damagedefine", "_damageSectionGroupID", r._damageSectionGroupID);
    const idSlug = (brrNames[r._unique_key] || r._desc).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    BOSSES.push({
      id: `brr_${idSlug}`,
      name: `${brrNames[r._unique_key] || r._desc} (Labo / Classement)`,
      mode: "Laboratoire Souterrain (Boss Raid Rank)",
      deckCount: tids.length || 2,
      allowedFactions: null,
      bossFaction: bBase.faction,
      baseSlotLevel: 2,
      damageGroupKey: gKey,
      bossAttackType: bBase.attackType,
      bossBaseStats: bBase.baseStats,
      bossBasicInterval: 2.1,
      bossUltEpCost: 1000,
      bossUltRate: 3.5,
      bossHpShieldInterval: 16.0,
      bossHpShieldRatio: 3.5,
      bossSkills: {
        invincibilityInterval: 15.0,
        invincibilityDuration: 4.5,
        invincibilityName: "Barrière / Invincibilité",
        ccInterval: 11.0,
        ccDuration: 2.5,
        ccName: "Contrôle Boss",
        bossDebuffAcc: 240,
        energyDrainInterval: 0,
        energyDrainAmount: 0
      },
      isAllianceWeekly: false,
      description: `Boss Raid de Classement — Toutes factions autorisées. 500 paliers exacts (bossraid_rank_damagedefine).`
    });
  }

  // Mode 3: Union Conquest (Expédition d'Alliance)
  const ucNames = {
    "1": "Anguille d'Acier Blanche (Neutre)",
    "2": "Anguille Électrique (Jaune)",
    "3": "Anguille Glaciale (Bleu)",
    "4": "Anguille de Flamme (Rouge)",
    "5": "Anguille Venimeuse (Vert)"
  };
  for (const r of db.prepare("SELECT * FROM union_conquest_boss_info ORDER BY CAST(_unique_key AS INTEGER)").all()) {
    const tr = db.prepare("SELECT _enemy1Id, _enemy2Id, _enemy3Id FROM battle_troop_union_conquest WHERE _unique_key = ?").get(String(r._troopID));
    const eid = tr ? (tr._enemy2Id || tr._enemy1Id || tr._enemy3Id) : 150;
    const bBase = getBossBase(eid);
    const gKey = loadGroup(`uc_${r._damageSectionGroupID}`, "union_conquest_bossdamagedefine", "_damageSectionGroupID", r._damageSectionGroupID);
    BOSSES.push({
      id: `uc_boss_${r._unique_key}`,
      name: ucNames[r._unique_key] || `Expédition Boss #${r._unique_key}`,
      mode: "Expédition d'Alliance (Union Conquest)",
      deckCount: 1,
      allowedFactions: null,
      bossFaction: bBase.faction,
      baseSlotLevel: 2,
      damageGroupKey: gKey,
      bossAttackType: bBase.attackType,
      bossBaseStats: bBase.baseStats,
      bossBasicInterval: 2.0,
      bossUltEpCost: 1000,
      bossUltRate: 3.2,
      bossHpShieldInterval: 20.0,
      bossHpShieldRatio: 3.0,
      bossSkills: {
        invincibilityInterval: 0,
        invincibilityDuration: 0,
        invincibilityName: "Aucune",
        ccInterval: 10.0,
        ccDuration: 2.5,
        ccName: "Balayage",
        bossDebuffAcc: 210,
        energyDrainInterval: 0,
        energyDrainAmount: 0
      },
      isAllianceWeekly: false,
      description: `Expédition d'Alliance (${FACTION_LABELS[bBase.faction] || bBase.faction}) — Toutes factions autorisées, avantage élémentaire actif.`
    });
  }

  // Mode 4: Sanctuary Boss (3 difficultés)
  const sanctRows = db.prepare("SELECT MIN(_unique_key) as k, _difficultyType as diff, _damageSectionGroupID as grp, _troopID as tid FROM sanctuary_boss_info GROUP BY _difficultyType ORDER BY _difficultyType").all();
  for (const r of sanctRows) {
    const tr = db.prepare("SELECT _enemy1Id, _enemy2Id, _enemy3Id FROM battle_troop_sanctuary WHERE _unique_key = ?").get(String(r.tid));
    const eid = tr ? (tr._enemy2Id || tr._enemy1Id || tr._enemy3Id) : 17101;
    const bBase = getBossBase(eid);
    const gKey = loadGroup(`sanct_${r.grp}`, "sanctuary_damagedefine", "_damageSectionGroupID", r.grp);
    BOSSES.push({
      id: `sanctuary_diff_${r.diff}`,
      name: `Administrateur (Sanctuaire Diff. ${r.diff})`,
      mode: "Sanctuaire (Sanctuary Boss)",
      deckCount: r.diff || 1,
      allowedFactions: null,
      bossFaction: bBase.faction,
      baseSlotLevel: 400,
      damageGroupKey: gKey,
      bossAttackType: bBase.attackType,
      bossBaseStats: bBase.baseStats,
      bossBasicInterval: 2.2,
      bossUltEpCost: 1000,
      bossUltRate: 3.5,
      bossHpShieldInterval: 16.0,
      bossHpShieldRatio: 4.0,
      bossSkills: {
        invincibilityInterval: 16.0,
        invincibilityDuration: 4.5,
        invincibilityName: "Barrière d'Administrateur",
        ccInterval: 11.0,
        ccDuration: 2.5,
        ccName: "Stun",
        bossDebuffAcc: 240,
        energyDrainInterval: 14.0,
        energyDrainAmount: 180
      },
      isAllianceWeekly: false,
      description: `Sanctuaire Difficulté ${r.diff} — 215 paliers exacts (sanctuary_damagedefine).`
    });
  }

  // Mode 5: Giga Boss
  const gigaNames = { "15": "Madam Net Dolphin (Giga Boss)", "16": "Super Ver Géant (Giga Boss)" };
  for (const r of db.prepare("SELECT * FROM event_gigaboss_info WHERE _unique_key IN ('15','16') ORDER BY CAST(_unique_key AS INTEGER) DESC").all()) {
    const tids = JSON.parse(r._troopID || "[]");
    const tr = db.prepare("SELECT _enemy1Id, _enemy2Id, _enemy3Id FROM battle_troop WHERE _unique_key = ?").get(String(tids[0]));
    const eid = tr ? (tr._enemy2Id || tr._enemy1Id || tr._enemy3Id) : 10039;
    const bBase = getBossBase(eid);
    const gKey = loadGroup(`giga_${r._damageSectionGroupID}`, "event_gigaboss_damagedefine", "_damageSectionGroupID", r._damageSectionGroupID);
    BOSSES.push({
      id: `giga_${r._unique_key}`,
      name: gigaNames[r._unique_key] || r._desc,
      mode: "Giga Boss (Événement)",
      deckCount: r._deckcount || 2,
      allowedFactions: null,
      bossFaction: bBase.faction,
      baseSlotLevel: 2,
      damageGroupKey: gKey,
      bossAttackType: bBase.attackType,
      bossBaseStats: bBase.baseStats,
      bossBasicInterval: 2.0,
      bossUltEpCost: 1000,
      bossUltRate: 3.2,
      bossHpShieldInterval: 20.0,
      bossHpShieldRatio: 3.0,
      bossSkills: {
        invincibilityInterval: 0,
        invincibilityDuration: 0,
        invincibilityName: "Aucune",
        ccInterval: 10.0,
        ccDuration: 2.5,
        ccName: "Balayage",
        bossDebuffAcc: 220,
        energyDrainInterval: 0,
        energyDrainAmount: 0
      },
      isAllianceWeekly: false,
      description: `Giga Boss — 500 paliers exacts (event_gigaboss_damagedefine).`
    });
  }

  const bundle = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceDb: "tog_data_decrypted.db",
      characterCount: CHARACTERS.length,
      greenCount: CHARACTERS.filter(c => c.faction === "Land").length,
      bossCount: BOSSES.length,
      damageGroupCount: Object.keys(DAMAGE_GROUPS).length
    },
    BATTLE_CONFIG,
    STAT_BOUNDS,
    FACTION_LABELS,
    FACTION_RELATIONS,
    FACTION_COMBOS,
    RARITY_PROMOTE,
    SLOT_GRADES,
    SLOT_LEVEL_MULT,
    UNION_WEEKLYBOSS_BUFFS,
    IGNITION_SETS: IGNITION_EFFECTS,
    IGNITION_SOUL_CURVES,
    SHIP_STAT_SCALING,
    SLOT4_MAIN_STATS,
    SLOT5_MAIN_STATS,
    SUBSTAT_PROFILES,
    AIRSHIPS,
    DAMAGE_GROUPS,
    BOSSES,
    CHARACTERS
  };

  const outJs = `// Auto-generated by tools/extract_db.mjs from data/tog_data_decrypted.db + data/hero-kits.json
(function (global) {
  "use strict";
  const DB = ${JSON.stringify(bundle)};
  if (typeof module !== "undefined" && module.exports) module.exports = DB;
  global.TOG_DB = DB;
})(typeof window !== "undefined" ? window : globalThis);
`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, outJs, "utf8");
  db.close();

  console.log(`=== EXTRACTION COMPLETE ===`);
  console.log(`Characters matched: ${CHARACTERS.length}/${dbChars.length} (Green: ${bundle.meta.greenCount})`);
  if (unmatchedLog.length) {
    console.warn(`WARN Fallback DB-only (${unmatchedLog.length}):`, JSON.stringify(unmatchedLog));
  }
  console.log(`Bosses extracted: ${BOSSES.length} (${Object.keys(DAMAGE_GROUPS).length} unique damage curves)`);
  console.log(`Output written: ${OUT_PATH} (${(Buffer.byteLength(outJs) / 1024).toFixed(1)} KB)`);
}

main();
