import '@milkdown/prose/view/style/prosemirror.css';
import '@milkdown/prose/tables/style/tables.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type * as monaco from '@codingame/monaco-vscode-editor-api';
import {
  Editor,
  type CmdKey,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import {
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark';
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  gfm,
  insertTableCommand,
  toggleStrikethroughCommand,
} from '@milkdown/preset-gfm';
import { history } from '@milkdown/plugin-history';
import { clipboard } from '@milkdown/plugin-clipboard';
import { $prose, $view, callCommand } from '@milkdown/utils';
import { Plugin, PluginKey, TextSelection, type EditorState, type Command } from '@milkdown/prose/state';
import type { Node as ProseNode, Mark } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { CellSelection, TableMap, deleteColumn, deleteRow, deleteTable, selectedRect } from '@milkdown/prose/tables';
import { getModel } from '../editor/models';
import { splitFrontmatter } from '../markdown/frontmatter';
import { mergeSerializedEdit, minimalReplacement } from '../markdown/lineMerge';
import { restoreNoteSyntax } from '../markdown/serializerFixes';
import {
  localMarkdownAssetPath,
  markdownAnchorUrl,
  markdownExternalImageUrl,
} from '../markdown/markdownPathUtils';
import { registerRichEditFlusher } from '../markdown/pendingRichEdits';
import type { EditorTab } from '../store/useEditorStore';
import { MarkdownPreview } from './MarkdownPreview';

interface Props {
  groupId: string;
  tab: EditorTab;
  onShowSource: () => void;
}

/** Delay between the last keystroke and writing the markdown back to the text model. */
const writeDelayMs = 150;

interface ToolbarState {
  block: string;
  marks: ReadonlySet<string>;
  inTable: boolean;
  /** GFM tables need their header row: deleting it is disabled. */
  inHeaderRow: boolean;
  inList: boolean;
  task: boolean;
}

const initialToolbarState: ToolbarState = {
  block: 'paragraph',
  marks: new Set(),
  inTable: false,
  inHeaderRow: false,
  inList: false,
  task: false,
};

function readToolbarState(state: EditorState): ToolbarState {
  const { $from, from, to, empty } = state.selection;
  let block = $from.parent.type.name;
  if (block === 'heading') block = `h${String($from.parent.attrs.level)}`;
  let inTable = state.selection instanceof CellSelection;
  let inHeaderRow = false;
  let inList = false;
  let task = false;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'table') inTable = true;
    if (node.type.name === 'table_header_row') inHeaderRow = true;
    if (node.type.name === 'list_item' && !inList) {
      inList = true;
      task = node.attrs.checked != null;
    }
  }
  const marks = new Set<string>();
  const collect = (list: readonly Mark[]) => list.forEach((mark) => marks.add(mark.type.name));
  if (empty) collect(state.storedMarks ?? $from.marks());
  else state.doc.nodesBetween(from, to, (node) => collect(node.marks));
  if (state.selection instanceof CellSelection) {
    state.selection.forEachCell((cell) => {
      if (cell.type.name === 'table_header') inHeaderRow = true;
    });
  }
  return { block, marks, inTable, inHeaderRow, inList, task };
}

function sameToolbarState(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.block === b.block &&
    a.inTable === b.inTable &&
    a.inHeaderRow === b.inHeaderRow &&
    a.inList === b.inList &&
    a.task === b.task &&
    a.marks.size === b.marks.size &&
    [...a.marks].every((mark) => b.marks.has(mark))
  );
}

/** Bullet marker used most in the file, so re-serialized lists keep the author's style. */
function dominantBullet(markdown: string): '-' | '*' | '+' {
  const counts = { '-': 0, '*': 0, '+': 0 };
  for (const match of markdown.matchAll(/^[ \t]*([-*+])[ \t]+(?![-*+][ \t]*[-*+])/gm)) {
    counts[match[1] as '-' | '*' | '+']++;
  }
  if (counts['*'] > counts['-'] && counts['*'] >= counts['+']) return '*';
  if (counts['+'] > counts['-'] && counts['+'] > counts['*']) return '+';
  return '-';
}

/**
 * Run a table insertion command, then put the cursor in the new row/column
 * (prosemirror-tables leaves it in the original cell).
 */
function insertInTable(run: (ctx: Ctx) => unknown, direction: 'above' | 'below' | 'left' | 'right') {
  return (ctx: Ctx): void => {
    const view = ctx.get(editorViewCtx);
    let before;
    try {
      before = selectedRect(view.state);
    } catch {
      return;
    }
    run(ctx);
    const row = direction === 'below' ? before.bottom : before.top;
    const col = direction === 'right' ? before.right : before.left;
    try {
      const after = selectedRect(view.state);
      const index = row * after.map.width + col;
      if (row >= after.map.height || col >= after.map.width) return;
      const cellPos = after.tableStart + after.map.map[index];
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cellPos + 1))));
    } catch {
      // Selection left where the command put it.
    }
  };
}

/** Insert a table and put the cursor in its first header cell. */
function insertTableAndEnter(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const from = view.state.selection.from;
  callCommand(insertTableCommand.key, { row: 3, col: 3 })(ctx);
  const { doc } = view.state;
  let tablePos = -1;
  doc.nodesBetween(Math.max(0, from - 1), doc.content.size, (node, pos) => {
    if (tablePos >= 0) return false;
    if (node.type.name === 'table') {
      tablePos = pos;
      return false;
    }
    return true;
  });
  if (tablePos < 0) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(tablePos + 1))));
}

/** Replace only the part of the document that differs, so the selection survives external updates. */
function replaceDocument(view: EditorView, next: ProseNode): void {
  const current = view.state.doc;
  const start = current.content.findDiffStart(next.content);
  if (start === null) return;
  const end = current.content.findDiffEnd(next.content);
  if (!end) return;
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const tr = view.state.tr.replace(start, endA, next.slice(start, endB));
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
}

/** Set GFM column alignment on every cell of the columns touched by the selection. */
function alignColumns(alignment: 'left' | 'center' | 'right'): Command {
  return (state, dispatch) => {
    let rect;
    try {
      rect = selectedRect(state);
    } catch {
      return false;
    }
    if (dispatch) {
      const tr = state.tr;
      const map: TableMap = rect.map;
      const seen = new Set<number>();
      for (let row = 0; row < map.height; row++) {
        for (let col = rect.left; col < rect.right; col++) {
          const cellPos = map.map[row * map.width + col];
          if (seen.has(cellPos)) continue;
          seen.add(cellPos);
          const pos = rect.tableStart + cellPos;
          const cell = tr.doc.nodeAt(pos);
          if (cell) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment });
        }
      }
      dispatch(tr);
    }
    return true;
  };
}

/** Toggle the GFM task checkbox of the enclosing list item (wrapping in a list first if needed). */
function toggleTask(state: EditorState, dispatch?: EditorView['dispatch']): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== 'list_item') continue;
    if (dispatch) {
      const checked = node.attrs.checked == null ? false : null;
      dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked }));
    }
    return true;
  }
  return false;
}

export function MarkdownRichEditor({ groupId, tab, onShowSource }: Props) {
  const model = getModel(tab.uri);
  if (!model) return <MarkdownPreview groupId={groupId} onShowSource={onShowSource} />;
  return <RichEditorSurface key={tab.uri} tab={tab} model={model} onShowSource={onShowSource} />;
}

function RichEditorSurface({
  tab,
  model,
  onShowSource,
}: {
  tab: EditorTab;
  model: monaco.editor.ITextModel;
  onShowSource: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | undefined>(undefined);
  const [frontmatter, setFrontmatter] = useState(() => splitFrontmatter(model.getValue()).frontmatter);
  const [toolbar, setToolbar] = useState<ToolbarState>(initialToolbarState);
  const [error, setError] = useState<string | undefined>(undefined);
  const [linkDraft, setLinkDraft] = useState<string | undefined>(undefined);
  const tabPath = tab.path;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let editor: Editor | undefined;
    /** Serializer output matching the model's current content (before any pending edit). */
    let baseline = '';
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let applyingExternal = false;
    let writingModel = false;

    const serialize = (ctx: Ctx): string =>
      restoreNoteSyntax(ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));

    const flush = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!pending || !editor || model.isDisposed()) return;
      pending = false;
      const edited = editor.action(serialize);
      if (edited === baseline) return;
      const current = model.getValue();
      const { frontmatter: head, body } = splitFrontmatter(current);
      const next = head + mergeSerializedEdit(body, baseline, edited);
      baseline = edited;
      const change = minimalReplacement(current, next);
      if (!change) return;
      const startPos = model.getPositionAt(change.start);
      const endPos = model.getPositionAt(change.end);
      writingModel = true;
      try {
        model.pushEditOperations(
          [],
          [
            {
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              },
              text: change.text,
            },
          ],
          () => null,
        );
        model.pushStackElement();
      } finally {
        writingModel = false;
      }
    };

    const schedule = (): void => {
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, writeDelayMs);
    };

    const syncPlugin = $prose(
      () =>
        new Plugin({
          key: new PluginKey('carlo-markdown-sync'),
          view: (view) => {
            setToolbar(readToolbarState(view.state));
            return {
              update: (updated, previous) => {
                if (!applyingExternal && !updated.state.doc.eq(previous.doc)) schedule();
                const next = readToolbarState(updated.state);
                setToolbar((current) => (sameToolbarState(current, next) ? current : next));
              },
            };
          },
          props: {
            handleClick: (view, pos, event) => {
              if (!(event.ctrlKey || event.metaKey)) return false;
              const link = view.state.doc
                .resolve(pos)
                .marks()
                .find((mark) => mark.type.name === 'link');
              const href = link ? markdownAnchorUrl(String(link.attrs.href ?? '')) : undefined;
              if (!href || href.startsWith('#')) return false;
              void window.api.shell.openExternal(href).catch(console.error);
              return true;
            },
            handleDOMEvents: {
              mousedown: (view, event) => {
                // The task checkbox is the li's ::before marker: a click on the li itself.
                const target = event.target;
                // Only a primary click toggles: right/middle clicks must not edit the file.
                if (event.button !== 0) return false;
                if (!(target instanceof HTMLElement) || !target.matches('li[data-item-type="task"]')) return false;
                const inside = view.posAtDOM(target, 0);
                const $pos = view.state.doc.resolve(inside);
                for (let depth = $pos.depth; depth > 0; depth--) {
                  const node = $pos.node(depth);
                  if (node.type.name !== 'list_item') continue;
                  event.preventDefault();
                  view.dispatch(
                    view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
                      ...node.attrs,
                      checked: !node.attrs.checked,
                    }),
                  );
                  return true;
                }
                return false;
              },
            },
          },
        }),
    );

    const imageView = $view(imageSchema.node, () => (initialNode) => {
      const dom = document.createElement('img');
      let currentSrc = '';
      const render = (node: ProseNode): void => {
        const src = String(node.attrs.src ?? '');
        dom.alt = String(node.attrs.alt ?? '');
        dom.title = String(node.attrs.title ?? '');
        if (src === currentSrc) return;
        currentSrc = src;
        dom.removeAttribute('src');
        const external = markdownExternalImageUrl(src);
        if (external) {
          dom.src = external;
          return;
        }
        const path = localMarkdownAssetPath(tabPath, src);
        if (!path) return;
        void window.api.file
          .readDataUrl(path)
          .then((result) => {
            if (currentSrc === src) dom.src = result.dataUrl;
          })
          .catch((reason: unknown) => console.error(`Could not load markdown image: ${path}`, reason));
      };
      render(initialNode);
      return {
        dom,
        update: (node) => {
          if (node.type !== initialNode.type) return false;
          render(node);
          return true;
        },
      };
    });

    const { body: initialBody } = splitFrontmatter(model.getValue());

    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialBody);
        const bullet = dominantBullet(initialBody);
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet }));
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(syncPlugin)
      .use(imageView)
      .create()
      .then((created) => {
        if (disposed) {
          void created.destroy();
          return;
        }
        editor = created;
        editorRef.current = created;
        baseline = created.action(serialize);
        created.action((ctx) => ctx.get(editorViewCtx).focus());
      })
      .catch((reason: unknown) => {
        console.error(reason);
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Could not open the rich editor.');
      });

    const contentListener = model.onDidChangeContent(() => {
      if (writingModel || !editor) return;
      // Changed elsewhere (disk reload, other split, format on save): follow it.
      // A rich edit still pending in the same instant is dropped in favour of the model.
      pending = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      const { frontmatter: head, body } = splitFrontmatter(model.getValue());
      setFrontmatter(head);
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const next = ctx.get(parserCtx)(body);
        applyingExternal = true;
        try {
          replaceDocument(view, next);
        } finally {
          applyingExternal = false;
        }
        baseline = serialize(ctx);
      });
    });

    const unregister = registerRichEditFlusher(tab.uri, flush);

    return () => {
      disposed = true;
      try {
        flush();
      } catch (reason) {
        console.error('Could not apply pending markdown edits', reason);
      }
      unregister();
      contentListener.dispose();
      editorRef.current = undefined;
      void editor?.destroy();
    };
  }, [model, tab.uri, tabPath]);

  const run = (action: (ctx: Ctx) => unknown): void => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.action((ctx) => {
      action(ctx);
      ctx.get(editorViewCtx).focus();
    });
  };
  const command = <T,>(key: CmdKey<T>, payload?: T) => () => run(callCommand(key, payload));
  const prose = (cmd: Command) => () =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      cmd(view.state, view.dispatch);
    });

  const applyLink = (href: string): void => {
    setLinkDraft(undefined);
    const url = href.trim();
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const linkType = state.schema.marks.link;
      const { from, to, empty } = state.selection;
      if (!url) {
        view.dispatch(state.tr.removeMark(from, to, linkType));
        return;
      }
      const mark = linkType.create({ href: url, title: null });
      if (empty) view.dispatch(state.tr.insertText(url, from).addMark(from, from + url.length, mark));
      else view.dispatch(state.tr.removeMark(from, to, linkType).addMark(from, to, mark));
    });
  };

  const button = (label: ReactNode, title: string, onClick: () => void, active = false, disabled = false) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`markdown-rich-button${active ? ' active' : ''}`}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  if (error) {
    return (
      <div className="markdown-preview">
        <div className="preview-toolbar">
          <span>Formatted</span>
          <button type="button" className="preview-action" onClick={onShowSource}>
            Show Source
          </button>
        </div>
        <div className="markdown-preview-error">{error}</div>
      </div>
    );
  }

  const blockValue = /^h[1-6]$/.test(toolbar.block) ? toolbar.block : 'paragraph';

  return (
    <div className="markdown-preview markdown-rich">
      <div className="preview-toolbar markdown-rich-toolbar">
        <select
          className="markdown-rich-select"
          title="Block type"
          value={blockValue}
          onChange={(event) => {
            const value = event.target.value;
            run(callCommand(wrapInHeadingCommand.key, value === 'paragraph' ? 0 : Number(value.slice(1))));
          }}
        >
          <option value="paragraph">Text</option>
          {[1, 2, 3, 4, 5, 6].map((level) => (
            <option key={level} value={`h${level}`}>
              Heading {level}
            </option>
          ))}
        </select>
        <span className="markdown-rich-group">
          {button(<b>B</b>, 'Bold (Ctrl+B)', command(toggleStrongCommand.key), toolbar.marks.has('strong'))}
          {button(<i>I</i>, 'Italic (Ctrl+I)', command(toggleEmphasisCommand.key), toolbar.marks.has('emphasis'))}
          {button(<s>S</s>, 'Strikethrough', command(toggleStrikethroughCommand.key), toolbar.marks.has('strike_through'))}
          {button(<code>{'</>'}</code>, 'Inline code', command(toggleInlineCodeCommand.key), toolbar.marks.has('inlineCode'))}
          {button('Link', 'Link', () => setLinkDraft(''), toolbar.marks.has('link'))}
        </span>
        <span className="markdown-rich-group">
          {button('•', 'Bullet list', command(wrapInBulletListCommand.key))}
          {button('1.', 'Numbered list', command(wrapInOrderedListCommand.key))}
          {button('☐', 'Task list item', prose(toggleTask), toolbar.task, !toolbar.inList)}
          {button('❝', 'Quote', command(wrapInBlockquoteCommand.key))}
          {button('{ }', 'Code block', command(createCodeBlockCommand.key))}
          {button('―', 'Horizontal rule', command(insertHrCommand.key))}
        </span>
        <span className="markdown-rich-group">
          {button('⊞', 'Insert table', () => run(insertTableAndEnter), false, toolbar.inTable)}
          {toolbar.inTable ? (
            <>
              {button('+↑', 'Insert row above', () => run(insertInTable(callCommand(addRowBeforeCommand.key), 'above')))}
              {button('+↓', 'Insert row below', () => run(insertInTable(callCommand(addRowAfterCommand.key), 'below')))}
              {button('+←', 'Insert column left', () => run(insertInTable(callCommand(addColBeforeCommand.key), 'left')))}
              {button('+→', 'Insert column right', () => run(insertInTable(callCommand(addColAfterCommand.key), 'right')))}
              {button('−row', 'Delete row', prose(deleteRow), false, toolbar.inHeaderRow)}
              {button('−col', 'Delete column', prose(deleteColumn))}
              {button('⇤', 'Align column left', prose(alignColumns('left')))}
              {button('≡', 'Center column', prose(alignColumns('center')))}
              {button('⇥', 'Align column right', prose(alignColumns('right')))}
              {button('✕', 'Delete table', prose(deleteTable))}
            </>
          ) : null}
        </span>
        {linkDraft !== undefined ? (
          <input
            className="markdown-rich-link-input"
            autoFocus
            placeholder="https://… (empty removes the link)"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyLink(linkDraft);
              if (event.key === 'Escape') {
                setLinkDraft(undefined);
                run(() => undefined);
              }
            }}
            onBlur={() => setLinkDraft(undefined)}
          />
        ) : null}
        <button type="button" className="preview-action" onClick={onShowSource}>
          Show Source
        </button>
      </div>
      <div className="markdown-preview-content markdown-rich-content">
        {frontmatter ? (
          <pre className="markdown-rich-frontmatter" title="Frontmatter (edit in source view)">
            {frontmatter.trimEnd()}
          </pre>
        ) : null}
        <div ref={rootRef} />
      </div>
    </div>
  );
}
