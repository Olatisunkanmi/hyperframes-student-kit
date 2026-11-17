"""Stage 1: get the reference video (download a URL with yt-dlp, or use a local file) and probe it."""
import shutil
import sys
from pathlib import Path

from sfr.common import StageError, load, log, probe, read_json, run, save, stage_out

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
KEPT_FIELDS = ("title", "track", "artist", "album", "uploader", "webpage_url", "upload_date")


def download(url: str, folder: Path) -> Path:
    """Download into an empty folder of its own; nothing else is ever written there."""
    run([
        sys.executable, "-I", "-B", "-m", "yt_dlp", "--no-playlist", "--no-progress",
        "--merge-output-format", "mp4", "--write-info-json",
        "-o", str(folder / "video.%(ext)s"), url,
    ])
    videos = [p for p in folder.iterdir() if p.suffix.lower() in VIDEO_SUFFIXES]
    if not videos:
        raise StageError("yt-dlp finished but no video file was written")
    return videos[0]


def sound_metadata(folder: Path) -> dict:
    """The platform's own description of the post, including the name of the sound when it has one."""
    info_file = folder / "video.info.json"
    if not info_file.exists():
        return {}
    info = read_json(info_file)
    kept = {key: info[key] for key in KEPT_FIELDS if info.get(key)}
    description = (info.get("description") or "")[:300]
    return {**kept, "description": description} if description else kept


def main() -> None:
    out = stage_out()
    source = load(out, "options")["input"]
    folder = out / "source"
    if source.startswith(("http://", "https://")):
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        log(f"fetch: downloading {source}")
        video = download(source, folder)
        meta = sound_metadata(folder)
    else:
        video = Path(source).expanduser().resolve()
        if not video.is_file():
            raise StageError(f"input not found: {video}")
        meta = {}
    save(out, "fetch", {"input": source, "video": str(video), "post": meta, **probe(video)})


if __name__ == "__main__":
    main()
