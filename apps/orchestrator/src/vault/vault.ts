import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { shellMethods } from '@btcortex/contracts';
import type { ShellMethodName, ShellMethodParams, ShellMethodResult } from '@btcortex/contracts';

// Secrets (remote RPC passwords, macaroons, API keys) are encrypted with
// Windows DPAPI by the native shell and stored here only as protected blobs.
// Plaintext exists solely in orchestrator memory while a secret is in use; it
// never reaches the WebView, logs or exports.

export type ShellCaller = <M extends ShellMethodName>(
  method: M,
  params: ShellMethodParams<M>,
) => Promise<ShellMethodResult<M>>;

/** Builds a typed caller that validates the shell's answers against the contract. */
export function createShellCaller(request: (method: string, params: unknown) => Promise<unknown>): ShellCaller {
  return async (method, params) => {
    const raw = await request(method, params);
    return shellMethods[method].result.parse(raw) as ShellMethodResult<typeof method>;
  };
}

export interface SecretSummary {
  id: string;
  purpose: string;
  createdAt: string;
  updatedAt: string;
}

export class SecretVault {
  constructor(
    private readonly database: DatabaseSync,
    private readonly shell: ShellCaller,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Stores a new secret and returns its id. */
  async store(purpose: string, plaintext: string): Promise<string> {
    const id = randomUUID();
    const { protected: blob } = await this.shell('vault.protect', { plaintext });
    const timestamp = this.now().toISOString();
    this.database
      .prepare('INSERT INTO secrets (id, purpose, protected_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, purpose, blob, timestamp, timestamp);
    return id;
  }

  async replace(id: string, plaintext: string): Promise<void> {
    const { protected: blob } = await this.shell('vault.protect', { plaintext });
    const result = this.database
      .prepare('UPDATE secrets SET protected_value = ?, updated_at = ? WHERE id = ?')
      .run(blob, this.now().toISOString(), id);
    if (Number(result.changes) === 0) throw new Error(`No secret with id ${id}.`);
  }

  async reveal(id: string): Promise<string> {
    const row = this.database.prepare('SELECT protected_value FROM secrets WHERE id = ?').get(id);
    if (!row) throw new Error(`No secret with id ${id}.`);
    const { plaintext } = await this.shell('vault.unprotect', { protected: String(row['protected_value']) });
    return plaintext;
  }

  remove(id: string): boolean {
    return Number(this.database.prepare('DELETE FROM secrets WHERE id = ?').run(id).changes) > 0;
  }

  list(): SecretSummary[] {
    return this.database
      .prepare('SELECT id, purpose, created_at, updated_at FROM secrets ORDER BY created_at')
      .all()
      .map((row) => ({
        id: String(row['id']),
        purpose: String(row['purpose']),
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
      }));
  }
}
