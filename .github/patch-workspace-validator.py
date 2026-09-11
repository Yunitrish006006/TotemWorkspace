from pathlib import Path
import json

path = Path("scripts/validate-workspace.mjs")
text = path.read_text()

replacements = {
    '["totem-core", "TotemCore", "0.7.16", "master", "b0b57bc98a98140a1c12a660a33952ea61167278", "TotemCore", null],':
        '["totem-core", "TotemCore", "0.7.19", "master", "21217505fa1d1100a00336d657f07fdd3505868b", "TotemCore", null],',
    '["totem-vanilla-tweaks", "TotemVanillaTweaks", "0.1.21", "main", "5d2d352453ef6abd9f59ddac8b203d7d5c5d87af", "TotemVanillaTweaks", ">=0.7.14 <0.8.0"],':
        '["totem-vanilla-tweaks", "TotemVanillaTweaks", "0.1.28", "main", "0360c3f513fe1247f1c4fd96c7d3af7e22365803", "TotemVanillaTweaks", ">=0.7.18 <0.8.0"],',
    '  ["totem-remnant", "TotemRemnant", "0.2.18", "master", "c828f42cee767b98a69d2bebd532b63f322c3b0e", "TotemRemnant", ">=0.7.15 <0.8.0"],':
        '  ["totem-observer", "TotemObserver", "0.1.0", "main", "51e1507564de9a58016977b16798ec1dd143a41d", "TotemObserver", ">=0.7.18 <0.8.0"],\n  ["totem-remnant", "TotemRemnant", "0.2.18", "master", "c828f42cee767b98a69d2bebd532b63f322c3b0e", "TotemRemnant", ">=0.7.15 <0.8.0"],',
    'check(data.snapshot?.date === "2026-09-02", "快照日期必須是 2026-09-02");':
        'check(data.snapshot?.date === "2026-09-11", "active registry 快照日期必須是 2026-09-11");',
    '    "vanillatweaks-remnant-observer",\n    "vanillatweaks-automata-observer",\n    "vanillatweaks-nexus-observer",\n    "vanillatweaks-locksmith-observer",\n    "vanillatweaks-villagers-observer"':
        '    "observer-remnant",\n    "observer-automata",\n    "observer-nexus",\n    "observer-locksmith",\n    "observer-villagers"',
    'check(activeIds.length === expectedModules.length && new Set(activeIds).size === activeIds.length, "curated index.html 必須保留目前已稽核基線模組；新增 registry 模組可先由 generated viewers 自動呈現");':
        'check(activeIds.length === 11 && new Set(activeIds).size === activeIds.length, "curated index.html 必須保留 2026-09-02 的 11-module 歷史基線；新增 registry 模組由 generated viewers 自動呈現");',
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"validator patch anchor missing: {old[:100]}")
    text = text.replace(old, new)

path.write_text(text)

audit_path = Path("data/relationship-audit.json")
audit = json.loads(audit_path.read_text())
audit["contractCount"] = 33
audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")

intelligence_path = Path("scripts/validate-intelligence.mjs")
intelligence = intelligence_path.read_text()
intelligence_replacements = {
    'assert.deepEqual([summary.moduleCount, summary.featureCount, summary.contractCount], [11, 58, 32]);':
        'assert.deepEqual([summary.moduleCount, summary.featureCount, summary.contractCount], [12, 64, 33]);',
    '], [10, 3, 8, 2, 3, 6]);':
        '], [11, 3, 8, 2, 3, 6]);',
    'assert.equal(graphForModule("totem-core", { depth: 1, knowledge }).modules.length, 11);':
        'assert.equal(graphForModule("totem-core", { depth: 1, knowledge }).modules.length, 12);',
    'assert.deepEqual([model.modules.length, model.features.length, model.contracts.length], [11, 58, 32]);':
        'assert.deepEqual([model.modules.length, model.features.length, model.contracts.length], [12, 64, 33]);',
    'assert.deepEqual([parsed.modules.length, parsed.features.length, parsed.contracts.length], [11, 58, 32]);':
        'assert.deepEqual([parsed.modules.length, parsed.features.length, parsed.contracts.length], [12, 64, 33]);',
}
for old, new in intelligence_replacements.items():
    if old not in intelligence:
        raise SystemExit(f"intelligence validator patch anchor missing: {old[:100]}")
    intelligence = intelligence.replace(old, new)

observer_assertion_anchor = 'assert.ok(observerPlan.validationCategories.includes("privacy-redaction"));'
if 'totem-observer' not in intelligence.split(observer_assertion_anchor, 1)[1][:500]:
    intelligence = intelligence.replace(
        observer_assertion_anchor,
        observer_assertion_anchor + '\nassert.ok(resolveTask("修改 Observer Screen provider protocol", knowledge).modules.some((m) => m.id === "totem-observer"));\nassert.ok(knowledge.contracts.filter((c) => c.type === "observer-provider").every((c) => c.from === "totem-observer"));'
    )
intelligence_path.write_text(intelligence)
