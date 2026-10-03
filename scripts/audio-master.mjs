#!/usr/bin/env node
// Voice master: light cleanup + two-pass EBU R128 loudness normalization.
//
// Usage:
//   node scripts/audio-master.mjs <input audio|video> --out <output.wav> [options]
//
// Options:
//   --lufs <n>        target integrated loudness (default -16, right for short-form social)
//   --tp <n>          true-peak ceiling in dBTP (default -1.5)
//   --no-denoise      skip the gentle noise reduction
//   --no-highpass     skip the 70 Hz rumble filter
//
// Chain: (mono -> dual-mono stereo) -> highpass 70 Hz -> afftdn (light) -> loudnorm pass 1 (measure) -> loudnorm pass 2 (linear apply).
// Run this on the VOICE stem before mixing music/SFX, then point the composition's
// <audio> at the mastered file. `audio-check.mjs` and `preflight.mjs` enforce the result.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { argv, exit } from "node:process";
import { measureLoudness, judge, TARGET } from "./lib/loudness.mjs";

const args = argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Usage: node scripts/audio-master.mjs <input> --out <output.wav> [--lufs -16] [--tp -1.5] [--no-denoise] [--no-highpass]");
  exit(args.length ? 0 : 1);
}
const o = { input: null, out: null, lufs: TARGET.lufs, tp: TARGET.truePeak, denoise: true, highpass: true };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out") o.out = args[++i];
  else if (a === "--lufs") o.lufs = Number(args[++i]);
  else if (a === "--tp") o.tp = Number(args[++i]);
  else if (a === "--no-denoise") o.denoise = false;
  else if (a === "--no-highpass") o.highpass = false;
  else if (a.startsWith("--")) { console.error(`unknown option: ${a}`); exit(1); }
  else o.input = a;
}
if (!o.input || !o.out) { console.error("need an input and --out"); exit(1); }
const input = resolve(o.input), out = resolve(o.out);

// Deliver stereo. Mono sources become dual-mono, which reads 3 LU louder on an EBU R128 meter than the
// same mono file, and that stereo figure is what players and platforms measure. Normalise AFTER upmixing.
const ch = Number(spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", input], { encoding: "utf8" }).stdout.trim());
const pre = [];
if (ch === 1) pre.push("pan=stereo|c0=c0|c1=c0");
if (o.highpass) pre.push("highpass=f=70");
if (o.denoise) pre.push("afftdn=nr=8:nf=-50");
const chainPre = pre.length ? pre.join(",") + "," : "";

// Pass 1: measure on the cleaned signal.
const p1 = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", input, "-vn", "-af", `${chainPre}loudnorm=I=${o.lufs}:TP=${o.tp}:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const j = (p1.stderr ?? "").match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/);
if (!j) { console.error("loudnorm pass 1 failed:\n" + (p1.stderr ?? "").slice(-1500)); exit(1); }
const m = JSON.parse(j[0]);

// Pass 2: apply with measured values (linear = no pumping).
const filter = `${chainPre}loudnorm=I=${o.lufs}:TP=${o.tp}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,alimiter=limit=${(10 ** (o.tp / 20)).toFixed(4)}:level=disabled`;
const p2 = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-af", filter, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out], { encoding: "utf8" });
if (p2.status !== 0) { console.error("loudnorm pass 2 failed:\n" + p2.stderr); exit(1); }

const before = measureLoudness(input), after = measureLoudness(out);
const verdict = judge(after);
console.log(JSON.stringify({ out, before, after, ok: verdict.ok, problems: verdict.problems }, null, 2));
exit(verdict.ok ? 0 : 2);
