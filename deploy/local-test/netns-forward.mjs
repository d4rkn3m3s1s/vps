#!/usr/bin/env node
// Zero-dependency TCP forwarder: host 127.0.0.1:<hostPort> -> a redroid
// container's adbd, which listens on 127.0.0.1:5555 INSIDE the container's
// (--network none) network namespace. We reach it by spawning
//   nsenter -t <pid> -n nc 127.0.0.1 5555
// per connection and piping the host socket through it. No socat/veth/bridge
// needed, so it works on the custom WSL2 kernel where docker bridge is broken.
//
// Usage: node netns-forward.mjs <hostPort>:<containerPid> [<hostPort>:<pid> ...]
import net from 'node:net';
import { spawn } from 'node:child_process';

const specs = process.argv.slice(2).map((s) => {
  const [hostPort, pid] = s.split(':');
  return { hostPort: Number(hostPort), pid: Number(pid) };
});

if (specs.length === 0) {
  console.error('usage: netns-forward.mjs <hostPort>:<pid> ...');
  process.exit(1);
}

for (const { hostPort, pid } of specs) {
  const server = net.createServer((client) => {
    // Enter the container netns and connect to its loopback adbd.
    const child = spawn('nsenter', ['-t', String(pid), '-n', 'nc', '127.0.0.1', '5555'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    client.pipe(child.stdin);
    child.stdout.pipe(client);
    const kill = () => { try { child.kill('SIGKILL'); } catch {} };
    client.on('error', kill);
    client.on('close', kill);
    child.on('error', () => client.destroy());
    child.on('close', () => client.destroy());
  });
  server.on('error', (e) => console.error(`[:${hostPort}] ${e.message}`));
  server.listen(hostPort, '127.0.0.1', () => {
    console.log(`forwarding 127.0.0.1:${hostPort} -> netns(pid ${pid}):5555`);
  });
}
