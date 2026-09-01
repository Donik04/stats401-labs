// Lab 1 — Student Score Bar Chart

const width = 720;
const height = 420;
const margin = { top: 60, right: 20, bottom: 60, left: 20 };

const plotHeight = height - margin.top - margin.bottom;

async function drawChart() {

    // Load the CSV and convert score from string to number while loading.
    const data = await d3.csv("../data/students.csv", d => ({
        name: d.name,
        score: +d.score
    }));

    const svg = d3.select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    // Title
    svg.append("text")
        .attr("class", "chart-title")
        .attr("x", width / 2)
        .attr("y", 32)
        .attr("text-anchor", "middle")
        .text("Student Scores");

    // Bar height is proportional to the score.
    const maxScore = d3.max(data, d => d.score);
    const barHeight = d => (d.score / maxScore) * plotHeight;

    const slot = (width - margin.left - margin.right) / data.length;
    const barWidth = slot * 0.6;

    // One group per student, positioned along the x direction.
    const groups = svg.selectAll("g.student")
        .data(data)
        .join("g")
        .attr("class", "student")
        .attr("transform", (d, i) =>
            `translate(${margin.left + i * slot + slot / 2}, 0)`);

    groups.append("rect")
        .attr("class", "bar")
        .attr("x", -barWidth / 2)
        .attr("y", d => margin.top + plotHeight - barHeight(d))
        .attr("width", barWidth)
        .attr("height", d => barHeight(d));

    // Score under each bar
    groups.append("text")
        .attr("class", "bar-value")
        .attr("x", 0)
        .attr("y", margin.top + plotHeight + 20)
        .text(d => d.score);

    // Name under the score
    groups.append("text")
        .attr("class", "bar-name")
        .attr("x", 0)
        .attr("y", margin.top + plotHeight + 38)
        .text(d => d.name);
}

drawChart();
