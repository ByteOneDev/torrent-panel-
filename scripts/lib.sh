#!/usr/bin/env bash
# Fonctions communes aux scripts Motflix.
# Compatible bash 3.2 (celui de macOS) : pas de tableaux associatifs, pas de ${var,,}.

# Docker Desktop installe sa CLI dans ~/.docker/bin ; Homebrew dans /opt/homebrew ou /usr/local.
# Utile quand le script est lancé au démarrage, avec un PATH minimal.
export PATH="$HOME/.docker/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

step() { printf '\n%s▸ %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '\n%s✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }

# ─── Emplacement de l'installation ───────────────────────────────────────
# Fichier écrit par install.sh pour retrouver l'installation depuis n'importe où.
INSTALL_POINTER="$HOME/.config/motflix/install-dir"

# Si le script est lancé depuis le dossier du projet (sans .env à côté), on retrouve
# l'installation et on y relance le même script, avec les mêmes arguments.
# Usage : delegate_to_install start.sh "$@"
delegate_to_install() {
  local script=$1 d pointed=''
  shift
  [ -f "$INSTALL_DIR/.env" ] && return 0
  [ -r "$INSTALL_POINTER" ] && pointed=$(cat "$INSTALL_POINTER")
  for d in "${MOTFLIX_DIR:-}" "$pointed" "$HOME/Motflix" /opt/motflix; do
    [ -n "$d" ] && [ -f "$d/.env" ] && [ -x "$d/$script" ] || continue
    [ "$d" -ef "$INSTALL_DIR" ] && continue
    info "${C_DIM}Installation trouvée : $d${C_RESET}"
    # shellcheck disable=SC2093  # voulu : le script de l'installation remplace celui-ci
    exec "$d/$script" "$@"
  done
  die "Motflix n'est pas encore installé sur cette machine. Lancez d'abord scripts/install.sh."
}

# ─── Questions ───────────────────────────────────────────────────────────
# Les réponses sont lues sur le terminal, même si le script est lancé via un pipe.
# En mode non interactif (ASSUME_YES=1), la valeur par défaut est prise.

# ask VAR "Question" "défaut"
ask() {
  local __var=$1 __q=$2 __def=${3:-} __ans=''
  if [ "${ASSUME_YES:-0}" = 1 ] || [ ! -r /dev/tty ]; then
    __ans=$__def
  else
    if [ -n "$__def" ]; then
      printf '  %s %s[%s]%s : ' "$__q" "$C_DIM" "$__def" "$C_RESET" >/dev/tty
    else
      printf '  %s : ' "$__q" >/dev/tty
    fi
    IFS= read -r __ans </dev/tty || true
    [ -z "$__ans" ] && __ans=$__def
  fi
  printf -v "$__var" '%s' "$__ans"
}

# ask_secret VAR "Question"
ask_secret() {
  local __var=$1 __q=$2 __ans=''
  if [ "${ASSUME_YES:-0}" = 1 ] || [ ! -r /dev/tty ]; then
    __ans=''
  else
    printf '  %s : ' "$__q" >/dev/tty
    IFS= read -rs __ans </dev/tty || true
    printf '\n' >/dev/tty
  fi
  printf -v "$__var" '%s' "$__ans"
}

# ask_yn "Question" o|n  → code de retour 0 pour oui
ask_yn() {
  # Nom de variable distinct de ceux de ask(), sinon printf -v écrirait dans la mauvaise.
  local __yn_q=$1 __yn_def=${2:-o} __yn=''
  ask __yn "$__yn_q (o/n)" "$__yn_def"
  case "$__yn" in o|O|oui|Oui|OUI|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# ─── Système ─────────────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)  echo linux ;;
    *)      echo unknown ;;
  esac
}

detect_tz() {
  local tz=''
  if [ -L /etc/localtime ]; then
    tz=$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')
  fi
  if [ -z "$tz" ] && command -v timedatectl >/dev/null 2>&1; then
    tz=$(timedatectl show -p Timezone --value 2>/dev/null || true)
  fi
  [ -z "$tz" ] && [ -r /etc/timezone ] && tz=$(cat /etc/timezone)
  # Certains liens contiennent « // » : on retire les barres en trop.
  while [ "${tz#/}" != "$tz" ]; do tz=${tz#/}; done
  case "$tz" in
    [A-Za-z]*) echo "$tz" ;;
    *)         echo Europe/Paris ;;
  esac
}

lan_ip() {
  local ip=''
  if [ "$(detect_os)" = macos ]; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  else
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  echo "${ip:-127.0.0.1}"
}

gen_hex() { openssl rand -hex "${1:-16}"; }

# ─── Fichier .env ────────────────────────────────────────────────────────
# Les valeurs sont écrites entre apostrophes : lues telles quelles par Docker Compose.
# Le fichier n'est jamais « sourcé » par bash, on le lit avec env_get.

# env_get FICHIER CLE
env_get() {
  [ -f "$1" ] || return 0
  awk -v k="$2" '
    index($0, k "=") == 1 {
      v = substr($0, length(k) + 2)
      if (v ~ /^'\''.*'\''$/ || v ~ /^".*"$/) v = substr(v, 2, length(v) - 2)
      print v; exit
    }' "$1"
}

# env_set FICHIER CLE VALEUR
env_set() {
  local file=$1 key=$2 val=$3 tmp
  case "$val" in *"'"*) die "La valeur de $key contient une apostrophe ('), ce n'est pas pris en charge." ;; esac
  tmp=$(mktemp)
  if [ -f "$file" ] && grep -q "^$key=" "$file"; then
    awk -v k="$key" -v line="$key='$val'" 'index($0, k "=") == 1 { print line; next } { print }' "$file" >"$tmp"
  else
    [ -f "$file" ] && cat "$file" >"$tmp"
    printf "%s='%s'\n" "$key" "$val" >>"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

# ─── Docker ──────────────────────────────────────────────────────────────

# Sur Linux, juste après l'installation, l'utilisateur n'est pas encore dans le groupe
# « docker » pour la session en cours : on passe alors par sudo.
DOCKER_SUDO=0
docker_detect_access() {
  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=0
  elif [ "$(detect_os)" = linux ] && sudo -n true 2>/dev/null && sudo docker info >/dev/null 2>&1; then
    DOCKER_SUDO=1
  elif [ "$(detect_os)" = linux ] && [ -t 0 ] && sudo docker info >/dev/null 2>&1; then
    DOCKER_SUDO=1
  else
    return 1
  fi
}

dkr() {
  if [ "$DOCKER_SUDO" = 1 ]; then sudo docker "$@"; else docker "$@"; fi
}

# Docker Compose dans le dossier d'installation (pour lire .env et COMPOSE_FILE).
dc() {
  (cd "$INSTALL_DIR" && dkr compose "$@")
}

# Attend que le démon Docker réponde (secondes max).
wait_docker() {
  local max=${1:-120} i=0
  while [ "$i" -lt "$max" ]; do
    docker_detect_access && return 0
    sleep 2; i=$((i + 2))
  done
  return 1
}

# Démarre le moteur Docker si besoin (Docker Desktop, Colima ou service Linux).
ensure_docker_running() {
  docker_detect_access && return 0
  local runtime
  runtime=$(env_get "$INSTALL_DIR/.env" DOCKER_RUNTIME)
  case "$(detect_os)/$runtime" in
    macos/colima)
      info "Démarrage de Colima…"
      colima start >/dev/null 2>&1 || colima start
      ;;
    macos/*)
      info "Démarrage de Docker Desktop…"
      open -ga Docker 2>/dev/null || open -a Docker
      ;;
    linux/*)
      info "Démarrage du service Docker…"
      sudo systemctl start docker 2>/dev/null || true
      ;;
  esac
  wait_docker 180 || die "Docker ne répond pas. Lancez-le à la main puis relancez ce script."
}
