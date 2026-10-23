import { connect } from 'node:net';

// The greeting of the SAM bridge that I2P routers offer to applications
// (SAM v3, https://i2p.net/en/docs/api/samv3/). Bitcoin Core speaks SAM 3.1,
// so a bridge that agrees to a version from 3.1 up is one it can use.

const HELLO_TIMEOUT_MS = 5_000;

export type SamHello = { ok: true; version: string } | { ok: false; reason: string };

/** The fields of a SAM reply line: `KEY=value` or `KEY="quoted value"`. */
export function samFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [, key, quoted, plain] of line.matchAll(/([A-Z_]+)=(?:"([^"]*)"|(\S*))/g)) {
    if (key !== undefined) fields[key] = quoted ?? plain ?? '';
  }
  return fields;
}

function readHello(line: string, address: string): SamHello {
  if (!line.startsWith('HELLO REPLY ')) {
    return { ok: false, reason: `Something other than an I2P router’s SAM bridge answers on ${address}.` };
  }
  const { RESULT: result, VERSION: version, MESSAGE: message } = samFields(line);
  if (result === 'OK' && version) return { ok: true, version };
  if (result === 'NOVERSION') {
    return { ok: false, reason: 'The I2P router does not offer SAM 3.1, which Bitcoin Core needs.' };
  }
  return { ok: false, reason: `The I2P router refused the greeting: ${message ?? result ?? 'no reason given'}.` };
}

/**
 * Greets a SAM bridge: the version it agrees to speak, or why it cannot be
 * used. Rejects when nothing accepts the connection. Nothing else is sent, so
 * no session or I2P address is created.
 */
export function samHello(host: string, port: number, timeoutMs = HELLO_TIMEOUT_MS): Promise<SamHello> {
  const address = `${host}:${String(port)}`;
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = '';
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      finish();
    };
    const silent = () => {
      const reason = socket.connecting
        ? `${address} did not accept the connection in time.`
        : `The program on ${address} accepted the connection but did not answer.`;
      settle(() => {
        resolve({ ok: false, reason });
      });
    };
    socket.setTimeout(timeoutMs, silent);
    socket.setEncoding('latin1');
    socket.once('connect', () => {
      socket.write('HELLO VERSION MIN=3.1 MAX=3.3\n');
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        settle(() => {
          resolve(readHello(line, address));
        });
      } else if (buffer.length > 1024) {
        settle(() => {
          resolve(readHello('', address));
        });
      }
    });
    socket.on('error', (error) => {
      settle(() => {
        reject(error);
      });
    });
    socket.on('close', silent);
  });
}
