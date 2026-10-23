import {
  Activity,
  ArchiveRestore,
  BookOpen,
  Blocks,
  Code,
  DatabaseZap,
  GlobeLock,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Layers,
  LayoutGrid,
  Network,
  PackageCheck,
  RefreshCcwDot,
  Router,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Store,
  Wallet,
  Workflow,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavigationItem {
  to:
    | '/'
    | '/catalogue'
    | '/services'
    | '/profiles'
    | '/nodes'
    | '/explorer'
    | '/wallets'
    | '/electrum'
    | '/lightning'
    | '/payments'
    | '/hardware'
    | '/tor'
    | '/topology'
    | '/remote'
    | '/developer'
    | '/software'
    | '/updates'
    | '/monitoring'
    | '/storage'
    | '/backups'
    | '/logs'
    | '/security'
    | '/settings'
    | '/help';
  labelKey:
    | 'navigation.overview'
    | 'navigation.catalogue'
    | 'navigation.services'
    | 'navigation.profiles'
    | 'navigation.nodes'
    | 'navigation.electrum'
    | 'navigation.explorer'
    | 'navigation.wallets'
    | 'navigation.lightning'
    | 'navigation.payments'
    | 'navigation.hardware'
    | 'navigation.tor'
    | 'navigation.topology'
    | 'navigation.remote'
    | 'navigation.developer'
    | 'navigation.software'
    | 'navigation.updates'
    | 'navigation.monitoring'
    | 'navigation.storage'
    | 'navigation.backups'
    | 'navigation.logs'
    | 'navigation.security'
    | 'navigation.settings'
    | 'navigation.help';
  icon: LucideIcon;
}

export interface NavigationGroup {
  labelKey: 'navigation.groupGeneral' | 'navigation.groupBitcoin' | 'navigation.groupSystem';
  items: NavigationItem[];
}

// Only areas with real functionality appear here (specification section 24.1).
export const NAVIGATION: NavigationGroup[] = [
  {
    labelKey: 'navigation.groupGeneral',
    items: [
      { to: '/', labelKey: 'navigation.overview', icon: LayoutDashboard },
      { to: '/catalogue', labelKey: 'navigation.catalogue', icon: LayoutGrid },
      { to: '/services', labelKey: 'navigation.services', icon: Workflow },
      { to: '/profiles', labelKey: 'navigation.profiles', icon: Layers },
    ],
  },
  {
    labelKey: 'navigation.groupBitcoin',
    items: [
      { to: '/nodes', labelKey: 'navigation.nodes', icon: Server },
      { to: '/explorer', labelKey: 'navigation.explorer', icon: Blocks },
      { to: '/wallets', labelKey: 'navigation.wallets', icon: Wallet },
      { to: '/electrum', labelKey: 'navigation.electrum', icon: DatabaseZap },
      { to: '/lightning', labelKey: 'navigation.lightning', icon: Zap },
      { to: '/payments', labelKey: 'navigation.payments', icon: Store },
      { to: '/hardware', labelKey: 'navigation.hardware', icon: KeyRound },
      { to: '/tor', labelKey: 'navigation.tor', icon: GlobeLock },
      { to: '/topology', labelKey: 'navigation.topology', icon: Network },
      { to: '/remote', labelKey: 'navigation.remote', icon: Router },
      { to: '/developer', labelKey: 'navigation.developer', icon: Code },
    ],
  },
  {
    labelKey: 'navigation.groupSystem',
    items: [
      { to: '/software', labelKey: 'navigation.software', icon: PackageCheck },
      { to: '/updates', labelKey: 'navigation.updates', icon: RefreshCcwDot },
      { to: '/monitoring', labelKey: 'navigation.monitoring', icon: Activity },
      { to: '/storage', labelKey: 'navigation.storage', icon: HardDrive },
      { to: '/logs', labelKey: 'navigation.logs', icon: ScrollText },
      { to: '/backups', labelKey: 'navigation.backups', icon: ArchiveRestore },
      { to: '/security', labelKey: 'navigation.security', icon: ShieldCheck },
      { to: '/settings', labelKey: 'navigation.settings', icon: Settings },
      { to: '/help', labelKey: 'navigation.help', icon: BookOpen },
    ],
  },
];
