# Local Live Flutter Viewer

Local Bridge 讓 Flutter Viewer 讀取目前機器上的 Totem repositories、Workspace Intelligence、Agent Activity 與 verification/change state。

```bash
node scripts/serve-local-viewer.mjs
```

預設開啟：

```text
http://127.0.0.1:18765/
```

Server 只綁定 loopback；非 loopback host 會被拒絕。

## Live mode

Flutter 偵測到 Local Bridge 後會進入 `LIVE LOCAL`，可使用：

- branch、short HEAD、dirty state、missing repositories 與 snapshot drift
- locale coverage
- incremental code-index refresh
- `/api/graph-data` 的即時 graph reload
- Agent Activity 與 semantic source focus
- Change Intelligence
- Verification Graph
- Development Replay
- 明確 opt-in 的 Prompt / Codex Agent Adapter

`POST /api/refresh` 重新索引後會更新 shared graph model；持久化 Viewer asset 只使用 `viewer_flutter/assets/graph-data.json`。舊 `viewer/generated/graph-data.js` 與 browser JavaScript Viewer 已移除。

## Local API

主要 endpoints 包括：

- `GET /api/health`
- `GET /api/workspace-status`
- `GET /api/graph-data`
- `POST /api/refresh`
- `GET /api/viewer-settings`
- `GET /api/activity`
- `GET /api/change-intelligence`
- `GET /api/verification-state`
- `GET /api/replay`
- `POST /api/prompt`

`/api/workspace-status` 不會向 browser response 暴露 absolute repository paths。Prompt 預設關閉，且 Browser 不能指定 executable、cwd、sandbox、model 或 CLI flags。

可指定其他 loopback port：

```bash
node scripts/serve-local-viewer.mjs --port 9000
```

不再提供 `/legacy/` 或 `/graph-v2.html` Viewer route；Flutter 是唯一維護中的 UI surface。
