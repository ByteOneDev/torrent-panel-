// Agent hôte : ce que le panel ne peut pas faire depuis son conteneur.
//
// Activer ou couper le VPN demande de modifier le .env et de recréer des conteneurs,
// ce que le proxy Docker refuse volontairement au panel. Le panel dépose donc une
// demande dans <config>/agent/queue/ ; sur la machine, un petit service (launchd sur
// macOS, systemd sur Linux) la voit, lance apply.sh, puis écrit le résultat.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentResult, VpnSettings } from '@motflix/shared';

/** Clés que apply.sh accepte (il revérifie de son côté). */
const ALLOWED_KEYS = new Set([
  'VPN_ENABLED', 'VPN_PROVIDER', 'VPN_TYPE', 'VPN_COUNTRIES', 'WIREGUARD_PRIVATE_KEY', 'WIREGUARD_ADDRESSES',
  'OPENVPN_USER', 'OPENVPN_PASSWORD', 'VPN_PORT_FORWARDING', 'VPN_PORT_FORWARD_ONLY',
]);

/** Fournisseurs proposés (noms Gluetun) et ceux qui savent ouvrir un port. */
export const VPN_PROVIDERS = [
  'protonvpn', 'mullvad', 'private internet access', 'surfshark', 'nordvpn', 'windscribe', 'ivpn', 'airvpn',
  'cyberghost', 'expressvpn', 'perfect privacy', 'privatevpn', 'purevpn', 'torguard',
];
const PORT_FORWARD_PROVIDERS = new Set(['protonvpn', 'private internet access', 'perfect privacy', 'privatevpn']);

export class AgentError extends Error {}

export function vpnEnv(v: VpnSettings): Record<string, string> {
  if (!v.enabled) return { VPN_ENABLED: '0' };
  if (!VPN_PROVIDERS.includes(v.provider)) throw new AgentError('Fournisseur VPN inconnu.');
  const pf = v.portForwarding && PORT_FORWARD_PROVIDERS.has(v.provider);
  const env: Record<string, string> = {
    VPN_ENABLED: '1',
    VPN_PROVIDER: v.provider,
    VPN_TYPE: v.type === 'openvpn' ? 'openvpn' : 'wireguard',
    VPN_COUNTRIES: v.countries.trim(),
    VPN_PORT_FORWARDING: pf ? 'on' : 'off',
    VPN_PORT_FORWARD_ONLY: pf ? 'on' : 'off',
  };
  if (env.VPN_TYPE === 'wireguard') {
    if (!v.wireguardPrivateKey.trim()) throw new AgentError('La clé privée WireGuard est obligatoire.');
    // Une clé WireGuard fait 44 caractères en base64 et se termine par « = ».
    if (!/^[A-Za-z0-9+/]{43}=$/.test(v.wireguardPrivateKey.trim())) {
      throw new AgentError('Cette clé WireGuard ne semble pas valide : elle fait 44 caractères et se termine par « = ».');
    }
    env.WIREGUARD_PRIVATE_KEY = v.wireguardPrivateKey.trim();
    env.WIREGUARD_ADDRESSES = v.wireguardAddresses.trim();
  } else {
    if (!v.openvpnUser.trim() || !v.openvpnPassword) throw new AgentError('Identifiant et mot de passe OpenVPN obligatoires.');
    env.OPENVPN_USER = v.openvpnUser.trim();
    env.OPENVPN_PASSWORD = v.openvpnPassword;
  }
  return env;
}

/** Une ligne CLE=valeur par réglage ; refuse tout ce qui pourrait casser le .env. */
export function serializeRequest(id: string, env: Record<string, string>): string {
  const lines = [`ID=${id}`];
  for (const [k, v] of Object.entries(env)) {
    if (!ALLOWED_KEYS.has(k)) throw new AgentError(`Réglage non autorisé : ${k}`);
    if (/['"\n\r\\`$]/.test(v) || v.length > 512) throw new AgentError(`Valeur invalide pour ${k}.`);
    lines.push(`${k}=${v}`);
  }
  return lines.join('\n') + '\n';
}

export function parseResult(text: string): AgentResult | null {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
  }
  const id = map.get('ID');
  if (!id) return null;
  return { id, ok: map.get('OK') === '1', message: map.get('MESSAGE') ?? '', finishedAt: map.get('FINISHED') ?? '' };
}

export class Agent {
  private dir: string;
  private hostDir: string | null;

  constructor(dataDir: string, hostDir: string | null) {
    this.dir = path.join(dataDir, 'agent');
    this.hostDir = hostDir;
  }

  private get queue() { return path.join(this.dir, 'queue'); }

  /** install.sh dépose ce fichier quand le service de l'agent est en place. */
  installed(): boolean {
    return existsSync(path.join(this.dir, 'installed'));
  }

  pending(): boolean {
    return existsSync(path.join(this.queue, 'request.env'));
  }

  applyCommand(): string {
    return this.hostDir ? `${this.hostDir}/apply.sh` : 'apply.sh (dans le dossier d\'installation de Motflix)';
  }

  submit(env: Record<string, string>): string {
    if (this.pending()) throw new AgentError('Une modification est déjà en cours.');
    const id = randomUUID();
    mkdirSync(this.queue, { recursive: true, mode: 0o700 });
    // Écriture atomique : le service ne doit jamais lire un fichier à moitié écrit.
    const tmp = path.join(this.dir, `.request-${id}.tmp`);
    writeFileSync(tmp, serializeRequest(id, env), { mode: 0o600 });
    renameSync(tmp, path.join(this.queue, 'request.env'));
    return id;
  }

  lastResult(): AgentResult | null {
    const file = path.join(this.dir, 'result.env');
    if (!existsSync(file)) return null;
    return parseResult(readFileSync(file, 'utf8'));
  }
}
