export interface TerminalCreateRequest {
  /** Renderer-generated id, so output listeners can be registered before the shell starts. */
  id: string;
  cwd?: string;
  cols: number;
  rows: number;
}

export type TerminalCreateResult = { ok: true } | { ok: false; error: string };

export interface TerminalWriteRequest {
  id: string;
  data: string;
}

export interface TerminalResizeRequest {
  id: string;
  cols: number;
  rows: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
}
