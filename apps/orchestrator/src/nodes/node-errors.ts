import {
  BitcoinRpcError,
  CookieFileError,
  RpcAuthenticationError,
  RpcForbiddenError,
  RpcTransportError,
} from '@btcortex/bitcoin-rpc';
import type { AppError, NodeProfile } from '@btcortex/contracts';

// Translates node failures into explanations that say what happened, which
// component is affected, whether data is at risk and what to do next
// (specification section 30).

export function nodeComponent(profile: NodeProfile): string {
  return `${profile.implementation === 'bitcoin-knots' ? 'Bitcoin Knots' : 'Bitcoin Core'} (${profile.name})`;
}

export function describeNodeError(profile: NodeProfile, error: unknown): AppError {
  const component = nodeComponent(profile);
  const managed = profile.execution === 'managed';

  if (error instanceof RpcAuthenticationError) {
    return {
      code: 'bitcoin-core.unauthorised',
      message: 'The node rejected the credentials BTCortex used.',
      component,
      dataRisk: 'none',
      likelyCause: managed
        ? 'The cookie file was replaced by another node using the same data directory.'
        : 'The RPC user name or password changed on the node.',
      recoveryActions: [{ id: 'update-credentials', label: 'Update the connection details' }],
    };
  }
  if (error instanceof RpcForbiddenError) {
    return {
      code: 'bitcoin-core.forbidden',
      message: `The node does not allow these credentials to call ${error.method}.`,
      component,
      dataRisk: 'none',
      likelyCause: 'An rpcwhitelist restricts this RPC user.',
      recoveryActions: [{ id: 'review-whitelist', label: 'Review the node’s rpcwhitelist settings' }],
    };
  }
  if (error instanceof CookieFileError || (error instanceof RpcTransportError && error.failure === 'unreachable')) {
    return {
      code: 'bitcoin-core.unreachable',
      message: 'BTCortex cannot reach the node’s RPC interface.',
      component,
      dataRisk: 'none',
      likelyCause: managed
        ? 'The node is not running.'
        : 'The node is stopped, the address is wrong, or a firewall blocks the connection.',
      details: { endpoint: profile.rpcEndpoint },
      recoveryActions: managed
        ? [{ id: 'start-node', label: 'Start the node' }]
        : [{ id: 'check-connection', label: 'Check that the node is running and reachable' }],
    };
  }
  if (error instanceof RpcTransportError && error.failure === 'timeout') {
    return {
      code: 'bitcoin-core.timeout',
      message: 'The node did not answer in time.',
      component,
      dataRisk: 'none',
      likelyCause: 'The node is busy, for example during the initial synchronisation or a large rescan.',
      recoveryActions: [{ id: 'wait', label: 'Wait; BTCortex retries automatically' }],
    };
  }
  if (error instanceof BitcoinRpcError) {
    return {
      code: 'bitcoin-core.rpc-error',
      message: `The node reported an error: ${error.message}`,
      component,
      dataRisk: 'unknown',
      details: { method: error.method, code: error.code },
      recoveryActions: [{ id: 'open-logs', label: 'Open the node log' }],
    };
  }
  return {
    code: 'bitcoin-core.unexpected',
    message: error instanceof Error ? error.message : 'An unexpected error occurred while checking the node.',
    component,
    dataRisk: 'unknown',
    recoveryActions: [{ id: 'open-logs', label: 'Open the BTCortex log' }],
  };
}
