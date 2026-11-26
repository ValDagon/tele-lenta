import { buildApp } from './app.js';
import { loadConfig, requireSharedSecret } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const sharedSecret = requireSharedSecret(config);
const db = openDatabase(config.databasePath);
const app = buildApp({
  db,
  logger: { level: config.logLevel },
  auth: { sharedSecret },
  config,
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, 'failed to start API');
  db.close();
  process.exit(1);
}
