/**
 * Self-update state, owned by the main process and broadcast to every window.
 *
 * - `idle`: nothing checked yet (or the last background check failed).
 * - `available`: a newer release exists. `installable` tells whether Carlo can
 *   install it itself (packaged .deb install on x64 Linux with pkexec); otherwise
 *   the UI only offers to open the release page.
 * - `downloading` / `installing`: an install is in progress.
 * - `installed`: the new package is on disk; Carlo must restart to use it.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'installed';

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  installable?: boolean;
}

export interface UpdateCheckRequest {
  /** Manual checks report their result (including "up to date" and errors) in a dialog. */
  manual: boolean;
}
