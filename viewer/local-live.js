(function () {
  "use strict";

  var liveBadge = document.getElementById("liveLocal");
  var statusButton = document.getElementById("localStatus");
  var refreshButton = document.getElementById("refreshLocal");
  var info = document.getElementById("info");
  if (!liveBadge || !statusButton || !refreshButton || !info) return;

  var latest = null;
  var active = false;
  var polling = null;

  function shortSha(value) {
    return value ? String(value).slice(0, 8) : "—";
  }

  function moduleLine(entry) {
    if (!entry.present) return entry.repoName + "｜MISSING";
    var flags = [];
    if (entry.dirty) flags.push("dirty");
    if (!entry.snapshotMatch) flags.push("snapshot drift");
    if (!flags.length) flags.push("snapshot match");
    return entry.repoName + "｜" + (entry.branch || "detached") + "｜" + shortSha(entry.head) + "｜" + flags.join(", ");
  }

  function summary(payload) {
    var modules = payload.modules || [];
    var missing = modules.filter(function (entry) { return !entry.present; }).length;
    var dirty = modules.filter(function (entry) { return entry.present && entry.dirty; }).length;
    var drift = modules.filter(function (entry) { return entry.present && !entry.snapshotMatch; }).length;
    return { modules: modules.length, missing: missing, dirty: dirty, drift: drift };
  }

  function renderBadge(payload) {
    var counts = summary(payload);
    liveBadge.hidden = false;
    statusButton.hidden = false;
    refreshButton.hidden = false;
    liveBadge.textContent = "LIVE LOCAL · " + counts.dirty + " dirty · " + counts.drift + " drift" + (counts.missing ? " · " + counts.missing + " missing" : "");
    liveBadge.title = "Last checked " + (payload.generatedAt || "now");
  }

  function setInfo(title, body, items) {
    var heading = document.getElementById("infoTitle");
    var paragraph = document.getElementById("infoBody");
    var content = document.getElementById("infoContent");
    if (!heading || !paragraph || !content) return;
    heading.textContent = title;
    paragraph.textContent = body;
    content.replaceChildren();
    var section = document.createElement("h3");
    section.textContent = "Local repositories";
    content.appendChild(section);
    items.forEach(function (text) {
      var item = document.createElement("div");
      item.className = "item";
      item.textContent = text;
      content.appendChild(item);
    });
    info.hidden = false;
  }

  async function fetchStatus() {
    var response = await fetch("api/workspace-status", { cache: "no-store" });
    if (!response.ok) throw new Error("local api unavailable");
    var payload = await response.json();
    if (!payload || payload.mode !== "local" || !Array.isArray(payload.modules)) throw new Error("not a local workspace response");
    latest = payload;
    if (!active) {
      active = true;
      document.documentElement.dataset.workspaceMode = "local";
    }
    renderBadge(payload);
    return payload;
  }

  async function poll() {
    try {
      await fetchStatus();
    } catch {
      if (!active && polling) {
        window.clearInterval(polling);
        polling = null;
      }
    }
  }

  statusButton.addEventListener("click", function () {
    if (!latest) return;
    var counts = summary(latest);
    setInfo(
      "LIVE LOCAL workspace",
      counts.modules + " modules · " + counts.dirty + " dirty · " + counts.drift + " snapshot drift · " + counts.missing + " missing",
      latest.modules.map(moduleLine)
    );
  });

  refreshButton.addEventListener("click", async function () {
    if (!active || refreshButton.disabled) return;
    refreshButton.disabled = true;
    var previous = refreshButton.textContent;
    refreshButton.textContent = "更新中…";
    try {
      var response = await fetch("api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        cache: "no-store"
      });
      if (!response.ok) {
        var errorPayload = await response.json().catch(function () { return {}; });
        throw new Error(errorPayload.error || "refresh failed");
      }
      window.location.reload();
    } catch (error) {
      refreshButton.textContent = "更新失敗";
      liveBadge.textContent = "LIVE LOCAL · " + (error && error.message ? error.message : "refresh failed");
      window.setTimeout(function () {
        refreshButton.textContent = previous;
        refreshButton.disabled = false;
      }, 1800);
      return;
    }
    refreshButton.textContent = previous;
    refreshButton.disabled = false;
  });

  poll();
  polling = window.setInterval(poll, 5000);
}());
