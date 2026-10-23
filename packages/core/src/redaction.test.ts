import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveKey, redact, redactString } from './redaction';

describe('redaction', () => {
  it('redacts sensitive keys at any depth', () => {
    const input = {
      rpcuser: 'alice',
      rpcpassword: 'correct horse battery staple',
      nested: { macaroonHex: '0201abc', list: [{ apiKey: 'k' }] },
    };
    expect(redact(input)).toEqual({
      rpcuser: 'alice',
      rpcpassword: REDACTED,
      nested: { macaroonHex: REDACTED, list: [{ apiKey: REDACTED }] },
    });
  });

  it('keeps empty or missing sensitive values visible so their absence can be diagnosed', () => {
    expect(redact({ rpcpassword: '', token: null })).toEqual({ rpcpassword: '', token: null });
  });

  it('redacts secrets embedded in strings', () => {
    const xprv =
      'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
    expect(redactString(`key ${xprv} end`)).toBe(`key ${REDACTED} end`);
    expect(redactString('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(`Authorization: ${REDACTED}`);
    expect(redactString('__cookie__:0123456789abcdef0123456789abcdef')).toBe(REDACTED);
    expect(redactString('http://alice:hunter2@127.0.0.1:8332/')).toBe(`http://alice:${REDACTED}@127.0.0.1:8332/`);
    // Bitcoin Core quotes the offending bitcoin.conf line, which may hold a password.
    expect(redactString('Error reading configuration file: parse error on line 8: torpassword hunter2')).toBe(
      `Error reading configuration file: parse error on line 8: ${REDACTED}`,
    );
  });

  it('identifies sensitive keys without flagging ordinary ones', () => {
    for (const key of [
      'rpcpassword',
      'torPassword',
      'rpcauth',
      'clientSecret',
      'accessToken',
      'seedPhrase',
      'privateKey',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['rpcuser', 'rpcport', 'network', 'datadir', 'blockHash', 'publicKey']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it('handles errors and circular structures', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    expect(redact(circular)).toEqual({ name: 'loop', self: '[circular]' });
    expect(redact(new Error('failed with Bearer abcdefghijklmnop'))).toEqual({
      name: 'Error',
      message: `failed with ${REDACTED}`,
    });
  });
});
