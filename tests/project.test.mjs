import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { status } from '../scripts/project-status.mjs';
import { hasFfmpeg } from './helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (script, args) => spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8' });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function rawVideo(dir) {
  const f = join(dir, 'original.mp4');
  if (!hasFfmpeg) { writeFileSync(f, Buffer.from('not a real video, but new-project only copies the bytes')); return f; }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=270x480:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=220:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return f;
}

test('new-project scaffolds a cold-start project, copies (never moves) the raw file, and refuses to overwrite', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hyperframes-kit-test-'));
  const raw = rawVideo(tmp), dest = join(tmp, 'projects');
  const r = run('scripts/new-project.mjs', ['demo-clip', '--raw', raw, '--dest', dest]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = join(dest, 'demo-clip');
  for (const f of ['assets/raw.mp4', 'assets/gsap.min.js', 'hyperframes.json', 'meta.json', 'DESIGN.md', 'video.json', 'beats.mjs', 'VERIFY.md']) assert.ok(existsSync(join(dir, f)), `${f} created`);
  assert.equal(sha(join(dir, 'assets/raw.mp4')), sha(raw), 'raw is a byte-identical copy');
  assert.ok(existsSync(raw), 'the original is untouched');
  assert.match(readFileSync(join(dir, 'video.json'), 'utf8'), /"slug": "demo-clip"/);
  assert.match(r.stdout, /project-status\.mjs/, 'prints how to resume');
  assert.equal(run('scripts/new-project.mjs', ['demo-clip', '--raw', raw, '--dest', dest]).status, 1, 'no overwrite');
  assert.equal(run('scripts/new-project.mjs', ['Bad Slug', '--raw', raw, '--dest', dest]).status, 1, 'slug validated');
  assert.equal(run('scripts/new-project.mjs', ['no-raw', '--raw', join(tmp, 'missing.mp4'), '--dest', dest]).status, 1, 'missing raw rejected');
});

test('project-status derives the next step from files alone', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hyperframes-kit-test-'));
  const raw = rawVideo(tmp), dest = join(tmp, 'projects');
  assert.equal(run('scripts/new-project.mjs', ['stateless', '--raw', raw, '--dest', dest]).status, 0);
  const dir = join(dest, 'stateless');
  const touch = (p, c = '{}') => writeFileSync(join(dir, p), c);
  let s = status(dir);
  assert.equal(s.steps[0].done, true);
  assert.match(s.next, /transcribe/, 'fresh project: transcribe next');
  touch('assets/raw.json'); assert.match(status(dir).next, /cut-silences/);
  touch('assets/raw.silence-transcript.json'); touch('assets/silenced.mp4', 'x'); assert.match(status(dir).next, /candidates/);
  touch('assets/raw.cut-candidates.json'); touch('assets/raw.filler-candidates.json'); assert.match(status(dir).next, /approved-cuts/);
  touch('assets/approved-cuts.json', '{"cuts":[]}'); assert.match(status(dir).next, /apply-cuts/);
  touch('assets/clean.mp4', 'x'); touch('assets/raw.mistakes-transcript.json');
  assert.match(status(dir).next, /video\.json/, 'template TODOs are not "filled"');
  copyFileSync(join(root, 'examples/brand-video-emr/video.json'), join(dir, 'video.json'));
  assert.match(status(dir).next, /beats\.mjs/, 'empty template beats are not "written"');
  copyFileSync(join(root, 'examples/brand-video-emr/beats.mjs'), join(dir, 'beats.mjs'));
  assert.match(status(dir).next, /build-video/);
  touch('renders/x.mp4', 'x'); assert.match(status(dir).next, /VERIFY/, 'template VERIFY is not "written"');
  touch('VERIFY.md', '# done\nchecked things'); s = status(dir);
  assert.ok(s.steps.every((st) => st.done), 'all stages done');
  assert.match(s.next, /npm run stop/, 'finishing reminds about cleanup');
});
