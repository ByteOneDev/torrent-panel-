// Ce que chaque rôle a le droit de faire (quand les comptes sont activés).
//
// - Administrateur : tout.
// - Membre : parcourir la bibliothèque, chercher, demander des titres (validés par l'admin).
// - Lecture seule : parcourir la bibliothèque et suivre les téléchargements.
// Tout ce qui n'est pas listé ici est réservé à l'administrateur.
import type { Role } from '@motflix/shared';

type Rule = { method: 'GET' | 'POST' | 'DELETE'; path: RegExp; roles: Role[] };

const EVERYONE: Role[] = ['admin', 'member', 'viewer'];
const MEMBERS: Role[] = ['admin', 'member'];

const RULES: Rule[] = [
  { method: 'GET', path: /^\/api\/(health|auth\/state)$/, roles: EVERYONE },
  { method: 'POST', path: /^\/api\/auth\/logout$/, roles: EVERYONE },
  { method: 'GET', path: /^\/api\/library\/(movies|series|books)$/, roles: EVERYONE },
  { method: 'GET', path: /^\/api\/library\/books\/[^/]+\/cover$/, roles: EVERYONE },
  { method: 'GET', path: /^\/api\/downloads$/, roles: EVERYONE },
  { method: 'GET', path: /^\/api\/requests$/, roles: EVERYONE },          // chacun voit les siennes
  { method: 'GET', path: /^\/api\/search$/, roles: MEMBERS },
  { method: 'GET', path: /^\/api\/settings\/preferences$/, roles: MEMBERS }, // libellé du choix de langue
  { method: 'POST', path: /^\/api\/requests$/, roles: MEMBERS },
  { method: 'DELETE', path: /^\/api\/requests\/\d+$/, roles: MEMBERS },    // annuler sa demande
];

export function canAccess(role: Role, method: string, url: string): boolean {
  if (role === 'admin') return true;
  const p = url.split('?')[0] ?? '';
  if (!p.startsWith('/api/')) return true; // pages de l'interface : l'API filtre le reste
  return RULES.some((r) => r.method === method && r.path.test(p) && r.roles.includes(role));
}
