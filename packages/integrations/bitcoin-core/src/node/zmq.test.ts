import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { interpretZmqMessage, subscribeZmq } from './zmq';
import type { ZmqMessage } from './zmq';

// A minimal ZMTP 3 publisher stands in for Bitcoin Core: greeting, READY,
// then multipart notifications once the subscriber has subscribed.

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function frame(flags: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([flags, body.length]), body]);
}

function publisher(onSubscribed: (socket: Socket, topics: string[]) => void): Promise<number> {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'ready' | 'subscriptions' = 'greeting';
    const topics: string[] = [];
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 64) {
        buffer = buffer.subarray(64);
        const greeting = Buffer.alloc(64);
        greeting[0] = 0xff;
        greeting[9] = 0x7f;
        greeting[10] = 3;
        greeting[11] = 1;
        greeting.write('NULL', 12, 'ascii');
        socket.write(greeting);
        stage = 'ready';
      }
      while (buffer.length >= 2) {
        const size = buffer[1] ?? 0;
        if (buffer.length < 2 + size) return;
        const flags = buffer[0] ?? 0;
        const body = buffer.subarray(2, 2 + size);
        buffer = buffer.subarray(2 + size);
        if (stage === 'ready' && (flags & 0x04) !== 0) {
          expect(body.toString('latin1')).toContain('Socket-Type');
          expect(body.toString('latin1')).toContain('SUB');
          const ready = Buffer.concat([
            Buffer.from([5]),
            Buffer.from('READY'),
            Buffer.from([11]),
            Buffer.from('Socket-Type'),
            Buffer.from([0, 0, 0, 3]),
            Buffer.from('PUB'),
          ]);
          socket.write(frame(0x04, ready));
          stage = 'subscriptions';
        } else if (stage === 'subscriptions' && body[0] === 1) {
          topics.push(body.subarray(1).toString('ascii'));
          if (topics.length === 2) onSubscribed(socket, topics);
        }
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe('ZMQ subscriber', () => {
  it('greets, subscribes and reads Bitcoin Core’s three-part notifications', async () => {
    const hash = Buffer.alloc(32, 0xab);
    let subscribed: string[] = [];
    const port = await publisher((socket, topics) => {
      subscribed = topics;
      const counter = Buffer.alloc(4);
      counter.writeUInt32LE(7);
      socket.write(Buffer.concat([frame(0x01, Buffer.from('hashblock')), frame(0x01, hash), frame(0x00, counter)]));
      const sequenceBody = Buffer.concat([hash, Buffer.from('A'), Buffer.from([42, 0, 0, 0, 0, 0, 0, 0])]);
      socket.write(
        Buffer.concat([frame(0x01, Buffer.from('sequence')), frame(0x01, sequenceBody), frame(0x00, counter)]),
      );
    });
    const messages: ZmqMessage[] = [];
    const received = new Promise<void>((resolve) => {
      void subscribeZmq({
        address: `tcp://127.0.0.1:${String(port)}`,
        topics: ['hashblock', 'sequence'],
        onMessage: (message) => {
          messages.push(message);
          if (messages.length === 2) resolve();
        },
      }).then((subscriber) => {
        void received.then(() => {
          subscriber.close();
        });
      });
    });
    await received;
    expect(subscribed).toEqual(['hashblock', 'sequence']);
    expect(messages.map(interpretZmqMessage)).toEqual([
      { kind: 'block', hash: 'ab'.repeat(32), sequence: 7 },
      { kind: 'mempool', change: 'transaction-added', hash: 'ab'.repeat(32), mempoolSequence: 42, sequence: 7 },
    ]);
  });

  it('gives up on something that is not a ZMQ publisher', async () => {
    const server = createServer((socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'.padEnd(64, ' '));
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as AddressInfo).port);
      });
    });
    await expect(
      subscribeZmq({ address: `tcp://127.0.0.1:${String(port)}`, topics: ['hashtx'], onMessage: () => undefined }),
    ).rejects.toThrow(/does not speak ZMTP 3|closed the connection/);
    await expect(subscribeZmq({ address: 'ipc:///tmp/x', topics: [], onMessage: () => undefined })).rejects.toThrow(
      /Only tcp/,
    );
  });
});
