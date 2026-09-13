// Lab 5 — a 50-station synthetic transit network drawn twice: once as a
// force-directed node-link diagram, once as an adjacency matrix built from the
// same two files.
//
// Encoding budget, decided once and held to across both views:
//
//   node-link          matrix
//   ---------          ------
//   district  → colour   district → row/column ordering (+ block swatch)
//   passengers→ area     passengers → margin bar
//   type      → shape    type     → margin glyph (same three shapes)
//   travel    → width    travel   → cell size      (both: more minutes = more ink)
//   route     → dash     route    → cell colour
//
// Each figure therefore carries exactly one colour scale: district in the
// node-link view, route type in the matrix.

// ---------------------------------------------------------------- palette --

// Five district hues, validated as a set for all-pairs separation (worst pair
// ΔE 13.0 under simulated protanopia, 16.3 unsimulated). Yellow and magenta sit
// below 3:1 on white, which is why every node also carries a printed number and
// why the table view exists.
const DISTRICTS = ["Central", "North", "South", "East", "West"];

const DISTRICT_COLOR = {
    Central: "#2a78d6",
    North: "#eda100",
    South: "#e87ba4",
    East: "#008300",
    West: "#4a3aa7"
};

// Station type gets shape, never colour, so a station's role never competes
// with the district it sits in.
const STATION_TYPES = ["Terminal", "Transfer", "Local"];

const TYPE_SYMBOL = {
    Terminal: d3.symbolTriangle,
    Transfer: d3.symbolSquare,
    Local: d3.symbolCircle
};

// Route type: dash pattern in the node-link view (where colour is spoken for),
// hue in the matrix (where district has moved onto position). These three hues
// are a separate validated set — worst pair ΔE 9.2 protan, 27.6 unsimulated.
const ROUTE_TYPES = ["Metro", "Express", "Shuttle"];

const ROUTE_DASH = {
    Metro: null,
    Express: "7,4",
    Shuttle: "1,3.5"
};

const ROUTE_COLOR = {
    Metro: "#eb6834",
    Express: "#1baf7a",
    Shuttle: "#4a3aa7"
};

// Ink, never a data colour, for anything that is text or chrome.
const INK = "#0b0b0b";
const INK_SOFT = "#52514e";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const RULE = "#c3c2b7";
const SURFACE = "#ffffff";
const FIELD = "#fbfbfa";

const comma = d3.format(",");

const tooltip = d3.select("body").append("div").attr("class", "tooltip");

function showTip(event, html) {
    tooltip.html(html)
        .style("left", `${event.pageX + 14}px`)
        .style("top", `${event.pageY - 12}px`)
        .style("opacity", 1);
}

function hideTip() {
    tooltip.style("opacity", 0);
}

// One symbol generator, reused for the nodes, the legend and the matrix
// margins, so a Transfer square is the same square everywhere on the page.
function symbolPath(type, area) {
    return d3.symbol().type(TYPE_SYMBOL[type]).size(area)();
}

// ------------------------------------------------------------------- load --

Promise.all([
    d3.csv("../data/lab5_assignment_stations.csv", d => ({
        id: d.id,
        station_name: d.station_name,
        district: d.district,
        daily_passengers: +d.daily_passengers,
        station_type: d.station_type
    })),
    d3.csv("../data/lab5_assignment_routes.csv", d => ({
        source: d.source,
        target: d.target,
        travel_time_min: +d.travel_time_min,
        route_type: d.route_type
    }))
]).then(([stations, routes]) => {

    // Degree and neighbour sets are read straight off the link table. They are
    // not encoded as variables anywhere — they only feed the tooltips and the
    // written findings.
    const byId = new Map(stations.map(d => [d.id, d]));
    const neighbours = new Map(stations.map(d => [d.id, new Set()]));

    routes.forEach(r => {
        neighbours.get(r.source).add(r.target);
        neighbours.get(r.target).add(r.source);
    });

    stations.forEach(d => {
        d.degree = neighbours.get(d.id).size;
    });

    const passengerExtent = d3.extent(stations, d => d.daily_passengers);
    const travelExtent = d3.extent(routes, d => d.travel_time_min);

    drawNetwork(stations, routes, byId, neighbours, passengerExtent, travelExtent);
    drawMatrix(stations, routes, byId, neighbours, passengerExtent, travelExtent);
    drawLinksTable(routes, byId);
    writeFindings(stations, routes, byId, neighbours);
});

// =========================================================== node-link view ==

function drawNetwork(stations, routes, byId, neighbours, passengerExtent, travelExtent) {

    const width = 940;
    const height = 760;
    const pad = 32;

    // Five stations have no connection at all. Left to the simulation they
    // drift in among the linked ones and read as part of the structure, so they
    // get a labelled strip along the bottom instead — which is also what makes
    // "unconnected" visible rather than something you have to notice.
    const trayTop = height - 74;
    const trayY = height - 40;

    // Area is what the eye reads as magnitude, so passengers drive the radius
    // through a square-root scale and the symbol is sized by the resulting area.
    const radius = d3.scaleSqrt().domain(passengerExtent).range([5, 15]);
    const nodeArea = d => Math.PI * radius(d.daily_passengers) ** 2;

    // More minutes, more ink — and more distance. Width and the simulation's
    // target link length both run the same way.
    const linkWidth = d3.scaleLinear().domain(travelExtent).range([1.4, 5]);
    // Tuned against this network's shape: 40 of the 50 links form one long
    // chain, so the range sets how much canvas that chain ends up filling.
    const linkDistance = d3.scaleLinear().domain(travelExtent).range([34, 88]);

    // The simulation mutates its input, so it gets its own copies and the
    // matrix keeps the untouched rows.
    const nodes = stations.map(d => ({ ...d }));
    const links = routes.map(d => ({ ...d }));

    const svg = d3.select("#network")
        .classed("loading", false)
        .html("")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label",
            "Force-directed diagram of 50 transit stations and 50 direct connections");

    const trayLayer = svg.append("g").attr("class", "tray");
    const linkLayer = svg.append("g").attr("class", "links");
    const nodeLayer = svg.append("g").attr("class", "nodes");
    const labelLayer = svg.append("g").attr("class", "node-labels");

    const isolates = nodes.filter(d => d.degree === 0);
    const traySlot = new Map(isolates.map((d, i) => [d.id, i]));
    const traySpan = 96;
    const trayX0 = width / 2 - ((isolates.length - 1) * traySpan) / 2;

    trayLayer.append("line")
        .attr("class", "tray-rule")
        .attr("x1", 0).attr("x2", width)
        .attr("y1", trayTop).attr("y2", trayTop);

    // Right-aligned so it clears the strip's own symbols, which are centred.
    trayLayer.append("text")
        .attr("class", "tray-label")
        .attr("x", width - 2).attr("y", trayTop + 17)
        .attr("text-anchor", "end")
        .text(`No direct connection to anything (${isolates.length} stations)`);

    const link = linkLayer.selectAll("line")
        .data(links)
        .join("line")
        .attr("class", "net-link")
        .attr("stroke", INK_SOFT)
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", d => linkWidth(d.travel_time_min))
        .attr("stroke-linecap", d => d.route_type === "Shuttle" ? "round" : "butt")
        .attr("stroke-dasharray", d => ROUTE_DASH[d.route_type]);

    const node = nodeLayer.selectAll("path")
        .data(nodes)
        .join("path")
        .attr("class", "net-node")
        .attr("d", d => symbolPath(d.station_type, nodeArea(d)))
        .attr("fill", d => DISTRICT_COLOR[d.district])
        .attr("stroke", SURFACE)
        .attr("stroke-width", 1.5);

    // The printed number is the relief for the two district hues that sit below
    // 3:1 on white, and it is what makes an individual station identifiable.
    const label = labelLayer.selectAll("text")
        .data(nodes)
        .join("text")
        .attr("class", "net-label")
        .text(d => d.id.replace("s", ""));

    // ---- forces. Both layouts are the same simulation; only the positioning
    // forces differ, so switching modes re-settles rather than redraws.

    // Laid out as a compass, because these district names are geographic: North
    // above, South below, East and West to the sides, Central in the middle.
    //
    const anchors = {
        Central: { x: width / 2, y: height * 0.47 },
        North: { x: width / 2, y: height * 0.11 },
        South: { x: width / 2, y: height * 0.87 },
        East: { x: width * 0.86, y: height * 0.47 },
        West: { x: width * 0.14, y: height * 0.47 }
    };

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links)
            .id(d => d.id)
            .distance(d => linkDistance(d.travel_time_min))
            .strength(0.6))
        .force("charge", d3.forceManyBody().strength(-175))
        .force("collide", d3.forceCollide(d => radius(d.daily_passengers) + 10));

    // The tray only exists in the free layout; the clamp in the tick handler
    // reads this to decide which band each node is allowed into.
    let trayActive = true;

    function applyLayout(mode) {
        trayActive = mode !== "district";
        if (mode === "district") {
            // District membership moves onto position, so colour becomes
            // redundant reinforcement rather than the only way to read it.
            trayLayer.attr("opacity", 0);
            // Every link in this network joins two different districts, so at
            // full strength the links simply drag the five groups back into one
            // heap. This layout is about membership, not topology, so the links
            // give way and the anchors win.
            simulation.force("link").strength(0.12);
            simulation
                .force("charge", d3.forceManyBody().strength(-190))
                .force("x", d3.forceX(d => anchors[d.district].x).strength(0.45))
                .force("y", d3.forceY(d => anchors[d.district].y).strength(0.45));

            // A point anchor would stack ten symbols on one spot, and loosening
            // the anchor lets the districts bleed into each other. Widening the
            // collision instead spreads a district out locally while the anchor
            // still holds it in its own corner of the compass.
            simulation.force("collide").radius(d => radius(d.daily_passengers) + 19);
        } else {
            // Connected stations are centred in the space above the tray;
            // unconnected ones are held in it.
            trayLayer.attr("opacity", 1);
            simulation.force("link").strength(0.6);
            simulation.force("collide").radius(d => radius(d.daily_passengers) + 10);
            simulation
                .force("charge", d3.forceManyBody().strength(-175))
                .force("x", d3.forceX(d => d.degree === 0
                    ? trayX0 + traySlot.get(d.id) * traySpan
                    : width / 2).strength(d => d.degree === 0 ? 0.6 : 0.055))
                .force("y", d3.forceY(d => d.degree === 0
                    ? trayY
                    : trayTop / 2).strength(d => d.degree === 0 ? 0.6 : 0.105));
        }
        simulation.alpha(0.9).restart();
    }

    applyLayout("free");

    simulation.on("tick", () => {
        // Clamped so nothing drifts off the canvas, and so the tray stays a
        // tray: connected stations are kept above the rule, unconnected ones
        // below it. Without this the network sprawls down into the strip and
        // the distinction the strip exists to make is lost.
        nodes.forEach(d => {
            d.x = Math.max(pad, Math.min(width - pad, d.x));
            if (!trayActive) {
                d.y = Math.max(pad, Math.min(height - pad, d.y));
            } else if (d.degree === 0) {
                d.y = Math.max(trayTop + 16, Math.min(height - pad, d.y));
            } else {
                d.y = Math.max(pad, Math.min(trayTop - 20, d.y));
            }
        });

        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node.attr("transform", d => `translate(${d.x},${d.y})`);

        label
            .attr("x", d => d.x + radius(d.daily_passengers) + 4)
            .attr("y", d => d.y + 3.5);
    });

    // ---- dragging

    node.call(d3.drag()
        .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
        })
        .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }));

    // ---- highlighting. Hover is transient; a legend click is sticky, so the
    // two are tracked separately and resolved in one place.

    let pinnedDistrict = null;
    let pinnedRoute = null;
    let hovered = null;

    function nodeVisible(d) {
        if (pinnedDistrict && d.district !== pinnedDistrict) return false;
        if (hovered && d.id !== hovered.id && !neighbours.get(hovered.id).has(d.id)) return false;
        return true;
    }

    function linkVisible(l) {
        if (pinnedRoute && l.route_type !== pinnedRoute) return false;
        if (pinnedDistrict &&
            l.source.district !== pinnedDistrict &&
            l.target.district !== pinnedDistrict) return false;
        if (hovered && l.source.id !== hovered.id && l.target.id !== hovered.id) return false;
        return true;
    }

    function refresh() {
        const quiet = pinnedDistrict || pinnedRoute || hovered;

        node.attr("opacity", d => nodeVisible(d) ? 1 : 0.12);
        label.attr("opacity", d => nodeVisible(d) ? 1 : 0.12);

        link
            .attr("stroke-opacity", l => !linkVisible(l) ? 0.06 : (quiet ? 0.95 : 0.5))
            .attr("stroke", l => (linkVisible(l) && hovered) ? INK : INK_SOFT);

        // Guarded on both sides: a static legend row carries neither attribute,
        // and null === null would otherwise light every one of them up.
        d3.selectAll("#net-legend .legend-swatch-row")
            .classed("pinned", function () {
                const el = d3.select(this);
                return (!!pinnedDistrict && el.attr("data-district") === pinnedDistrict) ||
                    (!!pinnedRoute && el.attr("data-route") === pinnedRoute);
            });
    }

    node
        .on("mouseover", (event, d) => {
            hovered = d;
            refresh();
            const n = d.degree;
            showTip(event, `
                <strong>${d.station_name}</strong><br>
                ${d.district} district &middot; ${d.station_type}<br>
                ${comma(d.daily_passengers)} daily passengers<br>
                ${n === 0 ? "No direct connections" :
                    `${n} direct connection${n === 1 ? "" : "s"}`}
            `);
        })
        .on("mousemove", event => showTip(event, tooltip.html()))
        .on("mouseout", () => {
            hovered = null;
            refresh();
            hideTip();
        });

    link
        .on("mouseover", (event, l) => {
            showTip(event, `
                <strong>${l.source.station_name} &mdash; ${l.target.station_name}</strong><br>
                ${l.route_type} &middot; ${l.travel_time_min} min<br>
                ${l.source.district} &rarr; ${l.target.district}
            `);
        })
        .on("mousemove", event => showTip(event, tooltip.html()))
        .on("mouseout", hideTip);

    // ---- legend, doubling as the filter

    buildNetLegend(passengerExtent, travelExtent, radius, linkWidth, {
        onDistrict(name) {
            pinnedDistrict = pinnedDistrict === name ? null : name;
            refresh();
        },
        onRoute(name) {
            pinnedRoute = pinnedRoute === name ? null : name;
            refresh();
        }
    });

    d3.select("#net-reset").on("click", () => {
        pinnedDistrict = null;
        pinnedRoute = null;
        hovered = null;
        refresh();
    });

    d3.selectAll("#layout-toggle button").on("click", function () {
        const mode = this.dataset.layout;
        d3.selectAll("#layout-toggle button").classed("active", false);
        d3.select(this).classed("active", true);
        applyLayout(mode);
    });

    refresh();
}

// ------------------------------------------------------------- net legend --

function buildNetLegend(passengerExtent, travelExtent, radius, linkWidth, handlers) {

    const root = d3.select("#net-legend").html("");

    // District — clickable, colour swatch drawn as the shape it will appear as.
    const districtBlock = root.append("div").attr("class", "legend-block");
    districtBlock.append("span").attr("class", "legend-label").text("District (node colour)");
    const dRows = districtBlock.append("div").attr("class", "legend-rows");

    DISTRICTS.forEach(name => {
        const row = dRows.append("button")
            .attr("type", "button")
            .attr("class", "legend-swatch-row")
            .attr("data-district", name)
            .on("click", () => handlers.onDistrict(name));

        row.append("svg").attr("width", 16).attr("height", 16)
            .append("circle")
            .attr("cx", 8).attr("cy", 8).attr("r", 6)
            .attr("fill", DISTRICT_COLOR[name]);

        row.append("span").text(name);
    });

    // Station type — shape only, drawn in ink so it reads as a shape key and
    // not as another colour scale.
    const typeBlock = root.append("div").attr("class", "legend-block");
    typeBlock.append("span").attr("class", "legend-label").text("Station type (node shape)");
    const tRows = typeBlock.append("div").attr("class", "legend-rows");

    STATION_TYPES.forEach(name => {
        const row = tRows.append("div").attr("class", "legend-swatch-row static");
        row.append("svg").attr("width", 16).attr("height", 16)
            .append("path")
            .attr("transform", "translate(8,8)")
            .attr("d", symbolPath(name, 78))
            .attr("fill", INK_SOFT);
        row.append("span").text(name);
    });

    // Route type — clickable, shown as the line it will appear as.
    const routeBlock = root.append("div").attr("class", "legend-block");
    routeBlock.append("span").attr("class", "legend-label").text("Route type (line pattern)");
    const rRows = routeBlock.append("div").attr("class", "legend-rows");

    ROUTE_TYPES.forEach(name => {
        const row = rRows.append("button")
            .attr("type", "button")
            .attr("class", "legend-swatch-row")
            .attr("data-route", name)
            .on("click", () => handlers.onRoute(name));

        row.append("svg").attr("width", 30).attr("height", 16)
            .append("line")
            .attr("x1", 1).attr("y1", 8).attr("x2", 29).attr("y2", 8)
            .attr("stroke", INK_SOFT)
            .attr("stroke-width", 2.4)
            .attr("stroke-linecap", name === "Shuttle" ? "round" : "butt")
            .attr("stroke-dasharray", ROUTE_DASH[name]);

        row.append("span").text(name);
    });

    // Daily passengers — three nested sizes rather than a continuous ramp,
    // because area is read as a ranking here, not as a number.
    const sizeBlock = root.append("div").attr("class", "legend-block");
    sizeBlock.append("span").attr("class", "legend-label").text("Daily passengers (node area)");

    const sizeSvg = sizeBlock.append("svg").attr("width", 150).attr("height", 42);
    const sizeStops = [passengerExtent[0], d3.mean(passengerExtent), passengerExtent[1]];

    sizeStops.forEach((v, i) => {
        const cx = 20 + i * 50;
        sizeSvg.append("circle")
            .attr("cx", cx).attr("cy", 17).attr("r", radius(v))
            .attr("fill", "none").attr("stroke", MUTED).attr("stroke-width", 1.2);
        sizeSvg.append("text")
            .attr("class", "legend-tick")
            .attr("x", cx).attr("y", 39)
            .attr("text-anchor", "middle")
            .text(d3.format(".2s")(v));
    });

    // Travel time — the same "more minutes, more ink" rule the matrix uses.
    const widthBlock = root.append("div").attr("class", "legend-block");
    widthBlock.append("span").attr("class", "legend-label").text("Travel time (line width)");

    const widthSvg = widthBlock.append("svg").attr("width", 150).attr("height", 42);
    const timeStops = [travelExtent[0], Math.round(d3.mean(travelExtent)), travelExtent[1]];

    timeStops.forEach((v, i) => {
        const cx = 22 + i * 48;
        widthSvg.append("line")
            .attr("x1", cx - 16).attr("y1", 17).attr("x2", cx + 16).attr("y2", 17)
            .attr("stroke", INK_SOFT)
            .attr("stroke-width", linkWidth(v));
        widthSvg.append("text")
            .attr("class", "legend-tick")
            .attr("x", cx).attr("y", 39)
            .attr("text-anchor", "middle")
            .text(`${v} min`);
    });
}

// ============================================================= matrix view ==

function drawMatrix(stations, routes, byId, neighbours, passengerExtent, travelExtent) {

    const ML = 182;   // left margin: block label, name, glyph, passenger bar
    const MT = 140;   // top margin: rotated name, glyph
    const MR = 16;
    const MB = 16;
    const field = 600;

    const width = ML + field + MR;
    const height = MT + field + MB;

    const band = d3.scaleBand().range([0, field]).padding(0);

    // Cell area carries travel time on the same square-root logic the node
    // areas use, so a 16-minute link is the fullest square in the grid.
    const cellSide = d3.scaleSqrt().domain(travelExtent).range([4.5, 10.6]);
    const barLength = d3.scaleLinear().domain([0, passengerExtent[1]]).range([0, 26]);

    // Look-up of the link on a pair, so hovering any cell can report either the
    // connection or its absence.
    const linkByPair = new Map();
    routes.forEach(r => {
        linkByPair.set(`${r.source}|${r.target}`, r);
        linkByPair.set(`${r.target}|${r.source}`, r);
    });

    // Every present cell twice — the matrix is symmetric and drawing both
    // halves is what makes a row readable on its own.
    const cells = [];
    routes.forEach(r => {
        cells.push({ row: r.source, col: r.target, link: r });
        cells.push({ row: r.target, col: r.source, link: r });
    });

    const svg = d3.select("#matrix")
        .classed("loading", false)
        .html("")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label",
            "Adjacency matrix of the same 50 stations and 50 connections");

    const g = svg.append("g").attr("transform", `translate(${ML},${MT})`);

    g.append("rect")
        .attr("width", field).attr("height", field)
        .attr("fill", FIELD);

    const blockBands = g.append("g").attr("class", "matrix-blocks");
    const crosshair = g.append("g").attr("class", "matrix-crosshair");
    const blockRules = g.append("g").attr("class", "matrix-rules");
    const diagonal = g.append("g").attr("class", "matrix-diagonal");
    const cellLayer = g.append("g").attr("class", "matrix-cells");

    const rowLabels = svg.append("g").attr("class", "matrix-rowlabels")
        .attr("transform", `translate(0,${MT})`);
    const colLabels = svg.append("g").attr("class", "matrix-collabels")
        .attr("transform", `translate(${ML},0)`);
    const groupLabels = svg.append("g").attr("class", "matrix-grouplabels");

    // ---- orderings. Each returns the station ids in display order plus the
    // key the blocks are cut on (null where blocks would be meaningless).

    const districtRank = new Map(DISTRICTS.map((d, i) => [d, i]));
    const typeRank = new Map(STATION_TYPES.map((d, i) => [d, i]));

    function networkOrder() {
        // Two breadth-first passes: the first finds a station at the far end of
        // the network, the second walks outward from it. On a network shaped
        // like this one that lays the connections down as a diagonal stripe.
        const bfs = start => {
            const seen = new Map([[start, 0]]);
            const queue = [start];
            const order = [];
            while (queue.length) {
                const v = queue.shift();
                order.push(v);
                [...neighbours.get(v)].sort().forEach(w => {
                    if (!seen.has(w)) {
                        seen.set(w, seen.get(v) + 1);
                        queue.push(w);
                    }
                });
            }
            return order;
        };

        const linked = stations.filter(d => d.degree > 0).map(d => d.id);
        const out = [];
        const placed = new Set();

        linked.forEach(id => {
            if (placed.has(id)) return;
            const far = bfs(id);
            bfs(far[far.length - 1]).forEach(v => {
                if (!placed.has(v)) {
                    placed.add(v);
                    out.push(v);
                }
            });
        });

        // Unconnected stations last, so the empty corner of the matrix is the
        // first thing the eye lands on.
        stations.filter(d => d.degree === 0).forEach(d => out.push(d.id));
        return out;
    }

    const ORDERS = {
        district: () => ({
            ids: stations.slice().sort((a, b) =>
                districtRank.get(a.district) - districtRank.get(b.district) ||
                typeRank.get(a.station_type) - typeRank.get(b.station_type) ||
                b.daily_passengers - a.daily_passengers).map(d => d.id),
            key: d => d.district
        }),
        type: () => ({
            ids: stations.slice().sort((a, b) =>
                typeRank.get(a.station_type) - typeRank.get(b.station_type) ||
                districtRank.get(a.district) - districtRank.get(b.district) ||
                b.daily_passengers - a.daily_passengers).map(d => d.id),
            key: d => d.station_type
        }),
        network: () => ({ ids: networkOrder(), key: null }),
        volume: () => ({
            ids: stations.slice().sort((a, b) =>
                b.daily_passengers - a.daily_passengers).map(d => d.id),
            key: null
        })
    };

    // ---- static pieces, positioned on every re-order

    const diag = diagonal.selectAll("rect")
        .data(stations, d => d.id)
        .join("rect")
        .attr("width", 0).attr("height", 0)
        .attr("fill", GRID);

    const cell = cellLayer.selectAll("rect")
        .data(cells, d => `${d.row}|${d.col}`)
        .join("rect")
        .attr("fill", d => ROUTE_COLOR[d.link.route_type])
        .attr("rx", 1);

    const rowGroup = rowLabels.selectAll("g")
        .data(stations, d => d.id)
        .join("g")
        .attr("class", "matrix-row");

    rowGroup.append("text")
        .attr("class", "matrix-name")
        .attr("x", 136)
        .attr("text-anchor", "end")
        .text(d => d.station_name);

    rowGroup.append("path")
        .attr("class", "matrix-glyph")
        .attr("d", d => symbolPath(d.station_type, 34))
        .attr("fill", INK_SOFT);

    rowGroup.append("rect")
        .attr("class", "matrix-bar")
        .attr("x", 152)
        .attr("height", 4)
        .attr("width", d => barLength(d.daily_passengers))
        .attr("fill", RULE);

    const colGroup = colLabels.selectAll("g")
        .data(stations, d => d.id)
        .join("g")
        .attr("class", "matrix-col");

    colGroup.append("text")
        .attr("class", "matrix-name")
        .attr("text-anchor", "start")
        // rotate(-90) maps (x, y) to (y, -x), so this x is what sets how close
        // the column names sit to the top of the grid.
        .attr("transform", "rotate(-90)")
        .attr("x", -MT + 20)
        .text(d => d.station_name);

    colGroup.append("path")
        .attr("class", "matrix-glyph")
        .attr("d", d => symbolPath(d.station_type, 34))
        .attr("fill", INK_SOFT);

    // ---- hover. One transparent overlay rather than 2,500 hit targets, which
    // also means empty cells can answer "these two are not connected".

    const rowWash = crosshair.append("rect").attr("class", "wash").attr("opacity", 0);
    const colWash = crosshair.append("rect").attr("class", "wash").attr("opacity", 0);

    let order = null;

    const overlay = g.append("rect")
        .attr("width", field).attr("height", field)
        .attr("fill", "transparent")
        .style("cursor", "crosshair");

    overlay
        .on("mousemove", function (event) {
            const [mx, my] = d3.pointer(event, this);
            const i = Math.floor(my / band.step());
            const j = Math.floor(mx / band.step());
            if (i < 0 || j < 0 || i >= order.ids.length || j >= order.ids.length) return;

            const rowId = order.ids[i];
            const colId = order.ids[j];
            const rowStation = byId.get(rowId);
            const colStation = byId.get(colId);

            rowWash.attr("opacity", 1)
                .attr("x", 0).attr("y", band(rowId))
                .attr("width", field).attr("height", band.bandwidth());
            colWash.attr("opacity", 1)
                .attr("x", band(colId)).attr("y", 0)
                .attr("width", band.bandwidth()).attr("height", field);

            rowGroup.classed("lit", d => d.id === rowId || d.id === colId);
            colGroup.classed("lit", d => d.id === rowId || d.id === colId);

            if (rowId === colId) {
                showTip(event, `
                    <strong>${rowStation.station_name}</strong><br>
                    ${rowStation.district} district &middot; ${rowStation.station_type}<br>
                    ${comma(rowStation.daily_passengers)} daily passengers<br>
                    ${rowStation.degree} direct connection${rowStation.degree === 1 ? "" : "s"}
                `);
                return;
            }

            const l = linkByPair.get(`${rowId}|${colId}`);
            showTip(event, `
                <strong>${rowStation.station_name} &mdash; ${colStation.station_name}</strong><br>
                ${rowStation.district} &middot; ${colStation.district}<br>
                ${l
                    ? `${l.route_type} &middot; ${l.travel_time_min} min`
                    : "<em>No direct connection</em>"}
            `);
        })
        .on("mouseleave", () => {
            rowWash.attr("opacity", 0);
            colWash.attr("opacity", 0);
            rowGroup.classed("lit", false);
            colGroup.classed("lit", false);
            hideTip();
        });

    // ---- (re)layout

    function render(orderName, animate) {
        order = ORDERS[orderName]();
        band.domain(order.ids);

        const step = band.step();
        const mid = step / 2;
        const t = d3.transition().duration(animate ? 750 : 0).ease(d3.easeCubicInOut);

        diag.transition(t)
            .attr("x", d => band(d.id) + 1)
            .attr("y", d => band(d.id) + 1)
            .attr("width", Math.max(0, step - 2))
            .attr("height", Math.max(0, step - 2));

        cell.transition(t)
            .attr("x", d => band(d.col) + mid - cellSide(d.link.travel_time_min) / 2)
            .attr("y", d => band(d.row) + mid - cellSide(d.link.travel_time_min) / 2)
            .attr("width", d => cellSide(d.link.travel_time_min))
            .attr("height", d => cellSide(d.link.travel_time_min));

        rowGroup.transition(t).attr("transform", d => `translate(0,${band(d.id)})`);
        colGroup.transition(t).attr("transform", d => `translate(${band(d.id)},0)`);

        rowGroup.select(".matrix-name").attr("y", mid + 3);
        rowGroup.select(".matrix-glyph").attr("transform", `translate(144,${mid})`);
        rowGroup.select(".matrix-bar").attr("y", mid - 2);
        colGroup.select(".matrix-name").attr("y", mid + 3);
        colGroup.select(".matrix-glyph").attr("transform", `translate(${mid},${MT - 14})`);

        // Block rules and labels only where a grouping key exists.
        const groups = [];
        if (order.key) {
            let start = 0;
            order.ids.forEach((id, i) => {
                const here = order.key(byId.get(id));
                const next = i + 1 < order.ids.length ? order.key(byId.get(order.ids[i + 1])) : null;
                if (here !== next) {
                    groups.push({ name: here, start, end: i });
                    start = i + 1;
                }
            });
        }

        blockBands.selectAll("rect")
            .data(groups.filter((_, i) => i % 2 === 1), d => d.name)
            .join("rect")
            .attr("x", 0)
            .attr("y", d => d.start * step)
            .attr("width", field)
            .attr("height", d => (d.end - d.start + 1) * step)
            .attr("fill", INK)
            .attr("opacity", 0.022);

        blockRules.selectAll("line.h")
            .data(groups.slice(0, -1), d => d.name)
            .join("line")
            .attr("class", "h")
            .attr("x1", 0).attr("x2", field)
            .attr("y1", d => (d.end + 1) * step)
            .attr("y2", d => (d.end + 1) * step)
            .attr("stroke", RULE);

        blockRules.selectAll("line.v")
            .data(groups.slice(0, -1), d => d.name)
            .join("line")
            .attr("class", "v")
            .attr("y1", 0).attr("y2", field)
            .attr("x1", d => (d.end + 1) * step)
            .attr("x2", d => (d.end + 1) * step)
            .attr("stroke", RULE);

        // District keeps its colour here only, as a tie back to the node-link
        // figure — a swatch beside a word, never a second scale in the grid.
        const gl = groupLabels.selectAll("g")
            .data(groups, d => d.name)
            .join(enter => {
                const grp = enter.append("g");
                grp.append("rect").attr("class", "group-swatch")
                    .attr("width", 9).attr("height", 9).attr("rx", 2);
                grp.append("text").attr("class", "group-name");
                return grp;
            });

        gl.attr("transform", d =>
            `translate(4,${MT + (d.start + (d.end - d.start + 1) / 2) * step})`);

        gl.select(".group-swatch")
            .attr("x", 0).attr("y", -4.5)
            .attr("fill", d => DISTRICT_COLOR[d.name] || MUTED)
            .attr("opacity", d => DISTRICT_COLOR[d.name] ? 1 : 0.45);

        gl.select(".group-name")
            .attr("x", 13).attr("y", 3.5)
            .text(d => d.name);
    }

    render("district", false);

    d3.selectAll("#order-toggle button").on("click", function () {
        d3.selectAll("#order-toggle button").classed("active", false);
        d3.select(this).classed("active", true);
        render(this.dataset.order, true);
    });

    buildMatrixLegend(cellSide, travelExtent);
}

// ---------------------------------------------------------- matrix legend --

function buildMatrixLegend(cellSide, travelExtent) {

    const root = d3.select("#matrix-legend").html("");

    const routeBlock = root.append("div").attr("class", "legend-block");
    routeBlock.append("span").attr("class", "legend-label").text("Route type (cell colour)");
    const rRows = routeBlock.append("div").attr("class", "legend-rows");

    ROUTE_TYPES.forEach(name => {
        const row = rRows.append("div").attr("class", "legend-swatch-row static");
        row.append("svg").attr("width", 16).attr("height", 16)
            .append("rect")
            .attr("x", 3).attr("y", 3).attr("width", 11).attr("height", 11).attr("rx", 1)
            .attr("fill", ROUTE_COLOR[name]);
        row.append("span").text(name);
    });

    const sizeBlock = root.append("div").attr("class", "legend-block");
    sizeBlock.append("span").attr("class", "legend-label").text("Travel time (cell size)");

    const sizeSvg = sizeBlock.append("svg").attr("width", 150).attr("height", 42);
    const stops = [travelExtent[0], Math.round(d3.mean(travelExtent)), travelExtent[1]];

    stops.forEach((v, i) => {
        const cx = 22 + i * 48;
        const s = cellSide(v);
        sizeSvg.append("rect")
            .attr("x", cx - s / 2).attr("y", 17 - s / 2)
            .attr("width", s).attr("height", s).attr("rx", 1)
            .attr("fill", MUTED);
        sizeSvg.append("text")
            .attr("class", "legend-tick")
            .attr("x", cx).attr("y", 39)
            .attr("text-anchor", "middle")
            .text(`${v} min`);
    });

    const marginBlock = root.append("div").attr("class", "legend-block");
    marginBlock.append("span").attr("class", "legend-label").text("Row margins");
    const mRows = marginBlock.append("div").attr("class", "legend-rows");

    STATION_TYPES.forEach(name => {
        const row = mRows.append("div").attr("class", "legend-swatch-row static");
        row.append("svg").attr("width", 16).attr("height", 16)
            .append("path")
            .attr("transform", "translate(8,8)")
            .attr("d", symbolPath(name, 60))
            .attr("fill", INK_SOFT);
        row.append("span").text(name);
    });

    const barRow = mRows.append("div").attr("class", "legend-swatch-row static");
    barRow.append("svg").attr("width", 16).attr("height", 16)
        .append("rect")
        .attr("x", 1).attr("y", 6).attr("width", 14).attr("height", 4)
        .attr("fill", RULE);
    barRow.append("span").text("Daily passengers");
}

// ================================================================== tables ==

function drawLinksTable(routes, byId) {

    const table = d3.select("#links-table");

    const columns = [
        ["From", d => byId.get(d.source).station_name, false],
        ["District", d => byId.get(d.source).district, false],
        ["To", d => byId.get(d.target).station_name, false],
        ["District", d => byId.get(d.target).district, false],
        ["Travel time", d => `${d.travel_time_min} min`, true],
        ["Route type", d => d.route_type, false]
    ];

    table.select("thead").html("")
        .append("tr")
        .selectAll("th")
        .data(columns)
        .join("th")
        .attr("class", d => d[2] ? "num" : null)
        .text(d => d[0]);

    table.select("tbody").html("")
        .selectAll("tr")
        .data(routes)
        .join("tr")
        .selectAll("td")
        .data(d => columns.map(c => ({ value: c[1](d), num: c[2] })))
        .join("td")
        .attr("class", d => d.num ? "num" : null)
        .text(d => d.value);
}

// ================================================================ findings ==

// The six questions. Every number quoted below is computed from the same two
// files the figures are drawn from, so the text cannot drift away from the
// picture — but the claims are written as things the views make visible.
function writeFindings(stations, routes, byId, neighbours) {

    const deg = id => byId.get(id).degree;
    const isolated = stations.filter(d => d.degree === 0);
    const spurs = stations.filter(d => d.degree === 1);
    const hubs = stations.filter(d => d.degree === 3);
    const maxDegree = d3.max(stations, d => d.degree);

    // District pair counts, exactly what the matrix blocks show.
    const pairCount = new Map();
    routes.forEach(r => {
        const key = [byId.get(r.source).district, byId.get(r.target).district].sort().join(" – ");
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
    });

    const pairs = [...pairCount].sort((a, b) => b[1] - a[1]);

    // A pairing of a district with itself is a different claim from a pairing
    // of two districts, so the two are counted separately.
    const crossPairs = pairs.filter(p => {
        const [a, b] = p[0].split(" – ");
        return a !== b;
    });
    const withinPairs = pairs.filter(p => {
        const [a, b] = p[0].split(" – ");
        return a === b;
    });

    const emptyPairs = [];
    DISTRICTS.forEach((a, i) => DISTRICTS.slice(i + 1).forEach(b => {
        const key = [a, b].sort().join(" – ");
        if (!pairCount.has(key)) emptyPairs.push(key);
    }));

    const busiest = stations.slice()
        .sort((a, b) => b.daily_passengers - a.daily_passengers)
        .slice(0, 6);

    const longest = routes.slice()
        .sort((a, b) => b.travel_time_min - a.travel_time_min)
        .slice(0, 3);

    const meanDegByType = STATION_TYPES.map(t => ({
        type: t,
        mean: d3.mean(stations.filter(d => d.station_type === t), d => d.degree)
    }));

    // Which pair of station types each route type actually joins. This is what
    // the station-type ordering of the matrix makes visible as coloured blocks,
    // and it is invisible in the node-link view.
    const typePairs = new Map(ROUTE_TYPES.map(t => [t, new Map()]));

    routes.forEach(r => {
        const pair = [byId.get(r.source).station_type, byId.get(r.target).station_type]
            .sort().join(" + ");
        const counts = typePairs.get(r.route_type);
        counts.set(pair, (counts.get(pair) || 0) + 1);
    });

    const dominantPair = t => {
        const counts = [...typePairs.get(t)].sort((a, b) => b[1] - a[1]);
        const total = d3.sum(counts, c => c[1]);
        return { pair: counts[0][0], n: counts[0][1], share: counts[0][1] / total };
    };

    const sameTypeLinks = routes.filter(r =>
        byId.get(r.source).station_type === byId.get(r.target).station_type);

    const nameList = arr => arr.map(d => d.station_name.replace("Station ", "")).join(", ");

    const findings = [
        {
            q: "1. Which stations appear central in the network?",
            verdict: "Partly",
            view: "Node-link",
            encoding: `Line count at a symbol, plus hover highlighting to trace one
                station's neighbourhood at a time.`,
            body: `<p>The honest answer is that <strong>this network has no
                hubs</strong>. The busiest junction in it has just
                <strong>${maxDegree} connections</strong>, and only ${hubs.length}
                of the 50 stations reach even that. The free layout shows why: it
                is not a hub-and-spoke system but one long chain looping back on
                itself, with a few shortcuts thrown across.</p>
                <p>Centrality here is therefore about position, not degree. The
                ${hubs.length} three-link stations &mdash; Stations
                ${nameList(hubs.slice(0, 6))} among them &mdash; are exactly the
                ends of those shortcuts, the only places offering a real choice of
                direction. Hovering one lights three lines instead of two;
                everything else lights two or fewer.</p>`
        },
        {
            q: "2. Which districts are strongly connected to one another?",
            verdict: "Well",
            view: "Adjacency matrix",
            encoding: `Row and column ordering by district: is the block where two
                districts cross full or empty?`,
            body: `<p>The matrix answers this far better than the node-link view,
                and it is the clearest case on the page for building a second view
                at all. Sorted by district, the 25 blocks read off directly: only
                <strong>${crossPairs.length} of the 10 possible pairings between
                different districts</strong> have anything in them.</p>
                <p>The heaviest are
                ${crossPairs.slice(0, 3).map(p => `<strong>${p[0]}</strong> (${p[1]})`).join(", ")},
                then ${crossPairs.slice(3, 5).map(p => `${p[0]} (${p[1]})`).join(" and ")}.
                ${emptyPairs.length} pairings are empty &mdash;
                <strong>${emptyPairs.join("</strong>, <strong>")}</strong> &mdash;
                an absence invisible in a force layout. The diagonal blocks are
                emptier still: only
                <strong>${withinPairs.map(p => p[0].split(" – ")[0]).join(" and ")}</strong>
                joins two of its own stations, so nearly every connection crosses a
                district boundary.</p>`
        },
        {
            q: "3. Where are transfer or terminal stations located in the topology?",
            verdict: "Well",
            view: "Both",
            encoding: `Symbol shape in the node-link view; the station-type ordering
                and margin glyphs in the matrix.`,
            body: `<p>Sorting the matrix by station type is the quickest test, and
                it comes back flat. The Terminal, Transfer and Local blocks look
                alike &mdash; the same scatter, the same density &mdash; where a
                real system would pack the Transfer block and leave Terminal rows
                bare.</p>
                <p>Mean degree is
                ${meanDegByType.map(d => `${d.type} ${d.mean.toFixed(2)}`).join(", ")}:
                effectively identical. <strong>Transfer stations are not more
                connected than Local ones.</strong> In the node-link view the
                shapes are mixed evenly along the chain rather than sorted to
                particular places in it.</p>
                <p>So a station's type says nothing about <em>how connected</em> it
                is. It says a great deal about <em>what kind of service</em>
                reaches it &mdash; but only the matrix shows that, and that is
                question 6.</p>`
        },
        {
            q: "4. Which stations have high passenger volume?",
            verdict: "Well",
            view: "Node-link",
            encoding: `Symbol area, with the tooltip for exact figures and the
                matrix margin bars as a cross-check.`,
            body: `<p>The largest symbols are unmistakable, and they sit in the
                strangest place in the network. The six busiest are
                ${busiest.map(d => `<strong>${d.station_name}</strong> (${comma(d.daily_passengers)})`).slice(0, 3).join(", ")}
                and Stations ${nameList(busiest.slice(3))} behind them &mdash; and
                in the layout they are the big symbols <em>outside</em> the main
                loop, dangling on a single line or floating free.</p>
                <p>That inversion is the most striking thing either view shows.
                <strong>Passenger volume runs opposite to connectivity
                here</strong>:
                ${busiest.every(d => d.degree <= 1)
                    ? "every one of the six has a single connection or none"
                    : `${busiest.filter(d => d.degree <= 1).length} of the six have one connection or none`},
                while the smallest symbols sit mid-chain. Sorting the matrix by
                volume makes it undeniable: the longest margin bars stack at the
                top, against rows that are almost empty.</p>`
        },
        {
            q: "5. Where are the longest direct travel-time connections?",
            verdict: "Well",
            view: "Both",
            encoding: `Line width and the simulation's link distance in the
                node-link view; cell size in the matrix.`,
            body: `<p>The three longest are
                ${longest.map(l => `<strong>${byId.get(l.source).station_name} &ndash; ${byId.get(l.target).station_name}</strong> (${l.travel_time_min} min, ${l.route_type})`).join(", ")}.
                They are easy to find because width and layout distance push the
                same way: the thickest lines are also the longest, stretched across
                the middle of the loop rather than running round its edge.</p>
                <p>That is the pattern, not a coincidence. <strong>The long
                connections are the shortcuts</strong> &mdash; the ten links
                cutting across the chain average
                ${d3.mean(routes.filter(r => Math.abs(+r.target.slice(1) - +r.source.slice(1)) !== 1), r => r.travel_time_min).toFixed(1)}
                minutes against
                ${d3.mean(routes.filter(r => Math.abs(+r.target.slice(1) - +r.source.slice(1)) === 1), r => r.travel_time_min).toFixed(1)}
                for links joining neighbours along it. Under <em>Network
                position</em> ordering the chain collapses to a tight diagonal
                stripe of small squares, and the shortcuts stand off it as larger
                ones.</p>`
        },
        {
            q: "6. Are particular route types concentrated in particular parts of the network?",
            verdict: "Well",
            view: "Adjacency matrix",
            encoding: `Cell colour, read against each of the two orderings in turn.`,
            body: `<p>Geographically, no. Under district ordering the three colours
                mix evenly through every block, and isolating a route type in the
                node-link legend leaves its lines scattered right round the
                loop.</p>
                <p>Switching to <em>Station type</em> ordering transforms the grid,
                and this is the one finding the node-link view never gives up. The
                colours snap into blocks:
                ${ROUTE_TYPES.map(t => `<strong>${t}</strong> joins ${dominantPair(t).pair.replace(" + ", " to ")} in ${Math.round(dominantPair(t).share * 100)}%`).join(", ")}
                of its links, and only <strong>${sameTypeLinks.length} of the
                50</strong> connections join two stations of the same type. Route
                type is fixed not by place but by the <em>pair of station
                types</em> it joins &mdash; a fingerprint of the file's
                construction, and exactly what a matrix exposes and a force layout
                hides.</p>`
        }
    ];

    const root = d3.select("#findings").html("");

    const items = root.selectAll("div.finding")
        .data(findings)
        .join("div")
        .attr("class", "finding");

    items.append("h3").text(d => d.q);

    const meta = items.append("div").attr("class", "finding-meta");

    meta.append("span")
        .attr("class", "finding-tag verdict")
        .text(d => `Answerable: ${d.verdict}`);

    meta.append("span")
        .attr("class", "finding-tag view")
        .text(d => `View: ${d.view}`);

    items.append("p")
        .attr("class", "finding-encoding")
        .html(d => `<strong>What carries it:</strong> ${d.encoding}`);

    items.append("div")
        .attr("class", "finding-body")
        .html(d => d.body);
}
