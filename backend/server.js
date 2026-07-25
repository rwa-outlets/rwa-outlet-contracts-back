const env = require('./src/env');
const { connectDB } = require('./src/db');
const { seedIfEmpty } = require('./src/utils/seed');
const app = require('./src/app');

async function start() {
  await connectDB();
  await seedIfEmpty();

  app.listen(env.PORT, () => {
    console.log(`[server] listening on :${env.PORT} (${env.NODE_ENV})`);
  });
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
