#!/usr/bin/env bash
# Désinstalle Motflix. Par défaut, vos médias et téléchargements sont conservés.
#
# Usage : ./uninstall.sh [--purge-data] [-y]
set -Eeuo pipefail

INSTALL_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$INSTALL_DIR/lib.sh"
delegate_to_install uninstall.sh "$@"

PURGE_DATA=0
ASSUME_YES=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge-data) PURGE_DATA=1; shift ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    -h|--help)    echo "Usage : $0 [--purge-data] [-y]"; exit 0 ;;
    *)            die "Option inconnue : $1" ;;
  esac
done
export ASSUME_YES

OS=$(detect_os)
ENV_FILE="$INSTALL_DIR/.env"
DATA_DIR=$(env_get "$ENV_FILE" DATA_DIR)

# Supprime un dossier en refusant les chemins dangereux ; sudo si des fichiers
# appartiennent à root (créés par certains conteneurs).
safe_rm() {
  local target=$1
  case "$target" in
    ''|/|/home|/Users|/opt|/srv|/mnt|/media|"$HOME"|"$HOME/") die "Refus de supprimer « $target »." ;;
  esac
  [ -e "$target" ] || return 0
  rm -rf "$target" 2>/dev/null || { [ "$OS" = linux ] && sudo rm -rf "$target"; }
}

printf '\n%s  Désinstallation de Motflix%s (%s)\n' "$C_BOLD" "$C_RESET" "$INSTALL_DIR"
ask_yn "Arrêter et retirer Motflix de cette machine ?" n || { info "Annulé."; exit 0; }

# ─── Conteneurs ──────────────────────────────────────────────────────────
step "Conteneurs"
if docker_detect_access; then
  if ask_yn "Supprimer aussi les images Docker (libère plusieurs Go) ?" o; then
    dc down --remove-orphans --rmi all
  else
    dc down --remove-orphans
  fi
  ok "Conteneurs retirés"
else
  warn "Docker ne tourne pas : conteneurs non retirés (lancez Docker puis relancez ce script)."
fi

# ─── Démarrage automatique ───────────────────────────────────────────────
step "Démarrage automatique"
if [ "$OS" = linux ]; then
  if [ -f /etc/systemd/system/motflix-agent.path ]; then
    sudo systemctl disable --now motflix-agent.path >/dev/null 2>&1 || true
    sudo rm -f /etc/systemd/system/motflix-agent.path /etc/systemd/system/motflix-agent.service
  fi
  if [ -f /etc/systemd/system/motflix.service ]; then
    sudo systemctl disable motflix.service >/dev/null 2>&1 || true
    sudo rm -f /etc/systemd/system/motflix.service
    sudo systemctl daemon-reload
  fi
else
  launchctl bootout "gui/$(id -u)/fr.motflix.agent" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/fr.motflix.agent.plist"
  plist="$HOME/Library/LaunchAgents/fr.motflix.start.plist"
  if [ -f "$plist" ]; then
    launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
  fi
fi
ok "Retiré"

# ─── Configuration ───────────────────────────────────────────────────────
step "Configuration"
if ask_yn "Supprimer aussi la configuration des outils (réglages, clés, historique) ?" n; then
  safe_rm "$INSTALL_DIR/config"
  rm -f "$ENV_FILE"
  for f in docker-compose.yml compose.plex-host.yml compose.plex-bridge.yml start.sh stop.sh update.sh apply.sh lib.sh; do
    rm -f "$INSTALL_DIR/$f"
  done
  safe_rm "$INSTALL_DIR/logs"
  rm -f "$INSTALL_POINTER"
  ok "Configuration supprimée"
  CONFIG_REMOVED=1
else
  info "Conservée dans $INSTALL_DIR (une réinstallation la réutilisera)."
  CONFIG_REMOVED=0
fi

# ─── Médias ──────────────────────────────────────────────────────────────
step "Médias et téléchargements"
if [ "$PURGE_DATA" = 1 ] && [ -n "$DATA_DIR" ]; then
  warn "Vous allez supprimer DÉFINITIVEMENT : $DATA_DIR"
  confirm=''
  [ "$ASSUME_YES" = 1 ] || ask confirm "Tapez SUPPRIMER pour confirmer" ''
  if [ "$confirm" = SUPPRIMER ]; then
    safe_rm "$DATA_DIR"
    ok "Médias supprimés"
  else
    info "Non confirmé : médias conservés dans $DATA_DIR"
  fi
else
  ok "Conservés dans ${DATA_DIR:-<inconnu>}"
fi

if [ "$CONFIG_REMOVED" = 1 ]; then
  rm -f "$INSTALL_DIR/uninstall.sh"
  rmdir "$INSTALL_DIR" 2>/dev/null || true
fi
printf '\n%s  Motflix est désinstallé.%s\n\n' "$C_BOLD$C_GREEN" "$C_RESET"
