// Individual project — a redesign of Figure 2.1 of the World Happiness Report
// 2026 ("Country rankings by life evaluations").
//
// Four linked views replace the three pages of stacked bars:
//
//   1. Beeswarm — all 147 life evaluations on one axis. Country A is the ink
//      dot, country B the hollow ring, and the countries inside A's plausible
//      rank range are tinted: the ones A could trade places with.
//   2. Waterfall, A beside B — the report's decomposition as steps from a
//      benchmark to the actual score. Steps go right (blue, raises the
//      predicted score) or left (red, lowers it), and the residual is a step of
//      its own, so the pieces still add up to the score but nothing can
//      overshoot it.
//   3. Factor strips — every country on each factor, on one shared scale of
//      ladder points, so the width of a cloud shows how much a factor varies.
//   4. Ranked list — the lookup table the original was, in one list.
//
// Clicking a country in any view makes it A. The benchmark is switchable:
// "average" measures each factor from its mean across countries, "dystopia"
// from the report's own zero, the world's lowest value of that factor.
//
// Every SVG fill, stroke and font size is set here as an attribute rather than
// left to the stylesheet, so a stale cached stylesheet cannot paint the charts
// black (an SVG shape with no fill defaults to black).

// ---------------------------------------------------------------- constants --

const DYSTOPIA = 1.16;   // Dystopia's ladder score, from the figure's legend

const FACTORS = [
    { key: "gdp", name: "GDP per capita", short: "GDP" },
    { key: "social", name: "Social support", short: "social support" },
    { key: "health", name: "Healthy life expectancy", short: "health" },
    { key: "freedom", name: "Freedom to make life choices", short: "freedom" },
    { key: "generosity", name: "Generosity", short: "generosity" },
    { key: "corruption", name: "Low perceived corruption", short: "corruption" }
];

const RESIDUAL = { key: "residual", name: "Unexplained (residual)" };

// Values the report publishes but that should not be read at face value.
const DOUBTFUL = {
    "Venezuela": {
        cells: ["gdp", "residual"],
        note: "GDP per capita is listed at $89 in the report's Statistical Appendix " +
            "(next lowest: Yemen, $917). The GDP step and the large residual both rest on that value."
    }
};

const START = { a: "Uzbekistan", b: "China" };

// Blue / red is the only data colour pair: direction (validated, CVD ΔE 21.6,
// both ≥ 3:1 on white). Identity of A and B is carried by filled dot versus
// hollow ring plus a printed name, never by hue.
const UP = "#2a78d6";
const DOWN = "#e34948";
const INK = "#0b0b0b";
const INK_SOFT = "#52514e";
const MUTED = "#898781";
const RULE = "#c3c2b7";
const GRID = "#ecebe6";
const DOT = "#b9b7af";
const PEER = "#86b6ef";
const SURFACE = "#ffffff";

const MAIN_W = 876;      // viewBox width of the waterfall and the strips
const LABEL_W = 192;     // their shared row-label column

const fmt3 = d3.format(".3f");
const fmt2 = d3.format(".2f");
const signed = v => (v < 0 ? "−" : "+") + fmt2(Math.abs(v));
const ordinal = n => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ---------------------------------------------------------------- svg helper --

// A text element with its type set as attributes, not through CSS.
function label(sel, { size = 12, weight = "normal", fill = INK, anchor = "start", halo = false } = {}) {
    const t = sel.append("text")
        .attr("font-size", size)
        .attr("font-weight", weight)
        .attr("fill", fill)
        .attr("text-anchor", anchor);
    if (halo) {
        t.attr("stroke", SURFACE).attr("stroke-width", 3).attr("paint-order", "stroke");
    }
    return t;
}

// ---------------------------------------------------------------- tooltip --

const tooltip = d3.select("#tooltip");

// Names come out of a CSV, so they are inserted as text, never as markup.
function showTip(event, title, rows, note) {
    const node = tooltip.node();
    node.textContent = "";

    const head = document.createElement("div");
    head.className = "tip-head";
    head.textContent = title;
    node.appendChild(head);

    for (const [key, value, colour] of rows) {
        const line = document.createElement("div");
        line.className = "tip-row";

        if (colour) {
            const mark = document.createElement("span");
            mark.className = "tip-line";
            mark.style.background = colour;
            line.appendChild(mark);
        }

        const k = document.createElement("span");
        k.className = "tip-key";
        k.textContent = `${key} `;

        const v = document.createElement("strong");
        v.textContent = value;

        line.append(k, v);
        node.appendChild(line);
    }

    if (note) {
        const foot = document.createElement("div");
        foot.className = "tip-note";
        foot.textContent = note;
        node.appendChild(foot);
    }

    tooltip.style("opacity", 1);
    moveTip(event);
}

// Flip to the other side of the pointer near the right and bottom edges.
function moveTip(event) {
    const box = tooltip.node().getBoundingClientRect();
    const flipX = event.clientX + 16 + box.width > window.innerWidth;
    const flipY = event.clientY + 16 + box.height > window.innerHeight;
    const x = event.clientX + window.scrollX;
    const y = event.clientY + window.scrollY;

    tooltip
        .style("left", `${flipX ? x - box.width - 14 : x + 14}px`)
        .style("top", `${flipY ? y - box.height - 10 : y + 14}px`);
}

function hideTip() {
    tooltip.style("opacity", 0);
}

// ---------------------------------------------------------------- data --

d3.csv("../data/redesign_whr2026.csv", d3.autoType).then(rows => {
    for (const d of rows) {
        d.missing = d.missing ? String(d.missing).split(";") : [];
        d.complete = d.missing.length === 0;
        d.doubtful = DOUBTFUL[d.country] || null;
    }

    // Means over the 145 countries with all six factors, so that for each of
    // them  score = average baseline + Σ(centred factors) + residual  exactly.
    const complete = rows.filter(d => d.complete);
    const mean = Object.fromEntries(FACTORS.map(f => [f.key, d3.mean(complete, d => d[f.key])]));
    mean.residual = 0;

    const baseline = {
        average: DYSTOPIA + d3.sum(FACTORS, f => mean[f.key]),
        dystopia: DYSTOPIA
    };

    // Rank on each factor, for the strip tooltips.
    const factorRank = {};
    for (const f of [...FACTORS, RESIDUAL]) {
        const sorted = rows.filter(d => d[f.key] != null).sort((a, b) => b[f.key] - a[f.key]);
        factorRank[f.key] = { n: sorted.length, of: new Map(sorted.map((d, i) => [d.country, i + 1])) };
    }

    const ctx = {
        rows,
        byName: new Map(rows.map(d => [d.country, d])),
        mean,
        baseline,
        factorRank,
        state: {
            a: rows.find(d => d.country === START.a),
            b: rows.find(d => d.country === START.b),
            region: "all",
            mode: "average"
        }
    };

    // The value a view draws for a factor in the current mode.
    ctx.value = (d, key) => d[key] == null ? null
        : d[key] - (ctx.state.mode === "average" ? mean[key] : 0);

    ctx.isDoubtful = (d, key) => !!(d.doubtful && d.doubtful.cells.includes(key));

    build(ctx);
});

// ---------------------------------------------------------------- wiring --

function build(ctx) {
    const { rows, state } = ctx;

    const views = [
        drawOverview(ctx),
        drawWaterfall(ctx),
        drawStrips(ctx),
        drawList(ctx)
    ];

    ctx.update = (duration = 600) => {
        d3.select("#pick-a").property("value", state.a.country);
        d3.select("#pick-b").property("value", state.b ? state.b.country : "");
        d3.selectAll("#baseline-set button")
            .classed("active", function () { return this.dataset.mode === state.mode; });
        writeSummary(ctx);
        writeKey(ctx);
        for (const v of views) v.update(duration);
    };

    ctx.setA = d => {
        if (!d || d === state.a) return;
        if (state.b === d) state.b = state.a;   // picking B as A swaps them
        state.a = d;
        ctx.update();
    };

    // ------------------------------------------------------------ controls --

    d3.select("#country-list")
        .selectAll("option")
        .data(rows.map(d => d.country).sort(d3.ascending))
        .join("option")
        .attr("value", d => d);

    const find = text => {
        const q = text.trim().toLowerCase();
        if (!q) return null;
        const exact = rows.find(d => d.country.toLowerCase() === q);
        if (exact) return exact;
        const hits = rows.filter(d => d.country.toLowerCase().includes(q));
        return hits.length === 1 ? hits[0] : null;
    };

    // Typing selects the whole field first, so a new name replaces the old one.
    d3.selectAll("#pick-a, #pick-b").on("focus", function () { this.select(); });

    d3.select("#pick-a").on("change", function () {
        const d = find(this.value);
        if (d) ctx.setA(d);
        else this.value = state.a.country;
    });

    d3.select("#pick-b").on("change", function () {
        if (!this.value.trim()) {
            state.b = null;
            ctx.update();
            return;
        }
        const d = find(this.value);
        if (d && d !== state.a) {
            state.b = d;
            ctx.update();
        } else {
            this.value = state.b ? state.b.country : "";
        }
    });

    d3.select("#swap").on("click", () => {
        if (!state.b) return;
        [state.a, state.b] = [state.b, state.a];
        ctx.update();
    });

    const regions = d3.rollups(rows, v => v.length, d => d.region)
        .sort((a, b) => d3.ascending(a[0], b[0]));

    d3.select("#region-filter")
        .selectAll("option")
        .data([["all", rows.length], ...regions])
        .join("option")
        .attr("value", d => d[0])
        .text(d => d[0] === "all" ? `All regions (${d[1]})` : `${d[0]} (${d[1]})`);

    d3.select("#region-filter").on("change", function () {
        state.region = this.value;
        ctx.update(300);
    });

    d3.selectAll("#baseline-set button").on("click", function () {
        state.mode = this.dataset.mode;
        ctx.update(800);
    });

    drawTable(rows);
    ctx.update(0);
}

// ---------------------------------------------------------------- text --

function writeSummary(ctx) {
    const { a } = ctx.state;
    const peers = ctx.rows.filter(d => d !== a && d.rank >= a.rank_lo && d.rank <= a.rank_hi).length;
    const node = document.getElementById("overview-summary");
    node.textContent = "";

    const name = document.createElement("strong");
    name.textContent = a.country;

    const rest = document.createElement("span");
    rest.textContent = a.rank_lo === a.rank_hi
        ? ` ranks ${ordinal(a.rank)} of 147 with ${fmt3(a.score)}, and its 95% rank range ` +
          "contains no other position."
        : ` ranks ${ordinal(a.rank)} of 147 with ${fmt3(a.score)}, but allowing for sampling ` +
          `error it could rank anywhere from ${ordinal(a.rank_lo)} to ${ordinal(a.rank_hi)}. ` +
          `The ${peers} blue dots are the countries it could plausibly trade places with.`;

    node.append(name, rest);
}

function writeKey(ctx) {
    const { a, b, mode } = ctx.state;
    const base = fmt2(ctx.baseline[mode]);

    d3.select("#equation").text(mode === "average"
        ? `Each panel starts from the average country's predicted score (${base}), adds or ` +
          "subtracts each of the six factors, then the part the six factors do not explain, " +
          "and ends at the country's actual life evaluation."
        : `Each panel starts from Dystopia (${base}), the report's imaginary country with the ` +
          "world's lowest value of every factor. Every factor can only add from there, which " +
          "is why the report's sub-bars are all positive.");

    const items = [
        { glyph: "a", text: a.country },
        ...(b ? [{ glyph: "b", text: b.country }] : []),
        { swatch: UP, text: mode === "average" ? "raises the predicted score" : "adds to the predicted score" },
        { swatch: DOWN, text: mode === "average" ? "lowers it" : "less happy than predicted (residual only)" },
        { hatch: true, text: "doubtful, or includes a missing factor" }
    ];

    const li = d3.select("#wf-key").selectAll("li")
        .data(items)
        .join("li");
    li.selectAll("*").remove();

    li.each(function (d) {
        const el = d3.select(this);
        if (d.glyph) el.append("span").attr("class", `pick-glyph ${d.glyph}`);
        if (d.swatch) el.append("span").attr("class", "swatch").style("background", d.swatch);
        if (d.hatch) el.append("span").attr("class", "swatch hatch");
        el.append("span").text(d.text);
    });
}

// ---------------------------------------------------------------- overview --

// A beeswarm of all 147 scores on one axis: the crowded top, the long tail at
// the bottom, and where A sits among the countries it is statistically tied with.
function drawOverview(ctx) {
    const { rows, state } = ctx;
    const W = 1180;
    const H = 216;
    const midY = 104;
    const axisY = 170;

    const x = d3.scaleLinear().domain([1, 8]).range([16, W - 16]);

    const svg = d3.select("#overview").classed("loading", false).text("")
        .append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", "Beeswarm of the 147 life evaluations. The top 20 countries lie " +
            "within 0.94 points of each other; the bottom 20 spread over 2.86 points.");

    const nodes = rows.map(d => ({ d, x: x(d.score), y: midY }));
    const sim = d3.forceSimulation(nodes)
        .force("x", d3.forceX(n => x(n.d.score)).strength(1))
        .force("y", d3.forceY(midY).strength(0.07))
        .force("collide", d3.forceCollide(5))
        .stop();
    for (let i = 0; i < 260; i++) sim.tick();

    // Axis, drawn by hand so it owns its colours.
    svg.append("line")
        .attr("x1", x(1)).attr("x2", x(8))
        .attr("y1", axisY).attr("y2", axisY)
        .attr("stroke", RULE);

    for (const v of d3.range(1, 9)) {
        svg.append("line")
            .attr("x1", x(v)).attr("x2", x(v))
            .attr("y1", axisY).attr("y2", axisY + 5)
            .attr("stroke", RULE);
        label(svg, { size: 12, fill: INK_SOFT, anchor: "middle" })
            .attr("x", x(v)).attr("y", axisY + 19)
            .text(v);
    }

    label(svg, { size: 12, fill: INK_SOFT, anchor: "middle" })
        .attr("x", W / 2).attr("y", H - 4)
        .text("Life evaluation, 0–10 ladder, averaged over 2023–2025");

    // Spread brackets for the top and bottom 20.
    const byRank = [...rows].sort((p, q) => p.rank - q.rank);
    for (const [group, name] of [[byRank.slice(0, 20), "Top 20"], [byRank.slice(-20), "Bottom 20"]]) {
        const lo = d3.min(group, d => d.score);
        const hi = d3.max(group, d => d.score);
        svg.append("path")
            .attr("d", `M${x(lo)},24V18H${x(hi)}V24`)
            .attr("fill", "none")
            .attr("stroke", MUTED);
        label(svg, { size: 12, fill: INK_SOFT, anchor: "middle" })
            .attr("x", (x(lo) + x(hi)) / 2).attr("y", 13)
            .text(`${name} span ${fmt2(hi - lo)} points`);
    }

    const dots = svg.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("cx", n => n.x)
        .attr("cy", n => n.y)
        .attr("r", 4.3)
        .attr("stroke", SURFACE)
        .attr("stroke-width", 1.2);

    const callouts = svg.append("g");

    // Nearest-dot hover, so the pointer only has to be close to an 8px dot.
    const delaunay = d3.Delaunay.from(nodes, n => n.x, n => n.y);
    const ring = svg.append("circle")
        .attr("r", 7.5)
        .attr("fill", "none")
        .attr("stroke", INK)
        .attr("stroke-width", 1.5)
        .attr("opacity", 0)
        .attr("pointer-events", "none");

    const nearest = event => {
        const [mx, my] = d3.pointer(event, svg.node());
        const n = nodes[delaunay.find(mx, my)];
        return Math.hypot(n.x - mx, n.y - my) < 14 ? n : null;
    };

    svg.append("rect")
        .attr("width", W)
        .attr("height", axisY)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .on("pointermove", event => {
            const n = nearest(event);
            if (!n) {
                ring.attr("opacity", 0);
                hideTip();
                return;
            }
            ring.attr("cx", n.x).attr("cy", n.y).attr("opacity", 1);
            showTip(event, n.d.country, [
                ["Rank", `${n.d.rank} (plausibly ${n.d.rank_lo}–${n.d.rank_hi})`],
                ["Life evaluation", fmt3(n.d.score)]
            ], `${n.d.region} · click to make it country A`);
        })
        .on("pointerleave", () => {
            ring.attr("opacity", 0);
            hideTip();
        })
        .on("click", event => {
            const n = nearest(event);
            if (n) ctx.setA(n.d);
        });

    function update() {
        const { a, b, region } = state;
        const inRegion = d => region === "all" || d.region === region;
        const peer = d => d !== a && d.rank >= a.rank_lo && d.rank <= a.rank_hi;

        dots
            .attr("fill", n => n.d === a ? INK : n.d === b ? SURFACE
                : peer(n.d) ? PEER : inRegion(n.d) ? (region === "all" ? DOT : INK_SOFT) : "#e6e5e0")
            .attr("stroke", n => n.d === b ? INK : SURFACE)
            .attr("stroke-width", n => n.d === b ? 2 : 1.2)
            .attr("r", n => n.d === a || n.d === b ? 6 : 4.3);

        dots.filter(n => n.d === a || n.d === b).raise();

        // A is labelled above the swarm, B below, so the two never collide.
        const marked = [a, b].filter(Boolean).map((d, i) => ({ d, n: nodes.find(n => n.d === d), up: i === 0 }));

        callouts.selectAll("g")
            .data(marked, m => m.up ? "a" : "b")
            .join(enter => {
                const g = enter.append("g");
                g.append("line").attr("stroke", INK).attr("stroke-width", 1);
                label(g, { size: 12.5, weight: "bold", anchor: "middle", halo: true });
                return g;
            })
            .each(function (m) {
                const g = d3.select(this);
                const ly = m.up ? 44 : 156;
                g.select("line")
                    .attr("x1", m.n.x).attr("x2", m.n.x)
                    .attr("y1", m.up ? m.n.y - 7 : m.n.y + 7)
                    .attr("y2", m.up ? ly + 4 : ly - 13);
                g.select("text")
                    .attr("x", m.n.x)
                    .attr("y", ly)
                    .text(`${m.d.country} ${fmt3(m.d.score)}`);
            });
    }

    return { update };
}

// ---------------------------------------------------------------- waterfall --

// The original stacks one country's seven pieces into a single bar. Here the
// same pieces become steps, each on its own row, from a benchmark to the score.
function drawWaterfall(ctx) {
    const { state } = ctx;
    const ROW_H = 30;
    const BAR_H = 14;
    const TOP = 92;
    const GAP = 30;
    const N_ROWS = 9;          // start, six factors, unexplained, end
    const H = TOP + N_ROWS * ROW_H + 40;
    const panelW = (MAIN_W - LABEL_W - GAP) / 2;
    const rowY = i => TOP + i * ROW_H + ROW_H / 2;

    const svg = d3.select("#waterfall").classed("loading", false).text("")
        .append("svg")
        .attr("viewBox", `0 0 ${MAIN_W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", "Waterfall charts for the two selected countries: from the " +
            "benchmark score, each of the six factors and the unexplained residual, " +
            "step by step, to the actual life evaluation.");

    // Hatches for doubtful values and for steps that absorb a missing factor.
    const defs = svg.append("defs");
    for (const [id, colour] of [["hatch-up", UP], ["hatch-down", DOWN], ["hatch-grey", MUTED]]) {
        const p = defs.append("pattern")
            .attr("id", id)
            .attr("width", 4).attr("height", 4)
            .attr("patternUnits", "userSpaceOnUse")
            .attr("patternTransform", "rotate(45)");
        p.append("rect").attr("width", 4).attr("height", 4).attr("fill", colour).attr("opacity", 0.22);
        p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 4)
            .attr("stroke", colour).attr("stroke-width", 2);
    }

    // Zebra bands behind alternate rows, and the row labels.
    for (let i = 1; i <= 7; i += 2) {
        svg.append("rect")
            .attr("x", 0).attr("y", TOP + i * ROW_H)
            .attr("width", MAIN_W).attr("height", ROW_H)
            .attr("fill", "#f7f7f4");
    }

    svg.append("line")
        .attr("x1", 0).attr("x2", MAIN_W)
        .attr("y1", TOP + 8 * ROW_H).attr("y2", TOP + 8 * ROW_H)
        .attr("stroke", RULE);

    const rowNames = ["", ...FACTORS.map(f => f.name), "Unexplained", "Life evaluation"];
    const rowLabels = svg.append("g").selectAll("text")
        .data(rowNames)
        .join(enter => label(enter, { size: 12.5, anchor: "end" }))
        .attr("x", LABEL_W - 12)
        .attr("y", (d, i) => rowY(i))
        .attr("dy", "0.35em")
        .attr("font-weight", (d, i) => i === 0 || i === 8 ? "bold" : "normal")
        .text(d => d);

    const panels = [0, 1].map(i => makePanel(LABEL_W + i * (panelW + GAP), i === 0 ? "a" : "b"));

    function makePanel(x0, which) {
        const g = svg.append("g");
        const body = g.append("g");
        const p = { x0, which, body };

        p.glyph = body.append("circle").attr("cx", x0 + 6).attr("cy", 13).attr("r", 5.5)
            .attr("fill", which === "a" ? INK : SURFACE)
            .attr("stroke", INK).attr("stroke-width", 2);
        p.title = label(body, { size: 15, weight: "bold" }).attr("x", x0 + 18).attr("y", 18);
        p.sub = label(body, { size: 12, fill: INK_SOFT }).attr("x", x0).attr("y", 38);
        p.lift = label(body, { size: 12, fill: INK_SOFT }).attr("x", x0).attr("y", 57);
        p.drag = label(body, { size: 12, fill: INK_SOFT }).attr("x", x0).attr("y", 74);

        p.grid = body.append("g");
        p.base = body.append("line").attr("stroke", RULE).attr("stroke-width", 1.5);
        p.connectors = body.append("g");
        p.bars = body.append("g");
        p.values = body.append("g");
        p.startMark = body.append("rect").attr("width", 3).attr("height", BAR_H + 4)
            .attr("fill", MUTED).attr("y", rowY(0) - BAR_H / 2 - 2);
        p.startText = label(body, { size: 12, fill: INK_SOFT }).attr("y", rowY(0)).attr("dy", "0.35em");
        p.ci = body.append("line").attr("stroke", INK_SOFT).attr("stroke-width", 1.5)
            .attr("y1", rowY(8)).attr("y2", rowY(8));
        p.endDot = body.append("circle").attr("cy", rowY(8)).attr("r", 6)
            .attr("fill", which === "a" ? INK : SURFACE)
            .attr("stroke", which === "a" ? SURFACE : INK).attr("stroke-width", 2);
        p.endText = label(body, { size: 13, weight: "bold" }).attr("y", rowY(8)).attr("dy", "0.35em");
        p.axis = body.append("g");
        p.empty = label(g, { size: 13, fill: MUTED, anchor: "middle" })
            .attr("x", x0 + panelW / 2).attr("y", rowY(4))
            .text("Choose a country to compare");

        return p;
    }

    // One country's steps in the current mode. A missing factor adds nothing
    // here, so its effect ends up inside the last step, which is then hatched.
    function stepsFor(d) {
        const base = ctx.baseline[state.mode];
        let t = base;
        const steps = [];

        for (const f of FACTORS) {
            const v = ctx.value(d, f.key);
            if (v == null) {
                steps.push({ key: f.key, name: f.name, missing: true, from: t, to: t });
                continue;
            }
            steps.push({ key: f.key, name: f.name, v, from: t, to: t + v, hatch: ctx.isDoubtful(d, f.key) });
            t += v;
        }

        steps.push({
            key: "residual",
            name: "Unexplained",
            v: d.complete ? d.residual : d.score - t,
            from: t,
            to: d.score,
            hatch: ctx.isDoubtful(d, "residual"),
            absorbs: d.complete ? null : FACTORS.filter(f => d.missing.includes(f.key)).map(f => f.short)
        });

        return { base, steps };
    }

    function update(duration) {
        const { a, b, mode } = state;
        const plans = [a, b].map(d => d ? { d, ...stepsFor(d) } : null);

        // One domain for both panels, so A and B are read on the same scale.
        const values = plans.filter(Boolean).flatMap(p =>
            [p.base, p.d.score_lo, p.d.score_hi, ...p.steps.flatMap(s => [s.from, s.to])]);
        let lo = Math.floor((d3.min(values) - 0.15) * 2) / 2;
        let hi = Math.ceil((d3.max(values) + 0.15) * 2) / 2;
        if (hi - lo < 1.5) {
            const grow = (1.5 - (hi - lo)) / 2;
            lo -= grow;
            hi += grow;
        }

        rowLabels.filter((d, i) => i === 0)
            .text(mode === "average" ? "Average country" : "Dystopia");

        panels.forEach((p, i) => drawPanel(p, plans[i], [lo, hi], duration));
    }

    function drawPanel(p, plan, domain, duration) {
        p.body.attr("display", plan ? null : "none");
        p.empty.attr("display", plan ? "none" : null);
        if (!plan) return;

        const x = d3.scaleLinear().domain(domain).range([p.x0 + 6, p.x0 + panelW - 6]);
        const t = svg.transition().duration(duration);
        const { d, base, steps } = plan;

        p.title.text(d.doubtful ? `${d.country} †` : d.country);
        p.sub.text(`Rank ${d.rank} of 147 · plausibly ${d.rank_lo}–${d.rank_hi}`);

        const known = steps.filter(s => s.key !== "residual" && !s.missing);
        const most = d3.greatest(known, s => s.v);
        const least = d3.least(known, s => s.v);
        if (state.mode === "average") {
            p.lift.text(most && most.v > 0 ? `Lifts it most: ${most.name} (${signed(most.v)})`
                : "No factor is above the average country");
            p.drag.text(least && least.v < 0 ? `Holds it back most: ${least.name} (${signed(least.v)})`
                : "No factor is below the average country");
        } else {
            p.lift.text(most ? `Adds most: ${most.name} (${signed(most.v)})` : "");
            p.drag.text(least ? `Adds least: ${least.name} (${signed(least.v)})` : "");
        }

        // Grid and axis.
        const ticks = x.ticks(domain[1] - domain[0] > 3 ? 7 : 6);
        p.grid.selectAll("line")
            .data(ticks, v => v)
            .join(enter => enter.append("line").attr("x1", x(0)).attr("x2", x(0)))
            .attr("y1", TOP).attr("y2", TOP + N_ROWS * ROW_H)
            .attr("stroke", GRID)
            .transition(t)
            .attr("x1", v => x(v)).attr("x2", v => x(v));

        // Labels at the domain's two ends are dropped: the panels sit side by
        // side, and A's last label would otherwise run into B's first.
        p.axis.selectAll("text")
            .data(ticks.filter(v => v > domain[0] && v < domain[1]), v => v)
            .join(enter => label(enter, { size: 11, fill: MUTED, anchor: "middle" })
                .attr("y", TOP + N_ROWS * ROW_H + 16))
            .text(v => d3.format("~g")(v))
            .transition(t)
            .attr("x", v => x(v));

        p.base.transition(t)
            .attr("x1", x(base)).attr("x2", x(base))
            .attr("y1", rowY(0) - BAR_H / 2 - 2).attr("y2", rowY(8));

        p.startMark.transition(t).attr("x", x(base) - 1.5);
        p.startText.text(fmt2(base)).transition(t).attr("x", x(base) + 7);

        // Connectors from each step's end to the next step's start.
        const joints = [base, ...steps.map(s => s.to)];
        p.connectors.selectAll("line")
            .data(joints)
            .join("line")
            .attr("stroke", "#9a9892")
            .attr("stroke-width", 1)
            .attr("y1", (v, i) => rowY(i) + BAR_H / 2)
            .attr("y2", (v, i) => rowY(i + 1) - BAR_H / 2)
            .transition(t)
            .attr("x1", v => x(v)).attr("x2", v => x(v));

        // The steps. A step narrower than 2px is widened to 2px so it shows.
        const fill = s => s.absorbs ? "url(#hatch-grey)"
            : s.v >= 0 ? (s.hatch ? "url(#hatch-up)" : UP)
                : (s.hatch ? "url(#hatch-down)" : DOWN);

        p.bars.selectAll("rect")
            .data(steps, s => s.key)
            .join("rect")
            .attr("y", (s, i) => rowY(i + 1) - BAR_H / 2)
            .attr("height", BAR_H)
            .attr("rx", 2)
            .attr("fill", fill)
            .transition(t)
            .attr("x", s => Math.min(x(s.from), x(s.to)) - (Math.abs(x(s.to) - x(s.from)) < 2 ? 1 : 0))
            .attr("width", s => s.missing ? 0 : Math.max(2, Math.abs(x(s.to) - x(s.from))));

        // Values beside each step, on the outside of its far end; flipped to
        // the near end when the far end is at the panel edge.
        const place = s => {
            const text = s.missing ? "no data"
                : s.absorbs ? `${signed(s.v)} incl. ${s.absorbs.join(", ")}`
                    : signed(s.v);
            const width = text.length * 6.2;
            const [from, to] = [x(s.from), x(s.to)];
            if (s.missing) return { text, x: from + 6, anchor: "start" };
            if (s.v >= 0) {
                return to + 6 + width < p.x0 + panelW
                    ? { text, x: to + 6, anchor: "start" } : { text, x: from - 6, anchor: "end" };
            }
            return to - 6 - width > p.x0
                ? { text, x: to - 6, anchor: "end" } : { text, x: from + 6, anchor: "start" };
        };

        p.values.selectAll("text")
            .data(steps.map(s => ({ s, ...place(s) })), v => v.s.key)
            .join(enter => label(enter, { size: 11.5, fill: INK_SOFT, halo: true }))
            .attr("y", (v, i) => rowY(i + 1))
            .attr("dy", "0.35em")
            .attr("font-style", v => v.s.missing ? "italic" : "normal")
            .attr("fill", v => v.s.missing ? MUTED : INK_SOFT)
            .attr("text-anchor", v => v.anchor)
            .text(v => v.text)
            .transition(t)
            .attr("x", v => v.x);

        // The actual score, with its 95% interval.
        p.ci.transition(t).attr("x1", x(d.score_lo)).attr("x2", x(d.score_hi));
        p.endDot.transition(t).attr("cx", x(d.score));
        p.endText.text(fmt3(d.score)).transition(t).attr("x", x(d.score_hi) + 9);
    }

    return { update };
}

// ---------------------------------------------------------------- strips --

// Every country on each factor, one strip per factor, all on one shared scale
// of ladder points. Dots are jittered vertically by a hash of the name, so a
// country sits at the same height every time the page loads.
function drawStrips(ctx) {
    const { rows, state } = ctx;
    const keys = [...FACTORS, RESIDUAL];
    const STRIP_H = 52;
    const TOP = 30;
    const H = TOP + keys.length * STRIP_H + 50;
    const x0 = LABEL_W + 6;
    const x1 = MAIN_W - 14;
    const centre = i => TOP + i * STRIP_H + STRIP_H / 2;

    const jitter = new Map(rows.map(d => {
        let h = 2166136261;
        for (const c of d.country) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return [d.country, ((h >>> 0) % 1000) / 1000 - 0.5];
    }));

    const svg = d3.select("#strips").classed("loading", false).text("")
        .append("svg")
        .attr("viewBox", `0 0 ${MAIN_W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", "Strip plots of every country's contribution from each of the six " +
            "factors and the residual, on one shared scale. GDP per capita and social support " +
            "spread widest; generosity and corruption barely vary.");

    keys.forEach((f, i) => {
        if (i % 2 === 0) {
            svg.append("rect")
                .attr("x", 0).attr("y", TOP + i * STRIP_H)
                .attr("width", MAIN_W).attr("height", STRIP_H)
                .attr("fill", "#f7f7f4");
        }
        const spread = d3.max(ctx.rows, d => d[f.key]) - d3.min(ctx.rows, d => d[f.key]);
        label(svg, { size: 12, weight: "bold", anchor: "end" })
            .attr("x", LABEL_W - 12).attr("y", centre(i) - 3)
            .text(f.key === "residual" ? "Unexplained" : f.name);
        label(svg, { size: 11, fill: MUTED, anchor: "end" })
            .attr("x", LABEL_W - 12).attr("y", centre(i) + 12)
            .text(`countries span ${fmt2(spread)} points`);
    });

    const grid = svg.append("g");
    const zero = svg.append("line")
        .attr("y1", TOP - 4).attr("y2", TOP + keys.length * STRIP_H)
        .attr("stroke", INK_SOFT);
    const zeroText = label(svg, { size: 11.5, weight: "bold", fill: INK_SOFT, anchor: "middle" })
        .attr("y", TOP - 10);
    const axis = svg.append("g");
    const axisTitle = label(svg, { size: 12, fill: INK_SOFT, anchor: "middle" })
        .attr("x", (x0 + x1) / 2).attr("y", H - 6);

    // One dot per country per strip.
    const points = keys.flatMap((f, i) => rows
        .filter(d => d[f.key] != null)
        .map(d => ({ d, f, i, jy: jitter.get(d.country) * 30 })));

    const dots = svg.append("g")
        .selectAll("circle")
        .data(points)
        .join("circle")
        .attr("r", 3.4)
        .attr("cy", p => centre(p.i) + p.jy);

    const venezuela = label(svg, { size: 11, fill: MUTED, anchor: "start", halo: true })
        .attr("y", centre(0) - 12)
        .text("Venezuela †");

    // A and B are drawn again on top, on the strip's centre line, with values.
    const marks = svg.append("g");

    const hover = svg.append("circle")
        .attr("r", 6.5).attr("fill", "none")
        .attr("stroke", INK).attr("stroke-width", 1.5)
        .attr("opacity", 0).attr("pointer-events", "none");

    let x = null;
    let delaunay = null;

    const nearest = event => {
        const [mx, my] = d3.pointer(event, svg.node());
        const p = points[delaunay.find(mx, my)];
        const px = x(ctx.value(p.d, p.f.key));
        const py = centre(p.i) + p.jy;
        return Math.hypot(px - mx, py - my) < 12 ? { p, px, py } : null;
    };

    svg.append("rect")
        .attr("x", x0 - 8).attr("y", TOP)
        .attr("width", x1 - x0 + 16).attr("height", keys.length * STRIP_H)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .on("pointermove", event => {
            const hit = nearest(event);
            if (!hit) {
                hover.attr("opacity", 0);
                hideTip();
                return;
            }
            const { p, px, py } = hit;
            const v = ctx.value(p.d, p.f.key);
            const r = ctx.factorRank[p.f.key];
            hover.attr("cx", px).attr("cy", py).attr("opacity", 1);
            showTip(event, p.d.country, [
                [p.f.key === "residual" ? "Unexplained" : p.f.name, signed(v), v >= 0 ? UP : DOWN],
                ["Rank on this factor", `${ordinal(r.of.get(p.d.country))} of ${r.n}`],
                ["Life evaluation", `${fmt3(p.d.score)} (rank ${p.d.rank})`]
            ], ctx.isDoubtful(p.d, p.f.key) ? p.d.doubtful.note : "Click to make it country A");
        })
        .on("pointerleave", () => {
            hover.attr("opacity", 0);
            hideTip();
        })
        .on("click", event => {
            const hit = nearest(event);
            if (hit) ctx.setA(hit.p.d);
        });

    function update(duration) {
        const { a, b, region, mode } = state;
        const t = svg.transition().duration(duration);

        x = d3.scaleLinear()
            .domain(mode === "average" ? [-1.6, 1.6] : [-1.6, 2.3])
            .range([x0, x1]);

        const ticks = d3.range(-1.5, mode === "average" ? 1.51 : 2.01, 0.5);
        const tickText = v => v === 0 ? "0" : `${v > 0 ? "+" : "−"}${d3.format("~g")(Math.abs(v))}`;

        grid.selectAll("line")
            .data(ticks, v => v)
            .join(enter => enter.append("line").attr("x1", x(0)).attr("x2", x(0)))
            .attr("y1", TOP).attr("y2", TOP + keys.length * STRIP_H)
            .attr("stroke", GRID)
            .transition(t)
            .attr("x1", v => x(v)).attr("x2", v => x(v));

        axis.selectAll("text")
            .data(ticks, v => v)
            .join(enter => label(enter, { size: 11, fill: MUTED, anchor: "middle" })
                .attr("x", x(0)).attr("y", TOP + keys.length * STRIP_H + 16))
            .text(tickText)
            .transition(t)
            .attr("x", v => x(v));

        zero.transition(t).attr("x1", x(0)).attr("x2", x(0));
        zeroText.text(mode === "average" ? "average country" : "Dystopia")
            .transition(t).attr("x", x(0));

        axisTitle.text(mode === "average"
            ? "Points each factor adds (+) or subtracts (−), compared with the average country"
            : "Points each factor adds above Dystopia, the report's benchmark");

        const inRegion = d => region === "all" || d.region === region;

        dots
            .attr("fill", p => region === "all" ? DOT : inRegion(p.d) ? INK_SOFT : "#e1e0d9")
            .attr("fill-opacity", p => region === "all" ? 0.6 : inRegion(p.d) ? 0.9 : 0.5)
            .transition(t)
            .attr("cx", p => x(ctx.value(p.d, p.f.key)));

        delaunay = d3.Delaunay.from(points,
            p => x(ctx.value(p.d, p.f.key)), p => centre(p.i) + p.jy);

        const vz = ctx.byName.get("Venezuela");
        venezuela.transition(t).attr("x", x(ctx.value(vz, "gdp")) + 7);

        // A above the centre line, B below it, each with its value.
        const marked = [];
        keys.forEach((f, i) => {
            for (const [d, which] of [[a, "a"], [b, "b"]]) {
                if (d) marked.push({ id: `${f.key}:${which}`, d, f, i, which, v: ctx.value(d, f.key) });
            }
        });

        marks.selectAll("g")
            .data(marked, m => m.id)
            .join(enter => {
                const g = enter.append("g");
                g.append("circle");
                label(g, { size: 11.5, weight: "bold", anchor: "middle", halo: true });
                return g;
            })
            .each(function (m) {
                const g = d3.select(this);
                const missing = m.v == null;
                const cx = missing ? x(0) : x(m.v);
                g.select("circle")
                    .attr("opacity", missing ? 0 : 1)
                    .attr("cy", centre(m.i))
                    .attr("r", 5.5)
                    .attr("fill", m.which === "a" ? INK : SURFACE)
                    .attr("stroke", m.which === "a" ? SURFACE : INK)
                    .attr("stroke-width", 2)
                    .transition(t)
                    .attr("cx", cx);
                g.select("text")
                    .attr("y", m.which === "a" ? centre(m.i) - 10 : centre(m.i) + 19)
                    .attr("fill", m.which === "a" ? INK : INK_SOFT)
                    .attr("font-style", missing ? "italic" : "normal")
                    .text(missing ? `${m.d.country}: no data` : signed(m.v))
                    .transition(t)
                    .attr("x", cx);
            });
    }

    return { update };
}

// ---------------------------------------------------------------- list --

// The ranked list: the lookup table the original is, in one place. Each row
// carries a small plausible-rank track on a 1–147 axis.
function drawList(ctx) {
    const { rows, state } = ctx;
    const list = d3.select("#rank-list");

    const items = list.selectAll("li")
        .data([...rows].sort((p, q) => p.rank - q.rank), d => d.country)
        .join("li");

    const button = items.append("button")
        .attr("type", "button")
        .attr("class", "rank-row")
        .on("click", (event, d) => ctx.setA(d));

    button.append("span").attr("class", "r-rank").text(d => d.rank);
    button.append("span").attr("class", "r-name").text(d => d.doubtful ? `${d.country} †` : d.country);
    button.append("span").attr("class", "r-score").text(d => fmt3(d.score));

    const track = button.append("span")
        .attr("class", "r-track")
        .attr("title", d => `Plausible rank ${d.rank_lo}–${d.rank_hi}`);
    track.append("i")
        .style("left", d => `${(d.rank_lo - 1) / 146 * 100}%`)
        .style("width", d => `${(d.rank_hi - d.rank_lo) / 146 * 100}%`);
    track.append("b")
        .style("left", d => `${(d.rank - 1) / 146 * 100}%`);

    function update() {
        const { a, b, region } = state;
        items
            .classed("hidden", d => region !== "all" && d.region !== region)
            .classed("is-peer", d => d !== a && d.rank >= a.rank_lo && d.rank <= a.rank_hi)
            .classed("is-a", d => d === a)
            .classed("is-b", d => d === b);

        button.attr("aria-pressed", d => d === a ? "true" : "false");

        // Keep A in view inside the list without scrolling the page.
        const row = items.filter(d => d === a).node();
        const box = list.node();
        if (row && !row.classList.contains("hidden")) {
            const top = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2;
            box.scrollTo({ top, behavior: "smooth" });
        }

        const shown = rows.filter(d => region === "all" || d.region === region).length;
        d3.select("#list-readout").text(region === "all"
            ? "Click a country to explain it."
            : `${shown} countries in this region; ranks are global.`);
    }

    return { update };
}

// ---------------------------------------------------------------- table --

function drawTable(rows) {
    const columns = [
        ["Rank", d => d.rank, true],
        ["Rank range", d => `${d.rank_lo}–${d.rank_hi}`, true],
        ["Country", d => d.country],
        ["Region", d => d.region],
        ["Life evaluation", d => fmt3(d.score), true],
        ["95% CI", d => `${fmt3(d.score_lo)}–${fmt3(d.score_hi)}`, true],
        ...FACTORS.map(f => [f.name, d => d[f.key] == null ? "no data" : fmt3(d[f.key]), true]),
        ["Dystopia + residual", d => d.dystopia_residual == null ? "no data" : fmt3(d.dystopia_residual), true]
    ];

    d3.select("#whr-table thead")
        .append("tr")
        .selectAll("th")
        .data(columns)
        .join("th")
        .attr("class", c => c[2] ? "num" : null)
        .text(c => c[0]);

    d3.select("#whr-table tbody")
        .selectAll("tr")
        .data([...rows].sort((p, q) => p.rank - q.rank))
        .join("tr")
        .selectAll("td")
        .data(d => columns.map(c => [c[1](d), c[2]]))
        .join("td")
        .attr("class", c => c[1] ? "num" : null)
        .text(c => c[0]);
}
