"""Downscaled WebP copies of uploaded images, generated on first request.

Avatars, component photo cells and course cards render at ~40-400px but used
to download the full original (often a multi-MB phone photo) every time.
FileDownloadView's ?size= serves one of these instead.

Generated lazily rather than at upload time, so every image uploaded before
this existed gets thumbnails too, with no backfill job. Stored next to the
original under thumbnails/<file id>/; delete_thumbnails removes the whole
folder whenever the original is deleted.
"""

import io
import logging

from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)

# Longest edge in pixels. An allowlist, not a free ?width= - otherwise anyone
# could make the server render and store an unlimited number of sizes.
THUMBNAIL_SIZES = {"sm": 160, "md": 640}

# Raster formats Pillow decodes. SVG is vector (and already small); anything
# else isn't an image the UI shows.
_THUMBNAILABLE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}

# Refuse to decode anything bigger than this (~50 megapixels, a large camera
# photo) - a tiny "decompression bomb" file can otherwise claim billions of
# pixels and exhaust the worker's memory. Such files are served as the
# original instead.
_MAX_SOURCE_PIXELS = 50_000_000


def _folder(stored_file) -> str:
    return f"thumbnails/{stored_file.pk}"


def thumbnail_name(stored_file, size: str) -> str:
    return f"{_folder(stored_file)}/{size}.webp"


def can_thumbnail(stored_file) -> bool:
    return stored_file.content_type.lower() in _THUMBNAILABLE_TYPES


def get_or_create_thumbnail(stored_file, size: str) -> str | None:
    """Storage name of `stored_file`'s thumbnail at `size`, generating it on
    first use. None when there's no thumbnail to serve (not a raster image,
    too large, or undecodable) - the caller falls back to the original."""
    if size not in THUMBNAIL_SIZES or not can_thumbnail(stored_file):
        return None
    storage = stored_file.file.storage
    name = thumbnail_name(stored_file, size)
    if storage.exists(name):
        return name

    try:
        data = _render(stored_file, THUMBNAIL_SIZES[size])
    except Exception:  # corrupt/truncated/unsupported upload - not the viewer's problem
        logger.warning("thumbnail: could not render %s for file %s", size, stored_file.pk, exc_info=True)
        return None
    if data is None:
        return None
    # Two first requests can race to generate the same thumbnail; whichever
    # saves second gets a renamed copy, which delete_thumbnails' folder sweep
    # still cleans up. Serve whatever name this request actually wrote.
    if storage.exists(name):
        return name
    return storage.save(name, ContentFile(data))


def _render(stored_file, max_edge: int) -> bytes | None:
    # Imported here so deleting thumbnails (a post_delete signal that runs in
    # every process, Celery included) never depends on Pillow being importable.
    from PIL import Image, ImageOps

    with stored_file.file.open("rb") as source:
        with Image.open(source) as image:
            width, height = image.size
            if width * height > _MAX_SOURCE_PIXELS:
                return None
            # Phone photos are stored sideways with an EXIF rotation flag that
            # browsers apply to the original but that's lost on re-encode.
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
            out = io.BytesIO()
            image.save(out, format="WEBP", quality=82, method=4)
            return out.getvalue()


def delete_thumbnails(stored_file) -> None:
    """Removes every thumbnail of `stored_file` (including any duplicate a
    generation race left behind). Best effort: a storage error here must not
    block deleting the original."""
    storage = stored_file.file.storage
    folder = _folder(stored_file)
    try:
        _, names = storage.listdir(folder)
    except (FileNotFoundError, NotImplementedError, OSError):
        return
    for name in names:
        try:
            storage.delete(f"{folder}/{name}")
        except Exception:
            logger.warning("thumbnail: could not delete %s/%s", folder, name, exc_info=True)
