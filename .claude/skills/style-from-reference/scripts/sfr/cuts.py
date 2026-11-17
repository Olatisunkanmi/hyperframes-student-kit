"""Stage 2: find every cut with ffmpeg's scene score and turn the cuts into pacing numbers."""
from sfr.common import load, log, run, save, stage_out
from sfr.metrics import parse_scene_scores, pick_cuts, shot_stats

SOFT_THRESHOLD = 0.1


def main() -> None:
    out = stage_out()
    source = load(out, "fetch")
    threshold = float(load(out, "options").get("scene", 0.3))
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)
    log("cuts: scoring every frame")
    # Relative output name + cwd keeps awkward characters in the path out of the filter string.
    run([
        "ffmpeg", "-v", "error", "-y", "-i", source["video"], "-an",
        "-vf", "select='gte(scene,0)',metadata=print:file=scene.txt", "-f", "null", "-",
    ], cwd=work)
    scores = parse_scene_scores((work / "scene.txt").read_text(encoding="utf-8"))
    cuts = pick_cuts(scores, threshold)
    hard = set(cuts)
    soft = [t for t in pick_cuts(scores, SOFT_THRESHOLD) if t not in hard]
    save(out, "cuts", {
        "threshold": threshold,
        "cuts": cuts,
        # Same-framing jump cuts and punch-ins score low. These need a look on the contact sheets.
        "soft_changes": soft,
        **shot_stats(cuts, source["duration"]),
    })


if __name__ == "__main__":
    main()
