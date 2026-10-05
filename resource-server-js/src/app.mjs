import express from 'express';

export function createApp({ answers, blockfrostKey, blockfrostUrl = 'https://cardano-preprod.blockfrost.io/api/v0', fetchImpl = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const send = (res, result) => res.status(result.status).set(result.headers).json(result.body);
  app.get('/api/config', (_req, res) => res.json(answers.config()));
  app.post('/api/quotes', async (req, res) => send(res, await answers.quote(req.body?.question)));
  app.get('/api/answers/:id', async (req, res) => send(res, await answers.answer(req.params.id, req.get('PAYMENT-SIGNATURE'))));
  app.get('/api/chain/{*path}', async (req, res) => {
    const path = req.path.slice('/api/chain'.length);
    if (!/^\/(epochs\/latest\/parameters|blocks\/latest|genesis|addresses\/addr_test1[a-z0-9]+\/utxos|txs\/[a-f0-9]{64}\/utxos)$/.test(path))
      return res.status(404).json({ error: 'chain_route_not_allowed' });
    const query = req.originalUrl.split('?')[1];
    if (query !== undefined && !/^(?:(?:page|count)=[0-9]{1,3}|order=(?:asc|desc))(?:&(?:(?:page|count)=[0-9]{1,3}|order=(?:asc|desc)))*$/.test(query))
      return res.status(400).json({ error: 'invalid_chain_query' });
    const upstream = await fetchImpl(`${blockfrostUrl}${path}${query ? `?${query}` : ''}`, {
      headers: { project_id: blockfrostKey }, signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    res.status(upstream.status).type('application/json').send(await upstream.text());
  });
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_request' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request_too_large' });
    // Never log signed payments, provider keys, or upstream bodies.
    res.status(503).json({ error: 'backend_unavailable', instruction: 'If a payment was signed, retain and retry that exact payment.' });
  });
  return app;
}
