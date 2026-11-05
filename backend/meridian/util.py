import os
import re
import time
import unicodedata
import uuid
from datetime import datetime, timezone

UTC = timezone.utc
REF = re.compile(
    r"^nexus:v1:([a-z][a-z0-9-]{0,47}):([a-z][a-z0-9-]{0,47}):([a-zA-Z0-9][a-zA-Z0-9._~-]{0,127})$"
)
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def uuid7() -> str:
    """RFC 9562 UUIDv7: 48-bit Unix milliseconds, version, 74 random bits."""
    ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= ((rand >> 62) & 0xFFF) << 64
    value |= 0b10 << 62
    value |= rand & ((1 << 62) - 1)
    return str(uuid.UUID(int=value))


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def reference(kind: str, rid: str) -> str:
    return f"nexus:v1:meridian:{kind}:{rid}"


def fold(text: str) -> str:
    """Case- and accent-insensitive form for search and matching ("Ján" ~ "jan")."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", stripped.casefold()).strip()


def phone_digits(value: str) -> str:
    """Digits of a phone number, with a leading international 00 treated as +."""
    digits = re.sub(r"\D", "", value or "")
    return digits[2:] if digits.startswith("00") else digits


def phone_key(value: str) -> str:
    """Comparison key: the last nine digits, so +421 905 123 456 matches 0905 123 456.
    Shorter numbers compare in full. A match is a hint for review, never proof."""
    digits = phone_digits(value)
    return digits[-9:] if len(digits) >= 9 else digits


def email_key(value: str) -> str:
    return (value or "").strip().casefold()
