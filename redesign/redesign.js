// Individual project — a redesign of Figure 2.1 of the World Happiness Report
// 2026 ("Country rankings by life evaluations").
//
// The original stacks seven sub-bars per country. This version unstacks them
// into a table lens: one row per country, one aligned column per quantity.
//
//   life evaluation          → dot on a 1–8 axis, 95% CI as a line, value printed
//   rank uncertainty          → line on a 1–147 rank axis (the printed "(43–65)")
//   six factor contributions  → one column each, all on one shared ladder-point
//                               scale; bar direction = raises / lowers the
//                               predicted score relative to the benchmark
//   residual                  → its own two-sided column
//
// Colour has one job — direction (blue raises, red lowers) — because column
// position already says which factor a bar belongs to.
//
// The benchmark is switchable. "average" subtracts each factor's mean across
// countries, so bars point both ways; "dystopia" is the report's own zero (the
// world's lowest value of each factor), so every bar is positive. The two views
// differ only in where the zero line sits: the far end of every bar is the same
// pixel in both, which the transition makes visible.

// ---------------------------------------------------------------- constants --

const DYSTOPIA = 1.16;   // Dystopia's ladder score, from the figure's legend

const FACTORS = [
    { key: "gdp", name: "GDP per capita", lines: ["GDP per", "capita"] },
    { key: "social", name: "Social support", lines: ["Social", "support"] },
    { key: "health", name: "Healthy life expectancy", lines: ["Healthy life", "expectancy"] },
    { key: "freedom", name: "Freedom to make life choices", lines: ["Freedom to", "choose"] },
    { key: "generosity", name: "Generosity", lines: ["Generosity"] },
    { key: "corruption", name: "Low perceived corruption", lines: ["Low", "corruption"] }
];

// Values the report publishes but that should not be read at face value. The
// cells are hatched and the country name carries a dagger.
const DOUBTFUL = {
    "Venezuela": {
        cells: ["gdp", "residual"],
        note: "GDP per capita is listed at $89 in the report's Statistical Appendix " +
            "(next lowest: Yemen, $917). The GDP bar and the large residual both rest on that value."
    }
};

const PINNED_AT_START = ["Uzbekistan", "China"];

// Colours. Blue / red is the diverging pair (validated: CVD ΔE 21.6, both ≥ 3:1
// on white). Everything else is ink or a neutral.
const UP = "#2a78d6";
const DOWN = "#e34948";
const INK = "#0b0b0b";
const INK_SOFT = "#52514e";
const MUTED = "#898781";
const RANGE_GREY = "#b4b2a9";
const GRID = "#ecebe6";

// Geometry. One ladder point is K pixels in every factor column, so column
// widths are comparable; a column never gets narrower than MIN_SLOT, which is
// what its two-line title needs, and its bars sit centred in the slot.
const ROW = 13;
const BAR = 7;
const K = 42;
const MIN_SLOT = 62;
const GAP = 12;
const HEAD_H = 78;

const fmt3 = d3.format(".3f");
const signed = d3.format("+.2f");

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

    for (const [label, value, colour] of rows) {
        const line = document.createElement("div");
        line.className = "tip-row";

        if (colour) {
            const key = document.createElement("span");
            key.className = "tip-line";
            key.style.background = colour;
            line.appendChild(key);
        }

        const k = document.createElement("span");
        k.className = "tip-key";
        k.textContent = `${label} `;

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

// Flip to the other side of the pointer near the right and bottom edges, so a
// tall tooltip on a row low in the window stays on screen.
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
        // The report's predicted score: Dystopia plus the six contributions.
        d.predicted = d.complete ? DYSTOPIA + d3.sum(FACTORS, f => d[f.key]) : null;
        d.doubtful = DOUBTFUL[d.country] || null;
    }
    draw(rows);
});

// ---------------------------------------------------------------- layout --

function buildColumns(rows) {
    const cols = {};
    let x = 0;

    const add = (id, w, extra = {}) => {
        cols[id] = { id, x, w, ...extra };
        x += w + GAP;
    };

    add("rank", 26);
    add("name", 148);
    add("range", 124, { pad: 5 });
    add("score", 190, { numW: 36 });

    // The means are taken over the 145 countries with all six factors, so that
    // for each of them  score = baseline + Σ(bars) + residual  holds exactly
    // (to the data's 3-decimal rounding).
    const complete = rows.filter(d => d.complete);

    for (const f of FACTORS) {
        const max = d3.max(rows, d => d[f.key]);
        const min = d3.min(rows, d => d[f.key]);   // 0: the Dystopia country
        const barW = (max - min) * K;
        const slot = Math.max(barW, MIN_SLOT);
        add(f.key, slot, {
            factor: f,
            min, max,
            mean: d3.mean(complete, d => d[f.key]),
            barX: x + (slot - barW) / 2
        });
    }

    const rMin = d3.min(rows, d => d.residual);
    const rMax = d3.max(rows, d => d.residual);
    const rW = (rMax - rMin) * K;
    add("residual", Math.max(rW, MIN_SLOT), { min: rMin, max: rMax });
    cols.residual.barX = cols.residual.x + (cols.residual.w - rW) / 2;

    const baselines = {
        dystopia: DYSTOPIA,
        average: DYSTOPIA + d3.sum(FACTORS, f => cols[f.key].mean)
    };

    return { cols, width: x - GAP, baselines };
}

// Where a column's zero line sits in the current mode. The far end of a factor
// bar is barX + value·K in both modes, only the start moves.
function zeroX(col, mode) {
    if (col.id === "residual") return col.barX - col.min * K;
    return col.barX + (mode === "average" ? col.mean : 0) * K;
}

function barEnd(col, value) {
    return col.id === "residual"
        ? col.barX + (value - col.min) * K
        : col.barX + value * K;
}

// A bar with a rounded data end and a square baseline end.
function barPath(x0, x1, y, h) {
    const r = Math.min(2, Math.abs(x1 - x0) / 2);
    const top = y - h / 2;
    if (x1 >= x0) {
        return `M${x0},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}` +
            `V${top + h - r}Q${x1},${top + h} ${x1 - r},${top + h}H${x0}Z`;
    }
    return `M${x0},${top}H${x1 + r}Q${x1},${top} ${x1},${top + r}` +
        `V${top + h - r}Q${x1},${top + h} ${x1 + r},${top + h}H${x0}Z`;
}

// ---------------------------------------------------------------- draw --

function draw(rows) {
    const { cols, width: W, baselines } = buildColumns(rows);
    const factorCols = [...FACTORS.map(f => cols[f.key]), cols.residual];

    const state = {
        mode: "average",
        region: "all",
        sort: { key: "rank", dir: 1 },
        pinned: new Set(PINNED_AT_START),
        hover: null
    };

    const rankX = d3.scaleLinear()
        .domain([1, 147])
        .range([cols.range.x + cols.range.pad, cols.range.x + cols.range.w - cols.range.pad]);

    const scoreX = d3.scaleLinear()
        .domain([1, 8])
        .range([cols.score.x + cols.score.numW + 6, cols.score.x + cols.score.w - 4]);

    const byCountry = new Map(rows.map(d => [d.country, d]));

    // ------------------------------------------------------------ controls --

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
        update();
    });

    d3.select("#country-list")
        .selectAll("option")
        .data(rows.map(d => d.country).sort(d3.ascending))
        .join("option")
        .attr("value", d => d);

    const search = d3.select("#country-search");

    function findCountry(text) {
        const q = text.trim().toLowerCase();
        if (!q) return null;
        const exact = rows.find(d => d.country.toLowerCase() === q);
        if (exact) return exact;
        const starts = rows.filter(d => d.country.toLowerCase().startsWith(q));
        if (starts.length === 1) return starts[0];
        const contains = rows.filter(d => d.country.toLowerCase().includes(q));
        return contains.length === 1 ? contains[0] : null;
    }

    function goTo(d) {
        state.pinned.add(d.country);
        if (state.region !== "all" && state.region !== d.region) {
            state.region = "all";
            d3.select("#region-filter").property("value", "all");
        }
        update();
        search.property("value", "");
        const row = body.select(`[data-country="${CSS.escape(d.country)}"]`).node();
        if (row) {
            const box = row.getBoundingClientRect();
            const headH = document.getElementById("lens-head").getBoundingClientRect().height;
            window.scrollTo({ top: window.scrollY + box.top - headH - 120, behavior: "smooth" });
        }
    }

    search
        .on("change", function () {
            const d = findCountry(this.value);
            if (d) goTo(d);
        })
        .on("keydown", function (event) {
            if (event.key === "Enter") {
                const d = findCountry(this.value);
                if (d) goTo(d);
            }
        });

    d3.selectAll("#baseline-set button").on("click", function () {
        state.mode = this.dataset.mode;
        d3.selectAll("#baseline-set button")
            .classed("active", function () { return this.dataset.mode === state.mode; });
        update(700);
    });

    d3.select("#clear-pins").on("click", () => {
        state.pinned.clear();
        update();
    });

    // ------------------------------------------------------------ overview --

    const overview = drawOverview(rows, W, state, d => goTo(d));

    // ------------------------------------------------------------ key --

    drawKey();

    // ------------------------------------------------------------ header --

    // The header is its own SVG so it can stay on screen while the rows
    // scroll. It shares the body's viewBox width, so the columns line up.
    const head = d3.select("#lens-head")
        .style("max-width", `${W + 8}px`)
        .append("svg")
        .attr("viewBox", `-4 0 ${W + 8} ${HEAD_H}`)
        .style("max-width", `${W + 8}px`);

    const firstF = cols[FACTORS[0].key];
    const lastF = cols.residual;

    const groupTitle = head.append("text")
        .attr("class", "group-title")
        .attr("x", (firstF.x + cols[FACTORS[5].key].x + cols[FACTORS[5].key].w) / 2)
        .attr("y", 11)
        .attr("text-anchor", "middle");

    head.append("path")
        .attr("class", "group-rule")
        .attr("d", `M${firstF.x},20V16H${cols[FACTORS[5].key].x + cols[FACTORS[5].key].w}V20`);

    const titles = [
        { key: "rank", col: cols.rank, lines: ["Rank"], anchor: "end", dir: 1 },
        { key: "name", col: cols.name, lines: ["Country"], anchor: "start", dir: 1 },
        { key: "range", col: cols.range, lines: ["Plausible rank", "(95% range)"], dir: -1 },
        { key: "score", col: cols.score, lines: ["Life evaluation", "(0–10, 95% CI)"], dir: -1 },
        ...FACTORS.map(f => ({ key: f.key, col: cols[f.key], lines: f.lines, dir: -1 })),
        { key: "residual", col: lastF, lines: ["Unexplained", "(residual)"], dir: -1 }
    ];

    const titleG = head.selectAll("g.col-head")
        .data(titles)
        .join("g")
        .attr("class", "col-head")
        .attr("role", "button")
        .attr("tabindex", 0)
        .attr("aria-label", t => `Sort by ${t.lines.join(" ")}`)
        .on("click", (event, t) => sortBy(t))
        .on("keydown", (event, t) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                sortBy(t);
            }
        });

    titleG.append("rect")
        .attr("class", "col-hit")
        .attr("x", t => t.col.x - 3)
        .attr("y", 22)
        .attr("width", t => t.col.w + 6)
        .attr("height", 34)
        .attr("rx", 3);

    titleG.append("text")
        .attr("class", "col-title")
        .attr("text-anchor", t => t.anchor || "middle")
        .attr("x", t => t.anchor === "end" ? t.col.x + t.col.w
            : t.anchor === "start" ? t.col.x : t.col.x + t.col.w / 2)
        .selectAll("tspan")
        .data(t => t.lines.map((line, i) => ({ line, i, t })))
        .join("tspan")
        .attr("x", d => d.t.anchor === "end" ? d.t.col.x + d.t.col.w
            : d.t.anchor === "start" ? d.t.col.x : d.t.col.x + d.t.col.w / 2)
        .attr("y", d => 34 + d.i * 12)
        .text(d => d.line);

    // The sort arrow sits on the line under each title.
    const arrows = titleG.append("text")
        .attr("class", "sort-arrow")
        .attr("text-anchor", "middle")
        .attr("x", t => t.anchor === "end" ? t.col.x + t.col.w - 13
            : t.anchor === "start" ? t.col.x + 5 : t.col.x + t.col.w / 2)
        .attr("y", t => 34 + t.lines.length * 12 - 1);

    // Axis ticks under the titles.
    const tickY = HEAD_H - 6;

    head.append("g")
        .selectAll("text")
        .data([1, 50, 100, 147])
        .join("text")
        .attr("class", "col-tick")
        .attr("x", d => rankX(d))
        .attr("y", tickY)
        .attr("text-anchor", d => d === 1 ? "start" : d === 147 ? "end" : "middle")
        .text(d => d);

    head.append("g")
        .selectAll("text")
        .data(d3.range(1, 9))
        .join("text")
        .attr("class", "col-tick")
        .attr("x", d => scoreX(d))
        .attr("y", tickY)
        .attr("text-anchor", "middle")
        .text(d => d);

    const factorTicks = head.append("g");

    // ------------------------------------------------------------ body --

    const body = d3.select("#lens").classed("loading", false).text("")
        .append("svg")
        .style("max-width", `${W + 8}px`)
        .attr("role", "img")
        .attr("aria-label", "All 147 countries in rank order, with their life evaluation, " +
            "plausible rank range and the six factor contributions. The table view below " +
            "lists the same values.");

    const defs = body.append("defs");
    for (const [id, colour] of [["hatch-up", UP], ["hatch-down", DOWN]]) {
        const p = defs.append("pattern")
            .attr("id", id)
            .attr("width", 4)
            .attr("height", 4)
            .attr("patternUnits", "userSpaceOnUse")
            .attr("patternTransform", "rotate(45)");
        p.append("rect").attr("width", 4).attr("height", 4).attr("fill", colour).attr("opacity", 0.22);
        p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 4)
            .attr("stroke", colour).attr("stroke-width", 2);
    }

    const bgLayer = body.append("g");
    const rowLayer = body.append("g");
    const fgLayer = body.append("g");

    // Vertical guides: score gridlines and one zero line per factor column.
    const scoreGrid = bgLayer.selectAll("line.score-grid")
        .data(d3.range(1, 9))
        .join("line")
        .attr("class", "score-grid")
        .attr("x1", d => scoreX(d))
        .attr("x2", d => scoreX(d))
        .attr("stroke", GRID);

    const rankGrid = bgLayer.selectAll("line.rank-grid")
        .data([1, 50, 100, 147])
        .join("line")
        .attr("class", "rank-grid")
        .attr("x1", d => rankX(d))
        .attr("x2", d => rankX(d))
        .attr("stroke", GRID);

    const zeroLines = fgLayer.selectAll("line.zero-line")
        .data(factorCols)
        .join("line")
        .attr("class", "zero-line");

    // ------------------------------------------------------------ rows --

    const rowSel = rowLayer.selectAll("g.lens-row")
        .data(rows, d => d.country)
        .join("g")
        .attr("class", "lens-row")
        .attr("data-country", d => d.country)
        .on("pointerenter", (event, d) => {
            state.hover = d;
            paintRows();
            tipFor(event, d);
        })
        .on("pointermove", moveTip)
        .on("pointerleave", () => {
            state.hover = null;
            paintRows();
            hideTip();
        })
        .on("click", (event, d) => {
            if (state.pinned.has(d.country)) state.pinned.delete(d.country);
            else state.pinned.add(d.country);
            paintRows();
            overview.paint();
            readout();
        });

    rowSel.append("rect")
        .attr("class", "row-bg")
        .attr("x", -4)
        .attr("y", 0)
        .attr("width", W + 8)
        .attr("height", ROW);

    const mid = ROW / 2;

    rowSel.append("text")
        .attr("class", "lens-num")
        .attr("x", cols.rank.x + cols.rank.w)
        .attr("y", mid)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .text(d => d.rank);

    rowSel.append("text")
        .attr("class", "lens-name")
        .attr("x", cols.name.x)
        .attr("y", mid)
        .attr("dy", "0.35em")
        .text(d => d.doubtful ? `${d.country} †` : d.country);

    // Plausible rank: a line from the best to the worst rank, ink dot at the rank.
    rowSel.append("line")
        .attr("x1", d => rankX(d.rank_lo))
        .attr("x2", d => rankX(d.rank_hi))
        .attr("y1", mid)
        .attr("y2", mid)
        .attr("stroke", RANGE_GREY)
        .attr("stroke-width", 3)
        .attr("stroke-linecap", "round");

    rowSel.append("circle")
        .attr("cx", d => rankX(d.rank))
        .attr("cy", mid)
        .attr("r", 2.2)
        .attr("fill", INK);

    // Life evaluation: printed value, CI line, dot.
    rowSel.append("text")
        .attr("class", "lens-num")
        .attr("x", cols.score.x + cols.score.numW)
        .attr("y", mid)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .text(d => fmt3(d.score));

    rowSel.append("line")
        .attr("x1", d => scoreX(d.score_lo))
        .attr("x2", d => scoreX(d.score_hi))
        .attr("y1", mid)
        .attr("y2", mid)
        .attr("stroke", INK_SOFT)
        .attr("stroke-width", 1.5);

    rowSel.append("circle")
        .attr("class", "score-dot")
        .attr("cx", d => scoreX(d.score))
        .attr("cy", mid)
        .attr("r", 3.6)
        .attr("fill", INK)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.5);

    // Factor and residual cells.
    for (const col of factorCols) {
        const key = col.id;

        const cell = rowSel.append("g").attr("class", `cell cell-${key}`);

        cell.filter(d => d[key] == null)
            .append("text")
            .attr("class", "lens-na")
            .attr("x", col.x + col.w / 2)
            .attr("y", mid)
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .text("no data");

        cell.filter(d => d[key] != null)
            .append("path")
            .attr("class", "lens-bar");
    }

    // ------------------------------------------------------------ table view --

    drawTable(rows);

    // ------------------------------------------------------------ behaviour --

    function sortBy(t) {
        if (state.sort.key === t.key) state.sort.dir *= -1;
        else state.sort = { key: t.key, dir: t.dir };
        update();
    }

    function sortValue(d, key) {
        if (key === "rank") return d.rank;
        if (key === "score") return d.score;
        if (key === "range") return d.rank_hi - d.rank_lo;
        return d[key];
    }

    function ordered() {
        const { key, dir } = state.sort;
        const shown = rows.filter(d => state.region === "all" || d.region === state.region);

        if (key === "name") {
            return shown.sort((a, b) => dir * a.country.localeCompare(b.country));
        }
        return shown.sort((a, b) => {
            const va = sortValue(a, key);
            const vb = sortValue(b, key);
            // Missing values go last whichever way the column is sorted.
            if (va == null && vb == null) return a.rank - b.rank;
            if (va == null) return 1;
            if (vb == null) return -1;
            return dir * (va - vb) || a.rank - b.rank;
        });
    }

    function barFill(d, key, value) {
        const hatched = d.doubtful && d.doubtful.cells.includes(key);
        if (value >= 0) return hatched ? "url(#hatch-up)" : UP;
        return hatched ? "url(#hatch-down)" : DOWN;
    }

    function paintBars(duration) {
        for (const col of factorCols) {
            const key = col.id;
            const z = zeroX(col, state.mode);
            const shift = key === "residual" || state.mode === "dystopia" ? 0 : col.mean;

            rowSel.select(`.cell-${key} .lens-bar`)
                .transition()
                .duration(duration)
                .attr("d", d => barPath(z, barEnd(col, d[key]), mid, BAR))
                .attr("fill", d => barFill(d, key, d[key] - shift));
        }

        zeroLines
            .transition()
            .duration(duration)
            .attr("x1", c => zeroX(c, state.mode))
            .attr("x2", c => zeroX(c, state.mode));

        drawFactorTicks(duration);
    }

    function drawFactorTicks(duration) {
        const ticks = [];
        for (const col of factorCols) {
            const shift = col.id === "residual" || state.mode === "dystopia" ? 0 : col.mean;
            const lo = col.id === "residual" ? col.min : col.min - shift;
            const hi = col.id === "residual" ? col.max : col.max - shift;
            for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) {
                const label = v === 0
                    ? (col.id === "residual" ? "0" : state.mode === "average" ? "avg" : "0")
                    : (v > 0 ? `+${v}` : `−${-v}`);
                ticks.push({ id: `${col.id}:${v}`, x: zeroX(col, state.mode) + v * K, label, v });
            }
        }

        factorTicks.selectAll("text")
            .data(ticks, t => t.id)
            .join(
                enter => enter.append("text")
                    .attr("class", t => t.v === 0 ? "col-tick zero" : "col-tick")
                    .attr("y", tickY)
                    .attr("text-anchor", "middle")
                    .attr("x", t => t.x)
                    .attr("opacity", 0),
                update => update,
                exit => exit.transition().duration(duration / 2).attr("opacity", 0).remove()
            )
            .text(t => t.label)
            .transition()
            .duration(duration)
            .attr("x", t => t.x)
            .attr("opacity", 1);
    }

    function paintRows() {
        const h = state.hover;
        rowSel
            .classed("pinned", d => state.pinned.has(d.country))
            .classed("hovered", d => h && d === h)
            .classed("in-range", d => h && d !== h && d.rank >= h.rank_lo && d.rank <= h.rank_hi);
    }

    function readout() {
        const shown = rows.filter(d => state.region === "all" || d.region === state.region).length;
        const pins = state.pinned.size;
        d3.select("#lens-readout").text(
            `${shown} of ${rows.length} countries shown` +
            (pins ? ` · ${pins} pinned` : "")
        );
    }

    function update(duration = 500) {
        const list = ordered();
        const index = new Map(list.map((d, i) => [d.country, i]));
        const H = list.length * ROW + 6;

        body.attr("viewBox", `-4 -2 ${W + 8} ${H + 2}`);

        rowSel
            .classed("hidden", d => !index.has(d.country))
            .classed("zebra", d => index.has(d.country) && Math.floor(index.get(d.country) / 5) % 2 === 1)
            .transition()
            .duration(duration)
            .attr("transform", d => `translate(0,${(index.get(d.country) ?? 0) * ROW})`);

        scoreGrid.attr("y1", 0).attr("y2", H - 6);
        rankGrid.attr("y1", 0).attr("y2", H - 6);
        zeroLines.attr("y1", 0).attr("y2", H - 6);

        titleG.classed("sorted", t => t.key === state.sort.key);
        arrows.text(t => t.key !== state.sort.key ? "" : state.sort.dir === t.dir
            ? (t.dir === 1 ? "▲" : "▼") : (t.dir === 1 ? "▼" : "▲"));

        groupTitle.text(state.mode === "average"
            ? "Six factors: how each moves the predicted score vs. the average country"
            : "Six factors: how much each adds to the predicted score above Dystopia");

        d3.select("#equation").call(renderEquation, state.mode, baselines);
        d3.select("#lens-key").call(updateKey, state.mode);

        paintBars(duration);
        paintRows();
        overview.paint();
        readout();
    }

    function tipFor(event, d) {
        const shift = f => state.mode === "average" ? cols[f.key].mean : 0;
        const vs = state.mode === "average" ? "vs average" : "above Dystopia";

        const lines = [
            ["Rank", `${d.rank} (plausibly ${d.rank_lo}–${d.rank_hi})`],
            ["Life evaluation", `${fmt3(d.score)} (95% CI ${fmt3(d.score_lo)}–${fmt3(d.score_hi)})`],
            ["Predicted from six factors", d.predicted == null ? "no data" : d.predicted.toFixed(2)],
            ["Unexplained", d.residual == null ? "no data" : signed(d.residual),
                d.residual == null ? null : d.residual >= 0 ? UP : DOWN]
        ];

        for (const f of FACTORS) {
            const v = d[f.key];
            if (v == null) {
                lines.push([f.name, "no data"]);
            } else {
                const x = v - shift(f);
                lines.push([`${f.name} ${vs}`, signed(x), x >= 0 ? UP : DOWN]);
            }
        }

        const notes = [d.region];
        if (d.doubtful) notes.push(d.doubtful.note);
        if (!d.complete) notes.push("The report leaves this row blank because one factor is missing.");

        showTip(event, d.country, lines, notes.join(" · "));
    }

    update(0);
}

// ---------------------------------------------------------------- equation --

function renderEquation(sel, mode, baselines) {
    const node = sel.node();
    node.textContent = "";

    const lead = document.createElement("span");
    lead.textContent = "For every row: life evaluation = ";

    const base = document.createElement("strong");
    base.textContent = baselines[mode].toFixed(2);

    const what = document.createElement("span");
    what.textContent = mode === "average"
        ? " (the average country’s predicted score)"
        : " (Dystopia: the world’s lowest value of every factor)";

    const rest = document.createElement("span");
    rest.textContent = " + the six factor bars + the unexplained bar.";

    node.append(lead, base, what, rest);
}

// ---------------------------------------------------------------- key --

function drawKey() {
    const items = [
        { id: "up", swatch: UP },
        { id: "down", swatch: DOWN },
        { id: "dot", svg: `<svg width="26" height="12" aria-hidden="true"><line x1="3" x2="23" y1="6" y2="6" stroke="${INK_SOFT}" stroke-width="1.5"/><circle cx="13" cy="6" r="3.6" fill="${INK}" stroke="#fff" stroke-width="1.5"/></svg>`,
            text: "Life evaluation, with its 95% confidence interval" },
        { id: "range", svg: `<svg width="30" height="12" aria-hidden="true"><line x1="3" x2="27" y1="6" y2="6" stroke="${RANGE_GREY}" stroke-width="3" stroke-linecap="round"/><circle cx="11" cy="6" r="2.2" fill="${INK}"/></svg>`,
            text: "Plausible rank: the report's 95% rank range" },
        { id: "hatch", svg: `<svg width="16" height="12" aria-hidden="true"><defs><pattern id="key-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="${DOWN}" opacity="0.22"/><line x1="0" y1="0" x2="0" y2="4" stroke="${DOWN}" stroke-width="2"/></pattern></defs><rect x="1" y="2.5" width="14" height="7" fill="url(#key-hatch)"/></svg>`,
            text: "Doubtful value (see the note †)" },
        { id: "scale", svg: `<svg width="${K + 8}" height="12" aria-hidden="true"><path d="M4,3V9M${K + 4},3V9M4,6H${K + 4}" stroke="${INK_SOFT}" stroke-width="1.2" fill="none"/></svg>`,
            text: "1 ladder point, in every factor column" }
    ];

    const li = d3.select("#lens-key")
        .selectAll("li")
        .data(items)
        .join("li")
        .attr("class", d => `key-${d.id}`);

    li.each(function (d) {
        const el = d3.select(this);
        if (d.swatch) {
            el.append("span").attr("class", "swatch").style("background", d.swatch);
        } else {
            // Static markup written in this file, not data.
            el.append("span").attr("class", "key-glyph").html(d.svg);
        }
        el.append("span").attr("class", "key-text").text(d.text || "");
    });
}

function updateKey(sel, mode) {
    sel.select(".key-up .key-text").text(mode === "average"
        ? "Raises the score: factor above average, or happier than predicted"
        : "Adds to the score above Dystopia, or happier than predicted");
    sel.select(".key-down .key-text").text(mode === "average"
        ? "Lowers the score: factor below average, or less happy than predicted"
        : "Less happy than predicted (only the residual can be negative here)");
}

// ---------------------------------------------------------------- overview --

// A beeswarm of all 147 scores on one axis, so the shape of the distribution —
// the crowded top and the long bottom tail — is visible without scrolling.
function drawOverview(rows, W, state, onPick) {
    const H = 196;
    const top = 44;
    const axisY = H - 46;

    const x = d3.scaleLinear().domain([1, 8]).range([14, W - 14]);

    const svg = d3.select("#overview").classed("loading", false).text("")
        .append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .style("max-width", `${W}px`)
        .attr("role", "img")
        .attr("aria-label", "Beeswarm of the 147 life evaluations. The top 20 countries " +
            "lie within 0.94 points of each other; the bottom 20 spread over 2.86 points.");

    const nodes = rows.map(d => ({ d, x: x(d.score), y: (top + axisY) / 2 }));

    const sim = d3.forceSimulation(nodes)
        .force("x", d3.forceX(n => x(n.d.score)).strength(1))
        .force("y", d3.forceY((top + axisY) / 2).strength(0.06))
        .force("collide", d3.forceCollide(4.6))
        .stop();
    for (let i = 0; i < 240; i++) sim.tick();

    // Axis.
    const axis = svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${axisY + 6})`)
        .call(d3.axisBottom(x).ticks(8).tickSize(4).tickFormat(d3.format("d")));
    axis.select(".domain").attr("stroke", "#c3c2b7");

    svg.append("text")
        .attr("class", "swarm-title")
        .attr("x", W / 2)
        .attr("y", H - 4)
        .attr("text-anchor", "middle")
        .text("Life evaluation, 0–10 ladder, 2023–2025 average");

    // Spread brackets for the top and bottom 20.
    const byRank = [...rows].sort((a, b) => a.rank - b.rank);
    const groups = [
        { rows: byRank.slice(0, 20), label: "Top 20" },
        { rows: byRank.slice(-20), label: "Bottom 20" }
    ];

    const brackets = svg.append("g").attr("class", "spread");
    for (const g of groups) {
        const lo = d3.min(g.rows, d => d.score);
        const hi = d3.max(g.rows, d => d.score);
        const y = 14;
        brackets.append("path")
            .attr("d", `M${x(lo)},${y + 6}V${y}H${x(hi)}V${y + 6}`);
        brackets.append("text")
            .attr("x", (x(lo) + x(hi)) / 2)
            .attr("y", y - 4)
            .attr("text-anchor", "middle")
            .text(`${g.label} span ${(hi - lo).toFixed(2)} points`);
    }

    const dots = svg.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("cx", n => n.x)
        .attr("cy", n => n.y)
        .attr("r", 4)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.2);

    const labels = svg.append("g").attr("class", "swarm-labels");

    // Nearest-dot hover, so the pointer only has to be close, not on a 8px dot.
    const delaunay = d3.Delaunay.from(nodes, n => n.x, n => n.y);
    const ring = svg.append("circle")
        .attr("r", 6.5)
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
            ], `${n.d.region} · click to pin and jump to its row`);
        })
        .on("pointerleave", () => {
            ring.attr("opacity", 0);
            hideTip();
        })
        .on("click", event => {
            const n = nearest(event);
            if (n) onPick(n.d);
        });

    function paint() {
        const filtered = state.region !== "all";
        dots
            .attr("fill", n => state.pinned.has(n.d.country) ? INK
                : filtered ? (n.d.region === state.region ? INK_SOFT : "#e1e0d9")
                    : "#aeaca4")
            .attr("r", n => state.pinned.has(n.d.country) ? 4.8 : 4);

        dots.filter(n => state.pinned.has(n.d.country)).raise();

        // Labels for pinned countries, alternating above and below the swarm so
        // neighbours do not collide.
        const pinned = nodes.filter(n => state.pinned.has(n.d.country))
            .sort((a, b) => a.x - b.x);

        labels.selectAll("g")
            .data(pinned, n => n.d.country)
            .join(enter => {
                const g = enter.append("g");
                g.append("line").attr("stroke", INK).attr("stroke-width", 1);
                g.append("text").attr("text-anchor", "middle");
                return g;
            })
            .each(function (n, i) {
                const up = i % 2 === 0;
                const ly = up ? top - 6 : axisY - 2;
                const g = d3.select(this);
                g.select("line")
                    .attr("x1", n.x).attr("x2", n.x)
                    .attr("y1", up ? n.y - 5 : n.y + 5)
                    .attr("y2", up ? ly + 3 : ly - 11);
                g.select("text")
                    .attr("x", n.x)
                    .attr("y", ly)
                    .text(n.d.country);
            });
    }

    return { paint };
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
        .data([...rows].sort((a, b) => a.rank - b.rank))
        .join("tr")
        .selectAll("td")
        .data(d => columns.map(c => [c[1](d), c[2]]))
        .join("td")
        .attr("class", c => c[1] ? "num" : null)
        .text(c => c[0]);
}
