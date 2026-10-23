import { describe, expect, it } from 'vitest';
import { hwiChain, HwiClient, HwiError } from './client';
import type { HwiRunner } from './client';
import { hwiReleaseFiles } from './release';

interface Call {
  args: readonly string[];
  input?: string;
}

function fakeHwi(answer: (call: Call) => unknown): { client: HwiClient; calls: Call[] } {
  const calls: Call[] = [];
  const run: HwiRunner = (args, options) => {
    const call = { args, ...(options.input === undefined ? {} : { input: options.input }) };
    calls.push(call);
    return Promise.resolve({ stdout: JSON.stringify(answer(call)), stderr: '', exitCode: 0 });
  };
  return { client: new HwiClient({ executable: 'hwi.exe', run }), calls };
}

const PSBT = 'cHNidP8BAHECAAAAAQ==';

describe('HWI client', () => {
  it('lists devices, keeping what HWI reports about each', async () => {
    const { client, calls } = fakeHwi(() => [
      {
        type: 'trezor',
        model: 'trezor_safe 5',
        path: 'webusb:000:1',
        label: 'My Trezor',
        fingerprint: 'd34db33f',
        needs_pin_sent: false,
        needs_passphrase_sent: false,
      },
      {
        type: 'trezor',
        model: 'trezor_safe 7',
        path: 'webusb:000:2',
        needs_pin_sent: true,
        needs_passphrase_sent: false,
        error: 'Could not open client or get fingerprint information',
        code: -13,
      },
    ]);
    expect(await client.enumerate('regtest')).toEqual([
      {
        type: 'trezor',
        model: 'trezor_safe 5',
        path: 'webusb:000:1',
        label: 'My Trezor',
        fingerprint: 'd34db33f',
        needsPinSent: false,
        needsPassphraseSent: false,
      },
      {
        type: 'trezor',
        model: 'trezor_safe 7',
        path: 'webusb:000:2',
        needsPinSent: true,
        needsPassphraseSent: false,
        error: 'Could not open client or get fingerprint information',
        code: -13,
      },
    ]);
    expect(calls[0]?.args).toEqual(['--chain', 'regtest', 'enumerate']);
  });

  it('asks for descriptors, shows addresses and signs with exactly the arguments Bitcoin Core uses', async () => {
    const { client, calls } = fakeHwi((call) => {
      if (call.args.includes('getdescriptors')) return { receive: ['wpkh(x)'], internal: ['wpkh(y)'] };
      if (call.args.includes('displayaddress')) return { address: 'bcrt1qexample' };
      return { psbt: PSBT, signed: true };
    });
    expect(await client.getDescriptors('D34DB33F', 'main', 1)).toEqual({ receive: ['wpkh(x)'], internal: ['wpkh(y)'] });
    expect(await client.displayAddress('d34db33f', 'test', 'wpkh([d34db33f/84h/1h/0h]tpub/0/0)#abcd')).toBe(
      'bcrt1qexample',
    );
    expect(await client.signTx('d34db33f', 'signet', PSBT)).toEqual({ psbt: PSBT, signed: true });
    expect(calls).toEqual([
      { args: ['--fingerprint', 'd34db33f', '--chain', 'main', 'getdescriptors', '--account', '1'] },
      {
        args: [
          '--fingerprint',
          'd34db33f',
          '--chain',
          'test',
          'displayaddress',
          '--desc',
          'wpkh([d34db33f/84h/1h/0h]tpub/0/0)#abcd',
        ],
      },
      // The PSBT travels on standard input, never on the command line.
      { args: ['--stdin', '--fingerprint', 'd34db33f', '--chain', 'signet'], input: `signtx ${PSBT}\n` },
    ]);
  });

  it('turns HWI’s error objects into HwiError with HWI’s code', async () => {
    const { client } = fakeHwi(() => ({ error: 'Could not find device with specified fingerprint or type', code: -3 }));
    const failure = await client.getDescriptors('d34db33f', 'regtest').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HwiError);
    expect(failure).toMatchObject({ code: -3 });
  });

  it('refuses malformed arguments before anything runs', async () => {
    const { client, calls } = fakeHwi(() => ({}));
    await expect(client.getDescriptors('not-a-fingerprint', 'main')).rejects.toBeInstanceOf(HwiError);
    await expect(client.displayAddress('d34db33f', 'main', 'wpkh(x) --password p')).rejects.toBeInstanceOf(HwiError);
    await expect(client.signTx('d34db33f', 'main', 'not base64!')).rejects.toBeInstanceOf(HwiError);
    expect(calls).toEqual([]);
  });

  it('maps Bitcoin networks to HWI chains and names the release files', () => {
    expect(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'].map(hwiChain)).toEqual([
      'main',
      'test',
      'testnet4',
      'signet',
      'regtest',
    ]);
    expect(hwiReleaseFiles('3.2.0')).toEqual({
      manifest: 'https://github.com/bitcoin-core/HWI/releases/download/3.2.0/SHA256SUMS.txt.asc',
      archiveName: 'hwi-3.2.0-windows-x86_64.zip',
      archive: 'https://github.com/bitcoin-core/HWI/releases/download/3.2.0/hwi-3.2.0-windows-x86_64.zip',
    });
  });
});
