#!/usr/bin/env bash
# Applique une demande déposée par le panel (aujourd'hui : activer ou couper le VPN).
#
# Le panel n'a pas le droit de recréer des conteneurs : il écrit sa demande dans
# config/motflix/agent/queue/request.env. Ce script, lancé automatiquement par
# launchd (macOS) ou systemd (Linux) dès qu'une demande arrive — ou à la main —,
# met à jour le .env, recrée les conteneurs concernés et écrit le résultat pour le panel.
set -Eeuo pipefail

INSTALL_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$INSTALL_DIR/lib.sh"
delegate_to_install apply.sh "$@"

ENV_FILE="$INSTALL_DIR/.env"
AGENT_DIR="$INSTALL_DIR/config/motflix/agent"
REQUEST="$AGENT_DIR/queue/request.env"
RESULT="$AGENT_DIR/result.env"

[ -f "$REQUEST" ] || { info "Aucune demande en attente."; exit 0; }

# Un seul passage à la fois.
LOCK="$AGENT_DIR/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  info "Une demande est déjà en cours de traitement."
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# La demande peut contenir des secrets : on la lit puis on la supprime aussitôt.
content=$(cat "$REQUEST")
rm -f "$REQUEST"

id=''
write_result() {
  local ok=$1 message=$2 tmp
  tmp=$(mktemp "$AGENT_DIR/.result.XXXXXX")
  printf 'ID=%s\nOK=%s\nMESSAGE=%s\nFINISHED=%s\n' "$id" "$ok" "$message" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$RESULT"
  if [ "$ok" = 1 ]; then ok "$message"; else warn "$message"; fi
}

# ─── 1. Lecture et vérification (rien n'est écrit si une ligne est refusée) ──
vpn_enabled=''
plex_claim=''
updates=''
while IFS= read -r line; do
  [ -n "$line" ] || continue
  key=${line%%=*}
  value=${line#*=}
  case "$key" in
    ID) id=$value ;;
    VPN_ENABLED)
      case "$value" in 0|1) vpn_enabled=$value ;; *) write_result 0 "Valeur refusée pour VPN_ENABLED"; exit 1 ;; esac ;;
    PLEX_CLAIM)
      if printf '%s' "$value" | grep -Eq '^claim-[A-Za-z0-9_-]+$'; then plex_claim=$value
      else write_result 0 "Code Plex refusé"; exit 1; fi ;;
    VPN_PROVIDER|VPN_TYPE|VPN_COUNTRIES|WIREGUARD_PRIVATE_KEY|WIREGUARD_ADDRESSES|OPENVPN_USER|OPENVPN_PASSWORD|VPN_PORT_FORWARDING|VPN_PORT_FORWARD_ONLY)
      case "$value" in
        *"'"*|*'"'*|*'`'*|*'$'*|*\\*) write_result 0 "Valeur refusée pour $key"; exit 1 ;;
      esac
      updates="$updates$key=$value
" ;;
    *) write_result 0 "Réglage refusé : $key"; exit 1 ;;
  esac
done <<EOF
$content
EOF

[ -n "$id" ] || { write_result 0 "Demande sans identifiant"; exit 1; }

# ─── Liaison de Plex au compte ───────────────────────────────────────────
# Plex n'accepte d'être réclamé que depuis sa propre machine : on passe par le conteneur.
if [ -n "$plex_claim" ]; then
  step "Liaison de Plex au compte"
  if ! ensure_docker_running; then write_result 0 "Docker ne répond pas"; exit 1; fi
  code=$(dkr exec motflix-plex curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:32400/myplex/claim?token=$plex_claim" 2>/dev/null || true)
  if [ "$code" = 200 ]; then
    write_result 1 "Serveur Plex lié à votre compte"
  else
    write_result 0 "Plex a refusé la liaison (code ${code:-inconnu}). Réessayez : le code expire après quelques minutes."
    exit 1
  fi
  exit 0
fi

[ -n "$vpn_enabled" ] || { write_result 0 "Demande incomplète"; exit 1; }

# ─── 2. Mise à jour du .env ──────────────────────────────────────────────
step "Mise à jour de la configuration"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  env_set "$ENV_FILE" "${line%%=*}" "${line#*=}"
done <<EOF
$updates
EOF

profiles=$(env_get "$ENV_FILE" COMPOSE_PROFILES | tr ',' '\n' | grep -vxE 'vpn|novpn' | paste -sd, -)
if [ "$vpn_enabled" = 1 ]; then mode=vpn; else mode=novpn; fi
env_set "$ENV_FILE" COMPOSE_PROFILES "${profiles:+$profiles,}$mode"
ok "Profils : $(env_get "$ENV_FILE" COMPOSE_PROFILES)"

# ─── 3. Recréation des conteneurs ────────────────────────────────────────
step "Application"
if ! ensure_docker_running; then write_result 0 "Docker ne répond pas"; exit 1; fi

# Les deux variantes de qBittorrent publient le même port : on retire l'ancienne.
if [ "$mode" = vpn ]; then
  dc rm -sf qbittorrent >/dev/null 2>&1 || true
else
  dc rm -sf gluetun qbittorrent-vpn >/dev/null 2>&1 || true
fi
if ! dc up -d --remove-orphans; then
  if [ "$mode" = vpn ]; then
    # Le plus souvent, Gluetun refuse les identifiants : on donne sa raison à l'utilisateur.
    reason=$(dkr logs --tail 40 motflix-gluetun 2>&1 | grep 'ERROR' | tail -1 | sed -E 's/.*ERROR //' \
      | tr -d "'\"\`\$\\\\" | tr '\n' ' ' | cut -c1-200 || true)
    write_result 0 "Le VPN ne se connecte pas${reason:+ ($reason)}. Vérifiez vos identifiants. Les téléchargements restent coupés, sans fuite."
  else
    write_result 0 "Docker n'a pas pu recréer les services (voir logs/agent.log)"
  fi
  exit 1
fi

if [ "$mode" = novpn ]; then
  write_result 1 "VPN désactivé : les téléchargements utilisent votre connexion"
  exit 0
fi

# ─── 4. Le VPN se connecte-t-il ? ────────────────────────────────────────
i=0
status=''
while [ "$i" -lt 120 ]; do
  status=$(dkr inspect -f '{{.State.Health.Status}}' motflix-gluetun 2>/dev/null || true)
  [ "$status" = healthy ] && break
  sleep 3; i=$((i + 3))
done
if [ "$status" = healthy ]; then
  write_result 1 "VPN connecté : les téléchargements passent par le VPN"
else
  write_result 0 "Le VPN ne se connecte pas : vérifiez vos identifiants. Les téléchargements restent coupés, sans fuite."
  exit 1
fi
