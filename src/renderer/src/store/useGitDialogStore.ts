import { create } from 'zustand';

interface GitDialogState {
  isOpen: boolean;
  openGitDialog: () => void;
  closeGitDialog: () => void;
  toggleGitDialog: () => void;
}

/** Visibility of the Source Control dialog (Ctrl+Shift+G, status bar branch button). */
export const useGitDialogStore = create<GitDialogState>((set) => ({
  isOpen: false,
  openGitDialog: () => set({ isOpen: true }),
  closeGitDialog: () => set({ isOpen: false }),
  toggleGitDialog: () => set((state) => ({ isOpen: !state.isOpen })),
}));
