import path from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'motflix.db'));
const app = await buildApp({ config, db });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} reçu, arrêt du panel`);
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
