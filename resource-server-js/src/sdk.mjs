import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactCardanoScheme } from '@x402/cardano/exact/server';
import { setTimeout } from 'node:timers/promises';

/** Official resource-server scheme, talking to the existing CF Java facilitator. */
export async function createPaymentServer(facilitatorUrl, { attempts = 1, retryMs = 2000 } = {}) {
  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: 90_000 });
  const payments = new x402ResourceServer(facilitator)
    .register('cardano:preprod', new ExactCardanoScheme());
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await payments.initialize(); // Fetch /supported before serving any quote.
      if (!payments.getSupportedKind(2, 'cardano:preprod', 'exact')) throw new Error('Preprod exact facilitator unavailable');
      return payments;
    } catch (error) {
      if (attempt === attempts || error.name === 'FacilitatorCapabilityError') throw error;
      await setTimeout(retryMs);
    }
  }
}
