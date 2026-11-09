# Meridian — design standard (Milestone 1: Stage A.2 approved, Stage B)

This is the visual and interaction language for every Meridian screen.
- **Reference implementations:** the Dashboard and the Person Profile (Stage A.2, approved).
- **Built from them:** the People directory, Import, Trash and Settings (Stage B). §§ 12–18
  describe their conventions.

Code: `frontend/style.css` (tokens prefixed `--m-`, on top of Aureate design system 2.1) and
`frontend/app.js`. Markup helpers:
- profile and records: `avatar()`, `psection()`, `vrow()`, `countdown()`;
- motion, navigation and editing: `animate()`, `openPerson()`, `openPanel()`;
- shared Stage B parts: `screenBand()`, `emptyState()`, `segmented()`, `highlight()`.

---

## 1. What Meridian should feel like, in testable terms

- **People are the subject.** Every list item about a person shows that person's avatar
  and name first. Dates, counts and metadata support the person; they are never the
  headline on their own.
- **One container per kind of thing.** Records live in *lists*, people in *tiles*, context
  in *one* side surface. Never put a card inside a card.
- **Copper means something.** Copper is used only for:
  - where you are (navigation indicator, tab underline);
  - the primary action;
  - what is soon (≤ 7 days);
  - the primary-record mark;
  - `@me`;
  - focus;
  - the date eyebrow.

  Icons, headings and borders are never copper.
- **Nothing is invented.** Every value on screen comes from a record or is computed from
  one. A countdown is computed from a date; "turns 35" only appears when the full birth
  date is known and not approximate. Empty means *not recorded*, and the UI says so.

---

## 2. Surfaces and colour

| Token | Value | Job | Used by |
| --- | --- | --- | --- |
| `--m-canvas` | `#0C0A09` | behind everything | `html` |
| `--m-well` | `#110F0D` | recessed: something you type into | Dashboard search |
| `--m-sheet` | `#151210` | the workspace | `.sheet`, occasion block inside the context surface |
| `--m-band` | `#1A1714` | a screen's identity header | `.band` |
| `--m-raised` | `#1E1A17` | lists, tiles, the context column, chips | `.list`, `.person-tile`, `.glance`, `.add-chip`, `.spotlight` |
| `--m-raised-hover` | `#231F1B` | hover on raised items | tiles, spotlight, chips |
| `--m-overlay` | `#27221E` | floats above the page | search results, menus, dialogs |
| `--m-line` | `rgba(255,236,222,.075)` | hairlines and container edges | everything |
| `--m-line-strong` | `rgba(255,236,222,.13)` | hover edge, overlay edge | |

- **Depth comes from tone steps plus hairlines**, not blur or glow. A raised container is
  `background: var(--m-raised)` + `inset 0 0 0 1px var(--m-line)` + at most
  `0 1px 2px rgba(0,0,0,.25)`.
- **Glass (blur) only on navigation and floating chrome:** the rail, toolbar, side panel,
  dialogs, menus and toasts. Never on content.
- **Text colours:**
  - `--m-text #F2EDE9`: values and names.
  - `--m-text-2 #CBC3BC`: labels and secondary lines.
  - `--m-text-3 #A59B93`: metadata. It is ≥ 5.5:1 on the sheet and on raised surfaces.
  - `--m-accent-text #E3AE8E`: copper text.
- **Avatar tones:** seven muted hues (`.tone-0` … `.tone-6`: copper, clay, ochre, sage,
  teal, slate, mauve). The tone is chosen from the person's id by `tone()`, so a person
  keeps their colour everywhere. Tones are mixed at 17–42% into graphite; never use a
  saturated fill.

✅ A tile on the sheet: raised tone, hairline edge, hover lifts the edge to `--m-line-strong`.
❌ A tile with a coloured border, a gradient fill, or a glow on hover.

---

## 3. Typography

| Role | Token | Size (≥ 2200 px) | Weight / tracking |
| --- | --- | --- | --- |
| Person name | `--m-fs-name` | 38 (42) · 28 on phones | 600, −0.03em, line-height 1.1 |
| Page heading (`.display`) | `--m-fs-display` | 34 (38) · 28 on phones | 600, −0.025em |
| Title (Stage B screens) | `--m-fs-title` | 26 (28) | 600, −0.02em |
| Profile subtitle (role · org) | — | 17 | 400, `--m-text-2` |
| Section heading | `--m-fs-section` | 15 (16) | 600, `--m-text`, icon 16 px in `--m-text-3` |
| Record value (strong) | `--m-fs-value` | 16 (17) | 500, tabular numbers |
| Body / record value | `--m-fs-body` | 15 (16) | 400 |
| Labels, metadata, secondary lines | `--m-fs-meta` | 14 (15) | 400, `--m-text-2` or `-3` |
| Small (timestamps, tile "Updated …") | `--m-fs-small` | 13 (14) | 400, `--m-text-3` |
| Uppercase label (month groups, "Next occasion") | `--m-fs-label` | 12 (13) | 600, +0.06em, uppercase |
| Countdown number | — | 38 band / 34 panel / 32 phone | 600, −0.03em, tabular |

- Nothing a person reads is below 12 px, and 12 px is only used for uppercase labels.
- Record labels from imports arrive in any case ("HOME", "mobile"); they are shown in
  sentence case (`.vrow .label::first-letter`).
- Numbers that change (counts, countdowns, phone numbers) use `font-variant-numeric:
  tabular-nums`.

---

## 4. Spacing, density and grid

- **Spacing scale:** `--m-s1` … `--m-s9` = 4, 8, 12, 16, 20, 24, 32, 40, 56 px.
- **Radii:** chip 6, control 9, list/tile 14 (`--m-r-list`), surface 16 (context column,
  sheet).
- **Page frame:** `.wrap` = `max-width: var(--m-page-max)` (1760 px; 2040 px at ≥ 2200 px)
  with `padding-inline: var(--m-page-pad)` (40 px; 56 px at ≥ 1760 px; 32 px ≤ 960 px;
  16 px ≤ 640 px).
- **Banded screens:**
  - A screen about one subject (Dashboard, Profile) is `.page.banded` with a full-width
    `.band` (identity) followed by `.wrap.body` (records). The body starts 32 px under the
    band.
  - Stage B list screens (People, Trash, Import) may use a band for their heading, search
    and filters.
- **Row density:**
  - list rows ≥ 54 px (record rows) or 60 px (person rows);
  - tiles ≥ 78 px;
  - row padding 10–14 px vertical, 16–18 px horizontal;
  - section-to-section gap 30 px; heading-to-list gap 8–10 px.
- **Dashboard grid:** below 1100 px, one column. From 1100 px, two columns
  `minmax(360px, 5fr) | minmax(0, 7fr)`, gap 48 px. The band uses the same columns: you,
  greeting and search sit on the left over the timeline; the next occasion starts at the
  people column.
- **Profile grid:**
  - From 1100 px: main column plus a 360 px context column (380 px at ≥ 1760 px, 420 px
    at ≥ 2200 px), gap 40 px.
  - From 1760 px a rich profile (more than two filled sections) flows into two CSS
    columns; a sparse one stays in one column.
  - Names / Record tabs use `.measure` (max 920 px).
- **Whitespace:** below the content is allowed to stay empty when there is no more data.
  Do not add widgets to fill it.

---

## 5. Components

### Avatar `avatar(name, id, size)`
- **Sizes:** `sm` 34 (timeline), default 40 (rows), `md` 44 (tiles, spotlight), `lg` 56
  (Dashboard "you"), `xl` 88 (profile; 64 on phones).
- Radius ≈ 27% of the size.
- `self` adds a copper outline (1.5 px, 2 px offset). It is the only avatar decoration.

### List `.list`
- The single container for records and timelines.
- Rows inside are `.row` (interactive) or `.vrow` (label / value / actions), separated by
  hairlines.
- Group labels inside a list are `.list-label` (uppercase).

### Record row `vrow(label, value, {sub, strong, primary, former, acts})`
- **Columns:** label 132 px | value | actions. On phones the label sits above the value.
- `primary` shows a copper "primary" pill next to the label.
- `former` dims the value and suffixes the label.
- Row actions (copy, write, open) sit at 50% opacity and reach 100% on row hover or
  focus. Always visible on touch.

### Person tile `.person-tile`
- Avatar `md`, name (16/600), one secondary line, one "Updated …" line.
- Laid out in an auto-fill grid with a 260 px minimum.

### Spotlight `.spotlight`
- One per screen, at most, in the band. On the Dashboard it is the next occasion: label,
  person, countdown, weekday.
- The countdown is copper when it is ≤ 7 days away.

### Context surface `.glance`
- One raised surface per profile, with sections (`.g-sec`) separated by hairlines. It is
  sticky from 1100 px.
- It holds only what the main column does not show: personal dates (the next occasion
  large, the rest as a list) and the record's provenance.

### Add chips `.profile-add` / `.add-chip`
- Missing sections are offered once, together, as chips ("+ Work", "+ Address", …),
  instead of one empty section each.
- A chip opens the side panel for that section with one starter row. An untouched
  starter row is ignored on save.

### Buttons
- Foundation `.ae-btn` with the following roles:
  - **Primary** (copper): one per screen region, such as New person or Save.
  - **Default:** header actions (Email, Copy number, Edit).
  - **Quiet:** section "Edit" and row actions.
- A destructive action is always confirmed.

### States, for every interactive element

| State | Treatment |
| --- | --- |
| Hover | raised → `--m-raised-hover` and edge → `--m-line-strong` (150 ms); rows → `--m-hover` |
| Pressed | `scale(.97–.99)` for 120 ms |
| Focus (keyboard) | `--focus-ring` (copper-hi) |
| Current | copper indicator or underline, text to `--m-text` |
| Disabled / later | `--m-text-3`, no hover |
| Busy | the button keeps its size and shows a spinner (`.is-busy`); "Saved" confirms success |

The heading that receives focus after navigation has no ring. Focus there is for screen
readers.

---

## 6. Forms and the side panel

- **One way to edit:**
  - Every section's Edit, every add chip and the header Edit open the side panel (560 px;
    a bottom sheet on phones) for that section.
  - Section chips at the top switch sections.
  - The page behind is `inert`.
- **Unsaved changes (contact tabs):**
  - All tabs share one session. Switching sections preserves raw input, including incomplete
    values, without saving or prompting. The footer shows "Unsaved changes".
  - Escape, the scrim, the close button and navigation offer Save, Discard changes and
    Continue editing. Failed saves leave the editor open with its draft intact.
  - Cancel closes and discards only edits since the last successful save.
- **Saving (contact tabs):**
  - Ctrl/Command+Enter or Save persists all changed sections in one transaction. Save is disabled
    when unchanged or saving; editing and closing are blocked while the request is pending.
  - On success the profile refreshes, the panel stays on its current section and "Saved"
    appears quietly in the footer. Returned record IDs establish the new draft baseline.
  - A content revision checked under the database write lock rejects stale drafts with 409.
    The user keeps their draft and can reopen the contact to review the latest data; there
    is no automatic merge. Older API clients may omit the revision for compatibility.
  - Relationship, membership and event editors retain their existing save/close behavior.
- **Errors:**
  - The server message names the row ("Contact 3: Enter an email address like …").
  - It appears in the panel footer, and that row is outlined and scrolled into view.
- **Focus:** on open, the first field. On close (saved or discarded), the Edit button that
  opened the panel.
- **Labels:** a suggested label follows the contact type ("mobile" becomes "home" for an
  email).

---

## 7. Motion

| Use | Duration | Easing |
| --- | --- | --- |
| Press, chips, toasts, search results | `--m-fast` 120 ms | `--m-ease` `cubic-bezier(.22,1,.36,1)` |
| Hover | `--m-hover-time` 150 ms | `--m-ease` |
| Page enter, tab content | `--m-page` 220 ms (tabs: 70 out + 170 in) | `--m-ease` |
| Side panel, dialog, avatar travel | `--m-panel` 260 ms; exits 160 ms | `--m-ease`; exit `cubic-bezier(.4,0,1,1)` |

- **Spatial direction:**
  - Going deeper (Dashboard → People → Profile) enters from 14 px right.
  - Going back enters from 14 px left.
  - Moving sideways in the rail rises 6 px.
- **Opening a profile:**
  - Where the browser supports view transitions, the avatar you clicked (tile, timeline
    row, spotlight, search result) travels into the profile header.
  - The workspace crossfades: the old one fades out in 90 ms, then the new one fades in
    over 200 ms after 50 ms. The rail and toolbar stay put.
  - The profile is fetched before the transition starts. A request slower than 250 ms
    falls back to an ordinary navigation, so the page never freezes waiting for the
    network.
- **What never animates:** layout (no animated width or height on content), more than
  one item in sequence (no stagger), overshoot or bounce, and anything decorative.
- **Race safety:**
  - Every navigation and tab change takes a token, and late results are discarded.
  - The animation helper cancels running animations on the element.
  - A skeleton appears only when loading takes longer than 160 ms.
- **`prefers-reduced-motion: reduce`:**
  - The helper does nothing, view transitions are skipped and all CSS transitions are
    off; state changes are immediate.
  - Verified in the Nexus iframe: `document.getAnimations()` is 0 after navigating,
    opening a profile, switching tabs and opening the panel.

---

## 8. Responsive behaviour

| Width | Rail | Dashboard | Profile |
| --- | --- | --- | --- |
| ≥ 2200 | full | two columns, type one step up, page 2040 px | two-column content when rich, 420 px context |
| 1760–2199 | full | two columns | two-column content when rich, 380 px context |
| 1100–1759 | full | two columns; band on the same columns | content + 360 px context |
| 641–1099 | icons only (≤ 960) | one column; spotlight under the greeting | actions move under the name; context below content |
| ≤ 640 | horizontal bar | one column; spotlight countdown on its own line; placeholder "Search people" | name 28 px, avatar 64 px, labels above values, panel as bottom sheet |

There is no horizontal page scroll at any width. Tabs scroll sideways inside their own
strip if they ever exceed the width.

---

## 9. Accessibility expectations

- Every action is reachable by keyboard, with a visible focus ring.
- `/` focuses search.
- Search is an ARIA combobox: arrows move, Enter opens the highlighted or only match,
  Escape closes.
- Profile tabs follow the ARIA tabs pattern (arrows, Home, End).
- The side panel is a modal dialog with a focus trap. Escape and Ctrl+Enter work, and
  focus returns to the invoker.
- Decorative avatars are `aria-hidden`; the name next to them is the accessible name.
- Contrast: text levels ≥ 5.5:1; copper text ≥ 4.5:1 on band and raised surfaces.
- Reduced motion and reduced transparency are honoured (§ 7, and glass becomes solid
  `--m-overlay`).

---

## 10. Good and bad usage

| ✅ Do | ❌ Don't |
| --- | --- |
| Put a person's avatar and name at the start of every person row | Show a date or count with no person attached |
| One `.list` per section; rows separated by hairlines | A card per record, or a card inside a card |
| Collect missing sections into one "Add to …" strip | Render five empty sections with "Nothing here" |
| Show a value once: aliases in the header, all names in the Names tab | Repeat aliases in the header, a side card and a tab |
| Copper for soon, current, primary, focus | Copper icons, copper headings, copper borders |
| Compute "in 6 days" and "turns 35" from real dates | Show ages for approximate or year-less dates |
| Leave space empty when there is no more data | Fill space with filler widgets, scores or fake activity |
| Quiet section "Edit" plus one primary action per region | Several primary buttons in one header |
| Motion that shows where something went | Motion that only decorates |

---

## 11. Checklist for a new screen

1. Does it open with a band (`screenBand()` or the profile band) whose heading is
   `[data-heading]`?
2. Are records in `.list`/`.vrow`, and people in rows or tiles with `avatar()`?
3. Is every copper use in the list in § 1?
4. Do empty states use `emptyState()`: what is missing, why, and the way forward, once?
5. Does every editable thing open the side panel, with the dirty guard?
6. Are type sizes from the tokens, with nothing below 12 px?
7. Does it work at 2560, 1440, 820 and 390 wide with no horizontal scroll?
8. Does it work by keyboard alone, and with reduced motion?
9. Is a destructive action confirmed in a dialog that names what is lost (§ 16)?

---

## 12. Shared Stage B parts

| Part | Helper / class | Rule |
| --- | --- | --- |
| Screen band | `screenBand({eyebrow, title, meta, actions, below})` → `.screen-top` | Title (`.display`), one factual meta line (counts, the file name as eyebrow), at most one secondary action, tools below. No primary button in a band; the toolbar owns "New person". |
| Segmented control | `segmented(act, label, options, current)` → `.seg` / `.seg-btn[aria-pressed]` | One choice of 2–5: sort, view, review filter. Pressed = raised tone plus edge, never only a colour. Icon-only options keep their text for screen readers (`.seg-label`, hidden visually below 640 px). |
| Filter chip | `.filter-chip[aria-pressed]` | Independent toggles. Pressed shows a copper tint *and* a check icon. |
| Empty state | `emptyState(icon, title, text, actions)` → `.empty-state` | Icon tile 52 px, title 18 px, at most two actions. Used for no data, no matches, errors (with "Try again") and the trashed profile. |
| Notice | `.notice.info` / `.notice.warn` | Icon plus a sentence. Warn adds an amber edge, but the icon and the words carry the meaning. |
| Flag badge | `.badge-flag.is-warn` / `.is-info` / `.is-stop` | Status next to a name: icon plus 1–3 words ("Possible duplicate", "Repeated in this file", "Cannot be imported"). |
| Toast with action | `toast(message, tone, {label, run})` | One follow-up at most ("Open profile" after a restore). Toasts never carry the only copy of information. |

Tokens added in Stage B: `--m-merge-text` (#9BB3C9, slate). It marks merge decisions, so a
merge never reads as copper "new".

---

## 13. People directory

- **Band:**
  - Title "People" and a live count ("5 people"; "2 of 5 people" while searching or
    filtering).
  - One search field (`#people-q`, `/` focuses it).
  - Sort as a segmented control: Name, Last updated, Date added. Name follows the sorting
    preference in Settings → People (§ 17, § 24), sorted on the server before pagination
    with Slovak collation; names are written as the display preference sets.
  - View as a segmented control: List or Cards.
  - Filter chips "Only with": Phone, Email, Birthday, Work, Imported.
  - The toolbar search is hidden on this screen, so there is never a second search.
- **List view** (default): one `.list` of `.dir-row` buttons.
  - Columns: avatar | name with `@me` and the "goes by" name, then work | email and phone
    with icons | "Updated …" (or "Added …" when sorted by date added).
  - Below 1100 px the time column goes; below 760 px contact details move under the name.
    Nothing else is shown: no IDs, sources or counts.
  - "No phone or email" is the only placeholder text, because the absence matters for a
    directory.
- **Cards view:** `.person-tile.dir-card` in an auto-fill grid with a 280 px minimum
  (avatar, name, work or "goes by", email, phone). Missing values are left out, never
  replaced by filler. The choice is remembered per browser (`localStorage`, wrapped in
  try/catch).
- **Search:**
  - Debounced 160 ms; each request takes a token, and an older answer never paints over a
    newer one.
  - The list dims only if an answer takes longer than 120 ms (`.is-busy`, `aria-busy`).
  - Matches are marked with `highlight()`, which is case- and accent-insensitive like the
    server ("zuz" marks "Zuz" in Zuzana).
  - Escape in the field clears it. ArrowDown moves into the results.
- **Keyboard:** arrow keys move between people (all four arrows in Cards); Home and End
  jump; ArrowUp from the first row returns to search. Enter opens the profile with the
  avatar transition.
- **Returning:** the breadcrumb restores the search, filters, sort, view and scroll
  position, and focuses the row of the person you came from.
- **States:**
  - No people: "No people yet" with New person and Import.
  - No matches: "No one matches “…”", with a hint about what search covers, plus
    "Clear search" and/or "Clear filters".
  - Load error: an empty state with "Try again".
  - More than 100 people: "Show 100 more · 100 of N shown"; focus moves to the first new
    row.

---

## 14. Import workflow

The screen is a four-step flow over the existing `/api/import/preview` and
`/api/import/commit`, with no backend changes. The band carries a stepper (`.steps`,
`aria-current="step"`; on phones only the current step's name shows). Step changes slide
in the direction of travel.

1. **Choose file.**
   - A dropzone (`label.dropzone` around a visually hidden file input, so click, keyboard
     and drop all work) beside "How import works": review first, duplicates flagged,
     merging only adds, nothing lost.
   - Limits are stated: vCard 2.1/3.0/4.0, up to 1.8 MB, up to 5,000 contacts.
   - Nothing is sent before a file is chosen. While reading, the dropzone says
     "Reading {file}…" and ignores further files.
   - Errors stay in place (`#import-error`, `role="alert"`) and name the file:
     - too large;
     - empty;
     - no vCard content;
     - the server's parse error (for example "The file ends inside a contact").
2. **Review.**
   - Every contact is an `.imp-item` in one list. It shows:
     - avatar and name, plus a flag badge if it needs a look;
     - up to six facts with icons ("+N more");
     - the decision.
   - **The decision** is a radio group of three labelled options with icons: Import as
     new (person-plus), Merge (merge arrow, only when there is a candidate), Skip (×).
     Arrow keys move between them. A contact that cannot be imported has Import disabled.
   - **The left edge** shows the decision too: copper for new, slate for merge, none for
     skip.
   - **Possible matches** sit in a `.match-panel` under the contact: who, why (the
     server's reasons) and **Compare**.
     - Compare loads the existing person and shows a table of what Meridian has, what
       the file has, and for each file value "Adds" or "Already there". It uses the
       server's matching rules: phone by its last 9 digits, email ignoring case, other
       text ignoring case and accents.
     - With several candidates, a radio picks the merge target.
   - **Other notices:** repeats within the file, the server's reason for a skip (such as
     an organization card), parser warnings, and the "N fields kept for review" list
     (collapsed).
   - **Filters:** All, Needs a look, New, Merge, Skipped. Bulk actions: "Use
     suggestions" (the server's defaults) and "Skip all".
   - **The sticky decision bar** shows the tally ("2 new · 0 merges · 2 skipped"),
     "Choose another file" (asks "Discard this review?") and Continue (disabled until
     something would be imported).
3. **Confirm.**
   - Three columns: New people, Merged into existing people (target name plus "gets new
     details from …"), Skipped.
   - Then the guarantees: saved all together or not at all; merges only add; where
     unplaceable fields go.
   - "Back to review" keeps every decision. "Import N contacts" is the only commit.
     During the request both buttons are disabled and a guard flag ignores repeated
     clicks, so three rapid clicks make one import.
4. **Done.**
   - Only what the server returned: stat tiles (new, merged, skipped), the people created
     and merged (rows open their profiles), skipped names (collapsed) and kept fields.
   - "Go to People" and "Import another file".

The review is kept in memory. Leaving the screen and coming back resumes it at the same
step; only "Choose another file" discards it, and it asks first. After a finished import,
opening Import starts a new one.

---

## 15. Trash

- **Band:** "Trash", the count, and "Meridian never empties Trash on its own".
- **Body:** an info notice explaining restore and permanent deletion, then one list of
  `.trash-row`s.
  - Each row: a desaturated avatar, the name (a link to the trashed profile), work and
    email, "Deleted 5 hours ago" (exact time on hover), and Restore plus "Delete
    permanently".
  - "Delete permanently" is a quiet button in danger red, with a trash icon and words.
- **Restore** is immediate and reversible:
  - the button disables while it runs;
  - the row slides out (160 ms);
  - focus moves to the next row's Restore;
  - a toast offers "Open profile".
- **Permanent deletion:** a confirm dialog that names the person and what is lost:
  names, contact details, dates, notes and imported data. It also says it cannot be
  undone and that other applications will see the person was deleted.
  - Focus starts on Cancel.
  - Escape returns focus to the button that opened it.
- **Empty:** "Trash is empty" with "Go to People".

---

## 16. Destructive and irreversible actions

| Action | Reversible? | Pattern |
| --- | --- | --- |
| Move to Trash | yes | confirm dialog, toast |
| Restore | yes | no confirm; toast with "Open profile" |
| Delete permanently | **no** | danger dialog naming what is lost; focus on Cancel; danger button |
| Discard unsaved panel edits | the edits only | confirm "Discard changes" |
| Discard an import review | nothing was saved | confirm "Discard review" (not danger) |
| Clear @me | yes | no confirm; toast |

Danger red is reserved for actions that cannot be undone. A destructive button always says
what it does ("Delete permanently", not "OK").

---

## 17. Settings

Only settings that exist, in this order:
- **You (@me):** the person with Open profile, Change and Clear; or "No one is marked as
  you yet" with Choose a person and Create my profile. The description mentions that @me
  finds this person in any person search.
- **People** (0.5.0): two independent segmented controls in a `vrow` list — *Sort by*
  (First name → Last name / Last name → First name) and *Show names as* (First name Last
  name / Last name, First name) — and one hint on Slovak order and names stored as one piece
  of text. A choice saves at once (toast "Saved"); on phones each control spans the width.
  See § 24.
- **Import history:** one row per import (file, counts, date). It opens a dialog listing
  each contact's outcome (New, Merged or Skipped, plus "in Trash" or "deleted since"),
  with links to the people still there.
- **Your data:** facts that are true of this installation. Stored locally only; included
  in Nexus backups; no online lookups; deleted people kept in Trash.
- **About:** version and what is planned (named as planned, not as a setting).

Sections are `.set-section` (16 px heading, one-line description) within the 920 px measure.

---

## 18. Stage B responsive and accessibility notes

- **At 2560:** list and card views use the page width; cards auto-fill. Import file
  step: dropzone and "How import works" side by side from 1100 px. Confirm: three columns
  from 1100 px.
- **At 820:** directory rows drop the time column; import decisions stay inline beside
  the contact.
- **At 390:**
  - The directory band drops its Import button (the rail has it). Sort and view share a
    row, and the view options show icons only.
  - Import decisions become a full-width three-part control under the contact. Compare
    stacks: field, then "In Meridian", then "In this file".
  - The decision bar's buttons stretch. Trash actions wrap under the name.
- **Verified:** no horizontal page scroll at any of the four sizes on People (list,
  cards, no results), Import (file, review, comparison open, confirm), Trash and
  Settings.
- **Never colour alone:** duplicate warnings, decisions, pressed filters, errors and
  destructive buttons each pair colour with an icon and words.
- **Forms:** the file input has an accessible name and `aria-describedby` for its limits
  and errors. Each decision group is a `fieldset` with a visually hidden legend ("What to
  do with {name}"). The comparison is a captioned table with header cells; on phones it
  is shown as stacked blocks with visible column labels.
- **Live regions:** the directory count and the import tally are `aria-live="polite"`;
  import errors are `role="alert"`.
- **Reduced motion:** step slides, list fades, row exits and the reading pulse are all
  off. Verified: `document.getAnimations()` is 0 after each Stage B interaction.

Screenshots: `docs/screenshots/stage-b/` (this stage), `docs/screenshots/stage-a2/`
(approved reference) and `docs/screenshots/stage-a/` (history).

---

## 19. Relationships on profiles (Milestone 2)

- **Section:** "Relationships" sits on every Person, Organization and Group profile, after
  Work. It is one `.list` of `.conn-row`s:
  - **Label:** the phrase from this profile's side, capitalised ("Parent of", "Child of",
    "Member of").
  - **Value:** the other entity as a button with avatar and name, which opens their
    profile.
  - **Detail line:** the context in quotes, the period, "Uncertain" (icon plus word) for
    low confidence, the first source ("told by Jana"), and the note.
  - **Action:** a quiet Edit icon.
- **History:** current rows first, then ended ones under a `History` list label, dimmed.
  An ended relationship is never hidden or deleted.
- **Groups and organizations:** Groups show "Members" in place of Relationships at the
  top. Organizations show "People at work here", which comes from each person's Work and
  is marked "From each person's Work". It is read-only there.
- **Empty profiles:** "+ Relationship" / "+ Member" join the "Add to …" chips. The profile
  header is not used for relationships.
- **Connections summary:** the context column's **Connections** section lists up to 8
  current connections (people, organizations and groups once each). It offers "Explore in
  graph" (the local graph) and "Add relationship".

## 20. Relationship and membership editors

- **Shell:** the same side panel as every other editor (`openShell()`), with the same
  dirty guard, focus trap, Escape and Ctrl/⌘+Enter, and "Saved" feedback, section flash and
  toast.
- **The relationship form reads as a sentence:** "*Jana Example* is [phrase] [whom]".
  - The phrase list is grouped by category and filtered to types that fit both entity
    kinds. Directional types appear in both directions ("parent of" and "child of"), so
    choosing the phrase chooses the direction.
  - "Something else…" defines a custom type: the wording from this side, optionally from
    the other side (empty means symmetric), and a kind.
  - A live line ("Reads as: … and from Jana's profile: …") states both readings before
    saving.
- **Target:** an entity picker (combobox over people, organizations and groups; arrows,
  Enter, Escape; this entity excluded). The chosen entity shows as a chip with "Change".
- **Other fields:**
  - "In your own words" (context);
  - When: Since and Until as partial dates, plus Now (Current / Ended — keep as history /
    Not known);
  - How sure (Not stated, Sure, Fairly sure, Uncertain, Don't know);
  - sources (kind, details, learned);
  - note.
- **0.5.0 additions** (§ 24): kinship (*Parenthood* / *Kind of siblings*) under the
  target for parent and sibling phrases; the child's birth date suggested as Since with an
  explanation; `@me` and a *Me* badge in the entity picker; the "Still going on?" dialog
  before a new relationship between two who have an ongoing one; the "Possible siblings"
  dialog after a parent relationship is saved. The phrase selector keeps the native
  `<select>` with readable category headings.
- **Similar records:** before saving, a similar existing relationship appears as an amber
  notice listing it, with "Save anyway" and "Edit the existing one". Nothing is merged.
- **Footer of an existing record:** "End it" sets Ended and this month as the end, for the
  user to adjust; "Remove" (danger) asks first and explains to use End for real
  relationships.
- **Membership form:** Group or Member picker, role, the same When, How sure and sources
  fields, and the reminder that sharing a group says nothing about how members relate.

## 21. Graph view

- **Layout:** the canvas fills the workspace. Meridian surfaces float over it:
  - **top-left:** "Find in the graph" (combobox over visible nodes; Enter selects and
    centres), Filters (a count badge shows active filters), and, in local mode, the
    "Around {name}" chip with How far (1–3 steps) and "Whole graph";
  - **bottom-right:** zoom in, zoom out, zoom to fit, reset view;
  - **bottom-left:** the legend (shapes, current/ended/uncertain lines), collapsible and
    remembered;
  - **right:** the details panel (a bottom sheet below 1,100 px). The bar wraps rather
    than slide under it.
- **Shapes, colours and edges:** see § 22, which supersedes the Milestone 2 styling.
- **Interaction:**
  - **Pointer:** hover highlights a node and its neighbours and dims the rest over
    150 ms, with a small card beside the pointer (hidden for what is already selected). Click selects a node or edge. Double-click opens the profile. Drag a node to
    move it, drag the background to pan, and use the wheel or pinch to zoom around the
    pointer.
  - **Keyboard (canvas focused):** arrows pan, + and − zoom, 0 fits, Enter opens the
    selection, Escape clears it. "/" focuses the graph search.
- **Details panel:**
  - **Node:** kind, name, Open profile, Explore around, then its connections in this view
    (current, then History). Each one focuses that node.
  - **Edge:** every record between the two entities, from `/api/connections` (wording,
    context, period, confidence, sources), with Open buttons for both sides. Editing
    happens on the profiles.
- **Filters:**
  - Show People, Organizations or Groups (with counts).
  - Connection categories present in the data.
  - Time: All, Current or Ended.
  - "Show entities without connections".
  - Reset.

  Filtering never re-runs the layout, so nothing jumps.
- **Local graph:** opened from a profile's Connections or from "Explore around". It is the
  same engine and data, limited to the entity's neighbourhood, 1–3 steps out. The
  breadcrumb reads "Graph / Around {name}". "Whole graph" returns, with that entity still
  selected.
- **State:** layout positions, camera, selection and local mode are kept for the session.
  Returning from a profile restores them exactly.
- **Empty states:** with nothing recorded, a centred empty state with "Go to People". With
  entities but no relationships, a hint: "Add one from any profile and it appears here."
- **Reduced motion:** the layout is computed out of sight ("Arranging the graph…"), then
  shown settled. Camera moves and dimming are instant.
- **Responsive:** below 1,100 px the details become a bottom sheet that sits just above
  the legend and zoom, however they wrap. At ≤ 760 px the legend folds to its title. At
  ≤ 640 px the search takes the full width, the overview panel starts folded to its title
  ("Constellation · N entities") so the graph has the screen, and the phone rail fits
  eight destinations (40 px items, scrollable).

Screenshots of Milestone 2: `docs/screenshots/m2/`. Screenshots of the Celestial redesign:
`docs/screenshots/celestial/`.

## 22. Celestial Graph

The graph reads as an astronomical atlas. Entities are stars, connections are fine
constellation lines, and the instruments around them are quiet tools. It is celestial, not
science fiction: no neon, bloom, particles, starfields or idle motion. This section
supersedes the Milestone 2 shapes and edge styling in § 21.

### Stage and instruments
- **Stage:** a barely-there radial gradient (`#1a1613` → `#0f0d0b`) and nothing else.
- **Instrument material:** the bar, zoom group, legend, panel, filters popover and hover
  card share one surface: `--instrument`, `--instrument-edge`, a 1 px inner highlight and
  a soft drop shadow. Backdrop blur is used only on these few surfaces, never per node.
  With `prefers-reduced-transparency` they become opaque.
- **No decorative controls.** Every instrument does something: search, Filters, the local
  chip (depth 1/2/3, Whole graph), zoom in and out, fit, reset, the legend toggle and the
  panel toggle.

### Entities
| Kind | Shape | Colour | Notes |
| --- | --- | --- | --- |
| Person | filled circle | `#ecdccd` sand | the default star |
| Organization | filled diamond | `#a3b5cc` slate | a different silhouette at any size |
| Group | hollow hexagon, faint fill | `#b3c39e` sage | an outline, so it differs from both without colour |
| @me | the circle plus a thin copper ring | `#c48663` | |

- **Size:** radius = 3.2 + 1.15·√(visible connections), clamped to 3.2–8.5 world units,
  plus 0.8 for @me. It is gentle on purpose: hubs are landmarks, not planets.
- **Hit target:** never below 11 px on screen (`MIN_HIT`), whatever the drawn size.
- **Selection:** a cached copper radial-gradient halo sprite plus a 1.5 px copper ring.
  Hovered and focused neighbours get a faint halo in their own hue. Halos are sprites drawn
  with `drawImage`, never `shadowBlur`.
- **Level of detail:** above 3,000 visible entities, entities are plain points. Halos
  appear only above zoom 0.35, or 1.2 when more than 1,500 entities are visible.

### Connections
| Record | Geometry | Colour |
| --- | --- | --- |
| Relationship | a gentle arc (bend 0.09 of the length) | its category hue: family `#c98d69`, partner `#d39f8a`, social `#cdbca7`, professional `#a3b5cc` |
| Membership | a straight spoke | sage `#b3c39e` |
| Employment | a straight spoke | slate `#9aaec6` |

- **State:** current is solid, ended is dashed (5 / 4.5), and uncertain or unknown is
  dotted. Pattern, not colour, carries state, so it survives colour blindness and
  greyscale.
- **Opacity:** resting lines are 0.13–0.38, thinning as the graph grows. Lines in focus
  rise to 0.8–0.95 at 1.35 px. Resting width is 0.9 px, or 0.6 px when dense.
- **Direction:** a small chevron along the line, only on directional connections in focus,
  pointing the way the shown wording reads: towards Vzorko for "Ukážka parent of Vzorko", and
  towards Ukážka for "Vzorko child of Ukážka". Symmetric types never show one.
- **Several records between one pair** fan out as separate lanes (0.22 of the length per
  lane), each one hoverable and selectable. The panel lists every record.

### Labels
- **Always shown:** the selected and hovered entity, both ends of a selected or hovered
  connection, and the neighbours of the focus where they fit.
- **At rest:** best-connected first, within a budget that follows the canvas area: area ÷
  14,000 for small graphs, or ÷ 30,000 above 60 entities, clamped to 10–260. Zooming in
  grows the eligible set, so more names appear at high zoom.
- **Never overlapping:** exact rectangle tests on a 48 px spatial hash. Forced names claim
  their space first, then relationship wording, then the rest. Entity cores are reserved
  when 400 or fewer are visible.
- **No popping:** labels fade in and out over about 170 ms. A label already showing keeps
  a small rank bonus, so names do not flicker as you pan. Dimmed entities have no labels.
- **Relationship wording** appears on a hovered or selected connection. It also appears
  around a focused entity with 8 or fewer connections, with spokes worded only at 4 or
  fewer. It reads from the focused side ("married to", "member of", "· ended",
  "· uncertain"). Parallel records slide along their curve to find room.
- **Type:** 11.5 px / 500 at rest, 12.5 px / 600 for hubs, and 13 px / 600 forced, each
  with a dark outline. The selected name is light copper.

### Layout and camera
- **Clusters come only from real connectivity.** Connected components are packed on a
  spiral, largest first. Each footprint is sized by the measured spread for the graph's
  density, so the packing matches the settled layout. Entities without connections share
  one loose cluster beside the rest. A weak pull to each component's home keeps separate
  networks apart without drawing them together. Nothing is clustered by kind, name or any
  inferred attribute.
- **Settling:** a time-boxed d3-force simulation (8 ms per frame while interacting, 26 ms
  idle) that stops when settled. After that, nothing moves: hover, selection, filters and
  panel changes never reheat it.
- **Dragging:** the held node follows the pointer and its network responds through the live
  simulation, one tick per frame.
  - **On release:** the node stays where it was dropped; it is pinned while the rest eases
    around it, then unpinned. The surrounding network keeps moving and cools on a clock,
    not per tick, with exponential damping. Alpha falls from 0.05–0.13 to 0.003 over 1–3 s,
    longer for bigger drags, then the simulation stops and drawing stops with it.
  - **Dragging again,** even mid-cool-down, picks up from the current positions; nothing
    resets.
  - **Under reduced motion,** the node moves alone and nothing else animates.
- **Returning to the same graph** (from a profile, or to the same local graph) restores
  the saved positions exactly, with no re-layout, as long as the data is unchanged; a data
  fingerprint decides. Changed data re-runs the layout gently.
- **Free area:** the engine knows which parts of the canvas the bar and the panel cover
  (`setInsets`). Fit, focus and framing use only the free area.
- **The camera moves only when needed:**
  - **On first open:** it is placed instantly from the predicted fit, then makes one calm
    fit (640 ms) once the layout settles.
  - **Choosing from search or the panel:** it frames the entity with everything it
    touches (`frameAround`). It zooms in no further than 1.6, and keeps the entity centred
    when everything still fits that way.
  - **Clicking on the canvas:** it never moves, unless the entity is near the edge of the
    free area (`ensureVisible`).
- **Remembered:** positions, camera, selection and local mode are kept for the session.

### Details panel
The panel is also the canvas's text alternative.
- **Nothing selected ("Constellation"):** counts by kind (with glyphs) and connections,
  then "Most connected" (7, or 4 on narrow screens). "Browse all N" lists up to 400
  entities as buttons that each focus the entity.
- **Entity:** kind, name, Open profile, Explore around and Clear selection. Then "N
  connections in view" (current) and History (ended), each with its glyph, line sample and
  wording.
- **Connection:** every record between the pair, from `/api/connections`, with period,
  state, confidence and sources, and Open buttons for both ends.
- **Collapsible:** the − / + button folds the panel to its header and frees the space for
  fit and focus. On phones the overview starts folded; after that the reader's choice
  wins.

### Motion
- **Easing and timing:** one easing (cubic ease-out). Camera moves take 420–640 ms, hover
  dimming 150 ms, and label fades about 170 ms.
- **No idle animation:** the frame loop runs only while settling, animating or fading, and
  a test asserts that frames stop.
- **Reduced motion:** the layout is computed out of sight, camera moves and dimming are
  instant, and labels switch without fading. `document.getAnimations()` stays empty.

### Accessibility
- **Keyboard:**
  - "/" focuses search; ↑ and ↓ move through results, and Enter selects and frames.
  - On the canvas: arrows pan, + and − zoom, 0 fits, Enter opens, Escape clears.
  - Every instrument is a button with a visible focus ring, including the search field
    inside the bar.
- **Announcements:** a polite live region says what was selected ("Eva Zelený, person, 11
  connections"), which connection was chosen, and "Selection cleared".
- **Non-colour distinctions:** silhouette for kind, straight versus arced for record kind,
  and dash or dot for state. The legend shows the same glyphs and line samples.
- **Contrast:** labels are `rgb(239 231 224)` with a near-black outline on the near-black
  stage, well above 4.5:1.

### Good and bad usage
- **Good:** a calm sky at rest, names where there is room, detail on demand, and a camera
  that stays put while you read.
- **Bad:**
  - glow, bloom or particles;
  - colour-only distinctions;
  - labels on every entity;
  - drifting or auto-rotating layouts;
  - moving the camera on hover;
  - clustering by anything other than recorded connections.

## 23. Timeline

The Timeline reads as a historical atlas, not a feed. It has one quiet thread through the years,
entries as rows of type rather than cards, and the year as the landmark. It complements the
Celestial Graph (§ 22) and uses the same palette and instruments. Behaviour and data:
docs/TIMELINE.md.

### Layout
- **Header:** the title ("History", or "{name} over time" when focused), with a meta line
  (entries, span, undated count). The tools are "Focus on someone" (or the focus chip),
  Filters, Overview / Detail, and New event.
- **Year rail** (left, sticky): every year with entries, with its density as a 2 px copper bar.
  A dotted gap marks quiet years, and the year being read is highlighted (`aria-current`). On
  phones it becomes a swipeable strip pinned under the toolbar.
- **Stream:** a 1 px thread at the marks' centre. Each year has a 26 px light numeral on a
  ringed node, sticky with a solid background and a short fade. Month labels appear only in
  busy years (three or more entries), and "12 quiet years" in italics marks a gap.
- **Details column** (right, sticky, 360 px): a key to the marks when nothing is selected, the
  selected entry otherwise. Below 1,100 px it is a sheet anchored bottom-right (full width on
  phones). The entry scrolls to stay above it.

### Entries
Each entry is a row: date (short, within its year: "17 May", "May", or nothing for year-only),
mark, tag, sentence, and a quiet second line. Entries on the same exact date and precision
share one date label (0.5.0): the following rows sit 4 px closer and a `--m-line-strong`
hairline in the date column joins them to the label; each remains its own row. Partial
dates are never merged (`TIMELINE.md` § 10a).

| Kind | Mark | Hue |
| --- | --- | --- |
| Relationship | an arc between two points (the graph's arc) | its category (family `#c98d69`, partner `#d39f8a`, social `#cdbca7`, professional `#a3b5cc` …) |
| Membership | a hexagon (the Group glyph) | sage `#b3c39e` |
| Work | a diamond (the Organization glyph) | slate `#9aaec6` |
| Life date | a circle | sand `#ecdccd` |
| Event | a four-point star | copper `#c48663` |

- **Fill and line:** filled means began or happened, hollow means ended or undated, and a
  dotted outline means uncertain or state unknown. An ongoing period trails a short fading line
  down the thread.
- **Tags:** a small word on a 14% tint of the hue ("Began", "Ended", "Born", "Founded",
  "Meeting"). It is always present, so meaning never rests on colour.
- **Sentence:** names in `--m-text` at weight 500 and the wording in `--m-text-2` ("Jana Example
  married to Adam Kováč"). The focused entity reads quieter (`is-focus`).
- **Second line:** the kind, context, "until …" or "since …", the length ("10 years so far"),
  "uncertain", and the number of sources.
- **Selection:** the row gets `--accent-soft` with a copper hairline. Hover uses `--m-hover`.

### Density
- **Overview:** each year shows its summary ("39 relationship changes · 24 work changes …") and
  three entries.
- **Detail:** six entries per month, then "Show N more from May 2005". Large Detail views build
  years as they approach (TIMELINE.md § 8).

### Motion
- Smooth scrolling to a year or entry, and the sheet's 260 ms entrance; nothing else.
- Reduced motion makes both instant. There is no idle animation.

### Good and bad usage
- **Good:**
  - partial dates shown as partial ("During 1990", "c. 2005");
  - unknown dates kept, in their own section;
  - one sentence per entry;
  - the record that owns an entry one click away.
- **Bad:**
  - feed cards, avatars on every row, or big date badges;
  - placing a year-only date on 1 January;
  - implying that an old, ongoing relationship ended;
  - colour-only kinds;
  - animating the idle timeline.

---

## 24. Kinship, transitions, name order and `@me` (0.5.0)

Behaviour and data: `docs/RELATIONSHIPS.md` § 9a. These additions reuse the side panel, the
modal `ae-dialog` and the segmented control; nothing else in Meridian changed shape.

### Native selects in the dark theme
The shared foundation coloured `<option>` but not `<optgroup>`, so Chromium on Windows drew
category headings (Family, Partners, Friends and social) in light text on the list's default
white. Meridian's `style.css` now gives every `.ae-select` `color-scheme: dark`, and options
and headings the overlay surface `--m-overlay`: headings `--m-text-2` at weight 600 (9.1:1),
options `--m-text` (13.5:1), the checked option `--m-raised-hover`, disabled `--m-text-3`;
`forced-colors` falls back to `Canvas`/`CanvasText`. The control stays native: keyboard,
type-ahead and screen readers behave as before. Meridian has only a dark theme, so there is no
light variant to check.

### Relationship editor
- **Kinship** appears under *Of whom* only for parent and sibling phrases: *Parenthood*
  (Biological, Adoptive, Step-parent, Not specified) or *Kind of siblings* (Full siblings,
  Half-siblings, Biological — full or half not known, Through adoption, Step-siblings, Not
  specified), with one hint line where it helps.
- **Suggested Since:** the birth date fills Since and a copper hint under the period says
  where it came from ("Since is set to Vzorko Kvázimenný’s birth date. Change it if the
  relationship began at another time."). It never touches Until or a date the user typed.
- **Sentences use natural names** ("Ukážka Kvázimenná is parent of Vzorko Kvázimenný") even when
  lists show "Kvázimenný, Vzorko".
- **Rows** keep the ordinary wording ("Sibling of", "Child of") and add the kinship to the quiet
  line: *half-siblings*, *siblings through adoption*, *adoptive*, *step-parent* (biological
  parenthood is the unremarked default).

### "Still going on?"
Wide dialog over the panel: one sentence naming both people and the new phrase; one bordered
row per ongoing relationship (checkbox, full sentence, "Since 2022 · no end date"); *Ended on*
as the usual day/month/year widget (shown only while something is selected) with "Leave it empty
if you don’t know"; buttons Cancel, Keep all and save, End selected and save (primary, disabled
until something is selected). Only partner relationships start selected.

### "Possible siblings"
Wide dialog after the panel closes: one sentence ("The parents recorded for … suggest …
Nothing is saved until you confirm."), then one bordered row per candidate with both avatars
and names, a plain-language reason ("Both have Ukážka Kvázimenná as a biological parent. Whether
they share their other parent is not recorded."), and a select of answers with the evidence
preselected. Buttons: Not now, Save answers.

### Name order
- Lists, search results and pickers show `display_family_first` ("Kvázimenný, Vzorko") when the
  display preference is last-name-first; headings, sentences, Graph and Timeline keep the
  natural form.
- Sorting is server-side with the `meridian_name` collation (Slovak: ä, č, ô, š, ž and ch are
  letters of their own; other accents break ties). Prefixes and suffixes do not sort; a name
  stored as one piece of text sorts and shows as written.

### `@me` in pickers
Typing `@me` (or `@`, `@m`) shows the self Person first with a small *Me* badge; "me" puts
them first among ordinary matches. With no one marked: "No one is marked as you yet. Choose who
you are in Settings → You." A picker that cannot take a Person (Groups) or excludes the self
Person (their own profile) says so instead of showing nothing.

---

## 25. Linked from other modules (0.6.0)

A profile section, shown only when something links here: one `vrow` per item, labelled by its module and kind ("Event
in Chronos", "Note in Mnemosyne") with the module's icon, the owner's current title as the value, and an "Open
<module>" action when that module is installed. An item that cannot be resolved stays listed as "Something linked
here" with a quiet reason ("deleted there", "not available right now"). One hint line says the items belong to their
modules. It is read when the profile opens (`GET /api/entities/{id}/linked-from`); Meridian stores none of it.

