import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { apiCandidates, EsploraClient, EsploraError, probeExplorer } from './client';

const REGTEST_GENESIS = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';
const servers: Server[] = [];

/** A local explorer: `routes` maps request paths to plain-text answers. */
function explorer(routes: Record<string, string>, onRequest?: (path: string) => void): Promise<string> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '';
    onRequest?.(path);
    const body = routes[path];
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(body);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('the Esplora API of mempool and Esplora', () => {
  it('reads the tip and a block hash, as plain text', async () => {
    const url = await explorer({ '/api/blocks/tip/height': '101\n', '/api/block-height/0': REGTEST_GENESIS });
    const client = new EsploraClient({ apiUrl: `${url}/api` });
    expect(await client.tipHeight()).toBe(101);
    expect(await client.blockHash(0)).toBe(REGTEST_GENESIS);
    await expect(client.blockHash(5)).rejects.toMatchObject({ failure: 'not-found' });
  });

  it('looks for the API where mempool and Esplora serve it', () => {
    expect(apiCandidates('http://umbrel.local:3006/', 'mempool')).toEqual(['http://umbrel.local:3006/api']);
    expect(apiCandidates('http://host:3000', 'esplora')).toEqual(['http://host:3000/api', 'http://host:3000']);
    expect(apiCandidates('https://blockstream.info/api', 'esplora')).toEqual(['https://blockstream.info/api']);
  });

  it('finds an Esplora API served at the root, and reads its chain', async () => {
    const asked: string[] = [];
    const url = await explorer({ '/blocks/tip/height': '7', '/block-height/0': REGTEST_GENESIS }, (path) => {
      asked.push(path);
    });
    expect(await probeExplorer(url, 'esplora')).toEqual({ apiUrl: url, height: 7, genesisHash: REGTEST_GENESIS });
    // Nothing but the tip and the genesis block is asked for.
    expect(asked).toEqual(['/api/blocks/tip/height', '/blocks/tip/height', '/block-height/0']);
  });

  it('refuses answers that are not an Esplora API’s', async () => {
    const url = await explorer({ '/api/blocks/tip/height': '<html>Umbrel</html>' });
    await expect(probeExplorer(url, 'mempool')).rejects.toBeInstanceOf(EsploraError);
    await expect(new EsploraClient({ apiUrl: `${url}/api` }).tipHeight()).rejects.toMatchObject({
      failure: 'protocol',
    });
    await expect(probeExplorer('http://127.0.0.1:1', 'mempool')).rejects.toMatchObject({ failure: 'refused' });
    expect(() => new EsploraClient({ apiUrl: 'ftp://host/api' })).toThrow(/https:\/\/ or http:\/\//);
  });
});
