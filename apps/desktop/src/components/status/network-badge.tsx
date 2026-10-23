import { useTranslation } from 'react-i18next';
import type { BitcoinNetworkId } from '@btcortex/contracts';
import { cn } from '@/lib/utils';

// Network identity from design-system/btcortex/MASTER.md: every view states
// which network a node is on, and test networks never look like mainnet.

const NETWORK_CLASSES: Record<BitcoinNetworkId, string> = {
  mainnet: 'border-network-mainnet/50 text-network-mainnet',
  testnet3: 'border-network-testnet/50 text-network-testnet',
  testnet4: 'border-network-testnet/50 text-network-testnet',
  signet: 'border-network-signet/50 text-network-signet',
  regtest: 'border-network-regtest/50 text-network-regtest',
};

export const NETWORK_STRIPE_CLASSES: Record<BitcoinNetworkId, string> = {
  mainnet: '',
  testnet3: 'bg-network-testnet',
  testnet4: 'bg-network-testnet',
  signet: 'bg-network-signet',
  regtest: 'bg-network-regtest',
};

export function NetworkBadge({ network, className }: { network: BitcoinNetworkId; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
        NETWORK_CLASSES[network],
        className,
      )}
    >
      {t(`networks.${network}`)}
    </span>
  );
}
