import { z } from 'zod';
import { AppFailure, endpointParts, isLoopbackHost } from '@btcortex/contracts';
import type { NodeWithStatus, OrchestratorEvent, ZmqEventView, ZmqNotification, ZmqStatus } from '@btcortex/contracts';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { interpretZmqMessage, subscribeZmq } from '@btcortex/integration-bitcoin-core';
import type { ZmqSubscriber } from '@btcortex/integration-bitcoin-core';
import type { Logger } from '../logging/logger';
import { describeNodeError } from '../nodes/node-errors';

// Watching a node's ZMQ notifications for the developer tools (specification
// section 15, ZMQ event monitoring): one subscription per publishing address,
// raw blocks and transactions only when the node publishes no hashes, and
// what arrives handed to the window in batches about once a second, so that a
// busy mempool cannot flood it. Watching stops by itself after 30 minutes.

const BATCH_MS = 1000;
const MAX_EVENTS_PER_BATCH = 50;
const WATCH_LIMIT_MS = 30 * 60 * 1000;

const NotificationsSchema = z.array(z.object({ type: z.string(), address: z.string(), hwm: z.number().optional() }));

interface Watch {
  subscribers: ZmqSubscriber[];
  pending: ZmqEventView[];
  counts: Record<string, number>;
  missed: number;
  last: Map<string, number>;
  timer: NodeJS.Timeout;
  limit: NodeJS.Timeout;
}

export interface ZmqWatchServiceOptions {
  nodes: { get(nodeId: string): NodeWithStatus; rpc(nodeId: string): Pick<BitcoinRpcClient, 'call'> };
  publish: (event: OrchestratorEvent) => void;
  logger: Logger;
  now?: () => Date;
}

export class ZmqWatchService {
  private readonly watches = new Map<string, Watch>();

  constructor(private readonly options: ZmqWatchServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async notifications(nodeId: string): Promise<ZmqNotification[]> {
    const { profile } = this.options.nodes.get(nodeId);
    try {
      const list = await this.options.nodes
        .rpc(nodeId)
        .call('getzmqnotifications', [], { schema: NotificationsSchema });
      return list.map((entry) => ({ type: entry.type, address: entry.address, hwm: entry.hwm ?? null }));
    } catch (error) {
      throw new AppFailure(describeNodeError(profile, error));
    }
  }

  /** Why this node's notifications cannot be watched from this computer, if so. */
  private unavailable(node: NodeWithStatus, notifications: readonly ZmqNotification[]): string | null {
    if (notifications.length === 0) {
      return 'The node publishes no ZMQ notifications. Add zmqpubhashblock, zmqpubhashtx and zmqpubsequence, bound to tcp://127.0.0.1 and a port, to its bitcoin.conf and restart it.';
    }
    const local = isLoopbackHost(endpointParts(node.profile.rpcEndpoint).hostname);
    const onlyLoopback = notifications.every((entry) => {
      try {
        return isLoopbackHost(new URL(entry.address).hostname);
      } catch {
        return false;
      }
    });
    if (!local && onlyLoopback) {
      return 'The node runs on another computer and publishes its notifications to that computer only.';
    }
    return null;
  }

  async status(nodeId: string): Promise<ZmqStatus> {
    const node = this.options.nodes.get(nodeId);
    const notifications = await this.notifications(nodeId);
    return {
      nodeId,
      notifications,
      watching: this.watches.has(nodeId),
      unavailableReason: this.unavailable(node, notifications),
    };
  }

  async watch(nodeId: string, watch: boolean): Promise<ZmqStatus> {
    if (!watch) {
      this.stop(nodeId, null);
      return this.status(nodeId);
    }
    if (this.watches.has(nodeId)) return this.status(nodeId);
    const node = this.options.nodes.get(nodeId);
    const notifications = await this.notifications(nodeId);
    const reason = this.unavailable(node, notifications);
    if (reason !== null) {
      throw new AppFailure({
        code: 'devtools.zmq-unavailable',
        message: reason,
        component: 'Developer tools',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const types = new Set(notifications.map((entry) => entry.type.replace(/^pub/, '')));
    const wanted = (topic: string) =>
      (topic !== 'rawblock' || !types.has('hashblock')) && (topic !== 'rawtx' || !types.has('hashtx'));
    const byAddress = new Map<string, string[]>();
    for (const entry of notifications) {
      const topic = entry.type.replace(/^pub/, '');
      if (!wanted(topic)) continue;
      // A publisher bound to every interface is reached where the node runs.
      const host = endpointParts(node.profile.rpcEndpoint).hostname;
      const address = entry.address.replace(/\/\/(0\.0\.0\.0|\*)(?=:)/, `//${host}`);
      byAddress.set(address, [...(byAddress.get(address) ?? []), topic]);
    }

    const state: Watch = {
      subscribers: [],
      pending: [],
      counts: {},
      missed: 0,
      last: new Map(),
      timer: setInterval(() => {
        this.flush(nodeId, null);
      }, BATCH_MS),
      limit: setTimeout(() => {
        this.stop(nodeId, 'Watching stopped by itself after 30 minutes.');
      }, WATCH_LIMIT_MS),
    };
    state.timer.unref();
    state.limit.unref();
    this.watches.set(nodeId, state);
    try {
      for (const [address, topics] of byAddress) {
        state.subscribers.push(
          await subscribeZmq({
            address,
            topics,
            onMessage: (message) => {
              // Gaps in the publisher's own counter are notifications that never arrived.
              if (message.sequence !== null) {
                const previous = state.last.get(message.topic);
                if (previous !== undefined && message.sequence > previous + 1) {
                  state.missed += message.sequence - previous - 1;
                }
                state.last.set(message.topic, message.sequence);
              }
              const event = interpretZmqMessage(message);
              if (!event) return;
              const key = event.kind === 'mempool' ? event.change : event.kind;
              state.counts[key] = (state.counts[key] ?? 0) + 1;
              state.pending.push({
                at: this.now().toISOString(),
                kind: event.kind,
                change: event.kind === 'mempool' ? event.change : null,
                hash:
                  event.kind === 'block' || event.kind === 'mempool'
                    ? event.hash
                    : event.kind === 'transaction'
                      ? event.txid
                      : null,
                bytes: event.kind === 'raw-block' || event.kind === 'raw-transaction' ? event.bytes : null,
              });
              if (state.pending.length > MAX_EVENTS_PER_BATCH * 4)
                state.pending.splice(0, state.pending.length - MAX_EVENTS_PER_BATCH);
            },
            onClose: (error) => {
              this.stop(
                nodeId,
                error ? `The node closed the notifications: ${error.message}` : 'The node stopped publishing.',
              );
            },
          }),
        );
      }
    } catch (error) {
      this.stop(nodeId, null);
      throw new AppFailure({
        code: 'devtools.zmq-connect',
        message: `BTCortex could not subscribe: ${error instanceof Error ? error.message : String(error)}`,
        component: 'Developer tools',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    this.options.logger.info('Watching ZMQ notifications', { nodeId, addresses: [...byAddress.keys()] });
    return this.status(nodeId);
  }

  private flush(nodeId: string, stopped: string | null): void {
    const state = this.watches.get(nodeId);
    if (!state) return;
    if (
      state.pending.length === 0 &&
      Object.keys(state.counts).length === 0 &&
      state.missed === 0 &&
      stopped === null
    ) {
      return;
    }
    this.options.publish({
      type: 'zmq.events',
      at: this.now().toISOString(),
      payload: {
        nodeId,
        events: state.pending.slice(-MAX_EVENTS_PER_BATCH),
        counts: state.counts,
        missed: state.missed,
        stopped,
      },
    });
    state.pending = [];
    state.counts = {};
    state.missed = 0;
  }

  private stop(nodeId: string, reason: string | null): void {
    const state = this.watches.get(nodeId);
    if (!state) return;
    this.flush(nodeId, reason ?? 'Watching stopped.');
    clearInterval(state.timer);
    clearTimeout(state.limit);
    for (const subscriber of state.subscribers) subscriber.close();
    this.watches.delete(nodeId);
  }

  shutdown(): void {
    for (const nodeId of [...this.watches.keys()]) this.stop(nodeId, 'BTCortex is closing.');
  }
}
