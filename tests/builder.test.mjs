import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { layoutFor, LAYOUTS } from '../scripts/lib/builder/layout.mjs';
import { captionGroups, locateHook, makeFind, finalWords, normWord } from '../scripts/lib/builder/timeline.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (args) => spawnSync(process.execPath, [join(root, 'scripts/build-video.mjs'), ...args], { encoding: 'utf8', cwd: root });

test('format is required and must be a known layout', () => {
  assert.throws(() => layoutFor(undefined), /--format is required/);
  assert.throws(() => layoutFor('16x9'), /needs a layout entry/);
  assert.deepEqual(Object.keys(LAYOUTS).sort(), ['4x5', '9x16']);
  assert.equal(layoutFor('4x5').H, 1350);
});

test('build-video refuses to run without --format (exit 1)', () => {
  const r = run(['video-projects/does-not-matter']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format is required/);
});

const W = (text, start, end) => ({ text, start, end, type: 'word' });
const words = [W('So', 0, .2), W('the', .3, .4), W('other', .5, .8), W('thing:', .9, 1.2), W('thirty-seven', 2, 2.6), W('percent', 2.7, 3.1), W('fail', 3.2, 3.5), W('mistranslated', 3.6, 4.4), W('Hi', 6, 6.2)];

test('locateHook finds the cold open from three spoken words in order', () => {
  const { HS, HE } = locateHook(words, { after: 'other', from: 'thirty-seven', to: 'mistranslated', pre: 0.1, post: 0.16 });
  assert.equal(HS, 1.9); assert.equal(HE, 4.56);
  assert.throws(() => locateHook(words, { after: 'other', from: 'nope', to: 'mistranslated', pre: 0, post: 0 }), /hook words not found/);
});

test('finalWords retimes hook and body onto [hook][bumper][body] and applies name fixes', () => {
  const meta = { HOOK_SRC: [1.9, 4.56], BODY_SRC_START: 0.12, H: 2.66, BUMPER: 2 };
  const out = finalWords(words, meta, { nameFixes: { Hi: 'Hello' } });
  const hook = out.filter((w) => w.part === 'hook'), body = out.filter((w) => w.part === 'body');
  assert.equal(hook[0].text, 'thirty-seven'); assert.equal(hook[0].start, 0.1);
  assert.equal(body.at(-1).text, 'Hello');
  assert.ok(body[0].start >= meta.H + meta.BUMPER - 0.001, 'body starts after the bumper');
  assert.equal(body.at(-1).start, +(2.66 + 2 + 6 - 0.12).toFixed(3));
});

test('makeFind is punctuation-insensitive and honours from/part; captions group sensibly', () => {
  const meta = { HOOK_SRC: [1.9, 4.56], BODY_SRC_START: 0.12, H: 2.66, BUMPER: 2 };
  const fw = finalWords(words, meta, { nameFixes: {} });
  const find = makeFind(fw);
  assert.equal(find('Thing').text, 'thing:');
  assert.equal(normWord('Thing:'), 'thing');
  assert.throws(() => find('missing'), /anchor not found/);
  const groups = captionGroups(fw, 12);
  assert.ok(groups.every((g) => g.words.length <= 4));
  assert.ok(groups.every((g) => g.end > g.start));
  assert.ok(groups.every((g) => new Set(g.words.map((w) => w.part)).size === 1), 'a group never straddles hook and body');
});

test('end to end on a synthetic project: base + compose + audio produce a lint-clean, preflight-passing page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hyperframes-kit-test-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'compositions'), { recursive: true }); // new-video creates this
  copyFileSync(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(dir, 'assets/gsap.min.js'));
  copyFileSync(join(root, 'examples/starter/hyperframes.json'), join(dir, 'hyperframes.json')); // real projects carry this; lint behaves differently without it
  const mk = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=8', '-f', 'lavfi', '-i', "aevalsrc='0.02*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))':d=8:s=48000", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'assets/clean.mp4')], { encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  const tw = [W('So', .2, .4), W('the', .5, .6), W('other', .7, 1), W('thing', 1.1, 1.4), W('thirty-seven', 2, 2.6), W('percent', 2.7, 3.1), W('mistranslated', 3.2, 4), W('Hi', 4.6, 4.8), W('my', 4.9, 5), W('name', 5.1, 5.3), W('is', 5.4, 5.5), W('Tester', 5.6, 6), W("I've", 6.2, 6.5), W('been', 6.6, 6.8), W('here', 6.9, 7.3)];
  writeFileSync(join(dir, 'assets/t.json'), JSON.stringify({ words: tw }));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 't', width: 1080, height: 1350, fps: 30 }));
  writeFileSync(join(dir, 'video.json'), JSON.stringify({ slug: 'synthetic', source: { clean: 'assets/clean.mp4', transcript: 'assets/t.json' }, hook: { after: 'other', from: 'thirty-seven', to: 'mistranslated' }, lowerThird: { startWord: 'hi', nameWord: 'tester', endWord: "i've" }, emphasis: ['thirty-seven'], outro: { seconds: 1.5, text: 'Follow' } }));
  writeFileSync(join(dir, 'beats.mjs'), `export default function beats({ find }) {
    const A = { n: find('thirty-seven', 0, 'hook') };
    return { anchors: A, html: '', css: '', js: '', counters: [{ id: 'cnum', from: 0, to: 37, start: A.n.start, duration: 0.7, suffix: '%' }], cues: [] };
  }`);
  const r = run([dir, '--format', '4x5', '--sfx', '--stages', 'base,compose,audio,compose']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /data-width="1080" data-height="1350"/);
  assert.match(html, /sfx\.stem\.wav/, 'sfx stem is mounted when requested and built');
  const cues = JSON.parse(readFileSync(join(dir, 'assets/sfx-cues.json'), 'utf8'));
  assert.ok(cues.some((c) => c.type === 'counter' && c.to === 37), 'the declared counter produced a counter cue');
  const meta = JSON.parse(readFileSync(join(dir, 'assets/base.meta.json'), 'utf8'));
  assert.equal(meta.BUMPER, 2); assert.equal(meta.OUTRO, 1.5);
  assert.ok(existsSync(join(dir, 'assets/base-4x5.mp4')));
  const lint = spawnSync(join(root, 'node_modules/.bin/hyperframes'), ['lint'], { cwd: dir, encoding: 'utf8' });
  assert.match((lint.stdout + lint.stderr).replace(/\x1b\[[0-9;]*m/g, ''), /0 error\(?s?\)?, 0 warning/, lint.stdout);
  const pf = spawnSync(process.execPath, [join(root, 'scripts/preflight.mjs'), dir], { encoding: 'utf8' });
  assert.equal(pf.status, 0, pf.stdout);
});
