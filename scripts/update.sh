#!/usr/bin/env bash
# Met à jour les images Docker et recrée les conteneurs qui ont changé.
set -Eeuo pipefail

INSTALL_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$INSTALL_DIR/lib.sh"
delegate_to_install update.sh "$@"

ensure_docker_running

step "Téléchargement des nouvelles versions"
dc pull --ignore-buildable

step "Reconstruction du panel"
dc build --pull motflix

step "Redémarrage des services mis à jour"
dc up -d --remove-orphans

step "Nettoyage des anciennes images"
dkr image prune -f >/dev/null
ok "Motflix est à jour"
