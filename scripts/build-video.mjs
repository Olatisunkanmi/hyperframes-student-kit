#!/usr/bin/env node
// Reusable video builder: cleaned cut + video.json + beats.mjs -> branded, gated render.
//
//   node scripts/build-video.mjs <project-dir> --format 4x5|9x16 [--sfx] [--music]
//        [--stages base,compose,audio,review,render,check] [--quality draft|standard|high] [--tag v2] [--out name.mp4] [--skip-review]
//
// --format is REQUIRED: ask the user which platform/format the video is for (never assume). See docs/BUILDER.md.
//
// Stages (default: all, in this order)
//   base     hook + bumper gap + cleaned video + outro slot -> assets/base*.mp4, voice.wav, base.meta.json
//   compose  index.html, final-timeline transcript, sound cues (counter ticks included)
//   audio    voice master (-16 LUFS stereo), SFX stem (--sfx), music bed (--music)
//   review   pre-render stills of every graphic + frame strips/luma flags at every join -> review/prerender/<format>/REVIEW.md
//   render   hyperframes lint (must be 0 errors) + render to renders/<slug>-<format>-<draft|final>[-tag].mp4
//            REFUSES unless a review of this exact composition + cut was written by an EARLIER run (see lib/builder/review.mjs)
//   check    preflight + audio-check (final loudness) on that render
// The default run stops after review: inspect REVIEW.md, fix, then `--stages render,check`. This keeps every slow render
// for a composition that has already been looked at. --skip-review bypasses the gate (say so in VERIFY.md).
// With "all", compose runs twice: once to write the cues, again to mount the audio stems.
// Exit code 1 when any gate fails.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { layoutFor } from "./lib/builder/layout.mjs";
import { loadProject } from "./lib/builder/timeline.mjs";
import { buildBase } from "./lib/builder/base.mjs";
import { compose } from "./lib/builder/compose.mjs";
import { audioStage } from "./lib/builder/audio.mjs";
import { checkReviewStamp, reviewStage } from "./lib/builder/review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Usage: node scripts/build-video.mjs <project-dir> --format 4x5|9x16 [--sfx] [--music] [--stages a,b] [--quality draft|standard|high] [--tag t] [--out file.mp4] [--skip-review]");
  exit(args.length ? 0 : 1);
}
const o = { dir: null, format: null, sfx: false, music: false, stages: "base,compose,audio,compose,review", quality: "draft", tag: null, out: null, skipReview: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--format") o.format = args[++i];
  else if (a === "--sfx") o.sfx = true;
  else if (a === "--music") o.music = true;
  else if (a === "--stages") o.stages = args[++i];
  else if (a === "--quality") o.quality = args[++i];
  else if (a === "--tag") o.tag = args[++i];
  else if (a === "--out") o.out = args[++i];
  else if (a === "--skip-review") o.skipReview = true;
  else if (a.startsWith("--")) { console.error(`unknown option: ${a}`); exit(1); }
  else o.dir = a;
}
const fail = (m) => { console.error(m); exit(1); };
if (!o.dir) fail("need a project directory");
try { layoutFor(o.format); } catch (e) { fail(e.message); }
const dir = resolve(o.dir);
const cfg = loadProject(dir);
const stages = o.stages === "all" ? ["base", "compose", "audio", "compose", "review", "render", "check"] : o.stages.split(",");
const runId = `${process.pid}-${Date.now()}`;
const outName = o.out ?? `${cfg.slug}-${o.format}-${o.quality === "draft" ? "draft" : "final"}${o.tag ? `-${o.tag}` : ""}.mp4`;
const outPath = join(dir, "renders", outName);
// Always use the kit's pinned HyperFrames, never whatever `npx` resolves for a project outside the repo.
const HF = join(root, "node_modules/.bin", process.platform === "win32" ? "hyperframes.cmd" : "hyperframes");
if (!existsSync(HF)) { console.error("hyperframes not installed: run npm ci in the kit root"); exit(1); }
const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" && cmd === HF, ...opts }); // Windows needs a shell for .cmd shims
const clean = (s) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
let failed = false;
const say = (s) => console.log(s);

for (const [i, stage] of stages.entries()) {
  const t0 = Date.now();
  if (stage === "base") {
    const m = buildBase(dir, cfg);
    say(`base     ok  hook ${m.H}s + bumper ${m.BUMPER}s + body + outro ${m.OUTRO}s = ${m.TOTAL}s`);
  } else if (stage === "compose") {
    // mount existing stems whenever this composition is headed for review or render (compose only mounts files that exist)
    const final = stages.slice(i + 1).some((s) => s === "render" || s === "review") || stages.slice(0, i).includes("audio");
    const r = await compose({ dir, root, cfg, format: o.format, sfx: o.sfx && final, music: o.music && final });
    say(`compose  ok  ${r.size} ${r.format}; ${r.counters.length} counters, ${r.cues} sound cues${r.sfx ? ", sfx mounted" : ""}${r.music ? ", music mounted" : ""}`);
    const motionErrors = r.motion.filter((f) => f.level === "error");
    if (r.motion.length) say(`motion   ${motionErrors.length ? "FAIL" : "warn"} ${motionErrors.length} errors, ${r.motion.length - motionErrors.length} warnings -> review/motion-review.md`);
    for (const f of r.motion) say(`         ${f.level.toUpperCase()} ${f.rule}: ${f.message}`);
    if (motionErrors.length) failed = true;
  } else if (stage === "audio") {
    const log = audioStage({ dir, root, cfg, sfx: o.sfx, music: o.music });
    const m = log[0];
    say(`audio    ${m.ok ? "ok " : "FAIL"} voice master ${m.before.lufs} -> ${m.after.lufs} LUFS, true peak ${m.after.truePeak} dBFS${o.sfx ? "; sfx stem" : ""}${o.music ? "; music bed" : ""}`);
    if (!m.ok) failed = true;
  } else if (stage === "review") {
    const rv = reviewStage({ dir, cfg, format: o.format, HF, sh, runId });
    say(`review   ${rv.snapOk ? "ok " : "FAIL"} ${rv.stills} stills, ${rv.strips} join strips, ${rv.flaggedJoins.length} joins with luma flags -> ${rv.out.replace(dir + "/", "")}/REVIEW.md`);
    for (const f of rv.flaggedJoins) say(`         FLAG ${f.name}: ${f.flagged.length} frames off-brightness (${f.why})`);
    if (!rv.snapOk) failed = true;
  } else if (stage === "render") {
    const gate = o.skipReview ? null : checkReviewStamp({ dir, cfg, format: o.format, runId });
    if (gate) { say(`render   BLOCKED ${gate}`); failed = true; continue; }
    const motionFile = join(dir, "review/motion-review.json");
    const motionBlock = existsSync(motionFile) ? JSON.parse(readFileSync(motionFile, "utf8")).filter((f) => f.level === "error") : [];
    if (motionBlock.length) { say(`render   BLOCKED ${motionBlock.length} motion review errors in review/motion-review.md: fix beats.mjs (or list the rule in allow with a reason in PLAN.md) and re-run --stages compose,review`); failed = true; continue; }
    if (o.skipReview) say("render   WARNING pre-render review skipped (--skip-review); record that in VERIFY.md");
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
const rendered = stages.includes("render");
if (!rendered && stages.includes("review") && !failed) {
  say(`\nNot rendered yet. Open review/prerender/${o.format}/REVIEW.md and every image it lists, fix what is wrong`);
  say(`(beats.mjs or the cut; then --stages compose,review), and only then: --stages render,check`);
  exit(0);
}
say(failed ? "\nGATES FAILED" : `\nall gates passed -> ${outPath}`);
say("Reminder: gates are signal checks. A human still has to listen (see scripts/audio-joins.mjs) and watch the draft.");
exit(failed ? 1 : 0);
