import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NEEDS_FFMPEG } from './helpers.mjs';
import { buildFilter, loadWords, picksHash, resolvePick, resolveSelection, retime, sentences } from '../scripts/lib/selection.mjs';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'scripts/select-moments.mjs');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: root });

// Sentences of 5 words (0.5 s per word) with a 0.5 s pause between them.
function transcript() {
  const text = [
    'Most people edit videos wrong.', 'They start with the timeline.', 'Start with the story instead.', 'Then cut everything else.',
    'Here is the proof.', 'It saved me ten hours.', 'Try it on your next video.', 'You will not go back.',
  ];
  const words = [];
  let t = 1;
  for (const s of text) {
    for (const w of s.split(' ')) { words.push({ text: w, start: t, end: t + 0.4, type: 'word' }); t += 0.5; }
    t += 0.5;
  }
  return { language_code: 'en', audio_duration_secs: t + 1, words };
}
const words = loadWords(transcript());

test('sentences split on punctuation and report word indexes', () => {
  const s = sentences(words);
  assert.equal(s.length, 8);
  assert.equal(s[0].text, 'Most people edit videos wrong.');
  assert.equal(s[1].firstWord, 5);
});

test('sentences also split on a long pause when punctuation is missing', () => {
  const bare = [{ text: 'a', start: 0, end: 0.3 }, { text: 'b', start: 0.4, end: 0.7 }, { text: 'c', start: 3, end: 3.3 }];
  assert.equal(sentences(bare).length, 2);
});

test('a pick snaps to word boundaries and padding stops short of the neighbour words', () => {
  const r = resolvePick(words, { slug: 'a', from: 1.02, to: 3.4, reason: 'x' });
  assert.equal(words[r.firstWord].text, 'Most');
  assert.equal(words[r.lastWord].text, 'wrong.');
  const prev = words[r.firstWord - 1];
  const next = words[r.lastWord + 1];
  assert.ok(r.start >= 0 && (!prev || r.start >= prev.end));
  assert.ok(r.end <= next.start);
});

test('a pick with no words in range is rejected', () => {
  assert.throws(() => resolvePick(words, { slug: 'a', from: 500, to: 510, reason: 'x' }), /no spoken words/);
});

test('a clean sentence-aligned pick has no warnings; a mid-sentence pick is flagged', () => {
  const clean = resolveSelection(words, { picks: [{ slug: 'clean', from: 4, to: 6.9, reason: 'a complete claim stated plainly', hook: 'h' }] });
  assert.equal(clean.errorCount, 0);
  assert.deepEqual(clean.picks[0].issues.filter((i) => i.message.startsWith('starts mid')), []);
  const mid = resolveSelection(words, { picks: [{ slug: 'mid', from: 5.6, to: 9.4, reason: 'starts partway through a line' }] });
  assert.ok(mid.picks[0].issues.some((i) => i.message.startsWith('starts mid-sentence')));
});

test('overlapping picks, duplicate slugs and missing reasons are blocking errors', () => {
  const r = resolveSelection(words, { picks: [
    { slug: 'one', from: 1, to: 9, reason: 'a long enough reason' },
    { slug: 'one', from: 6, to: 12, reason: 'a long enough reason' },
    { slug: 'three', from: 15, to: 18, reason: '' },
  ] });
  assert.ok(r.errorCount >= 4);
  assert.ok(r.picks[0].issues.some((i) => i.message.includes('overlaps')));
  assert.ok(r.picks[1].issues.some((i) => i.message === 'duplicate slug'));
  assert.ok(r.picks[2].issues.some((i) => i.message.includes('needs a reason')));
});

test('stitched retime butts ranges together; separate restarts at zero; word order and durations hold', () => {
  const ranges = [{ slug: 'a', start: 1, end: 4 }, { slug: 'b', start: 10, end: 13 }];
  const stitched = retime(words, ranges, 'stitch');
  assert.equal(stitched[1].offset, 3);
  assert.ok(stitched[1].words[0].start >= 3);
  const flat = stitched.flatMap((p) => p.words);
  assert.ok(flat.every((w, i) => w.end > w.start && (!i || w.start >= flat[i - 1].end - 1e-9)));
  const separate = retime(words, ranges, 'separate');
  assert.ok(separate[1].words[0].start < 1);
});

test('filter graph trims every range, fades the audio joins, and concats', () => {
  const g = buildFilter([{ start: 1, end: 4 }, { start: 10, end: 13 }]);
  assert.match(g, /concat=n=2:v=1:a=1\[v\]\[a\]/);
  assert.equal((g.match(/afade=t=in/g) ?? []).length, 2);
  assert.match(buildFilter([{ start: 1, end: 4 }]), /\[v0\]null\[v\]/);
});

test('the plan hash changes when a range moves', () => {
  const a = [{ slug: 'a', start: 1, end: 4 }];
  assert.notEqual(picksHash(a), picksHash([{ slug: 'a', start: 1, end: 4.5 }]));
});

test('apply is refused until approved, and after the ranges change', NEEDS_FFMPEG, () => {
  const dir = mkdtempSync(join(tmpdir(), 'select-moments-'));
  const tPath = join(dir, 'raw.json');
  writeFileSync(tPath, JSON.stringify(transcript()));
  const sel = join(dir, 'selection.json');
  writeFileSync(sel, JSON.stringify({ picks: [
    { slug: 'story', from: 4, to: 6.9, reason: 'states the core claim plainly', hook: 'Start with the story' },
    { slug: 'proof', from: 10, to: 12.9, reason: 'concrete result that earns the claim' },
  ] }));
  const video = join(dir, 'raw.mp4');
  const gen = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=26', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=26', '-shortest', '-pix_fmt', 'yuv420p', video], { stdio: 'ignore' });
  assert.equal(gen.status, 0);

  const check = run(['check', sel, '--transcript', tPath, '--out-dir', dir]);
  assert.equal(check.status, 0, check.stderr + check.stdout);
  const resolved = join(dir, 'selection.resolved.json');
  const md = readFileSync(join(dir, 'SELECTION.md'), 'utf8');
  assert.match(md, /story/);

  const early = run(['apply', resolved, '--video', video, '--transcript', tPath, '--out-dir', dir]);
  assert.notEqual(early.status, 0);
  assert.match(early.stderr, /not approved/);

  assert.equal(run(['approve', resolved, '--mode', 'stitch']).status, 0);
  const doc = JSON.parse(readFileSync(resolved, 'utf8'));
  writeFileSync(resolved, JSON.stringify({ ...doc, picks: doc.picks.map((p, i) => (i ? { ...p, end: p.end + 1 } : p)) }));
  const stale = run(['apply', resolved, '--video', video, '--transcript', tPath, '--out-dir', dir]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /changed after check/);

  writeFileSync(resolved, JSON.stringify(doc));
  const ok = run(['apply', resolved, '--video', video, '--transcript', tPath, '--out-dir', dir]);
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(readFileSync(join(dir, 'selected.json'), 'utf8'));
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(dir, 'selected.mp4')], { encoding: 'utf8' }).stdout);
  assert.ok(Math.abs(dur - out.audio_duration_secs) < 0.15, `video ${dur}s vs transcript ${out.audio_duration_secs}s`);
  assert.equal(out.words[0].text, 'They');
  assert.ok(out.words[0].start < 0.3);
});
