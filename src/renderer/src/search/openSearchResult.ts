import type { WorkspaceSearchMatch } from '@shared/file-types';
import { openFileByPath } from '../editor/openFileByPath';

export async function openSearchResult(result: WorkspaceSearchMatch): Promise<void> {
  const [{ getEditor, revealPosition, setPendingReveal }, { useEditorStore: editorStore }] =
    await Promise.all([
      import('../editor/editorRegistry'),
      import('../store/useEditorStore'),
    ]);
  const position = { lineNumber: result.lineNumber, column: result.column };
  setPendingReveal(editorStore.getState().activeGroupId, result.uri, position);
  await openFileByPath(result.path, result.uri);
  requestAnimationFrame(() => {
    const editor = getEditor();
    if (editor?.getModel()?.uri.toString() !== result.uri) return;
    revealPosition(editor, position);
    // Select the match, as VS Code does, so typing replaces it and Ctrl+D extends from it.
    editor.setSelection({
      startLineNumber: result.lineNumber,
      startColumn: result.matchStart + 1,
      endLineNumber: result.lineNumber,
      endColumn: result.matchEnd + 1,
    });
  });
}
