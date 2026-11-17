import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const scripts = join(repo, '.claude/skills/style-from-reference/scripts');
// The analyzer's pure logic is tested in Python (standard library only), so any python3 can run it.
const python = ['python3', 'python'].find((cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0);
const NEEDS_PYTHON = { skip: python ? false : 'python3 not installed' };

test('style-from-reference metrics pass their unit tests', NEEDS_PYTHON, () => {
  const run = spawnSync(python, ['-I', '-B', '-m', 'unittest', 'discover', '-s', join(scripts, 'tests'), '-t', scripts], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /Ran \d+ tests/);
});

test('style-from-reference leaves no Python bytecode in the skill folder', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [e.name, ...walk(join(dir, e.name))] : [e.name]));
  const stray = walk(scripts).filter((name) => name === '__pycache__' || name.endsWith('.pyc'));
  assert.deepEqual(stray, []);
});

test('style-from-reference ships its entry points', () => {
  for (const file of ['style-ref', 'setup.sh', 'requirements.txt', 'Dockerfile', 'sfr/cli.py']) assert.ok(existsSync(join(scripts, file)), file);
});
