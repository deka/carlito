import { ipcMain } from 'electron';
import type { CarloUserConfig } from '@shared/app-config';
import { IPC } from '@shared/ipc';
import { getLanguageConfig } from '@shared/language-registry';
import { loadUserConfig, saveUserConfig, userConfigPath } from '../config/user-config';

export function registerConfigHandlers(): void {
  ipcMain.handle(IPC.configLanguage, () => getLanguageConfig());
  ipcMain.handle(IPC.configUser, () => loadUserConfig());
  ipcMain.handle(IPC.configUserSave, (_event, config: CarloUserConfig) => saveUserConfig(config));
  ipcMain.handle(IPC.configUserPath, () => ({ path: userConfigPath() }));
}
