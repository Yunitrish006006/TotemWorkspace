# TotemWorkspace Flutter Viewer

Flutter is the sole maintained TotemWorkspace architecture viewer for GitHub Pages and the local Bridge UI. The previous browser JavaScript viewer has been retired.

## Data invariant

`viewer_flutter/assets/graph-data.json` is generated from the shared `buildGraphViewModel()`. Architecture semantics remain owned by the validated Workspace knowledge layer; Flutter does not maintain a separate dependency graph.

```bash
node scripts/render-flutter-graph.mjs
```

Run that command from the TotemWorkspace repository root before launching Flutter when graph data needs to be refreshed manually.

## Web

Flutter 3.47.0 is the validated SDK.

```bash
cd viewer_flutter
flutter pub get
flutter run -d chrome
```

When the app is not running on loopback, it stays in `PUBLISHED SNAPSHOT` mode.

### LIVE LOCAL

Start the loopback workspace service from the TotemWorkspace root:

```bash
node scripts/serve-local-viewer.mjs
```

Then, in another terminal:

```bash
cd viewer_flutter
flutter run -d chrome
```

Flutter running on localhost automatically discovers `http://127.0.0.1:18765`. The local API accepts browser origins only from loopback and the approved TotemWorkspace GitHub Pages origin; the server itself binds only to loopback.

LIVE LOCAL provides workspace branch / HEAD / dirty / snapshot-drift status, locale coverage, incremental code-index refresh, graph reload, Agent Activity, Prompt intake when explicitly enabled, change intelligence, Verification Graph, orchestration state and Development Replay.

For a non-default local API port:

```bash
flutter run -d chrome --dart-define=TOTEM_LOCAL_API=http://127.0.0.1:9000
```

Wasm production build:

```bash
flutter build web --wasm
```

## Architecture surface

The maintained viewer includes:

- deterministic module, feature and semantic-component layout
- progressive `Module → Feature → Component → Implementation` LOD
- Shared Manual and shared-capability endpoints
- relationship filtering and spotlight
- change-intelligence and verification overlays
- Agent Activity semantic focus and source-location cards
- Development Replay timeline
- desktop, touch and keyboard interaction
- LIVE LOCAL workspace status and graph refresh

`lib/model/graph_scene.dart` is the single Flutter scene/layout implementation.

## GitHub Pages

GitHub Pages publishes the Flutter Wasm build at the repository root:

```text
https://yunitrish006006.github.io/TotemWorkspace/
```

There is no `/legacy/` viewer surface. `index.html` in the repository remains the curated architecture source and is published separately as `/curated.html` for inspection.
