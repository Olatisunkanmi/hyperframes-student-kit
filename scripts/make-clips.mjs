#!/usr/bin/env node
// Clip harvester: cut standalone short clips out of the ORIGINAL recordings of a finished video.
// Light treatment only: trim to spoken words, tighten long pauses, crop to the format, brand captions, voice master (-16 LUFS).
//
//   node scripts/make-clips.mjs <clips.json> [--only slug,slug] [--list <transcript.json>]
//
// clips.json (paths relative to the file):
//   { "format": "4x5", "transcriptDir": "takes", "videoDir": ".", "outDir": "clips", "gapMax": 0.55, "emphasis": ["500"],
//     "clips": [ { "slug": "filing-cabinet", "title": "...", "parts": [ { "src": "IMG_9216", "from": 3.5, "to": 20.6, "drop": [[27.45, 27.85]] } ] } ] }
//   part.src = clip id: <videoDir>/<src>.mov (or .mp4) and <transcriptDir>/<src>.json. from/to/drop are source seconds.
// Words inside [from, to] (minus drop ranges) are kept; a gap longer than gapMax between kept words is cut out.
// Nothing is uploaded or published. Needs: ffmpeg, puppeteer-core + the cached headless Chrome, brand/ files.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { captionGroups, normWord } from "./lib/builder/timeline.mjs";
import { LAYOUTS } from "./lib/builder/layout.mjs";
import { measureLoudness, judge } from "./lib/loudness.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = argv.slice(2);
if (!args.length || args.includes("--help")) { console.log("Usage: node scripts/make-clips.mjs <clips.json> [--only slug,slug] | --list <transcript.json>"); exit(args.length ? 0 : 1); }

const wordsOf = (file) => JSON.parse(readFileSync(file, "utf8")).words.filter((w) => (w.type ?? "word") === "word");
const sh = (cmd, a, o = {}) => { const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...o }); if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || "").split("\n").slice(-6).join("\n")}`); return r; };

// --list: print sentences with times so clips can be chosen
if (args[0] === "--list") {
  const w = wordsOf(args[1]); let s = null, line = [];
  for (const x of w) { s ??= x.start; line.push(x.text); if (/[.?!]$/.test(x.text)) { console.log(`[${s.toFixed(2)}-${x.end.toFixed(2)}] ${line.join(" ")}`); s = null; line = []; } }
  if (line.length) console.log(`[${s.toFixed(2)}-${w.at(-1).end.toFixed(2)}] ${line.join(" ")}`);
  exit(0);
}

const specPath = resolve(args[0]); const base = dirname(specPath);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const layout = LAYOUTS[spec.format ?? "4x5"]; if (!layout) throw new Error(`unknown format ${spec.format}`);
const brand = JSON.parse(readFileSync(join(ROOT, "brand/brand.json"), "utf8"));
const gapMax = spec.gapMax ?? 0.55, padIn = 0.1, padInAfterDrop = 0.04, padOut = 0.16, tail = 0.25;
const cropY = spec.crop4x5Y ?? 160;
const outDir = resolve(base, spec.outDir ?? "clips"); const work = join(outDir, ".work"); mkdirSync(work, { recursive: true });
const emph = new Set((spec.emphasis ?? []).map(normWord));

function chromePath() {
  const dirs = [join(homedir(), ".cache/puppeteer/chrome-headless-shell"), join(homedir(), ".cache/hyperframes/chrome")];
  for (const d of dirs) if (existsSync(d)) { const f = spawnSync("find", [d, "-type", "f", "(", "-name", "chrome-headless-shell", "-o", "-name", "Google Chrome for Testing", ")"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean); if (f.length) return f[0]; }
  throw new Error("no cached headless Chrome found (run `npx hyperframes doctor`)");
}

/** words of one part -> segments [{src,start,end,words}] split at long gaps and drop ranges */
function segmentsOf(part) {
  const words = wordsOf(join(base, spec.transcriptDir ?? "takes", `${part.src}.json`));
  const inDrop = (w) => (part.drop ?? []).some(([a, b]) => w.start < b && w.end > a);
  const kept = []; let afterDrop = false;
  for (const w of words) {
    if (w.start < part.from - 0.02 || w.end > part.to + 0.02) continue;
    if (inDrop(w)) { afterDrop = true; continue; }
    kept.push({ ...w, brk: afterDrop }); afterDrop = false;
  }
  if (!kept.length) throw new Error(`${part.src}: no words in ${part.from}-${part.to}`);
  const groups = []; let cur = [];
  kept.forEach((w, i) => { const p = kept[i - 1]; if (p && (w.brk || w.start - p.end > gapMax)) { groups.push(cur); cur = []; } cur.push(w); });
  groups.push(cur);
  return groups.map((g, i) => {
    const first = g[0], last = g.at(-1);
    let start = Math.max(0, first.start - (first.brk ? padInAfterDrop : padIn)); let end = last.end + (i === groups.length - 1 ? tail : padOut);
    const nxt = groups[i + 1]; if (nxt) end = Math.min(end, (last.end + nxt[0].start) / 2 + 0.02);
    const prv = groups[i - 1]; if (prv) start = Math.max(start, (prv.at(-1).end + first.start) / 2 - 0.02);
    return { src: part.src, start: +start.toFixed(3), end: +end.toFixed(3), words: g };
  });
}

function findVideo(id) { for (const ext of [".mov", ".mp4", ".MOV"]) { const p = join(base, spec.videoDir ?? ".", id + ext); if (existsSync(p)) return p; } throw new Error(`no video for ${id}`); }

async function renderCaptions(groups, dir, puppeteer) {
  const font = (f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url('file://${join(ROOT, "brand", f.file)}') format('woff2')}`;
  const css = `${font(brand.fonts.caption)}*{margin:0;padding:0;box-sizing:border-box}html,body{width:${layout.W}px;height:${layout.H}px;background:transparent;font-family:'Inter',Arial,sans-serif}
#c{position:absolute;left:90px;width:900px;top:${layout.capTop}px;display:flex;justify-content:center}
.b{background:rgba(10,22,40,.95);border-radius:18px;padding:14px 30px 16px;color:#fff;font-weight:600;font-size:54px;line-height:1.15;text-align:center}.w{white-space:nowrap}.ac{color:${brand.colors.amber}}`;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.setViewport({ width: layout.W, height: layout.H, deviceScaleFactor: 1 });
  const shot = async (inner, file) => { await page.setContent(`<style>${css}</style><div id="c">${inner}</div>`); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: file, omitBackground: true }); };
  await shot("", join(dir, "blank.png"));
  for (let i = 0; i < groups.length; i++) await shot(`<div class="b">${groups[i].words.map((w) => `<span class="w${emph.has(normWord(w.text)) ? " ac" : ""}">${w.text.replace(/[.,:]$/, "")}</span>`).join(" ")}</div>`, join(dir, `cap-${i}.png`));
  await browser.close();
}

async function makeClip(clip, puppeteer) {
  const dir = join(work, clip.slug); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const segs = clip.parts.flatMap(segmentsOf);
  // 1) encode each segment (crop + short audio fades), 2) concat
  const vf = `scale=${layout.W}:1920:flags=lanczos,${layout.H < 1920 ? `crop=${layout.W}:${layout.H}:0:${cropY},` : ""}fps=30`;
  const list = []; let t = 0; const timed = [];
  segs.forEach((s, i) => {
    const d = +(s.end - s.start).toFixed(3); const f = join(dir, `seg-${i}.mp4`);
    sh("ffmpeg", ["-v", "error", "-y", "-ss", String(s.start), "-t", String(d), "-i", findVideo(s.src), "-vf", vf, "-af", `afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, d - 0.02)}:d=0.02,aresample=48000`, "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", f]);
    list.push(`file '${f}'`);
    for (const w of s.words) timed.push({ text: w.text, start: +(t + w.start - s.start).toFixed(3), end: +(t + w.end - s.start).toFixed(3), part: "body" });
    t += d;
  });
  writeFileSync(join(dir, "list.txt"), list.join("\n"));
  const joined = join(dir, "joined.mp4"); sh("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-c", "copy", joined]);
  const total = +sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", joined]).stdout.trim();
  // 3) voice master
  const master = join(dir, "voice.wav"); sh("node", [join(ROOT, "scripts/audio-master.mjs"), joined, "--out", master], { cwd: ROOT });
  // 4) captions
  const groups = captionGroups(timed, total); await renderCaptions(groups, dir, puppeteer);
  const cl = []; let at = 0;
  groups.forEach((g, i) => { if (g.start > at + 0.01) cl.push(`file 'blank.png'\nduration ${(g.start - at).toFixed(3)}`); cl.push(`file 'cap-${i}.png'\nduration ${(g.end - g.start).toFixed(3)}`); at = g.end; });
  cl.push(`file 'blank.png'\nduration ${Math.max(0.05, total - at).toFixed(3)}`, `file 'blank.png'`);
  writeFileSync(join(dir, "caps.txt"), cl.join("\n"));
  const out = join(outDir, `${clip.slug}-${spec.format ?? "4x5"}.mp4`);
  sh("ffmpeg", ["-v", "error", "-y", "-i", joined, "-f", "concat", "-safe", "0", "-i", join(dir, "caps.txt"), "-i", master, "-filter_complex", "[1:v]fps=30,format=rgba[c];[0:v][c]overlay=0:0:format=auto:eof_action=pass[v]", "-map", "[v]", "-map", "2:a", "-t", String(total), "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  // 5) join strip for review: frame 0.05s before and after every cut
  const cuts = []; let c = 0; segs.slice(0, -1).forEach((s) => { c += s.end - s.start; cuts.push(c); });
  writeFileSync(join(dir, "cuts.json"), JSON.stringify(cuts));
  if (cuts.length) {
    const sel = cuts.flatMap((x) => [Math.max(0, x - 0.04), x + 0.04]).map((x) => `eq(n\\,${Math.round(x * 30)})`).join("+");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", out, "-vf", `select='${sel}',scale=216:-1,tile=${Math.min(cuts.length * 2, 12)}x${Math.ceil((cuts.length * 2) / 12)}`, "-frames:v", "1", join(outDir, `${clip.slug}-joins.png`)]);
  }
  const m = measureLoudness(out); const j = judge(m);
  writeFileSync(join(outDir, `${clip.slug}-transcript.md`), `# ${clip.title ?? clip.slug}\n\n${timed.map((w) => w.text).join(" ")}\n`);
  return { slug: clip.slug, title: clip.title, seconds: +total.toFixed(1), joins: cuts.length, lufs: m.lufs, tp: m.truePeak, ok: j.ok, problems: j.problems, file: out };
}

const puppeteer = require("puppeteer-core");
const results = [];
for (const clip of spec.clips) {
  if (only && !only.includes(clip.slug)) continue;
  try { const r = await makeClip(clip, puppeteer); results.push(r); console.log(`${r.ok ? "ok  " : "FAIL"} ${r.slug}  ${r.seconds}s  joins ${r.joins}  ${r.lufs} LUFS  TP ${r.tp}${r.ok ? "" : "  " + r.problems.join("; ")}`); }
  catch (e) { console.error(`ERR  ${clip.slug}: ${e.message}`); results.push({ slug: clip.slug, ok: false, problems: [e.message] }); }
}
writeFileSync(join(outDir, "clips-report.json"), JSON.stringify(results, null, 2));
exit(results.every((r) => r.ok) ? 0 : 1);
