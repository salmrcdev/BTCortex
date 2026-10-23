// Bitcoin networks and their configuration-file section names.
// Sources: Bitcoin Core 31.1 doc/bitcoin-conf.md and chainparamsbase.cpp
// (docs/research/notes/full-nodes-core.md §5.2, §8).

export const BITCOIN_NETWORKS = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const;
export type BitcoinNetwork = (typeof BITCOIN_NETWORKS)[number];

/** Section names accepted in bitcoin.conf (`[main]`, not `[mainnet]`). */
export type ConfigSection = 'main' | 'test' | 'testnet4' | 'signet' | 'regtest';

export interface NetworkParameters {
  network: BitcoinNetwork;
  section: ConfigSection;
  /** Value of `getblockchaininfo.chain`. */
  chainName: 'main' | 'test' | 'testnet4' | 'signet' | 'regtest';
  /** Command-line selector, or `undefined` for mainnet. */
  selector: string | undefined;
  /** Subdirectory of the data directory holding chain-specific files; empty for mainnet. */
  subdirectory: string;
  p2pPort: number;
  rpcPort: number;
  label: string;
  deprecated: boolean;
}

export const NETWORK_PARAMETERS: Record<BitcoinNetwork, NetworkParameters> = {
  mainnet: {
    network: 'mainnet',
    section: 'main',
    chainName: 'main',
    selector: undefined,
    subdirectory: '',
    p2pPort: 8333,
    rpcPort: 8332,
    label: 'Mainnet',
    deprecated: false,
  },
  testnet3: {
    network: 'testnet3',
    section: 'test',
    chainName: 'test',
    selector: '-testnet',
    subdirectory: 'testnet3',
    p2pPort: 18333,
    rpcPort: 18332,
    label: 'Testnet3',
    deprecated: true,
  },
  testnet4: {
    network: 'testnet4',
    section: 'testnet4',
    chainName: 'testnet4',
    selector: '-testnet4',
    subdirectory: 'testnet4',
    p2pPort: 48333,
    rpcPort: 48332,
    label: 'Testnet4',
    deprecated: false,
  },
  signet: {
    network: 'signet',
    section: 'signet',
    chainName: 'signet',
    selector: '-signet',
    subdirectory: 'signet',
    p2pPort: 38333,
    rpcPort: 38332,
    label: 'Signet',
    deprecated: false,
  },
  regtest: {
    network: 'regtest',
    section: 'regtest',
    chainName: 'regtest',
    selector: '-regtest',
    subdirectory: 'regtest',
    p2pPort: 18444,
    rpcPort: 18443,
    label: 'Regtest',
    deprecated: false,
  },
};

export const CONFIG_SECTIONS: readonly ConfigSection[] = ['main', 'test', 'testnet4', 'signet', 'regtest'];

export function isConfigSection(name: string): name is ConfigSection {
  return (CONFIG_SECTIONS as readonly string[]).includes(name);
}

export function networkFromChainName(chain: string): BitcoinNetwork | undefined {
  return BITCOIN_NETWORKS.find((network) => NETWORK_PARAMETERS[network].chainName === chain);
}
