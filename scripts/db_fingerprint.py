"""Read-only fingerprint of a Meridian database, for comparing before and after an update.

Prints JSON: schema version, integrity check, and per table the row count and a SHA-256 over
its rows (ordered by every column). Columns added by a later schema are left out when
`--columns-of` names the older fingerprint, so the comparison covers exactly the old data.

    python db_fingerprint.py /data/meridian.sqlite3 [--columns-of before.json]
"""

import hashlib
import json
import sqlite3
import sys

path = sys.argv[1]
only = None
if "--columns-of" in sys.argv:
    only = json.load(open(sys.argv[sys.argv.index("--columns-of") + 1]))["columns"]
conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
out = {
    "user_version": conn.execute("PRAGMA user_version").fetchone()[0],
    "integrity": conn.execute("PRAGMA integrity_check").fetchone()[0],
    "foreign_keys": len(conn.execute("PRAGMA foreign_key_check").fetchall()),
    "tables": {},
    "columns": {},
}
for (table,) in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    if only is not None:
        if table not in only:
            continue
        cols = [c for c in cols if c in only[table]]
    out["columns"][table] = cols
    listed = ",".join(f'"{c}"' for c in cols)
    digest = hashlib.sha256()
    n = 0
    for row in conn.execute(f"SELECT {listed} FROM {table} ORDER BY {listed}"):
        digest.update(json.dumps(row, ensure_ascii=False, default=str).encode())
        n += 1
    out["tables"][table] = {"rows": n, "sha256": digest.hexdigest()}
print(json.dumps(out, indent=1, ensure_ascii=False))
