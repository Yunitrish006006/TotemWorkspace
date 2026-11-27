# CodexDiscord

CodexDiscord is a **local, allow-listed Discord Bot service** that starts the
Codex CLI already logged in on this host. It is intentionally separate from
the Minecraft mod: TotemDiscordBridge continues to send Minecraft notifications
to Discord, while this service receives a privileged Discord slash command and
starts a local coding session for developing the Totem modules.

It deliberately uses a **separate Discord Bot application** from the Minecraft
bridge. The Minecraft application owns its HTTP Interaction Endpoint and
commands; the Codex application uses the Bot Gateway and owns only `/codex`.
Keeping separate applications prevents command registration and interaction
delivery from overwriting or intercepting each other.

Every configured workspace executes directly through the shared local Codex App
Server runtime. CLI and Discord use the same task routing, model/effort policy
and bounded orchestration constraints. Discord keeps its own sessions and uses
its buttons, modals and attachments for approvals, questions and images.

Short explicit continuations reuse the prior task scope. Token, usage, status,
progress and service-operation questions are routed as read-only
`totem-workspace` work: they keep the selected session directory but do not
inherit an earlier game-module query, add game-module write roots or reload a
broader repository instruction scope.

Optional TotemWorkspace conversation sync is display-only: Viewer receives
fixed work-status events, never prompts, answers, commands or arbitrary text.
Viewer availability cannot block Discord execution. The old conversation prompt
and cancel endpoints return HTTP 410; execution and cancellation stay with DC.

## Security model

- Only `DISCORD_ALLOWED_USER_IDS` may use the commands.
- Only `DISCORD_ALLOWED_CHANNEL_IDS` (or threads beneath those channels) are
  accepted.
- The user can choose only a configured workspace name; Discord can never pass
  an arbitrary host path or shell command. The optional `workspace` root is
  explicit configuration for cross-module work, not a user-supplied path.
- Codex is launched with `--sandbox workspace-write`. This service never uses
  `--dangerously-bypass-approvals-and-sandbox`.
- A Discord conversation stores a separate local Codex session per
  user/channel/workspace. It does **not** attach to an already-open Codex app
  conversation.
- Active work is locked per user/workspace across Discord threads. A second
  thread cannot start a conflicting task until the first finishes or is cancelled.

## Setup

1. Create a dedicated Discord Application such as `Totem Codex`, add its Bot,
   and enable **Message Content Intent**. Do not configure an Interaction
   Endpoint URL; this service receives interactions through the Gateway.
2. Invite that Bot to the intended server with the `bot` and
   `applications.commands` scopes. Grant View Channels, Send Messages,
   Create Public Threads, Send Messages in Threads, Attach Files, Read Message
   History, and Pin Messages in the private Codex channel (older servers may
   expose pinning as Manage Messages). The Bot creates one thread for each new
   Codex session; Goal sessions pin their status card.
3. Copy `.env.example` to `.env`. Put the new Codex Bot token and Application
   ID in `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID`, and put the existing
   Minecraft application ID in `DISCORD_BRIDGE_APPLICATION_ID`. Startup rejects
   a configuration where the two Application IDs are equal. Fill every other
   Discord ID and list only workspaces you are willing to let Codex modify.
4. Install dependencies and verify the pure security/runner tests:

   ```bash
   npm install
   npm test
   ```

5. Confirm this host is already authenticated for the CLI with
   `codex login status`, then start the bot:

   ```bash
   node --env-file=.env src/index.mjs
   ```

The bot registers guild-local slash commands on startup, so command changes
appear quickly in the selected server. `CODEX_WORKSPACES_JSON` can define
explicit aliases; when `CODEX_WORKSPACE_ROOT` is set, direct child directories
with Git metadata (`.git` directory or worktree file) are added automatically
using names derived from their folder names. Repositories already configured
by path keep their explicit aliases. Additions are picked up the next time the
Bot starts and refreshes its guild command registration. Each autocomplete
response returns up to 25 matches. Select `workspace` for tasks spanning
several Totem modules; it is intentionally broader than individual module
choices and is still restricted to the allowed Discord user and channel.
Workspace options use autocomplete: focus or type in the field to see matching
names. The allowlist itself can contain more than 25 repositories.

## Commands

Final replies adapt Markdown pipe tables to labeled row lists because Discord does
not render GitHub-style tables. Supported inline formatting and links remain intact.
Long fenced code blocks are closed/reopened per message with their language and
indentation retained; chunks stay within 1,850 UTF-16 code units without splitting
surrogate pairs. This presentation step runs after local-link sanitization and
does not bypass attachment receipt checks or enable mentions.

For commands with a `workspace` option, the option is optional inside a thread
with one saved session binding. Codex uses that session's workspace; otherwise
it uses the channel's selected workspace or the `workspace` default. If a thread
has multiple workspace bindings, specify one explicitly. `/codex use` always
requires a workspace because it changes the channel setting.

- `/codex run workspace:<name> task:<request>` starts or resumes that caller's
  Codex session for the selected workspace. A new session started in a channel
  gets its own Discord thread. In an existing thread, messages and `/codex run`
  continue that thread's bound workspace and Codex session without creating a
  sibling thread. Thread names are prefixed with `[workspace]`; status messages
  also show the workspace. New session threads include the first task line in
  their title. Existing session threads remain available after a reset.
- `/codex continue workspace:<optional>` privately lists readable conversations
  from the selected workspace. Choose one to preview it, then start an ordinary
  conversation or continue an eligible native Goal in a new thread. A Bot
  controlled active Goal is paused before the fork; work controlled elsewhere
  must be stopped at its source. The new thread inherits the selected workspace.
- `/codex status workspace:<name>` reports whether that session is active.
- `/codex cancel workspace:<name>` sends `SIGTERM` only to that caller's active
  local Codex process.
- `/codex reset workspace:<name>` removes the saved session mapping; it does
  not delete repository files or Codex's global history.
- `/codex use workspace:<name>` changes the workspace used by subsequent normal
  messages in that channel or its threads. Without selection, normal messages
  use `workspace`.
- `/codex model name:<model>` changes the model for subsequent normal messages
  and `/codex run` requests in that channel. Discord shows an autocomplete
  picker populated from the models currently available to this host's Codex
  login; arbitrary model IDs are rejected. Choose **Codex local default** to
  return to the model configured locally for Codex. The catalog is refreshed
  whenever the service starts.
- `/codex reasoning effort:<depth>` shows only the thinking depths that the
  active model supports. Select **Model default** to remove the override; model
  changes also reset the depth to that model's default.
- `/codex progress lines:<0–8>` changes how many recent CLI-style gray activity
  lines are shown live for this user in this channel. The default is 4; choose
  0 to hide progress entirely. When enabled, sanitized commentary and planning
  progress is retained above the final Codex reply. Command execution, file
  changes, and subagent activity appear only in the live tail. The setting
  survives Bot restarts.
- `/codex usage` shows the authenticated Codex account's remaining quota
  percentage for each currently reported usage window and its reset time. This
  response is visible only to the caller. The Bot's Discord activity also shows
  a compact remaining-usage summary; it refreshes at startup, after each Codex
  task finishes, and whenever `/codex usage` is queried.
- `/codex sessions list workspace:<name> query:<optional> source:<optional>`
  privately lists readable local Codex conversations. `source` can narrow the
  list to Codex CLI, VS Code, or Codex App Server. Each entry shows whether it
  has a native Goal and its status; unreadable Goal metadata is marked unknown.
  Goal objectives are never shown in the list. Use the short-lived choice
  token in `/codex sessions preview workspace:<name> thread:<choice>` to read
  sent user/assistant messages privately. The preview card's **選取此對話**
  button saves a pending binding; it does not start a model turn. Use
  `/codex sessions current workspace:<name>` to inspect the binding, or
  `/codex sessions handoff workspace:<name> confirm:true` only after confirming
  that work in the source application has stopped and replies should appear in
  the current allowed Discord channel. The Bot rechecks source metadata before
  it forks. A fork continues from the selected completed turn in a new thread;
  it does not attach to or edit the source thread. An independent App Server's
  idle status cannot prove that another process has stopped writing.
- `/codex goal start workspace:<name> objective:<text> token_budget:<optional>`
  starts a native Codex Goal on the current execution thread.
  `/codex goal status workspace:<name>` is read-only;
  `/codex goal pause workspace:<name>` requests a pause;
  `/codex goal resume workspace:<name>` explicitly resumes an eligible paused
  or blocked Goal. For a settled `budgetLimited` Goal, pass
  `token_budget:<new-total>` to raise the budget and resume that same Goal
  under a fresh exact-thread runtime; the new total must exceed both the old
  budget and tokens used. While the original supervisor is still live, use
  `/codex goal budget` followed by `/codex goal resume` instead. The budget
  command changes a paused Goal's total budget, or updates a live
  `budgetLimited` Goal without resuming it; and
  `/codex goal clear workspace:<name>`
  clears a stopped Goal after read-back confirmation. A settled
  `budgetLimited` Goal can be resumed with the explicit higher-budget option
  above. Clearing the stopped Goal and starting a new one remains available
  when you want a fresh Goal budget while keeping the conversation history.
  If a Goal is still `active` after its Bot supervisor has disappeared, do not
  resume the bound thread directly. Select that source from `/codex sessions
  list`, confirm handoff only after the source has stopped, then run
  `/codex goal resume`. The Bot revalidates the completed-turn anchor and
  native Goal revision, forks a new execution thread, pauses the inherited
  Goal there, and resumes it under the new supervisor. The source thread and
  its Goal are left unchanged; an active source turn or stale history blocks
  recovery. After handoff, either resume the Goal explicitly or send an
  ordinary message / `/codex run` to use a normal session. The latter forks a
  separate Discord thread and pauses only the inherited Goal on that fork;
  the selected source remains unchanged. A prepared fork with its Goal paused
  or blocked continues to accept ordinary conversation. A Bot restart never
  resumes a Goal automatically. If the old Goal is still controlled by this
  Bot, running `/codex goal resume` from a different thread first asks its
  controller to pause, waits for it to settle, refreshes the completed-turn
  anchor, and then forks and resumes the Goal in the new thread. If the old
  controller is unavailable, use the explicit history selection and handoff
  flow above.
  Goal objective and activity summaries are kept out of public channel replies;
  approval and user-input details use private interactions.
- CodexDiscord uses `intelligence/agent-runtime/runtime.mjs`, the shared App
  Server lifecycle and prompt policy. TotemWorkspace supplies execution
  constraints; the primary chooses delegation, specialization and scheduling.
  No role topology or hard-coded coding model is required. Live catalog routing
  prefers capable lightweight/Spark models for bounded work and stronger Astra
  reasoning for ambiguity, shared critical contracts and non-local failures.
  Correctness comes first, total model tokens second, latency third. Compact
  evidence reuse and sequential work avoid repeated repository context.
  Module/write boundaries, dependency ordering, concurrency limits, independent
  review when required, Java 25/Fabric safety, deterministic validation and
  explicit release authorization remain mandatory. Actual runtime events alone
  establish delegation, selected models and usage; missing models are not
  displayed as Spark. Approvals, session resume, steering, images and cancellation
  use the same runtime as other launching surfaces.
- Attach a PNG, JPEG, WebP, or GIF to an ordinary message and Codex receives it
  as visual context; a message containing only an image asks Codex to inspect
  it. `/codex run` also accepts one optional `image` attachment. Up to four
  images, each 25 MiB, are accepted per ordinary message. Images are passed
  directly from Discord's CDN to Codex and are not saved on this host.
- Images generated by Codex are uploaded directly to the final Discord reply.
  Explicit local Markdown links to PNG, JPEG, WebP, GIF, SVG and JAR files in the
  final response are also attached when their real files stay inside the
  selected allow-listed workspace. Up to four output files, with a combined
  maximum of 25 MiB, are sent; Discord may impose a lower limit. JARs must have
  a ZIP local-file header; this is not archive integrity or malware validation.
  SVG files must be UTF-8, no larger than 5 MiB, and use the supported static,
  self-contained subset; scripts, event handlers and external references are
  rejected. Discord receives SVG as a file attachment and may not show an image
  preview.
  No files are executed or extracted. Symlinks cannot escape the workspace;
  only authoritative built-in image-generation results may come from `/tmp`
  (never JARs). Other file types and bare prose paths are not auto-uploaded.
  For a sibling module's JAR, select that module or the explicitly configured
  parent workspace; do not broaden access merely to satisfy an output link.
  Rejected image/SVG/JAR candidates produce an attachment warning rather than
  silently claiming delivery. Incoming attachments remain image-only.
  Final replies replace local attachment links/paths with filenames. Bare paths
  and unsupported local file links produce explicit non-delivery warnings;
  they do not grant permission to upload additional formats or arbitrary files.
  Output files are sent in a separate Discord message. Delivery is acknowledged
  only when that send response contains every expected filename with a distinct
  attachment ID, nonzero size and HTTPS Discord CDN URL. A resolved request
  with missing/partial receipts is not success. Terminal failures return false,
  show a prominent reason and never blindly repeat an uncertain upload.
  Receipt checking does not guarantee future CDN availability or bypass
  Discord permissions, network failures, or server size limits.
  Attachment requests may run for up to five minutes on slow uplinks; one retry
  is allowed, and terminal failures are written to the service journal before
  the final response falls back to text-only delivery.

After enabling Discord's **Message Content Intent** for this Bot Application,
ordinary text from an allowed user in an allowed channel is sent directly to
that user's active Codex session. No mention or command prefix is required.
Keep this channel private: every ordinary message from the configured user is a
Codex task. Slash-command responses remain ephemeral; ordinary-message
responses are visible in the allowed channel.

While a task is running, its initial Bot response is edited in place with safe
progress. A rolling CLI-style activity tail uses Discord's gray subtext for
readable reasoning summaries, commands, file changes, searches, and tool calls.
Sensitive command details are redacted, and raw reasoning text and command
output are not posted to Discord. When Codex asks a question, each request gets an **回答問題** button and a modal.
Only its owner in the allowed channel can submit answers; no choice is submitted
automatically. Overlapping questions keep separate cards. Secret questions and
questions too large for Discord fail explicitly and require a native surface.
Task-wide command approval never answers questions.

When Codex needs approval, that same message becomes an approval card
with **Allow once**, **Allow for this session**, and **Decline** buttons. Only
the configured Discord user in the configured channel can answer those buttons.
The service continues to run in the `workspace-write` sandbox; a button never
grants `danger-full-access`.

The approval card also offers **Allow all for this task**. It accepts the
current request and automatically accepts later command, file-change, and
permission requests only until that active task finishes or is cancelled. The
choice is never carried into a later Discord message or Codex task.

By default, local task budgets count only the accepted current turn: 40 tool calls or 48K
input context produce a checkpoint; 80 calls or 64K context stop the task.
Historical usage replayed while resuming a thread cannot trigger this guard.
The summary labels whole-thread token totals separately from current-turn
context and tools. A local budget stop is distinct from account quota exhaustion.
Telemetry stores numeric usage and bounded-context byte counts only. Missing
runtime fields remain unknown, token estimates are labelled as estimates, and
compaction remains unknown unless the App Server emits a compaction event. It
does not retain prompts, secrets or unsent input.
For terminal-like continuous tasks, the host owner can set
`CODEX_USAGE_GUARD_MODE=observe` and `CODEX_MAX_RUNTIME_SECONDS=0` in the service
environment and restart the idle Bot. Observe mode keeps usage checkpoints and
telemetry without stopping at the local tool/context thresholds; the model also
receives this policy on both new and resumed threads. `/codex status` shows the
effective mode and time limit. Other surfaces keep their default enforced
budgets. Account quotas, model context capacity, cancellation, sandbox and
approval checks still apply. Discord messages cannot change this host setting.
At the warning threshold the session store writes one restart-safe, bounded
checkpoint per thread/turn. It contains only repository-relative changed paths,
branch/HEAD, numeric usage and fixed summaries/risks; it never copies the prompt
or full conversation. Follow-up context carries task/checkpoint/evidence hashes
and expands evidence only when a reference is missing, stale or contradicted.
In enforce mode, if the current turn itself exceeds the context limit, save a bounded handoff,
use `/codex reset` for that workspace and send the handoff with the next task.
Reset removes only Discord's session mapping; Codex history remains on disk.
Saved `/codex model` and `/codex reasoning` overrides remain in effect until
changed through those commands.

To redirect a running task like Codex CLI, reply directly to its persistent
status message. The reply's text and up to four trusted Discord image
attachments are appended to the same in-flight turn in arrival order. The Bot
acknowledges an accepted reply with `↪️`; ordinary messages that are not replies
keep the existing busy-task behavior. A reply cannot approve an operation or
grant permissions: approval buttons remain the only approval path.

The persistent status message keeps the Discord **question/request**, current
status, and a short sanitized activity tail while work is running. Approval
details are shown only while the decision is pending. On completion, operational
command, file-change, and subagent entries are removed with the live status;
only sanitized commentary/planning progress may remain above Codex's final
response. Streamed progress is accumulated without character slicing so its
sentences remain complete; long final output is split across Discord messages
without dropping text.

Direct Gradle compilation, test, and local packaging tasks are accepted
automatically. Shell-wrapped commands, cleanup, publishing, network or file
scope changes, and other operations still require the allowed Discord user to
decide.

Short slash-command responses are ephemeral. A running `/codex run` request is
instead a persistent status message: Discord expires interaction webhooks after
a short window, while a normal Bot message keeps its approval controls and
progress updates usable for the complete local run. Keep the allowed channel
private, because long-running task prompts and final results are visible there.

## Service operation

Run this as the same operating-system user that owns the existing Codex login.
Keep `.env` outside source control. A systemd unit should use an `EnvironmentFile`
with mode `0600`, set `WorkingDirectory` to this directory, and run only after
the configured workspaces are mounted.

CodexDiscord is maintained inside TotemWorkspace at `tools/codex-discord/`.
Use the tracked [systemd template](systemd/codex-discord.service) for a per-user
service, then place the mode-`0600` `.env` next to this README. The template
uses `%h/workspace/TotemWorkspace`, so adjust it only if this workspace lives
somewhere else.

`CODEX_MAX_RUNTIME_SECONDS=0` leaves Codex tasks running until they complete or
the user cancels them. Set it to 30–7200 only when a finite safety deadline is
desired.

`CODEX_WORKLOAD_SCOPE_MODE` controls Codex App Server process ownership:

- `auto` (default) uses a validated `systemd --user` transient scope when the
  user manager and `systemd-run` are available, otherwise it records a fixed
  warning and uses direct spawn.
- `systemd` requests the same scoped path and still fails safely to direct spawn
  when the host cannot provide it.
- `direct` deliberately skips the probe and retains the legacy child process.

Scoped launches preserve cwd, environment and stdio. Cancellation signals the
whole scope and then the launcher; cgroup separation does not replace normal
cancel/shutdown cleanup. Generated unit names are bounded and never derived from
Discord input. Source or environment changes take effect only after an
authorized restart of an idle service. Do not restart the service to apply them
while a task is active.

### Optional TotemWorkspace sync

Set all of the following in the same mode-`0600` environment file as the Bot.
The channel must already be in `DISCORD_ALLOWED_CHANNEL_IDS`; the URL is
validated as loopback-only, and the token must be the exact value configured as
`TOTEM_CONVERSATION_SYNC_TOKEN` for `scripts/serve-local-viewer.mjs`.

```dotenv
TOTEM_WORKSPACE_SYNC_URL=http://127.0.0.1:18765/
TOTEM_WORKSPACE_SYNC_TOKEN=replace-with-the-same-long-random-secret
TOTEM_WORKSPACE_SYNC_CHANNEL_ID=your-allowed-channel-id
TOTEM_WORKSPACE_SYNC_WORKSPACE=workspace
```

This relay never exposes the token to the browser and does not persist full
prompts in TotemWorkspace replay data. Discord cannot expose characters in a
user's unsubmitted composer, so Discord input is shown in the web transcript
when the message is sent; browser drafts are mirrored in a throttled Bot-owned
preview message.

### Native Goal and local conversation history

Both Discord surfaces are disabled by default. To enable them, set the
host-owned values below in the Bot's mode-`0600` environment file:

```dotenv
CODEX_DISCORD_GOALS_ENABLED=true
CODEX_DISCORD_HISTORY_ENABLED=true
CODEX_HISTORY_OWNER_USER_ID=your-allow-listed-discord-user-id
CODEX_HISTORY_THREAD_GRANTS_JSON=[]
```

The history owner must also appear in `DISCORD_ALLOWED_USER_IDS`. Per-thread
grants are optional entries such as
`[{"threadId":"exact-local-thread-id","userId":"allow-listed-user-id"}]`;
they authorize only those exact threads and never grant access to the whole
local history. Keep this host-owned configuration private. The history browser
shows only conversations readable from this host's configured workspaces; it
does not fetch cloud conversations or scan arbitrary session files. History
lists and previews are ephemeral, and selection creates a pending safe-fork
handoff. A source that is active, changes after preview, or cannot be safely
revalidated stays read-only. Pausing, clearing, raising a budget, and resuming a
native Goal are explicit actions; unavailable state remains unavailable rather
than being guessed. Apply feature-flag changes only while the Bot is idle and
through the host's authorized service procedure. The current test and evidence
limits are tracked in
[`docs/codex-discord-goals-history-acceptance.md`](../../docs/codex-discord-goals-history-acceptance.md).

The same runtime is available without Discord through
`node scripts/totem-runtime.mjs run "<task>"` from TotemWorkspace, or by invoking
that script's absolute path from a sibling repository. Use `--cwd` to select an
explicit workspace, pipe a task through stdin when convenient, and use
`resume --thread <id> "<next task>"` to continue the session ID printed to stderr.
`--read-only` confines inspection; SIGINT cancels the active turn. This minimal
CLI declines approvals because it has no approval UI. `capabilities` performs
read-only discovery without a model turn and is also used by remote Bridge
`doctor`; it reports CLI/App Server, live models, MCP and intelligence status.

All shared runtime processes coordinate writes through the conservative
workspace-wide advisory lock at `.totem-index/runtime-write-leases/workspace.lock`.
The lock is created exclusively with mode 0600 and removed only when its ownership
token matches. Different processes serialize writing tasks; one process may run
independent module tasks within the plan's concurrency limits. Read-only tasks do
not acquire this lock. If abrupt termination leaves a lock whose recorded PID no
longer exists, the runtime serializes recovery, rechecks the exact lock token and
PID, then reclaims it before starting a writer. Live, malformed, unknown, or
concurrently recovering owners fail closed; do not remove those locks manually.
The runtime waits for App Server process-close evidence before releasing write
ownership. Shutdown escalates from SIGTERM to SIGKILL after two seconds; if close
is still unconfirmed after four seconds, the task fails and retains the lock.
Confirm the App Server and any remaining task processes have stopped before
manually cleaning this exceptional local state.
