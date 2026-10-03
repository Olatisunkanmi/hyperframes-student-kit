// Base-video stage: [cold-open hook][bumper gap: black + silence][cleaned video][outro slot: black + silence].
// Writes assets/base.mp4 (1080x1920), assets/base-4x5.mp4 (crop), assets/voice.wav and assets/base.meta.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadWords, locateHook } from "./timeline.mjs";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}`);
  return r.stdout;
}

export function buildBase(dir, cfg) {
  const words = loadWords(dir, cfg);
  const { HS, HE } = locateHook(words, cfg.hook);
  const BS = cfg.bodyStart, BUMPER = cfg.bumper ?? 0, OUTRO = cfg.outro?.seconds ?? 0;
  const clean = join(dir, cfg.source.clean);
  const dur = +run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clean]).trim();
  const H = +(HE - HS).toFixed(3);
  const A = "aformat=sample_rates=48000:channel_layouts=stereo";
  const seg = (d, i) => `color=c=black:s=1080x1920:r=30:d=${d}[${i}v];anullsrc=r=48000:cl=stereo:d=${d},atrim=0:${d},asetpts=PTS-STARTPTS[${i}a]`;
  const parts = [
    `[0:v]trim=${HS}:${HE},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,fps=30[hv]`,
    `[0:a]atrim=${HS}:${HE},asetpts=PTS-STARTPTS,${A},afade=t=in:d=0.015,afade=t=out:st=${(H - 0.05).toFixed(3)}:d=0.05[ha]`,
    `[0:v]trim=${BS}:${dur},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,fps=30[bv]`,
    `[0:a]atrim=${BS}:${dur},asetpts=PTS-STARTPTS,${A},afade=t=in:d=0.015[ba]`,
  ];
  const order = ["[hv][ha]"];
  if (BUMPER > 0) { parts.push(seg(BUMPER, "g")); order.push("[gv][ga]"); }
  order.push("[bv][ba]");
  if (OUTRO > 0) { parts.push(seg(OUTRO, "o")); order.push("[ov][oa]"); }
  const fc = `${parts.join(";")};${order.join("")}concat=n=${order.length}:v=1:a=1[v][a]`;
  const enc = ["-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-g", "30"];
  run("ffmpeg", ["-v", "error", "-y", "-i", clean, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", ...enc, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", join(dir, "assets/base.mp4")]);
  run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "assets/base.mp4"), "-vn", "-c:a", "pcm_s16le", "-ar", "48000", join(dir, "assets/voice.wav")]);
  // 4:5 is a crop of the vertical base, keeping the face and the top band for graphics.
  run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "assets/base.mp4"), "-vf", `crop=1080:1350:0:${cfg.crop4x5Y}`, ...enc, "-c:a", "copy", "-movflags", "+faststart", join(dir, "assets/base-4x5.mp4")]);
  const meta = { HOOK_SRC: [HS, HE], BODY_SRC_START: BS, H, BUMPER, OUTRO, TOTAL: +(H + BUMPER + (dur - BS) + OUTRO).toFixed(3) };
  writeFileSync(join(dir, "assets/base.meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

export const readMeta = (dir) => JSON.parse(readFileSync(join(dir, "assets/base.meta.json"), "utf8"));
