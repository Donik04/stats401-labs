// Lab 4 — sentiment against the route a tweet took to reach Twitter, plus a
// look at how sure the model was about each label it handed out.

// Sentiment is a diverging scale, so it gets two poles and a neutral midpoint
// rather than three unrelated hues. The same three colours mean the same three
// things in every chart on the page.
const SENTIMENT_COLOR = {
    Negative: "#e34948",
    Neutral: "#c3c2b7",
    Positive: "#2a78d6"
};

const ORDER = ["Negative", "Neutral", "Positive"];

// Ink, never a series colour, for anything that is text.
const INK = "#0b0b0b";
const INK_SOFT = "#52514e";
const SURFACE = "#ffffff";

// A route with only a handful of tweets has meaningless shares, so it stays in
// the table but is kept out of the chart.
const MIN_ROUTE_TWEETS = 50;

const percent = d3.format(".0%");
const percent1 = d3.format(".1%");
const signed = d3.format("+.3f");
const count = d3.format(",");

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

// A bar with 4px rounded corners on its outer end only; the end that meets
// another segment stays square so the two read as one continuous bar.
function barPath(x0, x1, y, height, radius, round) {
    const width = x1 - x0;
    if (width <= 0.2) return null;

    const r = Math.max(0, Math.min(radius, width, height / 2));

    if (r === 0 || round === "none") {
        return `M${x0},${y}H${x1}V${y + height}H${x0}Z`;
    }

    if (round === "right") {
        return `M${x0},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}`
            + `V${y + height - r}A${r},${r} 0 0 1 ${x1 - r},${y + height}`
            + `H${x0}Z`;
    }

    return `M${x1},${y}H${x0 + r}A${r},${r} 0 0 0 ${x0},${y + r}`
        + `V${y + height - r}A${r},${r} 0 0 0 ${x0 + r},${y + height}`
        + `H${x1}Z`;
}

// The same idea stood upright: a column rising to yTop, with the 4px radius on
// the cap only when this segment is the one on top of its stack.
function columnPath(x, width, yTop, yBottom, radius, roundCap) {
    const height = yBottom - yTop;
    if (height <= 0.2) return null;

    const r = Math.max(0, Math.min(radius, width / 2, height));

    if (r === 0 || !roundCap) {
        return `M${x},${yTop}H${x + width}V${yBottom}H${x}Z`;
    }

    return `M${x},${yBottom}V${yTop + r}A${r},${r} 0 0 1 ${x + r},${yTop}`
        + `H${x + width - r}A${r},${r} 0 0 1 ${x + width},${yTop + r}`
        + `V${yBottom}Z`;
}

// White or ink inside a filled segment, whichever clears contrast. This is the
// one place a label may sit on a data colour.
function labelInk(fill) {
    const { r, g, b } = d3.rgb(fill);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? INK : SURFACE;
}


// ---------------------------------------------------------------------------
// Chart 1 — sentiment composition by posting route, diverging from the centre
// ---------------------------------------------------------------------------

function drawRoutes(rows) {

    // One object per route: the three shares, the total, the mean score.
    const routes = Array.from(
        d3.group(rows, d => d.posted_via),
        ([name, group]) => {
            const route = {
                name,
                total: group[0].total,
                meanScore: group[0].mean_score,
                meanConfidence: group[0].mean_confidence,
                counts: {},
                shares: {}
            };

            for (const label of ORDER) {
                const match = group.find(d => d.sentiment === label);
                route.counts[label] = match ? match.count : 0;
                route.shares[label] = match ? match.share : 0;
            }

            return route;
        }
    ).sort((a, b) => d3.ascending(a.meanScore, b.meanScore));

    drawRoutesTable(routes);

    const shown = routes.filter(d => d.total >= MIN_ROUTE_TWEETS);
    const container = d3.select("#chart-routes");

    function render() {
        // .html("") rather than selectAll("*").remove(): the placeholder is a
        // bare text node, which removing child elements would leave behind.
        container.html("");
        container.classed("loading", false);

        const outerWidth = Math.max(
            320, Math.floor(container.node().getBoundingClientRect().width)
        );

        // On a narrow screen there is no room for a label column beside the
        // bars, so the label moves above its own bar instead of being squeezed
        // or truncated.
        const stacked = outerWidth < 620;

        const margin = {
            top: 34, right: 18, bottom: 30, left: stacked ? 2 : 168
        };
        const rowHeight = stacked ? 74 : 46;
        const barHeight = 24;

        const width = outerWidth - margin.left - margin.right;
        const height = shown.length * rowHeight;

        // The centre line only reads as a centre if the two arms share a scale,
        // so the domain is made symmetric around zero.
        const reach = d3.max(shown, d => Math.max(
            d.shares.Negative + d.shares.Neutral / 2,
            d.shares.Positive + d.shares.Neutral / 2
        ));
        const limit = Math.min(1, Math.ceil(reach * 20) / 20);

        const x = d3.scaleLinear([-limit, limit], [0, width]);
        const y = d3.scaleBand()
            .domain(shown.map(d => d.name))
            .range([0, height])
            .paddingInner(0);

        const svg = container.append("svg")
            .attr("viewBox",
                `0 0 ${outerWidth} ${height + margin.top + margin.bottom}`)
            .attr("role", "img")
            .attr("aria-label",
                "Share of tweets called negative, neutral and positive, "
                + "for each way a tweet was posted");

        const plot = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // --- Recessive gridlines, labelled once along the top --------------

        const ticks = x.ticks(7).filter(t => Math.abs(t) > 1e-9);

        plot.append("g")
            .selectAll("line")
            .data(ticks)
            .join("line")
            .attr("class", "grid-line")
            .attr("x1", d => x(d))
            .attr("x2", d => x(d))
            .attr("y1", -8)
            .attr("y2", height);

        plot.append("g")
            .selectAll("text")
            .data(ticks)
            .join("text")
            .attr("class", "tick-label")
            .attr("x", d => x(d))
            .attr("y", -14)
            .attr("text-anchor", "middle")
            .text(d => percent(Math.abs(d)));

        // --- Rows ----------------------------------------------------------

        const row = plot.selectAll("g.bar-hit")
            .data(shown)
            .join("g")
            .attr("class", "bar-hit")
            .attr("transform", d => `translate(0,${y(d.name)})`);

        const top = stacked ? rowHeight - barHeight - 12 : (rowHeight - barHeight) / 2;

        row.append("text")
            .attr("class", "row-label")
            .attr("x", stacked ? 0 : -margin.left + 2)
            .attr("y", stacked ? 16 : top + barHeight / 2 - 3)
            .text(d => d.name);

        row.append("text")
            .attr("class", "row-meta")
            .attr("x", stacked ? 0 : -margin.left + 2)
            .attr("y", stacked ? 31 : top + barHeight / 2 + 12)
            .text(d => `${count(d.total)} tweets · mean ${signed(d.meanScore)}`);

        // Segment geometry. Neutral straddles zero, so each route's negative
        // and positive arms start from the edge of its own neutral block.
        function segments(d) {
            const half = d.shares.Neutral / 2;

            return [
                {
                    route: d,
                    label: "Negative",
                    from: -(half + d.shares.Negative),
                    to: -half,
                    round: "left"
                },
                {
                    route: d,
                    label: "Neutral",
                    from: -half,
                    to: half,
                    round: "none"
                },
                {
                    route: d,
                    label: "Positive",
                    from: half,
                    to: half + d.shares.Positive,
                    round: "right"
                }
            ];
        }

        // A 2px gap in the surface colour separates touching segments, so each
        // one gives up 1px on every edge that meets a neighbour.
        function edges(segment) {
            const x0 = x(segment.from) + (segment.round === "left" ? 0 : 1);
            const x1 = x(segment.to) - (segment.round === "right" ? 0 : 1);
            return [x0, x1];
        }

        row.selectAll("path.segment")
            .data(segments)
            .join("path")
            .attr("class", "segment")
            .attr("fill", s => SENTIMENT_COLOR[s.label])
            .attr("d", s => {
                const [x0, x1] = edges(s);
                return barPath(x0, x1, top, barHeight, 4, s.round);
            })
            .on("mousemove", (event, s) => showTip(event, `
                <strong>${s.route.name}</strong><br>
                ${s.label}: ${count(s.route.counts[s.label])} tweets
                (${percent1(s.route.shares[s.label])})<br>
                <span style="color:${INK_SOFT}">
                    ${count(s.route.total)} tweets in total ·
                    mean score ${signed(s.route.meanScore)}
                </span>`))
            .on("mouseleave", hideTip);

        // Direct labels, but only where the text genuinely fits inside the
        // segment. A label that would be clipped is dropped: the legend, the
        // tooltip and the table all still carry the number.
        row.selectAll("text.seg-label")
            .data(d => segments(d).filter(s => {
                const [x0, x1] = edges(s);
                return x1 - x0 >= 34;
            }))
            .join("text")
            .attr("class", "seg-label")
            .attr("x", s => {
                const [x0, x1] = edges(s);
                return (x0 + x1) / 2;
            })
            .attr("y", top + barHeight / 2 + 4)
            .attr("text-anchor", "middle")
            .attr("fill", s => labelInk(SENTIMENT_COLOR[s.label]))
            .text(s => percent(s.route.shares[s.label]));

        // --- The centre line, drawn last so it sits above the fills ---------

        plot.append("line")
            .attr("class", "zero-line")
            .attr("x1", x(0))
            .attr("x2", x(0))
            .attr("y1", -8)
            .attr("y2", height);

        plot.append("text")
            .attr("class", "tick-label")
            .attr("x", x(0))
            .attr("y", height + 20)
            .attr("text-anchor", "middle")
            .attr("fill", INK_SOFT)
            .text("more negative ←   |   → more positive");
    }

    render();
    window.addEventListener("resize", render);
}


function drawRoutesTable(routes) {
    const columns = [
        ["Posting route", d => d.name, false],
        ["Tweets", d => count(d.total), true],
        ["Negative", d => percent1(d.shares.Negative), true],
        ["Neutral", d => percent1(d.shares.Neutral), true],
        ["Positive", d => percent1(d.shares.Positive), true],
        ["Mean score", d => signed(d.meanScore), true],
        ["Mean confidence", d => d.meanConfidence.toFixed(3), true]
    ];

    const table = d3.select("#routes-table");

    table.select("thead")
        .append("tr")
        .selectAll("th")
        .data(columns)
        .join("th")
        .attr("class", d => d[2] ? "num" : null)
        .text(d => d[0]);

    table.select("tbody")
        .selectAll("tr")
        .data(routes)
        .join("tr")
        .selectAll("td")
        .data(route => columns.map(column => ({ route, column })))
        .join("td")
        .attr("class", d => d.column[2] ? "num" : null)
        .text(d => d.column[1](d.route));
}


// ---------------------------------------------------------------------------
// Chart 2 — how confident the model was, split by the label it chose
// ---------------------------------------------------------------------------

// Three classes share one probability, so the winning class can never hold
// less than a third of it. The axis starts there rather than at a round
// number: the empty stretch above the floor is itself worth seeing.
const CONFIDENCE_FLOOR = 1 / 3;

function drawConfidence(tweets) {

    // Thresholds are the interior cuts only. Repeating the domain ends here
    // would open an empty bin at each end.
    const thresholds = d3.range(0.35, 1.0, 0.025);

    // One histogram per predicted class, all on the same bins, then stacked so
    // the column heights read as the overall distribution.
    const bins = d3.bin()
        .value(d => d.confidence)
        .domain([CONFIDENCE_FLOOR, 1.0])
        .thresholds(thresholds)(tweets);

    const data = bins.map(bin => {
        const row = { x0: bin.x0, x1: bin.x1, total: bin.length };
        for (const label of ORDER) {
            row[label] = bin.filter(d => d.sentiment === label).length;
        }
        return row;
    }).filter(d => d.x1 > d.x0);

    const stack = d3.stack().keys(ORDER)(data);
    const container = d3.select("#chart-confidence");

    function render() {
        // .html("") rather than selectAll("*").remove(): the placeholder is a
        // bare text node, which removing child elements would leave behind.
        container.html("");
        container.classed("loading", false);

        const outerWidth = Math.max(
            320, Math.floor(container.node().getBoundingClientRect().width)
        );

        const margin = { top: 30, right: 16, bottom: 52, left: 58 };
        const width = outerWidth - margin.left - margin.right;
        const height = Math.min(300, Math.max(200, outerWidth * 0.32));

        const x = d3.scaleLinear([CONFIDENCE_FLOOR, 1.0], [0, width]);
        const y = d3.scaleLinear([0, d3.max(data, d => d.total)], [height, 0])
            .nice();

        const svg = container.append("svg")
            .attr("viewBox",
                `0 0 ${outerWidth} ${height + margin.top + margin.bottom}`)
            .attr("role", "img")
            .attr("aria-label",
                "Distribution of the model's confidence in the label it chose, "
                + "stacked by predicted sentiment");

        const plot = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        plot.append("g")
            .selectAll("line")
            .data(y.ticks(5))
            .join("line")
            .attr("class", "grid-line")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", d => y(d))
            .attr("y2", d => y(d));

        plot.append("g")
            .selectAll("text")
            .data(y.ticks(5))
            .join("text")
            .attr("class", "tick-label")
            .attr("x", -10)
            .attr("y", d => y(d) + 4)
            .attr("text-anchor", "end")
            .text(count);

        plot.append("g")
            .selectAll("text")
            .data(x.ticks(8))
            .join("text")
            .attr("class", "tick-label")
            .attr("x", d => x(d))
            .attr("y", height + 18)
            .attr("text-anchor", "middle")
            .text(d3.format(".2f"));

        // Anything left of this line is a label the winning class did not even
        // hold half the probability for.
        plot.append("line")
            .attr("class", "zero-line")
            .attr("stroke-dasharray", "4 3")
            .attr("x1", x(0.5))
            .attr("x2", x(0.5))
            .attr("y1", -6)
            .attr("y2", height);

        plot.append("text")
            .attr("class", "tick-label")
            .attr("x", x(0.5) - 6)
            .attr("y", -12)
            .attr("text-anchor", "end")
            .text("↤ under half the probability");

        // Measured per bin, not once: the bin sitting on the 1/3 floor is
        // narrower than the 0.025-wide ones above it.
        const columnWidth = bin => Math.max(2, x(bin.x1) - x(bin.x0) - 2);

        plot.selectAll("g.series")
            .data(stack)
            .join("g")
            .attr("class", "series")
            .attr("fill", series => SENTIMENT_COLOR[series.key])
            .selectAll("path")
            .data(series => series.map(d => ({ ...d, key: series.key })))
            .join("path")
            .attr("d", d => {
                // Round the cap only on the topmost non-empty segment, so the
                // radius sits on the column's outline rather than mid-stack.
                const cap = ORDER.filter(k => d.data[k] > 0).pop();

                return columnPath(
                    x(d.data.x0) + 1, columnWidth(d.data),
                    y(d[1]), y(d[0]), 4, d.key === cap
                );
            })
            .on("mousemove", (event, d) => showTip(event, `
                <strong>confidence
                ${d3.format(".2f")(d.data.x0)}–${d3.format(".2f")(d.data.x1)}
                </strong><br>
                ${d.key}: ${count(d.data[d.key])} tweets<br>
                <span style="color:${INK_SOFT}">
                    ${count(d.data.total)} tweets in this bin
                </span>`))
            .on("mouseleave", hideTip);

        plot.append("text")
            .attr("class", "tick-label")
            .attr("x", width / 2)
            .attr("y", height + 42)
            .attr("text-anchor", "middle")
            .text("probability the model gave the class it picked");

        plot.append("text")
            .attr("class", "tick-label")
            .attr("transform", `translate(${-margin.left + 14},${height / 2}) rotate(-90)`)
            .attr("text-anchor", "middle")
            .text("tweets");
    }

    render();
    window.addEventListener("resize", render);
}


// ---------------------------------------------------------------------------
// The tweets the model came closest to guessing on
// ---------------------------------------------------------------------------

function drawUncertain(rows) {
    const list = d3.select("#uncertain-list");
    list.html("");

    const item = list.selectAll("li")
        .data(rows.slice(0, 12))
        .join("li");

    item.append("p")
        .attr("class", "tweet")
        .text(d => d.tweet_text);

    const bar = item.append("div").attr("class", "prob-bar");

    for (const label of ORDER) {
        bar.append("span")
            .style("background", SENTIMENT_COLOR[label])
            .style("width", d => `${100 * d[`p_${label.toLowerCase()}`]}%`);
    }

    item.append("div")
        .attr("class", "prob-figures")
        .html(d => `
            negative ${d.p_negative.toFixed(2)} ·
            neutral ${d.p_neutral.toFixed(2)} ·
            positive ${d.p_positive.toFixed(2)}
            <span class="verdict">called ${d.sentiment}</span>`);
}


// ---------------------------------------------------------------------------
// Characteristic terms from the TF-IDF matrix
// ---------------------------------------------------------------------------

function drawTerms(rows) {
    const grid = d3.select("#term-grid");
    grid.html("");
    grid.classed("loading", false);

    const byClass = d3.group(rows, d => d.sentiment);

    const block = grid.selectAll("div")
        .data(ORDER.filter(label => byClass.has(label)))
        .join("div")
        .attr("class", "term-block");

    const heading = block.append("h4");

    heading.append("span")
        .attr("class", d => `swatch ${d.toLowerCase()}`)
        .style("display", "inline-block")
        .style("width", "13px")
        .style("height", "13px")
        .style("border-radius", "3px");

    heading.append("span").text(d => d);

    block.append("ol")
        .selectAll("li")
        .data(label => byClass.get(label).slice(0, 10))
        .join("li")
        .text(d => d.term);
}


// ---------------------------------------------------------------------------

Promise.all([
    d3.csv("../data/lab4_sentiment_by_client.csv", d => ({
        posted_via: d.posted_via,
        sentiment: d.sentiment,
        count: +d.count,
        total: +d.total,
        mean_score: +d.mean_score,
        mean_confidence: +d.mean_confidence,
        share: +d.share
    })),
    d3.csv("../data/lab4_viz_tweets.csv", d => ({
        sentiment: d.sentiment,
        confidence: +d.confidence
    })),
    d3.csv("../data/lab4_uncertain_tweets.csv", d => ({
        tweet_text: d.tweet_text,
        sentiment: d.sentiment,
        p_negative: +d.p_negative,
        p_neutral: +d.p_neutral,
        p_positive: +d.p_positive
    })),
    d3.csv("../data/lab4_top_terms.csv")
])
.then(([byRoute, tweets, uncertain, terms]) => {
    drawRoutes(byRoute);
    drawConfidence(tweets);
    drawUncertain(uncertain);
    drawTerms(terms);
})
.catch(error => {
    console.error(error);
    d3.selectAll(".loading")
        .text("The data files could not be loaded — see the console.");
});
