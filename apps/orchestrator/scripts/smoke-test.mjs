// Smoke test of a built orchestrator: it must start, answer the shell over
// stdio, load its modules and shut down cleanly. Catches bundling faults that
// unit tests on the sources cannot see.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS = 30_000;

export async function smokeTest(command) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'btcortex-smoke-'));
  const [file, ...args] = command;
  const child = spawn(file, args, {
    env: { ...process.env, BTCORTEX_DATA_DIR: dataDirectory, BTCORTEX_DEVELOPMENT: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const responses = new Map();
  let stderr = '';
  let buffer = '';
  child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (message.id !== undefined) responses.set(message.id, message);
    }
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const waitFor = async (id) => {
    const deadline = Date.now() + TIMEOUT_MS;
    while (!responses.has(id)) {
      if (child.exitCode !== null)
        throw new Error(`The orchestrator exited early (code ${child.exitCode}).\n${stderr}`);
      if (Date.now() > deadline) throw new Error(`No answer to request ${id}.\n${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const response = responses.get(id);
    if (response.error) throw new Error(`Request ${id} failed: ${JSON.stringify(response.error)}`);
    return response.result;
  };

  try {
    send({ id: 1, method: 'system.ping', origin: 'shell' });
    await waitFor(1);
    send({ id: 2, method: 'system.getInfo', origin: 'ui' });
    const info = await waitFor(2);
    send({ id: 3, method: 'nodes.list', params: {}, origin: 'ui' });
    const nodes = await waitFor(3);
    if (!Array.isArray(nodes)) throw new Error('nodes.list did not return a list.');
    // The orchestrator's own log has entries by now, so the log centre must find some.
    send({
      id: 4,
      method: 'logs.read',
      params: { sourceIds: ['btcortex'], minimumSeverity: 'info', limit: 10 },
      origin: 'ui',
    });
    const page = await waitFor(4);
    if (!page.entries.some((entry) => entry.message === 'Orchestrator started')) {
      throw new Error(`logs.read did not return the start-up entry: ${JSON.stringify(page)}`);
    }
    // The catalogue's research data is bundled into the executable and checked as it loads.
    send({ id: 6, method: 'catalogue.list', params: {}, origin: 'ui' });
    const catalogue = await waitFor(6);
    const core = catalogue.find((entry) => entry.id === 'bitcoin-core');
    if (catalogue.length < 50 || core?.integration.level !== 'fully-managed') {
      throw new Error(`catalogue.list did not return the researched entries: ${String(catalogue.length)} entries.`);
    }
    // The Tor service and the signing key bundled with it load; a fresh data directory has no tor yet.
    send({ id: 7, method: 'tor.status', params: {}, origin: 'ui' });
    const tor = await waitFor(7);
    if (tor.state !== 'not-installed' || tor.ports.control === 9051) {
      throw new Error(`tor.status reported an unexpected state: ${JSON.stringify(tor)}`);
    }
    send({ id: 5, method: 'system.shutdown', params: { reason: 'application-exit' }, origin: 'shell' });
    await waitFor(5);
    const code = await exited;
    if (code !== 0) throw new Error(`The orchestrator exited with code ${code}.\n${stderr}`);
    console.log(
      `Smoke test passed: ${info.product.name} ${info.orchestrator.version} on ${info.orchestrator.runtime}.`,
    );
  } finally {
    if (child.exitCode === null) child.kill();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
}
