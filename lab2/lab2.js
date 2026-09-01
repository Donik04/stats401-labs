// Lab 2 — Task walkthrough: a multivariate scatterplot of students.
//
//   study_hours -> x-position
//   score       -> y-position
//   major       -> colour
//   year        -> size

const width = 800;
const height = 500;

const margin = {
    top: 40,
    right: 170,
    bottom: 70,
    left: 70
};

const tooltip = d3.select("#tooltip");

// Task 4 — load the data, converting the numeric columns while loading.
d3.csv("../data/students_multivariate.csv", d => ({
    name: d.name,
    study_hours: +d.study_hours,
    score: +d.score,
    major: d.major,
    year: d.year
}))
.then(data => {

    console.log("students_multivariate:", data);

    const svg = d3.select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    // --- Task 5: scales -------------------------------------------------

    const xScale = d3.scaleLinear()
        .domain(d3.extent(data, d => d.study_hours))
        .nice()
        .range([margin.left, width - margin.right]);

    // The y-range is reversed because SVG coordinates increase downward.
    const yScale = d3.scaleLinear()
        .domain(d3.extent(data, d => d.score))
        .nice()
        .range([height - margin.bottom, margin.top]);

    // --- Task 8: colour encodes major -----------------------------------

    const majors = Array.from(new Set(data.map(d => d.major)));

    const colorScale = d3.scaleOrdinal()
        .domain(majors)
        .range(d3.schemeTableau10);

    // --- Task 9: size encodes year --------------------------------------

    const sizeScale = d3.scaleOrdinal()
        .domain(["Freshman", "Sophomore", "Junior", "Senior"])
        .range([5, 7, 9, 11]);

    // --- Task 6: axes ---------------------------------------------------

    svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        .call(d3.axisBottom(xScale));

    svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(${margin.left}, 0)`)
        .call(d3.axisLeft(yScale));

    svg.append("text")
        .attr("class", "axis-label")
        .attr("x", (margin.left + width - margin.right) / 2)
        .attr("y", height - 25)
        .attr("text-anchor", "middle")
        .text("Study Hours");

    svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -(margin.top + height - margin.bottom) / 2)
        .attr("y", 22)
        .attr("text-anchor", "middle")
        .text("Exam Score");

    // --- Tasks 7, 8, 9, 11: the points ----------------------------------

    svg.selectAll(".student-point")
        .data(data)
        .join("circle")
        .attr("class", "student-point")
        .attr("cx", d => xScale(d.study_hours))
        .attr("cy", d => yScale(d.score))
        .attr("r", d => sizeScale(d.year))
        .attr("fill", d => colorScale(d.major))
        .attr("opacity", 0.85)
        .on("mouseover", function (event, d) {
            tooltip
                .style("opacity", 1)
                .html(`
                    <strong>${d.name}</strong><br>
                    Study Hours: ${d.study_hours}<br>
                    Score: ${d.score}<br>
                    Major: ${d.major}<br>
                    Year: ${d.year}
                `);
        })
        .on("mousemove", function (event) {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY + 12}px`);
        })
        .on("mouseout", function () {
            tooltip.style("opacity", 0);
        });

    // --- Task 10: colour legend -----------------------------------------

    const legend = svg.append("g")
        .attr("transform", `translate(${width - margin.right + 25}, 60)`);

    legend.append("text")
        .attr("class", "legend-title")
        .attr("y", -18)
        .text("Major");

    const legendItems = legend.selectAll(".legend-item")
        .data(majors)
        .join("g")
        .attr("class", "legend-item")
        .attr("transform", (d, i) => `translate(0, ${i * 28})`);

    legendItems.append("circle")
        .attr("r", 6)
        .attr("fill", d => colorScale(d));

    legendItems.append("text")
        .attr("x", 14)
        .attr("y", 4)
        .text(d => d);

    // A second legend for the size encoding, so year is not size-only.
    const sizeLegend = svg.append("g")
        .attr("transform",
            `translate(${width - margin.right + 25}, ${60 + majors.length * 28 + 30})`);

    sizeLegend.append("text")
        .attr("class", "legend-title")
        .attr("y", -18)
        .text("Year");

    const sizeItems = sizeLegend.selectAll(".legend-item")
        .data(sizeScale.domain())
        .join("g")
        .attr("class", "legend-item")
        .attr("transform", (d, i) => `translate(0, ${i * 28})`);

    sizeItems.append("circle")
        .attr("r", d => sizeScale(d))
        .attr("fill", "#898781");

    sizeItems.append("text")
        .attr("x", 16)
        .attr("y", 4)
        .text(d => d);
});
