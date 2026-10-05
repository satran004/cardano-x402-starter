import { describe, it, expect } from 'vitest';
import type { PaymentRequired } from '@x402/core/types';
import { validateOffer } from './payment';
const config = { network: 'cardano:preprod', amount: '2000000', payTo: 'addr_test1merchant' } as const;
const url = 'http://localhost:8080/api/answers/example';
const offer = (): PaymentRequired => ({ x402Version: 2, resource: { url }, accepts: [{ scheme: 'exact', network: config.network, amount: config.amount, asset: 'lovelace', payTo: config.payTo, maxTimeoutSeconds: 600, extra: { assetTransferMethod: 'default', confirmationPolicy: { l1Confirmations: 1 } } }] });
describe('Explicit wallet spending policy', () => {
  it('accepts the configured preprod quote', () => expect(validateOffer(offer(), config, url).amount).toBe('2000000'));
  it('accepts the official server SDK omitted default transfer method', () => { const q = offer(); delete q.accepts[0].extra!.assetTransferMethod; expect(validateOffer(q, config, url).amount).toBe('2000000'); });
  for (const method of ['masumi', 'script', 'unknown']) {
    it(`rejects ${method} transfers in this direct-payment demo`, () => { const q = offer(); q.accepts[0].extra!.assetTransferMethod = method; expect(() => validateOffer(q, config, url)).toThrow(); });
  }
  for (const [key, value] of [['amount', '5000000'], ['network', 'cardano:mainnet'], ['asset', 'USDM'], ['payTo', 'addr_test1attacker']] as const) {
    it(`rejects altered ${key} before wallet approval`, () => { const q = offer(); Object.assign(q.accepts[0], { [key]: value }); expect(() => validateOffer(q, config, url)).toThrow(); });
  }
  it('rejects a quote for another resource', () => expect(() => validateOffer(offer(), config, url + '/other')).toThrow());
  it('rejects mempool-only confirmation', () => { const q = offer(); q.accepts[0].extra!.confirmationPolicy = { l1Confirmations: -1 }; expect(() => validateOffer(q, config, url)).toThrow(); });
});
