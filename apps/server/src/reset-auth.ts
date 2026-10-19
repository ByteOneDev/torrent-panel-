// Mot de passe oublié : désactive les comptes, le panel redevient accessible sans connexion.
// Usage : docker exec motflix-panel node src/reset-auth.ts
import path from 'node:path';
import { AuthStore } from './auth.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';

const db = openDb(path.join(loadConfig().dataDir, 'motflix.db'));
new AuthStore(db).disable();
db.close();
console.log('Comptes désactivés : le panel est de nouveau accessible sans connexion.');
console.log('Réactivez-les dans Réglages › Utilisateurs pour choisir un nouveau mot de passe.');
