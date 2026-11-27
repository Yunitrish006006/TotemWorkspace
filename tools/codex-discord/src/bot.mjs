import { userInputCard, presentUserInput, userInputModal, answersFromModal, ownsUserInput } from "./user-input.mjs";
import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ActivityType, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import { isAllowedInteraction, isAllowedMessage } from "./config.mjs";
import { validateModel } from "./codex-runner.mjs";
import { discordOutputAttachments, outputFileName, withoutLocalFileLinks } from "./output-images.mjs";
import { conversationKey, sessionKey, taskKey } from "./session-store.mjs";
import { createWorkspaceSync } from "./workspace-sync.mjs";
import { splitDiscordMessage } from "./discord-markdown.mjs";
import { captureRepositoryCheckpoint } from "../../../intelligence/work-registry.mjs";
import { listTurns as listHistoryTurns, readThreadMetadata } from "../../../intelligence/agent-runtime/thread-history.mjs";
import { historyListPayload, historyPreviewPayload, loadHistoryList, loadHistoryPreview, validateHistoryForkSource } from "./history-ui.mjs";
import { formatGoalCommandError, GOAL_COMMAND_ACTIONS } from './goal-command.mjs';
import { createGoalLifecycle } from '../../../intelligence/agent-runtime/goal-lifecycle.mjs';

const MAX_DISCORD_MESSAGE = 1_850;
const PROGRESS_EDIT_INTERVAL_MS = 1_200;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_FILE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i;
const DEFAULT_CLI_PROGRESS_LINES = 4;
const MAX_CLI_PROGRESS_LINES = 8;
const MAX_FINAL_PROGRESS_LINE = MAX_DISCORD_MESSAGE - 3;
const DISCORD_REST_TIMEOUT_MS = 5 * 60 * 1_000;
const LIVE_ONLY_ITEM_TYPES = new Set(["commandexecution", "filechange", "collabagenttoolcall", "collabtoolcall", "subagentactivity"]);

export function commandDefinition(workspaceNames) {
  const workspaceOption = (option, required = false) => option
    .setName("workspace")
    .setDescription("Allowed local workspace")
    .setRequired(required)
    .setAutocomplete(true);
  return new SlashCommandBuilder()
    .setName("codex")
    .setDescription("Run the local Codex CLI in an allow-listed workspace")
    .addSubcommand((subcommand) => subcommand
      .setName("run")
      .setDescription("Start or resume your Codex session")
      .addStringOption((option) => option
        .setName("task")
        .setDescription("Coding task for Codex")
        .setRequired(true))
      .addStringOption(workspaceOption)
      .addAttachmentOption((option) => option
        .setName("image")
        .setDescription("Optional image for Codex to inspect")
        .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName("continue")
      .setDescription("Find a previous conversation and continue it in a new thread")
      .addStringOption(workspaceOption))
    .addSubcommand((subcommand) => subcommand
      .setName("status")
      .setDescription("Show your current Codex session state")
      .addStringOption(workspaceOption))
    .addSubcommand((subcommand) => subcommand
      .setName("cancel")
      .setDescription("Stop your active Codex process")
      .addStringOption(workspaceOption))
    .addSubcommand((subcommand) => subcommand
      .setName("reset")
      .setDescription("Forget your saved Codex session mapping")
      .addStringOption(workspaceOption))
    .addSubcommand((subcommand) => subcommand
      .setName("use")
      .setDescription("Use this workspace for normal messages in this channel")
      .addStringOption(option => workspaceOption(option, true)))
    .addSubcommand((subcommand) => subcommand
      .setName("model")
      .setDescription("Select the Codex model for normal messages in this channel")
      .addStringOption((option) => option
        .setName("name")
        .setDescription("Choose a model available to this local Codex login")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("reasoning")
      .setDescription("Select the reasoning depth for the active Codex model")
      .addStringOption((option) => option
        .setName("effort")
        .setDescription("Choose a depth supported by the active model")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("progress")
      .setDescription("Set the number of gray CLI-style progress lines")
      .addIntegerOption((option) => option
        .setName("lines")
        .setDescription("Number of recent activity lines to show (0 hides them)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(MAX_CLI_PROGRESS_LINES)))
    .addSubcommand((subcommand) => subcommand
      .setName("usage")
      .setDescription("Show remaining Codex account usage"))
    .addSubcommandGroup((group) => group
      .setName("sessions")
      .setDescription("Browse local Codex conversation history")
      .addSubcommand((subcommand) => subcommand
        .setName("list")
        .setDescription("List readable local conversations privately")
        .addStringOption(workspaceOption)
        .addStringOption((option) => option.setName("query").setDescription("Filter conversation titles").setRequired(false))
        .addStringOption((option) => option.setName("source").setDescription("Conversation source")
          .setRequired(false).addChoices(
            { name: "All readable sources", value: "all" },
            { name: "Codex CLI", value: "cli" }, { name: "VS Code", value: "vscode" },
            { name: "Codex App Server", value: "appServer" })))
      .addSubcommand((subcommand) => subcommand
        .setName("preview")
        .setDescription("Open a private read-only conversation preview")
        .addStringOption((option) => option.setName("thread").setDescription("Short-lived private choice token from the history list")
          .setRequired(true))
        .addStringOption(workspaceOption)
        .addStringOption((option) => option.setName("query").setDescription("Repeat the list filter, if used")
          .setRequired(false)))
      .addSubcommand((subcommand) => subcommand
        .setName("current")
        .setDescription("Show the conversation currently bound in this channel")
        .addStringOption(workspaceOption))
      .addSubcommand((subcommand) => subcommand
        .setName("handoff")
        .setDescription("Confirm the selected source work has stopped before continuing here")
        .addBooleanOption(option => option.setName("confirm")
          .setDescription("Confirm source work has stopped and output should continue in this channel")
          .setRequired(true))
        .addStringOption(workspaceOption)))
    .addSubcommandGroup((group) => group
      .setName('goal')
      .setDescription('Inspect and control a native Codex Goal')
      .addSubcommand(subcommand => subcommand
        .setName('start')
        .setDescription('Create and run a native Goal in this workspace')
        .addStringOption(option => option.setName('objective').setDescription('Bounded objective for the native Goal')
          .setRequired(true).setMaxLength(4_000))
        .addStringOption(workspaceOption)
        .addIntegerOption(option => option.setName('token_budget').setDescription('Optional total token budget')
          .setRequired(false).setMinValue(1)))
      .addSubcommand(subcommand => subcommand
        .setName('status')
        .setDescription('Read native Goal status for this workspace')
        .addStringOption(workspaceOption))
      .addSubcommand(subcommand => subcommand
        .setName('pause')
        .setDescription('Pause the native Goal for this workspace')
        .addStringOption(workspaceOption))
      .addSubcommand(subcommand => subcommand
        .setName('resume')
        .setDescription('Resume a safely resumable native Goal')
        .addStringOption(workspaceOption)
        .addIntegerOption(option => option.setName('token_budget').setDescription('Required new budget when recovering a settled budget-limited Goal')
          .setRequired(false).setMinValue(1)))
      .addSubcommand(subcommand => subcommand
        .setName('budget')
        .setDescription('Set the budget on a paused native Goal')
        .addIntegerOption(option => option.setName('token_budget').setDescription('New total token budget')
          .setRequired(true).setMinValue(1))
        .addStringOption(workspaceOption))
      .addSubcommand(subcommand => subcommand
        .setName('clear')
        .setDescription('Clear a stopped native Goal')
        .addStringOption(workspaceOption)));
}

/** Returns bounded workspace suggestions from the configured allowlist. */
export function workspaceAutocompleteChoices(workspaceNames, query = "") {
  const needle = String(query).trim().toLocaleLowerCase();
  return Array.from(workspaceNames)
    .filter((name) => !needle || name.toLocaleLowerCase().includes(needle))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_AUTOCOMPLETE_CHOICES)
    .map((name) => ({ name, value: name }));
}

export function resolveWorkspaceName({ explicit = null, userId, channelId, parentChannelId = null, sessions, workspaceNames }) {
  if (typeof explicit === 'string' && explicit) return explicit;
  const names = Array.from(workspaceNames ?? []);
  const bound = typeof sessions?.get === 'function'
    ? names.filter(workspace => sessions.get(sessionKey({ userId, channelId, workspace }))) : [];
  if (bound.length === 1) return bound[0];
  const active = sessions?.activeWorkspace?.(conversationKey({ userId, channelId }));
  if (bound.length > 1) return bound.includes(active) ? active : null;
  if (names.includes(active)) return active;
  const parentActive = parentChannelId
    ? sessions?.activeWorkspace?.(conversationKey({ userId, channelId: parentChannelId })) : null;
  if (names.includes(parentActive)) return parentActive;
  if (names.includes('workspace')) return 'workspace';
  return names.length === 1 ? names[0] : null;
}

function modelChoiceName(model) {
  const displayName = typeof model.displayName === "string" ? model.displayName.trim() : "";
  const label = displayName && displayName !== model.id ? `${displayName} — ${model.id}` : model.id;
  return label.slice(0, 100);
}

/** Returns Discord autocomplete entries for the current App Server model catalog. */
export function modelAutocompleteChoices(models, query = "") {
  const needle = String(query).trim().toLocaleLowerCase();
  const candidates = [
    { name: "Codex local default", value: "default", id: "default", displayName: "Codex local default", isDefault: true },
    ...models
  ];
  return candidates
    .filter((model) => !needle || model.id.toLocaleLowerCase().includes(needle)
      || model.displayName.toLocaleLowerCase().includes(needle))
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.id.localeCompare(right.id))
    .slice(0, MAX_AUTOCOMPLETE_CHOICES)
    .map((model) => ({ name: model.id === "default" ? model.name : modelChoiceName(model), value: model.id }));
}

function selectedModel(modelId, models) {
  if (modelId === "default") return null;
  if (!models.some((model) => model.id === modelId)) {
    throw new Error("That model is not currently available to this local Codex login");
  }
  return validateModel(modelId);
}

function activeCatalogModel(activeModel, models) {
  if (activeModel !== null) return models.find((model) => model.id === activeModel) ?? null;
  return models.find((model) => model.isDefault) ?? null;
}

function isDiscordImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:"
      && (url.hostname === "cdn.discordapp.com" || url.hostname.endsWith(".discordapp.net"));
  } catch {
    return false;
  }
}

function isImageAttachment(attachment) {
  const contentType = typeof attachment?.contentType === "string" ? attachment.contentType.toLocaleLowerCase() : "";
  return contentType === "image/png"
    || contentType === "image/jpeg"
    || contentType === "image/webp"
    || contentType === "image/gif"
    || (contentType === "" && IMAGE_FILE_EXTENSION.test(attachment?.name ?? ""));
}

/** Converts trusted Discord image attachments into Codex App Server image URLs. */
export function imageUrlsForAttachments(attachments, model) {
  const values = Array.from(attachments ?? []);
  if (values.length === 0) return [];
  if (!model?.inputModalities?.includes("image")) {
    throw new Error("The active Codex model does not support image inputs");
  }
  if (values.length > MAX_IMAGE_ATTACHMENTS) {
    throw new Error(`Attach at most ${MAX_IMAGE_ATTACHMENTS} images in one message`);
  }
  return values.map((attachment) => {
    if (!isImageAttachment(attachment)) throw new Error("Only PNG, JPEG, WebP, and GIF attachments are supported");
    if (Number.isFinite(attachment.size) && attachment.size > MAX_IMAGE_BYTES) {
      throw new Error("Each image must be at most 25 MiB");
    }
    if (!isDiscordImageUrl(attachment.url)) throw new Error("Image attachment URL is not a trusted Discord CDN URL");
    return attachment.url;
  });
}

function reasoningChoiceName(option) {
  const description = typeof option.description === "string" ? option.description.trim() : "";
  return (description ? `${option.reasoningEffort} — ${description}` : option.reasoningEffort).slice(0, 100);
}

/** Returns depth choices that the selected model explicitly advertises. */
export function reasoningAutocompleteChoices(model, query = "") {
  if (!model) return [];
  const needle = String(query).trim().toLocaleLowerCase();
  const defaultName = model.defaultReasoningEffort
    ? `Model default (${model.defaultReasoningEffort})`
    : "Model default";
  const candidates = [
    { name: defaultName, reasoningEffort: "default", description: defaultName },
    ...model.supportedReasoningEfforts
  ];
  return candidates
    .filter((option) => !needle || option.reasoningEffort.toLocaleLowerCase().includes(needle)
      || option.description.toLocaleLowerCase().includes(needle))
    .slice(0, MAX_AUTOCOMPLETE_CHOICES)
    .map((option) => ({
      name: option.reasoningEffort === "default" ? option.name : reasoningChoiceName(option),
      value: option.reasoningEffort
    }));
}

function selectedReasoningEffort(effort, model) {
  if (effort === "default") return null;
  if (!model?.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)) {
    throw new Error("That reasoning depth is not available for the active Codex model");
  }
  return effort;
}

function reasoningLabel(effort) {
  return effort ?? "model default";
}

function splitMessage(message) {
  return splitDiscordMessage(message, MAX_DISCORD_MESSAGE);
}

/**
 * Finishes a persistent status message. Long-running slash-command work uses a
 * normal bot message rather than an expiring interaction webhook, so approval
 * cards remain editable for the whole local Codex run.
 */
export async function statusChunks(status, message, files = []) {
  let content = withoutLocalFileLinks(message);
  let delivered = true;
  if (files.length > 0) {
    try {
      const names = files.map(file => outputFileName(file.name));
      const receipt = await status.channel.send({ content: `Codex 附件：${names.join("、")}`,
        files, allowedMentions: { parse: [] } });
      const attachments = Array.from(receipt?.attachments?.values?.() ?? []);
      const used = new Set();
      for (const file of files) {
        const match = attachments.find(attachment => !used.has(attachment.id)
          && attachment.id && attachment.name === file.name && attachment.size > 0
          && /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\//.test(attachment.url ?? ""));
        if (!match) throw Object.assign(new Error("Attachment receipt incomplete"), { code: "ATTACHMENT_UNCONFIRMED" });
        used.add(match.id);
      }
      content = `附件已另行傳送並由 Discord 確認：${names.join("、")}。\n\n${content}`;
    } catch (error) {
      const code = error?.code ?? error?.rawError?.code;
      const reason = code === 50_013 ? "Bot 缺少 Attach Files 或頻道權限"
        : code === 40_005 || error?.status === 413 ? "超過 Discord 附件大小限制"
        : code === "ATTACHMENT_UNCONFIRMED" ? "Discord 回覆未包含全部預期附件"
        : "上傳失敗或結果不明；請檢查網路、Attach Files 權限及容量限制";
      console.warn(`Discord attachment delivery unconfirmed for ${files.length} file(s).`);
      delivered = false;
      content = `附件交付未完成：${files.map(file => outputFileName(file.name)).join("、")}。${reason}。\n以下僅為文字結果，不代表附件已送達；本機路徑不能下載。\n\n${content}`;
    }
  }
  const [first, ...rest] = splitMessage(content);
  try {
    // Attachments are sent as a separate channel message before finalizing this status.
    await status.edit({ content: first, components: [], allowedMentions: { parse: [] } });
  } catch (error) {
    if (error?.code === 10_008 || error?.rawError?.code === 10_008) {
      console.warn("Discord status message no longer exists; skipping its final update.");
      return false;
    }
    throw error;
  }
  for (const chunk of rest) {
    await status.channel.send({ content: chunk, allowedMentions: { parse: [] } });
  }
  return delivered;
}

/** Keeps a Discord delivery failure from terminating the Gateway event loop. */
export async function safeStatusChunks(status, content, files = []) {
  try {
    return await statusChunks(status, content, files);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Could not update the Discord status message: ${detail}`);
    return false;
  }
}

export async function completedTaskPayload(result, workspace) {
  const attachments = await discordOutputAttachments({
    generatedPaths: result.imagePaths ?? [],
    message: result.message,
    workspace
  });
  const warning = attachments.skipped > 0
    ? `\n\n附件交付未完成：${attachments.skipped} 個附件未上傳。\n${attachments.issues.slice(0, 8).map(issue => `- ${issue.name}：${issue.reason}`).join("\n")}\n本機路徑不是下載連結。`
    : "";
  return { files: attachments.files, warning };
}

function resultPrefix(result) {
  if (result.timedOut) return "Codex exceeded the configured time limit and was stopped.\n\n";
  return result.exitCode === 0 ? "" : `Codex exited with status ${result.exitCode ?? "unknown"}.\n\n`;
}

function publicText(value, limit = 600) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").replace(/@/g, "@\u200b").trim();
  return limit === null ? normalized : normalized.slice(0, limit);
}

function sessionThreadTitle(task, workspaceName) {
  const firstLine = typeof task === 'string' ? task.split(/\r?\n/, 1)[0] : '';
  return publicText(`[${workspaceName}] ${firstLine || `Codex ${workspaceName}`}`, 90);
}

async function annotateSessionThread(channel, workspaceName) {
  if (!channel?.isThread?.() || typeof channel.setName !== 'function') return false;
  const marker = `[${workspaceName}]`;
  if (channel.name === marker || channel.name?.startsWith(`${marker} `)) return true;
  const title = publicText(channel.name?.replace(/^\[[a-z0-9-]+\]\s*/i, '') || `Codex ${workspaceName}`, 70);
  try {
    await channel.setName(publicText(`${marker} ${title}`, 100), `Mark workspace ${workspaceName}`);
    return true;
  } catch {
    return false;
  }
}

function commandLabel(command, limit = 240) {
  const normalized = publicText(command, limit);
  if (!normalized) return "本機指令";
  if (/(token|password|secret|authorization|cookie|private[ _-]?key|\.env)/i.test(normalized)) {
    return "本機指令（敏感內容已隱藏）";
  }
  return `\`${normalized.replace(/`/g, "'")}\``;
}

function safeProgressText(value, limit = null) {
  const normalized = publicText(value, limit);
  if (!normalized) return "";
  if (/(token|password|secret|authorization|cookie|private[ _-]?key|\.env)/i.test(normalized)) {
    return "敏感內容已隱藏";
  }
  return normalized;
}

function durationLabel(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  return `${Math.round(durationMs / 100) / 10}s`;
}

function fileChangeLabel(item) {
  const paths = Array.isArray(item?.changes)
    ? item.changes.flatMap((change) => {
      const path = safeProgressText(change?.path);
      return path ? [path] : [];
    })
    : [];
  if (paths.length === 0) return "工作區檔案";
  const visible = paths.slice(0, 2).join("、");
  return paths.length > 2 ? `${visible} 等 ${paths.length} 個檔案` : visible;
}

function cliItemDetail(item, completed) {
  const type = String(item?.type ?? "").replaceAll("_", "").toLocaleLowerCase();
  const duration = durationLabel(item?.durationMs);
  const suffix = duration ? ` · ${duration}` : "";
  if (type === "commandexecution") {
    const failed = item?.status === "failed" || item?.status === "declined"
      || (Number.isInteger(item?.exitCode) && item.exitCode !== 0);
    const action = completed ? (failed ? "失敗" : "完成") : "執行";
    const exit = completed && Number.isInteger(item?.exitCode) ? ` · exit ${item.exitCode}` : "";
    return `${action}：${commandLabel(item?.command, null)}${exit}${suffix}`;
  }
  if (type === "filechange") {
    return `${completed ? "已修改" : "修改檔案"}：${fileChangeLabel(item)}`;
  }
  if (type === "mcptoolcall") {
    const name = safeProgressText([item?.server, item?.tool].filter(Boolean).join(" / ")) || "整合工具";
    return `${completed ? "工具完成" : "使用工具"}：${name}${suffix}`;
  }
  if (type === "dynamictoolcall") {
    const name = safeProgressText([item?.namespace, item?.tool].filter(Boolean).join(" / ")) || "整合工具";
    return `${completed ? "工具完成" : "使用工具"}：${name}`;
  }
  if (type === "websearch") {
    return `${completed ? "搜尋完成" : "搜尋"}：${safeProgressText(item?.query) || "網路資料"}`;
  }
  if (type === "imageview") return `檢視圖片：${safeProgressText(item?.path) || "圖片"}`;
  if (type === "imagegeneration") return completed ? "圖片產生完成" : "正在產生圖片";
  if (type === "collabagenttoolcall" || type === "collabtoolcall") {
    const model = safeProgressText(item?.model) || "model 未回報";
    if (item?.tool === "spawnAgent") return `${completed ? "已啟動" : "正在啟動"}程式 subagent：${model}`;
    if (item?.tool === "wait") return completed ? "程式 subagent 工作完成" : "正在等待程式 subagent";
    return `${completed ? "subagent 協調完成" : "正在協調 subagent"}：${model}`;
  }
  if (type === "subagentactivity") {
    const byKind = {
      started: "程式 subagent 已開始工作",
      interacted: "程式 subagent 正在回覆協調訊息",
      interrupted: "程式 subagent 已停止"
    };
    return byKind[item?.kind] ?? "程式 subagent 正在工作…";
  }
  return "";
}

function requestedPermissions(permissions) {
  const labels = [];
  if (permissions?.network) labels.push("網路存取");
  if (permissions?.fileSystem) labels.push("額外檔案存取");
  return labels.length ? labels.join("、") : "額外權限";
}

function approvalDescription(approval) {
  if (approval.kind === "user-input") return userInputCard(approval);
  const lines = ["**需要你的授權才能繼續。**"];
  if (approval.kind === "command") {
    if (approval.network) lines.push(`網路連線：\`${approval.network.protocol}://${approval.network.host}\``);
    else lines.push(`指令：${commandLabel(approval.command)}`);
    if (approval.cwd) lines.push(`目錄：\`${publicText(approval.cwd, 180)}\``);
  } else if (approval.kind === "file-change") {
    lines.push(`檔案修改${approval.grantRoot ? `：\`${publicText(approval.grantRoot, 180)}\`` : ""}`);
  } else {
    lines.push(`請求：${requestedPermissions(approval.permissions)}`);
    if (approval.cwd) lines.push(`目錄：\`${publicText(approval.cwd, 180)}\``);
  }
  if (approval.reason) lines.push(`原因：${publicText(approval.reason, 360)}`);
  lines.push("你也可以只針對本次工作，自動允許目前及後續所有要求。");
  return lines.join("\n");
}

export function approvalComponents(token, approval) {
  const allowSession = approval.kind !== "command" || !Array.isArray(approval.availableDecisions)
    || approval.availableDecisions.includes("acceptForSession");
  const buttons = [
    new ButtonBuilder().setCustomId(`codex:approval:${token}:allow`).setLabel("允許一次").setStyle(ButtonStyle.Success)
  ];
  if (allowSession) {
    buttons.push(new ButtonBuilder().setCustomId(`codex:approval:${token}:allow-session`).setLabel("本工作階段允許").setStyle(ButtonStyle.Primary));
  }
  buttons.push(new ButtonBuilder().setCustomId(`codex:approval:${token}:allow-all`).setLabel("本次工作全部允許").setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder().setCustomId(`codex:approval:${token}:decline`).setLabel("拒絕").setStyle(ButtonStyle.Danger));
  return [new ActionRowBuilder().addComponents(...buttons)];
}

function questionText(task) {
  return publicText(task, 720) || "（未提供）";
}

function safeGoalObjective(value) {
  if (typeof value !== 'string' || !value.trim()) return '（未提供）';
  const normalized = publicText(value, 160);
  const labeledSecret = /(?:api[_ -]?key|password|secret|credential|authorization|bearer|token)\s*[:=]/i.test(normalized);
  const credentialFormat = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i;
  const pathOrUrl = /(?:https?:\/\/|www\.)|(?:\/home\/|\/Users\/|\/tmp\/|[A-Za-z]:\\)/i.test(normalized);
  if (labeledSecret || credentialFormat.test(normalized) || pathOrUrl) {
    return '敏感內容已隱藏';
  }
  return safeProgressText(normalized, 160) || '敏感內容已隱藏';
}

function splitProgressLine(text, limit = MAX_FINAL_PROGRESS_LINE) {
  const chunks = [];
  let remaining = safeProgressText(text);
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit + 1);
    const endings = [...candidate.matchAll(/[。！？!?；;](?:["'”’）)\]]*)|\.(?=\s|$)/gu)];
    let cut = endings.at(-1)?.index;
    if (Number.isSafeInteger(cut)) cut += endings.at(-1)[0].length;
    if (!Number.isSafeInteger(cut) || cut < Math.floor(limit / 3)) cut = candidate.lastIndexOf(" ", limit);
    if (cut < 1) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function progressSubtextLines(progressLines) {
  if (!Array.isArray(progressLines)) return [];
  return progressLines.flatMap((line) => splitProgressLine(line).map((part) => `-# ${part}`));
}

export function formatQuestionResult(task, result, progressLines = []) {
  const lines = [
    "**問題／需求**",
    questionText(task),
  ];
  const progress = progressSubtextLines(progressLines);
  if (progress.length > 0) lines.push("", ...progress);
  lines.push(
    "",
    "**Codex 回覆**",
    `${resultPrefix(result)}${result.message}`
  );
  if (result.usageSummary) {
    const summary = result.usageSummary;
    lines.push('', `用量：本輪工具 ${summary.observedToolCalls} 次｜本輪 context ${summary.firstContext ?? '?'}→${summary.peakContext}｜整段對話累計 input/output ${summary.threadInputTokens ?? '?'}/${summary.threadOutputTokens ?? '?'}｜回報模型 ${summary.reportedModel ?? '未知'}｜要求 effort ${summary.requestedEffort ?? '預設'}（非逐輪分佈）`);
    if (summary.stopReason === 'context-limit') lines.push(`本輪 context 已達本機 ${summary.maxContextTokens} tokens 上限，並非帳戶配額耗盡。請先保存工作摘要，再用 \`/codex reset\` 選擇工作區，於新對話提供摘要與明確需求；reset 只移除 DC 的對話對應，原始歷史仍保留。`);
  }
  if (result.telemetry) {
    const telemetry = result.telemetry;
    const tokens = telemetry.tokens ?? {};
    const value = number => Number.isFinite(number) ? number : '?';
    const compacted = telemetry.compaction?.status === 'observed'
      ? `已觀察 ${telemetry.compaction.observedCount} 次`
      : '未知（runtime 未提供事件證據）';
    lines.push('', `Telemetry：input ${value(tokens.inputTokens)}｜cached ${value(tokens.cachedInputTokens)}｜cache-write ${value(tokens.cacheWriteInputTokens)}｜output ${value(tokens.outputTokens)}｜reasoning ${value(tokens.reasoningOutputTokens)}｜bounded context ${value(telemetry.boundedContext?.bytes)} bytes（估算 ${value(telemetry.boundedContext?.estimatedTokens)} tokens）｜compaction ${compacted}`);
  }
  return lines.join("\n");
}

function rateLimitWindowLine(label, window) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  const usedPercent = Math.max(0, Math.min(100, window.usedPercent));
  const remainingPercent = Math.round((100 - usedPercent) * 10) / 10;
  const duration = Number.isSafeInteger(window.windowDurationMins) && window.windowDurationMins > 0
    ? `（${window.windowDurationMins} 分鐘）`
    : "";
  const resetAt = Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0
    ? `，將於 <t:${window.resetsAt}:R> 重置`
    : "";
  return `- ${label}${duration}：剩餘 **${remainingPercent}%**${resetAt}`;
}

function rateLimitSnapshots(usage) {
  const multiBucket = usage?.rateLimitsByLimitId;
  if (multiBucket && typeof multiBucket === "object" && !Array.isArray(multiBucket)) {
    return Object.values(multiBucket).filter((snapshot) => snapshot && typeof snapshot === "object");
  }
  return usage?.rateLimits && typeof usage.rateLimits === "object" && !Array.isArray(usage.rateLimits)
    ? [usage.rateLimits]
    : [];
}

function usageWindowDuration(windowDurationMins) {
  if (!Number.isSafeInteger(windowDurationMins) || windowDurationMins <= 0) return "";
  if (windowDurationMins % 1_440 === 0) return `${windowDurationMins / 1_440}d`;
  if (windowDurationMins % 60 === 0) return `${windowDurationMins / 60}h`;
  return `${windowDurationMins}m`;
}

function remainingUsagePercent(window) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  const usedPercent = Math.max(0, Math.min(100, window.usedPercent));
  return Math.round((100 - usedPercent) * 10) / 10;
}

/** Formats a compact Discord activity label from the current Codex quota windows. */
export function usagePresenceText(usage) {
  const snapshots = rateLimitSnapshots(usage);
  const includeLimitNames = snapshots.length > 1;
  const windows = snapshots.flatMap((snapshot, snapshotIndex) => {
    const limitName = publicText(snapshot.limitName, 24) || publicText(snapshot.limitId, 24) || `額度 ${snapshotIndex + 1}`;
    return [snapshot.primary, snapshot.secondary].flatMap((window) => {
      const remaining = remainingUsagePercent(window);
      if (remaining === null) return [];
      const duration = usageWindowDuration(window.windowDurationMins);
      const prefix = includeLimitNames ? `${limitName} ` : "";
      return [`${prefix}${duration ? `${duration} ` : ""}${remaining}%`];
    });
  });
  return (windows.length > 0 ? `剩餘用量：${windows.join(" · ")}` : "剩餘用量：暫無資料").slice(0, 128);
}

/** Updates the Bot's visible Discord activity without exposing account details. */
export function applyUsagePresence(client, usage) {
  const text = usagePresenceText(usage);
  client.user?.setPresence({
    activities: [{ name: text, type: ActivityType.Watching }],
    status: "online"
  });
  return text;
}

/** Formats the authenticated Codex account's currently reported quota windows. */
export function formatUsageResult(usage) {
  const lines = ["**Codex 剩餘用量**"];
  const snapshots = rateLimitSnapshots(usage);
  if (snapshots.length === 0) {
    lines.push("目前沒有可顯示的用量窗口。");
    return lines.join("\n");
  }

  for (const [index, snapshot] of snapshots.entries()) {
    const label = publicText(snapshot.limitName, 100) || publicText(snapshot.limitId, 100) || `額度 ${index + 1}`;
    const windows = [
      rateLimitWindowLine("主要額度", snapshot.primary),
      rateLimitWindowLine("次要額度", snapshot.secondary)
    ].filter(Boolean);
    lines.push("", `**${label}**`);
    if (windows.length > 0) lines.push(...windows);
    else lines.push("- 此額度目前沒有可顯示的剩餘百分比。");
    if (snapshot.rateLimitReachedType) lines.push("- **目前已達到此額度上限。**");
  }

  if (Number.isSafeInteger(usage?.rateLimitResetCredits?.availableCount)) {
    lines.push("", `可用的額度重設次數：**${usage.rateLimitResetCredits.availableCount}**`);
  }
  return lines.join("\n").slice(0, MAX_DISCORD_MESSAGE);
}

/**
 * Builds one durable status card. It keeps the Discord question visible while
 * work is in progress and renders a short, sanitized CLI-style activity tail
 * using Discord subtext. Raw command output and raw reasoning stay local.
 */
export function createProgressReporter({ workspaceName, task, model, reasoningEffort, progressLines = DEFAULT_CLI_PROGRESS_LINES, imageCount = 0, edit }) {
  if (!Number.isSafeInteger(progressLines) || progressLines < 0 || progressLines > MAX_CLI_PROGRESS_LINES) {
    throw new Error(`Progress line count must be an integer from 0 to ${MAX_CLI_PROGRESS_LINES}`);
  }
  let activity = "正在分析需求…";
  let approval = null;
  let timer = null;
  let closed = false;
  let lastEditAt = 0;
  let pendingEdit = Promise.resolve();
  let goalSummary = null;
  let goalComponents = [];
  const cliProgress = [];
  const retainedProgress = [];
  const streamedProgress = new Map();
  const itemPhases = new Map();

  const setCliProgress = (key, value, retainMode = "replace") => {
    if (progressLines === 0) return;
    const text = safeProgressText(value);
    if (!text) return;
    const existing = cliProgress.findIndex((entry) => entry.key === key);
    if (existing >= 0) cliProgress.splice(existing, 1);
    cliProgress.push({ key, text });
    while (cliProgress.length > progressLines) cliProgress.shift();

    if (retainMode === "none") return;
    if (retainMode === "append") {
      if (retainedProgress.at(-1)?.text !== text) retainedProgress.push({ key: `${key}:${retainedProgress.length}`, text });
      return;
    }
    const retained = retainedProgress.findIndex((entry) => entry.key === key);
    if (retained >= 0) retainedProgress[retained] = { key, text };
    else retainedProgress.push({ key, text });
  };
  const removeCliProgress = (key) => {
    const visible = cliProgress.findIndex((entry) => entry.key === key);
    if (visible >= 0) cliProgress.splice(visible, 1);
    const retained = retainedProgress.findIndex((entry) => entry.key === key);
    if (retained >= 0) retainedProgress.splice(retained, 1);
  };
  const completeSentencePrefix = (value) => {
    let boundary = -1;
    for (const match of value.matchAll(/(?:\r?\n+)|[。！？!?；;](?:["'”’）)\]]*)|\.(?=\s|$)/gu)) {
      boundary = match.index + match[0].length;
    }
    return boundary < 0 ? "" : value.slice(0, boundary);
  };
  const appendStreamedProgress = (key, itemId, prefix, delta) => {
    if (typeof delta !== "string" || !delta) return;
    const current = streamedProgress.get(key) ?? { itemId, prefix, text: "" };
    current.text += delta;
    streamedProgress.set(key, current);
    const complete = completeSentencePrefix(current.text);
    if (complete) setCliProgress(key, `${prefix}${complete}`);
  };
  const finalizeStreamedProgress = (itemId = null, includeRemainder = false) => {
    for (const [key, progress] of streamedProgress) {
      if (itemId !== null && progress.itemId !== itemId) continue;
      if (itemPhases.get(progress.itemId) === "final_answer") {
        removeCliProgress(key);
      } else {
        const complete = includeRemainder ? progress.text : completeSentencePrefix(progress.text);
        if (complete) setCliProgress(key, `${progress.prefix}${complete}`);
      }
      streamedProgress.delete(key);
    }
  };

  const content = () => {
    if (goalSummary) {
      const status = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(goalSummary.status)
        ? goalSummary.status : '狀態未確認';
      const turnsSeen = Number.isSafeInteger(goalSummary.turnsSeen) && goalSummary.turnsSeen >= 0 ? goalSummary.turnsSeen : null;
      const currentTurn = goalSummary.turnInFlight === true && turnsSeen !== null
        ? `第 ${turnsSeen || 1} 輪執行中` : turnsSeen === null ? '尚未確認' : `已開始 ${turnsSeen} 輪；等待原生狀態`;
      const used = Number.isSafeInteger(goalSummary.tokensUsed) && goalSummary.tokensUsed >= 0 ? goalSummary.tokensUsed : null;
      const budget = Number.isSafeInteger(goalSummary.tokenBudget) && goalSummary.tokenBudget >= 0 ? goalSummary.tokenBudget : null;
      const objective = safeGoalObjective(goalSummary.objective);
      const lines = ['**原生 Goal 活動**', `目標：${objective}`, `狀態：${status}`,
        `目前回合：${currentTurn}`, `用量：${used ?? '未知'} / ${budget ?? '未設定'} tokens`];
      return lines.join('\n').slice(0, MAX_DISCORD_MESSAGE);
    }
    const lines = [
      "**問題／需求**",
      questionText(task),
      "",
      `Codex 正在 **${workspaceName}** 使用 **${model ?? "local default"}**（思考深度：**${reasoningLabel(reasoningEffort)}**）工作…`,
      imageCount > 0 ? `已附上 ${imageCount} 張圖片。` : null,
      activity
    ].filter(Boolean);
    if (!approval && cliProgress.length > 0) {
      const groups = cliProgress.map((entry) => progressSubtextLines([entry.text]));
      const progress = [];
      for (let index = groups.length - 1; index >= 0; index -= 1) {
        const candidate = [...groups[index], ...progress];
        if ([...lines, "", ...candidate].join("\n").length <= MAX_DISCORD_MESSAGE) {
          progress.unshift(...groups[index]);
        }
      }
      if (progress.length > 0) lines.push("", ...progress);
    }
    if (approval) lines.push("", approvalDescription(approval.value));
    return lines.join("\n");
  };
  const flush = async () => {
    if (closed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastEditAt = Date.now();
    const payload = { content: content(), components: goalSummary ? goalComponents : approval?.components ?? goalComponents,
      allowedMentions: { parse: [] } };
    pendingEdit = pendingEdit.catch(() => {}).then(() => edit(payload)).catch(() => {});
    await pendingEdit;
  };
  const schedule = (immediate = false) => {
    if (closed) return;
    if (immediate) {
      void flush();
      return;
    }
    if (timer) return;
    const delay = Math.max(0, PROGRESS_EDIT_INTERVAL_MS - (Date.now() - lastEditAt));
    timer = setTimeout(() => { void flush(); }, delay);
  };
  const update = (event) => {
    const method = event?.method ?? event?.type;
    const params = event?.params ?? event ?? {};
    if (method === "item/reasoning/summaryTextDelta") {
      activity = "正在思考與規劃…";
      appendStreamedProgress(`reasoning:${params.itemId ?? "active"}`, params.itemId ?? "active", "思考：", params.delta);
    } else if (method === "item/reasoning/textDelta") {
      activity = "正在思考與規劃…";
    } else if (method === "item/plan/delta") {
      activity = "正在更新執行計畫…";
      appendStreamedProgress(`plan:${params.itemId ?? "active"}`, params.itemId ?? "active", "計畫：", params.delta);
    } else if (method === "item/agentMessage/delta") {
      activity = "正在整理回覆…";
      if (itemPhases.get(params.itemId) !== "final_answer") {
        appendStreamedProgress(`message:${params.itemId ?? "active"}`, params.itemId ?? "active", "進度：", params.delta);
      }
    } else if (method === "item/mcpToolCall/progress") {
      activity = "正在使用整合工具…";
      setCliProgress(`tool-progress:${params.itemId ?? "active"}`, `工具：${params.message ?? "正在處理"}`, "append");
    } else if (method === "item/started" || method === "item/completed") {
      const item = params.item ?? {};
      const itemType = String(item.type ?? "").replaceAll("_", "").toLocaleLowerCase();
      if (item.id && itemType === "agentmessage" && typeof item.phase === "string") itemPhases.set(item.id, item.phase);
      if (method === "item/completed" && item.id) finalizeStreamedProgress(item.id, true);
      if (method === "item/completed" && item.id && itemType === "agentmessage") {
        const key = `message:${item.id}`;
        if (itemPhases.get(item.id) === "final_answer") removeCliProgress(key);
        else if (typeof item.text === "string" && item.text.trim()) setCliProgress(key, `進度：${item.text}`);
      }
      const detail = cliItemDetail(item, method === "item/completed");
      if (detail) {
        const retainMode = LIVE_ONLY_ITEM_TYPES.has(itemType) ? "none" : "append";
        setCliProgress(`item:${item.id ?? itemType}`, detail, retainMode);
      }
      if (itemType === "commandexecution") activity = "正在執行本機工作…";
      else if (itemType === "filechange") activity = "正在修改工作區檔案…";
      else if (itemType === "collabagenttoolcall" || itemType === "collabtoolcall" || itemType === "subagentactivity") activity = "正在協調 subagent…";
      else if (itemType === "mcptoolcall" || itemType === "dynamictoolcall") activity = "正在使用整合工具…";
      else if (itemType === "agentmessage") activity = "正在整理回覆…";
      else if (itemType === "websearch") activity = "正在搜尋資料…";
    } else if (method === "turn/started") {
      activity = "正在處理需求…";
    } else if (method === "turn/completed") {
      activity = "正在整理最終回覆…";
    } else if (method === "bridge/sessionReset") {
      activity = "舊工作階段無法恢復，正在建立新的工作階段…";
    } else if (method === "bridge/usageGuard") {
      activity = params.action === 'stop'
        ? (params.stopReason === 'context-limit' ? `本輪 context 已達本機 ${params.maxContextTokens} tokens 上限，正在暫停；並非帳戶配額耗盡。`
          : `本輪已達本機 ${params.maxToolCalls} 次工具操作上限，正在暫停；任務尚未完成。`)
        : (params.mode === 'observe' ? '本輪用量提醒：保存進度後繼續；目前為不中斷模式。' : '本輪用量提醒：請收斂工作並保存檢查點。');
      setCliProgress('usage-guard', activity, 'append');
    } else if (method === "bridge/gradleAutoApproved") {
      activity = "已自動同意 Gradle 編譯／測試，正在繼續…";
    } else if (method === "bridge/allPermissionsAutoApproved") {
      activity = "本次工作已自動同意權限要求，正在繼續…";
    }
    schedule();
  };

  return {
    update,
    async updateGoalActivity(summary, components = goalComponents) {
      if (closed) return;
      goalSummary = { ...goalSummary, ...summary };
      goalComponents = Array.isArray(components) ? components : [];
      await flush();
    },
    async requestApproval(value, components) {
      approval = { value, components };
      activity = value.kind === "user-input" ? "正在等待你的回答…" : "正在等待你的授權…";
      await flush();
    },
    async approvalSubmitted(autoApproveAll = false) {
      approval = null;
      activity = autoApproveAll
        ? "本次工作將自動同意目前及後續所有權限要求，正在繼續…"
        : "已送出你的授權決定，正在繼續…";
      await flush();
    },
    async resolveApproval(requestId) {
      if (approval?.value?.requestId === String(requestId)) {
        approval = null;
        await flush();
      }
    },
    async steeringReceived() {
      activity = "已收到導正，正在調整方向…";
      await flush();
    },
    async finish() {
      finalizeStreamedProgress();
      goalComponents = [];
      await flush();
      closed = true;
      return retainedProgress.map((entry) => entry.text);
    }
  };
}

/** True only for a reply from the task owner in the status message's channel. */
export function isReplyToActiveStatus(message, activeTask) {
  const referenceId = message?.reference?.messageId ?? message?.reference?.message_id;
  return Boolean(activeTask
    && typeof referenceId === "string"
    && referenceId === activeTask.statusMessageId
    && message?.author?.id === activeTask.userId
    && message?.channelId === activeTask.channelId);
}

async function acknowledgeSteering(message) {
  if (typeof message?.react !== "function") return;
  try {
    await message.react("↪️");
  } catch {
    // Reactions are only an unobtrusive acknowledgement; missing permission is fine.
  }
}

export async function persistUsageCheckpoint({ sessions, key, workspaceName, workspacePath, event,
  repositoryState = null }) {
  if (event?.method !== 'bridge/usageGuard' || !['checkpoint', 'stop'].includes(event.params?.action)
      || typeof sessions?.setCheckpoint !== 'function') return false;
  const params = event.params;
  if (params.checkpointMutable === false) return false;
  const threadId = typeof params.threadId === 'string' ? params.threadId : null;
  const turnId = typeof params.turnId === 'string' ? params.turnId : null;
  if (!threadId || !turnId) return false;
  const repository = repositoryState ?? captureRepositoryCheckpoint(workspacePath);
  return sessions.setCheckpoint(key, {
    id: `${threadId}:${turnId}`,
    sessionId: threadId,
    workspace: workspaceName,
    branch: repository.branch,
    head: repository.head,
    worktreeDigest: repository.worktreeDigest,
    filesChanged: repository.filesChanged,
    usage: params
  });
}

async function runTask({ config, runner, sessions, ownership = null, historyAccess = null,
  historyClientFactory = null, historyContext = null, goalClientFactory = null, pendingGoalExpectation = null,
  userId, channelId, workspaceName, task,
  model = null, reasoningEffort = null, imageUrls = [], handoffConfirmed = false,
  goalRun = null, onSessionBound = () => {}, onProgress = () => {}, onApproval = () => {}, onUserInput = null }) {
  const workspaceConfig = config.workspaces.get(workspaceName);
  if (!workspaceConfig) throw new Error("That workspace is not configured");
  const savedKey = sessionKey({ userId, channelId, workspace: workspaceName });
  const activeKey = taskKey({ userId, workspace: workspaceName });
  const saved = sessions.get(savedKey);
  const observedRevision = sessions.bindingRevision?.(savedKey) ?? saved?.selectionRevision ?? 0;
  const observedRunEpoch = sessions.runEpoch?.(activeKey) ?? 0;
  const pendingFork = saved?.origin === 'native-selection' && saved.sessionId === null;
  if (pendingFork && !handoffConfirmed) {
    throw Object.assign(new Error('This conversation is pending a safe fork. Confirm the source work has stopped and that follow-up work will run in the selected workspace.'), { code: 'SESSION_HANDOFF_REQUIRED' });
  }
  // A fresh Bot process has no local Goal supervisor. Never let an ordinary
  // task silently resume an unfinished Goal, whether it is bound directly or
  // selected as a pending history fork. Only the explicit Goal-resume path may
  // fork and reattach supervision to an inherited Goal.
  const recoverySourceThreadId = pendingFork ? saved.sourceThreadId : saved?.sessionId;
  if (!goalRun && recoverySourceThreadId && typeof goalClientFactory === 'function') {
    const goalClient = await goalClientFactory({ cwd: workspaceConfig.path });
    let goalState;
    try { goalState = await createGoalLifecycle({ client: goalClient }).get(recoverySourceThreadId); }
    finally { await goalClient.close(); }
    const confirmedHistoryFork = pendingFork && handoffConfirmed;
    const parkedPreparedFork = saved?.origin === 'native-fork' && saved.forkGoalPrepared === true
      && ['paused', 'blocked'].includes(goalState.goal?.status);
    if (goalState.goal && goalState.goal.status !== 'complete' && !confirmedHistoryFork && !parkedPreparedFork) {
      throw Object.assign(new Error('此對話綁定了未完成的原生 Goal。若要繼續 Goal，請從 `/codex sessions list` 選取來源、確認交接後使用 `/codex goal resume`；若要改用一般對話，確認交接後直接送出一般訊息或 `/codex run`，Bot 會 fork 新 thread 並只暫停 fork 的 Goal。已準備的 paused/blocked fork 可以直接正常對話。'), {
        code: 'GOAL_RECOVERY_REQUIRED'
      });
    }
  }
  const runLease = typeof sessions.beginRun === 'function'
    ? await sessions.beginRun(savedKey, activeKey, observedRevision, observedRunEpoch, { allowPendingFork: pendingFork && handoffConfirmed }) : null;
  const checkpointWrites = [];
  try {
  const result = await runner.execute({
    key: activeKey,
    workspace: workspaceConfig.path,
    prompt: task,
    model,
    reasoningEffort,
    imageUrls,
    skipGitRepoCheck: workspaceConfig.allowNonGit,
    resumeSessionId: saved?.sessionId ?? null,
    resumePolicy: goalRun && saved?.sessionId ? 'exact' : saved?.origin === 'native-fork' ? 'exact' : 'fallback',
    forkFrom: pendingFork ? { threadId: saved.sourceThreadId, lastTurnId: saved.sourceLastCompletedTurnId } : null,
    prepareForkGoal: !goalRun && (pendingFork || (saved?.origin === 'native-fork' && saved.forkGoalPrepared !== true)),
    goalRun,
    onBeforeFork: async () => {
      if (!pendingFork || !historyAccess || typeof historyClientFactory !== 'function' || !historyContext) {
        throw new Error('History fork source cannot be revalidated');
      }
      const scope = await historyAccess.authorizeContext({ ...historyContext, workspaceName });
      const client = await historyClientFactory({ cwd: scope.workspacePath });
      try {
        await validateHistoryForkSource({ client, access: historyAccess, context: historyContext,
          workspaceName, sourceThreadId: saved.sourceThreadId, source: saved.source,
          lastCompletedTurnId: saved.sourceLastCompletedTurnId,
          sourceUpdatedAt: saved.sourceUpdatedAt });
      } finally { await client.close(); }
      if (goalRun) {
        const goalClient = await goalClientFactory({ cwd: workspaceConfig.path });
        try {
          const sourceGoal = await createGoalLifecycle({ client: goalClient }).get(saved.sourceThreadId);
          if (pendingGoalExpectation) {
            if (!sourceGoal.goal || sourceGoal.revision !== pendingGoalExpectation.revision) {
              throw Object.assign(new Error('Selected source Goal changed after confirmation'), { code: 'GOAL_REVISION_CONFLICT' });
            }
          } else if (sourceGoal.goal && sourceGoal.goal.status !== 'complete') {
            throw Object.assign(new Error('Selected source now has an unfinished native Goal'), { code: 'GOAL_ALREADY_EXISTS' });
          }
        } finally { await goalClient.close(); }
      }
    },
    resumeCheckpoint: saved?.checkpoint ?? null,
    onSessionId: async (sessionId) => {
      if (ownership) await ownership.claim({ threadId: sessionId, ownerUserId: userId, provenance: 'discord-runtime' });
      await sessions.set(savedKey, { sessionId, workspace: workspaceName,
        ...(pendingFork || saved?.origin === 'native-fork' ? { origin: 'native-fork', sourceThreadId: saved.sourceThreadId,
          sourceLastCompletedTurnId: saved.sourceLastCompletedTurnId,
          sourceUpdatedAt: saved.sourceUpdatedAt, forkGoalPrepared: pendingFork ? false : saved.forkGoalPrepared === true } : {}),
        updatedAt: new Date().toISOString() });
      await onSessionBound(sessionId);
    },
    onForkPrepared: async sessionId => {
      if (pendingFork || saved?.origin === 'native-fork') {
        if (pendingFork && pendingGoalExpectation) {
          const goalClient = await goalClientFactory({ cwd: workspaceConfig.path });
          try {
            const target = (await createGoalLifecycle({ client: goalClient }).get(sessionId)).goal;
            const expected = pendingGoalExpectation.goal;
            // A recovered active source is forked only after the explicit
            // history handoff gate. The runtime pauses the fork before this
            // callback so the new exact-thread supervisor can safely resume
            // it; the source Goal itself remains untouched.
            const expectedForkStatus = expected.status === 'active' ? 'paused' : expected.status;
            const inherited = target && ['objective', 'tokenBudget', 'tokensUsed', 'timeUsedSeconds', 'createdAt']
              .every(field => target[field] === expected[field]) && target.status === expectedForkStatus;
            const safelyResumableFork = ['paused', 'blocked'].includes(target?.status)
              || expected.status === 'budgetLimited' && target?.status === 'budgetLimited';
            if (!inherited || !safelyResumableFork) {
              throw Object.assign(new Error('Forked Goal does not match the confirmed source state'), { code: 'GOAL_READBACK_MISMATCH' });
            }
          } finally { await goalClient.close(); }
        }
        await sessions.set(savedKey, { sessionId, workspace: workspaceName, origin: 'native-fork',
          sourceThreadId: saved.sourceThreadId,
          sourceLastCompletedTurnId: saved.sourceLastCompletedTurnId,
          ...(Number.isFinite(saved.sourceUpdatedAt) ? { sourceUpdatedAt: saved.sourceUpdatedAt } : {}),
          forkGoalPrepared: true, updatedAt: new Date().toISOString() });
      }
    },
    onProgress,
    onUsageCheckpoint: event => {
      const checkpointWrite = persistUsageCheckpoint({ sessions, key: savedKey, workspaceName,
        workspacePath: event.workspace, event }).catch(() => false);
      checkpointWrites.push(checkpointWrite);
      return checkpointWrite;
    },
    onApproval,
    onUserInput
  });
  await Promise.all(checkpointWrites);
  if (result.sessionId && result.sessionId !== saved?.sessionId && !pendingFork) {
    await sessions.set(savedKey, { sessionId: result.sessionId, workspace: workspaceName, updatedAt: new Date().toISOString() });
  }
  if (result.exitCode === 0 && !result.timedOut && result.checkpointMutable === true
      && typeof sessions.clearCheckpoint === 'function') {
    await sessions.clearCheckpoint(savedKey, result.sessionId ?? saved?.sessionId ?? null);
  }
  return { key: activeKey, result };
  } finally {
    if (runLease && typeof sessions.endRun === 'function') await sessions.endRun(savedKey, runLease, activeKey);
  }
}

export async function registerCommands(config) {
  const rest = new REST({ version: "10" }).setToken(config.botToken);
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), {
    body: [commandDefinition([...config.workspaces.keys()]).toJSON()]
  });
}

export async function startBot({ config, runner, sessions, models = [], ownership = null,
  historyAccess = null, historyClientFactory = null, goalClientFactory = null,
  now = Date.now,
  clientFactory = options => new Client(options) }) {
  const approvals = new Map();
  const activeTasks = new Map();
  const goalCardStates = new Map();
  const historyUiState = new Map();
  const handoffGrants = new Map();
  const workspaceSync = createWorkspaceSync({ config });
  const catalogWorkspace = config.workspaces.values().next().value;
  let usagePresenceRefresh = Promise.resolve();
  const refreshUsagePresence = () => {
    usagePresenceRefresh = usagePresenceRefresh
      .then(async () => applyUsagePresence(client, await runner.getUsage({ workspace: catalogWorkspace.path })))
      .catch((error) => { console.warn(`Could not refresh Codex usage presence: ${error.message}`); });
    return usagePresenceRefresh;
  };
  const registerApproval = ({ approval, key, userId, channelId, progress, runId }) => {
    const token = randomUUID();
    approvals.set(token, {
      ...approval,
      runId,
      key,
      userId,
      channelId,
      progress
    });
    return token;
  };
  const createSessionThread = async ({ channel, starterMessage = null, userId, title }) => {
    const parent = channel?.isThread?.() ? channel.parent : channel;
    if (!parent || typeof parent.send !== 'function') return channel;
    const starter = starterMessage && starterMessage.channelId === parent.id
      ? starterMessage
      : await parent.send({ content: `Codex session：${publicText(title || '新工作', 70)}`, allowedMentions: { parse: [] } });
    if (typeof starter?.startThread !== 'function') return channel;
    const thread = await starter.startThread({ name: publicText(title || 'Codex session', 90) || 'Codex session',
      autoArchiveDuration: 1440, reason: 'Create a dedicated thread for a new Codex session' });
    const sourceConversation = conversationKey({ userId, channelId: channel.id });
    const targetConversation = conversationKey({ userId, channelId: thread.id });
    const workspace = sessions.activeWorkspace(sourceConversation);
    const model = sessions.activeModel(sourceConversation);
    const effort = sessions.activeReasoningEffort(sourceConversation);
    const lines = sessions.progressLineCount(sourceConversation);
    if (workspace) await sessions.setActiveWorkspace(targetConversation, workspace);
    if (model) await sessions.setActiveModel(targetConversation, model);
    if (effort) await sessions.setActiveReasoningEffort(targetConversation, effort);
    if (lines !== null && lines !== undefined && typeof sessions.setProgressLineCount === 'function')
      await sessions.setProgressLineCount(targetConversation, lines);
    return thread;
  };
  const pinGoalStatus = async status => {
    if (typeof status?.pin !== 'function') return false;
    try { await status.pin('Pin the active Codex Goal status for this session'); return true; }
    catch (error) {
      console.warn(`Could not pin the Goal status message: ${error.message}`);
      return false;
    }
  };
  const copyPendingSelection = async (binding, key) => {
    if (binding?.origin !== 'native-selection' || binding.sessionId !== null
        || typeof sessions.setPendingSelection !== 'function') return;
    await sessions.setPendingSelection(key, { workspace: binding.workspace, source: binding.source,
      sourceThreadId: binding.sourceThreadId, sourceLastCompletedTurnId: binding.sourceLastCompletedTurnId,
      sourceUpdatedAt: binding.sourceUpdatedAt ?? null,
      expectedRevision: sessions.bindingRevision?.(key) ?? 0 });
  };
  const resolveApproval = async (key, requestId, runId) => {
    for (const [token, approval] of approvals) {
      if (approval.key === key && approval.runId === runId && approval.requestId === String(requestId)) {
        approvals.delete(token);
        await approval.progress.resolveApproval(requestId);
      }
    }
  };
  const client = clientFactory({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    rest: {
      timeout: DISCORD_REST_TIMEOUT_MS,
      retries: 1
    }
  });
  const rememberHistoryState = (token, value) => {
    const now = Date.now();
    for (const [key, state] of historyUiState) if (state.expiresAt <= now) historyUiState.delete(key);
    if (historyUiState.size >= 256) historyUiState.delete(historyUiState.keys().next().value);
    historyUiState.set(token, { ...value, expiresAt: now + 5 * 60_000 });
  };
  const historyContext = interaction => ({ userId: interaction.user.id, guildId: interaction.guildId,
    channelId: interaction.channelId, parentId: interaction.channel?.parentId ?? null });
  const hasActiveGoalInConversation = interaction => [...activeTasks.values()].some(activeTask =>
    activeTask.goal?.threadId && activeTask.userId === interaction.user.id
      && activeTask.guildId === interaction.guildId && activeTask.channelId === interaction.channelId);
  const historyUiMatches = (state, interaction) => state && state.expiresAt > Date.now()
    && state.userId === interaction.user.id && state.guildId === interaction.guildId
    && state.channelId === interaction.channelId;
  const goalCardComponents = activeTask => {
    const goal = activeTask.goal;
    if (goal.cardToken) goalCardStates.delete(goal.cardToken);
    goal.cardToken = null;
    if (!goal.threadId || !activeTask.statusMessageId) return [];
    const currentTime = now();
    for (const [token, state] of goalCardStates) if (state.expiresAt <= currentTime) goalCardStates.delete(token);
    while (goalCardStates.size >= 512) goalCardStates.delete(goalCardStates.keys().next().value);
    const token = randomUUID();
    goal.cardToken = token;
    goalCardStates.set(token, { mapKey: activeTask.mapKey, key: activeTask.key, runId: activeTask.runId,
      statusMessageId: activeTask.statusMessageId, userId: activeTask.userId, guildId: activeTask.guildId,
      channelId: activeTask.channelId, threadId: goal.threadId, turnId: goal.turnId ?? null,
      turnsSeen: goal.turnsSeen ?? 0, expiresAt: currentTime + 30 * 60_000, progress: activeTask.progress });
    const buttons = [];
    if (goal.status === 'active') buttons.push(new ButtonBuilder().setCustomId(`codex:goal:${token}:pause`)
      .setLabel('暫停 Goal').setStyle(ButtonStyle.Danger));
    buttons.push(new ButtonBuilder().setCustomId(`codex:goal:${token}:status`)
      .setLabel('更新狀態').setStyle(ButtonStyle.Secondary));
    return [new ActionRowBuilder().addComponents(...buttons)];
  };
  const updateGoalActivity = async (activeTask, summary) => {
    Object.assign(activeTask.goal, summary);
    await activeTask.progress.updateGoalActivity(activeTask.goal, goalCardComponents(activeTask));
  };
  const retireGoalCard = activeTask => {
    if (activeTask?.goal?.cardToken) goalCardStates.delete(activeTask.goal.cardToken);
    if (activeTask?.goal) activeTask.goal.cardToken = null;
  };
  const consumeHandoffGrant = (key, context, binding) => {
    const grant = handoffGrants.get(key);
    handoffGrants.delete(key);
    return Boolean(grant && grant.expiresAt > Date.now()
      && grant.userId === context.userId && grant.guildId === context.guildId
      && grant.channelId === context.channelId
      && grant.selectionRevision === binding?.selectionRevision
      && grant.sourceThreadId === binding?.sourceThreadId
      && grant.sourceUpdatedAt === binding?.sourceUpdatedAt
      && grant.sourceLastCompletedTurnId === binding?.sourceLastCompletedTurnId);
  };
  const rememberHandoffGrant = (key, grant) => {
    const now = Date.now();
    for (const [entryKey, value] of handoffGrants) if (value.expiresAt <= now) handoffGrants.delete(entryKey);
    if (handoffGrants.size >= 256) handoffGrants.delete(handoffGrants.keys().next().value);
    handoffGrants.set(key, grant);
  };
  const validateAndRememberHistoryHandoff = async ({ key, context, workspaceName, binding }) => {
    if (binding?.origin !== 'native-selection' || binding.sessionId !== null
        || !Number.isSafeInteger(binding.selectionRevision)
        || typeof binding.sourceThreadId !== 'string'
        || typeof binding.sourceLastCompletedTurnId !== 'string') {
      throw new Error('目前沒有可確認交接的待續接對話；請先重新選取歷史對話。');
    }
    if (activeWorkspaceTask(context.userId, workspaceName)) {
      throw new Error('這個工作區仍有 Codex 工作執行中，請完成或取消後再確認交接。');
    }
    const workspace = config.workspaces.get(workspaceName);
    if (!workspace || !historyAccess) throw new Error('來源歷史目前無法重新驗證。');
    await withHistoryClient(workspace.path, client => validateHistoryForkSource({ client,
      access: historyAccess, context, workspaceName,
      sourceThreadId: binding.sourceThreadId, source: binding.source,
      lastCompletedTurnId: binding.sourceLastCompletedTurnId,
      sourceUpdatedAt: binding.sourceUpdatedAt }));
    rememberHandoffGrant(key, { userId: context.userId, guildId: context.guildId,
      channelId: context.channelId, selectionRevision: binding.selectionRevision,
      sourceThreadId: binding.sourceThreadId,
      sourceUpdatedAt: binding.sourceUpdatedAt,
      sourceLastCompletedTurnId: binding.sourceLastCompletedTurnId,
      expiresAt: Date.now() + 5 * 60_000 });
  };
  const autoPauseAndSelectActiveGoal = async ({ interaction, workspaceName, key, context, workspaceRunKey,
    sourceThreadId = null, reply }) => {
    if (!historyAccess || !config.historyEnabled || typeof historyClientFactory !== 'function') {
      throw Object.assign(new Error('Automatic Goal handoff requires authorized history access'), { code: 'GOAL_RECOVERY_REQUIRED' });
    }
    const candidates = [...activeTasks.values()].filter(task => task.userId === context.userId
      && task.guildId === context.guildId
      && task.workspaceName === workspaceName && task.goal?.threadId && task.goal.status !== 'complete'
      && (!sourceThreadId || task.goal.threadId === sourceThreadId));
    if (candidates.length !== 1) {
      throw Object.assign(new Error(candidates.length ? 'More than one controlled Goal could be handed off'
        : 'No locally controlled Goal is available for automatic handoff'), { code: 'GOAL_RECOVERY_REQUIRED' });
    }
    const sourceTask = candidates[0];
    if (typeof runner.pauseGoal !== 'function' || !runner.isRunning?.(sourceTask.key)) {
      throw Object.assign(new Error('The old Goal has no live controller that can stop it safely'), { code: 'GOAL_SUPERVISOR_REQUIRED' });
    }
    await reply({ content: '正在暫停舊 Goal，確認回合停止後會自動 fork 並在這個 thread 恢復…' });
    const accepted = await runner.pauseGoal(sourceTask.key, { threadId: sourceTask.goal.threadId,
      turnId: sourceTask.goal.turnId ?? null, turnsSeen: sourceTask.goal.turnsSeen ?? 0 });
    if (!accepted) throw Object.assign(new Error('The old Goal controller did not accept the pause request'), {
      code: 'GOAL_SUPERVISOR_REQUIRED'
    });
    await sourceTask.settled;

    const workspace = config.workspaces.get(workspaceName);
    const goalClient = await goalClientFactory({ cwd: workspace.path });
    let stoppedGoal;
    try { stoppedGoal = (await createGoalLifecycle({ client: goalClient }).get(sourceTask.goal.threadId)).goal; }
    finally { await goalClient.close(); }
    if (!stoppedGoal || stoppedGoal.status !== 'paused' || stoppedGoal.objective !== sourceTask.goal.objective) {
      throw Object.assign(new Error('The old Goal did not settle in a matching paused state'), { code: 'GOAL_READBACK_MISMATCH' });
    }

    const source = await withHistoryClient(workspace.path, async client => {
      const scope = await historyAccess.authorizeContext({ ...context, workspaceName });
      const metadata = await readThreadMetadata(client, { threadId: sourceTask.goal.threadId,
        cwd: scope.workspacePath, sourceKinds: ['cli', 'vscode', 'appServer', 'unknown'] });
      await historyAccess.assertThreadReadable({ ...context, workspaceName }, metadata);
      if (metadata.runtimeStatus === 'active') {
        throw Object.assign(new Error('The old Goal thread still reports an active runtime'), { code: 'HISTORY_SOURCE_ACTIVE' });
      }
      const turns = [];
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const result = await listHistoryTurns(client, { threadId: metadata.id, cursor, limit: 5 });
        turns.push(...result.turns);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
        if (page === 19) throw Object.assign(new Error('Recent Goal history exceeds the safe handoff window'), {
          code: 'HISTORY_SOURCE_UNCERTAIN'
        });
      }
      if (turns.some(turn => ['inProgress', 'running', 'active', 'pending'].includes(turn.status))) {
        throw Object.assign(new Error('The old Goal still has an unfinished source turn'), { code: 'HISTORY_SOURCE_ACTIVE' });
      }
      const latest = turns.filter(turn => turn.status === 'completed')
        .sort((a, b) => (b.completedAt ?? b.startedAt ?? 0) - (a.completedAt ?? a.startedAt ?? 0))[0];
      if (!latest) throw Object.assign(new Error('No completed source turn is available for a safe fork'), {
        code: 'HISTORY_SOURCE_UNCERTAIN'
      });
      return { metadata, latest };
    });
    const binding = await sessions.setPendingSelection(key, { workspace: workspaceName,
      source: source.metadata.source, sourceThreadId: source.metadata.id,
      sourceLastCompletedTurnId: source.latest.id, sourceUpdatedAt: source.metadata.updatedAt,
      expectedRevision: sessions.bindingRevision?.(key) ?? sessions.get(key)?.selectionRevision ?? 0,
      expectedRunEpoch: sessions.runEpoch?.(workspaceRunKey) ?? null, workspaceRunKey });
    await validateAndRememberHistoryHandoff({ key, context, workspaceName, binding });
    return binding;
  };
  const activeWorkspaceTask = (userId, workspaceName) => {
    const key = taskKey({ userId, workspace: workspaceName });
    return runner.isRunning(key) || [...activeTasks.values()].some(task => task.key === key);
  };
  const withHistoryClient = async (workspacePath, callback) => {
    if (!historyClientFactory) throw new Error('本機歷史讀取尚未設定。');
    const client = await historyClientFactory({ cwd: workspacePath });
    try { return await callback(client); }
    finally { await client.close(); }
  };
  const executeGoalRun = async ({ interaction, workspaceName, objective, goalRun, status, handoffConfirmed = false,
    pendingGoalExpectation = null }) => {
    const workspace = config.workspaces.get(workspaceName);
    const executionChannelId = status.channelId ?? status.channel?.id ?? interaction.channelId;
    const bindingKey = sessionKey({ userId: interaction.user.id, channelId: executionChannelId, workspace: workspaceName });
    const activeKey = taskKey({ userId: interaction.user.id, workspace: workspaceName });
    const conversation = conversationKey({ userId: interaction.user.id, channelId: executionChannelId });
    const model = sessions.activeModel(conversation);
    const activeModel = activeCatalogModel(model, models);
    const reasoningEffort = sessions.activeReasoningEffort(conversation);
    const runId = randomUUID();
    let resolveSettled;
    const settled = new Promise(resolve => { resolveSettled = resolve; });
    const activeTask = { key: activeKey, runId, mapKey: bindingKey, userId: interaction.user.id, settled,
      guildId: interaction.guildId, channelId: executionChannelId, workspaceName,
      statusMessageId: status.id, model: activeModel,
      goal: { objective, status: 'preparing', threadId: sessions.get(bindingKey)?.sessionId ?? null,
        turnId: null, turnsSeen: 0, turnsCompleted: 0, turnInFlight: false, tokenBudget: null, tokensUsed: null } };
    const progress = createProgressReporter({ workspaceName, task: objective, model, reasoningEffort,
      progressLines: 0, edit: payload => status.edit(payload) });
    activeTask.progress = progress;
    let taskStarted = false;
    try {
      claimActiveTask(activeTasks, activeTask, runner);
      taskStarted = true;
      await updateGoalActivity(activeTask, {});
      workspaceSync.record(workspaceName, { runId, event: 'started' });
      if (typeof sessions.setActiveWorkspace === 'function') await sessions.setActiveWorkspace(conversation, workspaceName);
      const { result } = await runTask({
        config, runner, sessions, ownership, historyAccess, historyClientFactory, goalClientFactory, pendingGoalExpectation,
        historyContext: historyContext(interaction), handoffConfirmed,
        userId: interaction.user.id, channelId: executionChannelId,
        workspaceName, task: objective, model, reasoningEffort, goalRun,
        onSessionBound: async threadId => {
          activeTask.goal.threadId = threadId;
          await updateGoalActivity(activeTask, {});
        },
        onProgress: async event => {
          if (event?.method === 'serverRequest/resolved') await resolveApproval(activeKey, event.params?.requestId, runId);
          if (event?.method === 'turn/started') {
            const turnId = event.params?.turn?.id ?? event.params?.turnId;
            if (typeof turnId === 'string' && turnId) {
              await updateGoalActivity(activeTask, { turnId, turnInFlight: true,
                turnsSeen: Math.max(activeTask.goal.turnsSeen ?? 0, (event.params?.turn?.index ?? 0) + 1) });
            }
          } else if (event?.method === 'bridge/goalStatus') {
            const params = event.params ?? {};
            const summary = {};
            if (['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'].includes(params.status)) summary.status = params.status;
            if (Number.isSafeInteger(params.turnsSeen) && params.turnsSeen >= 0) summary.turnsSeen = Math.max(activeTask.goal.turnsSeen ?? 0, params.turnsSeen);
            if (Number.isSafeInteger(params.turnsCompleted) && params.turnsCompleted >= 0) summary.turnsCompleted = Math.max(activeTask.goal.turnsCompleted ?? 0, params.turnsCompleted);
            if (typeof params.turnInFlight === 'boolean') summary.turnInFlight = params.turnInFlight;
            if (summary.turnInFlight === false) summary.turnId = null;
            else if (typeof params.turnId === 'string' && params.turnId) summary.turnId = params.turnId;
            if (Number.isSafeInteger(params.tokenBudget) && params.tokenBudget >= 0) summary.tokenBudget = params.tokenBudget;
            if (Number.isSafeInteger(params.tokensUsed) && params.tokensUsed >= 0) summary.tokensUsed = params.tokensUsed;
            await updateGoalActivity(activeTask, summary);
          }
          progress.update(event);
        },
        onUserInput: input => presentUserInput({ input, key: activeKey, userId: interaction.user.id,
          channelId: executionChannelId, status, register: args => registerApproval({ ...args, runId }),
          forget: token => approvals.delete(token),
          send: payload => interaction.followUp({ ...payload, ephemeral: true, allowedMentions: { parse: [] } }) }),
        onApproval: async approval => {
          const token = registerApproval({ approval, runId, key: activeKey, userId: interaction.user.id,
            channelId: executionChannelId, progress });
          await progress.requestApproval(approval, []);
          await interaction.followUp({ content: approvalDescription(approval), components: approvalComponents(token, approval),
            ephemeral: true, allowedMentions: { parse: [] } });
        }
      });
      const latestBinding = sessions.get(bindingKey);
      let terminal = null;
      if (latestBinding?.sessionId && typeof goalClientFactory === 'function') {
        try {
          const client = await goalClientFactory({ cwd: workspace.path });
          try { terminal = (await createGoalLifecycle({ client }).get(latestBinding.sessionId)).goal; }
          finally { await client.close(); }
        } catch { terminal = null; }
      }
      await updateGoalActivity(activeTask, terminal ? { status: terminal.status,
        tokenBudget: terminal.tokenBudget, tokensUsed: terminal.tokensUsed, turnInFlight: false, turnId: null }
        : { status: '狀態未確認', turnInFlight: false, turnId: null });
      retireGoalCard(activeTask);
      await progress.updateGoalActivity(activeTask.goal, []);
      await progress.finish();
      workspaceSync.record(workspaceName, { runId, event: result.exitCode === 0 ? 'completed' : 'failed' });
      return { result, terminal };
    } catch (error) {
      if (taskStarted) workspaceSync.record(workspaceName, { runId, event: 'failed' });
      retireGoalCard(activeTask);
      await progress.updateGoalActivity({ ...activeTask.goal, status: '狀態未確認' }, []);
      await progress.finish();
      throw error;
    } finally {
      retireGoalCard(activeTask);
      if (activeTasks.get(bindingKey) === activeTask) activeTasks.delete(bindingKey);
      try {
        if (taskStarted) {
          await clearRunApprovals(approvals, runId);
          void refreshUsagePresence();
        }
      } finally { resolveSettled(); }
    }
  };
  const renderHistoryPage = async ({ interaction, context, workspaceName, query, source, cursors = [], flow = 'history', update = false }) => {
    if (!config.historyEnabled || !historyAccess) throw new Error('對話歷史功能目前未啟用。');
    const workspace = config.workspaces.get(workspaceName);
    if (!workspace) throw new Error('這個工作區未設定。');
    const bindingKey = sessionKey({ userId: context.userId, channelId: context.channelId, workspace: workspaceName });
    const workspaceRunKey = taskKey({ userId: context.userId, workspace: workspaceName });
    const expectedRevision = sessions.bindingRevision?.(bindingKey)
      ?? sessions.get(bindingKey)?.selectionRevision ?? 0;
    const expectedRunEpoch = sessions.runEpoch?.(workspaceRunKey) ?? 0;
    const result = await withHistoryClient(workspace.path, client => loadHistoryList({ client,
      access: historyAccess, context, workspaceName, query, source, cursors }));
    const goalStatuses = new Map(result.threads.map(thread => [thread.id, 'unknown']));
    if (typeof goalClientFactory === 'function' && result.threads.length) {
      let goalClient;
      try {
        goalClient = await goalClientFactory({ cwd: workspace.path });
        const lifecycle = createGoalLifecycle({ client: goalClient });
        await Promise.all(result.threads.map(async thread => {
          try {
            const state = await lifecycle.get(thread.id);
            goalStatuses.set(thread.id, state.goal?.status ?? null);
          } catch { /* Preserve an explicit unknown marker for failed read-only status probes. */ }
        }));
      } catch { /* History remains useful when Goal status is unavailable. */ }
      finally {
        if (goalClient) try { await goalClient.close(); } catch { /* A status client close failure must not hide history. */ }
      }
    }
    const threadsWithGoalStatus = result.threads.map(thread => ({ ...thread, goalStatus: goalStatuses.get(thread.id) }));
    for (const [index, token] of result.candidateTokens.entries()) rememberHistoryState(token, { kind: 'candidate', query,
      flow, goalStatus: threadsWithGoalStatus[index]?.goalStatus ?? 'unknown', workspaceName, expectedRevision,
      expectedRunEpoch, userId: context.userId, guildId: context.guildId, channelId: context.channelId });
    if (result.nextToken) rememberHistoryState(result.nextToken, { kind: 'cursor', query, source, flow, workspaceName,
      userId: context.userId, guildId: context.guildId, channelId: context.channelId });
    const payload = historyListPayload({ workspaceName, threads: threadsWithGoalStatus,
      candidateTokens: result.candidateTokens, nextToken: result.nextToken, flow });
    if (update) await interaction.update({ ...payload, allowedMentions: { parse: [] } });
    else if (interaction.deferred || interaction.replied) await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
    else await interaction.reply({ ...payload, ephemeral: true, allowedMentions: { parse: [] } });
  };
  const renderHistoryPreview = async ({ interaction, context, state, token, update = false }) => {
    if (!config.historyEnabled || !historyAccess) throw new Error('對話歷史功能目前未啟用。');
    const workspace = config.workspaces.get(state.workspaceName);
    if (!workspace) throw new Error('這個工作區未設定。');
    const preview = await withHistoryClient(workspace.path, client => loadHistoryPreview({ client,
      access: historyAccess, context, workspaceName: state.workspaceName, token, query: state.query,
      turnCursor: state.turnCursor ?? null, turnId: state.turnId ?? null, itemCursor: state.itemCursor ?? null }));
    let goalStatus = state.goalStatus ?? 'unknown';
    if (typeof goalClientFactory === 'function') {
      let client;
      try {
        client = await goalClientFactory({ cwd: workspace.path });
        const current = await createGoalLifecycle({ client }).get(preview.metadata.id);
        goalStatus = current.goal?.status ?? null;
      } catch { goalStatus = 'unknown'; }
      finally { if (client) try { await client.close(); } catch { /* Goal metadata is optional for preview. */ } }
    }
    const pageState = { kind: 'preview-page', candidateToken: token, query: state.query, flow: state.flow,
      goalStatus,
      workspaceName: state.workspaceName, userId: context.userId, guildId: context.guildId,
      channelId: context.channelId, turnId: preview.turnId, turnCursor: preview.nextTurnCursor };
    const nextItemToken = preview.nextItemCursor ? randomUUID() : null;
    const nextTurnToken = preview.nextTurnCursor ? randomUUID() : null;
    if (nextItemToken) rememberHistoryState(nextItemToken, { ...pageState, itemCursor: preview.nextItemCursor });
    if (nextTurnToken) rememberHistoryState(nextTurnToken, { ...pageState, turnId: null, itemCursor: null });
    const payload = historyPreviewPayload({ workspaceName: state.workspaceName, thread: preview.metadata,
      turns: preview.turns, messages: preview.messages, more: preview.more, nextItemToken, nextTurnToken,
      candidateToken: token, continueMode: state.flow === 'continue', goalStatus });
    const [first, ...rest] = payload.contents;
    if (update) await interaction.update({ content: first, components: payload.components, allowedMentions: { parse: [] } });
    else if (interaction.deferred || interaction.replied) await interaction.editReply({ content: first,
      components: payload.components, allowedMentions: { parse: [] } });
    else await interaction.reply({ content: first, ephemeral: true, allowedMentions: { parse: [] } });
    for (const content of rest) await interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } });
  };
  const selectHistoryBinding = async ({ interaction, context, token, state }) => {
    if (!historyAccess || !config.historyEnabled || typeof sessions.setPendingSelection !== 'function') {
      throw new Error('對話選取功能目前無法使用。');
    }
    const key = sessionKey({ userId: context.userId, channelId: context.channelId, workspace: state.workspaceName });
    const workspaceRunKey = taskKey({ userId: context.userId, workspace: state.workspaceName });
    if (activeWorkspaceTask(context.userId, state.workspaceName)) throw new Error('這個工作區仍有 Codex 工作執行中，請完成或取消後再選取。');
    const workspace = config.workspaces.get(state.workspaceName);
    if (!workspace) throw new Error('這個工作區未設定。');
    const preview = await withHistoryClient(workspace.path, client => loadHistoryPreview({ client,
      access: historyAccess, context, workspaceName: state.workspaceName, token, query: state.query }));
    if (!preview.turnId) throw new Error('來源對話尚無已完成回合，無法安全保存續接錨點。');
    if (activeWorkspaceTask(context.userId, state.workspaceName)) throw new Error('這個工作區已有工作開始，請完成或取消後再選取。');
    const expectedRevision = Number.isSafeInteger(state.expectedRevision) ? state.expectedRevision
      : sessions.bindingRevision?.(key) ?? sessions.get(key)?.selectionRevision ?? 0;
    const expectedRunEpoch = Number.isSafeInteger(state.expectedRunEpoch) ? state.expectedRunEpoch
      : sessions.runEpoch?.(workspaceRunKey) ?? 0;
    let binding;
    try {
      binding = await sessions.setPendingSelection(key, { workspace: state.workspaceName,
        source: preview.metadata.source, sourceThreadId: preview.metadata.id,
        sourceLastCompletedTurnId: preview.turnId, sourceUpdatedAt: preview.metadata.updatedAt,
        expectedRevision,
        expectedRunEpoch, workspaceRunKey });
    } catch (error) {
      if (['SESSION_BINDING_CONFLICT', 'SESSION_BINDING_BUSY'].includes(error?.code)) throw error;
      throw new Error('無法安全保存對話選取；沒有啟動工作，請稍後重試。');
    }
    const handoffToken = randomUUID();
    rememberHistoryState(handoffToken, { kind: 'handoff-confirm', key, workspaceName: state.workspaceName,
      userId: context.userId, guildId: context.guildId, channelId: context.channelId,
      selectionRevision: binding.selectionRevision, sourceThreadId: binding.sourceThreadId,
      source: binding.source, sourceLastCompletedTurnId: binding.sourceLastCompletedTurnId,
      sourceUpdatedAt: binding.sourceUpdatedAt });
    await interaction.update({ content: `已選取來源對話（${binding.source}），目前保存為「待 fork」。選取本身沒有啟動 Codex；fork 只複製對話，不隔離工作區檔案。來源工作停止後，按下確認按鈕，再送出要執行的工作。`,
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`codex:history:handoff:${handoffToken}`).setLabel('來源已停止，確認在此工作區續接')
        .setStyle(ButtonStyle.Danger))], allowedMentions: { parse: [] } });
  };
  const continueFromHistory = async ({ interaction, context, token, state, mode }) => {
    await interaction.deferReply({ ephemeral: true });
    const workspaceName = state.workspaceName;
    const workspace = config.workspaces.get(workspaceName);
    if (!workspace || !historyAccess || !config.historyEnabled || typeof sessions.setPendingSelection !== 'function') {
      throw new Error('對話延續功能目前無法使用。');
    }
    const preview = await withHistoryClient(workspace.path, client => loadHistoryPreview({ client,
      access: historyAccess, context, workspaceName, token, query: state.query }));
    if (!preview.turnId) throw new Error('來源沒有已完成回合，無法安全延續。');
    let sourceGoal = null;
    if (typeof goalClientFactory === 'function') {
      const client = await goalClientFactory({ cwd: workspace.path });
      try { sourceGoal = (await createGoalLifecycle({ client }).get(preview.metadata.id)).goal; }
      finally { await client.close(); }
    }
    if (mode === 'goal' && (!sourceGoal || !['active', 'paused', 'blocked'].includes(sourceGoal.status))) {
      throw Object.assign(new Error('這個來源沒有可直接接續的 active、paused 或 blocked Goal。'), {
        code: 'GOAL_NOT_RESUMABLE'
      });
    }
    const localGoalTask = [...activeTasks.values()].find(task => task.userId === context.userId
      && task.guildId === context.guildId && task.workspaceName === workspaceName
      && task.goal?.threadId === preview.metadata.id && task.goal.status !== 'complete');
    if (activeWorkspaceTask(context.userId, workspaceName) && !localGoalTask) {
      throw Object.assign(new Error('這個工作區仍有其他工作執行中，請完成或取消後再延續。'), {
        code: 'SESSION_BINDING_BUSY'
      });
    }
    if (sourceGoal?.status === 'active' && !localGoalTask) {
      throw Object.assign(new Error('來源 Goal 仍為 active，且不受此 Bot 控制；請先在來源端停止，再重新預覽延續。'), {
        code: 'GOAL_SUPERVISOR_REQUIRED'
      });
    }
    if (localGoalTask && (typeof runner.pauseGoal !== 'function' || !runner.isRunning?.(localGoalTask.key))) {
      throw Object.assign(new Error('來源 Goal 沒有可安全暫停的本機控制器；請先確認來源狀態後重試。'), {
        code: 'GOAL_SUPERVISOR_REQUIRED'
      });
    }

    const targetThread = await createSessionThread({ channel: interaction.channel, userId: context.userId,
      title: sessionThreadTitle(preview.metadata.title, workspaceName) });
    const targetChannelId = targetThread?.id ?? interaction.channelId;
    const targetKey = sessionKey({ userId: context.userId, channelId: targetChannelId, workspace: workspaceName });
    const workspaceRunKey = taskKey({ userId: context.userId, workspace: workspaceName });
    const targetContext = { ...context, channelId: targetChannelId, parentId: targetThread?.parentId ?? context.parentId };
    await sessions.setActiveWorkspace(conversationKey({ userId: context.userId, channelId: targetChannelId }), workspaceName);

    let binding;
    if (localGoalTask) {
      binding = await autoPauseAndSelectActiveGoal({ interaction, workspaceName, key: targetKey,
        context: targetContext, workspaceRunKey, sourceThreadId: preview.metadata.id,
        reply: payload => interaction.editReply({ ...payload, allowedMentions: { parse: [] } }) });
    } else {
      binding = await sessions.setPendingSelection(targetKey, { workspace: workspaceName,
        source: preview.metadata.source, sourceThreadId: preview.metadata.id,
        sourceLastCompletedTurnId: preview.turnId, sourceUpdatedAt: preview.metadata.updatedAt,
        expectedRevision: sessions.bindingRevision?.(targetKey) ?? 0,
        expectedRunEpoch: sessions.runEpoch?.(workspaceRunKey) ?? 0, workspaceRunKey });
      await validateAndRememberHistoryHandoff({ key: targetKey, context: targetContext, workspaceName, binding });
    }

    if (mode === 'chat') {
      if (typeof targetThread?.send === 'function') await targetThread.send({
        content: '已準備好延續來源對話。直接在這個 thread 傳送新工作，Bot 會 fork 並在此繼續。',
        allowedMentions: { parse: [] }
      });
      await interaction.editReply({ content: `已準備一般對話：${targetThread?.toString?.() ?? '目前 thread'}。直接在新 thread 傳送工作即可。`,
        allowedMentions: { parse: [] } });
      return;
    }

    await interaction.editReply({ content: `正在新 thread 接續 Goal：${targetThread?.toString?.() ?? '目前 thread'}…`,
      allowedMentions: { parse: [] } });
    if (typeof dispatchInteraction !== 'function') throw new Error('Goal command dispatcher is unavailable');
    const synthetic = Object.create(interaction);
    Object.assign(synthetic, {
      commandName: 'codex', channel: targetThread, channelId: targetChannelId,
      deferred: true, replied: false,
      isButton: () => false, isModalSubmit: () => false, isAutocomplete: () => false, isChatInputCommand: () => true,
      options: { getSubcommandGroup: () => 'goal', getSubcommand: () => 'resume',
        getString: name => name === 'workspace' ? workspaceName : null, getInteger: () => null },
      deferReply: async () => {},
      editReply: payload => interaction.editReply({ ...payload, allowedMentions: { parse: [] } }),
      reply: payload => interaction.editReply({ ...payload, allowedMentions: { parse: [] } }),
      followUp: payload => interaction.followUp({ ...payload, allowedMentions: { parse: [] } })
    });
    await dispatchInteraction(synthetic);
  };
  client.once(Events.ClientReady, (readyClient) => {
    console.info(`CodexDiscord ready as ${readyClient.user.tag}`);
    void refreshUsagePresence();
  });
  let dispatchInteraction = null;
  const handleInteraction = async (interaction) => {
    if (interaction.isButton?.() && interaction.customId.startsWith('codex:goal:')) {
      const [, , token, action] = interaction.customId.split(':');
      const control = goalCardStates.get(token);
      const activeTask = control ? activeTasks.get(control.mapKey) : null;
      const allowed = isAllowedInteraction(interaction, config)
        && control?.userId === interaction.user.id && control?.guildId === interaction.guildId
        && control?.channelId === interaction.channelId && control?.statusMessageId === interaction.message?.id
        && control?.expiresAt > now();
      const current = activeTask && activeTask.runId === control?.runId && activeTask.key === control?.key
        && activeTask.goal?.cardToken === token && activeTask.goal.threadId === control?.threadId
        && (activeTask.goal.turnId ?? null) === control?.turnId
        && (activeTask.goal.turnsSeen ?? 0) === control?.turnsSeen;
      if (!allowed || !current || !['status', 'pause'].includes(action)) {
        await interaction.reply({ content: '這個 Goal 控制按鈕已過期，或不屬於目前執行者與回合。', ephemeral: true,
          allowedMentions: { parse: [] } });
        return;
      }
      await interaction.deferUpdate();
      try {
        const workspace = config.workspaces.get(activeTask.workspaceName);
        if (!workspace || typeof goalClientFactory !== 'function') throw Object.assign(new Error('Goal status is unavailable'), { code: 'GOAL_API_NOT_READY' });
        const client = await goalClientFactory({ cwd: workspace.path });
        let state;
        try {
          const lifecycle = createGoalLifecycle({ client });
          state = await lifecycle.get(control.threadId);
          if (!state.goal) throw Object.assign(new Error('Native Goal is unavailable'), { code: 'GOAL_NOT_FOUND' });
          const sameGoalCard = activeTasks.get(control.mapKey) === activeTask
            && activeTask.runId === control.runId && activeTask.key === control.key
            && activeTask.goal.cardToken === token && activeTask.goal.threadId === control.threadId
            && (activeTask.goal.turnId ?? null) === control.turnId
            && (activeTask.goal.turnsSeen ?? 0) === control.turnsSeen
            && control.expiresAt > now();
          if (!sameGoalCard) {
            const expired = control.expiresAt <= now();
            throw Object.assign(new Error(expired ? 'The Goal activity control expired during native status read'
              : 'The active Goal turn changed during native status read'), {
              code: expired ? 'GOAL_CONTROL_EXPIRED' : 'GOAL_TURN_CONFLICT'
            });
          }
          if (action === 'pause') {
            if (state.goal.status !== 'active' || typeof runner.pauseGoal !== 'function') {
              throw Object.assign(new Error('This Goal is no longer active in its supervisor'), { code: 'GOAL_SUPERVISOR_REQUIRED' });
            }
            const accepted = await runner.pauseGoal(control.key, { threadId: control.threadId,
              turnId: control.turnId, turnsSeen: control.turnsSeen });
            if (!accepted) throw Object.assign(new Error('The active Goal supervisor did not accept pause'), { code: 'GOAL_SUPERVISOR_REQUIRED' });
            state = await lifecycle.get(control.threadId);
          }
        } finally { await client.close(); }
        const goal = state.goal;
        await updateGoalActivity(activeTask, { status: goal.status,
          tokenBudget: goal.tokenBudget, tokensUsed: goal.tokensUsed,
          turnInFlight: activeTask.goal.turnInFlight,
          ...(goal.status === 'paused' ? { turnInFlight: false, turnId: null } : {}) });
        const usage = Number.isSafeInteger(goal.tokensUsed) ? goal.tokensUsed : '未知';
        const budget = Number.isSafeInteger(goal.tokenBudget) ? goal.tokenBudget : '未設定';
        const result = action === 'pause'
          ? goal.status === 'paused' ? `Goal 暫停已由 native read-back 確認；用量 ${usage} / ${budget} tokens。`
            : `已送出暫停要求，但 native 狀態為 ${goal.status}；尚未確認暫停。`
          : `Goal 狀態已重新讀取：${goal.status}；用量 ${usage} / ${budget} tokens。`;
        await interaction.followUp({ content: result, ephemeral: true, allowedMentions: { parse: [] } });
      } catch (error) {
        await interaction.followUp({ content: formatGoalCommandError(error), ephemeral: true, allowedMentions: { parse: [] } });
      }
      return;
    }
    if ((interaction.isStringSelectMenu?.() && ['codex:history:preview', 'codex:continue:select'].includes(interaction.customId))
      || (interaction.isButton?.() && (interaction.customId.startsWith('codex:history:page:')
        || interaction.customId.startsWith('codex:history:more:')
        || interaction.customId.startsWith('codex:history:select:')
        || interaction.customId.startsWith('codex:history:handoff:')
        || interaction.customId.startsWith('codex:continue:chat:')
        || interaction.customId.startsWith('codex:continue:goal:')))) {
      if (!isAllowedInteraction(interaction, config)) {
        await interaction.reply({ content: '無法使用這個歷史選單。', ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      const context = historyContext(interaction);
      try {
        if (interaction.isButton?.() && (interaction.customId.startsWith('codex:continue:chat:')
            || interaction.customId.startsWith('codex:continue:goal:'))) {
          const mode = interaction.customId.startsWith('codex:continue:goal:') ? 'goal' : 'chat';
          const prefix = `codex:continue:${mode}:`;
          const token = interaction.customId.slice(prefix.length);
          const state = historyUiState.get(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'candidate' || state.flow !== 'continue') {
            throw new Error('延續候選已過期，請重新執行 `/codex continue`。');
          }
          await continueFromHistory({ interaction, context, token, state, mode });
          historyUiState.delete(token);
          return;
        }
        if (interaction.isStringSelectMenu?.()) {
          const token = interaction.values?.[0];
          const state = historyUiState.get(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'candidate') throw new Error('歷史候選已過期，請重新列出對話。');
          await renderHistoryPreview({ interaction, context, state, token, update: true });
        } else if (interaction.customId.startsWith('codex:history:page:')) {
          const token = interaction.customId.slice('codex:history:page:'.length);
          const state = historyUiState.get(token);
          historyUiState.delete(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'cursor') throw new Error('歷史頁面已過期，請重新列出對話。');
          const resolved = await historyAccess.resolveCursor({ ...context, workspaceName: state.workspaceName },
            { token, query: state.query, source: state.source });
          await renderHistoryPage({ interaction, context, workspaceName: resolved.workspaceName,
            query: state.query, source: state.source, cursors: resolved.cursors, flow: state.flow ?? 'history', update: true });
        } else if (interaction.customId.startsWith('codex:history:more:')) {
          const token = interaction.customId.slice('codex:history:more:'.length);
          const state = historyUiState.get(token);
          historyUiState.delete(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'preview-page') throw new Error('預覽頁面已過期，請重新開啟對話。');
          await renderHistoryPreview({ interaction, context, state, token: state.candidateToken, update: true });
        } else if (interaction.customId.startsWith('codex:history:select:')) {
          const token = interaction.customId.slice('codex:history:select:'.length);
          const state = historyUiState.get(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'candidate') throw new Error('歷史候選已過期，請重新列出對話。');
          await selectHistoryBinding({ interaction, context, token, state });
        } else if (interaction.customId.startsWith('codex:history:handoff:')) {
          const token = interaction.customId.slice('codex:history:handoff:'.length);
          const state = historyUiState.get(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'handoff-confirm') throw new Error('交接確認已過期，請重新開啟來源預覽。');
          const binding = sessions.get(state.key);
          if (binding?.origin !== 'native-selection' || binding.sessionId !== null
              || binding.selectionRevision !== state.selectionRevision
              || binding.sourceThreadId !== state.sourceThreadId
              || binding.sourceLastCompletedTurnId !== state.sourceLastCompletedTurnId
              || binding.sourceUpdatedAt !== state.sourceUpdatedAt) {
            throw new Error('來源選取已變更，請重新預覽並選取。');
          }
          await validateAndRememberHistoryHandoff({ key: state.key, context,
            workspaceName: state.workspaceName, binding });
          historyUiState.delete(token);
          await interaction.update({ content: '交接確認完成。來源在這次檢查中沒有顯示執行中的回合；狀態仍可能無法證明其他 App Server 已閒置。若要繼續原生 Goal，請執行 `/codex goal resume`；若要一般對話，請送出工作。Bot 會在 fork 前再次檢查來源與預覽錨點。',
            components: [], allowedMentions: { parse: [] } });
        }
      } catch (error) {
        const payload = { content: `歷史資料目前無法顯示：${error.message}`, components: [], allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, ephemeral: true });
      }
      return;
    }
    if ((interaction.isButton() && interaction.customId.startsWith("codex:input:"))
        || (interaction.isModalSubmit() && interaction.customId.startsWith("codex:answers:"))) {
      const token = interaction.customId.split(":")[2];
      const input = approvals.get(token);
      if (!ownsUserInput(input, interaction, isAllowedInteraction(interaction, config)) || !belongsToActiveRun(input, activeTasks)) {
        await interaction.reply({ content: "這個問題已失效，或不屬於你的工作。", ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (interaction.isButton()) {
        await interaction.showModal(userInputModal(token, input));
        return;
      }
      try {
        const answers = answersFromModal(input, interaction.fields);
        if (!runner.answerUserInput(input.key, input.requestId, answers)) throw new Error("問題已結束，答案未送出");
        approvals.delete(token);
        await input.progress.resolveApproval(input.requestId);
        await interaction.reply({ content: "答案已送回 Codex。", ephemeral: true, allowedMentions: { parse: [] } });
      } catch (error) {
        await interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } });
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== "codex" || !isAllowedInteraction(interaction, config)) {
        await interaction.respond([]);
        return;
      }
      const focused = interaction.options.getFocused(true);
      const action = interaction.options.getSubcommand(false);
      const conversation = conversationKey({ userId: interaction.user.id, channelId: interaction.channelId });
      if (focused.name === "workspace") {
        await interaction.respond(workspaceAutocompleteChoices(config.workspaces.keys(), focused.value));
        return;
      }
      if (action === "model" && focused.name === "name") {
        await interaction.respond(modelAutocompleteChoices(models, focused.value));
        return;
      }
      if (action === "reasoning" && focused.name === "effort") {
        const model = activeCatalogModel(sessions.activeModel(conversation), models);
        await interaction.respond(reasoningAutocompleteChoices(model, focused.value));
        return;
      }
      if (action !== "model" && action !== "reasoning") {
        await interaction.respond([]);
        return;
      }
      await interaction.respond([]);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("codex:approval:")) {
      const [, , token, choice] = interaction.customId.split(":");
      const approval = approvals.get(token);
      if (!approval || !belongsToActiveRun(approval, activeTasks)) {
        approvals.delete(token);
        await interaction.update({ components: [] });
        await interaction.followUp({
          content: "This Codex approval is no longer active. The task may have finished, been cancelled, or the bot was restarted.",
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
        return;
      }
      if (!isAllowedInteraction(interaction, config) || interaction.user.id !== approval.userId || interaction.channelId !== approval.channelId) {
        await interaction.reply({ content: "You are not allowed to answer this Codex approval.", ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      await interaction.deferUpdate();
      try { await interaction.message?.edit?.({ components: [] }); } catch { /* The native decision remains authoritative. */ }
      const autoApproveAll = choice === "allow-all";
      const accepted = belongsToActiveRun(approval, activeTasks) && (autoApproveAll
        ? runner.approveAll(approval.key, approval.requestId)
        : runner.approve(approval.key, approval.requestId, choice));
      approvals.delete(token);
      if (accepted) {
        if (autoApproveAll) {
          retireRunApprovals(approvals, approval.runId, pending => pending.kind !== "user-input");
        }
        await approval.progress.approvalSubmitted(autoApproveAll);
      }
      else {
        await approval.progress.resolveApproval(approval.requestId);
        await interaction.followUp({
          content: "This Codex approval is no longer pending.",
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
      }
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== "codex") return;
    if (!isAllowedInteraction(interaction, config)) {
      await interaction.reply({ content: "You are not allowed to run local Codex here.", ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    const commandGroup = interaction.options.getSubcommandGroup?.(false) ?? null;
    const rootAction = interaction.options.getSubcommand(false);
    if (!commandGroup && rootAction === 'continue') {
      const context = historyContext(interaction);
      const workspaceName = resolveWorkspaceName({ explicit: interaction.options.getString('workspace', false),
        userId: context.userId, channelId: context.channelId, parentChannelId: interaction.channel?.parentId ?? null,
        sessions, workspaceNames: config.workspaces.keys() });
      if (!workspaceName) {
        await interaction.reply({ content: '無法判定 workspace；請先用 `/codex use`，或在 `/codex continue` 指定 workspace。',
          ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      try {
        await interaction.deferReply({ ephemeral: true });
        await renderHistoryPage({ interaction, context, workspaceName, query: '', source: 'all', flow: 'continue' });
      } catch (error) {
        const payload = { content: `無法列出可延續對話：${error.message}`, components: [], allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, ephemeral: true });
      }
      return;
    }
    if (commandGroup === 'goal') {
      const action = interaction.options.getSubcommand();
      if (!GOAL_COMMAND_ACTIONS.includes(action)) {
        await interaction.reply({ content: formatGoalCommandError({ code: 'GOAL_ACTION_UNSUPPORTED' }), ephemeral: true,
          allowedMentions: { parse: [] } });
        return;
      }
      if (!config.goalsEnabled) {
        await interaction.reply({ content: formatGoalCommandError({ code: 'GOAL_FEATURE_DISABLED' }), ephemeral: true,
          allowedMentions: { parse: [] } });
        return;
      }
      if (!['start', 'resume', 'budget', 'clear', 'status', 'pause'].includes(action) || typeof goalClientFactory !== 'function') {
        await interaction.reply({ content: formatGoalCommandError({ code: 'GOAL_API_NOT_READY' }), ephemeral: true,
          allowedMentions: { parse: [] } });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const goalReply = payload => interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
      const workspaceName = resolveWorkspaceName({ explicit: interaction.options.getString('workspace', false),
        userId: interaction.user.id, channelId: interaction.channelId, parentChannelId: interaction.channel?.parentId ?? null,
        sessions, workspaceNames: config.workspaces.keys() });
      if (!workspaceName) {
        await goalReply({ content: '這個 thread 沒有唯一的 workspace 綁定；請在指令中指定 workspace，或先用 `/codex use` 選擇。' });
        return;
      }
      const workspace = config.workspaces.get(workspaceName);
      if (!workspace) {
        await goalReply({ content: '這個工作區未設定。' });
        return;
      }
      const bindingKey = sessionKey({ userId: interaction.user.id, channelId: interaction.channelId, workspace: workspaceName });
      const workspaceTaskKey = taskKey({ userId: interaction.user.id, workspace: workspaceName });
      let binding = sessions.get(bindingKey);
      let pendingSelection = binding?.origin === 'native-selection' && binding.sessionId === null;
      if (action === 'start' || action === 'resume') {
        try {
          const resumeBudget = action === 'resume' ? interaction.options.getInteger?.('token_budget', false) ?? undefined : undefined;
          if (action === 'resume' && resumeBudget === undefined) {
            let canReplaceBinding = !binding?.sessionId;
            if (binding?.sessionId) {
              const currentClient = await goalClientFactory({ cwd: workspace.path });
              try {
                const current = await createGoalLifecycle({ client: currentClient }).get(binding.sessionId);
                canReplaceBinding = !current.goal || current.goal.status === 'complete';
              } catch { canReplaceBinding = false; }
              finally { await currentClient.close(); }
            }
            const controlledGoals = canReplaceBinding ? [...activeTasks.values()].filter(task => task.userId === interaction.user.id
              && task.guildId === interaction.guildId
              && task.workspaceName === workspaceName && task.goal?.threadId && task.goal.status !== 'complete') : [];
            if (controlledGoals.length && controlledGoals.some(task => task.goal.threadId !== binding?.sessionId)) {
              binding = await autoPauseAndSelectActiveGoal({ interaction, workspaceName, key: bindingKey,
                context: historyContext(interaction), workspaceRunKey: workspaceTaskKey, reply: goalReply });
              pendingSelection = true;
            }
          }
          if (pendingSelection && resumeBudget !== undefined) {
            throw Object.assign(new Error('Pending source Goals cannot be changed during handoff'), { code: 'GOAL_PENDING_SELECTION' });
          }
          const runningTask = activeTasks.get(bindingKey);
          if (activeWorkspaceTask(interaction.user.id, workspaceName)) {
            if (action === 'resume' && runningTask?.goal
                && typeof runner.resumeBudgetLimitedGoal === 'function' && binding?.sessionId) {
              if (resumeBudget !== undefined) throw Object.assign(new Error('Use /codex goal budget, then resume, while the existing supervisor is active'), {
                code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
              });
              const client = await goalClientFactory({ cwd: workspace.path });
              let resumed;
              try {
                const lifecycle = createGoalLifecycle({ client });
                const state = await lifecycle.get(binding.sessionId);
                if (!state.goal || state.goal.status !== 'budgetLimited') {
                  throw Object.assign(new Error('The active Goal supervisor is not waiting for a budget-limited Goal'), {
                    code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
                  });
                }
                if (!Number.isSafeInteger(state.goal.tokenBudget) || state.goal.tokenBudget < 1) {
                  throw Object.assign(new Error('Native Goal token budget is unavailable'), { code: 'GOAL_STATE_INVALID' });
                }
                if (!Number.isSafeInteger(state.goal.tokensUsed)) {
                  throw Object.assign(new Error('Native Goal token usage is unavailable'), { code: 'GOAL_USAGE_UNKNOWN' });
                }
                if (state.goal.tokenBudget <= state.goal.tokensUsed) {
                  throw Object.assign(new Error('Increase the budget explicitly before resuming'), {
                    code: 'GOAL_BUDGET_CHANGE_REQUIRED'
                  });
                }
                resumed = await runner.resumeBudgetLimitedGoal(workspaceTaskKey, state.revision);
                if (!resumed) throw Object.assign(new Error('No live Goal supervisor owns this thread'), {
                  code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
                });
                const updated = await lifecycle.get(binding.sessionId);
                if (!updated.goal || updated.goal.status !== 'active') {
                  throw Object.assign(new Error('Native Goal resume was not confirmed active'), { code: 'GOAL_READBACK_MISMATCH' });
                }
              } finally { await client.close(); }
              await goalReply({ content: 'Budget-limited 原生 Goal 已由現有 supervisor 明確恢復；執行仍由原 controller 與 workspace lease 持有。' });
              return;
            }
            throw Object.assign(new Error('Workspace already has active Codex work'), { code: 'GOAL_ALREADY_ACTIVE' });
          }
          let handoffConfirmed = false;
          let pendingGoalExpectation = null;
          if (pendingSelection) {
            const client = await goalClientFactory({ cwd: workspace.path });
            let state;
            try { state = await createGoalLifecycle({ client }).get(binding.sourceThreadId); }
            finally { await client.close(); }
            if (action === 'start' && state.goal && state.goal.status !== 'complete') {
              throw Object.assign(new Error('Selected source already has an unfinished Goal'), { code: 'GOAL_ALREADY_EXISTS' });
            }
            if (action === 'resume') {
              if (!state.goal) throw Object.assign(new Error('No native Goal exists for this thread'), { code: 'GOAL_NOT_FOUND' });
              if (state.goal.status === 'active' && !pendingSelection) {
                throw Object.assign(new Error('The bound Goal is active but has no recoverable supervisor; select its history and confirm handoff before resuming'), {
                  code: 'GOAL_RECOVERY_REQUIRED'
                });
              }
              if (state.goal.status === 'active' && resumeBudget !== undefined) {
                throw Object.assign(new Error('Active Goal recovery does not change the inherited budget'), {
                  code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
                });
              }
              if (state.goal.status === 'budgetLimited') {
                if (resumeBudget === undefined) throw Object.assign(new Error('Supply token_budget to explicitly raise the budget and recover this Goal'), {
                  code: 'GOAL_BUDGET_CHANGE_REQUIRED'
                });
                if (!Number.isSafeInteger(state.goal.tokenBudget) || !Number.isSafeInteger(state.goal.tokensUsed)
                    || resumeBudget <= state.goal.tokenBudget || resumeBudget <= state.goal.tokensUsed) {
                  throw Object.assign(new Error('New budget must exceed both the current budget and tokens used'), {
                    code: 'GOAL_BUDGET_NOT_ABOVE_USAGE'
                  });
                }
                pendingGoalExpectation = state;
              } else if (resumeBudget !== undefined) {
                throw Object.assign(new Error('token_budget is only valid when recovering a settled budget-limited Goal'), {
                  code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
                });
              } else if (!['paused', 'blocked'].includes(state.goal.status)
                  && !(pendingSelection && state.goal.status === 'active')) {
                throw Object.assign(new Error('Native Goal is not resumable'), { code: 'GOAL_NOT_RESUMABLE' });
              }
              pendingGoalExpectation = state;
            }
            handoffConfirmed = consumeHandoffGrant(bindingKey, { userId: interaction.user.id,
              guildId: interaction.guildId, channelId: interaction.channelId }, binding);
            if (!handoffConfirmed) {
              throw Object.assign(new Error('Source work requires explicit handoff confirmation'), { code: 'GOAL_HANDOFF_REQUIRED' });
            }
          }
          if (!pendingSelection && binding?.origin === 'native-fork' && binding.forkGoalPrepared !== true) {
            throw Object.assign(new Error('Forked thread requires Goal preparation'), { code: 'GOAL_PENDING_FORK_REQUIRED' });
          }
          const threadId = pendingSelection ? binding.sourceThreadId : binding?.sessionId ?? null;
          let expectedRevision;
          let objective = action === 'start' ? interaction.options.getString('objective', true).trim() : null;
          const tokenBudget = action === 'start' ? interaction.options.getInteger('token_budget', false) ?? undefined : undefined;
          if (threadId) {
            const client = await goalClientFactory({ cwd: workspace.path });
            let state;
            try { state = await createGoalLifecycle({ client }).get(threadId); }
            finally { await client.close(); }
            if (!pendingSelection) expectedRevision = state.revision;
            if (action === 'start' && state.goal && state.goal.status !== 'complete') {
              throw Object.assign(new Error('This execution thread already has an unfinished Goal'), { code: 'GOAL_ALREADY_EXISTS' });
            }
            if (action === 'resume') {
              if (!state.goal) throw Object.assign(new Error('No native Goal exists for this thread'), { code: 'GOAL_NOT_FOUND' });
              if (state.goal.status === 'active' && !pendingSelection) {
                throw Object.assign(new Error('The bound Goal is active but has no recoverable supervisor; select its history and confirm handoff before resuming'), {
                  code: 'GOAL_RECOVERY_REQUIRED'
                });
              }
              if (state.goal.status === 'active' && resumeBudget !== undefined) {
                throw Object.assign(new Error('Active Goal recovery does not change the inherited budget'), {
                  code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
                });
              }
              if (state.goal.status === 'budgetLimited') {
                if (resumeBudget === undefined) throw Object.assign(new Error('Supply token_budget to explicitly raise the budget and recover this Goal'), {
                  code: 'GOAL_BUDGET_CHANGE_REQUIRED'
                });
                if (!Number.isSafeInteger(state.goal.tokenBudget) || !Number.isSafeInteger(state.goal.tokensUsed)
                    || resumeBudget <= state.goal.tokenBudget || resumeBudget <= state.goal.tokensUsed) {
                  throw Object.assign(new Error('New budget must exceed both the current budget and tokens used'), {
                    code: 'GOAL_BUDGET_NOT_ABOVE_USAGE'
                  });
                }
              } else if (resumeBudget !== undefined) {
                throw Object.assign(new Error('token_budget is only valid when recovering a settled budget-limited Goal'), {
                  code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
                });
              } else if (!['paused', 'blocked'].includes(state.goal.status)
                  && !(pendingSelection && state.goal.status === 'active')) {
                throw Object.assign(new Error('Native Goal is not resumable'), { code: 'GOAL_NOT_RESUMABLE' });
              }
              if (!['paused', 'blocked'].includes(state.goal.status)
                  && !(pendingSelection && state.goal.status === 'active')
                  && !(state.goal.status === 'budgetLimited' && resumeBudget !== undefined)) {
                throw Object.assign(new Error('Native Goal is not resumable'), { code: 'GOAL_NOT_RESUMABLE' });
              }
              objective = state.goal.objective;
              if (pendingSelection) pendingGoalExpectation = state;
            }
          } else if (action === 'resume') {
            throw Object.assign(new Error('No execution thread is bound to resume'), { code: 'GOAL_NOT_FOUND' });
          }
          let executionChannel = interaction.channel;
          if (!interaction.channel?.isThread?.() && (!binding || pendingSelection)) {
            executionChannel = await createSessionThread({ channel: interaction.channel, userId: interaction.user.id,
              title: sessionThreadTitle(objective, workspaceName) });
          }
          await annotateSessionThread(executionChannel, workspaceName);
          if (pendingSelection) {
            const targetBindingKey = sessionKey({ userId: interaction.user.id,
              channelId: executionChannel.id ?? interaction.channelId, workspace: workspaceName });
            if (targetBindingKey !== bindingKey) await copyPendingSelection(binding, targetBindingKey);
          }
          const statusPayload = { content: `工作區：**${workspaceName}**\n${action === 'start' ? '正在準備原生 Goal…' : '正在恢復原生 Goal…'}`,
            allowedMentions: { parse: [] } };
          const status = typeof executionChannel.send === 'function'
            ? await executionChannel.send(statusPayload) : await goalReply(statusPayload);
          const pinned = await pinGoalStatus(status);
          await goalReply({ content: `Goal 執行 thread：${executionChannel.toString()}${pinned ? '（狀態訊息已釘選）' : '（無法釘選狀態訊息；請檢查 Bot 的管理訊息權限）'}` });
          await executeGoalRun({ interaction, workspaceName, objective,
            goalRun: action === 'start'
              ? { objective, ...(tokenBudget === undefined ? {} : { tokenBudget }), ...(expectedRevision ? { expectedRevision } : {}) }
              : { resume: true, ...(expectedRevision ? { expectedRevision } : {}), objective,
                ...(pendingSelection ? { forkRecovery: true } : {}),
                ...(resumeBudget !== undefined ? { resumeBudgetLimited: true, tokenBudget: resumeBudget } : {}) },
            status, handoffConfirmed, pendingGoalExpectation });
          // executeGoalRun owns the ephemeral Goal activity card through the
          // native terminal read-back; do not overwrite it with a generic turn
          // completion message that could misstate Goal completion.
        } catch (error) {
          console.warn(`Native Goal ${action} failed (${typeof error?.code === 'string' ? error.code : error?.name ?? 'unknown'})`);
          await goalReply({ content: formatGoalCommandError(error) });
        }
        return;
      }
      if (action === 'budget') {
        try {
          if (pendingSelection) throw Object.assign(new Error('Pending source Goals cannot be changed'), { code: 'GOAL_PENDING_SELECTION' });
          const threadId = binding?.sessionId;
          if (!threadId) throw Object.assign(new Error('No execution thread is bound'), { code: 'GOAL_NOT_FOUND' });
          const runningTask = activeTasks.get(bindingKey);
          if (activeWorkspaceTask(interaction.user.id, workspaceName) && !runningTask?.goal) {
            throw Object.assign(new Error('Goal has an active local controller'), { code: 'GOAL_ALREADY_ACTIVE' });
          }
          const tokenBudget = interaction.options.getInteger('token_budget', true);
          const client = await goalClientFactory({ cwd: workspace.path });
          let updated;
          try {
            let lifecycle;
            lifecycle = createGoalLifecycle({ client, ...(runningTask?.goal && typeof runner.setGoalBudget === 'function'
              ? { supervisor: { setBudget: async operation => {
              const accepted = await runner.setGoalBudget(workspaceTaskKey, operation.tokenBudget, operation.revision);
              if (!accepted) throw Object.assign(new Error('No live Goal supervisor owns this thread'), {
                code: 'GOAL_BUDGET_SUPERVISOR_REQUIRED'
              });
              return lifecycle.get(operation.threadId);
            } } } : {}) });
            const state = await lifecycle.get(threadId);
            if (!state.goal) throw Object.assign(new Error('No native Goal exists'), { code: 'GOAL_NOT_FOUND' });
            if (Number.isSafeInteger(state.goal.tokensUsed) && tokenBudget <= state.goal.tokensUsed) {
              throw Object.assign(new Error('Budget must exceed the current token usage'), { code: 'GOAL_BUDGET_NOT_ABOVE_USAGE' });
            }
            updated = await lifecycle.setBudget(threadId, tokenBudget, state.revision);
          } finally { await client.close(); }
          const goal = updated.goal;
          await goalReply({ content: `預算更新已讀回確認：狀態 ${goal.status}；總預算 ${goal.tokenBudget}；已用 ${goal.tokensUsed ?? '未知'} tokens。` });
        } catch (error) {
          await goalReply({ content: formatGoalCommandError(error) });
        }
        return;
      }
      if (action === 'clear') {
        try {
          if (pendingSelection) throw Object.assign(new Error('Pending source Goals cannot be cleared'), { code: 'GOAL_PENDING_SELECTION' });
          const threadId = binding?.sessionId;
          if (!threadId) throw Object.assign(new Error('No execution thread is bound'), { code: 'GOAL_NOT_FOUND' });
          if (activeWorkspaceTask(interaction.user.id, workspaceName)) {
            throw Object.assign(new Error('Goal has an active local controller'), { code: 'GOAL_ALREADY_ACTIVE' });
          }
          const client = await goalClientFactory({ cwd: workspace.path });
          let current, cleared;
          try {
            const lifecycle = createGoalLifecycle({ client });
            current = await lifecycle.get(threadId);
            if (!current.goal) {
              await goalReply({ content: '此執行 thread 沒有原生 Goal；沒有執行清除。' });
              return;
            }
            cleared = await lifecycle.clear(threadId, current.revision);
          } finally { await client.close(); }
          if (cleared.goal) throw Object.assign(new Error('Native Goal clear was not confirmed'), { code: 'GOAL_READBACK_MISMATCH' });
          await goalReply({ content: `原生 Goal 已清除並經 read-back 確認（原狀態：${current.goal.status}）；執行 thread 綁定保留。` });
        } catch (error) {
          await goalReply({ content: formatGoalCommandError(error) });
        }
        return;
      }
      const threadId = pendingSelection ? binding.sourceThreadId : binding?.sessionId;
      if (!threadId) {
        await goalReply({ content: '目前沒有可查詢的執行 thread。' });
        return;
      }
      try {
        const client = await goalClientFactory({ cwd: workspace.path });
        let state;
        try { state = await createGoalLifecycle({ client }).get(threadId); }
        finally { await client.close(); }
        const goal = state.goal;
        if (action === 'status') {
          const prefix = pendingSelection ? '這是所選來源 thread 的狀態；目前尚未建立執行 thread。' : '目前執行 thread 的 Goal 狀態：';
          const detail = goal ? `狀態 ${goal.status}；預算 ${goal.tokenBudget ?? '未設定'}；已用 ${goal.tokensUsed ?? '未知'} tokens。`
            : '此 thread 沒有原生 Goal。';
          await goalReply({ content: `${prefix}\n${detail}` });
          return;
        }
        if (pendingSelection) throw Object.assign(new Error('Pending selections cannot be mutated'), { code: 'GOAL_PENDING_SELECTION' });
        if (!goal || goal.status !== 'active') {
          await goalReply({ content: goal ? `Goal 目前為 ${goal.status}，不需執行暫停。` : '此 thread 沒有原生 Goal。' });
          return;
        }
        const key = taskKey({ userId: interaction.user.id, workspace: workspaceName });
        if (typeof runner.pauseGoal !== 'function' || !runner.isRunning?.(key) || !runner.pauseGoal(key)) {
          throw Object.assign(new Error('Active Goal is not controlled by this bot runtime'), { code: 'GOAL_SUPERVISOR_REQUIRED' });
        }
        await goalReply({ content: '已要求目前執行中的 Goal 暫停；請稍後查詢狀態確認。' });
      } catch (error) {
        await goalReply({ content: formatGoalCommandError(error) });
      }
      return;
    }
    if (commandGroup === 'sessions') {
      const sessionAction = interaction.options.getSubcommand();
      const context = historyContext(interaction);
      const workspaceName = resolveWorkspaceName({ explicit: interaction.options.getString('workspace', false),
        userId: context.userId, channelId: context.channelId, parentChannelId: interaction.channel?.parentId ?? null,
        sessions, workspaceNames: config.workspaces.keys() });
      if (!workspaceName) {
        await interaction.reply({ content: '這個 thread 沒有唯一的 workspace 綁定；請在指令中指定 workspace，或先用 `/codex use` 選擇。',
          ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      const query = interaction.options.getString('query', false) ?? '';
      const source = sessionAction === 'list' ? (interaction.options.getString('source', false) ?? 'all') : null;
      try {
        if (sessionAction === 'current') {
          const key = sessionKey({ userId: context.userId, channelId: context.channelId, workspace: workspaceName });
          const binding = sessions.get(key);
          const content = binding?.origin === 'native-selection' && binding.sessionId === null
            ? `目前對話綁定：待安全 fork。來源：${binding.source}；選取版本：${binding.selectionRevision}。尚未建立執行對話。`
            : binding?.sessionId
              ? `目前對話綁定：Codex Discord session 已就緒。版本：${binding.selectionRevision ?? 0}。`
              : '目前沒有已選取或執行中的對話綁定。';
          await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        if (sessionAction === 'handoff') {
          const key = sessionKey({ userId: context.userId, channelId: context.channelId, workspace: workspaceName });
          if (!interaction.options.getBoolean('confirm', true)) {
            await interaction.editReply({ content: '尚未確認來源工作已停止；沒有建立交接授權。',
              allowedMentions: { parse: [] } });
            return;
          }
          await validateAndRememberHistoryHandoff({ key, context, workspaceName, binding: sessions.get(key) });
          await interaction.editReply({ content: '交接確認完成。來源在這次檢查中沒有顯示執行中的回合；狀態仍可能無法證明其他 App Server 已閒置。若要繼續原生 Goal，請執行 `/codex goal resume`；若要一般對話，請送出工作。Bot 會在 fork 前再次檢查來源與預覽錨點。',
            allowedMentions: { parse: [] } });
        } else if (sessionAction === 'list') {
          await renderHistoryPage({ interaction, context, workspaceName, query, source });
        } else {
          const token = interaction.options.getString('thread', true);
          const key = sessionKey({ userId: context.userId, channelId: context.channelId, workspace: workspaceName });
          const state = historyUiState.get(token);
          if (!historyUiMatches(state, interaction) || state.kind !== 'candidate' || state.workspaceName !== workspaceName) {
            throw new Error('歷史候選已過期或不屬於目前對話，請重新列出對話。');
          }
          await renderHistoryPreview({ interaction, context, state, token });
        }
      } catch (error) {
        await interaction.editReply({ content: `歷史資料目前無法顯示：${error.message}`,
          components: [], allowedMentions: { parse: [] } });
      }
      return;
    }
    const action = interaction.options.getSubcommand();
    const conversation = conversationKey({ userId: interaction.user.id, channelId: interaction.channelId });
    if (action === "model") {
      try {
        const model = selectedModel(interaction.options.getString("name", true), models);
        await sessions.setActiveModel(conversation, model);
        await sessions.setActiveReasoningEffort(conversation, null);
        const activeGoalNotice = hasActiveGoalInConversation(interaction)
          ? '\n\nThe active Goal keeps the model and reasoning depth captured when it started; this setting applies to future runs.' : '';
        await interaction.reply({
          content: (model
            ? `Normal messages in this channel will now use **${model}**. Reasoning depth was reset to the model default.`
            : "Normal messages in this channel will now use the local Codex default model and its default reasoning depth.") + activeGoalNotice,
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
      } catch (error) {
        await interaction.reply({ content: `Invalid model: ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
      }
      return;
    }
    if (action === "reasoning") {
      try {
        const model = activeCatalogModel(sessions.activeModel(conversation), models);
        if (!model) throw new Error("Select an available Codex model before choosing a reasoning depth");
        const reasoningEffort = selectedReasoningEffort(interaction.options.getString("effort", true), model);
        await sessions.setActiveReasoningEffort(conversation, reasoningEffort);
        const activeGoalNotice = hasActiveGoalInConversation(interaction)
          ? '\n\nThe active Goal keeps the model and reasoning depth captured when it started; this setting applies to future runs.' : '';
        await interaction.reply({
          content: (reasoningEffort
            ? `Reasoning depth for **${model.id}** is now **${reasoningEffort}**.`
            : `Reasoning depth for **${model.id}** now uses the model default.`) + activeGoalNotice,
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
      } catch (error) {
        await interaction.reply({ content: `Invalid reasoning depth: ${error.message}`, ephemeral: true, allowedMentions: { parse: [] } });
      }
      return;
    }
    if (action === "progress") {
      const lines = interaction.options.getInteger("lines", true);
      await sessions.setProgressLineCount(conversation, lines);
      await interaction.reply({
        content: lines === 0
          ? "CLI-style gray progress lines are now hidden for this channel."
          : `CLI-style progress will show the latest **${lines}** gray line${lines === 1 ? "" : "s"} while running and retain the full history above the final reply.`,
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    if (action === "usage") {
      try {
        await interaction.deferReply({ ephemeral: true });
        const usage = await runner.getUsage({ workspace: catalogWorkspace.path });
        applyUsagePresence(client, usage);
        await interaction.editReply({ content: formatUsageResult(usage), allowedMentions: { parse: [] } });
      } catch (error) {
        const message = `Codex usage query failed: ${error.message}`;
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, allowedMentions: { parse: [] } });
        else await interaction.reply({ content: message, ephemeral: true, allowedMentions: { parse: [] } });
      }
      return;
    }
    const workspaceName = resolveWorkspaceName({ explicit: interaction.options.getString("workspace", false),
      userId: interaction.user.id, channelId: interaction.channelId, parentChannelId: interaction.channel?.parentId ?? null,
      sessions, workspaceNames: config.workspaces.keys() });
    if (!workspaceName) {
      await interaction.reply({ content: '這個 thread 沒有唯一的 workspace 綁定；請在指令中指定 workspace，或先用 `/codex use` 選擇。',
        ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    const workspaceConfig = config.workspaces.get(workspaceName);
    if (!workspaceConfig) {
      await interaction.reply({ content: "That workspace is not configured.", ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    const savedKey = sessionKey({ userId: interaction.user.id, channelId: interaction.channelId, workspace: workspaceName });
    const activeKey = taskKey({ userId: interaction.user.id, workspace: workspaceName });
    let status = null;
    let task = "";
    let taskStarted = false;
    let progress = null;
    let activeTask = null;
    const mirrorRunId = randomUUID();
    try {
      if (action === "status") {

        const saved = sessions.get(savedKey);
        const state = runner.isRunning(activeKey) ? "running"
          : saved?.origin === 'native-selection' && saved.sessionId === null ? 'pending safe fork'
            : saved ? "ready to resume" : "new";
        const model = sessions.activeModel(conversation) ?? "local default";
        const reasoningEffort = reasoningLabel(sessions.activeReasoningEffort(conversation));
        const progressLines = sessions.progressLineCount(conversation) ?? DEFAULT_CLI_PROGRESS_LINES;
        const budget = config.usageGuardMode === 'observe' ? '只提醒，不因工具次數或 context 中斷' : '80 次工具／64K context';
        const duration = config.maxRuntimeMs ? `${config.maxRuntimeMs / 1000} 秒` : '不限時';
        await interaction.reply({ content: `Codex session for **${workspaceName}**: ${state}. Model: **${model}**. Reasoning depth: **${reasoningEffort}**. Gray progress lines: **${progressLines}**.\n本機任務預算：${budget}；執行時間：${duration}。`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (action === "cancel") {

        const stopped = runner.cancel(activeKey);
        await interaction.reply({ content: stopped ? "Sent a stop request to your active Codex task." : "No active Codex task for this workspace.", ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (action === "reset") {
        if (activeWorkspaceTask(interaction.user.id, workspaceName)) throw new Error("Cancel the active task before resetting its session");
        const deleted = await sessions.delete(savedKey, activeKey);
        await interaction.reply({ content: deleted ? "Saved Codex session mapping removed." : "No saved Codex session mapping exists.", ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (action === "use") {
        await sessions.setActiveWorkspace(conversation, workspaceName);
        await annotateSessionThread(interaction.channel, workspaceName);
        await interaction.reply({ content: `Normal messages in this channel will now use **${workspaceName}**.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }

      task = interaction.options.getString("task", true);

      const model = sessions.activeModel(conversation);
      const activeModel = activeCatalogModel(model, models);
      const attachment = interaction.options.getAttachment("image", false);
      const imageUrls = imageUrlsForAttachments(attachment ? [attachment] : [], activeModel);
      if (runner.isRunning(activeKey)) {
        await interaction.reply({
          content: "Codex is already working on this workspace in another Discord thread. Reply to that task's status card to steer it, or use `/codex cancel` first.",
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
        return;
      }
      const pendingBinding = sessions.get(savedKey);
      const handoffConfirmed = pendingBinding?.origin === 'native-selection' && pendingBinding.sessionId === null
        ? consumeHandoffGrant(savedKey, { userId: interaction.user.id, guildId: interaction.guildId,
          channelId: interaction.channelId }, pendingBinding) : false;
      if (pendingBinding?.origin === 'native-selection' && pendingBinding.sessionId === null && !handoffConfirmed) {
        await interaction.reply({ content: '這個來源仍待交接確認。請回到對話預覽卡確認來源工作已停止，再送出工作。',
          ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      // Interaction webhooks expire, while a normal bot message can carry a
      // long-running approval card and receive the final result safely.
      let executionChannel = interaction.channel;
      if (!interaction.channel?.isThread?.() && (!pendingBinding || (pendingBinding.origin === 'native-selection'
          && pendingBinding.sessionId === null))) executionChannel = await createSessionThread({ channel: interaction.channel,
        userId: interaction.user.id, title: sessionThreadTitle(task, workspaceName) });
      await annotateSessionThread(executionChannel, workspaceName);
      await interaction.deferReply({ ephemeral: true });
      const statusPayload = { content: `工作區：**${workspaceName}**\n正在準備 Codex 任務…`, allowedMentions: { parse: [] } };
      const statusIsThreadMessage = typeof executionChannel.send === 'function';
      status = statusIsThreadMessage
        ? await executionChannel.send(statusPayload) : await interaction.editReply(statusPayload);
      if (statusIsThreadMessage) await interaction.editReply({ content: `Codex session thread：${executionChannel.toString()}`, allowedMentions: { parse: [] } });
      const executionChannelId = executionChannel.id ?? interaction.channelId;
      const executionConversation = conversationKey({ userId: interaction.user.id, channelId: executionChannelId });
      const executionSavedKey = sessionKey({ userId: interaction.user.id, channelId: executionChannelId, workspace: workspaceName });
      if (pendingBinding?.origin === 'native-selection' && pendingBinding.sessionId === null && executionSavedKey !== savedKey)
        await copyPendingSelection(pendingBinding, executionSavedKey);
      await sessions.setActiveWorkspace(conversation, workspaceName);
      const reasoningEffort = sessions.activeReasoningEffort(executionConversation) ?? sessions.activeReasoningEffort(conversation);
      progress = createProgressReporter({
        workspaceName,
        task,
        model,
        reasoningEffort,
        progressLines: sessions.progressLineCount(executionConversation) ?? sessions.progressLineCount(conversation) ?? DEFAULT_CLI_PROGRESS_LINES,
        imageCount: imageUrls.length,
        edit: (payload) => status.edit(payload)
      });
      activeTask = {
        key: activeKey,
        runId: mirrorRunId,
        mapKey: executionSavedKey,
        userId: interaction.user.id,
        channelId: executionChannelId,
        workspaceName,
        statusMessageId: status.id,
        progress,
        model: activeModel
      };
      claimActiveTask(activeTasks, activeTask, runner);
      taskStarted = true;
      workspaceSync.record(workspaceName, { runId: mirrorRunId, event: "started" });
      const { result } = await runTask({
        config, runner, sessions, ownership, historyAccess, historyClientFactory, goalClientFactory,
        historyContext: { userId: interaction.user.id, guildId: interaction.guildId,
          channelId: interaction.channelId, parentId: interaction.channel?.parentId ?? null },
        handoffConfirmed,
        userId: interaction.user.id, channelId: executionChannelId, workspaceName, task,
        model,
        reasoningEffort,
        imageUrls,
        onProgress: async (event) => {
          workspaceSync.progress(workspaceName, mirrorRunId, event);
          if (event?.method === "serverRequest/resolved") await resolveApproval(activeKey, event.params?.requestId, mirrorRunId);
          progress.update(event);
        },
        onUserInput: (input) => presentUserInput({ input, key: activeKey, userId: interaction.user.id, channelId: executionChannelId,
          status, register: args => registerApproval({ ...args, runId: mirrorRunId }), forget: token => approvals.delete(token) }),
        onApproval: async (approval) => {
          const token = registerApproval({ approval, runId: mirrorRunId, key: activeKey, userId: interaction.user.id, channelId: executionChannelId, progress });
          await progress.requestApproval(approval, approvalComponents(token, approval));
        }
      });
      const retainedProgress = await progress.finish();
      workspaceSync.record(workspaceName, { runId: mirrorRunId, event: result.exitCode === 0 ? "completed" : "failed" });
      const output = await completedTaskPayload(result, workspaceConfig.path);
      await safeStatusChunks(status, `工作區：**${workspaceName}**\n${output.warning}\n${formatQuestionResult(task, result, retainedProgress)}`, output.files);
    } catch (error) {
      if (taskStarted) workspaceSync.record(workspaceName, { runId: mirrorRunId, event: "failed" });
      const message = `Codex request failed: ${error.message}`;
      if (status) {
        const retainedProgress = progress ? await progress.finish() : [];
        await safeStatusChunks(status, `工作區：**${workspaceName}**\n${formatQuestionResult(task, { exitCode: 1, message }, retainedProgress)}`);
      }
      else if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, allowedMentions: { parse: [] } });
      else await interaction.reply({ content: message, ephemeral: true, allowedMentions: { parse: [] } });
    } finally {
      if (activeTask && activeTasks.get(activeTask.mapKey) === activeTask) activeTasks.delete(activeTask.mapKey);
      if (taskStarted) {
        await clearRunApprovals(approvals, mirrorRunId);
        void refreshUsagePresence();
      }
    }
  };
  dispatchInteraction = handleInteraction;
  client.on(Events.InteractionCreate, handleInteraction);
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guildId || (!message.content.trim() && message.attachments.size === 0) || !isAllowedMessage(message, config)) return;
    const conversation = conversationKey({ userId: message.author.id, channelId: message.channelId });
    const explicitReplyTask = [...activeTasks.values()].find((activeTask) => isReplyToActiveStatus(message, activeTask));
    const hasMessageReference = Boolean(message.reference?.messageId ?? message.reference?.message_id);
    const matchingGoalTasks = hasMessageReference ? [] : [...activeTasks.values()].filter(activeTask =>
      activeTask.goal?.threadId && activeTask.userId === message.author.id
        && activeTask.guildId === message.guildId && activeTask.channelId === message.channelId);
    const replyTask = explicitReplyTask
      ?? (matchingGoalTasks.length === 1 ? matchingGoalTasks[0] : null);
    if (replyTask) {
      let imageUrls;
      try {
        imageUrls = imageUrlsForAttachments(message.attachments.values(), replyTask.model);
      } catch (error) {
        await message.reply({ content: `Codex image upload failed: ${error.message}`, allowedMentions: { parse: [] } });
        return;
      }
      const steeringTask = message.content.trim() || "請檢視我上傳的圖片，並依此導正目前工作。";
      try {
        await runner.steer(replyTask.key, {
          prompt: steeringTask,
          imageUrls,
          clientUserMessageId: message.id
        });
        await replyTask.progress.steeringReceived();
        await acknowledgeSteering(message);
      } catch (error) {
        await message.reply({
          content: `無法導正目前的 Codex 工作：${error.message}`,
          allowedMentions: { parse: [] }
        });
      }
      return;
    }
    const workspaceName = resolveWorkspaceName({ userId: message.author.id, channelId: message.channelId,
      parentChannelId: message.channel?.parentId ?? message.channel?.parent?.id ?? null,
      sessions, workspaceNames: config.workspaces.keys() });
    if (!workspaceName) {
      await message.reply({ content: "這個討論串有多個工作區 session。請先用 `/codex use` 選定此串的工作區，再繼續。",
        allowedMentions: { parse: [] } });
      return;
    }
    const workspaceConfig = config.workspaces.get(workspaceName);
    if (!workspaceConfig) {
      await message.reply({ content: "No active workspace is configured. Use `/codex use` once.", allowedMentions: { parse: [] } });
      return;
    }
    if (message.channel?.isThread?.() && typeof sessions.setActiveWorkspace === 'function'
        && !sessions.activeWorkspace(conversation)) {
      await sessions.setActiveWorkspace(conversation, workspaceName);
    }
    await annotateSessionThread(message.channel, workspaceName);
    const task = message.content.trim() || "請檢視我上傳的圖片，說明你看到的內容並依此處理。";

    const model = sessions.activeModel(conversation);
    const reasoningEffort = sessions.activeReasoningEffort(conversation);
    let imageUrls;
    try {
      imageUrls = imageUrlsForAttachments(message.attachments.values(), activeCatalogModel(model, models));
    } catch (error) {
      await message.reply({ content: `Codex image upload failed: ${error.message}`, allowedMentions: { parse: [] } });
      return;
    }
    const originalSavedKey = sessionKey({ userId: message.author.id, channelId: message.channelId, workspace: workspaceName });
    const pendingBinding = sessions.get(originalSavedKey);
    const activeKey = taskKey({ userId: message.author.id, workspace: workspaceName });
    if (runner.isRunning(activeKey)) {
      await message.reply({ content: "Codex is already working on this workspace, possibly in another Discord thread. Reply to that task's status card to steer it, or use `/codex cancel` first.", allowedMentions: { parse: [] } });
      return;
    }
    const handoffConfirmed = pendingBinding?.origin === 'native-selection' && pendingBinding.sessionId === null
      ? consumeHandoffGrant(originalSavedKey, { userId: message.author.id, guildId: message.guildId,
        channelId: message.channelId }, pendingBinding) : false;
    if (pendingBinding?.origin === 'native-selection' && pendingBinding.sessionId === null && !handoffConfirmed) {
      await message.reply({ content: '這個來源仍待交接確認。請回到對話預覽卡確認來源工作已停止，再重新送出工作。',
        allowedMentions: { parse: [] } });
      return;
    }
    let executionChannel = message.channel ?? {};
    try {
      if (!message.channel?.isThread?.() && (!pendingBinding || (pendingBinding.origin === 'native-selection'
          && pendingBinding.sessionId === null)))
        executionChannel = await createSessionThread({ channel: executionChannel,
          starterMessage: message.channel?.isThread?.() ? null : message, userId: message.author.id,
          title: sessionThreadTitle(task, workspaceName) });
      await annotateSessionThread(executionChannel, workspaceName);
    } catch (error) {
      await message.reply({ content: `無法建立 Codex session thread：${error.message}`, allowedMentions: { parse: [] } });
      return;
    }
    const executionChannelId = executionChannel.id ?? message.channelId;
    const savedKey = sessionKey({ userId: message.author.id, channelId: executionChannelId, workspace: workspaceName });
    if (pendingBinding?.origin === 'native-selection' && pendingBinding.sessionId === null && savedKey !== originalSavedKey)
      await copyPendingSelection(pendingBinding, savedKey);
    const mirrorRunId = randomUUID();
    const modelLabel = model ?? "local default";
    const statusPayload = { content: `Codex is working in **${workspaceName}** with **${modelLabel}** at **${reasoningLabel(reasoningEffort)}** reasoning depth${imageUrls.length ? ` and ${imageUrls.length} image(s)` : ""}…`, allowedMentions: { parse: [] } };
    const status = typeof executionChannel.send === 'function'
      ? await executionChannel.send(statusPayload) : await message.reply(statusPayload);
    const progress = createProgressReporter({
      workspaceName,
      task,
      model,
      reasoningEffort,
      progressLines: sessions.progressLineCount(conversation) ?? DEFAULT_CLI_PROGRESS_LINES,
      imageCount: imageUrls.length,
      edit: (payload) => status.edit(payload)
    });
    const activeTask = {
      key: activeKey,
      runId: mirrorRunId,
      mapKey: savedKey,
      userId: message.author.id,
      channelId: executionChannelId,
      workspaceName,
      statusMessageId: status.id,
      progress,
      model: activeCatalogModel(model, models)
    };
    let taskStarted = false;
    try {
      claimActiveTask(activeTasks, activeTask, runner);
      taskStarted = true;
      workspaceSync.record(workspaceName, { runId: mirrorRunId, event: "started" });
      const { result } = await runTask({
        config, runner, sessions, ownership, historyAccess, historyClientFactory, goalClientFactory,
        historyContext: { userId: message.author.id, guildId: message.guildId,
          channelId: message.channelId, parentId: message.channel?.parentId ?? null },
        handoffConfirmed,
        userId: message.author.id, channelId: executionChannelId, workspaceName, task, model, reasoningEffort, imageUrls,
        onProgress: async (event) => {
          workspaceSync.progress(workspaceName, mirrorRunId, event);
          if (event?.method === "serverRequest/resolved") await resolveApproval(activeKey, event.params?.requestId, mirrorRunId);
          progress.update(event);
        },
        onUserInput: (input) => presentUserInput({ input, key: activeKey, userId: message.author.id, channelId: executionChannelId,
          status, register: args => registerApproval({ ...args, runId: mirrorRunId }), forget: token => approvals.delete(token) }),
        onApproval: async (approval) => {
          const token = registerApproval({ approval, runId: mirrorRunId, key: activeKey, userId: message.author.id, channelId: executionChannelId, progress });
          await progress.requestApproval(approval, approvalComponents(token, approval));
        }
      });
      const retainedProgress = await progress.finish();
      workspaceSync.record(workspaceName, { runId: mirrorRunId, event: result.exitCode === 0 ? "completed" : "failed" });
      const output = await completedTaskPayload(result, workspaceConfig.path);
      await safeStatusChunks(status, `工作區：**${workspaceName}**\n${output.warning}\n${formatQuestionResult(task, result, retainedProgress)}`, output.files);
    } catch (error) {
      if (taskStarted) workspaceSync.record(workspaceName, { runId: mirrorRunId, event: "failed" });
      const retainedProgress = await progress.finish();
      await safeStatusChunks(status,
        `工作區：**${workspaceName}**\n${formatQuestionResult(task, { exitCode: 1, message: `Codex request failed: ${error.message}` }, retainedProgress)}`);
    } finally {
      if (activeTasks.get(savedKey) === activeTask) activeTasks.delete(savedKey);
      await clearRunApprovals(approvals, mirrorRunId);
      void refreshUsagePresence();
    }
  });
  await client.login(config.botToken);
  return client;
}

export function belongsToActiveRun(pending, activeTasks) {
  return Boolean(pending?.runId) && [...activeTasks.values()].some(task => task.key === pending.key && task.runId === pending.runId);
}

function claimActiveTask(activeTasks, task, runner) {
  // Discord delivery yields before registration: another request may have started meanwhile.
  if (runner.isRunning(task.key) || [...activeTasks.values()].some(active => active.key === task.key))
    throw new Error("Codex is already working on this workspace. Reply to its status card or cancel it first.");
  activeTasks.set(task.mapKey, task);
}

export function retireRunApprovals(approvals, runId, predicate = () => true) {
  const retired = [];
  for (const [token, pending] of approvals) if (pending.runId === runId && predicate(pending)) {
    approvals.delete(token); retired.push(pending);
  }
  return retired;
}

// Retire only this invocation's cards, atomically before any asynchronous Discord edits.
export async function clearRunApprovals(approvals, runId) {
  const retired = retireRunApprovals(approvals, runId);
  await Promise.allSettled(retired.map(pending => Promise.resolve().then(() => pending.progress.resolveApproval(pending.requestId))));
}
