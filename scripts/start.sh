#!/usr/bin/env bash
# Démarre Motflix : moteur Docker, conteneurs, puis vérifie que chaque service répond.
# Lancé à la main ou automatiquement au démarrage de la machine.
set -Eeuo pipefail

INSTALL_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$INSTALL_DIR/lib.sh"

delegate_to_install start.sh "$@"
ENV_FILE="$INSTALL_DIR/.env"

TIMEOUT=${MOTFLIX_START_TIMEOUT:-240}

step "Moteur Docker"
ensure_docker_running
ok "Docker est prêt"

step "Démarrage des services"
dc up -d --remove-orphans
ok "Conteneurs lancés"

# ─── Vérification ────────────────────────────────────────────────────────
profiles=",$(env_get "$ENV_FILE" COMPOSE_PROFILES),"
has_profile() { case "$profiles" in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

panel_port=$(env_get "$ENV_FILE" PANEL_PORT)
panel_port=${panel_port:-8080}

# nom|url  (toute réponse HTTP compte : le service écoute)
checks="Panel Motflix|http://127.0.0.1:$panel_port/api/health
Films (Radarr)|http://127.0.0.1:7878/ping
Séries (Sonarr)|http://127.0.0.1:8989/ping
Sites d'indexation (Prowlarr)|http://127.0.0.1:9696/ping
Anti-bot (FlareSolverr)|http://127.0.0.1:8191/
Livres (LazyLibrarian)|http://127.0.0.1:5299/
Livres audio (Audiobookshelf)|http://127.0.0.1:13378/healthcheck
Téléchargement (qBittorrent)|http://127.0.0.1:8090/"
has_profile plex && checks="$checks
Lecture (Plex)|http://127.0.0.1:32400/identity"

http_up() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != 000 ]
}

step "Vérification des services (jusqu'à $((TIMEOUT / 60)) min au premier démarrage)"

if has_profile vpn; then
  i=0
  until [ "$(dkr inspect -f '{{.State.Health.Status}}' motflix-gluetun 2>/dev/null)" = healthy ]; do
    [ "$i" -ge "$TIMEOUT" ] && break
    sleep 3; i=$((i + 3))
  done
  if [ "$(dkr inspect -f '{{.State.Health.Status}}' motflix-gluetun 2>/dev/null)" = healthy ]; then
    ok "VPN connecté"
  else
    warn "Le VPN ne se connecte pas : qBittorrent reste coupé du réseau (aucune fuite)."
    warn "Voir les logs : docker logs motflix-gluetun"
  fi
fi

failed=0
deadline=$(( $(date +%s) + TIMEOUT ))
while IFS='|' read -r name url; do
  until http_up "$url"; do
    [ "$(date +%s)" -ge "$deadline" ] && break
    sleep 3
  done
  if http_up "$url"; then ok "$name"; else warn "$name ne répond pas"; failed=$((failed + 1)); fi
done <<EOF
$checks
EOF

# Le code de liaison Plex ne sert qu'une fois (et expire en 4 minutes).
if has_profile plex && [ -n "$(env_get "$ENV_FILE" PLEX_CLAIM)" ] && http_up http://127.0.0.1:32400/identity; then
  env_set "$ENV_FILE" PLEX_CLAIM ''
fi

# ─── Résumé ──────────────────────────────────────────────────────────────
ip=$(lan_ip)
bind=$(env_get "$ENV_FILE" TOOLS_BIND)
[ "$bind" = 127.0.0.1 ] && host=localhost || host=$ip

printf '\n'
if [ "$failed" -eq 0 ]; then
  printf '%s✓ Motflix est prêt.%s\n\n' "$C_BOLD$C_GREEN" "$C_RESET"
else
  printf '%s! Motflix a démarré, mais %s service(s) ne répondent pas encore.%s\n' "$C_BOLD$C_YELLOW" "$failed" "$C_RESET"
  printf '  Voir : docker compose --project-directory "%s" logs <service>\n\n' "$INSTALL_DIR"
fi
printf '  %sPanel Motflix   http://%s:%s%s\n\n' "$C_BOLD" "$ip" "$panel_port" "$C_RESET"
printf '  %sInterfaces d'"'"'origine :%s\n' "$C_DIM" "$C_RESET"
printf '  Films           http://%s:7878\n' "$host"
printf '  Séries          http://%s:8989\n' "$host"
printf '  Indexeurs       http://%s:9696\n' "$host"
printf '  Téléchargement  http://%s:8090\n' "$host"
printf '  Livres          http://%s:5299\n' "$host"
printf '  Livres audio    http://%s:13378\n' "$ip"
has_profile plex && printf '  Plex            http://%s:32400/web\n' "$ip"
[ "$bind" = 127.0.0.1 ] && printf '\n  %sLes outils ne sont joignables que depuis cette machine (TOOLS_BIND=127.0.0.1).%s\n' "$C_DIM" "$C_RESET"
printf '\n'
exit 0
