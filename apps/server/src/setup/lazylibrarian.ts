// LazyLibrarian : dossiers des livres et livres audio, téléchargement via qBittorrent.
// Son API ne parle pas JSON pour les réglages : « writeCFG » écrit une valeur à la fois.

export interface LazyLibrarianConfig {
  url: string;
  apiKey: string;
  qbittorrent: { username: string; password: string };
}

const VALUES: [group: string, name: string, value: string][] = [
  ['General', 'EBOOK_DIR', '/data/media/livres'],
  ['General', 'AUDIO_DIR', '/data/media/livres-audio'],
  ['General', 'DOWNLOAD_DIR', '/data/torrents/livres'],
  ['General', 'EBOOK_TAB', '1'],
  ['General', 'AUDIO_TAB', '1'],
  // Livres en français acceptés (par défaut, LazyLibrarian n'accepte que l'anglais).
  ['General', 'IMP_PREFLANG', 'fr, fre, fra, fr-FR, French, en, eng, en-US, en-GB, English'],
  ['TORRENT', 'TOR_DOWNLOADER_QBITTORRENT', '1'],
  ['TORRENT', 'KEEP_SEEDING', '1'],
  ['QBITTORRENT', 'QBITTORRENT_HOST', 'http://qbittorrent'],
  ['QBITTORRENT', 'QBITTORRENT_PORT', '8090'],
  ['QBITTORRENT', 'QBITTORRENT_LABEL', 'livres'],
];

export async function wireLazyLibrarian(c: LazyLibrarianConfig): Promise<string> {
  const call = async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ apikey: c.apiKey, ...params });
    const res = await fetch(`${c.url}/api?${qs}`, { signal: AbortSignal.timeout(15_000) });
    const text = (await res.text()).trim();
    if (!res.ok) throw new Error(`LazyLibrarian a répondu ${res.status}`);
    return text;
  };

  const values: [string, string, string][] = [
    ...VALUES,
    ['QBITTORRENT', 'QBITTORRENT_USER', c.qbittorrent.username],
    ['QBITTORRENT', 'QBITTORRENT_PASS', c.qbittorrent.password],
  ];
  for (const [group, name, value] of values) {
    const answer = await call({ cmd: 'writeCFG', group, name, value });
    if (answer !== 'OK') throw new Error(`${name} : ${answer.slice(0, 120)}`);
  }
  // Vérification : relecture d'une valeur.
  const check = await call({ cmd: 'readCFG', group: 'QBITTORRENT', name: 'QBITTORRENT_LABEL' });
  if (!check.includes('livres')) throw new Error('La configuration ne semble pas enregistrée.');
  return 'Livres et livres audio rangés dans /data/media · qBittorrent (catégorie « livres »)';
}
