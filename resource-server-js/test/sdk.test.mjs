import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPaymentServer } from '../src/sdk.mjs';

test('startup waits for a facilitator whose HTTP endpoint is not ready yet', async t => {
  let calls = 0;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (++calls === 1) { res.statusCode = 503; res.end('{}'); return; }
    res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'cardano:preprod',
      extra: { assetTransferMethods: ['default'], areFeesSponsored: false, l1Confirmations: { minimum: 0, maximum: 20 } } }], extensions: [] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const payments = await createPaymentServer(`http://127.0.0.1:${server.address().port}`, { attempts: 2, retryMs: 0 });
  assert.ok(payments.getSupportedKind(2, 'cardano:preprod', 'exact')); assert.equal(calls, 2);
});

test('startup refuses an endpoint that does not serve Cardano preprod exact', async t => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"kinds":[],"extensions":[]}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(createPaymentServer(`http://127.0.0.1:${server.address().port}`), /supported|unavailable/i);
});
