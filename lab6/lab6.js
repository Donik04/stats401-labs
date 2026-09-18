// Lab 6 — hierarchical data as trees and treemaps.
//
// Part 1 (assignment): one GDP hierarchy, World > continent > area > country,
// drawn as two treemaps that differ only in tiling. Both hold the encoding
// fixed so the tiling is the only thing that changes between them:
//
//   GDP amount   → rectangle area          (d3.hierarchy().sum())
//   GDP status   → fill colour, diverging  (+ ▲ ● ▼ glyph in the label)
//   continent    → dark framed header strip
//   area         → light framed header strip
//
// The two treemaps share hover (the same country is outlined in both) and
// zoom (clicking zooms both into the same continent).
//
// Part 2 (in-lab Tasks 3–15): a collapsible node-link tree and a zoomable
// treemap of twelve cities, with a switch between the five D3 tilings.

// ---------------------------------------------------------------- palette --

// GDP status is a polarity with a "nothing happened" middle, so it gets a
// diverging pair with a grey midpoint rather than three categorical hues.
// Validated as a set: worst CVD ΔE 19.5 (deutan), normal-vision ΔE 25.8. The
// grey sits at 2.05:1 on the page, which is why every cell with room carries
// a printed label and glyph, and why the table view exists.
const STATUSES = ["Increase", "Unchanged", "Decrease"];

const STATUS_COLOR = {
    Increase: "#2a78d6",
    Unchanged: "#b5b3ab",
    Decrease: "#d03b3b"
};

// Label ink per fill: white clears 4.6:1 on blue and red, dark ink on grey.
const STATUS_INK = {
    Increase: "#ffffff",
    Unchanged: "#0b0b0b",
    Decrease: "#ffffff"
};

const STATUS_GLYPH = {
    Increase: "▲",
    Unchanged: "●",
    Decrease: "▼"
};

// Continent colours for the practice treemap. Task 12 suggests
// d3.schemeTableau10; these are the first three slots of the site's
// categorical palette, which validate all-pairs for colour-blind readers.
const CONTINENT_COLOR = d3.scaleOrdinal()
    .domain(["North America", "Europe", "Asia"])
    .range(["#2a78d6", "#eb6834", "#1baf7a"]);

const INK = "#0b0b0b";
const INK_SOFT = "#52514e";
const CONTINENT_FRAME = "#e4e3dd";
const AREA_FRAME = "#f4f3ef";

const comma = d3.format(",");
const pct = d3.format(".1%");
const billions = v => `$${comma(v)}B`;

// ---------------------------------------------------------------- tooltip --

const tooltip = d3.select("#tooltip");

function showTip(event, html) {
    tooltip.html(html).style("opacity", 1);
    moveTip(event);
}

function moveTip(event) {
    // Flip to the left of the pointer near the right edge so it stays on screen.
    const box = tooltip.node().getBoundingClientRect();
    const flip = event.clientX + 16 + box.width > window.innerWidth;

    tooltip
        .style("left", `${flip ? event.pageX - box.width - 14 : event.pageX + 14}px`)
        .style("top", `${event.pageY + 12}px`);
}

function hideTip() {
    tooltip.style("opacity", 0);
}

// ------------------------------------------------------------ text fitting --

// Put `str` into an SVG text node, shortening it with an ellipsis until it fits
// in `maxWidth`. Leaves the node empty (and returns false) rather than showing
// a one- or two-letter stub that reads as a different word.
function fitText(node, str, maxWidth) {
    node.textContent = str;

    if (maxWidth <= 0) {
        node.textContent = "";
        return false;
    }

    if (node.getComputedTextLength() <= maxWidth) {
        return true;
    }

    for (let n = str.length - 1; n >= 3; n--) {
        node.textContent = `${str.slice(0, n).trimEnd()}…`;

        if (node.getComputedTextLength() <= maxWidth) {
            return true;
        }
    }

    node.textContent = "";
    return false;
}

// ======================================================= Part 1: GDP ======

const GDP_W = 960;
const GDP_H = 560;
const AXIS_H = 70;

// Header strip heights, by what the node is (not its absolute depth), so the
// same rule holds when zoomed into one continent.
const CONTINENT_HEAD = 20;
const AREA_HEAD = 16;

const gdpState = {
    world: null,
    worldTotal: 0,
    continentTotal: new Map(),
    focus: null            // null = World, otherwise a continent name
};

const gdpViews = [
    {
        el: "#treemap-squarify",
        tile: d3.treemapSquarify,
        // Largest first is what lets squarify pack well.
        sort: true,
        axis: false
    },
    {
        el: "#treemap-slicedice",
        tile: d3.treemapSliceDice,
        // Slice-and-dice turns order into reading order, so the data's own
        // alphabetical order is kept: continents and areas are then findable
        // by name, and the three smallest continents do not end up side by
        // side as three slivers.
        sort: false,
        axis: true
    }
];

d3.json("../data/lab6_assignment_gdp.json").then(world => {

    // Stamp each leaf with its continent and area once, so tooltips can name
    // the full path even when a zoomed view no longer contains the World node.
    world.children.forEach(continent => {
        let total = 0;

        continent.children.forEach(area => {
            area.children.forEach(country => {
                country.continent = continent.name;
                country.area = area.name;
                total += country.gdp;
            });
        });

        gdpState.continentTotal.set(continent.name, total);
        gdpState.worldTotal += total;
    });

    gdpState.world = world;

    drawGdpLegend();
    renderGdp();
    drawGdpTable(world);

    d3.selectAll("[data-zoom-out]").on("click", () => zoomGdp(null));

}).catch(error => {
    console.error(error);
    d3.selectAll("#treemap-squarify, #treemap-slicedice")
        .text("Could not load data/lab6_assignment_gdp.json.");
});

function zoomGdp(continent) {
    gdpState.focus = continent;
    hideTip();
    renderGdp();
}

function renderGdp() {
    gdpViews.forEach(drawGdpTreemap);

    const label = gdpState.focus ? `World › ${gdpState.focus}` : "World";

    d3.selectAll("[data-crumb]").text(label);
    d3.selectAll("[data-zoom-out]").property("hidden", !gdpState.focus);
}

function drawGdpTreemap(view) {
    const { world, focus } = gdpState;
    const subtree = focus
        ? world.children.find(c => c.name === focus)
        : world;

    const root = d3.hierarchy(subtree)
        .sum(d => d.children ? 0 : d.gdp);

    if (view.sort) {
        root.sort((a, b) => b.value - a.value);
    }

    d3.treemap()
        .tile(view.tile)
        .size([GDP_W, GDP_H])
        .paddingInner(2)
        .paddingOuter(3)
        .paddingTop(d => {
            if (d.depth === 0) return 3;
            if (d.height === 2) return CONTINENT_HEAD;
            if (d.height === 1) return AREA_HEAD;
            return 0;
        })(root);

    // html("") also clears the "Loading…" text node, which selectAll would miss.
    const container = d3.select(view.el).classed("loading", false).html("");

    const height = GDP_H + (view.axis ? AXIS_H : 0);

    const svg = container.append("svg")
        .attr("viewBox", [0, 0, GDP_W, height])
        .attr("role", "img")
        .attr("aria-label",
            `Treemap of GDP for ${focus || "the world"}, ` +
            `${view.tile === d3.treemapSquarify ? "squarified" : "slice-and-dice"} tiling`);

    const canvas = svg.append("g")
        .attr("class", focus ? "gdp-canvas zoomed" : "gdp-canvas")
        .style("opacity", 0);

    canvas.transition().duration(280).style("opacity", 1);

    // Clicking anywhere zooms into that continent, or back out when zoomed.
    const toggleZoom = (event, d) => {
        zoomGdp(focus ? null : continentOf(d));
    };

    // --- frames: continents and areas, drawn behind the countries.

    const frames = canvas.append("g")
        .selectAll("g")
        .data(root.descendants().filter(d => d.depth > 0 && d.children))
        .join("g")
        .attr("class", d => d.height === 2 ? "gdp-frame continent" : "gdp-frame area")
        .attr("transform", d => `translate(${d.x0},${d.y0})`)
        .on("click", toggleZoom)
        .on("mouseover", (event, d) => showTip(event, frameTip(d)))
        .on("mousemove", moveTip)
        .on("mouseout", hideTip);

    frames.append("rect")
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("rx", 3)
        .attr("fill", d => d.height === 2 ? CONTINENT_FRAME : AREA_FRAME);

    frames.append("text")
        .attr("class", d => d.height === 2 ? "frame-label continent" : "frame-label area")
        .attr("x", 5)
        .attr("y", d => d.height === 2 ? 14 : 11.5)
        .each(function(d) {
            const width = d.x1 - d.x0 - 10;
            const full = d.height === 2
                ? `${d.data.name}  ${billions(d.value)}`
                : d.data.name;

            // Try name + total first; fall back to the name alone.
            if (!fitText(this, full, width) || this.textContent.endsWith("…")) {
                fitText(this, d.data.name, width);
            }
        });

    // --- leaves: one rectangle per country.

    const leaves = canvas.append("g")
        .selectAll("g")
        .data(root.leaves())
        .join("g")
        .attr("class", "gdp-leaf")
        .attr("transform", d => `translate(${d.x0},${d.y0})`)
        .on("click", toggleZoom)
        .on("mouseover", function(event, d) {
            d3.selectAll(".gdp-leaf")
                .classed("linked", n => n.data.name === d.data.name)
                .filter(n => n.data.name === d.data.name)
                .raise();
            showTip(event, leafTip(d));
        })
        .on("mousemove", moveTip)
        .on("mouseout", () => {
            d3.selectAll(".gdp-leaf").classed("linked", false);
            hideTip();
        });

    leaves.append("rect")
        .attr("width", d => Math.max(0, d.x1 - d.x0))
        .attr("height", d => Math.max(0, d.y1 - d.y0))
        .attr("rx", 2)
        .attr("fill", d => STATUS_COLOR[d.data.status]);

    leaves.append("text")
        .attr("class", "leaf-name")
        .attr("x", 5)
        .attr("y", 15)
        .attr("fill", d => STATUS_INK[d.data.status])
        .each(function(d) {
            if (d.y1 - d.y0 >= 20) fitText(this, d.data.name, d.x1 - d.x0 - 9);
        });

    leaves.append("text")
        .attr("class", "leaf-value")
        .attr("x", 5)
        .attr("y", 29)
        .attr("fill", d => STATUS_INK[d.data.status])
        .each(function(d) {
            const w = d.x1 - d.x0 - 9;

            if (d.y1 - d.y0 < 34) return;

            // Glyph + value, then glyph alone: status should survive the
            // narrowest cells that still have a label at all.
            if (!fitText(this, `${STATUS_GLYPH[d.data.status]} ${billions(d.data.gdp)}`, w)
                || this.textContent.endsWith("…")) {
                fitText(this, STATUS_GLYPH[d.data.status], w);
            }
        });

    if (view.axis) {
        drawGroupAxis(svg, root);
    }
}

// Labels the top-level groups (continents, or areas when zoomed) as brackets
// under the slice-and-dice treemap. Labels go on the first row where they do
// not collide, with a leader line down from the bracket when pushed lower.
function drawGroupAxis(svg, root) {
    const axis = svg.append("g")
        .attr("class", "group-axis")
        .attr("transform", `translate(0,${GDP_H + 6})`);

    const rowEnds = [];
    const ROW_Y = [26, 44, 62];

    root.children.forEach(d => {
        const g = axis.append("g");
        const x0 = d.x0 + 1;
        const x1 = d.x1 - 1;
        const cx = (x0 + x1) / 2;

        g.append("path")
            .attr("class", "bracket")
            .attr("d", `M${x0},0 V6 H${x1} V0`);

        const text = g.append("text")
            .attr("class", "axis-name")
            .text(d.data.name);

        const width = text.node().getComputedTextLength();
        const left = Math.max(0, Math.min(GDP_W - width, cx - width / 2));

        let row = rowEnds.findIndex(end => left > end + 10);
        if (row === -1) row = rowEnds.length;
        row = Math.min(row, ROW_Y.length - 1);
        rowEnds[row] = left + width;

        text.attr("x", left).attr("y", ROW_Y[row]);

        g.append("line")
            .attr("class", "leader")
            .attr("x1", cx).attr("x2", cx)
            .attr("y1", 6).attr("y2", ROW_Y[row] - 12);
    });
}

function continentOf(node) {
    // Zoomed views are rooted at the continent itself.
    if (gdpState.focus) return gdpState.focus;

    return node.ancestors().find(a => a.depth === 1).data.name;
}

function leafTip(d) {
    const c = d.data;
    const continentTotal = gdpState.continentTotal.get(c.continent);

    return `
        <strong>${c.name}</strong><br>
        <span class="tip-path">${c.continent} › ${c.area}</span><br>
        GDP: <strong>${billions(c.gdp)}</strong><br>
        ${pct(c.gdp / gdpState.worldTotal)} of world ·
        ${pct(c.gdp / continentTotal)} of ${c.continent}<br>
        <span class="tip-swatch" style="background:${STATUS_COLOR[c.status]}"></span>
        ${STATUS_GLYPH[c.status]} GDP ${c.status.toLowerCase()}${c.status === "Unchanged" ? "" : "d"}
    `;
}

function frameTip(d) {
    const countries = d.leaves();
    const counts = d3.rollup(countries, v => v.length, n => n.data.status);
    const statusLine = STATUSES
        .filter(s => counts.has(s))
        .map(s => `${STATUS_GLYPH[s]} ${counts.get(s)} ${s.toLowerCase()}`)
        .join(" · ");
    const kind = d.height === 2 ? "Continent" : `Area in ${countries[0].data.continent}`;

    return `
        <strong>${d.data.name}</strong><br>
        <span class="tip-path">${kind}</span><br>
        GDP: <strong>${billions(d.value)}</strong>
        (${pct(d.value / gdpState.worldTotal)} of world)<br>
        ${countries.length} ${countries.length === 1 ? "country" : "countries"}: ${statusLine}<br>
        <span class="tip-path">Click to ${gdpState.focus ? "return to World" : "zoom in"}</span>
    `;
}

function drawGdpLegend() {
    const legend = d3.select("#gdp-legend");

    const status = legend.append("div").attr("class", "legend-block");
    status.append("span").attr("class", "legend-label").text("GDP status (fill)");

    const rows = status.append("div").attr("class", "legend-rows");

    STATUSES.forEach(s => {
        const row = rows.append("div").attr("class", "legend-swatch-row static");

        row.append("span")
            .attr("class", "status-chip")
            .style("background", STATUS_COLOR[s])
            .style("color", STATUS_INK[s])
            .text(STATUS_GLYPH[s]);

        row.append("span").text(s);
    });

    const size = legend.append("div").attr("class", "legend-block");
    size.append("span").attr("class", "legend-label").text("GDP amount (area)");

    // Three reference squares at true treemap scale for squarify at full
    // width: side = sqrt(value / world × plot area).
    const plotArea = GDP_W * GDP_H;
    const refs = [250, 1000, 4000];
    const sides = refs.map(v => Math.sqrt(v / gdpState.worldTotal * plotArea));

    const svg = size.append("svg")
        .attr("width", d3.sum(sides) + 16 * refs.length + 40)
        .attr("height", d3.max(sides) + 18);

    let x = 0;
    refs.forEach((v, i) => {
        const s = sides[i];
        svg.append("rect")
            .attr("x", x).attr("y", d3.max(sides) - s)
            .attr("width", s).attr("height", s)
            .attr("rx", 2)
            .attr("fill", "none")
            .attr("stroke", INK_SOFT);
        svg.append("text")
            .attr("class", "legend-tick")
            .attr("x", x).attr("y", d3.max(sides) + 13)
            .text(billions(v));
        x += s + 28;
    });

    size.append("span")
        .attr("class", "legend-note")
        .text("at full treemap scale, World view");

    const frame = legend.append("div").attr("class", "legend-block");
    frame.append("span").attr("class", "legend-label").text("Hierarchy (frames)");

    const frameRows = frame.append("div").attr("class", "legend-rows");

    [["Continent", CONTINENT_FRAME], ["Area within continent", AREA_FRAME]].forEach(([name, fill]) => {
        const row = frameRows.append("div").attr("class", "legend-swatch-row static");
        row.append("span")
            .attr("class", "frame-chip")
            .style("background", fill);
        row.append("span").text(name);
    });
}

function drawGdpTable(world) {
    const rows = [];

    world.children.forEach(c => c.children.forEach(a => a.children.forEach(n => rows.push(n))));
    rows.sort((a, b) => b.gdp - a.gdp);

    const table = d3.select("#gdp-table");

    table.select("thead").append("tr")
        .selectAll("th")
        .data(["Country", "Continent", "Area", "GDP (billion USD)", "Share of world", "GDP status"])
        .join("th")
        .attr("class", (d, i) => i === 3 || i === 4 ? "num" : null)
        .text(d => d);

    const tr = table.select("tbody")
        .selectAll("tr")
        .data(rows)
        .join("tr");

    tr.append("td").text(d => d.name);
    tr.append("td").text(d => d.continent);
    tr.append("td").text(d => d.area);
    tr.append("td").attr("class", "num").text(d => comma(d.gdp));
    tr.append("td").attr("class", "num").text(d => pct(d.gdp / gdpState.worldTotal));
    tr.append("td").html(d =>
        `<span class="tip-swatch" style="background:${STATUS_COLOR[d.status]}"></span>` +
        `${STATUS_GLYPH[d.status]} ${d.status}`);
}

// ================================================= Part 2: practice =======

// Task 3 — load the hierarchical JSON.
d3.json("../data/lab6_small_hierarchy.json").then(data => {

    console.log(data);

    // Task 4 — a D3 hierarchy wraps every object with data, parent,
    // children, depth and height.
    const root = d3.hierarchy(data);
    console.log(root);
    console.log(root.descendants());

    // Task 5 — values are summed upward: Japan = Tokyo + Osaka = 16,750.
    root.sum(d => d.value || 0);
    console.log(root.value);

    d3.select("#root-value").text(comma(root.value));

    drawPracticeTree(root);
    drawPracticeTreemap(data);

}).catch(error => {
    console.error(error);
    d3.selectAll("#tree, #treemap")
        .text("Could not load data/lab6_small_hierarchy.json.");
});

// ----------------------------------------------- Tasks 6–9: node-link tree --

function drawPracticeTree(root) {
    const width = 960;
    const height = 520;
    const margin = { top: 20, right: 170, bottom: 20, left: 70 };

    d3.select("#tree").classed("loading", false).html("");

    const treeSvg = d3.select("#tree")
        .append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("role", "img")
        .attr("aria-label", "Collapsible tree of the World city hierarchy");

    const treeGroup = treeSvg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const linkLayer = treeGroup.append("g");
    const nodeLayer = treeGroup.append("g");

    // Task 6 — the layout: x runs down the page (breadth), y across (depth).
    const treeLayout = d3.tree()
        .size([
            height - margin.top - margin.bottom,
            width - margin.left - margin.right
        ]);

    const linkPath = d3.linkHorizontal()
        .x(d => d.y)
        .y(d => d.x);

    // d.leaves() only follows `children`, so a collapsed node has to be
    // counted through the stashed `_children` as well.
    const countCities = d => {
        const kids = d.children || d._children;
        return kids ? d3.sum(kids, countCities) : 1;
    };

    // Stable ids so the joins below track the same node across collapses.
    root.descendants().forEach((d, i) => { d.id = i; });

    // Task 9 — hide or show a node's children, then redraw from that node.
    function toggleNode(event, d) {
        if (!d.children && !d._children) return;

        if (d.children) {
            d._children = d.children;
            d.children = null;
        } else {
            d.children = d._children;
            d._children = null;
        }

        updateTree(d);
    }

    function updateTree(source) {
        treeLayout(root);

        const t = treeSvg.transition().duration(450);
        const from = { x: source.x0 ?? source.x, y: source.y0 ?? source.y };
        const to = { x: source.x, y: source.y };

        // Task 7 — links, keyed by their child end.
        linkLayer.selectAll(".link")
            .data(root.links(), d => d.target.id)
            .join(
                enter => enter.append("path")
                    .attr("class", "link")
                    .attr("d", linkPath({ source: from, target: from })),
                update => update,
                exit => exit.transition(t)
                    .attr("d", linkPath({ source: to, target: to }))
                    .remove()
            )
            .transition(t)
            .attr("d", linkPath);

        // Task 8 — nodes: a circle and a label in a positioned group.
        const nodes = nodeLayer.selectAll(".node")
            .data(root.descendants(), d => d.id)
            .join(
                enter => {
                    const g = enter.append("g")
                        .attr("class", "node")
                        .attr("transform", `translate(${from.y},${from.x})`)
                        .style("opacity", 0);

                    g.append("circle");
                    g.append("text").attr("dy", "0.35em");

                    return g;
                },
                update => update,
                exit => exit.transition(t)
                    .attr("transform", `translate(${to.y},${to.x})`)
                    .style("opacity", 0)
                    .remove()
            )
            .on("click", toggleNode);

        nodes.classed("branch", d => d.children || d._children)
            .transition(t)
            .attr("transform", d => `translate(${d.y},${d.x})`)
            .style("opacity", 1);

        nodes.select("circle")
            .attr("r", d => d._children ? 9 : 6)
            .attr("fill", d => d.children || d._children ? "steelblue" : "orange")
            .attr("stroke", d => d._children ? INK : "#ffffff")
            .attr("stroke-width", d => d._children ? 1.5 : 1);

        // Leaves label to the right with their value; branches to the left.
        nodes.select("text")
            .attr("x", d => d.children ? -12 : 13)
            .attr("text-anchor", d => d.children ? "end" : "start")
            .text(d => {
                if (!d.children && !d._children) {
                    return `${d.data.name}  ${comma(d.value)}k`;
                }
                if (d._children) {
                    const hidden = countCities(d);
                    return `${d.data.name}  (+${hidden} ${hidden === 1 ? "city" : "cities"})`;
                }
                return d.data.name;
            });

        root.each(d => { d.x0 = d.x; d.y0 = d.y; });
    }

    function setCollapsed(depth) {
        root.each(d => {
            const kids = d.children || d._children;
            if (!kids) return;
            if (depth !== null && d.depth >= depth) {
                d._children = kids;
                d.children = null;
            } else {
                d.children = kids;
                d._children = null;
            }
        });
        updateTree(root);
    }

    d3.select("#tree-expand").on("click", () => setCollapsed(null));
    d3.select("#tree-collapse").on("click", () => setCollapsed(2));

    const legend = d3.select("#tree-legend").append("div").attr("class", "legend-rows horizontal");
    [
        ["steelblue", "#ffffff", 6, "Group (click to collapse)"],
        ["steelblue", INK, 9, "Collapsed group"],
        ["orange", "#ffffff", 6, "City (population, thousands)"]
    ].forEach(([fill, stroke, r, label]) => {
        const row = legend.append("div").attr("class", "legend-swatch-row static");
        row.append("svg").attr("width", 22).attr("height", 22)
            .append("circle")
            .attr("cx", 11).attr("cy", 11).attr("r", r)
            .attr("fill", fill).attr("stroke", stroke).attr("stroke-width", 1.5);
        row.append("span").text(label);
    });

    updateTree(root);
}

// --------------------------------------------- Tasks 10–15: treemap + zoom --

const TILES = {
    squarify: d3.treemapSquarify,
    binary: d3.treemapBinary,
    slice: d3.treemapSlice,
    dice: d3.treemapDice,
    sliceDice: d3.treemapSliceDice
};

function drawPracticeTreemap(data) {
    const treemapWidth = 960;
    const treemapHeight = 520;

    // Task 10 — a fresh hierarchy, summed and sorted largest first.
    const treemapRoot = d3.hierarchy(data)
        .sum(d => d.value || 0)
        .sort((a, b) => b.value - a.value);

    const treemapLayout = d3.treemap()
        .size([treemapWidth, treemapHeight])
        .paddingInner(2)
        .paddingOuter(4);

    treemapLayout(treemapRoot);

    // Task 12 — the continent is the ancestor at depth 1.
    function getContinent(d) {
        let current = d;
        while (current.depth > 1) {
            current = current.parent;
        }
        return current.data.name;
    }

    // Task 14 — zooming rescales layout coordinates into the full view.
    const x = d3.scaleLinear().domain([0, treemapWidth]).range([0, treemapWidth]);
    const y = d3.scaleLinear().domain([0, treemapHeight]).range([0, treemapHeight]);

    let focus = treemapRoot;

    d3.select("#treemap").classed("loading", false).html("");

    // Task 11 — the SVG, one group per leaf.
    const treemapSvg = d3.select("#treemap")
        .append("svg")
        .attr("class", "clipped")
        .attr("viewBox", [0, 0, treemapWidth, treemapHeight])
        .attr("role", "img")
        .attr("aria-label", "Treemap of city population, coloured by continent");

    const leaves = treemapRoot.leaves();

    const cells = treemapSvg.selectAll(".cell")
        .data(leaves)
        .join("g")
        .attr("class", "cell");

    cells.append("rect")
        .attr("rx", 2)
        .attr("fill", d => CONTINENT_COLOR(getContinent(d)));

    cells.append("text").attr("class", "leaf-name").attr("x", 6).attr("y", 18).attr("fill", INK);
    cells.append("text").attr("class", "leaf-value").attr("x", 6).attr("y", 33).attr("fill", INK);

    // Task 13 — tooltips.
    cells
        .on("mouseover", (event, d) => {
            const path = d.ancestors().reverse().slice(1, -1).map(a => a.data.name).join(" › ");
            showTip(event, `
                <strong>${d.data.name}</strong><br>
                <span class="tip-path">${path}</span><br>
                Population: <strong>${comma(d.value)}</strong> thousand<br>
                ${pct(d.value / focus.value)} of ${focus.data.name}
            `);
        })
        .on("mousemove", moveTip)
        .on("mouseout", hideTip)
        .on("click", (event, d) => {
            // Zoom one level below the current focus, toward the clicked city;
            // at the deepest group level a click goes back to the World.
            const next = d.ancestors().find(a => a.depth === focus.depth + 1);
            zoomTo(next && next.children ? next : treemapRoot);
        });

    function place(duration) {
        const w = n => Math.max(0, x(n.x1) - x(n.x0));
        const h = n => Math.max(0, y(n.y1) - y(n.y0));

        const t = cells.transition().duration(duration);

        t.attr("transform", n => `translate(${x(n.x0)},${y(n.y0)})`);

        t.select("rect")
            .attr("width", w)
            .attr("height", h);

        // Labels are re-fitted after the move, against the final sizes.
        t.end().catch(() => {}).then(() => {
            cells.select(".leaf-name").each(function(n) {
                this.textContent = "";
                if (h(n) >= 24) fitText(this, n.data.name, w(n) - 10);
            });
            cells.select(".leaf-value").each(function(n) {
                this.textContent = "";
                if (h(n) >= 40) fitText(this, `${comma(n.value)}k`, w(n) - 10);
            });
        });
    }

    function zoomTo(d) {
        focus = d;

        x.domain([d.x0, d.x1]);
        y.domain([d.y0, d.y1]);

        place(600);

        const crumb = d.ancestors().reverse().map(a => a.data.name).join(" › ");
        d3.select("#practice-crumb").text(crumb);
        d3.select("#practice-zoom-out").property("hidden", d === treemapRoot);
    }

    d3.select("#practice-zoom-out").on("click", () => {
        if (focus.parent) zoomTo(focus.parent);
    });

    // Task 15 — same hierarchy, same values, different cutting.
    d3.select("#tile-toggle").selectAll("button").on("click", function() {
        d3.select("#tile-toggle").selectAll("button").classed("active", false);
        d3.select(this).classed("active", true);

        treemapLayout.tile(TILES[this.dataset.tile]);
        treemapLayout(treemapRoot);

        // Keep the current zoom: re-read its new rectangle.
        zoomTo(focus);
    });

    const legend = d3.select("#treemap-legend").append("div").attr("class", "legend-rows horizontal");
    CONTINENT_COLOR.domain().forEach(name => {
        const row = legend.append("div").attr("class", "legend-swatch-row static");
        row.append("span").attr("class", "frame-chip").style("background", CONTINENT_COLOR(name));
        row.append("span").text(name);
    });

    zoomTo(treemapRoot);
}
