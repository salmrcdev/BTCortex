import { performance } from 'node:perf_hooks';
import { AppFailure } from '@btcortex/contracts';
import type { RemoteServiceKind, RemoteTestResult } from '@btcortex/contracts';
import type { LightningService } from '../lightning/lightning-service';
import type { NodeManager } from '../nodes/node-manager';
import type { RemoteElectrumService } from '../electrum/remote-electrum-service';
import type { RemoteExplorerService } from '../explorer/remote-explorer-service';
import type { PaymentService } from '../payments/payment-service';
import type { Dispatcher } from '../rpc/dispatcher';

// Connection tests for services on other computers (specification section 26):
// one round trip through the service's own interface, timed. A failure is a
// result to show, not an error: the point of a test is to find out.

export interface RemoteHandlerOptions {
  nodes: Pick<NodeManager, 'rpc'>;
  lightning: Pick<LightningService, 'refresh'>;
  payments: Pick<PaymentService, 'test'>;
  electrum: Pick<RemoteElectrumService, 'checkOne'>;
  explorers: Pick<RemoteExplorerService, 'checkOne'>;
  now?: () => Date;
}

function message(error: unknown): string {
  if (error instanceof AppFailure) return error.error.message;
  if (error instanceof Error) return error.message;
  return 'The service did not answer.';
}

export function registerRemoteHandlers(dispatcher: Dispatcher, options: RemoteHandlerOptions): void {
  const now = options.now ?? (() => new Date());
  const run = async (kind: RemoteServiceKind, id: string): Promise<{ ok: boolean; detail: string }> => {
    switch (kind) {
      case 'bitcoin-node': {
        const info = await options.nodes.rpc(id).call<{ subversion?: string; connections?: number }>('getnetworkinfo');
        return {
          ok: true,
          detail: `Answered as ${info.subversion ?? 'a Bitcoin node'} with ${String(info.connections ?? 0)} peers.`,
        };
      }
      case 'lightning': {
        const status = await options.lightning.refresh(id);
        const answering = ['ready', 'syncing', 'locked'].includes(status.state);
        return {
          ok: answering,
          detail: answering
            ? `LND answered${status.alias ? ` as ${status.alias}` : ''}${status.state === 'locked' ? '; its wallet is locked' : ''}.`
            : (status.error?.message ?? 'LND did not answer.'),
        };
      }
      case 'payments': {
        const status = await options.payments.test(id);
        const answering = status.state === 'online' || status.state === 'synchronising';
        const version = status.version === null ? '' : ` ${status.version}`;
        return {
          ok: answering,
          detail: answering
            ? `BTCPay Server${version} answered${status.state === 'synchronising' ? ' and is still synchronising' : ''}.`
            : (status.error ?? 'BTCPay Server did not answer.'),
        };
      }
      case 'electrum': {
        const status = await options.electrum.checkOne(id);
        return {
          ok: status.state === 'online',
          detail:
            status.state === 'online'
              ? `${status.serverVersion ?? 'The Electrum server'} answered at block ${String(status.height ?? 0)}.`
              : (status.error ?? 'The Electrum server did not answer.'),
        };
      }
      case 'explorer': {
        const status = await options.explorers.checkOne(id);
        return {
          ok: status.state === 'online',
          detail:
            status.state === 'online'
              ? `The explorer answered at block ${String(status.height ?? 0)}${
                  status.blocksBehind !== null && status.blocksBehind > 0
                    ? `, ${String(status.blocksBehind)} behind the node`
                    : ''
                }.`
              : (status.error ?? 'The explorer did not answer.'),
        };
      }
    }
  };

  dispatcher.register('remote.test', async ({ kind, id }): Promise<RemoteTestResult> => {
    const started = performance.now();
    try {
      const { ok, detail } = await run(kind, id);
      return {
        ok,
        latencyMs: ok ? Math.round(performance.now() - started) : null,
        detail,
        testedAt: now().toISOString(),
      };
    } catch (error) {
      return { ok: false, latencyMs: null, detail: message(error), testedAt: now().toISOString() };
    }
  });
}
