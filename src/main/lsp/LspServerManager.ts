import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import type { Message } from 'vscode-jsonrpc';
import { IPC } from '@shared/ipc';
import { hasLanguageServer } from '@shared/language-registry';
import type { LspStartOptions } from '@shared/lsp-types';
import type { PathMapping } from './pathMapping';
import type { ResolvedServer } from './resolveServer';

interface Connection {
  proc: ChildProcessWithoutNullStreams;
  reader: StreamMessageReader;
  writer: StreamMessageWriter;
  mapping?: PathMapping;
}

export class LspServerManager {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly send: (channel: string, payload: unknown) => void) {}

  /** `mapping` translates workspace paths for a server running in a dev container. */
  start(opts: LspStartOptions, server: ResolvedServer, mapping?: PathMapping): string {
    if (!hasLanguageServer(opts.languageId))
      throw new Error(`No language server for ${opts.languageId}`);
    const { command, args, cwd, env, debug } = server;
    const proc = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const reader = new StreamMessageReader(proc.stdout);
    const writer = new StreamMessageWriter(proc.stdin);
    const connectionId = randomUUID();

    const log = (message: string) => this.send(IPC.lspServerLog, { connectionId, languageId: opts.languageId, message });
    console.error(`[lsp ${opts.languageId}] start ${command} ${args.join(' ')} ${debug}`);
    log(`start ${command} ${args.join(' ')}; ${debug}`);

    reader.listen((message: Message) =>
      this.send(IPC.lspFromServer, { connectionId, message: mapping ? mapping.toHost(message) : message }),
    );
    proc.stderr.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      console.error(`[lsp ${opts.languageId}] ${data}`);
      this.send(IPC.lspServerStderr, { connectionId, languageId: opts.languageId, data });
    });
    proc.on('error', (error) => {
      console.error(`[lsp ${opts.languageId}] failed to spawn`, error);
      log(`spawn error: ${error.message}`);
      this.send(IPC.lspServerExit, { connectionId, code: null, signal: String(error.message) });
      this.connections.delete(connectionId);
    });
    proc.on('exit', (code, signal) => {
      log(`exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.send(IPC.lspServerExit, { connectionId, code, signal });
      this.connections.delete(connectionId);
    });

    this.connections.set(connectionId, { proc, reader, writer, mapping });
    return connectionId;
  }

  toServer(connectionId: string, message: Message): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    void connection.writer.write(connection.mapping ? connection.mapping.toContainer(message) : message);
  }

  stop(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    connection.reader.dispose();
    connection.writer.dispose();
    // Killing `docker exec` does not stop the server in the container; closing its
    // stdin does (language servers exit on EOF).
    connection.proc.stdin.end();
    connection.proc.kill();
    this.connections.delete(connectionId);
  }

  stopAll(): void {
    for (const connectionId of [...this.connections.keys()]) this.stop(connectionId);
  }
}
