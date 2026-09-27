// Lab 8 — the DKU Undergraduate Bulletin as formal structure + semantic space.
//
// One point = one passage. Encodings on the semantic map:
//
//   UMAP position      → semantic embedding (all-MiniLM-L6-v2, 384-d)
//   fill colour        → semantic topic (k-means, k = 8, on the 384-d vectors)
//   circle area        → passage length in words
//   black ring + lines → the selected passage and its 5 nearest neighbours
//
// The Topic × Section matrix is the formal-structure view: rows are the
// bulletin's Parts (expandable into their sections), columns the topics, cell
// shade the topic's share of the row. The two views share one state object:
// a matrix cell filters the map, a selected passage outlines its matrix cells,
// and the search box drives both.

// ---------------------------------------------------------------- palette --

// Topics take the eight documented categorical slots in fixed order.
const TOPICS = [
    "Politics, Society & History",
    "Math, Computing & Physics",
    "Arts, Media & Literature",
    "China, Chinese & Languages",
    "Life & Environmental Sciences",
    "Mission, Programs & Support",
    "Credits, Grades & Transfer",
    "Enrollment, Leave & Withdrawal"
];

const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100",
               "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

const topicColor = d3.scaleOrdinal(TOPICS, SLOTS);

// Sequential blue ramp (steps 100 → 700) for the matrix cells.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const shareColor = d3.scaleQuantize([0, 1], RAMP);

const PART_SHORT = {
    1: "General Information",
    2: "Liberal Arts Education",
    3: "The Curriculum",
    4: "Admission & Financial Aid",
    5: "Financial Information",
    6: "Academic Procedures",
    7: "Advising & Support",
    8: "Careers, Study Away, Research",
    9: "Student Affairs & Campus Life",
    10: "Majors and Courses",
    11: "Academic Calendar"
};

const partNo = chapter => +chapter.match(/Part (\d+)/)[1];
const partLabel = chapter => `Part ${partNo(chapter)} · ${PART_SHORT[partNo(chapter)]}`;
const fmtPct = d3.format(".0%");
const tooltip = d3.select("#tooltip");

// ------------------------------------------------------------------ state --

const state = {
    query: "",
    section: "all",      // "all" | "part|<chapter>" | "sec|<chapter>|<section>"
    topic: "all",
    cell: null,          // {chapter, section|null, topic} from the matrix
    selected: null       // passage_id
};

let passages, byId;
const listeners = [];
const update = () => listeners.forEach(fn => fn());

function matchesQuery(d) {
    return state.query === "" || d.textLower.includes(state.query);
}

function matches(d) {
    if (!matchesQuery(d)) return false;
    if (state.topic !== "all" && d.cluster_name !== state.topic) return false;
    if (state.section !== "all") {
        const [kind, chapter, section] = state.section.split("|");
        if (d.chapter !== chapter) return false;
        if (kind === "sec" && d.section !== section) return false;
    }
    if (state.cell) {
        const c = state.cell;
        if (d.chapter !== c.chapter || d.cluster_name !== c.topic) return false;
        if (c.section && d.section !== c.section) return false;
    }
    return true;
}

function showTip(event, html) {
    tooltip.html(html)
        .style("left", `${event.pageX + 14}px`)
        .style("top", `${event.pageY - 10}px`)
        .style("opacity", 1);
}

const hideTip = () => tooltip.style("opacity", 0);

const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

// ------------------------------------------------------------------- load --

Promise.all([
    d3.csv("../data/lab8_embedding_map.csv", d => ({
        ...d,
        x: +d.x,
        y: +d.y,
        page: +d.page,
        word_count: +d.word_count,
        cluster: +d.cluster,
        section_fit: +d.section_fit,
        textLower: d.text.toLowerCase(),
        neighbors: d.neighbors.split("|").map(s => {
            const [id, sim] = s.split(":");
            return { id, sim: +sim };
        })
    })),
    d3.csv("../data/lab8_top_terms.csv", d3.autoType),
    d3.csv("../data/lab8_topics.csv", d3.autoType)
]).then(([data, terms, topics]) => {
    passages = data;
    byId = new Map(data.map(d => [d.passage_id, d]));

    // rank of each passage's section fit within its own section (0 = least typical)
    for (const group of d3.group(data, d => d.chapter + "|" + d.section).values()) {
        const sorted = group.map(d => d.section_fit).sort(d3.ascending);
        group.forEach(d => {
            d.fitRank = group.length > 1 ? d3.bisectLeft(sorted, d.section_fit) / (group.length - 1) : 0.5;
        });
    }

    drawPartSummary(data);
    drawTerms(terms);
    fillTopicTable(topics);
    buildControls(data);
    drawSemanticMap(data);
    drawMatrix(data);
    update();
});

// ------------------------------------------------------ corpus summaries --

function drawPartSummary(data) {
    const rows = d3.rollups(data, v => ({ n: v.length, words: d3.mean(v, d => d.word_count) }),
        d => d.chapter)
        .map(([chapter, v]) => ({ chapter, ...v }))
        .sort((a, b) => partNo(a.chapter) - partNo(b.chapter));

    const labelW = 200, panelW = 170, gap = 34, rowH = 22, top = 34;
    const width = labelW + panelW * 2 + gap + 40;
    const height = top + rows.length * rowH + 8;

    const svg = d3.select("#part-summary").classed("loading", false).html("")
        .append("svg").attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "Passages and mean passage length for each Part of the bulletin");

    const y = d3.scaleBand(rows.map(d => d.chapter), [top, top + rows.length * rowH]).padding(0.25);
    const panels = [
        { key: "n", title: "Passages", x0: labelW, fmt: d3.format(",") },
        { key: "words", title: "Mean words per passage", x0: labelW + panelW + gap, fmt: d3.format(".0f") }
    ];

    svg.append("g").selectAll("text").data(rows).join("text")
        .attr("class", "matrix-row-label")
        .attr("x", labelW - 8).attr("y", d => y(d.chapter) + y.bandwidth() / 2)
        .attr("dy", "0.35em").attr("text-anchor", "end")
        .text(d => partLabel(d.chapter));

    for (const p of panels) {
        const x = d3.scaleLinear([0, d3.max(rows, d => d[p.key])], [0, panelW - 34]).nice();
        const g = svg.append("g").attr("transform", `translate(${p.x0},0)`);
        g.append("text").attr("class", "legend-title").attr("y", 14).text(p.title);
        g.append("line").attr("class", "baseline")
            .attr("y1", top - 4).attr("y2", top + rows.length * rowH)
            .attr("stroke", "#c3c2b7");
        g.selectAll("rect").data(rows).join("rect")
            .attr("y", d => y(d.chapter)).attr("height", y.bandwidth())
            .attr("width", d => x(d[p.key])).attr("rx", 2)
            .attr("fill", "#2a78d6")
            .on("mousemove", (event, d) => showTip(event,
                `<div class="tip-head">${partLabel(d.chapter)}</div>
                 <div class="tip-row"><strong>${d.n}</strong> <span class="tip-key">passages</span></div>
                 <div class="tip-row"><strong>${d.words.toFixed(1)}</strong> <span class="tip-key">mean words</span></div>`))
            .on("mouseleave", hideTip);
        g.selectAll(".bar-val").data(rows).join("text")
            .attr("class", "legend-tick")
            .attr("x", d => x(d[p.key]) + 4).attr("y", d => y(d.chapter) + y.bandwidth() / 2)
            .attr("dy", "0.35em").text(d => p.fmt(d[p.key]));
    }
}

function drawTerms(terms) {
    const labelW = 86, barW = 190, rowH = 17, top = 8;
    const height = top + terms.length * rowH + 4;
    const svg = d3.select("#top-terms").classed("loading", false).html("")
        .append("svg").attr("viewBox", `0 0 ${labelW + barW + 40} ${height}`)
        .attr("role", "img").attr("aria-label", "Top 20 TF-IDF terms in the bulletin");

    const y = d3.scaleBand(terms.map(d => d.term), [top, top + terms.length * rowH]).padding(0.2);
    const x = d3.scaleLinear([0, d3.max(terms, d => d.tfidf)], [0, barW]);

    svg.selectAll(".t").data(terms).join("text")
        .attr("class", "matrix-row-label")
        .attr("x", labelW - 8).attr("y", d => y(d.term) + y.bandwidth() / 2)
        .attr("dy", "0.35em").attr("text-anchor", "end").text(d => d.term);
    svg.selectAll("rect").data(terms).join("rect")
        .attr("x", labelW).attr("y", d => y(d.term))
        .attr("width", d => x(d.tfidf)).attr("height", y.bandwidth()).attr("rx", 2)
        .attr("fill", "#2a78d6")
        .on("mousemove", (event, d) => showTip(event,
            `<div class="tip-head">${d.term}</div>
             <div class="tip-row"><strong>${d.tfidf}</strong> <span class="tip-key">summed TF-IDF</span></div>
             <div class="tip-row"><strong>${d.passages}</strong> <span class="tip-key">passages contain it</span></div>`))
        .on("mouseleave", hideTip);
    svg.selectAll(".v").data(terms).join("text")
        .attr("class", "legend-tick")
        .attr("x", d => labelW + x(d.tfidf) + 4).attr("y", d => y(d.term) + y.bandwidth() / 2)
        .attr("dy", "0.35em").text(d => d.passages);
}

function fillTopicTable(topics) {
    const rows = TOPICS.map(name => topics.find(t => t.cluster_name === name));
    d3.select("#topic-table tbody").selectAll("tr").data(rows).join("tr")
        .html(t => `<td><span class="dot" style="background:${topicColor(t.cluster_name)}"></span>${t.cluster_name}</td>
                    <td class="num">${t.passages}</td>
                    <td>${t.top_terms}</td>`);
}

// --------------------------------------------------------------- controls --

function buildControls(data) {
    const select = d3.select("#section-filter");
    select.append("option").attr("value", "all").text(`All sections (${data.length})`);
    const parts = d3.groups(data, d => d.chapter).sort((a, b) => partNo(a[0]) - partNo(b[0]));
    for (const [chapter, rows] of parts) {
        const og = select.append("optgroup").attr("label", partLabel(chapter));
        og.append("option").attr("value", `part|${chapter}`).text(`All of Part ${partNo(chapter)} (${rows.length})`);
        for (const [section, s] of d3.groups(rows, d => d.section)) {
            og.append("option").attr("value", `sec|${chapter}|${section}`)
                .text(`${section.length > 44 ? section.slice(0, 42) + "…" : section} (${s.length})`);
        }
    }
    select.on("change", function () {
        state.section = this.value;
        update();
    });

    const topicSelect = d3.select("#topic-filter");
    topicSelect.append("option").attr("value", "all").text("All topics");
    TOPICS.forEach(t => topicSelect.append("option").attr("value", t).text(t));
    topicSelect.on("change", function () {
        state.topic = this.value;
        update();
    });

    d3.select("#search").on("input", function () {
        state.query = this.value.toLowerCase().trim();
        update();
    });

    d3.select("#reset-map").on("click", () => {
        Object.assign(state, { query: "", section: "all", topic: "all", cell: null, selected: null });
        d3.select("#search").property("value", "");
        update();
    });

    d3.select("#cell-chip button").on("click", () => {
        state.cell = null;
        update();
    });

    // legend rows double as the topic filter
    const legend = d3.select("#topic-legend").selectAll("button").data(TOPICS).join("button")
        .attr("type", "button").attr("class", "legend-swatch-row")
        .html(t => `<svg width="12" height="12"><circle cx="6" cy="6" r="5.5" fill="${topicColor(t)}"></circle></svg>${t}`)
        .on("click", (event, t) => {
            state.topic = state.topic === t ? "all" : t;
            update();
        });

    listeners.push(() => {
        select.property("value", state.section);
        topicSelect.property("value", state.topic);
        legend.classed("pinned", t => state.topic === t);
        const chip = d3.select("#cell-chip").classed("on", !!state.cell);
        if (state.cell) {
            chip.select("span").text(`Matrix cell: ${state.cell.section || partLabel(state.cell.chapter)} × ${state.cell.topic}`);
        }
        const n = passages.filter(matches).length;
        d3.select("#map-readout").text(`${d3.format(",")(n)} of ${d3.format(",")(passages.length)} passages shown`);
    });
}

// ----------------------------------------------------------- semantic map --

function drawSemanticMap(data) {
    const width = 700, height = 580, m = 18;
    const svg = d3.select("#semantic-map").classed("loading", false).html("")
        .append("svg").attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "UMAP semantic map of 1,253 bulletin passages coloured by topic");

    // UMAP places the 27 physical-education courses as a detached island far to
    // the left. Distance between disconnected UMAP components carries no
    // meaning, so the empty stretch is compressed to a marked 36px break rather
    // than spending half the plot on it.
    const xs = data.map(d => d.x).sort(d3.ascending);
    const [xMin, xMax] = [xs[0], xs[xs.length - 1]];
    let gapAt = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > xs[gapAt + 1] - xs[gapAt]) gapAt = i - 1;
    const gapLo = xs[gapAt], gapHi = xs[gapAt + 1];
    const hasBreak = gapHi - gapLo > 0.25 * (xMax - xMin);
    const x0 = hasBreak
        ? (() => {
            const unit = (width - 2 * m - 36) / ((gapLo - xMin) + (xMax - gapHi));
            const leftW = (gapLo - xMin) * unit;
            return d3.scaleLinear([xMin, gapLo, gapHi, xMax], [m, m + leftW, m + leftW + 36, width - m]);
        })()
        : d3.scaleLinear([xMin, xMax], [m, width - m]);
    const y0 = d3.scaleLinear(d3.extent(data, d => d.y), [height - m, m]);
    let x = x0, y = y0;

    const r = d3.scaleSqrt([0, d3.max(data, d => d.word_count)], [1.5, 6.5]);

    svg.append("defs").append("clipPath").attr("id", "map-clip")
        .append("rect").attr("width", width).attr("height", height);
    const plot = svg.append("g").attr("clip-path", "url(#map-clip)");
    const linkLayer = plot.append("g");
    const pointLayer = plot.append("g");
    const labelLayer = plot.append("g");

    // long passages first, so short ones stay clickable on top
    const points = pointLayer.selectAll(".passage")
        .data(data.slice().sort((a, b) => b.word_count - a.word_count), d => d.passage_id)
        .join("circle")
        .attr("class", "passage")
        .attr("r", d => r(d.word_count))
        .attr("fill", d => topicColor(d.cluster_name))
        .on("mousemove", (event, d) => showTip(event,
            `<div class="tip-head">${escapeHtml(d.heading || d.subsection || d.section)}</div>
             <div class="tip-row"><span class="dot" style="background:${topicColor(d.cluster_name)}"></span>${d.cluster_name}</div>
             <div class="tip-row"><span class="tip-key">${partLabel(d.chapter)} · p. ${d.page} · ${d.word_count} words</span></div>
             <div class="tip-note">${escapeHtml(d.text.slice(0, 110))}…</div>`))
        .on("mouseleave", hideTip)
        .on("click", (event, d) => {
            state.selected = state.selected === d.passage_id ? null : d.passage_id;
            update();
        });

    // direct label at each topic's median position
    const centres = TOPICS.map(t => {
        const pts = data.filter(d => d.cluster_name === t);
        return { t, x: d3.median(pts, d => d.x), y: d3.median(pts, d => d.y) };
    });
    const labels = labelLayer.selectAll("text").data(centres).join("text")
        .attr("class", "topic-label").text(d => d.t);

    const breakMark = hasBreak ? linkLayer.append("g") : null;
    if (breakMark) {
        breakMark.append("line").attr("class", "hairline").attr("y1", m).attr("y2", height - m);
        breakMark.append("text").attr("class", "legend-tick").attr("y", height - 6)
            .attr("text-anchor", "middle").text("gap compressed");
    }

    // keep labels inside the frame and off each other: estimate each box,
    // then push a label down past any label above it that it overlaps
    function placeLabels() {
        const boxes = centres.map(c => {
            const w = c.t.length * 6.8;
            return { c, w, x: Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, x(c.x))), y: y(c.y) };
        }).sort((a, b) => a.y - b.y);
        boxes.forEach((b, i) => {
            for (let j = 0; j < i; j++) {
                const o = boxes[j];
                if (Math.abs(b.x - o.x) < (b.w + o.w) / 2 && Math.abs(b.y - o.y) < 15) b.y = o.y + 15;
            }
            b.c.lx = b.x;
            b.c.ly = b.y;
        });
        labels.attr("x", d => d.lx).attr("y", d => d.ly);
    }

    function place() {
        points.attr("cx", d => x(d.x)).attr("cy", d => y(d.y));
        placeLabels();
        if (breakMark) breakMark.attr("transform", `translate(${x((gapLo + gapHi) / 2)},0)`);
        drawLinks();
    }

    function drawLinks() {
        const sel = state.selected && byId.get(state.selected);
        const links = sel ? sel.neighbors.map(n => ({ a: sel, b: byId.get(n.id) })) : [];
        linkLayer.selectAll("line").data(links).join("line")
            .attr("class", "neighbour-link")
            .attr("x1", d => x(d.a.x)).attr("y1", d => y(d.a.y))
            .attr("x2", d => x(d.b.x)).attr("y2", d => y(d.b.y));
    }

    const zoom = d3.zoom().scaleExtent([1, 14])
        .translateExtent([[0, 0], [width, height]])
        .on("zoom", event => {
            x = event.transform.rescaleX(x0);
            y = event.transform.rescaleY(y0);
            place();
        });
    svg.call(zoom).on("dblclick.zoom", null);
    d3.select("#zoom-reset").on("click", () => svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity));

    // size legend
    const sizes = [20, 80, 200];
    const sl = d3.select("#size-legend").append("svg").attr("width", 190).attr("height", 22);
    let cx = 4;
    sizes.forEach(s => {
        const rr = r(s);
        sl.append("circle").attr("cx", cx + rr).attr("cy", 11).attr("r", rr)
            .attr("fill", "none").attr("stroke", "#52514e");
        sl.append("text").attr("class", "legend-tick").attr("x", cx + rr * 2 + 3).attr("y", 15).text(s);
        cx += rr * 2 + 30;
    });
    sl.append("text").attr("class", "legend-tick").attr("x", cx - 6).attr("y", 15).text("words");

    place();

    listeners.push(() => {
        const sel = state.selected && byId.get(state.selected);
        const nn = new Set(sel ? sel.neighbors.map(n => n.id) : []);
        points
            .classed("dim", d => !matches(d) && d.passage_id !== state.selected && !nn.has(d.passage_id))
            .classed("selected", d => d.passage_id === state.selected)
            .classed("neighbour", d => nn.has(d.passage_id));
        points.filter(d => d.passage_id === state.selected || nn.has(d.passage_id)).raise();
        drawLinks();
        renderDetail(sel);
    });
}

// ----------------------------------------------------------- detail panel --

function highlight(text) {
    const safe = escapeHtml(text);
    if (!state.query) return safe;
    const q = escapeHtml(state.query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp(q, "gi"), s => `<mark>${s}</mark>`);
}

function renderDetail(d) {
    const panel = d3.select("#detail-panel");
    if (!d) {
        panel.html(`<p class="empty">Click a point to read its passage and its five nearest
            semantic neighbours. Drag to pan, scroll to zoom.</p>`);
        return;
    }
    panel.html(`
        <h3>${escapeHtml(d.heading || d.subsection || d.section)}</h3>
        <dl>
            <dt>Chapter</dt><dd>${partLabel(d.chapter)}</dd>
            <dt>Section</dt><dd>${escapeHtml(d.section)}</dd>
            <dt>Subsection</dt><dd>${escapeHtml(d.subsection) || "—"}</dd>
            <dt>Page</dt><dd>${d.page}</dd>
            <dt>Topic</dt><dd><span class="dot" style="background:${topicColor(d.cluster_name)}"></span>${d.cluster_name}</dd>
            <dt>Length</dt><dd>${d.word_count} words</dd>
            <dt>Section fit</dt><dd>${d.section_fit.toFixed(2)}
                <span class="l8-word-count">(${fmtPct(d.fitRank)} of its section is less typical)</span></dd>
        </dl>
        <p class="passage-text">${highlight(d.text)}</p>
        <h4>5 nearest semantic neighbours</h4>
        <ol class="nn-list"></ol>`);

    panel.select(".nn-list").selectAll("li").data(d.neighbors).join("li")
        .html(n => {
            const o = byId.get(n.id);
            const other = o.chapter !== d.chapter ? ` <span class="nn-other">other Part</span>` : "";
            return `<span class="nn-meta"><strong>${n.sim.toFixed(2)}</strong> ·
                    <span class="dot" style="background:${topicColor(o.cluster_name)}"></span>${escapeHtml(o.section)}, p. ${o.page}${other}</span>
                    <span class="nn-text">${escapeHtml(o.text.slice(0, 120))}…</span>`;
        })
        .on("click", (event, n) => {
            state.selected = n.id;
            update();
        });
}

// ----------------------------------------------------------------- matrix --

function drawMatrix(data) {
    const expanded = new Set();
    const labelW = 260, colW = 76, rowH = 23, headH = 58, totalW = 56;
    const width = labelW + TOPICS.length * colW + totalW;

    const root = d3.select("#matrix").classed("loading", false).html("");
    const svg = root.append("svg").attr("role", "img")
        .attr("aria-label", "Topic by bulletin section matrix");

    // wrapped column headers
    const head = svg.append("g");
    TOPICS.forEach((t, i) => {
        const lines = [];
        t.split(" ").forEach(w => {
            const last = lines[lines.length - 1];
            if (last && (last + " " + w).length <= 10) lines[lines.length - 1] = last + " " + w;
            else lines.push(w);
        });
        const text = head.append("text").attr("class", "matrix-head")
            .attr("x", labelW + i * colW + colW / 2)
            .attr("y", headH - 6 - (lines.length - 1) * 13);
        lines.forEach((l, j) => text.append("tspan")
            .attr("x", labelW + i * colW + colW / 2).attr("dy", j ? 13 : 0).text(l));
        head.append("rect").attr("x", labelW + i * colW + colW / 2 - 12).attr("y", headH - 2)
            .attr("width", 24).attr("height", 3).attr("rx", 1.5).attr("fill", topicColor(t));
    });
    head.append("text").attr("class", "matrix-head")
        .attr("x", labelW + TOPICS.length * colW + totalW / 2).attr("y", headH - 6).text("Total");

    const body = svg.append("g").attr("transform", `translate(0,${headH + 6})`);
    const parts = d3.groups(data, d => d.chapter).sort((a, b) => partNo(a[0]) - partNo(b[0]));

    d3.select("#expand-all").on("click", () => {
        parts.forEach(([c]) => expanded.add(c));
        render();
    });
    d3.select("#collapse-all").on("click", () => {
        expanded.clear();
        render();
    });

    function rowsFor(visible) {
        const rows = [];
        for (const [chapter, all] of parts) {
            const own = visible.filter(d => d.chapter === chapter);
            rows.push({ kind: "part", chapter, section: null, items: own });
            if (expanded.has(chapter)) {
                for (const [section] of d3.groups(all, d => d.section)) {
                    rows.push({ kind: "section", chapter, section, items: own.filter(d => d.section === section) });
                }
            }
        }
        return rows;
    }

    function render() {
        // the matrix counts only the passages that match the search box
        const visible = data.filter(matchesQuery);
        const topicTotals = d3.rollup(visible, v => v.length, d => d.cluster_name);
        const rows = rowsFor(visible);
        const sel = state.selected && byId.get(state.selected);

        svg.attr("viewBox", `0 0 ${width} ${headH + 10 + rows.length * rowH}`);

        const row = body.selectAll(".matrix-row").data(rows, d => d.chapter + "|" + d.section)
            .join(enter => {
                const g = enter.append("g").attr("class", "matrix-row");
                g.append("text").attr("dy", "0.35em");
                g.append("text").attr("class", "matrix-total").attr("dy", "0.35em").attr("text-anchor", "middle");
                return g;
            })
            .attr("transform", (d, i) => `translate(0,${i * rowH})`);

        row.select("text:not(.matrix-total)")
            .attr("class", d => `matrix-row-label ${d.kind}`)
            .attr("x", d => d.kind === "part" ? 0 : 18).attr("y", rowH / 2)
            .text(d => d.kind === "part"
                ? `${expanded.has(d.chapter) ? "▾" : "▸"} ${partLabel(d.chapter)}`
                : (d.section.length > 40 ? d.section.slice(0, 38) + "…" : d.section))
            .on("click", (event, d) => {
                if (d.kind !== "part") return;
                expanded.has(d.chapter) ? expanded.delete(d.chapter) : expanded.add(d.chapter);
                render();
            })
            .on("mousemove", (event, d) => d.kind === "section" && d.section.length > 40
                ? showTip(event, `<div class="tip-head">${escapeHtml(d.section)}</div>`) : null)
            .on("mouseleave", hideTip);

        row.select(".matrix-total")
            .attr("x", labelW + TOPICS.length * colW + totalW / 2).attr("y", rowH / 2)
            .text(d => d.items.length);

        row.each(function (r) {
            const counts = d3.rollup(r.items, v => v.length, d => d.cluster_name);
            const cells = TOPICS.map(t => ({ row: r, topic: t, n: counts.get(t) || 0, total: r.items.length }));
            const cell = d3.select(this).selectAll(".matrix-cell").data(cells, c => c.topic)
                .join(enter => {
                    const g = enter.append("g").attr("class", "matrix-cell");
                    g.append("rect");
                    g.append("text");
                    return g;
                })
                .attr("transform", (c, i) => `translate(${labelW + i * colW},0)`)
                .classed("active", c => state.cell && state.cell.chapter === r.chapter &&
                    state.cell.section === r.section && state.cell.topic === c.topic)
                .classed("linked", c => sel && sel.chapter === r.chapter && sel.cluster_name === c.topic &&
                    (r.section === null || sel.section === r.section));

            cell.select("rect")
                .attr("width", colW).attr("height", rowH).attr("rx", 3)
                .attr("fill", c => c.n ? shareColor(c.n / c.total) : "#f0efec")
                .on("mousemove", (event, c) => showTip(event,
                    `<div class="tip-head">${escapeHtml(c.row.section || partLabel(c.row.chapter))}</div>
                     <div class="tip-row"><span class="dot" style="background:${topicColor(c.topic)}"></span>${c.topic}</div>
                     <div class="tip-row"><strong>${c.n}</strong> <span class="tip-key">of ${c.total} passages in this row</span>
                        ${c.total ? `(<strong>${fmtPct(c.n / c.total)}</strong>)` : ""}</div>
                     <div class="tip-row"><span class="tip-key">${fmtPct(c.n / (topicTotals.get(c.topic) || 1))} of all “${c.topic}” passages</span></div>
                     ${state.query ? `<div class="tip-note">Counting only passages that contain “${escapeHtml(state.query)}”</div>` : ""}`))
                .on("mouseleave", hideTip)
                .on("click", (event, c) => {
                    if (!c.n) return;
                    const same = state.cell && state.cell.chapter === c.row.chapter &&
                        state.cell.section === c.row.section && state.cell.topic === c.topic;
                    state.cell = same ? null : { chapter: c.row.chapter, section: c.row.section, topic: c.topic };
                    update();
                });

            cell.select("text")
                .attr("x", colW / 2).attr("y", rowH / 2).attr("dy", "0.35em")
                .attr("fill", c => c.n / c.total > 0.45 ? "#ffffff" : "#0b0b0b")
                .text(c => c.n || "");
        });

        d3.select("#matrix-readout").text(state.query
            ? `Counting the ${visible.length} passages that contain “${state.query}”.`
            : `Counting all ${visible.length} passages.`);
    }

    // share-of-row legend
    const lg = d3.select("#matrix-legend").append("svg").attr("width", 250).attr("height", 34);
    RAMP.forEach((c, i) => lg.append("rect").attr("x", i * 30).attr("y", 4).attr("width", 30).attr("height", 12).attr("fill", c));
    [0, 0.5, 1].forEach(v => lg.append("text").attr("class", "legend-tick")
        .attr("x", v * 210).attr("y", 30).attr("text-anchor", v === 0 ? "start" : v === 1 ? "end" : "middle")
        .text(fmtPct(v)));

    listeners.push(() => {
        // a selected passage opens its Part so its section cell can be outlined
        const sel = state.selected && byId.get(state.selected);
        if (sel) expanded.add(sel.chapter);
        render();
    });
}
