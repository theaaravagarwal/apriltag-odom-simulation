#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _pick_default_pdf(tags_dir: Path) -> Path | None:
    preferred = [
        tags_dir / "all32tagspdf.pdf",
        tags_dir / "2026-apriltag-images-user-guide.pdf",
    ]
    for candidate in preferred:
        if candidate.exists():
            return candidate
    pdfs = sorted(tags_dir.glob("*.pdf"))
    return pdfs[0] if pdfs else None


def _write_with_pymupdf(pdf_path: Path, output_dir: Path, size: int) -> int:
    import fitz  # type: ignore

    doc = fitz.open(pdf_path)
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        scale = size / 1000.0
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out_path = output_dir / f"{page_index + 1}.png"
        pix.save(str(out_path))
    return doc.page_count


def _write_with_pdftoppm(pdf_path: Path, output_dir: Path, size: int) -> int:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        prefix = tmpdir_path / "page"
        cmd = [
            "pdftoppm",
            "-png",
            "-r",
            str(size),
            str(pdf_path),
            str(prefix),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                "pdftoppm failed.\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}\n"
            )
        rendered = sorted(tmpdir_path.glob("page-*.png"))
        for idx, src in enumerate(rendered, start=1):
            shutil.copyfile(src, output_dir / f"{idx}.png")
        return len(rendered)


def _write_with_imagemagick(pdf_path: Path, output_dir: Path, size: int) -> int:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        cmd = [
            "magick",
            "-density",
            str(size),
            str(pdf_path),
            str(tmpdir_path / "page.png"),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                "ImageMagick failed.\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}\n"
            )
        rendered = sorted(tmpdir_path.glob("page-*.png"))
        if not rendered:
            rendered = sorted(tmpdir_path.glob("page*.png"))
        for idx, src in enumerate(rendered, start=1):
            shutil.copyfile(src, output_dir / f"{idx}.png")
        return len(rendered)


def _write_with_qlmanage_single(pdf_path: Path, output_dir: Path, size: int) -> int:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        cmd = [
            "qlmanage",
            "-t",
            "-s",
            str(size),
            "-o",
            str(tmpdir_path),
            str(pdf_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                "qlmanage failed.\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}\n"
            )
        rendered = sorted(tmpdir_path.glob("*.png"))
        if not rendered:
            raise RuntimeError("No PNG output produced by qlmanage.")
        shutil.copyfile(rendered[0], output_dir / "1.png")
        return 1


def extract_all_pages(pdf_path: Path, output_dir: Path, size: int) -> int:
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    if shutil.which("pdftoppm"):
        return _write_with_pdftoppm(pdf_path, output_dir, size)
    if shutil.which("magick"):
        return _write_with_imagemagick(pdf_path, output_dir, size)

    try:
        import fitz  # noqa: F401

        return _write_with_pymupdf(pdf_path, output_dir, size)
    except Exception:
        return _write_with_qlmanage_single(pdf_path, output_dir, size)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    tags_dir = repo_root / "tags"

    parser = argparse.ArgumentParser(
        description=(
            "Extract every PDF page into numbered PNGs (1.png, 2.png, ...)"
        )
    )
    parser.add_argument(
        "pdf",
        nargs="?",
        help="Path to the PDF. Defaults to the first PDF in ./tags.",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=300,
        help="Render density/size. Higher = higher resolution.",
    )
    parser.add_argument(
        "--out-dir",
        help="Output directory. Defaults to the PDF's folder.",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser() if args.pdf else _pick_default_pdf(tags_dir)
    if pdf_path is None:
        print(f"No PDF found in {tags_dir}", file=sys.stderr)
        return 1

    output_dir = Path(args.out_dir).expanduser() if args.out_dir else pdf_path.parent

    try:
        written = extract_all_pages(pdf_path, output_dir, args.size)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"Wrote {written} page(s) into {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
