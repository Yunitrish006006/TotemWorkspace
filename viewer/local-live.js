(function () {
  "use strict";

  var liveBadge = document.getElementById("liveLocal");
  var changeBadge = document.getElementById("changeIntelligence");
  var adapterBadge = document.getElementById("agentAdapter");
  var orchestrationBadge = document.getElementById("orchestrationState");
  var verificationBadge = document.getElementById("verificationState");
  var activityBadge = document.getElementById("agentActivity");
  var promptToggle = document.getElementById("promptToggle");
  var promptBar = document.getElementById("promptBar");
  var promptInput = document.getElementById("promptInput");
  var promptSubmit = document.getElementById("promptSubmit");
  var codexConsole = document.getElementById("codexConsole");
  var codexConsoleHeader = document.getElementById("codexConsoleHeader");
  var codexConsoleBody = document.getElementById("codexConsoleBody");
  var replayBar = document.getElementById("replayBar");
  var replaySlider = document.getElementById("replaySlider");
  var replayLabel = document.getElementById("replayLabel");
  var replayMeta = document.getElementById("replayMeta");
  var replayLive = document.getElementById("replayLive");
  var statusButton = document.getElementById("localStatus");
  var refreshButton = document.getElementById("refreshLocal");
  var info = document.getElementById("info");
  if (!liveBadge || !changeBadge || !adapterBadge || !orchestrationBadge || !verificationBadge || !activityBadge || !promptToggle || !promptBar || !promptInput || !promptSubmit || !codexConsole || !codexConsoleHeader || !codexConsoleBody || !replayBar || !replaySlider || !replayLabel || !replayMeta || !replayLive || !statusButton || !refreshButton || !info) return;

  var latest = null;
  var settings = null;
  var active = false;
  var polling = null;
  var activityPolling = null;
  var verificationPolling = null;
  var adapterPolling = null;
  var replayPolling = null;
  var conversationPolling = null;
  var replayTimeline = null;
  var latestAdapterStatus = null;
  var replayActive = false;
  var latestLiveActivity = null;
  var latestLiveSemanticActivity = null;
  var codexTranscript = [];
  var activityAnimation = null;
  var changeAnimation = null;
  var verificationAnimation = null;
  var activitySequence = 0;
  var conversationRevision = 0;
  var conversationDraftClientId = "legacy:" + String(Date.now()) + ":" + Math.random().toString(16).slice(2);
  var draftDebounce = null;
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
    var japanese = entry.locales && entry.locales.ja_jp;
    var japaneseState = !japanese || japanese.applicable !== true
      ? "JA n/a"
      : japanese.complete === true
        ? "JA complete"
        : "JA " + (japanese.translatedKeys || 0) + "/" + (japanese.sourceKeys || 0);
    return entry.repoName + "｜" + (entry.branch || "detached") + "｜" + shortSha(entry.head) + "｜" + flags.join(", ") + "｜" + japaneseState;
  }

  function summary(payload) {
    var modules = payload.modules || [];
    var missing = modules.filter(function (entry) { return !entry.present; }).length;
    var dirty = modules.filter(function (entry) { return entry.present && entry.dirty; }).length;
    var drift = modules.filter(function (entry) { return entry.present && !entry.snapshotMatch; }).length;
    var japanese = modules.filter(function (entry) {
      return entry.present && entry.locales && entry.locales.ja_jp && entry.locales.ja_jp.applicable === true;
    });
    var japaneseComplete = japanese.filter(function (entry) { return entry.locales.ja_jp.complete === true; }).length;
    return { modules: modules.length, missing: missing, dirty: dirty, drift: drift, japaneseRequired: japanese.length, japaneseComplete: japaneseComplete };
  }

  function renderBadge(payload) {
    var counts = summary(payload);
    liveBadge.hidden = false;
    promptToggle.hidden = false;
    statusButton.hidden = false;
    refreshButton.hidden = false;
    liveBadge.textContent = "LIVE LOCAL · " + counts.dirty + " dirty · " + counts.drift + " drift" + (counts.missing ? " · " + counts.missing + " missing" : "") + " · JA " + counts.japaneseComplete + "/" + counts.japaneseRequired;
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
    window.__TOTEM_CHANGE_ANIMATIONS__ = settings.changeAnimationsEnabled !== false;
    if (settings.changeAnimationsEnabled === false && changeAnimation) {
      window.clearInterval(changeAnimation);
      changeAnimation = null;
    }
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

  function renderOrchestration(payload) {
    var plan = payload || {};
    var assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
    var roles = assignments.map(function (entry) { return entry.role; });
    var mode = plan.mode || "primary-only";
    var score = Number(plan.score || 0);
    var benefit = plan.estimatedBenefit || "none";
    orchestrationBadge.hidden = false;
    orchestrationBadge.dataset.mode = mode;
    orchestrationBadge.textContent = "ORCH · " + mode + " · score " + score + " · " +
      assignments.length + " subagents · " + (roles.length ? roles.join(", ") : "Primary only") +
      " · benefit " + benefit;
    orchestrationBadge.title = plan.rationale && Array.isArray(plan.rationale.modules)
      ? "Modules: " + plan.rationale.modules.join(", ")
      : "Adaptive orchestration";
  }

  function renderOrchestrationSummary(summary) {
    if (!summary) return;
    var roles = Array.isArray(summary.roles) ? summary.roles : [];
    orchestrationBadge.hidden = false;
    orchestrationBadge.dataset.mode = summary.mode || "primary-only";
    orchestrationBadge.textContent = "ORCH · " + (summary.mode || "primary-only") +
      " · score " + Number(summary.score || 0) +
      " · " + Number(summary.subagents || 0) + " subagents · " +
      (roles.length ? roles.join(", ") : "Primary only") +
      " · benefit " + (summary.estimatedBenefit || "none");
  }

  function codexEventLabel(event) {
    switch (event.type) {
      case "command_started": return "$";
      case "command_completed": return event.status === "failed" ? "[CMD FAIL]" : "[CMD OK]";
      case "tool_started": return "[MCP →]";
      case "tool_completed": return "[MCP ✓]";
      case "file_edit": return "[EDIT]";
      case "web_search_started": return "[WEB →]";
      case "web_search_completed": return "[WEB ✓]";
      case "todo_updated": return "[PLAN]";
      case "agent_message": return "[CODEX]";
      case "usage_updated": return "[TOKENS]";
      case "task_started": return "[START]";
      case "task_completed": return "[DONE]";
      case "task_failed": return "[FAILED]";
      default: return "[" + event.type + "]";
    }
  }

  function activeConsoleTaskId() {
    var adapter = latestAdapterStatus || {};
    if (adapter.currentTask && adapter.currentTask.id) return adapter.currentTask.id;
    if (adapter.lastTask && adapter.lastTask.id) return adapter.lastTask.id;
    var sessions = replayTimeline && Array.isArray(replayTimeline.sessions) ? replayTimeline.sessions : [];
    return sessions.length ? (sessions[sessions.length - 1].taskId || null) : null;
  }

  function renderCodexConsole() {
    var taskId = activeConsoleTaskId();
    if (!taskId) {
      codexConsole.hidden = true;
      codexConsoleBody.replaceChildren();
      return;
    }
    var events = codexTranscript.filter(function (event) { return event.taskId === taskId; });
    if (events.length > 80) events = events.slice(events.length - 80);
    codexConsole.hidden = false;
    codexConsoleHeader.textContent = "CODEX CONSOLE · " + taskId + " · " + events.length + " events";
    codexConsoleBody.replaceChildren();
    events.forEach(function (event) {
      var entry = document.createElement("div");
      entry.className = "codex-console-entry" +
        (event.type === "agent_message" ? " agent-message" : "") +
        (event.type === "task_failed" || event.status === "failed" ? " failed" : "");
      var headline = event.command || event.tool || event.summary || event.file || event.type;
      var lines = [codexEventLabel(event) + " " + headline];
      if (event.detail) lines.push(event.detail);
      if (event.usage) {
        lines.push("input " + (event.usage.inputTokens || 0) +
          " · cached " + (event.usage.cachedInputTokens || 0) +
          " · output " + (event.usage.outputTokens || 0) +
          " · total " + (event.usage.totalTokens || 0));
      }
      entry.textContent = lines.join("\n");
      codexConsoleBody.appendChild(entry);
    });
    codexConsoleBody.scrollTop = codexConsoleBody.scrollHeight;
  }

  function appendCodexTranscript(events) {
    (events || []).forEach(function (event) {
      if (!event || !event.taskId) return;
      codexTranscript.push(event);
    });
    if (codexTranscript.length > 500) codexTranscript.splice(0, codexTranscript.length - 500);
    renderCodexConsole();
  }

  function renderAgentAdapter(payload) {
    var adapter = payload || {};
    latestAdapterStatus = adapter;
    var configured = adapter.configured === true;
    var available = adapter.available === true;
    var busy = adapter.busy === true;
    var sessions = replayTimeline && Array.isArray(replayTimeline.sessions) ? replayTimeline.sessions : [];
    var replaySession = sessions.length ? sessions[sessions.length - 1] : null;
    var task = adapter.currentTask || adapter.lastTask || replaySession;
    var state = busy && adapter.currentTask
      ? "RUNNING"
      : adapter.lastTask
        ? String(adapter.lastTask.state || "unknown").toUpperCase()
        : replaySession
          ? (replaySession.state === "running" ? "INTERRUPTED" : String(replaySession.state || "unknown").toUpperCase())
          : available
            ? "READY"
            : configured
              ? "UNAVAILABLE"
              : "OFF";
    var taskId = task && (task.id || task.taskId);
    adapterBadge.hidden = false;
    adapterBadge.dataset.status = state.toLowerCase();
    adapterBadge.textContent = "AGENT · " + state + (taskId ? " · " + taskId : "");
    var detail = [];
    if (task && task.summary) detail.push(task.summary);
    if (task && (task.completedAt || task.endedAt)) detail.push("ended " + (task.completedAt || task.endedAt));
    if (task && task.error) detail.push(task.error);
    if (state === "INTERRUPTED") detail.push("Replay shows a running task, but this Bridge no longer owns it.");
    adapterBadge.title = detail.join("\n") || adapter.reason || adapter.version || adapter.kind || "";
    var orchestrationTask = adapter.currentTask || adapter.lastTask;
    if (orchestrationTask && orchestrationTask.orchestration) renderOrchestrationSummary(orchestrationTask.orchestration);
    renderCodexConsole();
  }

  async function fetchAgentAdapter() {
    var response = await fetch(apiUrl("/api/agent-adapter"), { cache: "no-store" });
    if (!response.ok) throw new Error("agent adapter unavailable");
    var payload = await response.json();
    renderAgentAdapter(payload);
    return payload;
  }

  async function pollAgentAdapter() {
    if (!active) return;
    try {
      await fetchAgentAdapter();
    } catch {
      // Workspace status polling owns connection-state reporting.
    }
  }

  function requestAgentDraw() {
    var renderer = window.__TOTEM_CLUSTER_3D_V2__;
    if (renderer && typeof renderer.draw === "function") renderer.draw();
  }

  function renderChangeIntelligence(payload) {
    window.__TOTEM_CHANGE_INTELLIGENCE__ = payload || null;
    var gitChanges = payload && Array.isArray(payload.gitChanges) ? payload.gitChanges : [];
    var diff = payload && payload.semanticDiff ? payload.semanticDiff : {};
    var changedIds = payload && Array.isArray(payload.affectedEntityIds)
      ? payload.affectedEntityIds
      : Array.isArray(diff.changedEntityIds) ? diff.changedEntityIds : [];
    var impact = payload && payload.impact ? payload.impact : {};
    var impacted = Array.isArray(impact.impactedModules) ? impact.impactedModules : [];
    var hasChanges = gitChanges.length > 0 || changedIds.length > 0;
    changeBadge.hidden = !hasChanges;
    if (hasChanges) {
      changeBadge.textContent = "CHANGE · " + gitChanges.length + " files · " + changedIds.length + " entities" + (impacted.length ? " · impact " + impacted.length : "");
      changeBadge.title = impacted.length ? "Impacted modules: " + impacted.join(", ") : "Semantic change detected";
    }
    requestAgentDraw();
    if (hasChanges && (!settings || settings.changeAnimationsEnabled !== false) && !changeAnimation) {
      changeAnimation = window.setInterval(requestAgentDraw, 80);
    }
  }

  async function fetchChangeIntelligence(render) {
    var response = await fetch(apiUrl("/api/change-intelligence"), { cache: "no-store" });
    if (!response.ok) throw new Error("change intelligence unavailable");
    var payload = await response.json();
    if (render !== false) renderChangeIntelligence(payload);
    return payload;
  }

  function renderVerificationState(payload) {
    window.__TOTEM_VERIFICATION_STATE__ = payload || null;
    var summary = payload && payload.summary ? payload.summary : {};
    var running = Number(summary.running || 0);
    var passed = Number(summary.passed || 0);
    var failed = Number(summary.failed || 0);
    var unresolved = Number(summary.unresolved || 0);
    var plan = payload && payload.activePlan ? payload.activePlan : {};
    var required = Array.isArray(plan.requiredCategories) ? plan.requiredCategories.length : 0;
    var visible = running > 0 || passed > 0 || failed > 0 || required > 0;
    verificationBadge.hidden = !visible;
    verificationBadge.dataset.status = failed > 0 ? "failed" : running > 0 ? "running" : "passed";
    verificationBadge.textContent = "VERIFY · " + (failed > 0 ? "FAIL " + failed : running > 0 ? "RUN " + running : passed > 0 ? "PASS " + passed : "READY") +
      " · " + passed + " passed · " + failed + " failed" + (required ? " · required " + required : "");
    verificationBadge.title = unresolved ? unresolved + " unresolved test target(s)" : "Live verification state";
    requestAgentDraw();

    if ((running > 0 || failed > 0) && !verificationAnimation) {
      verificationAnimation = window.setInterval(requestAgentDraw, 80);
    } else if (running === 0 && failed === 0 && verificationAnimation) {
      window.clearInterval(verificationAnimation);
      verificationAnimation = null;
    }
  }

  async function fetchVerificationState() {
    var response = await fetch(apiUrl("/api/verification-state"), { cache: "no-store" });
    if (!response.ok) throw new Error("verification state unavailable");
    var payload = await response.json();
    renderVerificationState(payload);
    return payload;
  }

  async function pollVerification() {
    if (!active || replayActive) return;
    try {
      await fetchVerificationState();
    } catch {
      // Verification is independent from workspace connection-state reporting.
    }
  }

  function hasSemanticTarget(event) {
    return !!(event && (event.componentId || event.featureId || event.moduleId));
  }

  function isSemanticEdit(event) {
    return !!(event && (event.type === "file_edit" || event.type === "symbol_edit" || event.type === "git_diff_updated"));
  }

  function renderActivity(event) {
    if (!event || !settings || settings.agentActivityEnabled === false) {
      activityBadge.hidden = true;
      window.__TOTEM_AGENT_ACTIVITY__ = null;
      return;
    }
    var activeTask = window.__TOTEM_AGENT_ADAPTER__ && window.__TOTEM_AGENT_ADAPTER__.currentTask
      ? window.__TOTEM_AGENT_ADAPTER__.currentTask
      : null;
    if (isSemanticEdit(event) && hasSemanticTarget(event)) {
      latestLiveSemanticActivity = event;
    }
    if ((event.type === "task_completed" || event.type === "task_failed") &&
        latestLiveSemanticActivity && latestLiveSemanticActivity.taskId === event.taskId) {
      latestLiveSemanticActivity = null;
    }
    // A graph pulse denotes an executing task, never the latest historical edit.
    // Without this guard, reopening the viewer could leave the last module pulsing
    // indefinitely after Codex had already completed the task.
    var semanticFocus = activeTask && latestLiveSemanticActivity &&
      latestLiveSemanticActivity.taskId === activeTask.id
      ? latestLiveSemanticActivity
      : null;
    window.__TOTEM_AGENT_ACTIVITY__ = semanticFocus && hasSemanticTarget(semanticFocus) ? semanticFocus : null;
    var target = event.componentId || event.featureId || event.moduleId || event.file || event.symbol || event.test || "";
    activityBadge.hidden = false;
    activityBadge.textContent = "AGENT · " + event.type + (target ? " · " + target : "") + (event.summary ? " · " + event.summary : "");
    activityBadge.title = event.timestamp || "";
    var renderer = window.__TOTEM_CLUSTER_3D_V2__;
    if (window.__TOTEM_AGENT_ACTIVITY__ && renderer && typeof renderer.focusActivity === "function") {
      renderer.focusActivity(window.__TOTEM_AGENT_ACTIVITY__, settings.autoExpandAgentFocus !== false);
    } else if (renderer && typeof renderer.draw === "function") {
      renderer.draw();
    } else {
      requestAgentDraw();
    }
    if (window.__TOTEM_AGENT_ACTIVITY__) {
      if (!activityAnimation) activityAnimation = window.setInterval(requestAgentDraw, 80);
    } else if (activityAnimation) {
      window.clearInterval(activityAnimation);
      activityAnimation = null;
    }
  }

  async function pollActivity() {
    if (!active || (settings && settings.agentActivityEnabled === false)) return;
    try {
      var response = await fetch(apiUrl("/api/activity?after=" + encodeURIComponent(activitySequence)), { cache: "no-store" });
      if (!response.ok) throw new Error("activity unavailable");
      var payload = await response.json();
      activitySequence = Number(payload.latestSequence || activitySequence);
      var events = Array.isArray(payload.events) ? payload.events : [];
      if (events.length) {
        appendCodexTranscript(events);
        events.forEach(function (event) {
          if (isSemanticEdit(event) && hasSemanticTarget(event)) latestLiveSemanticActivity = event;
          if ((event.type === "task_completed" || event.type === "task_failed") &&
              latestLiveSemanticActivity && latestLiveSemanticActivity.taskId === event.taskId) {
            latestLiveSemanticActivity = null;
          }
        });
        latestLiveActivity = events[events.length - 1];
        if (!replayActive) renderActivity(latestLiveActivity);
      }
    } catch {
      // Workspace status polling owns connection-state reporting.
    }
  }

  function conversationEvents(entries) {
    return entries.map(function (entry) {
      return {
        sequence: 900000000 + Number(entry.revision || 0),
        timestamp: entry.timestamp || "",
        type: "agent_message",
        source: entry.source || "workspace",
        summary: "[" + String(entry.source || "workspace").toUpperCase() + "] " + (entry.text || ""),
        taskId: entry.taskId || null
      };
    });
  }

  async function pollConversation() {
    if (!active || !settings || settings.promptEnabled !== true) return;
    try {
      var response = await fetch(apiUrl("/api/conversation?after=" + encodeURIComponent(conversationRevision)), { cache: "no-store" });
      if (!response.ok) throw new Error("conversation unavailable");
      var payload = await response.json();
      conversationRevision = Number(payload.latestRevision || conversationRevision);
      var events = conversationEvents(Array.isArray(payload.entries) ? payload.entries : []);
      if (events.length) appendCodexTranscript(events);
      var draft = payload.draft;
      if (draft && draft.clientId !== conversationDraftClientId) {
        activityBadge.hidden = false;
        activityBadge.textContent = "DISCORD DRAFT · " + draft.text;
      }
    } catch {
      // Activity/status polling continues when the optional conversation surface is unavailable.
    }
  }

  function publishDraft() {
    if (!active || !settings || settings.promptEnabled !== true) return;
    if (draftDebounce) window.clearTimeout(draftDebounce);
    draftDebounce = window.setTimeout(function () {
      fetch(apiUrl("/api/conversation/draft"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: conversationDraftClientId, text: promptInput.value }),
        cache: "no-store"
      }).catch(function () {});
    }, 450);
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
        body: JSON.stringify({ prompt: prompt, clientId: conversationDraftClientId }),
        cache: "no-store"
      });
      if (!response.ok) {
        var errorPayload = await response.json().catch(function () { return {}; });
        throw new Error(errorPayload.error || "prompt submission failed");
      }
      var payload = await response.json();
      if (payload.event) {
        activitySequence = Math.max(activitySequence, Number(payload.event.sequence || 0));
        appendCodexTranscript([payload.event]);
        renderActivity(payload.event);
      }
      if (payload.orchestration) renderOrchestration(payload.orchestration);
      if (payload.adapter) renderAgentAdapter(payload.adapter);
      if (payload.execution === "agent-adapter-unavailable") {
        liveBadge.textContent = "LIVE LOCAL · prompt recorded · agent adapter unavailable";
      }
      promptInput.value = "";
      publishDraft();
    } catch (error) {
      liveBadge.textContent = "LIVE LOCAL · " + (error && error.message ? error.message : "prompt failed");
    } finally {
      promptSubmit.textContent = previous;
      promptSubmit.disabled = false;
    }
  }

  function renderReplayTimeline(payload) {
    replayTimeline = payload || null;
    if (latestAdapterStatus) renderAgentAdapter(latestAdapterStatus);
    else renderCodexConsole();
    var hasEvents = payload && Number(payload.eventCount || 0) > 0;
    replayBar.hidden = !hasEvents || !settings || settings.replayEnabled === false;
    if (!hasEvents) return;
    replaySlider.min = String(payload.earliestSequence || 0);
    replaySlider.max = String(Math.max(Number(payload.latestSequence || 0), Number(payload.earliestSequence || 0) + 1));
    replaySlider.step = "1";
    if (!replayActive) replaySlider.value = String(payload.latestSequence || 0);
    replayMeta.textContent = Number(payload.eventCount || 0) + " events · " +
      (Array.isArray(payload.sessions) ? payload.sessions.length : 0) + " sessions · " +
      (Array.isArray(payload.milestones) ? payload.milestones.length : 0) + " milestones";
    replayLabel.textContent = replayActive ? "REPLAY · #" + replaySlider.value : "REPLAY · LIVE";
    replayLive.disabled = !replayActive;
  }

  async function fetchReplayTimeline() {
    var response = await fetch(apiUrl("/api/replay"), { cache: "no-store" });
    if (!response.ok) throw new Error("development replay unavailable");
    var payload = await response.json();
    renderReplayTimeline(payload);
    return payload;
  }

  async function fetchReplayFrame(sequence) {
    var response = await fetch(apiUrl("/api/replay/frame?sequence=" + encodeURIComponent(sequence)), { cache: "no-store" });
    if (!response.ok) throw new Error("replay frame unavailable");
    return response.json();
  }

  async function selectReplay(sequence) {
    if (!replayTimeline) return;
    var latest = Number(replayTimeline.latestSequence || 0);
    if (Number(sequence) >= latest) {
      await goReplayLive();
      return;
    }
    var frame = await fetchReplayFrame(sequence);
    replayActive = frame.live !== true;
    replaySlider.value = String(frame.sequence || sequence);
    replayLabel.textContent = replayActive ? "REPLAY · #" + replaySlider.value : "REPLAY · LIVE";
    replayLive.disabled = !replayActive;
    window.__TOTEM_REPLAY_GRAPH_STATE__ = frame.graphState || null;
    renderChangeIntelligence(frame.changeIntelligence || null);
    renderVerificationState(frame.verificationState || null);
    renderActivity(frame.activity || null);
    requestAgentDraw();
  }

  async function goReplayLive() {
    replayActive = false;
    window.__TOTEM_REPLAY_GRAPH_STATE__ = null;
    if (replayTimeline) {
      replaySlider.value = String(replayTimeline.latestSequence || 0);
      replayLabel.textContent = "REPLAY · LIVE";
    }
    replayLive.disabled = true;
    var results = await Promise.all([
      fetchChangeIntelligence(false),
      fetchVerificationState(),
      fetch(apiUrl("/api/activity?after=0"), { cache: "no-store" }).then(function (response) {
        if (!response.ok) throw new Error("activity unavailable");
        return response.json();
      })
    ]);
    renderChangeIntelligence(results[0]);
    var events = Array.isArray(results[2].events) ? results[2].events : [];
    latestLiveActivity = events.length ? events[events.length - 1] : null;
    renderActivity(latestLiveActivity);
    requestAgentDraw();
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
      if (!replayActive) await fetchChangeIntelligence();
    } catch {
      if (!active && polling) {
        window.clearInterval(polling);
        polling = null;
        if (activityPolling) {
          window.clearInterval(activityPolling);
          activityPolling = null;
        }
        if (verificationPolling) {
          window.clearInterval(verificationPolling);
          verificationPolling = null;
        }
        if (adapterPolling) {
          window.clearInterval(adapterPolling);
          adapterPolling = null;
        }
        if (replayPolling) {
          window.clearInterval(replayPolling);
          replayPolling = null;
        }
        if (conversationPolling) {
          window.clearInterval(conversationPolling);
          conversationPolling = null;
        }
      }
    }
  }

  replaySlider.addEventListener("input", function () {
    replayLabel.textContent = Number(replaySlider.value) >= Number(replaySlider.max)
      ? "REPLAY · LIVE"
      : "REPLAY · #" + replaySlider.value;
  });

  replaySlider.addEventListener("change", function () {
    selectReplay(Number(replaySlider.value)).catch(function (error) {
      liveBadge.textContent = "LIVE LOCAL · " + (error && error.message ? error.message : "replay failed");
    });
  });

  replayLive.addEventListener("click", function () {
    goReplayLive().catch(function (error) {
      liveBadge.textContent = "LIVE LOCAL · " + (error && error.message ? error.message : "replay live failed");
    });
  });

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
    if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
    event.preventDefault();
    submitPrompt();
  });

  promptInput.addEventListener("input", publishDraft);

  statusButton.addEventListener("click", function () {
    if (!latest) return;
    var counts = summary(latest);
    setInfo(
      "LIVE LOCAL workspace",
      counts.modules + " modules · " + counts.dirty + " dirty · " + counts.drift + " snapshot drift · " + counts.missing + " missing · JA " + counts.japaneseComplete + "/" + counts.japaneseRequired + " complete",
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
  verificationPolling = window.setInterval(pollVerification, 2000);
  adapterPolling = window.setInterval(pollAgentAdapter, 2000);
  replayPolling = window.setInterval(function () {
    if (active && settings && settings.replayEnabled !== false) {
      fetchReplayTimeline().catch(function () {});
    }
  }, 3000);
  conversationPolling = window.setInterval(pollConversation, 1000);
  pollVerification();
  pollAgentAdapter();
  fetchReplayTimeline().catch(function () {});
  pollConversation();
}());
