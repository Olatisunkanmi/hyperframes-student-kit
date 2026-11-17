"""Command line for the analyzer. Each stage runs as its own process, so only one model is in memory
at a time and a finished stage is never repeated when a run is resumed."""
import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

from sfr.common import data_path, load, log, save

# (stage, optional): a failed optional stage is recorded and the run continues without it.
STAGES = [
    ("fetch", False), ("cuts", False), ("frames", False), ("audio", False),
    ("stems", True), ("transcript", True), ("rhythm", True), ("tags", True),
]
PACKAGES = ["torch", "torchaudio", "demucs", "librosa", "transformers", "faster_whisper", "PIL", "yt_dlp"]


def run_stage(name: str, out: Path, extra: list[str] | None = None) -> subprocess.CompletedProcess:
    cmd = [sys.executable, "-I", "-B", "-m", f"sfr.{name}", str(out), *(extra or [])]
    return subprocess.run(cmd, stderr=subprocess.PIPE, text=True, check=False)


def last_line(text: str) -> str:
    lines = [line for line in text.strip().splitlines() if line.strip()]
    return lines[-1][:300] if lines else "no error output"


def is_run_folder(out: Path) -> bool:
    """True for a folder this tool created, the only kind --force may delete."""
    return data_path(out, "options").exists()


def analyze(args: argparse.Namespace) -> int:
    out = args.out.resolve()
    if out.exists() and any(out.iterdir()) and not is_run_folder(out):
        log(f"analyze: {out} is not empty and is not an earlier run of this tool. Choose a new --out folder.")
        return 2
    if args.force and out.exists():
        shutil.rmtree(out)
    previous = load(out, "options").get("input")
    if previous is not None and previous != args.input:
        log(f"analyze: {out} already holds the analysis of {previous}. Use a new --out folder, or --force to replace it.")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    save(out, "options", {
        "input": args.input, "scene": args.scene, "device": args.device, "whisper": args.whisper,
    })
    skip = {name for name in args.skip.split(",") if name}
    errors = {name: "skipped with --skip" for name in skip}
    for name, optional in STAGES:
        if name in skip or data_path(out, name).exists():
            continue
        result = run_stage(name, out)
        sys.stderr.write("".join(line + "\n" for line in result.stderr.splitlines() if line.startswith(f"{name}:")))
        if result.returncode == 0:
            continue
        if not optional:
            log(f"{name} failed:\n{result.stderr[-2000:]}")
            return 1
        log(f"{name} failed, continuing without it: {last_line(result.stderr)}")
        errors = {**errors, name: last_line(result.stderr)}
    save(out, "errors", errors)
    if run_stage("report", out).returncode != 0:
        return 1
    print(out / "REPORT.md")
    return 0


def folder_size_gb(path: Path) -> float:
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file() and not f.is_symlink())
    return round(total / 1e9, 2)


def doctor() -> int:
    home = Path(os.environ["STYLE_REF_HOME"])
    missing = [name for name in PACKAGES if importlib.util.find_spec(name) is None]
    tools = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    print(f"python   {sys.version.split()[0]}")
    print(f"home     {home}")
    print(f"venv     {folder_size_gb(home / 'venv')} GB")
    print(f"models   {folder_size_gb(home / 'models') if (home / 'models').exists() else 0} GB")
    print(f"packages {'ok' if not missing else 'MISSING ' + ', '.join(missing)}")
    print(f"ffmpeg   {'ok' if not tools else 'MISSING ' + ', '.join(tools)}")
    return 1 if missing or tools else 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="style-ref", description="Measure the editing style of a reference video.")
    commands = root.add_subparsers(dest="command", required=True)
    run = commands.add_parser("analyze", help="run every stage and write REPORT.md + analysis.json")
    run.add_argument("input", help="a video URL (TikTok, Reel, Short) or a local video file")
    run.add_argument("--out", type=Path, required=True, help="folder for this reference's analysis")
    run.add_argument("--skip", default="", help="comma list of optional stages: stems,transcript,rhythm,tags")
    run.add_argument("--force", action="store_true", help="delete the folder and start again")
    run.add_argument("--scene", type=float, default=0.3, help="scene-change score that counts as a cut")
    run.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"], help="where Demucs runs")
    run.add_argument("--whisper", default="small", help="faster-whisper model name")
    look = commands.add_parser("frames", help="contact sheet of a time range, for a closer look")
    look.add_argument("out", type=Path)
    look.add_argument("--range", nargs=2, required=True, metavar=("START", "END"))
    look.add_argument("--fps", default="8")
    commands.add_parser("doctor", help="check the install and show how much disk it uses")
    commands.add_parser("warm", help="download every model now so later runs work offline")
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "analyze":
        return analyze(args)
    if args.command == "frames":
        if not load(args.out.resolve(), "fetch"):
            log(f"no analysis in {args.out}: run `style-ref analyze` first")
            return 1
        result = run_stage("frames", args.out.resolve(), ["--range", *args.range, "--fps", args.fps])
        sys.stderr.write(result.stderr)
        return result.returncode
    if args.command == "warm":
        return subprocess.run([sys.executable, "-I", "-B", "-m", "sfr.warm"], check=False).returncode
    return doctor()


if __name__ == "__main__":
    sys.exit(main())
