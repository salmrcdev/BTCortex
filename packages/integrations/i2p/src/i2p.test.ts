import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTER_CONSOLES, routerByConsole, routerName } from './detect';
import { samFields, samHello } from './sam';

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** A local server that answers the first line it receives with `reply`, or stays silent. */
const fakeBridge = (reply: string | null) =>
  listen(
    createServer((socket: Socket) => {
      socket.once('data', () => {
        if (reply !== null) socket.write(`${reply}\n`);
      });
      socket.on('error', () => undefined);
    }),
  );

/** A console page with `title`. */
const fakeConsole = (title: string) =>
  listen(
    createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<html><head><title>${title}</title></head></html>`);
    }),
  );

/** A port nothing listens on: taken, then given back. */
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('SAM bridge greeting', () => {
  it('reads SAM replies, quoted values included', () => {
    expect(samFields('HELLO REPLY RESULT=I2P_ERROR MESSAGE="Session not ready"')).toEqual({
      RESULT: 'I2P_ERROR',
      MESSAGE: 'Session not ready',
    });
  });

  it('accepts a bridge that agrees to a version from 3.1 up', async () => {
    expect(await samHello('127.0.0.1', await fakeBridge('HELLO REPLY RESULT=OK VERSION=3.1'))).toEqual({
      ok: true,
      version: '3.1',
    });
  });

  it('tells a bridge without SAM 3.1, another program and a silent one apart', async () => {
    expect(await samHello('127.0.0.1', await fakeBridge('HELLO REPLY RESULT=NOVERSION'))).toEqual({
      ok: false,
      reason: 'The I2P router does not offer SAM 3.1, which Bitcoin Core needs.',
    });
    expect(await samHello('127.0.0.1', await fakeBridge('HTTP/1.1 400 Bad Request'))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Something other than an I2P router’s SAM bridge/) as unknown,
    });
    expect(await samHello('127.0.0.1', await fakeBridge(null), 200)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/did not answer/) as unknown,
    });
    await expect(samHello('127.0.0.1', await closedPort())).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});

describe('which router runs', () => {
  it('names i2pd and the Java router from their processes', () => {
    expect(routerName('i2pd')).toBe('i2pd');
    expect(routerName('javaw')).toBe('I2P');
    expect(routerName('otherprogram')).toBe('otherprogram');
    expect(routerName(null)).toBeNull();
  });

  it('recognises a router by its console, and nothing when no console answers', async () => {
    const nowhere = `http://127.0.0.1:${String(await closedPort())}/`;
    const java = `http://127.0.0.1:${String(await fakeConsole('I2P Router Console - home'))}/`;
    expect(
      await routerByConsole({
        i2pd: { ...ROUTER_CONSOLES.i2pd, url: nowhere },
        'java-i2p': { ...ROUTER_CONSOLES['java-i2p'], url: java },
      }),
    ).toBe('java-i2p');
    // Another program's web page on the console's port is not a router.
    const other = `http://127.0.0.1:${String(await fakeConsole('Something else'))}/`;
    expect(
      await routerByConsole({
        i2pd: { ...ROUTER_CONSOLES.i2pd, url: other },
        'java-i2p': { ...ROUTER_CONSOLES['java-i2p'], url: nowhere },
      }),
    ).toBeNull();
  });
});
