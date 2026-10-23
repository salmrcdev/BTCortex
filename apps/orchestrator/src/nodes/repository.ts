import type { DatabaseSync } from 'node:sqlite';
import { AppFailure, NodeProfileSchema, RpcAuthenticationSchema } from '@btcortex/contracts';
import type { NodeProfile } from '@btcortex/contracts';

// Persistence of node profiles. Rows are validated on the way out, so a
// corrupted or hand-edited database cannot inject malformed profiles.

function toProfile(row: Record<string, unknown>): NodeProfile {
  return NodeProfileSchema.parse({
    id: row['id'],
    name: row['name'],
    implementation: row['implementation'],
    network: row['network'],
    execution: row['execution'],
    runtimeVersion: row['runtime_version'] ?? null,
    dataDirectory: row['data_directory'] ?? null,
    rpcEndpoint: row['rpc_endpoint'],
    authentication: RpcAuthenticationSchema.parse(JSON.parse(String(row['authentication']))),
    keepRunningOnExit: Number(row['keep_running_on_exit']) === 1,
    startWithBtcortex: Number(row['start_with_btcortex']) === 1,
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  });
}

export class NodeRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): NodeProfile[] {
    return this.database
      .prepare('SELECT * FROM node_profiles ORDER BY created_at')
      .all()
      .map((row) => toProfile(row));
  }

  get(id: string): NodeProfile | undefined {
    const row = this.database.prepare('SELECT * FROM node_profiles WHERE id = ?').get(id);
    return row ? toProfile(row) : undefined;
  }

  insert(profile: NodeProfile): void {
    const valid = NodeProfileSchema.parse(profile);
    try {
      this.database
        .prepare(
          `INSERT INTO node_profiles (id, name, implementation, network, execution, runtime_version, data_directory,
             rpc_endpoint, authentication, keep_running_on_exit, start_with_btcortex, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          valid.id,
          valid.name,
          valid.implementation,
          valid.network,
          valid.execution,
          valid.runtimeVersion,
          valid.dataDirectory,
          valid.rpcEndpoint,
          JSON.stringify(valid.authentication),
          valid.keepRunningOnExit ? 1 : 0,
          valid.startWithBtcortex ? 1 : 0,
          valid.createdAt,
          valid.updatedAt,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new AppFailure({
          code: 'nodes.data-directory-in-use',
          message: 'Another node profile already uses this data directory on the same network.',
          component: 'Node profiles',
          dataRisk: 'none',
          likelyCause: 'Two Bitcoin nodes cannot share one data directory.',
          details: { dataDirectory: valid.dataDirectory, network: valid.network },
          recoveryActions: [{ id: 'choose-directory', label: 'Choose a different data directory' }],
        });
      }
      throw error;
    }
  }

  /** Records the Bitcoin Core version a managed node now runs. */
  setRuntimeVersion(id: string, version: string, updatedAt: string): NodeProfile | undefined {
    this.database
      .prepare('UPDATE node_profiles SET runtime_version = ?, updated_at = ? WHERE id = ?')
      .run(version, updatedAt, id);
    return this.get(id);
  }

  /** Records whether a node starts with BTCortex and keeps running after it quits. */
  setLifecycle(
    id: string,
    policy: { keepRunningOnExit: boolean; startWithBtcortex: boolean },
    updatedAt: string,
  ): NodeProfile | undefined {
    this.database
      .prepare(
        'UPDATE node_profiles SET keep_running_on_exit = ?, start_with_btcortex = ?, updated_at = ? WHERE id = ?',
      )
      .run(policy.keepRunningOnExit ? 1 : 0, policy.startWithBtcortex ? 1 : 0, updatedAt, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    return Number(this.database.prepare('DELETE FROM node_profiles WHERE id = ?').run(id).changes) > 0;
  }
}
