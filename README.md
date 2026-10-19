# Motflix

Panel d'administration web qui réunit les outils de téléchargement et de gestion de médias
(films, séries, livres, livres audio) dans une seule interface.

- Cahier des charges : [docs/cahier-des-charges.md](docs/cahier-des-charges.md)
- Maquette : [docs/maquette/index.html](docs/maquette/index.html)

**État : phase 0** — la stack de services s'installe et démarre seule. Le panel arrive en phase 1 ;
en attendant, chaque outil se règle dans sa propre interface.

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

## Services

| Service | Rôle | Adresse |
|---|---|---|
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

## Scripts de développement

En attendant l'assistant (phase 2), deux scripts font les liaisons par API :

| Script | Rôle |
|---|---|
| `scripts/dev/wire-radarr.py` | Radarr ↔ qBittorrent, Prowlarr → Radarr, dossier racine, renommage, hardlinks |
| `scripts/dev/plex-link.py claim-…` | Lie Plex au compte (code `plex.tv/claim`), crée la bibliothèque Films, branche Radarr dessus |

## Test de la phase 0 (réglages à la main)

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
