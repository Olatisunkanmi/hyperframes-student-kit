"""Shared helpers for the analysis stages: subprocess, JSON files, ffprobe, paths."""
import json
import subprocess
import sys
from fractions import Fraction
from pathlib import Path


class StageError(RuntimeError):
    """A stage could not finish. The message is shown to the user as-is."""


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def run(cmd: list, cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run a command, raising StageError with the tail of stderr when it fails."""
    result = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, cwd=cwd, check=False)
    if result.returncode != 0:
        raise StageError(f"{cmd[0]} exited {result.returncode}:\n{result.stderr[-1500:]}")
    return result


def read_json(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def data_path(out: Path, name: str) -> Path:
    return out / "data" / f"{name}.json"


def load(out: Path, name: str) -> dict:
    """Read a stage's result, or an empty dict when that stage did not run."""
    path = data_path(out, name)
    return read_json(path) if path.exists() else {}


def save(out: Path, name: str, data: dict) -> None:
    write_json(data_path(out, name), data)


def stage_out() -> Path:
    """Every stage is invoked as `python -m sfr.<stage> <out-dir> ...`."""
    if len(sys.argv) < 2:
        raise SystemExit("usage: python -m sfr.<stage> <out-dir>")
    return Path(sys.argv[1]).resolve()


def probe(video: Path) -> dict:
    """Width, height, frame rate, duration and whether the file has an audio track."""
    raw = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", video])
    info = json.loads(raw.stdout)
    streams = info.get("streams", [])
    picture = next((s for s in streams if s.get("codec_type") == "video"), None)
    if picture is None:
        raise StageError(f"no video stream in {video}")
    rate = picture.get("avg_frame_rate") or picture.get("r_frame_rate") or "30/1"
    fps = float(Fraction(rate)) if not rate.startswith("0") else 30.0
    return {
        "width": int(picture["width"]),
        "height": int(picture["height"]),
        "fps": round(fps, 3),
        "duration": round(float(info["format"]["duration"]), 3),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "video_codec": picture.get("codec_name"),
    }
