// Free-form engine: a content-led edit for talking-head shorts, used from a project's beats.mjs with
// scripts/build-video.mjs. It starts from the Kinetic Serif Mix look (style-library/03-kinetic-serif) and adds
// scene types, emphasis marks and transitions, so each line of the script can get the treatment it calls for.
// How to choose treatments: .claude/skills/free-form/references/editorial-intuition.md. API: references/treatments.md.
//
//   import { freeform } from "../../scripts/lib/freeform/freeform.mjs";
//   export default (ctx) => freeform(ctx, { palette, hero, marks, scenes });
//
// video.json must set  "captions": false, "lowerThird": false, "camera": false.
//
// spec
//   palette  { paper, ink, fg, accent }  colours; choose the accent from the footage or the brand
//   hero     [word]                       large words inside ordinary caption stacks
//   marks    [{ word, style }]            "underline" | "highlight" | "accent" on a stack word
//   serif / sans / breaks                 as in kinetic.mjs
//   scenes   spoken ranges that get their own treatment, each { type, from, to, in?, out?, ... }:
//     card    takeover   { glyph?, hero: [word], variant?: "paper" | "ink" | "accent" }
//     expand  takeover   { parts: [{ at: word }], variant? }        a term unfolded part by part (E / M / R)
//     versus  takeover   { sides: [{ label, items: [{ at, text }] }, { label, from: word, items }] }
//     list    overlay    { items: [{ at, text }], title?, slot? }   numbered points beside the speaker
//     punch   overlay    { word }                                   one word slammed in at full width
//   in / out  transition of a takeover: in "cut" | "flash" | "push" | "zoom" | "wipe", out "cut" | "push"
//   camera   { zoom: [levels], moves: ["jump" | "whip"], minShot, maxShot, faceY }
import {
  FONT_DIR, SLOT_ORDER, SLOT_WIDTH, SMALL_WORDS, buildLines, copyFonts, esc, fontFaces, groupWords, norm, planShots, shown, timeGroups,
} from "../../../style-library/03-kinetic-serif/kinetic.mjs";

export const TAKEOVERS = new Set(["card", "expand", "versus"]);
export const SCENE_TYPES = new Set([...TAKEOVERS, "list", "punch"]);
export const TRANSITIONS_IN = new Set(["cut", "flash", "push", "zoom", "wipe"]);
export const TRANSITIONS_OUT = new Set(["cut", "push"]);
export const MARK_STYLES = new Set(["underline", "highlight", "accent"]);
export const VARIANTS = new Set(["paper", "ink", "accent"]);
const bare = (text) => text.replace(/[.,;:!?]+$/, "");
const DEFAULT_IN = { card: "flash", expand: "push", versus: "push" };
const DEFAULT_PALETTE = { paper: "#fdfdfd", ink: "#0b0b0d", fg: "#ffffff", accent: "#e3000f" };

/** Fail early, with the scene number, when a spec cannot be built. */
export function validateSpec(spec, words) {
  const inWords = (w) => words.includes(w);
  (spec.scenes ?? []).forEach((scene, i) => {
    const fail = (why) => { throw new Error(`freeform: scene ${i} (${scene.type}) ${why}`); };
    if (!SCENE_TYPES.has(scene.type)) fail(`has an unknown type; use one of ${[...SCENE_TYPES].join(", ")}`);
    if (!inWords(scene.from) || !inWords(scene.to)) fail("needs from/to word objects from ctx.find");
    if (scene.from.part !== scene.to.part) fail("must stay inside the hook or inside the body, not span both");
    if (scene.variant && !VARIANTS.has(scene.variant)) fail(`has an unknown variant "${scene.variant}"`);
    if (scene.slot && !(scene.slot in SLOT_WIDTH)) fail(`has an unknown slot "${scene.slot}"`);
    if (scene.in && !TRANSITIONS_IN.has(scene.in)) fail(`has an unknown "in" transition "${scene.in}"`);
    if (scene.out && !TRANSITIONS_OUT.has(scene.out)) fail(`has an unknown "out" transition "${scene.out}"`);
    if (!TAKEOVERS.has(scene.type) && (scene.in || scene.out)) fail("is an overlay; in/out transitions apply to takeovers only");
    const inRange = (w) => inWords(w) && w.start >= scene.from.start && w.end <= scene.to.end;
    if (scene.type === "expand" && !(scene.parts?.length >= 2 && scene.parts.every((p) => inRange(p.at)))) fail("needs 2+ parts, each { at: word } inside the scene");
    if (scene.type === "expand" && scene.parts.some((p) => !bare(p.at.text))) fail("has a part with no letters to show");
    if (scene.type === "punch" && !inRange(scene.word)) fail("needs a word inside the scene");
    if (scene.type === "list" && !(scene.items?.length >= 2 && scene.items.every((it) => inRange(it.at) && it.text))) fail("needs 2+ items, each { at: word, text } inside the scene");
    if (scene.type === "versus") {
      const ok = scene.sides?.length === 2 && scene.sides.every((s) => s.label && s.items?.length && s.items.every((it) => inRange(it.at) && it.text));
      if (!ok || !inRange(scene.sides[1].from)) fail("needs two sides with a label and items, and sides[1].from (the word that introduces the second side)");
    }
  });
  const ordered = [...(spec.scenes ?? [])].sort((a, b) => a.from.start - b.from.start);
  ordered.forEach((scene, i) => {
    if (i && scene.from.start <= ordered[i - 1].to.start) throw new Error(`freeform: the ${scene.type} scene starting at "${scene.from.text}" overlaps the ${ordered[i - 1].type} scene before it`);
  });
  Object.entries(spec.palette ?? {}).forEach(([name, value]) => {
    if (!/^#[0-9a-f]{3,8}$/i.test(value ?? "")) throw new Error(`freeform: palette.${name} must be a hex colour, got "${value}"`);
  });
  (spec.marks ?? []).forEach((m, i) => {
    if (!inWords(m.word) || !MARK_STYLES.has(m.style)) throw new Error(`freeform: mark ${i} needs a word from ctx.find and a style of ${[...MARK_STYLES].join(", ")}`);
  });
}

export function freeform(ctx, spec = {}) {
  const { words, TOTAL, OUTRO, layout, dir, r } = ctx;
  validateSpec(spec, words);
  const until = TOTAL - OUTRO;
  const P = { ...DEFAULT_PALETTE, ...spec.palette };
  const scenes = spec.scenes ?? [];
  const heroes = new Set(spec.hero ?? []), serifs = new Set(spec.serif ?? []), sansSet = new Set(spec.sans ?? []);
  const markOf = new Map((spec.marks ?? []).map((m) => [m.word, m.style]));
  const cam = { zoom: [1.15, 1.38, 1.24, 1.32], moves: ["jump", "whip"], faceY: 54, ...spec.camera };
  const sy = layout.H / 1920;
  copyFonts(dir);

  const classOf = (w) => heroes.has(w) ? "h" : serifs.has(w) ? "i" : sansSet.has(w) ? "s" : SMALL_WORDS.has(norm(w.text)) ? "i" : "s";
  const groups = timeGroups(groupWords(words, { cards: scenes, breaks: spec.breaks }), until);
  const id = new Map(words.map((w, i) => [w, `fw-${i}`]));
  const html = [], js = [], cues = [];
  const at = (t) => r(Math.max(0, t));
  const wordIn = (word, floor) => js.push(`tl.fromTo('#${id.get(word)}',{opacity:0,filter:'blur(16px)',y:16,scale:1.06},{opacity:1,filter:'blur(0px)',y:0,scale:1,duration:.26,ease:'power2.out'},${at(Math.max(floor, word.start - 0.05))});`);
  const span = (word, cls, style = "", inner = "") => `<span class="kw ${cls}" id="${id.get(word)}"${style ? ` style="${style}"` : ""}>${shown(word.text)}${inner}</span>`;
  const blurIn = (sel, t, from = "x:-30") => js.push(`tl.fromTo('${sel}',{opacity:0,${from},filter:'blur(12px)'},{opacity:1,x:0,y:0,filter:'blur(0px)',duration:.3,ease:'power2.out'},${at(t)});`);
  // A stack too short to fade is simply cut by its clip.
  const exit = (sel, group) => { if (group.end - group.start >= 0.3) js.push(`tl.to('${sel}',{opacity:0,filter:'blur(10px)',duration:.1,ease:'power1.in'},${at(group.end - 0.12)});tl.set('${sel}',{opacity:0},${at(group.end - 0.02)});`); };

  html.push(`  <div id="kscrim" class="clip" data-start="0" data-duration="${until}" data-track-index="19"></div>`);
  let slotIndex = 0;

  // ---- ordinary caption stack (speaker on screen) ----
  const stack = (group, gi) => {
    const slot = SLOT_ORDER[slotIndex++ % SLOT_ORDER.length];
    const lines = buildLines(group.words, classOf).map((line, li) => {
      const heroSize = line.hero ? Math.min(176, Math.floor(SLOT_WIDTH[slot] / (Math.max(4, line.chars) * 0.6))) : 0;
      const one = (w) => {
        const mark = markOf.get(w);
        if (mark && mark !== "accent") js.push(`tl.fromTo('#mk-${id.get(w)}',{scaleX:0},{scaleX:1,duration:.32,ease:'power3.out'},${at(w.start + 0.12)});`);
        return span(w, `${line.cls}${mark ? ` mk-${mark}` : ""}`, heroSize ? `font-size:${heroSize}px` : "", mark && mark !== "accent" ? `<i class="mk" id="mk-${id.get(w)}"></i>` : "");
      };
      return `<div class="kl${li % 2 ? " odd" : ""}">${line.words.map(one).join(" ")}</div>`;
    });
    html.push(`  <div id="kg-${gi}" class="kg ${slot} clip" data-start="${group.start}" data-duration="${r(group.end - group.start)}" data-track-index="${20 + (gi % 2)}"><div class="kgi" id="kgi-${gi}">${lines.join("")}</div></div>`);
    group.words.forEach((w) => wordIn(w, group.start));
    exit(`#kgi-${gi}`, group);
  };

  // ---- overlays (speaker stays on screen) ----
  const punch = (group, gi, scene) => {
    const rest = buildLines(group.words.filter((w) => w !== scene.word && w.start < scene.word.start), classOf);
    const after = buildLines(group.words.filter((w) => w !== scene.word && w.start > scene.word.start), classOf);
    const size = Math.min(250, Math.floor(940 / (Math.max(3, shown(scene.word.text).length) * 0.6)));
    const line = (l) => `<div class="kl">${l.words.map((w) => span(w, l.cls)).join(" ")}</div>`;
    const hid = id.get(scene.word);
    html.push(`  <div id="kg-${gi}" class="kg low pn clip" data-start="${group.start}" data-duration="${r(group.end - group.start)}" data-track-index="${20 + (gi % 2)}"><div class="kgi" id="kgi-${gi}">${rest.map(line).join("")}<div class="kl"><span class="kw h mk-underline" id="${hid}" style="font-size:${size}px">${shown(scene.word.text)}<i class="mk" id="mk-${hid}"></i></span></div>${after.map(line).join("")}</div></div>`);
    group.words.filter((w) => w !== scene.word).forEach((w) => wordIn(w, group.start));
    js.push(`tl.fromTo('#${hid}',{opacity:0,scale:1.7,filter:'blur(22px)'},{opacity:1,scale:1,filter:'blur(0px)',duration:.2,ease:'expo.out'},${at(Math.max(group.start, scene.word.start - 0.04))});`);
    js.push(`tl.fromTo('#mk-${hid}',{scaleX:0},{scaleX:1,duration:.3,ease:'power3.out'},${at(scene.word.start + 0.16)});`);
    exit(`#kgi-${gi}`, group);
    cues.push({ t: scene.word.start, sfx: "hit", gain: -18, why: `punch word: ${shown(scene.word.text)}` });
  };

  const list = (group, gi, scene) => {
    const slot = scene.slot ?? "topL";
    const rows = scene.items.map((it, k) => {
      blurIn(`#li-${gi}-${k}`, it.at.start - 0.04);
      cues.push({ t: it.at.start - 0.04, sfx: "tick", gain: -10, why: `list item ${k + 1}: ${it.text}` });
      return `<div class="li" id="li-${gi}-${k}"><i>${String(k + 1).padStart(2, "0")}</i><span>${esc(it.text)}</span></div>`;
    });
    const title = scene.title ? `<div class="lt" id="lt-${gi}">${esc(scene.title)}</div>` : "";
    if (scene.title) blurIn(`#lt-${gi}`, group.start + 0.02, "y:14");
    html.push(`  <div id="kg-${gi}" class="kg ${slot} ls clip" data-start="${group.start}" data-duration="${r(group.end - group.start)}" data-track-index="${20 + (gi % 2)}"><div class="kgi" id="kgi-${gi}">${title}${rows.join("")}</div></div>`);
    exit(`#kgi-${gi}`, group);
  };

  // ---- takeovers (replace the picture; the voice carries on) ----
  const takeover = (group, gi, scene, body, variant) => {
    const sel = `#fsi-${gi}`, start = group.start, end = group.end;
    html.push(`  <div id="fs-${gi}" class="fs clip" data-start="${start}" data-duration="${r(end - start)}" data-track-index="22"><div class="fsi v-${variant} t-${scene.type}" id="fsi-${gi}">${body}</div></div>`);
    const tin = start < 0.2 ? "cut" : scene.in ?? DEFAULT_IN[scene.type];
    if (tin === "flash") js.push(`tl.fromTo('#kflash',{opacity:0},{opacity:.6,duration:.07,ease:'none'},${at(start - 0.07)});tl.set('#kflash',{opacity:0},${start});`);
    if (tin === "push") js.push(`tl.fromTo('${sel}',{yPercent:100},{yPercent:0,duration:.34,ease:'expo.out'},${start});`);
    if (tin === "zoom") js.push(`tl.fromTo('${sel}',{scale:1.2,opacity:0,filter:'blur(14px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:.24,ease:'power3.out'},${start});`);
    if (tin === "wipe") js.push(`tl.fromTo('${sel}',{clipPath:'circle(0% at 50% 46%)'},{clipPath:'circle(130% at 50% 46%)',duration:.45,ease:'power2.out'},${start});`);
    if (scene.out === "push") js.push(`tl.to('${sel}',{yPercent:-100,duration:.24,ease:'power3.in'},${at(end - 0.26)});tl.set('${sel}',{opacity:0},${at(end - 0.01)});`);
    cues.push({ t: Math.max(0, start - 0.1), sfx: "whoosh-up", gain: -12, why: `${scene.type} in (${tin}): ${group.words.slice(0, 5).map((w) => w.text).join(" ")}` });
    if (end < until - 0.2 && groups[gi + 1]?.card === null) cues.push({ t: end, sfx: "tick", gain: -10, why: `${scene.type} out, back to the speaker` });
  };

  const card = (group, gi, scene) => {
    const cardHero = new Set(scene.hero ?? []);
    const lines = buildLines(group.words, (w) => (cardHero.has(w) ? "h" : "s"), 14).map((line) => {
      const size = line.hero ? Math.min(230, Math.floor(880 / (Math.max(3, line.chars) * 0.5))) : 0;
      return `<div class="kl">${line.words.map((w) => span(w, line.hero ? "cb" : "cs", size ? `font-size:${size}px` : "")).join(" ")}</div>`;
    });
    const glyph = scene.glyph ? `<div class="kglyph" id="kgl-${gi}">${esc(scene.glyph)}</div>` : "";
    takeover(group, gi, scene, `<div class="kblock">${glyph}${lines.join("")}</div>`, scene.variant ?? "paper");
    if (scene.glyph) js.push(`tl.fromTo('#kgl-${gi}',{opacity:0,filter:'blur(18px)',scale:.7,rotation:-14},{opacity:1,filter:'blur(0px)',scale:1,rotation:0,duration:.3,ease:'back.out(1.6)'},${at(group.start + 0.04)});`);
    group.words.forEach((w) => wordIn(w, group.start));
  };

  const expand = (group, gi, scene) => {
    const parts = new Set(scene.parts.map((p) => p.at));
    const lead = group.words.filter((w) => !parts.has(w));
    const leadLines = buildLines(lead, () => "s", 16).map((l) => `<div class="kl">${l.words.map((w) => span(w, "cs")).join(" ")}</div>`);
    const rows = scene.parts.map((p, k) => {
      const raw = bare(p.at.text), text = esc(raw);
      js.push(`tl.fromTo('#xl-${gi}-${k}',{opacity:0,scale:.4,rotation:-12},{opacity:1,scale:1,rotation:0,duration:.3,ease:'back.out(2)'},${at(p.at.start - 0.06)});`);
      blurIn(`#${id.get(p.at)}`, p.at.start);
      cues.push({ t: p.at.start - 0.05, sfx: "tick", gain: -10, why: `expand: ${text}` });
      return `<div class="xrow"><span class="xl" id="xl-${gi}-${k}">${esc(raw[0].toUpperCase())}</span><span class="xw" id="${id.get(p.at)}">${esc(raw.slice(1))}</span></div>`;
    });
    takeover(group, gi, scene, `<div class="kblock">${leadLines.join("")}<div class="xrows">${rows.join("")}</div></div>`, scene.variant ?? "ink");
    lead.forEach((w) => wordIn(w, group.start));
  };

  const versus = (group, gi, scene) => {
    const [a, b] = scene.sides;
    const swap = b.from.start - 0.1;
    const side = (s, key, shownAt) => {
      const label = s.label.split(" ");
      const tail = label.pop();
      blurIn(`#vl-${gi}-${key}`, shownAt, "y:18");
      const items = s.items.map((it, k) => {
        blurIn(`#vi-${gi}-${key}-${k}`, it.at.start - 0.04);
        cues.push({ t: it.at.start - 0.04, sfx: "tick", gain: -10, why: `${s.label}: ${it.text}` });
        return `<div class="vit" id="vi-${gi}-${key}-${k}"><i>${k + 1}</i><span>${esc(it.text)}</span></div>`;
      });
      return `<div class="vs ${key}" id="vs-${gi}-${key}"><div class="vin"><div class="vlab" id="vl-${gi}-${key}">${label.length ? `${esc(label.join(" "))} ` : ""}<b${label.length ? "" : ' class="solo"'}>${esc(tail)}</b></div>${items.join("")}</div></div>`;
    };
    const body = `${side(a, "a", (a.from ?? group.words[0]).start + 0.05)}${side(b, "b", b.from.start)}<div class="vmid" id="vm-${gi}">vs</div>`;
    takeover(group, gi, scene, body, "split");
    js.push(`tl.fromTo('#vs-${gi}-a',{height:'100%'},{height:'50%',duration:.42,ease:'expo.inOut'},${at(swap)});`);
    js.push(`tl.fromTo('#vs-${gi}-b',{yPercent:100},{yPercent:0,duration:.42,ease:'expo.inOut'},${at(swap)});`);
    js.push(`tl.fromTo('#vm-${gi}',{opacity:0,scale:.3},{opacity:1,scale:1,duration:.3,ease:'back.out(2.2)'},${at(swap + 0.26)});`);
    cues.push({ t: swap, sfx: "whoosh-down", gain: -13, why: `${b.label} pushes in` });
  };

  const RENDER = { card, expand, versus, list, punch };
  groups.forEach((group, gi) => (group.card === null ? stack(group, gi) : RENDER[scenes[group.card].type](group, gi, scenes[group.card])));
  html.push(`  <div id="kflash" class="clip" data-start="0" data-duration="${until}" data-track-index="23"></div>`);

  // ---- camera: a new framing per shot; overlays keep the shot running, takeovers end it ----
  const shotGroups = groups.map((g) => (g.card !== null && !TAKEOVERS.has(scenes[g.card].type) ? { ...g, card: null } : g));
  const shots = planShots(shotGroups, until, cam.minShot, cam.maxShot);
  shots.forEach((shot, i) => {
    const z = cam.zoom[i % cam.zoom.length];
    js.push(`tl.set('#vwrap',{scale:${z}},${r(shot.start)});tl.to('#vwrap',{scale:${r(z + 0.03)},duration:${r(Math.max(0.05, shot.end - shot.start - 0.04))},ease:'none'},${r(shot.start)});`);
    if (i && cam.moves[i % cam.moves.length] === "whip") js.push(`tl.fromTo('#vwrap',{filter:'blur(18px)'},{filter:'blur(0px)',duration:.22,ease:'power2.out',immediateRender:false},${r(shot.start)});`);
  });

  const css = `
${fontFaces()}
:root{--paper:${P.paper};--ink:${P.ink};--fg:${P.fg};--accent:${P.accent}}
#vwrap{transform-origin:50% ${cam.faceY}%}
#kscrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,8,20,.62) 0%,rgba(6,8,20,.30) 30%,rgba(6,8,20,.14) 55%,rgba(6,8,20,.34) 72%,rgba(6,8,20,.66) 100%)}
#kflash{position:absolute;inset:0;opacity:0;background:var(--accent)}
.kg{position:absolute;display:flex;flex-direction:column;color:var(--fg);text-shadow:0 2px 6px rgba(0,0,0,.55),0 8px 40px rgba(0,0,0,.55)}
.kg.low{left:70px;width:940px;top:${Math.round(1430 * sy)}px;align-items:center;text-align:center}
.kg.top{left:90px;width:900px;bottom:${Math.round(layout.H - 600 * sy)}px;align-items:center;text-align:center}
.kg.topL{left:70px;width:640px;bottom:${Math.round(layout.H - 610 * sy)}px;align-items:flex-start}
.kg.topR{right:70px;width:640px;bottom:${Math.round(layout.H - 610 * sy)}px;align-items:flex-end;text-align:right}
.kg.lowL{left:70px;width:640px;top:${Math.round(1410 * sy)}px;align-items:flex-start}
.kg.lowR{right:70px;width:640px;top:${Math.round(1410 * sy)}px;align-items:flex-end;text-align:right}
.kg.pn{top:auto;bottom:${Math.round(96 * sy)}px}
.kgi{display:flex;flex-direction:column;align-items:inherit}
.kl{white-space:nowrap;line-height:.94}
.kg.topL .kl.odd,.kg.lowL .kl.odd{margin-left:46px}.kg.topR .kl.odd,.kg.lowR .kl.odd{margin-right:46px}
.kw{display:inline-block;position:relative;will-change:transform,opacity,filter}
.kw + .kw{margin-left:.2em}
.kw.s{font-family:'Poppins',sans-serif;font-weight:600;font-size:84px;letter-spacing:-.05em}
.kw.h{font-family:'Poppins',sans-serif;font-weight:700;letter-spacing:-.055em;line-height:1}
.kw.i{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:96px;letter-spacing:-.02em;padding-right:.08em}
.mk{position:absolute;display:block;background:var(--accent);transform-origin:0 50%}
.mk-underline .mk{left:0;right:0;bottom:-.02em;height:.09em;border-radius:.05em}
.mk-highlight .mk{left:-.1em;right:-.1em;top:.1em;bottom:.02em;border-radius:.07em;z-index:-1}
.mk-highlight{text-shadow:none}.mk-accent{color:var(--accent)}
.ls .kgi{gap:14px}
.lt{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:76px;margin-bottom:6px}
.li{display:flex;align-items:baseline;gap:22px;font-family:'Poppins',sans-serif;font-weight:600;font-size:66px;letter-spacing:-.045em;white-space:nowrap}
.li i{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:60px;color:var(--accent);text-shadow:0 2px 10px rgba(0,0,0,.7)}
.fs{position:absolute;inset:0;overflow:hidden}
.fsi{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-bottom:${Math.round(240 * sy)}px;will-change:transform}
.fsi.v-paper{background:var(--paper);color:var(--ink)}
.fsi.v-ink{background:var(--ink);color:var(--paper)}
.fsi.v-accent{background:var(--accent);color:var(--paper)}
.fsi.v-accent .kglyph,.fsi.v-accent .xl{color:var(--ink)}
.kblock{display:flex;flex-direction:column;align-items:flex-start}
.kglyph{align-self:center;font-family:'Poppins',sans-serif;font-weight:700;font-size:250px;line-height:1;color:var(--accent);margin-bottom:26px}
.kw.cs{font-family:'Poppins',sans-serif;font-weight:600;font-size:80px;letter-spacing:-.05em}
.kw.cb{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;letter-spacing:-.03em;line-height:1.02;padding-right:.08em}
.xrows{display:flex;flex-direction:column;gap:6px;margin-top:40px}
.xrow{display:flex;align-items:baseline;white-space:nowrap}
.xl{display:inline-block;font-family:'Poppins',sans-serif;font-weight:700;font-size:230px;line-height:.98;letter-spacing:-.05em;color:var(--accent)}
.xw{display:inline-block;font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:132px;letter-spacing:-.02em}
.fsi.v-split{display:block;padding:0;background:var(--ink)}
.vs{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.vs.a{top:0;height:100%;background:var(--paper);color:var(--ink)}
.vs.b{bottom:0;height:50%;background:var(--ink);color:var(--paper)}
.vin{display:flex;flex-direction:column;align-items:flex-start;gap:20px;width:820px}
.vlab{font-family:'Poppins',sans-serif;font-weight:700;font-size:112px;letter-spacing:-.055em;line-height:1;margin-bottom:14px;white-space:nowrap}
.vlab b{margin-left:.1em;font-family:'Playfair Display',serif;font-style:italic;font-weight:500;color:var(--accent);font-size:150px;letter-spacing:0}
.vlab b.solo{margin-left:0}
.vit{display:flex;align-items:center;gap:26px;font-family:'Poppins',sans-serif;font-weight:600;font-size:62px;letter-spacing:-.045em;white-space:nowrap}
.vit i{flex:none;width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:700;font-size:40px;letter-spacing:0;background:var(--accent);color:#fff}
.vmid{position:absolute;left:50%;top:50%;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:72px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
`;
  return { anchors: {}, html: html.join("\n"), css, js: js.join("\n"), counters: [], cues, shots, groups, fontDir: FONT_DIR };
}
