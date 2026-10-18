"""Upload validation: an extension allowlist, magic-byte checks, and a hard blocklist.

The extension picks the expected type; a file whose leading bytes contradict it is rejected, so
"payload.html" renamed to "payload.png" doesn't pass. Stored content types come from this table,
never from the client's request. Self-hosters can allow more extensions with UPLOAD_EXTRA_EXTENSIONS
(accepted as application/octet-stream), but never the active-content types in BLOCKED_EXTENSIONS.
"""

import os
from collections.abc import Callable

from django.conf import settings
from rest_framework.exceptions import ValidationError

HEADER_BYTES = 4096

# Never accepted, even via UPLOAD_EXTRA_EXTENSIONS: content a browser or OS can execute or render.
BLOCKED_EXTENSIONS = frozenset(
    "html htm xhtml shtml svg svgz js mjs cjs jsx wasm exe dll com scr msi msp bat cmd ps1 psm1 vbs vbe "
    "wsf wsh hta jar class apk app dmg pkg deb rpm php phtml phar asp aspx jsp cgi swf lnk reg scf iso".split()
)


def _starts_with(*signatures: bytes) -> Callable[[bytes], bool]:
    return lambda header: header.startswith(signatures)


def _riff(kind: bytes) -> Callable[[bytes], bool]:
    return lambda header: header[:4] == b"RIFF" and header[8:12] == kind


def _iso_media(header: bytes) -> bool:
    return header[4:8] == b"ftyp"


def _is_text(header: bytes) -> bool:
    return b"\x00" not in header


_ZIP = _starts_with(b"PK\x03\x04", b"PK\x05\x06")
_OLE = _starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")

# extension -> (canonical content type, content check or None for "no reliable signature")
ALLOWED_TYPES: dict[str, tuple[str, Callable[[bytes], bool] | None]] = {
    # Images
    "png": ("image/png", _starts_with(b"\x89PNG\r\n\x1a\n")),
    "jpg": ("image/jpeg", _starts_with(b"\xff\xd8\xff")),
    "jpeg": ("image/jpeg", _starts_with(b"\xff\xd8\xff")),
    "gif": ("image/gif", _starts_with(b"GIF87a", b"GIF89a")),
    "webp": ("image/webp", _riff(b"WEBP")),
    "bmp": ("image/bmp", _starts_with(b"BM")),
    "ico": ("image/x-icon", _starts_with(b"\x00\x00\x01\x00")),
    "tif": ("image/tiff", _starts_with(b"II*\x00", b"MM\x00*")),
    "tiff": ("image/tiff", _starts_with(b"II*\x00", b"MM\x00*")),
    # Documents
    "pdf": ("application/pdf", _starts_with(b"%PDF-")),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", _ZIP),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _ZIP),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", _ZIP),
    "odt": ("application/vnd.oasis.opendocument.text", _ZIP),
    "ods": ("application/vnd.oasis.opendocument.spreadsheet", _ZIP),
    "odp": ("application/vnd.oasis.opendocument.presentation", _ZIP),
    "doc": ("application/msword", _OLE),
    "xls": ("application/vnd.ms-excel", _OLE),
    "ppt": ("application/vnd.ms-powerpoint", _OLE),
    "rtf": ("application/rtf", _starts_with(b"{\\rtf")),
    # Archives
    "zip": ("application/zip", _ZIP),
    "7z": ("application/x-7z-compressed", _starts_with(b"7z\xbc\xaf\x27\x1c")),
    "gz": ("application/gzip", _starts_with(b"\x1f\x8b")),
    "tgz": ("application/gzip", _starts_with(b"\x1f\x8b")),
    # Media
    "mp4": ("video/mp4", _iso_media),
    "mov": ("video/quicktime", _iso_media),
    "webm": ("video/webm", _starts_with(b"\x1a\x45\xdf\xa3")),
    "mp3": ("audio/mpeg", _starts_with(b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")),
    "wav": ("audio/wav", _riff(b"WAVE")),
    # Text and data (must not contain binary bytes)
    "txt": ("text/plain", _is_text),
    "md": ("text/markdown", _is_text),
    "csv": ("text/csv", _is_text),
    "tsv": ("text/tab-separated-values", _is_text),
    "json": ("application/json", _is_text),
    "xml": ("application/xml", _is_text),
    "yaml": ("application/yaml", _is_text),
    "yml": ("application/yaml", _is_text),
    "toml": ("application/toml", _is_text),
    "ini": ("text/plain", _is_text),
    "log": ("text/plain", _is_text),
    "ipynb": ("application/json", _is_text),
    # Source code and machine/CAD text formats
    **{ext: ("text/plain", _is_text) for ext in "py m c h cpp hpp ino tex bib gcode nc cfg conf sql".split()},
    **{ext: ("application/octet-stream", _is_text) for ext in "step stp iges igs dxf obj".split()},
    # Binary engineering formats with no dependable signature
    **{
        ext: ("application/octet-stream", None)
        for ext in "stl 3mf dwg dwf sldprt sldasm slddrw f3d fcstd ipt iam prt catpart x_t x_b mat bag slx".split()
    },
}


def extension_of(filename: str) -> str:
    return os.path.splitext(filename)[1].lstrip(".").lower()


def _extra_extensions() -> set[str]:
    return {ext.lower().lstrip(".") for ext in getattr(settings, "UPLOAD_EXTRA_EXTENSIONS", [])}


def validate_upload(uploaded_file) -> str:
    """Raises ValidationError unless `uploaded_file` is an allowed type whose bytes match its
    extension. Returns the canonical content type to store."""
    extension = extension_of(uploaded_file.name or "")
    if not extension:
        raise ValidationError("Files need an extension so their type can be checked.")
    if extension in BLOCKED_EXTENSIONS:
        raise ValidationError(f"'.{extension}' files can't be uploaded.")

    entry = ALLOWED_TYPES.get(extension)
    if entry is None:
        if extension in _extra_extensions():
            return "application/octet-stream"
        raise ValidationError(f"'.{extension}' files aren't an allowed upload type.")

    content_type, check = entry
    if check is not None:
        uploaded_file.seek(0)
        header = uploaded_file.read(HEADER_BYTES)
        uploaded_file.seek(0)
        if not check(header):
            raise ValidationError(f"The file's contents don't match its '.{extension}' extension.")
    return content_type
