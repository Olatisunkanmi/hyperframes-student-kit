#!/usr/bin/env node
// Simple, gentle colour grade for a project's cleaned cut. Run it BEFORE build-video, once per video,
// and AGAIN after any change to the cuts (apply-cuts rewrites assets/clean.mp4; a stale clean-graded.mp4 would show old cuts).
//
//   node scripts/grade-clean.mjs <project> --preview            # before/after still of 3 frames, writes nothing else
//   node scripts/grade-clean.mjs <project>                      # writes assets/clean-graded.mp4 and points video.json at it
//   node scripts/grade-clean.mjs <project> --temp 5600 --contrast 1.05 --saturation 0.92 [--no-lut]
//
// Recipe (defaults, tuned on warm indoor talking-head footage): luts/soft-pastel-cinematic-subtle.cube, a slightly cooler white
// balance (6500 K neutral; 5600 cools a warm orange cast), a touch of contrast, saturation 0.92 to calm a hot red shirt.
// Always look at the --preview before applying; skin tone must stay natural. assets/clean.mp4 is kept untouched.
// See luts/README.md for the LUT itself.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "Usage: node scripts/grade-clean.mjs <project> [--preview] [--temp 5600] [--contrast 1.05] [--saturation 0.92] [--no-lut]";
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); const v = i < 0 ? undefined : args[i + 1]; return v === undefined || v.startsWith("--") ? d : v; };
const num = (n, d) => {
  const v = Number(flag(n, d));
  if (!Number.isFinite(v) || v <= 0) { console.error(`--${n} must be a positive number\n${USAGE}`); process.exit(2); }
  return v;
};
const dir = args[0] && !args[0].startsWith("--") ? args[0] : null; // the project path is always the first argument
if (!dir || !existsSync(join(dir, "video.json"))) { console.error(USAGE); process.exit(2); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proj = resolve(dir);
const cfg = JSON.parse(readFileSync(join(proj, "video.json"), "utf8"));
const input = join(proj, "assets/clean.mp4");
if (!existsSync(input)) { console.error(`missing ${input}: run the cuts first`); process.exit(1); }

// ffmpeg runs with cwd = repo root and a RELATIVE LUT path, so spaces or ':' ',' in the repo path never reach the filtergraph.
const filters = [];
if (!args.includes("--no-lut")) filters.push("lut3d=file=luts/soft-pastel-cinematic-subtle.cube:interp=tetrahedral");
filters.push(`colortemperature=temperature=${num("temp", 5600)}`, `eq=contrast=${num("contrast", 1.05)}:saturation=${num("saturation", 0.92)}`);
const vf = filters.join(",");
const ff = (a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });

if (args.includes("--preview")) {
  mkdirSync(join(proj, "review"), { recursive: true });
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]).toString());
  const ts = [0.1, 0.5, 0.9].map((p) => (dur * p).toFixed(2));
  const parts = [];
  for (const [i, t] of ts.entries()) {
    const b = join(proj, `review/grade-b${i}.png`), a = join(proj, `review/grade-a${i}.png`);
    ff(["-ss", t, "-i", input, "-frames:v", "1", "-vf", "scale=360:-1", b]);
    ff(["-ss", t, "-i", input, "-frames:v", "1", "-vf", `${vf},scale=360:-1`, a]);
    parts.push([b, a]);
  }
  const out = join(proj, "review/grade-preview.png");
  ff([...parts.flatMap(([b]) => ["-i", b]), ...parts.flatMap(([, a]) => ["-i", a]), "-filter_complex", "[0][1][2]hstack=3[t];[3][4][5]hstack=3[b];[t][b]vstack", "-update", "1", "-frames:v", "1", out]);
  console.log(`before (top) / after (bottom): ${out}\nOpen it. If skin looks off, lower --saturation / raise --temp, or pass --no-lut.`);
  process.exit(0);
}

const output = join(proj, "assets/clean-graded.mp4");
ff(["-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output]);
cfg.source = { ...cfg.source, clean: "assets/clean-graded.mp4" };
writeFileSync(join(proj, "video.json"), JSON.stringify(cfg, null, 2) + "\n");
console.log(`graded -> ${output}\nvideo.json source.clean now points at it. Record the recipe in VERIFY.md: ${vf}`);
