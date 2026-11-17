#!/usr/bin/env node
// Watch a render: sample one frame per second and tile them into contact sheets you can open and read.
// The agent cannot play video; this is the closest honest substitute, and it must run after EVERY render.
//
//   node scripts/watch-render.mjs <video.mp4> [--out-dir <dir>] [--fps 1] [--width 300] [--cols 8] [--rows 3]
//   node scripts/watch-render.mjs <video.mp4> --faces --at 23.5,40,62 [--y 730] [--h 620]   # full-size crops of a band
//
// Output: <out-dir>/sheet-1.png, sheet-2.png, ... (frames in time order, left to right, top to bottom).
// Default out-dir: <project>/review/watch/<name> when the video sits in <project>/renders/, else <video dir>/watch-<name>.
// While reading the sheets check: the full face is clear (no caption bar, panel, or lower-third over the mouth or
// chin), no half-built or blank cards that last more than a beat, no black or white flashes, colour and skin tone.
// --faces crops the band where the face meets the caption bar. The defaults (y 730, h 620) are tuned for the 4:5 layout
// (caption top y=1010, lower-third y=1190); for another format pass --y/--h (see scripts/lib/builder/layout.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const USAGE = "Usage: node scripts/watch-render.mjs <video.mp4> [--out-dir dir] [--fps 1] [--width 300] [--cols 8] [--rows 3] [--faces --at t1,t2 [--y 730] [--h 620]]";
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); const v = i < 0 ? undefined : args[i + 1]; return v === undefined || v.startsWith("--") ? d : v; };
const num = (n, d, min = 0) => {
  const v = Number(flag(n, d));
  if (!Number.isFinite(v) || v < min) { console.error(`--${n} must be a number >= ${min}\n${USAGE}`); process.exit(2); }
  return v;
};
const video = args[0] && !args[0].startsWith("--") ? args[0] : null; // the video path is always the first argument
if (!video || !existsSync(video)) { console.error(USAGE); process.exit(2); }

const src = resolve(video);
const name = basename(src, ".mp4");
const inProject = basename(dirname(src)) === "renders";
const outDir = resolve(flag("out-dir", inProject ? join(dirname(src), "..", "review", "watch", name) : join(dirname(src), `watch-${name}`)));
const fps = num("fps", 1, 0.01), width = num("width", 300, 16), cols = num("cols", 8, 1), rows = num("rows", 3, 1);
mkdirSync(outDir, { recursive: true });
const ff = (a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { stdio: ["ignore", "inherit", "inherit"] });
// A re-run must never leave sheets from an older render of the same name in place: they would be reviewed as current.
const clearOld = (re) => { for (const f of readdirSync(outDir).filter((x) => re.test(x))) rmSync(join(outDir, f)); };

if (args.includes("--faces")) {
  const times = String(flag("at", "")).split(",").map(Number).filter((t) => Number.isFinite(t) && t >= 0);
  if (!times.length) { console.error(`--faces needs --at t1,t2,...\n${USAGE}`); process.exit(2); }
  const y = num("y", 730), h = num("h", 620, 16);
  clearOld(/^face-\d+\.png$|^faces\.png$/);
  const crop = `crop=iw:min(ih\\,${h}):0:max(0\\,min(${y}\\,ih-${h}))`;
  const parts = times.map((t, i) => { const f = join(outDir, `face-${i + 1}.png`); ff(["-ss", String(t), "-i", src, "-frames:v", "1", "-vf", crop, f]); return f; });
  const out = join(outDir, "faces.png");
  ff([...parts.flatMap((p) => ["-i", p]), "-filter_complex", `vstack=inputs=${parts.length}`, "-update", "1", "-frames:v", "1", out]);
  console.log(out);
  process.exit(0);
}

clearOld(/^sheet-\d+\.png$/);
const frames = join(outDir, "frames");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
ff(["-i", src, "-vf", `fps=${fps},scale=${width}:-1`, join(frames, "f%04d.png")]);
const n = readdirSync(frames).filter((f) => f.endsWith(".png")).length;
const per = cols * rows;
const sheets = [];
for (let s = 0; s * per < n; s++) {
  const out = join(outDir, `sheet-${s + 1}.png`);
  ff(["-framerate", "1", "-start_number", String(s * per + 1), "-i", join(frames, "f%04d.png"), "-vf", `tile=${cols}x${rows}`, "-update", "1", "-frames:v", "1", out]);
  sheets.push(out);
}
rmSync(frames, { recursive: true, force: true });
console.log(`${n} frames at ${fps} fps -> ${sheets.length} sheet(s). Open every one:`);
for (const s of sheets) console.log(`  ${s}`);
console.log("Frame k of a sheet is at (sheetIndex*cols*rows + k) / fps seconds. This is sampled stills, not playback.");
