import { randomUUID } from 'node:crypto';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import { BitcoinRpcClient, cookieCredentials, staticCredentials } from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type { BitcoinNetworkId, NodeProfile, OrchestratorEvent } from '@btcortex/contracts';
import { takeSnapshot } from '@btcortex/integration-bitcoin-core';
import type { NodeConfigService } from '../nodes/config-service';
import { discoverLocalNodes, publicView, readConfiguredPassword } from '../nodes/discovery';
import type { DiscoveryOptions } from '../nodes/discovery';
import { describeNodeError, nodeComponent } from '../nodes/node-errors';
import type { MempoolService } from '../nodes/mempool-service';
import type { NodeManager } from '../nodes/node-manager';
import type { PeerService } from '../nodes/peer-service';
import type { RpcConsoleService } from '../nodes/rpc-console-service';
import type { StorageService } from '../nodes/storage-service';
import type { NodeRepository } from '../nodes/repository';
import type { Dispatcher } from '../rpc/dispatcher';
import type { SecretVault } from '../vault/vault';

export interface NodeHandlerOptions {
  nodes: NodeManager;
  config: NodeConfigService;
  peers: PeerService;
  console: RpcConsoleService;
  mempool: MempoolService;
  storage: StorageService;
  repository: NodeRepository;
  vault: SecretVault;
  /** The node's Electrum server on this computer, which goes with the node; returns where its index stays. */
  electrum?: { forgetNode(nodeId: string): Promise<string | null> };
  publish: (event: OrchestratorEvent) => void;
  now?: () => Date;
  /** Where to look for existing nodes; replaced in tests. */
  discovery?: DiscoveryOptions;
}

const ACTIVE_STATES = new Set(['starting', 'running', 'stopping']);

export function registerNodeHandlers(dispatcher: Dispatcher, options: NodeHandlerOptions): void {
  const now = options.now ?? (() => new Date());
  const announce = (nodeIds: string[]) => {
    options.publish({ type: 'nodes.changed', at: now().toISOString(), payload: { nodeIds } });
  };

  dispatcher.register('nodes.list', () => options.nodes.list());
  dispatcher.register('nodes.get', ({ nodeId }) => options.nodes.get(nodeId));
  dispatcher.register('nodes.peers', ({ nodeId }) => options.peers.peers(nodeId));
  dispatcher.register('nodes.network', ({ nodeId }) => options.peers.network(nodeId));
  dispatcher.register('nodes.mempool', ({ nodeId }) => options.mempool.overview(nodeId));
  dispatcher.register('nodes.mempool.transaction', ({ nodeId, txid }) => options.mempool.transaction(nodeId, txid));
  dispatcher.register('nodes.metrics', ({ nodeId }) => options.nodes.metrics(nodeId));
  dispatcher.register('nodes.storage', ({ nodeId }) => options.storage.overview(nodeId));
  dispatcher.register('nodes.storage.configure', ({ nodeId, change, confirmed }) =>
    options.storage.configure(nodeId, change, confirmed),
  );
  dispatcher.register('nodes.storage.verify', ({ nodeId }) => options.storage.verify(nodeId));
  dispatcher.register('nodes.storage.reindex', async ({ nodeId, scope }) => {
    await options.storage.reindex(nodeId, scope);
    return { restarting: true } as const;
  });
  dispatcher.register('nodes.storage.removeIndexFiles', async ({ nodeId, part }) => ({
    removedBytes: await options.storage.removeIndexFiles(nodeId, part),
  }));
  dispatcher.register('nodes.rpc.catalogue', ({ nodeId }) => options.console.catalogue(nodeId));
  dispatcher.register('nodes.rpc.help', async ({ nodeId, method }) => ({
    text: await options.console.help(nodeId, method),
  }));
  dispatcher.register('nodes.rpc.call', ({ nodeId, method, params, wallet, confirmed }) =>
    options.console.call(nodeId, { method, params, wallet, confirmed }),
  );
  dispatcher.register('nodes.rpc.statistics', ({ nodeId }) => options.nodes.rpcStatistics(nodeId));
  dispatcher.register('nodes.peers.history', ({ nodeId }) => options.peers.history(nodeId));
  const done = { done: true } as const;
  dispatcher.register('nodes.peers.disconnect', async ({ nodeId, peerId }) => {
    await options.peers.disconnect(nodeId, peerId);
    return done;
  });
  dispatcher.register('nodes.peers.connect', async ({ nodeId, address, keep }) => {
    await options.peers.connect(nodeId, address, keep);
    return done;
  });
  dispatcher.register('nodes.peers.forget', async ({ nodeId, address }) => {
    await options.peers.forget(nodeId, address);
    return done;
  });
  dispatcher.register('nodes.peers.ban', async ({ nodeId, target, durationSeconds }) => {
    await options.peers.ban(nodeId, target, durationSeconds);
    return done;
  });
  dispatcher.register('nodes.peers.unban', async ({ nodeId, target }) => {
    await options.peers.unban(nodeId, target);
    return done;
  });
  dispatcher.register('nodes.peers.clearBans', async ({ nodeId }) => {
    await options.peers.clearBans(nodeId);
    return done;
  });

  dispatcher.register('nodes.lifecycle.configure', ({ nodeId, keepRunningOnExit, startWithBtcortex }) => {
    const profile = options.nodes.configureLifecycle(nodeId, {
      ...(keepRunningOnExit === undefined ? {} : { keepRunningOnExit }),
      ...(startWithBtcortex === undefined ? {} : { startWithBtcortex }),
    });
    announce([nodeId]);
    return profile;
  });

  dispatcher.register('nodes.start', async ({ nodeId }) => {
    await options.nodes.start(nodeId);
    return { accepted: true };
  });

  dispatcher.register('nodes.stop', async ({ nodeId }) => {
    await options.nodes.stop(nodeId);
    return { accepted: true };
  });

  dispatcher.register('nodes.restart', async ({ nodeId }) => {
    await options.nodes.restart(nodeId);
    return { accepted: true };
  });

  dispatcher.register('nodes.config.get', ({ nodeId }) => options.config.get(nodeId));
  dispatcher.register('nodes.config.save', ({ nodeId, text, revision, acceptedRisks }) =>
    options.config.save(nodeId, { text, revision, acceptedRisks }),
  );
  dispatcher.register('nodes.config.history', ({ nodeId }) => options.config.history(nodeId));
  dispatcher.register('nodes.config.export', async ({ nodeId, path }) => {
    await options.config.export(nodeId, path);
    return { written: true } as const;
  });
  dispatcher.register('nodes.config.version', ({ nodeId, versionId }) => options.config.version(nodeId, versionId));
  dispatcher.register('nodes.config.restore', ({ nodeId, versionId, revision, acceptedRisks }) =>
    options.config.restore(nodeId, versionId, revision, acceptedRisks),
  );

  dispatcher.register('nodes.remove', async ({ nodeId }) => {
    const { profile, status } = options.nodes.get(nodeId);
    // The process itself counts: a bitcoind that does not answer (busy, or after an error) still runs.
    if (
      profile.execution === 'managed' &&
      (ACTIVE_STATES.has(status.state) || (await options.nodes.isProcessRunning(nodeId)))
    ) {
      throw new AppFailure({
        code: 'nodes.stop-first',
        message: 'Stop this node before removing it from BTCortex.',
        component: nodeComponent(profile),
        dataRisk: 'none',
        likelyCause: 'Removing a running managed node would leave it running without supervision.',
        recoveryActions: [{ id: 'stop-node', label: 'Stop the node' }],
      });
    }
    // Its Electrum server goes first: stopped, its onion address withdrawn; the index folder stays.
    const electrumIndexKept = (await options.electrum?.forgetNode(nodeId)) ?? null;
    options.nodes.untrack(nodeId);
    options.repository.remove(nodeId);
    if (profile.authentication.kind === 'password') options.vault.remove(profile.authentication.secretId);
    announce([nodeId]);
    // Blockchain and wallet data are never deleted as a side effect (specification section 5.2).
    return { removed: true, dataDirectoryKept: profile.dataDirectory, electrumIndexKept };
  });

  /** Tests the connection first, then registers the node; nothing is stored if the test fails. */
  const connect = async ({
    name,
    network,
    rpcEndpoint,
    authentication,
  }: {
    name: string;
    network: BitcoinNetworkId;
    rpcEndpoint: string;
    authentication: { kind: 'cookie'; cookieFile: string } | { kind: 'password'; username: string; password: string };
  }): Promise<NodeProfile> => {
    const credentials =
      authentication.kind === 'cookie'
        ? cookieCredentials(authentication.cookieFile)
        : staticCredentials({ username: authentication.username, password: authentication.password });
    const timestamp = now().toISOString();
    const draft: NodeProfile = {
      id: randomUUID(),
      name,
      implementation: 'bitcoin-core',
      network,
      execution: 'external',
      runtimeVersion: null,
      dataDirectory: null,
      rpcEndpoint,
      authentication:
        authentication.kind === 'cookie'
          ? authentication
          : { kind: 'password', username: authentication.username, secretId: 'pending' },
      keepRunningOnExit: true,
      startWithBtcortex: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Test before saving anything: wrong network, address or credentials are reported now.
    const client = new BitcoinRpcClient({ endpoint: rpcEndpoint, credentials, timeoutMs: 15_000 });
    let snapshot;
    try {
      snapshot = await takeSnapshot(client, now);
    } catch (error) {
      throw new AppFailure(describeNodeError(draft, error));
    }
    const expectedChain = NETWORK_PARAMETERS[network].chainName;
    if (snapshot.blockchain.chain !== expectedChain) {
      throw new AppFailure({
        code: 'nodes.network-mismatch',
        message: `The node at ${rpcEndpoint} runs on "${snapshot.blockchain.chain}", not on ${NETWORK_PARAMETERS[network].label}.`,
        component: nodeComponent(draft),
        dataRisk: 'none',
        recoveryActions: [{ id: 'choose-network', label: 'Choose the network the node actually uses' }],
      });
    }
    const implementation = /Knots/i.test(snapshot.network.subversion) ? 'bitcoin-knots' : 'bitcoin-core';

    let profile: NodeProfile = { ...draft, implementation };
    if (authentication.kind === 'password') {
      const secretId = await options.vault.store(`RPC password for ${name}`, authentication.password);
      profile = { ...profile, authentication: { kind: 'password', username: authentication.username, secretId } };
    }
    try {
      options.repository.insert(profile);
    } catch (error) {
      if (profile.authentication.kind === 'password') options.vault.remove(profile.authentication.secretId);
      throw error;
    }
    options.nodes.track(profile);
    announce([profile.id]);
    return profile;
  };

  dispatcher.register('nodes.connectExisting', (request) => connect(request));

  const discover = () =>
    discoverLocalNodes(
      options.nodes.list().map((node) => node.profile),
      options.discovery,
    );

  dispatcher.register('nodes.discover', async () => (await discover()).map(publicView));

  dispatcher.register('nodes.connectDiscovered', async ({ dataDirectory, network, name, useConfiguredPassword }) => {
    // Only what discovery found itself is used; the interface cannot point BTCortex at other files.
    const found = (await discover()).find(
      (candidate) =>
        candidate.network === network && candidate.dataDirectory.toLowerCase() === dataDirectory.toLowerCase(),
    );
    const component = 'Bitcoin Core';
    if (!found) {
      throw new AppFailure({
        code: 'nodes.not-found-on-computer',
        message: 'BTCortex no longer finds this node on this computer.',
        component,
        dataRisk: 'none',
        recoveryActions: [{ id: 'refresh', label: 'Look for nodes again' }],
      });
    }
    if (found.registeredAs !== undefined) {
      throw new AppFailure({
        code: 'nodes.already-registered',
        message: 'This node is already in BTCortex.',
        component,
        dataRisk: 'none',
        recoveryActions: [{ id: 'open-node', label: 'Open the node' }],
      });
    }
    if (!found.running) {
      throw new AppFailure({
        code: 'nodes.not-running',
        message: 'This node is not running. BTCortex does not start nodes it did not set up.',
        component,
        dataRisk: 'none',
        recoveryActions: [{ id: 'start-externally', label: 'Start Bitcoin Core, then connect again' }],
      });
    }
    if (found.rpcServer === 'off') {
      throw new AppFailure({
        code: 'nodes.rpc-disabled',
        message: 'This node does not accept connections from other programs.',
        component,
        dataRisk: 'none',
        likelyCause: 'Bitcoin Core’s window leaves its RPC server off unless it is enabled in its options.',
        recoveryActions: [
          {
            id: 'enable-rpc-server',
            label: 'In Bitcoin Core, open Settings › Options, tick “Enable RPC server”, then restart Bitcoin Core',
          },
        ],
      });
    }
    if (found.authentication === 'cookie') {
      return connect({
        name,
        network,
        rpcEndpoint: found.rpcEndpoint,
        authentication: { kind: 'cookie', cookieFile: found.cookieFile },
      });
    }
    const configured = useConfiguredPassword ? await readConfiguredPassword(found.dataDirectory, network) : undefined;
    if (!configured) {
      throw new AppFailure({
        code: 'nodes.password-required',
        message: 'This node’s bitcoin.conf sets an RPC password, which switches the cookie off.',
        component,
        dataRisk: 'none',
        recoveryActions: [{ id: 'use-configured-password', label: 'Connect using the password in its bitcoin.conf' }],
      });
    }
    // The password is read here, stored with DPAPI by connect(), and never sent to the interface.
    return connect({
      name,
      network,
      rpcEndpoint: found.rpcEndpoint,
      authentication: { kind: 'password', ...configured },
    });
  });
}
