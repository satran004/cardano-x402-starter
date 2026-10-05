import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { createPaymentServer } from '../src/sdk.mjs';
import { createAnswers } from '../src/answers.mjs';
import { createApp } from '../src/app.mjs';

const vector = JSON.parse(await readFile(new URL('../../resource-server/src/test/resources/public-test-transaction.json', import.meta.url))
  .catch(() => readFile(new URL('./public-test-transaction.json', import.meta.url))));

// Public offline vector. The fake facilitator never talks to Cardano or broadcasts.
async function fixture(t) {
  const calls = { verify: 0, settle: 0 };
  let valid = true, pending = false, wrongEvidence = false, lost = false, time = Date.now();
  const fac = express(); fac.use(express.json());
  fac.get('/supported', (_req, res) => res.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'cardano:preprod',
    extra: { assetTransferMethods: ['default', 'masumi', 'script'], areFeesSponsored: false, l1Confirmations: { minimum: 0, maximum: 20 } } }],
    extensions: [], signers: { 'cardano:*': [] } }));
  fac.post('/verify', (req, res) => {
    calls.verify++;
    assert.equal(req.body.x402Version, 2);
    assert.equal(req.body.paymentRequirements.amount, '2000000');
    res.json({ isValid: valid, payer: 'addr_test1payer', ...(valid ? {} : { invalidReason: 'invalid_signature' }) });
  });
  fac.post('/settle', (_req, res) => {
    calls.settle++;
    if (lost) return res.status(503).json({ error: 'lost_response' });
    res.json({ success: !pending, transaction: vector.hash, network: 'cardano:preprod', payer: 'addr_test1payer',
      ...(pending ? { errorReason: 'settlement_pending' } : {}), extra: { confirmations: wrongEvidence ? 0 : 1 } });
  });
  const facServer = fac.listen(0, '127.0.0.1'); await once(facServer, 'listening');
  t.after(() => new Promise(resolve => facServer.close(resolve)));
  const payments = await createPaymentServer(`http://127.0.0.1:${facServer.address().port}`);
  const rows = new Map();
  const store = {
    async insert(row) { rows.set(row.id, structuredClone(row)); },
    async withQuote(id, action) {
      const row = rows.get(id);
      return action(row && structuredClone(row), {
        async owner(hash) { return [...rows.values()].find(r => r.tx_hash === hash)?.id; },
        async bind(hash, payload, answer) {
          if ([...rows.values()].some(r => r.tx_hash === hash)) return false;
          Object.assign(row, { tx_hash: hash, payload: structuredClone(payload), prepared_answer: answer }); return true;
        },
        async settlement(receipt) { row.settlement = receipt; },
        async complete(answer) { row.answer = answer; },
      });
    },
  };
  const answers = createAnswers({ payments, store, payTo: 'addr_test1merchant', amount: '2000000', publicUrl: 'http://localhost:8081', now: () => time });
  const server = createServer({ maxHeaderSize: 65_536 }, createApp({ answers, blockfrostKey: 'test-key', fetchImpl: async () => { throw new Error('Unexpected chain request'); } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const quote = async () => {
    const r = await fetch(base + '/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'What does the facilitator do?' }) });
    assert.equal(r.status, 200); return r.json();
  };
  const get = (q, signature) => fetch(base + '/api/answers/' + q.id, { headers: signature ? { 'PAYMENT-SIGNATURE': signature } : {} });
  const sign = async (q, mutate = () => {}) => {
    const r = await get(q); const challenge = decodePaymentRequiredHeader(r.headers.get('PAYMENT-REQUIRED'));
    const payload = { x402Version: 2, accepted: challenge.accepts[0], resource: challenge.resource,
      payload: { transaction: vector.transaction, nonce: '0'.repeat(64) + '#0' } };
    mutate(payload); return encodePaymentSignatureHeader(payload);
  };
  return { base, rows, calls, quote, get, sign,
    invalid: () => { valid = false; }, pending: () => { pending = true; }, confirm: () => { pending = false; },
    expire: () => { time += 700_000; }, badEvidence: () => { wrongEvidence = true; }, lose: () => { lost = true; }, recover: () => { lost = false; } };
}

test('official SDK builds the 402 header; no answer or verification occurs', async t => {
  const f = await fixture(t); const q = await f.quote(); const r = await f.get(q);
  assert.equal(r.status, 402);
  const body = await r.json(); assert.deepEqual(decodePaymentRequiredHeader(r.headers.get('PAYMENT-REQUIRED')), body);
  assert.equal(body.accepts[0].extra.assetTransferMethod, undefined); // SDK default omitted on wire.
  assert.equal(body.accepts[0].asset, 'lovelace'); assert.equal(body.accepts[0].amount, '2000000');
  assert.deepEqual(f.calls, { verify: 0, settle: 0 });
});

test('official verify/settle HTTP calls release a receipt and cache the same answer', async t => {
  const f = await fixture(t); const q = await f.quote(); const signature = await f.sign(q);
  const r = await f.get(q, signature); assert.equal(r.status, 200); const body = await r.json();
  assert.equal(body.settlement.transaction, vector.hash);
  assert.deepEqual(decodePaymentResponseHeader(r.headers.get('PAYMENT-RESPONSE')), body.settlement);
  assert.deepEqual(await (await f.get(q, signature)).json(), body);
  assert.deepEqual(f.calls, { verify: 1, settle: 1 });
});

test('HTTP 200 with isValid false does not bind or settle', async t => {
  const f = await fixture(t); const q = await f.quote(); const signature = await f.sign(q); f.invalid();
  const r = await f.get(q, signature); assert.equal(r.status, 402); const body = await r.json();
  assert.equal(body.paymentStatus, 'not_submitted'); assert.equal(body.canRequestNewQuote, true);
  assert.equal(f.rows.get(q.id).tx_hash, undefined); assert.equal(f.calls.settle, 0);
});

test('altered quote amount or resource is refused before verification', async t => {
  const f = await fixture(t); const q = await f.quote();
  for (const mutate of [p => { p.accepted.amount = '1'; }, p => { p.resource.url += '/other'; }]) {
    const r = await f.get(q, await f.sign(q, mutate)); assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'payment_terms_mismatch');
  }
  assert.equal(f.calls.verify, 0);
});

test('an unaccepted expired signed quote can be replaced without settlement', async t => {
  const f = await fixture(t); const q = await f.quote(); const signature = await f.sign(q); f.expire();
  for (const s of [signature, undefined]) {
    const r = await f.get(q, s); assert.equal(r.status, 410);
    assert.equal((await r.json()).paymentStatus, 'not_submitted');
  }
  assert.deepEqual(f.calls, { verify: 0, settle: 0 });
});

test('pending is retried once by core; bound payment reconciles after quote expiry', async t => {
  const f = await fixture(t); const q = await f.quote(); const signature = await f.sign(q); f.pending();
  const r = await f.get(q, signature); assert.equal(r.status, 202); assert.equal(f.calls.settle, 2);
  assert.equal((await r.json()).canRequestNewQuote, undefined);
  assert.ok(f.rows.get(q.id).payload); f.expire();
  const unsigned = await f.get(q); assert.equal((await unsigned.json()).paymentStatus, undefined);
  f.confirm(); assert.equal((await f.get(q, signature)).status, 200);
  assert.equal(f.calls.verify, 1); assert.equal(f.calls.settle, 3);
});

test('a transaction cannot buy another question', async t => {
  const f = await fixture(t); const q = await f.quote(); assert.equal((await f.get(q, await f.sign(q))).status, 200);
  const other = await f.quote(); const r = await f.get(other, await f.sign(other)); assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'payment_already_used_for_another_question'); assert.equal(f.calls.verify, 1);
});

test('lost settlement response retains binding and permits unchanged retry', async t => {
  const f = await fixture(t); const q = await f.quote(); const signature = await f.sign(q); f.lose();
  const r = await f.get(q, signature); assert.equal(r.status, 503); assert.ok(f.rows.get(q.id).tx_hash);
  assert.equal((await r.json()).canRequestNewQuote, undefined);
  f.recover(); assert.equal((await f.get(q, signature)).status, 200); assert.equal(f.calls.verify, 1);
});

test('insufficient confirmation evidence never releases the answer', async t => {
  const f = await fixture(t); const q = await f.quote(); const signature = await f.sign(q); f.badEvidence();
  assert.equal((await f.get(q, signature)).status, 503); assert.equal(f.rows.get(q.id).answer, undefined);
});

test('malformed payment, unknown quote and invalid question are rejected', async t => {
  const f = await fixture(t); const q = await f.quote(); assert.equal((await f.get(q, 'not-base64')).status, 400);
  assert.equal((await f.get({ id: 'missing' })).status, 404);
  const r = await fetch(f.base + '/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":""}' });
  assert.equal(r.status, 400); assert.equal(f.calls.verify, 0);
});

test('chain proxy refuses submission paths and unsupported query parameters', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/api/chain/tx/submit')).status, 404);
  assert.equal((await fetch(f.base + '/api/chain/blocks/latest?secret=1')).status, 400);
});
