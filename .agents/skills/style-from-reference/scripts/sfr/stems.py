"""Stage 5: split the soundtrack into voice and everything else (music + effects) with Demucs."""
import shutil
import sys

from sfr.audio import measure
from sfr.common import StageError, load, log, run, save, stage_out

MODEL = "htdemucs"


def main() -> None:
    out = stage_out()
    audio = load(out, "audio")
    if "wav" not in audio:
        save(out, "stems", {"skipped": "no soundtrack to separate"})
        return
    device = load(out, "options").get("device", "cpu")
    work = out / "work"
    log(f"stems: separating voice from music and effects on {device} (the slowest step)")
    run([
        sys.executable, "-I", "-B", "-m", "demucs", "-n", MODEL, "--two-stems", "vocals",
        "-d", device, "-o", work / "demucs", audio["wav"],
    ])
    produced = work / "demucs" / MODEL / "audio"
    stems = work / "stems"
    stems.mkdir(parents=True, exist_ok=True)
    for name in ("vocals", "no_vocals"):
        if not (produced / f"{name}.wav").exists():
            raise StageError(f"demucs did not write {name}.wav")
        shutil.move(produced / f"{name}.wav", stems / f"{name}.wav")
    shutil.rmtree(work / "demucs")
    voice, bed = measure(stems / "vocals.wav"), measure(stems / "no_vocals.wav")
    both = voice["lufs"] is not None and bed["lufs"] is not None
    save(out, "stems", {
        "vocals": str(stems / "vocals.wav"),
        "no_vocals": str(stems / "no_vocals.wav"),
        "voice": voice,
        "music_and_effects": bed,
        # Negative = the bed sits that many LU below the voice. Maps to sound-design.mjs --rel.
        "bed_relative_to_voice_lu": round(bed["lufs"] - voice["lufs"], 1) if both else None,
    })


if __name__ == "__main__":
    main()
