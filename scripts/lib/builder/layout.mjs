// Output formats. A format is a layout contract: frame size, where overlay panels, captions and the lower-third sit,
// and which base video it uses. Add a format here (and verify it on rendered frames) before offering it to the user.
//   k          scale applied to the 940x420 design size of an overlay panel
//   panelTop   y of the top band reserved for graphics (the face stays below it)
//   capTop     y of the caption bar (lower third)
//   ltTop      y of the lower-third bar (below the captions)
//   originY    transform-origin % for the slow camera push (about where the face is)
export const LAYOUTS = {
  "4x5": { name: "LinkedIn feed 4:5", W: 1080, H: 1350, k: 0.82, panelTop: 26, capTop: 1010, ltTop: 1190, base: "assets/base-4x5.mp4", originY: 52 },
  "9x16": { name: "TikTok / Reels / Shorts 9:16", W: 1080, H: 1920, k: 1, panelTop: 150, capTop: 1390, ltTop: 1590, base: "assets/base.mp4", originY: 42 },
};

export function layoutFor(format) {
  if (!format) throw new Error(`--format is required (ask the user which platform it is for). Options: ${Object.keys(LAYOUTS).join(", ")}`);
  const l = LAYOUTS[format];
  if (!l) throw new Error(`unknown format "${format}". Options: ${Object.keys(LAYOUTS).join(", ")}. A new format needs a layout entry in scripts/lib/builder/layout.mjs.`);
  return l;
}
