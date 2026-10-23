import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTER_CONSOLES } from '@btcortex/integration-i2p';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { I2pRouterService } from './i2p-router';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** A SAM bridge that answers every greeting with `reply` and keeps the greetings it receives. */
async function fakeBridge(reply: string): Promise<{ port: number; greetings: string[] }> {
  const greetings: string[] = [];
  const port = await listen(
    createServer((socket: Socket) => {
      socket.setEncoding('latin1');
      socket.once('data', (chunk: string) => {
        greetings.push(chunk.trim());
        socket.write(`${reply}\n`);
      });
      socket.on('error', () => undefined);
    }),
  );
  return { port, greetings };
}

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

describe('the I2P router on this computer', () => {
  it('greets the SAM bridge with the versions Bitcoin Core can use, names the router and keeps the answer', async () => {
    const bridge = await fakeBridge('HELLO REPLY RESULT=OK VERSION=3.3');
    const router = new I2pRouterService({
      samAddress: `127.0.0.1:${String(bridge.port)}`,
      listeningProcess: () => Promise.resolve('i2pd'),
      logger,
    });
    expect(await router.status()).toMatchObject({
      available: true,
      samVersion: '3.3',
      program: 'i2pd',
      runningWithoutSam: null,
      error: null,
    });
    expect(bridge.greetings).toEqual(['HELLO VERSION MIN=3.1 MAX=3.3']);
    // Asked again within half a minute, the answer is the one already found.
    await router.status();
    expect(bridge.greetings).toHaveLength(1);
    await router.status(true);
    expect(bridge.greetings).toHaveLength(2);
  });

  it('finds no router when nothing listens, without calling that an error', async () => {
    const nowhere = `http://127.0.0.1:${String(await closedPort())}/`;
    const router = new I2pRouterService({
      samAddress: `127.0.0.1:${String(await closedPort())}`,
      consoles: {
        i2pd: { ...ROUTER_CONSOLES.i2pd, url: nowhere },
        'java-i2p': { ...ROUTER_CONSOLES['java-i2p'], url: nowhere },
      },
      logger,
    });
    expect(await router.status()).toMatchObject({
      available: false,
      samVersion: null,
      program: null,
      runningWithoutSam: null,
      error: null,
    });
  });

  it('recognises the Java router by its console while its SAM bridge is off', async () => {
    const consolePort = await listen(
      createHttpServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<html><head><title>I2P Router Console - home</title></head></html>');
      }),
    );
    const router = new I2pRouterService({
      samAddress: `127.0.0.1:${String(await closedPort())}`,
      consoles: {
        i2pd: { ...ROUTER_CONSOLES.i2pd, url: `http://127.0.0.1:${String(await closedPort())}/` },
        'java-i2p': { ...ROUTER_CONSOLES['java-i2p'], url: `http://127.0.0.1:${String(consolePort)}/` },
      },
      logger,
    });
    expect(await router.status()).toMatchObject({ available: false, runningWithoutSam: 'java-i2p', error: null });
  });

  it('explains a bridge it cannot use', async () => {
    const old = await fakeBridge('HELLO REPLY RESULT=NOVERSION');
    const router = new I2pRouterService({ samAddress: `127.0.0.1:${String(old.port)}`, logger });
    expect(await router.status()).toMatchObject({
      available: false,
      error: expect.stringMatching(/SAM 3\.1/) as unknown,
    });
  });
});
