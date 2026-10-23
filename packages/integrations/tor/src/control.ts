import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { resolve } from 'node:path';

// A client for tor's control port (https://spec.torproject.org/control-spec):
// CRLF-terminated commands; replies of three-digit lines ("250-" mid-reply,
// "250+" followed by a data block ending with ".", "250 " last); asynchronous
// 650 events between replies. Authentication is SAFECOOKIE only: the cookie
// never crosses the socket, and tor has to prove that it knows the cookie as
// well, so another program listening on the port is detected
// (privacy-networking.md §2.10).

const SERVER_TO_CONTROLLER = 'Tor safe cookie authentication server-to-controller hash';
const CONTROLLER_TO_SERVER = 'Tor safe cookie authentication controller-to-server hash';
/** BTCortex asks only for small replies; a larger one is not the tor it expects. */
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface ReplyLine {
  status: number;
  /** The text after the status code and separator. */
  text: string;
  /** The data block that follows a "250+" line, with dot-stuffing removed and lines joined by "\n". */
  data?: string;
}

export interface ControlReply {
  status: number;
  lines: ReplyLine[];
}

export interface ControlEvent {
  /** For example `STATUS_CLIENT`. */
  type: string;
  /** The rest of the first line, for example `NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"`. */
  body: string;
  lines: ReplyLine[];
}

export class TorControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TorControlError';
  }
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" };

/**
 * Splits "POSITIONAL KEY=value KEY="quoted value"" into positional words and
 * keyword arguments; quoted values use C escapes.
 */
export function parseArguments(text: string): { positional: string[]; keywords: Map<string, string> } {
  const positional: string[] = [];
  const keywords = new Map<string, string>();
  let index = 0;
  while (index < text.length) {
    while (text[index] === ' ') index += 1;
    if (index >= text.length) break;
    const start = index;
    while (index < text.length && text[index] !== ' ' && text[index] !== '=') index += 1;
    const key = text.slice(start, index);
    if (text[index] !== '=') {
      positional.push(key);
      continue;
    }
    index += 1;
    if (text[index] !== '"') {
      const valueStart = index;
      while (index < text.length && text[index] !== ' ') index += 1;
      keywords.set(key, text.slice(valueStart, index));
      continue;
    }
    index += 1;
    let value = '';
    while (index < text.length && text[index] !== '"') {
      const character = text[index] ?? '';
      if (character !== '\\' || index + 1 >= text.length) {
        value += character;
        index += 1;
        continue;
      }
      const next = text[index + 1] ?? '';
      const octal = /^[0-7]{1,3}/.exec(text.slice(index + 1, index + 4));
      if (octal) {
        value += String.fromCharCode(Number.parseInt(octal[0], 8));
        index += 1 + octal[0].length;
      } else {
        value += ESCAPES[next] ?? next;
        index += 2;
      }
    }
    index += 1;
    keywords.set(key, value);
  }
  return { positional, keywords };
}

/** Turns control-port lines into complete replies. */
export class ReplyParser {
  private lines: ReplyLine[] = [];
  private dataLine: ReplyLine | undefined;
  private dataLines: string[] = [];
  private bytes = 0;

  constructor(private readonly onReply: (reply: ControlReply) => void) {}

  push(raw: string): void {
    this.bytes += raw.length + 2;
    if (this.bytes > MAX_REPLY_BYTES) throw new Error('The control port sent a reply larger than BTCortex accepts.');
    if (this.dataLine) {
      if (raw === '.') {
        this.dataLine.data = this.dataLines.join('\n');
        this.dataLine = undefined;
        this.dataLines = [];
      } else {
        this.dataLines.push(raw.startsWith('.') ? raw.slice(1) : raw);
      }
      return;
    }
    const match = /^(\d{3})([ +-])(.*)$/.exec(raw);
    if (!match?.[1] || !match[2]) throw new Error(`The control port sent an unexpected line: "${raw.slice(0, 80)}".`);
    const line: ReplyLine = { status: Number(match[1]), text: match[3] ?? '' };
    this.lines.push(line);
    if (match[2] === '+') {
      this.dataLine = line;
    } else if (match[2] === ' ') {
      const reply = { status: line.status, lines: this.lines };
      this.lines = [];
      this.bytes = 0;
      this.onReply(reply);
    }
  }
}

export interface ProtocolInfo {
  methods: string[];
  cookieFile?: string;
  torVersion?: string;
}

export function parseProtocolInfo(reply: ControlReply): ProtocolInfo {
  const info: ProtocolInfo = { methods: [] };
  for (const { text } of reply.lines) {
    if (text.startsWith('AUTH ')) {
      const { keywords } = parseArguments(text.slice(5));
      info.methods = (keywords.get('METHODS') ?? '').split(',').filter((method) => method !== '');
      const cookieFile = keywords.get('COOKIEFILE');
      if (cookieFile !== undefined) info.cookieFile = cookieFile;
    } else if (text.startsWith('VERSION ')) {
      const version = parseArguments(text.slice(8)).keywords.get('Tor');
      if (version !== undefined) info.torVersion = version;
    }
  }
  return info;
}

export type TorSignal = 'SHUTDOWN' | 'HALT' | 'NEWNYM' | 'ACTIVE' | 'RELOAD';

interface Waiter {
  resolve: (reply: ControlReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** A port of an onion service: the port wallets use, and where tor sends them on this computer. */
export interface OnionPort {
  virtual: number;
  /** For example `127.0.0.1:60401`; onion services reach loopback only. */
  target: string;
}

export interface PublishedOnion {
  /** The address without `.onion`. */
  serviceId: string;
  /** `ED25519-V3:<base64>`, returned only when tor made a new identity. */
  privateKey?: string;
}

const NEW_ONION_KEY = 'NEW:ED25519-V3';
const ONION_KEY = /^ED25519-V3:[A-Za-z0-9+/]+={0,2}$/;
const ONION_SERVICE_ID = /^[a-z2-7]{56}$/;

export interface ConnectOptions {
  host?: string;
  timeoutMs?: number;
  /** How long a command may wait for its reply before the connection is given up. */
  commandTimeoutMs?: number;
}

export class TorControlConnection {
  private readonly waiters: Waiter[] = [];
  private readonly eventListeners = new Set<(event: ControlEvent) => void>();
  private readonly closeListeners = new Set<(error: Error | undefined) => void>();
  private readonly parser: ReplyParser;
  private buffer = '';
  private isClosed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly commandTimeoutMs: number,
  ) {
    this.parser = new ReplyParser((reply) => {
      this.dispatch(reply);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.receive(chunk);
    });
    socket.on('error', (error) => {
      this.shutdown(error);
    });
    socket.on('close', () => {
      this.shutdown(undefined);
    });
  }

  static connect(port: number, options: ConnectOptions = {}): Promise<TorControlConnection> {
    const host = options.host ?? '127.0.0.1';
    return new Promise((resolvePromise, reject) => {
      const socket = createConnection({ host, port });
      const fail = (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(new Error(`The tor control port ${host}:${String(port)} did not answer.`));
      }, options.timeoutMs ?? 5000);
      socket.once('error', fail);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeListener('error', fail);
        resolvePromise(new TorControlConnection(socket, options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS));
      });
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const raw = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      try {
        this.parser.push(raw);
      } catch (error) {
        this.shutdown(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_REPLY_BYTES) this.shutdown(new Error('The control port sent an overlong line.'));
  }

  private dispatch(reply: ControlReply): void {
    if (reply.status === 650) {
      const first = reply.lines[0]?.text ?? '';
      const space = first.indexOf(' ');
      const event: ControlEvent = {
        type: space === -1 ? first : first.slice(0, space),
        body: space === -1 ? '' : first.slice(space + 1),
        lines: reply.lines,
      };
      for (const listener of this.eventListeners) listener(event);
      return;
    }
    const waiter = this.waiters.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (reply.status >= 200 && reply.status < 300) {
      waiter.resolve(reply);
    } else {
      const text = reply.lines.map((line) => line.text).join(' ');
      waiter.reject(new TorControlError(reply.status, `tor refused the command: ${String(reply.status)} ${text}`));
    }
  }

  private shutdown(error: Error | undefined): void {
    if (this.isClosed) return;
    this.isClosed = true;
    const reason = error ?? new Error('The tor control connection closed.');
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    for (const listener of this.closeListeners) listener(error);
    this.socket.destroy();
  }

  /** Sends one command line and waits for its reply; 4xx and 5xx replies reject with TorControlError. */
  command(line: string): Promise<ControlReply> {
    if (/[\r\n]/.test(line)) return Promise.reject(new Error('A control command must be a single line.'));
    if (this.isClosed) return Promise.reject(new Error('The tor control connection is closed.'));
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        // Replies arrive in order, so a missing one makes the rest of the connection unusable.
        this.shutdown(new Error(`tor did not answer "${line.split(' ')[0] ?? line}" in time.`));
      }, this.commandTimeoutMs);
      this.waiters.push({ resolve: resolvePromise, reject, timer });
      this.socket.write(`${line}\r\n`);
    });
  }

  async protocolInfo(): Promise<ProtocolInfo> {
    return parseProtocolInfo(await this.command('PROTOCOLINFO 1'));
  }

  /** SAFECOOKIE authentication with the 32-byte control cookie. */
  async authenticate(cookie: Uint8Array): Promise<void> {
    if (cookie.length !== 32) throw new Error('The tor control cookie is not 32 bytes long, so it cannot be used.');
    const clientNonce = randomBytes(32);
    const reply = await this.command(`AUTHCHALLENGE SAFECOOKIE ${clientNonce.toString('hex')}`);
    const { keywords } = parseArguments((reply.lines[0]?.text ?? '').replace(/^AUTHCHALLENGE\s+/, ''));
    const serverHash = keywords.get('SERVERHASH') ?? '';
    const serverNonce = keywords.get('SERVERNONCE') ?? '';
    if (!/^[0-9A-Fa-f]{64}$/.test(serverHash) || !/^[0-9A-Fa-f]{64}$/.test(serverNonce)) {
      throw new TorControlError(reply.status, 'tor sent a malformed authentication challenge.');
    }
    const message = Buffer.concat([cookie, clientNonce, Buffer.from(serverNonce, 'hex')]);
    const expected = createHmac('sha256', SERVER_TO_CONTROLLER).update(message).digest();
    if (!timingSafeEqual(expected, Buffer.from(serverHash, 'hex'))) {
      this.close();
      throw new TorControlError(
        515,
        'The program on this control port does not know the control cookie, so it is not the expected tor.',
      );
    }
    const response = createHmac('sha256', CONTROLLER_TO_SERVER).update(message).digest('hex');
    await this.command(`AUTHENTICATE ${response}`);
  }

  async getInfo(keys: readonly string[]): Promise<Map<string, string>> {
    if (keys.length === 0 || keys.some((key) => !/^[A-Za-z0-9/_.-]+$/.test(key))) {
      throw new Error('GETINFO keys must be plain names.');
    }
    const reply = await this.command(`GETINFO ${keys.join(' ')}`);
    const values = new Map<string, string>();
    for (const line of reply.lines) {
      const equals = line.text.indexOf('=');
      if (equals > 0) values.set(line.text.slice(0, equals), line.data ?? line.text.slice(equals + 1));
    }
    return values;
  }

  async setEvents(events: readonly string[]): Promise<void> {
    if (events.some((event) => !/^[A-Z_]+$/.test(event))) throw new Error('Event names must be plain names.');
    await this.command(['SETEVENTS', ...events].join(' '));
  }

  async signal(name: TorSignal): Promise<void> {
    await this.command(`SIGNAL ${name}`);
  }

  /** tor exits as soon as this connection closes; nothing else can then leave it running. */
  async takeOwnership(): Promise<void> {
    await this.command('TAKEOWNERSHIP');
    await this.command('RESETCONF __OwningControllerProcess');
  }

  /**
   * Publishes an onion service that outlives this control connection
   * (`Flags=Detach`): with a new identity when `privateKey` is omitted, whose
   * key is then returned so that the same address can be published again
   * later, or with a known identity.
   */
  async addOnion(ports: readonly OnionPort[], privateKey?: string): Promise<PublishedOnion> {
    if (privateKey !== undefined && !ONION_KEY.test(privateKey)) throw new Error('The onion service key is malformed.');
    if (ports.length === 0) throw new Error('An onion service needs at least one port.');
    for (const port of ports) {
      if (!Number.isInteger(port.virtual) || port.virtual < 1 || port.virtual > 65_535) {
        throw new Error(`${String(port.virtual)} is not a valid onion service port.`);
      }
      if (!/^127\.0\.0\.1:\d{1,5}$/.test(port.target)) throw new Error('Onion services reach loopback addresses only.');
    }
    const key = privateKey ?? NEW_ONION_KEY;
    const flags = privateKey === undefined ? 'Detach' : 'Detach,DiscardPK';
    const reply = await this.command(
      `ADD_ONION ${key} Flags=${flags} ${ports.map((port) => `Port=${String(port.virtual)},${port.target}`).join(' ')}`,
    );
    let serviceId: string | undefined;
    let returnedKey: string | undefined;
    for (const line of reply.lines) {
      if (line.text.startsWith('ServiceID=')) serviceId = line.text.slice('ServiceID='.length);
      if (line.text.startsWith('PrivateKey=')) returnedKey = line.text.slice('PrivateKey='.length);
    }
    if (serviceId === undefined || !ONION_SERVICE_ID.test(serviceId)) {
      throw new Error('tor did not name the onion service it published.');
    }
    if (privateKey !== undefined) return { serviceId };
    if (returnedKey === undefined || !ONION_KEY.test(returnedKey)) {
      throw new Error('tor did not return the new onion service’s key.');
    }
    return { serviceId, privateKey: returnedKey };
  }

  /** The onion services published by controllers and kept after they disconnected. */
  async detachedOnions(): Promise<string[]> {
    const value = (await this.getInfo(['onions/detached'])).get('onions/detached') ?? '';
    return value
      .split(/\s+/)
      .map((id) => id.trim())
      .filter((id) => ONION_SERVICE_ID.test(id));
  }

  /** Stops an onion service published earlier. */
  async delOnion(serviceId: string): Promise<void> {
    if (!ONION_SERVICE_ID.test(serviceId)) throw new Error('The onion service ID is malformed.');
    await this.command(`DEL_ONION ${serviceId}`);
  }

  onEvent(listener: (event: ControlEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onClose(listener: (error: Error | undefined) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    if (this.isClosed) return;
    this.socket.end('QUIT\r\n');
    this.shutdown(undefined);
  }
}

export class TorIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorIdentityError';
  }
}

/**
 * Connects to a tor that BTCortex started and authenticates with SAFECOOKIE.
 * The cookie file tor reports must be the one BTCortex configured, so a
 * different tor on the same port is never mistaken for it.
 */
export async function connectAuthenticated(
  port: number,
  cookieFile: string,
  options: ConnectOptions = {},
): Promise<TorControlConnection> {
  const connection = await TorControlConnection.connect(port, options);
  try {
    const info = await connection.protocolInfo();
    if (!info.methods.includes('SAFECOOKIE')) {
      throw new TorIdentityError(`The tor on port ${String(port)} does not offer cookie authentication.`);
    }
    if (info.cookieFile === undefined || resolve(info.cookieFile).toLowerCase() !== resolve(cookieFile).toLowerCase()) {
      throw new TorIdentityError(`The tor on port ${String(port)} is not the one BTCortex started.`);
    }
    await connection.authenticate(await readFile(cookieFile));
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
