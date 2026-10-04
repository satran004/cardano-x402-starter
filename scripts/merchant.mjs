import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { Client, Address, PrivateKey, preprod } from '../frontend/node_modules/@evolution-sdk/evolution/dist/index.js';
const dir = new URL('../.local/', import.meta.url);
await mkdir(dir, { recursive: true, mode: 0o700 });
const file = new URL('merchant.json', dir);
let merchant;
try { merchant = JSON.parse(await readFile(file, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const mnemonic = PrivateKey.generateMnemonic();
  const wallet = Client.make(preprod).withSeed({ mnemonic });
  const address = Address.toBech32(await wallet.address());
  merchant = { network: 'cardano:preprod', address, mnemonic };
  await writeFile(file, JSON.stringify(merchant, null, 2) + '\n', { mode: 0o600 });
}
const envFile = new URL('../.env', import.meta.url);
let env = await readFile(envFile, 'utf8');
const old = env.match(/^PAY_TO=(.*)$/m)?.[1];
if (old && old !== merchant.address && old !== 'addr_test1_replace_me') throw new Error('PAY_TO is already set to a different recipient; leave it unchanged.');
env = /^PAY_TO=/m.test(env) ? env.replace(/^PAY_TO=.*$/m, 'PAY_TO=' + merchant.address) : env + '\nPAY_TO=' + merchant.address + '\n';
await writeFile(envFile, env, { mode: 0o600 }); await chmod(envFile, 0o600);
console.log('Merchant preprod receiving address: ' + merchant.address);
console.log('Recovery phrase stored privately in .local/merchant.json (never printed).');
