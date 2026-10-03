#!/usr/bin/env node
// Reusable video builder: cleaned cut + video.json + beats.mjs -> branded, gated render.
//
//   node scripts/build-video.mjs <project-dir> --format 4x5|9x16 [--sfx] [--music]
//        [--stages base,compose,audio,render,check] [--quality draft|standard] [--tag v2] [--out name.mp4]
//
// --format is REQUIRED: ask the user which platform/format the video is for (never assume). See docs/BUILDER.md.
//
// Stages (default: all, in this order)
//   base     hook + bumper gap + cleaned video + outro slot -> assets/base*.mp4, voice.wav, base.meta.json
//   compose  index.html, final-timeline transcript, sound cues (counter ticks included)
//   audio    voice master (-16 LUFS stereo), SFX stem (--sfx), music bed (--music)
//   render   hyperframes lint (must be 0 errors) + render to renders/<slug>-<format>-<draft|final>[-tag].mp4
//   check    preflight + audio-check (final loudness) on that render
// With "all", compose runs twice: once to write the cues, again to mount the audio stems.
// Exit code 1 when any gate fails.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { layoutFor } from "./lib/builder/layout.mjs";
import { loadProject } from "./lib/builder/timeline.mjs";
import { buildBase } from "./lib/builder/base.mjs";
import { compose } from "./lib/builder/compose.mjs";
import { audioStage } from "./lib/builder/audio.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Usage: node scripts/build-video.mjs <project-dir> --format 4x5|9x16 [--sfx] [--music] [--stages a,b] [--quality draft|standard] [--tag t] [--out file.mp4]");
  exit(args.length ? 0 : 1);
}
const o = { dir: null, format: null, sfx: false, music: false, stages: "base,compose,audio,compose,render,check", quality: "draft", tag: null, out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--format") o.format = args[++i];
  else if (a === "--sfx") o.sfx = true;
  else if (a === "--music") o.music = true;
  else if (a === "--stages") o.stages = args[++i];
  else if (a === "--quality") o.quality = args[++i];
  else if (a === "--tag") o.tag = args[++i];
  else if (a === "--out") o.out = args[++i];
  else if (a.startsWith("--")) { console.error(`unknown option: ${a}`); exit(1); }
  else o.dir = a;
}
const fail = (m) => { console.error(m); exit(1); };
if (!o.dir) fail("need a project directory");
try { layoutFor(o.format); } catch (e) { fail(e.message); }
const dir = resolve(o.dir);
const cfg = loadProject(dir);
const stages = o.stages === "all" ? ["base", "compose", "audio", "compose", "render", "check"] : o.stages.split(",");
const outName = o.out ?? `${cfg.slug}-${o.format}-${o.quality === "draft" ? "draft" : "final"}${o.tag ? `-${o.tag}` : ""}.mp4`;
const outPath = join(dir, "renders", outName);
// Always use the kit's pinned HyperFrames, never whatever `npx` resolves for a project outside the repo.
const HF = join(root, "node_modules/.bin/hyperframes");
if (!existsSync(HF)) { console.error("hyperframes not installed: run npm ci in the kit root"); exit(1); }
const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
const clean = (s) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
let failed = false;
const say = (s) => console.log(s);

for (const [i, stage] of stages.entries()) {
  const t0 = Date.now();
  if (stage === "base") {
    const m = buildBase(dir, cfg);
    say(`base     ok  hook ${m.H}s + bumper ${m.BUMPER}s + body + outro ${m.OUTRO}s = ${m.TOTAL}s`);
  } else if (stage === "compose") {
    const final = stages.slice(i + 1).includes("render") || stages.slice(0, i).includes("audio");
    const r = await compose({ dir, root, cfg, format: o.format, sfx: o.sfx && final, music: o.music && final });
    say(`compose  ok  ${r.size} ${r.format}; ${r.counters.length} counters, ${r.cues} sound cues${r.sfx ? ", sfx mounted" : ""}${r.music ? ", music mounted" : ""}`);
  } else if (stage === "audio") {
    const log = audioStage({ dir, root, cfg, sfx: o.sfx, music: o.music });
    const m = log[0];
    say(`audio    ${m.ok ? "ok " : "FAIL"} voice master ${m.before.lufs} -> ${m.after.lufs} LUFS, true peak ${m.after.truePeak} dBFS${o.sfx ? "; sfx stem" : ""}${o.music ? "; music bed" : ""}`);
    if (!m.ok) failed = true;
  } else if (stage === "render") {
    const lint = sh(HF, ["lint"], { cwd: dir });
    const lt = clean(lint.stdout + lint.stderr);
    const errs = Number((lt.match(/(\d+)\s+error/) ?? [0, 0])[1]);
    say(`lint     ${errs === 0 ? "ok " : "FAIL"} ${(lt.match(/\d+ error\(?s?\)?, \d+ warning\(?s?\)?/) ?? ["?"])[0]}`);
    if (errs > 0) { console.log(lt); failed = true; continue; }
    mkdirSync(join(dir, "renders"), { recursive: true });
    const rr = sh(HF, ["render", "--quality", o.quality, "--workers", "2", "--output", join("renders", outName)], { cwd: dir });
    const rt = clean(rr.stdout + rr.stderr);
    if (rr.status !== 0 || !existsSync(outPath)) { console.log(rt.slice(-1500)); fail("render FAILED"); }
    say(`render   ok  ${outPath} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } else if (stage === "check") {
    const pf = sh(process.execPath, [join(root, "scripts/preflight.mjs"), dir]);
    const pft = clean(pf.stdout);
    say(`preflight ${pf.status === 0 ? "ok " : "FAIL"} ${(pft.match(/◇[^\n]*/) ?? [""])[0].trim()}`);
    if (pf.status !== 0) { console.log(pft); failed = true; }
    const ac = sh(process.execPath, [join(root, "scripts/audio-check.mjs"), outPath]);
    say(`loudness ${ac.status === 0 ? "ok " : "FAIL"} ${clean(ac.stdout).trim().replace(dir + "/", "")}`);
    if (ac.status !== 0) failed = true;
  } else fail(`unknown stage "${stage}"`);
}
say(failed ? "\nGATES FAILED" : `\nall gates passed -> ${outPath}`);
say("Reminder: gates are signal checks. A human still has to listen (see scripts/audio-joins.mjs) and watch the draft.");
exit(failed ? 1 : 0);
