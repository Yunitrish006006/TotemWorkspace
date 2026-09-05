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

Static / published mode:

```bash
cd viewer_flutter
flutter pub get
flutter run -d chrome
```

When the app is not running on loopback, it stays in `PUBLISHED SNAPSHOT` mode.

### LIVE LOCAL

Start the existing loopback workspace service from the TotemWorkspace root:

```bash
node scripts/serve-local-viewer.mjs
```

Then, in another terminal:

```bash
cd viewer_flutter
flutter run -d chrome
```

Flutter running on localhost automatically discovers `http://127.0.0.1:18765`. The local API accepts browser origins only from `localhost`, `127.0.0.1`, or `::1` and the server itself still binds only to loopback.

LIVE LOCAL provides:

- five-second branch / HEAD / dirty / snapshot-drift polling, plus Japanese locale key coverage (the bridge refreshes this status at most every 12 seconds)
- 11-module workspace status dialog
- incremental code-index refresh through the existing `/api/refresh`
- in-place graph reload from `/api/graph-data` after refresh, without reloading the browser page

For a non-default local API port, build or run with:

```bash
flutter run -d chrome --dart-define=TOTEM_LOCAL_API=http://127.0.0.1:9000
```

Wasm production build:

```bash
flutter build web --wasm
```

## Current scope — Phases 1–3

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
- LIVE LOCAL workspace status and incremental graph refresh
- deterministic layout, architecture-semantic, and live-source regression tests

The old Phase 1-only layout implementation was removed; `lib/model/graph_scene.dart` is the single Flutter scene/layout implementation.

## Pages prototype

GitHub Pages keeps the JavaScript viewer at the site root and publishes Flutter in parallel at:

```text
https://yunitrish006006.github.io/TotemWorkspace/flutter/
```

Pages always uses `PUBLISHED SNAPSHOT` mode; it never probes localhost.

## Next

Remaining pre-cutover work is native desktop workspace access plus generated code-detail category/file/symbol browsing and final parity validation. The JavaScript production viewer is not removed until those cutover criteria are met.
