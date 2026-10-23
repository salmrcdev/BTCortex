import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { consoleBlockReason, parseHelpCatalogue, RPC_RISKS, rpcMethodRisk } from './catalogue';

describe('RPC catalogue', () => {
  it('reads methods and categories from help', () => {
    const text =
      '== Blockchain ==\ngetbestblockhash\ngetblock "blockhash" ( verbosity )\n\n== Wallet ==\nlistwallets\n';
    expect(parseHelpCatalogue(text)).toEqual([
      { name: 'getbestblockhash', category: 'Blockchain' },
      { name: 'getblock', category: 'Blockchain' },
      { name: 'listwallets', category: 'Wallet' },
    ]);
  });

  it('classifies methods, treating unknown ones as dangerous and secret', () => {
    expect(rpcMethodRisk('getblockchaininfo')).toEqual({ risk: 'read', secret: false });
    expect(rpcMethodRisk('sendtoaddress')).toEqual({ risk: 'dangerous', secret: false });
    expect(rpcMethodRisk('gettxoutsetinfo').risk).toBe('heavy');
    expect(rpcMethodRisk('somefuturemethod')).toEqual({ risk: 'dangerous', secret: true });
  });

  it('classifies every method of Bitcoin Core 31.1 and Bitcoin Knots 29.4.2', () => {
    // help from regtest nodes of both, 2026-10-23.
    for (const file of ['bitcoin-core-31.1-help.txt', 'bitcoin-knots-29.4.2-help.txt']) {
      const methods = parseHelpCatalogue(readFileSync(join(import.meta.dirname, 'testdata', file), 'utf8'));
      expect(methods.length, file).toBeGreaterThan(150);
      expect(
        methods.filter(({ name }) => !(name in RPC_RISKS)).map(({ name }) => name),
        file,
      ).toEqual([]);
    }
  });

  it('refuses calls that would pass private keys or passphrases through BTCortex', () => {
    expect(consoleBlockReason('getblockcount', [])).toBeUndefined();
    expect(consoleBlockReason('stop', [])).toContain('Stop in BTCortex');
    expect(consoleBlockReason('signrawtransactionwithkey', ['00', ['key']])).toContain('private keys');
    expect(consoleBlockReason('listdescriptors', [])).toBeUndefined();
    expect(consoleBlockReason('listdescriptors', [true])).toContain('private keys');
    expect(consoleBlockReason('gethdkeys', [{ private: true }])).toContain('private keys');
    expect(consoleBlockReason('gethdkeys', { options: { private: true } })).toContain('private keys');
    expect(consoleBlockReason('createwallet', ['watch', true, true])).toBeUndefined();
    expect(consoleBlockReason('createwallet', ['spend', false, false, 'hunter2'])).toContain('passphrase');
    expect(consoleBlockReason('setmocktime', [0])).toContain('test-only');
    // Legacy wallets, which Bitcoin Knots and Bitcoin Core before 30 still have.
    for (const method of [
      'dumpprivkey',
      'dumpmasterprivkey',
      'dumpwallet',
      'importprivkey',
      'importmulti',
      'sethdseed',
      'sweepprivkeys',
    ]) {
      expect(consoleBlockReason(method, []), method).toMatch(/private key/);
    }
  });
});
