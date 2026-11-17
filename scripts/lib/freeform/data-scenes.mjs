// Data scenes for the free-form engine: a number counting up, a bar chart, a step timeline.
// All three are takeovers (they replace the picture; the voice carries on) and are driven by spoken words:
// each number, bar or step appears when its word is said. Wired in by scripts/lib/freeform/freeform.mjs.
//
//   counter   { value: { at: word, to: 37, from?: 0, prefix?: "$", suffix?: "%" }, label?, variant? }
//   chart     { title?, bars: [{ at: word, label, value, display? }], variant? }          2 to 6 bars
//   timeline  { title?, steps: [{ at: word, label, caption? }], variant? }                2 to 5 steps
//
// Counters are integers (the tween rounds). Show a decimal as its own text in a `card`, or use a chart `display`.
// The counting tween itself comes from the builder through the `counters` array, which also adds the rising tick
// sound and the landing ping, so picture and sound cannot drift apart.
import { esc } from "../../../style-library/03-kinetic-serif/kinetic.mjs";
import { sweep } from "../motion/primitives.mjs";

export const DATA_TYPES = new Set(["counter", "chart", "timeline"]);
export const DATA_DEFAULT_IN = { counter: "zoom", chart: "push", timeline: "push" };
export const DATA_DEFAULT_VARIANT = { counter: "ink", chart: "paper", timeline: "paper" };
// Limits keep every label on one line at its font size inside the 900 px column (step text has 798 px beside the dot).
const LIMITS = { counterLabel: 40, barLabel: 24, stepLabel: 22, stepCaption: 36, title: 26 };
const TITLE_H = 132; // title line plus its margin, in 1080x1920 design units
const ROW_H = { bar: 144, barGap: 34 };
const STEP_H = (n) => (n === 2 ? 250 : n === 5 ? 164 : 210);
const LAST_STEP_H = 130;

/** Scale (<= 1) that fits content of `height` design pixels inside the frame, keeping the bottom UI margin the takeovers already leave. */
export function fitScale(height, frameH) {
  const room = (frameH - (240 * frameH) / 1920) * 0.94;
  return Math.min(1, +(room / height).toFixed(3));
}

/** Throws through `fail` (which names the scene) when a data scene cannot be built. */
export function validateDataScene(scene, fail, inRange) {
  const text = (v, max, what) => { if (typeof v !== "string" || !v.trim() || v.length > max) fail(`${what} must be 1 to ${max} characters`); };
  if (scene.title !== undefined) text(scene.title, LIMITS.title, "title");
  if (scene.type === "counter") {
    const v = scene.value;
    if (!v || !inRange(v.at)) fail("needs value: { at: word, to: number } with the word inside the scene");
    const from = v.from ?? 0;
    if (!Number.isInteger(v.to) || !Number.isInteger(from) || v.to <= from || v.to > 999999999) fail("needs integer value.from < value.to (counters are whole numbers)");
    for (const k of ["prefix", "suffix"]) if (v[k] !== undefined && (typeof v[k] !== "string" || v[k].length > 4)) fail(`value.${k} must be up to 4 characters`);
    if (scene.label !== undefined) text(scene.label, LIMITS.counterLabel, "label");
  }
  if (scene.type === "chart") {
    const bars = scene.bars;
    if (!(Array.isArray(bars) && bars.length >= 2 && bars.length <= 6)) fail("needs 2 to 6 bars");
    bars.forEach((b, k) => {
      if (!inRange(b.at)) fail(`bar ${k} needs { at: word } inside the scene`);
      text(b.label, LIMITS.barLabel, `bar ${k} label`);
      if (!Number.isFinite(b.value) || b.value < 0) fail(`bar ${k} needs a value of 0 or more`);
    });
    if (!bars.some((b) => b.value > 0)) fail("needs at least one bar above 0");
  }
  if (scene.type === "timeline") {
    const steps = scene.steps;
    if (!(Array.isArray(steps) && steps.length >= 2 && steps.length <= 5)) fail("needs 2 to 5 steps");
    steps.forEach((s, k) => {
      if (!inRange(s.at)) fail(`step ${k} needs { at: word } inside the scene`);
      text(s.label, LIMITS.stepLabel, `step ${k} label`);
      if (s.caption !== undefined) text(s.caption, LIMITS.stepCaption, `step ${k} caption`);
    });
    if (steps.some((s, k) => k && s.at.start <= steps[k - 1].at.start)) fail("steps must be in spoken order");
  }
}

/** Scene renderers. `h` is the engine's helper bundle: { js, cues, counters, at, blurIn, takeover }. */
export function dataScenes(h) {
  const { js, cues, counters, at, blurIn, takeover, frameH } = h;
  const wrap = (inner, height, cls = "") => {
    const k = fitScale(height, frameH);
    return `<div class="dwrap${cls}"${k < 1 ? ` style="transform:scale(${k})"` : ""}>${inner}</div>`;
  };
  const title = (gi, scene) => {
    if (!scene.title) return "";
    blurIn(`#dt-${gi}`, scene.from.start + 0.04, "y:14");
    return `<div class="dttl" id="dt-${gi}">${esc(scene.title)}</div>`;
  };

  const counter = (group, gi, scene) => {
    const v = scene.value, from = v.from ?? 0;
    const start = Math.max(group.start + 0.12, v.at.start - 0.05);
    const room = group.end - start - 0.5;
    const duration = +Math.max(0.4, Math.min(1.1, room)).toFixed(2);
    const chars = String(v.to).length + (v.prefix ?? "").length + (v.suffix ?? "").length;
    const size = Math.min(380, Math.floor(900 / (Math.max(2, chars) * 0.62)));
    const label = scene.label ? `<div class="dlab" id="dl-${gi}">${esc(scene.label)}</div>` : "";
    takeover(group, gi, scene, `<div class="dwrap">${title(gi, scene)}<div class="cnum" id="cn-${gi}" style="font-size:${size}px">${v.prefix ? `<span class="cpre">${esc(v.prefix)}</span>` : ""}<span id="ctr-${gi}">${from}${esc(v.suffix ?? "")}</span></div>${label}</div>`, scene.variant ?? DATA_DEFAULT_VARIANT.counter);
    js.push(`tl.fromTo('#cn-${gi}',{opacity:0,scale:.82,filter:'blur(14px)'},{opacity:1,scale:1,filter:'blur(0px)',duration:.3,ease:'power3.out'},${at(group.start + 0.06)});`);
    js.push(`tl.to('#cn-${gi}',{scale:1.06,duration:.12,ease:'power2.out'},${at(start + duration)});tl.to('#cn-${gi}',{scale:1,duration:.2,ease:'power2.inOut'},${at(start + duration + 0.12)});`);
    if (scene.label) blurIn(`#dl-${gi}`, start + duration * 0.5, "y:16");
    // The counting tween and its tick sound are generated by the builder from this entry.
    counters.push({ id: `ctr-${gi}`, from, to: v.to, start: +start.toFixed(3), duration, ease: "power2.out", suffix: v.suffix ?? "", why: `counter: ${v.prefix ?? ""}${v.to}${v.suffix ?? ""}` });
  };

  const chart = (group, gi, scene) => {
    const max = Math.max(...scene.bars.map((b) => b.value));
    const top = scene.bars.findIndex((b) => b.value === max);
    const rows = scene.bars.map((b, k) => {
      const pct = Math.max(2, (b.value / max) * 72);
      const t = b.at.start - 0.05;
      blurIn(`#cr-${gi}-${k}`, t, "y:16");
      js.push(sweep(`#cb-${gi}-${k}`, at(t + 0.08), { duration: 0.55, ease: "expo.out" }));
      cues.push({ t, sfx: "tick", gain: -10, why: `chart bar ${k + 1}: ${b.label}` });
      return `<div class="crow" id="cr-${gi}-${k}"><div class="cl">${esc(b.label)}</div><div class="ctrack"><div class="cbar${k === top ? " top" : ""}" id="cb-${gi}-${k}" style="width:${pct.toFixed(1)}%"></div><span class="cv">${esc(b.display ?? String(b.value))}</span></div></div>`;
    });
    const height = (scene.title ? TITLE_H : 0) + scene.bars.length * ROW_H.bar + (scene.bars.length - 1) * ROW_H.barGap;
    takeover(group, gi, scene, wrap(`${title(gi, scene)}<div class="crows">${rows.join("")}</div>`, height), scene.variant ?? DATA_DEFAULT_VARIANT.chart);
  };

  const timeline = (group, gi, scene) => {
    const n = scene.steps.length;
    const rows = scene.steps.map((s, k) => {
      const t = s.at.start - 0.05;
      blurIn(`#ts-${gi}-${k}`, t, "x:-30");
      js.push(`tl.fromTo('#td-${gi}-${k}',{scale:0},{scale:1,duration:.3,ease:'back.out(2.4)'},${at(t)});`);
      cues.push({ t, sfx: "tick", gain: -10, why: `timeline step ${k + 1}: ${s.label}` });
      const next = scene.steps[k + 1];
      if (next) js.push(`tl.fromTo('#tg-${gi}-${k}',{scaleY:0},{scaleY:1,duration:${(+Math.max(0.25, Math.min(0.9, next.at.start - s.at.start - 0.1)).toFixed(2))},ease:'power2.inOut'},${at(t + 0.2)});`);
      const seg = next ? `<i class="tseg" id="tg-${gi}-${k}"></i>` : "";
      return `<div class="tstep${k === n - 1 ? " last" : ""}" id="ts-${gi}-${k}"><b class="tdot" id="td-${gi}-${k}">${k + 1}</b>${seg}<div class="ttx"><div class="tlb">${esc(s.label)}</div>${s.caption ? `<div class="tcp">${esc(s.caption)}</div>` : ""}</div></div>`;
    });
    const height = (scene.title ? TITLE_H : 0) + (n - 1) * STEP_H(n) + LAST_STEP_H;
    takeover(group, gi, scene, wrap(`${title(gi, scene)}<div class="tsteps n${n}">${rows.join("")}</div>`, height, " left"), scene.variant ?? DATA_DEFAULT_VARIANT.timeline);
  };

  return { counter, chart, timeline };
}

export const DATA_CSS = `
.dwrap{display:flex;flex-direction:column;align-items:center;width:900px;transform-origin:50% 50%}
.dwrap.left{align-items:flex-start}
.dttl{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:84px;line-height:1.05;margin-bottom:44px;align-self:flex-start}
.cnum{display:flex;align-items:baseline;justify-content:center;font-family:'Poppins',sans-serif;font-weight:700;line-height:1;letter-spacing:-.06em;color:var(--accent);white-space:nowrap}
.cpre{font-size:.62em;margin-right:.04em}
.dlab{margin-top:30px;font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:84px;line-height:1.05;text-align:center}
.crows{display:flex;flex-direction:column;gap:34px;width:900px}
.cl{font-family:'Poppins',sans-serif;font-weight:600;font-size:54px;letter-spacing:-.04em;line-height:1.2;margin-bottom:10px;white-space:nowrap}
.ctrack{display:flex;align-items:center;gap:22px;width:900px}
.cbar{flex:none;height:68px;border-radius:10px;background:currentColor;opacity:.88;transform-origin:0 50%}
.cbar.top{background:var(--accent);opacity:1}
.cv{font-family:'Poppins',sans-serif;font-weight:700;font-size:60px;letter-spacing:-.05em;line-height:1;white-space:nowrap}
.tsteps{display:flex;flex-direction:column;width:900px}
.tstep{position:relative;display:flex;align-items:flex-start;gap:38px;min-height:210px}
.tsteps.n5 .tstep{min-height:164px}.tsteps.n2 .tstep{min-height:250px}
.tstep.last{min-height:0}
.tdot{flex:none;width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--accent);color:#fff;font-family:'Poppins',sans-serif;font-weight:700;font-size:34px;letter-spacing:0}
.tseg{position:absolute;left:29px;top:70px;bottom:6px;width:6px;border-radius:3px;background:currentColor;opacity:.3;transform-origin:50% 0}
.tlb{font-family:'Poppins',sans-serif;font-weight:600;font-size:66px;letter-spacing:-.045em;line-height:1.02}
.tcp{margin-top:8px;font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:46px;line-height:1.1;opacity:.8}
`;
