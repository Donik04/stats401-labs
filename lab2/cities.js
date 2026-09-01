// Lab 2 — Assignment: four dimensions of twelve cities.
//
//   population        (ratio)    -> bar length, from a true zero
//   temp_c            (interval) -> single-hue blue fill, light = cool, dark = warm
//   development_level (ordinal)  -> one, two or three pips beside the city name
//   region            (nominal)  -> one small-multiple panel per region

const cityTooltip = d3.select("#tooltip");

// Panel geometry. Each region is its own small SVG in a CSS grid.
const panel = {
    width: 430,
    rowHeight: 38,
    headerHeight: 34,
    labelWidth: 88,
    pipsWidth: 34,
    padRight: 54
};

const barLeft = panel.labelWidth + panel.pipsWidth + 10;
const barRight = panel.width - panel.padRight;

// Sequential blue ramp, validated light -> dark against the page surface.
const tempRamp = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];

const regionOrder = ["North", "East", "West", "South"];
const devOrder = ["Low", "Medium", "High"];

d3.csv("../data/cities_multivariate.csv", d => ({
    city: d.city,
    population: +d.population,
    temp_c: +d.temp_c,
    development_level: d.development_level,
    region: d.region
}))
.then(data => {

    console.log("cities_multivariate:", data);

    // Shared scales, so every panel is directly comparable.
    const popScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.population)])
        .nice()
        .range([barLeft, barRight]);

    const tempScale = d3.scaleQuantize()
        .domain(d3.extent(data, d => d.temp_c))
        .range(tempRamp);

    const pipScale = d3.scaleOrdinal()
        .domain(devOrder)
        .range([1, 2, 3]);

    const byRegion = d3.group(data, d => d.region);

    const root = d3.select("#cities-chart");

    // --- Legends --------------------------------------------------------

    const legend = root.append("div")
        .attr("class", "viz-legend");

    // Temperature ramp
    const tempBlock = legend.append("div").attr("class", "legend-block");
    tempBlock.append("span")
        .attr("class", "legend-label")
        .text("Avg temperature");

    const ramp = tempBlock.append("div").attr("class", "ramp");
    ramp.selectAll("span")
        .data(tempRamp)
        .join("span")
        .attr("class", "ramp-step")
        .style("background", d => d);

    tempBlock.append("span")
        .attr("class", "ramp-ends")
        .text(`${d3.min(data, d => d.temp_c)}°C cool → ${d3.max(data, d => d.temp_c)}°C warm`);

    // Development level pips
    const devBlock = legend.append("div").attr("class", "legend-block");
    devBlock.append("span")
        .attr("class", "legend-label")
        .text("Development level");

    const devItems = devBlock.append("div").attr("class", "dev-items");

    devItems.selectAll("span")
        .data(devOrder)
        .join("span")
        .attr("class", "dev-item")
        .html(d => `${"●".repeat(pipScale(d))}<span class="dev-name">${d}</span>`);

    // --- One panel per region -------------------------------------------

    const panels = root.append("div")
        .attr("class", "panel-grid")
        .selectAll(".panel")
        .data(regionOrder.filter(r => byRegion.has(r)))
        .join("div")
        .attr("class", "panel");

    panels.each(function (region) {

        // Sort each region's cities by population, largest first.
        const rows = byRegion.get(region)
            .slice()
            .sort((a, b) => d3.descending(a.population, b.population));

        const svgHeight = panel.headerHeight + rows.length * panel.rowHeight + 12;

        const svg = d3.select(this)
            .append("svg")
            .attr("width", panel.width)
            .attr("height", svgHeight)
            .attr("viewBox", `0 0 ${panel.width} ${svgHeight}`);

        svg.append("text")
            .attr("class", "panel-title")
            .attr("x", 0)
            .attr("y", 16)
            .text(region);

        // A recessive baseline at population zero.
        svg.append("line")
            .attr("class", "baseline")
            .attr("x1", popScale(0))
            .attr("x2", popScale(0))
            .attr("y1", panel.headerHeight - 8)
            .attr("y2", svgHeight - 8);

        const g = svg.selectAll(".city-row")
            .data(rows)
            .join("g")
            .attr("class", "city-row")
            .attr("transform", (d, i) =>
                `translate(0, ${panel.headerHeight + i * panel.rowHeight})`);

        // City name — direct label, so identity never depends on colour.
        g.append("text")
            .attr("class", "city-name")
            .attr("x", panel.labelWidth)
            .attr("y", 16)
            .attr("text-anchor", "end")
            .text(d => d.city);

        // Development level as ordinal pips.
        g.append("text")
            .attr("class", "city-pips")
            .attr("x", panel.labelWidth + 8)
            .attr("y", 16)
            .text(d => "●".repeat(pipScale(d.development_level)));

        // Population as bar length, temperature as fill.
        g.append("rect")
            .attr("class", "city-bar")
            .attr("x", popScale(0))
            .attr("y", 3)
            .attr("width", d => Math.max(2, popScale(d.population) - popScale(0)))
            .attr("height", 18)
            .attr("rx", 4)
            .attr("fill", d => tempScale(d.temp_c));

        // Population value at the end of each bar.
        g.append("text")
            .attr("class", "city-value")
            .attr("x", d => popScale(d.population) + 8)
            .attr("y", 16)
            .text(d => `${d.population}M`);

        // Hover target spanning the whole row, larger than the bar itself.
        g.append("rect")
            .attr("class", "row-hit")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", panel.width)
            .attr("height", panel.rowHeight - 4)
            .attr("fill", "transparent")
            .on("mouseover", function (event, d) {
                cityTooltip
                    .style("opacity", 1)
                    .html(`
                        <strong>${d.city}</strong><br>
                        Region: ${d.region}<br>
                        Population: ${d.population} million<br>
                        Avg temperature: ${d.temp_c}°C<br>
                        Development: ${d.development_level}
                    `);
            })
            .on("mousemove", function (event) {
                cityTooltip
                    .style("left", `${event.pageX + 12}px`)
                    .style("top", `${event.pageY + 12}px`);
            })
            .on("mouseout", function () {
                cityTooltip.style("opacity", 0);
            });
    });

    // --- Table view, so the data is readable without colour -------------

    const details = root.append("details")
        .attr("class", "table-view");

    details.append("summary").text("View the data as a table");

    const table = details.append("table").attr("class", "data-table");

    table.append("thead").append("tr")
        .selectAll("th")
        .data(["City", "Region", "Population (M)", "Temp (°C)", "Development"])
        .join("th")
        .text(d => d);

    table.append("tbody")
        .selectAll("tr")
        .data(data)
        .join("tr")
        .selectAll("td")
        .data(d => [
            d.city, d.region, d.population, d.temp_c, d.development_level
        ])
        .join("td")
        .text(d => d);
});
