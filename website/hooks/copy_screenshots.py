import logging
import shutil
from pathlib import Path

log = logging.getLogger("mkdocs")


def on_pre_build(config):
    repo_root = Path(__file__).resolve().parents[2]
    src = repo_root / "design_handoff_verspaetungsbegleiter" / "screenshots"
    dst = Path(__file__).resolve().parent.parent / "docs" / "img" / "screenshots"
    if not src.is_dir():
        log.warning(f"copy_screenshots: source not found at {src}, skipping")
        return
    shutil.copytree(src, dst, dirs_exist_ok=True)
