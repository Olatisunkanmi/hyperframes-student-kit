#!/usr/bin/env node
// Stateless resume: read a video project's folder and say which pipeline stages are done and what comes next.
// No conversation memory needed: the files ARE the state.
//
//   node scripts/project-status.mjs <project-dir>        (or: npm run status -- <project-dir>)
//   node scripts/project-status.mjs                      lists every project under video-projects/ with its stage

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (d, p) => existsSync(join(d, p));
const json = (d, p) => { try { return JSON.parse(readFileSync(join(d, p), "utf8")); } catch { return null; } };
const todo = (d, p) => { try { return /TODO/.test(readFileSync(join(d, p), "utf8").replace(/"_help"[^\n]*/, "")); } catch { return true; } };

export function status(dir) {
  const steps = [];
  const add = (name, done, next) => steps.push({ name, done: !!done, next });
  const renders = has(dir, "renders") ? readdirSync(join(dir, "renders")).filter((f) => f.endsWith(".mp4")) : [];
  const latest = renders.map((f) => ({ f, t: statSync(join(dir, "renders", f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
  add("source preserved", has(dir, "assets/raw.mp4"), "node scripts/new-project.mjs <slug> --raw <video>");
  add("transcript (word-level)", has(dir, "assets/raw.json"), "transcribe: scripts/transcribe-elevenlabs.mjs (confirm upload) or scripts/transcribe-local.mjs");
  add("silences trimmed", has(dir, "assets/raw.silence-transcript.json") && has(dir, "assets/silenced.mp4"), "cut-silences.mjs ... --apply");
  add("cut candidates found", has(dir, "assets/raw.cut-candidates.json") && has(dir, "assets/raw.filler-candidates.json"), "find-cut-candidates.mjs and find-fillers.mjs");
  add("cuts approved by the user", has(dir, "assets/approved-cuts.json"), "review candidates WITH the user, write assets/approved-cuts.json (empty cuts list is valid)");
  add("cleaned cut rendered", has(dir, "assets/clean.mp4") && has(dir, "assets/raw.mistakes-transcript.json"), "apply-cuts.mjs ... --apply");
  const vj = has(dir, "video.json") && !todo(dir, "video.json");
  add("video.json filled", vj, "fill video.json (hook words, lower-third words, emphasis); see docs/BUILDER.md");
  add("beats.mjs written", has(dir, "beats.mjs") && /anchors:\s*A/.test(readFileSync(join(dir, "beats.mjs"), "utf8")) && /find\(/.test(readFileSync(join(dir, "beats.mjs"), "utf8").replace(/\/\/.*$/gm, "")), "write beats.mjs: graphics that show what the speaker says; every count-up in `counters`");
  add("built + gated render", !!latest, "node scripts/build-video.mjs <project> --format <ask the user> --sfx --music");
  const verify = has(dir, "VERIFY.md") && !todo(dir, "VERIFY.md");
  add("VERIFY.md written (no TODOs)", verify, "write VERIFY.md: decisions, what was checked, what was NOT (the agent cannot hear audio)");
  const nextStep = steps.find((s) => !s.done);
  return { dir, latestRender: latest ?? null, steps, next: nextStep?.next ?? "all stages done: get the user's review, then final render (--quality standard) and run `npm run stop`" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = argv[2];
  const show = (s) => {
    console.log(`${s.dir.replace(root + "/", "")}${s.latestRender ? `  (latest render: ${s.latestRender})` : ""}`);
    for (const st of s.steps) console.log(`  [${st.done ? "x" : " "}] ${st.name}`);
    console.log(`  NEXT: ${s.next}\n`);
  };
  if (target) { const d = resolve(target); if (!existsSync(d)) { console.error(`no such project: ${d}`); exit(1); } show(status(d)); }
  else {
    const base = join(root, "video-projects");
    const dirs = existsSync(base) ? readdirSync(base).filter((n) => has(join(base, n), "video.json") || has(join(base, n), "assets/raw.mp4")) : [];
    if (!dirs.length) console.log("no branded-video projects yet. Start: node scripts/new-project.mjs <slug> --raw <video>");
    for (const n of dirs) show(status(join(base, n)));
  }
}
