(function () {
  "use strict";

  var DATA = window.__TOTEM_GRAPH_DATA__;
  var pane = document.getElementById("pane3d");
  var canvas = document.getElementById("graph3d");
  var info = document.getElementById("info");
  if (!DATA || !canvas || !pane) return;

  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "TOTEM 3D architecture graph. Use arrow keys to choose nodes, Enter or Space to activate, left drag to rotate, right drag to pan, and wheel to zoom.");

  var modules = DATA.modules || [];
  var externals = DATA.externalNodes || [];
  var features = DATA.features || [];
  var contracts = DATA.contracts || [];
  var capabilities = DATA.sharedCapabilities || [];
  var components = DATA.components || [];
  var verification = DATA.verification || { tests: [], relations: [], requirements: [], coverage: [] };
  var tests = verification.tests || [];
  var verificationRelations = verification.relations || [];
  var code = DATA.code || { nodes: [] };

  document.getElementById("snapshot").textContent = ((DATA.snapshot && DATA.snapshot.date) || "unknown") + " snapshot";
  document.getElementById("stats").textContent = modules.length + " modules｜" + features.length + " features｜" + components.length + " components｜" + tests.length + " tests｜" + contracts.length + " contracts｜" + capabilities.length + " shared";

  var moduleMap = new Map(modules.map(function (x) { return [x.id, x]; }));
  var featureMap = new Map(features.map(function (x) { return [x.id, x]; }));
  var componentMap = new Map(components.map(function (x) { return [x.id, x]; }));
  var testMap = new Map(tests.map(function (x) { return [x.id, x]; }));
  var contractMap = new Map(contracts.map(function (x) { return [x.id, x]; }));
  var edgeFilterKeys = [
    "hard-core",
    "fabric-suggests",
    "runtime-optional",
    "eventbus",
    "observer-provider",
    "external-service",
    "shared-capability",
    "validated-by"
  ];
  var enabledEdgeFilters = new Set(edgeFilterKeys);

  var expanded = new Set();
  var spotlightId = null;
  var keyboardFocusId = null;
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
    var unmappedComponentCount = components.filter(function (component) {
      return component.moduleId === moduleId && !(component.featureIds || []).length;
    }).length;
    var syntheticCapabilityCount = capabilities.filter(function (capability) {
      return capability.consumerModuleId === moduleId && !capabilityConsumerFeature(capability);
    }).length;
    var unmappedTestCount = tests.filter(function (test) {
      return test.moduleId === moduleId && !(test.featureIds || []).length;
    }).length;
    var count = Math.max(1, featureCount + unmappedComponentCount + syntheticCapabilityCount + unmappedTestCount);
    return Math.min(245, 118 + Math.sqrt(count) * 27);
  }

  function moduleOrbitRadius(count) {
    return count <= 0 ? 330 : Math.min(630, 430 + Math.sqrt(count) * 55);
  }

  function band(type) {
    if (type === "component") return [0.48, 0.72];
    if (type === "implementation") return [0.38, 0.62];
    if (type === "test") return [0.44, 0.70];
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

  function vecLength(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  function normalizeVec(v) {
    var length = vecLength(v);
    if (length < 0.000001) return { x: 0, y: 0, z: 0 };
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  }

  function dotVec(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function crossVec(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  function featureContractIds(feature) {
    if (!feature) return [];
    var ids = [];
    Object.keys(feature).forEach(function (key) {
      if (!/ContractIds$/.test(key) || !Array.isArray(feature[key])) return;
      feature[key].forEach(function (id) {
        if (!ids.includes(id)) ids.push(id);
      });
    });
    return ids;
  }

  function relationWeight(type) {
    if (type === "hard-core") return 1.7;
    if (type === "shared-capability") return 1.55;
    if (type === "fabric-suggests") return 1.4;
    if (type === "runtime-optional") return 1.3;
    if (type === "external-service") return 1.25;
    if (type === "eventbus" || type === "observer-provider") return 1.2;
    return 1;
  }

  function featureRelations(ownerId, featureId) {
    var feature = featureMap.get(featureId);
    var declaredContractIds = new Set(featureContractIds(feature));
    var merged = new Map();

    function add(targetId, weight, kind) {
      if (!targetId || targetId === ownerId) return;
      var current = merged.get(targetId) || { targetId: targetId, weight: 0, kinds: [] };
      current.weight += weight;
      if (!current.kinds.includes(kind)) current.kinds.push(kind);
      merged.set(targetId, current);
    }

    contracts.forEach(function (contract) {
      var featureBound = (contract.featureIds || []).includes(featureId) || declaredContractIds.has(contract.id);
      if (!featureBound) return;
      if (contract.from === ownerId) add(contract.to, relationWeight(contract.type), contract.type);
      else if (contract.to === ownerId) add(contract.from, relationWeight(contract.type), contract.type);
    });

    capabilities.forEach(function (capability) {
      var consumerFeature = capabilityConsumerFeature(capability);
      if (capability.providerFeatureId === featureId && capability.providerModuleId === ownerId) {
        add(capability.consumerModuleId, relationWeight("shared-capability"), "shared-capability");
      }
      if (consumerFeature && consumerFeature.id === featureId && capability.consumerModuleId === ownerId) {
        add(capability.providerModuleId, relationWeight("shared-capability"), "shared-capability");
      }
    });

    return Array.from(merged.values()).sort(function (a, b) {
      return a.targetId.localeCompare(b.targetId);
    });
  }

  function relationAwareScatter(parent, id, type, radius, ownerId, sceneNodes, explicitRelations) {
    var base = scatter(parent, id, type, radius);
    var offset = { x: base.x - parent.x, y: base.y - parent.y, z: base.z - parent.z };
    var radialDistance = vecLength(offset);
    var baseDirection = normalizeVec(offset);
    var relations = explicitRelations == null ? featureRelations(ownerId, id) : explicitRelations;
    var outward = ownerId === "totem-core" ? null : normalizeVec({ x: parent.x, y: parent.y, z: parent.z });

    if (!relations.length) {
      if (!outward) return base;
      var ordinaryDirection = normalizeVec({
        x: baseDirection.x * 0.72 + outward.x * 0.28,
        y: baseDirection.y * 0.72 + outward.y * 0.28,
        z: baseDirection.z * 0.72 + outward.z * 0.28
      });
      return {
        x: parent.x + ordinaryDirection.x * radialDistance,
        y: parent.y + ordinaryDirection.y * radialDistance,
        z: parent.z + ordinaryDirection.z * radialDistance
      };
    }

    var byId = new Map(sceneNodes.map(function (node) { return [node.id, node]; }));
    var weightedCentroid = { x: 0, y: 0, z: 0 };
    var totalWeight = 0;
    var resolved = [];
    relations.forEach(function (relation) {
      var target = byId.get(relation.targetId);
      if (!target) return;
      var weight = Number(relation.weight || 1);
      weightedCentroid.x += target.x * weight;
      weightedCentroid.y += target.y * weight;
      weightedCentroid.z += target.z * weight;
      totalWeight += weight;
      resolved.push(relation);
    });
    if (!resolved.length || totalWeight <= 0) return base;

    weightedCentroid.x /= totalWeight;
    weightedCentroid.y /= totalWeight;
    weightedCentroid.z /= totalWeight;
    var junctionDirection = normalizeVec({
      x: weightedCentroid.x - parent.x,
      y: weightedCentroid.y - parent.y,
      z: weightedCentroid.z - parent.z
    });
    if (vecLength(junctionDirection) < 0.000001) junctionDirection = baseDirection;

    var hasCoreTarget = resolved.some(function (relation) { return relation.targetId === "totem-core"; });
    if (outward && !hasCoreTarget) {
      var inwardness = dotVec(junctionDirection, outward);
      if (inwardness < -0.18) {
        var correction = 0.42 + Math.abs(inwardness) * 0.45;
        junctionDirection = normalizeVec({
          x: junctionDirection.x + outward.x * correction,
          y: junctionDirection.y + outward.y * correction,
          z: junctionDirection.z + outward.z * correction
        });
      }
    }

    var degree = resolved.length;
    var influence = Math.min(0.9, 0.38 + Math.log2(degree + 1) * 0.17 + Math.min(0.18, totalWeight * 0.035));
    var direction = normalizeVec({
      x: baseDirection.x * (1 - influence) + junctionDirection.x * influence,
      y: baseDirection.y * (1 - influence) + junctionDirection.y * influence,
      z: baseDirection.z * (1 - influence) + junctionDirection.z * influence
    });

    var axis = Math.abs(direction.y) < 0.86 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    var tangentA = normalizeVec(crossVec(direction, axis));
    var tangentB = normalizeVec(crossVec(direction, tangentA));
    var phase = hashUnit(id, 131) * Math.PI * 2;
    var slotStrength = 0.22 / Math.sqrt(Math.max(1, degree));
    direction = normalizeVec({
      x: direction.x + (tangentA.x * Math.cos(phase) + tangentB.x * Math.sin(phase)) * slotStrength,
      y: direction.y + (tangentA.y * Math.cos(phase) + tangentB.y * Math.sin(phase)) * slotStrength,
      z: direction.z + (tangentA.z * Math.cos(phase) + tangentB.z * Math.sin(phase)) * slotStrength
    });

    return {
      x: parent.x + direction.x * radialDistance,
      y: parent.y + direction.y * radialDistance,
      z: parent.z + direction.z * radialDistance
    };
  }

  function modulePosition(module, peripheralIndex, peripheralCount, radius) {
    if (module.id === "totem-core") return { x: 0, y: 0, z: 0 };
    return fib(peripheralIndex, peripheralCount, radius);
  }

  function edgeGroup(edge) {
    if (!edge) return null;
    return edgeFilterKeys.includes(edge.type) ? edge.type : null;
  }

  function edgeVisible(edge) {
    var group = edgeGroup(edge);
    return !group || enabledEdgeFilters.has(group);
  }

  function expandedCenterEndpoint(id) {
    return moduleMap.has(id) && expanded.has(id);
  }

  function syncEdgeFilterUi() {
    var button = document.getElementById("edgeFilters");
    if (button) button.textContent = "線條 " + enabledEdgeFilters.size + "/" + edgeFilterKeys.length;
    document.querySelectorAll("[data-edge-filter]").forEach(function (input) {
      input.checked = enabledEdgeFilters.has(input.getAttribute("data-edge-filter"));
    });
  }

  function setAllEdgeFilters(enabled) {
    enabledEdgeFilters.clear();
    if (enabled) edgeFilterKeys.forEach(function (key) { enabledEdgeFilters.add(key); });
    syncEdgeFilterUi();
    draw();
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
      if (expandedCenterEndpoint(contract.from) || expandedCenterEndpoint(contract.to)) return;
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
        if (expandedCenterEndpoint(from) || expandedCenterEndpoint(to)) return;
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

  function capabilityConsumerFeature(capability) {
    var explicit = capability.consumerFeatureId && featureMap.get(capability.consumerFeatureId);
    if (explicit) return explicit;
    if (capability.family === "manual") return manualFeatureFor(capability.consumerModuleId);
    return null;
  }

  function capabilityConsumerEndpoint(capability) {
    if (!expanded.has(capability.consumerModuleId)) return capability.consumerModuleId;
    var inferred = capabilityConsumerFeature(capability);
    if (inferred) return inferred.id;
    return "capability-node:" + capability.id;
  }

  function scene() {
    var nodes = [];
    var edges = [];
    var clusters = [];
    var expandedCount = modules.filter(function (module) { return expanded.has(module.id); }).length;
    var moduleRadius = moduleOrbitRadius(expandedCount);
    var externalRadius = moduleRadius + 280;

    var coreModule = modules.find(function (module) { return module.id === "totem-core"; });
    var peripheralModules = modules.filter(function (module) { return module.id !== "totem-core"; }).sort(function (a, b) {
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    if (coreModule) {
      var corePosition = modulePosition(coreModule, 0, peripheralModules.length, moduleRadius);
      nodes.push({
        id: coreModule.id,
        label: coreModule.name || coreModule.id,
        type: "module",
        rank: rankOf(coreModule),
        ownerId: coreModule.id,
        x: corePosition.x,
        y: corePosition.y,
        z: corePosition.z,
        source: coreModule
      });
    }

    peripheralModules.forEach(function (module, index) {
      var position = modulePosition(module, index, peripheralModules.length, moduleRadius);
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
      if (!moduleMap.has(moduleId)) return;
      var parent = nodes.find(function (node) { return node.id === moduleId; });
      if (!parent) return;

      var moduleFeatures = features.filter(function (feature) { return feature.ownerId === moduleId; });
      var unmappedComponents = components.filter(function (component) {
        return component.moduleId === moduleId && !(component.featureIds || []).length;
      });
      var unmappedTests = tests.filter(function (test) {
        return test.moduleId === moduleId && !(test.featureIds || []).length;
      }).slice(0, 8);
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
        childCount: moduleFeatures.length + unmappedComponents.length + syntheticCaps.length + unmappedTests.length
      });

      moduleFeatures.forEach(function (feature) {
        var position = relationAwareScatter(parent, feature.id, "feature", radius, moduleId, nodes, null);
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
      });

      syntheticCaps.forEach(function (capability) {
        var id = "capability-node:" + capability.id;
        var position = relationAwareScatter(parent, id, "capability", radius, moduleId, nodes, [{ targetId: capability.providerModuleId, weight: relationWeight("shared-capability"), kinds: ["shared-capability"] }]);
        nodes.push({
          id: id,
          label: moduleShort(moduleId) + " · " + String(capability.label || "SHARED CAPABILITY").toUpperCase(),
          type: "capability",
          ownerId: moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: capability
        });
      });

      unmappedComponents.forEach(function (component) {
        var position = relationAwareScatter(parent, component.id, "component", radius, moduleId, nodes, []);
        nodes.push({
          id: component.id,
          label: moduleShort(moduleId) + " · COMPONENT · " + component.label,
          type: "component",
          ownerId: moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: component
        });
        edges.push({
          id: "contains-component:" + component.id,
          from: moduleId,
          to: component.id,
          type: "detail",
          label: "unmapped component",
          retargeted: true
        });
      });

      unmappedTests.forEach(function (test) {
        var position = relationAwareScatter(parent, test.id, "test", radius, moduleId, nodes, []);
        nodes.push({
          id: test.id,
          label: "TEST · " + test.label,
          type: "test",
          ownerId: moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: test
        });
        edges.push({
          id: "validated-by-module:" + moduleId + ":" + test.id,
          from: moduleId,
          to: test.id,
          type: "validated-by",
          label: "module test evidence",
          retargeted: true
        });
      });
    });

    expanded.forEach(function (featureId) {
      var feature = featureMap.get(featureId);
      if (!feature) return;
      var parent = nodes.find(function (node) { return node.id === featureId; });
      if (!parent) return;
      var mapped = components.filter(function (component) {
        return (component.featureIds || []).includes(featureId);
      });
      var linkedTests = tests.filter(function (test) {
        return (test.featureIds || []).includes(featureId);
      }).slice(0, 8);
      var radius = Math.min(150, 74 + Math.sqrt(Math.max(1, mapped.length + linkedTests.length)) * 22);
      mapped.forEach(function (component) {
        var position = scatter(parent, component.id, "component", radius);
        nodes.push({
          id: component.id,
          label: "COMPONENT · " + component.label,
          type: "component",
          ownerId: feature.ownerId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: component
        });
        edges.push({
          id: "contains-component:" + featureId + ":" + component.id,
          from: featureId,
          to: component.id,
          type: "detail",
          label: "responsibility",
          retargeted: true
        });
      });

      linkedTests.forEach(function (test) {
        if (!nodes.some(function (node) { return node.id === test.id; })) {
          var position = scatter(parent, test.id, "test", radius * 0.92);
          nodes.push({
            id: test.id,
            label: "TEST · " + test.label,
            type: "test",
            ownerId: feature.ownerId,
            x: position.x,
            y: position.y,
            z: position.z,
            source: test
          });
        }
        edges.push({
          id: "validated-by:" + featureId + ":" + test.id,
          from: featureId,
          to: test.id,
          type: "validated-by",
          label: "validated by",
          retargeted: true
        });
      });
    });

    expanded.forEach(function (componentId) {
      var component = componentMap.get(componentId);
      if (!component) return;
      var parent = nodes.find(function (node) { return node.id === componentId; });
      if (!parent) return;
      var paths = (component.implementationPaths || []).slice(0, 10);
      var radius = Math.min(132, 62 + Math.sqrt(Math.max(1, paths.length)) * 18);
      paths.forEach(function (implementationPath, index) {
        var id = "implementation:" + component.id + ":" + implementationPath;
        var position = scatter(parent, id, "implementation", radius);
        nodes.push({
          id: id,
          label: implementationPath.split("/").pop(),
          type: "implementation",
          ownerId: component.moduleId,
          x: position.x,
          y: position.y,
          z: position.z,
          source: { component: component, path: implementationPath }
        });
        edges.push({
          id: "contains-implementation:" + component.id + ":" + implementationPath,
          from: component.id,
          to: id,
          type: "detail",
          label: "implementation",
          retargeted: true
        });
      });
    });

    contracts.forEach(function (contract) { addContractEdges(edges, contract); });

    capabilities.forEach(function (capability) {
      if (!expanded.has(capability.consumerModuleId) && !expanded.has(capability.providerModuleId)) return;
      var from = capabilityConsumerEndpoint(capability);
      var to = capability.providerModuleId;
      if (
        expanded.has(capability.providerModuleId) &&
        capability.providerFeatureId &&
        featureMap.has(capability.providerFeatureId)
      ) {
        to = capability.providerFeatureId;
      }
      if (expandedCenterEndpoint(from) || expandedCenterEndpoint(to)) return;
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

    return { nodes: nodes, edges: edges.filter(edgeVisible), clusters: clusters };
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
    if (edge.type === "validated-by") return "#4ade80";
    if (edge.type === "detail") return "#34d399";
    if (edge.type === "feature-detail") return "#64748b";
    return "#a78bfa";
  }

  function drawArrowhead(ctx, a, b, color, alpha, lineWidth) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var length = Math.sqrt(dx * dx + dy * dy);
    if (length < 18) return;
    var ux = dx / length;
    var uy = dy / length;
    var tipOffset = 13;
    var tipX = b.x - ux * tipOffset;
    var tipY = b.y - uy * tipOffset;
    var size = Math.max(6, Math.min(9, 5.5 + lineWidth));
    var backX = tipX - ux * size;
    var backY = tipY - uy * size;
    var px = -uy * size * 0.62;
    var py = ux * size * 0.62;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(backX + px, backY + py);
    ctx.lineTo(backX - px, backY - py);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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

  function agentActivityColor(type) {
    if (type === "task_failed" || type === "test_failed" || type === "deployment_failed") return "#f87171";
    if (type === "test_passed" || type === "task_completed" || type === "deployment_completed") return "#86efac";
    if (type === "file_edit" || type === "symbol_edit" || type === "git_diff_updated") return "#fbbf24";
    return "#67e8f9";
  }

  function drawAgentActivityHalo(ctx, projected, radius, type) {
    var phase = (Date.now() % 1200) / 1200;
    var pulse = (Math.sin(phase * Math.PI * 2) + 1) / 2;
    var color = agentActivityColor(type);
    ctx.save();
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius + 8 + pulse * 7, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9 - pulse * 0.45;
    ctx.lineWidth = 2.2 + pulse * 1.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 + pulse * 8;
    ctx.stroke();
    ctx.restore();
  }

  function verificationColor(status) {
    if (status === "failed") return "#f87171";
    if (status === "running") return "#67e8f9";
    if (status === "passed") return "#86efac";
    return "#94a3b8";
  }

  function drawVerificationHalo(ctx, projected, radius, status) {
    var phase = status === "passed" ? 0.35 : (Date.now() % 1200) / 1200;
    var pulse = status === "passed" ? phase : (Math.sin(phase * Math.PI * 2) + 1) / 2;
    var color = verificationColor(status);
    ctx.save();
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius + 10 + pulse * 5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = status === "passed" ? 0.72 : 0.72 + pulse * 0.24;
    ctx.lineWidth = status === "failed" ? 3 + pulse * 1.5 : 2.2 + pulse;
    ctx.shadowColor = color;
    ctx.shadowBlur = status === "failed" ? 12 + pulse * 8 : 8 + pulse * 5;
    ctx.stroke();
    ctx.restore();
  }

  function drawChangeHalo(ctx, projected, radius, kind) {
    var animated = window.__TOTEM_CHANGE_ANIMATIONS__ !== false;
    var phase = animated ? (Date.now() % 1200) / 1200 : 0.25;
    var pulse = (Math.sin(phase * Math.PI * 2) + 1) / 2;
    var color = kind === "impact" ? "#a78bfa" : "#fbbf24";
    var extra = kind === "impact" ? 14 : 9 + pulse * 5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius + extra, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = kind === "impact" ? 0.56 : 0.72 + pulse * 0.23;
    ctx.lineWidth = kind === "impact" ? 2.2 : 2 + pulse * 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = kind === "impact" ? 8 : 9 + pulse * 7;
    ctx.stroke();
    ctx.restore();
  }

  function relationChanged(edge, changedIds) {
    for (var id of changedIds) {
      if (edge.id === id || edge.id.indexOf(id + ":") === 0) return true;
    }
    return false;
  }

  function connectedToSpotlight(currentScene, id) {
    return !spotlightId || id === spotlightId || currentScene.edges.some(function (edge) {
      return (edge.from === spotlightId || edge.to === spotlightId) && (edge.from === id || edge.to === id);
    });
  }

  function drawChild(ctx, node, projected, selected, connected) {
    var radius = node.type === "capability" ? 6 : node.type === "component" ? 5.8 : node.type === "implementation" ? 4.3 : node.type === "test" ? 5.4 : 5.25;
    var stroke = selected ? "#ffffff" : node.type === "capability" ? "#f472b6" : node.type === "component" ? "#34d399" : node.type === "implementation" ? "#a7f3d0" : node.type === "test" ? "#4ade80" : ((node.source && node.source.softContractIds) || []).length ? "#fbbf24" : "#8095ad";
    var fill = node.type === "capability" ? "#f472b6" : node.type === "component" ? "#34d399" : node.type === "implementation" ? "#a7f3d0" : node.type === "test" ? "#4ade80" : "#93c5fd";
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
    if (keyboardFocusId && !byId.has(keyboardFocusId)) keyboardFocusId = null;
    currentScene.nodes.forEach(function (node) {
      projected.set(node.id, project(node, width, height));
    });

    var spotlightOwner = owner(byId.get(spotlightId));
    var related = relatedOwners(currentScene);
    var agentActivity = window.__TOTEM_AGENT_ACTIVITY__ || null;
    var changeIntelligence = window.__TOTEM_CHANGE_INTELLIGENCE__ || null;
    var changeDiff = changeIntelligence && changeIntelligence.semanticDiff ? changeIntelligence.semanticDiff : {};
    var changeImpact = changeIntelligence && changeIntelligence.impact ? changeIntelligence.impact : {};
    var changedEntityIds = new Set(
      changeIntelligence && Array.isArray(changeIntelligence.affectedEntityIds)
        ? changeIntelligence.affectedEntityIds
        : Array.isArray(changeDiff.changedEntityIds) ? changeDiff.changedEntityIds : []
    );
    var impactedModules = new Set(Array.isArray(changeImpact.impactedModules) ? changeImpact.impactedModules : []);
    var verificationState = window.__TOTEM_VERIFICATION_STATE__ || {};
    var runningVerificationTargets = new Set(Array.isArray(verificationState.runningTargetIds) ? verificationState.runningTargetIds : []);
    var passedVerificationTargets = new Set(Array.isArray(verificationState.passedTargetIds) ? verificationState.passedTargetIds : []);
    var failedVerificationTargets = new Set(Array.isArray(verificationState.failedTargetIds) ? verificationState.failedTargetIds : []);
    var replayGraphState = window.__TOTEM_REPLAY_GRAPH_STATE__ || {};
    var historicalEntityIds = new Set(Array.isArray(replayGraphState.entityIds) ? replayGraphState.entityIds : []);
    var agentActivityNodeId = null;
    if (agentActivity) {
      if (agentActivity.componentId && byId.has(agentActivity.componentId)) agentActivityNodeId = agentActivity.componentId;
      else if (agentActivity.featureId && byId.has(agentActivity.featureId)) agentActivityNodeId = agentActivity.featureId;
      else if (agentActivity.moduleId && byId.has(agentActivity.moduleId)) agentActivityNodeId = agentActivity.moduleId;
    }
    currentScene.clusters.forEach(function (cluster) {
      if (historicalEntityIds.size && !historicalEntityIds.has(cluster.ownerId)) return;
      var p = projected.get(cluster.ownerId);
      if (!p) return;
      var state = !spotlightId ? "normal" : cluster.ownerId === spotlightOwner ? "active" : related.has(cluster.ownerId) ? "related" : "dim";
      drawCluster(ctx, cluster, p, state);
    });

    var labels = [];
    currentScene.edges.forEach(function (edge) {
      if (historicalEntityIds.size && (!historicalEntityIds.has(edge.from) || !historicalEntityIds.has(edge.to))) return;
      var a = projected.get(edge.from);
      var b = projected.get(edge.to);
      if (!a || !b) return;
      var active = !spotlightId || edge.from === spotlightId || edge.to === spotlightId;
      var relation = edge.type === "shared-capability" || edge.retargeted;
      var internal = edge.type === "detail" || edge.type === "feature-detail";

      var changedRelation = relationChanged(edge, changedEntityIds);
      var verificationStatus = failedVerificationTargets.has(edge.from) || failedVerificationTargets.has(edge.to)
        ? "failed"
        : runningVerificationTargets.has(edge.from) || runningVerificationTargets.has(edge.to)
          ? "running"
          : passedVerificationTargets.has(edge.from) || passedVerificationTargets.has(edge.to)
            ? "passed"
            : null;
      var changePhase = window.__TOTEM_CHANGE_ANIMATIONS__ === false ? 0.5 : (Math.sin((Date.now() % 1200) / 1200 * Math.PI * 2) + 1) / 2;
      var verificationEdge = edge.type === "validated-by" && verificationStatus;
      var edgeAlpha = changedRelation
        ? 0.74 + changePhase * 0.24
        : verificationEdge
          ? 0.92
          : spotlightId ? (active ? 1 : 0.055) : (relation ? 0.82 : internal ? 0.16 : 0.34);
      var edgeWidth = changedRelation
        ? 2.8 + changePhase * 1.8
        : verificationEdge
          ? 2.8
          : spotlightId && active ? 4.6 : relation ? 2.6 : internal ? 1.15 : 1.45;
      var color = changedRelation ? "#fbbf24" : verificationEdge ? verificationColor(verificationStatus) : edgeColor(edge);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = edgeAlpha;
      ctx.lineWidth = edgeWidth;
      ctx.stroke();
      if (!internal) drawArrowhead(ctx, a, b, color, edgeAlpha, edgeWidth);

      if ((relation || (active && spotlightId)) && edge.label) {
        labels.push({ text: edge.label, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, active: active });
      }
    });

    ctx.globalAlpha = 1;
    lastHits = [];
    currentScene.nodes.slice().sort(function (a, b) {
      return projected.get(a.id).z - projected.get(b.id).z;
    }).forEach(function (node) {
      if (historicalEntityIds.size && !historicalEntityIds.has(node.id)) return;
      var p = projected.get(node.id);
      var child = node.type === "feature" || node.type === "component" || node.type === "implementation" || node.type === "capability" || node.type === "test";
      var selected = spotlightId === node.id || keyboardFocusId === node.id;
      var connected = connectedToSpotlight(currentScene, node.id);
      var activityRadius = child
        ? (node.type === "capability" ? 6 : node.type === "component" ? 5.8 : node.type === "implementation" ? 4.3 : node.type === "test" ? 5.4 : 5.25)
        : Math.max(8, 12 * p.scale);
      var verificationStatus = failedVerificationTargets.has(node.id)
        ? "failed"
        : runningVerificationTargets.has(node.id)
          ? "running"
          : passedVerificationTargets.has(node.id)
            ? "passed"
            : null;
      if (node.type === "module" && impactedModules.has(node.id)) {
        drawChangeHalo(ctx, p, activityRadius, "impact");
      }
      if (changedEntityIds.has(node.id)) {
        drawChangeHalo(ctx, p, activityRadius, "change");
      }
      if (verificationStatus) {
        drawVerificationHalo(ctx, p, activityRadius, verificationStatus);
      }
      if (node.id === agentActivityNodeId) {
        drawAgentActivityHalo(ctx, p, activityRadius, agentActivity && agentActivity.type);
      }

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

  function keyboardNodes() {
    var replayGraphState = window.__TOTEM_REPLAY_GRAPH_STATE__ || {};
    var historicalEntityIds = new Set(Array.isArray(replayGraphState.entityIds) ? replayGraphState.entityIds : []);
    return scene().nodes.filter(function (node) {
      if (historicalEntityIds.size && !historicalEntityIds.has(node.id)) return false;
      return node.type === "module" || node.type === "external" || node.type === "feature" || node.type === "component" || node.type === "implementation" || node.type === "capability" || node.type === "test";
    });
  }

  function setKeyboardFocus(id) {
    keyboardFocusId = id || null;
    draw();
  }

  function moveKeyboardFocus(step) {
    var nodes = keyboardNodes();
    if (!nodes.length) return;
    var index = nodes.findIndex(function (node) { return node.id === keyboardFocusId; });
    if (index < 0) index = nodes.findIndex(function (node) { return node.id === "totem-core"; });
    if (index < 0) index = 0;
    index = (index + step + nodes.length) % nodes.length;
    setKeyboardFocus(nodes[index].id);
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

  function sharedCapabilityLinksForFeature(featureId) {
    return capabilities.filter(function (capability) {
      var consumerFeature = capabilityConsumerFeature(capability);
      return capability.providerFeatureId === featureId || (consumerFeature && consumerFeature.id === featureId);
    });
  }

  function showContracts() {
    setInfo(contracts.length + " validated contracts", "Curated relationship list", [
      {
        title: "Contracts",
        items: contracts.map(function (contract, index) {
          return String(index + 1).padStart(2, "0") + "｜" + contract.type + "｜" + contract.from + " → " + contract.to + "｜" + (contract.feature || contract.id);
        })
      },
      {
        title: "Shared capabilities",
        items: capabilities.map(function (capability) {
          return capability.consumerModuleId + " → " + capability.providerModuleId + "｜" + capability.label;
        })
      }
    ]);
  }

  function showNode(node) {
    keyboardFocusId = node.id;
    if (node.type === "module") {
      spotlightId = null;
      if (expanded.has(node.id)) {
        expanded.delete(node.id);
        features.filter(function (feature) { return feature.ownerId === node.id; }).forEach(function (feature) {
          expanded.delete(feature.id);
        });
        components.filter(function (component) { return component.moduleId === node.id; }).forEach(function (component) {
          expanded.delete(component.id);
        });
      } else {
        expanded.add(node.id);
      }
      var moduleFeatures = features.filter(function (feature) { return feature.ownerId === node.id; });
      var moduleComponents = components.filter(function (component) { return component.moduleId === node.id; });
      var moduleTests = tests.filter(function (test) { return test.moduleId === node.id; });
      var moduleCapabilities = capabilities.filter(function (capability) { return capability.consumerModuleId === node.id || capability.providerModuleId === node.id; });
      var expandedModules = modules.filter(function (module) { return expanded.has(module.id); }).length;
      setInfo((node.source && node.source.name) || node.label, (node.source && node.source.role) || "", [
        {
          title: "Feature groups",
          items: (node.source && node.source.featureGroups) || []
        },
        {
          title: "Semantic LOD",
          items: [
            "L2 curated features: " + moduleFeatures.length,
            "L3 inferred components: " + moduleComponents.length,
            "Mapped components: " + moduleComponents.filter(function (component) { return (component.featureIds || []).length; }).length,
            "Test entities: " + moduleTests.length,
            "Shared capabilities: " + moduleCapabilities.length
          ]
        },
        {
          title: "3D cluster",
          items: [
            expanded.has(node.id) ? "Expanded cluster" : "Collapsed",
            "Cluster radius: " + Math.round(clusterRadius(node.id)),
            "Module orbit radius: " + Math.round(moduleOrbitRadius(expandedModules)),
            "Expanded modules: " + expandedModules
          ]
        }
      ]);
      draw();
      return;
    }

    spotlightId = node.id;
    if (node.type === "feature") {
      var feature = node.source || {};
      if (expanded.has(node.id)) {
        expanded.delete(node.id);
        components.filter(function (component) {
          return (component.featureIds || []).includes(node.id);
        }).forEach(function (component) { expanded.delete(component.id); });
      } else {
        expanded.add(node.id);
      }
      var soft = (feature.softContractIds || []).map(function (id) { return contractMap.get(id); }).filter(Boolean);
      var hard = contracts.filter(function (contract) {
        return contract.type === "hard-core" && (contract.featureIds || []).includes(feature.id);
      });
      var capabilityLinks = sharedCapabilityLinksForFeature(feature.id);
      var featureComponents = components.filter(function (component) {
        return (component.featureIds || []).includes(feature.id);
      });
      var featureTests = tests.filter(function (test) {
        return (test.featureIds || []).includes(feature.id);
      });
      setInfo(node.label, feature.summary || "", [
        {
          title: "L3 Components",
          items: featureComponents.length
            ? featureComponents.map(function (component) {
                return component.label + "｜" + component.mappingConfidence + "｜" + component.fileCount + " files";
              })
            : ["No strongly mapped component evidence"]
        },
        {
          title: "Validated by",
          items: featureTests.length
            ? featureTests.map(function (test) { return test.kind + "｜" + test.path; })
            : ["No confidently linked Test entity"]
        },
        {
          title: "Shared capability links",
          items: capabilityLinks.map(function (capability) {
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
    } else if (node.type === "component") {
      var component = node.source || {};
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
      setInfo(node.label, component.responsibility || "Inferred production-code responsibility", [
        {
          title: "Semantic mapping",
          items: [
            "confidence: " + (component.mappingConfidence || "unmapped"),
            "score: " + Number(component.mappingScore || 0),
            (component.featureIds || []).length ? "features: " + component.featureIds.join(", ") : "module-level component · no strong Feature mapping"
          ]
        },
        {
          title: "L4 Implementation",
          items: (component.implementationPaths || []).slice(0, 10)
        },
        {
          title: "Surface evidence",
          items: (component.surfaceKinds || []).concat((component.symbols || []).slice(0, 8))
        }
      ]);
    } else if (node.type === "test") {
      var test = node.source || {};
      setInfo(node.label, (test.kind || "test") + " verification evidence", [
        {
          title: "Test path",
          items: [test.path || node.label]
        },
        {
          title: "Validated Feature",
          items: test.featureIds || []
        },
        {
          title: "Validated contract / API",
          items: (test.contractIds || []).concat(test.capabilityIds || [])
        },
        {
          title: "Verification categories",
          items: test.categories || []
        }
      ]);
    } else if (node.type === "implementation") {
      setInfo(node.label, "L4 production implementation evidence", [{
        title: "Path",
        items: [node.source && node.source.path ? node.source.path : node.label]
      }]);
    } else if (node.type === "capability") {
      var capability = node.source || {};
      setInfo(node.label, capability.consumerLabel + " → " + capability.providerLabel, [{
        title: "Live code evidence",
        items: capability.evidencePaths || []
      }]);
    } else {
      setInfo(node.label, "External node", []);
    }
    draw();
  }

  function focusActivity(event, autoExpand) {
    if (!event) return;
    if (autoExpand !== false) {
      var component = event.componentId ? componentMap.get(event.componentId) : null;
      if (component) {
        expanded.add(component.moduleId);
        if ((component.featureIds || []).length) expanded.add(component.featureIds[0]);
        expanded.add(component.id);
      } else if (event.featureId && featureMap.has(event.featureId)) {
        var feature = featureMap.get(event.featureId);
        expanded.add(feature.ownerId);
        expanded.add(feature.id);
      } else if (event.moduleId && moduleMap.has(event.moduleId)) {
        expanded.add(event.moduleId);
      }
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

  canvas.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveKeyboardFocus(1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveKeyboardFocus(-1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      var nodes = keyboardNodes();
      if (!nodes.length) return;
      var target = event.key === "Home"
        ? (nodes.find(function (node) { return node.id === "totem-core"; }) || nodes[0])
        : nodes[nodes.length - 1];
      setKeyboardFocus(target.id);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      var focused = keyboardNodes().find(function (node) { return node.id === keyboardFocusId; });
      if (focused) showNode(focused);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      spotlightId = null;
      keyboardFocusId = null;
      info.hidden = true;
      draw();
    }
  });

  canvas.addEventListener("focus", function () {
    if (keyboardFocusId) return;
    var nodes = keyboardNodes();
    var core = nodes.find(function (node) { return node.id === "totem-core"; });
    if (core || nodes[0]) setKeyboardFocus((core || nodes[0]).id);
  });

  canvas.addEventListener("blur", function () {
    keyboardFocusId = null;
    draw();
  });

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

  var edgeFilterButton = document.getElementById("edgeFilters");
  var edgeFilterPanel = document.getElementById("edgeFilterPanel");
  if (edgeFilterButton && edgeFilterPanel) {
    edgeFilterButton.addEventListener("click", function () {
      var opening = edgeFilterPanel.hidden;
      edgeFilterPanel.hidden = !opening;
      edgeFilterButton.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    document.querySelectorAll("[data-edge-filter]").forEach(function (input) {
      input.addEventListener("change", function () {
        var key = input.getAttribute("data-edge-filter");
        if (input.checked) enabledEdgeFilters.add(key);
        else enabledEdgeFilters.delete(key);
        syncEdgeFilterUi();
        draw();
      });
    });
    document.getElementById("edgeFilterAll").addEventListener("click", function () { setAllEdgeFilters(true); });
    document.getElementById("edgeFilterNone").addEventListener("click", function () { setAllEdgeFilters(false); });
    syncEdgeFilterUi();
  }

  document.getElementById("contracts").addEventListener("click", showContracts);

  document.getElementById("overview").addEventListener("click", function () {
    expanded.clear();
    spotlightId = null;
    keyboardFocusId = null;
    cam.panX = 0;
    cam.panY = 0;
    cam.zoom = 1.02;
    draw();
  });

  document.getElementById("expandAll3d").addEventListener("click", function () {
    modules.forEach(function (module) { expanded.add(module.id); });
    spotlightId = null;
    keyboardFocusId = null;
    cam.zoom = 0.52;
    cam.panX = 0;
    cam.panY = 0;
    window.requestAnimationFrame(function () {
      resize();
      draw();
    });
  });

  window.addEventListener("resize", function () {
    resize();
    draw();
  });

  window.requestAnimationFrame(function () {
    resize();
    draw();
  });

  window.__TOTEM_CLUSTER_3D_V2__ = {
    scene: scene,
    clusterRadius: clusterRadius,
    moduleOrbitRadius: moduleOrbitRadius,
    modulePosition: modulePosition,
    scatter: scatter,
    edgeGroup: edgeGroup,
    edgeVisible: edgeVisible,
    expandedCenterEndpoint: expandedCenterEndpoint,
    featureRelations: featureRelations,
    relationAwareScatter: relationAwareScatter,
    manualFeatureFor: manualFeatureFor,
    capabilityConsumerEndpoint: capabilityConsumerEndpoint,
    panBy: panBy,
    drawArrowhead: drawArrowhead,
    keyboardNodes: keyboardNodes,
    showContracts: showContracts,
    focusActivity: focusActivity,
    draw: draw
  };
}());
