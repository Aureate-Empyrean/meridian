"""vCard (.vcf) parsing and mapping into Meridian Person documents.

Treats input as untrusted: bounded size, card count, property count and value length; no
network access, no file access, no evaluation of any content. Parsing never touches the
database. Supports vCard 2.1, 3.0 and 4.0 as exported by common phones, mail clients and
address books (line folding, quoted-printable with charsets, grouped Apple labels,
structured N/ADR/ORG values, escaped text).
"""

import codecs
import quopri
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from . import dates
from .models import DOMAIN, EMAIL, PHONE, URL

MAX_BYTES = 1_800_000  # the Nexus gateway accepts at most 2 MiB per request
MAX_CARDS = 5000
MAX_PROPERTIES = 500
MAX_VALUE = 32_768
MAX_RAW_VALUE = 4096

TECHNICAL = {
    "VERSION",
    "PRODID",
    "REV",
    "BEGIN",
    "END",
    "X-ABUID",
    "X-ABSHOWAS",
    "KIND",
    "SORT-STRING",
}
MEDIA = {"PHOTO", "LOGO", "SOUND"}
LINE = re.compile(
    r"^(?:(?P<group>[A-Za-z0-9-]+)\.)?(?P<name>[A-Za-z0-9-]+)(?P<params>(?:;[^:]*)?):(?P<value>.*)$",
    re.S,
)


class VCardError(ValueError):
    pass


@dataclass
class Prop:
    group: str
    name: str
    params: dict
    value: str

    def types(self):
        found = []
        for raw in self.params.get("TYPE", []):
            found += [t.strip().lower() for t in raw.split(",") if t.strip()]
        return found


@dataclass
class Card:
    version: str = ""
    props: list = field(default_factory=list)
    errors: list = field(default_factory=list)


def unfold(text: str) -> list[str]:
    """Logical lines: folded continuations (leading space/tab) are joined, and a
    quoted-printable soft line break ("=" at the end) continues onto the next line."""
    raw = re.split(r"\r\n|\r|\n", text)
    lines = []
    for line in raw:
        if lines and line[:1] in (" ", "\t"):
            lines[-1] += line[1:]
        elif (
            lines
            and lines[-1].endswith("=")
            and "QUOTED-PRINTABLE" in lines[-1].split(":", 1)[0].upper()
        ):
            lines[-1] = lines[-1][:-1] + line
        else:
            lines.append(line)
    return [line for line in lines if line.strip()]


def split_params(text: str) -> dict:
    """;TYPE=home,work;PREF=1;HOME;CHARSET=UTF-8 -> {"TYPE": ["home,work","home"], ...}.
    Bare parameters (vCard 2.1) are types."""
    params: dict = {}
    for part in re.findall(r';((?:[^;"]|"[^"]*")*)', text):
        if not part:
            continue
        key, sep, value = part.partition("=")
        key = key.strip().upper()
        if not sep:
            key, value = "TYPE", part
        value = value.strip().strip('"')
        params.setdefault(key, []).append(value)
    return params


def decode(prop_value: str, params: dict) -> str:
    encoding = (params.get("ENCODING") or [""])[0].upper()
    if encoding in ("QUOTED-PRINTABLE", "QP"):
        charset = (params.get("CHARSET") or ["utf-8"])[0] or "utf-8"
        try:
            codecs.lookup(charset)
        except LookupError:
            charset = "utf-8"
        return quopri.decodestring(prop_value.encode("latin-1", "replace")).decode(
            charset, "replace"
        )
    return prop_value


def unescape(value: str) -> str:
    text = re.sub(r"\\([\\,;nN:])", lambda m: "\n" if m[1] in "nN" else m[1], value)
    return text.replace("\r\n", "\n").replace("\r", "\n")


def components(value: str) -> list[str]:
    """Split a structured value on unescaped semicolons, then unescape each part."""
    parts, current, i = [], "", 0
    while i < len(value):
        if value[i] == "\\" and i + 1 < len(value):
            current += value[i : i + 2]
            i += 2
            continue
        if value[i] == ";":
            parts.append(current)
            current = ""
        else:
            current += value[i]
        i += 1
    parts.append(current)
    return [unescape(p).strip() for p in parts]


def parse(text: str) -> list[Card]:
    if len(text.encode("utf-8", "replace")) > MAX_BYTES:
        raise VCardError("The file is larger than 1.8 MB")
    text = text.lstrip("﻿")
    cards, card, depth = [], None, 0
    for line in unfold(text):
        match = LINE.match(line)
        if not match:
            if card is not None:
                card.errors.append("A line could not be read and was skipped")
            continue
        name = match["name"].upper()
        value = match["value"]
        if name == "BEGIN" and value.strip().upper() == "VCARD":
            depth += 1
            if depth == 1:
                card = Card()
            continue
        if name == "END" and value.strip().upper() == "VCARD":
            depth = max(0, depth - 1)
            if depth == 0 and card is not None:
                cards.append(card)
                card = None
                if len(cards) > MAX_CARDS:
                    raise VCardError(f"The file has more than {MAX_CARDS} contacts")
            continue
        if card is None or depth != 1:
            continue  # outside a card, or inside a nested (2.1 AGENT) card
        if len(card.props) >= MAX_PROPERTIES:
            if "Too many properties" not in " ".join(card.errors):
                card.errors.append("Too many properties; the rest of this contact was skipped")
            continue
        params = split_params(match["params"] or "")
        if name in MEDIA:
            card.props.append(Prop(match["group"] or "", name, params, value[:0]))
            card.props[-1].params["_size"] = [str(len(value))]
            continue
        if len(value) > MAX_VALUE:
            card.errors.append(f"A {name} value was too long and was skipped")
            continue
        if name == "VERSION":
            card.version = value.strip()
            continue
        card.props.append(Prop(match["group"] or "", name, params, decode(value, params)))
    if card is not None:
        raise VCardError("The file ends inside a contact (missing END:VCARD)")
    if not cards:
        raise VCardError("No contacts were found in this file")
    return cards


# ── Mapping ─────────────────────────────────────────────────────────────

PHONE_LABELS = [("cell", "mobile"), ("mobile", "mobile"), ("iphone", "mobile"), ("work", "work"),
                ("home", "home"), ("main", "main"), ("fax", "fax"), ("pager", "pager"),
                ("car", "car"), ("other", "other")]  # fmt: skip
GENERIC_LABELS = [
    ("work", "work"),
    ("home", "home"),
    ("other", "other"),
    ("internet", ""),
    ("pref", ""),
]
SOCIAL_HOSTS = {
    "twitter.com": "twitter", "x.com": "x", "instagram.com": "instagram",
    "facebook.com": "facebook", "linkedin.com": "linkedin", "github.com": "github",
    "mastodon.social": "mastodon", "youtube.com": "youtube", "tiktok.com": "tiktok",
}  # fmt: skip
IMPP_SCHEMES = {"xmpp": "xmpp", "skype": "skype", "sip": "sip", "aim": "aim", "ymsgr": "yahoo",
                "msnim": "msn", "icq": "icq", "irc": "irc", "matrix": "matrix", "tel": "phone"}  # fmt: skip


def apple_label(value: str) -> str:
    match = re.fullmatch(r"_\$!<(.+)>!\$_", value.strip())
    return (match[1] if match else value).strip().lower()


def label_for(prop: Prop, vocabulary, group_labels: dict) -> str:
    if prop.group and prop.group in group_labels:
        return group_labels[prop.group]
    found = []
    types = prop.types()
    for key, label in vocabulary:
        if key in types and label and label not in found:
            found.append(label)
    if prop.name == "TEL" and "fax" in found and len(found) > 1:
        found = [f for f in found if f != "fax"] + ["fax"]
    return " ".join(found)


def is_pref(prop: Prop) -> bool:
    return "pref" in prop.types() or any(p.strip() == "1" for p in prop.params.get("PREF", []))


def parse_date(value: str, params: dict):
    """vCard birthday/anniversary -> (partial date or None, description)."""
    raw = value.strip()
    if (params.get("VALUE") or [""])[0].lower() == "text":
        return None, raw[:120]
    raw = raw.split("T", 1)[0]
    omit_year = (params.get("X-APPLE-OMIT-YEAR") or [""])[0]
    patterns = [
        (r"^(\d{4})-?(\d{2})-?(\d{2})$", lambda m: f"{m[1]}-{m[2]}-{m[3]}"),
        (r"^--(\d{2})-?(\d{2})$", lambda m: f"--{m[1]}-{m[2]}"),
        (r"^(\d{4})-(\d{2})$", lambda m: f"{m[1]}-{m[2]}"),
        (r"^(\d{4})$", lambda m: m[1]),
    ]
    for pattern, build in patterns:
        match = re.fullmatch(pattern, raw)
        if match:
            candidate = build(match)
            if omit_year and candidate.startswith(omit_year) and len(candidate) == 10:
                candidate = "--" + candidate[5:]
            try:
                return dates.normalize(candidate), ""
            except ValueError:
                break
    return None, raw[:120]


def account_from_url(url: str):
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    service = SOCIAL_HOSTS.get(host)
    if not service:
        return None
    path = [p for p in urlparse(url).path.split("/") if p]
    handle = path[-1] if path and service != "linkedin" else (path[1] if len(path) > 1 else "")
    return {"service": service, "handle": handle.lstrip("@")[:200], "url": url}


def safe_url(value: str):
    value = value.strip()
    if URL.fullmatch(value):
        return value
    if DOMAIN.fullmatch(value):
        return "https://" + value
    return None


def display_params(params: dict) -> dict:
    return {
        k.lower(): ",".join(v)
        for k, v in params.items()
        if not k.startswith("_") and k != "CHARSET"
    }


def map_card(card: Card) -> dict:
    """A Person document plus import notes for one vCard. Nothing is inferred."""
    doc = {"names": [], "contacts": [], "addresses": [], "dates": [], "employments": [],
           "accounts": [], "facts": [], "notes": ""}  # fmt: skip
    raw, warnings, technical, media = [], list(card.errors), set(), []
    identifiers = []
    group_labels = {
        p.group: apple_label(unescape(p.value))
        for p in card.props
        if p.name == "X-ABLABEL" and p.group
    }
    kind = "person"
    fn = ""
    notes = []
    orgs, titles, roles = [], [], []
    for prop in card.props:
        name, value = prop.name, prop.value
        if name in TECHNICAL:
            if name == "KIND" and value.strip().lower() in ("org", "organization", "group"):
                kind = "organization" if value.strip().lower() != "group" else "group"
            if name == "X-ABSHOWAS" and value.strip().upper() == "COMPANY":
                kind = "organization"
            technical.add(name)
            continue
        if name == "X-ABLABEL":
            continue
        if name in MEDIA:
            media.append({"name": name, "bytes": int(prop.params.get("_size", ["0"])[0])})
            continue
        if name == "FN":
            fn = unescape(value).strip()[:300]
        elif name == "N":
            parts = (components(value) + [""] * 5)[:5]
            family, given, middle, prefix, suffix = (p[:120] for p in parts)
            if any(parts):
                doc["names"].append({"kind": "full", "value": "", "given": given, "middle": middle,
                                     "family": family, "prefix": prefix[:60], "suffix": suffix[:60]})  # fmt: skip
        elif name in ("NICKNAME", "X-PHONETIC-FIRST-NAME", "X-MAIDENNAME"):
            kind_name = {"NICKNAME": "nickname", "X-MAIDENNAME": "birth"}.get(name, "phonetic")
            for nick in re.split(r"(?<!\\),", value):
                nick = unescape(nick).strip()
                if nick:
                    doc["names"].append({"kind": kind_name, "value": nick[:300]})
        elif name == "TEL":
            number = re.sub(r"^tel:", "", unescape(value).strip(), flags=re.I)
            if PHONE.fullmatch(number) and len(re.sub(r"\D", "", number)) >= 3:
                doc["contacts"].append({"channel": "phone", "value": number,
                                        "label": label_for(prop, PHONE_LABELS, group_labels),
                                        "is_primary": is_pref(prop)})  # fmt: skip
            else:
                raw.append(prop)
        elif name == "EMAIL":
            address = unescape(value).strip()
            if EMAIL.fullmatch(address) and len(address) <= 320:
                doc["contacts"].append({"channel": "email", "value": address,
                                        "label": label_for(prop, GENERIC_LABELS, group_labels),
                                        "is_primary": is_pref(prop)})  # fmt: skip
            else:
                raw.append(prop)
        elif name == "URL":
            url = safe_url(unescape(value))
            account = account_from_url(url) if url else None
            if account:
                doc["accounts"].append(account)
            elif url and len(url) <= 320:
                doc["contacts"].append({"channel": "website", "value": url,
                                        "label": label_for(prop, GENERIC_LABELS, group_labels),
                                        "is_primary": False})  # fmt: skip
            else:
                raw.append(prop)
        elif name in ("X-SOCIALPROFILE", "IMPP", "X-JABBER", "X-SKYPE", "X-SKYPE-USERNAME", "X-AIM",
                      "X-MSN", "X-ICQ", "X-YAHOO", "X-TWITTER", "X-GOOGLE-TALK"):  # fmt: skip
            text = unescape(value).strip()
            url = safe_url(text)
            account = account_from_url(url) if url else None
            if not account:
                scheme, _, rest = text.partition(":")
                service = (prop.types() or [""])[0] if name == "X-SOCIALPROFILE" else ""
                if name == "IMPP":
                    service = IMPP_SCHEMES.get(scheme.lower(), scheme.lower() or "im")
                    text = rest or text
                elif name != "X-SOCIALPROFILE":
                    service = name[2:].lower().replace("-username", "")
                handle = text if not url else ""
                account = {"service": (service or "other")[:60], "handle": handle[:200],
                           "url": url or ""} if (handle or url) else None  # fmt: skip
            if account:
                doc["accounts"].append(account)
            else:
                raw.append(prop)
        elif name in ("ADR",):
            parts = (components(value) + [""] * 7)[:7]
            po_box, extended, street, locality, region, postal, country = parts
            formatted = unescape((prop.params.get("LABEL") or [""])[0])
            if any(parts) or formatted:
                doc["addresses"].append({
                    "label": label_for(prop, GENERIC_LABELS, group_labels), "po_box": po_box[:60],
                    "extended": extended[:200], "street": street[:200], "locality": locality[:120],
                    "region": region[:120], "postal_code": postal[:30], "country": country[:120],
                    "formatted": formatted[:1000], "is_primary": is_pref(prop),
                })  # fmt: skip
        elif name in ("BDAY", "ANNIVERSARY", "X-ANNIVERSARY", "X-ABDATE", "DEATHDATE"):
            when, description = parse_date(unescape(value), prop.params)
            if when or description:
                kind_date = {"BDAY": "birth", "DEATHDATE": "death"}.get(name, "anniversary")
                label = group_labels.get(prop.group, "") if name == "X-ABDATE" else ""
                if name == "X-ABDATE" and label and label not in ("anniversary",):
                    kind_date = "custom"
                if label == kind_date:
                    label = ""
                doc["dates"].append({"kind": kind_date, "label": label[:80], "date": when,
                                     "description": description})  # fmt: skip
            else:
                raw.append(prop)
        elif name == "ORG":
            parts = [p for p in components(value) if p]
            if parts:
                orgs.append(parts)
        elif name == "TITLE":
            titles.append(unescape(value).strip()[:200])
        elif name == "ROLE":
            roles.append(unescape(value).strip()[:200])
        elif name == "NOTE":
            note = unescape(value).strip()
            if note:
                notes.append(note)
        elif name == "UID":
            uid = unescape(value).strip()
            if uid:
                identifiers.append({"system": "vcard-uid", "value": uid[:300]})
        else:
            raw.append(prop)

    # Work: one record per organization; titles and roles attach to the first one.
    if orgs or titles or roles:
        for i, parts in enumerate(orgs or [[]]):
            doc["employments"].append({
                "organization": parts[0][:200] if parts else "",
                "department": " / ".join(parts[1:])[:200] if len(parts) > 1 else "",
                "title": titles[0] if i == 0 and titles else "",
                "role": roles[0] if i == 0 and roles else "",
            })  # fmt: skip
        for extra in titles[1:]:
            doc["facts"].append({"key": "title", "value": extra})
    doc["notes"] = "\n\n".join(notes)[:20000]

    # The display name: FN, then N, then what else identifies the card.
    full = [n for n in doc["names"] if n["kind"] == "full"]
    if fn:
        if full:
            full[0]["value"] = fn
        else:
            doc["names"].insert(0, {"kind": "full", "value": fn})
    if not [n for n in doc["names"] if n["kind"] == "full"]:
        fallback = next(
            (x for x in ([n["value"] for n in doc["names"]]
                         + [o[0] for o in orgs]
                         + [c["value"] for c in doc["contacts"] if c["channel"] in ("email", "phone")])
             if x), "",
        )  # fmt: skip
        if fallback:
            doc["names"].insert(0, {"kind": "full", "value": fallback[:300]})
            warnings.append("The contact has no name; another field is used as its name")
    raw_items = []
    for prop in raw:
        value = unescape(prop.value)
        truncated = len(value) > MAX_RAW_VALUE
        raw_items.append({"name": prop.name, "params": display_params(prop.params),
                          "value": value[:MAX_RAW_VALUE] + ("…" if truncated else "")})  # fmt: skip
    if (
        orgs
        and kind == "person"
        and not fn
        and not [p for p in card.props if p.name == "N" and p.value.strip(";")]
    ):
        kind = "organization"
    return {
        "kind": kind,
        "version": card.version,
        "doc": doc,
        "identifiers": identifiers,
        "raw": raw_items,
        "media": media,
        "technical": sorted(technical),
        "warnings": warnings,
    }
