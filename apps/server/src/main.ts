import { loadConfig } from './config.js';
import { start } from './start.js';

const server = await start(loadConfig());
const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
