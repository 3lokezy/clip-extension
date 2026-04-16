// Copy of repo root "TikTok profile inspect" — replace this file after editing the bookmarklet.
(() => {
  // ============================================================
  // DUPLICATE RUN GUARD
  // ============================================================
  if (window.__ttMasterTeardown) {
    try { window.__ttMasterTeardown(); } catch (e) {}
  }

  const disposers = [];

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    disposers.push(function() { target.removeEventListener(type, fn, opts); });
  }

  function teardown() {
    window.__ttMasterRunning = false;
    window.__ttMasterTeardown = null;
    disposers.splice(0).forEach(function(d) { try { d(); } catch (e) {} });
    ["tt-statsbar","tt-datebar","tt-modebar","tt-toolbar","tt-loader","tt-panel"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    var old = document.getElementById("tt-master-style");
    if (old) old.remove();
    document.body.classList.remove("tt-dim-mode","tt-focus-active","tt-creator-mode");
  }

  window.__ttMasterTeardown = teardown;
  window.__ttMasterRunning = true;

  // ============================================================
  // CONFIG
  // ============================================================
  const MIN_VIEWS            = 100000;
  const TOP_MULTIPLIER     = 5;
  const RATE_PER_MIN       = 50;
  const ACCEPTANCE_RATE    = 0.75;

  const ENABLE_AUTO_SCROLL = true;
  /** If false, first paint only scans visible grid; use toolbar “Load window” or a date filter that needs depth. */
  const AUTO_SCROLL_ON_START = false;
  const SEEK_BACK_DAYS       = 30;
  const SCROLL_STEP          = 1200;
  const SCROLL_DELAY         = 800;
  const MAX_IDLE_ROUNDS      = 4;
  const SCROLL_RESET_DELAY   = 400;
  /** Heavy dimming off by default; toggle “Dim” in the toolbar. */
  const START_DIMMED         = false;

  const filterOptions = [
    { label:"All", days:0 }, { label:"7d", days:7 },
    { label:"30d", days:30 }, { label:"90d", days:90 }, { label:"180d", days:180 }
  ];

  function closestPreset(target) {
    if (target === 0) return 0;
    var best = filterOptions.reduce(function(prev, cur) {
      return Math.abs(cur.days - target) < Math.abs(prev.days - target) ? cur : prev;
    });
    return best.days;
  }

  var defaultPreset = closestPreset(SEEK_BACK_DAYS);

  // ============================================================
  // DATE HELPERS
  // ============================================================
  function dateFromVideoId(id) {
    try {
      var n       = BigInt(id);
      var shifted = n / BigInt(0x100000000);
      return new Date(Number(shifted) * 1000);
    } catch (e) { return null; }
  }

  function fmtDate(d) {
    if (!d) return "—";
    return d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
  }

  function daysAgo(d) {
    if (!d) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function videoDateFromItem(item) {
    var a = item.querySelector("a[href*='/video/']");
    var m = a ? a.href.match(/\/video\/(\d+)/) : null;
    return m ? dateFromVideoId(m[1]) : null;
  }

  // ============================================================
  // FORMAT HELPERS
  // ============================================================
  function fmtK(n)     { return n >= 1000000 ? (n/1000000).toFixed(1)+"M" : n >= 1000 ? (n/1000).toFixed(0)+"K" : String(Math.round(n)); }
  function fmtPct(n)   { return n.toFixed(1) + "%"; }
  function fmtMoney(n) { return "$" + (n >= 1000 ? (n/1000).toFixed(1)+"K" : n.toFixed(0)); }

  function parseViews(text) {
    text = text.toLowerCase().trim();
    if (text.includes("m")) return parseFloat(text) * 1000000;
    if (text.includes("k")) return parseFloat(text) * 1000;
    return parseFloat(text.replace(/,/g, "")) || 0;
  }

  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  function rawScore(views, isTop, isQualified) {
    return Math.log10(views + 1) * 10 * (isTop ? 1.6 : isQualified ? 1.2 : 0.6);
  }

  // ============================================================
  // STYLE INJECTION
  // ============================================================
  var styleEl = document.createElement("style");
  styleEl.id  = "tt-master-style";
  styleEl.textContent = [
    ".tt-item {",
    "  transition: transform 320ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms ease, filter 180ms ease;",
    "  transform-origin: center;",
    "}",
    ".tt-dim-mode .tt-item { opacity:0.12; filter:blur(0.4px) saturate(0.7); transform:scale(0.98); }",
    ".tt-dim-mode .tt-item.tt-qualified,",
    ".tt-dim-mode .tt-item.tt-top { opacity:1; filter:none; transform:scale(1); }",
    ".tt-dim-mode .tt-item.tt-date-hidden { opacity:0.04 !important; filter:blur(2px) saturate(0) !important; pointer-events:none !important; }",
    ".tt-creator-mode .tt-item:not(.tt-date-hidden) { opacity:1 !important; filter:none !important; transform:scale(1) !important; }",
    ".tt-creator-mode.tt-focus-active .tt-item:not(.tt-active):not(.tt-date-hidden) { opacity:0.35 !important; filter:blur(1px) saturate(0.5) !important; }",
    ".tt-dim-mode.tt-focus-active .tt-item.tt-qualified:not(.tt-active),",
    ".tt-dim-mode.tt-focus-active .tt-item.tt-top:not(.tt-active) { opacity:0.3; filter:blur(1.2px) saturate(0.4); }",
    ".tt-dim-mode.tt-focus-active .tt-item:not(.tt-active):not(.tt-qualified):not(.tt-top) { opacity:0.07; filter:blur(1.5px) saturate(0.4); }",
    ".tt-item.tt-active { opacity:1 !important; transform:scale(1.05) !important; filter:none !important; z-index:10; }",
    ".tt-item.tt-qualified { outline:2px solid #39FF14; }",
    ".tt-item.tt-top { outline:none; position:relative; }",
    ".tt-item.tt-top::before {",
    "  content:''; position:absolute; inset:-2px; z-index:-1;",
    "  border-radius:6px;",
    "  background: linear-gradient(135deg, #85F6FE, #84FFA8, #FFB054, #FFA3DE, #84A9FF);",
    "  pointer-events:none;",
    "}",
    ".tt-item.tt-top { box-shadow: 0 0 18px rgba(133,246,254,0.2), 0 0 8px rgba(255,163,222,0.15); }",

    "#tt-loader { position:fixed; top:8px; z-index:999999; display:none; align-items:center;",
    "  gap:12px; background:rgba(0,0,0,0.88); backdrop-filter:blur(10px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:10px;",
    "  font-family:monospace; color:#fff; padding:0 20px; height:52px; }",
    "#tt-loader .tt-loader-spinner { width:14px; height:14px; border:2px solid rgba(133,246,254,0.2);",
    "  border-top-color:#85F6FE; border-radius:50%; animation:tt-spin 0.7s linear infinite; flex-shrink:0; }",
    "@keyframes tt-spin { to { transform:rotate(360deg); } }",
    "#tt-loader .tt-loader-text { font-size:12px; color:rgba(255,255,255,0.6); }",
    "#tt-loader .tt-loader-count { font-size:14px; font-weight:bold; color:#85F6FE; margin-left:4px; }",
    "#tt-loader .tt-loader-status { font-size:10px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.06em; }",

    "#tt-panel { position:fixed; z-index:999998; pointer-events:none; display:none;",
    "  background:rgba(0,0,0,0.75); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:10px;",
    "  font-family:monospace; overflow:hidden; min-width:230px; max-width:250px; }",
    "#tt-panel .tt-panel-disclaimer { padding:6px 14px 8px; font-size:9px; line-height:1.35; color:rgba(255,255,255,0.38);",
    "  border-top:1px solid rgba(255,255,255,0.06); }",
    "#tt-panel .tt-panel-header { padding:9px 14px 8px; font-size:10px; letter-spacing:0.1em;",
    "  text-transform:uppercase; color:rgba(255,255,255,0.4); border-bottom:1px solid rgba(255,255,255,0.07);",
    "  display:flex; justify-content:space-between; align-items:center; }",
    "#tt-panel .tt-panel-badge { font-size:10px; padding:2px 7px; border-radius:20px; font-weight:bold; letter-spacing:0.04em; }",
    "#tt-panel .tt-panel-badge.qualified { background:rgba(57,255,20,0.15); color:#39FF14; border:1px solid rgba(57,255,20,0.3); }",
    "#tt-panel .tt-panel-badge.top       { background:rgba(133,246,254,0.1); color:#85F6FE; border:1px solid rgba(133,246,254,0.3); }",
    "#tt-panel .tt-panel-badge.not-qualified { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.3); border:1px solid rgba(255,255,255,0.1); }",
    "#tt-panel .tt-panel-grid { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid rgba(255,255,255,0.07); }",
    "#tt-panel .tt-panel-cell { padding:8px 14px; border-right:1px solid rgba(255,255,255,0.07); }",
    "#tt-panel .tt-panel-cell:nth-child(even) { border-right:none; }",
    "#tt-panel .tt-panel-cell-label { font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:rgba(255,255,255,0.35); margin-bottom:2px; }",
    "#tt-panel .tt-panel-cell-value { font-size:14px; font-weight:bold; color:#fff; }",
    "#tt-panel .tt-panel-cell-value.green { color:#39FF14; }",
    "#tt-panel .tt-panel-cell-value.pink  { color:#ff2dfc; }",
    "#tt-panel .tt-panel-cell-value.blue  { color:#85F6FE; }",
    "#tt-panel .tt-panel-cell-value.peach { color:#FFB054; }",
    "#tt-panel .tt-panel-date { padding:7px 14px; border-bottom:1px solid rgba(255,255,255,0.07); display:flex; justify-content:space-between; align-items:center; }",
    "#tt-panel .tt-panel-date-label { font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:rgba(255,255,255,0.35); }",
    "#tt-panel .tt-panel-date-value { font-size:11px; font-weight:bold; color:rgba(255,255,255,0.7); }",
    "#tt-panel .tt-panel-bar-row { padding:8px 14px 10px; }",
    "#tt-panel .tt-panel-bar-label { display:flex; justify-content:space-between; font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:rgba(255,255,255,0.35); margin-bottom:5px; }",
    "#tt-panel .tt-panel-bar-track { height:4px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; }",
    "#tt-panel .tt-panel-bar-fill { height:100%; background:linear-gradient(90deg,#85F6FE,#84FFA8,#FFB054,#FFA3DE,#84A9FF); border-radius:4px; transition:width 260ms ease; }",

    "#tt-statsbar { position:fixed; top:8px; z-index:999997; display:flex; align-items:stretch;",
    "  background:rgba(0,0,0,0.88); backdrop-filter:blur(10px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:10px;",
    "  font-family:monospace; color:#fff; overflow:hidden; }",
    "#tt-statsbar .tt-stat { display:flex; flex-direction:column; align-items:center; justify-content:center;",
    "  padding:0 14px; flex:1; border-right:1px solid rgba(255,255,255,0.07); gap:2px; min-width:0; height:52px; }",
    "#tt-statsbar .tt-stat:last-child { border-right:none; }",
    "#tt-statsbar .tt-stat-label { font-size:8.5px; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.07em; white-space:nowrap; }",
    "#tt-statsbar .tt-stat-value { font-size:13px; font-weight:bold; color:#fff; white-space:nowrap; transition:color 200ms ease, opacity 200ms ease; }",
    "#tt-statsbar .tt-stat-value.green { color:#39FF14; }",
    "#tt-statsbar .tt-stat-value.pink  { color:#ff2dfc; }",
    "#tt-statsbar .tt-stat-value.blue  { color:#85F6FE; }",
    "#tt-statsbar .tt-stat-value.peach { color:#FFB054; }",
    "#tt-statsbar .tt-stat-close { flex:0 0 44px; display:flex; align-items:center; justify-content:center;",
    "  border-left:1px solid rgba(255,255,255,0.07); cursor:pointer; color:rgba(255,255,255,0.45); font-size:18px; line-height:1;",
    "  user-select:none; transition:color 140ms ease, background 140ms ease; }",
    "#tt-statsbar .tt-stat-close:hover { color:#fff; background:rgba(255,255,255,0.06); }",

    "#tt-datebar { position:fixed; top:68px; z-index:999997; display:flex; align-items:center;",
    "  gap:6px; background:rgba(0,0,0,0.88); backdrop-filter:blur(10px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:8px;",
    "  font-family:monospace; padding:0 10px; height:34px; }",
    "#tt-datebar .tt-filter-label { font-size:9px; text-transform:uppercase; letter-spacing:0.08em;",
    "  color:rgba(255,255,255,0.3); padding-right:6px; border-right:1px solid rgba(255,255,255,0.08); margin-right:2px; white-space:nowrap; }",
    "#tt-datebar .tt-filter-btn { font-family:monospace; font-size:10px; font-weight:bold; letter-spacing:0.05em;",
    "  padding:3px 10px; border-radius:5px; border:1px solid rgba(255,255,255,0.1); background:transparent;",
    "  color:rgba(255,255,255,0.45); cursor:pointer; transition:all 140ms ease; white-space:nowrap; }",
    "#tt-datebar .tt-filter-btn:hover:not(:disabled) { background:rgba(255,255,255,0.08); color:#fff; }",
    "#tt-datebar .tt-filter-btn.active { background:rgba(133,246,254,0.12); border-color:rgba(133,246,254,0.4); color:#85F6FE; }",
    "#tt-datebar .tt-filter-btn.loading { background:rgba(133,246,254,0.06); color:rgba(133,246,254,0.5); cursor:wait; }",
    "#tt-datebar .tt-filter-btn:disabled { opacity:0.45; cursor:not-allowed; }",
    "#tt-datebar .tt-filter-btn.partial::after { content:'~'; margin-left:2px; opacity:0.6; }",

    "#tt-modebar { position:fixed; top:110px; z-index:999997; display:flex; align-items:center;",
    "  gap:8px; background:rgba(0,0,0,0.88); backdrop-filter:blur(10px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:8px;",
    "  font-family:monospace; padding:0 12px; height:34px; }",
    "#tt-modebar .tt-mode-label { font-size:9px; text-transform:uppercase; letter-spacing:0.08em;",
    "  color:rgba(255,255,255,0.3); padding-right:8px; border-right:1px solid rgba(255,255,255,0.08); margin-right:2px; white-space:nowrap; }",
    "#tt-modebar .tt-mode-btn { font-family:monospace; font-size:10px; font-weight:bold; letter-spacing:0.05em;",
    "  padding:3px 10px; border-radius:5px; border:1px solid rgba(255,255,255,0.1); background:transparent;",
    "  color:rgba(255,255,255,0.45); cursor:pointer; transition:all 140ms ease; white-space:nowrap; }",
    "#tt-modebar .tt-mode-btn:hover { background:rgba(255,255,255,0.08); color:#fff; }",
    "#tt-modebar .tt-mode-btn.active.clipping { background:rgba(57,255,20,0.12); border-color:rgba(57,255,20,0.35); color:#39FF14; }",
    "#tt-modebar .tt-mode-btn.active.creator  { background:rgba(255,176,84,0.12); border-color:rgba(255,176,84,0.35); color:#FFB054; }",
    "#tt-modebar .tt-rpm-wrap { display:flex; align-items:center; gap:7px; padding-left:8px; border-left:1px solid rgba(255,255,255,0.08); }",
    "#tt-modebar .tt-rpm-label { font-size:9px; color:rgba(255,255,255,0.3); text-transform:uppercase; letter-spacing:0.06em; white-space:nowrap; }",
    "#tt-modebar .tt-rpm-value { font-size:11px; font-weight:bold; color:#FFB054; min-width:38px; text-align:right; }",
    "#tt-modebar .tt-rpm-slider { -webkit-appearance:none; appearance:none; width:80px; height:3px;",
    "  background:rgba(255,176,84,0.2); border-radius:2px; outline:none; cursor:pointer; }",
    "#tt-modebar .tt-rpm-slider::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:#FFB054; cursor:pointer; }",
    "#tt-modebar .tt-rpm-slider::-moz-range-thumb { width:12px; height:12px; border-radius:50%; background:#FFB054; border:none; cursor:pointer; }",

    "#tt-toolbar { position:fixed; top:152px; z-index:999997; display:flex; align-items:center; flex-wrap:wrap;",
    "  gap:8px; background:rgba(0,0,0,0.88); backdrop-filter:blur(10px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:8px;",
    "  font-family:monospace; padding:6px 12px; min-height:34px; }",
    "#tt-toolbar .tt-tool-btn { font-family:monospace; font-size:10px; font-weight:bold; letter-spacing:0.04em;",
    "  padding:4px 10px; border-radius:5px; border:1px solid rgba(255,255,255,0.1); background:transparent;",
    "  color:rgba(255,255,255,0.55); cursor:pointer; transition:all 140ms ease; white-space:nowrap; }",
    "#tt-toolbar .tt-tool-btn:hover { background:rgba(255,255,255,0.08); color:#fff; }",
    "#tt-toolbar .tt-tool-btn.on { background:rgba(133,246,254,0.12); border-color:rgba(133,246,254,0.35); color:#85F6FE; }",
    "#tt-toolbar .tt-tool-hint { font-size:9px; color:rgba(255,255,255,0.32); max-width:220px; line-height:1.35; }"
  ].join("\n");

  document.head.appendChild(styleEl);
  if (START_DIMMED) document.body.classList.add("tt-dim-mode");

  // ============================================================
  // SHARED STATE
  // ============================================================
  var earningsMode    = "clipping";
  var creatorRPM      = 0.70;
  var activeDayFilter = defaultPreset;
  var loadedDays      = 0;
  var loadedToEnd     = false;
  var filterBusy      = false;
  var panelPinned     = false;

  const enriched     = [];
  const processedSet = new Set();
  var   dataMap      = new Map();

  const listRoot = document.querySelector("#user-post-item-list") || document.body;

  function inferLoadedDepthDays() {
    var oldest = oldestLoadedDate();
    if (!oldest) return 0;
    return daysAgo(oldest);
  }

  function syncLoadedDepthMeta() {
    if (!loadedToEnd && !filterBusy && loadedDays === 0) {
      var inferred = inferLoadedDepthDays();
      if (inferred > 0) loadedDays = inferred;
    }
  }

  function updateDateButtonPartialState() {
    var depth = inferLoadedDepthDays();
    document.querySelectorAll(".tt-filter-btn").forEach(function(btn) {
      var d = Number(btn.dataset.days);
      var partial = d > 0 && !loadedToEnd && depth < d;
      btn.classList.toggle("partial", partial);
    });
  }

  function setDateFilterBusy(busy) {
    document.querySelectorAll(".tt-filter-btn").forEach(function(btn) {
      btn.disabled = busy && !btn.classList.contains("loading");
    });
  }

  // ============================================================
  // EARNINGS
  // ============================================================
  function calcItemEarnings(views, isQualified) {
    if (earningsMode === "creator") return (views / 1000) * creatorRPM;
    return isQualified ? (views / MIN_VIEWS) * RATE_PER_MIN * ACCEPTANCE_RATE : 0;
  }

  function updateModeLabels() {
    var bar = document.getElementById("tt-statsbar");
    if (!bar) return;
    var labels = bar.querySelectorAll(".tt-stat-label");
    if (earningsMode === "creator") {
      if (labels[8]) labels[8].textContent = "Per Video";
      if (labels[9]) labels[9].textContent = "ROI/Video";
    } else {
      if (labels[8]) labels[8].textContent = "Per Qual";
      if (labels[9]) labels[9].textContent = "ROI/Video";
    }
  }

  // ============================================================
  // LOADER
  // ============================================================
  var loader = document.createElement("div");
  loader.id  = "tt-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.style.display = "none";
  loader.innerHTML =
    '<div class="tt-loader-spinner"></div>' +
    '<div>' +
      '<div class="tt-loader-status" id="tt-loader-status">Scrolling</div>' +
      '<div class="tt-loader-text">Videos loaded: <span class="tt-loader-count" id="tt-loader-count">0</span></div>' +
    '</div>';
  document.body.appendChild(loader);

  // ============================================================
  // SCROLL HELPERS
  // ============================================================
  function getGridItems() {
    return listRoot.querySelectorAll('[id^="grid-item-container"]');
  }

  function getItemCount() {
    return getGridItems().length;
  }

  function oldestLoadedDate() {
    var all    = getGridItems();
    var sample = Array.from(all).slice(-8);
    var oldest = null;
    for (var i = 0; i < sample.length; i++) {
      var d = videoDateFromItem(sample[i]);
      if (d && (!oldest || d < oldest)) oldest = d;
    }
    return oldest;
  }

  function positionFixed(el) {
    var r = listRoot.getBoundingClientRect();
    el.style.left  = r.left + "px";
    el.style.width = r.width + "px";
  }

  function getScrollContainer() {
    var el = listRoot;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return null;
  }

  async function autoScroll(targetDays) {
    positionFixed(loader);
    loader.style.display = "flex";

    var lastCount  = getItemCount();
    var idleRounds = 0;
    var statusEl   = document.getElementById("tt-loader-status");
    var countEl    = document.getElementById("tt-loader-count");
    var container  = getScrollContainer();
    var hitLimit   = false;

    while (idleRounds < MAX_IDLE_ROUNDS) {
      if (container) {
        container.scrollTop += SCROLL_STEP;
      } else {
        window.scrollBy(0, SCROLL_STEP);
        document.documentElement.scrollTop += SCROLL_STEP;
      }
      await new Promise(function(r) { setTimeout(r, SCROLL_DELAY); });

      var current = getItemCount();
      countEl.textContent = String(current);

      if (current === lastCount) {
        idleRounds++;
        statusEl.textContent = "Waiting (" + idleRounds + "/" + MAX_IDLE_ROUNDS + ")";
      } else {
        idleRounds = 0;
        lastCount  = current;
        statusEl.textContent = "Scrolling";

        if (targetDays > 0) {
          var oldest = oldestLoadedDate();
          if (oldest && daysAgo(oldest) > targetDays) {
            statusEl.textContent = "Date limit reached";
            hitLimit = true;
            break;
          }
        }
      }
    }

    if (!hitLimit) loadedToEnd = (targetDays === 0 || idleRounds >= MAX_IDLE_ROUNDS);
    loadedDays = targetDays;

    statusEl.textContent = "Done";
    await new Promise(function(r) { setTimeout(r, 300); });
    loader.style.display = "none";
    syncLoadedDepthMeta();
    updateDateButtonPartialState();
  }

  // ============================================================
  // PROCESS ITEMS
  // ============================================================
  function processItems() {
    var items = getGridItems();

    items.forEach(function(item) {
      if (processedSet.has(item)) return;

      var viewEl = item.querySelector('[data-e2e="video-views"]');
      if (!viewEl) return;

      processedSet.add(item);
      item.classList.add("tt-item");

      var views       = parseViews(viewEl.textContent || "");
      var isQualified = views >= MIN_VIEWS;
      var isTop       = views >= MIN_VIEWS * TOP_MULTIPLIER;
      var score       = rawScore(views, isTop, isQualified);
      var postDate    = videoDateFromItem(item);

      item.classList.remove("tt-qualified", "tt-top");
      if (isQualified) item.classList.add(isTop ? "tt-top" : "tt-qualified");
      item.dataset.daysAgo = String(daysAgo(postDate));

      var entry = { item:item, views:views, isQualified:isQualified, isTop:isTop,
                    score:score, postDate:postDate };
      enriched.push(entry);
      dataMap.set(item, entry);
    });

    enriched.sort(function(a, b) { return b.score - a.score; });
    var rawTop = enriched[0] ? enriched[0].score : 1;

    enriched.forEach(function(d, i) {
      d.score = Math.round((d.score / rawTop) * 1000) / 10;
      d.rank  = i + 1;
      d.item.style.opacity = "";
      if (!d.isQualified) {
        d.item.style.opacity = (0.08 + ((enriched.length - i) / Math.max(enriched.length, 1)) * 0.17).toFixed(2);
      }
    });

    syncLoadedDepthMeta();
    updateDateButtonPartialState();
  }

  // ============================================================
  // STATS
  // ============================================================
  function calcStats(days) {
    var subset = days === 0
      ? enriched
      : enriched.filter(function(d) { return daysAgo(d.postDate) <= days; });

    var tv = 0, qc = 0, qv = 0, mx = 0, topScore = 0, tc = subset.length;
    subset.forEach(function(d) {
      tv += d.views;
      mx = Math.max(mx, d.views);
      if (d.score > topScore) topScore = d.score;
      if (d.isQualified) { qc++; qv += d.views; }
    });

    var avgV = tc ? tv/tc : 0;
    var avgQ = qc ? qv/qc : 0;
    var earn, epv;

    if (earningsMode === "creator") {
      earn = (tv / 1000) * creatorRPM;
      epv  = tc ? earn / tc : 0;
    } else {
      earn = (qv / MIN_VIEWS) * RATE_PER_MIN * ACCEPTANCE_RATE;
      epv  = qc ? earn / qc : 0;
    }

    var roi = tc ? earn / tc : 0;

    return { tc:tc, qc:qc, qrate:tc?(qc/tc)*100:0, tv:tv, avgV:avgV,
             avgQ:avgQ, mx:mx, earn:earn, epv:epv, roi:roi, topScore:topScore };
  }

  function updateStatsBar(days) {
    var s   = calcStats(days);
    var bar = document.getElementById("tt-statsbar");
    if (!bar) return;
    var vals = bar.querySelectorAll(".tt-stat-value");
    var topStr = s.tc ? (s.topScore.toFixed(1) + " / 100") : "—";
    var data = [s.tc, s.qc, fmtPct(s.qrate), fmtK(s.tv), fmtK(s.avgV),
                fmtK(s.avgQ), fmtK(s.mx), fmtMoney(s.earn),
                fmtMoney(s.epv), fmtMoney(s.roi), topStr];
    vals.forEach(function(el, i) { if (data[i] !== undefined) el.textContent = data[i]; });
  }

  // ============================================================
  // DATE FILTER
  // ============================================================
  function applyVisualFilter(days) {
    enriched.forEach(function(d) {
      var hidden = days > 0 && daysAgo(d.postDate) > days;
      d.item.classList.toggle("tt-date-hidden", hidden);
    });
    document.querySelectorAll(".tt-filter-btn").forEach(function(btn) {
      btn.classList.remove("active", "loading");
      if (Number(btn.dataset.days) === days) btn.classList.add("active");
    });
    updateStatsBar(days);
    activeDayFilter = days;
    updateDateButtonPartialState();
  }

  async function applyDateFilter(days) {
    if (filterBusy) return;

    var needsScroll = ENABLE_AUTO_SCROLL && !loadedToEnd &&
      (days === 0 || (days > 0 && loadedDays > 0 && days > loadedDays));

    if (needsScroll) {
      filterBusy = true;
      setDateFilterBusy(true);
      document.querySelectorAll(".tt-filter-btn").forEach(function(btn) {
        if (Number(btn.dataset.days) === days) btn.classList.add("loading");
      });

      await autoScroll(days);
      processItems();
      filterBusy = false;
      setDateFilterBusy(false);
    }

    applyVisualFilter(days);
  }

  // ============================================================
  // HOVER PANEL
  // ============================================================
  var panel = document.createElement("div");
  panel.id  = "tt-panel";
  document.body.appendChild(panel);

  function cell(label, value, colorClass) {
    return '<div class="tt-panel-cell">' +
      '<div class="tt-panel-cell-label">' + label + '</div>' +
      '<div class="tt-panel-cell-value' + (colorClass ? " " + colorClass : "") + '">' + value + '</div>' +
      '</div>';
  }

  function positionPanel(item) {
    var rect = item.getBoundingClientRect();
    var pw = 250, gap = 14;
    var left = (window.innerWidth - rect.right) > pw + gap
      ? rect.right + gap : rect.left - pw - gap;
    left = clamp(left, 10, window.innerWidth - pw - 10);
    var top = clamp(rect.top, 8, window.innerHeight - (panel.offsetHeight || 200) - 8);
    panel.style.left = left + "px";
    panel.style.top  = top  + "px";
  }

  var activeItem      = null;
  var scrollHideTimer = null;

  function resetPanel(opts) {
    opts = opts || {};
    if (panelPinned && !opts.force) return;
    panelPinned = false;
    if (activeItem) activeItem.classList.remove("tt-active");
    activeItem = null;
    panel.style.display = "none";
    document.body.classList.remove("tt-focus-active");
  }

  function showPanel(d) {
    if (activeItem === d.item && panel.style.display === "block") return;
    if (activeItem) activeItem.classList.remove("tt-active");
    activeItem = d.item;
    d.item.classList.add("tt-active");
    document.body.classList.add("tt-focus-active");

    var badgeClass = d.isTop ? "top" : d.isQualified ? "qualified" : "not-qualified";
    var badgeText  = d.isTop ? "TOP" : d.isQualified ? "QUALIFIED" : "NOT QUALIFIED";
    var scoreColor = d.score >= 80 ? "pink" : d.score >= 50 ? "green" : "";
    var age        = daysAgo(d.postDate);
    var ageStr     = age === Infinity ? "—" : age === 0 ? "Today" : age === 1 ? "Yesterday" : age + "d ago";
    var earnLabel  = earningsMode === "creator" ? "Creator Est." : "Clip Est.";

    panel.innerHTML =
      '<div class="tt-panel-header"><span>Video Intel</span>' +
        '<span class="tt-panel-badge ' + badgeClass + '">' + badgeText + '</span></div>' +
      '<div class="tt-panel-date">' +
        '<span class="tt-panel-date-label">Posted</span>' +
        '<span class="tt-panel-date-value">' + fmtDate(d.postDate) + ' · ' + ageStr + '</span>' +
      '</div>' +
      '<div class="tt-panel-grid">' +
        cell("Views",    d.views.toLocaleString(),                "blue")     +
        cell("Rank",     "#" + d.rank + " / " + enriched.length, "")         +
        cell(earnLabel,  "$" + calcItemEarnings(d.views, d.isQualified).toFixed(2), "peach") +
        cell("Score",    d.score.toFixed(1) + " / 100",           scoreColor) +
      '</div>' +
      '<div class="tt-panel-bar-row">' +
        '<div class="tt-panel-bar-label"><span>Strength</span><span>' + d.score.toFixed(1) + '%</span></div>' +
        '<div class="tt-panel-bar-track"><div class="tt-panel-bar-fill" style="width:' + d.score + '%"></div></div>' +
      '</div>' +
      '<div class="tt-panel-disclaimer">Figures are rough estimates from this page, not TikTok payouts.</div>';

    panel.style.display = "block";
    positionPanel(d.item);
  }

  function onListHover(e) {
    if (panelPinned) return;
    var item = e.target.closest('[id^="grid-item-container"]');
    if (!item) return;
    if (item.classList.contains("tt-date-hidden")) { resetPanel({ force:true }); return; }
    var d = dataMap.get(item);
    if (d) showPanel(d);
  }

  on(listRoot, "mouseover", onListHover);
  on(listRoot, "pointerover", function(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    onListHover(e);
  });
  on(listRoot, "mouseleave", function() { resetPanel({ force:true }); });

  on(listRoot, "contextmenu", function(e) {
    var item = e.target.closest('[id^="grid-item-container"]');
    if (!item) return;
    var d = dataMap.get(item);
    if (!d || item.classList.contains("tt-date-hidden")) return;
    e.preventDefault();
    panelPinned = true;
    showPanel(d);
  });

  var scrollHandler = function() {
    if (scrollHideTimer) clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(function() {
      resetPanel({ force:true });
      scrollHideTimer = null;
    }, SCROLL_RESET_DELAY);
  };
  on(window, "scroll", scrollHandler, { passive:true });

  var scrollContainer = getScrollContainer();
  if (scrollContainer && scrollContainer !== window) {
    on(scrollContainer, "scroll", scrollHandler, { passive:true });
  }

  on(document, "keydown", function(e) {
    if (e.key === "Escape") resetPanel({ force:true });
  });

  // ============================================================
  // STATS BAR + CLOSE
  // ============================================================
  function stat(label, value, colorClass) {
    return '<div class="tt-stat"><span class="tt-stat-label">' + label + '</span>' +
      '<span class="tt-stat-value' + (colorClass ? " " + colorClass : "") + '">' + value + '</span></div>';
  }

  var statsBar = document.createElement("div");
  statsBar.id  = "tt-statsbar";
  statsBar.setAttribute("role", "toolbar");
  statsBar.innerHTML =
    stat("Videos",     "—", "")      + stat("Qualified",   "—", "green") +
    stat("Qual Rate",  "—", "green") + stat("Total Views", "—", "blue")  +
    stat("Avg Views",  "—", "blue")  + stat("Avg Qual",    "—", "blue")  +
    stat("Max Views",  "—", "blue")  + stat("Earnings",    "—", "peach") +
    stat("Per Qual",   "—", "peach") + stat("ROI/Video",   "—", "peach") +
    stat("Top Score",  "—",  "pink") +
    '<div class="tt-stat-close" id="tt-stat-close" role="button" tabindex="0" aria-label="Close TikTok inspect overlay">×</div>';
  document.body.appendChild(statsBar);

  on(document.getElementById("tt-stat-close"), "click", function(e) {
    e.stopPropagation();
    teardown();
  });
  on(document.getElementById("tt-stat-close"), "keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      teardown();
    }
  });

  // ============================================================
  // DATE FILTER BAR
  // ============================================================
  var dateBar  = document.createElement("div");
  dateBar.id   = "tt-datebar";
  var dateBarHTML = '<span class="tt-filter-label">Date</span>';
  filterOptions.forEach(function(f) {
    dateBarHTML += '<button type="button" class="tt-filter-btn' + (f.days === defaultPreset ? " active" : "") +
      '" data-days="' + f.days + '" aria-pressed="' + (f.days === defaultPreset ? "true" : "false") + '">' +
      f.label + "</button>";
  });
  dateBar.innerHTML = dateBarHTML;

  on(dateBar, "click", function(e) {
    var btn = e.target.closest(".tt-filter-btn");
    if (!btn || btn.disabled || btn.classList.contains("loading")) return;
    applyDateFilter(Number(btn.dataset.days));
    document.querySelectorAll(".tt-filter-btn").forEach(function(b) {
      b.setAttribute("aria-pressed", b === btn ? "true" : "false");
    });
  });
  document.body.appendChild(dateBar);

  // ============================================================
  // EARNINGS MODE BAR
  // ============================================================
  var modeBar = document.createElement("div");
  modeBar.id  = "tt-modebar";
  modeBar.innerHTML =
    '<span class="tt-mode-label">Earnings Mode</span>' +
    '<button type="button" class="tt-mode-btn clipping active" data-mode="clipping" aria-pressed="true">Clipping</button>' +
    '<button type="button" class="tt-mode-btn creator" data-mode="creator" aria-pressed="false">Creator Rewards</button>' +
    '<div class="tt-rpm-wrap" id="tt-rpm-wrap" style="display:none">' +
      '<span class="tt-rpm-label">RPM</span>' +
      '<input class="tt-rpm-slider" id="tt-rpm-slider" type="range" min="0.40" max="1.00" step="0.05" value="0.70" aria-valuemin="0.4" aria-valuemax="1" aria-valuenow="0.7" aria-label="Creator RPM per thousand views">' +
      '<span class="tt-rpm-value" id="tt-rpm-value">$0.70</span>' +
    '</div>';

  on(modeBar, "click", function(e) {
    var btn = e.target.closest(".tt-mode-btn");
    if (!btn) return;
    earningsMode = btn.dataset.mode;
    modeBar.querySelectorAll(".tt-mode-btn").forEach(function(b) {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    document.getElementById("tt-rpm-wrap").style.display = earningsMode === "creator" ? "flex" : "none";
    document.body.classList.toggle("tt-creator-mode", earningsMode === "creator");
    updateModeLabels();
    updateStatsBar(activeDayFilter);
    if (activeItem) {
      var d = dataMap.get(activeItem);
      if (d) { activeItem = null; showPanel(d); }
    }
  });

  var rpmSlider = modeBar.querySelector("#tt-rpm-slider");
  var rpmValue  = modeBar.querySelector("#tt-rpm-value");
  on(rpmSlider, "input", function() {
    creatorRPM = parseFloat(rpmSlider.value);
    rpmSlider.setAttribute("aria-valuenow", String(creatorRPM));
    rpmValue.textContent = "$" + creatorRPM.toFixed(2);
    updateStatsBar(activeDayFilter);
    if (activeItem) {
      var d = dataMap.get(activeItem);
      if (d) { activeItem = null; showPanel(d); }
    }
  });

  document.body.appendChild(modeBar);

  // ============================================================
  // TOOLBAR (dim, load window)
  // ============================================================
  var toolBar = document.createElement("div");
  toolBar.id = "tt-toolbar";
  toolBar.innerHTML =
    '<button type="button" class="tt-tool-btn" id="tt-btn-dim" aria-pressed="' + (START_DIMMED ? "true" : "false") + '">Dim rest</button>' +
    '<button type="button" class="tt-tool-btn" id="tt-btn-load" aria-label="Scroll feed to load roughly ' + SEEK_BACK_DAYS + ' days of posts">Load ' + SEEK_BACK_DAYS + 'd</button>' +
    '<span class="tt-tool-hint" id="tt-toolbar-hint">Long-press a tile for details on touch. Esc closes the card panel.</span>';
  document.body.appendChild(toolBar);

  var dimBtn = document.getElementById("tt-btn-dim");
  if (START_DIMMED) dimBtn.classList.add("on");
  on(dimBtn, "click", function() {
    document.body.classList.toggle("tt-dim-mode");
    var dim = document.body.classList.contains("tt-dim-mode");
    dimBtn.classList.toggle("on", dim);
    dimBtn.setAttribute("aria-pressed", dim ? "true" : "false");
  });

  on(document.getElementById("tt-btn-load"), "click", async function() {
    if (filterBusy) return;
    filterBusy = true;
    setDateFilterBusy(true);
    await autoScroll(SEEK_BACK_DAYS);
    processItems();
    filterBusy = false;
    setDateFilterBusy(false);
    applyVisualFilter(activeDayFilter);
  });

  // ============================================================
  // POSITION FIXED BARS
  // ============================================================
  function positionBars() {
    [statsBar, dateBar, modeBar, toolBar, loader].forEach(positionFixed);
  }

  var rafScheduled = false;
  function schedulePositionBars() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(function() {
      rafScheduled = false;
      positionBars();
    });
  }

  var resizeTimer = null;
  on(window, "resize", function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(schedulePositionBars, 120);
  });
  schedulePositionBars();

  // ============================================================
  // ENTRY
  // ============================================================
  (async function() {
    if (AUTO_SCROLL_ON_START && ENABLE_AUTO_SCROLL) {
      await autoScroll(SEEK_BACK_DAYS);
    }

    processItems();
    applyVisualFilter(defaultPreset);

    var s = calcStats(0);
    console.log("════════════════════════════════════");
    console.log("        TikTok profile inspect        ");
    console.log("════════════════════════════════════");
    console.log("Total Videos       :", s.tc);
    console.log("Qualified Videos   :", s.qc);
    console.log("Qualification Rate :", fmtPct(s.qrate));
    console.log("Total Views        :", fmtK(s.tv));
    console.log("Max Views          :", fmtK(s.mx));
    console.log("Earnings (model)   :", fmtMoney(s.earn), "(not actual payouts)");
    console.log("════════════════════════════════════");
  })();

})();
