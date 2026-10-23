import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Interface preferences only. Nothing sensitive is ever stored in WebView
// storage (specification section 3.3): secrets stay in the orchestrator vault.

export type Theme = 'dark' | 'light';
/** "system" follows Windows' light or dark mode for apps. */
export type ThemePreference = 'system' | Theme;
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

interface PreferencesState {
  theme: ThemePreference;
  /** Windows' current mode; not stored, read from the WebView at start and on change. */
  systemTheme: Theme;
  sidebarCollapsed: boolean;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
  setSystemTheme: (theme: Theme) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function currentSystemTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

export function resolveTheme(state: Pick<PreferencesState, 'theme' | 'systemTheme'>): Theme {
  return state.theme === 'system' ? state.systemTheme : state.theme;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      systemTheme: currentSystemTheme(),
      sidebarCollapsed: false,
      setTheme: (theme) => {
        set({ theme });
      },
      toggleTheme: () => {
        set((state) => ({ theme: resolveTheme(state) === 'dark' ? 'light' : 'dark' }));
      },
      setSystemTheme: (systemTheme) => {
        set({ systemTheme });
      },
      setSidebarCollapsed: (sidebarCollapsed) => {
        set({ sidebarCollapsed });
      },
    }),
    {
      name: 'btcortex.preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, sidebarCollapsed }) => ({ theme, sidebarCollapsed }),
    },
  ),
);

/** The theme in effect, with "system" resolved. */
export function useResolvedTheme(): Theme {
  return usePreferences(resolveTheme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Keeps the document's theme in step with the preference and, for "system", with Windows. */
export function followTheme(): () => void {
  const query = window.matchMedia(LIGHT_QUERY);
  const onSystemChange = () => {
    usePreferences.getState().setSystemTheme(query.matches ? 'light' : 'dark');
  };
  query.addEventListener('change', onSystemChange);
  applyTheme(resolveTheme(usePreferences.getState()));
  const unsubscribe = usePreferences.subscribe((state) => {
    applyTheme(resolveTheme(state));
  });
  return () => {
    query.removeEventListener('change', onSystemChange);
    unsubscribe();
  };
}
