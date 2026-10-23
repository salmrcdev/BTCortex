import { connect, isIP } from 'node:net';
import type { Socket } from 'node:net';

// A SOCKS5 client (RFC 1928, with RFC 1929 username and password) for
// reaching services, onion services above all, through tor's SOCKS port.
// Host names are handed to tor unresolved, so they never reach the local
// resolver. With IsolateSOCKSAuth, which BTCortex's torrc sets, each distinct
// username gets its own circuits, so the services BTCortex reaches cannot be
// linked to one another by a shared circuit.

export interface SocksTarget {
  host: string;
  port: number;
}

export interface SocksOptions {
  proxyHost?: string;
  proxyPort: number;
  /** A name for stream isolation, sent as the SOCKS username. */
  isolation?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** RFC 1928's replies, and tor's extended ones for onion services (sent with ExtendedErrors). */
const REPLIES: Record<number, string> = {
  1: 'general SOCKS server failure',
  2: 'connection not allowed',
  3: 'network unreachable',
  4: 'host unreachable',
  5: 'connection refused',
  6: 'TTL expired',
  7: 'command not supported',
  8: 'address type not supported',
  0xf0: 'onion service descriptor not found',
  0xf1: 'onion service descriptor invalid',
  0xf2: 'onion service introduction failed',
  0xf3: 'onion service rendezvous failed',
  0xf4: 'onion service client authorisation missing',
  0xf5: 'onion service client authorisation wrong',
  0xf6: 'invalid onion address',
  0xf7: 'onion service introduction timed out',
};

export class SocksError extends Error {
  constructor(
    message: string,
    /** The proxy's reply code, when it sent one. */
    readonly reply?: number,
  ) {
    super(message);
    this.name = 'SocksError';
  }
}

function addressField(host: string): Buffer {
  if (isIP(host) === 4) return Buffer.from([0x01, ...host.split('.').map(Number)]);
  if (isIP(host) === 6) {
    const groups = host.split('::');
    const head = groups[0] === '' || groups[0] === undefined ? [] : groups[0].split(':');
    const tail = groups.length > 1 && groups[1] !== '' && groups[1] !== undefined ? groups[1].split(':') : [];
    const words = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
    const bytes = Buffer.alloc(16);
    words.forEach((word, index) => bytes.writeUInt16BE(Number.parseInt(word, 16), index * 2));
    return Buffer.concat([Buffer.from([0x04]), bytes]);
  }
  const name = Buffer.from(host, 'utf8');
  if (name.length === 0 || name.length > 255) throw new SocksError(`"${host}" is not a host name SOCKS can carry.`);
  return Buffer.concat([Buffer.from([0x03, name.length]), name]);
}

/** Opens a TCP connection to `target` through a SOCKS5 proxy, ready for use once it resolves. */
export function connectThroughSocks(target: SocksTarget, options: SocksOptions): Promise<Socket> {
  const proxyHost = options.proxyHost ?? '127.0.0.1';
  const where = `${target.host}:${String(target.port)}`;
  return new Promise((resolve, reject) => {
    let request: Buffer;
    try {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      request = Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addressField(target.host), port]);
    } catch (error) {
      reject(error instanceof Error ? error : new SocksError(String(error)));
      return;
    }
    const socket = connect(options.proxyPort, proxyHost);
    const method = options.isolation === undefined ? 0x00 : 0x02;
    let stage: 'greeting' | 'authentication' | 'connection' = 'greeting';
    let buffer = Buffer.alloc(0);
    let settled = false;

    const fail = (error: SocksError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(
        new SocksError(
          `tor did not reach ${where} within ${String((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s.`,
        ),
      );
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        const [version, chosen] = buffer;
        buffer = buffer.subarray(2);
        if (version !== 0x05 || chosen !== method) {
          fail(
            new SocksError(
              `The proxy at ${proxyHost}:${String(options.proxyPort)} is not a SOCKS5 proxy BTCortex can use.`,
            ),
          );
          return;
        }
        if (method === 0x02) {
          const username = Buffer.from(options.isolation ?? '', 'utf8').subarray(0, 255);
          socket.write(Buffer.concat([Buffer.from([0x01, username.length]), username, Buffer.from([0x01, 0x2d])]));
          stage = 'authentication';
        } else {
          socket.write(request);
          stage = 'connection';
        }
      }
      if (stage === 'authentication') {
        if (buffer.length < 2) return;
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (status !== 0x00) {
          fail(new SocksError('The SOCKS proxy refused BTCortex’s stream isolation name.'));
          return;
        }
        socket.write(request);
        stage = 'connection';
      }
      if (buffer.length < 5) return;
      const reply = buffer[1] ?? 0xff;
      const type = buffer[3];
      const addressLength = type === 0x01 ? 4 : type === 0x04 ? 16 : type === 0x03 ? 1 + (buffer[4] ?? 0) : -1;
      if (reply !== 0x00) {
        fail(new SocksError(`tor could not reach ${where}: ${REPLIES[reply] ?? `error ${String(reply)}`}.`, reply));
        return;
      }
      if (addressLength < 0) {
        fail(new SocksError('The SOCKS proxy answered in a form BTCortex does not understand.'));
        return;
      }
      const length = 4 + addressLength + 2;
      if (buffer.length < length) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      const rest = buffer.subarray(length);
      if (rest.length > 0) socket.unshift(rest);
      resolve(socket);
    };

    socket.once('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, method]));
    });
    const onError = (error: NodeJS.ErrnoException) => {
      fail(
        new SocksError(
          `tor's SOCKS port ${proxyHost}:${String(options.proxyPort)} could not be reached (${error.code ?? error.message}).`,
        ),
      );
    };
    const onClose = () => {
      fail(new SocksError(`The SOCKS proxy closed the connection before ${where} was reached.`));
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}
