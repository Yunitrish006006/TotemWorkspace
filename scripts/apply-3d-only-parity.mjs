#!/usr/bin/env node
import fs from "node:fs";

function mustReplace(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`missing replacement marker: ${label}`);
  return source.replace(from, to);
}

const rendererPath = "viewer/graph-v2-cluster-v2.js";
let source = fs.readFileSync(rendererPath, "utf8");

source = mustReplace(source,
`  var DATA = window.__TOTEM_GRAPH_DATA__;
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
`,
`  var DATA = window.__TOTEM_GRAPH_DATA__;
  var pane = document.getElementById("pane3d");
  var canvas = document.getElementById("graph3d");
  var info = document.getElementById("info");
  if (!DATA || !canvas || !pane) return;

  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "TOTEM 3D architecture graph. Use arrow keys to choose nodes, Enter or Space to activate, left drag to rotate, right drag to pan, and wheel to zoom.");
`, "standalone canvas bootstrap");

source = mustReplace(source,
`  var code = DATA.code || { nodes: [] };

  var moduleMap`,
`  var code = DATA.code || { nodes: [] };

  document.getElementById("snapshot").textContent = ((DATA.snapshot && DATA.snapshot.date) || "unknown") + " snapshot";
  document.getElementById("stats").textContent = modules.length + " modules｜" + features.length + " features｜" + contracts.length + " contracts｜" + capabilities.length + " shared｜" + ((code.nodes || []).length) + " code nodes";

  var moduleMap`, "snapshot and stats initialization");

source = mustReplace(source,
`  var expanded = new Set();
  var spotlightId = null;
  var lastHits = [];
`,
`  var expanded = new Set();
  var spotlightId = null;
  var keyboardFocusId = null;
  var lastHits = [];
`, "keyboard focus state");

source = mustReplace(source,
`  function owner(node) {`,
`  function drawArrowhead(ctx, a, b, color, alpha, lineWidth) {
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

  function owner(node) {`, "direction arrow renderer");

source = mustReplace(source,
`      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = edgeColor(edge);
      ctx.globalAlpha = spotlightId ? (active ? 1 : 0.055) : (relation ? 0.82 : internal ? 0.16 : 0.34);
      ctx.lineWidth = spotlightId && active ? 4.6 : relation ? 2.6 : internal ? 1.15 : 1.45;
      ctx.stroke();

      if ((relation || (active && spotlightId)) && edge.label) {`,
`      var edgeAlpha = spotlightId ? (active ? 1 : 0.055) : (relation ? 0.82 : internal ? 0.16 : 0.34);
      var edgeWidth = spotlightId && active ? 4.6 : relation ? 2.6 : internal ? 1.15 : 1.45;
      var color = edgeColor(edge);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = edgeAlpha;
      ctx.lineWidth = edgeWidth;
      ctx.stroke();
      if (!internal) drawArrowhead(ctx, a, b, color, edgeAlpha, edgeWidth);

      if ((relation || (active && spotlightId)) && edge.label) {`, "directed relationship edges");

source = mustReplace(source,
`    var currentScene = scene();
    var projected = new Map();
    var byId = new Map(currentScene.nodes.map(function (node) { return [node.id, node]; }));
`,
`    var currentScene = scene();
    var projected = new Map();
    var byId = new Map(currentScene.nodes.map(function (node) { return [node.id, node]; }));
    if (keyboardFocusId && !byId.has(keyboardFocusId)) keyboardFocusId = null;
`, "keyboard focus scene sync");

source = mustReplace(source,
`      var selected = spotlightId === node.id;
      var connected = connectedToSpotlight(currentScene, node.id);
`,
`      var selected = spotlightId === node.id || keyboardFocusId === node.id;
      var connected = connectedToSpotlight(currentScene, node.id);
`, "keyboard focus drawing");

source = mustReplace(source,
`  function setInfo(title, body, sections) {`,
`  function keyboardNodes() {
    return scene().nodes.filter(function (node) {
      return node.type === "module" || node.type === "external" || node.type === "feature" || node.type === "category" || node.type === "capability";
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

  function setInfo(title, body, sections) {`, "keyboard navigation helpers");

source = mustReplace(source,
`  function showNode(node) {
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
`,
`  function showContracts() {
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
      if (expanded.has(node.id)) expanded.delete(node.id);
      else expanded.add(node.id);
      var moduleFeatures = features.filter(function (feature) { return feature.ownerId === node.id; });
      var moduleCategories = (code.nodes || []).filter(function (entry) { return entry.moduleId === node.id && entry.type === "code-category"; });
      var moduleCapabilities = capabilities.filter(function (capability) { return capability.consumerModuleId === node.id || capability.providerModuleId === node.id; });
      setInfo((node.source && node.source.name) || node.label, (node.source && node.source.role) || "", [
        {
          title: "Feature groups",
          items: (node.source && node.source.featureGroups) || []
        },
        {
          title: "Summary",
          items: [
            "Curated features: " + moduleFeatures.length,
            "Generated categories: " + moduleCategories.length,
            "Shared capabilities: " + moduleCapabilities.length
          ]
        },
        {
          title: "3D cluster",
          items: [
            expanded.has(node.id) ? "Expanded cluster" : "Collapsed",
            "Cluster radius: " + Math.round(clusterRadius(node.id)),
            "Module orbit radius: " + Math.round(moduleOrbitRadius(expanded.size)),
            "Expanded modules: " + expanded.size
          ]
        }
      ]);
      draw();
      return;
    }
`, "module feature groups and contracts parity");

source = mustReplace(source,
`  canvas.addEventListener("contextmenu", function (event) {`,
`  canvas.addEventListener("keydown", function (event) {
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

  canvas.addEventListener("contextmenu", function (event) {`, "keyboard input listeners");

source = mustReplace(source,
`  document.getElementById("mode3d").addEventListener("click", function () {
    window.requestAnimationFrame(function () {
      resize();
      draw();
    });
  });

  document.getElementById("overview").addEventListener("click", function () {`,
`  document.getElementById("contracts").addEventListener("click", showContracts);

  document.getElementById("overview").addEventListener("click", function () {`, "remove 2D/3D mode dependency");

source = mustReplace(source,
`    expanded.clear();
    spotlightId = null;
    cam.panX = 0;`,
`    expanded.clear();
    spotlightId = null;
    keyboardFocusId = null;
    cam.panX = 0;`, "overview keyboard reset");

source = mustReplace(source,
`    modules.forEach(function (module) { expanded.add(module.id); });
    spotlightId = null;
    cam.zoom = 0.52;`,
`    modules.forEach(function (module) { expanded.add(module.id); });
    spotlightId = null;
    keyboardFocusId = null;
    cam.zoom = 0.52;`, "expand-all keyboard reset");

source = mustReplace(source,
`  window.addEventListener("resize", function () {
    if (!pane.hidden) {
      resize();
      draw();
    }
  });

  window.__TOTEM_CLUSTER_3D_V2__ = {`,
`  window.addEventListener("resize", function () {
    resize();
    draw();
  });

  window.requestAnimationFrame(function () {
    resize();
    draw();
  });

  window.__TOTEM_CLUSTER_3D_V2__ = {`, "standalone initial render");

source = mustReplace(source,
`    capabilityConsumerEndpoint: capabilityConsumerEndpoint,
    panBy: panBy,
    draw: draw`,
`    capabilityConsumerEndpoint: capabilityConsumerEndpoint,
    panBy: panBy,
    drawArrowhead: drawArrowhead,
    keyboardNodes: keyboardNodes,
    showContracts: showContracts,
    draw: draw`, "standalone parity exports");

fs.writeFileSync(rendererPath, source);

fs.writeFileSync("graph-v2.html", `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'">
<title>TOTEM Architecture V2</title>
<link rel="stylesheet" href="viewer/graph-v2.css">
</head>
<body>
<div class="app">
  <header class="bar">
    <div class="brand">
      <b>TOTEM Architecture V2</b>
      <small>3D architecture explorer · architecture data is loaded separately</small>
    </div>
    <span class="pill" id="snapshot">loading</span>
    <span class="pill" id="stats">loading</span>
    <button id="overview" type="button">總覽</button>
    <button id="expandAll3d" type="button">全展開</button>
    <button id="contracts" type="button">關係</button>
  </header>
  <main class="stage">
    <section id="pane3d" class="pane">
      <canvas id="graph3d" class="canvas3d" tabindex="0" role="application" aria-label="TOTEM 3D 架構圖；方向鍵切換節點，Enter 或空白鍵啟動"></canvas>
      <div class="hint3d">點模組展開成 cluster｜功能 / capability / code 固定散點分層｜左鍵旋轉・右鍵拖曳平移・滾輪縮放｜手機一指旋轉・兩指縮放＋平移｜鍵盤方向鍵選節點・Enter / Space 啟動｜箭頭表示關係方向</div>
    </section>
    <aside id="info" class="info" hidden>
      <h2 id="infoTitle"></h2>
      <p id="infoBody"></p>
      <div id="infoContent"></div>
    </aside>
    <div class="legend">
      <span><i class="dot hard"></i>Hard dependency</span>
      <span><i class="dot suggest"></i>Fabric suggests</span>
      <span><i class="dot compat"></i>Runtime / Observer / EventBus</span>
      <span><i class="dot service"></i>External service</span>
      <span><i class="dot capability"></i>Shared Core capability</span>
      <span><i class="dot generated"></i>Generated code detail</span>
    </div>
  </main>
</div>
<script src="viewer/generated/graph-data.js"></script>
<script src="viewer/graph-v2-adapter.js"></script>
<script src="viewer/graph-v2-cluster-v2.js"></script>
</body>
</html>
`);

fs.writeFileSync("viewer/graph-v2.css", `:root{color-scheme:dark;--bg:#050b14;--panel:#071522;--ink:#edf6ff;--muted:#8fa5bd;--hard:#60a5fa;--suggest:#fbbf24;--compat:#a78bfa;--service:#22d3ee;--capability:#f472b6;--generated:#34d399}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{overflow:hidden;background:radial-gradient(circle at 42% 16%,#12304c 0,#081522 34%,var(--bg) 74%);color:var(--ink);font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
.app{height:100dvh;display:grid;grid-template-rows:auto 1fr}.bar{z-index:5;display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #26394f;background:#06101bee;box-shadow:0 10px 30px #0008;backdrop-filter:blur(12px)}
.brand{margin-right:auto}.brand b{display:block;font-size:18px}.brand small{display:block;margin-top:2px;color:var(--muted);font-size:11px}.pill{padding:5px 9px;border:1px solid #38506a;border-radius:999px;color:#bdd0e5;background:#0c1d2d;font-size:11px}
button{border:1px solid #38506a;border-radius:9px;background:#10253a;color:var(--ink);padding:7px 11px;font-weight:750;cursor:pointer}button:hover{background:#17344f}.stage{position:relative;min-height:0}.pane{position:absolute;inset:0}
.legend{position:absolute;left:12px;bottom:12px;z-index:3;display:flex;gap:9px;flex-wrap:wrap;max-width:min(1120px,calc(100% - 24px));padding:7px 10px;border:1px solid #26394f;border-radius:11px;background:#06131fe9;color:#a8bdd2;font-size:11px}.dot{display:inline-block;width:14px;height:3px;margin-right:5px;vertical-align:middle}.dot.hard{background:var(--hard)}.dot.suggest{background:var(--suggest)}.dot.compat{background:var(--compat)}.dot.service{background:var(--service)}.dot.capability{background:var(--capability)}.dot.generated{background:var(--generated)}
.info{position:absolute;right:14px;top:14px;z-index:4;width:min(460px,calc(100% - 28px));max-height:calc(100% - 28px);overflow:auto;padding:14px;border:1px solid #2d435c;border-radius:13px;background:#071522f2;box-shadow:0 18px 44px #0009}.info[hidden]{display:none}.info h2{font-size:17px;margin:0 0 6px}.info p{color:#b8c9da;line-height:1.55;font-size:13px}.info h3{margin:14px 0 7px;color:#93c5fd;font-size:11px;letter-spacing:.08em}.item{margin:6px 0;padding:8px 9px;border:1px solid #334b63;border-radius:8px;background:#102033;color:#d7e5f4;font-size:12px;line-height:1.45;overflow-wrap:anywhere}
.canvas3d{width:100%;height:100%;display:block;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;overscroll-behavior:none}.canvas3d.dragging{cursor:grabbing}.canvas3d:focus-visible{outline:2px solid #67e8f9;outline-offset:-3px}.hint3d{position:absolute;left:12px;top:12px;z-index:2;max-width:min(880px,calc(100% - 24px));padding:7px 10px;border-radius:9px;background:#06111edb;border:1px solid #2b4057;color:#a9bdd0;font-size:12px;pointer-events:none}
@media(max-width:820px){.brand{width:100%}.pill{display:none}.bar{gap:6px;padding:8px}.bar button{padding:7px 9px;font-size:12px}.info{top:auto;bottom:12px;max-height:44%}.legend{display:none}.hint3d{font-size:11px;right:10px;left:10px;top:8px}}
`);

let pages = fs.readFileSync(".github/workflows/pages.yml", "utf8");
pages = pages.replace("          cp viewer/graph-v2.js _site/viewer/graph-v2.js\n", "");
fs.writeFileSync(".github/workflows/pages.yml", pages);

fs.writeFileSync("scripts/validate-3d-only-parity.mjs", `#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("graph-v2.html", "utf8");
const source = fs.readFileSync("viewer/graph-v2-cluster-v2.js", "utf8");
const css = fs.readFileSync("viewer/graph-v2.css", "utf8");
const pages = fs.readFileSync(".github/workflows/pages.yml", "utf8");

assert.ok(!fs.existsSync("viewer/graph-v2.js"), "legacy 2D/base renderer must be deleted");
assert.ok(!html.includes("mode2d") && !html.includes("pane2d") && !html.includes("graph2d"), "2D controls and pane must be removed");
assert.ok(!html.includes('src="viewer/graph-v2.js"'), "legacy renderer must not be loaded");
assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'), "standalone 3D renderer must be loaded");
assert.ok(!css.includes(".svg-wrap") && !css.includes(".node rect") && !css.includes(".section-title"), "2D SVG presentation CSS must be removed");
assert.ok(!pages.includes("cp viewer/graph-v2.js"), "Pages must not publish the deleted 2D renderer");

assert.ok(source.includes("drawArrowhead"), "3D relationships must render arrowheads");
assert.ok(source.includes("if (!internal) drawArrowhead"), "directed contract/capability edges must receive arrowheads");
assert.ok(source.includes('title: "Feature groups"'), "3D module info must expose featureGroups metadata");
assert.ok(source.includes('title: "Summary"'), "3D module info must retain curated/code/capability summary counts");
assert.ok(source.includes("function showContracts"), "3D renderer must own the relationship list button");
assert.ok(source.includes("validated contracts"), "3D relationship list must expose the full contract inventory");
assert.ok(source.includes("document.getElementById(\"snapshot\").textContent"), "3D renderer must initialize snapshot metadata");
assert.ok(source.includes("document.getElementById(\"stats\").textContent"), "3D renderer must initialize statistics metadata");

assert.ok(html.includes('tabindex="0"') && html.includes('role="application"'), "3D canvas must be keyboard-focusable");
assert.ok(source.includes('canvas.addEventListener("keydown"'), "3D renderer must implement keyboard navigation");
assert.ok(source.includes('event.key === "ArrowRight"') && source.includes('event.key === "ArrowLeft"'), "arrow keys must navigate nodes");
assert.ok(source.includes('event.key === "Enter" || event.key === " "'), "Enter/Space must activate the focused node");
assert.ok(source.includes("keyboardFocusId"), "keyboard focus must be represented visually in the 3D renderer");
assert.ok(html.includes("鍵盤方向鍵選節點"), "visible help must document keyboard navigation");

console.log("3D-only parity validation passed: directional edges, module metadata, contracts/stats ownership, keyboard navigation, and 2D removal are complete.");
`);

let validate = fs.readFileSync(".github/workflows/validate.yml", "utf8");
if (!validate.includes("Validate 3D-only feature parity")) {
  validate = validate.replace(
    "      - name: Validate deterministic 3D module clusters\n        run: node scripts/validate-3d-cluster.mjs\n",
    "      - name: Validate deterministic 3D module clusters\n        run: node scripts/validate-3d-cluster.mjs\n      - name: Validate 3D-only feature parity\n        run: node scripts/validate-3d-only-parity.mjs\n"
  );
}
fs.writeFileSync(".github/workflows/validate.yml", validate);

let clusterValidation = fs.readFileSync("scripts/validate-3d-cluster.mjs", "utf8");
clusterValidation = clusterValidation.replace(
`assert.ok(
  html.indexOf('src="viewer/graph-v2.js"') < html.indexOf('src="viewer/graph-v2-cluster-v2.js"'),
  "cluster v2 renderer must load after the base renderer"
);`,
`assert.ok(!html.includes('src="viewer/graph-v2.js"'), "standalone 3D must not load the deleted base/2D renderer");
assert.ok(!fs.existsSync(path.join(root, "viewer", "graph-v2.js")), "legacy 2D/base renderer must be deleted");`
);
clusterValidation = clusterValidation.replace(
`assert.ok(css.includes(".cluster3d{position:absolute;inset:0"), "cluster canvas must overlay the 3D pane instead of changing document flow");`,
`assert.ok(css.includes(".canvas3d:focus-visible"), "standalone 3D canvas must expose visible keyboard focus");`
);
clusterValidation = clusterValidation.replace(
`  "function drawCluster",`,
`  "function drawCluster",
  "function drawArrowhead",
  "function keyboardNodes",
  "function showContracts",`
);
clusterValidation = clusterValidation.replace(
`assert.ok(source.includes("gesture.startZoom"), "cluster view must preserve pinch zoom");`,
`assert.ok(source.includes("gesture.startZoom"), "cluster view must preserve pinch zoom");
assert.ok(source.includes('title: "Feature groups"'), "module detail parity must include featureGroups metadata");
assert.ok(source.includes('canvas.addEventListener("keydown"'), "3D-only renderer must preserve keyboard node activation");
assert.ok(source.includes("if (!internal) drawArrowhead"), "relationship directions must be visible through arrowheads");`
);
clusterValidation = clusterValidation.replace(
"3D cluster v2 validation passed: Core-centered topology, deterministic clusters, dynamic spacing, audited Core friendship retargeting, symmetric Shared Manual endpoints, desktop right-drag camera pan, touch gestures, spotlight integration, and Pages packaging are present.",
"3D cluster v2 validation passed: standalone 3D parity, Core-centered topology, deterministic clusters, dynamic spacing, audited Core friendship retargeting, symmetric Shared Manual endpoints, directed edges, keyboard navigation, gestures, spotlight integration, and Pages packaging are present."
);
fs.writeFileSync("scripts/validate-3d-cluster.mjs", clusterValidation);

let panValidation = fs.readFileSync("scripts/validate-3d-pan.mjs", "utf8");
if (!panValidation.includes("legacy 2D/base renderer")) {
  panValidation = panValidation.replace(
    `assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'), "active cluster renderer must be v2");`,
    `assert.ok(html.includes('src="viewer/graph-v2-cluster-v2.js"'), "active cluster renderer must be v2");
assert.ok(!html.includes('src="viewer/graph-v2.js"'), "legacy 2D/base renderer must not be loaded");
assert.ok(!fs.existsSync(path.join(root, "viewer", "graph-v2.js")), "legacy 2D/base renderer must be deleted");`
  );
}
fs.writeFileSync("scripts/validate-3d-pan.mjs", panValidation);

if (fs.existsSync("viewer/graph-v2.js")) fs.rmSync("viewer/graph-v2.js");

console.log("Applied standalone 3D feature parity migration and removed the V2 2D renderer.");
