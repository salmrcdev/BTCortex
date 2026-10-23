import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { BitcoinConfig, interpretBoolean, resolveEffective, validateConfig } from '@btcortex/bitcoin-config';
import { endpointParts, followsKnotsFork, isLoopbackHost } from '@btcortex/contracts';
import type {
  Alert,
  BackupSettings,
  ElectrumOverview,
  InstalledSoftware,
  LightningConnectionWithStatus,
  NodeConfigDocument,
  NodeWithStatus,
  SecurityControl,
  SecurityFinding,
  SecurityOverview,
  TorStatus,
} from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import { coreVersionFromNumber, coreVersionRisk } from '../nodes/version-risk';
import type { AppPaths } from '../platform/paths';

// The security centre (specification sections 21 and 24.1, area 23): what
// BTCortex can see of the security of everything it runs or connects to,
// gathered from the same sources the other pages use. Nothing is changed
// here; each finding says what to do and where. The checks of this computer
// (firewall, who can read BTCortex's data) need no administrator rights.

const COMPUTER_CHECK_MS = 10 * 60 * 1000;
const LOOPBACK_ADDRESS = /^(127\.\d+\.\d+\.\d+|::1|\[::1\]|localhost)$/i;
const EVERYWHERE = new Set(['0.0.0.0/0', '::/0', '0.0.0.0', '::']);
/** What tor's directory authorities call a version that is fine to run. */
const RECOMMENDED_TOR = new Set(['recommended', 'new', 'new in series', 'up to date']);

const execFileAsync = promisify(execFile);

const COMPUTER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$firewall = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; enabled = ([string]$_.Enabled -eq "True") } })',
  '$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  "$allowed = @('S-1-5-18', 'S-1-5-32-544', 'S-1-3-0', 'S-1-3-4', $me)",
  '$others = @((Get-Acl -LiteralPath $env:BTCORTEX_ROOT).Access | Where-Object { [string]$_.AccessControlType -eq "Allow" } | ForEach-Object { $rule = $_; try { $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $sid = [string]$rule.IdentityReference }; if ($allowed -notcontains $sid) { [string]$rule.IdentityReference } } | Select-Object -Unique)',
  'ConvertTo-Json -Compress -Depth 3 @{ firewall = $firewall; others = $others }',
].join('; ');

const ComputerSchema = z.object({
  firewall: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
  others: z.array(z.string()),
});
export type ComputerFacts = z.infer<typeof ComputerSchema>;

async function checkComputer(root: string): Promise<ComputerFacts | undefined> {
  if (process.platform !== 'win32') return undefined;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', COMPUTER_SCRIPT],
    {
      windowsHide: true,
      timeout: 30_000,
      // The path travels in the environment, never inside the script.
      env: { ...process.env, BTCORTEX_ROOT: root },
    },
  );
  return ComputerSchema.parse(JSON.parse(stdout));
}

/** The controls BTCortex itself applies (docs/SECURITY_MODEL.md). */
export const CONTROLS: readonly SecurityControl[] = [
  {
    id: 'verified-downloads',
    title: 'Verified downloads',
    detail:
      'Every program is installed only after its publishers’ signatures over its checksums, the checksum of the download and, where published, its Windows signature have been checked.',
    state: 'active',
  },
  {
    id: 'secret-vault',
    title: 'Secrets protected by Windows',
    detail:
      'Passwords, macaroons and keys are kept encrypted with Windows DPAPI for your account and never reach the window; logs and diagnostics are redacted.',
    state: 'active',
  },
  {
    id: 'loopback',
    title: 'Interfaces on this computer only',
    detail:
      'Nodes, Electrum servers and tor that BTCortex sets up listen on this computer only; other devices reach them only through Tor, and only when you allow it. BTCortex opens no firewall ports.',
    state: 'active',
  },
  {
    id: 'window-boundary',
    title: 'A narrow window boundary',
    detail:
      'The window may only show dialogs and notifications and open HTTPS links; every request to the background service is checked against a list of allowed methods, and dangerous ones need a confirmation.',
    state: 'active',
  },
  {
    id: 'confirmations',
    title: 'Confirmed changes',
    detail:
      'Changes that expose a node, run commands, delete data, move funds or change what the network can learn about you are explained and confirmed first.',
    state: 'active',
  },
  {
    id: 'signed-releases',
    title: 'Signed BTCortex releases',
    detail: 'BTCortex’s own installer and updates are not code-signed yet.',
    state: 'planned',
  },
  {
    id: 'dependency-audit',
    title: 'Dependency auditing',
    detail: 'Automatic checks of BTCortex’s own dependencies for known vulnerabilities are not in place yet.',
    state: 'planned',
  },
];

export interface SecurityServiceOptions {
  nodes: () => NodeWithStatus[];
  config: { get(nodeId: string): Promise<NodeConfigDocument> };
  tor: () => Promise<TorStatus>;
  electrum: () => Promise<ElectrumOverview>;
  lightning: () => LightningConnectionWithStatus[];
  installations: () => Promise<InstalledSoftware[]>;
  secrets: () => { purpose: string }[];
  backups: () => BackupSettings;
  alerts: () => Alert[];
  paths: Pick<AppPaths, 'root'>;
  logger: Logger;
  now?: () => Date;
  /** For tests. */
  computer?: (root: string) => Promise<ComputerFacts | undefined>;
}

export class SecurityService {
  private computerCache: { at: number; value: ComputerFacts | undefined } | undefined;

  constructor(private readonly options: SecurityServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async overview(): Promise<SecurityOverview> {
    const findings: SecurityFinding[] = [];
    const add = (finding: SecurityFinding) => findings.push(finding);
    for (const node of this.options.nodes()) await this.nodeFindings(node, add);
    await this.serviceFindings(add);
    await this.softwareFindings(add);
    this.secretFindings(add);
    await this.computerFindings(add);

    const order = { critical: 0, warning: 1, info: 2, ok: 3 } as const;
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    const count = (severity: SecurityFinding['severity']) =>
      findings.filter((finding) => finding.severity === severity).length;
    return {
      checkedAt: this.now().toISOString(),
      counts: { critical: count('critical'), warning: count('warning'), info: count('info'), ok: count('ok') },
      findings,
      controls: [...CONTROLS],
    };
  }

  private async nodeFindings(node: NodeWithStatus, add: (finding: SecurityFinding) => void): Promise<void> {
    const { profile, status } = node;
    const subject = profile.name;
    const route = `/nodes/${profile.id}`;
    const configuration = `/nodes/${profile.id}/configuration`;

    // How BTCortex signs in.
    const host = endpointParts(profile.rpcEndpoint).hostname;
    if (profile.authentication.kind === 'cookie') {
      add({
        id: `node.cookie:${profile.id}`,
        area: 'nodes',
        severity: 'ok',
        subject,
        title: 'BTCortex signs in with the cookie file',
        detail: 'No password is stored: Bitcoin Core writes a new cookie each time it starts.',
        action: null,
        route,
      });
    } else if (!isLoopbackHost(host) && profile.rpcEndpoint.startsWith('http://')) {
      add({
        id: `node.plain-http:${profile.id}`,
        area: 'nodes',
        severity: 'warning',
        subject,
        title: 'The RPC password travels unencrypted',
        detail: `BTCortex reaches ${host} over plain HTTP on the local network, so anyone on that network can read the password and every answer.`,
        action: 'Reach the node through an encrypted tunnel, or through Tor.',
        route,
      });
    }

    // The running version (docs/research/notes/full-nodes-core.md §11, version-warning matrix).
    const number = status.snapshot?.network.version;
    const knots =
      profile.implementation === 'bitcoin-knots' || (status.snapshot?.network.subversion.includes('Knots') ?? false);
    const risk = number === undefined || knots ? undefined : coreVersionRisk(coreVersionFromNumber(number));
    if (followsKnotsFork(node)) {
      // A Knots node BTCortex set up was set up only after the user agreed to its chain.
      const agreed = profile.execution === 'managed' && profile.implementation === 'bitcoin-knots';
      add({
        id: `node.other-chain:${profile.id}`,
        area: 'nodes',
        severity: agreed ? 'info' : profile.network === 'mainnet' ? 'critical' : 'warning',
        subject,
        title: 'A node on another chain',
        detail:
          'This Bitcoin Knots enforces rules Bitcoin Core does not — the BIP110 softfork and, from mainnet block 961,640, a BLAKE2b proof of work — so it follows a chain Bitcoin Core rejects. Wallets, Electrum servers and payment services connected to it see that chain, and coins received there may not exist for Bitcoin Core nodes.',
        action: 'Connect wallets and payments to a Bitcoin Core node, unless following this chain is what you want.',
        route,
      });
    }
    if (risk) {
      add({
        id: `node.version:${profile.id}`,
        area: 'nodes',
        severity: risk.severity,
        subject,
        title: 'An outdated Bitcoin Core',
        detail: risk.reason,
        action:
          profile.execution === 'managed'
            ? 'Move the node to the current release on the Updates page.'
            : 'Update Bitcoin Core with the program that installed it.',
        route: profile.execution === 'managed' ? '/updates' : route,
      });
    }

    // The configuration, where its file is on this computer.
    let document: NodeConfigDocument | undefined;
    try {
      document = await this.options.config.get(profile.id);
    } catch {
      document = undefined;
    }
    if (!document?.exists) return;
    const config = BitcoinConfig.parse(document.text);
    const effective = resolveEffective(config, profile.network);
    const diagnostics = validateConfig(config, {
      network: profile.network,
      windows: process.platform === 'win32',
      managed: profile.execution === 'managed',
    });
    const exposure = diagnostics.filter((diagnostic) => diagnostic.code === 'rpc-exposed');
    if (exposure.length === 0) {
      add({
        id: `node.rpc-local:${profile.id}`,
        area: 'nodes',
        severity: 'ok',
        subject,
        title: 'RPC answers this computer only',
        detail: 'Neither rpcbind nor rpcallowip lets other computers reach the interface that controls the node.',
        action: null,
        route: configuration,
      });
    } else {
      const everywhere = (effective.get('rpcallowip')?.values ?? []).some((entry) => EVERYWHERE.has(entry));
      add({
        id: `node.rpc-exposed:${profile.id}`,
        area: 'nodes',
        severity: everywhere ? 'critical' : 'warning',
        subject,
        title: everywhere ? 'RPC is open to any address' : 'RPC is reachable from other computers',
        detail: exposure.map((diagnostic) => diagnostic.message).join(' '),
        action: 'Remove the non-local rpcbind and rpcallowip entries, or use an encrypted tunnel instead.',
        route: configuration,
      });
    }
    if (diagnostics.some((diagnostic) => diagnostic.code === 'rest-enabled')) {
      add({
        id: `node.rest:${profile.id}`,
        area: 'nodes',
        severity: 'warning',
        subject,
        title: 'The REST interface is on',
        detail: 'It needs no authentication, and web pages open in a browser on this computer can read it.',
        action: 'Turn rest off unless a program needs it.',
        route: configuration,
      });
    }
    const commands = diagnostics.filter((diagnostic) => diagnostic.code === 'executes-commands');
    if (commands.length > 0) {
      add({
        id: `node.commands:${profile.id}`,
        area: 'nodes',
        severity: 'info',
        subject,
        title: 'The node runs commands on events',
        detail: `${commands.map((diagnostic) => diagnostic.key ?? '').join(', ')} run a command on this computer whenever the event occurs.`,
        action: 'Make sure you know and trust each command.',
        route: configuration,
      });
    }
    if (diagnostics.some((diagnostic) => diagnostic.code === 'plaintext-password')) {
      add({
        id: `node.rpcpassword:${profile.id}`,
        area: 'nodes',
        severity: 'warning',
        subject,
        title: 'A password in plain text in bitcoin.conf',
        detail: 'rpcpassword keeps the password readable by anyone who can read the file, and turns the cookie off.',
        action: 'Use rpcauth, which keeps only a salted hash, or the cookie file.',
        route: configuration,
      });
    }
    const publishers = [...effective.entries()]
      .filter(([key]) => key.startsWith('zmqpub'))
      .flatMap(([key, value]) =>
        value.values
          .filter((address) => {
            try {
              return !LOOPBACK_ADDRESS.test(new URL(address).hostname);
            } catch {
              return false;
            }
          })
          .map((address) => `${key}=${address}`),
      );
    if (publishers.length > 0) {
      add({
        id: `node.zmq:${profile.id}`,
        area: 'nodes',
        severity: 'warning',
        subject,
        title: 'Block and transaction notifications go to the network',
        detail: `${publishers.join(', ')} publishes to other computers without authentication.`,
        action: 'Bind ZMQ publishers to 127.0.0.1 unless another computer needs them.',
        route: configuration,
      });
    }
    const switchOn = (key: string) => {
      const value = effective.get(key);
      return (
        value !== undefined && value.lines.length > 0 && !value.negated && interpretBoolean(value.values[0] ?? '0')
      );
    };
    if (switchOn('natpmp') || switchOn('upnp')) {
      add({
        id: `node.port-mapping:${profile.id}`,
        area: 'nodes',
        severity: 'info',
        subject,
        title: 'The router is asked to forward the node’s port',
        detail:
          'Port mapping makes the node reachable from the internet, which helps the network but shows that this address runs Bitcoin.',
        action: null,
        route: configuration,
      });
    }
  }

  private async serviceFindings(add: (finding: SecurityFinding) => void): Promise<void> {
    const tor = await this.options.tor().catch(() => undefined);
    if (tor?.installed) {
      const status = tor.versionStatus;
      if (status !== null && !RECOMMENDED_TOR.has(status)) {
        add({
          id: 'tor.version',
          area: 'tor',
          severity: status === 'obsolete' || status === 'unrecommended' ? 'warning' : 'info',
          subject: 'Tor',
          title: 'The Tor network does not recommend this tor',
          detail: `The directory authorities rate tor ${tor.installed.torVersion ?? tor.installed.version} as "${status}".`,
          action: 'Update tor on the Installed software page.',
          route: '/software',
        });
      } else {
        add({
          id: 'tor.local',
          area: 'tor',
          severity: 'ok',
          subject: 'Tor',
          title: 'tor listens on this computer only',
          detail: 'Its SOCKS and control ports are on loopback, and the control port needs tor’s cookie.',
          action: null,
          route: '/tor',
        });
      }
    }

    const electrum = await this.options.electrum().catch(() => undefined);
    for (const server of electrum?.servers ?? []) {
      if (server.state === 'not-set-up') continue;
      add(
        server.remoteAccess.enabled
          ? {
              id: `electrum.onion:${server.nodeId}`,
              area: 'electrum',
              severity: 'info',
              subject: `Electrum server of ${server.nodeName}`,
              title: 'Reachable through Tor',
              detail:
                'Anyone who knows its onion address can use the server; it never learns more than the wallets ask.',
              action: 'Turn remote access off when no other device needs it.',
              route: '/electrum',
            }
          : {
              id: `electrum.local:${server.nodeId}`,
              area: 'electrum',
              severity: 'ok',
              subject: `Electrum server of ${server.nodeName}`,
              title: 'Answers this computer only',
              detail: 'Its Electrum, administration and statistics ports are on loopback, with peering off.',
              action: null,
              route: '/electrum',
            },
      );
    }

    for (const { connection, status } of this.options.lightning()) {
      const subject = `Lightning (${status.alias ?? connection.name})`;
      const route = `/lightning?connection=${connection.id}`;
      if (connection.macaroon.access === 'admin' || connection.macaroon.access === 'custom') {
        add({
          id: `lightning.macaroon:${connection.id}`,
          area: 'lightning',
          severity: 'warning',
          subject,
          title: 'BTCortex holds a macaroon that can move funds',
          detail: 'It only reads the node, so the read-only macaroon would do.',
          action: 'Connect again with readonly.macaroon.',
          route,
        });
      } else {
        add({
          id: `lightning.readonly:${connection.id}`,
          area: 'lightning',
          severity: 'ok',
          subject,
          title: 'A read-only macaroon',
          detail: 'BTCortex can read the node but cannot change it or move its funds.',
          action: null,
          route,
        });
      }
      if (connection.certificateFingerprint === null) {
        add({
          id: `lightning.certificate:${connection.id}`,
          area: 'lightning',
          severity: 'info',
          subject,
          title: 'The certificate is not pinned',
          detail: 'BTCortex trusts the certificate authorities of Windows for this node instead of one certificate.',
          action: null,
          route,
        });
      }
    }

    const backups = (() => {
      try {
        return this.options.backups();
      } catch {
        return undefined;
      }
    })();
    if (backups) {
      if (backups.destination === null) {
        add({
          id: 'backups.none',
          area: 'backups',
          severity: 'warning',
          subject: 'Backups',
          title: 'No backup folder chosen',
          detail: 'Configuration, wallets and channel backups are not copied anywhere.',
          action: 'Choose a backup folder, ideally on another disk.',
          route: '/backups',
        });
      } else if (backups.lastRun?.outcome === 'succeeded') {
        add({
          id: 'backups.ok',
          area: 'backups',
          severity: 'ok',
          subject: 'Backups',
          title: 'Backed up',
          detail: `The last backup was made ${backups.lastRun.at.slice(0, 10)}.`,
          action: null,
          route: '/backups',
        });
      }
    }

    for (const alert of this.options.alerts().filter((candidate) => candidate.rule === 'config.changed')) {
      add({
        id: `alert:${alert.id}`,
        area: 'nodes',
        severity: alert.severity === 'warning' ? 'warning' : 'info',
        subject: alert.component,
        title: alert.title,
        detail: alert.message,
        action: alert.severity === 'warning' ? 'If you did not make this change, look at the file now.' : null,
        route: alert.route,
      });
    }
  }

  private async softwareFindings(add: (finding: SecurityFinding) => void): Promise<void> {
    const software = await this.options.installations().catch(() => []);
    if (software.length === 0) return;
    const short = software.filter((entry) => entry.signatures.valid < entry.signatures.required);
    const unrecorded = software.filter((entry) => !entry.integrityRecorded);
    add(
      short.length > 0
        ? {
            id: 'software.signatures',
            area: 'software',
            severity: 'critical',
            subject: 'Installed software',
            title: 'A program without enough valid signatures',
            detail: short.map((entry) => `${entry.product} ${entry.version}`).join(', '),
            action: 'Remove it and install it again on the Installed software page.',
            route: '/software',
          }
        : {
            id: 'software.verified',
            area: 'software',
            severity: 'ok',
            subject: 'Installed software',
            title: 'Every program BTCortex installed was verified',
            detail: `${String(software.length)} ${software.length === 1 ? 'version carries' : 'versions carry'} the signatures their publishers require.`,
            action: null,
            route: '/software',
          },
    );
    if (unrecorded.length > 0) {
      add({
        id: 'software.integrity',
        area: 'software',
        severity: 'info',
        subject: 'Installed software',
        title: 'Some programs cannot be checked for changes',
        detail: `No file hashes were recorded when ${unrecorded.map((entry) => `${entry.product} ${entry.version}`).join(', ')} ${unrecorded.length === 1 ? 'was' : 'were'} installed.`,
        action: 'Install them again to record their hashes.',
        route: '/software',
      });
    }
  }

  private secretFindings(add: (finding: SecurityFinding) => void): void {
    const secrets = this.options.secrets();
    add({
      id: 'secrets.vault',
      area: 'secrets',
      severity: 'ok',
      subject: 'BTCortex’s vault',
      title: secrets.length === 0 ? 'No secrets stored' : 'Secrets protected by Windows',
      detail:
        secrets.length === 0
          ? 'BTCortex holds no passwords, macaroons or keys.'
          : `${String(secrets.length)} ${secrets.length === 1 ? 'secret is' : 'secrets are'} encrypted with Windows DPAPI for your account; none ever reaches the window.`,
      action: null,
      route: null,
    });
  }

  private async computer(): Promise<ComputerFacts | undefined> {
    const now = this.now().getTime();
    if (this.computerCache && now - this.computerCache.at < COMPUTER_CHECK_MS) return this.computerCache.value;
    let value: ComputerFacts | undefined;
    try {
      value = await (this.options.computer ?? checkComputer)(this.options.paths.root);
    } catch (error) {
      this.options.logger.debug('Could not check the firewall and the data folder', { error });
      value = undefined;
    }
    this.computerCache = { at: now, value };
    return value;
  }

  private async computerFindings(add: (finding: SecurityFinding) => void): Promise<void> {
    const facts = await this.computer();
    if (!facts) return;
    const off = facts.firewall.filter((profile) => !profile.enabled).map((profile) => profile.name);
    add(
      off.length > 0
        ? {
            id: 'computer.firewall',
            area: 'computer',
            severity: 'warning',
            subject: 'This computer',
            title: 'Windows Firewall is off',
            detail: `It is off for the ${off.join(', ')} ${off.length === 1 ? 'profile' : 'profiles'}.`,
            action: 'Turn it on in Windows Security.',
            route: null,
          }
        : {
            id: 'computer.firewall',
            area: 'computer',
            severity: 'ok',
            subject: 'This computer',
            title: 'Windows Firewall is on',
            detail: 'It is on for every network profile; BTCortex opens no ports in it.',
            action: null,
            route: null,
          },
    );
    add(
      facts.others.length > 0
        ? {
            id: 'computer.data-folder',
            area: 'computer',
            severity: 'warning',
            subject: 'This computer',
            title: 'Others can read BTCortex’s data',
            detail: `${facts.others.join(', ')} ${facts.others.length === 1 ? 'has' : 'have'} access to ${this.options.paths.root}.`,
            action: 'Remove their access in the folder’s security settings.',
            route: null,
          }
        : {
            id: 'computer.data-folder',
            area: 'computer',
            severity: 'ok',
            subject: 'This computer',
            title: 'Only you can read BTCortex’s data',
            detail: 'Apart from your account, only Windows itself and administrators have access to its folder.',
            action: null,
            route: null,
          },
    );
  }
}
