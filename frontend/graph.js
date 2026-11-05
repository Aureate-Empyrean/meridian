/*
 * Meridian graph engine — "Celestial Graph" (d3-force layout, Canvas 2D rendering).
 *
 * Visual system (docs/DESIGN.md § 22):
 * - Entities are small luminous cores, told apart by silhouette as well as tone: a Person
 *   is a filled circle, an Organization a filled diamond, a Group a hollow hexagon. Size
 *   follows the number of visible connections, gently (it never ranks people).
 * - Connections are fine, translucent lines. Personal relationships are gentle arcs; Group
 *   membership and Work are straight spokes to the group or organization. Ended
 *   connections are dashed, uncertain ones dotted. Several records between one pair fan out
 *   as separate arcs, each selectable.
 * - Direction (a small chevron) and relationship wording appear only on the connections in
 *   focus, so the whole graph stays calm.
 * - Halos are pre-rendered sprites (no per-node blur); level of detail drops them, and
 *   draws plain points, when nodes are too small to tell apart.
 *
 * Layout: disconnected components are packed apart (from actual connectivity only); the
 * simulation advances in time-boxed slices per frame and stops when settled. Hover and
 * selection never restart it. The camera fits into the free part of the canvas (insets).
 */
(function (global) {
  "use strict";
  const d3 = global.d3;
  const KIND = {
    p: { color: "#ecdccd", glow: [236, 220, 205], shape: "circle", noun: "Person" },
    o: { color: "#a3b5cc", glow: [163, 181, 204], shape: "diamond", noun: "Organization" },
    g: { color: "#b3c39e", glow: [179, 195, 158], shape: "hexagon", noun: "Group" },
  };
  const CATEGORY = {
    family: "#c98d69", partner: "#d39f8a", social: "#cdbca7", professional: "#a3b5cc",
    affiliation: "#a3b5cc", structure: "#93a7c1", membership: "#b3c39e", employment: "#9aaec6", other: "#b9aea3",
  }; // prettier-ignore
  const COPPER = "#c48663";
  const COPPER_HI = "#e8bc9c";
  const LABEL = [239, 231, 224];
  const HALO_DARK = "rgba(16,13,11,0.92)";
  const MIN_HIT = 11; // px: hit targets never shrink below this, whatever the drawn size
  // Live physics around a drag. While a node is held the simulation stays warm; after release
  // it cools on a clock (not per tick), one tick per frame, so the network visibly eases to
  // rest in 1–3 s whatever the refresh rate or graph size.
  const DRAG_ALPHA = 0.12;
  const COOL_END = 0.003;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const edgeColor = (l) => (l.record === "m" ? CATEGORY.membership : l.record === "e" ? CATEGORY.employment : CATEGORY[l.category] || CATEGORY.other);

  function shapePath(path, shape, x, y, r) {
    if (shape === "circle") {
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    } else if (shape === "diamond") {
      const s = r * 1.22;
      path.moveTo(x, y - s);
      path.lineTo(x + s, y);
      path.lineTo(x, y + s);
      path.lineTo(x - s, y);
      path.closePath();
    } else {
      const s = r * 1.15;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const px = x + s * Math.cos(a);
        const py = y + s * Math.sin(a);
        i ? path.lineTo(px, py) : path.moveTo(px, py);
      }
      path.closePath();
    }
  }
  /** A soft halo, rendered once per tone and reused: no blur filters per node. */
  const sprites = new Map();
  function halo([r, g, b], strength) {
    const key = `${r},${g},${b},${strength}`;
    if (sprites.has(key)) return sprites.get(key);
    const size = 64;
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},${strength})`);
    grad.addColorStop(0.35, `rgba(${r},${g},${b},${strength * 0.38})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    sprites.set(key, c);
    return c;
  }

  /** Connected components, packed on a spiral by size so separate networks never overlap. */
  /** A short fingerprint of what is drawn, to tell whether saved positions still fit. */
  function signature(nodes, links) {
    let h = 5381;
    const add = (text) => {
      for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
    };
    for (const n of nodes) add(n.id);
    for (const l of links) add(`${l.source.id}>${l.target.id}:${l.type}:${l.state}`);
    return `${nodes.length}:${links.length}:${h >>> 0}`;
  }

  function packComponents(nodes, adjacent) {
    const comp = new Map();
    const groups = [];
    for (const n of nodes) {
      if (comp.has(n.id)) continue;
      const members = [];
      const stack = [n.id];
      comp.set(n.id, groups.length);
      while (stack.length) {
        const id = stack.pop();
        members.push(id);
        for (const m of adjacent.get(id) || []) if (!comp.has(m)) comp.set(m, groups.length) && stack.push(m);
      }
      groups.push(members);
    }
    // Entities without connections share one loose cluster at the edge.
    const singles = groups.filter((g) => g.length === 1).flat();
    const real = groups.filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
    if (singles.length) real.push(singles);
    const placed = [];
    const centre = new Map();
    // How far apart entities settle follows the charge tier, so a cluster's footprint does
    // too (measured on the synthetic fixtures: about 55 world units per √n when small, 15 at 5,000).
    const total = nodes.length;
    const spread = total > 3000 ? 16 : total > 900 ? 25 : total > 200 ? 38 : 52;
    real.forEach((members, i) => {
      const lone = members === singles;
      const r = (lone ? 18 : spread) * Math.sqrt(members.length) + 28;
      let x = 0;
      let y = 0;
      if (placed.length) {
        // The first position on a widening spiral that clears every placed cluster.
        for (let step = 1; step < 4000; step++) {
          const a = step * 0.5;
          const d = 18 * step ** 0.75;
          x = d * Math.cos(a);
          y = d * Math.sin(a) * 0.72;
          if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 18)) break;
        }
      }
      placed.push({ x, y, r });
      for (const id of members) centre.set(id, { x, y, index: i, lone, r });
    });
    return { centre, count: real.length, placed };
  }

  class Engine {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.opts = options;
      this.reduced = options.reducedMotion || (() => false);
      this.cam = { x: 0, y: 0, k: 1 };
      this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
      this.nodes = [];
      this.links = [];
      this.byId = new Map();
      this.adjacent = new Map();
      this.visibleNodes = [];
      this.visibleLinks = [];
      this.hover = null;
      this.selected = null;
      this.mix = 0;
      this.anim = null;
      this.settling = false;
      this.frame = 0;
      this.frames = 0;
      this.lastFrame = 0;
      this.widths = new Map();
      this.labelAlpha = new Map();
      this.stats = { ticks: 0, settleMs: 0, lastDrawMs: 0, labels: 0, labelBoxes: [] };
      this.resize = this.resize.bind(this);
      this.loop = this.loop.bind(this);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(canvas.parentElement || canvas);
      this.bind();
      this.resize();
    }

    destroy() {
      this.observer.disconnect();
      this.sim?.stop();
      cancelAnimationFrame(this.frame);
      this.unbind?.();
    }

    /* ── Data ── */

    setData({ nodes, edges }, positions = new Map(), { warm = null } = {}) {
      const previous = this.byId;
      this.byId = new Map();
      this.nodes = nodes.map((n) => {
        const old = previous.get(n.id);
        const saved = positions.get(n.id);
        const node = Object.assign(old || {}, n, { degree: 0 });
        if (!old && saved) Object.assign(node, { x: saved.x, y: saved.y });
        this.byId.set(n.id, node);
        return node;
      });
      this.adjacent = new Map(this.nodes.map((n) => [n.id, new Set()]));
      const pairs = new Map();
      this.links = [];
      for (const e of edges) {
        const source = this.byId.get(e.source);
        const target = this.byId.get(e.target);
        if (!source || !target || source === target) continue;
        const link = Object.assign({}, e, { source, target });
        link.pair = source.id < target.id ? `${source.id}|${target.id}` : `${target.id}|${source.id}`;
        link.spoke = e.record === "m" || e.record === "e";
        (pairs.get(link.pair) || pairs.set(link.pair, []).get(link.pair)).push(link);
        this.links.push(link);
        source.degree++;
        target.degree++;
        this.adjacent.get(source.id).add(target.id);
        this.adjacent.get(target.id).add(source.id);
      }
      for (const group of pairs.values()) group.forEach((l, i) => Object.assign(l, { lane: i - (group.length - 1) / 2, lanes: group.length }));
      const packed = packComponents(this.nodes, this.adjacent);
      this.components = packed;
      for (const n of this.nodes) {
        n.home = packed.centre.get(n.id);
        n.base = this.baseRadius(n.degree, n.self);
        n.r = n.base;
        if (n.x === undefined) {
          const anchor = [...this.adjacent.get(n.id)].map((id) => this.byId.get(id)).find((m) => m.x !== undefined);
          const jitter = () => (Math.random() - 0.5) * 60;
          if (anchor) Object.assign(n, { x: anchor.x + jitter(), y: anchor.y + jitter() });
          else Object.assign(n, { x: n.home.x + jitter(), y: n.home.y + jitter() });
        }
      }
      const fresh = this.nodes.filter((n) => !previous.has(n.id) && !positions.has(n.id)).length;
      this.signature = signature(this.nodes, this.links);
      // The same data with every position known (returning from a profile): restore it as
      // it was, without re-running the layout, so nothing moves.
      const same = !fresh && positions.signature === this.signature;
      this.layout(warm ?? (same ? 0 : fresh / Math.max(1, this.nodes.length) > 0.3 ? 1 : fresh ? 0.35 : 0.08));
      this.applyFilter(this.filter);
    }
    baseRadius(degree, self) {
      return clamp(3.2 + 1.15 * Math.sqrt(degree), 3.2, 8.5) + (self ? 0.8 : 0);
    }

    layout(alpha) {
      this.sim?.stop();
      const n = this.nodes.length;
      const degreeOf = (node) => Math.max(1, node.degree);
      const big = n > 3000;
      // Gentle centring: strong enough to hold separate networks apart, weak enough for
      // communities inside one network to find their own places.
      const pull = (d) => (d.home.lone ? 0.06 : n > 900 ? 0.03 : n > 40 ? 0.014 : 0.03);
      this.sim = d3
        .forceSimulation(this.nodes)
        .stop()
        .force(
          "link",
          d3
            .forceLink(this.links)
            .distance((l) => (l.spoke ? 64 : 52) + 2.2 * (l.source.base + l.target.base))
            .strength((l) => (l.spoke ? 0.35 : 0.9) / Math.min(degreeOf(l.source), degreeOf(l.target))),
        )
        .force("charge", d3.forceManyBody().strength(n > 3000 ? -60 : n > 900 ? -100 : n > 200 ? -170 : n > 40 ? -230 : -300).theta(0.95).distanceMax(big ? 320 : n > 900 ? 480 : n > 40 ? 620 : 700))
        .force("collide", big ? null : d3.forceCollide((d) => d.base + 9).strength(0.75))
        // Each connected network is held around its own place; separate networks stay apart.
        .force("x", d3.forceX((d) => d.home.x).strength(pull))
        .force("y", d3.forceY((d) => d.home.y).strength(pull))
        .alphaDecay(1 - Math.pow(0.001, 1 / (n > 2000 ? 150 : n > 600 ? 200 : 260)))
        .velocityDecay(0.42)
        .alpha(alpha);
      this.decay = this.sim.alphaDecay();
      this.cool = null;
      this.pinned = null;
      this.dragging = false;
      this.firstLayout = true;
      this.settling = true;
      this.settleStart = performance.now();
      this.stats.ticks = 0;
      this.quad = null;
      this.schedule();
    }

    positions() {
      const map = new Map(this.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      map.signature = this.signature;
      return map;
    }

    /** Which nodes and edges show. Filtering never re-runs the layout, so nothing moves. */
    applyFilter(filter) {
      this.filter = filter;
      const nodeOk = filter?.node || (() => true);
      const linkOk = filter?.link || (() => true);
      const shown = new Set(this.nodes.filter(nodeOk).map((n) => n.id));
      this.visibleLinks = this.links.filter((l) => shown.has(l.source.id) && shown.has(l.target.id) && linkOk(l));
      const degree = new Map();
      for (const l of this.visibleLinks) {
        degree.set(l.source.id, (degree.get(l.source.id) || 0) + 1);
        degree.set(l.target.id, (degree.get(l.target.id) || 0) + 1);
      }
      this.visibleNodes = this.nodes.filter((n) => shown.has(n.id) && (filter?.isolated !== false || degree.has(n.id) || n.id === this.selected?.id));
      this.visibleIds = new Set(this.visibleNodes.map((n) => n.id));
      // Size follows what you can see, gently.
      for (const n of this.nodes) {
        n.shown = degree.get(n.id) || 0;
        n.r = this.baseRadius(n.shown, n.self);
      }
      this.linkAlpha = clamp(0.38 - 0.05 * Math.log2(1 + this.visibleLinks.length / 40), 0.13, 0.38);
      this.quad = null;
      this.schedule();
    }

    /* ── Camera ── */

    resize() {
      const box = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      this.w = Math.max(1, box.width);
      this.h = Math.max(1, box.height);
      this.dpr = dpr;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.schedule();
    }
    /** Parts of the canvas covered by floating panels; fitting and focusing avoid them. */
    setInsets(insets) {
      this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
    }
    safeRect() {
      const i = this.insets;
      return { x0: i.left, y0: i.top, x1: Math.max(i.left + 40, this.w - i.right), y1: Math.max(i.top + 40, this.h - i.bottom) };
    }
    toWorld(sx, sy) {
      return { x: (sx - this.w / 2) / this.cam.k + this.cam.x, y: (sy - this.h / 2) / this.cam.k + this.cam.y };
    }
    toScreen(x, y) {
      return { x: (x - this.cam.x) * this.cam.k + this.w / 2, y: (y - this.cam.y) * this.cam.k + this.h / 2 };
    }
    animateTo(target, ms = 420) {
      if (this.reduced() || ms <= 0) {
        Object.assign(this.cam, target);
        this.anim = null;
        this.opts.onCamera?.(this.cam);
        return this.schedule();
      }
      this.anim = { from: { ...this.cam }, to: { ...this.cam, ...target }, start: performance.now(), ms };
      this.schedule();
    }
    bounds(nodes = this.visibleNodes) {
      if (!nodes.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; // prettier-ignore
      for (const n of nodes) {
        x0 = Math.min(x0, n.x - n.r);
        y0 = Math.min(y0, n.y - n.r);
        x1 = Math.max(x1, n.x + n.r);
        y1 = Math.max(y1, n.y + n.r);
      }
      return { x0, y0, x1, y1 };
    }
    /** The camera that shows `nodes` inside the free area, with room for labels. */
    fitTarget(nodes) {
      const b = this.bounds(nodes);
      if (!b) return null;
      const s = this.safeRect();
      const pad = Math.min(90, Math.max(36, (s.x1 - s.x0) * 0.07));
      const bw = Math.max(80, b.x1 - b.x0);
      const bh = Math.max(80, b.y1 - b.y0);
      const k = clamp(Math.min((s.x1 - s.x0 - pad * 2) / bw, (s.y1 - s.y0 - pad * 2 - 22) / bh), 0.04, 2.4);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2 + 9 / k; // labels hang below the lowest entities
      return { k, x: cx - ((s.x0 + s.x1) / 2 - this.w / 2) / k, y: cy - ((s.y0 + s.y1) / 2 - this.h / 2) / k };
    }
    fit(ms = 520, nodes) {
      const target = this.fitTarget(nodes);
      if (target) this.animateTo(target, ms);
    }
    /** Bring a node to the centre of the free area; zoom in only if it is far out. */
    focus(id, { zoom = 1.5, ms = 520 } = {}) {
      const n = this.byId.get(id);
      if (!n) return;
      const k = Math.max(this.cam.k, zoom);
      const s = this.safeRect();
      this.animateTo({ k, x: n.x - ((s.x0 + s.x1) / 2 - this.w / 2) / k, y: n.y - ((s.y0 + s.y1) / 2 - this.h / 2) / k }, ms);
    }
    /** Show a node with everything it is visibly connected to, zooming in no further than `maxK`. */
    frameAround(id, { maxK = 1.6, ms = 520 } = {}) {
      const n = this.byId.get(id);
      if (!n) return;
      const group = [n];
      for (const l of this.visibleLinks) {
        if (l.source === n) group.push(l.target);
        else if (l.target === n) group.push(l.source);
      }
      const fit = this.fitTarget(group);
      if (!fit) return;
      const k = Math.min(fit.k, maxK);
      const s = this.safeRect();
      const at = (cx, cy) => ({ k, x: cx - ((s.x0 + s.x1) / 2 - this.w / 2) / k, y: cy - ((s.y0 + s.y1) / 2 - this.h / 2) / k });
      const b = this.bounds(group);
      const mid = at((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      // Keep the entity itself centred when everything it touches still fits that way.
      const centred = at(n.x, n.y);
      const half = { x: (s.x1 - s.x0) / 2 / k, y: (s.y1 - s.y0) / 2 / k };
      const fits = group.every((g) => Math.abs(g.x - n.x) < half.x * 0.9 && Math.abs(g.y - n.y) < half.y * 0.9);
      const target = fits ? centred : mid;
      this.animateTo(target, ms);
    }
    /** Move the camera only when a node is hidden or close to the edge of the free area. */
    ensureVisible(id) {
      const n = this.byId.get(id);
      if (!n) return false;
      const p = this.toScreen(n.x, n.y);
      const s = this.safeRect();
      const m = 70;
      if (p.x > s.x0 + m && p.x < s.x1 - m && p.y > s.y0 + m && p.y < s.y1 - m) return false;
      const k = this.cam.k;
      this.animateTo({ x: n.x - ((s.x0 + s.x1) / 2 - this.w / 2) / k, y: n.y - ((s.y0 + s.y1) / 2 - this.h / 2) / k }, 480);
      return true;
    }
    zoomBy(factor, sx = this.w / 2, sy = this.h / 2, ms = 140) {
      const base = this.anim ? this.anim.to : this.cam;
      const k = clamp(base.k * factor, 0.03, 6);
      const wx = (sx - this.w / 2) / base.k + base.x;
      const wy = (sy - this.h / 2) / base.k + base.y;
      this.animateTo({ k, x: wx - (sx - this.w / 2) / k, y: wy - (sy - this.h / 2) / k }, ms);
    }
    panBy(dx, dy) {
      this.anim = null;
      this.cam.x -= dx / this.cam.k;
      this.cam.y -= dy / this.cam.k;
      this.opts.onCamera?.(this.cam);
      this.schedule();
    }

    /* ── Selection ── */

    select(selection, { silent = false } = {}) {
      this.selected = selection;
      if (!silent) this.opts.onSelect?.(selection, this.selectionInfo(selection));
      this.schedule();
    }
    selectionInfo(sel) {
      if (!sel) return null;
      if (sel.type === "node") {
        const n = this.byId.get(sel.id);
        return n && { node: n, links: this.visibleLinks.filter((l) => l.source === n || l.target === n) };
      }
      const links = this.links.filter((l) => l.pair === sel.key);
      return links.length ? { links, a: links[0].source, b: links[0].target } : null;
    }
    focusSet() {
      const sel = this.hover || this.selected;
      if (!sel) return null;
      if (sel.type === "node") {
        const set = new Set([sel.id]);
        for (const l of this.visibleLinks) {
          if (l.source.id === sel.id) set.add(l.target.id);
          else if (l.target.id === sel.id) set.add(l.source.id);
        }
        return set;
      }
      return new Set(sel.key.split("|"));
    }

    /* ── Hit testing (targets never smaller than MIN_HIT pixels) ── */

    nodeAt(sx, sy) {
      const p = this.toWorld(sx, sy);
      const k = this.cam.k;
      if (!this.quad && !this.settling) this.quad = d3.quadtree(this.visibleNodes, (d) => d.x, (d) => d.y);
      let best = null;
      let bestD = Infinity;
      const consider = (n) => {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        const reach = Math.max(n.r * 1.25, MIN_HIT / k);
        if (d <= reach && d < bestD) {
          best = n;
          bestD = d;
        }
      };
      if (this.quad) {
        const r = MIN_HIT / k + 12;
        this.quad.visit((q, x0, y0, x1, y1) => {
          if (!q.length) do consider(q.data); while ((q = q.next));
          return x0 > p.x + r || x1 < p.x - r || y0 > p.y + r || y1 < p.y - r;
        });
      } else this.visibleNodes.forEach(consider);
      return best;
    }
    edgeAt(sx, sy) {
      const p = this.toWorld(sx, sy);
      const tol = 6 / this.cam.k;
      let best = null;
      let bestD = tol;
      for (const l of this.visibleLinks) {
        const pad = 0.3 * Math.hypot(l.target.x - l.source.x, l.target.y - l.source.y) + tol;
        if (p.x < Math.min(l.source.x, l.target.x) - pad || p.x > Math.max(l.source.x, l.target.x) + pad) continue;
        if (p.y < Math.min(l.source.y, l.target.y) - pad || p.y > Math.max(l.source.y, l.target.y) + pad) continue;
        const c = this.control(l);
        for (let i = 1; i < 12; i++) {
          const t = i / 12;
          const x = (1 - t) * (1 - t) * l.source.x + 2 * (1 - t) * t * c.x + t * t * l.target.x;
          const y = (1 - t) * (1 - t) * l.source.y + 2 * (1 - t) * t * c.y + t * t * l.target.y;
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < bestD) {
            bestD = d;
            best = l;
          }
        }
      }
      return best;
    }
    /** Control point: relationships arc gently; spokes are straight; several records fan out. */
    control(l) {
      const mx = (l.source.x + l.target.x) / 2;
      const my = (l.source.y + l.target.y) / 2;
      const dx = l.target.x - l.source.x;
      const dy = l.target.y - l.source.y;
      const len = Math.hypot(dx, dy) || 1;
      const flip = l.source.id < l.target.id ? 1 : -1;
      const bend = (l.spoke ? 0 : 0.09) + l.lane * 0.22;
      const off = bend * len * flip;
      return { x: mx - (dy / len) * off, y: my + (dx / len) * off };
    }
    /**
     * How a connection reads from the focused entity's side: the wording shown and the way
     * it points. A record is stored once (subject → type → object); read from the object's side
     * a directional type uses its inverse wording ("child of") and therefore points back to the
     * subject. With no entity in focus (a hovered or selected edge) it reads from the subject.
     * Wording and arrow both come from here, so they can never disagree.
     */
    reads(l, focusNode = null) {
      const directed = !l.symmetric;
      const reversed = directed && !!focusNode && l.target.id === focusNode && l.source.id !== focusNode;
      return {
        text: reversed ? l.inverse || l.label : l.label,
        directed,
        reversed,
        from: reversed ? l.target : l.source,
        to: reversed ? l.source : l.target,
      };
    }
    pointOn(l, t) {
      const c = this.control(l);
      return {
        x: (1 - t) * (1 - t) * l.source.x + 2 * (1 - t) * t * c.x + t * t * l.target.x,
        y: (1 - t) * (1 - t) * l.source.y + 2 * (1 - t) * t * c.y + t * t * l.target.y,
      };
    }

    /* ── Pointer and keyboard ── */

    bind() {
      const c = this.canvas;
      const pointers = new Map();
      let drag = null;
      const local = (e) => {
        const b = c.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };
      const down = (e) => {
        this.lastInput = performance.now();
        c.setPointerCapture?.(e.pointerId);
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          drag = { type: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), k: this.cam.k };
          return;
        }
        const p = local(e);
        const node = this.nodeAt(p.x, p.y);
        drag = { type: node ? "node" : "pan", node, start: p, last: p, moved: false };
      };
      const move = (e) => {
        this.lastInput = performance.now();
        const p = local(e);
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
        if (drag?.type === "pinch" && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const factor = Math.hypot(a.x - b.x, a.y - b.y) / drag.dist;
          this.zoomBy((drag.k * factor) / this.cam.k, (a.x + b.x) / 2, (a.y + b.y) / 2, 0);
          return;
        }
        if (drag) {
          if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4) drag.moved = true;
          if (!drag.moved) return;
          if (drag.type === "pan") {
            c.style.cursor = "grabbing";
            this.panBy(p.x - drag.last.x, p.y - drag.last.y);
          } else if (drag.type === "node") {
            const w = this.toWorld(p.x, p.y);
            if (!drag.held) this.hold(drag.node);
            drag.held = true;
            drag.node.fx = w.x;
            drag.node.fy = w.y;
            if (this.reduced()) Object.assign(drag.node, { x: w.x, y: w.y });
            this.quad = null;
            this.schedule();
          }
          drag.last = p;
          return;
        }
        const node = this.nodeAt(p.x, p.y);
        const edge = node ? null : this.edgeAt(p.x, p.y);
        const next = node ? { type: "node", id: node.id } : edge ? { type: "edge", key: edge.pair } : null;
        if ((next?.id || next?.key) !== (this.hover?.id || this.hover?.key)) {
          this.hover = next;
          c.style.cursor = next ? "pointer" : "grab";
          this.schedule();
        }
        this.opts.onHover?.(next, next && this.selectionInfo(next), p);
      };
      const up = (e) => {
        pointers.delete(e.pointerId);
        c.style.cursor = this.hover ? "pointer" : "grab";
        if (!drag) return;
        const p = local(e);
        if (drag.type === "node" && drag.moved) {
          const start = this.toWorld(drag.start.x, drag.start.y);
          this.release(drag.node, Math.hypot(drag.node.x - start.x, drag.node.y - start.y));
        } else if (!drag.moved && drag.type !== "pinch") {
          const node = this.nodeAt(p.x, p.y);
          const edge = node ? null : this.edgeAt(p.x, p.y);
          this.select(node ? { type: "node", id: node.id } : edge ? { type: "edge", key: edge.pair } : null);
        }
        drag = pointers.size ? drag : null;
      };
      const leave = () => {
        if (this.hover) {
          this.hover = null;
          this.schedule();
        }
        this.opts.onHover?.(null);
      };
      const wheel = (e) => {
        e.preventDefault();
        this.lastInput = performance.now();
        const p = local(e);
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoomBy(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y, 120);
      };
      const dbl = (e) => {
        const p = local(e);
        const node = this.nodeAt(p.x, p.y);
        if (node) this.opts.onOpen?.(node);
      };
      const key = (e) => {
        const step = 70;
        const k = e.key;
        if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
          e.preventDefault();
          this.panBy(k === "ArrowLeft" ? step : k === "ArrowRight" ? -step : 0, k === "ArrowUp" ? step : k === "ArrowDown" ? -step : 0);
        } else if (k === "+" || k === "=") this.zoomBy(1.3, undefined, undefined, 200);
        else if (k === "-" || k === "_") this.zoomBy(1 / 1.3, undefined, undefined, 200);
        else if (k === "0") this.fit();
        else if (k === "Escape" && this.selected) {
          e.stopPropagation();
          this.select(null);
        } else if (k === "Enter" && this.selected?.type === "node") this.opts.onOpen?.(this.byId.get(this.selected.id));
      };
      c.addEventListener("pointerdown", down);
      c.addEventListener("pointermove", move);
      c.addEventListener("pointerup", up);
      c.addEventListener("pointercancel", up);
      c.addEventListener("pointerleave", leave);
      c.addEventListener("wheel", wheel, { passive: false });
      c.addEventListener("dblclick", dbl);
      c.addEventListener("keydown", key);
      c.style.cursor = "grab";
      c.style.touchAction = "none";
      this.unbind = () => {
        c.removeEventListener("pointerdown", down);
        c.removeEventListener("pointermove", move);
        c.removeEventListener("pointerup", up);
        c.removeEventListener("pointercancel", up);
        c.removeEventListener("pointerleave", leave);
        c.removeEventListener("wheel", wheel);
        c.removeEventListener("dblclick", dbl);
        c.removeEventListener("keydown", key);
      };
    }

    /* ── Dragging: live physics, then a natural cool-down ── */

    /** A node is picked up: keep the simulation warm around it, without resetting anything. */
    hold(node) {
      if (this.pinned && this.pinned !== node) {
        this.pinned.fx = null;
        this.pinned.fy = null;
      }
      this.pinned = node;
      this.cool = null;
      this.dragging = true;
      this.opts.onHover?.(null); // the hover card would be left behind where the drag began
      if (this.reduced()) return; // the node follows the pointer; nothing else moves
      this.sim.alphaDecay(this.firstLayout ? this.decay : 0);
      this.sim.alphaTarget(DRAG_ALPHA);
      if (this.sim.alpha() < DRAG_ALPHA) this.sim.alpha(DRAG_ALPHA);
      this.settling = true;
      this.schedule();
    }
    /**
     * A node is let go where it was dropped. It stays pinned while its neighbours ease
     * around it, so it neither snaps back nor drifts; the cool-down is longer for bigger
     * disturbances (`moved`, in world units) and ends with a smooth exponential damping.
     */
    release(node, moved) {
      this.dragging = false;
      this.sim.alphaTarget(0);
      if (this.reduced()) {
        node.fx = null;
        node.fy = null;
        this.pinned = null;
        return;
      }
      if (this.firstLayout) {
        // Still arranging for the first time: let that finish as before.
        node.fx = null;
        node.fy = null;
        this.pinned = null;
        this.sim.alphaDecay(this.decay);
        return;
      }
      const d = clamp(moved / 300, 0, 1);
      const from = Math.max(0.02, Math.min(this.sim.alpha(), 0.05 + 0.08 * d));
      this.sim.alphaDecay(0).alpha(from);
      this.cool = { start: performance.now(), from, ms: 1000 + 2000 * d };
      this.settling = true;
      this.schedule();
    }
    /** The cool-down is over: unpin, restore the normal decay and stop ticking. */
    endCool() {
      this.cool = null;
      if (this.pinned) {
        this.pinned.fx = null;
        this.pinned.fy = null;
        this.pinned = null;
      }
      this.sim.alphaDecay(this.decay).alpha(0);
    }

    /* ── Frame loop: runs only while something changes ── */

    schedule() {
      if (!this.frame) this.frame = requestAnimationFrame(this.loop);
    }
    loop(now) {
      this.frame = 0;
      this.frames++;
      let again = false;
      if (this.settling && this.sim && (this.dragging || this.cool)) {
        // Live: exactly one tick per frame, so the motion is seen rather than skipped.
        let done = false;
        if (this.cool) {
          const t = (now - this.cool.start) / this.cool.ms;
          if (t >= 1) done = true;
          else this.sim.alpha(this.cool.from * Math.pow(COOL_END / this.cool.from, t));
        }
        if (done) {
          this.endCool();
          this.settling = false;
          this.quad = null;
          this.opts.onSettled?.(this.stats);
        } else {
          this.sim.tick();
          this.stats.ticks++;
          this.quad = null;
          again = true;
        }
      } else if (this.settling && this.sim) {
        // Arranging (first layout or new data): time-boxed batches, finished quickly.
        const idle = now - (this.lastInput || 0) > 400;
        const budget = this.reduced() ? 40 : idle ? 26 : 8;
        const t0 = performance.now();
        while (performance.now() - t0 < budget && this.sim.alpha() > this.sim.alphaMin()) {
          this.sim.tick();
          this.stats.ticks++;
        }
        if (this.sim.alpha() <= this.sim.alphaMin()) {
          this.settling = false;
          this.firstLayout = false;
          this.quad = null;
          this.stats.settleMs = performance.now() - this.settleStart;
          this.opts.onSettled?.(this.stats);
        } else again = true;
      }
      if (this.anim) {
        const t = clamp((now - this.anim.start) / this.anim.ms, 0, 1);
        const e = easeOut(t);
        const { from, to } = this.anim;
        this.cam.k = from.k * Math.pow(to.k / from.k, e);
        this.cam.x = from.x + (to.x - from.x) * e;
        this.cam.y = from.y + (to.y - from.y) * e;
        this.opts.onCamera?.(this.cam);
        if (t >= 1) this.anim = null;
        else again = true;
      }
      const dt = Math.min(64, now - (this.lastFrame || now));
      const target = this.focusSet() ? 1 : 0;
      if (this.mix !== target) {
        this.mix = this.reduced() ? target : clamp(this.mix + Math.sign(target - this.mix) * (dt / 140), 0, 1);
        if (this.mix !== target) again = true;
      }
      this.lastFrame = now;
      if (this.reduced() && this.settling) this.drawStatus();
      else if (this.draw(dt)) again = true;
      if (again) this.schedule();
    }

    drawStatus() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.fillStyle = "rgba(239,231,224,0.62)";
      ctx.font = "500 14px Roboto, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.opts.arrangingText || "Arranging…", this.w / 2, this.h / 2);
    }

    /** Draws a frame; returns true while labels are still fading, so another frame follows. */
    draw(dt = 16) {
      const t0 = performance.now();
      const ctx = this.ctx;
      const { k } = this.cam;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.save();
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(k, k);
      ctx.translate(-this.cam.x, -this.cam.y);
      const v0 = this.toWorld(0, 0);
      const v1 = this.toWorld(this.w, this.h);
      const margin = 40 / k;
      const inView = (n) => n.x > v0.x - margin && n.x < v1.x + margin && n.y > v0.y - margin && n.y < v1.y + margin;
      const focus = this.focusSet();
      const mix = this.mix;
      const lead = this.hover || this.selected;
      const focusNode = lead?.type === "node" ? lead.id : null;
      const focusEdge = lead?.type === "edge" ? lead.key : null;
      const selKey = this.selected?.type === "edge" ? this.selected.key : null;
      const dense = this.visibleNodes.length > 1500;

      // Connections: fine translucent lines in batches by colour, pattern and emphasis.
      const batches = new Map();
      const focused = [];
      const base = this.linkAlpha || 0.25;
      for (const l of this.visibleLinks) {
        if (!inView(l.source) && !inView(l.target)) continue;
        const touched = focusNode ? l.source.id === focusNode || l.target.id === focusNode : focusEdge ? l.pair === focusEdge : false;
        const level = selKey === l.pair ? 3 : touched ? 2 : focus ? 0 : 1;
        if (level >= 2) focused.push(l);
        const pattern = l.state === 1 ? "ended" : l.conf === 1 || l.conf === 2 || l.state === 2 ? "doubt" : "solid";
        const keyName = `${edgeColor(l)}|${pattern}|${level}`;
        let path = batches.get(keyName);
        if (!path) batches.set(keyName, (path = new Path2D()));
        path.moveTo(l.source.x, l.source.y);
        if (l.spoke && !l.lane) path.lineTo(l.target.x, l.target.y);
        else {
          const c = this.control(l);
          path.quadraticCurveTo(c.x, c.y, l.target.x, l.target.y);
        }
      }
      const alphaFor = (level, pattern) => {
        const a = level === 3 ? 0.95 : level === 2 ? 0.8 : level === 1 ? base * (focus ? 1 - 0.7 * mix : 1) : base * (1 - 0.75 * mix);
        return pattern === "ended" && level < 2 ? a * 0.8 : a;
      };
      ctx.lineCap = "round";
      for (const [keyName, path] of batches) {
        const [color, pattern, level] = keyName.split("|");
        const lv = +level;
        ctx.globalAlpha = alphaFor(lv, pattern);
        ctx.strokeStyle = color;
        ctx.lineWidth = (lv >= 2 ? 1.35 : dense ? 0.6 : 0.9) / k;
        ctx.setLineDash(pattern === "ended" ? [5 / k, 4.5 / k] : pattern === "doubt" ? [0.1 / k, 3.4 / k] : []);
        ctx.stroke(path);
      }
      ctx.setLineDash([]);
      // Direction: a small chevron on the connections in focus only. It points the way the
      // displayed wording reads ("Ukážka parent of Vzorko" → towards Vzorko; from Vzorko's side,
      // "Vzorko child of Ukážka" → towards Ukážka), never simply from subject to object.
      const arrows = [];
      if (focused.length && k > 0.35) {
        ctx.globalAlpha = 0.92;
        ctx.lineWidth = 1.4 / k;
        for (const l of focused) {
          const reading = this.reads(l, focusNode);
          if (!reading.directed) continue;
          arrows.push([reading.from.id, reading.to.id, reading.text]);
          const [ta, tb] = reading.reversed ? [0.43, 0.39] : [0.57, 0.61];
          const a = this.pointOn(l, ta);
          const b = this.pointOn(l, tb);
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const s = 4.4 / k;
          ctx.strokeStyle = edgeColor(l);
          ctx.beginPath();
          ctx.moveTo(b.x - s * Math.cos(ang - 0.62), b.y - s * Math.sin(ang - 0.62));
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b.x - s * Math.cos(ang + 0.62), b.y - s * Math.sin(ang + 0.62));
          ctx.stroke();
        }
      }
      this.stats.arrows = arrows;

      // Halos: soft light around cores, from cached sprites; skipped where too small to see.
      if (k > (dense ? 1.2 : 0.35)) {
        for (const n of this.visibleNodes) {
          if (!inView(n)) continue;
          const a = !focus || focus.has(n.id) ? 1 : 1 - 0.85 * mix;
          if (a < 0.05) continue;
          const size = n.r * 7;
          ctx.globalAlpha = a * (n.shown ? 1 : 0.55);
          ctx.drawImage(halo(KIND[n.kind].glow, 0.22), n.x - size / 2, n.y - size / 2, size, size);
        }
      }

      // Cores: crisp silhouettes, with a hairline of background for separation.
      const cores = new Map();
      const outlines = new Path2D();
      let selectedNode = null;
      const tiny = 1.6 / k;
      const points = this.visibleNodes.length > 3000; // only very large graphs fall back to plain points
      for (const n of this.visibleNodes) {
        if (!inView(n)) continue;
        const near = !focus || focus.has(n.id);
        const keyName = `${n.kind}|${near ? 1 : 0}`;
        let path = cores.get(keyName);
        if (!path) cores.set(keyName, (path = new Path2D()));
        const r = Math.max(n.r, tiny);
        if (points && r * k < 2.2) path.rect(n.x - r, n.y - r, r * 2, r * 2);
        else {
          shapePath(path, KIND[n.kind].shape, n.x, n.y, r);
          if (r * k > 3) shapePath(outlines, KIND[n.kind].shape, n.x, n.y, r);
        }
        if (this.selected?.type === "node" && this.selected.id === n.id) selectedNode = n;
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.4 / k;
      ctx.strokeStyle = HALO_DARK;
      ctx.stroke(outlines);
      for (const [keyName, path] of cores) {
        const [kind, near] = keyName.split("|");
        ctx.globalAlpha = near === "1" ? 1 : 1 - 0.8 * mix;
        if (kind === "g") {
          // Groups are hollow: a fine ring with a faint fill, so they read as collections.
          ctx.fillStyle = "rgba(179,195,158,0.2)";
          ctx.fill(path);
          ctx.lineWidth = 1.6 / k;
          ctx.strokeStyle = KIND.g.color;
          ctx.stroke(path);
        } else {
          ctx.fillStyle = KIND[kind].color;
          ctx.fill(path);
        }
      }
      // @me: a fine copper orbit.
      for (const n of this.visibleNodes) {
        if (!n.self || !inView(n)) continue;
        ctx.globalAlpha = !focus || focus.has(n.id) ? 0.95 : 0.35;
        ctx.strokeStyle = COPPER;
        ctx.lineWidth = 1.1 / k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      const ring = (n, color, gap, width, alpha) => {
        const p = new Path2D();
        shapePath(p, KIND[n.kind].shape, n.x, n.y, n.r + gap);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width / k;
        ctx.strokeStyle = color;
        ctx.stroke(p);
      };
      if (this.hover?.type === "node" && this.hover.id !== this.selected?.id) {
        const n = this.byId.get(this.hover.id);
        if (n && this.visibleIds.has(n.id)) ring(n, `rgb(${LABEL})`, 3.2, 1.1, 0.75);
      }
      if (selectedNode) {
        const size = selectedNode.r * 10;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(halo([196, 134, 99], 0.42), selectedNode.x - size / 2, selectedNode.y - size / 2, size, size);
        ring(selectedNode, COPPER_HI, 4.4, 1.5, 1);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      const fading = this.drawLabels(focus, inView, focused, focusNode, dt);
      this.stats.lastDrawMs = performance.now() - t0;
      return fading;
    }

    /** Labels in screen space on a collision grid, fading in and out rather than popping. */
    drawLabels(focus, inView, focused, focusNode, dt) {
      const ctx = this.ctx;
      const { k } = this.cam;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      // Exact rectangle tests, bucketed on a coarse grid for speed.
      const cell = 48;
      const grid = new Map();
      const rects = [];
      const boxes = [];
      const cells = (x0, y0, x1, y1, fn) => {
        for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) if (fn(gx * 100003 + gy) === false) return false;
        return true;
      };
      const free = (x0, y0, x1, y1) =>
        cells(x0, y0, x1, y1, (key) => {
          for (const i of grid.get(key) || []) {
            const r = rects[i];
            if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false;
          }
        });
      const take = (x0, y0, x1, y1) => {
        const i = rects.push([x0, y0, x1, y1]) - 1;
        cells(x0, y0, x1, y1, (key) => {
          const list = grid.get(key);
          list ? list.push(i) : grid.set(key, [i]);
        });
      };
      // Reserve the cores so labels never sit on other entities, where the graph is sparse
      // enough for that to matter; in a dense sky the label's dark outline separates it.
      if (this.visibleNodes.length <= 400)
        for (const n of this.visibleNodes) {
          if (!inView(n)) continue;
          const p = this.toScreen(n.x, n.y);
          const r = Math.max(2, n.r * k) - 1;
          take(p.x - r, p.y - r, p.x + r, p.y + r);
        }
      // Relationship wording on the connections in focus, read from the focused side.
      const edgeLead = (this.hover || this.selected)?.type === "edge";
      const worded = focused.filter((l) => edgeLead || (focused.length <= 8 && (!l.spoke || focused.length <= 4)));
      this.stats.words = []; // [from id, to id, wording] for each connection worded this frame
      const words = () => {
        if (!worded.length || k <= 0.5) return;
        ctx.font = "500 11px Roboto, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        for (const l of worded) {
          const reading = this.reads(l, focusNode);
          let { text } = reading;
          if (!text) continue;
          this.stats.words.push([reading.from.id, reading.to.id, text]);
          if (l.state === 1) text += " · ended";
          else if (l.conf === 2 || l.conf === 1) text += " · uncertain";
          const w = ctx.measureText(text).width;
          // Parallel records share a midpoint; slide along the curve before giving up.
          let p = null;
          let box = null;
          for (const at of [0.5, 0.36, 0.64]) {
            const m = this.pointOn(l, at);
            const q = this.toScreen(m.x, m.y);
            const r = [q.x - w / 2 - 4, q.y - 7, q.x + w / 2 + 4, q.y + 7];
            if (free(...r)) {
              p = q;
              box = r;
              break;
            }
          }
          if (!p) continue;
          take(...box);
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = 4;
          ctx.strokeStyle = HALO_DARK;
          ctx.strokeText(text, p.x, p.y);
          ctx.fillStyle = edgeColor(l);
          ctx.fillText(text, p.x, p.y);
        }
      };
      // Entity names. Selected and hovered always; neighbours of the focus; otherwise the
      // best-connected first, within a budget that follows the canvas area, so a large graph
      // reads as a calm sky and a small one is fully named. A visible label keeps a small
      // lead, so names do not flicker as you pan.
      ctx.textBaseline = "top";
      const sel = this.selected?.type === "node" ? this.selected.id : null;
      const hov = this.hover?.type === "node" ? this.hover.id : null;
      // A connection in focus always names both of its ends.
      const ends = new Set(edgeLead ? focused.flatMap((l) => [l.source.id, l.target.id]) : []);
      const many = this.visibleNodes.length > 60;
      const budget = clamp(Math.floor((this.w * this.h) / (many ? 30000 : 14000)), 10, 260);
      const want = [];
      for (const n of this.visibleNodes) {
        if (!inView(n)) continue;
        const forced = n.id === sel || n.id === hov || ends.has(n.id);
        const neighbour = !!focus?.has(n.id);
        if (!forced && focus && !neighbour) {
          if (this.labelAlpha.get(n.id)) want.push({ n, forced, neighbour, rank: -1, eligible: false });
          continue;
        }
        const big = n.r * k >= 2.1 && (!many || n.shown >= 2 || n.r * k >= 6);
        const shownBefore = (this.labelAlpha.get(n.id) || 0) > 0.5;
        want.push({ n, forced, neighbour, eligible: forced || neighbour || big, rank: forced ? 1e9 : neighbour ? 1e6 + n.shown : n.shown * 10 + n.r + (shownBefore ? 6 : 0) });
      }
      want.sort((a, b) => b.rank - a.rank);
      let fading = false;
      let drawn = 0;
      let general = 0;
      const step = this.reduced() ? 1 : dt / 170;
      const seen = new Set();
      let wordsPlaced = false;
      for (const { n, forced, neighbour, eligible } of want) {
        // Forced names come first (highest rank) and claim their space; then the wording.
        if (!forced && !wordsPlaced) {
          wordsPlaced = true;
          words();
          ctx.textBaseline = "top";
        }
        seen.add(n.id);
        let a = this.labelAlpha.get(n.id) || 0;
        const hub = n.shown > 5;
        const size = forced ? 13 : hub ? 12.5 : 11.5;
        const weight = forced || hub ? 600 : 500;
        ctx.font = `${weight} ${size}px Roboto, system-ui, sans-serif`;
        const text = n.label.length > 30 ? n.label.slice(0, 29) + "…" : n.label;
        const wkey = `${weight}|${size}|${text}`;
        let w = this.widths.get(wkey);
        if (w === undefined) this.widths.set(wkey, (w = ctx.measureText(text).width));
        const p = this.toScreen(n.x, n.y);
        const y = p.y + Math.max(3, n.r * k * (n.kind === "o" ? 1.22 : 1.1)) + 5;
        const box = [p.x - w / 2 - 3, y - 1, p.x + w / 2 + 3, y + size + 2];
        const room = forced || ((neighbour || general < budget) && free(...box));
        const goal = eligible && room ? 1 : 0;
        if (goal && !forced && !neighbour) general++;
        a = a < goal ? Math.min(goal, a + step) : Math.max(goal, a - step);
        if (Math.abs(a - goal) > 0.01) fading = true;
        this.labelAlpha.set(n.id, a);
        if (a < 0.02) continue;
        take(...box);
        if (goal) boxes.push(box);
        ctx.globalAlpha = a;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = HALO_DARK;
        ctx.strokeText(text, p.x, y);
        ctx.fillStyle = n.id === sel ? COPPER_HI : `rgba(${LABEL},${forced || hub || neighbour ? 0.97 : 0.82})`;
        ctx.fillText(text, p.x, y);
        drawn++;
      }
      if (!wordsPlaced) words();
      for (const id of this.labelAlpha.keys()) if (!seen.has(id)) this.labelAlpha.delete(id);
      this.stats.labels = drawn;
      this.stats.labelBoxes = boxes;
      ctx.globalAlpha = 1;
      return fading;
    }
  }

  global.MeridianGraph = { Engine, KIND, CATEGORY, packComponents, MIN_HIT };
})(window);
