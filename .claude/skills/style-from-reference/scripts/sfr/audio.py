"""Stage 4: extract the soundtrack and measure the loudness of the finished mix."""
import json
import re
import subprocess
from pathlib import Path

from sfr.common import StageError, load, log, run, save, stage_out

LOUDNORM_JSON = re.compile(r"\{[^{}]*\"input_i\"[^{}]*\}")


def finite(value: str) -> float | None:
    """ffmpeg reports silence as -inf, which JSON cannot hold."""
    number = float(value)
    return round(number, 2) if number not in (float("inf"), float("-inf")) else None


def measure(path: Path) -> dict:
    """Integrated loudness (LUFS), true peak (dBTP) and loudness range (LU) of an audio file."""
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "loudnorm=print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=False,
    )
    found = LOUDNORM_JSON.findall(result.stderr)
    if result.returncode != 0 or not found:
        raise StageError(f"could not measure loudness of {path}:\n{result.stderr[-800:]}")
    report = json.loads(found[-1])
    return {
        "lufs": finite(report["input_i"]),
        "true_peak": finite(report["input_tp"]),
        "range_lu": finite(report["input_lra"]),
    }


def main() -> None:
    out = stage_out()
    source = load(out, "fetch")
    if not source["has_audio"]:
        save(out, "audio", {"skipped": "the video has no audio track"})
        return
    wav = out / "work" / "audio.wav"
    wav.parent.mkdir(parents=True, exist_ok=True)
    log("audio: extracting the soundtrack")
    run(["ffmpeg", "-v", "error", "-y", "-i", source["video"], "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", wav])
    save(out, "audio", {"wav": str(wav), "mix": measure(wav)})


if __name__ == "__main__":
    main()
