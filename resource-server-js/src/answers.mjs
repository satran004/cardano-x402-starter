import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { decodeCardanoTransaction } from '@x402/cardano';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';

const response = (status, body, headers = {}) => ({ status, body, headers });
const error = (status, code) => response(status, { error: code });
const expired = () => response(410, { error: 'quote_expired', paymentStatus: 'not_submitted',
  canRequestNewQuote: true, instruction: 'Request a fresh quote; no transaction was submitted for this quote.' });
const success = (answer, settlement) => response(200, { result: answer, settlement },
  { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settlement) });

export function explain(question) {
  const q = question.toLowerCase();
  if (q.includes('utxo')) return 'A UTxO is an unspent transaction output. Cardano payments consume UTxOs and create outputs for the merchant and your change. The x402 nonce identifies one consumed input.';
  if (q.includes('wallet') || q.includes('cip')) return 'CIP-30 lets a website connect to your Cardano browser wallet and request a transaction signature. Your private keys stay in your wallet; the facilitator receives the signed transaction.';
  if (q.includes('facilitator')) return 'The facilitator verifies the signed transaction, submits it to Cardano, and checks confirmation evidence. It needs no signing key or funded wallet. This demo waits for inclusion plus one newer block.';
  if (q.includes('fee')) return 'The 2 tADA resource price goes to the merchant. Your wallet also pays a separate Cardano network fee and receives change. This demo uses preprod test ADA.';
  return 'x402 uses HTTP 402 to quote a payment. Your wallet signs a Cardano transaction, the browser retries with PAYMENT-SIGNATURE, and the facilitator verifies and settles it. The paid answer includes a PAYMENT-RESPONSE receipt.';
}

/** Official SDK handles requirements, envelopes and facilitator calls; our journal owns the resource. */
export function createAnswers({ payments, store, payTo, amount, publicUrl, now = Date.now }) {
  if (!payTo?.startsWith('addr_test1') || !/^[1-9][0-9]*$/.test(amount) || BigInt(amount) < 2_000_000n)
    throw new Error('Use a preprod merchant address and at least 2000000 lovelace');
  const url = id => `${publicUrl}/api/answers/${id}`;
  const config = () => ({ network: 'cardano:preprod', amount, payTo, confirmationPolicy: { l1Confirmations: 1 } });
  const prepare = question => ({ question, answer: explain(question), generatedAt: new Date(now()).toISOString(),
    source: 'Local educational examples; no external AI service' });
  const required = row => payments.createPaymentRequiredResponse([row.requirements],
    { url: url(row.id), description: 'A short educational Cardano answer', mimeType: 'application/json' });

  return {
    config,
    async quote(question) {
      if (typeof question !== 'string' || !question.trim() || question.length > 300)
        return error(400, 'invalid_request');
      // ExactCardanoScheme checks price/asset syntax and /supported capabilities.
      const [requirements] = await payments.buildPaymentRequirements({ scheme: 'exact', network: 'cardano:preprod',
        price: { amount, asset: 'lovelace' }, payTo, maxTimeoutSeconds: 600,
        extra: { assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: 1 } } });
      const id = randomUUID();
      const expiresAt = now() + 600_000;
      await store.insert({ id, question: question.trim(), requirements, expires_at: expiresAt });
      return response(200, { id, url: url(id), expiresAt });
    },
    async answer(id, signature) {
      return store.withQuote(id, async (row, journal) => {
        if (!row) return error(404, 'quote_not_found');
        if (!signature?.trim()) {
          if (now() > row.expires_at) return row.tx_hash ? error(410, 'quote_expired') : expired();
          const challenge = await required(row);
          return response(402, challenge, { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) });
        }
        let incoming, hash;
        try {
          if (signature.length > 60_000) return error(413, 'payment_too_large');
          incoming = decodePaymentSignatureHeader(signature);
          if (incoming.x402Version !== 2 || !isDeepStrictEqual(incoming.accepted, row.requirements)
            || incoming.resource?.url !== url(id)) return error(400, 'payment_terms_mismatch');
          hash = decodeCardanoTransaction(incoming.payload.transaction).txHash;
        } catch { return error(400, 'malformed_payment'); }
        if (row.tx_hash && row.tx_hash !== hash) return error(409, 'quote_already_bound_to_another_payment');
        let preparedAnswer = row.prepared_answer;
        if (!row.tx_hash) {
          if (await journal.owner(hash)) return error(409, 'payment_already_used_for_another_question');
          if (now() > row.expires_at) return expired();
          const verified = await payments.verifyPayment(incoming, row.requirements);
          if (!verified.isValid) {
            const challenge = await required(row);
            return response(402, { error: 'payment_invalid', verification: verified,
              paymentStatus: 'not_submitted', canRequestNewQuote: true },
            { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) });
          }
          // authorization flow: execute this pure handler before settling, release only after success.
          preparedAnswer = prepare(row.question);
          if (!await journal.bind(hash, incoming, preparedAnswer)) return error(409, 'payment_already_used_for_another_question');
        } else {
          incoming = row.payload; // Skip fresh verification of potentially spent UTxOs on retries.
          if (row.answer) return success(row.answer, row.settlement);
          // Allows recovery of a pending quote originally accepted by Spring Boot.
          preparedAnswer ??= prepare(row.question);
        }
        // Core retries a tx-carrying settlement_pending result once, using the same payment.
        const settled = await payments.settlePayment(incoming, row.requirements);
        await journal.settlement(settled);
        if (!settled.success) return response(settled.errorReason === 'settlement_pending' ? 202 : 409,
          { error: settled.errorReason || 'settlement_failed', settlement: settled,
            instruction: 'Retry the identical PAYMENT-SIGNATURE; do not sign another transaction.' },
          { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settled) });
        if (settled.transaction !== hash || !Number.isInteger(settled.extra?.confirmations) || settled.extra.confirmations < 1)
          throw new Error('Facilitator returned insufficient settlement evidence');
        await journal.complete(preparedAnswer);
        return success(preparedAnswer, settled);
      });
    },
  };
}
