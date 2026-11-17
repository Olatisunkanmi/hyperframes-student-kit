// Motion primitives: the small GSAP recipes that scenes are built from, as functions returning the JavaScript
// that goes on a composition's shared paused timeline `tl` (see the hyperframes and gsap skills).
//
// Each takes a CSS selector and an absolute time in seconds (already rounded by the caller). They emit strings,
// not tweens, because compositions are generated HTML; the strings are deterministic so renders reproduce.
// Rules the recipes keep: transforms and opacity only (plus filter blur for focus pulls), finite durations,
// no repeat:-1, nothing that depends on wall-clock time.
//
//   blurRise   a word focusing in from slightly below and large        (caption words)
//   blurSlide  an item focusing in from the side or from below          (list rows, labels, titles)
//   blurOut    a short focus-out, then hidden                           (caption stacks, list blocks)
//   sweep      a bar or line growing from its origin along one axis     (underlines, chart bars, rails)
//   slam       a word landing large and shrinking to size               (punch words)
//   pop        an element springing in with overshoot                   (initials, badges)
//   pulse      a quick scale-up and settle                              (a number as it is said)
//   shake      a short horizontal shake                                 (a negation as it is said)
//
// PRIMITIVES lists them with their family so a variety check can tell recipes apart.

// GSAP examples write sub-1 numbers without the leading zero; keep that so emitted code stays compact.
const n = (x) => String(x).replace(/^(-?)0\./, "$1.");

export const blurRise = (sel, t) =>
  `tl.fromTo('${sel}',{opacity:0,filter:'blur(16px)',y:16,scale:1.06},{opacity:1,filter:'blur(0px)',y:0,scale:1,duration:.26,ease:'power2.out'},${t});`;

/** `from` is the extra starting offset: "x:-30" slides from the left, "y:14" rises from below. */
export const blurSlide = (sel, t, from = "x:-30") =>
  `tl.fromTo('${sel}',{opacity:0,${from},filter:'blur(12px)'},{opacity:1,x:0,y:0,filter:'blur(0px)',duration:.3,ease:'power2.out'},${t});`;

/**
 * Fade-and-blur out at `t`, then force hidden at `tHide` so a late seek never shows it. Pass the end of the clip that
 * holds the element: hyperframes lint (gsap_exit_missing_hard_kill) wants a hard kill within 0.05 s of every clip
 * start that an exit tween ends within 0.05 s of, and a clip's own end is always within that of the next start.
 * Without `tHide` it hides where the tween ends.
 */
export const blurOut = (sel, t, tHide = +(t + 0.1).toFixed(3)) =>
  `tl.to('${sel}',{opacity:0,filter:'blur(10px)',duration:.1,ease:'power1.in'},${t});tl.set('${sel}',{opacity:0},${tHide});`;

/** Grow from 0 to full length. axis "x" grows left to right, "y" top to bottom (set transform-origin in CSS). */
export const sweep = (sel, t, { duration = 0.32, ease = "power3.out", axis = "x" } = {}) => {
  const prop = axis === "y" ? "scaleY" : "scaleX";
  return `tl.fromTo('${sel}',{${prop}:0},{${prop}:1,duration:${n(duration)},ease:'${ease}'},${t});`;
};

export const slam = (sel, t) =>
  `tl.fromTo('${sel}',{opacity:0,scale:1.7,filter:'blur(22px)'},{opacity:1,scale:1,filter:'blur(0px)',duration:.2,ease:'expo.out'},${t});`;

/** Spring in from `scale`, optionally rotating in from `rotation` degrees. */
export const pop = (sel, t, { scale = 0.4, rotation = null, duration = 0.3, ease = "back.out(2)" } = {}) => {
  const from = `opacity:0,scale:${n(scale)}${rotation === null ? "" : `,rotation:${rotation}`}`;
  const to = `opacity:1,scale:1${rotation === null ? "" : ",rotation:0"}`;
  return `tl.fromTo('${sel}',{${from}},{${to},duration:${n(duration)},ease:'${ease}'},${t});`;
};

/** Scale up to `to` and settle back. Start it after the word's own entrance has finished. The settle starts 1 ms after the rise ends so hyperframes lint does not report a zero-length overlap. */
export const pulse = (sel, t, { to = 1.14 } = {}) =>
  `tl.to('${sel}',{scale:${n(to)},duration:.12,ease:'power2.out'},${t});tl.to('${sel}',{scale:1,duration:.2,ease:'power2.inOut'},${+(t + 0.121).toFixed(3)});`;

/** Four quick offsets that settle at 0, 1 ms apart so consecutive tweens never touch (lint: overlapping_gsap_tweens). Animates x only, so it never fights an entrance on y or scale. */
export const shake = (sel, t, { amount = 9 } = {}) => {
  const steps = [-amount, amount * 0.85, -amount * 0.5, 0];
  return steps.map((x, i) => `tl.to('${sel}',{x:${+x.toFixed(1)},duration:.06,ease:'power1.out'},${+(t + i * 0.061).toFixed(3)});`).join("");
};

export const PRIMITIVES = Object.freeze({
  blurRise: { family: "enter" },
  blurSlide: { family: "enter" },
  blurOut: { family: "exit" },
  sweep: { family: "draw" },
  slam: { family: "enter" },
  pop: { family: "enter" },
  pulse: { family: "emphasis" },
  shake: { family: "emphasis" },
});
