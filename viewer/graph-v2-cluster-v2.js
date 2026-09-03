(function () {
  "use strict";

  var DATA = window.__TOTEM_GRAPH_DATA__;
  var base = document.getElementById("graph3d");
  var pane = document.getElementById("pane3d");
  var info = document.getElementById("info");
  if (!DATA || !base || !pane) return;

  var previous = document.getElementById("graph3dCluster");
  if (previous) previous.remove();

  var canvas = document.createElement("canvas");
  canvas.id = "graph3dClusterV2";
  canvas.className = "canvas3d cluster3d";
  canvas.setAttribute("aria-label", "TOTEM 3D module cluster preview");
  pane.insertBefore(canvas, base.nextSibling);
  base.style.display = "none";

  var modules = DATA.modules || [];
  var externals = DATA.externalNodes || [];
  var features = DATA.features || [];
  var contracts = DATA.contracts || [];
  var capabilities = DATA.sharedCapabilities || [];
  var code = DATA.code || { nodes: [] };

  var moduleMap = new Map(modules.map(function (x) { return [x.id, x]; }));
  var featureMap = new Map(features.map(function (x) { return [x.id, x]; }));
  var contractMap = new Map(contracts.map(function (x) { return [x.id, x]; }));

  var expanded = new Set();
  var spotlightId = null;
  var lastHits = [];
  var pointers = new Map();
  var cam = { yaw: -0.48, pitch: 0.22, zoom: 1.02, panX: 0, panY: 0 };
  var gesture = {
    pinching: false,
    startDistance: 0,
    startZoom: 1,
    lastCentroid: null,
    suppressClick: false
  };

  function short(value, max) {
    value = String(value || "");
    return value.length > max ? value.slice(0, max - 1) + "…" : value;
  }

  function rankOf(node) {
    return Number(node.rankHint || 4);
  }

  function moduleShort(id) {
    var module = moduleMap.get(id);
    var name = module ? (module.name || id) : id;
    return name.replace(/^Totem/, "");
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function project(point, width, height) {
    var cy = Math.cos(cam.yaw);
    var sy = Math.sin(cam.yaw);
    var cp = Math.cos(cam.pitch);
    var sp = Math.sin(cam.pitch);
    var x = point.x * cy - point.z * sy;
    var z = point.x * sy + point.z * cy;
    var y = point.y * cp - z * sp;
    z = point.y * sp + z * cp;
    var scale = cam.zoom * 820 / Math.max(200, 920 + z);
    return {
      x: width / 2 + cam.panX + x * scale,
      y: height / 2 + cam.panY + y * scale,
      scale: scale,
      z: z
    };
  }

  function fib(index, count, radius) {
    count = Math.max(1, count);
    var y = 1 - 2 * ((index + 0.5) / count);
    var ring = Math.sqrt(Math.max(0, 1 - y * y));
    var theta = index * Math.PI * (3 - Math.sqrt(5));
    return {
      x: Math.cos(theta) * ring * radius,
      y: y * radius,
      z: Math.sin(theta) * ring * radius
    };
  }

  function hashUnit(text, salt) {
    var h = (2166136261 ^ (salt || 0)) >>> 0;
    var value = String(text || "");
    for (var i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    return (h >>> 0) / 4294967295;
  }

  function manualFeatureFor(moduleId) {
    return features.find(function (feature) {
      return feature.ownerId === moduleId && /manual|手冊/i.test((feature.title || "") + " " + (feature.summary || ""));
    }) || null;
  }

  function clusterRadius(moduleId) {
    var featureCount = features.filter(function (f) { return f.ownerId === moduleId; }).length;
    var categoryCount = (code.nodes || []).filter(function (n) {
      return n.moduleId === moduleId && n.type === "code-category";
    }).length;
    var syntheticCapabilityCount = capabilities.filter(function (capability) {
      return capability.consumerModuleId === moduleId && !manualFeatureFor(moduleId);
    }).length;
    var count = Math.max(1, featureCount + categoryCount + syntheticCapabilityCount);
    return Math.min(245, 118 + Math.sqrt(count) * 27);
  }

  function moduleOrbitRadius(count) {
    return count <= 0 ? 330 : Math.min(630, 430 + Math.sqrt(count) * 55);
  }

  function band(type) {
    if (type === "category") return [0.72, 0.96];
    if (type === "capability") return [0.56, 0.78];
    return [0.34, 0.64];
  }

  function scatter(parent, id, type, radius) {
    var u = hashUnit(id, 17);
    var v = hashUnit(id, 53);
    var q = hashUnit(id, 97);
    var z = 2 * u - 1;
    var ring = Math.sqrt(Math.max(0, 1 - z * z));
    var theta = 2 * Math.PI * v;
    var range = band(type);
    var rr = radius * (range[0] + (range[1] - range[0]) * q);
    return {
      x: parent.x + ring * Math.cos(theta) * rr,
      y: parent.y + z * rr,
      z: parent.z + ring * Math.sin(theta) * rr
    };
  }

  function isRetargetable(contract) {
    return Boolean(contract && (
      contract.type === "fabric-suggests" ||
      contract.type === "runtime-optional" ||
      (contract.type === "hard-core" && (contract.featureIds || []).length > 0)
    ));
  }

  function featureIdsForOwner(contract, ownerId) {
    return (contract.featureIds || []).filter(function (id) {
      var feature = featureMap.get(id);
      return feature && feature.ownerId === ownerId;
    });
  }

  function endpoints(contract, ownerId) {
    if (!expanded.has(ownerId)) return [ownerId];
    var ids = featureIdsForOwner(contract, ownerId);
    return ids.length ? ids : [ownerId];
  }

  function addContractEdges(edges, contract) {
    if (!contract.from || !contract.to) return;
    if (!isRetargetable(contract) || (contract.featureIds || []).length === 0) {
      edges.push({
        id: contract.id,
        from: contract.from,
        to: contract.to,
        type: contract.type,
        label: contract.feature || contract.id,
        retargeted: false
      });
      return;
    }
    var fromIds = endpoints(contract, contract.from);
    var toIds = endpoints(contract, contract.to);
    fromIds.forEach(function (from) {
      toIds.forEach(function (to) {
        edges.push({
          id: contract.id + ":" + from + ":" + to,
          from: from,
          to: to,
          type: contract.type,
          label: contract.feature || contract.id,
          retargeted: from !== contract.from || to !== contract.to
        });
      });
    });
  }

  function capabilityConsumerEndpoint(capability) {
    var explicit = capability.consumerFeatureId && featureMap.get(capability.consumerFeatureId);
    var inferred = explicit || manualFeatureFor(capability.consumerModuleId);
    if (expanded.has(capability.consumerModuleId) && inferred) return inferred.id;
    return "capability-node:" + capability.id;
  }

  function scene() {
    var nodes = [];
    var edges = [];
    var clusters = [];
    var expandedCount = expanded.size;
    var moduleRadius = moduleOrbitRadius(expandedCount);
    var externalRadius = moduleRadius + 280;

    var sortedModules = modules.slice().sort(function (a, b) {
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
    sortedModules.forEach(function (module, index) {
      var position = fib(index, sortedModules.length, moduleRadius);
      nodes.push({
        id: module.id,
        label: module.name || module.id,
        type: "module",
        rank: rankOf(module),
        ownerId: module.id,
        x: position.x,
        y: position.y,
        z: position.z,
        source: module
      });
    });

    externals.slice().sort(function (a, b) {
      return (a.name || a.id).localeCompare(b.name || b.id);
    }).forEach(function (external, index, list) {
      var position = fib(index + 0.65, Math.max(1, list.length + 1), externalRadius);
      nodes.push({
        id: external.id,
        label: external.name || external.id,
        type: "external",
        rank: rankOf(external),
        x: position.x,
        y: position.y,
        z: position.z,
        source: external
      });
    });

    expanded.forEach(function (moduleId) {
      var parent = nodes.find(function (node) { return node.id === moduleId; });
      if (!parent) return;

      var moduleFeatures = features.filter(function (feature) { return feature.ownerId === moduleId; });
      var categories = (code.nodes || []).filter(function (node) {
        return node.moduleId === moduleId && node.type === "code-category";
      });
      var moduleCaps = capabilities.filter(function (capability) {
        return capability.consumerModuleId === moduleId;
      });
      var syntheticCaps = moduleCaps.filter(function (capability) {
        return capabilityConsumerEndpoint(capability).indexOf("capability-node:") === 0;
      });
      var radius = clusterRadius(moduleId);

      clusters.push({
        ownerId: moduleId,
        radius: radius,
        childCount: moduleFeatures.length + categories.length + syntheticCaps.length
      });

      moduleFeatures.forEach(function (feature) {
        var position = scatter(parent, feature.id, "feature", radius);
        nodes.push({
          id: feature.id,
          label: moduleShort(moduleId) + " · " + feature.title,
          type: "feature",
          ownerId: moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: feature
        });
        edges.push({
          id: "owner:" + feature.id,
          from: moduleId,
          to: feature.id,
          type: "feature-detail",
          label: "curated feature"
        });
      });

      syntheticCaps.forEach(function (capability) {
        var id = "capability-node:" + capability.id;
        var position = scatter(parent, id, "capability", radius);
        nodes.push({
          id: id,
          label: moduleShort(moduleId) + " · SHARED MANUAL",
          type: "capability",
          ownerId: moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: capability
        });
        edges.push({
          id: "owner:" + id,
          from: moduleId,
          to: id,
          type: "feature-detail",
          label: "shared capability"
        });
      });

      categories.forEach(function (category) {
        var position = scatter(parent, category.id, "category", radius);
        nodes.push({
          id: category.id,
          label: moduleShort(moduleId) + " · CODE · " + category.label,
          type: "category",
          ownerId: moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: category
        });
        edges.push({
          id: "owner:" + category.id,
          from: moduleId,
          to: category.id,
          type: "detail",
          label: "generated code"
        });
      });
    });

    contracts.forEach(function (contract) { addContractEdges(edges, contract); });

    capabilities.forEach(function (capability) {
      if (!expanded.has(capability.consumerModuleId)) return;
      var from = capabilityConsumerEndpoint(capability);
      var to = capability.providerModuleId;
      if (
        expanded.has(capability.providerModuleId) &&
        capability.providerFeatureId &&
        featureMap.has(capability.providerFeatureId)
      ) {
        to = capability.providerFeatureId;
      }
      edges.push({
        id: capability.id,
        from: from,
        to: to,
        type: "shared-capability",
        label: capability.label,
        retargeted: true,
        source: capability
      });
    });

    return { nodes: nodes, edges: edges, clusters: clusters };
  }

  function rounded(ctx, x, y, width, height, radius) {
    var rr = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + width, y, x + width, y + height, rr);
    ctx.arcTo(x + width, y + height, x, y + height, rr);
    ctx.arcTo(x, y + height, x, y, rr);
    ctx.arcTo(x, y, x + width, y, rr);
    ctx.closePath();
  }

  function edgeColor(edge) {
    if (edge.type === "hard-core") return "#60a5fa";
    if (edge.type === "fabric-suggests") return "#fbbf24";
    if (edge.type === "external-service") return "#22d3ee";
    if (edge.type === "shared-capability") return "#f472b6";
    if (edge.type === "detail") return "#34d399";
    if (edge.type === "feature-detail") return "#64748b";
    return "#a78bfa";
  }

  function owner(node) {
    return node ? (node.ownerId || (node.type === "module" ? node.id : null)) : null;
  }

  function relatedOwners(currentScene) {
    var result = new Set();
    var byId = new Map(currentScene.nodes.map(function (node) { return [node.id, node]; }));
    if (!spotlightId) return result;
    currentScene.edges.forEach(function (edge) {
      if (edge.from !== spotlightId && edge.to !== spotlightId) return;
      var other = edge.from === spotlightId ? edge.to : edge.from;
      var relatedOwner = owner(byId.get(other));
      if (relatedOwner) result.add(relatedOwner);
    });
    return result;
  }

  function clusterColor(id) {
    var module = moduleMap.get(id);
    return module && rankOf(module) === 3 ? "#22d3ee" : "#60a5fa";
  }

  function drawCluster(ctx, cluster, projected, state) {
    var radius = Math.max(42, cluster.radius * projected.scale);
    var stroke = clusterColor(cluster.ownerId);
    var alpha = state === "active" ? 0.78 : state === "related" ? 0.42 : state === "dim" ? 0.10 : 0.28;
    var fillAlpha = state === "active" ? 0.12 : state === "related" ? 0.065 : state === "dim" ? 0.015 : 0.035;

    ctx.save();
    ctx.fillStyle = stroke;
    ctx.globalAlpha = fillAlpha;
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = stroke;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = state === "active" ? 2.6 : 1.35;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = alpha * 0.38;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(projected.x, projected.y, radius * 0.78, radius * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(projected.x, projected.y, radius * 0.22, radius * 0.78, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = Math.max(0.3, alpha);
    ctx.font = (state === "active" ? "700 " : "") + "10px system-ui";
    ctx.fillStyle = "#c9ddf3";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(moduleShort(cluster.ownerId) + " cluster · " + cluster.childCount + " nodes", projected.x, projected.y - radius - 6);
    ctx.restore();
  }

  function connectedToSpotlight(currentScene, id) {
    return !spotlightId || id === spotlightId || currentScene.edges.some(function (edge) {
      return (edge.from === spotlightId || edge.to === spotlightId) && (edge.from === id || edge.to === id);
    });
  }

  function drawChild(ctx, node, projected, selected, connected) {
    var radius = node.type === "capability" ? 6 : node.type === "category" ? 4.5 : 5.25;
    var stroke = selected ? "#ffffff" : node.type === "capability" ? "#f472b6" : node.type === "category" ? "#34d399" : ((node.source && node.source.softContractIds) || []).length ? "#fbbf24" : "#8095ad";
    var fill = node.type === "capability" ? "#f472b6" : node.type === "category" ? "#34d399" : "#93c5fd";
    var text = short(node.label, 40);

    ctx.globalAlpha = spotlightId ? (connected ? 1 : 0.22) : 1;
    if (selected) {
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.8;
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur = selected ? 14 : 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.font = (selected ? "700 " : "") + "10.5px system-ui";
    var textWidth = Math.min(245, ctx.measureText(text).width + 12);
    var x = projected.x + radius + 5;
    var y = projected.y - 10;
    rounded(ctx, x, y, textWidth, 20, 6);
    ctx.fillStyle = selected ? "#11263cf2" : "#071522d9";
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = spotlightId ? (connected ? 1 : 0.18) : 0.82;
    ctx.lineWidth = selected ? 1.5 : 0.8;
    ctx.stroke();
    ctx.fillStyle = "#e7f1fb";
    ctx.globalAlpha = spotlightId ? (connected ? 1 : 0.3) : 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 6, projected.y);
    ctx.globalAlpha = 1;

    return {
      w: radius * 2 + 5 + textWidth,
      h: 28,
      cx: projected.x + (radius * 2 + 5 + textWidth) / 2 - radius
    };
  }

  function drawLabel(ctx, text, x, y, active) {
    ctx.font = (active ? "700 " : "") + "10px system-ui";
    var width = Math.min(260, ctx.measureText(text).width + 12);
    rounded(ctx, x - width / 2, y - 9, width, 18, 6);
    ctx.fillStyle = active ? "#0f2032f7" : "#071522dc";
    ctx.fill();
    ctx.fillStyle = active ? "#fff" : "#cbd5e1";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(short(text, 38), x, y);
  }

  function draw() {
    if (pane.hidden) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var width = rect.width;
    var height = rect.height;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#050b14";
    ctx.fillRect(0, 0, width, height);

    var currentScene = scene();
    var projected = new Map();
    var byId = new Map(currentScene.nodes.map(function (node) { return [node.id, node]; }));
    currentScene.nodes.forEach(function (node) {
      projected.set(node.id, project(node, width, height));
    });

    var spotlightOwner = owner(byId.get(spotlightId));
    var related = relatedOwners(currentScene);
    currentScene.clusters.forEach(function (cluster) {
      var p = projected.get(cluster.ownerId);
      if (!p) return;
      var state = !spotlightId ? "normal" : cluster.ownerId === spotlightOwner ? "active" : related.has(cluster.ownerId) ? "related" : "dim";
      drawCluster(ctx, cluster, p, state);
    });

    var labels = [];
    currentScene.edges.forEach(function (edge) {
      var a = projected.get(edge.from);
      var b = projected.get(edge.to);
      if (!a || !b) return;
      var active = !spotlightId || edge.from === spotlightId || edge.to === spotlightId;
      var relation = edge.type === "shared-capability" || edge.retargeted;
      var internal = edge.type === "detail" || edge.type === "feature-detail";

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = edgeColor(edge);
      ctx.globalAlpha = spotlightId ? (active ? 1 : 0.055) : (relation ? 0.82 : internal ? 0.16 : 0.34);
      ctx.lineWidth = spotlightId && active ? 4.6 : relation ? 2.6 : internal ? 1.15 : 1.45;
      ctx.stroke();

      if ((relation || (active && spotlightId)) && edge.label) {
        labels.push({ text: edge.label, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, active: active });
      }
    });

    ctx.globalAlpha = 1;
    lastHits = [];
    currentScene.nodes.slice().sort(function (a, b) {
      return projected.get(a.id).z - projected.get(b.id).z;
    }).forEach(function (node) {
      var p = projected.get(node.id);
      var child = node.type === "feature" || node.type === "category" || node.type === "capability";
      var selected = spotlightId === node.id;
      var connected = connectedToSpotlight(currentScene, node.id);

      if (child) {
        var hit = drawChild(ctx, node, p, selected, connected);
        lastHits.push({ node: node, x: hit.cx, y: p.y, w: hit.w, h: hit.h, z: p.z });
        return;
      }

      var radius = Math.max(8, 12 * p.scale);
      var isExpanded = node.type === "module" && expanded.has(node.id);
      ctx.globalAlpha = spotlightId ? (connected ? 0.92 : 0.28) : 1;
      if (isExpanded || selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + (isExpanded ? 9 : 7), 0, Math.PI * 2);
        ctx.strokeStyle = selected ? "#fff" : clusterColor(node.id);
        ctx.lineWidth = isExpanded ? 3.1 : 2.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.type === "external" ? "#fbbf24" : node.rank === 3 ? "#22d3ee" : "#60a5fa";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = isExpanded ? 13 : 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = (isExpanded ? "700 " : "") + "12px system-ui";
      ctx.fillStyle = "#dbeafe";
      ctx.fillText(short(node.label, 25), p.x + radius + 6, p.y + 4);
      ctx.globalAlpha = 1;
      lastHits.push({ node: node, x: p.x, y: p.y, w: Math.max(32, radius * 2 + 12), h: Math.max(32, radius * 2 + 12), z: p.z });
    });

    labels.forEach(function (label) {
      drawLabel(ctx, label.text, label.x, label.y, label.active);
    });
    lastHits.sort(function (a, b) { return b.z - a.z; });
  }

  function hit(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var best = null;
    var bestDistance = Infinity;
    lastHits.forEach(function (candidate) {
      if (x < candidate.x - candidate.w / 2 || x > candidate.x + candidate.w / 2 || y < candidate.y - candidate.h / 2 || y > candidate.y + candidate.h / 2) return;
      var dx = x - candidate.x;
      var dy = y - candidate.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
    return best;
  }

  function setInfo(title, body, sections) {
    document.getElementById("infoTitle").textContent = title;
    document.getElementById("infoBody").textContent = body || "";
    var box = document.getElementById("infoContent");
    box.replaceChildren();
    (sections || []).forEach(function (section) {
      if (!(section.items || []).length) return;
      var heading = document.createElement("h3");
      heading.textContent = section.title;
      box.appendChild(heading);
      section.items.forEach(function (text) {
        var item = document.createElement("div");
        item.className = "item";
        item.textContent = text;
        box.appendChild(item);
      });
    });
    info.hidden = false;
  }

  function manualLinksForFeature(featureId) {
    return capabilities.filter(function (capability) {
      var consumerFeature = capability.consumerFeatureId && featureMap.get(capability.consumerFeatureId);
      consumerFeature = consumerFeature || manualFeatureFor(capability.consumerModuleId);
      return capability.providerFeatureId === featureId || (consumerFeature && consumerFeature.id === featureId);
    });
  }

  function showNode(node) {
    if (node.type === "module") {
      spotlightId = null;
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
      setInfo((node.source && node.source.name) || node.label, (node.source && node.source.role) || "", [{
        title: "3D cluster",
        items: [
          expanded.has(node.id) ? "Expanded cluster" : "Collapsed",
          "Cluster radius: " + Math.round(clusterRadius(node.id)),
          "Module orbit radius: " + Math.round(moduleOrbitRadius(expanded.size)),
          "Expanded modules: " + expanded.size
        ]
      }]);
      draw();
      return;
    }

    spotlightId = node.id;
    if (node.type === "feature") {
      var feature = node.source || {};
      var soft = (feature.softContractIds || []).map(function (id) { return contractMap.get(id); }).filter(Boolean);
      var hard = contracts.filter(function (contract) {
        return contract.type === "hard-core" && (contract.featureIds || []).includes(feature.id);
      });
      var manualLinks = manualLinksForFeature(feature.id);
      setInfo(node.label, feature.summary || "", [
        {
          title: "Shared Manual links",
          items: manualLinks.map(function (capability) {
            return moduleShort(capability.consumerModuleId) + " ↔ " + moduleShort(capability.providerModuleId) + "｜" + capability.label;
          })
        },
        {
          title: "Core API links",
          items: hard.map(function (contract) {
            return (contract.feature || contract.id) + "｜" + moduleShort(contract.from) + " → " + moduleShort(contract.to);
          })
        },
        {
          title: "Soft integrations",
          items: soft.map(function (contract) {
            return (contract.feature || contract.id) + "｜" + moduleShort(contract.from) + " → " + moduleShort(contract.to);
          })
        }
      ]);
    } else if (node.type === "capability") {
      var capability = node.source || {};
      setInfo(node.label, capability.consumerLabel + " → " + capability.providerLabel, [{
        title: "Live code evidence",
        items: capability.evidencePaths || []
      }]);
    } else if (node.type === "category") {
      setInfo(node.label, "Generated code category", [{
        title: "Metadata",
        items: ["files: " + ((node.source && node.source.count) || 0)]
      }]);
    } else {
      setInfo(node.label, "External node", []);
    }
    draw();
  }

  function distance() {
    var touchPointers = Array.from(pointers.values()).filter(function (pointer) { return pointer.pointerType !== "mouse"; });
    if (touchPointers.length < 2) return 0;
    var dx = touchPointers[0].x - touchPointers[1].x;
    var dy = touchPointers[0].y - touchPointers[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function centroid() {
    var touchPointers = Array.from(pointers.values()).filter(function (pointer) { return pointer.pointerType !== "mouse"; });
    if (touchPointers.length < 2) return null;
    return {
      x: (touchPointers[0].x + touchPointers[1].x) / 2,
      y: (touchPointers[0].y + touchPointers[1].y) / 2
    };
  }

  function clamp(value, limit) {
    return Math.max(-limit, Math.min(limit, value));
  }

  function panBy(dx, dy) {
    var rect = canvas.getBoundingClientRect();
    cam.panX = clamp(cam.panX + dx, Math.max(160, rect.width * 0.75));
    cam.panY = clamp(cam.panY + dy, Math.max(160, rect.height * 0.75));
  }

  canvas.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  canvas.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
    if (event.pointerType === "mouse" && event.button === 2) event.preventDefault();

    var mode = event.pointerType === "mouse" && event.button === 2 ? "pan" : "rotate";
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerType: event.pointerType,
      mode: mode
    });
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");

    var touchCount = Array.from(pointers.values()).filter(function (pointer) { return pointer.pointerType !== "mouse"; }).length;
    if (touchCount === 2) {
      gesture.pinching = true;
      gesture.startDistance = Math.max(1, distance());
      gesture.startZoom = cam.zoom;
      gesture.lastCentroid = centroid();
      gesture.suppressClick = true;
    }
  });

  canvas.addEventListener("pointermove", function (event) {
    var pointer = pointers.get(event.pointerId);
    if (!pointer) {
      canvas.style.cursor = hit(event.clientX, event.clientY) ? "pointer" : "grab";
      return;
    }

    var dx = event.clientX - pointer.x;
    var dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (Math.abs(event.clientX - pointer.startX) + Math.abs(event.clientY - pointer.startY) > 6) pointer.moved = true;

    if (pointer.pointerType === "mouse") {
      if (pointer.mode === "pan") {
        panBy(dx, dy);
        gesture.suppressClick = true;
        draw();
        return;
      }
      cam.yaw += dx * 0.008;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + dy * 0.006));
      draw();
      return;
    }

    var touchCount = Array.from(pointers.values()).filter(function (item) { return item.pointerType !== "mouse"; }).length;
    if (touchCount >= 2) {
      gesture.pinching = true;
      gesture.suppressClick = true;
      var dist = distance();
      var next = centroid();
      if (next && gesture.lastCentroid) panBy(next.x - gesture.lastCentroid.x, next.y - gesture.lastCentroid.y);
      gesture.lastCentroid = next;
      cam.zoom = Math.max(0.32, Math.min(3.2, gesture.startZoom * (dist / gesture.startDistance)));
      draw();
      return;
    }

    if (!gesture.pinching) {
      cam.yaw += dx * 0.008;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + dy * 0.006));
      draw();
    }
  });

  function endPointer(event) {
    var pointer = pointers.get(event.pointerId);
    if (!pointer) return;

    var click = pointer.pointerType === "mouse" && pointer.mode === "rotate" && pointers.size === 1 && !gesture.pinching && !gesture.suppressClick && !pointer.moved;
    var tapped = pointer.pointerType !== "mouse" && pointers.size === 1 && !gesture.pinching && !gesture.suppressClick && !pointer.moved;
    var candidate = click || tapped ? hit(event.clientX, event.clientY) : null;

    pointers.delete(event.pointerId);
    var touchCount = Array.from(pointers.values()).filter(function (item) { return item.pointerType !== "mouse"; }).length;
    if (touchCount < 2 && gesture.pinching) {
      gesture.pinching = false;
      gesture.lastCentroid = null;
      gesture.suppressClick = true;
    }

    if (pointers.size === 0) {
      canvas.classList.remove("dragging");
      if (click || tapped) {
        if (candidate) showNode(candidate.node);
        else {
          spotlightId = null;
          draw();
        }
      }
      window.setTimeout(function () {
        if (pointers.size === 0) gesture.suppressClick = false;
      }, 0);
    }
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", function (event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      gesture.pinching = false;
      gesture.lastCentroid = null;
      gesture.suppressClick = false;
      canvas.classList.remove("dragging");
    }
  });

  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    cam.zoom = Math.max(0.32, Math.min(3.2, cam.zoom * Math.exp(-event.deltaY * 0.001)));
    draw();
  }, { passive: false });

  document.getElementById("mode3d").addEventListener("click", function () {
    window.requestAnimationFrame(function () {
      resize();
      draw();
    });
  });

  document.getElementById("overview").addEventListener("click", function () {
    expanded.clear();
    spotlightId = null;
    cam.panX = 0;
    cam.panY = 0;
    cam.zoom = 1.02;
    draw();
  });

  document.getElementById("expandAll3d").addEventListener("click", function () {
    modules.forEach(function (module) { expanded.add(module.id); });
    spotlightId = null;
    cam.zoom = 0.52;
    cam.panX = 0;
    cam.panY = 0;
    window.requestAnimationFrame(function () {
      resize();
      draw();
    });
  });

  window.addEventListener("resize", function () {
    if (!pane.hidden) {
      resize();
      draw();
    }
  });

  window.__TOTEM_CLUSTER_3D_V2__ = {
    scene: scene,
    clusterRadius: clusterRadius,
    moduleOrbitRadius: moduleOrbitRadius,
    scatter: scatter,
    manualFeatureFor: manualFeatureFor,
    capabilityConsumerEndpoint: capabilityConsumerEndpoint,
    panBy: panBy,
    draw: draw
  };
}());
