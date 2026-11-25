# Tower of God: New World — Optimiseur & Simulateur Boss (DB Exacte)

Simulateur de combat Boss **90 secondes** et optimiseur de compositions (**1 équipe** ou **2 équipes disjointes**) basé directement sur la base de données déchiffrée du jeu (`data/tog_data_decrypted.db`) et ses définitions de compétences indexées par ID officiel (`data/hero-kits.json`).

- **162 héros jouables** (`SSR`, `XSR+`, `SSR+`, `EX` — hors R/SR pour alléger l'optimisation) avec statistiques de base, Équipements Exclusifs (`+0` à `+40`) et compétences calibrées.
- **20 Boss sur 5 modes** : **Expédition d'Alliance** (*Anguille Électrique*, *Labo / Boss Raid*, etc.), **Zigena hebdomadaire** (`× 5` éléments), **Boss Raid de Classement** (2 decks), **Sanctuaire** et **Giga Boss**.
- **Mécaniques exactes du jeu** : courbes du Lien Shinsu (`slot_level` + `slot_grade` + `character_rarity`), sets d'Ignition + **Âmes `0 → 30`** (`IGNITION_SOUL_CURVES`), **Vaisseaux** (niveau + compétence `/5`), **Tri-Essence** (`FOR / DEX / INT`), et calcul exact de la **Domination (`Noyau Shinsu + 1 par perso Transcendé Boss`)**.

---

## 1. Démarrage rapide (Interface Web — zéro installation)

Ouvrez simplement `index.html` dans votre navigateur (fonctionne directement en `file://`, sans serveur) :

1. **Sélectionnez un Boss** (par défaut : *Anguille Électrique (Jaune)*).
2. **Choisissez un profil** via le menu déroulant **Profil compte** *(ou cliquez sur **Importer JSON** pour charger un profil exporté)*.
3. *(Optionnel)* Décochez **Profil compte** pour tester en mode manuel (Lien Shinsu, High Link, Révolution, Box personnalisée via **Ma Box / Verrouiller**).
4. Consultez le classement des meilleures compositions (`3 FRONT / 2 BACK`, Sets IW, Vaisseau optimal, impacts marginaux) et ajustez librement une compo dans le **Bac à sable 90s**.

---

## 2. Architecture du projet

```text
tog-boss-optimizer/
├── index.html                   # Interface Web autonome (file://)
├── app.js                       # Contrôleur UI, sélecteur de profils & bac à sable
├── styles.css                   # Feuille de style
├── engine/
│   ├── simulator.js             # Moteur de combat 90s (pipeline FOAMBPPLDPL)
│   └── optimizer.js             # Recherche multi-graines, High Links, Vaisseaux & Sets
├── data/
│   ├── tog_data_decrypted.db    # Base SQLite déchiffrée du jeu (~105,6 Mo)
│   ├── hero-kits.json           # Définitions de compétences indexées par ID officiel DB
│   ├── db-bundle.js             # Bundle compilé utilisé par le Web et la CLI (~2 Mo)
│   ├── profiles/
│   │   ├── _template.json       # Modèle vierge pour créer le profil d'un joueur
│   │   └── martin.json          # Profil exemple pré-configuré
│   ├── account-profiles.js      # Bundle Web multi-profils généré automatiquement
│   ├── account-profile.js       # Profil par défaut (rétrocompatibilité)
│   └── my-account.json          # Copie du profil principal
└── tools/
    ├── extract_db.mjs           # ETL lecture seule : DB + hero-kits.json -> data/db-bundle.js
    ├── run_optimizer.mjs        # Optimiseur en ligne de commande (CLI)
    ├── import_screenshots.mjs   # Importateur OCR local (captures FR Windows)
    ├── ocr_winrt.ps1            # Moteur WinRT OCR (fr-FR) pour import_screenshots.mjs
    └── build_profiles_bundle.mjs# Compile data/profiles/*.json -> data/account-profiles.js
```

---

## 3. Utilisation CLI (Node.js 22+)

Node.js **22+** (avec module intégré `node:sqlite`) est requis pour exécuter les scripts `tools/`.

```powershell
# Lister tous les boss disponibles
node tools/run_optimizer.mjs --list-bosses

# Lister tous les profils disponibles dans data/profiles/
node tools/run_optimizer.mjs --list-profiles

# Optimiser l'Anguille Électrique sur un profil (Top 5)
node tools/run_optimizer.mjs --boss uc_boss_2 --profile martin --top 5

# Optimiser un boss à 2 équipes disjointes (ex: Data Khun Edahn)
node tools/run_optimizer.mjs --boss brr_data_khun_edahn --profile martin --teams 2

# Optimiser en mode manuel (sans fichier de profil)
node tools/run_optimizer.mjs --boss uwb_zygaena_land --shinsu 1600 --high-link 20 --no-collab --top 5
```

---

## 4. Ajouter le profil d'un autre joueur (Alliance / Amis)

### Méthode A — Import automatique depuis captures d'écran (Windows 10/11)

Le script utilise l'OCR natif de Windows (`fr-FR`, 100 % local, aucune interaction avec le jeu) sur vos captures d'écran (**Lien Shinsu / Noyau**, **Âmes IW**, **Tri-Essence FOR / DEX / INT**, **Hangar**) :

```powershell
node tools/import_screenshots.mjs <dossier-images> --profile pseudo --name "Pseudo"
node tools/run_optimizer.mjs --boss uc_boss_2 --profile pseudo --top 5
```

> **Note :** Les captures de box de héros sont à renseigner dans la clé `"box"` du fichier JSON généré (ou via le panneau **Ma Box** de l'interface Web).

### Méthode B — Modèle JSON manuel

1. Copiez `data/profiles/_template.json` vers `data/profiles/<pseudo>.json`.
2. Renseignez `profileId`, `displayName`, `shinsuSlotLevels`, `shinsuCoreLevel`, `iwSoulLevels`, `triEssenceByType`, `airships` et `box`.
3. Compilez le bundle Web :
   ```powershell
   node tools/build_profiles_bundle.mjs
   ```
   *(Ou chargez directement le `.json` dans l'interface Web via le bouton **Importer JSON** — il sera sauvegardé dans le navigateur).*

---

## 5. Régénérer la base compilée (`data/db-bundle.js`)

Après une mise à jour de `data/tog_data_decrypted.db` ou de `data/hero-kits.json` :

```powershell
node tools/extract_db.mjs
```

Le script lit automatiquement `data/tog_data_decrypted.db` et `data/hero-kits.json` en chemins relatifs (surchargeable via la variable d'environnement `TOG_DB_PATH`).

---

## 6. Partager le projet

Deux formats selon l'usage :

| Format | Contenu | Taille approx. | Usage recommandé |
| --- | --- | :---: | --- |
| **Pack Web léger** *(sans `data/tog_data_decrypted.db`)* | `index.html`, `app.js`, `styles.css`, `engine/`, `data/db-bundle.js`, `data/account-profiles.js` | **~2,3 Mo** *(~500 Ko en `.zip`)* | **Netlify Drop**, **GitHub Pages**, ou `.zip` sur **Discord** (tes alliés ouvrent juste `index.html`). |
| **Dépôt complet** *(avec `data/tog_data_decrypted.db`)* | Tout le projet + base SQLite brute (`105,6 Mo`) | **~108 Mo** | La base `data/tog_data_decrypted.db` (`> 100 Mo`) est fournie en pièce jointe de la **Release GitHub `v1.0`** afin que `git clone` reste rapide et que **GitHub Pages** fonctionne directement avec `data/db-bundle.js`. |
