import { spawn } from 'node:child_process';

// A client for HWI's command line (docs/research/notes/wallets-hardware.md
// §5.4), limited to what BTCortex may do with a signing device: list devices,
// read the public descriptors for a watch-only wallet, show an address on the
// device, and sign a PSBT after an explicit request, with the device itself
// asking for confirmation. Setting up, wiping, restoring or backing up a
// device, PIN and passphrase handling and message signing are deliberately
// not offered. HWI answers in JSON on standard output; errors are objects
// with `error` and `code`.

export type HwiChain = 'main' | 'test' | 'testnet4' | 'signet' | 'regtest';

const CHAINS: Record<string, HwiChain> = {
  mainnet: 'main',
  testnet3: 'test',
  testnet4: 'testnet4',
  signet: 'signet',
  regtest: 'regtest',
};

/** HWI's chain name for a Bitcoin network. */
export function hwiChain(network: string): HwiChain {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`HWI has no chain for the network "${network}".`);
  return chain;
}

/** HWI's error codes (hwilib/errors.py). */
export const HWI_ERRORS = {
  noDeviceType: -1,
  missingArguments: -2,
  deviceConnection: -3,
  unknownDeviceType: -4,
  invalidTransaction: -5,
  noPassword: -6,
  badArgument: -7,
  notImplemented: -8,
  unavailableAction: -9,
  deviceAlreadyInitialised: -10,
  deviceAlreadyUnlocked: -11,
  deviceNotReady: -12,
  unknown: -13,
  cancelled: -14,
  deviceBusy: -15,
  needsRoot: -16,
  helpText: -17,
  deviceNotInitialised: -18,
} as const;

export class HwiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'HwiError';
  }
}

export interface HwiDevice {
  /** For example `trezor`, `ledger`, `coldcard`, `bitbox02`, `jade`. */
  type: string;
  /** For example `trezor_t`, `trezor_safe 5`, `ledger_nano_s_plus`. */
  model: string;
  path: string;
  /** The name the user gave the device. Personal data: shown, never logged. */
  label?: string;
  /** Master key fingerprint (8 hex characters); missing while the device is locked. */
  fingerprint?: string;
  needsPinSent: boolean;
  needsPassphraseSent: boolean;
  /** Why HWI could not talk to this device. */
  error?: string;
  code?: number;
}

export interface HwiRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type HwiRunner = (
  args: readonly string[],
  options: { input?: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<HwiRunResult>;

const MAX_OUTPUT = 8 * 1024 * 1024;

/** Runs hwi.exe without a window, optionally feeding it standard input. */
export function processRunner(executable: string): HwiRunner {
  return (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outcome();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => {
          reject(new HwiError(HWI_ERRORS.deviceNotReady, 'The device did not answer in time.'));
        });
      }, options.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > MAX_OUTPUT) child.kill();
      });
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 64 * 1024) stderr += chunk;
      });
      child.once('error', (error) => {
        finish(() => {
          reject(error);
        });
      });
      child.once('close', (exitCode) => {
        finish(() => {
          resolve({ stdout, stderr, exitCode });
        });
      });
      child.stdin.end(options.input ?? '');
    });
}

const FINGERPRINT = /^[0-9a-f]{8}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function checkFingerprint(fingerprint: string): string {
  const value = fingerprint.toLowerCase();
  if (!FINGERPRINT.test(value)) throw new HwiError(HWI_ERRORS.badArgument, 'A device fingerprint is 8 hex characters.');
  return value;
}

function checkDescriptor(descriptor: string): string {
  // Descriptors never contain spaces or control characters; refusing them keeps arguments unambiguous.
  let unsafe = false;
  for (let index = 0; index < descriptor.length; index += 1) unsafe ||= descriptor.charCodeAt(index) <= 0x20;
  if (descriptor.length === 0 || descriptor.length > 4096 || unsafe) {
    throw new HwiError(HWI_ERRORS.badArgument, 'The descriptor is not valid.');
  }
  return descriptor;
}

export interface HwiClientOptions {
  executable: string;
  run?: HwiRunner;
}

export class HwiClient {
  private readonly run: HwiRunner;

  constructor(options: HwiClientOptions) {
    this.run = options.run ?? processRunner(options.executable);
  }

  private async call(
    args: readonly string[],
    options: { input?: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<unknown> {
    const result = await this.run(args, options);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.trim() === '' ? 'null' : result.stdout);
    } catch {
      throw new HwiError(HWI_ERRORS.unknown, `HWI did not answer in JSON (exit code ${String(result.exitCode)}).`);
    }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
      const { error, code } = parsed as { error: unknown; code: unknown };
      throw new HwiError(typeof code === 'number' ? code : HWI_ERRORS.unknown, String(error));
    }
    if (parsed === null) throw new HwiError(HWI_ERRORS.unknown, 'HWI returned nothing.');
    return parsed;
  }

  /** Lists connected devices. HWI briefly opens each one, so a vendor app that holds a device can make it fail. */
  async enumerate(chain: HwiChain, signal?: AbortSignal): Promise<HwiDevice[]> {
    const listed = await this.call(['--chain', chain, 'enumerate'], {
      timeoutMs: 60_000,
      ...(signal ? { signal } : {}),
    });
    if (!Array.isArray(listed)) throw new HwiError(HWI_ERRORS.unknown, 'HWI did not return a list of devices.');
    return listed.flatMap((item): HwiDevice[] => {
      if (item === null || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      const text = (key: string) => (typeof entry[key] === 'string' ? entry[key] : undefined);
      const type = text('type');
      const path = text('path');
      if (type === undefined || path === undefined) return [];
      const fingerprint = text('fingerprint');
      const label = text('label');
      const error = text('error');
      return [
        {
          type,
          model: text('model') ?? type,
          path,
          ...(label === undefined || label === '' ? {} : { label }),
          ...(fingerprint !== undefined && FINGERPRINT.test(fingerprint) ? { fingerprint } : {}),
          needsPinSent: entry['needs_pin_sent'] === true,
          needsPassphraseSent: entry['needs_passphrase_sent'] === true,
          ...(error === undefined ? {} : { error }),
          ...(typeof entry['code'] === 'number' ? { code: entry['code'] } : {}),
        },
      ];
    });
  }

  /** Receive and change descriptors for each address type the device supports, for a watch-only wallet. */
  async getDescriptors(
    fingerprint: string,
    chain: HwiChain,
    account = 0,
    signal?: AbortSignal,
  ): Promise<{ receive: string[]; internal: string[] }> {
    if (!Number.isInteger(account) || account < 0 || account > 1000) {
      throw new HwiError(HWI_ERRORS.badArgument, 'The account number is not valid.');
    }
    const result = (await this.call(
      [
        '--fingerprint',
        checkFingerprint(fingerprint),
        '--chain',
        chain,
        'getdescriptors',
        '--account',
        String(account),
      ],
      { timeoutMs: 180_000, ...(signal ? { signal } : {}) },
    )) as { receive?: unknown; internal?: unknown };
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return { receive: strings(result.receive), internal: strings(result.internal) };
  }

  /** Shows the address on the device, so the user can compare it with the one on screen. */
  async displayAddress(
    fingerprint: string,
    chain: HwiChain,
    descriptor: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = (await this.call(
      [
        '--fingerprint',
        checkFingerprint(fingerprint),
        '--chain',
        chain,
        'displayaddress',
        '--desc',
        checkDescriptor(descriptor),
      ],
      { timeoutMs: 300_000, ...(signal ? { signal } : {}) },
    )) as { address?: unknown };
    if (typeof result.address !== 'string') throw new HwiError(HWI_ERRORS.unknown, 'HWI returned no address.');
    return result.address;
  }

  /**
   * Asks the device to sign a PSBT. Call it only after the user asked for it
   * and reviewed the transaction; the device shows the details and asks for
   * confirmation itself. The PSBT travels on standard input, as Bitcoin Core
   * passes it, because Windows command lines are limited in length.
   */
  async signTx(
    fingerprint: string,
    chain: HwiChain,
    psbt: string,
    signal?: AbortSignal,
  ): Promise<{ psbt: string; signed: boolean }> {
    if (!BASE64.test(psbt) || psbt.length > 4 * 1024 * 1024) {
      throw new HwiError(HWI_ERRORS.invalidTransaction, 'The PSBT is not valid base64.');
    }
    const result = (await this.call(['--stdin', '--fingerprint', checkFingerprint(fingerprint), '--chain', chain], {
      input: `signtx ${psbt}\n`,
      timeoutMs: 600_000,
      ...(signal ? { signal } : {}),
    })) as { psbt?: unknown; signed?: unknown };
    if (typeof result.psbt !== 'string') throw new HwiError(HWI_ERRORS.unknown, 'HWI returned no PSBT.');
    return { psbt: result.psbt, signed: result.signed !== false };
  }
}
