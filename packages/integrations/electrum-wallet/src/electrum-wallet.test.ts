import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  electrumArguments,
  electrumExecutableIn,
  electrumReleaseFiles,
  ELECTRUM_TRUSTED_KEYS,
  fetchLatestElectrumVersion,
  isCompatibleElectrumVersion,
  parseRegistryValues,
} from './index';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Electrum releases', () => {
  it('names the standalone executable and its signatures', () => {
    expect(electrumReleaseFiles('4.8.2')).toEqual({
      executableName: 'electrum-4.8.2.exe',
      executable: 'https://download.electrum.org/4.8.2/electrum-4.8.2.exe',
      signature: 'https://download.electrum.org/4.8.2/electrum-4.8.2.exe.asc',
    });
    expect(() => electrumReleaseFiles('4.8.2/../x')).toThrow(/not an Electrum release/);
  });

  it('pins ThomasV’s and SomberNight’s keys', () => {
    expect(ELECTRUM_TRUSTED_KEYS.map((key) => key.fingerprints[0])).toEqual([
      '6694D8DE7BE8EE5631BED9502BD5824B7F9470E6',
      '0EEDCFD5CAFB459067349B23CA9EEEC43DF911DC',
    ]);
  });

  it('offers only versions the Electrum servers can serve', () => {
    expect(isCompatibleElectrumVersion('4.8.2')).toBe(true);
    expect(isCompatibleElectrumVersion('4.7.2')).toBe(true);
    expect(isCompatibleElectrumVersion('4.9.0')).toBe(false);
    expect(isCompatibleElectrumVersion('5.0.0')).toBe(false);
  });

  it('reads the latest version from Electrum’s own update file', async () => {
    const answer = (body: unknown) =>
      (() => Promise.resolve(new Response(JSON.stringify(body)))) as unknown as typeof fetch;
    expect(await fetchLatestElectrumVersion(answer({ version: '4.8.2', signatures: {} }))).toBe('4.8.2');
    await expect(fetchLatestElectrumVersion(answer({ version: '4.8.2rc1' }))).rejects.toThrow(/latest release/);
  });
});

describe('Electrum on this computer', () => {
  it('starts Electrum on the node’s network with only the given server', () => {
    expect(electrumArguments('mainnet', '127.0.0.1:50001:t')).toEqual(['--oneserver', '--server', '127.0.0.1:50001:t']);
    expect(electrumArguments('testnet4', '127.0.0.1:40001:t')[0]).toBe('--testnet4');
    expect(electrumArguments('regtest', '127.0.0.1:60401:t')).toEqual([
      '--regtest',
      '--oneserver',
      '--server',
      '127.0.0.1:60401:t',
    ]);
    expect(() => electrumArguments('mainnet', '127.0.0.1:50001 --proxy x')).toThrow(/not an Electrum server/);
  });

  it('reads registry values whatever the display language', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Electrum',
      '    DisplayName    REG_SZ    Electrum',
      '    UninstallString    REG_SZ    C:\\Program Files\\Electrum\\Uninstall.exe',
      '    DisplayVersion    REG_SZ    4.7.2',
      '    EstimatedSize    REG_DWORD    0x272f3',
      '    (Predefinito)    REG_SZ    C:\\Program Files\\Electrum',
    ].join('\r\n');
    const values = parseRegistryValues(output);
    expect(values.get('DisplayVersion')).toBe('4.7.2');
    expect(values.get('UninstallString')).toBe('C:\\Program Files\\Electrum\\Uninstall.exe');
    expect(values.has('EstimatedSize')).toBe(false);
  });

  it('finds the program in an installation folder, never the debug build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'btcortex-electrum-'));
    directories.push(directory);
    for (const name of ['electrum-4.7.2-debug.exe', 'electrum-4.7.2.exe', 'Uninstall.exe']) {
      writeFileSync(join(directory, name), 'MZ');
    }
    expect(electrumExecutableIn(directory, '4.7.2')).toBe(join(directory, 'electrum-4.7.2.exe'));
    expect(electrumExecutableIn(directory, undefined)).toBe(join(directory, 'electrum-4.7.2.exe'));
    expect(electrumExecutableIn(join(directory, 'missing'), '4.7.2')).toBeUndefined();
  });
});
