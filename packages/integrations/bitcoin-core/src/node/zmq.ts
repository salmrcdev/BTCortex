import { connect } from 'node:net';
import type { Socket } from 'node:net';

// A ZMQ subscriber for Bitcoin Core's notifications (doc/zmq.md in the
// Bitcoin Core tree), speaking ZMTP 3 with the NULL mechanism over TCP, so
// that no native library is needed. Bitcoin Core publishes multipart
// messages of three frames: the topic, the body and a 4-byte little-endian
// sequence number per topic.

const GREETING_BYTES = 64;
const FLAG_MORE = 0x01;
const FLAG_LONG = 0x02;
const FLAG_COMMAND = 0x04;
/** Bitcoin Core's largest message is a raw block; anything bigger is not a notification. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ZmqTopic = 'hashblock' | 'hashtx' | 'rawblock' | 'rawtx' | 'sequence';

export interface ZmqMessage {
  topic: string;
  body: Buffer;
  /** The publisher's own counter for this topic, which reveals missed messages. */
  sequence: number | null;
}

/** What a notification says, in the form people read. */
export type ZmqEvent =
  | { kind: 'block'; hash: string; sequence: number | null }
  | { kind: 'transaction'; txid: string; sequence: number | null }
  | { kind: 'raw-block'; bytes: number; sequence: number | null }
  | { kind: 'raw-transaction'; bytes: number; sequence: number | null }
  | {
      kind: 'mempool';
      /** C: block connected, D: block disconnected, A: transaction added, R: transaction removed. */
      change: 'block-connected' | 'block-disconnected' | 'transaction-added' | 'transaction-removed';
      hash: string;
      mempoolSequence: number | null;
      sequence: number | null;
    };

/** The greeting: signature, version 3.0, the NULL mechanism, as client. */
function greeting(): Buffer {
  const buffer = Buffer.alloc(GREETING_BYTES);
  buffer[0] = 0xff;
  buffer[9] = 0x7f;
  buffer[10] = 3;
  buffer[11] = 0;
  buffer.write('NULL', 12, 'ascii');
  return buffer;
}

function frame(flags: number, body: Buffer): Buffer {
  if (body.length > 255) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(body.length));
    return Buffer.concat([Buffer.from([flags | FLAG_LONG]), size, body]);
  }
  return Buffer.concat([Buffer.from([flags, body.length]), body]);
}

/** The READY command with this socket's type. */
function ready(socketType: string): Buffer {
  const name = Buffer.from('READY', 'ascii');
  const property = Buffer.from('Socket-Type', 'ascii');
  const value = Buffer.from(socketType, 'ascii');
  const valueSize = Buffer.alloc(4);
  valueSize.writeUInt32BE(value.length);
  return frame(
    FLAG_COMMAND,
    Buffer.concat([Buffer.from([name.length]), name, Buffer.from([property.length]), property, valueSize, value]),
  );
}

/** ZMTP 3.0's subscription: a message whose first byte is 1, then the topic (3.1 publishers accept it too). */
function subscription(topic: string): Buffer {
  return frame(0, Buffer.concat([Buffer.from([1]), Buffer.from(topic, 'ascii')]));
}

export function interpretZmqMessage(message: ZmqMessage): ZmqEvent | undefined {
  const { body, sequence } = message;
  switch (message.topic) {
    case 'hashblock':
      return body.length === 32 ? { kind: 'block', hash: body.toString('hex'), sequence } : undefined;
    case 'hashtx':
      return body.length === 32 ? { kind: 'transaction', txid: body.toString('hex'), sequence } : undefined;
    case 'rawblock':
      return { kind: 'raw-block', bytes: body.length, sequence };
    case 'rawtx':
      return { kind: 'raw-transaction', bytes: body.length, sequence };
    case 'sequence': {
      if (body.length < 33) return undefined;
      const label = String.fromCharCode(body[32] ?? 0);
      const change =
        label === 'C'
          ? 'block-connected'
          : label === 'D'
            ? 'block-disconnected'
            : label === 'A'
              ? 'transaction-added'
              : label === 'R'
                ? 'transaction-removed'
                : undefined;
      if (!change) return undefined;
      return {
        kind: 'mempool',
        change,
        hash: body.subarray(0, 32).toString('hex'),
        mempoolSequence: body.length >= 41 ? Number(body.readBigUInt64LE(33)) : null,
        sequence,
      };
    }
    default:
      return undefined;
  }
}

export interface ZmqSubscriberOptions {
  /** For example `tcp://127.0.0.1:28332`, as getzmqnotifications reports it. */
  address: string;
  topics: readonly string[];
  onMessage: (message: ZmqMessage) => void;
  onClose?: (error?: Error) => void;
  /** How long to wait for the connection and the publisher's greeting. */
  timeoutMs?: number;
}

export interface ZmqSubscriber {
  close(): void;
}

/** Connects, subscribes and passes each message on until closed. */
export function subscribeZmq(options: ZmqSubscriberOptions): Promise<ZmqSubscriber> {
  const url = new URL(options.address);
  if (url.protocol !== 'tcp:')
    return Promise.reject(new Error(`Only tcp:// ZMQ endpoints are supported, not ${options.address}.`));
  const host = url.hostname === '0.0.0.0' || url.hostname === '*' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port);
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host, port });
    let buffer = Buffer.alloc(0);
    let greeted = false;
    let established = false;
    let parts: Buffer[] = [];
    let closed = false;
    const finish = (error?: Error) => {
      if (closed) return;
      closed = true;
      socket.destroy();
      if (!established) reject(error ?? new Error('The ZMQ publisher closed the connection.'));
      else options.onClose?.(error);
    };
    socket.setTimeout(options.timeoutMs ?? 10_000, () => {
      if (!established) finish(new Error(`No ZMQ publisher answered at ${options.address}.`));
    });
    socket.once('connect', () => {
      socket.write(greeting());
    });
    socket.on('error', (error) => {
      finish(error);
    });
    socket.on('close', () => {
      finish();
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!greeted) {
        if (buffer.length < GREETING_BYTES) return;
        const peer = buffer.subarray(0, GREETING_BYTES);
        if (peer[0] !== 0xff || peer[9] !== 0x7f || (peer[10] ?? 0) < 3) {
          finish(new Error(`${options.address} does not speak ZMTP 3.`));
          return;
        }
        buffer = buffer.subarray(GREETING_BYTES);
        greeted = true;
        socket.write(ready('SUB'));
      }
      for (;;) {
        if (buffer.length < 2) return;
        const flags = buffer[0] ?? 0;
        const long = (flags & FLAG_LONG) !== 0;
        const header = long ? 9 : 2;
        if (buffer.length < header) return;
        const size = long ? Number(buffer.readBigUInt64BE(1)) : (buffer[1] ?? 0);
        if (size > MAX_FRAME_BYTES) {
          finish(new Error('The ZMQ publisher sent a frame larger than any notification.'));
          return;
        }
        if (buffer.length < header + size) return;
        const body = Buffer.from(buffer.subarray(header, header + size));
        buffer = buffer.subarray(header + size);
        if ((flags & FLAG_COMMAND) !== 0) {
          // The publisher's READY completes the handshake; then the subscriptions go out.
          if (!established && body.subarray(1, 1 + (body[0] ?? 0)).toString('ascii') === 'READY') {
            established = true;
            socket.setTimeout(0);
            for (const topic of options.topics) socket.write(subscription(topic));
            resolve({
              close: () => {
                closed = true;
                socket.destroy();
              },
            });
          }
          continue;
        }
        parts.push(body);
        if ((flags & FLAG_MORE) !== 0) continue;
        const [topic, payload, counter] = parts;
        parts = [];
        if (!topic || !payload) continue;
        options.onMessage({
          topic: topic.toString('ascii'),
          body: payload,
          sequence: counter?.length === 4 ? counter.readUInt32LE(0) : null,
        });
      }
    });
  });
}
