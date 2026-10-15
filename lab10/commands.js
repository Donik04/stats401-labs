// Lab 10: the command grammar shared by voice and the typed-command box.
//
// parse() turns a transcript ("highlight japan", "show me europe", "next")
// into one command object. It knows nothing about the maps; lab10.js decides
// what each command does. Keeping recognition (this file) apart from the
// visualization functions (lab10.js) is what lets voice, gesture, gaze,
// keyboard and mouse all end in the same actions.

const commands = (() => {

    // Continents as Natural Earth names them (data/lab10_regions.csv).
    const REGIONS = [
        { name: "Asia", words: ["asia", "asian"] },
        { name: "Europe", words: ["europe", "european"] },
        { name: "Africa", words: ["africa", "african"] },
        { name: "North America", words: ["north america", "north american"] },
        { name: "South America", words: ["south america", "south american", "latin america"] },
        { name: "Oceania", words: ["oceania", "pacific"] }
    ];

    // Spoken forms the recognizer is likely to return, beyond the dataset's
    // own names. Short forms like "us" and "uk" only match as whole words.
    const ALIASES = {
        USA: ["united states of america", "united states", "america", "the states", "usa", "u s a", "us", "u s"],
        GBR: ["united kingdom", "great britain", "britain", "england", "uk", "u k"],
        RUS: ["russian federation", "russia"],
        KOR: ["south korea", "republic of korea", "korea"],
        TUR: ["turkiye", "turkey"],
        ARE: ["united arab emirates", "emirates", "uae", "u a e"],
        HKG: ["hong kong"],
        CZE: ["czech republic", "czechia", "czech"],
        NLD: ["netherlands", "holland", "dutch"],
        SAU: ["saudi arabia", "saudi"],
        CHE: ["switzerland", "swiss"],
        PHL: ["philippines"],
        ZAF: ["south africa"],
        VNM: ["vietnam", "viet nam"]
    };

    // Words that carry no meaning for the grammar.
    const FILLER = /\b(please|can you|could you|would you|i want to|i'd like to|let's|lets|now|um+|uh+|okay|ok|hey|the|me|on|of)\b/g;

    function normalize(text) {
        return text
            .toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "")   // Türkiye → turkiye
            .replace(/[^a-z0-9' ]+/g, " ")
            .replace(FILLER, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Build the name lookup once from the 50 economies in the GDP file.
    function buildLexicon(economies) {
        const phrases = [];
        for (const { iso3, country } of economies) {
            const official = country.replace(/ SAR$/, "").replace(/^Korea.*$/, "Korea");
            const names = new Set([official, ...(ALIASES[iso3] || [])].map(normalize));
            for (const n of names) phrases.push({ phrase: n, kind: "country", id: iso3 });
        }
        for (const r of REGIONS) {
            for (const w of r.words) phrases.push({ phrase: normalize(w), kind: "region", id: r.name });
        }
        // Longest first, so "south africa" wins over "africa".
        phrases.sort((a, b) => b.phrase.length - a.phrase.length);
        return phrases;
    }

    // Every country or region named in the text, left to right. Exact
    // whole-word matches first; failing that, one near miss of a letter or
    // two on a longer name ("columbia" is Colombia). A near miss that is
    // equally close to two places ("polland": Poland or Holland) is refused
    // rather than guessed.
    function findEntities(text, lexicon) {
        const found = [];
        let rest = ` ${text} `;
        for (const entry of lexicon) {
            const needle = ` ${entry.phrase} `;
            let at = rest.indexOf(needle);
            while (at !== -1) {
                found.push({ ...entry, at });
                rest = rest.slice(0, at + 1) + "#".repeat(entry.phrase.length) + rest.slice(at + 1 + entry.phrase.length);
                at = rest.indexOf(needle);
            }
        }
        if (found.length) return found.sort((a, b) => a.at - b.at);

        const tokens = text.split(" ");
        const near = [];
        for (const entry of lexicon) {
            if (entry.phrase.length < 5) continue;
            const n = entry.phrase.split(" ").length;
            for (let i = 0; i + n <= tokens.length; i++) {
                const span = tokens.slice(i, i + n).join(" ");
                const d = editDistance(span, entry.phrase);
                const limit = entry.phrase.length >= 8 ? 2 : 1;
                if (d <= limit) near.push({ ...entry, at: i, d, fuzzy: span });
            }
        }
        if (!near.length) return [];
        const dMin = Math.min(...near.map(e => e.d));
        const closest = near.filter(e => e.d === dMin);
        return new Set(closest.map(e => e.id)).size === 1 ? [closest[0]] : [];
    }

    function editDistance(a, b) {
        const row = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            let prev = row[0];
            row[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const tmp = row[j];
                row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
                prev = tmp;
            }
        }
        return row[b.length];
    }

    const has = (text, re) => re.test(text);

    function parse(raw, lexicon) {
        const text = normalize(raw || "");
        if (!text) return { type: "unknown", text };

        if (has(text, /\b(help|what can i say|commands)\b/)) return { type: "help" };
        if (has(text, /\b(reset|start over|reset everything)\b/)) return { type: "reset" };

        if (has(text, /\b(zoom out|whole world|show world|show all|all regions|everything|full view|world view)\b/)) {
            return { type: "zoomOut" };
        }

        // When a sentence names both, the last-named entity is the target:
        // "show us asia" is about Asia.
        const entities = findEntities(text, lexicon);
        const target = entities[entities.length - 1];
        if (target && target.kind === "country") {
            const zoom = has(text, /\b(zoom|where is|where's|locate|go to|take to|fly to)\b/);
            return { type: "country", iso3: target.id, zoom, fuzzy: target.fuzzy || null };
        }
        if (target && target.kind === "region") {
            return { type: "region", region: target.id, fuzzy: target.fuzzy || null };
        }

        if (has(text, /\bzoom in\b|\bzoom\b|\bcloser\b|\benlarge\b/)) return { type: "zoomSelected" };
        if (has(text, /\b(next|forward|right)\b/)) return { type: "step", dir: 1 };
        if (has(text, /\b(previous|prev|back|before|left)\b/)) return { type: "step", dir: -1 };
        if (has(text, /^(select|choose|pick|confirm|yes)( (this|that|it|here|there))?( one)?$|^(this|that) one$/)) {
            return { type: "confirm" };
        }
        if (has(text, /\b(clear|deselect|unselect|cancel)\b/)) return { type: "clear" };
        if (has(text, /\b(play|animate|morph)\b/)) return { type: "play" };
        if (has(text, /\bland\b/)) return { type: "morph", to: 0 };
        if (has(text, /\b(gdp|g d p|cartogram|economy size|economic size)\b/)) return { type: "morph", to: 1 };
        if (has(text, /\b(log|logarithmic|log scale)\b/)) return { type: "scale", scale: "log" };
        if (has(text, /\b(linear|linear scale)\b/)) return { type: "scale", scale: "linear" };

        return { type: "unknown", text };
    }

    return { REGIONS, buildLexicon, parse, normalize };
})();

if (typeof module !== "undefined") module.exports = commands;
