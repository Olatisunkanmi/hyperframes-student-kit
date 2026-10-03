// Audio stage: master the voice, mix the SFX stem from assets/sfx-cues.json, build the optional music bed.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readMeta } from "./base.mjs";

function node(root, script, args) {
  const r = spawnSync(process.execPath, [join(root, "scripts", script), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${script} failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

export function audioStage({ dir, root, cfg, sfx, music }) {
  const { TOTAL } = readMeta(dir);
  const log = [];
  log.push(JSON.parse(node(root, "audio-master.mjs", [join(dir, "assets/voice.wav"), "--out", join(dir, "assets/voice.master.wav")]).replace(/^[^{]*/, "")));
  if (sfx) {
    if (!existsSync(join(root, "sounds/sfx/hit.wav"))) node(root, "sound-design.mjs", ["generate"]);
    log.push(node(root, "sound-design.mjs", ["mix", "--cues", join(dir, "assets/sfx-cues.json"), "--duration", String(TOTAL), "--out", join(dir, "assets/sfx.stem.wav")]).trim());
  }
  if (music) {
    const m = cfg.music ?? { synth: true };
    const src = m.file ? ["--file", join(dir, m.file)] : ["--synth"];
    log.push(node(root, "sound-design.mjs", ["music", "--voice", join(dir, "assets/voice.master.wav"), "--duration", String(TOTAL), "--out", join(dir, "assets/music.stem.wav"), ...src, ...(m.rel !== undefined ? ["--rel", String(m.rel)] : [])]).trim());
  }
  return log;
}
