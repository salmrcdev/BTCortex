import {
  BitcoinRpcError,
  consoleBlockReason,
  CONSOLE_BLOCKED,
  parseHelpCatalogue,
  rpcMethodRisk,
} from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type { RpcCallResult, RpcCatalogueEntry } from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import { describeNodeError, nodeComponent } from './node-errors';
import type { NodeManager } from './node-manager';

// The RPC console (specification section 5.7). The orchestrator enforces the
// rules itself rather than trusting the interface: blocked methods are
// refused, dangerous ones need confirmation, and parameters and results are
// never logged — only the method name and how long it took.

const READ_TIMEOUT_MS = 60_000;
/** The shell gives up on any request after five minutes. */
const HEAVY_TIMEOUT_MS = 4.5 * 60_000;
const MAX_RESULT_CHARACTERS = 8 * 1024 * 1024;

export interface RpcCallRequest {
  method: string;
  params: unknown[];
  wallet?: string | undefined;
  confirmed: boolean;
}

export interface RpcConsoleServiceOptions {
  nodes: Pick<NodeManager, 'get' | 'rpc'>;
  logger: Logger;
}

export class RpcConsoleService {
  constructor(private readonly options: RpcConsoleServiceOptions) {}

  async catalogue(nodeId: string): Promise<RpcCatalogueEntry[]> {
    const text = await this.run(nodeId, 'help', [], undefined, READ_TIMEOUT_MS);
    return parseHelpCatalogue(typeof text === 'string' ? text : '').map(({ name, category }) => {
      const { risk, secret } = rpcMethodRisk(name);
      const blockedReason = CONSOLE_BLOCKED[name];
      return { name, category, risk, secret, ...(blockedReason === undefined ? {} : { blockedReason }) };
    });
  }

  async help(nodeId: string, method: string): Promise<string> {
    const text = await this.run(nodeId, 'help', [method], undefined, READ_TIMEOUT_MS);
    return typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  }

  async call(nodeId: string, request: RpcCallRequest): Promise<RpcCallResult> {
    const { profile } = this.options.nodes.get(nodeId);
    const component = nodeComponent(profile);
    const blocked = consoleBlockReason(request.method, request.params);
    if (blocked !== undefined) {
      throw new AppFailure({
        code: 'rpc.blocked',
        message: `${request.method} is not available in BTCortex’s console. ${blocked}`,
        component,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const { risk } = rpcMethodRisk(request.method);
    if (risk === 'dangerous' && !request.confirmed) {
      throw new AppFailure({
        code: 'rpc.confirmation-required',
        message: `${request.method} can move funds, change the chain or write files on this computer, so it needs your explicit confirmation.`,
        component,
        dataRisk: 'possible',
        recoveryActions: [{ id: 'confirm', label: 'Confirm and run it' }],
      });
    }

    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let result: unknown;
    try {
      result = await this.run(
        nodeId,
        request.method,
        request.params,
        request.wallet,
        risk === 'heavy' ? HEAVY_TIMEOUT_MS : READ_TIMEOUT_MS,
      );
    } catch (error) {
      // Only the method, its duration and the error code: parameters may hold secrets.
      this.options.logger.info('Console call failed', {
        nodeId,
        method: request.method,
        risk,
        durationMs: elapsed(),
        code: error instanceof AppFailure ? error.error.code : 'unknown',
      });
      throw error;
    }
    const durationMs = elapsed();
    // Only the method and its duration: parameters and results may hold secrets.
    this.options.logger.info('Console call', { nodeId, method: request.method, risk, durationMs });
    if (JSON.stringify(result ?? null).length > MAX_RESULT_CHARACTERS) {
      throw new AppFailure({
        code: 'rpc.result-too-large',
        message: 'The answer is larger than 8 MiB, too large to show. Ask for less, for example a lower verbosity.',
        component,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    return { result: result ?? null, durationMs };
  }

  private async run(
    nodeId: string,
    method: string,
    params: unknown[],
    wallet: string | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const { profile } = this.options.nodes.get(nodeId);
    try {
      return await this.options.nodes
        .rpc(nodeId)
        .call(method, params, { timeoutMs, ...(wallet === undefined ? {} : { wallet }) });
    } catch (error) {
      if (error instanceof BitcoinRpcError) {
        // The node's own answer (wrong parameters, unknown method, …) is the useful part.
        throw new AppFailure({
          code: 'rpc.node-error',
          message: error.message,
          component: nodeComponent(profile),
          dataRisk: 'none',
          details: { rpcCode: error.code },
          recoveryActions: [],
        });
      }
      throw new AppFailure(describeNodeError(profile, error));
    }
  }
}
