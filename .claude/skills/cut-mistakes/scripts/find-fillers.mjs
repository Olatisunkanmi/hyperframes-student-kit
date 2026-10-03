#!/usr/bin/env node
// Agent 2b — Filler-word candidate finder
// Scans a word-level transcript for spoken filler words and proposes cut ranges.
//   - "certain" fillers (um, uh, er, ah, hmm...) are never content: recommend cut.
//   - "contextual" fillers (you know, I mean, basically, like...) are often real
//     speech: recommend review, and only flag them in filler-like positions.
//
// MECHANICAL detection only. The agent reviews every candidate in context, then
// writes approved cuts for apply-cuts.mjs. Output uses the same
// { cuts: [{ start, end, reason }] } shape apply-cuts.mjs consumes.
//
// Input: any { words: [{ text, start, end, type? }] } transcript — normally
// <stem>.silence-transcript.json so cuts land on the silenced timeline.
//
// Output (in --out-dir or next to the transcript):
//   <stem>.filler-candidates.json    structured candidates
//   <stem>.filler-candidates.md      readable proposal
//   <stem>.filler-cuts-draft.json    apply-cuts file with ONLY the certain fillers
//
// Usage:
//   node find-fillers.mjs <transcript.json> [--out-dir dir]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { argv, exit } from "node:process";

const args = argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log("Usage: node find-fillers.mjs <transcript.json> [--out-dir dir]");
  exit(args.length === 0 ? 1 : 0);
}
let transcriptArg = null, outDirArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out-dir") outDirArg = args[++i];
  else if (!transcriptArg) transcriptArg = args[i];
}
const transcriptPath = resolve(transcriptArg);
const transcript = JSON.parse(readFileSync(transcriptPath, "utf8"));
if (!Array.isArray(transcript.words)) { console.error("transcript has no words[]"); exit(1); }

// Keep spoken words only; ignore spacing and audio-event tokens.
const words = transcript.words.filter((w) => (w.type ?? "word") === "word" && w.text?.trim());

const CERTAIN = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "eh", "hm", "hmm", "hmmm", "mm", "mmm", "mhm"]);
// Multi-word contextual fillers (matched on cleaned tokens).
const PHRASES = [["you", "know"], ["i", "mean"], ["sort", "of"], ["kind", "of"]];
// Single-word contextual fillers: only flagged at a pause or clause edge.
const SINGLES = new Set(["like", "basically", "actually", "literally", "honestly", "obviously", "right", "okay", "so", "well"]);

const PAUSE = 0.25; // seconds of silence that marks a clause edge

function clean(text) {
  return (text ?? "").toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
}
function fmt(s) {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}
function ctx(i, j = i) {
  const lo = Math.max(0, i - 6), hi = Math.min(words.length, j + 7);
  return words.slice(lo, hi).map((w, k) => (lo + k >= i && lo + k <= j ? `[${w.text}]` : w.text)).join(" ");
}
const endsClause = (w) => /[,.!?;:]$/.test(w.text);

const candidates = [];
let cid = 0;
const add = (c) => candidates.push({ id: `f${String(++cid).padStart(3, "0")}`, ...c });
// Absorb the gap up to the next word (capped) so no orphaned breath is left behind.
function range(i, j = i) {
  const next = words[j + 1];
  const end = next && next.start - words[j].end <= 0.12 ? next.start : words[j].end;
  return { start: Number(words[i].start.toFixed(3)), end: Number(end.toFixed(3)) };
}

for (let i = 0; i < words.length; i++) {
  const w = words[i], tok = clean(w.text);
  const prev = words[i - 1], next = words[i + 1];
  const gapBefore = prev ? w.start - prev.end : Infinity;
  const gapAfter = next ? next.start - w.end : Infinity;

  if (CERTAIN.has(tok)) {
    add({ type: "filler", kind: "certain", confidence: "high", recommend: "cut", cut: range(i), removes: w.text, context: ctx(i), note: `hesitation "${tok}"` });
    continue;
  }

  const phrase = PHRASES.find((p) => p.every((t, k) => clean(words[i + k]?.text) === t));
  if (phrase) {
    const j = i + phrase.length - 1;
    const atEdge = gapBefore >= PAUSE || endsClause(prev ?? { text: "." }) || (words[j + 1] ? words[j + 1].start - words[j].end >= PAUSE : true) || endsClause(words[j]);
    if (atEdge) {
      add({ type: "filler", kind: "contextual", confidence: "medium", recommend: "review", cut: range(i, j), removes: words.slice(i, j + 1).map((x) => x.text).join(" "), context: ctx(i, j), note: `"${phrase.join(" ")}" at a clause edge` });
    }
    i = j;
    continue;
  }

  if (SINGLES.has(tok)) {
    // "like"/"so"/"well"/"right"/"okay" are usually content; require a pause or comma on a side.
    const hedged = gapBefore >= PAUSE || gapAfter >= PAUSE || endsClause(w) || (prev && endsClause(prev));
    const weak = new Set(["like", "so", "well", "right", "okay"]).has(tok);
    if (hedged && (!weak || (gapBefore >= PAUSE && (gapAfter >= PAUSE || endsClause(w))))) {
      add({ type: "filler", kind: "contextual", confidence: weak ? "low" : "medium", recommend: "review", cut: range(i), removes: w.text, context: ctx(i), note: `"${tok}" with a pause/clause edge — may be real content` });
    }
  }
}

const certain = candidates.filter((c) => c.kind === "certain");
const total = (list) => list.reduce((s, c) => s + (c.cut.end - c.cut.start), 0);
const counts = candidates.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});

const stem = basename(transcriptPath, extname(transcriptPath)).replace(/[-.]?(silence-)?transcript.*$/i, "") || "source";
const outDir = outDirArg ? resolve(outDirArg) : dirname(transcriptPath);
mkdirSync(outDir, { recursive: true });

const jsonPath = join(outDir, `${stem}.filler-candidates.json`);
const mdPath = join(outDir, `${stem}.filler-candidates.md`);
const draftPath = join(outDir, `${stem}.filler-cuts-draft.json`);

writeFileSync(jsonPath, JSON.stringify({ agent: "cut-mistakes/fillers", source_transcript: transcriptPath, word_count: words.length, counts, certain_cut_seconds: Number(total(certain).toFixed(2)), candidates }, null, 2));
writeFileSync(draftPath, JSON.stringify({ cuts: certain.map((c) => ({ start: c.cut.start, end: c.cut.end, reason: `filler: ${c.removes}` })) }, null, 2));
writeFileSync(mdPath, [
  "# Filler-Word Candidates",
  "",
  `Transcript: ${basename(transcriptPath)} · ${words.length} words`,
  `Found: ${candidates.length} (${certain.length} certain, ${candidates.length - certain.length} contextual). Certain fillers total ~${total(certain).toFixed(1)}s.`,
  "Contextual fillers are NOT in the draft cuts file; approve them individually after reading context.",
  "",
  ...candidates.map((c) => [
    `## ${c.id} · ${c.kind} · ${c.confidence} · recommend: ${c.recommend}`,
    `cut ${fmt(c.cut.start)}–${fmt(c.cut.end)} (${(c.cut.end - c.cut.start).toFixed(2)}s) — ${c.note}`,
    `- removes: ${c.removes}`,
    `- context: …${c.context}…`,
    "",
  ].join("\n")),
].join("\n"));

console.log(JSON.stringify({ candidates: candidates.length, counts, certainCutSeconds: Number(total(certain).toFixed(2)), outputs: { json: jsonPath, md: mdPath, draftCuts: draftPath } }, null, 2));
