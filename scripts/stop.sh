#!/usr/bin/env bash
# Arrête proprement tous les services Motflix (les données sont conservées).
set -Eeuo pipefail

INSTALL_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$INSTALL_DIR/lib.sh"
delegate_to_install stop.sh "$@"

docker_detect_access || { info "Docker ne tourne pas : rien à arrêter."; exit 0; }
step "Arrêt des services"
dc stop
ok "Motflix est arrêté"
