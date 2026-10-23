// The developer tools' tabs, kept in the address.

export const DEVELOPER_TABS = [
  'decode',
  'uri',
  'coins',
  'convert',
  'features',
  'events',
  'testnets',
  'endpoints',
] as const;
export type DeveloperTab = (typeof DEVELOPER_TABS)[number];
