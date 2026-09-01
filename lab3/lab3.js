// Lab 3 — display the acquired dataset as a sortable, filterable table.

// Columns that must sort by numeric value rather than as text.
const numericColumns = new Set(["price_gbp", "rating", "page"]);

// Friendlier headings than the raw CSV column names.
const headings = {
    title: "Title",
    price_gbp: "Price (£)",
    rating: "Rating",
    availability: "Availability",
    page: "Page",
    url: "Link"
};

d3.csv("../data/lab3_data.csv", d => ({
    title: d.title,
    price_gbp: +d.price_gbp,
    rating: +d.rating,
    availability: d.availability,
    page: +d.page,
    url: d.url
}))
.then(data => {

    const columns = ["title", "price_gbp", "rating", "availability", "page", "url"];

    // Dataset facts in the description list.
    d3.select("#record-count").text(data.length.toLocaleString());
    d3.select("#column-count").text(columns.length);

    const table = d3.select("#data-table");
    const status = d3.select("#row-status");

    let sortColumn = null;
    let ascending = true;
    let filterText = "";

    // --- Header, with click-to-sort ------------------------------------

    const header = table.select("thead")
        .append("tr")
        .selectAll("th")
        .data(columns)
        .join("th")
        .attr("class", "sort-header")
        .attr("tabindex", 0)
        .attr("role", "button")
        .on("click", (event, column) => toggleSort(column))
        .on("keydown", (event, column) => {
            // Keyboard access: the header is focusable, so honour Enter/Space.
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleSort(column);
            }
        });

    function toggleSort(column) {
        if (sortColumn === column) {
            ascending = !ascending;      // same column again -> reverse
        } else {
            sortColumn = column;
            ascending = true;            // new column -> ascending first
        }
        render();
    }

    // --- Filter box -----------------------------------------------------

    d3.select("#search").on("input", function () {
        filterText = this.value.trim().toLowerCase();
        render();
    });

    // --- Render ---------------------------------------------------------

    function render() {

        // Filter first, then sort the surviving rows.
        let rows = filterText
            ? data.filter(d => d.title.toLowerCase().includes(filterText))
            : data.slice();

        if (sortColumn) {
            const compare = numericColumns.has(sortColumn)
                ? (a, b) => d3.ascending(a[sortColumn], b[sortColumn])
                : (a, b) => d3.ascending(
                    String(a[sortColumn]).toLowerCase(),
                    String(b[sortColumn]).toLowerCase()
                );

            rows.sort((a, b) => ascending ? compare(a, b) : -compare(a, b));
        }

        // Header text carries the current sort direction.
        header
            .attr("aria-sort", d =>
                d === sortColumn
                    ? (ascending ? "ascending" : "descending")
                    : null)
            .classed("sorted", d => d === sortColumn)
            .text(d => {
                const label = headings[d] || d;
                if (d !== sortColumn) return label;
                return `${label} ${ascending ? "▲" : "▼"}`;
            });

        status.text(
            rows.length === data.length
                ? `${data.length.toLocaleString()} records`
                : `${rows.length.toLocaleString()} of ${data.length.toLocaleString()} records`
        );

        const tr = table.select("tbody")
            .selectAll("tr")
            .data(rows, d => d.url)
            .join("tr");

        const td = tr.selectAll("td")
            .data(row => columns.map(column => ({ column, row })))
            .join("td")
            .attr("class", d => numericColumns.has(d.column) ? "num" : null);

        // The link column renders an anchor; every other column is text.
        td.each(function (d) {
            const cell = d3.select(this);

            if (d.column === "url") {
                cell.text(null);
                cell.selectAll("a")
                    .data([d.row])
                    .join("a")
                    .attr("href", r => r.url)
                    .attr("target", "_blank")
                    .attr("rel", "noopener")
                    .text("view");
            } else {
                cell.selectAll("a").remove();
                cell.text(d.row[d.column]);
            }
        });
    }

    render();
});
