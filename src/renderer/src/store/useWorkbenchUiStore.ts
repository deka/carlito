import { create } from 'zustand';

export type SidebarView = 'explorer' | 'search';

interface WorkbenchUiState {
  sidebarVisible: boolean;
  sidebarView: SidebarView;
  toggleSidebar: () => void;
  showSidebar: () => void;
  hideSidebar: () => void;
  /** Shows the sidebar on `view`. */
  showSidebarView: (view: SidebarView) => void;
  /** Activity bar behaviour: hides the sidebar when `view` is already shown, else switches to it. */
  toggleSidebarView: (view: SidebarView) => void;
}

export const useWorkbenchUiStore = create<WorkbenchUiState>((set) => ({
  sidebarVisible: true,
  sidebarView: 'explorer',
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  showSidebar: () => set({ sidebarVisible: true }),
  hideSidebar: () => set({ sidebarVisible: false }),
  showSidebarView: (view) => set({ sidebarVisible: true, sidebarView: view }),
  toggleSidebarView: (view) =>
    set((state) =>
      state.sidebarVisible && state.sidebarView === view
        ? { sidebarVisible: false }
        : { sidebarVisible: true, sidebarView: view },
    ),
}));
