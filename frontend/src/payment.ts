import { Address, Assets, Client, Transaction, preprod } from '@evolution-sdk/evolution';
import type { WalletApi } from '@evolution-sdk/evolution/sdk/wallet/Wallet';
import type { ClientCardanoSigner } from '@x402/cardano';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { ExactCardanoScheme } from '@x402/cardano/exact/client';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { Buffer } from 'buffer';

export type Cip30Api = WalletApi & { getNetworkId(): Promise<number> };
export type DemoConfig = { network: string; amount: string; payTo: string };

/** CIP-30 reports testnet=0 for both preview and preprod; the user must select preprod. */
export function validateOffer(required: PaymentRequired, config: DemoConfig, resourceUrl: string): PaymentRequirements {
  const terms = required.accepts[0];
  if (required.x402Version !== 2 || required.resource.url !== resourceUrl || required.accepts.length !== 1
    || !terms || terms.scheme !== 'exact' || terms.network !== 'cardano:preprod'
    || terms.asset !== 'lovelace' || terms.payTo !== config.payTo || terms.amount !== config.amount
    || (terms.extra?.assetTransferMethod !== undefined && terms.extra.assetTransferMethod !== 'default') || terms.maxTimeoutSeconds !== 600
    || (terms.extra.confirmationPolicy as { l1Confirmations?: number })?.l1Confirmations !== 1)
    throw new Error('The payment request does not match the demo price, recipient, resource, or preprod policy.');
  return terms;
}

/** Adapts Evolution's CIP-30 wallet to the official x402 Cardano scheme. */
export async function signPayment(api: Cip30Api, required: PaymentRequired, config: DemoConfig, quoteExpiresAt?: number): Promise<string> {
  if (await api.getNetworkId() !== 0) throw new Error('Switch your wallet to Cardano preprod before paying.');
  const terms = validateOffer(required, config, required.resource.url);
  const client = Client.make(preprod).withBlockfrost({ baseUrl: `${location.origin}/api/chain`, projectId: 'local-proxy' }).withCip30(api);
  const address = Address.toBech32(await client.address());
  const signer: ClientCardanoSigner = {
    getAddress: () => address,
    async buildAndSignPaymentTransaction(input) {
      const utxos = await client.getWalletUtxos();
      if (!utxos.length) throw new Error('No spendable UTxOs. Fund this wallet with preprod test ADA.');
      const anchor = utxos[0];
      const nonce = `${Buffer.from(anchor.transactionId.hash).toString('hex')}#${anchor.index}`;
      // Keep the transaction inside the quote's lifetime, including time spent approving it.
      const validTo = Math.min(Date.now() + (input.maxTimeoutSeconds - 30) * 1000, quoteExpiresAt === undefined ? Infinity : quoteExpiresAt - 30_000);
      if (validTo <= Date.now()) throw new Error('The quote is too close to expiry. Request a fresh quote before signing.');
      const builder = await client.newTx().collectFrom({ inputs: [anchor] })
        .payToAddress({ address: Address.fromBech32(input.payTo), assets: Assets.fromLovelace(BigInt(input.amount)) })
        .setValidity({ to: BigInt(validTo) })
        .build({ availableUtxos: utxos, changeAddress: await client.address(), autoMinUtxo: false });
      const signed = await builder.sign(); // Wallet approval; never submit here.
      const unsigned = await builder.toTransaction();
      const transaction = new Transaction.Transaction({ body: unsigned.body, witnessSet: signed.witnessSet, isValid: true, auxiliaryData: null });
      return { transaction: Buffer.from(Transaction.toCBORBytes(transaction)).toString('base64'), nonce };
    },
  };
  const result = await new ExactCardanoScheme(signer).createPaymentPayload(2, terms);
  const payload: PaymentPayload = { ...result, accepted: terms, resource: required.resource };
  return encodePaymentSignatureHeader(payload);
}
