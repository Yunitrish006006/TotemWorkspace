# Local Live 3D Viewer

Run the same standalone 3D architecture viewer against the Totem repositories currently present on this machine.

```bash
node scripts/serve-local-viewer.mjs
```

Open:

```text
http://127.0.0.1:8765/
```

The server binds to loopback only. Non-loopback hosts are rejected by design.

## Live mode

When the viewer detects the local API it shows a `LIVE LOCAL` badge plus:

- `本機狀態` — branch, short HEAD, dirty state, missing repositories, and snapshot drift for all 11 active Totem modules.
- `重新整理本機` — incrementally refreshes the local code index, regenerates `viewer/generated/graph-data.js`, then reloads the same 3D viewer.

The status badge refreshes every 5 seconds. GitHub Pages uses the same HTML/JS, but the local adapter silently disables itself when the local API is not available.

## Local API

- `GET /api/health`
- `GET /api/workspace-status`
- `GET /api/graph-data`
- `POST /api/refresh`

`/api/workspace-status` deliberately omits absolute repository paths from the browser response.

An alternate loopback port can be selected with:

```bash
node scripts/serve-local-viewer.mjs --port 9000
```
