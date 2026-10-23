import { describe, expect, it } from 'vitest';
import { AppFailure, RPC_ERROR } from '@btcortex/contracts';
import { describeSystem, registerSystemHandlers } from '../handlers/system';
import { resolveAppPaths } from '../platform/paths';
import { createPeerHarness } from '../testing/harness';
import { RpcRemoteError } from './errors';

const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: 'C:\\btcortex-test' }, 'win32');

function withSystemHandlers() {
  const harness = createPeerHarness();
  let shutdownRequested = false;
  registerSystemHandlers(harness.dispatcher, {
    paths,
    startedAt: new Date('2026-10-21T10:00:00.000Z'),
    developmentMode: true,
    requestShutdown: () => {
      shutdownRequested = true;
    },
  });
  return { ...harness, wasShutdownRequested: () => shutdownRequested };
}

describe('JsonRpcPeer and Dispatcher', () => {
  it('answers a valid request from the interface', async () => {
    const { send, waitFor } = withSystemHandlers();
    send({ jsonrpc: '2.0', id: 1, method: 'system.ping', params: {}, origin: 'ui' });
    const response = await waitFor((message) => message['id'] === 1);
    expect(response['result']).toMatchObject({ pong: true });
  });

  it('returns host information that satisfies the contract', async () => {
    const { send, waitFor } = withSystemHandlers();
    send({ jsonrpc: '2.0', id: 'info', method: 'system.getInfo', origin: 'ui' });
    const response = await waitFor((message) => message['id'] === 'info');
    expect(response['error']).toBeUndefined();
    expect(response['result']).toMatchObject({ orchestrator: { dataDirectory: paths.root, developmentMode: true } });
    expect(
      describeSystem({ paths, startedAt: new Date(), developmentMode: false }).platform.logicalProcessors,
    ).toBeGreaterThan(0);
  });

  it('refuses shell-only methods when the call comes from the interface', async () => {
    const { send, waitFor, wasShutdownRequested } = withSystemHandlers();
    send({ jsonrpc: '2.0', id: 2, method: 'system.shutdown', params: { reason: 'application-exit' }, origin: 'ui' });
    const response = await waitFor((message) => message['id'] === 2);
    expect(response['error']).toMatchObject({ code: RPC_ERROR.forbidden });
    expect(wasShutdownRequested()).toBe(false);
  });

  it('treats requests without an origin as coming from the interface', async () => {
    const { send, waitFor } = withSystemHandlers();
    send({ jsonrpc: '2.0', id: 3, method: 'system.shutdown', params: { reason: 'application-exit' } });
    const response = await waitFor((message) => message['id'] === 3);
    expect(response['error']).toMatchObject({ code: RPC_ERROR.forbidden });
  });

  it('lets the shell request a shutdown', async () => {
    const { send, waitFor, wasShutdownRequested } = withSystemHandlers();
    send({ jsonrpc: '2.0', id: 4, method: 'system.shutdown', params: { reason: 'application-exit' }, origin: 'shell' });
    const response = await waitFor((message) => message['id'] === 4);
    expect(response['result']).toEqual({ acknowledged: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(wasShutdownRequested()).toBe(true);
  });

  it('rejects unknown methods and invalid parameters with standard codes', async () => {
    const { send, waitFor } = withSystemHandlers();
    send({ jsonrpc: '2.0', id: 5, method: 'wallet.spendEverything', origin: 'ui' });
    send({ jsonrpc: '2.0', id: 6, method: 'system.ping', params: { unexpected: true }, origin: 'ui' });
    expect((await waitFor((message) => message['id'] === 5))['error']).toMatchObject({
      code: RPC_ERROR.methodNotFound,
    });
    expect((await waitFor((message) => message['id'] === 6))['error']).toMatchObject({ code: RPC_ERROR.invalidParams });
  });

  it('reports malformed input without crashing', async () => {
    const { sendLine, send, waitFor } = withSystemHandlers();
    sendLine('this is not json');
    send({ jsonrpc: '1.0', id: 7, method: 'system.ping' });
    const errors = await waitFor(
      (message) => message['id'] === null && (message['error'] as { code: number }).code === RPC_ERROR.parseError,
    );
    expect(errors).toBeDefined();
    send({ jsonrpc: '2.0', id: 8, method: 'system.ping', origin: 'ui' });
    expect((await waitFor((message) => message['id'] === 8))['result']).toMatchObject({ pong: true });
  });

  it('serialises application failures with their structured error', async () => {
    const harness = createPeerHarness();
    harness.dispatcher.register('system.ping', () => {
      throw new AppFailure({
        code: 'test.failure',
        message: 'The test failed on purpose.',
        component: 'Test',
        dataRisk: 'none',
        recoveryActions: [{ id: 'retry', label: 'Try again' }],
      });
    });
    harness.send({ jsonrpc: '2.0', id: 9, method: 'system.ping', origin: 'ui' });
    const response = await harness.waitFor((message) => message['id'] === 9);
    expect(response['error']).toMatchObject({
      code: RPC_ERROR.applicationError,
      data: { code: 'test.failure', dataRisk: 'none' },
    });
  });

  it('hides unexpected internal errors behind a generic message', async () => {
    const harness = createPeerHarness();
    harness.dispatcher.register('system.ping', () => {
      throw new Error('secret internal detail rpcpassword=hunter2');
    });
    harness.send({ jsonrpc: '2.0', id: 10, method: 'system.ping', origin: 'ui' });
    const response = await harness.waitFor((message) => message['id'] === 10);
    expect(response['error']).toMatchObject({ code: RPC_ERROR.internalError });
    expect(JSON.stringify(response)).not.toContain('hunter2');
  });

  it('correlates responses to its own outgoing requests and times out otherwise', async () => {
    const { peer, waitFor, send } = createPeerHarness();
    const answered = peer.request('vault.protect', { plaintext: 'x' });
    const outgoing = await waitFor((message) => message['method'] === 'vault.protect');
    send({ jsonrpc: '2.0', id: outgoing['id'] as number, result: { protected: 'AAAA' } });
    await expect(answered).resolves.toEqual({ protected: 'AAAA' });

    await expect(peer.request('vault.unprotect', { protected: 'AAAA' }, 20)).rejects.toBeInstanceOf(RpcRemoteError);
  });

  it('rejects pending requests and notifies listeners when the channel closes', async () => {
    const { peer, input } = createPeerHarness();
    let closed = false;
    peer.onClose(() => {
      closed = true;
    });
    const pending = peer.request('vault.protect', { plaintext: 'x' }, 5000);
    input.end();
    await expect(pending).rejects.toMatchObject({ rpcError: { code: RPC_ERROR.unavailable } });
    expect(closed).toBe(true);
  });
});
