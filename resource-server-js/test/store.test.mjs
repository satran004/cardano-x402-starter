import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { setTimeout } from 'node:timers/promises';
import { createStore } from '../src/store.mjs';

test('PostgreSQL retains binding across restart, fences concurrent retries and rejects reuse',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    let store = await createStore(connectionString);
    const id = randomUUID(), other = randomUUID();
    const hash = randomUUID().replaceAll('-', '').padEnd(64, '0');
    const prepared = { answer: 'Prepared before submission' };
    try {
      for (const quoteId of [id, other]) await store.insert({ id: quoteId, question: 'Test', requirements: { scheme: 'exact' }, expires_at: 1000 });
      await store.withQuote(id, async (_row, journal) => { assert.equal(await journal.bind(hash, { signed: 'test' }, prepared), true); });
      await store.close(); store = await createStore(connectionString);
      await store.withQuote(id, async (row) => { assert.equal(row.tx_hash, hash); assert.deepEqual(row.prepared_answer, prepared); assert.deepEqual(row.payload, { signed: 'test' }); });
      await store.withQuote(other, async (_row, journal) => { assert.equal(await journal.owner(hash), id); assert.equal(await journal.bind(hash, {}, {}), false); });
      let release, entered;
      const hold = new Promise(resolve => { release = resolve; });
      const started = new Promise(resolve => { entered = resolve; });
      const first = store.withQuote(id, async (_row, journal) => { entered(); await hold; await journal.complete(prepared); });
      await started;
      let secondEntered = false;
      const second = store.withQuote(id, async row => { secondEntered = true; assert.deepEqual(row.answer, prepared); });
      await setTimeout(30);
      const enteredBeforeRelease = secondEntered;
      // Second callback must observe the first's committed answer, even if both requests overlap.
      release(); await Promise.all([first, second]);
      assert.equal(enteredBeforeRelease, false, 'Concurrent retry must wait for the quote lock');
    } finally {
      await store.close();
      const cleanup = new pg.Pool({ connectionString });
      await cleanup.query('DELETE FROM demo_quotes WHERE id=ANY($1::varchar[])', [[id, other]]); await cleanup.end();
    }
  });
