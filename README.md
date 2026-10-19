# Motflix

Panel d'administration web qui réunit les outils de téléchargement et de gestion de médias
(films, séries, livres, livres audio) dans une seule interface.

- Cahier des charges : [docs/cahier-des-charges.md](docs/cahier-des-charges.md)
- Maquette : [docs/maquette/index.html](docs/maquette/index.html)

**État : phase 4** — la stack s'installe et démarre seule ; un assistant relie tous les outils au premier accès.
Depuis le panel : chercher et ajouter des films, séries et livres, parcourir la bibliothèque, suivre et gérer les
téléchargements, et tout régler (langue, qualité, partage, VPN, sites, Plex, comptes) sans ouvrir les outils.

---

## Installation

Sur macOS ou Linux (Ubuntu), avec votre utilisateur habituel (pas en root) :

```bash
./scripts/install.sh
```

Le script :

1. installe Docker s'il manque (Docker Engine sur Linux ; Colima via Homebrew sur macOS, ou utilise Docker Desktop s'il est déjà là) ;
2. demande le dossier d'installation et le dossier des médias ;
3. propose un VPN (facultatif) et Plex ;
4. génère les clés API et le mot de passe de qBittorrent dans `.env` ;
5. prépare la configuration de chaque outil ;
6. active le démarrage automatique ;
7. télécharge les services, demande le code Plex et démarre tout.

| | macOS | Linux |
|---|---|---|
| Dossier d'installation | `~/Motflix` | `/opt/motflix` |
| Démarrage automatique | LaunchAgent, à l'ouverture de session | Service systemd `motflix` |

Options utiles (`--help` pour la liste complète) :

| Option | Effet |
|---|---|
| `--data-dir CHEMIN` | Range médias et téléchargements ailleurs (ex. un disque dédié) |
| `--expose-tools` | Rend les interfaces des outils joignables depuis le réseau local (utile sur un serveur sans écran) |
| `--no-vpn`, `--no-plex` | Ne propose pas le VPN / n'installe pas Plex |
| `--no-autostart` | Pas de démarrage automatique |
| `--reconfigure` | Repose les questions (les clés existantes sont conservées) |
| `-y` | Aucune question : sans VPN, avec Plex |

Relancer `install.sh` ne casse rien : la configuration existante est conservée.

## Au quotidien

Depuis le dossier d'installation :

```bash
./start.sh
```

| Script | Rôle |
|---|---|
| `start.sh` | Démarre Docker si besoin, lance les services, vérifie qu'ils répondent |
| `stop.sh` | Arrête les services (rien n'est supprimé) |
| `update.sh` | Met à jour les services |
| `uninstall.sh` | Désinstalle ; les médias sont conservés (sauf `--purge-data`) |
| `apply.sh` | Applique un changement de VPN demandé depuis le panel. Lancé tout seul par l'agent (launchd / systemd) ; à la main seulement si l'agent est absent |

## Services

| Service | Rôle | Adresse |
|---|---|---|
| **Motflix** | **Panel d'administration** | **http://\<ip\>:8080** |
| Radarr | Films | http://localhost:7878 |
| Sonarr | Séries | http://localhost:8989 |
| Prowlarr | Sites d'indexation | http://localhost:9696 |
| FlareSolverr | Protections anti-bot | http://localhost:8191 |
| qBittorrent | Téléchargement | http://localhost:8090 |
| LazyLibrarian | Livres et livres audio | http://localhost:5299 |
| Audiobookshelf | Écoute et lecture des livres | http://\<ip\>:13378 |
| Plex | Lecture sur la télé | http://\<ip\>:32400/web |
| Gluetun | VPN (facultatif) | — |

Les outils ne sont joignables que depuis la machine elle-même (sauf `--expose-tools`).
Audiobookshelf et Plex sont visibles sur le réseau local.

Tous les services voient les fichiers au même chemin, `/data` :

```
data/
├── torrents/  films/ series/ livres/ livres-audio/   ← téléchargements en cours et en partage
└── media/     films/ series/ livres/ livres-audio/   ← bibliothèque rangée (hardlinks : pas de double espace)
```

## Le panel

Après l'installation, ouvrez **http://\<ip-de-la-machine\>:8080** (le port est affiché par `start.sh` ;
s'il est déjà pris, l'installeur choisit le suivant de libre, ou utilisez `--port`).
Au premier accès, **l'assistant** prend la main : dossiers, VPN, Plex (connexion à votre compte en un clic),
livres audio, langues préférées (VF › MULTi › VO › VOSTFR), sites d'indexation, puis « Tout configurer ».
Il se relance à tout moment depuis le menu.

Le panel s'ouvre directement, sans mot de passe. Pour en exiger un, activez les comptes dans
**Réglages › Utilisateurs et rôles** (mot de passe oublié : `docker exec motflix-panel node src/reset-auth.ts`).

| Page | Contenu |
|---|---|
| Tableau de bord | Téléchargements, stockage, VPN, bibliothèque, état de chaque service, activité récente |
| Rechercher | Films, séries et livres (barre du haut) ; « Ajouter » selon vos préférences, avec ou sans recherche immédiate |
| Films, Séries, Livres, Livres audio | Affiches, filtres (disponibles, en téléchargement, recherchés), fiche avec « Rechercher à nouveau » et « Retirer » |
| Téléchargements | Vitesses, progression, temps restant, pause / reprise / suppression, « Tout mettre en pause » |
| Services | Détail d'un service : démarrer / redémarrer / arrêter, CPU et mémoire, console de logs en direct, et les identifiants de son interface d'origine |
| Réglages | Langue et qualité, téléchargements (vitesse, plage horaire, partage), VPN, sites d'indexation, Plex, comptes, mode avancé |

Le panel parle à Docker à travers `socket-proxy`, qui n'autorise que la lecture de l'état, des logs et des
statistiques, et le démarrage / arrêt des conteneurs. Les clés API des outils ne quittent jamais le serveur.

## Développement

Prérequis : Node.js 24 ou plus récent, et une installation Motflix qui tourne (pour avoir des services à piloter).

```bash
npm install
```

```bash
cp apps/server/.env.dev.example apps/server/.env.dev
```

Complétez `apps/server/.env.dev` avec les clés de `~/Motflix/.env`, puis :

```bash
npm run dev
```

L'interface est sur http://localhost:5173 (Vite, rechargement à chaud), l'API sur le port indiqué dans `.env.dev`.

| Commande | Rôle |
|---|---|
| `npm test` | Tests du serveur (Vitest) |
| `npm run typecheck` | Vérification des types, serveur et interface |
| `npm run build` | Compile l'interface dans `apps/web/dist` |
| `npm run docker:build` | Construit l'image du panel |

> Le dossier de ce projet contient « : » dans son nom. C'est sans conséquence pour Motflix, mais les scripts npm
> appellent les outils par leur chemin relatif (`../../node_modules/.bin/…`), car un « : » dans le `PATH` casse
> la résolution des commandes.

## Test à la main (sans l'assistant)

Uniquement avec un contenu **libre de droits et léger** (ex. un court métrage de la Blender Foundation).

1. **Prowlarr** → Settings → Apps : ajouter Radarr (`http://radarr:7878`, clé `RADARR_API_KEY` du `.env`) ; Prowlarr doit pointer vers `http://prowlarr:9696`.
   Indexers → ajouter un site. Si un site est protégé, ajouter FlareSolverr (`http://flaresolverr:8191`) en *Indexer Proxy*.
2. **Radarr** → Settings → Download Clients : qBittorrent, hôte `qbittorrent`, port `8090`, catégorie `films`
   (pas de mot de passe nécessaire depuis le réseau Docker).
   Media Management → Root Folders : `/data/media/films`.
3. **Plex** → ajouter une bibliothèque Films sur `/data/media/films`.
4. Ajouter le film dans Radarr → il doit passer par qBittorrent, être rangé dans `media/films`, puis apparaître dans Plex.
5. Redémarrer la machine → tout doit revenir seul.

## Dépannage

```bash
cd ~/Motflix   # ou /opt/motflix
docker compose ps
docker compose logs -f radarr
```

- Journal d'installation : `logs/install.log`. Journal du démarrage automatique (macOS) : `logs/start.log`.
- Linux : `journalctl -u motflix`.
- Plex sur macOS : sans code de liaison (`plex.tv/claim`) à l'installation, le serveur peut refuser d'être réclamé. Récupérez un code, mettez-le dans `PLEX_CLAIM` du `.env`, supprimez `config/plex`, puis relancez `start.sh`.
