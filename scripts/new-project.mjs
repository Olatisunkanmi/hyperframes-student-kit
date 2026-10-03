#!/usr/bin/env node
// Scaffold a branded-video project that scripts/build-video.mjs can build.
//
//   node scripts/new-project.mjs <slug> --raw <path/to/raw.mp4> [--dest <parent-dir>]
//   npm run new-project -- my-video --raw ~/Movies/IMG_1234.mp4
//
// Creates video-projects/<slug>/ with: assets/raw.mp4 (a COPY: your original is never touched), gsap, hyperframes.json,
// meta.json, DESIGN.md (points at brand/), video.json + beats.mjs (from templates/brand-video, with TODOs), VERIFY.md,
// and the working folders. Then prints the exact next commands. Refuses to overwrite an existing project.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Usage: node scripts/new-project.mjs <lowercase-slug> --raw <video file> [--dest <parent dir>]");
  exit(args.length ? 0 : 1);
}
let slug = null, raw = null, dest = join(root, "video-projects");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--raw") raw = args[++i];
  else if (args[i] === "--dest") dest = resolve(args[++i]);
  else if (args[i].startsWith("--")) { console.error(`unknown option: ${args[i]}`); exit(1); }
  else slug = args[i];
}
const die = (m) => { console.error(m); exit(1); };
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) die("Use a lowercase kebab-case slug, e.g. emr-explainer");
if (!raw) die("--raw <video file> is required (the original recording; it is copied, never moved)");
const rawPath = resolve(raw.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
if (!existsSync(rawPath) || !statSync(rawPath).isFile()) die(`raw video not found: ${rawPath}`);
const projectDir = join(dest, slug);
if (existsSync(projectDir)) die(`Project already exists: ${projectDir}. Pick a new slug.`);
const gsap = join(root, "node_modules/gsap/dist/gsap.min.js");
if (!existsSync(gsap)) die("Run npm ci in the kit root first (gsap missing).");

for (const d of ["assets", "compositions", "renders", "review"]) mkdirSync(join(projectDir, d), { recursive: true });
copyFileSync(rawPath, join(projectDir, "assets/raw.mp4"));
copyFileSync(gsap, join(projectDir, "assets/gsap.min.js"));
copyFileSync(join(root, "examples/starter/hyperframes.json"), join(projectDir, "hyperframes.json"));
writeFileSync(join(projectDir, "meta.json"), JSON.stringify({ id: slug, name: slug, width: 1080, height: 1350, fps: 30 }, null, 2) + "\n");
writeFileSync(join(projectDir, "DESIGN.md"), `# ${slug}\n\nVisual identity: see ../../brand/BRAND.md and ../../brand/brand.json (tokens, fonts, captions, lower-third, hook-first order, bumper, outro).\nDo not use colours or fonts outside the brand file. Format is chosen per video (ask the user); record it in VERIFY.md.\n`);
const vj = readFileSync(join(root, "templates/brand-video/video.json"), "utf8").replace("TODO-slug", slug);
writeFileSync(join(projectDir, "video.json"), vj);
copyFileSync(join(root, "templates/brand-video/beats.mjs"), join(projectDir, "beats.mjs"));
writeFileSync(join(projectDir, "VERIFY.md"), readFileSync(join(root, "templates/brand-video/VERIFY.md"), "utf8").replaceAll("TODO-slug", slug));

const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "default=nw=1", rawPath], { encoding: "utf8" }).stdout.trim().replace(/\n/g, "  ");
const rel = (p) => p.replace(root + "/", "");
console.log(`created ${rel(projectDir)}\n  source copy: assets/raw.mp4 (original untouched at ${rawPath})\n  probe: ${probe}\n`);
console.log(`Next (see the studio-edit skill):
  1. transcribe     node scripts/transcribe-elevenlabs.mjs ${rel(projectDir)}/assets/raw.mp4 --no-diarize   (confirm the upload first; or scripts/transcribe-local.mjs, free)
  2. silences       node .claude/skills/cut-silences/scripts/cut-silences.mjs ${rel(projectDir)}/assets/raw.json --video ${rel(projectDir)}/assets/raw.mp4 --out-dir ${rel(projectDir)}/assets --output ${rel(projectDir)}/assets/silenced.mp4 --apply
  3. candidates     node .claude/skills/cut-mistakes/scripts/find-cut-candidates.mjs ${rel(projectDir)}/assets/raw.silence-transcript.json --out-dir ${rel(projectDir)}/assets
                    node .claude/skills/cut-mistakes/scripts/find-fillers.mjs ${rel(projectDir)}/assets/raw.silence-transcript.json --out-dir ${rel(projectDir)}/assets
  4. review cuts WITH the user, write assets/approved-cuts.json, then apply-cuts.mjs -> assets/clean.mp4
  5. fill video.json + beats.mjs, then: node scripts/build-video.mjs ${rel(projectDir)} --format <ask the user> --sfx --music
  Resume any time: node scripts/project-status.mjs ${rel(projectDir)}`);
