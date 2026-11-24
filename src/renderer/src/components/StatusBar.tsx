import { useActiveTab, useEditorStore } from '../store/useEditorStore';
import { problemCounts, useProblemsStore } from '../store/useProblemsStore';
import { useBottomPanelStore } from '../store/useBottomPanelStore';
import { LspStatusIndicator } from './LspStatusIndicator';
import { UpdateIndicator } from './UpdateIndicator';

export function StatusBar() {
  const tab = useActiveTab();
  const workspaceRootUri = useEditorStore((state) => state.workspace?.rootUri);
  const problems = useProblemsStore((state) => state.problems);
  const toggleProblems = () => useBottomPanelStore.getState().togglePanel('problems');
  const counts = problemCounts(problems);

  return (
    <footer className="status-bar">
      <div className="status-brand" title="Carlo is ready">
        <span className="status-ready-dot" aria-hidden="true" />
        <span>Ready</span>
      </div>
      <button
        className="status-item status-button status-problem-button"
        type="button"
        onClick={toggleProblems}
        title="Toggle Problems"
      >
        <span className="status-count status-error-count">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25" /><path d="m6.2 6.2 3.6 3.6M9.8 6.2 6.2 9.8" /></svg>
          {counts.errors}
        </span>
        <span className="status-count status-warning-count">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.25 14 13H2zM8 5.75v3.5M8 11.4v.1" /></svg>
          {counts.warnings}
        </span>
      </button>
      <span className="status-spacer" />
      <UpdateIndicator />
      {tab?.languageId ? <span className="status-item status-language">{tab.languageId}</span> : null}
      <LspStatusIndicator languageId={tab?.languageId} rootUri={workspaceRootUri} />
    </footer>
  );
}
