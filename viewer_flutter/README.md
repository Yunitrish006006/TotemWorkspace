# TotemWorkspace Flutter Viewer

Flutter migration prototype for the TotemWorkspace architecture viewer. It remains parallel to the production JavaScript viewer until all cutover criteria are proven.

## Data invariant

`viewer_flutter/assets/graph-data.json` is generated from the same `buildGraphViewModel()` used by the production viewer. Do not hand-maintain a third graph.

```bash
node scripts/render-flutter-graph.mjs
```

Run that command from the TotemWorkspace repository root before launching Flutter.

## Web

Flutter 3.47.0 is the validated SDK.

```bash
cd viewer_flutter
flutter pub get
flutter run -d chrome
```

Wasm production build:

```bash
flutter build web --wasm
```

## Current scope — Phase 1 + Phase 2

- same generated architecture model
- TotemCore fixed at world origin
- deterministic peripheral module and external-service layout
- curated feature clusters
- Shared Manual / shared-capability endpoints
- relation-aware weighted junction placement with deterministic slotting
- expanded module-center suppression
- seven-family relationship filters
- spotlight for selected child nodes and related clusters
- directed contract arrows
- desktop left-drag rotation, right-drag pan, wheel zoom
- touch one-finger rotation and two-finger zoom/pan
- keyboard arrows, Enter/Space, Home, End, Escape
- responsive desktop/mobile details panel
- deterministic layout and architecture-semantic regression tests

The old Phase 1-only layout implementation was removed; `lib/model/graph_scene.dart` is now the single Flutter scene/layout implementation.

## Next

Phase 3 connects Flutter to the existing loopback local workspace API and adds native desktop workspace sources. Generated code-detail category/file/symbol browsing is still required before production cutover.
