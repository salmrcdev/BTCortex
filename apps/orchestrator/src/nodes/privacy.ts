import {
  BitcoinConfig,
  effectiveScalar,
  interpretBoolean,
  resolveEffective,
  setOption,
} from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { I2P_SAM_ADDRESS } from '@btcortex/contracts';
import type { NodePrivacyChange, NodeTorMode, TorPorts } from '@btcortex/contracts';

// How a node routes through BTCortex's tor, read from and written to its
// bitcoin.conf (privacy-networking.md §2.17 and §2.21, Bitcoin Core's
// doc/tor.md). Each mode is a fixed set of the options below and nothing
// else, so a configuration either matches one of them exactly or is shown as
// custom; choosing a mode rewrites only these options.
//
// - `onion-peers`: `onion=` sends only onion connections through Tor.
// - `all-traffic`: `proxy=` sends every connection through Tor, and name
//   lookups too (Bitcoin Core takes the DNS proxy from -proxy, not -onion).
// - `tor-only`: `proxy=` plus `onlynet=onion`.
// Every Tor mode also sets `onion=` explicitly: without it, Bitcoin Core asks
// tor's control port for a SOCKS port and falls back to 127.0.0.1:9050, which
// may be another program's tor, whenever tor reports none.
// - The onion service: `listen=1`, `listenonion=1`, `torcontrol=` on
//   BTCortex's control port and one `bind=127.0.0.1:<port>=onion`, so that
//   nothing listens on the network itself (no firewall prompt) and only Tor
//   reaches the node; `discover=0` stops it from also announcing this
//   computer's own addresses.
// - I2P, alongside any of the modes: `i2psam=` on the SAM bridge of the I2P
//   router on this computer and `i2pacceptincoming=0`, so that every outgoing
//   I2P connection uses a new, short-lived I2P address (Bitcoin Core's
//   doc/i2p.md); with `tor-only`, `onlynet=i2p` joins `onlynet=onion`.

export const PRIVACY_KEYS = [
  'proxy',
  'onion',
  'onlynet',
  'listen',
  'listenonion',
  'torcontrol',
  'bind',
  'discover',
  'privatebroadcast',
  'i2psam',
  'i2pacceptincoming',
] as const;

/** Bitcoin Core's default onion service target port per network (chainparamsbase.cpp). */
export const DEFAULT_ONION_PORTS: Record<BitcoinNetwork, number> = {
  mainnet: 8334,
  testnet3: 18335,
  testnet4: 48335,
  signet: 38334,
  regtest: 18445,
};

export interface TorEndpoints {
  /** SOCKS endpoint for nodes, for example 127.0.0.1:9050. */
  socks: string;
  /** Control endpoint, for example 127.0.0.1:9054. */
  control: string;
}

export function torEndpoints(ports: TorPorts): TorEndpoints {
  return { socks: `127.0.0.1:${String(ports.socks)}`, control: `127.0.0.1:${String(ports.control)}` };
}

export interface ConfiguredPrivacy {
  mode: NodeTorMode;
  /** `null`: listening is set up in a way BTCortex did not. */
  onionService: boolean | null;
  /** The local port of the onion service, when one is set up the way BTCortex does it. */
  onionPort: number | undefined;
  privateBroadcast: boolean;
  /** The configuration sends something to BTCortex's tor. */
  usesTor: boolean;
  /** I2P peers through the router on this computer, set up the way BTCortex does it. */
  i2p: boolean;
}

const ONION_BIND = /^127\.0\.0\.1:(\d{1,5})=onion$/;

export function configuredPrivacy(text: string, network: BitcoinNetwork, tor: TorEndpoints): ConfiguredPrivacy {
  const effective = resolveEffective(BitcoinConfig.parse(text), network);
  const scalar = (key: string) => (effective.get(key)?.negated ? undefined : effectiveScalar(effective, key)?.trim());
  const list = (key: string) => (effective.get(key)?.negated ? [] : (effective.get(key)?.values ?? []));
  const flag = (key: string, fallback: boolean) => {
    const value = effectiveScalar(effective, key);
    return value === undefined ? fallback : interpretBoolean(value);
  };

  const proxy = scalar('proxy');
  const onion = scalar('onion');
  const i2psam = scalar('i2psam');
  const i2p = i2psam === I2P_SAM_ADDRESS && !flag('i2pacceptincoming', true);
  // With I2P set up, onlynet=i2p belongs to it rather than to the Tor mode.
  const onlynet = list('onlynet')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => !(i2p && value === 'i2p'));
  const ours = (value: string | undefined) => value === tor.socks;
  const onionOrNone = onion === undefined || ours(onion);
  let mode: NodeTorMode = 'custom';
  // I2P set up another way makes the whole routing one BTCortex did not set up.
  if (i2psam !== undefined && !i2p) mode = 'custom';
  else if (proxy === undefined && onion === undefined && onlynet.length === 0) mode = 'off';
  else if (proxy === undefined && ours(onion) && onlynet.length === 0) mode = 'onion-peers';
  else if (ours(proxy) && onionOrNone && onlynet.length === 0) mode = 'all-traffic';
  else if (ours(proxy) && onionOrNone && onlynet.length === 1 && onlynet[0] === 'onion') mode = 'tor-only';

  // Bitcoin Core listens by default unless a proxy is set; BTCortex always writes listen explicitly.
  const listen = flag('listen', proxy === undefined);
  const torcontrol = scalar('torcontrol');
  const binds = list('bind').map((value) => value.trim());
  const onionBind = binds.length === 1 ? ONION_BIND.exec(binds[0] ?? '') : null;
  let onionService: boolean | null = null;
  if (listen && flag('listenonion', true) && torcontrol === tor.control && onionBind && !flag('discover', true)) {
    onionService = true;
  } else if (!listen && binds.length === 0 && (torcontrol === undefined || torcontrol === tor.control)) {
    onionService = false;
  }

  return {
    mode,
    onionService,
    onionPort: onionService && onionBind ? Number(onionBind[1]) : undefined,
    privateBroadcast: flag('privatebroadcast', false),
    usesTor: ours(proxy) || ours(onion) || torcontrol === tor.control,
    i2p,
  };
}

/**
 * The configuration text with the change applied. `onionPort` is the local
 * port for the onion service, chosen by the caller so that it is free; I2P
 * stays as it is when the change leaves it out.
 */
export function applyPrivacy(
  text: string,
  network: BitcoinNetwork,
  change: NodePrivacyChange,
  tor: TorEndpoints,
  onionPort: number,
): string {
  let next = text;
  const set = (key: (typeof PRIVACY_KEYS)[number], values: readonly string[] | undefined) => {
    next = setOption(next, key, values, network);
  };
  const i2p = change.i2p ?? configuredPrivacy(text, network, tor).i2p;
  set('proxy', change.mode === 'all-traffic' || change.mode === 'tor-only' ? [tor.socks] : undefined);
  set('onion', change.mode === 'off' ? undefined : [tor.socks]);
  set('onlynet', change.mode === 'tor-only' ? ['onion', ...(i2p ? ['i2p'] : [])] : undefined);
  set('i2psam', i2p ? [I2P_SAM_ADDRESS] : undefined);
  set('i2pacceptincoming', i2p ? ['0'] : undefined);
  // An onion service needs Bitcoin Core to use Tor; with `off` there is none.
  if (change.onionService && change.mode !== 'off') {
    set('listen', ['1']);
    set('listenonion', ['1']);
    set('torcontrol', [tor.control]);
    set('bind', [`127.0.0.1:${String(onionPort)}=onion`]);
    set('discover', ['0']);
  } else {
    // BTCortex's default for nodes it sets up: no incoming connections.
    set('listen', ['0']);
    set('listenonion', undefined);
    set('torcontrol', undefined);
    set('bind', undefined);
    set('discover', undefined);
  }
  set('privatebroadcast', change.privateBroadcast && change.mode !== 'off' ? ['1'] : undefined);
  return next;
}
