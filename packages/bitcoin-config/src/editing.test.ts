import { describe, expect, it } from 'vitest';
import { describeChanges, managedSettingChanges, riskyChanges } from './changes';
import { effectiveScalar, resolveEffective } from './effective';
import { BitcoinConfig } from './parser';
import { containsSecretPlaceholder, isSecretOption, maskSecrets, restoreSecrets, secretPlaceholder } from './secrets';
import { validateConfig } from './validate';

const WITH_SECRETS = [
  'rpcauth=alice:5f1a$9c0d  # laptop',
  'rpcauth=bob:77aa$e3f1',
  'torpassword=pa$$word',
  'norpcpassword=1',
  'dbcache=450',
  '',
].join('\n');

function mask(text: string) {
  const { config, hidden } = maskSecrets(BitcoinConfig.parse(text));
  return { masked: config.toString(), hidden };
}

describe('secret masking', () => {
  it('hides secret values and everything after them, keeping rpcauth user names and other lines', () => {
    const { masked, hidden } = mask(WITH_SECRETS);
    expect(masked).toBe(
      [
        `rpcauth=alice:${secretPlaceholder(1)}`,
        `rpcauth=bob:${secretPlaceholder(2)}`,
        `torpassword=${secretPlaceholder(3)}`,
        'norpcpassword=1',
        'dbcache=450',
        '',
      ].join('\n'),
    );
    expect(hidden.get(1)).toEqual({ key: 'rpcauth', value: '5f1a$9c0d  # laptop' });
    expect(hidden.get(3)).toEqual({ key: 'torpassword', value: 'pa$$word' });
  });

  it('puts the original values back, even after lines were removed or reordered', () => {
    const { masked, hidden } = mask(WITH_SECRETS);
    // The user deletes alice's line and moves bob's below a new setting.
    const edited = BitcoinConfig.parse(
      masked
        .split('\n')
        .filter((line) => !line.startsWith('rpcauth=alice'))
        .join('\n')
        .replace(`rpcauth=bob:${secretPlaceholder(2)}`, `prune=550\nrpcauth=bob:${secretPlaceholder(2)}`),
    );
    const { config, unresolvedLines } = restoreSecrets(edited, hidden);
    expect(unresolvedLines).toEqual([]);
    expect(config.toString()).toContain('rpcauth=bob:77aa$e3f1');
    expect(config.toString()).toContain('torpassword=pa$$word');
    expect(config.toString()).not.toContain('alice');
    expect(containsSecretPlaceholder(config.toString())).toBe(false);
  });

  it('never puts a secret back anywhere masking would not have put it', () => {
    const { masked, hidden } = mask('chain=regtest\ntorpassword=hunter2\nrpcauth=alice:5f1a$9c0d\n');
    expect(masked).toContain(`torpassword=${secretPlaceholder(1)}`);
    const attempts = [
      // Into a comment that masking would not cover the same way, an option name, a trailing comment,
      // another option, or a placeholder that does not exist.
      `#torpassword note ${secretPlaceholder(1)}`,
      `torpassword${secretPlaceholder(1)}=x`,
      `rpcauth=bob:00$00 # ${secretPlaceholder(2)}`,
      `rpcpassword=${secretPlaceholder(1)}`,
      `torpassword=${secretPlaceholder(9)}`,
      `torpassword=${secretPlaceholder(1)}${secretPlaceholder(1)}`,
      `uacomment=${secretPlaceholder(1)}`,
    ];
    for (const attempt of attempts) {
      const { config, unresolvedLines } = restoreSecrets(BitcoinConfig.parse(`${attempt}\n`), hidden);
      expect(unresolvedLines, attempt).toEqual([1]);
      expect(config.toString(), attempt).not.toMatch(/hunter2|5f1a/);
    }
  });

  it('puts a secret back only where the next reading hides it again', () => {
    const { masked, hidden } = mask('chain=regtest\nrpcauth=alice:5f1a$9c0d\ntorpassword=hunter2\n');
    // Glued to the option name, the restored text would read as another word and come back in clear.
    const attempts = [
      `#torpassword${secretPlaceholder(2)}`,
      `#rpcauth${secretPlaceholder(1)}`,
      `dbcache=450 #torpassword${secretPlaceholder(2)}`,
    ];
    for (const attempt of attempts) {
      const { config, unresolvedLines, restoredLines } = restoreSecrets(
        BitcoinConfig.parse(`${masked}${attempt}\n`),
        hidden,
      );
      expect(unresolvedLines, attempt).toEqual([4]);
      expect(restoredLines, attempt).toEqual([2, 3]);
      // The rejected line keeps its placeholder; the secret stays only where it was.
      expect(config.toString().split('\n')[3], attempt).toBe(attempt);
    }
    // A commented-out credential with a separator still goes back, and is hidden again when read.
    const spaced = mask('# rpcpassword spaced-out\n');
    const restored = restoreSecrets(BitcoinConfig.parse(spaced.masked), spaced.hidden);
    expect(restored.unresolvedLines).toEqual([]);
    expect(restored.config.toString()).toBe('# rpcpassword spaced-out\n');
    expect(mask(restored.config.toString()).masked).toBe(`# rpcpassword ${secretPlaceholder(1)}\n`);
  });

  it('hides credentials on malformed and commented-out lines, in any spelling', () => {
    const text = [
      'rpcpassword=abc#def',
      '-torpassword=hunter2',
      '--rpcpassword=two-hyphens',
      '#rpcpassword=old-secret',
      '##rpcpassword=two-hashes',
      '# rpcpassword spaced-out',
      '#my_password=underscore',
      'my_password not-assigned',
      '.rpcauth=dot:5f1a$9c0d',
      'rpcauth=alice:77aa$e3f1 # was bob:0011$2233',
      'server=1 # rpcpassword=in-a-trailing-comment',
      'regtest.rpcpassword=xyz',
      'myservicepassword=se#cret  ',
      '# Managed by BTCortex for "Home" (Regtest)',
      '',
    ].join('\n');
    const { masked, hidden } = mask(text);
    for (const secret of [
      'abc',
      'hunter2',
      'two-hyphens',
      'old-secret',
      'two-hashes',
      'spaced-out',
      'underscore',
      'not-assigned',
      '5f1a',
      '0011',
      'in-a-trailing-comment',
      'xyz',
      'cret',
    ]) {
      expect(masked).not.toContain(secret);
    }
    expect(masked).toContain('# Managed by BTCortex for "Home" (Regtest)');
    expect(masked).toContain('rpcauth=alice:[hidden value');
    // Untouched, everything comes back exactly; with the leading hyphen fixed, the password is kept.
    expect(restoreSecrets(BitcoinConfig.parse(masked), hidden).config.toString()).toBe(text);
    const fixed = BitcoinConfig.parse(masked.replace('-torpassword', 'torpassword'));
    expect(restoreSecrets(fixed, hidden).config.toString()).toContain('\ntorpassword=hunter2\n');
  });

  it('recognises secret options, including unknown ones that look like passwords', () => {
    expect(isSecretOption('rpcpassword')).toBe(true);
    expect(isSecretOption('norpcpassword')).toBe(false);
    expect(isSecretOption('dbcache')).toBe(false);
    expect(isSecretOption('myservicepassword')).toBe(true);
  });
});

describe('reading bitcoin.conf as Bitcoin Core does', () => {
  it('treats a leading dot as the global scope and prefixes inside a section as errors', () => {
    const config = BitcoinConfig.parse('.rpcuser=x\n.blocknotify=calc.exe\n[regtest]\nregtest.rpcport=1\n.rpcport=2\n');
    const [user, notify, prefixed, dotted] = config.settings();
    expect(user).toMatchObject({ key: 'rpcuser', scope: null });
    expect(notify).toMatchObject({ key: 'blocknotify', scope: null });
    expect(prefixed).toMatchObject({ key: 'regtest.rpcport', scope: 'regtest' });
    expect(dotted).toMatchObject({ key: '.rpcport', scope: 'regtest' });
    expect(config.issues().map((issue) => issue.line)).toEqual([4, 5]);
    expect(effectiveScalar(resolveEffective(config, 'regtest'), 'rpcport')).toBeUndefined();
  });

  it('takes section names verbatim and trims only spaces, tabs and line ends', () => {
    const config = BitcoinConfig.parse('[ regtest ]\nrpcport=1\n[regtest]\n listen=1\n');
    expect(config.issues().map((issue) => issue.line)).toEqual([1]);
    const effective = resolveEffective(config, 'regtest');
    expect(effectiveScalar(effective, 'rpcport')).toBeUndefined();
    // A no-break space is part of the name for Bitcoin Core, which then ignores the option.
    expect(effectiveScalar(effective, 'listen')).toBeUndefined();
  });

  it('follows Bitcoin Core’s negation rules', () => {
    const scalar = (text: string, key: string, network: 'mainnet' | 'regtest' = 'mainnet') =>
      effectiveScalar(resolveEffective(BitcoinConfig.parse(text), network), key);
    // A double negative is on; everything before a scope's last negation is dropped.
    expect(scalar('nolisten=0\n', 'listen')).toBe('1');
    expect(scalar('nolisten=1\n', 'listen')).toBe('0');
    expect(scalar('listen=1\nnolisten=1\n', 'listen')).toBe('0');
    expect(scalar('nolisten=1\nlisten=1\n', 'listen')).toBe('1');
    // The first value after the last negation wins in a scope.
    expect(scalar('[regtest]\nrpcport=18543\nnorpcport=1\nrpcport=18600\nrpcport=1\n', 'rpcport', 'regtest')).toBe(
      '18600',
    );
    // A global scope ending with a negation reaches network-only options on test networks; otherwise it is ignored.
    expect(scalar('rpcport=5\nnorpcport=1\n', 'rpcport', 'regtest')).toBe('0');
    expect(scalar('norpcport=1\nrpcport=5\n', 'rpcport', 'regtest')).toBeUndefined();
  });

  it('gathers list values as Bitcoin Core does across scopes', () => {
    const list = (text: string) => resolveEffective(BitcoinConfig.parse(text), 'regtest').get('rpcallowip')?.values;
    expect(list('rpcallowip=10.0.0.1\n[regtest]\nnorpcallowip=1\n')).toEqual([]);
    expect(list('rpcallowip=10.0.0.1\nnorpcallowip=1\n[regtest]\nrpcallowip=192.168.0.1\n')).toEqual(['192.168.0.1']);
    expect(list('rpcallowip=10.0.0.1\n[regtest]\nrpcallowip=192.168.0.1\n')).toEqual(['192.168.0.1', '10.0.0.1']);
  });

  it('reads the chain only from the global scope', () => {
    const config = BitcoinConfig.parse('[regtest]\nchain=regtest\n');
    expect(effectiveScalar(resolveEffective(config, 'regtest'), 'chain')).toBeUndefined();
  });

  it('reports parse errors as errors, so such a file is never saved', () => {
    const diagnostics = validateConfig(BitcoinConfig.parse('[regtest]\nregtest.rpcport=1\n'), { network: 'regtest' });
    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'error' && diagnostic.line === 2)).toBe(true);
  });
});

describe('describeChanges', () => {
  it('reports effective changes only, per network', () => {
    const before = BitcoinConfig.parse('chain=regtest\ndbcache=450\n[regtest]\nrpcport=18543\n');
    const after = BitcoinConfig.parse(
      '# a new comment\nchain=regtest\ndbcache=1024\n[regtest]\nrpcport=18543\n[main]\nprune=550\n',
    );
    expect(describeChanges(before, after, 'regtest')).toEqual([{ key: 'dbcache', before: ['450'], after: ['1024'] }]);
    expect(describeChanges(before, after, 'mainnet').map((change) => change.key)).toEqual(['dbcache', 'prune']);
  });

  it('asks for confirmation whenever exposure widens, including a return to a default that is on', () => {
    const before = BitcoinConfig.parse('listen=0\nnatpmp=0\n');
    const after = BitcoinConfig.parse('listen=1\nrpcallowip=192.168.1.0/24\nblocknotify=curl x\ndbcache=900\n');
    expect(
      riskyChanges(describeChanges(before, after, 'mainnet')).map(({ change, risk }) => [change.key, risk]),
    ).toEqual([
      ['blocknotify', 'executes-commands'],
      ['listen', 'exposure'],
      ['natpmp', 'exposure'],
      ['rpcallowip', 'exposure'],
    ]);
    // Switching things off, or a double negative that reads as off, needs no confirmation.
    expect(riskyChanges(describeChanges(after, before, 'mainnet'))).toEqual([]);
    // nolisten=0 is a double negative: it turns listening on.
    expect(
      riskyChanges(describeChanges(before, BitcoinConfig.parse('nolisten=0\nnatpmp=0\n'), 'mainnet')).map(
        ({ change }) => change.key,
      ),
    ).toEqual(['listen']);
  });
});

describe('managedSettingChanges', () => {
  const before = BitcoinConfig.parse('chain=regtest\n[regtest]\nrpcport=18543\n');
  const keys = (text: string) =>
    managedSettingChanges(before, BitcoinConfig.parse(text), 'regtest').map((diagnostic) => diagnostic.key);

  it('refuses changes to settings BTCortex relies on, however they are written', () => {
    expect(keys('chain=main\nrpcpassword=x\n[regtest]\nrpcport=18600\n')).toEqual(['chain', 'rpcport', 'rpcpassword']);
    expect(keys('# note\nchain=regtest\n[regtest]\nrpcport=18543\n')).toEqual([]);
    // A leading dot is the global scope for Bitcoin Core.
    expect(keys('chain=regtest\n.rpcuser=x\n.rpcpassword=y\n[regtest]\nrpcport=18543\n')).toEqual([
      'rpcuser',
      'rpcpassword',
    ]);
    // Moving the chain into a section removes it for Bitcoin Core.
    expect(keys('[regtest]\nchain=regtest\nrpcport=18543\n')).toEqual(['chain']);
    // A global negation of the RPC port applies to regtest too, when its section does not set the port.
    expect(
      managedSettingChanges(
        BitcoinConfig.parse('chain=regtest\n'),
        BitcoinConfig.parse('chain=regtest\nnorpcport=1\n'),
        'regtest',
      ).map((diagnostic) => diagnostic.key),
    ).toEqual(['rpcport']);
    // A section name with spaces is a different section, so the port is lost.
    expect(keys('chain=regtest\n[ regtest ]\nrpcport=18543\n')).toEqual(['rpcport']);
    // Included files cannot be checked.
    expect(keys('chain=regtest\nincludeconf=\\\\evil.example\\share\\x.conf\n[regtest]\nrpcport=18543\n')).toEqual([
      'includeconf',
    ]);
    // Bitcoin Core reads the global and the network includes separately: a negation in the
    // network section does not drop the global one.
    expect(
      keys('chain=regtest\nincludeconf=\\\\evil.example\\share\\x.conf\n[regtest]\nrpcport=18543\nnoincludeconf=1\n'),
    ).toEqual(['includeconf']);
    expect(keys('chain=regtest\nincludeconf=extra.conf\nregtest.noincludeconf=1\n[regtest]\nrpcport=18543\n')).toEqual([
      'includeconf',
    ]);
    // settings.json overrides bitcoin.conf, so it may not move either.
    expect(keys('chain=regtest\nsettings=\\\\evil.example\\share\\s.json\n[regtest]\nrpcport=18543\n')).toEqual([
      'settings',
    ]);
  });
});

describe('managed connectivity', () => {
  const base = BitcoinConfig.parse('chain=regtest\n');
  const codes = (text: string) =>
    managedSettingChanges(base, BitcoinConfig.parse(`chain=regtest\n${text}`), 'regtest').map(
      (diagnostic) => diagnostic.code,
    );

  it('keeps the RPC address BTCortex connects to reachable', () => {
    expect(codes('rpcallowip=192.168.1.0/24\n[regtest]\nrpcbind=192.168.1.10\n')).toContain('managed-rpc-unreachable');
    expect(codes('rpcallowip=127.0.0.1\n[regtest]\nrpcbind=127.0.0.1:18999\n')).toContain('managed-rpc-unreachable');
    expect(codes('rpcallowip=192.168.1.0/24\n[regtest]\nrpcbind=127.0.0.1\nrpcbind=192.168.1.10\n')).toEqual([]);
    expect(codes('rpcallowip=192.168.1.0/24\n[regtest]\nrpcbind=0.0.0.0\n')).toEqual([]);
    // Bitcoin Core ignores rpcbind without rpcallowip and stays on the loopback address.
    expect(codes('[regtest]\nrpcbind=192.168.1.10\n')).toEqual([]);
  });

  it('locks the process identifier file', () => {
    expect(codes('pid=elsewhere.pid\n')).toEqual(['managed-setting']);
  });
});
