import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { judge, measureLoudness } from '../scripts/lib/loudness.mjs';
import { counterTimes } from '../scripts/lib/counter-ticks.mjs';
import { NEEDS_FFMPEG } from './helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (script, args) => spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8', cwd: root });
const scratch = () => mkdtempSync(join(tmpdir(), 'hyperframes-kit-test-'));

// A quiet MONO "voice": amplitude-modulated tone, around -35 LUFS like a real quiet phone recording.
function quietMono(dir) {
  const f = join(dir, 'quiet.wav');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.012*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))':d=6:s=48000", '-ac', '1', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return f;
}

test('judge accepts the delivery window and rejects quiet, loud, and hot-peak audio', () => {
  assert.equal(judge({ lufs: -16, truePeak: -1.5 }).ok, true);
  assert.match(judge({ lufs: -33, truePeak: -9 }).problems[0], /too quiet/);
  assert.match(judge({ lufs: -10, truePeak: -2 }).problems[0], /too loud/);
  assert.match(judge({ lufs: -16, truePeak: 0.2 }).problems[0], /true peak/);
});

test('audio-master turns a quiet mono file into -16 LUFS stereo that audio-check passes', NEEDS_FFMPEG, () => {
  const dir = scratch(), input = quietMono(dir), out = join(dir, 'master.wav');
  assert.equal(run('scripts/audio-check.mjs', [input]).status, 1, 'quiet input must fail the gate');
  const m = run('scripts/audio-master.mjs', [input, '--out', out]);
  assert.equal(m.status, 0, m.stderr + m.stdout);
  const ch = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  assert.equal(ch.stdout.trim(), '2', 'master must be stereo so the measured LUFS is the delivered LUFS');
  const lufs = measureLoudness(out).lufs;
  assert.ok(lufs > -17.5 && lufs < -14.5, `expected about -16 LUFS, got ${lufs}`);
  assert.equal(run('scripts/audio-check.mjs', [out]).status, 0);
});

// Minimal inline-video project for preflight.
function project(dir, audioSrc) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><body>
<div id="r" data-composition-id="t" data-start="0" data-duration="5" data-width="1080" data-height="1920">
<div id="w"><video id="v" data-start="0" data-duration="5" data-track-index="0" src="assets/x.mp4" muted playsinline></video></div>
${audioSrc ? `<audio id="a" data-start="0" data-duration="5" data-track-index="1" src="${audioSrc}"></audio>` : ''}
<script>const tl=gsap.timeline({paused:true});tl.to('#w',{opacity:1,duration:1},0);window.__timelines=window.__timelines||{};window.__timelines['t']=tl;</script>
</div></body></html>`);
}

test('preflight allows root data-start with an inline video (the real lint exempts the root)', () => {
  const dir = scratch(); project(dir, null);
  const r = run('scripts/preflight.mjs', [dir]);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /root_data_start_conflicts_with_video/);
});

test('preflight fails a quiet voice file and passes the mastered one', NEEDS_FFMPEG, () => {
  const dir = scratch(); project(dir, 'assets/voice.wav');
  const quiet = quietMono(dir);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', quiet, join(dir, 'assets/voice.wav')]);
  const bad = run('scripts/preflight.mjs', [dir]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /audio_loudness/);
  const master = run('scripts/audio-master.mjs', [quiet, '--out', join(dir, 'assets/voice.wav')]);
  assert.equal(master.status, 0, master.stderr);
  assert.equal(run('scripts/preflight.mjs', [dir]).status, 0);
});

test('counter ticks land exactly when the rounded number changes (GSAP power2.out is cubic)', () => {
  const out = (p) => 1 - (1 - p) ** 3;
  for (const [start, duration, to] of [[0.1, 0.78, 37], [11.36, 0.39, 5], [24.28, 0.84, 37]]) {
    const { ticks, landing } = counterTimes({ start, duration, from: 0, to, ease: 'power2.out' });
    const shown = (t) => Math.round(to * out(Math.min(1, Math.max(0, (t - start) / duration))));
    assert.ok(ticks.length >= Math.min(to, 5), 'a counter must produce ticks');
    assert.ok(ticks.every((k) => shown(k.t + 0.002) === k.value && shown(k.t - 0.004) < k.value), 'each tick coincides with a number change');
    assert.equal(landing, +(start + duration).toFixed(3));
    assert.ok(ticks.every((k, i) => !i || k.t - ticks[i - 1].t >= 0.029), 'ticks are thinned to the 30 ms minimum gap');
  }
  assert.throws(() => counterTimes({ start: 0, duration: 1, to: 5, ease: 'bounce' }), /unknown ease/);
});

test('sound-design expands a counter cue into one tick per displayed change plus a landing', NEEDS_FFMPEG, () => {
  const dir = scratch();
  assert.equal(run('scripts/sound-design.mjs', ['generate', '--dir', join(dir, 'sfx')]).status, 0);
  const cues = join(dir, 'cues.json');
  writeFileSync(cues, JSON.stringify([{ type: 'counter', t: 0.5, duration: 0.6, from: 0, to: 5, ease: 'power2.out', gain: -12, landing: 'ping', landingGain: -9 }]));
  const r = run('scripts/sound-design.mjs', ['mix', '--cues', cues, '--duration', '2', '--out', join(dir, 'stem.wav'), '--dir', join(dir, 'sfx')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mixed 6 cues/, 'five ticks plus one landing');
});

test('preflight blocks a mounted SFX stem that has a count-up but no counter cue', NEEDS_FFMPEG, () => {
  const dir = scratch(); mkdirSync(join(dir, 'assets'), { recursive: true });
  const quiet = quietMono(dir);
  assert.equal(run('scripts/audio-master.mjs', [quiet, '--out', join(dir, 'assets/voice.master.wav')]).status, 0);
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><body>
<div id="r" data-composition-id="t" data-start="0" data-duration="5" data-width="1080" data-height="1350">
<video id="v" data-start="0" data-duration="5" data-track-index="0" src="assets/x.mp4" muted playsinline></video>
<audio id="a" data-start="0" data-duration="5" data-track-index="1" src="assets/voice.master.wav"></audio>
<audio id="s" data-start="0" data-duration="5" data-track-index="2" src="assets/sfx.stem.wav" data-loudness-exempt></audio>
<div id="n">0</div>
<script>const tl=gsap.timeline({paused:true});const o={v:0};tl.to(o,{v:37,duration:1,onUpdate:function(){document.getElementById('n').textContent=Math.round(o.v);}},0);window.__timelines=window.__timelines||{};window.__timelines['t']=tl;</script>
</div></body></html>`);
  writeFileSync(join(dir, 'assets/sfx-cues.json'), JSON.stringify([{ t: 1, sfx: 'pop' }]));
  const bad = run('scripts/preflight.mjs', [dir]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /counter_without_sound/);
  writeFileSync(join(dir, 'assets/sfx-cues.json'), JSON.stringify([{ type: 'counter', t: 0, duration: 1, from: 0, to: 37 }]));
  assert.equal(run('scripts/preflight.mjs', [dir]).status, 0);
});
