console.log("Hello STATS 401!");

// --- Task 1.5: variables, arrays, objects -------------------------------

let course = "STATS 401";
let studentCount = 40;

console.log(course);
console.log(studentCount);

let numbers = [10, 20, 30, 40, 50];
console.log(numbers);

let student = { name: "Alice", score: 85 };
console.log(student.name);
console.log(student.score);

// --- Task 2.2: verify D3 -------------------------------------------------

console.log("D3 version:", d3.version);

// --- Task 2.3 / 3.3 / 3.4: select and modify -----------------------------

d3.select("#message")
    .text("This text was changed using D3!");

d3.select("#title")
    .style("color", "steelblue")
    .style("font-weight", "bold");

// --- Task 3.5: appending elements ---------------------------------------

const content = d3.select("#content");

content.append("h3")
    .text("My Dataset");

content.append("p")
    .text("The dataset contains student scores.");

// --- Task 3.6: data binding ---------------------------------------------

d3.select("#numbers")
    .selectAll("p")
    .data(numbers)
    .join("p")
    .text(d => `Value: ${d}`);

// --- Task 4.4: build SVG with D3 ----------------------------------------

const svg = d3.select("#svg-demo")
    .append("svg")
    .attr("width", 600)
    .attr("height", 200);

svg.append("circle")
    .attr("cx", 100)
    .attr("cy", 100)
    .attr("r", 40)
    .attr("fill", "steelblue");

svg.append("rect")
    .attr("x", 200)
    .attr("y", 60)
    .attr("width", 120)
    .attr("height", 80)
    .attr("fill", "orange");

// --- Task 4.5: several circles from data --------------------------------

const values = [10, 20, 30, 40, 50];

const circleSvg = d3.select("#svg-circles")
    .append("svg")
    .attr("width", 600)
    .attr("height", 200);

circleSvg.selectAll("circle")
    .data(values)
    .join("circle")
    .attr("cx", (d, i) => 60 + i * 100)
    .attr("cy", 100)
    .attr("r", d => d / 2)
    .attr("fill", "steelblue");

// --- Task 5: loading CSV and JSON ---------------------------------------

async function loadData() {

    // 5.4 row conversion: scores become numbers while loading
    const csvData = await d3.csv("data/students.csv", d => ({
        name: d.name,
        score: +d.score
    }));

    console.log("CSV data:", csvData);
    console.log("typeof score:", typeof csvData[0].score);

    // 5.5 JSON preserves numeric types
    const jsonData = await d3.json("data/students.json");
    console.log("JSON data:", jsonData);
}

loadData();
