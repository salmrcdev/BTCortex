import { arch, cpus, freemem, release, totalmem } from 'node:os';
import { PRODUCT_NAME } from '@btcortex/contracts';
import type { OperatingSystem, SystemInfo } from '@btcortex/contracts';
import type { AppPaths } from '../platform/paths';
import type { Dispatcher } from '../rpc/dispatcher';
import { ORCHESTRATOR_VERSION } from '../version';

export interface SystemHandlerOptions {
  paths: AppPaths;
  startedAt: Date;
  developmentMode: boolean;
  /** Called after the shutdown acknowledgement has been sent. */
  requestShutdown: () => void;
  now?: () => Date;
}

function operatingSystem(platform: NodeJS.Platform): OperatingSystem {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'macos';
    default:
      return 'other';
  }
}

export function describeSystem(
  options: Pick<SystemHandlerOptions, 'paths' | 'startedAt' | 'developmentMode'>,
): SystemInfo {
  const processors = cpus();
  return {
    product: { name: PRODUCT_NAME, version: ORCHESTRATOR_VERSION },
    orchestrator: {
      version: ORCHESTRATOR_VERSION,
      runtime: `Node.js ${process.version}`,
      processId: process.pid,
      startedAt: options.startedAt.toISOString(),
      dataDirectory: options.paths.root,
      developmentMode: options.developmentMode,
    },
    platform: {
      os: operatingSystem(process.platform),
      release: release(),
      architecture: arch(),
      cpuModel: processors[0]?.model.trim() ?? 'Unknown processor',
      logicalProcessors: processors.length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
    },
  };
}

export function registerSystemHandlers(dispatcher: Dispatcher, options: SystemHandlerOptions): void {
  const now = options.now ?? (() => new Date());

  dispatcher.register('system.ping', () => ({ pong: true, at: now().toISOString() }));

  dispatcher.register('system.getInfo', () => describeSystem(options));

  dispatcher.register('system.shutdown', () => {
    // Let the acknowledgement reach the shell before tearing down.
    setImmediate(options.requestShutdown);
    return { acknowledged: true };
  });
}
