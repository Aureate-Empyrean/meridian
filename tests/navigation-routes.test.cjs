// Meridian's route codec for the Nexus navigation contract (frontend/navigation.js).
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const app = fs.readFileSync("frontend/app.js", "utf8");
const nav = fs.readFileSync("frontend/navigation.js", "utf8");
const a = app.indexOf("function routeFromPath(path)");
const b = app.indexOf("const SKELETONS", a);
assert(a > 0 && b > a, "routeFromPath not found");
const codec = nav.slice(nav.indexOf("const MeridianRoutes"), nav.indexOf("let shownRoute"));
const context = {};
vm.createContext(context);
vm.runInContext(app.slice(a, b) + codec + "\nglobalThis.R = MeridianRoutes;", context);
const R = context.R;
const id = "0192f0c4-1111-7aaa-8bbb-000000000001";
const round = (ref) => R.serialize(R.parse(ref));

for (const ref of ["/", "/people", "/organizations", "/groups", "/graph", "/timeline", "/import", "/trash", "/settings", `/people/${id}`, `/organizations/${id}`, `/groups/${id}`])
  assert.strictEqual(round(ref), ref, ref);
assert.deepStrictEqual({ ...R.parse(`/groups/${id}`) }, { view: "entity", id, kind: "group" });
assert.deepStrictEqual({ ...R.parse(`/people/${id}`) }, { view: "person", id });
assert.strictEqual(round(`/interactions/${id}`), `/interactions/${id}`);
assert.deepStrictEqual({ ...R.parse(`/interactions/${id}`) }, { view: "interaction", id: null, interaction: id });
// Unknown, malformed or over-specified references are an explicit outcome, and keep their address.
for (const ref of ["/nope", "/people/not-a-uuid", "/people/x/y", "/admin", "/interactions/not-a-uuid"]) {
  assert.strictEqual(R.parse(ref).view, "not-found", ref);
  assert.strictEqual(round(ref), ref, ref);
}
assert.strictEqual(round(""), "/");
assert.strictEqual(round("/people/"), "/people");
// Queries and fragments are not part of Meridian routes.
assert.strictEqual(round("/people?q=secret#x"), "/people");
console.log("navigation route codec tests passed");
