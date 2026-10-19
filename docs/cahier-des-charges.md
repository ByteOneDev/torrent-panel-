# Motflix — Cahier des charges

**Version 0.1 — 19 octobre 2026 — statut : brouillon à valider**

Maquette associée : [`docs/maquette/index.html`](maquette/index.html)

---

## 1. Objectif

Motflix est un **panel d'administration web** qui réunit dans une seule interface propre tous les outils de téléchargement et de gestion de médias (films, séries, livres, livres audio). Il s'installe sur n'importe quelle machine avec un script et alimente **Plex** (plus tard, une application Motflix maison).

**Problème résolu :** chaque outil (Radarr, Sonarr, Prowlarr, qBittorrent…) a sa propre interface, austère, et les réglages importants (langue, qualité, taille des fichiers) sont éparpillés et difficiles à trouver.

**Principes directeurs**

1. **Simple pour n'importe qui** : un script d'installation, un assistant de configuration, aucun port à ouvrir à la main.
2. **Les outils restent la source de vérité** : le panel lit et écrit chez eux via leurs API, sans garder de copie. Pas de désynchronisation possible.
3. **Local uniquement** : accessible depuis le réseau de la maison, pas depuis Internet.
4. **Interface inspirée de Minestrator** : claire, jolie, pratique.

---

## 2. Périmètre

### Dans la v1

- Stack Docker Compose complète (§5)
- Scripts `install.sh` et `start.sh` pour macOS et Linux, avec démarrage automatique (§7)
- Assistant de première configuration avec liaison automatique des services (§8)
- Panel : tableau de bord, services (état, ressources, logs, actions), **réglages unifiés**, recherche et ajout, bibliothèque, téléchargements (§9, §10)
- Gestion des rôles (option désactivée par défaut, §4)
- Panel responsive et installable (PWA)

### Hors v1 (plus tard)

- Application Motflix (Tauri : macOS, Windows, Linux, Android)
- Accès depuis l'extérieur de la maison
- Script d'installation Windows (`install.ps1`) — prévu en v1.1
- Sous-titres automatiques (Bazarr)

---

## 3. Environnements

| | Développement | Production |
|---|---|---|
| Machine | Mac (macOS) | Serveur Ubuntu (dernière LTS) |
| Docker | Colima (installé via Homebrew) | Docker Engine (dépôt officiel) |
| Usage | Tests avec du contenu libre et très léger (§14) | Usage réel |
| Disponibilité | Ponctuelle | Allumé la journée, éteint la nuit |
| Lecture | Plex (test) | Plex sur la télé |

**Conséquence « éteint la nuit » :** tout doit redémarrer seul au démarrage de la machine, les téléchargements reprennent où ils s'étaient arrêtés, et le ratio de partage par défaut reste raisonnable.

---

## 4. Utilisateurs et rôles

- **Pas de compte par défaut** : le panel s'ouvre directement, en administrateur, sans mot de passe.
- **Comptes activables** dans Réglages › Utilisateurs : on définit alors l'identifiant et le mot de passe de
  l'administrateur, et le panel exige une connexion. Désactivables de la même façon.
- Les deux autres personnes regardent via **Plex sur la télé** : elles n'ont pas besoin de compte sur le panel.
- **Option « Utilisateurs et rôles »** (Réglages → Utilisateurs), **désactivée par défaut**, sur le modèle de Plex :

| Rôle | Droits |
|---|---|
| Administrateur | Tout |
| Membre | Parcourir la bibliothèque, faire des demandes. Permissions cochables : films, séries, livres, livres audio ; validation automatique ou par l'admin ; quota par semaine |
| Lecture seule | Consulter la bibliothèque et les téléchargements |

---

## 5. Architecture

### 5.1 Services

| Service | Rôle | Image | Visible sur le réseau local |
|---|---|---|---|
| **motflix** | Panel (API + interface) | image maison | ✅ port `8080` |
| gluetun | VPN (optionnel) | `qmcgaw/gluetun` | ❌ |
| qbittorrent | Client torrent | `lscr.io/linuxserver/qbittorrent` | ❌ |
| prowlarr | Sites d'indexation | `lscr.io/linuxserver/prowlarr` | ❌ |
| flaresolverr | Passe les protections anti-bot de certains sites | `ghcr.io/flaresolverr/flaresolverr` | ❌ |
| radarr | Films | `lscr.io/linuxserver/radarr` | ❌ |
| sonarr | Séries | `lscr.io/linuxserver/sonarr` | ❌ |
| lazylibrarian | Livres et livres audio | `lscr.io/linuxserver/lazylibrarian` | ❌ |
| audiobookshelf | Écoute des livres audio, lecture des livres | `ghcr.io/advplyr/audiobookshelf` | ✅ port `13378` (appli mobile) |
| plex | Lecture sur la télé | `lscr.io/linuxserver/plex` | ✅ port `32400` (réseau hôte sur Linux) |
| socket-proxy | Accès Docker restreint pour le panel | `lscr.io/linuxserver/socket-proxy` | ❌ |

« ❌ » = joignable uniquement depuis le réseau Docker interne et depuis le serveur lui-même (`127.0.0.1`). Seul le panel parle à ces services.

### 5.2 Schéma

```
                         Réseau de la maison
   Navigateur / téléphone ───► Motflix :8080          Télé ───► Plex :32400
                                  │                  Téléphone ───► Audiobookshelf :13378
                                  │ (API + clés, côté serveur uniquement)
   ┌──────────────────────────────┼─────────────────────────────────────────┐
   │ Réseau Docker interne        ▼                                         │
   │   Radarr · Sonarr · LazyLibrarian ◄── Prowlarr ◄── FlareSolverr        │
   │          │                                                             │
   │          ▼                                                             │
   │   [ Gluetun (VPN, optionnel) ── qBittorrent ]  ── tout le trafic       │
   │                                                    torrent sort par    │
   │   Plex · Audiobookshelf ◄── /data/media            le VPN              │
   │   socket-proxy ◄── Motflix (état, logs, redémarrage des conteneurs)    │
   └────────────────────────────────────────────────────────────────────────┘
```

### 5.3 VPN optionnel

- Le choix se fait dans l'assistant et peut être changé dans Réglages → VPN.
- Deux **profils Compose** : `vpn` et `novpn`, sélectionnés via `COMPOSE_PROFILES` dans `.env`.
  - **Avec VPN** : qBittorrent utilise le réseau de Gluetun (`network_mode: service:gluetun`). Si le VPN tombe, qBittorrent perd tout accès réseau : **aucune fuite d'IP possible**.
  - **Sans VPN** : qBittorrent est sur le réseau normal.
- Prowlarr et FlareSolverr ne passent pas par le VPN par défaut. Une option « Faire passer les recherches par le VPN » est prévue.
- Le panel ne peut pas recréer de conteneurs (accès Docker restreint). Il dépose sa demande dans
  `config/motflix/agent/queue/` ; un **agent** sur la machine (launchd sur macOS, unité systemd `.path` sur Linux)
  lance `apply.sh`, qui vérifie la demande (liste blanche de réglages), met à jour `.env`, recrée les conteneurs et
  écrit le résultat que l'assistant affiche. Une clé invalide est refusée avant même d'être envoyée.

### 5.4 Port forwarding — décision

L'ouverture d'un port n'est **jamais obligatoire** : le téléchargement fonctionne sans. Elle améliore seulement le nombre de connexions et le partage.

| Cas | Ce qui se passe | Action de l'utilisateur |
|---|---|---|
| VPN compatible (ex. ProtonVPN, PIA — liste exacte à vérifier en phase 0) | Le port est ouvert **chez le fournisseur VPN**. Gluetun récupère le numéro, Motflix l'applique à qBittorrent et le réapplique s'il change | Aucune |
| VPN sans port forwarding | Fonctionne, avec un peu moins de connexions | Aucune |
| Sans VPN | qBittorrent demande à la box d'ouvrir le port (UPnP / NAT-PMP, activé par défaut) | Aucune |

Le panel affiche simplement l'état : « Port ouvert ✓ » ou « Connexions limitées (fonctionne quand même) ».

---

## 6. Arborescence sur la machine

| OS | Dossier d'installation |
|---|---|
| Ubuntu | `/opt/motflix` |
| macOS | `~/Motflix` |

```
motflix/
├── docker-compose.yml
├── .env                    # généré : clés API, PUID/PGID, chemins, profils (permissions 600)
├── config/<service>/       # configuration de chaque outil
└── data/                   # chemin configurable (ex. un disque dédié)
    ├── torrents/
    │   ├── films/  series/  livres/  livres-audio/
    └── media/
        ├── films/  series/  livres/  livres-audio/
```

**Un seul volume `/data`**, monté au même chemin dans qBittorrent, les *arr, LazyLibrarian, Plex et Audiobookshelf. Les imports se font par *hardlink* : un fichier peut rester en partage et apparaître dans la bibliothèque **sans prendre deux fois la place**, et le « déplacement » est instantané.

---

## 7. Installation et démarrage

### 7.1 `install.sh` (macOS + Linux)

1. Détecte l'OS et l'architecture.
2. Installe ce qui manque :
   - **Ubuntu** : Docker Engine + plugin Compose (dépôt officiel Docker), ajout de l'utilisateur au groupe `docker`.
   - **macOS** : Homebrew si absent, puis Colima + Docker CLI + Compose.
3. Demande (avec des valeurs par défaut) le dossier des médias et le port du panel. Vérifie l'espace libre.
4. Crée l'arborescence (§6) et génère `.env` : clés API aléatoires injectées dans chaque outil, PUID/PGID de l'utilisateur, fuseau horaire.
5. Installe le démarrage automatique (§7.3).
6. Lance `start.sh`, puis ouvre le navigateur sur l'assistant de configuration.

Exigences : **relançable sans rien casser**, journal dans `install.log`, messages clairs en français, options `--data-dir`, `--port`, `--no-autostart`.

### 7.2 `start.sh`

1. Démarre Docker s'il ne tourne pas (`colima start` sur macOS).
2. Lance `docker compose up -d`.
3. Attend que chaque service réponde (avec un délai maximum).
4. Affiche « Motflix est prêt : http://<ip-locale>:8080 », ou le service en échec.

### 7.3 Démarrage automatique

| OS | Mécanisme |
|---|---|
| Ubuntu | Service systemd `motflix.service` (démarré après `docker.service`) qui exécute `start.sh` |
| macOS | LaunchAgent `~/Library/LaunchAgents/` exécuté à l'ouverture de session (Colima a besoin de la session) |
| Windows | Tâche planifiée (v1.1) |

Les conteneurs ont `restart: unless-stopped` en filet de sécurité.

### 7.4 Scripts annexes

- `update.sh` : met à jour les images et recrée les conteneurs (aussi accessible depuis le panel).
- `uninstall.sh` : retire Motflix et le démarrage automatique. **Les médias sont conservés par défaut.**

---

## 8. Assistant de première configuration

Affiché au premier lancement du panel. Chaque étape peut être refaite plus tard dans les Réglages.

1. **Bienvenue** : présentation (aucun compte demandé ; ils restent activables dans les Réglages).
2. **Dossiers** : dossier des médias, présence des 8 sous-dossiers, espace libre (le changer : `install.sh --data-dir`).
3. **VPN** : Sans VPN / Avec VPN → fournisseur (liste Gluetun), identifiants (WireGuard ou OpenVPN), bouton **Tester** qui affiche l'IP vue de l'extérieur.
4. **Lecture** : bouton « Se connecter avec Plex » (connexion officielle plex.tv, sans code à copier) : le panel
   rattache le serveur au compte puis crée les bibliothèques. Identifiants Audiobookshelf (générés, à noter pour
   l'appli mobile). Motflix App grisé, « bientôt ».
5. **Préférences** : langues (§10.1, préremplies), qualité, tailles maximales.
6. **Sites d'indexation** : ajout dans Prowlarr depuis une liste avec recherche et test. Étape facultative, à faire plus tard si on veut.
7. **Récapitulatif → « Tout configurer »**. Le panel effectue automatiquement :
   - Prowlarr → Radarr, Sonarr, LazyLibrarian (synchronisation des indexeurs)
   - FlareSolverr déclaré dans Prowlarr
   - qBittorrent ajouté comme client dans Radarr, Sonarr et LazyLibrarian (une catégorie par type)
   - Dossiers racines de chaque outil
   - Profils de qualité + *custom formats* de langue
   - Plex : bibliothèques Films et Séries, actualisation après chaque import
   - Audiobookshelf : bibliothèques Livres audio et Livres
   - Port forwarding si disponible

   Chaque action s'affiche avec ✓ ou ✗ et un bouton **Réessayer**.

---

## 9. Pages du panel

### 9.1 Tableau de bord
- Cartes de synthèse : téléchargements actifs et vitesse, stockage utilisé/libre, état du VPN et du port, contenu de la bibliothèque.
- Grille des services : nom simple (« Films ») + outil (« Radarr »), badge En ligne / Arrêté / Erreur, CPU, RAM.
- File de téléchargement abrégée et activité récente (ajouts, imports, erreurs).

### 9.2 Services (style Minestrator)
- Détail d'un service : état, durée de fonctionnement, boutons Démarrer / Redémarrer / Arrêter, graphiques CPU et RAM.
- **Console de logs en direct**, avec filtre et niveau (info, avertissement, erreur).
- Lien « Ouvrir l'interface d'origine », avec l'identifiant et le mot de passe à utiliser (copiables) quand l'outil en demande un.

### 9.3 Bibliothèque (Films, Séries, Livres, Livres audio)
- Grille d'affiches, filtres (Disponible, En téléchargement, Manquant), badges langue et qualité.
- Fiche d'un média : fichiers, langue détectée, historique, actions (rechercher à nouveau, supprimer).

### 9.4 Recherche et ajout
- Barre de recherche unique : résultats regroupés par type.
- Ajout en un clic avec les préférences par défaut, ou personnalisé.

### 9.5 Téléchargements
- Liste en temps réel : nom, type, taille, progression, vitesse, temps restant, état.
- Pause, reprise, suppression ; vitesse globale ; badge VPN.

### 9.6 Réglages
Voir §10.

### 9.7 Système
- Mises à jour des services, sauvegarde et restauration de la configuration, journal du panel.

---

## 10. Réglages unifiés (le cœur du projet)

Chaque réglage : **unités humaines**, une phrase d'explication, bouton Enregistrer avec confirmation visible, et l'indication des outils concernés (« appliqué à Films et Séries »).

### 10.1 Langue

**Ordre par défaut : 1. VF → 2. MULTi → 3. VO → 4. VOSTFR** (modifiable par glisser-déposer ou flèches).

| Libellé | Correspond aux sorties marquées |
|---|---|
| VF | `TRUEFRENCH`, `VFF`, `VFI`, `FRENCH` (+ `VFQ` si la case « Accepter la VFQ » est cochée) |
| MULTi | `MULTi` (piste VF + piste VO) |
| VO | Langue originale, sans piste française |
| VOSTFR | `VOSTFR`, `SUBFRENCH` |

**Mise en œuvre dans Radarr/Sonarr :** un *custom format* par langue, avec un score décroissant selon l'ordre choisi (ex. 400 / 300 / 200 / 100). Le filtre de langue natif est réglé sur « N'importe laquelle » et c'est le score qui classe. On s'appuie sur les *custom formats* français maintenus par la communauté (TRaSH Guides) plutôt que de les écrire nous-mêmes.

Options :
- « Remplacer automatiquement quand une meilleure langue sort » (ex. VOSTFR → VF) : **oui** par défaut.
- « Refuser les versions hors de cette liste » : **oui** par défaut.

### 10.2 Qualité
- Résolution cible : 720p / **1080p** (défaut) / 4K.
- Accepter le HDR : oui/non.
- Éviter les fichiers « remux » (très lourds) : **oui** par défaut.
- → Traduit en *Quality Profile* dans Radarr et Sonarr.

### 10.3 Taille des fichiers
- Taille max d'un film : **4 Go** par défaut. Taille max d'un épisode : **1,5 Go** par défaut.
- → Traduit en *Quality Definitions* (Mo par minute), sur la base d'une durée moyenne (film 120 min, épisode 45 min). Le panel affiche l'équivalence (« ≈ 34 Mo par minute »).

### 10.4 Téléchargement (qBittorrent)
- Limites de vitesse (réception / envoi), planning (« ralentir de 9 h à 18 h »).
- Nombre de téléchargements simultanés.
- Partage : arrêter après un ratio de **1,0** ou **3 jours**, le premier atteint (à valider).
- Supprimer le torrent après le partage (le fichier reste dans la bibliothèque).

### 10.5 Sites d'indexation (Prowlarr)
- Liste, ajout, test, activation, priorité. FlareSolverr est appliqué automatiquement aux sites qui en ont besoin.

### 10.6 Bibliothèque
- Modèle de nommage (« Titre (Année) »), dossiers, actualisation Plex.

### 10.7 Lecture
- Plex (liaison, bibliothèques) ou Motflix App (bientôt).

### 10.8 VPN
- Activer/désactiver, fournisseur, identifiants, test, état du port.

### 10.9 Utilisateurs et rôles
- Voir §4. Désactivé par défaut.

### 10.10 Mode avancé
- Accès direct aux profils, *custom formats* et réglages bruts de chaque outil, pour les cas que le mode simple ne couvre pas.

---

## 11. Design

- Inspiré de **Minestrator** : barre latérale, cartes de services avec badges d'état, console de logs, formulaires aérés.
- Thème **sombre par défaut**, thème clair disponible.
- **Responsive** (téléphone, tablette, ordinateur) et **installable** (PWA).
- Langue de l'interface : français.

---

## 12. Sécurité

- Accès local uniquement. Seuls le panel, Plex et Audiobookshelf sont exposés au réseau de la maison.
- Les clés API des outils sont générées à l'installation et **ne quittent jamais le serveur** : le navigateur parle uniquement au backend Motflix.
- Sans compte (par défaut), toute personne sur le réseau local peut ouvrir le panel : c'est un choix assumé pour un
  usage familial. Avec les comptes activés : mots de passe hachés (argon2), session par cookie `httpOnly`,
  limite de tentatives de connexion.
- Accès à Docker via `socket-proxy`, limité aux opérations nécessaires (état, logs, démarrage/arrêt, statistiques).
- Identifiants VPN dans `.env`, lisible uniquement par le propriétaire (permissions `600`).

---

## 13. Stack technique

| Couche | Choix |
|---|---|
| Langage | TypeScript partout |
| Monorepo | npm workspaces (pnpm n'est pas installé par défaut et npm suffit) |
| Backend | Node.js 24 (LTS) + Fastify, TypeScript exécuté directement par Node (pas de compilation) |
| Base de données | SQLite intégré à Node (`node:sqlite`) : comptes et sessions. Un ORM viendra si le schéma grossit |
| Clients API | Générés depuis les specs OpenAPI (Radarr et Sonarr v3, Prowlarr v1) ; clients écrits à la main pour qBittorrent, LazyLibrarian, Audiobookshelf, Plex, Gluetun |
| Frontend | React + Vite + TanStack Query + React Router, icônes Lucide, CSS repris tel quel de la maquette validée |
| Temps réel | Server-Sent Events pour les logs ; rafraîchissement toutes les 5 s pour l'état et les statistiques |
| Livraison | Une seule image Docker `motflix-panel`, construite à l'installation : le backend sert l'interface compilée |
| Tests | Vitest ; tests d'intégration contre la stack Docker |

```
motflix/
├── apps/
│   ├── server/           # API Fastify, intégrations, assistant, Docker
│   └── web/              # Interface React (PWA)
├── packages/
│   └── shared/           # Types partagés serveur ↔ interface (clients API typés : phase 3)
├── Dockerfile            # image du panel
├── docker/
│   └── docker-compose.yml (+ variantes Plex)
├── scripts/
│   ├── install.sh  start.sh  update.sh  uninstall.sh
│   └── autostart/        # unité systemd, LaunchAgent
└── docs/
```

---

## 14. Plan de test (machine de développement)

**Uniquement du contenu libre de droits et très léger** (volume total < 1 Go) :

| Type | Contenu |
|---|---|
| Film | Un court métrage open source de la Blender Foundation (licence Creative Commons), dans sa version la plus légère |
| Livre | Un classique du domaine public (Project Gutenberg, EPUB) |
| Livre audio | Un enregistrement court de LibriVox (domaine public) |

Si ces contenus ne remontent pas via les indexeurs, on teste la chaîne qBittorrent → import → bibliothèque avec le torrent officiel, et la recherche Prowlarr sans lancer de téléchargement.

**Critères de réussite**
- [ ] Avec VPN : l'IP vue par qBittorrent est celle du VPN, pas celle de la maison
- [ ] VPN coupé volontairement → qBittorrent n'a plus de réseau
- [ ] Téléchargement terminé, importé et renommé dans `media/`, par hardlink
- [ ] Plex affiche le film, Audiobookshelf affiche le livre audio et le livre
- [ ] Un réglage modifié dans le panel apparaît bien dans Radarr/Sonarr
- [ ] Redémarrage de la machine → tout revient seul, sans intervention

---

## 15. Feuille de route

| Phase | Contenu | Terminée quand |
|---|---|---|
| **0** | `docker-compose.yml`, `install.sh`, `start.sh`, démarrage automatique | Un film libre va de la recherche jusqu'à Plex, configuré à la main ; redémarrage OK |
| **1** | Squelette du panel : connexion, tableau de bord, services (état, ressources, logs, actions) | Les services se pilotent depuis le panel — ✅ livré |
| **2** | Assistant + liaison automatique des services | Installation neuve → tout fonctionne sans ouvrir aucun autre outil — ✅ livré |
| **3** | **Réglages unifiés** (§10) | Langue, qualité, taille et téléchargement se règlent uniquement depuis le panel — ✅ livré |
| **4** | Recherche, bibliothèque, téléchargements | Ajouter et suivre un média sans quitter le panel — ✅ livré |
| **5** | Rôles, PWA, finitions, `install.ps1` | v1 livrée — ✅ livré (Windows non testé sur une vraie machine) |
| Plus tard | Application Motflix (Tauri) | — |

---

## 16. Points ouverts

- [ ] Partage par défaut : ratio 1,0 **ou** 3 jours (le premier atteint) — à confirmer
- [ ] VFQ acceptée comme VF ? (proposé : non par défaut, case à cocher)
- [ ] Accès aux interfaces d'origine : proxy via le panel ou seulement depuis le serveur
- [ ] Adresse locale facile à retenir (`motflix.local` via mDNS) — bonus
- [ ] Port du panel : `8080` par défaut ?
