import { useEffect, useRef } from 'react';
import { reopenInContainer, reopenLocally, useDevcontainerStore } from '../store/useDevcontainerStore';

const statusText = {
  none: 'No dev container',
  available: 'Local',
  starting: 'Starting…',
  running: 'Running',
  error: 'Failed',
} as const;

export function DevcontainerPanel() {
  const state = useDevcontainerStore((store) => store.state);
  const log = useDevcontainerStore((store) => store.log);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log]);

  const run = (action: () => Promise<void>) => () => void action().catch(console.error);
  const connected = state.status === 'running' || state.status === 'starting';

  return (
    <section className="problems-panel devcontainer-panel" aria-label="Dev Container">
      <header className="problems-header">
        <div className="problems-title">Dev Container</div>
        <div className="problems-summary">
          {state.status === 'running' ? `${statusText.running} — ${state.name}` : statusText[state.status]}
        </div>
        <div className="devcontainer-actions">
          {connected ? (
            <button type="button" onClick={run(reopenLocally)}>Reopen Locally</button>
          ) : (
            <button type="button" onClick={run(() => reopenInContainer())}>Reopen in Container</button>
          )}
          <button type="button" onClick={run(() => reopenInContainer(true))}>Rebuild</button>
        </div>
      </header>
      <pre className="devcontainer-log" ref={logRef}>
        {log || 'The output of `devcontainer up` appears here.'}
      </pre>
    </section>
  );
}
