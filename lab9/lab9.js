// Lab 9: 2025 GDP as a choropleth (colour) and a cartogram (area).
//
// Both maps read one shared state: the hovered economy and the pinned
// (clicked) one. Highlighting, the selection bar and the table all redraw from
// that state, so a country picked anywhere lights up everywhere.

// ---------------------------------------------------------------- palette --

// Sequential blue ramp, steps 150 → 700: six GDP classes, light = small.
const RAMP = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];

const SCALES = {
    log: { thresholds: [500, 1000, 2000, 5000, 10000], min: 300 },
    linear: { thresholds: [5000, 10000, 15000, 20000, 25000], min: 0 }
};

const CARTO_FILL = "#86b6ef";
const W = 960;

const fmtInt = d3.format(",.0f");
const fmtPct = d3.format(".1%");
const fmtGDP = v => v >= 1000
    ? `$${d3.format(".1f")(v / 1000)} trillion`
    : `$${fmtInt(v)} billion`;
// Land shares of small countries are tiny; keep two significant digits.
const fmtShare = v => v < 0.001 ? d3.format(".2r")(v * 100) + "%" : fmtPct(v);
const fmtFactor = f => f >= 100 ? fmtInt(f) : f >= 10 ? d3.format(".0f")(f) : d3.format(".2~f")(f);

const tooltip = d3.select("#tooltip");

// ------------------------------------------------------------------ state --

const state = {
    hover: null,     // iso3 under the pointer, in either map or the table
    pinned: null,    // iso3 clicked or chosen in the select
    scale: "log",
    t: 1             // cartogram morph: 0 = land area, 1 = GDP area
};

const listeners = [];
const update = () => listeners.forEach(fn => fn());
const focus = () => state.hover || state.pinned;

function setHover(iso3) {
    if (state.hover === iso3) return;
    state.hover = iso3;
    update();
}

function togglePin(iso3) {
    state.pinned = state.pinned === iso3 ? null : iso3;
    update();
}

function showTip(event, html) {
    tooltip.html(html)
        .style("left", `${event.pageX + 14}px`)
        .style("top", `${event.pageY - 10}px`)
        .style("opacity", 1);
}

const hideTip = () => tooltip.style("opacity", 0);

// A hatched neutral fill for "no data", defined once per SVG so it can never
// be mistaken for the palest GDP class.
function addNoDataPattern(svg, id) {
    const p = svg.append("defs").append("pattern")
        .attr("id", id)
        .attr("width", 5)
        .attr("height", 5)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("patternTransform", "rotate(45)");
    p.append("rect").attr("width", 5).attr("height", 5).attr("fill", "#f1f0ec");
    p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 5)
        .attr("stroke", "#c9c7bf").attr("stroke-width", 1.5);
    return `url(#${id})`;
}

// A ring around the highlighted country when it is too small to see at the
// current zoom (Singapore and Hong Kong on the land map are a few pixels).
function addLocator(mapGroup) {
    const ring = mapGroup.append("circle")
        .attr("class", "l9-locator")
        .attr("display", "none");
    return (node, k) => {
        if (!node) { ring.attr("display", "none"); return; }
        const b = node.getBBox();
        const small = Math.max(b.width, b.height) * k < 14;
        ring.raise()
            .attr("display", small ? null : "none")
            .attr("cx", b.x + b.width / 2)
            .attr("cy", b.y + b.height / 2)
            .attr("r", 11 / k);
    };
}

// ------------------------------------------------------------------- load --

Promise.all([
    d3.json("../data/lab9_world_countries.geojson"),
    d3.json("../data/lab9_gdp_cartogram.geojson"),
    d3.csv("../data/lab9_gdp_2025_top50.csv", d => ({
        iso3: d.iso3,
        country: d.country,
        gdp: +d.gdp_2025_billion_usd,
        rank: +d.rank
    }))
]).then(([geoData, cartoData, stats]) => {

    // Part A: join GDP onto the boundaries by ISO-3 code.
    const statById = new Map(stats.map(d => [d.iso3, d]));
    const totalGDP = d3.sum(stats, d => d.gdp);

    geoData.features.forEach((feature, i) => {
        const p = feature.properties;
        const s = statById.get(p.iso3);
        const c = cartoData.features[i].properties;
        console.assert(c.iso3 === p.iso3, "cartogram feature order differs", p.iso3, c.iso3);
        p.value = s ? s.gdp : null;           // null = no data, never 0
        p.rank = s ? s.rank : null;
        p.label = s ? s.country : p.name;
        p.share = s ? s.gdp / totalGDP : null;
        p.geoShare = c.geo_share;
        p.cartoShare = c.carto_share;
    });

    const featureById = new Map(geoData.features.map(f => [f.properties.iso3, f]));
    reportJoin(stats, geoData, featureById);

    const ctx = { geoData, cartoData, stats, statById, featureById, totalGDP };
    buildSelectionBar(ctx);
    drawChoropleth(ctx);
    drawCartogram(ctx);
    fillTable(ctx);
    update();
});

function reportJoin(stats, geoData, featureById) {
    const matched = stats.filter(d => featureById.has(d.iso3));
    const unmatched = stats.filter(d => !featureById.has(d.iso3)).map(d => d.iso3);
    const noData = geoData.features.filter(f => f.properties.value == null).length;
    d3.select("#join-check").html(
        `<code>feature.properties.iso3</code> &harr; <code>iso3</code>:
         <strong>${matched.length} of ${stats.length}</strong> economies matched a
         boundary${unmatched.length ? ` (unmatched: ${unmatched.join(", ")})` : ""},
         each exactly once; ${noData} of ${geoData.features.length} features have no
         GDP value. Natural Earth codes France and Norway as <code>-99</code>, which
         a plain join drops; <a href="build_world.py">build_world.py</a> repairs them.`
    );
}

// ------------------------------------------------------- tooltip content --

function tipHTML(p, view) {
    if (p.value == null) {
        const note = view === "cartogram"
            ? "Its size on the cartogram is a placeholder, not GDP."
            : "Shown as missing, not as zero.";
        return `<div class="tip-head">${p.name}</div>
            <div class="tip-row"><span class="tip-key">No GDP value:</span> not among the 50 economies in the file</div>
            <div class="tip-note">${note}</div>`;
    }
    const rows = [
        `<div class="tip-row"><strong>${fmtGDP(p.value)}</strong> <span class="tip-key">2025 GDP</span></div>`,
        `<div class="tip-row"><strong>#${p.rank}</strong> <span class="tip-key">of 50 &middot;</span> <strong>${fmtPct(p.share)}</strong> <span class="tip-key">of top-50 GDP</span></div>`
    ];
    if (view === "cartogram") {
        rows.push(`<div class="tip-row"><strong>${fmtShare(p.cartoShare)}</strong> <span class="tip-key">of the map &middot; land share</span> <strong>${fmtShare(p.geoShare)}</strong></div>`);
        rows.push(`<div class="tip-note">Area &times;${fmtFactor(p.cartoShare / p.geoShare)} its land area</div>`);
    }
    return `<div class="tip-head">${p.label}</div>${rows.join("")}`;
}

// ------------------------------------------------------- selection bar --

function buildSelectionBar({ stats, featureById }) {
    const select = d3.select("#economy-select");
    select.append("option").attr("value", "").text("Find an economy…");
    select.selectAll("option.economy")
        .data(stats.slice().sort((a, b) => a.rank - b.rank))
        .join("option")
        .attr("class", "economy")
        .attr("value", d => d.iso3)
        .text(d => `${d.rank}. ${d.country}`);

    select.on("change", function () {
        state.pinned = this.value || null;
        update();
    });

    d3.select("#clear-selection").on("click", () => {
        state.pinned = null;
        update();
    });

    listeners.push(() => {
        select.property("value", state.pinned || "");
        d3.select("#clear-selection").attr("hidden", state.pinned ? null : true);

        const id = focus();
        const readout = d3.select("#selection-readout");
        if (!id) {
            readout.html(`<span class="l9-hint">Hover or click a country in either map.</span>`);
            return;
        }
        const p = featureById.get(id).properties;
        readout.html(p.value == null
            ? `<strong>${p.name}</strong> &middot; no GDP value in the dataset`
            : `<strong>${p.label}</strong> &middot; ${fmtGDP(p.value)} (#${p.rank}) &middot;
               ${fmtShare(p.geoShare)} of land &rarr; ${fmtShare(p.cartoShare)} of the cartogram
               (&times;${fmtFactor(p.cartoShare / p.geoShare)})`);
    });
}

// ------------------------------------------------------------ choropleth --

function drawChoropleth({ geoData, stats }) {
    const projection = d3.geoEqualEarth().fitWidth(W, geoData);
    const path = d3.geoPath().projection(projection);
    const H = Math.ceil(path.bounds(geoData)[1][1]) + 2;

    const container = d3.select("#choropleth").classed("loading", false).html("");
    const svg = container.append("svg")
        .attr("viewBox", [0, 0, W, H])
        .attr("role", "img")
        .attr("aria-label", "World choropleth map of 2025 nominal GDP for the 50 largest economies");

    const noData = addNoDataPattern(svg, "nodata-choropleth");
    svg.append("rect").attr("class", "l9-ocean").attr("width", W).attr("height", H);

    const mapGroup = svg.append("g");

    mapGroup.append("path")
        .datum(d3.geoGraticule10())
        .attr("class", "l9-graticule")
        .attr("d", path);

    const countries = mapGroup.selectAll(".country")
        .data(geoData.features)
        .join("path")
        .attr("class", "country")
        .attr("d", path)
        .on("pointerenter", (event, d) => setHover(d.properties.iso3))
        .on("pointermove", (event, d) => showTip(event, tipHTML(d.properties, "choropleth")))
        .on("pointerleave", () => { setHover(null); hideTip(); })
        .on("click", (event, d) => togglePin(d.properties.iso3));

    const locate = addLocator(mapGroup);
    let k = 1;

    // Zoom and pan; strokes keep their width because of non-scaling-stroke.
    const zoom = d3.zoom()
        .scaleExtent([1, 8])
        .translateExtent([[0, 0], [W, H]])
        .on("zoom", event => {
            k = event.transform.k;
            mapGroup.attr("transform", event.transform);
            locate(countries.filter(".lit").node(), k);
        });
    svg.call(zoom);
    d3.select("#choropleth-reset").on("click", () =>
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity));

    // Clicking open sea clears the pinned country.
    svg.on("click", event => {
        if (event.target.classList.contains("country")) return;
        if (state.pinned) { state.pinned = null; update(); }
    });

    d3.selectAll("#scale-buttons button").on("click", function () {
        state.scale = this.dataset.scale;
        d3.selectAll("#scale-buttons button").classed("active", function () {
            return this.dataset.scale === state.scale;
        });
        update();
    });

    let drawnScale = null;
    listeners.push(() => {
        if (drawnScale !== state.scale) {
            const target = drawnScale === null ? countries : countries.transition().duration(400);
            drawnScale = state.scale;
            const color = d3.scaleThreshold(SCALES[state.scale].thresholds, RAMP);
            target.attr("fill", d => d.properties.value == null ? noData : color(d.properties.value));
            drawLegend(stats, color);
        }
        const id = focus();
        // No fading here: a faded fill would read as a lighter GDP class.
        countries.classed("lit", d => d.properties.iso3 === id);
        locate(countries.filter(".lit").raise().node(), k);
    });
}

// Stepped legend: one block per class with its limits and how many of the 50
// economies fall in it, plus the no-data swatch.
function drawLegend(stats, color) {
    const { thresholds, min } = SCALES[state.scale];
    const max = d3.max(stats, d => d.gdp);
    const edges = [min, ...thresholds, max];
    const classes = RAMP.map((fill, i) => ({
        fill,
        lo: edges[i],
        hi: edges[i + 1],
        n: stats.filter(d => color(d.gdp) === fill).length
    }));

    const legend = d3.select("#choropleth-legend").html("");
    legend.append("div").attr("class", "legend-label")
        .text("2025 GDP, billion USD (count of economies in each class)");

    const row = legend.append("div").attr("class", "l9-steps");
    const step = row.selectAll(".l9-step")
        .data(classes)
        .join("div")
        .attr("class", "l9-step")
        .classed("empty", d => d.n === 0);
    step.append("span").attr("class", "l9-chip").style("background", d => d.fill);
    step.append("span").attr("class", "l9-count").text(d => d.n === 0 ? "none" : d.n);

    const ticks = legend.append("div").attr("class", "l9-ticks");
    ticks.selectAll("span")
        .data(edges)
        .join("span")
        .text((d, i) => i === edges.length - 1 ? fmtInt(d) + " (max)" : fmtInt(d));

    legend.append("div").attr("class", "l9-nodata")
        .html(`<span class="l9-chip hatched"></span> No data (outside the top 50)`);
}

// ------------------------------------------------------------- cartogram --

function drawCartogram({ geoData, cartoData, statById }) {
    // The cartogram file is in raw Equal Earth units, so the land-area start
    // of the morph is the same raw projection applied to the original
    // longitudes and latitudes, vertex for vertex.
    const rad = Math.PI / 180;
    const raw = d3.geoEqualEarthRaw;
    const polysOf = g => g.type === "Polygon" ? [g.coordinates] : g.coordinates;

    const start = geoData.features.map(f =>
        polysOf(f.geometry).map(rings => rings.map(ring => ring.map(([lon, lat]) => raw(lon * rad, lat * rad)))));
    const end = cartoData.features.map(f => polysOf(f.geometry));

    // One fit for both states, so the morph does not rescale as it plays.
    const corners = [...start, ...end].flat(3);
    const identity = d3.geoIdentity().reflectY(true)
        .fitWidth(W, { type: "MultiPoint", coordinates: corners });
    const path = d3.geoPath(identity);
    const H = Math.ceil(path.bounds({ type: "MultiPoint", coordinates: corners })[1][1]) + 2;

    const shapeAt = (i, t) => ({
        type: "MultiPolygon",
        coordinates: t === 1 ? end[i] : t === 0 ? start[i] : start[i].map((rings, a) => rings.map((ring, b) =>
            ring.map(([x0, y0], c) => {
                const [x1, y1] = end[i][a][b][c];
                return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
            })))
    });

    const container = d3.select("#cartogram").classed("loading", false).html("");
    const svg = container.append("svg")
        .attr("viewBox", [0, 0, W, H])
        .attr("role", "img")
        .attr("aria-label", "Cartogram in which each country's area is proportional to its 2025 GDP");

    const noData = addNoDataPattern(svg, "nodata-cartogram");
    svg.append("rect").attr("class", "l9-ocean").attr("width", W).attr("height", H);

    const mapGroup = svg.append("g");
    const features = geoData.features;

    const countries = mapGroup.selectAll(".country")
        .data(features)
        .join("path")
        .attr("class", "country")
        .attr("fill", d => d.properties.value == null ? noData : CARTO_FILL)
        .on("pointerenter", (event, d) => setHover(d.properties.iso3))
        .on("pointermove", (event, d) => showTip(event, tipHTML(d.properties, "cartogram")))
        .on("pointerleave", () => { setHover(null); hideTip(); })
        .on("click", (event, d) => togglePin(d.properties.iso3));

    // Direct labels at the centre of each economy's largest piece, sized to
    // the final (GDP-area) shapes. Which ones show depends on the zoom.
    const labelData = features
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.properties.value != null)
        .map(({ f, i }) => {
            const pieces = end[i].map(rings => ({ type: "Polygon", coordinates: rings }));
            const biggest = d3.greatest(pieces, p => path.area(p));
            const [[x0, y0], [x1, y1]] = path.bounds(biggest);
            return {
                iso3: f.properties.iso3,
                name: shortName(statById.get(f.properties.iso3).country),
                at: path.centroid(biggest),
                w: x1 - x0,
                h: y1 - y0
            };
        });

    const locate = addLocator(mapGroup);
    const labelLayer = mapGroup.append("g").attr("class", "l9-labels");
    const labels = labelLayer.selectAll("text")
        .data(labelData)
        .join("text")
        .attr("x", d => d.at[0])
        .attr("y", d => d.at[1])
        .attr("dy", "0.35em");

    // Area key: a square of $1 trillion at the current zoom, using the
    // cartogram's own pixels-per-dollar so the reader can measure with it.
    const usa = features.findIndex(f => f.properties.iso3 === "USA");
    const pxPerBillion = path.area(shapeAt(usa, 1)) / features[usa].properties.value;
    const key = svg.append("g").attr("class", "l9-area-key").attr("transform", `translate(18, ${H - 18})`);
    const keyBg = key.append("rect").attr("class", "l9-key-bg").attr("x", -8);
    const keySquare = key.append("rect").attr("class", "l9-key-square");
    const keyText = key.append("text").attr("class", "l9-key-text");

    let k = 1;
    function placeLabels() {
        const id = focus();
        const show = d => state.t === 1 && (d.iso3 === id || d.w * k > 34 && d.h * k > 14);
        labels
            .attr("font-size", 11 / k)
            .attr("stroke-width", 3 / k)
            .text(d => d.w * k > 8 * d.name.length ? d.name : d.iso3)
            .attr("display", d => show(d) ? null : "none")
            .classed("lit", d => d.iso3 === id);

        const side = Math.sqrt(pxPerBillion * 1000) * k;
        keySquare.attr("y", -side).attr("width", side).attr("height", side);
        keyText.attr("x", side + 8).attr("y", -side / 2).attr("dy", "0.35em").text("= $1 trillion of GDP");
        keyBg.attr("y", -side - 8).attr("width", side + 140).attr("height", side + 16);
        key.attr("display", state.t === 1 ? null : "none");
    }

    const zoom = d3.zoom()
        .scaleExtent([1, 8])
        .translateExtent([[0, 0], [W, H]])
        .on("zoom", event => {
            k = event.transform.k;
            mapGroup.attr("transform", event.transform);
            placeLabels();
            locate(countries.filter(".lit").node(), k);
        });
    svg.call(zoom);
    d3.select("#cartogram-reset").on("click", () =>
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity));

    svg.on("click", event => {
        if (event.target.classList.contains("country")) return;
        if (state.pinned) { state.pinned = null; update(); }
    });

    // Morph between land area (t = 0) and GDP area (t = 1).
    let drawnT = null;
    function render() {
        if (drawnT !== state.t) {
            drawnT = state.t;
            countries.attr("d", (d, i) => path(shapeAt(i, state.t)));
            locate(countries.filter(".lit").node(), k);
            d3.select("#area-note").classed("off", state.t !== 1);
        }
        placeLabels();
    }

    const slider = d3.select("#morph").on("input", function () {
        state.t = +this.value / 100;
        render();
    });

    let timer = null;
    d3.select("#morph-play").on("click", () => {
        if (timer) timer.stop();
        const duration = 2600;
        timer = d3.timer(elapsed => {
            const u = Math.min(1, elapsed / duration);
            // hold on the land map briefly, then ease into the cartogram
            state.t = d3.easeCubicInOut(Math.max(0, (u - 0.15) / 0.85));
            slider.property("value", Math.round(state.t * 100));
            render();
            if (u === 1) { timer.stop(); timer = null; }
        });
    });

    listeners.push(() => {
        const id = focus();
        countries
            .classed("lit", d => d.properties.iso3 === id)
            .classed("faded", d => state.pinned && d.properties.iso3 !== id);
        countries.filter(".lit").raise();
        labelLayer.raise();
        render();
        locate(countries.filter(".lit").node(), k);
    });
}

// Names short enough to sit inside a country on the cartogram.
function shortName(name) {
    return {
        "United States": "United States",
        "United Kingdom": "UK",
        "Russian Federation": "Russia",
        "Korea, Republic of": "S. Korea",
        "United Arab Emirates": "UAE",
        "Hong Kong SAR": "Hong Kong",
        "Czech Republic": "Czechia",
        "Saudi Arabia": "Saudi Arabia"
    }[name] || name;
}

// ----------------------------------------------------------------- table --

const fmtTableShare = v => v < 0.0005 ? d3.format(".2r")(v * 100) + "%" : d3.format(".2%")(v);

function fillTable({ stats, featureById }) {
    const rows = d3.select("#gdp-table tbody")
        .selectAll("tr")
        .data(stats.slice().sort((a, b) => a.rank - b.rank))
        .join("tr")
        .on("pointerenter", (event, d) => setHover(d.iso3))
        .on("pointerleave", () => setHover(null))
        .on("click", (event, d) => togglePin(d.iso3));

    rows.html(d => {
        const p = featureById.get(d.iso3).properties;
        return `<td class="num">${d.rank}</td>
            <td>${d.country}</td>
            <td class="num">${fmtInt(d.gdp)}</td>
            <td class="num">${fmtPct(p.share)}</td>
            <td class="num">${fmtTableShare(p.geoShare)}</td>
            <td class="num">${fmtTableShare(p.cartoShare)}</td>
            <td class="num">&times;${fmtFactor(p.cartoShare / p.geoShare)}</td>`;
    });

    listeners.push(() => {
        const id = focus();
        rows.classed("lit", d => d.iso3 === id);
    });
}
