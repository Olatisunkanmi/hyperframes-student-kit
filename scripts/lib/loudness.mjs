// Shared loudness helpers (EBU R128 via ffmpeg). Used by audio-master, audio-check, and preflight.
import { spawnSync } from "node:child_process";

export const TARGET = { lufs: -16, truePeak: -1.5, minLufs: -18, maxLufs: -14, maxTruePeak: -1 };

/** Measure integrated loudness, loudness range and true peak of any file with an audio stream. */
export function measureLoudness(file) {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`ffmpeg not available: ${r.error.message}`);
  const out = r.stderr ?? "";
  const summary = out.slice(out.lastIndexOf("Summary:"));
  const num = (re) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  const lufs = num(/I:\s+(-?[\d.]+)\s+LUFS/);
  const lra = num(/LRA:\s+(-?[\d.]+)\s+LU/);
  const truePeak = num(/Peak:\s+(-?[\d.]+)\s+dBFS/);
  if (lufs === null) throw new Error(`could not measure loudness of ${file} (no audio stream?)`);
  return { lufs, lra, truePeak };
}

/** Pass/fail against the delivery window. Returns { ok, problems[] }. */
export function judge({ lufs, truePeak }, t = TARGET) {
  const problems = [];
  if (lufs < t.minLufs) problems.push(`too quiet: ${lufs} LUFS (want ${t.minLufs}..${t.maxLufs}, target ${t.lufs})`);
  if (lufs > t.maxLufs) problems.push(`too loud: ${lufs} LUFS (want ${t.minLufs}..${t.maxLufs}, target ${t.lufs})`);
  if (truePeak !== null && truePeak > t.maxTruePeak) problems.push(`true peak ${truePeak} dBFS is above ${t.maxTruePeak} dBFS (clipping risk)`);
  return { ok: problems.length === 0, problems };
}
