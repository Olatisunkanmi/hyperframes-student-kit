#!/usr/bin/env node
// Sound design toolkit: a locally synthesized SFX pack, a cue-based SFX stem, and a ducked music bed.
// Everything is generated with ffmpeg, so there are no licensing questions for the SFX pack.
//
//   node scripts/sound-design.mjs generate [--dir sounds/sfx]
//       Writes whoosh-up, whoosh-down, hit, pop, tick, ping, riser (48 kHz stereo wav).
//
//   node scripts/sound-design.mjs mix --cues <cues.json> --duration <s> --out <sfx.stem.wav> [--dir sounds/sfx]
//       cues.json: [{ "t": 12.3, "sfx": "whoosh-up", "gain": -14, "why": "stat panel enters" }, ...]
//       "gain" is dB relative to full scale of the pack file (default -16). Keep SFX under the voice.
//       COUNTER cues (required for every count-up number animation):
//         { "type": "counter", "t": 12.3, "duration": 0.8, "from": 0, "to": 37, "ease": "power2.out",
//           "gain": -17, "landing": "ping", "landingGain": -14, "why": "37% counts up" }
//       expands into one rising-pitch tick per displayed number change (same math as the GSAP tween, see
//       scripts/lib/counter-ticks.mjs) plus a landing sound when the final value arrives.
//
//   node scripts/sound-design.mjs music --voice <voice.master.wav> --duration <s> --out <music.stem.wav>
//                              [--file <music.mp3|wav> | --synth] [--rel -14] [--duck 2.5]
//       Places a bed --rel LU below the voice's loudness, fades it in/out, and ducks it under speech
//       (sidechain from the voice). --synth makes a plain placeholder pad; real music = --file.
//       Record the music's source and license in the project's VERIFY.md.
//
// Wire the stems into the composition as extra <audio data-loudness-exempt> elements, render, then run
// scripts/audio-check.mjs on the render: the FINAL mix must still land at -18..-14 LUFS.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { measureLoudness } from "./lib/loudness.mjs";
import { counterTimes } from "./lib/counter-ticks.mjs";

const [cmd, ...rest] = argv.slice(2);
const o = { dir: "sounds/sfx", cues: null, duration: null, out: null, voice: null, file: null, synth: false, rel: -14, duck: 2.5 };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === "--dir") o.dir = rest[++i];
  else if (a === "--cues") o.cues = rest[++i];
  else if (a === "--duration") o.duration = Number(rest[++i]);
  else if (a === "--out") o.out = rest[++i];
  else if (a === "--voice") o.voice = rest[++i];
  else if (a === "--file") o.file = rest[++i];
  else if (a === "--synth") o.synth = true;
  else if (a === "--rel") o.rel = Number(rest[++i]);
  else if (a === "--duck") o.duck = Number(rest[++i]);
  else { console.error(`unknown option: ${a}`); exit(1); }
}
const ff = (args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); if (r.status !== 0) { console.error(r.stderr); exit(1); } };

const PACK = {
  "whoosh-up": "anoisesrc=d=0.6:c=pink:r=48000:seed=3,asplit[a][b];[a]lowpass=f=500,volume='1-t/0.6':eval=frame[l];[b]highpass=f=2500,lowpass=f=9000,volume='t/0.6':eval=frame[h];[l][h]amix=inputs=2:normalize=0,volume='sin(PI*t/0.6)':eval=frame,afade=t=in:d=0.04,afade=t=out:st=0.42:d=0.18",
  "whoosh-down": "anoisesrc=d=0.6:c=pink:r=48000:seed=5,asplit[a][b];[a]lowpass=f=500,volume='t/0.6':eval=frame[l];[b]highpass=f=2500,lowpass=f=9000,volume='1-t/0.6':eval=frame[h];[l][h]amix=inputs=2:normalize=0,volume='sin(PI*t/0.6)':eval=frame,afade=t=in:d=0.04,afade=t=out:st=0.42:d=0.18",
  "hit": "aevalsrc='0.9*sin(2*PI*(62-45*t)*t)*exp(-8*t)':d=0.55:s=48000[t];anoisesrc=d=0.55:c=white:r=48000:seed=9,lowpass=f=3000,volume='exp(-70*t)':eval=frame[n];[t][n]amix=inputs=2:normalize=0,afade=t=out:st=0.4:d=0.15",
  "pop": "aevalsrc='0.7*sin(2*PI*(500+1500*exp(-30*t))*t)*exp(-26*t)':d=0.16:s=48000,afade=t=out:st=0.1:d=0.06",
  "tick": "aevalsrc='0.55*sin(2*PI*2200*t)*exp(-120*t)':d=0.06:s=48000",
  "count-1": "aevalsrc='0.6*sin(2*PI*1300*t)*exp(-110*t)':d=0.05:s=48000",
  "count-2": "aevalsrc='0.6*sin(2*PI*1600*t)*exp(-110*t)':d=0.05:s=48000",
  "count-3": "aevalsrc='0.6*sin(2*PI*1950*t)*exp(-110*t)':d=0.05:s=48000",
  "count-4": "aevalsrc='0.6*sin(2*PI*2350*t)*exp(-110*t)':d=0.05:s=48000",
  "count-5": "aevalsrc='0.6*sin(2*PI*2800*t)*exp(-110*t)':d=0.05:s=48000",
  "ping": "aevalsrc='0.35*(sin(2*PI*880*t)*exp(-6*t)+0.7*sin(2*PI*1318*(t-0.09))*exp(-6*(t-0.09))*gte(t,0.09))':d=0.9:s=48000,afade=t=out:st=0.7:d=0.2",
  "riser": "aevalsrc='0.3*sin(2*PI*(200+900*t)*t)*t/1.2':d=1.2:s=48000[s];anoisesrc=d=1.2:c=pink:r=48000:seed=2,highpass=f=1500,volume='0.18*t/1.2':eval=frame[n];[s][n]amix=inputs=2:normalize=0,afade=t=out:st=1.1:d=0.1",
};

if (cmd === "generate") {
  const dir = resolve(o.dir); mkdirSync(dir, { recursive: true });
  for (const [name, graph] of Object.entries(PACK)) {
    // each graph starts from its own source filter; conform to 48 kHz stereo s16
    ff(["-filter_complex", `${graph},aformat=sample_fmts=s16:channel_layouts=stereo:sample_rates=48000`, "-c:a", "pcm_s16le", join(dir, `${name}.wav`)]);
  }
  console.log(`wrote ${Object.keys(PACK).length} SFX to ${dir}`);
} else if (cmd === "mix") {
  if (!o.cues || !o.duration || !o.out) { console.error("mix needs --cues, --duration, --out"); exit(1); }
  const expand = (c) => {
    if (c.type !== "counter") return [c];
    const { ticks, landing } = counterTimes({ start: c.t, duration: c.duration, from: c.from ?? 0, to: c.to, ease: c.ease ?? "power2.out" });
    const g = c.gain ?? -17;
    const out = ticks.map((k, i) => ({ t: k.t, sfx: `count-${Math.min(5, 1 + Math.floor((i / ticks.length) * 5))}`, gain: g - 5 + 5 * (i / Math.max(1, ticks.length - 1)), why: c.why }));
    if (c.landing !== null) out.push({ t: landing, sfx: c.landing ?? "ping", gain: c.landingGain ?? g + 3, why: `${c.why ?? "counter"} lands` });
    return out;
  };
  const cues = JSON.parse(readFileSync(resolve(o.cues), "utf8")).flatMap(expand).filter((c) => c.t >= 0 && c.t < o.duration);
  const dir = resolve(o.dir);
  if (!cues.length) { console.error("no cues inside the duration"); exit(1); }
  const inputs = [], parts = [];
  cues.forEach((c, i) => {
    const f = join(dir, `${c.sfx}.wav`);
    if (!existsSync(f)) { console.error(`missing sfx: ${f} (run: node scripts/sound-design.mjs generate)`); exit(1); }
    inputs.push("-i", f);
    parts.push(`[${i}:a]volume=${(c.gain ?? -16)}dB,adelay=${Math.round(c.t * 1000)}|${Math.round(c.t * 1000)}[c${i}]`);
  });
  const mixIn = cues.map((_, i) => `[c${i}]`).join("");
  const graph = `${parts.join(";")};${mixIn}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad=whole_dur=${o.duration},atrim=0:${o.duration}`;
  ff([...inputs, "-filter_complex", graph, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", resolve(o.out)]);
  console.log(`mixed ${cues.length} cues -> ${resolve(o.out)}`);
} else if (cmd === "music") {
  if (!o.voice || !o.duration || !o.out || (!o.file && !o.synth)) { console.error("music needs --voice, --duration, --out and (--file | --synth)"); exit(1); }
  const voice = resolve(o.voice), voiceLufs = measureLoudness(voice).lufs, target = (voiceLufs + o.rel).toFixed(1);
  const fadeOut = Math.max(0, o.duration - 1.5);
  const bedSrc = o.synth
    ? ["-f", "lavfi", "-i", `aevalsrc='0.16*(sin(2*PI*110*t)+0.8*sin(2*PI*164.81*t)+0.6*sin(2*PI*220*t)+0.5*sin(2*PI*277.18*t))*(0.75+0.25*sin(2*PI*0.12*t))':d=${o.duration}:s=48000`]
    : ["-stream_loop", "-1", "-i", resolve(o.file)];
  const graph = `[0:a]atrim=0:${o.duration},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo:sample_rates=48000,lowpass=f=7000,loudnorm=I=${target}:TP=-3:LRA=7,afade=t=in:d=1.2,afade=t=out:st=${fadeOut}:d=1.5[bed];[1:a]aformat=channel_layouts=stereo:sample_rates=48000[v1];[bed][v1]sidechaincompress=threshold=0.05:ratio=${o.duck}:attack=30:release=500[ducked];[ducked]atrim=0:${o.duration}[out]`;
  ff([...bedSrc, "-i", voice, "-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", resolve(o.out)]);
  console.log(`music bed -> ${resolve(o.out)} (target ${target} LUFS before ducking; voice is ${voiceLufs} LUFS)`);
} else {
  console.log("Usage: node scripts/sound-design.mjs generate | mix --cues c.json --duration s --out f.wav | music --voice v.wav --duration s --out f.wav (--file m.mp3 | --synth)");
  exit(cmd ? 1 : 0);
}
