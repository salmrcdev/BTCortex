import { PassThrough } from 'node:stream';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { Dispatcher } from '../rpc/dispatcher';
import { JsonRpcPeer } from '../rpc/peer';

/** An orchestrator peer wired to in-memory streams, standing in for the native shell. */
export function createPeerHarness() {
  const toOrchestrator = new PassThrough();
  const fromOrchestrator = new PassThrough();
  const sink = new MemorySink();
  const logger = new StructuredLogger([sink], 'debug');
  const dispatcher = new Dispatcher(logger);
  const peer = new JsonRpcPeer({
    input: toOrchestrator,
    output: fromOrchestrator,
    handler: (request) => dispatcher.dispatch(request),
    logger,
    defaultTimeoutMs: 200,
  });
  peer.start();

  const received: unknown[] = [];
  let buffer = '';
  fromOrchestrator.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      received.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  });

  /** Sends one raw line as the shell would. */
  const sendLine = (line: string) => toOrchestrator.write(`${line}\n`);
  const send = (message: object) => sendLine(JSON.stringify(message));

  /** Resolves with the next message matching `predicate`. */
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean, timeoutMs = 1000) => {
    const started = Date.now();
    for (;;) {
      const match = received.find((message) => predicate(message as Record<string, unknown>));
      if (match) return match as Record<string, unknown>;
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for a message from the orchestrator.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  return { peer, dispatcher, sink, received, send, sendLine, waitFor, input: toOrchestrator };
}
