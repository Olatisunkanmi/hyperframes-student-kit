// Review stage: the cheap visual checks that must happen BEFORE the first (slow) render.
//
//   1. Composition stills: `hyperframes snapshot` of every overlay clip (mid and settled end state), the lower-third,
//      bumper, outro and the opening, so overflow, clipping and face coverage are fixed in seconds, not after a render.
//   2. Footage at every editorial join of the cleaned cut (hook in/out, body start, each cut or moved segment):
//      a 1 s frame strip from assets/clean.mp4 plus a luma check that flags occluded/flashed frames
//      (a hand over the lens, a black frame) that only show up in the picture, never in the transcript.
//
// Writes review/prerender/<format>/ (stills, strips/, REVIEW.md) and a stamp. The render stage refuses to run unless
// the stamp matches the current index.html + clean.mp4 AND was written by an earlier invocation: someone has to open
// REVIEW.md between "review" and "render". Changing beats.mjs or the cut makes the stamp stale (re-run compose,review).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const r2 = (n) => +n.toFixed(2);
const LUMA_DEV = 0.25; // a frame this far from the strip's median luma is flagged

export function reviewDir(dir, format) { return join(dir, "review/prerender", format); }

/** Fingerprint of what the render will show: the composition and the cleaned footage. */
export function reviewHash(dir, cfg) {
  const h = createHash("sha256");
  h.update(readFileSync(join(dir, "index.html")));
  const clean = join(dir, cfg.source.clean);
  if (existsSync(clean)) { const s = statSync(clean); h.update(`${s.size}:${s.mtimeMs}`); }
  return h.digest("hex").slice(0, 16);
}

/** Editorial joins on the cleaned timeline: assets/clean.joins.txt if a custom cut wrote one, else the mistakes EDL. */
function editorialJoins(dir, cfg) {
  const txt = join(dir, "assets/clean.joins.txt");
  if (existsSync(txt)) return readFileSync(txt, "utf8").split(/[,\s]+/).filter(Boolean).map(Number);
  const edlPath = join(dir, cfg.source.transcript.replace(/transcript\.json$/, "edl.json"));
  if (!existsSync(edlPath)) return [];
  const keep = JSON.parse(readFileSync(edlPath, "utf8")).keep_ranges ?? [];
  const out = []; let acc = 0;
  for (let i = 0; i < keep.length - 1; i++) { acc += keep[i].end - keep[i].start; out.push(r2(acc)); }
  return out;
}

function lumaFlags(video, t0, dur) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", Math.max(0, t0).toFixed(3), "-i", video, "-t", dur.toFixed(3),
    "-vf", "scale=64:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 8 << 20 });
  const y = [...(r.stdout ?? "").matchAll(/YAVG=([0-9.]+)/g)].map((m) => +m[1]);
  if (!y.length) return { frames: 0, flagged: [] };
  const med = [...y].sort((a, b) => a - b)[Math.floor(y.length / 2)];
  const flagged = y.map((v, i) => ({ t: r2(Math.max(0, t0) + i / 30), v })).filter((f) => Math.abs(f.v - med) / med > LUMA_DEV);
  return { frames: y.length, flagged };
}

export function reviewStage({ dir, cfg, format, HF, sh, runId }) {
  const out = reviewDir(dir, format);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "strips"), { recursive: true });
  const meta = JSON.parse(readFileSync(join(dir, "assets/base.meta.json"), "utf8"));
  const html = readFileSync(join(dir, "index.html"), "utf8");

  // 1. composition stills
  const shots = [{ t: 0.05, why: "first frame" }, { t: 1.0, why: "hook at 1 s" }, { t: Math.max(0.1, meta.H - 0.15), why: "hook settled" }];
  for (const m of html.matchAll(/<div id="([^"]+)"[^>]*class="[^"]*\bclip\b[^"]*"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)" data-track-index="(\d+)"/g)) {
    const [, id, s, d, track] = m; const st = +s, du = +d;
    if (+track >= 20 || ["lt", "bump", "outro"].includes(id)) {
      shots.push({ t: r2(st + du * 0.5), why: `${id} mid` });
      if (du > 1) shots.push({ t: r2(st + du - 0.35), why: `${id} settled` });
    }
  }
  shots.sort((a, b) => a.t - b.t);
  for (let i = shots.length - 1; i > 0; i--) if (shots[i].t - shots[i - 1].t < 0.25) shots.splice(i, 1); // near-duplicates
  const snap = sh(HF, ["snapshot", ".", "-o", join("review/prerender", format), "--at", shots.map((s) => s.t).join(","), "--no-end", "--describe", "false", "--timeout", "15000"], { cwd: dir });
  const snapOk = snap.status === 0;

  // 2. footage at every editorial join
  const clean = join(dir, cfg.source.clean);
  const [HS, HE] = meta.HOOK_SRC;
  const joins = [{ t: HS, why: "hook start (cold open first frame)" }, { t: HE, why: "hook end -> bumper" }, { t: meta.BODY_SRC_START, why: "body start after bumper" },
    ...editorialJoins(dir, cfg).map((t) => ({ t, why: "editorial cut" }))];
  const rows = [];
  joins.forEach((j, i) => {
    const name = `join-${String(i + 1).padStart(2, "0")}-at-${j.t.toFixed(2)}s.jpg`;
    spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, j.t - 0.5).toFixed(3), "-i", clean, "-t", "1", "-vf", "fps=10,scale=160:-1,tile=10x1", "-frames:v", "1", join(out, "strips", name)]);
    const l = lumaFlags(clean, j.t - 0.5, 1);
    rows.push({ ...j, name, flagged: l.flagged });
  });
  const flaggedJoins = rows.filter((r) => r.flagged.length);

  const stamp = { hash: reviewHash(dir, cfg), runId, at: new Date().toISOString(), format, flaggedJoins: flaggedJoins.length };
  writeFileSync(join(out, "stamp.json"), JSON.stringify(stamp, null, 2));
  writeFileSync(join(out, "REVIEW.md"), `# Pre-render review (${format})

Open every image below BEFORE rendering. Fix what is wrong (beats.mjs, the cut), re-run \`--stages compose,review\`
(seconds), and only then \`--stages render,check\`. Times are on the final timeline for stills, the cleaned clip for strips.

## Composition stills (${snapOk ? `${shots.length} frames` : "SNAPSHOT FAILED, see build output"})
Look for: text overflowing its card, cards covering the face or captions, wrong colours/fonts, empty or half-built states.
${shots.map((s) => `- ${s.t}s ${s.why}`).join("\n")}
Contact sheets: contact-sheet*.jpg in this folder.

## Footage at joins (${rows.length} strips, ${flaggedJoins.length} with luma flags)
Each strip is 0.5 s before to 0.5 s after the join at 10 fps. Look for: hands or objects over the lens, black/white flashes,
jump cuts that read as a glitch, the speaker leaving frame. A flag means a frame's brightness is >${LUMA_DEV * 100}% off the strip median.
${rows.map((r) => `- strips/${r.name}  ${r.why}${r.flagged.length ? `  **FLAG: ${r.flagged.length} frames, e.g. ${r.flagged.slice(0, 3).map((f) => `${f.t}s (Y ${f.v.toFixed(0)})`).join(", ")}**` : ""}`).join("\n")}
`);
  return { snapOk, stills: shots.length, strips: rows.length, flaggedJoins, out };
}

/** Render gate: a review of exactly this composition + footage, written by an EARLIER run. */
export function checkReviewStamp({ dir, cfg, format, runId }) {
  const p = join(reviewDir(dir, format), "stamp.json");
  if (!existsSync(p)) return `no pre-render review for ${format}: run --stages review (or compose,review) and inspect review/prerender/${format}/REVIEW.md first`;
  const s = JSON.parse(readFileSync(p, "utf8"));
  if (s.hash !== reviewHash(dir, cfg)) return `pre-render review is stale (index.html or the cleaned cut changed since): re-run --stages compose,review and inspect it`;
  if (s.runId === runId) return `the review was written by this same run, so nobody has looked at it yet: inspect review/prerender/${format}/REVIEW.md, then run --stages render,check`;
  return null;
}
