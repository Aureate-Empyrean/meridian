from datetime import date

import pytest
from meridian import dates, vcard


def card(body: str) -> dict:
    return vcard.map_card(vcard.parse(f"BEGIN:VCARD\r\n{body}\r\nEND:VCARD\r\n")[0])


def test_folded_lines_and_escaped_structured_values():
    mapped = card(
        "VERSION:3.0\r\nN:Doe\\;Smith;Jane;;;\r\nFN:Jane Doe-Smith\r\nNOTE:one\\, two\r\n  and three\\nfour"
    )
    full = mapped["doc"]["names"][0]
    assert (
        full["family"] == "Doe;Smith"
        and full["given"] == "Jane"
        and full["value"] == "Jane Doe-Smith"
    )
    assert mapped["doc"]["notes"] == "one, two and three\nfour"


def test_quoted_printable_in_a_legacy_charset():
    text = "VERSION:2.1\r\nFN;CHARSET=windows-1250;ENCODING=QUOTED-PRINTABLE:=8Atef=E1nia"
    assert card(text)["doc"]["names"][0]["value"] == "Štefánia"


def test_unknown_charset_falls_back_safely():
    text = "VERSION:2.1\r\nFN;CHARSET=not-a-charset;ENCODING=QUOTED-PRINTABLE:Ann=C3=A1"
    assert card(text)["doc"]["names"][0]["value"] == "Anná"


def test_group_labels_apply_to_their_own_property_only():
    mapped = card("FN:A\r\nitem1.TEL:111 222\r\nitem1.X-ABLabel:Gym\r\nTEL;TYPE=WORK:333 444")
    labels = [c["label"] for c in mapped["doc"]["contacts"]]
    assert labels == ["gym", "work"]


def test_nothing_is_inferred_and_nothing_silently_dropped():
    mapped = card("FN:A\r\nGENDER:M\r\nCATEGORIES:x\r\nX-UNKNOWN:y\r\nPRODID:-//x//")
    assert {r["name"] for r in mapped["raw"]} == {"GENDER", "CATEGORIES", "X-UNKNOWN"}
    assert mapped["technical"] == ["PRODID"]
    assert "gender" not in str(mapped["doc"]).lower()


def test_unsafe_urls_never_become_links():
    mapped = card("FN:A\r\nURL:javascript:alert(1)\r\nURL:data:text/html,x\r\nURL:example.org")
    assert [c["value"] for c in mapped["doc"]["contacts"]] == ["https://example.org"]
    assert [r["value"] for r in mapped["raw"]] == ["javascript:alert(1)", "data:text/html,x"]


def test_social_profiles_become_account_records():
    mapped = card(
        "FN:A\r\nURL:https://github.com/someone\r\nX-SOCIALPROFILE;type=linkedin:https://www.linkedin.com/in/some-one"
    )
    assert [(a["service"], a["handle"]) for a in mapped["doc"]["accounts"]] == [
        ("github", "someone"),
        ("linkedin", "some-one"),
    ]


def test_nested_cards_are_ignored_not_merged():
    text = "BEGIN:VCARD\r\nFN:Outer\r\nAGENT:\r\nBEGIN:VCARD\r\nFN:Inner\r\nEND:VCARD\r\nTEL:123 456\r\nEND:VCARD\r\n"
    cards = vcard.parse(text)
    assert len(cards) == 1
    mapped = vcard.map_card(cards[0])
    assert mapped["doc"]["names"][0]["value"] == "Outer"


def test_text_birthdays_keep_their_words():
    mapped = card("VERSION:4.0\r\nFN:A\r\nBDAY;VALUE=text:circa 1800")
    assert mapped["doc"]["dates"] == [
        {"kind": "birth", "label": "", "date": None, "description": "circa 1800"}
    ]


@pytest.mark.parametrize(
    "value", ["1990", "1990-05", "1990-05-17", "--05-17", "--02-29", "2000-02-29"]
)
def test_partial_dates_accepted(value):
    assert dates.normalize(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "1990-13",
        "1990-02-30",
        "2001-02-29",
        "--04-31",
        "--13-01",
        "0000",
        "17.5.1990",
        "1990-5-17",
        "",
    ],
)
def test_partial_dates_rejected(value):
    with pytest.raises(ValueError):
        dates.normalize(value)


def test_next_occurrence_and_precision():
    assert dates.next_occurrence("1990-05-17", date(2026, 5, 18)) == date(2027, 5, 17)
    assert dates.next_occurrence("--02-29", date(2027, 1, 1)) == date(2027, 2, 28)
    assert dates.next_occurrence("--02-29", date(2028, 1, 1)) == date(2028, 2, 29)
    assert dates.next_occurrence("1990-05", date(2026, 1, 1)) is None
    assert [dates.precision(v) for v in ("1990", "1990-05", "1990-05-17", "--05-17")] == [
        "year",
        "month",
        "day",
        "month-day",
    ]
