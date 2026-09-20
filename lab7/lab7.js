// Lab 7 — temporal data: line charts and an animated temporal network.
//
// Part 1 (assignment): 12 companies, 27 commercial relationships, 60 days.
// One frame of the animation is one day (or a trailing window of days), and the
// encodings are:
//
//   region                  → node fill colour (3 hues) + horizontal band
//   sector                  → node symbol shape (7 shapes)
//   volume traded that day   → node symbol area  (dynamic)
//   gained a new partner     → dark ring on the node
//   amount_usd              → link stroke width
//   transaction_type        → link dash pattern
//   first / last day of a relationship → ink dot / hollow ring at link midpoint
//   connected component     → soft halo traced along that cluster's own links
//
// Two static overviews sit beside the animation, because animation alone makes
// distant days impossible to compare (Task 11): a per-day strip of link count
// and traded value, and a 27 × 60 grid of which relationship was active when.
// Both are scrubbers — clicking either jumps the animation to that day.
//
// Part 2 (in-lab Tasks 1–11): 180 days of weather for eight cities as a
// multi-series line chart with a metric switch, a crosshair tooltip, brush and
// date-input range filtering, and a controllable animated marker.

// ---------------------------------------------------------------- palette --

// Region is the only categorical colour in the network. Three slots of the
// site's palette, validated all-pairs: worst CVD ΔE 9.2 (deutan), worst
// normal-vision ΔE 24.0. Aqua sits at 2.74:1 on the page, below 3:1, so the
// relief rule applies — every node carries a printed name and the page ships a
// table view. Neither may be removed.
const REGIONS = ["Asia", "Europe", "North America"];

const REGION_COLOR = {
    "Asia": "#2a78d6",
    "Europe": "#eb6834",
    "North America": "#1baf7a"
};

// Sector is a second node channel, carried by shape rather than by more hues.
const SECTOR_SYMBOL = {
    "Retail": d3.symbolCircle,
    "Manufacturing": d3.symbolSquare,
    "Food": d3.symbolDiamond,
    "Logistics": d3.symbolTriangle,
    "Wholesale": d3.symbolWye,
    "Materials": d3.symbolCross,
    "Technology": d3.symbolStar
};

const SECTORS = Object.keys(SECTOR_SYMBOL).sort(d3.ascending);

// Transaction type is a link channel, carried by dash pattern so the links stay
// out of the colour scale the nodes own. "none" is a solid line.
const TYPE_DASH = {
    "goods": "none",
    "shipping": "8 3",
    "components": "2.5 2.5",
    "materials": "11 3 2.5 3",
    "services": "1 3"
};

const TYPES = ["goods", "shipping", "components", "materials", "services"];

const INK = "#0b0b0b";
const INK_SOFT = "#52514e";
const LINK_GREY = "#9a9892";
const IDLE_FILL = "#d8d7d1";

// Amount in the relationship grid is a magnitude, so one hue, light → dark.
const AMOUNT_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

const money = d3.format("$,.0f");
const moneyShort = v => `$${d3.format(".3~s")(v).replace("G", "B")}`;
const comma = d3.format(",");
const isoDate = d3.timeFormat("%Y-%m-%d");
// %e pads single-digit days with a space, which reads as a double space here.
const longDate = d => d3.timeFormat("%a %e %b %Y")(d).replace("  ", " ");
const parseDay = d3.timeParse("%Y-%m-%d");

// ---------------------------------------------------------------- tooltip --

const tooltip = d3.select("#tooltip");

// Names and types come out of a CSV, so they are inserted as text, never as
// markup. `rows` is a list of [label, value] pairs; value may carry a swatch.
function showTip(event, title, rows, note) {
    const node = tooltip.node();
    node.textContent = "";

    const head = document.createElement("div");
    head.className = "tip-head";
    head.textContent = title;
    node.appendChild(head);

    for (const [label, value] of rows) {
        const line = document.createElement("div");
        line.className = "tip-row";

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

function moveTip(event) {
    // Flip to the left of the pointer near the right edge so it stays on screen.
    const box = tooltip.node().getBoundingClientRect();
    const flip = event.clientX + 16 + box.width > window.innerWidth;

    tooltip
        .style("left", `${flip ? event.pageX - box.width - 14 : event.pageX + 14}px`)
        .style("top", `${event.pageY + 14}px`);
}

function hideTip() {
    tooltip.style("opacity", 0);
}

// Attach the same readout to hover and to keyboard focus.
function bindTip(sel, title, rows, note) {
    sel
        .on("pointerenter.tip", (event, d) => showTip(event, title(d), rows(d), note && note(d)))
        .on("pointermove.tip", moveTip)
        .on("pointerleave.tip", hideTip)
        .on("focus.tip", function (event, d) {
            const box = this.getBoundingClientRect();
            showTip(
                { clientX: box.left + box.width / 2, clientY: box.top,
                  pageX: box.left + box.width / 2 + window.scrollX,
                  pageY: box.top + box.height + window.scrollY },
                title(d), rows(d), note && note(d)
            );
        })
        .on("blur.tip", hideTip);
}

// ============================================================================
// Part 1 — Assignment: animated temporal commercial network
// ============================================================================

Promise.all([
    d3.csv("../data/lab7_assignment_companies.csv", d => ({
        id: d.id,
        name: d.company_name,
        short: d.company_name.split(" ")[0],
        sector: d.sector,
        region: d.region
    })),
    d3.csv("../data/lab7_assignment_transactions_60days.csv", d => ({
        date: parseDay(d.date),
        day: +d.day,
        source: d.source,
        target: d.target,
        amount: +d.amount_usd,
        type: d.transaction_type,
        count: +d.transaction_count
    }))
]).then(([companies, transactions]) => {
    buildNetwork(companies, transactions);
}).catch(err => {
    d3.selectAll("#network, #overview, #relationships")
        .classed("loading", true)
        .text("Could not load the assignment data — open this page over http, not as a file.");
    console.error(err);
});

function buildNetwork(companies, transactions) {

    const DAYS = d3.range(1, 61);

    // ---------------------------------------------------------- index data --

    const byId = new Map(companies.map(c => [c.id, c]));

    // Links are undirected, so source/target order is dropped: "c06|c09" and
    // "c09|c06" are the same relationship. The dataset writes both.
    const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    for (const t of transactions) {
        t.key = pairKey(t.source, t.target);
        t.a = t.key.split("|")[0];
        t.b = t.key.split("|")[1];
    }

    const byDay = d3.group(transactions, d => d.day);
    const dayDate = new Map(DAYS.map(d => [d, byDay.get(d)[0].date]));

    // One record per relationship over the whole 60 days: the backbone of the
    // layout, and the rows of the relationship grid.
    const pairs = Array.from(
        d3.group(transactions, d => d.key),
        ([key, rows]) => {
            const days = rows.map(r => r.day).sort(d3.ascending);
            const a = byId.get(rows[0].a);
            const b = byId.get(rows[0].b);

            return {
                key,
                a, b,
                rows,
                days,
                byDay: new Map(rows.map(r => [r.day, r])),
                first: days[0],
                last: days[days.length - 1],
                total: d3.sum(rows, r => r.amount),
                type: d3.greatest(
                    d3.rollups(rows, v => v.length, r => r.type),
                    d => d[1]
                )[0],
                cross: a.region !== b.region
            };
        }
    ).sort((p, q) => d3.ascending(p.first, q.first) || d3.descending(p.days.length, q.days.length));

    const pairByKey = new Map(pairs.map(p => [p.key, p]));

    // Per-day totals for the overview strips.
    const dayStats = DAYS.map(day => {
        const rows = byDay.get(day);
        return {
            day,
            date: dayDate.get(day),
            links: rows.length,
            value: d3.sum(rows, r => r.amount),
            active: new Set(rows.flatMap(r => [r.a, r.b])).size
        };
    });

    // Largest single-day volume for one company — the top of the size scale.
    const maxNodeVolume = d3.max(DAYS, day => d3.max(
        d3.rollup(
            byDay.get(day).flatMap(r => [{ id: r.a, v: r.amount }, { id: r.b, v: r.amount }]),
            v => d3.sum(v, x => x.v),
            x => x.id
        ).values()
    ));

    // ------------------------------------------------------------- scales --

    // Node area is proportional to the day's volume, which is what makes areas
    // comparable across frames; idle nodes get a fixed floor so they stay
    // visible (and countable) instead of collapsing to nothing.
    const IDLE_AREA = 120;

    const areaScale = d3.scaleLinear()
        .domain([0, maxNodeVolume])
        .range([IDLE_AREA, 1250]);

    const amountExtent = d3.extent(transactions, d => d.amount);

    const widthScale = d3.scaleLinear()
        .domain(amountExtent)
        .range([1.5, 7]);

    const amountColor = d3.scaleQuantize()
        .domain(amountExtent)
        .range(AMOUNT_RAMP);

    const radiusOf = area => Math.sqrt(area / Math.PI) * 1.15;
    const maxRadius = radiusOf(areaScale(maxNodeVolume));

    // ------------------------------------------------------- network frame --

    const W = 940;
    const H = 580;

    // The box the nodes are fitted into. The strip above it holds the day
    // stamp, the strip below it the region names, so neither can ever collide
    // with a node or its label.
    const box = { x0: 62, x1: 878, y0: 86, y1: 494 };

    const netSvg = d3.select("#network")
        .classed("loading", false)
        .append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label",
            "Node-link diagram of 12 companies and the commercial relationships "
            + "active on the selected day.");

    // Region columns: a horizontal force pulls each company toward its region's
    // column, so a link that crosses a column boundary is a cross-regional
    // relationship — visible without reading the two colours.
    const bandX = d3.scalePoint()
        .domain(REGIONS)
        .range([box.x0 + 90, box.x1 - 90]);

    const bandG = netSvg.append("g").attr("class", "region-bands");

    const hullG = netSvg.append("g").attr("class", "hulls");
    const linkG = netSvg.append("g").attr("class", "net-links");
    const nodeG = netSvg.append("g").attr("class", "net-nodes");

    const dayLabel = netSvg.append("text")
        .attr("class", "day-stamp")
        .attr("x", box.x0 - 6)
        .attr("y", 34);

    const dateStamp = netSvg.append("text")
        .attr("class", "date-stamp")
        .attr("x", box.x0 - 6)
        .attr("y", 56);

    // The columns are drawn from where the nodes actually landed, not from the
    // force's targets, so the labels can never drift off their own group.
    function drawBands() {
        const mean = new Map(REGIONS.map(r =>
            [r, d3.mean(companies.filter(c => c.region === r), c => c.x)]));

        bandG.selectAll("line")
            .data(REGIONS.slice(1).map((r, i) => (mean.get(r) + mean.get(REGIONS[i])) / 2))
            .join("line")
            .attr("x1", x => x).attr("x2", x => x)
            .attr("y1", box.y0 - 26)
            .attr("y2", H - 34);

        bandG.selectAll("text")
            .data(REGIONS)
            .join("text")
            .attr("x", r => mean.get(r))
            .attr("y", H - 14)
            .attr("text-anchor", "middle")
            .attr("fill", r => REGION_COLOR[r])
            .text(r => r.toUpperCase());
    }

    // ----------------------------------------------------------- the force --

    // The simulation runs on the *aggregate* network — all 27 relationships,
    // pulled together in proportion to how often they trade — not on one day's
    // links. That is what preserves the mental map: a company sits in the same
    // place on day 3 and on day 57, so the reader tracks size and connection
    // instead of re-finding the node. Days change which links are drawn, never
    // where the nodes are.
    const simLinks = pairs.map(p => ({
        source: p.a.id,
        target: p.b.id,
        weight: p.days.length
    }));

    const simulation = d3.forceSimulation(companies)
        .force("link", d3.forceLink(simLinks)
            .id(d => d.id)
            .distance(d => 150 - 3 * d.weight)
            .strength(d => 0.25 + 0.03 * d.weight))
        .force("charge", d3.forceManyBody().strength(-820))
        .force("x", d3.forceX(d => bandX(d.region)).strength(0.34))
        .force("y", d3.forceY((box.y0 + box.y1) / 2).strength(0.07))
        .force("collide", d3.forceCollide(maxRadius + 10))
        .stop();

    // Settle once, off-screen, then pin every node. The collision radius is the
    // largest a node ever gets, so growing nodes can never overlap later.
    simulation.tick(400);
    fitAndPin();

    // The forces settle to a shape, not to a size, so the result is scaled once
    // to fill the frame — one factor for both axes, so nothing is distorted —
    // and then pinned.
    function fitAndPin() {
        const xs = d3.extent(companies, c => c.x);
        const ys = d3.extent(companies, c => c.y);

        const k = Math.min(
            (box.x1 - box.x0) / Math.max(1, xs[1] - xs[0]),
            (box.y1 - box.y0) / Math.max(1, ys[1] - ys[0])
        );

        const cx = (xs[0] + xs[1]) / 2;
        const cy = (ys[0] + ys[1]) / 2;

        for (const c of companies) {
            c.x = c.fx = (box.x0 + box.x1) / 2 + (c.x - cx) * k;
            c.y = c.fy = (box.y0 + box.y1) / 2 + (c.y - cy) * k;
        }

        drawBands();
    }

    simulation.on("tick", () => {
        positionNodes();
        positionLinks();
        drawHulls(currentFrame);
    });

    // --------------------------------------------------------- frame maths --

    // Everything the picture and the summary need for one day (or trailing
    // window), computed in one place so the numbers can never disagree.
    function computeFrame(day, win) {
        const lo = Math.max(1, day - win + 1);
        const rows = d3.range(lo, day + 1).flatMap(d => byDay.get(d));

        const links = Array.from(
            d3.group(rows, r => r.key),
            ([key, rs]) => {
                const pair = pairByKey.get(key);
                const amount = d3.sum(rs, r => r.amount);

                return {
                    key,
                    pair,
                    a: pair.a,
                    b: pair.b,
                    amount,
                    count: d3.sum(rs, r => r.count),
                    occurrences: rs.length,
                    type: rs.length === 1 ? rs[0].type : pair.type,
                    mixed: new Set(rs.map(r => r.type)).size > 1,
                    // Relationship onset and close-out: the events that make the
                    // 60 days a story rather than 60 unrelated pictures.
                    opens: pair.first >= lo && pair.first <= day,
                    closes: pair.last >= lo && pair.last <= day && pair.last < 60
                };
            }
        ).sort((p, q) => d3.ascending(p.key, q.key));

        const volume = new Map(companies.map(c => [c.id, 0]));
        const degree = new Map(companies.map(c => [c.id, 0]));
        const opened = new Set();
        const partners = new Map(companies.map(c => [c.id, []]));

        for (const l of links) {
            for (const c of [l.a, l.b]) {
                volume.set(c.id, volume.get(c.id) + l.amount);
                degree.set(c.id, degree.get(c.id) + 1);
                if (l.opens) opened.add(c.id);
            }
            partners.get(l.a.id).push(l.b);
            partners.get(l.b.id).push(l.a);
        }

        return {
            day, win, lo,
            date: dayDate.get(day),
            links,
            volume, degree, partners, opened,
            value: d3.sum(links, l => l.amount),
            clusters: components(links),
            crossCount: links.filter(l => l.pair.cross).length
        };
    }

    // Connected components among the companies trading in this frame — the
    // "are there separate clusters right now?" question, answered explicitly
    // rather than left to the layout. Each component carries its own links, so
    // the halo can be drawn along the edges instead of around the area.
    function components(links) {
        const parent = new Map();
        const find = x => {
            while (parent.get(x) !== x) {
                parent.set(x, parent.get(parent.get(x)));
                x = parent.get(x);
            }
            return x;
        };

        for (const l of links) {
            for (const id of [l.a.id, l.b.id]) {
                if (!parent.has(id)) parent.set(id, id);
            }
        }

        for (const l of links) {
            const ra = find(l.a.id);
            const rb = find(l.b.id);
            if (ra !== rb) parent.set(ra, rb);
        }

        const linksByRoot = d3.group(links, l => find(l.a.id));

        return Array.from(
            d3.group(Array.from(parent.keys()), id => find(id)),
            ([root, ids]) => ({
                key: ids.slice().sort().join("-"),
                nodes: ids.map(id => byId.get(id)),
                links: linksByRoot.get(root) || [],
                size: ids.length
            })
        ).sort((p, q) => d3.descending(p.size, q.size));
    }

    // ------------------------------------------------------------ drawing --

    let currentFrame = computeFrame(1, 1);

    function positionNodes() {
        nodeG.selectAll("g.net-node")
            .attr("transform", d => `translate(${d.x},${d.y})`);
    }

    function positionLinks() {
        const g = linkG.selectAll("g.net-link");

        g.select("line.wire")
            .attr("x1", d => d.a.x).attr("y1", d => d.a.y)
            .attr("x2", d => d.b.x).attr("y2", d => d.b.y);

        g.select("line.hit")
            .attr("x1", d => d.a.x).attr("y1", d => d.a.y)
            .attr("x2", d => d.b.x).attr("y2", d => d.b.y);

        g.select("circle.event")
            .attr("cx", d => (d.a.x + d.b.x) / 2)
            .attr("cy", d => (d.a.y + d.b.y) / 2);
    }

    // A soft halo per cluster, traced along the cluster's own edges rather than
    // around the area it covers. A convex hull would be the obvious choice, but
    // positions are pinned, so a hull routinely encloses a company that is not
    // in the cluster at all (Granite sits inside the big group's hull on day
    // 42) — it would state something false. Following the edges cannot.
    // The halo is one group per cluster at a single opacity, so the overlapping
    // pieces inside it flatten instead of compounding into darker patches.
    function drawHulls(frame) {
        const groups = showClusters
            ? frame.clusters.filter(c => c.size >= 2)
            : [];

        const g = hullG.selectAll("g.hull")
            .data(groups, c => c.key)
            .join(enter => enter.append("g").attr("class", "hull"));

        g.selectAll("circle")
            .data(c => c.nodes, n => n.id)
            .join("circle")
            .attr("r", 21)
            .attr("cx", n => n.x)
            .attr("cy", n => n.y);

        g.selectAll("line")
            .data(c => c.links, l => l.key)
            .join("line")
            .attr("x1", l => l.a.x).attr("y1", l => l.a.y)
            .attr("x2", l => l.b.x).attr("y2", l => l.b.y);
    }

    function render(frame, dur) {
        currentFrame = frame;

        // ---- links: enter fades in, exit fades out (Part C) ----
        const links = linkG.selectAll("g.net-link")
            .data(frame.links, d => d.key)
            .join(
                enter => {
                    const g = enter.append("g")
                        .attr("class", "net-link")
                        .attr("opacity", 0);

                    g.append("line").attr("class", "hit");
                    g.append("line").attr("class", "wire");
                    g.append("circle").attr("class", "event").attr("r", 0);

                    g.call(e => e.transition("fade").duration(dur).attr("opacity", 1));

                    return g;
                },
                update => update,
                exit => exit
                    .transition("fade").duration(dur)
                    .attr("opacity", 0)
                    .remove()
            );

        links.select("line.wire")
            .attr("stroke-dasharray", d => TYPE_DASH[d.type])
            .transition("look").duration(dur)
            .attr("stroke", d => (d.opens ? INK : LINK_GREY))
            .attr("stroke-opacity", d => (d.opens ? 0.95 : 0.7))
            .attr("stroke-width", d => widthScale(d.amount));

        links.select("line.hit")
            .attr("stroke-width", d => Math.max(14, widthScale(d.amount) + 10));

        links.select("circle.event")
            .attr("fill", d => (d.opens ? INK : "#ffffff"))
            .attr("stroke", d => (d.opens || d.closes ? INK : "none"))
            .attr("stroke-width", 2)
            .transition("look").duration(dur)
            .attr("r", d => (d.opens || d.closes ? 5 : 0));

        // A relationship opening gets one brief pulse on that dot, so the eye
        // is pulled to it while the frame is on screen. The pulse rides on its
        // own attribute, never on the stroke width that carries the amount.
        links.filter(d => d.opens).select("circle.event")
            .interrupt("look")
            .attr("r", 0)
            .transition("look").duration(Math.min(200, dur))
            .attr("r", 11)
            .transition().duration(Math.min(300, dur * 1.4))
            .attr("r", 5);

        bindTip(links, linkTitle, linkRows, linkNote);

        links.on("click", (event, d) => {
            event.stopPropagation();
            highlightPair(d.key);
        });

        // ---- nodes: all 12 always present, so nothing ever moves or vanishes ----
        const nodes = nodeG.selectAll("g.net-node")
            .data(companies, d => d.id)
            .join(enter => {
                const g = enter.append("g")
                    .attr("class", "net-node")
                    .attr("tabindex", 0)
                    .attr("transform", d => `translate(${d.x},${d.y})`);

                g.append("path").attr("class", "glyph");

                g.append("text")
                    .attr("class", "net-label")
                    .attr("text-anchor", "middle")
                    .text(d => d.short);

                return g;
            });

        nodes
            .classed("idle", d => frame.degree.get(d.id) === 0)
            .classed("opened", d => frame.opened.has(d.id));

        nodes.select("path.glyph")
            .attr("stroke", d => (frame.opened.has(d.id) ? INK : "#ffffff"))
            .attr("stroke-width", d => (frame.opened.has(d.id) ? 2.5 : 1.5))
            .transition("size").duration(dur)
            .attr("fill", d => (frame.degree.get(d.id) ? REGION_COLOR[d.region] : IDLE_FILL))
            .attr("d", d => d3.symbol()
                .type(SECTOR_SYMBOL[d.sector])
                .size(areaScale(frame.volume.get(d.id)))()
            );

        nodes.select("text.net-label")
            .transition("size").duration(dur)
            .attr("y", d => radiusOf(areaScale(frame.volume.get(d.id))) + 13);

        bindTip(nodes, d => d.name, nodeRows, nodeNote);

        nodes.call(d3.drag()
            .on("start", function () { d3.select(this).raise(); })
            .on("drag", (event, d) => {
                d.fx = d.x = event.x;
                d.fy = d.y = event.y;
                positionNodes();
                positionLinks();
                drawHulls(currentFrame);
            }));

        positionLinks();
        drawHulls(frame);

        dayLabel.text(`Day ${frame.day}`);
        dateStamp.text(
            frame.win === 1
                ? longDate(frame.date)
                : `days ${frame.lo}–${frame.day} · ${longDate(frame.date)}`
        );

        updateSummary(frame);
        markDay(frame);
    }

    // ------------------------------------------------------- tooltip copy --

    function nodeRows(d) {
        const f = currentFrame;
        const vol = f.volume.get(d.id);
        const deg = f.degree.get(d.id);

        return [
            ["Sector", d.sector],
            ["Region", d.region],
            [f.win === 1 ? "Traded this day" : `Traded days ${f.lo}–${f.day}`,
                deg ? money(vol) : "nothing"],
            ["Partners", deg ? f.partners.get(d.id).map(p => p.short).join(", ") : "none"],
            ["Relationships in 60 days", String(pairs.filter(p => p.a.id === d.id || p.b.id === d.id).length)]
        ];
    }

    function nodeNote(d) {
        return currentFrame.opened.has(d.id)
            ? "Opened a new relationship in this frame."
            : null;
    }

    function linkTitle(d) {
        return `${d.a.short} — ${d.b.short}`;
    }

    function linkRows(d) {
        const f = currentFrame;
        return [
            ["Amount", money(d.amount)],
            ["Transactions", comma(d.count)],
            ["Type", d.mixed ? `${d.type} (mixed)` : d.type],
            ["Regions", d.pair.cross ? `${d.a.region} ⇄ ${d.b.region}` : d.a.region],
            ["Active in 60 days", `${d.pair.days.length} days (${d.pair.first}–${d.pair.last})`],
            [f.win === 1 ? "Day" : "Days in window", f.win === 1 ? String(f.day) : String(d.occurrences)]
        ];
    }

    function linkNote(d) {
        if (d.opens) return "First day of this relationship.";
        if (d.closes) return "Last day of this relationship.";
        return null;
    }

    // Clicking a link lights up the same relationship in the grid below.
    let pinnedPair = null;

    function highlightPair(key) {
        pinnedPair = pinnedPair === key ? null : key;

        linkG.selectAll("g.net-link")
            .classed("dim", d => pinnedPair && d.key !== pinnedPair);

        d3.selectAll("#relationships .rel-row")
            .classed("lit", d => pinnedPair === d.key);
    }

    netSvg.on("click", () => { if (pinnedPair) highlightPair(pinnedPair); });

    // ------------------------------------------------------- summary panel --

    const summary = d3.select("#day-summary");

    function updateSummary(frame) {
        const stats = [
            ["Active companies", `${new Set(frame.links.flatMap(l => [l.a.id, l.b.id])).size} of 12`],
            ["Active relationships", `${frame.links.length} of 27`],
            ["Traded value", money(frame.value)],
            ["Separate clusters", String(frame.clusters.length)],
            ["Cross-regional links", `${frame.crossCount} of ${frame.links.length}`]
        ];

        const rows = summary.select(".stat-rows")
            .selectAll("div.stat-row")
            .data(stats)
            .join(enter => {
                const g = enter.append("div").attr("class", "stat-row");
                g.append("span").attr("class", "stat-key");
                g.append("span").attr("class", "stat-val");
                return g;
            });

        rows.select(".stat-key").text(d => d[0]);
        rows.select(".stat-val").text(d => d[1]);

        const events = [];

        for (const l of frame.links) {
            if (l.opens) events.push(["opens", `${l.a.short} — ${l.b.short}`]);
        }
        for (const l of frame.links) {
            if (l.closes) events.push(["closes", `${l.a.short} — ${l.b.short}`]);
        }

        const biggest = d3.greatest(frame.links, l => l.amount);
        const busiest = d3.greatest(companies, c => frame.volume.get(c.id));

        summary.select(".stat-events")
            .selectAll("p")
            .data([
                ["Busiest", `${busiest.short} · ${money(frame.volume.get(busiest.id))}`],
                ["Largest link", biggest ? `${biggest.a.short} — ${biggest.b.short} · ${money(biggest.amount)}` : "—"],
                ["Cluster sizes", frame.clusters.length
                    ? frame.clusters.map(c => c.size).join(" · ")
                    : "—"]
            ])
            .join("p")
            .attr("class", "stat-note")
            .each(function (d) {
                this.textContent = "";
                const k = document.createElement("span");
                k.className = "note-key";
                k.textContent = `${d[0]} `;
                const v = document.createElement("strong");
                v.textContent = d[1];
                this.append(k, v);
            });

        const evSel = summary.select(".stat-changes")
            .selectAll("p")
            .data(events, d => d.join());

        evSel.exit().remove();

        evSel.enter()
            .append("p")
            .attr("class", d => `change ${d[0]}`)
            .merge(evSel)
            .each(function (d) {
                this.textContent = "";
                const tag = document.createElement("span");
                tag.className = "change-tag";
                tag.textContent = d[0] === "opens" ? "new" : "last day";
                const v = document.createElement("span");
                v.textContent = ` ${d[1]}`;
                this.append(tag, v);
            });

        summary.select(".stat-changes").classed("empty", events.length === 0);

        summary.select(".no-change")
            .style("display", events.length === 0 ? null : "none");
    }

    // ============================================================ overview --

    // Two static strips over the same 60-day axis. They are the answer to
    // "animation makes distant time points hard to compare": the shape of the
    // whole period stays on screen while one day is being animated.
    const oW = 940;
    const stripH = 62;
    // The top padding carries the two annotations, above the bars rather than
    // across them.
    const oPad = { top: 48, right: 22, bottom: 24, left: 52 };
    const oH = oPad.top + stripH * 2 + 30 + oPad.bottom;

    const oSvg = d3.select("#overview")
        .classed("loading", false)
        .append("svg")
        .attr("viewBox", `0 0 ${oW} ${oH}`)
        .attr("role", "img")
        .attr("aria-label",
            "Two strips over 60 days: number of active relationships per day, "
            + "and total value traded per day.");

    const oX = d3.scaleLinear()
        .domain([0.5, 60.5])
        .range([oPad.left, oW - oPad.right]);

    const strips = [
        {
            label: "Active relationships",
            y: oPad.top,
            value: d => d.links,
            format: d => comma(d.links),
            fmtAxis: comma
        },
        {
            label: "Value traded",
            y: oPad.top + stripH + 30,
            value: d => d.value,
            format: d => money(d.value),
            fmtAxis: moneyShort
        }
    ];

    for (const s of strips) {
        s.scale = d3.scaleLinear()
            .domain([0, d3.max(dayStats, s.value)]).nice()
            .range([s.y + stripH, s.y]);

        const g = oSvg.append("g").attr("class", "strip");

        g.append("text")
            .attr("class", "strip-title")
            .attr("x", oPad.left)
            .attr("y", s.y - 7)
            .text(s.label);

        g.append("g")
            .attr("class", "axis")
            .attr("transform", `translate(${oPad.left},0)`)
            .call(d3.axisLeft(s.scale).ticks(3).tickFormat(s.fmtAxis).tickSize(-(oW - oPad.left - oPad.right)))
            .call(sel => sel.select(".domain").remove())
            .call(sel => sel.selectAll(".tick line").attr("class", "grid-line"));

        // Bars, 2px of surface between them so adjacent days stay countable.
        s.bars = g.selectAll("rect.day-bar")
            .data(dayStats)
            .join("rect")
            .attr("class", "day-bar")
            .attr("x", d => oX(d.day - 0.5) + 1)
            .attr("width", Math.max(1, oX(1.5) - oX(0.5) - 2))
            .attr("y", d => s.scale(s.value(d)))
            .attr("height", d => s.scale(0) - s.scale(s.value(d)))
            .attr("rx", 1.5);
    }

    oSvg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${oPad.top + stripH * 2 + 30})`)
        .call(d3.axisBottom(oX).tickValues([1, 10, 20, 30, 40, 50, 60]).tickFormat(d => `day ${d}`));

    // The two structural breaks the data actually has, annotated so a reader
    // scrubbing the animation knows where to look.
    const marks = [
        { day: 20.5, text: "day 21 · Fusion becomes a hub" },
        { day: 40.5, text: "day 41 · Cedar & Ion cluster opens" }
    ];

    const markG = oSvg.selectAll("g.phase-mark")
        .data(marks)
        .join("g")
        .attr("class", "phase-mark")
        .attr("transform", d => `translate(${oX(d.day)},0)`);

    markG.append("line")
        .attr("y1", oPad.top - 26)
        .attr("y2", oPad.top + stripH * 2 + 30);

    markG.append("text")
        .attr("x", 5)
        .attr("y", 16)
        .text(d => d.text);

    // Current-day cursor: a caret above the bars rather than a rule through
    // them, so it cannot be mistaken for an outline on the highlighted bar.
    const cursor = oSvg.append("path")
        .attr("class", "day-cursor")
        .attr("d", "M-5,-10L5,-10L0,-1Z");

    const scrubDay = event => {
        const [mx] = d3.pointer(event, oSvg.node());
        return Math.max(1, Math.min(60, Math.round(oX.invert(mx))));
    };

    oSvg.append("rect")
        .attr("class", "scrub")
        .attr("x", oPad.left)
        .attr("y", oPad.top - 10)
        .attr("width", oW - oPad.left - oPad.right)
        .attr("height", stripH * 2 + 40)
        .on("pointermove", function (event) {
            const d = dayStats[scrubDay(event) - 1];
            showTip(event, `Day ${d.day} · ${isoDate(d.date)}`, [
                ["Active relationships", comma(d.links)],
                ["Active companies", `${d.active} of 12`],
                ["Value traded", money(d.value)]
            ], "Click to jump the animation here.");
        })
        .on("pointerleave", hideTip)
        .call(d3.drag()
            .on("start drag", event => goTo(scrubDay(event.sourceEvent))))
        .on("click", event => goTo(scrubDay(event)));

    // ==================================================== relationship grid --

    // 27 relationships × 60 days. Whether a relationship exists at all on a
    // given day is the one thing the animation cannot hold still, so it is
    // drawn once, statically: onset, recurrence rhythm and close-out all read
    // off a single picture.
    const rW = 940;
    const rowH = 12;
    const rPad = { top: 26, right: 20, bottom: 26, left: 208 };
    const rH = rPad.top + pairs.length * rowH + rPad.bottom;

    const rSvg = d3.select("#relationships")
        .classed("loading", false)
        .append("svg")
        .attr("viewBox", `0 0 ${rW} ${rH}`)
        .attr("role", "img")
        .attr("aria-label",
            "Grid of 27 commercial relationships by 60 days; a filled cell means "
            + "the two companies traded that day, darker means a larger amount.");

    const rX = d3.scaleBand()
        .domain(DAYS)
        .range([rPad.left, rW - rPad.right])
        .paddingInner(0.14);

    const rY = d3.scaleBand()
        .domain(pairs.map(p => p.key))
        .range([rPad.top, rH - rPad.bottom])
        .paddingInner(0.16);

    rSvg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${rPad.top - 6})`)
        .call(d3.axisTop(
            d3.scaleLinear().domain([0.5, 60.5]).range([rPad.left, rW - rPad.right])
        ).tickValues([1, 10, 20, 30, 40, 50, 60]).tickFormat(d => `day ${d}`));

    const relRows = rSvg.selectAll("g.rel-row")
        .data(pairs, p => p.key)
        .join("g")
        .attr("class", "rel-row")
        .attr("transform", p => `translate(0,${rY(p.key)})`);

    // Row label: the two regions as dots (so cross-regional rows are visible
    // as a pair of unlike colours), the two names, and the dash pattern that
    // identifies this relationship's transaction type in the network above.
    relRows.each(function (p) {
        const g = d3.select(this);
        const mid = rY.bandwidth() / 2;

        g.append("circle")
            .attr("cx", 8).attr("cy", mid).attr("r", 3.4)
            .attr("fill", REGION_COLOR[p.a.region]);

        g.append("circle")
            .attr("cx", 17).attr("cy", mid).attr("r", 3.4)
            .attr("fill", REGION_COLOR[p.b.region]);

        g.append("text")
            .attr("class", "rel-name")
            .attr("x", 26)
            .attr("y", mid)
            .attr("dominant-baseline", "middle")
            .text(`${p.a.short} — ${p.b.short}`);

        g.append("line")
            .attr("class", "rel-dash")
            .attr("x1", rPad.left - 44).attr("x2", rPad.left - 8)
            .attr("y1", mid).attr("y2", mid)
            .attr("stroke-dasharray", TYPE_DASH[p.type]);
    });

    relRows.append("rect")
        .attr("class", "rel-band")
        .attr("x", p => rX(p.first))
        .attr("width", p => rX(p.last) + rX.bandwidth() - rX(p.first))
        .attr("y", 1)
        .attr("height", rY.bandwidth() - 2);

    relRows.selectAll("rect.rel-cell")
        .data(p => p.rows.map(r => ({ ...r, pair: p })))
        .join("rect")
        .attr("class", "rel-cell")
        .attr("x", r => rX(r.day))
        .attr("width", rX.bandwidth())
        .attr("y", 0)
        .attr("height", rY.bandwidth())
        .attr("rx", 1.5)
        .attr("fill", r => amountColor(r.amount));

    const rhythm = p => Array.from(
        new Set(p.days.slice(1).map((d, i) => d - p.days[i]))
    ).sort(d3.ascending).join(" / ");

    bindTip(
        relRows.selectAll("rect.rel-cell"),
        r => `${r.pair.a.name} — ${r.pair.b.name}`,
        r => [
            ["Day", `${r.day} · ${isoDate(r.date)}`],
            ["Amount", money(r.amount)],
            ["Transactions", comma(r.count)],
            ["Type", r.type],
            ["Regions", r.pair.cross ? `${r.pair.a.region} ⇄ ${r.pair.b.region}` : r.pair.a.region],
            ["Relationship", `days ${r.pair.first}–${r.pair.last}, every ${rhythm(r.pair)} days`]
        ],
        () => "Click to jump the animation to this day."
    );

    relRows.selectAll("rect.rel-cell")
        .on("click", (event, r) => goTo(r.day));

    const relCursor = rSvg.append("rect")
        .attr("class", "rel-cursor")
        .attr("y", rPad.top - 4)
        .attr("height", pairs.length * rowH + 6)
        .attr("width", rX.step());

    function markDay(frame) {
        cursor.attr("transform", `translate(${oX(frame.day)},${oPad.top})`);

        for (const s of strips) {
            s.bars
                .classed("current", d => d.day === frame.day)
                .classed("in-window", d => d.day >= frame.lo && d.day <= frame.day);
        }

        relCursor.attr("x", rX(frame.lo) - 1)
            .attr("width", rX(frame.day) + rX.bandwidth() - rX(frame.lo) + 2);
    }

    // ============================================================= legend --

    buildNetworkLegend();

    function buildNetworkLegend() {
        const legend = d3.select("#network-legend");

        // Region — colour.
        const regionBlock = legend.append("div").attr("class", "legend-block");
        regionBlock.append("span").attr("class", "legend-label").text("Region — node colour");
        const regionRows = regionBlock.append("div").attr("class", "legend-rows horizontal");

        for (const r of REGIONS) {
            const row = regionRows.append("span").attr("class", "legend-swatch-row static");
            row.append("span").attr("class", "tip-swatch").style("background", REGION_COLOR[r]);
            row.append("span").text(r);
        }

        // Sector — shape.
        const sectorBlock = legend.append("div").attr("class", "legend-block");
        sectorBlock.append("span").attr("class", "legend-label").text("Sector — node shape");
        const sectorRows = sectorBlock.append("div").attr("class", "legend-rows horizontal");

        for (const s of SECTORS) {
            const row = sectorRows.append("span").attr("class", "legend-swatch-row static");
            row.append("svg")
                .attr("width", 18).attr("height", 18)
                .append("path")
                .attr("transform", "translate(9,9)")
                .attr("fill", INK_SOFT)
                .attr("d", d3.symbol().type(SECTOR_SYMBOL[s]).size(90)());
            row.append("span").text(s);
        }

        // Transaction type — dash.
        const typeBlock = legend.append("div").attr("class", "legend-block");
        typeBlock.append("span").attr("class", "legend-label").text("Transaction type — link dash");
        const typeRows = typeBlock.append("div").attr("class", "legend-rows horizontal");

        for (const t of TYPES) {
            const row = typeRows.append("span").attr("class", "legend-swatch-row static");
            row.append("svg")
                .attr("width", 30).attr("height", 12)
                .append("line")
                .attr("x1", 1).attr("x2", 29).attr("y1", 6).attr("y2", 6)
                .attr("stroke", LINK_GREY).attr("stroke-width", 2.5)
                .attr("stroke-dasharray", TYPE_DASH[t]);
            row.append("span").text(t);
        }

        // Magnitudes and the temporal events.
        const sizeBlock = legend.append("div").attr("class", "legend-block");
        sizeBlock.append("span").attr("class", "legend-label").text("Magnitude");

        const sizeSvg = sizeBlock.append("svg")
            .attr("width", 210).attr("height", 60);

        sizeSvg.append("text").attr("class", "legend-tick").attr("x", 0).attr("y", 10)
            .text("node area — traded that day");

        const sizeStops = [20000, 60000, maxNodeVolume];
        let sx = 20;

        for (const v of sizeStops) {
            sizeSvg.append("path")
                .attr("transform", `translate(${sx},32)`)
                .attr("fill", "#c9c8c2")
                .attr("stroke", "#ffffff")
                .attr("d", d3.symbol().type(d3.symbolCircle).size(areaScale(v))());

            sizeSvg.append("text")
                .attr("class", "legend-tick")
                .attr("x", sx).attr("y", 56)
                .attr("text-anchor", "middle")
                .text(moneyShort(v));

            sx += radiusOf(areaScale(v)) + 44;
        }

        const widthSvg = sizeBlock.append("svg")
            .attr("width", 210).attr("height", 34);

        widthSvg.append("text").attr("class", "legend-tick").attr("x", 0).attr("y", 10)
            .text("link width — amount");

        [amountExtent[0], amountExtent[1]].forEach((v, i) => {
            widthSvg.append("line")
                .attr("x1", 4 + i * 110).attr("x2", 54 + i * 110)
                .attr("y1", 22).attr("y2", 22)
                .attr("stroke", LINK_GREY)
                .attr("stroke-width", widthScale(v));

            widthSvg.append("text")
                .attr("class", "legend-tick")
                .attr("x", 60 + i * 110).attr("y", 26)
                .text(moneyShort(v));
        });

        const eventBlock = legend.append("div").attr("class", "legend-block");
        eventBlock.append("span").attr("class", "legend-label").text("Temporal events");
        const eventRows = eventBlock.append("div").attr("class", "legend-rows");

        const events = [
            ["First day of a relationship", "dark line, filled dot at its middle; the node gets a dark ring"],
            ["Last day of a relationship", "hollow ring at its middle"],
            ["No trade today", "node greys out and shrinks, but keeps its place"],
            ["Separate clusters", "soft grey halo traced along each connected group's links"]
        ];

        for (const [k, v] of events) {
            const row = eventRows.append("span").attr("class", "legend-swatch-row static");
            row.append("span").attr("class", "legend-key").text(k);
            row.append("span").attr("class", "legend-note").text(v);
        }
    }

    // ========================================================== the table --

    buildTable();

    function buildTable() {
        const table = d3.select("#rel-table");

        const cols = [
            ["Relationship", p => `${p.a.name} — ${p.b.name}`, false],
            ["Regions", p => (p.cross ? `${p.a.region} ⇄ ${p.b.region}` : p.a.region), false],
            ["Type", p => p.type, false],
            ["Days active", p => comma(p.days.length), true],
            ["First", p => String(p.first), true],
            ["Last", p => String(p.last), true],
            ["Total", p => money(p.total), true],
            ["Mean/day", p => money(p.total / p.days.length), true]
        ];

        table.select("thead")
            .append("tr")
            .selectAll("th")
            .data(cols)
            .join("th")
            .attr("class", c => (c[2] ? "num" : null))
            .text(c => c[0]);

        table.select("tbody")
            .selectAll("tr")
            .data(pairs)
            .join("tr")
            .selectAll("td")
            .data(p => cols.map(c => [c[1](p), c[2]]))
            .join("td")
            .attr("class", c => (c[1] ? "num" : null))
            .text(c => c[0]);
    }

    // ========================================================== controls --

    let day = 1;
    let win = 1;
    let showClusters = true;
    let timer = null;
    let stepMs = 420;

    const slider = d3.select("#day-slider");

    function frameDur() {
        return Math.min(340, stepMs * 0.8);
    }

    function goTo(d, dur) {
        day = Math.max(1, Math.min(60, d));
        slider.property("value", day);
        render(computeFrame(day, win), dur === undefined ? frameDur() : dur);
    }

    function play() {
        if (timer) return;

        // Restart from the beginning rather than sitting on the last frame.
        if (day >= 60) day = 0;

        d3.select("#play").classed("active", true);

        timer = d3.interval(() => {
            day += 1;
            goTo(day);

            if (day >= 60) pause();
        }, stepMs);
    }

    function pause() {
        if (timer) {
            timer.stop();
            timer = null;
        }
        d3.select("#play").classed("active", false);
    }

    function reset() {
        pause();
        goTo(1, 200);
    }

    d3.select("#play").on("click", () => (timer ? pause() : play()));
    d3.select("#pause").on("click", pause);
    d3.select("#reset").on("click", reset);

    slider.on("input", function () {
        pause();
        goTo(+this.value, 160);
    });

    d3.select("#speed").on("change", function () {
        stepMs = +this.value;
        if (timer) { pause(); play(); }
    });

    d3.selectAll("#window-set button").on("click", function () {
        d3.selectAll("#window-set button").classed("active", false);
        d3.select(this).classed("active", true);
        win = +this.dataset.win;
        goTo(day, 260);
    });

    d3.select("#show-clusters").on("change", function () {
        showClusters = this.checked;
        drawHulls(currentFrame);
    });

    d3.select("#resettle").on("click", () => {
        for (const c of companies) { c.fx = null; c.fy = null; }

        simulation.alpha(0.9).restart();

        setTimeout(() => {
            simulation.stop();
            fitAndPin();
            positionNodes();
            positionLinks();
            drawHulls(currentFrame);
        }, 1600);
    });

    goTo(1, 0);
}

// ============================================================================
// Part 2 — In-lab Tasks 1–11: weather line chart and animated marker
// ============================================================================

// Eight cities, in the site's fixed categorical order — assigned to the city,
// never re-assigned when the selection changes, so a city keeps its colour.
const CITY_ORDER = [
    "Tokyo", "London", "New York", "Singapore",
    "Sydney", "Cairo", "São Paulo", "Toronto"
];

const CITY_COLOR = d3.scaleOrdinal()
    .domain(CITY_ORDER)
    .range(["#2a78d6", "#eb6834", "#1baf7a", "#eda100",
            "#e87ba4", "#008300", "#4a3aa7", "#e34948"]);

const METRICS = {
    temperature_c: { label: "Temperature", unit: "°C", fmt: d3.format(".1f") },
    humidity_pct: { label: "Humidity", unit: "%", fmt: d3.format(".1f") },
    wind_speed_mps: { label: "Wind speed", unit: "m/s", fmt: d3.format(".1f") },
    pressure_hpa: { label: "Pressure", unit: "hPa", fmt: d3.format(".1f") },
    precipitation_mm: { label: "Precipitation", unit: "mm", fmt: d3.format(".1f") }
};

d3.csv("../data/lab7_historical_weather.csv", d => ({
    date: parseDay(d.date),
    city: d.city,
    country: d.country,
    temperature_c: +d.temperature_c,
    humidity_pct: +d.humidity_pct,
    wind_speed_mps: +d.wind_speed_mps,
    pressure_hpa: +d.pressure_hpa,
    precipitation_mm: +d.precipitation_mm
}))
    .then(buildWeather)
    .catch(err => {
        d3.select("#weather").classed("loading", true)
            .text("Could not load the weather data — open this page over http, not as a file.");
        console.error(err);
    });

function buildWeather(data) {

    // Task 2: the parsed rows, as the instructions ask.
    console.log("Lab 7 · weather rows parsed:", data.length, data.slice(0, 3));

    const byCity = d3.group(data, d => d.city);

    for (const [, rows] of byCity) {
        rows.sort((a, b) => d3.ascending(a.date, b.date));
    }

    const dates = byCity.get("Tokyo").map(d => d.date);
    const lastIndex = dates.length - 1;

    const W = 940;
    const H = 460;
    const m = { top: 24, right: 104, bottom: 44, left: 62 };

    const svg = d3.select("#weather")
        .classed("loading", false)
        .append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", "Line chart of a weather metric over time for the selected cities.");

    const xScale = d3.scaleTime().range([m.left, W - m.right]);
    const yScale = d3.scaleLinear().range([H - m.bottom, m.top]);

    const clipId = "weather-clip";

    svg.append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("x", m.left).attr("y", m.top - 4)
        .attr("width", W - m.left - m.right)
        .attr("height", H - m.top - m.bottom + 8);

    const gridG = svg.append("g")
        .attr("class", "axis grid")
        .attr("transform", `translate(${m.left},0)`);
    const xAxisG = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.bottom})`);
    const yAxisG = svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`);

    const yTitle = svg.append("text")
        .attr("class", "axis-label")
        .attr("x", m.left)
        .attr("y", m.top - 9);

    const plotG = svg.append("g").attr("clip-path", `url(#${clipId})`);
    const lineG = plotG.append("g").attr("class", "series");
    const markerG = plotG.append("g").attr("class", "markers");
    const labelG = svg.append("g").attr("class", "end-labels");

    const hairline = plotG.append("line")
        .attr("class", "hairline")
        .attr("y1", m.top).attr("y2", H - m.bottom)
        .style("display", "none");

    const dateStamp = svg.append("text")
        .attr("class", "date-stamp")
        .attr("x", W - m.right)
        .attr("y", m.top + 4)
        .attr("text-anchor", "end");

    // ------------------------------------------------------------- state --

    let metric = "temperature_c";
    let visible = new Set(["Tokyo", "London", "New York"]);
    let range = [0, lastIndex];
    let index = 0;
    let timer = null;

    const line = d3.line()
        .x(d => xScale(d.date))
        .y(d => yScale(d[metric]));

    function windowRows(city) {
        return byCity.get(city).slice(range[0], range[1] + 1);
    }

    function render(dur) {
        const shown = CITY_ORDER.filter(c => visible.has(c));
        const meta = METRICS[metric];

        xScale.domain([dates[range[0]], dates[range[1]]]);

        const values = shown.flatMap(c => windowRows(c).map(r => r[metric]));

        yScale.domain(values.length ? d3.extent(values) : [0, 1]).nice();

        xAxisG.transition().duration(dur).call(d3.axisBottom(xScale).ticks(8));
        yAxisG.transition().duration(dur).call(d3.axisLeft(yScale).ticks(6));

        gridG.transition().duration(dur)
            .call(d3.axisLeft(yScale).ticks(6).tickSize(-(W - m.left - m.right)).tickFormat(""))
            .call(sel => sel.select(".domain").remove())
            .call(sel => sel.selectAll(".tick line").attr("class", "grid-line"));

        yTitle.text(`${meta.label} (${meta.unit})`);

        // Task 4: one path per city, from d3.group.
        lineG.selectAll("path.city-line")
            .data(shown.map(c => [c, windowRows(c)]), d => d[0])
            .join(
                enter => enter.append("path")
                    .attr("class", "city-line")
                    .attr("fill", "none")
                    .attr("stroke", d => CITY_COLOR(d[0]))
                    .attr("stroke-width", 2)
                    .attr("d", d => line(d[1])),
                update => update,
                exit => exit.remove()
            )
            .transition().duration(dur)
            .attr("stroke", d => CITY_COLOR(d[0]))
            .attr("d", d => line(d[1]));

        // Direct labels at the right end: identity without hunting in a legend,
        // and the relief for the palette's low-contrast slots. The name is ink;
        // the short stroke beside it carries the city's colour.
        const endPos = d => {
            const last = d[1][d[1].length - 1];
            return `translate(0,${last ? yScale(last[metric]) : m.top})`;
        };

        labelG.selectAll("g.end-label")
            .data(shown.map(c => [c, windowRows(c)]), d => d[0])
            .join(enter => {
                // Entering labels are placed directly; only labels that were
                // already on screen have somewhere to travel from.
                const g = enter.append("g")
                    .attr("class", "end-label")
                    .attr("transform", endPos);

                g.append("line")
                    .attr("x1", W - m.right + 6)
                    .attr("x2", W - m.right + 18);

                g.append("text")
                    .attr("x", W - m.right + 24)
                    .attr("dy", "0.32em");

                return g;
            })
            .call(g => {
                g.select("line").attr("stroke", d => CITY_COLOR(d[0]));
                g.select("text").text(d => d[0]);
            })
            .transition().duration(dur)
            .attr("transform", endPos);

        showFrame(Math.max(range[0], Math.min(range[1], index)), dur);
        updateLegend();
    }

    // ------------------------------------------- Tasks 9–10: the animation --

    function showFrame(i, dur = 0) {
        index = i;

        const shown = CITY_ORDER.filter(c => visible.has(c));
        const meta = METRICS[metric];

        markerG.selectAll("circle.marker")
            .data(shown.map(c => byCity.get(c)[i]), d => d.city)
            .join("circle")
            .attr("class", "marker")
            .attr("r", 6)
            .attr("fill", d => CITY_COLOR(d.city))
            .transition().duration(dur)
            .attr("cx", d => xScale(d.date))
            .attr("cy", d => yScale(d[metric]));

        dateStamp.text(isoDate(dates[i]));

        d3.select("#time-slider").property("value", i);

        d3.select("#frame-readout").text(
            shown.length
                ? shown.map(c => `${c} ${meta.fmt(byCity.get(c)[i][metric])}${meta.unit}`).join(" · ")
                : "no city selected"
        );
    }

    function play() {
        if (timer) return;
        if (index >= range[1]) index = range[0] - 1;

        d3.select("#w-play").classed("active", true);

        timer = d3.interval(() => {
            index += 1;
            showFrame(index, 120);
            if (index >= range[1]) pause();
        }, 150);
    }

    function pause() {
        if (timer) { timer.stop(); timer = null; }
        d3.select("#w-play").classed("active", false);
    }

    d3.select("#w-play").on("click", () => (timer ? pause() : play()));
    d3.select("#w-pause").on("click", pause);
    d3.select("#w-reset").on("click", () => { pause(); showFrame(range[0], 200); });

    d3.select("#time-slider")
        .attr("min", 0)
        .attr("max", lastIndex)
        .on("input", function () {
            pause();
            showFrame(+this.value, 90);
        });

    // ------------------------------------------- Task 6: crosshair tooltip --

    // One readout for every visible city at the hovered date, so the pointer
    // never has to land on a 2px line.
    const bisectDate = d3.bisector(d => d.date).center;

    const overlay = svg.append("g").attr("class", "hover-layer");

    overlay.append("rect")
        .attr("x", m.left).attr("y", m.top)
        .attr("width", W - m.left - m.right)
        .attr("height", H - m.top - m.bottom)
        .attr("fill", "none")
        .attr("pointer-events", "all")
        .on("pointerenter pointermove", moved)
        .on("pointerleave", () => {
            hairline.style("display", "none");
            hideTip();
        });

    function moved(event) {
        const shown = CITY_ORDER.filter(c => visible.has(c));
        if (!shown.length) return;

        const [mx] = d3.pointer(event, svg.node());
        const date = xScale.invert(mx);
        const i = Math.max(range[0], Math.min(range[1], bisectDate(byCity.get(shown[0]), date)));
        const meta = METRICS[metric];

        hairline
            .style("display", null)
            .attr("x1", xScale(dates[i]))
            .attr("x2", xScale(dates[i]));

        showTip(
            event,
            longDate(dates[i]),
            shown.map(c => {
                const row = byCity.get(c)[i];
                return [c, `${meta.fmt(row[metric])} ${meta.unit}`];
            }),
            "Every selected city at this date."
        );
    }

    // ------------------------------- Task 7: brush and date-input filtering --

    const brush = d3.brushX()
        .extent([[m.left, m.top], [W - m.right, H - m.bottom]])
        .on("end", brushed);

    const brushG = svg.append("g").attr("class", "brush").call(brush);

    // The brush overlay sits on top, so the crosshair handlers move onto it —
    // a plain move still reads values, a drag still selects a range.
    brushG.select(".overlay")
        .on("pointermove.hover", moved)
        .on("pointerleave.hover", () => {
            hairline.style("display", "none");
            hideTip();
        });

    function brushed(event) {
        if (!event.selection) return;

        const [x0, x1] = event.selection;

        // Task 7: xScale.invert turns a screen position back into a date.
        const i0 = bisectDate(byCity.get(CITY_ORDER[0]), xScale.invert(x0));
        const i1 = bisectDate(byCity.get(CITY_ORDER[0]), xScale.invert(x1));

        if (i1 - i0 < 2) { brushG.call(brush.move, null); return; }

        pause();
        range = [i0, i1];
        index = i0;
        brushG.call(brush.move, null);
        syncRangeInputs();
        render(600);
    }

    function syncRangeInputs() {
        d3.select("#start-date").property("value", isoDate(dates[range[0]]));
        d3.select("#end-date").property("value", isoDate(dates[range[1]]));
        d3.select("#time-slider").attr("min", range[0]).attr("max", range[1]);
        d3.select("#range-readout").text(
            `${isoDate(dates[range[0]])} → ${isoDate(dates[range[1]])} · ${range[1] - range[0] + 1} days`
        );
    }

    d3.select("#apply-range").on("click", () => {
        const start = parseDay(d3.select("#start-date").property("value"));
        const end = parseDay(d3.select("#end-date").property("value"));
        if (!start || !end || start >= end) return;

        const rows = byCity.get(CITY_ORDER[0]);
        const i0 = Math.max(0, bisectDate(rows, start));
        const i1 = Math.min(lastIndex, bisectDate(rows, end));
        if (i1 - i0 < 2) return;

        pause();
        range = [i0, i1];
        index = i0;
        syncRangeInputs();
        render(600);
    });

    d3.select("#reset-range").on("click", () => {
        pause();
        range = [0, lastIndex];
        index = 0;
        syncRangeInputs();
        render(600);
    });

    // ----------------------------------------- Task 5: the metric switch --

    d3.select("#metric").on("change", function () {
        metric = this.value;
        render(600);
    });

    // ------------------------------------------------- city legend/filter --

    const legend = d3.select("#weather-legend")
        .append("div").attr("class", "legend-block");

    legend.append("span").attr("class", "legend-label").text("City — click to show or hide");

    const rows = legend.append("div").attr("class", "legend-rows horizontal");

    const cityRows = rows.selectAll("button")
        .data(CITY_ORDER)
        .join("button")
        .attr("type", "button")
        .attr("class", "legend-swatch-row")
        .on("click", (event, c) => {
            if (visible.has(c)) {
                if (visible.size > 1) visible.delete(c);
            } else {
                visible.add(c);
            }
            render(400);
        });

    cityRows.append("span").attr("class", "tip-swatch").style("background", c => CITY_COLOR(c));
    cityRows.append("span").text(c => c);

    function updateLegend() {
        cityRows.classed("pinned", c => visible.has(c));
    }

    syncRangeInputs();
    render(0);
}
