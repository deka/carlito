import { showThemeSelector } from '../../quickopen/themeSelector';
import { useSettingsStore } from '../../store/useSettingsStore';
import { registerCommand } from '../registry';

function openSettings(): void {
  const settingsStore = useSettingsStore.getState();
  settingsStore.openSettings();
  void settingsStore.loadSettings().catch(console.error);
}

export function registerPreferencesCommands(): void {
  registerCommand({
    id: 'preferences.openSettings',
    title: 'Preferences: Open Settings',
    keybinding: 'Ctrl+,',
    run: openSettings,
  });
  registerCommand({
    id: 'workbench.action.selectTheme',
    title: 'Preferences: Color Theme',
    run: showThemeSelector,
  });
}
