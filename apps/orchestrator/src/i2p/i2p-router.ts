import { I2P_SAM_ADDRESS } from '@btcortex/contracts';
import type { I2pRouterStatus } from '@btcortex/contracts';
import { listeningProcess, routerByConsole, routerName, samHello } from '@btcortex/integration-i2p';
import type { I2pRouterKind, RouterConsole, SamHello } from '@btcortex/integration-i2p';
import type { Logger } from '../logging/logger';

// The I2P router on this computer (specification section 10; Bitcoin Core's
// doc/i2p.md). BTCortex neither installs nor runs one: it greets the SAM
// bridge that i2pd and the Java I2P router offer on 127.0.0.1:7656, and asks
// Windows which program listens there, so that the nodes it set up can be
// pointed at the router. When the bridge does not answer, the routers'
// consoles tell a router without its bridge from no router at all.

const CACHE_MS = 30_000;

export interface I2pRouterOptions {
  /** The SAM bridge as `host:port`; i2pd's and the Java router's default unless a test says otherwise. */
  samAddress?: string;
  /** The process listening on a local port; Windows' answer unless a test says otherwise. */
  listeningProcess?: (port: number) => Promise<string | null>;
  /** The routers' consoles; their default addresses unless a test says otherwise. */
  consoles?: Record<I2pRouterKind, RouterConsole>;
  logger: Logger;
}

export class I2pRouterService {
  private cached: { at: number; status: Promise<I2pRouterStatus> } | undefined;

  constructor(private readonly options: I2pRouterOptions) {}

  get samAddress(): string {
    return this.options.samAddress ?? I2P_SAM_ADDRESS;
  }

  /** Whether the router answers, asked again at most every 30 seconds unless `refresh`. */
  status(refresh = false): Promise<I2pRouterStatus> {
    if (!refresh && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.status;
    const status = this.check();
    this.cached = { at: Date.now(), status };
    return status;
  }

  private async check(): Promise<I2pRouterStatus> {
    const { samAddress } = this;
    const separator = samAddress.lastIndexOf(':');
    const host = samAddress.slice(0, separator);
    const port = Number(samAddress.slice(separator + 1));
    const unavailable = (error: string | null, runningWithoutSam: I2pRouterKind | null = null): I2pRouterStatus => ({
      available: false,
      samAddress,
      samVersion: null,
      program: null,
      runningWithoutSam,
      checkedAt: new Date().toISOString(),
      error,
    });
    let hello: SamHello;
    try {
      hello = await samHello(host, port);
    } catch (error) {
      // Nothing listening is the usual case: no router is installed or running.
      if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') {
        return unavailable(null, await routerByConsole(this.options.consoles));
      }
      return unavailable(
        `${samAddress} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!hello.ok) return unavailable(hello.reason);
    const program = await (this.options.listeningProcess ?? listeningProcess)(port)
      .then(routerName)
      .catch((error: unknown) => {
        this.options.logger.debug('The program behind the SAM bridge could not be named', { error });
        return null;
      });
    return {
      available: true,
      samAddress,
      samVersion: hello.version,
      program,
      runningWithoutSam: null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }
}
