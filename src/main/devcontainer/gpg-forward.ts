import { execFile, spawn } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import type { ContainerTarget } from './devcontainer-service';
import { findTool, toolEnv } from './tools';

/**
 * Forwards the host's GnuPG agent into a dev container, like VS Code does, so that
 * `git commit -S` in the container signs with the host's keys.
 *
 * A bind-mounted Unix socket does not work with Docker Desktop (the daemon runs in a
 * VM), so the agent traffic goes through the stdio of a `docker exec`: a small Perl
 * relay listens on the container's agent socket and multiplexes its connections as
 * frames; each one is relayed to the host's restricted "extra" agent socket, which
 * cannot export secret keys or kill the agent.
 *
 * Frame: type (u8: 0 open, 1 data, 2 close), connection id (u32), length (u32), data.
 */

const FRAME_OPEN = 0;
const FRAME_DATA = 1;
const FRAME_CLOSE = 2;
const HEADER = 9;

/** Exit code of the prelude when the container's agent socket is already forwarded. */
const alreadyForwarded = 4;

/** Run in the container as the remote user; `$1` is the relay script. */
const containerPrelude = [
  'command -v gpgconf >/dev/null 2>&1 || { echo "gpgconf not found in the container." >&2; exit 3; }',
  'command -v perl >/dev/null 2>&1 || { echo "perl not found in the container." >&2; exit 3; }',
  // An agent that answers with no live gpg-agent process behind it is already
  // forwarded (VS Code, another window): keep it rather than replacing its socket.
  'if ! grep -qs "^[0-9]* (gpg-agent) [^Z]" /proc/[0-9]*/stat && gpg-connect-agent --no-autostart "GETINFO version" /bye 2>/dev/null | grep -q "^D "; then exit 4; fi',
  // A local agent has no keys and would shadow the host's one.
  'gpgconf --kill gpg-agent >/dev/null 2>&1',
  's=$(gpgconf --list-dirs agent-socket)',
  'mkdir -p -m 700 "${s%/*}"',
  'exec perl -e "$1" "$s"',
].join('\n');

const relayScript = String.raw`
use strict; use warnings;
use IO::Socket::UNIX; use IO::Select; use Socket qw(SOCK_STREAM);
$SIG{PIPE} = 'IGNORE';
my $path = shift;
unlink $path;
my $srv = IO::Socket::UNIX->new(Type => SOCK_STREAM, Local => $path, Listen => 16)
  or die "Cannot listen on $path: $!\n";
chmod 0600, $path;
my $ino = (stat $path)[1];
# Remove the socket on exit unless another relay (or VS Code) has replaced it.
sub cleanup { my @st = stat $path; unlink $path if @st && $st[1] == $ino; exit 0 }
$SIG{TERM} = $SIG{HUP} = $SIG{INT} = \&cleanup;
binmode STDIN; binmode STDOUT;
print STDERR "listening\n";
my $sel = IO::Select->new($srv, \*STDIN);
my (%conn, %ids); my $next = 0; my $buf = '';
sub out { my $s = shift; while (length $s) { my $n = syswrite STDOUT, $s; cleanup() unless $n; substr($s, 0, $n) = '' } }
sub frame { my ($t, $id, $d) = @_; $d = '' unless defined $d; out(pack('CNN', $t, $id, length $d) . $d) }
sub drop { my $id = shift; my $c = delete $conn{$id} or return; delete $ids{fileno $c}; $sel->remove($c); close $c }
while (1) {
  for my $fh ($sel->can_read) {
    # Closed by an earlier handle of this round.
    my $fd = fileno $fh;
    next unless defined $fd;
    if ($fh == $srv) {
      my $c = $srv->accept or next;
      my $id = ++$next; $conn{$id} = $c; $ids{fileno $c} = $id; $sel->add($c);
      frame(0, $id);
    } elsif ($fd == 0) {
      my $n = sysread STDIN, $buf, 65536, length $buf;
      cleanup() unless $n;
      while (length $buf >= 9) {
        my ($t, $id, $len) = unpack 'CNN', $buf;
        last if length $buf < 9 + $len;
        my $d = substr $buf, 9, $len; substr($buf, 0, 9 + $len) = '';
        my $c = $conn{$id} or next;
        if ($t == 1) {
          while (length $d) { my $w = syswrite $c, $d; unless ($w) { drop($id); frame(2, $id); last } substr($d, 0, $w) = '' }
        } elsif ($t == 2) { drop($id) }
      }
    } else {
      my $id = $ids{$fd};
      my $n = sysread $fh, my $d, 65536;
      if ($n) { frame(1, $id, $d) } else { drop($id); frame(2, $id) }
    }
  }
}
`;

export interface GpgForwarding {
  stop(): void;
}

function run(file: string, args: string[], input?: Buffer): Promise<{ ok: boolean; stdout: Buffer; stderr: string }> {
  return new Promise((done) => {
    const child = execFile(
      file,
      args,
      { env: toolEnv(file), timeout: 20_000, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => done({ ok: !error, stdout, stderr: stderr.toString().trim() }),
    );
    child.stdin?.end(input);
  });
}

/** Fingerprints of the host's secret keys (the public part of each is what the container needs). */
function secretKeyFingerprints(colons: string): string[] {
  const fingerprints: string[] = [];
  let afterSec = false;
  for (const line of colons.split('\n')) {
    const field = line.split(':');
    if (field[0] === 'sec') afterSec = true;
    else if (field[0] === 'fpr' && afterSec && field[9]) {
      fingerprints.push(field[9]);
      afterSec = false;
    }
  }
  return fingerprints;
}

function frame(type: number, id: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(HEADER);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(id, 1);
  header.writeUInt32BE(data.length, 5);
  return Buffer.concat([header, data]);
}

/**
 * Start forwarding the host's GnuPG agent into the container. Failures (no GnuPG on
 * the host or in the container, no Perl…) are logged and never block the container.
 */
export function startGpgForwarding(target: ContainerTarget, log: (text: string) => void): GpgForwarding {
  let stopped = false;
  let stopRelay: (() => void) | undefined;

  void (async () => {
    const gpg = findTool('gpg');
    const gpgconf = findTool('gpgconf');
    if (!gpg || !gpgconf) return;

    await run(gpgconf, ['--launch', 'gpg-agent']);
    const extra = await run(gpgconf, ['--list-dirs', 'agent-extra-socket']);
    const agentSocket = extra.stdout.toString().trim();
    if (!extra.ok || !agentSocket) {
      log(`GPG forwarding disabled: ${extra.stderr || 'no agent extra socket on the host'}.\n`);
      return;
    }

    // The container needs the public keys to sign with the forwarded secret ones.
    const secrets = await run(gpg, ['--batch', '--list-secret-keys', '--with-colons']);
    const fingerprints = secretKeyFingerprints(secrets.stdout.toString());
    if (fingerprints.length === 0) return;
    const exported = await run(gpg, ['--batch', '--export', ...fingerprints]);
    if (stopped) return;
    if (exported.ok && exported.stdout.length > 0) {
      const imported = await run(
        target.docker,
        ['exec', '-i', '-u', target.remoteUser, target.containerId, 'gpg', '--batch', '--import'],
        exported.stdout,
      );
      if (!imported.ok) {
        log(`GPG forwarding disabled: could not import the public keys (${imported.stderr || 'gpg failed'}).\n`);
        return;
      }
    }
    if (stopped) return;

    const relay = spawn(
      target.docker,
      ['exec', '-i', '-u', target.remoteUser, target.containerId, 'sh', '-c', containerPrelude, 'sh', relayScript],
      { env: toolEnv(target.docker), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const connections = new Map<number, Socket>();
    const send = (data: Buffer) => {
      if (relay.stdin.writable) relay.stdin.write(data);
    };
    let buffer: Buffer = Buffer.alloc(0);

    relay.stdout.on('data', (chunk: Buffer) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length >= HEADER) {
        const type = buffer.readUInt8(0);
        const id = buffer.readUInt32BE(1);
        const length = buffer.readUInt32BE(5);
        if (buffer.length < HEADER + length) break;
        const data = buffer.subarray(HEADER, HEADER + length);
        buffer = buffer.subarray(HEADER + length);
        if (type === FRAME_OPEN) {
          const socket = connect(agentSocket);
          connections.set(id, socket);
          socket.on('data', (chunk: Buffer) => send(frame(FRAME_DATA, id, chunk)));
          socket.on('error', () => socket.destroy());
          socket.on('close', () => {
            if (connections.get(id) !== socket) return;
            connections.delete(id);
            send(frame(FRAME_CLOSE, id));
          });
        } else if (type === FRAME_DATA) {
          connections.get(id)?.write(Buffer.from(data));
        } else if (type === FRAME_CLOSE) {
          const socket = connections.get(id);
          connections.delete(id);
          socket?.destroy();
        }
      }
    });
    relay.stdin.on('error', () => undefined);

    let stderr = '';
    relay.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.includes('listening\n')) {
        stderr = stderr.replace('listening\n', '');
        log('GPG agent forwarded from the host.\n');
      }
    });
    relay.on('error', (error) => log(`GPG forwarding failed: ${error.message}\n`));
    relay.on('close', (code) => {
      for (const socket of connections.values()) socket.destroy();
      connections.clear();
      if (code === alreadyForwarded) log('GPG agent already forwarded into the container.\n');
      else if (!stopped) log(`GPG forwarding stopped${stderr.trim() ? `: ${stderr.trim()}` : ` (exit code ${code ?? 'null'})`}.\n`);
    });

    stopRelay = () => {
      // Closing stdin makes the relay remove its socket and exit; `docker exec` alone
      // would leave it running in the container.
      relay.stdin.end();
      const timer = setTimeout(() => relay.kill(), 5_000);
      relay.once('close', () => clearTimeout(timer));
    };
    if (stopped) stopRelay();
  })().catch((error: unknown) => {
    log(`GPG forwarding failed: ${error instanceof Error ? error.message : String(error)}\n`);
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      stopRelay?.();
    },
  };
}
