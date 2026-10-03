#!/usr/bin/env node
// Listening-gate helper: inspect every edit join in an encoded video/audio WITHOUT needing ears first,
// and hand the human a few short clips to audition.
//
// For each join it reports: click risk (sample discontinuity), level jump, room-tone (noise-floor)
// mismatch, leftover dead air, and how tight the cut sits to the neighbouring words. It writes
// short audition clips, a spectrogram sheet, and (optionally) re-transcribes the final audio locally
// and flags expected words near each join that the audio does not seem to contain (a clipped word).
//
// Usage:
//   node scripts/audio-joins.mjs <rendered.mp4|audio> --out-dir <dir> [join sources] [options]
//
// Join sources (combine freely):
//   --joins 4.66,13.6          join times (seconds) on the rendered file's timeline
//   --edl a.json --edl b.json  EDLs in editing order (keep_ranges); joins are composed through later EDLs
//   --offset <s>               added to EDL-derived joins (e.g. a prepended cold open minus any trimmed head)
// Options:
//   --words <transcript.json>  final-timeline transcript, for tightness + ASR check
//   --asr                      run local whisper.cpp on the audio and compare to --words (needs transcribe-local setup)
//   --window <s>               audition clip half-width (default 1.5)
//
// Exit code 0 always; this is a review aid. Read joins.md, listen to clips/, look at joins.png.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { measureLoudness, TARGET } from "./lib/loudness.mjs";

const SR = 48000;
const args = argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Usage: node scripts/audio-joins.mjs <file> --out-dir <dir> [--joins t1,t2] [--edl a.json ...] [--offset s] [--words t.json] [--asr] [--window 1.5]");
  exit(args.length ? 0 : 1);
}
const o = { file: null, outDir: null, joins: [], edls: [], offset: 0, words: null, asr: false, window: 1.5 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out-dir") o.outDir = args[++i];
  else if (a === "--joins") o.joins.push(...args[++i].split(",").map(Number));
  else if (a === "--edl") o.edls.push(args[++i]);
  else if (a === "--offset") o.offset = Number(args[++i]);
  else if (a === "--words") o.words = args[++i];
  else if (a === "--asr") o.asr = true;
  else if (a === "--window") o.window = Number(args[++i]);
  else if (a.startsWith("--")) { console.error(`unknown option: ${a}`); exit(1); }
  else o.file = a;
}
if (!o.file || !o.outDir) { console.error("need <file> and --out-dir"); exit(1); }
const file = resolve(o.file), outDir = resolve(o.outDir);
mkdirSync(join(outDir, "clips"), { recursive: true });

// ---- joins from EDLs, composed through later EDLs ----
function keepRanges(p) { return JSON.parse(readFileSync(resolve(p), "utf8")).keep_ranges; }
function joinsOf(keep) {
  const out = []; let acc = 0;
  for (let i = 0; i < keep.length - 1; i++) { acc += keep[i].end - keep[i].start; out.push(acc); }
  return out;
}
function mapThrough(t, keep) { // time on input timeline -> output timeline, or null if deleted
  let acc = 0;
  for (const k of keep) { if (t >= k.start && t <= k.end) return acc + (t - k.start); acc += k.end - k.start; }
  return null;
}
let derived = [];
o.edls.forEach((p, idx) => {
  const keep = keepRanges(p);
  derived = derived.map((t) => mapThrough(t, keep)).filter((t) => t !== null);
  derived.push(...joinsOf(keep));
});
const joins = [...new Set([...derived.map((t) => +(t + o.offset).toFixed(3)), ...o.joins])].sort((a, b) => a - b);
if (!joins.length) { console.error("no joins given (use --joins or --edl)"); exit(1); }

// ---- audio ----
function pcm(start, dur) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, start)), "-t", String(dur), "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("ffmpeg decode failed: " + r.stderr);
  const b = r.stdout; return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const rms = (a, s, e) => { let t = 0; const n = Math.max(1, e - s); for (let i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / n); };
function frames(a, s, e, f = Math.round(SR * 0.02)) { const out = []; for (let i = s; i + f <= e; i += f) out.push(db(rms(a, i, i + f))); return out; }

// Judge audibility at delivery loudness: shift every dB reading as if the file were mastered to the target.
const GAIN = TARGET.lufs - measureLoudness(file).lufs;
const words = o.words ? JSON.parse(readFileSync(resolve(o.words), "utf8")).words.filter((w) => (w.type ?? "word") === "word") : null;

const rows = [];
for (const J of joins) {
  const W = 0.6, t0 = Math.max(0, J - W), buf = pcm(t0, 2 * W), c = Math.round((J - t0) * SR);
  const flags = [];
  // click: discontinuity at the join vs typical sample-to-sample change nearby
  const diffs = []; for (let i = c - 2400; i < c + 2400; i++) if (i > 0 && i < buf.length && Math.abs(i - c) > 96) diffs.push(Math.abs(buf[i] - buf[i - 1]));
  diffs.sort((a, b) => a - b);
  const p99 = diffs[Math.floor(diffs.length * 0.99)] || 1e-6;
  let jump = 0; for (let i = c - 48; i <= c + 48; i++) if (i > 0 && i < buf.length) jump = Math.max(jump, Math.abs(buf[i] - buf[i - 1]));
  const clickRatio = jump / p99;
  if (clickRatio > 6 && jump > 0.01) flags.push(`click risk (step ${clickRatio.toFixed(1)}x normal)`);
  // level jump 80 ms either side
  const L = Math.round(SR * 0.08);
  const before = db(rms(buf, c - L, c)) + GAIN, after = db(rms(buf, c, c + L)) + GAIN;
  // Only speech-to-speech steps are audible as a jump; cuts inside pauses are covered by the room-tone check.
  if (before > -35 && after > -35 && Math.abs(before - after) > 12) flags.push(`level jump ${before.toFixed(0)} -> ${after.toFixed(0)} dB`);
  // room tone: quietest 20 ms frame in 300 ms either side
  const fb = frames(buf, Math.max(0, c - Math.round(SR * 0.3)), c), fa = frames(buf, c, Math.min(buf.length, c + Math.round(SR * 0.3)));
  const floorB = Math.min(...fb) + GAIN, floorA = Math.min(...fa) + GAIN;
  // Only compare when BOTH sides contain a real pause (quiet frame under -50 dBFS at delivery loudness); a side that
  // is continuous speech has no room tone to compare. Then a step above 10 dB is audible as a 'pumping' pause.
  if (floorB < -50 && floorA < -50 && Math.abs(floorB - floorA) > 10) flags.push(`room tone mismatch ${floorB.toFixed(0)} vs ${floorA.toFixed(0)} dB`);
  // leftover dead air across the join
  const floor = Math.min(floorB, floorA) - GAIN, quiet = floor + 6;
  let run = 0; for (let i = fb.length - 1; i >= 0 && fb[i] < quiet; i--) run++;
  for (let i = 0; i < fa.length && fa[i] < quiet; i++) run++;
  if (run * 0.02 > 0.45) flags.push(`dead air ~${(run * 0.02).toFixed(2)} s around the join`);
  // tightness to words
  let tight = null;
  if (words) {
    const prev = [...words].reverse().find((w) => w.end <= J + 0.02), next = words.find((w) => w.start >= J - 0.02);
    const gb = prev ? J - prev.end : null, ga = next ? next.start - J : null;
    tight = { prev: prev?.text, gapBefore: gb === null ? null : +gb.toFixed(3), next: next?.text, gapAfter: ga === null ? null : +ga.toFixed(3) };
    if (gb !== null && gb < 0.03) flags.push(`cut lands ${(gb * 1000).toFixed(0)} ms after "${prev.text}" (tail may be clipped)`);
    if (ga !== null && ga < 0.03) flags.push(`cut lands ${(ga * 1000).toFixed(0)} ms before "${next.text}" (onset may be clipped)`);
  }
  rows.push({ time: +J.toFixed(3), clickRatio: +clickRatio.toFixed(1), levelBeforeDb: +before.toFixed(1), levelAfterDb: +after.toFixed(1), floorBeforeDb: +floorB.toFixed(1), floorAfterDb: +floorA.toFixed(1), tight, flags });
}

// ---- audition clips + spectrogram sheet ----
const idx = (i) => String(i + 1).padStart(2, "0");
rows.forEach((r, i) => {
  const s = Math.max(0, r.time - o.window);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(s), "-t", String(2 * o.window), "-i", file, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", join(outDir, "clips", `join-${idx(i)}-at-${r.time.toFixed(2)}s.wav`)]);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(s), "-t", String(2 * o.window), "-i", file, "-filter_complex", "[0:a]highpass=f=80,volume=12dB,showspectrumpic=s=700x200:legend=0:scale=log:stop=6000[v]", "-map", "[v]", "-frames:v", "1", join(outDir, "clips", `.spec-${idx(i)}.png`)]);
});
const specs = rows.map((_, i) => join(outDir, "clips", `.spec-${idx(i)}.png`)).filter(existsSync);
if (specs.length) {
  // pair spectrograms side by side; an odd one out is padded with a blank so every row has equal width
  const inputs = specs.flatMap((p) => ["-i", p]);
  const nRows = Math.ceil(specs.length / 2);
  const parts = [];
  for (let r = 0; r < nRows; r++) {
    const l = 2 * r, rt = 2 * r + 1;
    parts.push(rt < specs.length ? `[${l}:v][${rt}:v]hstack=2[r${r}]` : `[${l}:v]pad=iw*2:ih:0:0[r${r}]`);
  }
  const fc = parts.join(";") + ";" + (nRows > 1 ? Array.from({ length: nRows }, (_, i) => `[r${i}]`).join("") + `vstack=${nRows}` : "[r0]null");
  const sheet = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", fc, join(outDir, "joins.png")], { encoding: "utf8" });
  if (sheet.status !== 0) console.error("spectrogram sheet failed:\n" + sheet.stderr);
}

// ---- ASR cross-check: does the audio still contain the words we expect near each join? ----
let asr = null;
if (o.asr) {
  if (!words) { console.error("--asr needs --words"); exit(1); }
  const tl = fileURLToPath(new URL("./transcribe-local.mjs", import.meta.url));
  const outJson = join(outDir, "final-audio.asr.json");
  const r = spawnSync("node", [tl, file, "--output", outJson, "--prompt", ""], { encoding: "utf8" });
  if (r.status !== 0) { console.error("local ASR failed:\n" + r.stderr); }
  else {
    const heard = JSON.parse(readFileSync(outJson, "utf8")).words;
    const norm = (t) => t.toLowerCase().replace(/[^a-z0-9']/g, "");
    const NUM = { thirtyseven: "37", fiveplus: "5" };
    const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 0; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const same = (e, h) => { const x = norm(e), y = norm(h); if (!x || !y) return false; if (x === y || NUM[x] === y || y.startsWith(NUM[x] ?? "\0")) return true; return 1 - lev(x, y) / Math.max(x.length, y.length) >= 0.6; };
    // A clipped word sits right at the join, so only words whose edge is within 0.35 s of it are judged.
    asr = rows.map((row) => {
      const near = words.filter((w) => (w.end <= row.time + 0.02 ? row.time - w.end : w.start - row.time) < 0.35 && Math.abs(w.start - row.time) < 1.0);
      const missing = near.filter((w) => !heard.some((h) => same(w.text, h.text) && Math.abs(h.start - w.start) < 0.9)).map((w) => w.text);
      return { time: row.time, missing };
    });
    asr.forEach((a, i) => { if (a.missing.length) rows[i].flags.push(`ASR did not confirm: ${a.missing.join(" ")}`); });
  }
}

writeFileSync(join(outDir, "joins.json"), JSON.stringify({ file, joins: rows }, null, 2));
const flagged = rows.filter((r) => r.flags.length);
const md = [
  `# Join review: ${file}`, "",
  `${rows.length} joins, ${flagged.length} flagged. Signal checks are automatic. Hearing them is still on you: play the short clips in \`clips/\` (each is +/-${o.window}s around a join) and look at \`joins.png\`.`,
  asr ? "ASR cross-check ran (local whisper.cpp, fuzzy-matched, words next to the join only); it can miss words for accent or noise reasons, so treat 'did not confirm' as 'listen here first'." : "ASR cross-check not run (add --asr --words).", "",
  "| # | time | flags |", "|---|---|---|",
  ...rows.map((r, i) => `| ${idx(i)} | ${r.time.toFixed(2)}s | ${r.flags.length ? r.flags.join("; ") : "ok"} |`),
].join("\n");
writeFileSync(join(outDir, "joins.md"), md);
console.log(md);
