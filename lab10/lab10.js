// Lab 10: the Lab 9 maps, driven by voice, hand gestures and eye gaze.
//
// ../lab9/lab9.js draws both maps and owns their shared state (the hovered
// and pinned economy, the colour classes, the cartogram morph). This file only
// adds inputs. Each input is recognised on its own, but all of them end in the
// same command objects and the same `perform()`, so "next" said aloud, a swipe
// to the right, the → key and the Next button run exactly the same code.
//
// Wrapped in a function so its names cannot collide with lab9.js, which
// declares its own at the top level of the page.

(() => {

    // ----------------------------------------------------------- settings --

    const COOLDOWN = 1000;      // ms between two gesture commands
    const HOLD = 450;           // ms a hand pose must be held still to fire
    const UNLATCH = 300;        // ms a pose must be gone before it can fire again
    const SWIPE_WINDOW = 600;   // ms a swipe may take
    const SWIPE_DX = 0.22;      // share of the frame width a swipe must cross
    const STILL = 0.05;         // max palm movement (share of frame) over 200 ms for "held still"
    const DWELL = 800;          // ms of gaze on one country before it is indicated
    const GAZE_SMOOTH = 6;      // gaze estimates averaged for the cursor
    const GAZE_RADIUS = 24;     // px around the gaze point that are hit-tested

    const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
    const GESTURE_MODEL = "https://storage.googleapis.com/mediapipe-models/" +
        "gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
    const WEBGAZER = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/webgazer.js";
    const WEBGAZER_FACEMESH = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh";

    // A longitude/latitude view box per continent. Europe stops at 45°E, so
    // Russia (European in Natural Earth) does not stretch the view to the Pacific.
    const REGION_BOXES = {
        "Asia": [[25, -11], [150, 56]],
        "Europe": [[-25, 34], [45, 71]],
        "Africa": [[-18, -35], [52, 38]],
        "North America": [[-170, 7], [-52, 72]],
        "South America": [[-82, -56], [-34, 13]],
        "Oceania": [[110, -48], [180, 0]]
    };

    // The gesture vocabulary: MediaPipe's built-in pose labels plus two swipes
    // computed here from the hand landmarks.
    const GESTURES = {
        Swipe_Right: { label: "Swipe right", cmd: { type: "step", dir: 1 } },
        Swipe_Left: { label: "Swipe left", cmd: { type: "step", dir: -1 } },
        Thumb_Up: { label: "Thumb up", cmd: { type: "zoomSelected" } },
        Thumb_Down: { label: "Thumb down", cmd: { type: "zoomOut" } },
        Victory: { label: "V sign", cmd: { type: "toggleMorph" } },
        Open_Palm: { label: "Open palm", cmd: { type: "reset" } }
    };
    const POSE_NAMES = {
        Closed_Fist: "Closed fist", Pointing_Up: "Pointing up", ILoveYou: "I-love-you sign"
    };

    const SOURCE = {
        voice: "Voice", gesture: "Gesture", gaze: "Gaze",
        typed: "Typed", key: "Keyboard", button: "Button"
    };

    // ------------------------------------------------------------- state --

    let ctx = null;             // Lab 9's joined data (features, stats, …)
    let regionOf = null;        // iso3 → continent
    let indexOf = null;         // iso3 → feature index (same order in both maps)
    let lexicon = null;         // names the command parser recognises
    let ranked = null;          // the 50 economies, largest first
    let scope = null;           // continent shown, or null for the whole world
    let zoomedOn = null;        // "country" while the maps follow the selection

    const polysOf = g => g.type === "Polygon" ? [g.coordinates] : g.coordinates;

    Promise.all([hooks.ready, d3.csv("../data/lab10_regions.csv")]).then(([data, regions]) => {
        ctx = data;
        regionOf = new Map(regions.map(d => [d.iso3, d.continent]));
        indexOf = new Map(ctx.geoData.features.map((f, i) => [f.properties.iso3, i]));
        ranked = ctx.stats.slice().sort((a, b) => a.rank - b.rank);
        lexicon = commands.buildLexicon(ranked);

        listeners.push(paintScope);
        setupBar();
        setupTyped();
        setupKeyboard();
        setupVoice();
        setupGesture();
        setupGaze();
        update();
    });

    // ========================================================== actions ==
    //
    // Every input produces a command object; perform() is the only place a
    // command touches the maps. Each action returns what it did, in words,
    // for the feedback panels.

    const ok = text => ({ ok: true, text });
    const fail = text => ({ ok: false, text });

    function describe(iso3) {
        const p = ctx.featureById.get(iso3).properties;
        return p.value == null
            ? `${p.name} (no GDP value in the dataset)`
            : `${p.label}, ${fmtGDP(p.value)}, #${p.rank} of 50`;
    }

    const nameOf = iso3 => ctx.featureById.get(iso3).properties.label;
    const inScope = iso3 => !scope || regionOf.get(iso3) === scope;
    const scoped = () => ranked.filter(d => inScope(d.iso3));

    function perform(cmd) {
        switch (cmd.type) {
            case "country": return selectCountry(cmd.iso3, cmd.zoom, cmd.fuzzy);
            case "region": return showRegion(cmd.region);
            case "step": return step(cmd.dir);
            case "zoomSelected": return zoomSelected();
            case "zoomOut": return zoomOut();
            case "confirm": return confirmGazeTarget();
            case "clear": return clearSelection();
            case "reset": return resetAll();
            case "morph": return morphTo(cmd.to);
            case "toggleMorph": return morphTo(state.t > 0.5 ? 0 : 1);
            case "play": return playMorph();
            case "scale": return setScale(cmd.scale);
            case "help": return ok("Try “Show Asia”, “Highlight Japan”, “Next”, “Zoom in”, " +
                "“Zoom out”, “Land”, “GDP” or “Reset”. The full list is in section 2.");
            default: return fail(`Command not recognized. Try “Show Asia”, “Highlight Japan”, “Next” or “Reset”.`);
        }
    }

    function pin(iso3) {
        state.pinned = iso3;
        state.hover = null;
        update();
    }

    function selectCountry(iso3, zoom, fuzzy) {
        let note = "";
        if (!inScope(iso3)) {
            note = ` (outside ${scope}, so the region filter was cleared)`;
            scope = null;
            if (!zoom) resetZoom();
        }
        pin(iso3);
        if (zoom || zoomedOn === "country") zoomToCountry(iso3);
        const heard = fuzzy ? ` (understood “${fuzzy}” as ${nameOf(iso3)})` : "";
        return ok(`Selected ${describe(iso3)}${heard}${note}`);
    }

    function showRegion(name) {
        scope = name;
        zoomedOn = null;
        if (state.pinned && !inScope(state.pinned)) state.pinned = null;
        state.hover = null;
        update();
        zoomToRegion(name);
        const members = scoped();
        if (!members.length) return ok(`Showing ${name}: none of the 50 economies is here`);
        const total = d3.sum(members, d => d.gdp);
        return ok(`Showing ${name}: ${members.length} of the 50 economies, ${fmtGDP(total)} ` +
            `(${fmtPct(total / ctx.totalGDP)} of their combined GDP)`);
    }

    function step(dir) {
        const list = scoped();
        const where = scope ? ` in ${scope}` : "";
        const at = list.findIndex(d => d.iso3 === state.pinned);
        const i = at === -1 ? (dir > 0 ? 0 : list.length - 1) : at + dir;
        if (i < 0) return fail(`Already at the largest economy${where}, ${nameOf(list[0].iso3)}`);
        if (i >= list.length) return fail(`Already at the smallest economy${where}, ${nameOf(list[list.length - 1].iso3)}`);
        pin(list[i].iso3);
        if (zoomedOn === "country") zoomToCountry(list[i].iso3);
        const position = scope ? ` · ${i + 1} of ${list.length} in ${scope}` : "";
        return ok(`${dir > 0 ? "Next" : "Previous"}: ${describe(list[i].iso3)}${position}`);
    }

    function zoomSelected() {
        const id = state.pinned || state.hover;
        if (!id) return fail("Nothing is selected to zoom to. Say “Highlight Japan”, or swipe to step to an economy.");
        if (!state.pinned) pin(id);
        zoomToCountry(id);
        return ok(`Zoomed to ${nameOf(id)}`);
    }

    function zoomOut() {
        scope = null;
        update();
        resetZoom();
        return ok("Zoomed out to the whole world");
    }

    function clearSelection() {
        if (!state.pinned && !state.hover) return fail("Nothing is selected");
        state.pinned = null;
        state.hover = null;
        gaze.target = null;
        update();
        showGazeTarget();
        return ok("Selection cleared");
    }

    function resetAll() {
        scope = null;
        state.pinned = null;
        state.hover = null;
        gaze.target = null;
        showGazeTarget();
        if (state.scale !== "log") setScale("log");
        if (state.t !== 1) morphTo(1);
        update();
        resetZoom();
        return ok("Reset: whole world, nothing selected, log-spaced colours, GDP-area cartogram");
    }

    function confirmGazeTarget() {
        const id = gaze.target || state.hover;
        if (!id) {
            return fail(gaze.running
                ? "Nothing to select yet: look at a country until its ring fills, then say “select”."
                : "Nothing to select: start eye gaze, or hover over a country with the mouse.");
        }
        pin(id);
        if (zoomedOn === "country") zoomToCountry(id);
        return ok(`Selected ${describe(id)}`);
    }

    function setScale(scale) {
        if (state.scale !== scale) d3.select(`#scale-buttons button[data-scale="${scale}"]`).node().click();
        return ok(`Colour classes: ${scale === "log" ? "log-spaced" : "linear"}`);
    }

    // Drive Lab 9's own slider, animating it, so the morph and its labels stay
    // in Lab 9's hands.
    let morphTimer = null;
    function morphTo(target) {
        const slider = d3.select("#morph");
        const from = state.t;
        if (morphTimer) morphTimer.stop();
        morphTimer = d3.timer(elapsed => {
            const u = Math.min(1, elapsed / 900);
            const t = from + (target - from) * d3.easeCubicInOut(u);
            slider.property("value", Math.round(t * 100));
            slider.node().dispatchEvent(new Event("input"));
            if (u === 1) { morphTimer.stop(); morphTimer = null; }
        });
        return ok(target === 1 ? "Cartogram: area shows GDP" : "Cartogram: area shows land");
    }

    function playMorph() {
        d3.select("#morph-play").node().click();
        return ok("Playing the morph from land area to GDP area");
    }

    // ------------------------------------------------------------ zooming --

    // A zoom transform that fits pixel bounds into a map, kept inside the map
    // like Lab 9's own translateExtent.
    function fit(view, [[x0, y0], [x1, y1]], fill) {
        const H = view.height;
        const k = Math.max(1, Math.min(8, fill / Math.max((x1 - x0) / W, (y1 - y0) / H, 1e-6)));
        const tx = Math.min(0, Math.max(W - k * W, W / 2 - k * (x0 + x1) / 2));
        const ty = Math.min(0, Math.max(H - k * H, H / 2 - k * (y0 + y1) / 2));
        return d3.zoomIdentity.translate(tx, ty).scale(k);
    }

    function zoomBoth(bounds, fill) {
        for (const name of ["choropleth", "cartogram"]) {
            const view = hooks.views[name];
            view.svg.transition().duration(750).call(view.zoom.transform, fit(view, bounds[name], fill));
        }
    }

    function resetZoom() {
        zoomedOn = null;
        for (const view of Object.values(hooks.views)) {
            view.svg.transition().duration(750).call(view.zoom.transform, d3.zoomIdentity);
        }
    }

    // A country's largest piece, so France zooms to France and not to France
    // plus French Guiana.
    function largest(path, polygons) {
        return d3.greatest(polygons.map(coordinates => ({ type: "Polygon", coordinates })), p => path.area(p));
    }

    function zoomToCountry(iso3) {
        const i = indexOf.get(iso3);
        const { choropleth, cartogram } = hooks.views;
        zoomedOn = "country";
        zoomBoth({
            choropleth: choropleth.path.bounds(largest(choropleth.path, polysOf(ctx.geoData.features[i].geometry))),
            cartogram: cartogram.path.bounds(largest(cartogram.path, cartogram.shapeAt(i, state.t).coordinates))
        }, 0.45);
    }

    // The choropleth zooms to the land inside the continent's box; the
    // cartogram to where those same vertices are on the distorted map, since
    // both files keep every vertex in the same order.
    function zoomToRegion(name) {
        const [[w, s], [e, n]] = REGION_BOXES[name];
        const inside = ([lon, lat]) => lon >= w && lon <= e && lat >= s && lat <= n;
        const geo = [];
        const carto = [];
        const { choropleth, cartogram } = hooks.views;
        ctx.geoData.features.forEach((f, i) => {
            const now = cartogram.shapeAt(i, state.t).coordinates;
            polysOf(f.geometry).forEach((rings, a) => rings.forEach((ring, b) => ring.forEach((pt, c) => {
                if (inside(pt)) {
                    geo.push(pt);
                    carto.push(now[a][b][c]);
                }
            })));
        });
        const points = coordinates => ({ type: "MultiPoint", coordinates });
        zoomBoth({
            choropleth: choropleth.path.bounds(points(geo)),
            cartogram: cartogram.path.bounds(points(carto))
        }, 0.95);
    }

    // ------------------------------------------------------ region scope --

    // Outside the region, the choropleth swaps each fill for a grey of the
    // same lightness: the GDP class is still readable, but the country no
    // longer competes with the region. The cartogram fades them, as Lab 9
    // already does for a pinned country.
    function paintScope() {
        const color = d3.scaleThreshold(SCALES[state.scale].thresholds, RAMP);
        const grey = v => {
            const c = d3.hcl(color(v));
            c.c = 0;
            return c.formatHex();
        };
        hooks.views.choropleth.svg.selectAll(".country")
            .style("fill", d => inScope(d.properties.iso3) || d.properties.value == null
                ? null : grey(d.properties.value));
        hooks.views.cartogram.svg.selectAll(".country")
            .classed("l10-outside", d => !inScope(d.properties.iso3));

        d3.select("#region-select").property("value", scope || "");
        d3.select("#prev-button").attr("disabled", state.pinned && scoped()[0]?.iso3 === state.pinned ? true : null);
        const list = scoped();
        d3.select("#next-button").attr("disabled", list.length && list[list.length - 1].iso3 === state.pinned ? true : null);
    }

    // ========================================================= feedback ==

    let toastTimer = null;

    // One report per command: the input's own panel, the floating toast (so
    // feedback is visible wherever the page is scrolled) and the action log.
    function report(source, input, result) {
        const panel = d3.select(`#${source}-action`);
        if (!panel.empty()) panel.text(result.text).classed("l10-fail", !result.ok);

        const toast = d3.select("#toast")
            .classed("show", true)
            .classed("l10-fail", !result.ok)
            .html("");
        toast.append("span").attr("class", "l10-source").text(SOURCE[source]);
        toast.append("span").attr("class", "l10-input").text(input);
        toast.append("span").attr("class", "l10-result").text(result.text);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classed("show", false), 4500);

        const log = d3.select("#action-log");
        log.select(".l10-log-empty").remove();
        const li = log.insert("li", ":first-child").classed("l10-fail", !result.ok);
        li.append("span").attr("class", "l10-time").text(d3.timeFormat("%H:%M:%S")(new Date()));
        li.append("span").attr("class", "l10-source").text(SOURCE[source]);
        li.append("span").attr("class", "l10-input").text(input);
        li.append("span").attr("class", "l10-arrow").text("→");
        li.append("span").attr("class", "l10-result").text(result.text);
        log.selectAll("li").filter((d, i) => i >= 12).remove();
    }

    function run(cmd, source, input) {
        const result = perform(cmd);
        report(source, input, result);
        return result;
    }

    // Red "device on" indicators in the corner dock, one per active sensor.
    const devices = new Map();
    function indicate(key, label) {
        if (label) devices.set(key, label); else devices.delete(key);
        d3.select("#indicators").selectAll("li")
            .data([...devices.values()])
            .join("li")
            .text(d => d);
        d3.select("#sensor-dock").attr("hidden", devices.size ? null : true);
    }

    function status(id, text, mode) {
        d3.select(`#${id}`).text(text).attr("data-mode", mode || null);
    }

    // ================================================= conventional input ==

    function setupBar() {
        const regionSelect = d3.select("#region-select");
        regionSelect.selectAll("option.region")
            .data(Object.keys(REGION_BOXES))
            .join("option")
            .attr("class", "region")
            .attr("value", d => d)
            .text(d => d);
        regionSelect.on("change", function () {
            const value = this.value;
            if (value) run({ type: "region", region: value }, "button", `Region: ${value}`);
            else run({ type: "zoomOut" }, "button", "Region: Whole world");
        });

        // Lab 9 pins the economy picked from its list; picking one outside the
        // region shown also clears the region, as saying its name would.
        d3.select("#economy-select").on("change.l10", function () {
            if (this.value) run({ type: "country", iso3: this.value }, "button", `Economy: ${nameOf(this.value)}`);
        });

        d3.select("#prev-button").on("click", () => run({ type: "step", dir: -1 }, "button", "Previous"));
        d3.select("#next-button").on("click", () => run({ type: "step", dir: 1 }, "button", "Next"));
        d3.select("#zoom-button").on("click", () => run({ type: "zoomSelected" }, "button", "Zoom to selection"));
        d3.select("#reset-button").on("click", () => run({ type: "reset" }, "button", "Reset all"));

        // Lab 9's own reset-zoom buttons end the "follow the selection" mode.
        d3.selectAll("#choropleth-reset, #cartogram-reset").on("click.l10", () => { zoomedOn = null; });
    }

    function setupTyped() {
        const input = d3.select("#typed-command");
        const submit = () => {
            const text = input.property("value").trim();
            if (!text) return;
            run(commands.parse(text, lexicon), "typed", `“${text}”`);
            input.property("value", "");
        };
        d3.select("#typed-form").on("submit", event => { event.preventDefault(); submit(); });
        d3.select("#typed-run").on("click", submit);
    }

    function setupKeyboard() {
        const keys = {
            ArrowRight: { cmd: { type: "step", dir: 1 }, label: "Right arrow" },
            ArrowLeft: { cmd: { type: "step", dir: -1 }, label: "Left arrow" },
            z: { cmd: { type: "zoomSelected" }, label: "Z" },
            Escape: { cmd: { type: "reset" }, label: "Esc" }
        };
        d3.select(window).on("keydown.l10", event => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.target.closest("input, select, textarea")) return;
            if (calibrating && event.key === "Escape") { endCalibration(); return; }
            if (event.key === " " && gaze.running) {
                event.preventDefault();
                run({ type: "confirm" }, "key", "Space");
                return;
            }
            if (event.key === "v" || event.key === "V") { voice.start(); return; }
            const hit = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
            if (!hit) return;
            event.preventDefault();
            run(hit.cmd, "key", hit.label);
        });
    }

    // ============================================================= voice ==

    const voice = { start: () => {} };

    function setupVoice() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const button = d3.select("#voice-button");

        if (!SpeechRecognition) {
            button.attr("disabled", true);
            status("voice-status", "Speech recognition is not supported in this browser " +
                "(try Chrome, Edge or Safari). Type the same commands in the box below.", "off");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;

        let wanted = false;     // the user has turned voice control on
        let running = false;    // a recognition session is open
        let fatal = false;      // an error that retrying cannot fix

        const keepListening = () => d3.select("#voice-keep").property("checked");

        function listen() {
            if (running) return;
            try {
                recognition.start();
            } catch (err) {
                // start() throws if a session is already open; nothing to do.
            }
        }

        function start() {
            wanted = true;
            fatal = false;
            button.text("Stop voice control").classed("on", true);
            status("voice-status", "Starting… allow the microphone if the browser asks.", "wait");
            listen();
        }

        function stop() {
            wanted = false;
            recognition.abort();
        }

        voice.start = () => { if (!wanted) start(); };
        button.on("click", () => wanted ? stop() : start());

        recognition.onstart = () => {
            running = true;
            indicate("mic", "Microphone on");
            status("voice-status", "Listening… say a command", "on");
        };

        recognition.onresult = event => {
            const result = event.results[event.results.length - 1];
            if (!result.isFinal) {
                d3.select("#voice-heard").text(`“${result[0].transcript.trim()}…”`);
                return;
            }
            // Use the first alternative transcript that is a valid command.
            const alternatives = Array.from(result, a => a.transcript.trim());
            let chosen = alternatives[0];
            let cmd = commands.parse(chosen, lexicon);
            for (const alt of alternatives) {
                const parsed = commands.parse(alt, lexicon);
                if (parsed.type !== "unknown") { chosen = alt; cmd = parsed; break; }
            }
            const confidence = result[0].confidence ? ` (${Math.round(result[0].confidence * 100)}% sure)` : "";
            d3.select("#voice-heard").text(`“${chosen.toLowerCase()}”${confidence}`);
            run(cmd, "voice", `“${chosen.toLowerCase()}”`);
        };

        recognition.onerror = event => {
            const messages = {
                "not-allowed": "Microphone permission was denied. Allow it from the address bar, or use the buttons and the typed commands.",
                "service-not-allowed": "The browser's speech service is not allowed here. Use the buttons and the typed commands.",
                "audio-capture": "No microphone was found.",
                "network": "The browser's speech service could not be reached; it needs an internet connection.",
                "language-not-supported": "English speech recognition is not available in this browser.",
                "no-speech": "No speech heard. Speak a little louder or closer to the microphone."
            };
            if (event.error !== "no-speech" && event.error !== "aborted") fatal = true;
            const message = messages[event.error];
            if (!message) return;
            status("voice-status", message, "error");
            if (fatal) report("voice", "(microphone)", fail(message));
        };

        recognition.onend = () => {
            running = false;
            if (wanted && keepListening() && !fatal) {
                setTimeout(() => { if (wanted) listen(); }, 250);
                return;
            }
            wanted = false;
            indicate("mic", null);
            button.text("Start voice control").classed("on", false);
            if (!fatal) status("voice-status", "Voice control inactive");
        };
    }

    // ===================================================== hand gesture ==

    const hand = {
        running: false,
        stream: null,
        model: null,          // { recognizer, GestureRecognizer, DrawingUtils }
        frame: 0,
        lastVideoTime: -1,
        track: [],            // recent palm positions { t, x, y }
        candidate: null,      // pose currently being held
        since: 0,
        latched: null,        // pose that already fired and is still shown
        latchedSeen: 0,
        lastFire: -Infinity,
        shown: ""
    };

    function setupGesture() {
        const button = d3.select("#gesture-button");
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            button.attr("disabled", true);
            status("gesture-status", "No camera access here: the page needs https or localhost, " +
                "and a browser with getUserMedia. Use the buttons and keys instead.", "off");
            return;
        }
        button.on("click", () => hand.running ? stopGesture() : startGesture());
    }

    async function startGesture() {
        const button = d3.select("#gesture-button").attr("disabled", true);
        const video = document.getElementById("camera");
        status("gesture-status", "Asking for camera permission…", "wait");
        try {
            hand.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: "user" },
                audio: false
            });
        } catch (err) {
            button.attr("disabled", null);
            const message = cameraError(err);
            status("gesture-status", message, "error");
            report("gesture", "(camera)", fail(message));
            return;
        }
        video.srcObject = hand.stream;
        await video.play();
        indicate("gesture", "Camera on: hand gestures");
        d3.select("#camera-box").attr("hidden", null);

        try {
            if (!hand.model) {
                status("gesture-status", "Loading the hand-gesture model (about 8 MB, first time only)…", "wait");
                hand.model = await loadGestureModel();
            }
        } catch (err) {
            console.error(err);
            stopGesture();
            const message = "The gesture model could not be loaded (it comes from a CDN, so it needs an internet connection).";
            status("gesture-status", message, "error");
            report("gesture", "(model)", fail(message));
            return;
        }

        hand.running = true;
        hand.lastVideoTime = -1;
        button.attr("disabled", null).text("Stop camera").classed("on", true);
        status("gesture-status", "Camera on. Show one hand, palm toward the camera.", "on");
        hand.frame = requestAnimationFrame(gestureLoop);
    }

    function stopGesture() {
        hand.running = false;
        cancelAnimationFrame(hand.frame);
        if (hand.stream) hand.stream.getTracks().forEach(t => t.stop());
        hand.stream = null;
        document.getElementById("camera").srcObject = null;
        const canvas = document.getElementById("camera-overlay");
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        d3.select("#camera-box").attr("hidden", true);
        indicate("gesture", null);
        d3.select("#gesture-button").attr("disabled", null).text("Start camera").classed("on", false);
        status("gesture-status", "Camera off");
        showDetected("—", 0);
    }

    async function loadGestureModel() {
        const { FilesetResolver, GestureRecognizer, DrawingUtils } = await import(`${MP}/vision_bundle.mjs`);
        const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
        const options = delegate => ({
            baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.5
        });
        let recognizer;
        try {
            recognizer = await GestureRecognizer.createFromOptions(fileset, options("GPU"));
        } catch (err) {
            recognizer = await GestureRecognizer.createFromOptions(fileset, options("CPU"));
        }
        return { recognizer, GestureRecognizer, DrawingUtils };
    }

    function cameraError(err) {
        return {
            NotAllowedError: "Camera permission was denied. Allow it from the address bar, or use the buttons and keys.",
            NotFoundError: "No camera was found.",
            NotReadableError: "The camera is in use by another application.",
            OverconstrainedError: "The camera does not support the requested video size.",
            SecurityError: "Camera access is blocked here; the page needs https or localhost."
        }[err.name] || `The camera could not be started (${err.name || err}).`;
    }

    function gestureLoop() {
        if (!hand.running) return;
        const video = document.getElementById("camera");
        if (video.readyState >= 2 && video.currentTime !== hand.lastVideoTime) {
            hand.lastVideoTime = video.currentTime;
            const now = performance.now();
            const result = hand.model.recognizer.recognizeForVideo(video, now);
            drawHand(video, result);
            interpretHand(result, now);
        }
        hand.frame = requestAnimationFrame(gestureLoop);
    }

    function drawHand(video, result) {
        const canvas = document.getElementById("camera-overlay");
        if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        const g = canvas.getContext("2d");
        g.clearRect(0, 0, canvas.width, canvas.height);
        const { GestureRecognizer, DrawingUtils } = hand.model;
        const draw = new DrawingUtils(g);
        for (const landmarks of result.landmarks || []) {
            draw.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#86b6ef", lineWidth: 4 });
            draw.drawLandmarks(landmarks, { color: "#0d366b", fillColor: "#ffffff", lineWidth: 1, radius: 3 });
        }
    }

    // Swipes come from palm movement; poses from MediaPipe's classifier, but
    // only after being held still, so the open hand at the start of a swipe
    // does not fire "reset".
    function interpretHand(result, now) {
        const landmarks = result.landmarks && result.landmarks[0];
        if (!landmarks) {
            hand.track = [];
            hand.candidate = null;
            hand.latched = null;
            showDetected("No hand in view", 0);
            return;
        }

        const palm = [0, 5, 9, 13, 17].map(i => landmarks[i]);
        const x = d3.mean(palm, p => p.x);
        const y = d3.mean(palm, p => p.y);
        hand.track.push({ t: now, x, y });
        while (hand.track[0].t < now - SWIPE_WINDOW) hand.track.shift();

        const first = hand.track[0];
        const dx = x - first.x;
        const dy = y - first.y;
        if (Math.abs(dx) > SWIPE_DX && Math.abs(dx) > 2 * Math.abs(dy)) {
            hand.track = [{ t: now, x, y }];
            hand.candidate = null;
            // The camera image is not mirrored: a hand moving to the user's
            // right moves left in the image.
            fireGesture(dx < 0 ? "Swipe_Right" : "Swipe_Left", now);
            return;
        }

        const top = result.gestures && result.gestures[0] && result.gestures[0][0];
        const pose = top && top.score >= 0.6 && GESTURES[top.categoryName] ? top.categoryName : null;

        if (pose && pose === hand.latched) hand.latchedSeen = now;
        else if (hand.latched && now - hand.latchedSeen > UNLATCH) hand.latched = null;

        if (pose !== hand.candidate) {
            hand.candidate = pose;
            hand.since = now;
        }

        if (!pose) {
            const seen = top && top.categoryName !== "None"
                ? `${POSE_NAMES[top.categoryName] || top.categoryName} (not a command)`
                : "Hand, no command pose";
            showDetected(seen, 0);
            return;
        }

        const label = `${GESTURES[pose].label} ${top.score.toFixed(2)}`;
        if (pose === hand.latched) {
            showDetected(`${label}: done, change pose to repeat`, 1);
            return;
        }
        const recent = hand.track.filter(p => p.t >= now - 200);
        const still = d3.max(recent, p => Math.hypot(p.x - x, p.y - y)) < STILL;
        if (!still) hand.since = now;
        const held = (now - hand.since) / HOLD;
        showDetected(`${label}${still ? ": hold still…" : ": moving"}`, Math.min(1, held));
        if (held >= 1) {
            hand.latched = pose;
            hand.latchedSeen = now;
            fireGesture(pose, now);
        }
    }

    function fireGesture(name, now) {
        const gesture = GESTURES[name];
        if (now - hand.lastFire < COOLDOWN) {
            showDetected(`${gesture.label}: ignored, too soon after the last command`, 0);
            return;
        }
        hand.lastFire = now;
        showDetected(`${gesture.label} ✓`, 1);
        run(gesture.cmd, "gesture", gesture.label);
    }

    // Detected-gesture text changes many times a second; only touch the DOM
    // when it actually changes.
    function showDetected(text, progress) {
        if (text !== hand.shown) {
            hand.shown = text;
            d3.select("#gesture-detected").text(text);
            d3.select("#camera-label").text(text === "—" ? "" : text);
        }
        d3.select("#gesture-hold").style("width", `${Math.round(progress * 100)}%`);
    }

    // ========================================================= eye gaze ==

    const gaze = {
        running: false,
        target: null,         // country indicated by a completed dwell
        candidate: null,
        since: 0,
        points: []
    };
    let calibrating = false;

    function setupGaze() {
        const button = d3.select("#gaze-button");
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            button.attr("disabled", true);
            status("gaze-status", "No camera access here: the page needs https or localhost.", "off");
            return;
        }
        button.on("click", () => gaze.running ? stopGaze() : startGaze());
        d3.select("#gaze-calibrate").on("click", startCalibration);
        d3.select("#gaze-select").on("click", () => run({ type: "confirm" }, "button", "Select target"));
        d3.select("#calibration-skip").on("click", endCalibration);
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function startGaze() {
        // WebGazer refuses plain http other than "localhost" (127.0.0.1 too).
        if (location.protocol !== "https:" && location.hostname !== "localhost") {
            const message = "Eye gaze needs https, or http://localhost (not 127.0.0.1).";
            status("gaze-status", message, "error");
            report("gaze", "(camera)", fail(message));
            return;
        }
        const button = d3.select("#gaze-button").attr("disabled", true);
        try {
            if (!window.webgazer) {
                status("gaze-status", "Loading the eye tracker (WebGazer, about 2 MB)…", "wait");
                await loadScript(WEBGAZER);
            }
            webgazer.params.faceMeshSolutionPath = WEBGAZER_FACEMESH;
            webgazer.params.videoViewerWidth = 240;
            webgazer.params.videoViewerHeight = 180;
            webgazer.saveDataAcrossSessions(false)
                .setRegression("ridge")
                .applyKalmanFilter(true)
                .showPredictionPoints(false)
                .setGazeListener(onGaze);
            status("gaze-status", "Asking for camera permission, then finding your face…", "wait");
            let denied = null;
            await webgazer.begin(err => { denied = err || new Error("camera"); });
            if (denied) throw denied;
        } catch (err) {
            console.error(err);
            button.attr("disabled", null);
            const message = err instanceof DOMException
                ? cameraError(err)
                : "The eye tracker could not be started (it comes from a CDN, so it needs an internet connection).";
            status("gaze-status", message, "error");
            report("gaze", "(camera)", fail(message));
            return;
        }
        gaze.running = true;
        gaze.points = [];
        button.attr("disabled", null).text("Stop eye gaze").classed("on", true);
        d3.selectAll("#gaze-calibrate, #gaze-select").attr("disabled", null);
        indicate("gaze", "Camera on: eye gaze");
        startCalibration();
    }

    function stopGaze() {
        gaze.running = false;
        endCalibration(true);
        try {
            webgazer.clearGazeListener();
            webgazer.stopVideo();
            webgazer.end();
        } catch (err) {
            console.warn(err);
        }
        if (gaze.target && state.hover === gaze.target) { state.hover = null; update(); }
        gaze.target = null;
        gaze.candidate = null;
        showGazeTarget();
        d3.select("#gaze-cursor").attr("hidden", true);
        d3.select("#gaze-button").text("Start eye gaze").classed("on", false);
        d3.selectAll("#gaze-calibrate, #gaze-select").attr("disabled", true);
        indicate("gaze", null);
        status("gaze-status", "Eye gaze off");
    }

    // Nine dots; WebGazer learns from every click, so clicking a dot while
    // looking at it is a training sample.
    function startCalibration() {
        calibrating = true;
        webgazer.showVideoPreview(true).showFaceOverlay(true).showFaceFeedbackBox(true);
        const overlay = d3.select("#calibration").attr("hidden", null);
        const spots = d3.cross([0.08, 0.5, 0.92], [0.1, 0.5, 0.9]).map(([x, y]) => ({ x, y, clicks: 0 }));
        overlay.selectAll("button.l10-dot")
            .data(spots)
            .join("button")
            .attr("type", "button")
            .attr("class", "l10-dot")
            .attr("aria-label", "Calibration dot")
            .style("left", d => `${d.x * 100}%`)
            .style("top", d => `${d.y * 100}%`)
            .style("--done", 0)
            .on("click", function (event, d) {
                d.clicks += 1;
                d3.select(this).style("--done", Math.min(1, d.clicks / 5)).classed("done", d.clicks >= 5);
                if (spots.every(s => s.clicks >= 5)) endCalibration();
            });
        status("gaze-status", "Calibrating: click each dot five times while looking at it.", "wait");
    }

    function endCalibration(silent) {
        if (!calibrating) return;
        calibrating = false;
        d3.select("#calibration").attr("hidden", true);
        if (window.webgazer) webgazer.showVideoPreview(false).showFaceOverlay(false).showFaceFeedbackBox(false);
        if (silent === true) return;
        status("gaze-status", "Tracking. Look at a country for 0.8 s, then say “select” or press Space.", "on");
    }

    function onGaze(data) {
        if (!data || !gaze.running) return;

        gaze.points.push([data.x, data.y]);
        if (gaze.points.length > GAZE_SMOOTH) gaze.points.shift();
        const x = d3.mean(gaze.points, p => p[0]);
        const y = d3.mean(gaze.points, p => p[1]);

        const cursor = d3.select("#gaze-cursor")
            .attr("hidden", null)
            .style("left", `${x}px`)
            .style("top", `${y}px`);
        if (calibrating) { cursor.style("--p", 0); return; }

        const iso3 = countryNear(x, y);
        const now = performance.now();
        if (iso3 !== gaze.candidate) {
            gaze.candidate = iso3;
            gaze.since = now;
        }
        const progress = iso3 ? Math.min(1, (now - gaze.since) / DWELL) : 0;
        cursor.style("--p", iso3 === gaze.target ? 1 : progress);

        // Dwell, not glance: a country is indicated only after DWELL ms.
        if (iso3 && iso3 !== gaze.target && progress >= 1) {
            gaze.target = iso3;
            state.hover = iso3;
            update();
            showGazeTarget();
            report("gaze", `Looked at ${nameOf(iso3)} for 0.8 s`,
                ok(`Indicated ${describe(iso3)}. Say “select” or press Space to select it.`));
        }
    }

    // Vote over nine points around the estimate, so a noisy gaze point near a
    // border still lands on the country most of the area belongs to.
    function countryNear(x, y) {
        const votes = new Map();
        const offsets = [[0, 0], ...d3.range(8).map(i => {
            const a = (i / 8) * 2 * Math.PI;
            return [GAZE_RADIUS * Math.cos(a), GAZE_RADIUS * Math.sin(a)];
        })];
        for (const [ox, oy] of offsets) {
            const el = document.elementFromPoint(x + ox, y + oy);
            if (!el || !el.classList.contains("country")) continue;
            const p = d3.select(el).datum().properties;
            if (p.value == null) continue;
            votes.set(p.iso3, (votes.get(p.iso3) || 0) + 1);
        }
        const best = d3.greatest(votes, ([, n]) => n);
        return best && best[1] >= 3 ? best[0] : null;
    }

    function showGazeTarget() {
        d3.select("#gaze-target").text(gaze.target ? describe(gaze.target) : "—");
    }

})();
