import { createConnection } from 'node:net';
import { TorControlConnection } from './control';
import type { ProtocolInfo } from './control';

// Finds tor instances BTCortex did not start (privacy-networking.md §2.16).
// A suspected control port only ever receives PROTOCOLINFO, which tor answers
// before authentication; other programs' cookie files are never read and
// nothing is sent through their SOCKS ports.

export type ExternalTorKind = 'tor' | 'tor-browser' | 'wasabi';

export const KNOWN_TOR_PORTS: readonly { kind: ExternalTorKind; socks: number; control: number }[] = [
  { kind: 'tor', socks: 9050, control: 9051 },
  { kind: 'tor-browser', socks: 9150, control: 9151 },
  { kind: 'wasabi', socks: 37150, control: 37151 },
];

export interface ExternalTor {
  kind: ExternalTorKind;
  socksPort?: number;
  controlPort?: number;
  torVersion?: string;
  authMethods?: string[];
  /** The control port lets any local program control this tor. */
  unauthenticated?: boolean;
}

/** True when something accepts connections on the loopback port. */
export function isAcceptingConnections(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (result: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('error', () => {
      finish(false);
    });
  });
}

/** PROTOCOLINFO on a port that may belong to tor; undefined when it does not answer as tor. */
export async function probeControlPort(port: number, timeoutMs = 2000): Promise<ProtocolInfo | undefined> {
  let connection: TorControlConnection | undefined;
  try {
    connection = await TorControlConnection.connect(port, { timeoutMs, commandTimeoutMs: timeoutMs });
    const info = await connection.protocolInfo();
    return info.methods.length > 0 || info.torVersion !== undefined ? info : undefined;
  } catch {
    return undefined;
  } finally {
    connection?.close();
  }
}

/** Looks for tor on the ports other software uses; `skipPorts` are BTCortex's own. */
export async function detectExternalTor(skipPorts: readonly number[] = []): Promise<ExternalTor[]> {
  const found: ExternalTor[] = [];
  for (const known of KNOWN_TOR_PORTS) {
    const socks = !skipPorts.includes(known.socks) && (await isAcceptingConnections(known.socks));
    const control = skipPorts.includes(known.control) ? undefined : await probeControlPort(known.control);
    if (!socks && !control) continue;
    found.push({
      kind: known.kind,
      ...(socks ? { socksPort: known.socks } : {}),
      ...(control
        ? {
            controlPort: known.control,
            authMethods: control.methods,
            unauthenticated: control.methods.includes('NULL'),
            ...(control.torVersion === undefined ? {} : { torVersion: control.torVersion }),
          }
        : {}),
    });
  }
  return found;
}
