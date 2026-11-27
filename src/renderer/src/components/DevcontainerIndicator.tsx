import { reopenInContainer, showDevcontainerLog, useDevcontainerStore } from '../store/useDevcontainerStore';

/** Status bar item for the workspace's dev container; hidden when there is none. */
export function DevcontainerIndicator() {
  const state = useDevcontainerStore((store) => store.state);
  if (state.status === 'none') return null;

  const label =
    state.status === 'running'
      ? state.name
      : state.status === 'starting'
        ? 'Starting Dev Container…'
        : state.status === 'stopping'
          ? 'Stopping Dev Container…'
        : state.status === 'error'
          ? 'Dev Container failed'
          : 'Dev Container';
  const title =
    state.status === 'running'
      ? `Running in dev container ${state.name} (${state.remoteWorkspaceFolder}) — show log`
      : state.status === 'available'
        ? 'This folder has a dev container — reopen in container'
        : state.status === 'error'
          ? `${state.error} — show log`
          : 'Show dev container log';
  const onClick = () => {
    if (state.status === 'available') void reopenInContainer().catch(console.error);
    else showDevcontainerLog();
  };

  return (
    <button
      className={`status-item status-button devcontainer-status devcontainer-status-${state.status}`}
      type="button"
      onClick={onClick}
      title={title}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.75 13.5 4.9v6.2L8 14.25 2.5 11.1V4.9zM2.5 4.9 8 8l5.5-3.1M8 8v6.25" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
