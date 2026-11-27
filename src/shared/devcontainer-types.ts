/** The dev container of a window's workspace, as seen by the renderer. */
export type DevcontainerState =
  /** The workspace has no devcontainer.json. */
  | { status: 'none' }
  /** A devcontainer.json exists; the window runs locally. */
  | { status: 'available' }
  | { status: 'starting' }
  /** Reopening locally: the container is being stopped. */
  | { status: 'stopping' }
  | {
      status: 'running';
      containerId: string;
      /** Short display name, e.g. the container's name. */
      name: string;
      remoteUser: string;
      remoteWorkspaceFolder: string;
    }
  | { status: 'error'; error: string };

export interface DevcontainerStateRequest {
  rootPath: string;
}

export interface DevcontainerOpenRequest {
  rootPath: string;
  /** Remove the existing container and build it again. */
  rebuild?: boolean;
}

export interface DevcontainerChangedEvent {
  rootPath: string;
  state: DevcontainerState;
}

export interface DevcontainerLogEvent {
  rootPath: string;
  /** Appended text; `reset` starts a new log (a new `devcontainer up`). */
  data: string;
  reset?: boolean;
}
