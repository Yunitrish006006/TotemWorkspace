# TotemWorkspace Flutter Viewer

Phase 1 of the Flutter rewrite. This is intentionally parallel to the production JavaScript viewer until feature parity is proven.

## Data invariant

`viewer_flutter/assets/graph-data.json` is generated from the same `buildGraphViewModel()` used by the production viewer. Do not hand-maintain a third graph.

```bash
node scripts/render-flutter-graph.mjs
```

Run that command from the TotemWorkspace repository root before launching Flutter.

## Web

Flutter 3.47.0 is the validated SDK for this phase.

```bash
cd viewer_flutter
flutter pub get
flutter run -d chrome
```

Wasm production build:

```bash
flutter build web --wasm
```

## Desktop

The Dart/UI code is platform-neutral. Native desktop runner folders are intentionally deferred until Phase 2; once enabled, the same graph renderer can run on macOS, Windows, and Linux without changing graph semantics.

## Phase 1 scope

- same generated architecture model
- TotemCore fixed at world origin
- deterministic peripheral module and external-service layout
- perspective camera with drag rotation and wheel zoom
- directed contract edges
- node hit testing and module detail panel
- keyboard Home/Escape basics
- deterministic layout/unit tests

Not yet migrated: feature clusters, relation-aware child placement, contract filters, spotlight parity, local-live workspace source, and desktop-native Git/filesystem access.
