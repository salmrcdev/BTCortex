import { describe, expect, it } from 'vitest';
import { analyseDraft, lineRange, optionStates, setOption, unknownSettings } from './config-model';

const SAVED = [
  '# Managed by BTCortex',
  'chain=regtest',
  'dbcache=450 # tuned',
  '',
  '[regtest]',
  'rpcport=18543',
  '',
].join('\n');

describe('setOption', () => {
  it('changes a value in place, keeping its comment', () => {
    expect(setOption(SAVED, 'dbcache', ['1024'], 'regtest')).toBe(SAVED.replace('dbcache=450', 'dbcache=1024'));
  });

  it('puts network-only options into the network section and others into the global scope', () => {
    const withPort = setOption(SAVED, 'port', ['18544'], 'regtest');
    expect(withPort).toContain('[regtest]\nrpcport=18543\nport=18544');
    const withPrune = setOption(SAVED, 'prune', ['550'], 'regtest');
    expect(withPrune.split('[regtest]')[0]).toContain('prune=550');
  });

  it('removes every assignment and negation when returning to the default', () => {
    const text = 'dbcache=450\nnodbcache=1\n[regtest]\ndbcache=300\n';
    expect(setOption(text, 'dbcache', undefined, 'regtest')).toBe('[regtest]\n');
  });

  it('replaces list values so that the new list is the only one', () => {
    const text = 'rpcallowip=127.0.0.1\n[regtest]\nrpcallowip=10.0.0.1\n';
    const result = setOption(text, 'rpcallowip', ['127.0.0.1', '::1'], 'regtest');
    expect(result).toBe('[regtest]\nrpcallowip=127.0.0.1\nrpcallowip=::1\n');
  });
});

describe('analyseDraft', () => {
  it('reports changes, risky changes and managed settings for the node’s network', () => {
    // Managed nodes start with listen=0, so turning it on widens exposure.
    const saved = setOption(SAVED, 'listen', ['0'], 'regtest');
    const draft = setOption(setOption(saved, 'listen', ['1'], 'regtest'), 'rpcport', ['18600'], 'regtest');
    const analysis = analyseDraft(saved, draft, 'regtest', true);
    expect(analysis.changes.map((change) => change.key)).toEqual(['listen', 'rpcport']);
    expect(analysis.risky.map(({ change }) => change.key)).toEqual(['listen']);
    expect(analysis.errorCount).toBe(1);
    const states = optionStates(analysis, [{ key: 'server', value: '1' }], true);
    expect(states.find((state) => state.definition.key === 'rpcport')).toMatchObject({
      changed: true,
      locked: expect.stringContaining('connects') as string,
      values: ['18600'],
    });
    expect(states.find((state) => state.definition.key === 'server')?.commandLine).toBe('1');
  });

  it('lists options BTCortex does not know, with their lines', () => {
    expect(unknownSettings(analyseDraft('', 'mything=1\ndbcache=4\n', 'mainnet', false).config)).toEqual([
      { key: 'mything', value: '1', line: 1 },
    ]);
  });
});

describe('lineRange', () => {
  it('finds the characters of a line', () => {
    expect(lineRange('a=1\nbb=2\nc=3', 2)).toEqual({ start: 4, end: 8 });
    expect(lineRange('a=1', 5)).toEqual({ start: 3, end: 3 });
  });
});
