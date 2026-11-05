"""Partial dates: Meridian keeps exactly as much as is known.

Stored forms (text):
  YYYY          year known
  YYYY-MM       year and month known
  YYYY-MM-DD    exact date
  --MM-DD       month and day known, year unknown (as in vCard)
A record may also carry `approximate` and a free description ("summer 2022"), so precision
and uncertainty are never destroyed by forcing a full timestamp.
"""

import calendar
import re
from datetime import date

PATTERN = re.compile(r"^(?:(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?|--(\d{2})-(\d{2}))$")


def normalize(value: str) -> str:
    """Validate a partial date and return it unchanged; raise ValueError otherwise."""
    value = (value or "").strip()
    match = PATTERN.fullmatch(value)
    if not match:
        raise ValueError("Use YYYY, YYYY-MM, YYYY-MM-DD or --MM-DD")
    year, month, day, md_month, md_day = match.groups()
    if md_month:
        month_n, day_n = int(md_month), int(md_day)
        if not 1 <= month_n <= 12 or not 1 <= day_n <= (29 if month_n == 2 else 31):
            raise ValueError("Not a real calendar day")
        if month_n in (4, 6, 9, 11) and day_n > 30:
            raise ValueError("Not a real calendar day")
        return value
    year_n = int(year)
    if year_n < 1:
        raise ValueError("Year must be 0001 or later")
    if month:
        month_n = int(month)
        if not 1 <= month_n <= 12:
            raise ValueError("Month must be 01–12")
        if day:
            try:
                date(year_n, month_n, int(day))
            except ValueError as exc:
                raise ValueError("Not a real calendar day") from exc
    return value


def precision(value: str) -> str:
    if value.startswith("--"):
        return "month-day"
    return {4: "year", 7: "month", 10: "day"}[len(value)]


def month_day(value: str):
    """(month, day) when both are known, else None."""
    if value.startswith("--"):
        return int(value[2:4]), int(value[5:7])
    if len(value) == 10:
        return int(value[5:7]), int(value[8:10])
    return None


def year_of(value: str):
    return int(value[:4]) if value and not value.startswith("--") else None


def next_occurrence(value: str, today: date):
    """The next anniversary on or after `today`, for dates whose month and day are known.
    29 February falls on 28 February in common years."""
    md = month_day(value)
    if not md:
        return None
    month, day = md
    for year in (today.year, today.year + 1):
        actual = min(day, calendar.monthrange(year, month)[1])
        candidate = date(year, month, actual)
        if candidate >= today:
            return candidate
    return None
