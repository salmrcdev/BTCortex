// What the Lightning page keeps in the address: the chosen connection and tab.

export const LIGHTNING_TABS = ['overview', 'channels', 'peers', 'payments', 'routing'] as const;
export type LightningTab = (typeof LIGHTNING_TABS)[number];

export interface LightningSearch {
  connection?: string;
  tab?: LightningTab;
}
