// Journal des actions importantes (ajouts, retraits, suppressions), conservé dans le
// dossier de configuration du panel : il survit aux mises à jour du conteneur.
import { appendFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;

export function createJournal(dataDir: string) {
  const file = path.join(dataDir, 'journal.log');
  return async (message: string, user?: string | null): Promise<void> => {
    try {
      const size = await stat(file).then((s) => s.size, () => 0);
      if (size > MAX_BYTES) await rename(file, `${file}.1`);
      await appendFile(file, `${new Date().toISOString()}  ${user ?? 'admin'}  ${message}\n`, 'utf8');
    } catch {
      /* le journal ne doit jamais faire échouer l'action elle-même */
    }
  };
}
