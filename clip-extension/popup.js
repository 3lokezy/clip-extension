(function () {
  var DEFAULTS = {
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

  var pollTimer = null;

  function isSupportedPageUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      var u = new URL(url);
      if (u.protocol !== "https:") return false;
      var h = u.hostname.toLowerCase();
      if (h === "tiktok.com" || h === "www.tiktok.com" || h.endsWith(".tiktok.com")) return true;
      if (h === "youtube.com" || h === "www.youtube.com" || h === "m.youtube.com") {
        var p = u.pathname;
        return (
          /\/@[^/]+\/shorts\/?/i.test(p) ||
          /\/channel\/[^/]+\/shorts\/?/i.test(p) ||
          /\/c\/[^/]+\/shorts\/?/i.test(p) ||
          /\/user\/[^/]+\/shorts\/?/i.test(p)
        );
      }
      if (h === "instagram.com" || h === "www.instagram.com") {
        var igp = u.pathname.split("/").filter(function (x) {
          return x;
        });
        return igp.length >= 2 && /^reels?$/i.test(igp[1]);
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function shortenUrl(url) {
    if (!url) return "";
    try {
      var u = new URL(url);
      var s = u.hostname + (u.pathname || "/");
      return s.length > 58 ? s.slice(0, 56) + "…" : s;
    } catch (e2) {
      return String(url).slice(0, 58);
    }
  }

  function stepsHtmlCommon() {
    return (
      "<li>Click the tab that shows the video grid.</li>" +
      "<li>Reload the tab after an extension update.</li>" +
      "<li>Click <strong>Try again</strong> below.</li>"
    );
  }

  function stepsHtmlWrongPage() {
    return (
      "<li>Open a TikTok profile, YouTube Shorts channel, or Instagram <code>/username/reels/</code>.</li>" +
      "<li>Make sure that tab is the active tab in this window.</li>" +
      "<li>Click <strong>Try again</strong>.</li>"
    );
  }

  function setOfflineContent(meta) {
    var titleEl = document.getElementById("popup-offline-title");
    var detailEl = document.getElementById("popup-offline-detail");
    var stepsEl = document.getElementById("popup-offline-steps");
    if (!titleEl || !detailEl || !stepsEl) return;
    titleEl.textContent = meta.title || "Can’t use this tab yet";
    detailEl.innerHTML = meta.detailHtml || "";
    stepsEl.innerHTML = meta.stepsHtml || stepsHtmlCommon();
  }

  function sendTab(payload, cb, opts) {
    opts = opts || {};
    var didInject = !!opts._didInject;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs[0];
      if (!t || !t.id) {
        if (cb) cb(new Error("no tab"));
        return;
      }
      if (!isSupportedPageUrl(t.url)) {
        if (cb) cb(new Error("not supported page"));
        return;
      }
      chrome.tabs.sendMessage(t.id, payload, function (res) {
        var lastErr = chrome.runtime.lastError;
        if (lastErr) {
          var em = lastErr.message || "";
          if (
            !didInject &&
            /Receiving end does not exist|Could not establish connection|The message port closed/i.test(em)
          ) {
            chrome.scripting.executeScript(
              { target: { tabId: t.id }, files: ["content.js"] },
              function () {
                var injErr = chrome.runtime.lastError;
                if (injErr) {
                  if (cb) cb(new Error(injErr.message));
                  return;
                }
                sendTab(payload, cb, { _didInject: true });
              }
            );
            return;
          }
          if (cb) cb(new Error(em));
          return;
        }
        if (cb) cb(null, res);
      });
    });
  }

  function showOffline(meta) {
    if (meta) setOfflineContent(meta);
    document.getElementById("popup-offline").classList.remove("hidden");
    document.getElementById("popup-main").classList.add("hidden");
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showMain() {
    document.getElementById("popup-offline").classList.add("hidden");
    document.getElementById("popup-main").classList.remove("hidden");
  }

  function setStatus(text) {
    var s = document.getElementById("popup-status");
    if (!s) return;
    s.textContent = text || "";
  }

  function showOfflineFromFailure(err, snap, tabUrl) {
    var msg = err && err.message ? String(err.message) : "";
    if (snap && snap.error) {
      msg = String(snap.error);
    }
    var meta = { title: "", detailHtml: "", stepsHtml: "" };
    if (msg === "not supported page") {
      meta.title = "This page doesn’t run Clip inspect";
      meta.detailHtml = tabUrl
        ? "Current tab: <strong>" + shortenUrl(tabUrl) + "</strong>. Switch to a supported profile grid."
        : "Switch to a TikTok profile, YouTube Shorts grid, or Instagram Reels tab.";
      meta.stepsHtml = stepsHtmlWrongPage();
    } else if (msg === "no tab") {
      meta.title = "No active tab";
      meta.detailHtml = "Focus the browser window that has your grid open, then open this panel again.";
      meta.stepsHtml = stepsHtmlCommon();
    } else if (msg === "inactive") {
      meta.title = "This tab needs a refresh";
      meta.detailHtml =
        "The extension isn’t running on this page yet. <strong>Reload the tab</strong>, wait for the grid, then try again.";
      meta.stepsHtml = stepsHtmlCommon();
    } else if (msg === "empty") {
      meta.title = "No response from the page";
      meta.detailHtml = "Reload the tab and wait for the grid to appear.";
      meta.stepsHtml = stepsHtmlCommon();
    } else {
      meta.title = "Couldn’t reach this tab";
      meta.detailHtml =
        (msg ? "Details: " + msg + "<br><br>" : "") +
        "Try a hard refresh (reload), then open this panel again.";
      meta.stepsHtml = stepsHtmlCommon();
    }
    showOffline(meta);
  }

  function statCell(label, value, colorClass) {
    var c = colorClass ? " " + colorClass : "";
    return (
      '<div class="tt-stat">' +
      '<span class="tt-stat-label">' +
      label +
      "</span>" +
      '<span class="tt-stat-value' +
      c +
      '">' +
      value +
      "</span>" +
      "</div>"
    );
  }

  function renderSnapshot(snap) {
    if (!snap || !snap.stats) return;
    setStatus("");
    var lede = document.getElementById("popup-lede");
    if (lede) {
      if (snap.popupLede) {
        lede.textContent = snap.popupLede;
        lede.hidden = false;
      } else {
        lede.textContent = "";
        lede.hidden = true;
      }
    }
    var ctxBar = document.getElementById("popup-context-bar");
    var platEl = document.getElementById("ctx-platform");
    var profEl = document.getElementById("ctx-profile");
    if (ctxBar && platEl && profEl) {
      var pl = snap.platformLabel || "";
      var pr = snap.profileLabel || "";
      if (pl || pr) {
        ctxBar.hidden = false;
        platEl.textContent = pl || "—";
        profEl.textContent = pr || "—";
        profEl.title = pr ? String(pr) : "";
      } else {
        ctxBar.hidden = true;
      }
    }
    var dateSection = document.getElementById("popup-date-range-section");
    if (dateSection) {
      if (snap.showDateRangeUi === false) {
        dateSection.classList.add("hidden");
      } else {
        dateSection.classList.remove("hidden");
      }
    }
    var dateHintEl = document.getElementById("popup-date-hint");
    if (dateHintEl) {
      if (snap.dateHint) {
        dateHintEl.textContent = snap.dateHint;
        dateHintEl.classList.remove("hidden");
      } else {
        dateHintEl.textContent = "";
        dateHintEl.classList.add("hidden");
      }
    }
    var earnHintEl = document.getElementById("popup-earnings-hint");
    if (earnHintEl) {
      earnHintEl.textContent = snap.earningsModeHint || "";
    }
    var igNoteEl = document.getElementById("popup-instagram-note");
    if (igNoteEl) {
      if (snap.instagramGridNote) {
        igNoteEl.textContent = snap.instagramGridNote;
        igNoteEl.classList.remove("hidden");
      } else {
        igNoteEl.textContent = "";
        igNoteEl.classList.add("hidden");
      }
    }
    var st = snap.stats;
    var grid = document.getElementById("stats-grid");
    grid.innerHTML =
      statCell("Videos", st.videos, "") +
      statCell("Qualified", st.qualified, "green") +
      statCell("Qual rate", st.qualRate, "green") +
      statCell("Total views", st.totalViews, "blue") +
      statCell("Avg views", st.avgViews, "blue") +
      statCell("Avg qual", st.avgQual, "blue") +
      statCell("Max views", st.maxViews, "blue") +
      statCell("Earnings", st.earnings, "peach") +
      statCell(st.perQualLabel || "Per qual", st.perQualOrVideo, "peach") +
      statCell("ROI / video", st.roi, "peach");

    var dateRow = document.getElementById("date-row");
    dateRow.innerHTML = '<span class="row-label">Date</span>';
    (snap.partialDays || []).forEach(function (fd) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tt-filter-btn";
      b.dataset.days = String(fd.days);
      b.textContent = fd.label;
      b.setAttribute("aria-pressed", snap.activeDayFilter === fd.days ? "true" : "false");
      b.title = "Show stats for videos uploaded in the last " + (fd.days === 0 ? "all time" : fd.days + " days");
      if (snap.activeDayFilter === fd.days) b.classList.add("active");
      if (fd.partial) b.classList.add("partial");
      if (snap.filterBusy) b.disabled = true;
      dateRow.appendChild(b);
    });

    var clipBtn = document.getElementById("mode-clipping");
    var creBtn = document.getElementById("mode-creator");
    clipBtn.classList.remove("active");
    creBtn.classList.remove("active");
    clipBtn.setAttribute("aria-pressed", "false");
    creBtn.setAttribute("aria-pressed", "false");
    if (snap.earningsMode === "creator") {
      creBtn.classList.add("active", "creator");
      creBtn.setAttribute("aria-pressed", "true");
      document.getElementById("rpm-wrap").classList.remove("hidden");
    } else {
      clipBtn.classList.add("active", "clipping");
      clipBtn.setAttribute("aria-pressed", "true");
      document.getElementById("rpm-wrap").classList.add("hidden");
    }

    var rpmSlider = document.getElementById("rpm-slider");
    rpmSlider.value = String(snap.creatorRPM);
    document.getElementById("rpm-value").textContent = "$" + Number(snap.creatorRPM).toFixed(2);

    var dimBtn = document.getElementById("btn-dim");
    dimBtn.classList.toggle("on", !!snap.dimmed);
    dimBtn.setAttribute("aria-pressed", snap.dimmed ? "true" : "false");

    var plainPopupBtn = document.getElementById("btn-plain-popup");
    if (plainPopupBtn) {
      var plainOn = !!snap.styleOff;
      plainPopupBtn.classList.toggle("on", plainOn);
      plainPopupBtn.textContent = plainOn ? "Show styling" : "Plain view";
      plainPopupBtn.setAttribute("aria-pressed", plainOn ? "true" : "false");
    }

  }

  function refresh() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs[0];
      var tabUrl = t && t.url ? String(t.url) : "";
      sendTab({ type: "TT_GET_SNAPSHOT" }, function (err, snap) {
        if (err) {
          showOfflineFromFailure(err, null, tabUrl);
          return;
        }
        if (snap == null || snap.error) {
          showOfflineFromFailure(null, snap || { error: "empty" }, tabUrl);
          return;
        }
        showMain();
        renderSnapshot(snap);
      });
    });
  }

  function fillForm(s) {
    document.getElementById("minViews").value = s.minViews;
    document.getElementById("ratePerMin").value = s.ratePerMin;
    document.getElementById("acceptanceRate").value = s.acceptanceRate;
    document.getElementById("seekBackDays").value = s.seekBackDays;
    document.getElementById("scrollStep").value = s.scrollStep;
    document.getElementById("scrollDelay").value = s.scrollDelay;
    document.getElementById("maxIdleRounds").value = s.maxIdleRounds;
    document.getElementById("scrollResetDelay").value = s.scrollResetDelay;
    document.getElementById("startDimmed").checked = !!s.startDimmed;
  }

  function readForm() {
    return {
      minViews: Number(document.getElementById("minViews").value) || DEFAULTS.minViews,
      ratePerMin: Number(document.getElementById("ratePerMin").value) || DEFAULTS.ratePerMin,
      acceptanceRate: Number(document.getElementById("acceptanceRate").value),
      seekBackDays: Number(document.getElementById("seekBackDays").value) || DEFAULTS.seekBackDays,
      scrollStep: Number(document.getElementById("scrollStep").value) || DEFAULTS.scrollStep,
      scrollDelay: Number(document.getElementById("scrollDelay").value) || DEFAULTS.scrollDelay,
      maxIdleRounds: Number(document.getElementById("maxIdleRounds").value) || DEFAULTS.maxIdleRounds,
      scrollResetDelay: Number(document.getElementById("scrollResetDelay").value) || DEFAULTS.scrollResetDelay,
      startDimmed: document.getElementById("startDimmed").checked
    };
  }

  function syncAdvancedUi() {
    var adv = document.getElementById("settings-advanced");
    var btn = document.getElementById("btn-toggle-advanced");
    if (!adv || !btn) return;
    var open = sessionStorage.getItem("ttPopupAdvanced") === "1";
    adv.classList.toggle("hidden", !open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "Hide advanced" : "Advanced";
  }

  document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.sync.get(DEFAULTS, fillForm);
    syncAdvancedUi();

    document.getElementById("btn-toggle-advanced").addEventListener("click", function () {
      var open = sessionStorage.getItem("ttPopupAdvanced") === "1";
      sessionStorage.setItem("ttPopupAdvanced", open ? "0" : "1");
      syncAdvancedUi();
    });

    document.getElementById("popup-retry").addEventListener("click", function () {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      pollTimer = setInterval(refresh, 1200);
      refresh();
    });

    document.getElementById("date-row").addEventListener("click", function (e) {
      var btn = e.target.closest(".tt-filter-btn");
      if (!btn || btn.disabled) return;
      var days = Number(btn.dataset.days);
      sendTab({ type: "TT_APPLY_DATE", days: days }, function (err, res) {
        if (!err && res && res.ok) {
          setStatus("Date range updated");
          refresh();
        } else {
          setStatus("Couldn’t change range — check the tab.");
        }
      });
    });

    document.getElementById("mode-clipping").addEventListener("click", function () {
      sendTab({ type: "TT_SET_MODE", mode: "clipping" }, function () {
        refresh();
      });
    });
    document.getElementById("mode-creator").addEventListener("click", function () {
      sendTab({ type: "TT_SET_MODE", mode: "creator" }, function () {
        refresh();
      });
    });

    document.getElementById("rpm-slider").addEventListener("input", function () {
      var v = parseFloat(document.getElementById("rpm-slider").value);
      document.getElementById("rpm-value").textContent = "$" + v.toFixed(2);
      sendTab({ type: "TT_SET_RPM", value: v }, function () {});
    });

    document.getElementById("btn-dim").addEventListener("click", function () {
      sendTab({ type: "TT_TOGGLE_DIM" }, function () {
        refresh();
      });
    });

    document.getElementById("btn-plain-popup").addEventListener("click", function () {
      sendTab({ type: "TT_TOGGLE_PLAIN" }, function () {
        refresh();
      });
    });

    document.getElementById("save").addEventListener("click", function () {
      var o = readForm();
      if (isNaN(o.acceptanceRate)) o.acceptanceRate = DEFAULTS.acceptanceRate;
      o.acceptanceRate = Math.max(0, Math.min(1, o.acceptanceRate));
      setStatus("Saving…");
      chrome.storage.sync.set(o, function () {
        setStatus("Saved · updating tab…");
        sendTab({ type: "TT_RECALC_FROM_SETTINGS" }, function (err) {
          chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var t = tabs[0];
            if (t && t.id && isSupportedPageUrl(t.url || "") && err) {
              try {
                chrome.tabs.reload(t.id);
              } catch (e) {}
            }
            setTimeout(function () {
              window.close();
            }, 520);
          });
        });
      });
    });

    document.getElementById("reset").addEventListener("click", function () {
      chrome.storage.sync.set(DEFAULTS, function () {
        fillForm(DEFAULTS);
        setStatus("Defaults loaded — Save to apply to the tab.");
      });
    });

    refresh();
    pollTimer = setInterval(refresh, 1200);
  });
})();
