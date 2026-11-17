#!/usr/bin/env node
// Select the best moments of a long recording from its transcript, review-gated.
//
//   node scripts/select-moments.mjs outline <transcript.json> [--json]
//   node scripts/select-moments.mjs check <selection.json> --transcript <t.json> [--out-dir dir]
//   node scripts/select-moments.mjs approve <selection.resolved.json> --mode stitch|separate
//   node scripts/select-moments.mjs apply <selection.resolved.json> --video <raw.mp4> --transcript <t.json> [--out-dir dir]
//
// outline  prints every sentence with times so moments can be chosen by reading, not guessing.
// check    snaps picks onto word boundaries, lints them, writes SELECTION.md (the review doc) and
//          selection.resolved.json (approved: false). selection.json: { "picks": [ { slug, from, to, reason, hook? } ] }.
// approve  records the user's decision (mode) and binds it to the exact ranges. Run it only AFTER the user approves.
// apply    refuses unless approved and the ranges are unchanged, then cuts:
//            stitch   -> <out-dir>/selected.mp4 + selected.json   (one video, picks in listed order)
//            separate -> <out-dir>/selected-<slug>.mp4 + .json    (one video per pick)
//          The transcript has the same shape as the raw one, so cut-silences and cut-mistakes run on it unchanged.
// The source video is never modified. Nothing is uploaded or published.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { buildFilter, loadWords, picksHash, renderSelectionMd, resolveSelection, retime, sentences } from "./lib/selection.mjs";

const die = (m) => { console.error(m); exit(1); };
const [cmd, ...rest] = argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i === -1 ? null : rest[i + 1]; };
const readJson = (p) => JSON.parse(readFileSync(resolve(p), "utf8"));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const stamp = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

if (!cmd || cmd === "--help") {
  console.log("Usage: node scripts/select-moments.mjs outline|check|approve|apply ... (see the header of this file)");
  exit(cmd ? 0 : 1);
}

if (cmd === "outline") {
  if (!rest[0]) die("outline needs <transcript.json>");
  const words = loadWords(readJson(rest[0]));
  const list = sentences(words);
  if (rest.includes("--json")) console.log(JSON.stringify(list, null, 2));
  else {
    list.forEach((s) => console.log(`#${String(s.index).padStart(3, "0")} [${s.start.toFixed(2)}-${s.end.toFixed(2)}] ${s.text}`));
    console.error(`\n${list.length} sentences, ${stamp(words.at(-1).end)} of speech. Choose self-contained ranges: a hook first, a closed thought last.`);
  }
  exit(0);
}

if (cmd === "check") {
  const transcriptPath = flag("--transcript");
  if (!rest[0] || !transcriptPath) die("check needs <selection.json> --transcript <t.json>");
  const transcript = readJson(transcriptPath);
  const words = loadWords(transcript);
  const result = resolveSelection(words, readJson(rest[0]));
  const outDir = resolve(flag("--out-dir") ?? dirname(resolve(rest[0])));
  mkdirSync(outDir, { recursive: true });
  const hash = picksHash(result.picks);
  const sourceSeconds = Number(transcript.audio_duration_secs) || words.at(-1).end;
  writeFileSync(join(outDir, "SELECTION.md"), renderSelectionMd({ source: resolve(transcriptPath), sourceSeconds, result, hash }));
  writeJson(join(outDir, "selection.resolved.json"), { approved: false, mode: null, hash, transcript: resolve(transcriptPath), sourceSeconds, ...result });
  console.log(`${result.picks.length} picks, ${result.totalSeconds}s of ${stamp(sourceSeconds)}; ${result.errorCount} errors. Review: ${join(outDir, "SELECTION.md")}`);
  exit(result.errorCount ? 2 : 0);
}

if (cmd === "approve") {
  const mode = flag("--mode");
  if (!rest[0] || !["stitch", "separate"].includes(mode)) die("approve needs <selection.resolved.json> --mode stitch|separate");
  const file = resolve(rest[0]);
  const doc = readJson(file);
  if (doc.errorCount) die(`${doc.errorCount} blocking errors: fix the selection and re-run check`);
  if (picksHash(doc.picks) !== doc.hash) die("ranges changed since check: re-run check");
  writeJson(file, { ...doc, approved: true, mode, approvedAt: new Date().toISOString() });
  console.log(`approved: ${doc.picks.length} picks, mode ${mode}, plan ${doc.hash}`);
  exit(0);
}

if (cmd === "apply") {
  const videoPath = flag("--video");
  const transcriptPath = flag("--transcript");
  if (!rest[0] || !videoPath || !transcriptPath) die("apply needs <selection.resolved.json> --video <raw.mp4> --transcript <t.json>");
  const doc = readJson(rest[0]);
  if (!doc.approved || !doc.mode) die("selection is not approved: get the user's approval, then run approve");
  if (picksHash(doc.picks) !== doc.hash) die("ranges changed after check: re-run check and approve again");
  const video = resolve(videoPath);
  if (!existsSync(video)) die(`video not found: ${video}`);
  const words = loadWords(readJson(transcriptPath));
  const outDir = resolve(flag("--out-dir") ?? dirname(resolve(rest[0])));
  mkdirSync(outDir, { recursive: true });
  const jobs = doc.mode === "stitch"
    ? [{ name: "selected", ranges: doc.picks }]
    : doc.picks.map((p) => ({ name: `selected-${p.slug}`, ranges: [p] }));
  const language = readJson(transcriptPath).language_code;
  for (const job of jobs) {
    const output = join(outDir, `${job.name}.mp4`);
    if (resolve(output) === video) die("output must differ from the source video");
    const ff = spawnSync("ffmpeg", ["-y", "-i", video, "-filter_complex", buildFilter(job.ranges), "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output],
    { stdio: ["ignore", "ignore", "inherit"] });
    if (ff.status !== 0) die(`ffmpeg failed for ${job.name} (status ${ff.status})`);
    const parts = retime(words, job.ranges, "stitch");
    const total = parts.reduce((s, p) => s + p.seconds, 0);
    writeJson(join(outDir, `${job.name}.json`), {
      language_code: language,
      audio_duration_secs: Number(total.toFixed(3)),
      produced_by: "select-moments",
      picks: job.ranges.map((r) => ({ slug: r.slug, source_start: r.start, source_end: r.end })),
      words: parts.flatMap((p) => p.words),
    });
    console.log(`${job.name}: ${job.ranges.length} range(s), ${total.toFixed(1)}s -> ${output}`);
  }
  console.log(doc.mode === "stitch"
    ? "Next: new-project with --raw selected.mp4, copy selected.json to assets/raw.json, then cut-silences and cut-mistakes as usual."
    : "Next: one new-project per selected-<slug>.mp4 (copy its .json to that project's assets/raw.json), then cut-silences and cut-mistakes.");
  exit(0);
}

die(`unknown command: ${cmd}`);
