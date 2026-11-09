"""Compare the rows of an earlier Meridian database with a later one, by primary key.

Reports, per table, how many earlier rows are missing or changed in the later database
(comparing only the columns the earlier schema had) and how many rows are new. Read-only.

    python compare_rows.py earlier.sqlite3 later.sqlite3
"""

import json
import sqlite3
import sys

old = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
new = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True)
report = {}
for (table,) in old.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
):
    info = list(old.execute(f"PRAGMA table_info({table})"))
    cols = [r[1] for r in info]
    key = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5]] or cols
    listed = ",".join(f'"{c}"' for c in cols)
    keyed = lambda rows: {tuple(r[cols.index(k)] for k in key): r for r in rows}  # noqa: E731
    before = keyed(old.execute(f"SELECT {listed} FROM {table}"))
    after = keyed(new.execute(f"SELECT {listed} FROM {table}"))
    changed = [k for k in before if k in after and before[k] != after[k]]
    report[table] = {
        "earlier": len(before),
        "missing": sum(1 for k in before if k not in after),
        "changed": len(changed),
        "new": sum(1 for k in after if k not in before),
    }
    if changed:
        report[table]["changed_keys"] = [list(k) for k in changed][:20]
print(json.dumps(report, indent=1, ensure_ascii=False))
