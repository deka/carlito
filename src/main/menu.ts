import { Menu } from 'electron';

/**
 * Carlo has no menu bar: every command lives in the UI, the command palette or a
 * renderer keybinding. Linux/Windows get no application menu at all. macOS keeps a
 * minimal native menu because its global menu bar always exists and the Edit roles
 * are what make Cmd+C/V/X/Z/A work in text fields there.
 */
export function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  );
}
