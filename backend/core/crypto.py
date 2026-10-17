"""Streaming authenticated encryption for backup archives - org backups
(backups/) and the whole-instance CLI backups (core/management/commands/).

Format (one self-describing file, so a downloaded backup can be restored on
any server that's given the passphrase - nothing else has to be copied
across):

    header  = MAGIC (8) | version (1) | kdf (1) | salt (16)
              | scrypt log2(n) (1) | r (1) | p (1) | nonce prefix (7)
    body    = AES-256-GCM chunks, each CHUNK_SIZE plaintext bytes (the last
              may be shorter, even empty) + a 16-byte tag

Each chunk's 12-byte nonce is nonce prefix | 4-byte counter | last-chunk
flag, and the whole header is the chunk's associated data (the STREAM
construction) - so reordering, dropping or appending chunks, truncating the
file, or editing the header (e.g. swapping in a different salt) all fail
the tag check, not just flipped bytes inside a chunk.

Two key sources, recorded in the header's kdf byte:
- KDF_SCRYPT: derived from an admin-chosen passphrase - what a downloaded
  backup is encrypted with, so it's portable to a new server.
- KDF_SERVER: this server's own key (server_key()) - what archives sitting
  in storage on this server are encrypted with, so nothing in MEDIA_ROOT/S3
  is ever a plaintext credentials dump.
"""

import base64
import os
import struct
from collections.abc import Iterable, Iterator
from typing import BinaryIO

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

MAGIC = b"ATHARENC"
VERSION = 1
KDF_SERVER = 0
KDF_SCRYPT = 1
CHUNK_SIZE = 64 * 1024
TAG_SIZE = 16
_HEADER = struct.Struct(">8sBB16sBBB7s")
HEADER_SIZE = _HEADER.size


class DecryptionError(Exception):
    """Wrong passphrase/key, or the file was corrupted or tampered with -
    deliberately one error for all of them, since AES-GCM can't tell those
    apart either."""


def server_key() -> bytes:
    """BACKUP_ENCRYPTION_KEY (base64, 32 bytes) if set, otherwise derived
    from SECRET_KEY - so a fresh install encrypts at rest with no extra
    setup. Rotating SECRET_KEY without setting BACKUP_ENCRYPTION_KEY to the
    old derived key makes previously stored archives unreadable (downloaded
    passphrase-encrypted copies are unaffected)."""
    configured = settings.BACKUP_ENCRYPTION_KEY
    if configured:
        try:
            key = base64.b64decode(configured, validate=True)
        except ValueError as exc:
            raise ImproperlyConfigured("BACKUP_ENCRYPTION_KEY must be base64.") from exc
        if len(key) != 32:
            raise ImproperlyConfigured("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.")
        return key
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"athar-backup-at-rest").derive(
        settings.SECRET_KEY.encode()
    )


def derive_key(passphrase: str, salt: bytes, log2_n: int, r: int, p: int) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**log2_n, r=r, p=p).derive(passphrase.encode())


class _Header:
    def __init__(self, raw: bytes):
        magic, version, kdf, salt, log2_n, r, p, nonce_prefix = _HEADER.unpack(raw)
        if magic != MAGIC:
            raise DecryptionError("This isn't an encrypted Athar backup.")
        if version != VERSION or kdf not in (KDF_SERVER, KDF_SCRYPT):
            raise DecryptionError("This backup was made by a newer, incompatible version of Athar.")
        self.raw = raw
        self.kdf = kdf
        self.salt = salt
        self.log2_n, self.r, self.p = log2_n, r, p
        self.nonce_prefix = nonce_prefix

    def key(self, passphrase: str | None) -> bytes:
        if self.kdf == KDF_SERVER:
            return server_key()
        if not passphrase:
            raise DecryptionError("This backup is passphrase-protected - a passphrase is required.")
        # The header is untrusted and read before anything is authenticated -
        # bound what it can make scrypt allocate (128 * n * r bytes; this
        # app writes 128MB) and reject values scrypt itself would refuse.
        if not (10 <= self.log2_n <= 20 and 1 <= self.r <= 8 and 1 <= self.p <= 2) or (
            128 * 2**self.log2_n * self.r > 256 * 1024 * 1024
        ):
            raise DecryptionError("This backup's key parameters are out of range.")
        try:
            return derive_key(passphrase, self.salt, self.log2_n, self.r, self.p)
        except ValueError as exc:
            raise DecryptionError("This backup's key parameters are out of range.") from exc


def _new_header(passphrase: str | None) -> tuple[bytes, bytes]:
    """Returns (header bytes, key) for a new encrypted stream."""
    salt = os.urandom(16)
    nonce_prefix = os.urandom(7)
    if passphrase is None:
        kdf, log2_n, r, p = KDF_SERVER, 0, 0, 0
        key = server_key()
    else:
        kdf, log2_n, r, p = KDF_SCRYPT, settings.BACKUP_SCRYPT_LOG2_N, 8, 1
        key = derive_key(passphrase, salt, log2_n, r, p)
    return _HEADER.pack(MAGIC, VERSION, kdf, salt, log2_n, r, p, nonce_prefix), key


def _nonce(nonce_prefix: bytes, counter: int, last: bool) -> bytes:
    return nonce_prefix + struct.pack(">IB", counter, 1 if last else 0)


def _rechunk(chunks: Iterable[bytes]) -> Iterator[bytes]:
    buffer = bytearray()
    for chunk in chunks:
        buffer += chunk
        while len(buffer) >= CHUNK_SIZE:
            yield bytes(buffer[:CHUNK_SIZE])
            del buffer[:CHUNK_SIZE]
    yield bytes(buffer)


def encrypted_size(plaintext_size: int) -> int:
    """Exact size iter_encrypt produces for this much plaintext - one tag per
    chunk, including the always-present (possibly empty) final chunk. Lets a
    streamed response declare a Content-Length up front."""
    return HEADER_SIZE + plaintext_size + (plaintext_size // CHUNK_SIZE + 1) * TAG_SIZE


def iter_encrypt(chunks: Iterable[bytes], passphrase: str | None = None) -> Iterator[bytes]:
    """Encrypts a stream of plaintext chunks (any sizes) - with the server
    key when passphrase is None. Yields the header, then each encrypted
    chunk; memory use stays at about one CHUNK_SIZE regardless of input
    size, so this can feed a StreamingHttpResponse directly."""
    header, key = _new_header(passphrase)
    aead = AESGCM(key)
    nonce_prefix = header[-7:]
    yield header
    counter = 0
    pending = None
    for piece in _rechunk(chunks):
        if pending is not None:
            yield aead.encrypt(_nonce(nonce_prefix, counter, last=False), pending, header)
            counter += 1
        pending = piece
    # _rechunk always yields at least one (possibly empty) final piece.
    yield aead.encrypt(_nonce(nonce_prefix, counter, last=True), pending, header)


def iter_decrypt(source: BinaryIO, passphrase: str | None = None) -> Iterator[bytes]:
    """Inverse of iter_encrypt. Raises DecryptionError on a wrong key or any
    tampering - including truncation, which only shows up at the very end,
    so callers must not act on the output until the generator is exhausted
    (decrypt into a temp file first, as every caller here does)."""
    header = _Header(_read_exact(source, HEADER_SIZE))
    aead = AESGCM(header.key(passphrase))
    sealed_size = CHUNK_SIZE + TAG_SIZE
    counter = 0
    current = _read_exact(source, sealed_size, allow_short=True)
    while True:
        following = _read_exact(source, sealed_size, allow_short=True)
        last = not following
        if len(current) < TAG_SIZE or (not last and len(current) != sealed_size):
            raise DecryptionError("Wrong passphrase, or the backup file is corrupted.")
        try:
            yield aead.decrypt(_nonce(header.nonce_prefix, counter, last), current, header.raw)
        except InvalidTag as exc:
            raise DecryptionError("Wrong passphrase, or the backup file is corrupted.") from exc
        if last:
            return
        counter += 1
        current = following


def _read_exact(source: BinaryIO, size: int, allow_short: bool = False) -> bytes:
    data = bytearray()
    while len(data) < size:
        piece = source.read(size - len(data))
        if not piece:
            break
        data += piece
    if len(data) < size and not allow_short:
        raise DecryptionError("Wrong passphrase, or the backup file is corrupted.")
    return bytes(data)


def iter_file(source: BinaryIO, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
    while chunk := source.read(chunk_size):
        yield chunk


def encrypt_file(source: BinaryIO, destination: BinaryIO, passphrase: str | None = None) -> None:
    for piece in iter_encrypt(iter_file(source), passphrase):
        destination.write(piece)


def decrypt_file(source: BinaryIO, destination: BinaryIO, passphrase: str | None = None) -> None:
    for piece in iter_decrypt(source, passphrase):
        destination.write(piece)


def is_encrypted(source: BinaryIO) -> bool:
    """Peeks at the magic without moving the file position."""
    position = source.tell()
    magic = source.read(len(MAGIC))
    source.seek(position)
    return magic == MAGIC


def needs_passphrase(source: BinaryIO) -> bool:
    position = source.tell()
    raw = source.read(HEADER_SIZE)
    source.seek(position)
    return len(raw) == HEADER_SIZE and raw[:8] == MAGIC and raw[9] == KDF_SCRYPT


def verify_passphrase(source: BinaryIO, passphrase: str | None) -> None:
    """Decrypts just the first chunk, so a wrong passphrase fails in well
    under a second instead of after reading a multi-GB upload. Leaves the
    file position where it was."""
    position = source.tell()
    try:
        header = _Header(_read_exact(source, HEADER_SIZE))
        aead = AESGCM(header.key(passphrase))
        first = _read_exact(source, CHUNK_SIZE + TAG_SIZE, allow_short=True)
        last = len(first) < CHUNK_SIZE + TAG_SIZE or not source.read(1)
        try:
            aead.decrypt(_nonce(header.nonce_prefix, 0, last), first, header.raw)
        except InvalidTag as exc:
            raise DecryptionError("Wrong passphrase, or the backup file is corrupted.") from exc
    finally:
        source.seek(position)
