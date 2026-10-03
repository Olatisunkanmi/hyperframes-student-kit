// Compose stage: writes <project>/index.html, assets/transcript.json (final timeline) and assets/sfx-cues.json.
//
// The core owns everything that is the same in every video: brand fonts and tokens, the video + voice master audio,
// captions (navy bar), lower-third, slow camera push, count-up tweens, bumper, outro, and the cues for all of those.
// Per-video graphics come from <project>/beats.mjs, a module whose default export is
//
//   (ctx) => ({ anchors, html, css, js, counters, cues })
//
//   ctx      { words, find(text, from?, part?), H, BUMPER, OUTRO, HB, TOTAL, brand, C, layout, format, r }
//   anchors  { name: wordObject } (word objects from ctx.find); exposed to js as A / T(name, 0|1) = start|end
//   html     overlay clips. Use class="panel clip" for a card; give each clip a unique data-track-index >= 20
//   css      extra CSS (core already provides .panel .disp .lab .bar)
//   js       GSAP code appended to the timeline `tl`; may use C (config), A, T()
//   counters [{ id, from, to, start, duration, ease, suffix, plusAtEnd, land, landGain, gain, why }]
//            EVERY count-up number is declared here: it drives the tween AND its counter sound cues.
//   cues     extra sound cues [{ t, sfx, gain, why }]
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { layoutFor } from "./layout.mjs";
import { captionGroups, finalWords, loadWords, makeFind, normWord } from "./timeline.mjs";
import { readMeta } from "./base.mjs";

const r2 = (n) => +n.toFixed(2);
const cue = (t, sfx, gain, why) => ({ t: +Math.max(0, t).toFixed(3), sfx, gain, why });

export async function compose({ dir, root, cfg, format, sfx = false, music = false }) {
  const layout = layoutFor(format);
  const brand = JSON.parse(readFileSync(join(root, cfg.brand), "utf8"));
  const C = brand.colors;
  const fontDir = join(root, "brand/fonts");
  mkdirSync(join(dir, "assets/brand/fonts"), { recursive: true });
  for (const f of readdirSync(fontDir)) copyFileSync(join(fontDir, f), join(dir, "assets/brand/fonts", f));

  const meta = readMeta(dir);
  const { H, TOTAL } = meta, BUMPER = meta.BUMPER ?? 0, OUTRO = meta.OUTRO ?? 0, HB = H + BUMPER;
  const words = finalWords(loadWords(dir, cfg), meta, cfg);
  writeFileSync(join(dir, "assets/transcript.json"), JSON.stringify({ audio_duration_secs: TOTAL, hook_duration: H, words }, null, 2));
  const find = makeFind(words);

  // per-video beats
  const beatsPath = join(dir, "beats.mjs");
  if (!existsSync(beatsPath)) throw new Error(`missing ${beatsPath}`);
  const ctx = { words, find, H, BUMPER, OUTRO, HB, TOTAL, brand, C, layout, format, r: r2 };
  const b = await (await import(pathToFileURL(beatsPath).href + `?t=${Date.now()}`)).default(ctx);
  const counters = b.counters ?? [];
  const anchors = { ...b.anchors };

  // lower-third anchors (core)
  const lt = cfg.lowerThird;
  anchors.ltStart = find(lt.startWord, HB); anchors.ltName = find(lt.nameWord, HB); anchors.ltEnd = find(lt.endWord, HB);
  const A = anchors;

  // sound cues: counters first (every count-up gets ticks + landing), then bumper/lower-third/outro, then beats
  const cues = [
    ...counters.map((c) => ({ type: "counter", t: +c.start.toFixed(3), duration: c.duration, from: c.from, to: c.to, ease: c.ease ?? "power2.out", gain: c.gain ?? -12, landing: c.land ?? "ping", landingGain: c.landGain ?? -8, why: c.why ?? c.id })),
    ...(BUMPER ? [cue(H - 0.3, "whoosh-up", -2, "hook -> monogram bumper"), cue(H + 0.12, "hit", -10, "monogram lands"), cue(H + 0.55, "ping", -12, "bumper accent bar")] : []),
    cue(A.ltStart.start - 0.1, "pop", -11, "lower-third enters"),
    ...(b.cues ?? []).map((c) => cue(c.t, c.sfx, c.gain, c.why)),
    ...(OUTRO ? [cue(TOTAL - OUTRO + 0.12, "pop", -10, "outro monogram"), cue(TOTAL - OUTRO + 0.65, "ping", -12, "outro accent bar")] : []),
  ];
  writeFileSync(join(dir, "assets/sfx-cues.json"), JSON.stringify(cues, null, 2));
  const WITH_SFX = sfx && existsSync(join(dir, "assets/sfx.stem.wav"));
  const WITH_MUSIC = music && existsSync(join(dir, "assets/music.stem.wav"));

  // captions: navy bar; emphasis words (numbers) in amber, which is legal as text only on navy
  const emph = new Set(cfg.emphasis.map(normWord));
  const groups = captionGroups(words, TOTAL);
  const capHtml = groups.map((g, gi) => `<div class="cg" id="cg-${gi}"><div class="cgb">${g.words.map((w) => `<span class="${emph.has(normWord(w.text)) ? "w ac" : "w"}">${w.text.replace(/[.,:]$/, "")}</span>`).join(" ")}</div></div>`).join("");

  const runtime = { H, TOTAL, OUTRO, K: layout.k, A: Object.fromEntries(Object.entries(A).map(([k, v]) => [k, [r2(v.start), r2(v.end)]])), caps: groups.map((g) => [r2(g.start), r2(g.end)]), counters };
  const FONT = (f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url('assets/brand/${f.file}') format('woff2')}`;
  const fmt = `${layout.W}x${layout.H}`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${cfg.slug} (${format})</title>
<script src="assets/gsap.min.js"></script>
<style>
${FONT(brand.fonts.display)}
${FONT(brand.fonts.body)}
${FONT(brand.fonts.caption)}
:root{--navy:${C.navy};--paper:${C.paper};--teal:${C.teal};--amber:${C.amber};--ink:${C.ink};--slate:${C.slate};--line:rgba(10,22,40,.14)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${layout.W}px;height:${layout.H}px;overflow:hidden;background:#000;font-family:'Inter',Arial,sans-serif}
#main{position:relative;width:${layout.W}px;height:${layout.H}px;overflow:hidden;background:#000}
#vwrap{position:absolute;inset:0;transform-origin:50% ${layout.originY}%}
#vwrap video{position:absolute;inset:0;width:${layout.W}px;height:${layout.H}px;object-fit:cover}
.panel{position:absolute;left:70px;top:${layout.panelTop}px;width:940px;height:420px;border-radius:36px;background:rgba(255,255,255,.97);border:2px solid var(--line);box-shadow:0 18px 50px rgba(10,22,40,.30);overflow:hidden;transform-origin:50% 0}
.disp{font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:-.025em;color:var(--navy)}
.lab{font-family:'Inter',sans-serif;font-weight:600;letter-spacing:.1em;text-transform:uppercase;font-size:30px;color:var(--slate)}
.bar{position:absolute;height:9px;background:var(--amber);border-radius:5px;transform-origin:0 50%}
/* lower-third: navy bar, amber rule above the name */
#lt{position:absolute;left:70px;top:${layout.ltTop}px;width:700px}
#lt .rule{height:8px;background:var(--amber);transform-origin:0 50%}
#lt .barn{background:var(--navy);padding:16px 28px 18px}
#lt .n{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:46px;color:#fff;letter-spacing:-.02em;white-space:nowrap}
#lt .t{font-weight:600;font-size:28px;color:#fff;opacity:.92;margin-top:2px}
/* captions: Inter SemiBold, white on a navy backing bar, lower third */
#caps{position:absolute;left:90px;width:900px;top:${layout.capTop}px;height:190px}
.cg{position:absolute;left:0;right:0;top:0;display:flex;justify-content:center;opacity:0}
.cgb{background:rgba(10,22,40,.95);border-radius:18px;padding:14px 30px 16px;color:#fff;font-weight:600;font-size:54px;line-height:1.15;text-align:center}
.cg .w{white-space:nowrap}.cg .ac{color:var(--amber)}
/* bumper + outro */
.full{position:absolute;inset:0;background:var(--navy);display:flex;flex-direction:column;align-items:center;justify-content:center}
.mono{display:flex;align-items:center;justify-content:center;border:5px solid var(--amber);color:var(--amber);font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:-.04em}
#bump .mono{width:340px;height:340px;border-radius:76px;font-size:190px}
#outro .mono{width:240px;height:240px;border-radius:54px;font-size:134px;border-width:4px}
#bump .bar,#outro .bar{position:relative;margin-top:44px;width:200px}
#outro .tag{margin-top:44px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:68px;color:#fff;letter-spacing:-.02em}
${b.css ?? ""}
</style></head><body>
<div id="main" data-composition-id="${cfg.slug}" data-start="0" data-duration="${TOTAL}" data-width="${layout.W}" data-height="${layout.H}">
  <div id="vwrap"><video id="v" data-start="0" data-duration="${TOTAL}" data-track-index="0" src="${layout.base}" muted playsinline></video></div>
  <audio id="a" data-start="0" data-duration="${TOTAL}" data-track-index="1" src="assets/voice.master.wav" data-volume="1"></audio>
${WITH_SFX ? `  <audio id="sfx" data-start="0" data-duration="${TOTAL}" data-track-index="10" src="assets/sfx.stem.wav" data-volume="1" data-loudness-exempt></audio>` : ""}
${WITH_MUSIC ? `  <audio id="music" data-start="0" data-duration="${TOTAL}" data-track-index="11" src="assets/music.stem.wav" data-volume="1" data-loudness-exempt></audio>` : ""}
${b.html ?? ""}
  <div id="lt" class="clip" data-start="${r2(A.ltStart.start - 0.1)}" data-duration="${r2(A.ltEnd.start - A.ltStart.start + 0.9)}" data-track-index="3">
    <div class="rule" id="ltr"></div>
    <div class="barn" id="ltb"><div class="n">${brand.name}</div><div class="t">${brand.title}</div></div>
  </div>
${BUMPER ? `  <div id="bump" class="full clip" data-start="${H}" data-duration="${BUMPER}" data-track-index="12">
    <div class="mono" id="bmono">${brand.monogram}</div><div class="bar" id="bbar"></div>
  </div>` : ""}
${OUTRO ? `  <div id="outro" class="full clip" data-start="${r2(TOTAL - OUTRO)}" data-duration="${OUTRO}" data-track-index="13">
    <div class="mono" id="omono">${brand.monogram}</div><div class="tag" id="otag">${cfg.outro.text}</div><div class="bar" id="obar"></div>
  </div>` : ""}
  <div id="caps" class="clip" data-start="0" data-duration="${TOTAL}" data-track-index="8">${capHtml}</div>

<script>
var C=${JSON.stringify(runtime)};var A=C.A;
function T(k,i){return A[k][i||0];}
gsap.set('.panel',{scale:C.K});
var tl=gsap.timeline({paused:true});
// camera: hook punch, then slow push on the wrapper
tl.fromTo('#vwrap',{scale:1.06},{scale:1,duration:C.H,ease:'power2.out'},0);
tl.fromTo('#vwrap',{scale:1},{scale:1.035,duration:C.TOTAL-C.H,ease:'none'},C.H);
// COUNTERS (same config as the counter sound cues)
C.counters.forEach(function(c){var o={v:c.from};var el=document.getElementById(c.id);
 tl.to(o,{v:c.to,duration:c.duration,ease:c.ease||'power2.out',onUpdate:function(){var n=Math.round(o.v);el.textContent=n+(c.plusAtEnd&&n>=c.to?'+':'')+(c.suffix||'');}},c.start);});
// ---- per-video beats ----
${b.js ?? ""}
// ---- bumper + outro ----
${BUMPER ? `tl.from('#bmono',{scale:.55,opacity:0,duration:.45,ease:'back.out(1.8)'},C.H+0.08);
tl.from('#bbar',{scaleX:0,duration:.5,ease:'power3.out'},C.H+0.5);` : ""}
${OUTRO ? `var os=C.TOTAL-C.OUTRO;
tl.from('#omono',{scale:.6,opacity:0,duration:.45,ease:'back.out(1.8)'},os+0.08);
tl.from('#otag',{opacity:0,y:24,duration:.45,ease:'power3.out'},os+0.35);
tl.from('#obar',{scaleX:0,duration:.5,ease:'power3.out'},os+0.65);` : ""}
// ---- lower-third ----
tl.from('#lt',{opacity:0,x:-80,duration:.4,ease:'power3.out'},T('ltStart')-0.1);
tl.from('#ltr',{scaleX:0,duration:.45,ease:'power2.out'},T('ltStart')-0.05);
tl.from('#ltb .n',{opacity:0,y:14,duration:.4,ease:'expo.out'},T('ltName')-0.05);
tl.from('#ltb .t',{opacity:0,y:10,duration:.35,ease:'power2.out'},T('ltName',1));
tl.to('#lt',{opacity:0,x:-50,duration:.25,ease:'power2.in'},T('ltEnd')+0.6);
// ---- captions (hard kill after each group) ----
C.caps.forEach(function(c,i){var el='#cg-'+i;
 tl.fromTo(el,{opacity:0,y:12},{opacity:1,y:0,duration:.12,ease:'power2.out'},c[0]-0.02);
 tl.to(el,{opacity:0,duration:.08,ease:'power2.in'},c[1]-0.08);
 tl.set(el,{opacity:0},c[1]);});
window.__timelines=window.__timelines||{};window.__timelines['${cfg.slug}']=tl;
</script></div></body></html>`;
  writeFileSync(join(dir, "index.html"), html);
  const metaPath = join(dir, "meta.json");
  if (existsSync(metaPath)) writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, "utf8")), width: layout.W, height: layout.H }, null, 2) + "\n");
  return { format, size: fmt, H, BUMPER, OUTRO, TOTAL, counters: counters.map((c) => `${c.id}: ${c.from}->${c.to} @${r2(c.start)}s`), cues: cues.length, sfx: WITH_SFX, music: WITH_MUSIC };
}
