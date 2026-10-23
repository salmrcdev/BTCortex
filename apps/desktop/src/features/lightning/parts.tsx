import type { TFunction } from 'i18next';
import type { BitcoinNetworkId, LightningNetwork, LightningStatus, MacaroonAccess } from '@btcortex/contracts';
import { NetworkBadge } from '@/components/status/network-badge';
import type { StatusTone } from '@/components/status/status-indicator';
import { formatNumber, truncateMiddle } from '@/lib/format';

// Small pieces the Lightning views share.

const NETWORK_IDS: Record<LightningNetwork, BitcoinNetworkId> = {
  mainnet: 'mainnet',
  testnet: 'testnet3',
  testnet4: 'testnet4',
  signet: 'signet',
  regtest: 'regtest',
  // btcd's private test network; it looks like regtest.
  simnet: 'regtest',
};

export function LightningNetworkBadge({ network }: { network: LightningNetwork }) {
  return <NetworkBadge network={NETWORK_IDS[network]} />;
}

export function lightningState(status: LightningStatus, t: TFunction): { tone: StatusTone; label: string } {
  const label = t(`lightning.state.${status.state}`);
  switch (status.state) {
    case 'checking':
      return { tone: 'working', label };
    case 'ready':
      return { tone: 'healthy', label };
    case 'syncing':
      return { tone: 'working', label };
    case 'locked':
      return { tone: 'attention', label };
    case 'unreachable':
      return { tone: 'failed', label };
    case 'unauthorised':
      return { tone: 'failed', label };
    case 'failed':
      return { tone: 'failed', label };
  }
}

/** Safe macaroons look calm; one that can move funds stands out. */
export function accessVariant(access: MacaroonAccess): 'success' | 'warning' | 'outline' {
  if (access === 'read-only') return 'success';
  if (access === 'admin') return 'warning';
  return 'outline';
}

/** Millisatoshis as satoshis, keeping the fraction LND reports, for example "1.025 sats". */
export function formatMsat(msat: number): string {
  const sats = msat / 1000;
  return `${formatNumber(sats, { maximumFractionDigits: 3 })} ${sats === 1 ? 'sat' : 'sats'}`;
}

/** A peer by its alias when known, otherwise by its shortened public key. */
export function PeerName({ alias, pubkey }: { alias: string | null; pubkey: string }) {
  return (
    <span title={pubkey} className={alias === null ? 'font-mono text-[13px]' : undefined}>
      {alias ?? truncateMiddle(pubkey, 8, 8)}
    </span>
  );
}
