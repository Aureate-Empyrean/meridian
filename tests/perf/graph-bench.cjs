// Runs graph-bench.html in Chromium and prints the engine's timings for growing synthetic
// networks. Usage: PLAYWRIGHT_PATH=<path to playwright> node tests/perf/graph-bench.cjs
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.resolve(__dirname, "graph-bench.html").replace(/\\/g, "/"));
  const sizes = (process.env.SIZES || "200:2,500:2,2000:2.5,5000:2.5").split(",").map((s) => s.split(":").map(Number));
  const rows = [];
  for (const [n, perNode] of sizes) {
    const result = await page.evaluate(([n, p]) => window.bench(n, p), [n, perNode]);
    rows.push(result);
    console.log(JSON.stringify(result));
  }
  await browser.close();
  const fail = rows.filter((r) => r.nodes <= 2000 && r.drawP95Ms > 16.7);
  if (fail.length) {
    console.error("Frame budget exceeded for", fail.map((r) => r.nodes).join(", "), "nodes");
    process.exit(1);
  }
})();
