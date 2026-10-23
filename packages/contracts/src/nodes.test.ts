import { describe, expect, it } from 'vitest';
import { methods } from './methods';
import { endpointParts, isLocalNetworkHost, isLoopbackHost } from './nodes';

const connect = methods['nodes.connectExisting'].params;
const cookie = { kind: 'cookie', cookieFile: 'C:\\Bitcoin\\.cookie' } as const;
const password = { kind: 'password', username: 'alice', password: 'secret' } as const;

describe('connecting an existing node', () => {
  it('sends a cookie only to a node on this computer', () => {
    expect(
      connect.safeParse({ name: 'n', network: 'mainnet', rpcEndpoint: 'http://127.0.0.1:8332', authentication: cookie })
        .success,
    ).toBe(true);
    expect(
      connect.safeParse({ name: 'n', network: 'mainnet', rpcEndpoint: 'http://[::1]:8332', authentication: cookie })
        .success,
    ).toBe(true);
    for (const rpcEndpoint of [
      'http://192.168.1.5:8332',
      'https://node.example.com',
      'http://user@127.0.0.1.evil.example',
    ]) {
      expect(connect.safeParse({ name: 'n', network: 'mainnet', rpcEndpoint, authentication: cookie }).success).toBe(
        false,
      );
    }
  });

  it('refuses to send a password in plain text beyond the local network', () => {
    const at = (rpcEndpoint: string) =>
      connect.safeParse({ name: 'n', network: 'mainnet', rpcEndpoint, authentication: password }).success;
    expect(at('http://192.168.1.5:8332')).toBe(true);
    expect(at('http://100.101.102.103:8332')).toBe(true);
    expect(at('https://node.example.com:8332')).toBe(true);
    expect(at('http://node.example.com:8332')).toBe(false);
    expect(at('http://8.8.8.8:8332')).toBe(false);
  });
});

describe('address helpers', () => {
  it('classifies hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('127.0.0.1.example.com')).toBe(false);
    expect(isLocalNetworkHost('10.0.0.2')).toBe(true);
    expect(isLocalNetworkHost('172.32.0.1')).toBe(false);
    expect(isLocalNetworkHost('fd12:3456::1')).toBe(true);
    expect(endpointParts('HTTP://user:pw@Example.COM:80/path')).toEqual({ protocol: 'http:', hostname: 'example.com' });
  });
});
