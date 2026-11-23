import { useEffect, useState } from 'react';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { getModel } from '../editor/models';

/**
 * The tab's text model, picked up once the source editor creates it (a tab can
 * open straight into a preview before Monaco has attached its model).
 */
export function useTextModel(uri: string): monaco.editor.ITextModel | undefined {
  const [model, setModel] = useState(() => getModel(uri));
  useEffect(() => {
    setModel(getModel(uri));
    const target = monaco.Uri.parse(uri).toString();
    // Fired inside createModel, before models.ts registers it: use the event's model.
    const created = monaco.editor.onDidCreateModel((candidate) => {
      if (candidate.uri.toString() === target) setModel(candidate);
    });
    const disposed = monaco.editor.onWillDisposeModel((candidate) => {
      if (candidate.uri.toString() === target) setModel(undefined);
    });
    return () => {
      created.dispose();
      disposed.dispose();
    };
  }, [uri]);
  return model;
}

/** Live text of the tab's model (unsaved edits included), debounced while typing. */
export function useModelText(uri: string, delayMs: number): string | undefined {
  const model = useTextModel(uri);
  const [text, setText] = useState(() => model?.getValue());
  useEffect(() => {
    setText(model?.getValue());
    if (!model) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = model.onDidChangeContent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setText(model.getValue()), delayMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      listener.dispose();
    };
  }, [model, delayMs]);
  return text;
}
