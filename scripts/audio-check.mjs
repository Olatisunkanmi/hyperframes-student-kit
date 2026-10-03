#!/usr/bin/env node
// Delivery-loudness gate. Exits 1 when a file is outside -18..-14 LUFS or its true peak exceeds -1 dBTP.
//
// Usage: node scripts/audio-check.mjs <audio|video file> [more files...]
// Works on rendered MP4s, so run it on the draft AND the final render.

import { resolve } from "node:path";
import { argv, exit } from "node:process";
import { measureLoudness, judge } from "./lib/loudness.mjs";

const files = argv.slice(2).filter((a) => !a.startsWith("--"));
if (!files.length || argv.includes("--help")) {
  console.log("Usage: node scripts/audio-check.mjs <file> [more files...]");
  exit(files.length ? 0 : 1);
}
let bad = 0;
for (const f of files) {
  const m = measureLoudness(resolve(f));
  const v = judge(m);
  console.log(`${v.ok ? "PASS" : "FAIL"}  ${f}  ${m.lufs} LUFS  LRA ${m.lra} LU  true peak ${m.truePeak} dBFS`);
  for (const p of v.problems) console.log(`      - ${p}`);
  if (!v.ok) bad++;
}
exit(bad ? 1 : 0);
