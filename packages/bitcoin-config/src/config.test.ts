import { describe, expect, it } from 'vitest';
import { effectiveScalar, resolveEffective } from './effective';
import { interpretBoolean, lookupOption } from './options';
import { BitcoinConfig } from './parser';
import { recommendConfiguration } from './recommend';
import { validateConfig } from './validate';

const SAMPLE = [
  '# My node — hand-written notes',
  'server=1',
  'prune=550   # keep it small',
  'customthing=42',
  '',
  '[test]',
  'rpcport=18332',
  '',
  '[regtest]',
  'fallbackfee=0.0002',
  '',
].join('\r\n');

describe('BitcoinConfig parser', () => {
  it('round-trips files byte for byte, including CRLF and unknown options', () => {
    expect(BitcoinConfig.parse(SAMPLE).toString()).toBe(SAMPLE);
    expect(BitcoinConfig.parse('a=1').toString()).toBe('a=1');
    expect(BitcoinConfig.parse('').toString()).toBe('');
  });

  it('parses sections, prefixes, inline comments and invalid lines', () => {
    const config = BitcoinConfig.parse('regtest.rpcport=1\n[main]\nprune=550 # note\n-txindex=1\ntxindex\n[mainnet]\n');
    const settings = config.settings();
    expect(settings[0]).toMatchObject({ key: 'rpcport', scope: 'regtest', prefixed: true, value: '1' });
    expect(settings[1]).toMatchObject({ key: 'prune', scope: 'main', value: '550', comment: ' note' });
    const issues = config.issues().map((issue) => issue.line);
    expect(issues).toEqual([4, 5, 6]);
  });

  it('refuses # inside rpcpassword, as Bitcoin Core does', () => {
    const config = BitcoinConfig.parse('rpcpassword=abc#def\n');
    expect(config.issues()[0]?.message).toContain('rpcpassword');
  });

  it('edits values in place, keeps comments and appends to the right scope', () => {
    const config = BitcoinConfig.parse(SAMPLE);
    config.set('prune', '24000', { scope: null });
    config.set('dbcache', '1024', { scope: null });
    config.set('rpcport', '18450', { scope: 'regtest' });
    config.set('txindex', '1', { scope: 'signet' });
    const text = config.toString();
    expect(text).toContain('prune=24000 # keep it small');
    expect(text).toContain('customthing=42');
    // Global insertion lands before the first section.
    expect(text.indexOf('dbcache=1024')).toBeLessThan(text.indexOf('[test]'));
    expect(text.indexOf('rpcport=18450')).toBeGreaterThan(text.indexOf('[regtest]'));
    expect(text).toMatch(/\[signet\]\r\ntxindex=1/);
    expect(text.startsWith('# My node — hand-written notes')).toBe(true);
  });

  it('collapses duplicate scalar assignments when setting a value', () => {
    const config = BitcoinConfig.parse('dbcache=100\ndbcache=200\n');
    config.set('dbcache', '300', { scope: null });
    expect(config.toString()).toBe('dbcache=300\n');
  });

  it('replaces list values and removes options', () => {
    const config = BitcoinConfig.parse('addnode=a\nserver=1\naddnode=b\n');
    config.setList('addnode', ['c', 'd'], { scope: null });
    expect(config.valuesIn('addnode', { scope: null })).toEqual(['c', 'd']);
    expect(config.unset('server', { scope: null })).toBe(true);
    expect(config.toString()).not.toContain('server=1');
  });

  it('edits lists in place, keeping the comments and positions of values that stay', () => {
    const config = BitcoinConfig.parse(
      ['# Peers', 'addnode=192.168.1.20 # my laptop node', 'addnode=10.0.0.9', '', '# Other', 'dbcache=450', ''].join(
        '\n',
      ),
    );
    config.setList('addnode', ['192.168.1.20', '10.0.0.7'], { scope: null });
    expect(config.toString()).toBe(
      ['# Peers', 'addnode=192.168.1.20 # my laptop node', 'addnode=10.0.0.7', '', '# Other', 'dbcache=450', ''].join(
        '\n',
      ),
    );
    // A value added next to a prefixed line keeps the network prefix, so it stays in that network.
    const prefixed = BitcoinConfig.parse('regtest.addnode=a\n[main]\n');
    prefixed.setList('addnode', ['a', 'b'], { scope: 'regtest' });
    expect(prefixed.toString()).toBe('regtest.addnode=a\nregtest.addnode=b\n[main]\n');
    expect(prefixed.valuesIn('addnode', { scope: 'regtest' })).toEqual(['a', 'b']);
  });
});

describe('effective settings', () => {
  it('applies network sections over global values and first-wins inside a scope', () => {
    const config = BitcoinConfig.parse('dbcache=100\ndbcache=200\n[regtest]\ndbcache=300\n');
    expect(effectiveScalar(resolveEffective(config, 'mainnet'), 'dbcache')).toBe('100');
    const regtest = resolveEffective(config, 'regtest');
    expect(effectiveScalar(regtest, 'dbcache')).toBe('300');
    expect(regtest.get('dbcache')?.ignoredLines).toEqual([1, 2]);
  });

  it('applies network-only options outside a section to mainnet only', () => {
    const config = BitcoinConfig.parse('rpcport=9999\n');
    expect(effectiveScalar(resolveEffective(config, 'mainnet'), 'rpcport')).toBe('9999');
    expect(effectiveScalar(resolveEffective(config, 'signet'), 'rpcport')).toBeUndefined();
  });

  it('understands negation', () => {
    const config = BitcoinConfig.parse('nolisten=1\n');
    const effective = resolveEffective(config, 'mainnet');
    expect(effectiveScalar(effective, 'listen')).toBe('0');
    expect(effective.get('listen')?.negated).toBe(true);
    expect(lookupOption('nolisten')?.negated).toBe(true);
  });

  it('reads booleans with atoi semantics', () => {
    expect(interpretBoolean('1')).toBe(true);
    expect(interpretBoolean('0')).toBe(false);
    expect(interpretBoolean('true')).toBe(false);
  });
});

describe('validateConfig', () => {
  const codes = (text: string, network: Parameters<typeof validateConfig>[1]['network'] = 'mainnet') =>
    validateConfig(BitcoinConfig.parse(text), {
      network,
      windows: true,
      totalMemoryBytes: 6_340_771_840,
      managed: true,
    }).map((diagnostic) => diagnostic.code);

  it('reports fatal combinations Bitcoin Core refuses at start-up', () => {
    expect(codes('prune=550\ntxindex=1\n')).toContain('prune-conflict');
    expect(codes('prune=100\n')).toContain('prune-too-small');
    expect(codes('peerblockfilters=1\n')).toContain('missing-block-filters');
    expect(codes('daemon=1\n')).toContain('daemon-unsupported');
    expect(codes('conf=other.conf\n')).toContain('command-line-only');
  });

  it('flags removed, deprecated, unknown and mistyped options', () => {
    expect(codes('upnp=1\n')).toContain('removed-option');
    expect(codes('mempoolfullrbf=1\n')).toContain('removed-option');
    expect(codes('testnet=1\n')).toContain('deprecated-option');
    expect(codes('txindx=1\n')).toContain('unknown-option');
    expect(codes('txindex=true\n')).toContain('boolean-format');
    expect(codes('onlynet=tor\n')).toContain('invalid-network');
    expect(codes('maxconnections=lots\n')).toContain('invalid-integer');
  });

  it('warns about exposure and surprising behaviour', () => {
    expect(codes('rpcallowip=0.0.0.0/0\n')).toContain('rpc-exposed');
    expect(codes('rpcallowip=127.0.0.1\n')).not.toContain('rpc-exposed');
    expect(codes('rpcwhitelist=alice:getblockcount\n')).toContain('whitelist-locks-out');
    expect(codes('blocknotify=curl http://example.org/%s\n')).toContain('executes-commands');
    expect(codes('rest=1\n')).toContain('rest-enabled');
    expect(codes('reindex=1\n')).toContain('one-shot-in-file');
    expect(codes('dbcache=8000\n')).toContain('dbcache-too-large');
    expect(codes('rpcport=1\n', 'regtest')).toContain('network-only-ignored');
  });

  it('accepts a clean managed configuration', () => {
    expect(
      codes('server=1\nprune=24000\ndbcache=1024\nmaxmempool=300\nmaxconnections=40\nlisten=0\nnatpmp=0\n'),
    ).toEqual([]);
  });
});

describe('recommendConfiguration', () => {
  const GB = 1_000_000_000;
  const testMachine = {
    totalMemoryBytes: 6_340_771_840,
    availableMemoryBytes: 2_500_000_000,
    freeDiskBytes: 73 * GB,
    volumeBytes: 136 * GB,
    logicalProcessors: 6,
  };

  it('prunes mainnet on a small disk and explains the consequences', () => {
    const recommendation = recommendConfiguration({
      network: 'mainnet',
      usage: 'wallet-backend',
      hardware: testMachine,
    });
    expect(recommendation.feasible).toBe(true);
    expect(recommendation.pruned).toBe(true);
    // 73 − 14 − 13.6 (10% reserve) − 2 = 43.4 GB available → half ≈ 20 697 MiB → 20 000 MiB.
    expect(recommendation.pruneTargetMiB).toBe(20_000);
    expect(recommendation.settings.find((setting) => setting.key === 'listen')?.value).toBe('0');
    expect(recommendation.consequences.length).toBeGreaterThan(0);
    const config = BitcoinConfig.empty();
    for (const setting of recommendation.settings) config.set(setting.key, setting.value, { scope: null });
    expect(
      validateConfig(config, { network: 'mainnet', windows: true, totalMemoryBytes: testMachine.totalMemoryBytes }),
    ).toEqual([]);
  });

  it('refuses an Electrum backend that cannot hold the full chain', () => {
    const recommendation = recommendConfiguration({
      network: 'mainnet',
      usage: 'electrum-backend',
      hardware: testMachine,
    });
    expect(recommendation.feasible).toBe(false);
    expect(recommendation.blockers[0]).toContain('Electrum server');
  });

  it('indexes transactions from the start for an Electrum backend, and counts the indexes in the space', () => {
    const roomy = { ...testMachine, freeDiskBytes: 2000 * GB, volumeBytes: 4000 * GB };
    const electrum = recommendConfiguration({ network: 'mainnet', usage: 'electrum-backend', hardware: roomy });
    const wallet = recommendConfiguration({ network: 'mainnet', usage: 'wallet-backend', hardware: roomy });
    expect(electrum.feasible).toBe(true);
    expect(electrum.pruned).toBe(false);
    expect(electrum.settings.find((setting) => setting.key === 'txindex')?.value).toBe('1');
    expect(wallet.settings.find((setting) => setting.key === 'txindex')).toBeUndefined();
    expect(electrum.estimatedFootprintBytes - wallet.estimatedFootprintBytes).toBeGreaterThan(300 * GB);
    expect(electrum.consequences.join(' ')).toContain('Fulcrum');
    // Room for the chain alone is not enough.
    const tight = recommendConfiguration({
      network: 'mainnet',
      usage: 'electrum-backend',
      hardware: { ...roomy, freeDiskBytes: 1000 * GB },
    });
    expect(tight.feasible).toBe(false);
  });

  it('keeps small test chains unpruned and reduces the cache when memory is scarce', () => {
    const signet = recommendConfiguration({ network: 'signet', usage: 'general', hardware: testMachine });
    expect(signet.pruned).toBe(false);
    const lowMemory = recommendConfiguration({
      network: 'regtest',
      usage: 'general',
      hardware: { ...testMachine, totalMemoryBytes: 3 * 1024 ** 3, availableMemoryBytes: 1024 ** 3 },
    });
    expect(lowMemory.settings.find((setting) => setting.key === 'dbcache')?.value).toBe('450');
    expect(lowMemory.settings.find((setting) => setting.key === 'maxmempool')?.value).toBe('150');
  });
});
