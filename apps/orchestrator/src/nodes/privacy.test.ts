import { describe, expect, it } from 'vitest';
import { applyPrivacy, configuredPrivacy, torEndpoints } from './privacy';

const TOR = torEndpoints({ socks: 9050, applicationSocks: 9052, control: 9054 });

// A managed node's bitcoin.conf as BTCortex writes it: no incoming connections.
const MANAGED = 'server=1\nlisten=0\nnatpmp=0\nmaxconnections=40\n';

describe('node routing through Tor', () => {
  it('reads a node BTCortex set up as direct, without an onion service', () => {
    expect(configuredPrivacy(MANAGED, 'mainnet', TOR)).toEqual({
      mode: 'off',
      onionService: false,
      onionPort: undefined,
      privateBroadcast: false,
      usesTor: false,
      i2p: false,
    });
  });

  it.each([
    ['onion-peers', ['onion=127.0.0.1:9050'], ['proxy=', 'onlynet=']],
    // onion= as well, so that Bitcoin Core never falls back to another program's tor on 9050.
    ['all-traffic', ['proxy=127.0.0.1:9050', 'onion=127.0.0.1:9050'], ['onlynet=']],
    ['tor-only', ['proxy=127.0.0.1:9050', 'onion=127.0.0.1:9050', 'onlynet=onion'], []],
  ] as const)('writes and reads back %s', (mode, present, absent) => {
    const text = applyPrivacy(MANAGED, 'mainnet', { mode, onionService: false, privateBroadcast: true }, TOR, 8334);
    for (const line of present) expect(text).toContain(line);
    for (const line of absent) expect(text).not.toContain(`\n${line}`);
    expect(text).toContain('privatebroadcast=1');
    expect(text).toContain('listen=0');
    expect(configuredPrivacy(text, 'mainnet', TOR)).toMatchObject({
      mode,
      onionService: false,
      privateBroadcast: true,
      usesTor: true,
    });
  });

  it('sets up the onion service on loopback only, and in the network section where Bitcoin Core reads bind', () => {
    const text = applyPrivacy(
      `${MANAGED}regtest=1\n[regtest]\nrpcport=18443\n`,
      'regtest',
      { mode: 'tor-only', onionService: true, privateBroadcast: false },
      TOR,
      18445,
    );
    expect(text).toContain('listen=1');
    expect(text).toContain('torcontrol=127.0.0.1:9054');
    expect(text).toContain('discover=0');
    // bind is a network-only option: outside [regtest] Bitcoin Core would ignore it on regtest.
    expect(text.slice(text.indexOf('[regtest]'))).toContain('bind=127.0.0.1:18445=onion');
    expect(text).not.toMatch(/0\.0\.0\.0/);
    expect(configuredPrivacy(text, 'regtest', TOR)).toMatchObject({
      mode: 'tor-only',
      onionService: true,
      onionPort: 18445,
    });
  });

  it('goes back to direct connections and removes everything it added', () => {
    const tor = applyPrivacy(
      MANAGED,
      'mainnet',
      { mode: 'all-traffic', onionService: true, privateBroadcast: true },
      TOR,
      8334,
    );
    const back = applyPrivacy(tor, 'mainnet', { mode: 'off', onionService: true, privateBroadcast: true }, TOR, 8334);
    expect(back).not.toMatch(/proxy=|onion=|onlynet=|torcontrol=|bind=|privatebroadcast=|discover=|listenonion=/);
    expect(back).toContain('listen=0');
    expect(configuredPrivacy(back, 'mainnet', TOR)).toMatchObject({ mode: 'off', onionService: false, usesTor: false });
  });

  it('calls anything it did not set up custom, and leaves it alone until a mode is chosen', () => {
    // Tor Browser's port, not BTCortex's tor.
    expect(configuredPrivacy(`${MANAGED}proxy=127.0.0.1:9150\n`, 'mainnet', TOR)).toMatchObject({
      mode: 'custom',
      usesTor: false,
    });
    expect(configuredPrivacy(`${MANAGED}onlynet=ipv4\n`, 'mainnet', TOR).mode).toBe('custom');
    // Listening on the network itself is the user's own set-up.
    expect(configuredPrivacy('listen=1\n', 'mainnet', TOR).onionService).toBeNull();
    // A negated proxy is no proxy.
    expect(configuredPrivacy(`${MANAGED}noproxy=1\n`, 'mainnet', TOR).mode).toBe('off');
  });
});

describe('I2P peers through the router on this computer', () => {
  it('adds I2P to any mode with a new address for every connection, and joins onlynet with tor-only', () => {
    const direct = applyPrivacy(
      MANAGED,
      'mainnet',
      { mode: 'off', onionService: false, privateBroadcast: false, i2p: true },
      TOR,
      8334,
    );
    expect(direct).toContain('i2psam=127.0.0.1:7656');
    // Without incoming I2P connections, Bitcoin Core uses a short-lived address for each one it makes.
    expect(direct).toContain('i2pacceptincoming=0');
    expect(direct).not.toContain('onlynet=');
    expect(configuredPrivacy(direct, 'mainnet', TOR)).toMatchObject({ mode: 'off', i2p: true, usesTor: false });

    const torOnly = applyPrivacy(
      direct,
      'mainnet',
      { mode: 'tor-only', onionService: false, privateBroadcast: true, i2p: true },
      TOR,
      8334,
    );
    expect(torOnly).toContain('onlynet=onion\nonlynet=i2p');
    expect(configuredPrivacy(torOnly, 'mainnet', TOR)).toMatchObject({ mode: 'tor-only', i2p: true });

    const off = applyPrivacy(
      torOnly,
      'mainnet',
      { mode: 'tor-only', onionService: false, privateBroadcast: true, i2p: false },
      TOR,
      8334,
    );
    expect(off).not.toMatch(/i2psam=|i2pacceptincoming=|onlynet=i2p/);
    expect(configuredPrivacy(off, 'mainnet', TOR)).toMatchObject({ mode: 'tor-only', i2p: false });
  });

  it('keeps I2P as it is when a change leaves it out', () => {
    const withI2p = applyPrivacy(
      MANAGED,
      'mainnet',
      { mode: 'onion-peers', onionService: false, privateBroadcast: false, i2p: true },
      TOR,
      8334,
    );
    const changed = applyPrivacy(
      withI2p,
      'mainnet',
      { mode: 'tor-only', onionService: false, privateBroadcast: false },
      TOR,
      8334,
    );
    expect(configuredPrivacy(changed, 'mainnet', TOR)).toMatchObject({ mode: 'tor-only', i2p: true });
  });

  it('calls I2P set up another way custom', () => {
    // Another router address, or incoming I2P connections, are the user's own set-up.
    expect(configuredPrivacy(`${MANAGED}i2psam=127.0.0.1:7655\n`, 'mainnet', TOR)).toMatchObject({
      mode: 'custom',
      i2p: false,
    });
    expect(configuredPrivacy(`${MANAGED}i2psam=127.0.0.1:7656\n`, 'mainnet', TOR).mode).toBe('custom');
    // onlynet=i2p without BTCortex's I2P set-up is not a Tor mode either.
    expect(configuredPrivacy(`${MANAGED}onion=127.0.0.1:9050\nonlynet=i2p\n`, 'mainnet', TOR).mode).toBe('custom');
  });
});
