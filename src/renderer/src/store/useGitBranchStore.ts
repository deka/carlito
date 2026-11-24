import { create } from 'zustand';
import type { GitBranchInfo, GitBranchResult } from '@shared/file-types';
import { sameBranch } from '../git/gitBranch';

interface GitBranchState {
  /** Workspace root the branch below belongs to. */
  rootPath?: string;
  isGitRepo: boolean;
  branch?: GitBranchInfo;
  refresh: (rootPath: string) => Promise<void>;
  setBranch: (rootPath: string, result: GitBranchResult) => void;
  clear: () => void;
}

// Monotonic id so a slow, outdated answer never overwrites a newer one.
let requestId = 0;

/** Current git branch of the window's workspace, shown in the status bar and the Source Control panel. */
export const useGitBranchStore = create<GitBranchState>((set, get) => ({
  isGitRepo: false,
  refresh: async (rootPath) => {
    const id = ++requestId;
    try {
      const result = await window.api.git.branch(rootPath);
      if (id === requestId) get().setBranch(rootPath, result);
    } catch (error) {
      console.error('failed to read git branch', error);
      if (id === requestId) get().setBranch(rootPath, { isGitRepo: false });
    }
  },
  setBranch: (rootPath, { isGitRepo, branch }) => {
    const state = get();
    if (state.rootPath === rootPath && state.isGitRepo === isGitRepo && sameBranch(state.branch, branch)) return;
    set({ rootPath, isGitRepo, branch: isGitRepo ? branch : undefined });
  },
  clear: () => {
    requestId++;
    set({ rootPath: undefined, isGitRepo: false, branch: undefined });
  },
}));
