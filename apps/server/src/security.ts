// Protections du panel, qui s'ouvre sans mot de passe par défaut.
//
// DNS rebinding : un site malveillant visité depuis la maison peut faire pointer son
// propre nom de domaine vers l'adresse du panel, puis lire ses réponses (identifiants,
// pilotage de Docker). Le navigateur envoie alors ce nom dans l'en-tête Host : on
// n'accepte que des adresses IP, « localhost », des noms du réseau local, ou les noms
// déclarés dans PANEL_HOSTNAMES.

const LOCAL_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.localhost'];

export function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedHost(hostHeader: string | undefined, extra: string[] = []): boolean {
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  if (host === 'localhost' || extra.includes(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;   // IPv4
  if (host.startsWith('[') && host.endsWith(']')) return true; // IPv6
  if (!host.includes('.')) return true;                       // nom court du réseau local (« serveur »)
  return LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

/** Une requête qui modifie quelque chose doit venir de la page du panel elle-même. */
export function isSameOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true; // pas d'Origin : requête non issue d'un autre site (curl, même page en GET…)
  try {
    return new URL(origin).host === hostHeader;
  } catch {
    return false; // « Origin: null » (iframe isolée, fichier local…) : refusé
  }
}
