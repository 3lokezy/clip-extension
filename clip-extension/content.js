(() => {
  var ttInspectTeardownOnce = false;

  // ============================================================
  // DUPLICATE RUN GUARD
  // ============================================================
  if (window.__ttMasterTeardown) {
    try { window.__ttMasterTeardown(); } catch (e) {}
  }

  // ============================================================
  // PLATFORMS — detect before registering teardown (unsupported URL → exit)
  // ============================================================
  function parseYoutubeRelativeDate(str) {
    if (!str) return null;
    var m = str.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    var u = m[2].toLowerCase();
    var mult = {
      second: 1000,
      minute: 60000,
      hour: 3600000,
      day: 86400000,
      week: 604800000,
      month: 2592000000,
      year: 31536000000
    };
    var ms = mult[u];
    if (!ms) return null;
    return new Date(Date.now() - n * ms);
  }

  /** Relative + optional absolute; used for ytInitialData publishedTimeText strings */
  function parseYoutubeFlexibleDate(str) {
    if (!str || typeof str !== "string") return null;
    str = str.trim();
    if (/^today$/i.test(str)) return new Date();
    if (/^yesterday$/i.test(str)) return new Date(Date.now() - 86400000);
    var rel = parseYoutubeRelativeDate(str);
    if (rel) return rel;
    str = str.replace(/^(streamed|premiered|posted)\s+/i, "").trim();
    rel = parseYoutubeRelativeDate(str);
    if (rel) return rel;
    var ms = Date.parse(str);
    if (!isNaN(ms)) return new Date(ms);
    return null;
  }

  /** Instagram may use /user/reel/id or short /reel/id; older code required /user/reel/ only. */
  function instagramReelHrefOk(href) {
    if (!href || href.indexOf("/reel/") === -1) return false;
    try {
      return /\/reel\/[^/?#]+/i.test(new URL(href, window.location.href).pathname);
    } catch (e) {
      return /\/reel\/[^/?#]+/i.test(href.split("?")[0]);
    }
  }

  function instagramProfileAllowsReelHref(profileUser, href) {
    if (!profileUser) return true;
    var path;
    try {
      path = new URL(href, window.location.href).pathname;
    } catch (e2) {
      return false;
    }
    if (path.indexOf("/" + profileUser + "/reel/") !== -1) return true;
    return /^\/reel\/[^/?#]+/i.test(path);
  }

  var PLATFORMS = {
    tiktok: {
      id: "tiktok",
      match: function(loc) {
        var h = loc.hostname.toLowerCase();
        if (!(h === "tiktok.com" || h.endsWith(".tiktok.com"))) return false;
        var p = loc.pathname || "";
        if (/^\/@[^\/?#]+\/?$/i.test(p)) return true;
        if (/^\/@[^\/?#]+\/(video|photo)\/\d+/i.test(p)) return true;
        return false;
      },
      getListRoot: function() {
        var el = document.querySelector('#user-post-item-list, [data-e2e="user-post-item-list"]');
        return el || document.body;
      },
      getGridItems: function(listRoot) {
        return listRoot.querySelectorAll('[id^="grid-item-container"]');
      },
      closestGridItem: function(el) {
        return el.closest('[id^="grid-item-container"]');
      },
      extractMetrics: function(item, ctx) {
        var viewEl = item.querySelector('[data-e2e="video-views"]');
        if (!viewEl) return null;
        var snap = viewEl.textContent || "";
        var a = item.querySelector("a[href*='/video/']");
        var vid = a ? a.href.match(/\/video\/(\d+)/) : null;
        var postDate = vid ? ctx.dateFromVideoId(vid[1]) : null;
        var views = ctx.parseViews(snap);
        return { viewSnap: snap, views: views, postDate: postDate };
      },
      plainLabel: function(off) {
        return off ? "Show styling" : "Plain TikTok";
      },
      disclaimer: "Figures are rough estimates from this page, not TikTok payouts."
    },
    youtube: {
      id: "youtube",
      match: function(loc) {
        var h = loc.hostname.toLowerCase();
        if (h !== "youtube.com" && h !== "www.youtube.com" && h !== "m.youtube.com") return false;
        var p = loc.pathname;
        return (
          /\/@[^/]+\/shorts\/?/i.test(p) ||
          /\/channel\/[^/]+\/shorts\/?/i.test(p) ||
          /\/c\/[^/]+\/shorts\/?/i.test(p) ||
          /\/user\/[^/]+\/shorts\/?/i.test(p)
        );
      },
      getListRoot: function() {
        var el = document.querySelector("ytd-browse ytd-rich-grid-renderer, ytd-rich-grid-renderer");
        return el || document.body;
      },
      getGridItems: function(listRoot) {
        var nodes = listRoot.querySelectorAll("ytd-rich-item-renderer");
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].querySelector('a[href*="/shorts/"]')) out.push(nodes[i]);
        }
        return out;
      },
      closestGridItem: function(el) {
        var node = el.closest("ytd-rich-item-renderer");
        if (!node || !node.querySelector('a[href*="/shorts/"]')) return null;
        return node;
      },
      extractMetrics: function(item, ctx) {
        var text = "";
        var meta = item.querySelector("#metadata-line, ytd-video-meta-block #metadata-line");
        if (meta) {
          text = (meta.innerText || meta.textContent || "").trim();
        }
        if (!text) {
          var sub = item.querySelector(
            ".shortsLockupViewModelHostOutsideMetadataSubhead, " +
            "ytm-shorts-lockup-view-model .shortsLockupViewModelHostOutsideMetadataSubhead"
          );
          if (sub) {
            text = (sub.innerText || sub.textContent || "").trim();
          }
        }
        if (!text) {
          var link = item.querySelector('a[href*="/shorts/"][aria-label]');
          if (link) {
            text = (link.getAttribute("aria-label") || "").trim();
          }
        }
        var blob = (item.innerText || item.textContent || "").trim();
        var viewMatch = text.match(/([\d.,]+\s*[KMBkmb]?)\s*views?/i);
        if (!viewMatch) {
          viewMatch = blob.match(/([\d.,]+\s*[KMBkmb]?)\s*views?/i);
        }
        if (!viewMatch) return null;
        var snap = (text || viewMatch[0]).trim();
        var numPart = viewMatch[1].replace(/\s/g, "").replace(/,/g, "");
        var views = ctx.parseViews(numPart);
        var shortLink = item.querySelector('a[href*="/shorts/"]');
        var href = shortLink ? shortLink.href || shortLink.getAttribute("href") || "" : "";
        var vm = href.match(/\/shorts\/([^/?#]+)/);
        var videoId = vm ? vm[1] : null;
        var postDate = null;
        if (videoId && ctx.youtubeVideoDateMap) {
          postDate = ctx.youtubeVideoDateMap[videoId] || null;
        }
        if (!postDate) {
          postDate =
            ctx.parseYoutubeFlexibleDate(blob) ||
            ctx.parseYoutubeFlexibleDate(text) ||
            ctx.parseYoutubeFlexibleDate(snap);
        }
        return { viewSnap: snap, views: views, postDate: postDate };
      },
      plainLabel: function(off) {
        return off ? "Show styling" : "Plain view";
      },
      disclaimer: "Figures are rough estimates from this page, not YouTube payouts."
    },
    instagram: {
      id: "instagram",
      match: function(loc) {
        var h = loc.hostname.toLowerCase();
        if (h !== "instagram.com" && h !== "www.instagram.com") return false;
        var parts = loc.pathname.split("/").filter(function(x) {
          return x;
        });
        return parts.length >= 2 && /^reels?$/i.test(parts[1]);
      },
      getListRoot: function() {
        return document.querySelector("main") || document.body;
      },
      getGridItems: function(listRoot) {
        var loc = window.location;
        var pathParts = loc.pathname.split("/").filter(function(x) {
          return x;
        });
        var profileUser =
          pathParts.length >= 2 && /^reels?$/i.test(pathParts[1]) ? pathParts[0] : null;
        var nodes = listRoot.querySelectorAll('a[href*="/reel/"]');
        var out = [];
        var seen = Object.create(null);
        for (var i = 0; i < nodes.length; i++) {
          var a = nodes[i];
          var href = a.getAttribute("href") || "";
          if (!instagramReelHrefOk(href)) continue;
          if (!instagramProfileAllowsReelHref(profileUser, href)) continue;
          if (seen[href]) continue;
          seen[href] = 1;
          out.push(a);
        }
        return out;
      },
      closestGridItem: function(el) {
        var a = el.closest('a[href*="/reel/"]');
        if (!a || !instagramReelHrefOk(a.getAttribute("href") || "")) return null;
        return a;
      },
      extractMetrics: function(item, ctx) {
        function fromSnap(snap) {
          var t = (snap || "").trim();
          if (!t) return null;
          var views = ctx.parseViews(t);
          return { viewSnap: t + " plays", views: views, postDate: null };
        }
        var vSvg =
          item.querySelector('svg[aria-label="View Count Icon"]') ||
          item.querySelector('svg[aria-label*="View"]') ||
          item.querySelector('svg[aria-label*="view"]');
        if (vSvg) {
          var tray =
            vSvg.closest("div._aaj_") ||
            vSvg.closest('div[class*="_aaj_"]') ||
            vSvg.closest("div[role]") ||
            vSvg.parentElement;
          var numSpan = tray && tray.querySelector("span.html-span");
          if (!numSpan && tray) {
            numSpan = tray.querySelector("span");
          }
          if (!numSpan) {
            var walk = vSvg.parentElement;
            for (var d = 0; d < 10 && walk && walk !== item; d++) {
              if (walk.tagName === "UL") {
                walk = walk.parentElement;
                continue;
              }
              var cand =
                walk.querySelector("span.html-span") ||
                walk.querySelector("span[class*='x']");
              if (cand && cand.textContent && /[\d.,]/.test(cand.textContent)) {
                numSpan = cand;
                break;
              }
              walk = walk.parentElement;
            }
          }
          if (numSpan) {
            var s0 = numSpan.textContent.trim();
            if (s0) return fromSnap(s0);
          }
        }
        var aria = item.getAttribute("aria-label") || "";
        var am = aria.match(/([\d,.]+\s*[KMBkmb]?)\s*(views|plays|view)/i);
        if (am) {
          var fs = fromSnap(am[1].trim());
          if (fs) return fs;
        }
        var spans = item.querySelectorAll("span");
        var si;
        for (si = 0; si < spans.length; si++) {
          var raw = spans[si].textContent.replace(/\s+/g, " ").trim();
          if (/^[\d,.]+\s*[KMBkmb]?$/.test(raw) && raw.length < 14) {
            var fs2 = fromSnap(raw);
            if (fs2 && fs2.views >= 0) return fs2;
          }
        }
        return null;
      },
      plainLabel: function(off) {
        return off ? "Show styling" : "Plain view";
      },
      disclaimer: "Figures are rough estimates from this page, not Instagram payouts."
    }
  };

  function detectPlatform() {
    var loc = window.location;
    var order = ["tiktok", "youtube", "instagram"];
    for (var oi = 0; oi < order.length; oi++) {
      var p = PLATFORMS[order[oi]];
      if (p.match(loc)) return p;
    }
    return null;
  }

  var selectedPlatform = detectPlatform();
  if (!selectedPlatform) {
    return;
  }

  const disposers = [];

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    disposers.push(function() { target.removeEventListener(type, fn, opts); });
  }

  function teardown() {
    if (window.__ttMasterRunning) ttInspectTeardownOnce = true;
    window.__ttMasterRunning = false;
    window.__ttMasterTeardown = null;
    disposers.splice(0).forEach(function(d) { try { d(); } catch (e) {} });
    ["tt-panel", "tt-dock", "tt-scroll-banner"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    var old = document.getElementById("tt-master-style");
    if (old) old.remove();
    document.body.classList.remove(
      "tt-dim-mode",
      "tt-focus-active",
      "tt-creator-mode",
      "tt-style-off",
      "tt-platform-instagram"
    );
  }

  window.__ttMasterTeardown = teardown;
  window.__ttMasterRunning = true;

  (function installSpaRouteGuard() {
    var origPush = history.pushState;
    var origReplace = history.replaceState;
    function onMaybeNav() {
      setTimeout(function() {
        var p = detectPlatform();
        if (window.__ttMasterRunning && !p) teardown();
        else if (!window.__ttMasterRunning && p && ttInspectTeardownOnce) location.reload();
      }, 0);
    }
    history.pushState = function(state, title, url) {
      var r = origPush.call(history, state, title, url);
      onMaybeNav();
      return r;
    };
    history.replaceState = function(state, title, url) {
      var r = origReplace.call(history, state, title, url);
      onMaybeNav();
      return r;
    };
    on(window, "popstate", onMaybeNav);
    disposers.push(function() {
      history.pushState = origPush;
      history.replaceState = origReplace;
    });
  })();

  // ============================================================
  // CONFIG (defaults — overridden from chrome.storage.sync via popup)
  // ============================================================
  var TOP_BAND_MULT = 3;

  var STORAGE_DEFAULTS = {
    minViews: 75000,
    ratePerMin: 50,
    acceptanceRate: 0.87,
    seekBackDays: 30,
    scrollStep: 1200,
    scrollDelay: 800,
    maxIdleRounds: 4,
    scrollResetDelay: 400,
    startDimmed: false
  };

  var minViews;
  var ratePerMin;
  var acceptanceRate;
  var seekBackDays;
  var scrollStep;
  var scrollDelay;
  var maxIdleRounds;
  var scrollResetDelay;
  var startDimmed;

  var defaultPreset;

  var filterOptions = [
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

  function applySettings(s) {
    var d = STORAGE_DEFAULTS;
    minViews = s.minViews != null ? Number(s.minViews) : d.minViews;
    ratePerMin = s.ratePerMin != null ? Number(s.ratePerMin) : d.ratePerMin;
    acceptanceRate = s.acceptanceRate != null ? Number(s.acceptanceRate) : d.acceptanceRate;
    seekBackDays = s.seekBackDays != null ? Number(s.seekBackDays) : d.seekBackDays;
    scrollStep = s.scrollStep != null ? Number(s.scrollStep) : d.scrollStep;
    scrollDelay = s.scrollDelay != null ? Number(s.scrollDelay) : d.scrollDelay;
    maxIdleRounds = s.maxIdleRounds != null ? Number(s.maxIdleRounds) : d.maxIdleRounds;
    scrollResetDelay = s.scrollResetDelay != null ? Number(s.scrollResetDelay) : d.scrollResetDelay;
    startDimmed = s.startDimmed != null ? !!s.startDimmed : d.startDimmed;
    defaultPreset = closestPreset(seekBackDays);
  }

  function initInspectMain(platform) {
  if (platform.id === "instagram") {
    document.body.classList.add("tt-platform-instagram");
  }

  var youtubeVideoDateMap = {};
  var ytDateMapVersion = 0;

  var gridObserver = null;
  var gridObserved = null;
  var gridObsPauseDepth = 0;

  function pauseGridObs() {
    if (!gridObserver) return;
    if (gridObsPauseDepth === 0) {
      try { gridObserver.disconnect(); } catch (e) {}
    }
    gridObsPauseDepth++;
  }

  function resumeGridObs() {
    gridObsPauseDepth--;
    if (gridObsPauseDepth < 0) gridObsPauseDepth = 0;
    if (gridObsPauseDepth === 0 && gridObserved && gridObserver) {
      try {
        gridObserver.observe(gridObserved, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch (e2) {}
    }
  }

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

  function metricsCtx() {
    return {
      dateFromVideoId: dateFromVideoId,
      parseViews: parseViews,
      parseYoutubeRelativeDate: parseYoutubeRelativeDate,
      parseYoutubeFlexibleDate: parseYoutubeFlexibleDate,
      youtubeVideoDateMap: youtubeVideoDateMap
    };
  }

  function videoDateFromItem(item) {
    var ver = platform.id === "youtube" ? ytDateMapVersion : 0;
    if (item._ttPostDateDone && item._ttYtMapV === ver) return item._ttPostDateVal;
    var ex = platform.extractMetrics(item, metricsCtx());
    var d = ex ? ex.postDate : null;
    item._ttPostDateDone = true;
    item._ttPostDateVal = d;
    item._ttYtMapV = ver;
    return d;
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
    "  position: relative;",
    "  border-radius: 12px;",
    "  overflow: visible;",
    "  isolation: isolate;",
    "  contain: style;",
    "  transition: opacity 160ms ease, filter 160ms ease, transform 260ms cubic-bezier(0.34,1.56,0.64,1);",
    "  transform-origin: center;",
    "}",
    ".tt-dim-mode .tt-item { opacity:0.12; filter:blur(0.4px) saturate(0.7); transform:scale(0.98); }",
    ".tt-dim-mode .tt-item.tt-qualified,",
    ".tt-dim-mode .tt-item.tt-top { opacity:1; filter:none; transform:scale(1); }",
    ".tt-dim-mode .tt-item.tt-date-hidden:not(.tt-out-of-range) { opacity:0.04 !important; filter:blur(2px) saturate(0) !important; }",
    ".tt-dim-mode .tt-item.tt-out-of-range { opacity:0.52 !important; filter:blur(1px) saturate(0.55) brightness(0.92) !important; outline:2px dashed rgba(255,85,105,0.98) !important; outline-offset:-2px; border-radius:12px; }",
    ".tt-creator-mode .tt-item:not(.tt-date-hidden) { opacity:1 !important; filter:none !important; transform:scale(1) !important; }",
    ".tt-creator-mode.tt-focus-active .tt-item:not(.tt-active):not(.tt-date-hidden) { opacity:0.35 !important; filter:blur(1px) saturate(0.5) !important; }",
    ".tt-dim-mode.tt-focus-active .tt-item.tt-qualified:not(.tt-active),",
    ".tt-dim-mode.tt-focus-active .tt-item.tt-top:not(.tt-active) { opacity:0.3; filter:blur(1.2px) saturate(0.4); }",
    ".tt-dim-mode.tt-focus-active .tt-item:not(.tt-active):not(.tt-qualified):not(.tt-top):not(.tt-out-of-range) { opacity:0.07; filter:blur(1.5px) saturate(0.4); }",
    ".tt-dim-mode.tt-focus-active .tt-item.tt-out-of-range:not(.tt-active) { opacity:0.42 !important; filter:blur(1.5px) saturate(0.45) brightness(0.88) !important; }",
    ".tt-item.tt-active { opacity:1 !important; transform:scale(1.05) !important; filter:none !important; z-index:10; }",
    ".tt-item.tt-qualified:not(.tt-top)::before {",
    "  content:''; position:absolute; inset:-2px; z-index:2; border-radius:inherit;",
    "  padding:2px; pointer-events:none; background:#39FF14;",
    "  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);",
    "  mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);",
    "  -webkit-mask-composite:xor; mask-composite:exclude;",
    "}",
    "body.tt-creator-mode .tt-item.tt-qualified:not(.tt-top)::before { display:none !important; }",
    ".tt-item.tt-top { outline:none; z-index:1; position:relative; box-shadow:none; }",
    ".tt-item.tt-top::before {",
    "  content:''; position:absolute; inset:-2px; z-index:2; border-radius:inherit;",
    "  padding:2px; pointer-events:none;",
    "  background:linear-gradient(135deg,#85F6FE,#84FFA8,#FFB054,#FFA3DE,#84A9FF);",
    "  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);",
    "  mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);",
    "  -webkit-mask-composite:xor; mask-composite:exclude;",
    "}",
    ".tt-item.tt-range-edge {",
    "  box-shadow:",
    "    inset 5px 0 0 0 rgba(255,190,84,0.98),",
    "    0 0 0 1px rgba(255,190,84,0.35); }",
    ".tt-item.tt-range-edge.tt-top {",
    "  box-shadow:",
    "    inset 5px 0 0 0 rgba(255,190,84,0.98),",
    "    0 0 0 1px rgba(255,190,84,0.35); }",
    ".tt-item.tt-out-of-range { outline:2px dashed rgba(255,75,100,0.98) !important; outline-offset:-2px; border-radius:12px; }",
    ".tt-item.tt-out-of-range::after {",
    "  content:''; position:absolute; inset:0; z-index:4; pointer-events:none; border-radius:inherit;",
    "  background:",
    "    repeating-linear-gradient(-45deg, rgba(180,30,55,0.14), rgba(180,30,55,0.14) 6px, rgba(120,15,40,0.22) 6px, rgba(120,15,40,0.22) 12px),",
    "    linear-gradient(180deg, rgba(255,70,95,0.28), rgba(90,15,35,0.45));",
    "  mix-blend-mode:normal;",
    "}",

    "body.tt-platform-instagram:not(.tt-style-off) .tt-item {",
    "  contain: none;",
    "  display: inline-block;",
    "  width: 100%;",
    "  max-width: 100%;",
    "  box-sizing: border-box;",
    "  vertical-align: top;",
    "  box-shadow: none;",
    "  border-radius: 0;",
    "  transform: scale(0.98);",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified,",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-top {",
    "  transform: scale(1);",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-ig-cell {",
    "  position: relative;",
    "  isolation: isolate;",
    "  border-radius: 0;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item:not(.tt-out-of-range)::after {",
    "  content: '';",
    "  position: absolute;",
    "  inset: 0;",
    "  border-radius: 0;",
    "  pointer-events: none;",
    "  z-index: 20;",
    "  box-sizing: border-box;",
    "  border: none;",
    "  box-shadow: inset 0 0 0 6px #141414;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-top::before {",
    "  content:''; position:absolute; inset:-2px; z-index:22; border-radius:0;",
    "  padding:2px; pointer-events:none;",
    "  background:linear-gradient(135deg,#85F6FE,#84FFA8,#FFB054,#FFA3DE,#84A9FF);",
    "  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);",
    "  mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);",
    "  -webkit-mask-composite:xor; mask-composite:exclude;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-top:not(.tt-out-of-range)::after {",
    "  z-index: 20;",
    "  box-shadow: inset 0 0 0 6px #141414;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified:not(.tt-top):not(.tt-out-of-range)::after {",
    "  z-index: 22;",
    "  border: none;",
    "  border-radius: 0;",
    "  box-shadow:",
    "    inset 0 0 0 5px #141414,",
    "    inset 0 0 0 7px #39FF14,",
    "    inset 0 0 0 10px #141414;",
    "}",
    "body.tt-creator-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified:not(.tt-top):not(.tt-out-of-range)::after {",
    "  z-index: 22;",
    "  border: none;",
    "  border-radius: 0;",
    "  box-shadow: inset 0 0 0 6px #141414;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified:not(.tt-top) {",
    "  z-index: 2;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified:not(.tt-top)::before {",
    "  display: none !important;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-top {",
    "  z-index: 3;",
    "  box-shadow: none;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-active {",
    "  z-index: 14;",
    "  transform: scale(1) !important;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-out-of-range {",
    "  outline: none !important;",
    "  box-shadow: inset 0 0 0 2px rgba(255,75,100,0.98);",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-out-of-range::after {",
    "  inset: 3px; border-radius: 0;",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-range-edge:not(.tt-top):not(.tt-out-of-range)::after {",
    "  border: none;",
    "  box-shadow:",
    "    inset 4px 0 0 0 rgba(255,190,84,0.98),",
    "    inset 0 0 0 1px rgba(255,190,84,0.35);",
    "}",
    "body.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-range-edge.tt-top {",
    "  box-shadow:",
    "    inset 4px 0 0 0 rgba(255,190,84,0.98),",
    "    inset 0 0 0 1px rgba(255,190,84,0.35);",
    "}",

    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-date-hidden:not(.tt-out-of-range) {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-out-of-range {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-dim-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-creator-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item:not(.tt-active):not(.tt-date-hidden) {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item > * {",
    "  opacity: 0.12;",
    "  filter: blur(0.4px) saturate(0.7);",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified > *,",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-top > * {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-date-hidden:not(.tt-out-of-range) > * {",
    "  opacity: 0.04 !important;",
    "  filter: blur(2px) saturate(0) !important;",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-out-of-range > * {",
    "  opacity: 0.52 !important;",
    "  filter: blur(1px) saturate(0.55) brightness(0.92) !important;",
    "}",
    "body.tt-dim-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item:not(.tt-active):not(.tt-qualified):not(.tt-top):not(.tt-out-of-range) > * {",
    "  opacity: 0.07 !important;",
    "  filter: blur(1.5px) saturate(0.4) !important;",
    "}",
    "body.tt-dim-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-qualified:not(.tt-active) > *,",
    "body.tt-dim-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-top:not(.tt-active) > * {",
    "  opacity: 0.3 !important;",
    "  filter: blur(1.2px) saturate(0.4) !important;",
    "}",
    "body.tt-dim-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-out-of-range:not(.tt-active) > * {",
    "  opacity: 0.42 !important;",
    "  filter: blur(1.5px) saturate(0.45) brightness(0.88) !important;",
    "}",
    "body.tt-creator-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item:not(.tt-active):not(.tt-date-hidden) > * {",
    "  opacity: 0.35 !important;",
    "  filter: blur(1px) saturate(0.5) !important;",
    "}",
    "body.tt-creator-mode.tt-focus-active.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-active > * {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    "body.tt-dim-mode.tt-platform-instagram:not(.tt-style-off) .tt-item.tt-active > * {",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",

    "body.tt-style-off .tt-ig-cell { box-shadow: none !important; }",
    "body.tt-style-off .tt-item,",
    "body.tt-style-off.tt-dim-mode .tt-item,",
    "body.tt-style-off.tt-creator-mode .tt-item {",
    "  opacity:1 !important; filter:none !important; transform:none !important;",
    "  outline:none !important; box-shadow:none !important;",
    "}",
    "body.tt-style-off .tt-item::before, body.tt-style-off .tt-item::after { display:none !important; content:none !important; }",
    "body.tt-style-off .tt-item.tt-active { transform:none !important; z-index:auto !important; }",
    "body.tt-style-off.tt-focus-active .tt-item { opacity:1 !important; filter:none !important; }",

    "#tt-scroll-banner { position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:999995; max-width:min(480px,calc(100vw - 20px));",
    "  box-sizing:border-box; padding:12px 14px; border-radius:10px;",
    "  font-family:ui-monospace, Menlo, Monaco, monospace; font-size:12px; line-height:1.45; color:rgba(255,255,255,0.94);",
    "  background:rgba(12,10,18,0.94); border:1px solid rgba(133,246,254,0.35); box-shadow:0 8px 32px rgba(0,0,0,0.45); pointer-events:auto; }",
    "#tt-scroll-banner .tt-scroll-banner-inner { display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; justify-content:space-between; }",
    "#tt-scroll-banner .tt-scroll-banner-text { flex:1 1 200px; min-width:0; }",
    "#tt-scroll-banner #tt-scroll-cancel {",
    "  flex-shrink:0; padding:6px 14px; border-radius:6px; cursor:pointer; font:inherit; font-size:11px; font-weight:bold;",
    "  border:1px solid rgba(255,120,130,0.55); background:rgba(255,75,100,0.12); color:#ffb8c0;",
    "}",
    "#tt-scroll-banner #tt-scroll-cancel:hover { background:rgba(255,75,100,0.22); color:#fff; }",

    "#tt-dock { position:fixed; bottom:0; z-index:999990; display:flex; flex-direction:column; align-items:stretch;",
    "  gap:0; padding:0; min-height:0; box-sizing:border-box;",
    "  font-family:ui-monospace, Menlo, Monaco, monospace; font-size:12px; color:rgba(255,255,255,0.92);",
    "  background:rgba(8,8,10,0.88); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);",
    "  border-top:1px solid rgba(255,255,255,0.08); pointer-events:auto; }",
    "#tt-dock .tt-dock-row { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:3px 8px 4px; min-height:0; }",
    "#tt-dock .tt-dock-campaign { display:block; padding:5px 10px; font-size:11px; line-height:1.35; color:rgba(180,255,210,0.92);",
    "  border-top:1px solid rgba(255,255,255,0.07); background:rgba(12,32,22,0.55); }",
    "#tt-dock .tt-dock-campaign[hidden] { display:none !important; }",
    "#tt-dock .tt-dock-hint { display:block; padding:5px 10px 6px; font-size:11px; line-height:1.35; color:rgba(255,200,120,0.95);",
    "  border-top:1px solid rgba(255,255,255,0.07); background:rgba(40,28,8,0.45); }",
    "#tt-dock .tt-dock-hint[hidden] { display:none !important; }",
    "#tt-dock .tt-dock-interrupt { display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; padding:5px 10px 6px;",
    "  border-top:1px solid rgba(255,120,130,0.35); background:rgba(48,12,18,0.55); font-size:10px; line-height:1.35; color:rgba(255,200,205,0.95); }",
    "#tt-dock .tt-dock-interrupt[hidden] { display:none !important; }",
    "#tt-dock #tt-dock-resume-scroll {",
    "  flex-shrink:0; padding:5px 10px; border-radius:6px; cursor:pointer; font:inherit; font-size:10px; font-weight:bold;",
    "  border:1px solid rgba(133,246,254,0.45); background:rgba(133,246,254,0.12); color:#85F6FE;",
    "}",
    "#tt-dock #tt-dock-resume-scroll:hover { background:rgba(133,246,254,0.2); }",
    "#tt-dock #tt-dock-range-wrap[hidden] { display:none !important; }",
    "#tt-dock .tt-dock-left { display:flex; align-items:center; flex-wrap:nowrap; gap:6px 10px; min-width:0; flex:1; overflow:hidden; }",
    "#tt-dock .tt-dock-label { font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:rgba(255,255,255,0.36); }",
    "#tt-dock .tt-dock-val { font-weight:bold; font-size:10px; color:#85F6FE; white-space:nowrap; }",
    "#tt-dock .tt-dock-earn { font-weight:bold; font-size:10px; color:#FFB054; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; max-width:min(42vw,220px); }",
    "#tt-dock #tt-dock-body { display:flex; flex-direction:column; align-items:stretch; }",
    "#tt-dock .tt-dock-actions { display:flex; align-items:center; gap:4px; margin-left:auto; flex-shrink:0; }",
    "#tt-dock .tt-dock-chip { display:inline-flex; align-items:center; justify-content:center; gap:4px; flex-shrink:0;",
    "  padding:2px 7px; min-height:22px; border-radius:999px; cursor:pointer; font:inherit; font-weight:700; font-size:9px;",
    "  letter-spacing:0.02em; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.88);",
    "  line-height:1; }",
    "#tt-dock .tt-dock-chip:hover { background:rgba(255,255,255,0.1); color:#fff; }",
    "#tt-dock .tt-dock-chip .tt-dock-plain-glyph { font-size:10px; line-height:1; opacity:0.92; }",
    "#tt-dock #tt-dock-plain { border-color:rgba(255,200,120,0.28); color:rgba(255,230,200,0.95); background:rgba(255,160,80,0.07); }",
    "#tt-dock #tt-dock-plain:hover { background:rgba(255,160,80,0.12); }",
    "#tt-dock #tt-dock-plain.on { border-color:rgba(133,246,254,0.45); color:#85F6FE; background:rgba(133,246,254,0.1); }",

    "#tt-panel { position:fixed; z-index:999998; pointer-events:none; display:none;",
    "  background:rgba(0,0,0,0.75); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);",
    "  border:1px solid rgba(255,255,255,0.08); border-radius:10px;",
    "  font-family:monospace; overflow:hidden; min-width:230px; max-width:250px; }",
    "#tt-panel .tt-panel-disclaimer { padding:6px 14px 8px; font-size:9px; line-height:1.35; color:rgba(255,255,255,0.38);",
    "  border-top:1px solid rgba(255,255,255,0.06); }",
    "#tt-panel .tt-panel-disclaimer.tt-panel-campaign { color:rgba(180,255,210,0.55); }",
    "#tt-panel .tt-panel-header { padding:9px 14px 8px; font-size:10px; letter-spacing:0.1em;",
    "  text-transform:uppercase; color:rgba(255,255,255,0.4); border-bottom:1px solid rgba(255,255,255,0.07);",
    "  display:flex; justify-content:space-between; align-items:center; }",
    "#tt-panel .tt-panel-badge { font-size:10px; padding:2px 7px; border-radius:20px; font-weight:bold; letter-spacing:0.04em; }",
    "#tt-panel .tt-panel-badge.qualified { background:rgba(57,255,20,0.15); color:#39FF14; border:1px solid rgba(57,255,20,0.3); }",
    "#tt-panel .tt-panel-badge.top       { background:rgba(133,246,254,0.1); color:#85F6FE; border:1px solid rgba(133,246,254,0.3); }",
    "#tt-panel .tt-panel-badge.not-qualified { background:rgba(255,75,100,0.14); color:#ff9aa8; border:1px solid rgba(255,90,110,0.5); }",
    "#tt-panel .tt-panel-badge-empty { display:inline-block; min-width:86px; min-height:22px; vertical-align:middle; }",
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
    "#tt-panel .tt-panel-bar-fill { height:100%; background:linear-gradient(90deg,#85F6FE,#84FFA8,#FFB054,#FFA3DE,#84A9FF); border-radius:4px; transition:width 260ms ease; }"
  ].join("\n");

  document.head.appendChild(styleEl);
  if (startDimmed) document.body.classList.add("tt-dim-mode");

  // ============================================================
  // SHARED STATE
  // ============================================================
  var earningsMode    = "clipping";
  var creatorRPM      = 0.70;
  var activeDayFilter = defaultPreset;
  var loadedDays      = 0;
  var loadedToEnd     = false;
  var filterBusy      = false;
  var scrollLoadInterrupted = false;
  var scrollAbortRequested = false;
  var scrollBannerEl = null;
  var dockInterruptRowEl = null;
  var dockResumeScrollBtn = null;
  var panelPinned     = false;

  const enriched     = [];
  const processedSet = new Set();
  var   dataMap      = new Map();

  function getListRoot() {
    return platform.getListRoot();
  }

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

  function updateDateButtonPartialState() {}

  function setDateFilterBusy(busy) {}

  // ============================================================
  // EARNINGS
  // ============================================================
  function calcItemEarnings(views, isQualified) {
    if (earningsMode === "creator") return (views / 1000) * creatorRPM;
    return isQualified ? (views / minViews) * ratePerMin * acceptanceRate : 0;
  }

  // ============================================================
  // SCROLL HELPERS
  // ============================================================
  function getGridItems() {
    return platform.getGridItems(getListRoot());
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

  function getScrollContainer() {
    var el = getListRoot();
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return null;
  }

  function hideScrollBanner() {
    if (scrollBannerEl && scrollBannerEl.parentNode) {
      try {
        scrollBannerEl.parentNode.removeChild(scrollBannerEl);
      } catch (eRem) {}
    }
    scrollBannerEl = null;
  }

  function showScrollBanner(targetDays) {
    if (platform.id !== "tiktok") return;
    hideScrollBanner();
    scrollBannerEl = document.createElement("div");
    scrollBannerEl.id = "tt-scroll-banner";
    scrollBannerEl.setAttribute("role", "status");
    scrollBannerEl.setAttribute("aria-live", "polite");
    var msg =
      targetDays > 0
        ? "Auto-scrolling to load older posts (past " +
          targetDays +
          " days). Cancel anytime — earnings and stats only reflect what has loaded."
        : "Auto-scrolling to load older posts for dates and stats. Cancel anytime — earnings only reflect what has loaded.";
    scrollBannerEl.innerHTML =
      '<div class="tt-scroll-banner-inner">' +
      '<div class="tt-scroll-banner-text">' +
      msg +
      "</div>" +
      '<button type="button" id="tt-scroll-cancel">Cancel</button>' +
      "</div>";
    scrollBannerEl.querySelector("#tt-scroll-cancel").addEventListener("click", function() {
      scrollAbortRequested = true;
    });
    document.body.appendChild(scrollBannerEl);
  }

  async function resumeFullRangeScroll() {
    if (filterBusy || platform.id !== "tiktok") return;
    filterBusy = true;
    try {
      var depth = activeDayFilter > 0 ? activeDayFilter : 0;
      await autoScroll(depth);
      runBatchedProcessAndVisual(activeDayFilter);
    } finally {
      filterBusy = false;
      updateDock();
    }
  }

  async function autoScroll(targetDays) {
    scrollAbortRequested = false;
    showScrollBanner(targetDays);
    pauseGridObs();
    var userAborted = false;
    var lastCount = getItemCount();
    var idleRounds = 0;
    var container = getScrollContainer();
    var hitLimit = false;
    try {
      while (idleRounds < maxIdleRounds) {
        if (scrollAbortRequested) {
          scrollAbortRequested = false;
          userAborted = true;
          break;
        }
        if (container) {
          container.scrollTop += scrollStep;
        } else {
          window.scrollBy(0, scrollStep);
          document.documentElement.scrollTop += scrollStep;
        }
        await new Promise(function(r) {
          setTimeout(r, scrollDelay);
        });

        var current = getItemCount();

        if (current === lastCount) {
          idleRounds++;
        } else {
          idleRounds = 0;
          lastCount = current;

          if (targetDays > 0) {
            var oldest = oldestLoadedDate();
            if (oldest && daysAgo(oldest) > targetDays) {
              hitLimit = true;
              break;
            }
          }
        }
      }

      if (userAborted) {
        loadedToEnd = false;
        scrollLoadInterrupted = true;
        var inf = inferLoadedDepthDays();
        loadedDays = inf > 0 ? inf : 0;
      } else {
        scrollLoadInterrupted = false;
        if (!hitLimit) loadedToEnd = targetDays === 0 || idleRounds >= maxIdleRounds;
        loadedDays = targetDays;
      }

      await new Promise(function(r) {
        setTimeout(r, 300);
      });
      syncLoadedDepthMeta();
      updateDateButtonPartialState();
    } finally {
      resumeGridObs();
      hideScrollBanner();
      updateDock();
    }
  }

  // ============================================================
  // PROCESS ITEMS
  // ============================================================
  /** Parent of the reel link when the link is `display: contents` (no box). Used for cell framing + dock width. */
  function getInstagramTileSurface(anchor) {
    if (!anchor || platform.id !== "instagram") return anchor;
    try {
      if (window.getComputedStyle(anchor).display === "contents") {
        return anchor.parentElement || anchor;
      }
    } catch (e) {}
    try {
      var br = anchor.getBoundingClientRect();
      if (br.width < 2 && br.height < 2 && anchor.parentElement) {
        return anchor.parentElement;
      }
    } catch (e2) {}
    return anchor;
  }

  /** Matches Instagram layout tokens on :root, e.g. --site-width-wide / --polaris-site-width-wide (935px). */
  function getInstagramSiteContentMaxWidthPx() {
    var keys = ["--site-width-wide", "--polaris-site-width-wide", "--footer-width-wide"];
    try {
      var cs = window.getComputedStyle(document.documentElement);
      for (var i = 0; i < keys.length; i++) {
        var raw = cs.getPropertyValue(keys[i]).trim();
        if (!raw) continue;
        var n = parseFloat(raw);
        if (n > 200 && n < 4096) return Math.round(n);
      }
    } catch (e) {}
    return 935;
  }

  function instagramGridColumnRect() {
    var nodes = document.querySelectorAll('a.tt-item[href*="/reel/"]');
    if (!nodes.length) return null;
    var minL = Infinity;
    var maxR = -Infinity;
    var valid = false;
    for (var i = 0; i < nodes.length; i++) {
      var tile = nodes[i];
      var el = getInstagramTileSurface(tile);
      var r = el.getBoundingClientRect();
      if (r.width < 4) continue;
      valid = true;
      minL = Math.min(minL, r.left);
      maxR = Math.max(maxR, r.right);
    }
    if (!valid || minL === Infinity) return null;
    return { left: minL, width: Math.max(200, maxR - minL) };
  }

  function readItemMetrics(item) {
    var parsed = platform.extractMetrics(item, metricsCtx());
    if (!parsed) return null;
    var snap = parsed.viewSnap || "";
    var ver = platform.id === "youtube" ? ytDateMapVersion : 0;
    var snapKey = snap + "\0" + ver;
    var ex = dataMap.get(item);
    if (ex && item._ttViewSnap === snapKey) {
      return {
        views: ex.views,
        isQualified: ex.isQualified,
        isTop: ex.isTop,
        rawScore: ex.scoreRaw,
        postDate: ex.postDate
      };
    }
    item._ttViewSnap = snapKey;
    item._ttPostDateDone = true;
    item._ttPostDateVal = parsed.postDate;
    item._ttYtMapV = ver;
    var views = parsed.views;
    var isQualified = views >= minViews;
    var isTop = views >= minViews * TOP_BAND_MULT;
    return {
      views: views,
      isQualified: isQualified,
      isTop: isTop,
      rawScore: rawScore(views, isTop, isQualified),
      postDate: parsed.postDate
    };
  }

  function finalizeScoresAndRanks() {
    enriched.sort(function(a, b) { return b.scoreRaw - a.scoreRaw; });
    var rawTop = enriched[0] ? enriched[0].scoreRaw : 1;
    if (rawTop < 1e-6) rawTop = 1;
    var n = enriched.length;
    enriched.forEach(function(d, i) {
      d.score = Math.round((d.scoreRaw / rawTop) * 1000) / 10;
      d.rank = i + 1;
      var op = "";
      if (!d.isQualified) {
        op = (0.08 + ((n - i) / Math.max(n, 1)) * 0.17).toFixed(2);
      }
      if (d.item._ttLastOp !== op) {
        d.item.style.opacity = op || "";
        d.item._ttLastOp = op;
      }
    });
  }

  function processItemsBody() {
    var items = getGridItems();

    items.forEach(function(item) {
      var m = readItemMetrics(item);
      if (!m) return;

      if (!processedSet.has(item)) {
        processedSet.add(item);
        item.classList.add("tt-item");
        var entry = {
          item: item,
          views: m.views,
          isQualified: m.isQualified,
          isTop: m.isTop,
          scoreRaw: m.rawScore,
          postDate: m.postDate
        };
      enriched.push(entry);
      dataMap.set(item, entry);
      } else {
        var e = dataMap.get(item);
        e.views = m.views;
        e.isQualified = m.isQualified;
        e.isTop = m.isTop;
        e.scoreRaw = m.rawScore;
        e.postDate = m.postDate;
      }

      item.dataset.daysAgo = m.postDate ? String(daysAgo(m.postDate)) : "";
      item.classList.remove("tt-qualified", "tt-top");
      if (m.isQualified) item.classList.add(m.isTop ? "tt-top" : "tt-qualified");

      if (platform.id === "instagram") {
        var igCell = getInstagramTileSurface(item);
        if (igCell) igCell.classList.add("tt-ig-cell");
      }
    });

    finalizeScoresAndRanks();
    syncLoadedDepthMeta();
    updateDateButtonPartialState();
    updateDock();
  }

  function runBatchedProcessAndVisual(dayFilter) {
    pauseGridObs();
    try {
      processItemsBody();
      applyVisualFilter(dayFilter);
    } finally {
      resumeGridObs();
    }
  }

  function installYoutubeYtInitialBridge() {
    if (platform.id !== "youtube") return;
    var bridgeId = "pi-ytinitial-bridge";
    if (document.getElementById(bridgeId)) return;

    function onYtInitialMessage(ev) {
      var origin = ev.origin || "";
      if (origin.indexOf("youtube.com") === -1 && origin.indexOf("youtube-nocookie.com") === -1) return;
      if (!ev.data || ev.data.source !== "pi-yt" || ev.data.type !== "YT_INITIAL_TIMES") return;
      if (!window.__ttMasterRunning) return;
      var payload = ev.data.payload || {};
      var changed = false;
      Object.keys(payload).forEach(function(vid) {
        var txt = payload[vid];
        if (!txt || typeof txt !== "string") return;
        var parsed = parseYoutubeFlexibleDate(txt);
        if (!parsed) return;
        var prev = youtubeVideoDateMap[vid];
        if (!prev || prev.getTime() !== parsed.getTime()) {
          youtubeVideoDateMap[vid] = parsed;
          changed = true;
        }
      });
      if (changed) {
        ytDateMapVersion++;
        runBatchedProcessAndVisual(activeDayFilter);
      }
    }
    window.addEventListener("message", onYtInitialMessage);
    disposers.push(function() {
      try { window.removeEventListener("message", onYtInitialMessage); } catch (eBr) {}
      var br = document.getElementById(bridgeId);
      if (br) br.remove();
    });

    var s = document.createElement("script");
    s.id = bridgeId;
    s.textContent = [
      "(function(){",
      "function pt(o){if(!o)return'';if(typeof o==='string')return o;",
      "if(o.simpleText)return o.simpleText;",
      "if(o.runs)return o.runs.map(function(r){return r.text||''}).join('');",
      "return '';}",
      "function walk(n,acc,depth){if(!n||typeof n!=='object'||depth>95)return;",
      "var vid=typeof n.videoId==='string'&&n.videoId.length>=6?n.videoId:null;",
      "if(!vid&&n.navigationEndpoint){var ne=n.navigationEndpoint;",
      "if(ne.reelWatchEndpoint&&ne.reelWatchEndpoint.videoId)vid=ne.reelWatchEndpoint.videoId;",
      "if(!vid&&ne.watchEndpoint&&ne.watchEndpoint.videoId)vid=ne.watchEndpoint.videoId;",
      "if(!vid&&ne.reelWatchEndpoint&&ne.reelWatchEndpoint.overlay){var ov=ne.reelWatchEndpoint.overlay;",
      "if(ov&&ov.reelPlayerOverlayRenderer&&ov.reelPlayerOverlayRenderer.videoId)vid=ov.reelPlayerOverlayRenderer.videoId;}}",
      "var ptt=n.publishedTimeText||n.relativeTimeText;",
      "if(vid&&ptt){var tx=pt(ptt);if(tx)acc[vid]=tx;}",
      "if(vid&&!acc[vid]&&n.accessibility&&n.accessibility.accessibilityData&&n.accessibility.accessibilityData.label){",
      "var lab=n.accessibility.accessibilityData.label;",
      "if(lab&&/ago|yesterday|today|streamed|premiered|\\d{4}/i.test(lab))acc[vid]=lab;}",
      "if(Array.isArray(n)){for(var i=0;i<n.length;i++)walk(n[i],acc,depth+1);}",
      "else{for(var k in n){if(Object.prototype.hasOwnProperty.call(n,k))walk(n[k],acc,depth+1);}}",
      "}",
      "function send(){try{var acc={};",
      "if(window.ytInitialData)walk(window.ytInitialData,acc,0);",
      "try{if(window.ytInitialPlayerResponse)walk(window.ytInitialPlayerResponse,acc,0);}catch(e2){}",
      "window.postMessage({source:'pi-yt',type:'YT_INITIAL_TIMES',payload:acc},'*');",
      "}catch(e){}}",
      "send();setTimeout(send,300);setTimeout(send,900);setTimeout(send,2200);",
      "document.addEventListener('yt-navigate-finish',send);",
      "document.addEventListener('yt-page-data-updated',send);",
      "var deb=null;function sched(){clearTimeout(deb);deb=setTimeout(send,500);}",
      "window.addEventListener('scroll',sched,{passive:true,capture:true});",
      "try{new MutationObserver(sched).observe(document.documentElement||document.body,{childList:true,subtree:true});}catch(e3){}",
      "})();"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  // ============================================================
  // STATS
  // ============================================================
  /** Range earnings & counts: unknown upload date = include (matches UI: not treated as out-of-range). */
  function passesDateFilterForStats(d, days) {
    if (days <= 0) return true;
    if (d.postDate == null) return true;
    return daysAgo(d.postDate) <= days;
  }

  function calcStats(days) {
    var subset = days === 0
      ? enriched
      : enriched.filter(function(d) { return passesDateFilterForStats(d, days); });

    var tv = 0, qc = 0, qv = 0, mx = 0, tc = subset.length;
    subset.forEach(function(d) {
      tv += d.views;
      mx = Math.max(mx, d.views);
      if (d.isQualified) { qc++; qv += d.views; }
    });

    var avgV = tc ? tv/tc : 0;
    var avgQ = qc ? qv/qc : 0;
    var earn, epv;

    if (earningsMode === "creator") {
      earn = (tv / 1000) * creatorRPM;
      epv  = tc ? earn / tc : 0;
    } else {
      earn = (qv / minViews) * ratePerMin * acceptanceRate;
      epv  = qc ? earn / qc : 0;
    }

    var roi = tc ? earn / tc : 0;

    return { tc:tc, qc:qc, qrate:tc?(qc/tc)*100:0, tv:tv, avgV:avgV,
             avgQ:avgQ, mx:mx, earn:earn, epv:epv, roi:roi };
  }

  // ============================================================
  // DATE FILTER
  // ============================================================
  function updateRangeEdgeMarker(days) {
    enriched.forEach(function(d) {
      d.item.classList.remove("tt-range-edge");
    });
    if (days <= 0) return;

    var gridOrder = Array.from(getGridItems());
    var maxDa = -1;
    gridOrder.forEach(function(item) {
      var e = dataMap.get(item);
      if (!e || !e.postDate) return;
      var da = daysAgo(e.postDate);
      if (da > days) return;
      if (da > maxDa) maxDa = da;
    });
    if (maxDa < 0) return;

    var edgeIdx = -1;
    gridOrder.forEach(function(item, idx) {
      var e = dataMap.get(item);
      if (!e || !e.postDate) return;
      var da = daysAgo(e.postDate);
      if (da <= days && da === maxDa && idx > edgeIdx) edgeIdx = idx;
    });
    if (edgeIdx >= 0) gridOrder[edgeIdx].classList.add("tt-range-edge");
  }

  function applyVisualFilter(days) {
    enriched.forEach(function(d) {
      var out = days > 0 && d.postDate != null && daysAgo(d.postDate) > days;
      d.item.classList.toggle("tt-date-hidden", out);
      d.item.classList.toggle("tt-out-of-range", out);
    });
    activeDayFilter = days;
    updateRangeEdgeMarker(days);
    updateDateButtonPartialState();
    updateDock();
  }

  async function applyDateFilter(days) {
    if (filterBusy) return;

    var needsScroll = platform.id === "tiktok" && !loadedToEnd &&
      (days === 0 || (days > 0 && loadedDays > 0 && days > loadedDays));

    if (needsScroll) {
      filterBusy = true;
      setDateFilterBusy(true);

      await autoScroll(days);
      filterBusy = false;
      setDateFilterBusy(false);
    }

    pauseGridObs();
    try {
      if (needsScroll) processItemsBody();
      applyVisualFilter(days);
    } finally {
      resumeGridObs();
    }
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
    var margin = 8;
    var ph = panel.offsetHeight || 200;
    var maxTopVp = window.innerHeight - ph - margin;
    var maxTop = maxTopVp;
    var top = clamp(rect.top, margin, maxTop);
    panel.style.left = left + "px";
    panel.style.top  = top + "px";
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

  var dock = null;
  var dockRangeWrapEl = null;
  var dockDateEl = null;
  var dockEarnEl = null;
  var dockCampaignEl = null;
  var dockHintEl = null;
  var plainBtn = null;
  var dockScrollTimer = null;

  function syncDockLayout() {
    if (!dock) return;
    if (platform.id === "instagram") {
      var col = instagramGridColumnRect();
      if (col && col.width > 100) {
        dock.style.left = col.left + "px";
        dock.style.width = col.width + "px";
        dock.style.transform = "";
        dock.style.maxWidth = "";
        return;
      }
      var igMax = getInstagramSiteContentMaxWidthPx();
      dock.style.left = "50%";
      dock.style.width = "min(" + igMax + "px, calc(100vw - 24px))";
      dock.style.maxWidth = "calc(100vw - 24px)";
      dock.style.transform = "translateX(-50%)";
      return;
    }
    dock.style.transform = "";
    dock.style.maxWidth = "";
    var lr = getListRoot();
    var r = lr.getBoundingClientRect();
    dock.style.left = r.left + "px";
    dock.style.width = Math.max(200, r.width) + "px";
  }

  function ensureDock() {
    if (dock) return;
    dock = document.createElement("div");
    dock.id = "tt-dock";
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", "Clip profile inspect — stats and quick actions");
    dock.innerHTML =
      '<div id="tt-dock-body">' +
      '<div class="tt-dock-row">' +
      '<div class="tt-dock-left">' +
      '<span id="tt-dock-range-wrap">' +
      '<span class="tt-dock-label">Range</span> <span class="tt-dock-val" id="tt-dock-date">—</span>' +
      "</span>" +
      '<span class="tt-dock-label">Earnings</span> <span class="tt-dock-earn" id="tt-dock-earn">—</span>' +
      "</div>" +
      '<div class="tt-dock-actions">' +
      '<button type="button" id="tt-dock-plain" class="tt-dock-chip" aria-pressed="false">' +
      '<span class="tt-dock-plain-glyph" aria-hidden="true">\u2726</span>' +
      '<span class="tt-dock-plain-lbl">Plain</span></button>' +
      "</div>" +
      "</div>" +
      '<div id="tt-dock-interrupt" class="tt-dock-interrupt" hidden>' +
      '<span id="tt-dock-interrupt-msg">Range: interrupted — earnings may not cover the full date filter.</span>' +
      '<button type="button" id="tt-dock-resume-scroll">Load full range</button>' +
      "</div>" +
      '<div id="tt-dock-campaign" class="tt-dock-campaign" hidden></div>' +
      '<div id="tt-dock-hint" class="tt-dock-hint" hidden></div>' +
      "</div>";
    dockRangeWrapEl = dock.querySelector("#tt-dock-range-wrap");
    dockDateEl = dock.querySelector("#tt-dock-date");
    dockEarnEl = dock.querySelector("#tt-dock-earn");
    dockCampaignEl = dock.querySelector("#tt-dock-campaign");
    dockHintEl = dock.querySelector("#tt-dock-hint");
    dockInterruptRowEl = dock.querySelector("#tt-dock-interrupt");
    dockResumeScrollBtn = dock.querySelector("#tt-dock-resume-scroll");
    plainBtn = dock.querySelector("#tt-dock-plain");
    plainBtn.addEventListener("click", function onDockPlainClick() {
      document.body.classList.toggle("tt-style-off");
      resetPanel({ force: true });
      updateDock();
    });
    if (dockResumeScrollBtn) {
      dockResumeScrollBtn.addEventListener("click", function() {
        resumeFullRangeScroll().catch(function() {});
      });
    }
    document.body.appendChild(dock);
    function ttOnWinResize() {
      syncDockLayout();
    }
    on(window, "resize", ttOnWinResize, { passive: true });
    function onDockScroll() {
      if (dockScrollTimer) clearTimeout(dockScrollTimer);
      dockScrollTimer = setTimeout(syncDockLayout, 80);
    }
    on(window, "scroll", onDockScroll, { passive: true });
    disposers.push(function() {
      try { window.removeEventListener("resize", ttOnWinResize); } catch (e) {}
      try { window.removeEventListener("scroll", onDockScroll); } catch (e) {}
    });
    syncDockLayout();
  }

  function updateDock() {
    ensureDock();
    var s = calcStats(activeDayFilter);
    var showRange = shouldShowDateRangeUi();
    if (dockRangeWrapEl) dockRangeWrapEl.hidden = !showRange;
    dockDateEl.textContent = activeDayFilter === 0 ? "All" : activeDayFilter + "d";
    dockEarnEl.textContent = fmtMoney(s.earn) + " · " + (earningsMode === "creator" ? "creator" : "clip");
    if (dockCampaignEl) {
      dockCampaignEl.textContent = "";
      dockCampaignEl.hidden = true;
    }
    var off = document.body.classList.contains("tt-style-off");
    var plainTitle = platform.plainLabel(off);
    var plainShort = off ? "Style" : "Plain";
    var plainGlyph = off ? "\u25A1" : "\u2726";
    function applyPlainDockButton(btn) {
      if (!btn) return;
      btn.title = plainTitle;
      btn.setAttribute("aria-label", plainTitle);
      btn.setAttribute("aria-pressed", off ? "true" : "false");
      btn.classList.toggle("on", off);
      var g = btn.querySelector(".tt-dock-plain-glyph");
      var lb = btn.querySelector(".tt-dock-plain-lbl");
      if (g) g.textContent = plainGlyph;
      if (lb) lb.textContent = plainShort;
    }
    applyPlainDockButton(plainBtn);
    if (dockHintEl) {
      var hintText = gridDateHintText();
      if (hintText) {
        dockHintEl.textContent = hintText;
        dockHintEl.hidden = false;
      } else {
        dockHintEl.textContent = "";
        dockHintEl.hidden = true;
      }
    }
    if (dockInterruptRowEl) {
      dockInterruptRowEl.hidden = !(platform.id === "tiktok" && scrollLoadInterrupted && !filterBusy);
    }
    syncDockLayout();
  }

  function getYoutubeDateCoverage() {
    if (platform.id !== "youtube") return null;
    var total = enriched.length;
    if (total === 0) return null;
    var known = 0;
    enriched.forEach(function(d) {
      if (d.postDate) known++;
    });
    return { known: known, total: total };
  }

  /** Hide date-range UI when tiles are loaded but none have a parsed upload date (e.g. YouTube Shorts). */
  function shouldShowDateRangeUi() {
    if (enriched.length === 0) return true;
    for (var i = 0; i < enriched.length; i++) {
      if (enriched[i].postDate) return true;
    }
    return false;
  }

  function youtubeDateHintText() {
    var cov = getYoutubeDateCoverage();
    if (!cov) return null;
    if (cov.known === 0) {
      return "No upload dates in YouTube page data for these tiles yet—scroll the Shorts grid to load more. Stats and earnings update as new tiles load.";
    }
    if (cov.known < cov.total) {
      return "Upload dates for " + cov.known + " / " + cov.total + " loaded Shorts—scroll to load more; stats update as you scroll.";
    }
    return null;
  }

  function gridDateHintText() {
    if (platform.id === "youtube") return youtubeDateHintText();
    return null;
  }

  function instagramPopupGridNote() {
    if (platform.id !== "instagram" || enriched.length === 0) return null;
    return "Instagram's Reels tab doesn't show post dates in the grid—stats use play counts only; date range is unavailable.";
  }

  function showPanel(d) {
    if (activeItem === d.item && panel.style.display === "block") return;
    if (activeItem) activeItem.classList.remove("tt-active");
    activeItem = d.item;
    d.item.classList.add("tt-active");
    if (!document.body.classList.contains("tt-style-off")) {
    document.body.classList.add("tt-focus-active");
    }

    var badgeClass = d.isTop ? "top" : d.isQualified ? "qualified" : "not-qualified";
    var badgeText  = d.isTop ? "TOP" : d.isQualified ? "QUALIFIED" : "NOT QUALIFIED";
    var hideQualBadge = earningsMode === "creator" && d.isQualified && !d.isTop;
    var badgeHtml = hideQualBadge
      ? '<span class="tt-panel-badge tt-panel-badge-empty" aria-hidden="true"></span>'
      : '<span class="tt-panel-badge ' + badgeClass + '">' + badgeText + "</span>";
    var scoreColor = d.score >= 80 ? "pink" : d.score >= 50 ? "green" : "";
    var age        = daysAgo(d.postDate);
    var ageStr     = age === Infinity ? "—" : age === 0 ? "Today" : age === 1 ? "Yesterday" : age + "d ago";
    var earnLabel  = earningsMode === "creator" ? "Creator Est." : "Clip Est.";

    panel.innerHTML =
      '<div class="tt-panel-header"><span>Video Intel</span>' +
        badgeHtml + "</div>" +
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
      '<div class="tt-panel-disclaimer">' + platform.disclaimer + "</div>";

    panel.style.display = "block";
    positionPanel(d.item);
  }

  function onListHover(e) {
    if (panelPinned) return;
    var item = platform.closestGridItem(e.target);
    if (!item) return;
    var d = dataMap.get(item);
    if (d) showPanel(d);
  }

  on(document, "mouseover", function(e) {
    var lr = getListRoot();
    if (lr !== document.body && !lr.contains(e.target)) return;
    onListHover(e);
  });
  on(document, "pointerover", function(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    var lr = getListRoot();
    if (lr !== document.body && !lr.contains(e.target)) return;
    onListHover(e);
  });
  on(document, "mouseout", function(e) {
    var lr = getListRoot();
    if (lr === document.body) return;
    var rel = e.relatedTarget;
    if (lr.contains(e.target) && (!rel || !lr.contains(rel))) {
      resetPanel({ force:true });
    }
  });

  on(document, "contextmenu", function(e) {
    var lr = getListRoot();
    if (lr !== document.body && !lr.contains(e.target)) return;
    var item = platform.closestGridItem(e.target);
    if (!item) return;
    var d = dataMap.get(item);
    if (!d) return;
    e.preventDefault();
    panelPinned = true;
    showPanel(d);
  });

  var scrollHandler = function() {
    if (scrollHideTimer) clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(function() {
      resetPanel({ force:true });
      scrollHideTimer = null;
    }, scrollResetDelay);
  };
  on(window, "scroll", scrollHandler, { passive:true });

  var scrollContainer = getScrollContainer();
  if (scrollContainer && scrollContainer !== window) {
    on(scrollContainer, "scroll", scrollHandler, { passive:true });
  }

  on(document, "keydown", function(e) {
    if (e.key === "Escape") resetPanel({ force:true });
  });

  function applyEarningsMode(mode) {
    earningsMode = mode === "creator" ? "creator" : "clipping";
    document.body.classList.toggle("tt-creator-mode", earningsMode === "creator");
    if (activeItem) {
      var d = dataMap.get(activeItem);
      if (d) { activeItem = null; showPanel(d); }
    }
    updateDock();
  }

  function platformDisplayLabel() {
    if (platform.id === "youtube") return "YouTube · Shorts";
    if (platform.id === "tiktok") return "TikTok";
    if (platform.id === "instagram") return "Instagram · Reels";
    return platform.id;
  }

  function profileLabelForPage() {
    var p = window.location.pathname;
    if (platform.id === "youtube") {
      var y = p.match(/^\/@([^/]+)/);
      if (y) return "@" + y[1];
      var ch = p.match(/^\/(?:channel|c|user)\/([^/]+)/);
      if (ch) return ch[1];
      return "—";
    }
    if (platform.id === "tiktok") {
      var a = p.match(/^\/@([^/]+)/);
      if (a) return "@" + a[1];
      var seg = p.split("/").filter(function(x) { return x; });
      if (seg.length && !/^(video|search|following|foryou|live|tag|music|discover|stitch|effect|upload)$/i.test(seg[0])) {
        return seg[0];
      }
      return "—";
    }
    if (platform.id === "instagram") {
      var ig = p.split("/").filter(function(x) {
        return x;
      });
      if (ig.length >= 2 && /^reels?$/i.test(ig[1])) return "@" + ig[0];
      return "—";
    }
    return "—";
  }

  function popupLedeText() {
    if (filterBusy) return "Loading the grid… figures may jump until tiles finish settling.";
    var n = getItemCount();
    if (n === 0) {
      return "No tiles in view yet—scroll the grid on the page, then reopen this panel if numbers stay at zero.";
    }
    return "All numbers are for this tab only. Plain / styling is on the bar at the bottom of the page.";
  }

  function buildSnapshot() {
    var s = calcStats(activeDayFilter);
    var depth = inferLoadedDepthDays();
    var yCov = getYoutubeDateCoverage();
    return {
      type: "TT_SNAPSHOT",
      platformId: platform.id,
      platformLabel: platformDisplayLabel(),
      profileLabel: profileLabelForPage(),
      popupLede: popupLedeText(),
      dateHint: gridDateHintText(),
      instagramGridNote: instagramPopupGridNote(),
      dateCoverage: yCov,
      showDateRangeUi: shouldShowDateRangeUi(),
      earningsModeHint:
        earningsMode === "creator"
          ? "Creator mode: earnings use views × RPM (per thousand views)."
          : "Clip mode: earnings use qualified tiles, clip rate, and acceptance.",
      stats: {
        videos: String(s.tc),
        qualified: String(s.qc),
        qualRate: fmtPct(s.qrate),
        totalViews: fmtK(s.tv),
        avgViews: fmtK(s.avgV),
        avgQual: fmtK(s.avgQ),
        maxViews: fmtK(s.mx),
        earnings: fmtMoney(s.earn),
        perQualOrVideo: fmtMoney(s.epv),
        roi: fmtMoney(s.roi),
        perQualLabel: earningsMode === "creator" ? "Per video" : "Per qual"
      },
      activeDayFilter: activeDayFilter,
      earningsMode: earningsMode,
      creatorRPM: creatorRPM,
      filterBusy: filterBusy,
      dimmed: document.body.classList.contains("tt-dim-mode"),
      loadedToEnd: loadedToEnd,
      loadedDays: loadedDays,
      scrollLoadInterrupted: scrollLoadInterrupted,
      gridCount: getItemCount(),
      seekBackDays: seekBackDays,
      partialDays: filterOptions.map(function(f) {
        if (f.days === 0) return { days: 0, label: f.label, partial: false };
        return { days: f.days, label: f.label, partial: f.days > 0 && !loadedToEnd && depth < f.days };
      }),
      styleOff: document.body.classList.contains("tt-style-off")
    };
  }

  var gridMoTimer = null;
  gridObserver = new MutationObserver(function() {
    clearTimeout(gridMoTimer);
    gridMoTimer = setTimeout(function() {
      runBatchedProcessAndVisual(activeDayFilter);
    }, 550);
  });
  function tryObserveGrid() {
    var lr = getListRoot();
    if (!lr || lr === document.body) {
      gridObserved = null;
      return;
    }
    if (lr === gridObserved) return;
    try { gridObserver.disconnect(); } catch (e) {}
    gridObserved = lr;
    try {
      gridObserver.observe(lr, {
        childList: true,
        subtree: true,
        characterData: true
      });
    } catch (e2) {}
  }
  tryObserveGrid();
  var gridDomObserver = new MutationObserver(function() { tryObserveGrid(); });
  gridDomObserver.observe(document.documentElement, { childList: true, subtree: true });
  disposers.push(function() {
    try { gridObserver.disconnect(); } catch (eG) {}
    try { gridDomObserver.disconnect(); } catch (eH) {}
  });

  installYoutubeYtInitialBridge();

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (!window.__ttMasterRunning) {
      sendResponse({ error: "inactive" });
      return false;
    }
    if (msg.type === "TT_GET_SNAPSHOT") {
      try {
        sendResponse(buildSnapshot());
      } catch (e) {
        sendResponse({ error: e && e.message ? e.message : "snapshot" });
      }
      return false;
    }
    if (msg.type === "TT_SET_MODE") {
      applyEarningsMode(msg.mode);
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "TT_SET_RPM") {
      creatorRPM = clamp(Number(msg.value), 0.4, 1);
      if (activeItem) {
        var dR = dataMap.get(activeItem);
        if (dR) { activeItem = null; showPanel(dR); }
      }
      sendResponse({ ok: true, creatorRPM: creatorRPM });
      return false;
    }
    if (msg.type === "TT_TOGGLE_DIM") {
    document.body.classList.toggle("tt-dim-mode");
      sendResponse({ ok: true, dimmed: document.body.classList.contains("tt-dim-mode") });
      return false;
    }
    if (msg.type === "TT_APPLY_DATE") {
      applyDateFilter(Number(msg.days)).then(function() {
        sendResponse({ ok: true });
      }).catch(function() {
        sendResponse({ ok: false });
      });
      return true;
    }
    if (msg.type === "TT_LOAD_HISTORY") {
      if (filterBusy) {
        sendResponse({ ok: false, busy: true });
        return false;
      }
      filterBusy = true;
      var scrollDone =
        platform.id === "tiktok" ? autoScroll(seekBackDays) : Promise.resolve();
      scrollDone
        .then(function() {
          runBatchedProcessAndVisual(activeDayFilter);
          sendResponse({ ok: true });
        })
        .catch(function() {
          sendResponse({ ok: false });
        })
        .finally(function() {
          filterBusy = false;
          updateDock();
        });
      return true;
    }
    if (msg.type === "TT_RECALC_FROM_SETTINGS") {
      try {
        chrome.storage.sync.get(STORAGE_DEFAULTS, function(s) {
          applySettings(s);
          syncSettingsToPage();
          updateDock();
          try {
            sendResponse({ ok: true });
          } catch (eR) {}
        });
      } catch (eRec) {
        sendResponse({ ok: false });
      }
      return true;
    }
    if (msg.type === "TT_TOGGLE_PLAIN") {
      document.body.classList.toggle("tt-style-off");
      resetPanel({ force: true });
      updateDock();
      sendResponse({
        ok: true,
        styleOff: document.body.classList.contains("tt-style-off")
      });
      return false;
    }
    if (msg.type === "TT_TEARDOWN") {
      teardown();
      sendResponse({ ok: true });
      return false;
    }
  });

  // ============================================================
  // ENTRY
  // ============================================================
  (async function() {
    if (platform.id === "tiktok") {
      filterBusy = true;
      try {
        await autoScroll(seekBackDays);
      } finally {
        filterBusy = false;
      }
    }

    runBatchedProcessAndVisual(defaultPreset);

  })();

  function syncSettingsToPage() {
    if (startDimmed) document.body.classList.add("tt-dim-mode");
    else document.body.classList.remove("tt-dim-mode");
    runBatchedProcessAndVisual(activeDayFilter);
  }

  var storageChangeListener = function(changes, areaName) {
    if (areaName !== "sync") return;
    chrome.storage.sync.get(STORAGE_DEFAULTS, function(s) {
      applySettings(s);
      syncSettingsToPage();
    });
  };
  chrome.storage.onChanged.addListener(storageChangeListener);
  disposers.push(function() {
    try { chrome.storage.onChanged.removeListener(storageChangeListener); } catch (e4) {}
  });

  }

  chrome.storage.sync.get(STORAGE_DEFAULTS, function(s) {
    applySettings(s);
    initInspectMain(selectedPlatform);
  });

})();
