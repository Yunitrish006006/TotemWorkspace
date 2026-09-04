(function () {
  "use strict";

  var liveBadge = document.getElementById("liveLocal");
  var activityBadge = document.getElementById("agentActivity");
  var promptToggle = document.getElementById("promptToggle");
  var promptBar = document.getElementById("promptBar");
  var promptInput = document.getElementById("promptInput");
  var promptSubmit = document.getElementById("promptSubmit");
  var statusButton = document.getElementById("localStatus");
  var refreshButton = document.getElementById("refreshLocal");
  var info = document.getElementById("info");
  if (!liveBadge || !activityBadge || !promptToggle || !promptBar || !promptInput || !promptSubmit || !statusButton || !refreshButton || !info) return;

  var latest = null;
  var settings = null;
  var active = false;
  var polling = null;
  var activityPolling = null;
  var activityAnimation = null;
  var activitySequence = 0;
  var localApiBase = null;

  function discoverLocalApiBase() {
    var host = window.location.hostname.toLowerCase();
    var loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
    var approvedPages = host === "yunitrish006006.github.io";
    if (!loopback && !approvedPages) return null;
    if (loopback && window.location.port === "18765") return window.location.origin;
    return "http://127.0.0.1:18765";
  }

  function apiUrl(path) {
    if (!localApiBase) throw new Error("local api unavailable");
    return localApiBase + path;
  }

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
    promptToggle.hidden = false;
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

  function renderSettings(value) {
    settings = value || {};
    var enabled = settings.promptEnabled === true;
    promptToggle.textContent = enabled ? "Prompt ON" : "Prompt OFF";
    promptToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    promptBar.hidden = !enabled;
  }

  async function fetchSettings() {
    var response = await fetch(apiUrl("/api/viewer-settings"), { cache: "no-store" });
    if (!response.ok) throw new Error("viewer settings unavailable");
    var payload = await response.json();
    renderSettings(payload);
    return payload;
  }

  async function updatePromptSetting(enabled) {
    var response = await fetch(apiUrl("/api/viewer-settings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptEnabled: enabled }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error("viewer settings update failed");
    renderSettings(await response.json());
  }

  function requestAgentDraw() {
    var renderer = window.__TOTEM_CLUSTER_3D_V2__;
    if (renderer && typeof renderer.draw === "function") renderer.draw();
  }

  function renderActivity(event) {
    if (!event || !settings || settings.agentActivityEnabled === false) {
      activityBadge.hidden = true;
      window.__TOTEM_AGENT_ACTIVITY__ = null;
      return;
    }
    window.__TOTEM_AGENT_ACTIVITY__ = event;
    var target = event.componentId || event.featureId || event.moduleId || event.file || event.symbol || event.test || "";
    activityBadge.hidden = false;
    activityBadge.textContent = "AGENT · " + event.type + (target ? " · " + target : "") + (event.summary ? " · " + event.summary : "");
    activityBadge.title = event.timestamp || "";
    var renderer = window.__TOTEM_CLUSTER_3D_V2__;
    if (renderer && typeof renderer.focusActivity === "function") {
      renderer.focusActivity(event, settings.autoExpandAgentFocus !== false);
    } else {
      requestAgentDraw();
    }
    if (!activityAnimation) activityAnimation = window.setInterval(requestAgentDraw, 80);
  }

  async function pollActivity() {
    if (!active || (settings && settings.agentActivityEnabled === false)) return;
    try {
      var response = await fetch(apiUrl("/api/activity?after=" + encodeURIComponent(activitySequence)), { cache: "no-store" });
      if (!response.ok) throw new Error("activity unavailable");
      var payload = await response.json();
      activitySequence = Number(payload.latestSequence || activitySequence);
      var events = Array.isArray(payload.events) ? payload.events : [];
      if (events.length) renderActivity(events[events.length - 1]);
    } catch {
      // Workspace status polling owns connection-state reporting.
    }
  }

  async function submitPrompt() {
    if (!settings || settings.promptEnabled !== true || promptSubmit.disabled) return;
    var prompt = promptInput.value.trim();
    if (!prompt) return;
    promptSubmit.disabled = true;
    var previous = promptSubmit.textContent;
    promptSubmit.textContent = "送出中…";
    try {
      var response = await fetch(apiUrl("/api/prompt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt }),
        cache: "no-store"
      });
      if (!response.ok) {
        var errorPayload = await response.json().catch(function () { return {}; });
        throw new Error(errorPayload.error || "prompt submission failed");
      }
      var payload = await response.json();
      if (payload.event) {
        activitySequence = Math.max(activitySequence, Number(payload.event.sequence || 0));
        renderActivity(payload.event);
      }
      promptInput.value = "";
    } catch (error) {
      liveBadge.textContent = "LIVE LOCAL · " + (error && error.message ? error.message : "prompt failed");
    } finally {
      promptSubmit.textContent = previous;
      promptSubmit.disabled = false;
    }
  }

  async function fetchStatus() {
    var response = await fetch(apiUrl("/api/workspace-status"), { cache: "no-store" });
    if (!response.ok) throw new Error("local api unavailable");
    var payload = await response.json();
    if (!payload || payload.mode !== "local" || !Array.isArray(payload.modules)) throw new Error("not a local workspace response");
    latest = payload;
    if (!active) {
      active = true;
      document.documentElement.dataset.workspaceMode = "local";
      await fetchSettings();
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
        if (activityPolling) {
          window.clearInterval(activityPolling);
          activityPolling = null;
        }
      }
    }
  }

  promptToggle.addEventListener("click", async function () {
    if (!active || !settings) return;
    promptToggle.disabled = true;
    try {
      await updatePromptSetting(settings.promptEnabled !== true);
    } catch (error) {
      liveBadge.textContent = "LIVE LOCAL · " + (error && error.message ? error.message : "settings failed");
    } finally {
      promptToggle.disabled = false;
    }
  });

  promptSubmit.addEventListener("click", function () {
    submitPrompt();
  });

  promptInput.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitPrompt();
  });

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
      var response = await fetch(apiUrl("/api/refresh"), {
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

  localApiBase = discoverLocalApiBase();
  if (!localApiBase) return;
  poll();
  polling = window.setInterval(poll, 5000);
  activityPolling = window.setInterval(pollActivity, 1000);
}());
