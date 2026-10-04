import { afterEach, describe, it, expect, vi } from 'vitest';
import { Address, Assets, CBOR, Client, TransactionHash, TransactionWitnessSet, UTxO, preprod } from '@evolution-sdk/evolution';
import { ExactCardanoScheme as FacilitatorScheme } from '@x402/cardano/exact/facilitator';
import { decodeCardanoTransaction } from '@x402/cardano';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { signPayment, type Cip30Api } from './payment';

// Public BIP-39 test vector and fabricated inputs. No live funds or submission.
const mnemonic='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const protocol={min_fee_a:44,min_fee_b:155381,pool_deposit:'500000000',key_deposit:'2000000',
  max_tx_size:16384,max_val_size:5000,max_block_size:90112,coins_per_utxo_size:'4310',
  price_mem:0.0577,price_step:0.0000721,max_tx_ex_mem:'14000000',max_tx_ex_steps:'10000000000',
  collateral_percent:150,max_collateral_inputs:3,min_fee_ref_script_cost_per_byte:15,
  cost_models:{PlutusV1:{},PlutusV2:{},PlutusV3:{}},drep_deposit:'500000000',gov_action_deposit:'100000000000'};

async function fixture() {
  const wallet=Client.make(preprod).withSeed({mnemonic});
  const address=await wallet.address();
  const txHash='01'.repeat(32);
  const utxo=new UTxO.UTxO({transactionId:TransactionHash.fromHex(txHash),index:0n,address,assets:Assets.fromLovelace(30_000_000n)});
  const getUtxos=vi.fn(async()=>[CBOR.toCBORHex([[Buffer.from(txHash,'hex'),0n],[Buffer.from(Address.toHex(address),'hex'),30_000_000n]])]);
  const signTx=vi.fn(async(cbor:string)=>TransactionWitnessSet.toCBORHex(await wallet.signTx(cbor,{utxos:[utxo]})));
  const submitTx=vi.fn(async()=>{throw new Error('Client must never submit');});
  const api:Cip30Api={getNetworkId:async()=>0,getUsedAddresses:async()=>[Address.toHex(address)],getUnusedAddresses:async()=>[],getRewardAddresses:async()=>[],getUtxos,signTx,submitTx,signData:async()=>{throw new Error('Unused');}};
  // A second account is the merchant so payment is distinct from payer change.
  const merchant=Client.make(preprod).withSeed({mnemonic,accountIndex:1});
  const config={network:'cardano:preprod',amount:'2000000',payTo:Address.toBech32(await merchant.address())};
  const required:PaymentRequired={x402Version:2,resource:{url:'http://localhost:8080/api/answers/test'},accepts:[{scheme:'exact',network:'cardano:preprod',asset:'lovelace',amount:config.amount,payTo:config.payTo,maxTimeoutSeconds:600,extra:{assetTransferMethod:'default',areFeesSponsored:false,confirmationPolicy:{l1Confirmations:1}}}]};
  vi.stubGlobal('location',{origin:'http://localhost:5173'});
  vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>{
    if(String(url).endsWith('/epochs/latest/parameters')) return new Response(JSON.stringify(protocol),{headers:{'Content-Type':'application/json'}});
    throw new Error('Unexpected provider request: '+String(url));
  }));
  return {api,config,required,address,signTx,submitTx,getUtxos};
}
afterEach(()=>vi.unstubAllGlobals());
describe('CIP-30 transaction adapter with official SDKs',()=>{
  it('builds a signed payment with exact merchant output and a consumed nonce; never broadcasts',async()=>{
    const f=await fixture();
    const signature=await signPayment(f.api,f.required,f.config);
    const payload=decodePaymentSignatureHeader(signature);
    const decoded=decodeCardanoTransaction(payload.payload.transaction as string);
    expect(decoded.inputs).toContain(payload.payload.nonce);
    expect(decoded.vkeyWitnessCount).toBeGreaterThan(0);
    expect(decoded.outputs.some(o=>o.address===f.config.payTo && o.coin===2_000_000n)).toBe(true);
    expect(f.signTx).toHaveBeenCalledOnce();expect(f.submitTx).not.toHaveBeenCalled();
    const currentSlot=preprod.slotConfig.zeroSlot+(BigInt(Date.now())-preprod.slotConfig.zeroTime)/BigInt(preprod.slotConfig.slotLength);
    const verifier=new FacilitatorScheme({getAddresses:()=>[],getCurrentSlot:async()=>currentSlot,
      getUtxo:async()=>({exists:true,address:Address.toBech32(f.address),coin:30_000_000n,assets:{}}),
      getProtocolParameters:async()=>({coinsPerUtxoByte:4310n,minFeeCoefficient:44n,minFeeConstant:155381n}),
      getTransactionEvidence:async()=>({status:'unknown',confirmations:-2}),
      submitTransaction:async()=>{throw new Error('Offline verification must never submit');}});
    expect(await verifier.verify(payload,f.required.accepts[0])).toMatchObject({isValid:true});
  });
  it('rejects mainnet before constructing or signing',async()=>{
    const f=await fixture();f.api.getNetworkId=async()=>1;
    await expect(signPayment(f.api,f.required,f.config)).rejects.toThrow('preprod');
    expect(f.signTx).not.toHaveBeenCalled();expect(f.getUtxos).not.toHaveBeenCalled();
  });
  it('reports an empty wallet without requesting a signature',async()=>{
    const f=await fixture();f.api.getUtxos=async()=>[];
    await expect(signPayment(f.api,f.required,f.config)).rejects.toThrow('No spendable UTxOs');
    expect(f.signTx).not.toHaveBeenCalled();
  });
  it('caps transaction validity at the quote deadline even when signing starts late',async()=>{
    const f=await fixture();const expiresAt=Date.now()+120_000;
    const signature=await signPayment(f.api,f.required,f.config,expiresAt);
    const payload=decodePaymentSignatureHeader(signature);
    const decoded=decodeCardanoTransaction(payload.payload.transaction as string);
    const validityTime=preprod.slotConfig.zeroTime+(decoded.ttlSlot!-preprod.slotConfig.zeroSlot)*BigInt(preprod.slotConfig.slotLength);
    expect(validityTime).toBeLessThanOrEqual(BigInt(expiresAt-30_000));
    expect(validityTime).toBeGreaterThan(BigInt(Date.now()));
    expect(f.signTx).toHaveBeenCalledOnce();expect(f.submitTx).not.toHaveBeenCalled();
  });
  it('refuses a quote too close to expiry before asking the wallet to sign',async()=>{
    const f=await fixture();
    await expect(signPayment(f.api,f.required,f.config,Date.now()+10_000)).rejects.toThrow('fresh quote');
    expect(f.signTx).not.toHaveBeenCalled();expect(f.submitTx).not.toHaveBeenCalled();
  });
});
