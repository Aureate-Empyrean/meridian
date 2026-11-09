"""A local stand-in for the Nexus host page, for browser checks without Nexus.

Serves Meridian in an iframe sandboxed like the Nexus one (`allow-scripts allow-downloads`)
at /__harness and answers its `empyrean-v1` bridge: `context` with an English locale, and
`request` by calling Meridian's API with the gateway key. Like the Nexus bridge it passes on
only an error's `detail` string, never an error body. Test data only: a fresh database in
MERIDIAN_DATA (default /tmp/meridian-harness).

    python tests/e2e/harness.py [port]     (PYTHONPATH=backend)
"""

import json
import os
import sys

import uvicorn
from starlette.applications import Starlette
from starlette.responses import HTMLResponse
from starlette.routing import Mount, Route

KEY = os.environ.setdefault("NEXUS_RESOLVER_KEY", "h" * 40)
os.environ.setdefault("MERIDIAN_DATA", "/tmp/meridian-harness")

from meridian.app import create_app  # noqa: E402  (reads the environment above)

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Meridian harness</title>
<style>html,body{margin:0;height:100%;background:#0c0a09}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body><iframe id="module-application" title="Meridian" sandbox="allow-scripts allow-downloads" src="/"></iframe>
<script>
const KEY = __KEY__;
addEventListener("message", async (event) => {
  const m = event.data;
  if (!m || m.channel !== "empyrean-v1") return;
  const reply = (x) => event.source.postMessage({ channel: "empyrean-v1", id: m.id, ...x }, "*");
  if (m.action === "context") return reply({ result: { locale: "en", applications: [] } });
  if (m.action !== "request") return reply({ error: "Not available in the harness" });
  try {
    const r = await fetch(m.path, { method: m.method || "GET",
      headers: { "x-nexus-gateway-key": KEY, "content-type": "application/json" },
      body: m.body === undefined ? undefined : JSON.stringify(m.body) });
    const data = await r.json().catch(() => null);
    if (!r.ok) return reply({ error: data && typeof data.detail === "string" ? data.detail : `HTTP ${r.status}` });
    reply({ result: data });
  } catch (error) { reply({ error: String(error) }); }
});
</script></body></html>"""


def harness(request):
    return HTMLResponse(PAGE.replace("__KEY__", json.dumps(KEY)))


app = Starlette(routes=[Route("/__harness", harness), Mount("/", app=create_app())])

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
