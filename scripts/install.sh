#!/usr/bin/env bash
# Installe Motflix : Docker si besoin, dossiers, configuration, démarrage automatique.
# Relançable sans risque : la configuration existante est conservée.
#
# Usage : ./scripts/install.sh [options]   (voir --help)
set -Eeuo pipefail

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=lib.sh
. "$REPO_DIR/scripts/lib.sh"

MOTFLIX_VERSION=0.1.0
OS=$(detect_os)

# ─── Options ─────────────────────────────────────────────────────────────
INSTALL_DIR=''
DATA_DIR=''
EXPOSE_TOOLS=0
PANEL_PORT=''
AUTOSTART=1
START=1
RECONFIGURE=0
NO_VPN=0
NO_PLEX=0
ASSUME_YES=0

usage() {
  cat <<EOF
Installe Motflix sur cette machine.

Usage : $0 [options]

  --dir CHEMIN        Dossier d'installation
                      (défaut : ~/Motflix sur macOS, /opt/motflix sur Linux)
  --data-dir CHEMIN   Dossier des médias et téléchargements (défaut : <dossier>/data)
  --port PORT         Port du panel sur le réseau local (défaut : 8080)
  --expose-tools      Rend les interfaces des outils joignables depuis le réseau local
                      (par défaut : seulement depuis cette machine)
  --no-vpn            Ne pas proposer de VPN
  --no-plex           Ne pas installer Plex
  --no-autostart      Ne pas lancer Motflix au démarrage de la machine
  --no-start          Préparer l'installation sans télécharger ni démarrer les services
  --reconfigure       Reposer les questions (VPN, Plex…) même si Motflix est déjà configuré
  -y, --yes           Ne poser aucune question (valeurs par défaut : sans VPN, avec Plex)
  -h, --help          Afficher cette aide
EOF
}

need_arg() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "L'option $1 attend une valeur."; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)          need_arg "$@"; INSTALL_DIR=$2; shift 2 ;;
    --data-dir)     need_arg "$@"; DATA_DIR=$2; shift 2 ;;
    --port)         need_arg "$@"; PANEL_PORT=$2; shift 2 ;;
    --expose-tools) EXPOSE_TOOLS=1; shift ;;
    --no-vpn)       NO_VPN=1; shift ;;
    --no-plex)      NO_PLEX=1; shift ;;
    --no-autostart) AUTOSTART=0; shift ;;
    --no-start)     START=0; shift ;;
    --reconfigure)  RECONFIGURE=1; shift ;;
    -y|--yes)       ASSUME_YES=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "Option inconnue : $1 (voir --help)" ;;
  esac
done
export ASSUME_YES

[ "$OS" != unknown ] || die "Système non pris en charge : $(uname -s). Motflix fonctionne sur macOS et Linux."
case "$PANEL_PORT" in ''|*[!0-9]*) [ -z "$PANEL_PORT" ] || die "Port invalide : $PANEL_PORT" ;; esac
[ "$(id -u)" -ne 0 ] || die "Lancez ce script avec votre utilisateur habituel, sans sudo (il sera demandé si besoin)."

expand_path() {
  # shellcheck disable=SC2088  # on reconnaît ici un « ~ » tapé littéralement
  case "$1" in
    "~")   echo "$HOME" ;;
    "~/"*) echo "$HOME/${1#\~/}" ;;
    /*)    echo "$1" ;;
    *)     echo "$(pwd)/$1" ;;
  esac
}

# Exécute une commande avec sudo seulement si le dossier parent n'est pas accessible en écriture.
mkdir_owned() {
  local dir=$1 parent
  [ -d "$dir" ] && [ -w "$dir" ] && return 0
  parent=$dir
  while [ ! -d "$parent" ]; do parent=$(dirname "$parent"); done
  if [ -w "$parent" ]; then
    mkdir -p "$dir"
  else
    sudo mkdir -p "$dir"
    sudo chown "$(id -u):$(id -g)" "$dir"
  fi
}

printf '\n%s  Motflix — installation%s %s(v%s, %s)%s\n' "$C_BOLD" "$C_RESET" "$C_DIM" "$MOTFLIX_VERSION" "$OS" "$C_RESET"

# ─── 1. Outils de base ───────────────────────────────────────────────────
step "Vérification des outils de base"
missing=''
for cmd in curl openssl awk sed; do
  command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"
done
if [ -n "$missing" ]; then
  if [ "$OS" = linux ] && command -v apt-get >/dev/null 2>&1; then
    info "Installation de :$missing"
    sudo apt-get update -qq
    # shellcheck disable=SC2086
    sudo apt-get install -y -qq $missing
  else
    die "Outils manquants :$missing. Installez-les puis relancez ce script."
  fi
fi
ok "curl, openssl, awk, sed"

# ─── 2. Docker ───────────────────────────────────────────────────────────
DOCKER_RUNTIME=''

install_docker_macos() {
  if docker_detect_access; then
    if docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -q 'Docker Desktop'; then
      DOCKER_RUNTIME=desktop
    elif command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
      DOCKER_RUNTIME=colima
    else
      DOCKER_RUNTIME=other
    fi
    ok "Docker est déjà installé et fonctionne ($DOCKER_RUNTIME)"
    return
  fi

  if [ -d /Applications/Docker.app ]; then
    DOCKER_RUNTIME=desktop
    info "Docker Desktop est installé mais arrêté : démarrage…"
    open -ga Docker
    wait_docker 180 || die "Docker Desktop ne démarre pas. Ouvrez-le à la main puis relancez ce script."
    ok "Docker Desktop est prêt"
    return
  fi

  if command -v colima >/dev/null 2>&1; then
    DOCKER_RUNTIME=colima
    info "Démarrage de Colima…"
    colima start
    wait_docker 120 || die "Colima ne démarre pas (voir : colima status)."
    ok "Colima est prêt"
    return
  fi

  info "Docker n'est pas installé. Motflix va installer Colima, un moteur Docker léger"
  info "et sans interface, via Homebrew."
  ask_yn "Continuer ?" o || die "Installation annulée."

  if ! command -v brew >/dev/null 2>&1; then
    info "Installation de Homebrew (votre mot de passe peut être demandé)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
    command -v brew >/dev/null 2>&1 || die "Homebrew ne s'est pas installé correctement."
  fi

  brew install colima docker docker-compose
  # Rend « docker compose » disponible (plugin installé par Homebrew).
  mkdir -p "$HOME/.docker/cli-plugins"
  ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" "$HOME/.docker/cli-plugins/docker-compose"

  local major
  major=$(sw_vers -productVersion | cut -d. -f1)
  if [ "$major" -ge 13 ]; then
    colima start --cpu 2 --memory 4 --disk 60 --vm-type vz --mount-type virtiofs
  else
    colima start --cpu 2 --memory 4 --disk 60
  fi
  DOCKER_RUNTIME=colima
  wait_docker 120 || die "Colima ne démarre pas (voir : colima status)."
  ok "Colima est installé et démarré"
}

install_docker_linux() {
  if command -v docker >/dev/null 2>&1 && (docker compose version || sudo docker compose version) >/dev/null 2>&1; then
    ok "Docker et Docker Compose sont déjà installés"
  else
    info "Installation de Docker Engine (votre mot de passe peut être demandé)…"
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      ubuntu|debian)
        sudo apt-get update -qq
        sudo apt-get install -y -qq ca-certificates curl
        sudo install -m 0755 -d /etc/apt/keyrings
        sudo curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
        sudo chmod a+r /etc/apt/keyrings/docker.asc
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
          | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
        if ! { sudo apt-get update -qq && sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; }; then
          # Version d'Ubuntu trop récente pour le dépôt Docker : paquets de la distribution.
          warn "Dépôt Docker indisponible pour cette version, utilisation des paquets Ubuntu."
          sudo rm -f /etc/apt/sources.list.d/docker.list
          sudo apt-get update -qq
          sudo apt-get install -y -qq docker.io docker-compose-v2
        fi
        ;;
      *)
        curl -fsSL https://get.docker.com | sudo sh
        ;;
    esac
    ok "Docker est installé"
  fi

  sudo systemctl enable --now docker >/dev/null 2>&1 || true
  if ! id -nG "$(id -un)" | tr ' ' '\n' | grep -qx docker; then
    if sudo usermod -aG docker "$(id -un)"; then
      ok "Utilisateur ajouté au groupe docker (effectif après reconnexion)"
    else
      warn "Impossible d'ajouter l'utilisateur au groupe docker : Motflix utilisera sudo."
    fi
  fi
  DOCKER_RUNTIME=engine
  wait_docker 60 || die "Docker ne répond pas (voir : sudo systemctl status docker)."
  ok "Docker est prêt"
}

step "Docker"
if [ "$OS" = macos ]; then install_docker_macos; else install_docker_linux; fi

# ─── 3. Dossiers ─────────────────────────────────────────────────────────
step "Dossiers"
if [ "$OS" = macos ]; then default_dir="$HOME/Motflix"; else default_dir=/opt/motflix; fi
[ -n "$INSTALL_DIR" ] || ask INSTALL_DIR "Dossier d'installation" "$default_dir"
INSTALL_DIR=$(expand_path "$INSTALL_DIR")
ENV_FILE="$INSTALL_DIR/.env"

HAS_CONFIG=0
[ -f "$ENV_FILE" ] && [ "$RECONFIGURE" = 0 ] && HAS_CONFIG=1

if [ "$HAS_CONFIG" = 1 ]; then
  [ -n "$DATA_DIR" ] || DATA_DIR=$(env_get "$ENV_FILE" DATA_DIR)
else
  [ -n "$DATA_DIR" ] || ask DATA_DIR "Dossier des médias et téléchargements" "$INSTALL_DIR/data"
fi
DATA_DIR=$(expand_path "$DATA_DIR")

# Docker utilise « : » comme séparateur dans les volumes : ces chemins seraient mal lus.
for p in "$INSTALL_DIR" "$DATA_DIR"; do
  case "$p" in *:*) die "Le chemin « $p » contient « : », que Docker ne gère pas. Choisissez un autre dossier." ;; esac
done

if [ "$OS" = macos ] && [ "$DOCKER_RUNTIME" = colima ]; then
  case "$DATA_DIR" in
    "$HOME"/*) ;;
    *) warn "Colima ne partage que votre dossier personnel avec Docker : $DATA_DIR risque d'être inaccessible." ;;
  esac
fi

mkdir_owned "$INSTALL_DIR"
mkdir_owned "$DATA_DIR"
for kind in films series livres livres-audio; do
  mkdir -p "$DATA_DIR/torrents/$kind" "$DATA_DIR/media/$kind"
done
mkdir -p "$INSTALL_DIR/logs"

# À partir d'ici, tout est aussi enregistré dans install.log.
exec > >(tee -a "$INSTALL_DIR/logs/install.log") 2>&1
printf '\n===== %s — install.sh v%s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$MOTFLIX_VERSION" >>"$INSTALL_DIR/logs/install.log"

mkdir -p "$(dirname "$INSTALL_POINTER")"
printf '%s\n' "$INSTALL_DIR" >"$INSTALL_POINTER"

ok "Installation : $INSTALL_DIR"
ok "Médias       : $DATA_DIR"
free_space=$(df -h "$DATA_DIR" | awk 'NR==2 {print $4}')
info "${C_DIM}Espace libre sur ce disque : $free_space${C_RESET}"

# ─── 4. Fichiers de Motflix ──────────────────────────────────────────────
step "Copie des fichiers"
copy() {
  local src=$1 dst=$2
  [ "$src" -ef "$dst" ] && return 0
  cp -f "$src" "$dst"
}
for f in docker-compose.yml compose.plex-host.yml compose.plex-bridge.yml; do
  copy "$REPO_DIR/docker/$f" "$INSTALL_DIR/$f"
done
for f in lib.sh start.sh stop.sh update.sh uninstall.sh apply.sh; do
  copy "$REPO_DIR/scripts/$f" "$INSTALL_DIR/$f"
  chmod +x "$INSTALL_DIR/$f"
done
ok "Services et scripts copiés"

# ─── 5. Configuration (.env) ─────────────────────────────────────────────
VPN_ENABLED=0
VPN_PROVIDER=''; VPN_TYPE=wireguard; VPN_COUNTRIES=''
WIREGUARD_PRIVATE_KEY=''; WIREGUARD_ADDRESSES=''
OPENVPN_USER=''; OPENVPN_PASSWORD=''
VPN_PORT_FORWARDING=off; VPN_PORT_FORWARD_ONLY=off
WG_CONF_FILE=''

ask_vpn() {
  [ "$NO_VPN" = 1 ] && return
  printf '\n'
  info "Un VPN masque votre adresse IP pendant les téléchargements. Facultatif."
  ask_yn "Utiliser un VPN ?" n || return 0
  VPN_ENABLED=1

  info "Fournisseurs :"
  info "  1) ProtonVPN   2) Mullvad    3) Private Internet Access   4) Surfshark"
  info "  5) NordVPN     6) Windscribe 7) IVPN"
  info "  8) Autre, avec un fichier de configuration WireGuard (.conf)"
  local choice
  ask choice "Votre fournisseur (1-8)" 1
  case "$choice" in
    1) VPN_PROVIDER=protonvpn ;;
    2) VPN_PROVIDER=mullvad ;;
    3) VPN_PROVIDER='private internet access'; VPN_TYPE=openvpn ;;
    4) VPN_PROVIDER=surfshark ;;
    5) VPN_PROVIDER=nordvpn ;;
    6) VPN_PROVIDER=windscribe ;;
    7) VPN_PROVIDER=ivpn ;;
    8) VPN_PROVIDER=custom ;;
    *) die "Choix invalide : $choice" ;;
  esac

  if [ "$VPN_PROVIDER" = custom ]; then
    ask WG_CONF_FILE "Chemin du fichier .conf WireGuard"
    WG_CONF_FILE=$(expand_path "$WG_CONF_FILE")
    [ -f "$WG_CONF_FILE" ] || die "Fichier introuvable : $WG_CONF_FILE"
    return 0
  fi

  if [ "$VPN_TYPE" = wireguard ]; then
    local t
    ask t "Protocole : wireguard (recommandé) ou openvpn" wireguard
    [ "$t" = openvpn ] && VPN_TYPE=openvpn
  fi

  if [ "$VPN_TYPE" = wireguard ]; then
    info "Ces informations sont dans l'espace client de votre VPN (configuration WireGuard)."
    ask_secret WIREGUARD_PRIVATE_KEY "Clé privée WireGuard (PrivateKey)"
    [ -n "$WIREGUARD_PRIVATE_KEY" ] || die "La clé privée WireGuard est obligatoire."
    ask WIREGUARD_ADDRESSES "Adresse WireGuard (Address, ex. 10.2.0.2/32 — vide si non fournie)" ''
  else
    ask OPENVPN_USER "Identifiant OpenVPN"
    ask_secret OPENVPN_PASSWORD "Mot de passe OpenVPN"
  fi

  ask VPN_COUNTRIES "Pays des serveurs, en anglais (ex. Switzerland,Netherlands — vide = tous)" ''

  info "Le « port forwarding » améliore le partage. Aucun port à ouvrir sur votre box :"
  info "c'est votre fournisseur VPN qui l'ouvre. Compatible : ProtonVPN (offre payante),"
  info "Private Internet Access, PrivateVPN, Perfect Privacy."
  if ask_yn "Activer le port forwarding ?" n; then
    VPN_PORT_FORWARDING=on
    case "$VPN_PROVIDER" in protonvpn|'private internet access') VPN_PORT_FORWARD_ONLY=on ;; esac
  fi
}

PLEX_ENABLED=1
ask_plex() {
  if [ "$NO_PLEX" = 1 ]; then PLEX_ENABLED=0; return; fi
  printf '\n'
  ask_yn "Installer Plex pour regarder sur la télé ?" o || PLEX_ENABLED=0
}

# Port du panel : celui demandé, sinon 8080 ou le premier port libre après lui.
choose_panel_port() {
  local p
  if [ -n "$PANEL_PORT" ]; then echo "$PANEL_PORT"; return; fi
  p=$(free_port 8080)
  [ "$p" != 8080 ] && warn "Le port 8080 est déjà utilisé : le panel utilisera le port $p." >&2
  echo "$p"
}

step "Configuration"
if [ "$HAS_CONFIG" = 1 ]; then
  ok "Configuration existante conservée (--reconfigure pour la refaire)"
  [ "$EXPOSE_TOOLS" = 1 ] && env_set "$ENV_FILE" TOOLS_BIND 0.0.0.0
  [ "$NO_PLEX" = 1 ] && warn "--no-plex ignoré : utilisez --reconfigure pour changer ce choix."
  env_set "$ENV_FILE" MOTFLIX_VERSION "$MOTFLIX_VERSION"
  env_set "$ENV_FILE" DOCKER_RUNTIME "$DOCKER_RUNTIME"
  # Ajouts des versions récentes, absents des installations plus anciennes.
  env_set "$ENV_FILE" MOTFLIX_SRC "$REPO_DIR"
  env_set "$ENV_FILE" MOTFLIX_DIR "$INSTALL_DIR"
  if [ -n "$PANEL_PORT" ] || [ -z "$(env_get "$ENV_FILE" PANEL_PORT)" ]; then
    env_set "$ENV_FILE" PANEL_PORT "$(choose_panel_port)"
  fi
else
  ask_vpn
  ask_plex

  if [ "$VPN_ENABLED" = 1 ]; then profiles=vpn; else profiles=novpn; fi
  [ "$PLEX_ENABLED" = 1 ] && profiles="$profiles,plex"
  if [ "$OS" = linux ]; then plex_file=compose.plex-host.yml; else plex_file=compose.plex-bridge.yml; fi
  if [ "$EXPOSE_TOOLS" = 1 ]; then bind=0.0.0.0; else bind=127.0.0.1; fi

  # On garde les clés et mots de passe déjà générés en cas de --reconfigure.
  keep() { local v; v=$(env_get "$ENV_FILE" "$1"); if [ -n "$v" ]; then echo "$v"; else echo "$2"; fi; }
  RADARR_API_KEY=$(keep RADARR_API_KEY "$(gen_hex 16)")
  SONARR_API_KEY=$(keep SONARR_API_KEY "$(gen_hex 16)")
  PROWLARR_API_KEY=$(keep PROWLARR_API_KEY "$(gen_hex 16)")
  LAZYLIBRARIAN_API_KEY=$(keep LAZYLIBRARIAN_API_KEY "$(gen_hex 16)")
  QBITTORRENT_PASSWORD=$(keep QBITTORRENT_PASSWORD "$(gen_hex 8)")

  tmp_env=$(mktemp)
  cat >"$tmp_env" <<EOF
# Motflix — généré par install.sh le $(date '+%Y-%m-%d %H:%M').
# Contient des secrets : ne pas partager. Modifiable à la main, puis relancer start.sh.
EOF
  {
    env_set "$tmp_env" MOTFLIX_VERSION "$MOTFLIX_VERSION"
    env_set "$tmp_env" DOCKER_RUNTIME "$DOCKER_RUNTIME"
    env_set "$tmp_env" COMPOSE_FILE "docker-compose.yml:$plex_file"
    env_set "$tmp_env" COMPOSE_PROFILES "$profiles"
    env_set "$tmp_env" PUID "$(id -u)"
    env_set "$tmp_env" PGID "$(id -g)"
    env_set "$tmp_env" TZ "$(detect_tz)"
    env_set "$tmp_env" DATA_DIR "$DATA_DIR"
    env_set "$tmp_env" MOTFLIX_SRC "$REPO_DIR"
    env_set "$tmp_env" MOTFLIX_DIR "$INSTALL_DIR"
    env_set "$tmp_env" PANEL_PORT "$(choose_panel_port)"
    env_set "$tmp_env" TOOLS_BIND "$bind"
    env_set "$tmp_env" TORRENT_PORT 6881
    env_set "$tmp_env" RADARR_API_KEY "$RADARR_API_KEY"
    env_set "$tmp_env" SONARR_API_KEY "$SONARR_API_KEY"
    env_set "$tmp_env" PROWLARR_API_KEY "$PROWLARR_API_KEY"
    env_set "$tmp_env" LAZYLIBRARIAN_API_KEY "$LAZYLIBRARIAN_API_KEY"
    env_set "$tmp_env" QBITTORRENT_USER admin
    env_set "$tmp_env" QBITTORRENT_PASSWORD "$QBITTORRENT_PASSWORD"
    env_set "$tmp_env" VPN_PROVIDER "$VPN_PROVIDER"
    env_set "$tmp_env" VPN_TYPE "$VPN_TYPE"
    env_set "$tmp_env" VPN_COUNTRIES "$VPN_COUNTRIES"
    env_set "$tmp_env" WIREGUARD_PRIVATE_KEY "$WIREGUARD_PRIVATE_KEY"
    env_set "$tmp_env" WIREGUARD_ADDRESSES "$WIREGUARD_ADDRESSES"
    env_set "$tmp_env" OPENVPN_USER "$OPENVPN_USER"
    env_set "$tmp_env" OPENVPN_PASSWORD "$OPENVPN_PASSWORD"
    env_set "$tmp_env" VPN_PORT_FORWARDING "$VPN_PORT_FORWARDING"
    env_set "$tmp_env" VPN_PORT_FORWARD_ONLY "$VPN_PORT_FORWARD_ONLY"
    env_set "$tmp_env" PLEX_CLAIM ''
  }
  cat "$tmp_env" >"$ENV_FILE"
  rm -f "$tmp_env"
  chmod 600 "$ENV_FILE"
  ok "Configuration enregistrée dans .env"

  if [ -n "$WG_CONF_FILE" ]; then
    mkdir -p "$INSTALL_DIR/config/gluetun/wireguard"
    cp "$WG_CONF_FILE" "$INSTALL_DIR/config/gluetun/wireguard/wg0.conf"
    chmod 600 "$INSTALL_DIR/config/gluetun/wireguard/wg0.conf"
    ok "Fichier WireGuard copié"
  fi
fi

# ─── 6. Préconfiguration des outils ──────────────────────────────────────
# Écrite seulement au premier lancement : les outils reprennent ensuite la main.
step "Préconfiguration des outils"
CONFIG_DIR="$INSTALL_DIR/config"
mkdir -p "$CONFIG_DIR/motflix/agent/queue" && chmod 700 "$CONFIG_DIR/motflix/agent"
mkdir -p "$CONFIG_DIR"/{motflix,radarr,sonarr,prowlarr,lazylibrarian,qbittorrent/qBittorrent,gluetun,plex} \
         "$CONFIG_DIR/audiobookshelf/config" "$CONFIG_DIR/audiobookshelf/metadata"

seed_arr() {
  local name=$2 port=$3 key=$4 file="$CONFIG_DIR/$1/config.xml"
  if [ -f "$file" ]; then info "${C_DIM}$name : configuration existante conservée${C_RESET}"; return; fi
  cat >"$file" <<EOF
<Config>
  <BindAddress>*</BindAddress>
  <Port>$port</Port>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>$key</ApiKey>
  <AuthenticationMethod>Forms</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
  <LogLevel>info</LogLevel>
  <UrlBase></UrlBase>
  <InstanceName>$name</InstanceName>
  <AnalyticsEnabled>False</AnalyticsEnabled>
</Config>
EOF
  ok "$name : clé API préparée"
}
seed_arr radarr Radarr 7878 "$(env_get "$ENV_FILE" RADARR_API_KEY)"
seed_arr sonarr Sonarr 8989 "$(env_get "$ENV_FILE" SONARR_API_KEY)"
seed_arr prowlarr Prowlarr 9696 "$(env_get "$ENV_FILE" PROWLARR_API_KEY)"

qbt_conf="$CONFIG_DIR/qbittorrent/qBittorrent/qBittorrent.conf"
if [ -f "$qbt_conf" ]; then
  info "${C_DIM}qBittorrent : configuration existante conservée${C_RESET}"
else
  qbt_pass=$(env_get "$ENV_FILE" QBITTORRENT_PASSWORD)
  qbt_hash=''
  if command -v python3 >/dev/null 2>&1; then
    # Même format que qBittorrent : PBKDF2-SHA512, 100 000 itérations, sel de 16 octets.
    qbt_hash=$(python3 - "$qbt_pass" <<'PY'
import base64, hashlib, os, sys
salt = os.urandom(16)
digest = hashlib.pbkdf2_hmac("sha512", sys.argv[1].encode(), salt, 100000, 64)
print("@ByteArray(%s:%s)" % (base64.b64encode(salt).decode(), base64.b64encode(digest).decode()))
PY
) || qbt_hash=''
  fi
  {
    echo '[BitTorrent]'
    echo 'Session\DefaultSavePath=/data/torrents'
    echo 'Session\TempPathEnabled=false'
    # Gestion automatique : chaque catégorie (films, series…) a son sous-dossier dans /data/torrents.
    echo 'Session\DisableAutoTMMByDefault=false'
    echo "Session\\Port=$(env_get "$ENV_FILE" TORRENT_PORT)"
    echo 'Session\QueueingSystemEnabled=true'
    echo 'Session\MaxActiveDownloads=3'
    echo 'Session\GlobalMaxRatio=1'
    echo 'Session\GlobalMaxSeedingMinutes=4320'
    echo ''
    echo '[LegalNotice]'
    echo 'Accepted=true'
    echo ''
    echo '[Preferences]'
    echo 'Connection\UPnP=true'
    echo 'WebUI\Port=8090'
    echo 'WebUI\Username=admin'
    [ -n "$qbt_hash" ] && echo "WebUI\\Password_PBKDF2=\"$qbt_hash\""
    # Pas de mot de passe depuis le conteneur lui-même (utilisé par le VPN pour régler le port)
    # ni depuis les autres conteneurs Motflix (Radarr, Sonarr… et plus tard le panel).
    # Cette plage exclut la passerelle Docker : depuis l'hôte ou le réseau local, mot de passe exigé.
    echo 'WebUI\LocalHostAuth=false'
    echo 'WebUI\AuthSubnetWhitelistEnabled=true'
    echo 'WebUI\AuthSubnetWhitelist=172.31.250.128/25'
    echo 'WebUI\HostHeaderValidation=false'
  } >"$qbt_conf"
  if [ -n "$qbt_hash" ]; then
    ok "qBittorrent : identifiants préparés"
  else
    env_set "$ENV_FILE" QBITTORRENT_PASSWORD ''
    warn "python3 absent : le mot de passe temporaire de qBittorrent sera dans « docker logs motflix-qbittorrent »."
  fi
fi

ll_conf="$CONFIG_DIR/lazylibrarian/config.ini"
if [ -f "$ll_conf" ]; then
  info "${C_DIM}LazyLibrarian : configuration existante conservée${C_RESET}"
else
  cat >"$ll_conf" <<EOF
[General]
http_port = 5299
api_enabled = 1
api_key = $(env_get "$ENV_FILE" LAZYLIBRARIAN_API_KEY)
EOF
  ok "LazyLibrarian : clé API préparée"
fi

# ─── 7. Démarrage automatique ────────────────────────────────────────────
sed_escape() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
render() {
  sed -e "s|@INSTALL_DIR@|$(sed_escape "$INSTALL_DIR")|g" \
      -e "s|@USER@|$(sed_escape "$(id -un)")|g" \
      -e "s|@HOME@|$(sed_escape "$HOME")|g" "$1"
}

step "Démarrage automatique"
if [ "$AUTOSTART" = 0 ]; then
  info "Ignoré (--no-autostart)"
elif [ "$OS" = linux ]; then
  render "$REPO_DIR/scripts/autostart/motflix.service" | sudo tee /etc/systemd/system/motflix.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable motflix.service >/dev/null 2>&1
  ok "Service systemd « motflix » activé au démarrage"
else
  plist="$HOME/Library/LaunchAgents/fr.motflix.start.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  render "$REPO_DIR/scripts/autostart/fr.motflix.start.plist" >"$plist"
  plutil -lint "$plist" >/dev/null || die "Fichier de démarrage automatique invalide : $plist"
  ok "Motflix démarrera à l'ouverture de votre session"
  if [ "$DOCKER_RUNTIME" = desktop ]; then
    info "${C_DIM}Docker Desktop sera lancé automatiquement s'il ne l'est pas déjà.${C_RESET}"
  fi
fi

# ─── 8. Agent du panel (VPN) ─────────────────────────────────────────────
# Toujours installé, même sans démarrage automatique : c'est lui qui applique
# les changements de VPN demandés depuis le panel.
step "Agent du panel"
agent_marker="$CONFIG_DIR/motflix/agent/installed"
rm -f "$agent_marker"
if [ "$OS" = linux ]; then
  render "$REPO_DIR/scripts/autostart/motflix-agent.path" | sudo tee /etc/systemd/system/motflix-agent.path >/dev/null
  render "$REPO_DIR/scripts/autostart/motflix-agent.service" | sudo tee /etc/systemd/system/motflix-agent.service >/dev/null
  sudo systemctl daemon-reload
  if sudo systemctl enable --now motflix-agent.path >/dev/null 2>&1; then
    printf 'systemd %s\n' "$(date '+%Y-%m-%d %H:%M')" >"$agent_marker"
    ok "Agent actif (systemd)"
  else
    warn "Agent non démarré : le VPN se changera avec $INSTALL_DIR/apply.sh"
  fi
else
  agent_plist="$HOME/Library/LaunchAgents/fr.motflix.agent.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  render "$REPO_DIR/scripts/autostart/fr.motflix.agent.plist" >"$agent_plist"
  launchctl bootout "gui/$(id -u)/fr.motflix.agent" >/dev/null 2>&1 || true
  if plutil -lint "$agent_plist" >/dev/null && launchctl bootstrap "gui/$(id -u)" "$agent_plist" 2>/dev/null; then
    printf 'launchd %s\n' "$(date '+%Y-%m-%d %H:%M')" >"$agent_marker"
    ok "Agent actif (launchd)"
  else
    warn "Agent non démarré : le VPN se changera avec $INSTALL_DIR/apply.sh"
  fi
fi

# ─── 9. Téléchargement des images et démarrage ───────────────────────────
INSTALL_PROFILES=",$(env_get "$ENV_FILE" COMPOSE_PROFILES),"

if [ "$START" = 0 ]; then
  step "Démarrage"
  info "Ignoré (--no-start). Pour lancer Motflix : $INSTALL_DIR/start.sh"
  printf '\n'
else
  step "Téléchargement des services (plusieurs Go la première fois, patience)"
  docker_detect_access || die "Docker ne répond plus."
  dc pull --ignore-buildable

  step "Construction du panel"
  dc build motflix
  ok "Panel construit"

  # Le code Plex expire en 4 minutes : on le demande juste avant de démarrer.
  case "$INSTALL_PROFILES" in
    *,plex,*)
      if [ ! -d "$CONFIG_DIR/plex/Library" ]; then
        printf '\n'
        info "Pour relier Plex à votre compte : ouvrez ${C_BOLD}https://plex.tv/claim${C_RESET}, connecté à Plex,"
        info "et copiez le code affiché (valable 4 minutes)."
        ask claim "Code Plex (vide = lier plus tard)" ''
        if [ -n "$claim" ]; then env_set "$ENV_FILE" PLEX_CLAIM "$claim"; fi
      fi
      ;;
  esac

  "$INSTALL_DIR/start.sh"
fi

# ─── Résumé ──────────────────────────────────────────────────────────────
printf '%s  Installation terminée.%s\n\n' "$C_BOLD$C_GREEN" "$C_RESET"
info "Ouvrez le panel : ${C_BOLD}http://$(lan_ip):$(env_get "$ENV_FILE" PANEL_PORT)${C_RESET}"
info "(au premier accès, il vous demande de créer le compte administrateur)"
info ""
qbt_pass=$(env_get "$ENV_FILE" QBITTORRENT_PASSWORD)
if [ -n "$qbt_pass" ]; then
  info "qBittorrent : utilisateur ${C_BOLD}admin${C_RESET}, mot de passe ${C_BOLD}$qbt_pass${C_RESET}"
fi
info "Clés API et réglages : $ENV_FILE"
info ""
info "Commandes utiles :"
info "  $INSTALL_DIR/start.sh       démarrer"
info "  $INSTALL_DIR/stop.sh        arrêter"
info "  $INSTALL_DIR/update.sh      mettre à jour"
info "  $INSTALL_DIR/uninstall.sh   désinstaller (vos médias sont conservés)"
if [ "$OS" = linux ] && ! id -nG | tr ' ' '\n' | grep -qx docker; then
  info ""
  warn "Déconnectez-vous puis reconnectez-vous pour utiliser « docker » sans sudo."
fi
printf '\n'
