// Per-video graphics. The reusable pipeline is scripts/build-video.mjs (docs/BUILDER.md); this file is the only part
// that depends on what THIS video says. Full worked example: examples/brand-video-emr/beats.mjs.
//
// Rules: graphics show the example, relationship or consequence the speaker describes (not a restatement of the
// captions); one idea per beat; keep the face clear (the top band is for graphics); real product/screens or clean
// graphics only; no colours or fonts outside brand/BRAND.md. Overlay clips use data-track-index >= 20.
// EVERY count-up number goes in `counters` (never hand-write a counting tween): it gets rising tick sound automatically.
export default function beats({ find, H, HB, r, C }) {
  // Anchor graphics to spoken words: find(word, afterSeconds?, "hook"|"body"?) -> { text, start, end }
  const A = {
    // example: stat: find("percent", HB),
  };

  const counters = [
    // example: { id: "num1", from: 0, to: 37, start: A.stat.start, duration: 0.8, ease: "power2.out", suffix: "%", land: "ping", landGain: -8, gain: -12, why: "37% counts up" },
  ];

  const cues = [
    // extra one-off sounds: { t: seconds, sfx: "pop" | "tick" | "hit" | "ping" | "whoosh-up" | "whoosh-down" | "riser", gain: dB, why }
  ];

  const css = ``;
  const html = ``; // e.g. <div id="p1" class="panel clip" data-start="${r(A.stat.start - 0.1)}" data-duration="3" data-track-index="20"> ... </div>
  const js = ``;   // GSAP on the shared timeline `tl`; read anchors with T("stat") (start) / T("stat", 1) (end)

  return { anchors: A, html, css, js, counters, cues };
}
