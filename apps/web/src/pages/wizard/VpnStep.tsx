import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Globe, Info, Loader2, Shield } from 'lucide-react';
import type { SetupInfo, VpnSettings } from '@motflix/shared';
import { api } from '../../api.ts';

const PROVIDER_LABEL: Record<string, string> = {
  protonvpn: 'ProtonVPN', mullvad: 'Mullvad', 'private internet access': 'Private Internet Access',
  surfshark: 'Surfshark', nordvpn: 'NordVPN', windscribe: 'Windscribe', ivpn: 'IVPN', airvpn: 'AirVPN',
  cyberghost: 'CyberGhost', expressvpn: 'ExpressVPN', 'perfect privacy': 'Perfect Privacy',
  privatevpn: 'PrivateVPN', purevpn: 'PureVPN', torguard: 'TorGuard',
};
const PORT_FORWARD = new Set(['protonvpn', 'private internet access', 'perfect privacy', 'privatevpn']);

const EMPTY: VpnSettings = {
  enabled: true, provider: 'protonvpn', type: 'wireguard', wireguardPrivateKey: '', wireguardAddresses: '',
  openvpnUser: '', openvpnPassword: '', countries: '', portForwarding: true,
};

export function VpnStep({ info, embedded = false }: { info: SetupInfo; embedded?: boolean }) {
  const [want, setWant] = useState<boolean>(info.vpn.enabled);
  const [form, setForm] = useState<VpnSettings>({ ...EMPTY, provider: info.vpn.provider ?? 'protonvpn' });
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['vpn-providers'], queryFn: api.setup.vpnProviders, staleTime: Infinity });

  // Pendant qu'une demande est en cours, on suit son résultat.
  const result = info.vpn.lastResult && info.vpn.lastResult.id === requestId ? info.vpn.lastResult : null;
  const waiting = !!requestId && !result;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['setup'] }), 2000);
    return () => clearInterval(t);
  }, [waiting, qc]);
  // Résultat arrivé : un dernier rafraîchissement pour afficher le nouvel état.
  useEffect(() => {
    if (result) void qc.invalidateQueries({ queryKey: ['setup'] });
  }, [result?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<VpnSettings>) => setForm((f) => ({ ...f, ...patch }));
  // Sans VPN et déjà sans VPN : rien à appliquer. Sinon on peut toujours (re)envoyer.
  const showApply = want || info.vpn.enabled;

  async function apply() {
    setError(null);
    try {
      const r = await api.setup.applyVpn({ ...form, enabled: want });
      setRequestId(r.id);
      await qc.invalidateQueries({ queryKey: ['setup'] });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      {!embedded && <h2>Voulez-vous utiliser un VPN ?</h2>}
      {!embedded && <p className="lead">Il masque votre adresse IP pendant les téléchargements. Facultatif, et modifiable plus tard.</p>}

      <div className="hint">
        <Info className="ic ic-sm" />
        <span>Actuellement : <b>{info.vpn.enabled ? `avec VPN${info.vpn.provider ? ` (${PROVIDER_LABEL[info.vpn.provider] ?? info.vpn.provider})` : ''}` : 'sans VPN'}</b>.
          {!embedded && " Pour garder ce réglage, passez simplement à l'étape suivante."}</span>
      </div>

      <div className="choice-cards">
        <button type="button" className={`choice ${!want ? 'active' : ''}`} onClick={() => setWant(false)}>
          <Globe className="ic" /><b>Sans VPN</b><span>Plus simple, rien à configurer.</span>
        </button>
        <button type="button" className={`choice ${want ? 'active' : ''}`} onClick={() => setWant(true)}>
          <Shield className="ic" /><b>Avec VPN</b><span>Recommandé. Si le VPN se coupe, les téléchargements s'arrêtent : votre IP ne fuit jamais.</span>
        </button>
      </div>

      {want && (
        <div className="grid g2">
          <div className="field">
            <label htmlFor="vpn-provider">Fournisseur</label>
            <select id="vpn-provider" className="input" value={form.provider} onChange={(e) => set({ provider: e.target.value })}>
              {(providers.data ?? Object.keys(PROVIDER_LABEL)).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p] ?? p}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="vpn-type">Protocole</label>
            <select id="vpn-type" className="input" value={form.type} onChange={(e) => set({ type: e.target.value as VpnSettings['type'] })}>
              <option value="wireguard">WireGuard (recommandé)</option>
              <option value="openvpn">OpenVPN</option>
            </select>
          </div>
          {form.type === 'wireguard' ? (
            <>
              <div className="field">
                <label htmlFor="wg-key">Clé privée WireGuard</label>
                <input id="wg-key" className="input mono" type="password" autoComplete="off" value={form.wireguardPrivateKey}
                  onChange={(e) => set({ wireguardPrivateKey: e.target.value })} />
                <span className="hint-text">Dans l'espace client de votre VPN, configuration WireGuard (« PrivateKey »).</span>
              </div>
              <div className="field">
                <label htmlFor="wg-addr">Adresse (facultatif)</label>
                <input id="wg-addr" className="input mono" placeholder="10.2.0.2/32" value={form.wireguardAddresses}
                  onChange={(e) => set({ wireguardAddresses: e.target.value })} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="ovpn-user">Identifiant OpenVPN</label>
                <input id="ovpn-user" className="input" autoComplete="off" value={form.openvpnUser} onChange={(e) => set({ openvpnUser: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ovpn-pass">Mot de passe OpenVPN</label>
                <input id="ovpn-pass" className="input" type="password" autoComplete="off" value={form.openvpnPassword} onChange={(e) => set({ openvpnPassword: e.target.value })} />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="vpn-countries">Pays des serveurs (facultatif)</label>
            <input id="vpn-countries" className="input" placeholder="Switzerland, Netherlands" value={form.countries}
              onChange={(e) => set({ countries: e.target.value })} />
          </div>
          {PORT_FORWARD.has(form.provider) && (
            <div className="field">
              <label>Ouvrir un port automatiquement</label>
              <label className="setting" style={{ padding: 0, border: 0 }}>
                <span className="txt"><p>Meilleur partage. Rien à faire sur votre box : c'est le VPN qui ouvre le port.</p></span>
                <span className="toggle"><input type="checkbox" checked={form.portForwarding} onChange={(e) => set({ portForwarding: e.target.checked })} /><span /></span>
              </label>
            </div>
          )}
        </div>
      )}

      {error && <div className="alert" role="alert"><AlertTriangle className="ic ic-sm" />{error}</div>}

      {waiting && (info.vpn.agentInstalled ? (
        <div className="hint"><Loader2 className="ic ic-sm spin" /><span>Application en cours : Motflix redémarre les services de téléchargement (jusqu'à 2 minutes)…</span></div>
      ) : (
        <div className="hint warn"><AlertTriangle className="ic ic-sm" /><span>
          L'agent de Motflix n'est pas actif sur cette machine. Pour appliquer, lancez dans un terminal : <code className="mono">{info.vpn.applyCommand}</code>
        </span></div>
      ))}
      {result && (
        <div className={`hint ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? <Check className="ic ic-sm" /> : <AlertTriangle className="ic ic-sm" />}<span>{result.message}</span>
        </div>
      )}

      {showApply && (
        <div>
          <button type="button" className="btn" disabled={waiting} onClick={apply}>
            {waiting ? <Loader2 className="ic ic-sm spin" /> : <Shield className="ic ic-sm" />}
            {want ? 'Appliquer et tester le VPN' : 'Désactiver le VPN'}
          </button>
        </div>
      )}
    </>
  );
}
