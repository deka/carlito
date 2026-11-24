/** Top-level application menu labels, in order. Shared so the renderer can draw them in the title bar. */
export const APP_MENU_LABELS = [
  'File',
  'Edit',
  'Source Control',
  'Terminal',
  'Navigate',
  'View',
  'Preferences',
  'Help',
] as const;

export type AppMenuLabel = (typeof APP_MENU_LABELS)[number];

export interface MenuPopupRequest {
  label: AppMenuLabel;
  /** Popup anchor, in CSS pixels relative to the window content. */
  x: number;
  y: number;
}
