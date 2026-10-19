// Mise en forme à la française : « 1,5 Go », « 4,2 Mo/s », « il y a 4 min ».

const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'];

export function bytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  const d = i === 0 || v >= 100 ? 0 : digits;
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d })} ${UNITS[i]}`;
}

export const speed = (n: number) => `${bytes(n)}/s`;

export function percent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 })} %`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export function since(iso: string | null): string {
  if (!iso) return '—';
  return duration((Date.now() - Date.parse(iso)) / 1000);
}

export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const days = Math.floor(s / 86400);
  if (days < 7) return days === 1 ? 'hier' : `il y a ${days} jours`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function clock(iso: string | null): string {
  if (!iso) return '--:--:--';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour12: false });
}
