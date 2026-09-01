// Home page script for the STATS 401 lab site.
// The Lab 1 exercises live in lab1/tasks.js; this file keeps the site-wide
// behaviour that belongs to the landing page.

console.log("Hello STATS 401!");

// Stamp the year into the footer note so it does not go stale.
const year = new Date().getFullYear();

d3.select("#site-note")
    .text(`STATS 401 lab site — ${year}`);
