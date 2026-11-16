import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { initRealtime } from './realtime.js';
import { startJobs, stopJobs } from './services/jobs.js';

const app = createApp();
const server = http.createServer(app);
initRealtime(server);
startJobs();
server.listen(config.port, () => {
  console.log(`UTS Housing API listening on http://localhost:${config.port} (${config.env})`);
});

const shutdown = async () => {
  stopJobs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
