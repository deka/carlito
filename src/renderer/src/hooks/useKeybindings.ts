import { useEffect } from 'react';
import {
  ensureCommandsLoaded,
  getCommands,
  matchesEvent,
  parseKeybinding,
  runCommand,
} from '../commands/registry';
import { isTerminalElement } from '../terminal/terminalTabs';

type KeyDescriptor = ReturnType<typeof parseKeybinding>;

/**
 * While a terminal has focus, plain Ctrl+<key>, Alt+<key> and function keys belong
 * to the shell (Ctrl+C, Ctrl+W, Ctrl+P, F8 in htop…). Only Ctrl+Shift and Ctrl+Alt
 * workbench shortcuts stay active, except Ctrl+Shift+C/V (terminal copy/paste).
 */
function allowedInTerminal(descriptor: KeyDescriptor): boolean {
  if (!descriptor.ctrl || !(descriptor.shift || descriptor.alt)) return false;
  const key = descriptor.key.toLowerCase();
  return !(descriptor.shift && !descriptor.alt && (key === 'c' || key === 'v' || key === 'keyc' || key === 'keyv'));
}

/**
 * Register a global `keydown` listener that dispatches to registered commands
 * based on the `keybinding` field of each {@link Command}.
 *
 * Keybinding strings are parsed once (after the builtin commands have been
 * loaded) so there are no per-event allocations.  Adding a new keybinding only
 * requires setting the `keybinding` property on the corresponding
 * `registerCommand` call — no changes to this file are needed.
 */
export function useKeybindings(): void {
  useEffect(() => {
    // Build the descriptor table after builtin commands are registered.
    // Commands registered later (extensions, tests) are picked up on the
    // next keydown because we re-read getCommands() lazily.
    let descriptorsReady = false;
    type Binding = { commandId: string; descriptor: KeyDescriptor };
    let bindings: Binding[] = [];

    function buildBindings(): void {
      bindings = getCommands()
        .filter((cmd) => cmd.keybinding)
        .map((cmd) => ({
          commandId: cmd.id,
          // parseKeybinding is cheap and called only once per command.
          descriptor: parseKeybinding(cmd.keybinding!),
        }));
      descriptorsReady = true;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;

      if (!descriptorsReady) {
        // Commands may not be registered yet on very first keypress — build
        // a preliminary table from whatever is registered so far.
        buildBindings();
      }

      const inTerminal = isTerminalElement(event.target);
      for (const { commandId, descriptor } of bindings) {
        if (inTerminal && !allowedInTerminal(descriptor)) continue;
        if (matchesEvent(descriptor, event)) {
          event.preventDefault();
          event.stopPropagation();
          void runCommand(commandId);
          // Allow multiple bindings to fire (e.g. if two commands share a key)
          // but in practice each binding is unique.
        }
      }
    };

    // Eagerly load builtin commands and build the final descriptor table so
    // the first keydown doesn't pay the async import cost.
    void ensureCommandsLoaded().then(buildBindings);

    const offMenu = window.api.menu.onCommand((commandId) => void runCommand(commandId));
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      offMenu();
    };
  }, []);
}
