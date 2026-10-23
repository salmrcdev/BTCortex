import { create } from 'zustand';

// Which application-wide overlay is open: the command palette or the list of
// keyboard shortcuts. One at a time; opening one closes the other.

export type Overlay = 'palette' | 'shortcuts';

interface OverlayState {
  open: Overlay | null;
  show: (overlay: Overlay) => void;
  toggle: (overlay: Overlay) => void;
  close: () => void;
}

export const useOverlays = create<OverlayState>()((set) => ({
  open: null,
  show: (open) => {
    set({ open });
  },
  toggle: (overlay) => {
    set((state) => ({ open: state.open === overlay ? null : overlay }));
  },
  close: () => {
    set({ open: null });
  },
}));
