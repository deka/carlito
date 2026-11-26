import { type BottomPanelId } from '../store/useBottomPanelStore';

const panelLabels: Record<BottomPanelId, string> = {
  problems: 'Problems',
};

interface PanelTabStripProps {
  activePanel: BottomPanelId;
  errorCount: number;
  warningCount: number;
  onOpen: (panel: BottomPanelId) => void;
  onClose: () => void;
}

export function PanelTabStrip({ activePanel, errorCount, warningCount, onOpen, onClose }: PanelTabStripProps) {
  return (
    <div className="bottom-panel-tabs" role="tablist" aria-label="Panel tabs">
      {(Object.keys(panelLabels) as BottomPanelId[]).map((panel) => (
        <button
          key={panel}
          className={`bottom-panel-tab ${activePanel === panel ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activePanel === panel}
          onClick={() => onOpen(panel)}
        >
          {panelLabels[panel]}
          {panel === 'problems' ? (
            <span className="bottom-panel-badge">{errorCount} / {warningCount}</span>
          ) : null}
        </button>
      ))}
      <span className="bottom-panel-spacer" />
      <button className="bottom-panel-close" type="button" onClick={onClose} title="Close Panel" aria-label="Close Panel">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6" /></svg>
      </button>
    </div>
  );
}
