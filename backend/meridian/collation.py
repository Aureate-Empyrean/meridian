"""Alphabetical order of names, correct for Slovak (and readable for other Latin names).

SQLite's own ordering compares code points, and Meridian's folded `sort_key` drops accents
entirely; neither is Slovak alphabetical order. This follows the CLDR Slovak collation:

- ä, č, ô, š, ž (and ř, for Czech names) are letters of their own, sorted after their base
  letter: "Cyril" < "Čapek" < "Dana";
- "ch" is one letter, sorted after h: "Hudák" < "Chovan" < "Ivan";
- every other accent (á, é, í, ó, ú, ý, ď, ť, ľ, ĺ, ň, ŕ, ...) only breaks ties:
  "Lukáč" sorts with "Lukac", just after it;
- case breaks remaining ties (lower case first); a space sorts before any letter, so
  "Kráľ" comes before "Kráľová"; hyphens and apostrophes are ignored.

Letters outside the Latin alphabet sort after it by code point. The collation is registered on
every database connection as `meridian_name` (meridian.db); nothing is stored in this form,
so changing the rules never needs a migration.
"""

import unicodedata
from functools import lru_cache

ALPHABET = "a ä b c č d e f g h ch i j k l m n o ô p q r ř s š t u v w x y z ž".split()
PRIMARY = {letter: 10 + i for i, letter in enumerate(ALPHABET)}
OWN_LETTERS = {"ä", "č", "ô", "ř", "š", "ž"}
SPACE = 1
DIGIT = 2  # digits sort after a space and before letters, by value
IGNORED = set("-‐‑–—'’`´.·,")
NAME = "meridian_name"


@lru_cache(maxsize=65536)
def key(text: str):
    """A comparable key: (primary letters, accents, case). Empty text sorts last."""
    text = unicodedata.normalize("NFC", (text or "").strip())
    if not text:
        return (1,)
    primary, secondary, tertiary = [], [], []
    i = 0
    while i < len(text):
        c = text[i]
        low = c.lower()
        if c in IGNORED:
            i += 1
            continue
        if c.isspace():
            if primary and primary[-1] != (SPACE,):
                primary.append((SPACE,))
                secondary.append(0)
                tertiary.append(0)
            i += 1
            continue
        if low == "c" and i + 1 < len(text) and text[i + 1].lower() == "h":
            primary.append((PRIMARY["ch"],))
            secondary.append(0)
            tertiary.append(0 if c.islower() else 1)
            i += 2
            continue
        if low in OWN_LETTERS:
            primary.append((PRIMARY[low],))
            secondary.append(0)
        else:
            parts = unicodedata.normalize("NFD", low)
            base, marks = parts[0], parts[1:]
            if base.isdigit():
                primary.append((DIGIT, int(base) if base.isascii() else ord(base)))
            elif base in PRIMARY:
                primary.append((PRIMARY[base],))
            else:
                primary.append((1000, ord(base)))
            secondary.append(sum(ord(m) for m in marks))
        tertiary.append(0 if c == low else 1)
        i += 1
    while primary and primary[-1] == (SPACE,):
        primary.pop()
        secondary.pop()
        tertiary.pop()
    return (0, tuple(primary), tuple(secondary), tuple(tertiary))


def compare(a: str, b: str) -> int:
    ka, kb = key(a), key(b)
    return (ka > kb) - (ka < kb)


def sorted_names(values):
    return sorted(values, key=key)
