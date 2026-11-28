# Carlito

> Everything you need, nothing in the way. A focused, simple AI workspace.

![Carlito](./assets/carlito.svg)

Carlito is a workspace for coding with an AI agent. Open a folder, start your agent in the built-in terminal, and watch, review and fix what it does in a real editor, with language intelligence, search and Git right next to it.

Everything is in the box. There are no extensions to hunt for, no settings to tune before you start, no account to create. Install it, open a folder, get to work.

It runs on Linux.

## What you get

**A real editor.** The Monaco editor (the one inside VS Code), with tabs you can drag, side-by-side and stacked splits, find and replace, formatting, soft wrap, go back / go forward, and color themes. Save formats the file and organizes imports.

**Your agent, right there.** Terminal tabs in a resizable bottom panel, running your usual shell. Start Claude Code, Codex, Aider or any command-line agent and keep the code it touches in view.

**Review what changed.** Lines changed since the last commit are marked in the editor gutter. Source Control shows every change as a folder tree: stage, unstage, commit, pull and push without leaving the window. The current branch sits in the status bar.

**Find your way around.** Quick open any file (`Ctrl+P`), run any command (`Ctrl+Shift+P`), search and replace across the whole workspace with case, whole word, regex and include / exclude filters, results grouped by folder.

**Language intelligence that just works.** Completion, errors, go to definition, find references, rename and quick fixes through language servers (LSP). TypeScript, JavaScript and JSON work out of the box.

**See the real thing.** Markdown switches in place between source, formatted preview and a rich editor. HTML, SVG, PDF and images open as previews, not as raw text.

**Dev containers.** Folders with a dev container can be reopened inside it.

**Room for the code.** No menu bar, no title bar. Commands live in the activity bar, the workspace menu and the command palette. Recent folders wait for you on the welcome screen.

**Stays up to date.** Installed from the `.deb`, Carlito checks for new releases and updates itself.

## What you don't get

No marketplace, no extension system, no built-in chat, no project files, no telemetry. If something does not help you or your agent open, edit, navigate or review code, it does not belong here.

## Install

Download the latest package from the [Releases page](https://github.com/deka/carlo/releases).

On Debian / Ubuntu:

```sh
sudo apt install ./carlito_<version>_amd64.deb
```

On other Linux distributions:

```sh
tar xzf carlito-<version>.tar.gz
./carlito-<version>/carlito
```

## Getting started

Start Carlito from the applications menu, or from a terminal:

```sh
carlito            # open the current directory
carlito ~/project  # open a folder
```

Running `carlito` again opens another window in the same app; each window has its own folder.

Then:

1. `Ctrl+Shift+T` opens a terminal. Start your agent there.
2. `Ctrl+P` jumps to a file, `Ctrl+Shift+P` finds any command.
3. `Ctrl+Shift+G` shows what changed, ready to commit.
4. `Ctrl+,` opens the settings: theme, fonts, tab size, format on save.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+P` | Quick open file |
| `Ctrl+K` | Open folder |
| `Ctrl+N` / `Ctrl+O` | New file / open file |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+Alt+S` | Save / save as / save all |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+E` | Toggle explorer |
| `Ctrl+Shift+F` / `Ctrl+Shift+H` | Find / replace in files |
| `Ctrl+Shift+G` | Source Control |
| `Ctrl+Shift+M` | Toggle problems |
| `F8` / `Shift+F8` | Next / previous problem |
| `F12` / `Alt+F12` | Go to / peek definition |
| `Shift+F12` | Find references |
| `F2` | Rename symbol |
| `Ctrl+.` | Quick fix |
| `Ctrl+Space` | Trigger suggestions |
| `Ctrl+[` / `Ctrl+]` | Go back / forward |
| `Ctrl+Alt+Right` / `Ctrl+Alt+Down` | Split editor right / down |
| `Ctrl+Alt+V` | Toggle preview (Markdown, SVG, HTML) |
| `Ctrl+Shift+V` | Markdown preview to the side |
| `Ctrl+,` | Settings |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |

In a terminal, keys go to the shell (`Ctrl+C`, `Ctrl+W`, `Ctrl+P`…); only `Ctrl+Shift` / `Ctrl+Alt` shortcuts reach Carlito. Copy and paste with `Ctrl+Shift+C` / `Ctrl+Shift+V`, or right-click.

## Thanks

Thanks to [@rumpl](https://github.com/rumpl) for creating [Carlo](https://github.com/rumpl/carlo), which made Carlito possible.
