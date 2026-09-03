from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing marker: {label}")
    return text.replace(old, new, 1)

# --- HTML ---
html_path = Path("graph-v2.html")
html = html_path.read_text()
html = replace_once(
    html,
    '    <button id="expandAll3d" type="button">全展開</button>\n    <button id="contracts" type="button">關係</button>',
    '''    <button id="expandAll3d" type="button">全展開</button>\n    <div class="filter-wrap">\n      <button id="edgeFilters" type="button" aria-expanded="false" aria-controls="edgeFilterPanel">線條 7/7</button>\n      <div id="edgeFilterPanel" class="edge-filter" hidden>\n        <b>線條種類</b>\n        <label><input type="checkbox" data-edge-filter="hard-core" checked><i class="dot hard"></i>Hard Core</label>\n        <label><input type="checkbox" data-edge-filter="fabric-suggests" checked><i class="dot suggest"></i>Fabric suggests</label>\n        <label><input type="checkbox" data-edge-filter="runtime-optional" checked><i class="dot compat"></i>Runtime optional</label>\n        <label><input type="checkbox" data-edge-filter="eventbus" checked><i class="dot compat"></i>EventBus</label>\n        <label><input type="checkbox" data-edge-filter="observer-provider" checked><i class="dot compat"></i>Observer provider</label>\n        <label><input type="checkbox" data-edge-filter="external-service" checked><i class="dot service"></i>External service</label>\n        <label><input type="checkbox" data-edge-filter="shared-capability" checked><i class="dot capability"></i>Shared Core capability</label>\n        <small>展開模組後，只保留能落到實際 feature / capability endpoint 的跨模組線。</small>\n        <div class="filter-actions">\n          <button id="edgeFilterAll" type="button">全部</button>\n          <button id="edgeFilterNone" type="button">清除</button>\n        </div>\n      </div>\n    </div>\n    <button id="contracts" type="button">關係</button>''',
    "filter controls"
)
html = html.replace(
    '點模組展開成 cluster｜功能 / capability / code 關係感知固定散點分層｜高交集節點靠近共同 junction｜左鍵旋轉・右鍵拖曳平移・滾輪縮放｜手機一指旋轉・兩指縮放＋平移｜鍵盤方向鍵選節點・Enter / Space 啟動｜箭頭表示關係方向',
    '點模組展開成 cluster｜關係感知固定散點分層・高交集節點靠近共同 junction｜展開後不保留 module-center 舊線｜線條按種類篩選｜左鍵旋轉・右鍵拖曳平移・滾輪縮放｜手機一指旋轉・兩指縮放＋平移｜箭頭表示關係方向'
)
html_path.write_text(html)

# --- CSS ---
css_path = Path("viewer/graph-v2.css")
css = css_path.read_text()
filter_css = '''\n.filter-wrap{position:relative}.edge-filter{position:absolute;right:0;top:calc(100% + 8px);z-index:8;width:300px;padding:11px;border:1px solid #38506a;border-radius:11px;background:#071522f7;box-shadow:0 18px 44px #000a}.edge-filter[hidden]{display:none}.edge-filter>b{display:block;margin-bottom:7px;font-size:12px}.edge-filter label{display:flex;align-items:center;gap:5px;padding:5px 2px;color:#d7e5f4;font-size:12px;cursor:pointer}.edge-filter input{margin:0 3px 0 0;accent-color:#67e8f9}.edge-filter small{display:block;margin-top:7px;color:#8fa5bd;line-height:1.45}.filter-actions{display:flex;gap:7px;margin-top:9px}.filter-actions button{flex:1;padding:6px 8px;font-size:11px}\n'''
if ".edge-filter{" not in css:
    css = replace_once(css, "\n@media(max-width:820px)", filter_css + "@media(max-width:820px)", "edge filter css")
css = css.replace(
    '@media(max-width:820px){.brand{width:100%}',
    '@media(max-width:820px){.brand{width:100%}.filter-wrap{position:static}.edge-filter{position:fixed;left:8px;right:8px;top:112px;width:auto}'
)
css_path.write_text(css)

# --- Renderer ---
renderer_path = Path("viewer/graph-v2-cluster-v2.js")
s = renderer_path.read_text()
s = replace_once(
    s,
    '  var contractMap = new Map(contracts.map(function (x) { return [x.id, x]; }));\n\n  var expanded = new Set();',
    '''  var contractMap = new Map(contracts.map(function (x) { return [x.id, x]; }));\n  var edgeFilterKeys = [\n    "hard-core",\n    "fabric-suggests",\n    "runtime-optional",\n    "eventbus",\n    "observer-provider",\n    "external-service",\n    "shared-capability"\n  ];\n  var enabledEdgeFilters = new Set(edgeFilterKeys);\n\n  var expanded = new Set();''',
    "edge filter state"
)

insert_marker = '  function isRetargetable(contract) {'
helpers = '''  function edgeGroup(edge) {\n    if (!edge) return null;\n    return edgeFilterKeys.includes(edge.type) ? edge.type : null;\n  }\n\n  function edgeVisible(edge) {\n    var group = edgeGroup(edge);\n    return !group || enabledEdgeFilters.has(group);\n  }\n\n  function expandedCenterEndpoint(id) {\n    return moduleMap.has(id) && expanded.has(id);\n  }\n\n  function syncEdgeFilterUi() {\n    var button = document.getElementById("edgeFilters");\n    if (button) button.textContent = "線條 " + enabledEdgeFilters.size + "/" + edgeFilterKeys.length;\n    document.querySelectorAll("[data-edge-filter]").forEach(function (input) {\n      input.checked = enabledEdgeFilters.has(input.getAttribute("data-edge-filter"));\n    });\n  }\n\n  function setAllEdgeFilters(enabled) {\n    enabledEdgeFilters.clear();\n    if (enabled) edgeFilterKeys.forEach(function (key) { enabledEdgeFilters.add(key); });\n    syncEdgeFilterUi();\n    draw();\n  }\n\n'''
if "function edgeGroup" not in s:
    s = replace_once(s, insert_marker, helpers + insert_marker, "edge filter helpers")

s = replace_once(
    s,
    '''    if (!isRetargetable(contract) || (contract.featureIds || []).length === 0) {\n      edges.push({''',
    '''    if (!isRetargetable(contract) || (contract.featureIds || []).length === 0) {\n      if (expandedCenterEndpoint(contract.from) || expandedCenterEndpoint(contract.to)) return;\n      edges.push({''',
    "expanded center suppression for direct contracts"
)
s = replace_once(
    s,
    '''    fromIds.forEach(function (from) {\n      toIds.forEach(function (to) {\n        edges.push({''',
    '''    fromIds.forEach(function (from) {\n      toIds.forEach(function (to) {\n        if (expandedCenterEndpoint(from) || expandedCenterEndpoint(to)) return;\n        edges.push({''',
    "expanded center suppression for retargeted contracts"
)

# Remove decorative ownership spokes: cluster boundary already conveys ownership.
owner_blocks = [
'''        edges.push({\n          id: "owner:" + feature.id,\n          from: moduleId,\n          to: feature.id,\n          type: "feature-detail",\n          label: "curated feature"\n        });\n''',
'''        edges.push({\n          id: "owner:" + id,\n          from: moduleId,\n          to: id,\n          type: "feature-detail",\n          label: "shared capability"\n        });\n''',
'''        edges.push({\n          id: "owner:" + category.id,\n          from: moduleId,\n          to: category.id,\n          type: "detail",\n          label: "generated code"\n        });\n'''
]
for idx, block in enumerate(owner_blocks, 1):
    if block in s:
        s = s.replace(block, "", 1)
    else:
        raise SystemExit(f"missing owner spoke block {idx}")

s = replace_once(
    s,
    '''      edges.push({\n        id: capability.id,''',
    '''      if (expandedCenterEndpoint(from) || expandedCenterEndpoint(to)) return;\n      edges.push({\n        id: capability.id,''',
    "expanded center suppression for shared capability"
)
s = replace_once(
    s,
    '    return { nodes: nodes, edges: edges, clusters: clusters };',
    '    return { nodes: nodes, edges: edges.filter(edgeVisible), clusters: clusters };',
    "filtered scene edges"
)

listener_marker = '  document.getElementById("contracts").addEventListener("click", showContracts);\n'
filter_listeners = '''  var edgeFilterButton = document.getElementById("edgeFilters");\n  var edgeFilterPanel = document.getElementById("edgeFilterPanel");\n  if (edgeFilterButton && edgeFilterPanel) {\n    edgeFilterButton.addEventListener("click", function () {\n      var opening = edgeFilterPanel.hidden;\n      edgeFilterPanel.hidden = !opening;\n      edgeFilterButton.setAttribute("aria-expanded", opening ? "true" : "false");\n    });\n    document.querySelectorAll("[data-edge-filter]").forEach(function (input) {\n      input.addEventListener("change", function () {\n        var key = input.getAttribute("data-edge-filter");\n        if (input.checked) enabledEdgeFilters.add(key);\n        else enabledEdgeFilters.delete(key);\n        syncEdgeFilterUi();\n        draw();\n      });\n    });\n    document.getElementById("edgeFilterAll").addEventListener("click", function () { setAllEdgeFilters(true); });\n    document.getElementById("edgeFilterNone").addEventListener("click", function () { setAllEdgeFilters(false); });\n    syncEdgeFilterUi();\n  }\n\n'''
if "var edgeFilterButton" not in s:
    s = replace_once(s, listener_marker, filter_listeners + listener_marker, "edge filter listeners")

s = replace_once(
    s,
    '    modulePosition: modulePosition,\n    scatter: scatter,',
    '    modulePosition: modulePosition,\n    scatter: scatter,\n    edgeGroup: edgeGroup,\n    edgeVisible: edgeVisible,\n    expandedCenterEndpoint: expandedCenterEndpoint,',
    "debug exports"
)
renderer_path.write_text(s)

# --- Validator ---
val_path = Path("scripts/validate-3d-cluster.mjs")
v = val_path.read_text()
v = replace_once(
    v,
    'assert.ok(html.includes("右鍵拖曳平移"), "desktop hint must expose right-button camera pan");',
    '''assert.ok(html.includes("右鍵拖曳平移"), "desktop hint must expose right-button camera pan");\nassert.ok(html.includes('id="edgeFilters"'), "3D shell must expose the edge filter control");\nfor (const kind of ["hard-core", "fabric-suggests", "runtime-optional", "eventbus", "observer-provider", "external-service", "shared-capability"]) {\n  assert.ok(html.includes(`data-edge-filter="${kind}"`), `missing edge filter checkbox: ${kind}`);\n}\nassert.ok(css.includes(".edge-filter{"), "edge filter panel must be styled");''',
    "filter validator shell"
)
v = replace_once(
    v,
    '  "function relationAwareScatter",',
    '  "function relationAwareScatter",\n  "function edgeGroup",\n  "function edgeVisible",\n  "function expandedCenterEndpoint",\n  "function syncEdgeFilterUi",',
    "filter validator required funcs"
)
extra = '''\n// Edge filtering and expanded-center cleanup regression.\nassert.ok(source.includes('var edgeFilterKeys = ['), "renderer must keep an explicit list of filterable relationship kinds");\nassert.ok(source.includes('edges.filter(edgeVisible)'), "scene edges must be filtered before spotlight/draw processing");\nassert.ok(source.includes('expandedCenterEndpoint(contract.from) || expandedCenterEndpoint(contract.to)'), "direct contracts must disappear when they would terminate on an expanded module center");\nassert.ok(source.includes('expandedCenterEndpoint(from) || expandedCenterEndpoint(to)'), "retargeted/shared edges must reject expanded module-center endpoints");\nassert.ok(!source.includes('id: "owner:" + feature.id'), "expanded curated features must not keep decorative module-center owner spokes");\nassert.ok(!source.includes('id: "owner:" + category.id'), "expanded code categories must not keep decorative module-center owner spokes");\nassert.ok(source.includes('document.querySelectorAll("[data-edge-filter]")'), "edge filter UI must drive renderer state");\nassert.ok(source.includes('setAllEdgeFilters(true)') && source.includes('setAllEdgeFilters(false)'), "edge filter must support all/none shortcuts");\n'''
if "Edge filtering and expanded-center cleanup regression" not in v:
    v = replace_once(v, '\nassert.deepEqual(audit.contractOverrides', extra + '\nassert.deepEqual(audit.contractOverrides', "edge filter regression section")
val_path.write_text(v)

print("edge filter + expanded-center cleanup patch applied")
