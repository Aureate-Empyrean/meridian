"""Validated input for a Person document. Every field is optional except a name."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import dates

Confidence = Literal["unknown", "low", "medium", "high"]
State = Literal["current", "former", "unknown"]
UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
# Open vocabularies: letters (any script), digits, spaces and a little punctuation.
WORD = r"^[\w][\w .,'&/()+-]*$"
EMAIL = re.compile(r"^[^@\s<>\"]+@[^@\s<>\"]+\.[^@\s<>\"]+$")
PHONE = re.compile(r"^[0-9+()./ \-#*,;xXextEXT]{3,40}$")
URL = re.compile(r"^https?://[^\s<>\"]+$", re.IGNORECASE)
DOMAIN = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?#][^\s<>\"]*)?$", re.I
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def partial(value):
    return dates.normalize(value) if value else None


def website(value: str) -> str:
    """http(s) URLs only; a bare domain becomes https://. Anything else is refused, so a
    javascript: or data: value can never become a link."""
    if URL.fullmatch(value):
        return value
    if DOMAIN.fullmatch(value):
        return "https://" + value
    raise ValueError("Enter a web address starting with http:// or https://")


class Record(Strict):
    id: str | None = Field(default=None, max_length=64)
    valid_from: str | None = Field(default=None, max_length=10)
    valid_until: str | None = Field(default=None, max_length=10)
    confidence: Confidence | None = None
    note: str = Field(default="", max_length=2000)

    @field_validator("valid_from", "valid_until")
    @classmethod
    def _validity(cls, value):
        return partial(value)


class NameIn(Record):
    kind: str = Field(default="full", min_length=1, max_length=40, pattern=WORD)
    value: str = Field(default="", max_length=300)
    given: str = Field(default="", max_length=120)
    middle: str = Field(default="", max_length=120)
    family: str = Field(default="", max_length=120)
    prefix: str = Field(default="", max_length=60)
    suffix: str = Field(default="", max_length=60)

    @model_validator(mode="after")
    def has_text(self):
        if not (self.value or self.given or self.middle or self.family):
            raise ValueError("A name needs a value or name parts")
        self.kind = self.kind.lower()
        return self


class ContactIn(Record):
    channel: Literal["phone", "email", "website"]
    value: str = Field(min_length=1, max_length=320)
    label: str = Field(default="", max_length=40)
    is_primary: bool = False

    @model_validator(mode="after")
    def check_value(self):
        if self.channel == "email" and not EMAIL.fullmatch(self.value):
            raise ValueError("Enter an email address like name@example.com")
        if self.channel == "phone":
            if not PHONE.fullmatch(self.value) or len(re.sub(r"\D", "", self.value)) < 3:
                raise ValueError("Enter a phone number using digits, spaces and + ( ) - .")
        if self.channel == "website":
            self.value = website(self.value)
        self.label = self.label.lower()
        return self


class AddressIn(Record):
    label: str = Field(default="", max_length=40)
    street: str = Field(default="", max_length=200)
    extended: str = Field(default="", max_length=200)
    po_box: str = Field(default="", max_length=60)
    locality: str = Field(default="", max_length=120)
    region: str = Field(default="", max_length=120)
    postal_code: str = Field(default="", max_length=30)
    country: str = Field(default="", max_length=120)
    formatted: str = Field(default="", max_length=1000)
    is_primary: bool = False

    @model_validator(mode="after")
    def has_text(self):
        parts = (self.street, self.extended, self.po_box, self.locality, self.region)
        if not any(parts + (self.postal_code, self.country, self.formatted)):
            raise ValueError("An address needs at least one line")
        self.label = self.label.lower()
        return self


class DateIn(Record):
    kind: str = Field(default="birth", min_length=1, max_length=40, pattern=WORD)
    label: str = Field(default="", max_length=80)
    date: str | None = Field(default=None, max_length=10)
    description: str = Field(default="", max_length=120)
    approximate: bool = False

    @field_validator("date")
    @classmethod
    def _date(cls, value):
        return partial(value)

    @model_validator(mode="after")
    def has_value(self):
        if not self.date and not self.description:
            raise ValueError("A date needs a value or a description")
        self.kind = self.kind.lower()
        return self


class EmploymentIn(Record):
    organization: str = Field(default="", max_length=200)
    # The Organization entity this work is at, when known; the name stays the readable form.
    organization_id: str | None = Field(default=None, pattern=UUID_PATTERN)
    title: str = Field(default="", max_length=200)
    department: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def has_text(self):
        if not (self.organization or self.title or self.department or self.role):
            raise ValueError("Work needs an organization or a title")
        return self


class AccountIn(Record):
    service: str = Field(min_length=1, max_length=60)
    handle: str = Field(default="", max_length=200)
    display_name: str = Field(default="", max_length=200)
    url: str = Field(default="", max_length=2048)
    state: str = Field(default="unknown", max_length=30, pattern=WORD)

    @model_validator(mode="after")
    def check(self):
        if self.url:
            self.url = website(self.url)
        if not (self.handle or self.url or self.display_name):
            raise ValueError("An account needs a handle, a name or a profile address")
        self.state = self.state.lower()
        return self


class FactIn(Record):
    key: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=4000)


class PersonDoc(Strict):
    names: list[NameIn] = Field(default_factory=list, max_length=30)
    contacts: list[ContactIn] = Field(default_factory=list, max_length=100)
    addresses: list[AddressIn] = Field(default_factory=list, max_length=30)
    dates: list[DateIn] = Field(default_factory=list, max_length=50)
    employments: list[EmploymentIn] = Field(default_factory=list, max_length=50)
    accounts: list[AccountIn] = Field(default_factory=list, max_length=50)
    facts: list[FactIn] = Field(default_factory=list, max_length=100)
    notes: str = Field(default="", max_length=20000)

    @model_validator(mode="after")
    def needs_name(self):
        if not self.names:
            raise ValueError("A person needs a name")
        return self


class EntityDoc(PersonDoc):
    """An Organization or Group: the same structured records as a Person where they make
    sense (names and aliases, contact details, addresses, accounts, dates, details, notes).
    Work records belong to people."""

    kind: Literal["organization", "group"]

    @model_validator(mode="after")
    def no_work(self):
        if self.employments:
            raise ValueError("Work records belong to people")
        return self


class SourceIn(Strict):
    """Where a piece of knowledge came from: observed, told by someone, a document..."""

    kind: str = Field(min_length=1, max_length=40, pattern=WORD)
    entity_id: str | None = Field(default=None, pattern=UUID_PATTERN)
    label: str = Field(default="", max_length=300)
    learned: str | None = Field(default=None, max_length=10)

    @field_validator("learned")
    @classmethod
    def _learned(cls, value):
        return partial(value)

    @model_validator(mode="after")
    def _kind(self):
        self.kind = self.kind.lower()
        return self


class Connection(Strict):
    state: State = "current"
    valid_from: str | None = Field(default=None, max_length=10)
    valid_until: str | None = Field(default=None, max_length=10)
    confidence: Confidence | None = None
    note: str = Field(default="", max_length=2000)
    sources: list[SourceIn] = Field(default_factory=list, max_length=20)

    @field_validator("valid_from", "valid_until")
    @classmethod
    def _validity(cls, value):
        return partial(value)


class RelationshipIn(Connection):
    subject_id: str = Field(pattern=UUID_PATTERN)
    object_id: str = Field(pattern=UUID_PATTERN)
    type: str = Field(min_length=1, max_length=80)
    context: str = Field(default="", max_length=80)
    # Set after the user has seen a similar existing relationship and still wants this one.
    allow_similar: bool = False


class MembershipIn(Connection):
    group_id: str = Field(pattern=UUID_PATTERN)
    member_id: str = Field(pattern=UUID_PATTERN)
    role: str = Field(default="", max_length=80)


def dated(value):
    """A timeline date: a partial date that has a year (a birthday-style --MM-DD cannot be
    placed in history)."""
    value = partial(value)
    if value and value.startswith("--"):
        raise ValueError("Add a year, or leave the date empty if it is not known")
    return value


class ParticipantIn(Strict):
    entity_id: str = Field(pattern=UUID_PATTERN)
    role: str = Field(default="", max_length=80)


class EventIn(Strict):
    """A native Meridian event: an occurrence that no relationship, membership or work
    record represents. Dates are partial; `ends` makes it a span, `ongoing` an open span."""

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    category: str = Field(default="milestone", min_length=1, max_length=40, pattern=WORD)
    starts: str | None = Field(default=None, max_length=10)
    ends: str | None = Field(default=None, max_length=10)
    ongoing: bool = False
    approximate: bool = False
    confidence: Confidence | None = None
    participants: list[ParticipantIn] = Field(min_length=1, max_length=50)
    sources: list[SourceIn] = Field(default_factory=list, max_length=20)
    # Set after the user has seen similar entries on the Timeline and still wants this one.
    allow_similar: bool = False

    @field_validator("starts", "ends")
    @classmethod
    def _dates(cls, value):
        return dated(value)

    @model_validator(mode="after")
    def check(self):
        self.category = self.category.lower()
        if self.ends and not self.starts:
            raise ValueError("An end needs a start")
        if self.ongoing and self.ends:
            raise ValueError("An ongoing event has no end yet")
        if self.ongoing and not self.starts:
            raise ValueError("An ongoing event needs a start")
        if self.starts and self.ends:
            n = min(len(self.starts), len(self.ends))
            if self.ends[:n] < self.starts[:n]:
                raise ValueError("The end is before the start")
        ids = [p.entity_id for p in self.participants]
        if len(set(ids)) != len(ids):
            raise ValueError("Each participant can be added once")
        return self


class TypeIn(Strict):
    label: str = Field(min_length=1, max_length=60, pattern=WORD)
    inverse: str = Field(default="", max_length=60)
    symmetric: bool = False
    category: str = Field(default="other", max_length=40, pattern=WORD)

    @field_validator("inverse")
    @classmethod
    def _inverse(cls, value):
        if value and not re.fullmatch(WORD, value):
            raise ValueError("Use letters, digits and simple punctuation")
        return value
