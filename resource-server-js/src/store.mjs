import pg from 'pg';

const parse = row => row && ({ ...row,
  requirements: JSON.parse(row.requirements),
  payload: row.payload ? JSON.parse(row.payload) : null,
  settlement: row.settlement ? JSON.parse(row.settlement) : null,
  answer: row.answer ? JSON.parse(row.answer) : null,
  prepared_answer: row.prepared_answer ? JSON.parse(row.prepared_answer) : null,
  expires_at: Number(row.expires_at),
});

/** Shares Spring Boot's journal so switching servers preserves accepted payments. */
export async function createStore(connectionString) {
  const pool = new pg.Pool({ connectionString });
  await pool.query(`CREATE TABLE IF NOT EXISTS demo_quotes (
    id VARCHAR(36) PRIMARY KEY, question VARCHAR(300) NOT NULL,
    requirements TEXT NOT NULL, expires_at BIGINT NOT NULL,
    tx_hash VARCHAR(64) UNIQUE, payload TEXT, settlement TEXT, answer TEXT
  )`);
  await pool.query('ALTER TABLE demo_quotes ADD COLUMN IF NOT EXISTS prepared_answer TEXT');
  return {
    async insert(row) {
      await pool.query('INSERT INTO demo_quotes(id,question,requirements,expires_at) VALUES ($1,$2,$3,$4)',
        [row.id, row.question, JSON.stringify(row.requirements), row.expires_at]);
    },
    async withQuote(id, action) {
      const client = await pool.connect();
      let locked = false;
      let broken = false;
      try {
        // Session lock survives the autocommit that persists binding BEFORE broadcast.
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [id]);
        locked = true;
        const { rows } = await client.query('SELECT * FROM demo_quotes WHERE id=$1', [id]);
        return await action(parse(rows[0]), {
          async owner(hash) {
            const { rows } = await client.query('SELECT id FROM demo_quotes WHERE tx_hash=$1', [hash]);
            return rows[0]?.id;
          },
          async bind(hash, payload, preparedAnswer) {
            try {
              await client.query('UPDATE demo_quotes SET tx_hash=$1,payload=$2,prepared_answer=$3 WHERE id=$4',
                [hash, JSON.stringify(payload), JSON.stringify(preparedAnswer), id]);
              return true;
            } catch (error) { if (error.code === '23505') return false; throw error; }
          },
          async settlement(receipt) {
            await client.query('UPDATE demo_quotes SET settlement=$1 WHERE id=$2', [JSON.stringify(receipt), id]);
          },
          async complete(answer) {
            await client.query('UPDATE demo_quotes SET answer=$1 WHERE id=$2', [JSON.stringify(answer), id]);
          },
        });
      } finally {
        if (locked) {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [id]); }
          catch { broken = true; }
        }
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
