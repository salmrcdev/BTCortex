// A simulated hardware wallet for integration tests. It answers Bitcoin Core's
// external signer calls the way HWI does, and signs with a regtest wallet that
// holds the private keys, standing in for the device. Its settings come from
// the JSON file named by BTCORTEX_MOCK_SIGNER; every call is logged there.

import { appendFileSync, readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.env.BTCORTEX_MOCK_SIGNER ?? '', 'utf8'));
const args = process.argv.slice(2);
const input = args.includes('--stdin') ? readFileSync(0, 'utf8') : '';
const command =
  ['enumerate', 'getdescriptors', 'displayaddress'].find((name) => args.includes(name)) ??
  (input.startsWith('signtx') ? 'signtx' : 'unknown');
appendFileSync(config.log, `${JSON.stringify({ command, args })}\n`);

async function rpc(method, params, wallet) {
  const cookie = readFileSync(config.cookieFile, 'utf8').trim();
  const url = wallet === undefined ? config.rpcUrl : `${config.rpcUrl}/wallet/${encodeURIComponent(wallet)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(cookie).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

function reply(value) {
  process.stdout.write(JSON.stringify(value));
}

try {
  if (command === 'enumerate') {
    reply([
      {
        type: 'trezor',
        model: config.model,
        path: 'simulated',
        fingerprint: config.fingerprint,
        needs_pin_sent: false,
        needs_passphrase_sent: false,
      },
    ]);
  } else if (command === 'getdescriptors') {
    reply({ receive: config.receive, internal: config.internal });
  } else if (command === 'displayaddress') {
    const [address] = await rpc('deriveaddresses', [args[args.indexOf('--desc') + 1]]);
    reply({ address: config.echo ?? address });
  } else if (command === 'signtx') {
    const psbt = input.trim().split(/\s+/)[1];
    const signed = await rpc('walletprocesspsbt', [psbt, true, 'DEFAULT', true, false], config.wallet);
    reply({ psbt: signed.psbt, signed: true });
  } else {
    reply({ error: 'The simulated device does not support this command.', code: -9 });
  }
} catch (error) {
  reply({ error: error instanceof Error ? error.message : String(error), code: -13 });
}
