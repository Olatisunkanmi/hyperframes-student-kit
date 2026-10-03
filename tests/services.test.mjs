import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { NEEDS_PROCESS_TOOLS } from './helpers.mjs';
import { mkdtempSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
// The fixtures live in a throwaway "project root", and stop-services is scoped to it with --root, so this test can never
// stop ffmpeg or servers that other tests (or the live repo) are running at the same time.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hyperframes-kit-svc-')));
const script = join(repo, 'scripts/stop-services.mjs');
// zombies (killed, not yet reaped by this blocked test process) count as stopped
const alive = (pid) => { const st = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim(); return st !== '' && !st.startsWith('Z'); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const keepAlive = ['-e', 'setInterval(() => {}, 1e6)'];

test('stop-services stops this repo\'s pipeline processes and leaves everything else alone', NEEDS_PROCESS_TOOLS, async () => {
  const mine = [];
  const decoys = [];
  const start = (list, cmd, args, cwd) => { const p = spawn(cmd, args, { cwd, stdio: 'ignore' }); list.push(p); return p; };
  try {
    // ours: a "hyperframes" node process and a long ffmpeg, both running inside the repo; plus a listening server
    const hf = start(mine, process.execPath, [...keepAlive, 'hyperframes', 'preview'], root);
    const ff = start(mine, 'ffmpeg', ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=s=64x64:r=10', '-t', '120', '-f', 'null', '-'], root);
    const srv = start(mine, process.execPath, ['-e', "require('http').createServer().listen(0, '127.0.0.1'); setInterval(() => {}, 1e6)", 'serve'], root);
    // not ours: same tool outside the repo, a non-pipeline process inside the repo, an unrelated node process
    const ffOther = start(decoys, 'ffmpeg', ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=s=64x64:r=10', '-t', '120', '-f', 'null', '-'], tmpdir());
    const sleeper = start(decoys, 'sleep', ['120'], root);
    const unrelated = start(decoys, process.execPath, keepAlive, tmpdir());
    await wait(1200);
    for (const p of [...mine, ...decoys]) assert.ok(alive(p.pid), `fixture ${p.pid} should be running`);

    const dry = spawnSync(process.execPath, [script, '--root', root, '--dry-run', '--json'], { encoding: 'utf8' });
    const found = JSON.parse(dry.stdout).found.map((f) => f.pid);
    for (const p of mine) assert.ok(found.includes(p.pid), `dry run lists ours (${p.pid})`);
    for (const p of decoys) assert.ok(!found.includes(p.pid), `dry run must not list decoy ${p.pid}`);
    for (const p of mine) assert.ok(alive(p.pid), 'dry run must not kill');

    const real = spawnSync(process.execPath, [script, '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(real.status, 0, real.stdout + real.stderr);
    assert.ok(JSON.parse(real.stdout).ports.length >= 1, 'reports the port the server held');
    await wait(500);
    for (const p of mine) assert.ok(!alive(p.pid), `ours (${p.pid}) must be stopped`);
    for (const p of decoys) assert.ok(alive(p.pid), `decoy (${p.pid}) must survive`);
    assert.ok(hf && ff && srv && ffOther && sleeper && unrelated);
  } finally {
    for (const p of [...mine, ...decoys]) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
  }
});

test('stop-services is a no-op (exit 0) when nothing is running', NEEDS_PROCESS_TOOLS, () => {
  const r = spawnSync(process.execPath, [script, '--root', root, '--quiet'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
