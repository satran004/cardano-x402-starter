import { createPaymentServer } from './sdk.mjs';
import { createStore } from './store.mjs';
import { createAnswers } from './answers.mjs';
import { createApp } from './app.mjs';
import { createServer } from 'node:http';

const store = await createStore(process.env.DATABASE_URL || 'postgres://postgres:local-demo-only@localhost:5432/postgres');
try {
  const payments = await createPaymentServer(process.env.FACILITATOR_URL || 'http://localhost:4022', { attempts: 30 });
  const answers = createAnswers({ payments, store, payTo: process.env.PAY_TO, amount: process.env.PAYMENT_AMOUNT || '2000000',
    publicUrl: process.env.PUBLIC_RESOURCE_URL || 'http://localhost:8081' });
  if (!process.env.BLOCKFROST_PROJECT_ID) throw new Error('Set BLOCKFROST_PROJECT_ID privately');
  const app = createApp({ answers, blockfrostKey: process.env.BLOCKFROST_PROJECT_ID,
    blockfrostUrl: process.env.BLOCKFROST_BASE_URL });
  const server = createServer({ maxHeaderSize: 65_536 }, app)
    .listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('JavaScript resource server ready'));
  server.maxHeadersCount = 100;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
} catch {
  await store.close();
  console.error('Resource server startup failed; check database, facilitator capabilities and private configuration.');
  process.exitCode = 1;
}
