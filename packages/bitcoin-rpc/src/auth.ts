import { readFile } from 'node:fs/promises';

// Credential sources for Bitcoin Core RPC. The cookie is preferred for local
// nodes: it needs no stored secret, and it changes on every node start, so it
// is re-read after an authentication failure.

export interface RpcCredentials {
  username: string;
  password: string;
}

export interface CredentialProvider {
  get(): Promise<RpcCredentials>;
  /** Called after HTTP 401 so that the next `get()` reloads its source. */
  invalidate(): void;
  readonly description: string;
}

export class CookieFileError extends Error {
  constructor(
    readonly path: string,
    readonly reason: 'missing' | 'unreadable' | 'malformed',
    options?: { cause?: unknown },
  ) {
    super(
      reason === 'missing'
        ? `The RPC cookie file does not exist yet: ${path}. The node may still be starting or may use password authentication.`
        : reason === 'unreadable'
          ? `The RPC cookie file could not be read: ${path}.`
          : `The RPC cookie file has an unexpected format: ${path}.`,
      options,
    );
    this.name = 'CookieFileError';
  }
}

/**
 * Bitcoin Core writes `__cookie__:<64 hexadecimal characters>`. Anything else
 * is refused, so that a cookie path pointing at another file can never send
 * that file's contents as credentials.
 */
const COOKIE = /^__cookie__:[0-9a-f]{64}$/i;

export function parseCookie(content: string): RpcCredentials | undefined {
  const line = content.trim();
  if (!COOKIE.test(line)) return undefined;
  const separator = line.indexOf(':');
  return { username: line.slice(0, separator), password: line.slice(separator + 1) };
}

export function cookieCredentials(path: string): CredentialProvider {
  let cached: RpcCredentials | undefined;
  return {
    description: `cookie file ${path}`,
    async get() {
      if (cached) return cached;
      let content: string;
      try {
        content = await readFile(path, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        throw new CookieFileError(path, code === 'ENOENT' ? 'missing' : 'unreadable', { cause: error });
      }
      const credentials = parseCookie(content);
      if (!credentials) throw new CookieFileError(path, 'malformed');
      cached = credentials;
      return credentials;
    },
    invalidate() {
      cached = undefined;
    },
  };
}

/** Static credentials, for example a remote node's rpcauth user loaded from the vault. */
export function staticCredentials(credentials: RpcCredentials): CredentialProvider {
  return {
    description: `user ${credentials.username}`,
    get: () => Promise.resolve(credentials),
    invalidate() {
      // Nothing to reload; a 401 means the stored credentials are wrong.
    },
  };
}
