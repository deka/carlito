import { useEffect } from 'react';
import { startUpdateSync, useUpdateStore } from '../store/useUpdateStore';

export function UpdateIndicator() {
  const update = useUpdateStore((state) => state.update);

  useEffect(startUpdateSync, []);

  if (!update) return null;
  const { phase, latestVersion, currentVersion } = update;
  const pending = phase === 'available' || phase === 'installed' || phase === 'downloading' || phase === 'installing';

  // Nothing to install: the version doubles as the manual "Check for Updates" entry point.
  if (!latestVersion || !pending) {
    const checking = phase === 'checking';
    return (
      <button
        className="status-item status-button status-version"
        type="button"
        disabled={checking}
        onClick={() => void window.api.update.check(true).catch(console.error)}
        title={checking ? 'Checking for updates…' : `Carlo ${currentVersion}. Click to check for updates.`}
      >
        {checking ? 'Checking…' : `v${currentVersion}`}
      </button>
    );
  }

  if (phase === 'downloading' || phase === 'installing') {
    return (
      <span className="status-item status-update status-update-busy" title={`Updating to Carlo ${latestVersion}`}>
        <UpdateIcon />
        {phase === 'downloading' ? 'Downloading update…' : 'Installing update…'}
      </span>
    );
  }

  const installed = phase === 'installed';

  return (
    <button
      className="status-item status-button status-update"
      type="button"
      onClick={() => void (installed ? window.api.update.restart() : window.api.update.install())}
      title={
        installed
          ? `Carlo ${latestVersion} is installed. Click to restart.`
          : `Carlo ${latestVersion} is available. Click to update.`
      }
    >
      <UpdateIcon />
      {installed ? 'Restart to update' : `Update ${latestVersion}`}
    </button>
  );
}

function UpdateIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
    </svg>
  );
}
