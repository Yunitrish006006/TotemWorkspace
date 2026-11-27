import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { splitDiscordMessage } from './discord-markdown.mjs';
import { listItems, listThreads, listTurns, readThreadMetadata } from '../../../intelligence/agent-runtime/thread-history.mjs';

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const URL = /\b(?:https?|ftp):\/\/[^\s<>]+/gi;
const UNIX_PATH = /(?<![\w:])\/(?:[\w.@+-]+\/)*[\w.@+-]+/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\s<>"'`]+\\?)+/g;
const CREDENTIAL = /\b(?:bearer\s+)[A-Za-z0-9._~+/-]+=*|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+|\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gi;
const DISCORD_MENTION = /<(?:@!?\d{17,20}|@&\d{17,20}|#\d{17,20})>/g;
const MAX_ANCHOR_TURN_PAGES = 20;
const NATIVE_GOAL_STATUSES = new Set(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']);

/** Remove values that can expose local machine details or trigger Discord mentions. */
export function sanitizeHistoryText(value, limit = 2_000) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20_000) throw new RangeError('limit is invalid');
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, ' ').replace(CREDENTIAL, '[憑證已隱藏]')
    .replace(URL, '[URL 已隱藏]').replace(UNIX_PATH, '[本機路徑已隱藏]')
    .replace(WINDOWS_PATH, '[本機路徑已隱藏]').replace(DISCORD_MENTION, '[mention 已隱藏]')
    .replace(/@(everyone|here)\b/gi, '@\u200b$1').replace(/@(?=\w)/g, '@\u200b')
    .slice(0, limit);
}

export function historyChoiceLabel(thread) {
  const hasGoalStatus = thread?.goalStatus !== undefined;
  const goalLabel = !hasGoalStatus ? '' : thread.goalStatus === null ? '無 Goal'
    : NATIVE_GOAL_STATUSES.has(thread.goalStatus) ? `Goal：${thread.goalStatus}` : 'Goal：狀態未知';
  const title = sanitizeHistoryText(thread?.title || '（未命名對話）', hasGoalStatus ? 37 : 72).replace(/\s+/g, ' ').trim();
  const source = sanitizeHistoryText(thread?.source || 'unknown', 20);
  const updated = Number.isFinite(thread?.updatedAt)
    ? new Date(thread.updatedAt).toISOString().slice(0, 16).replace('T', ' ') : '時間未知';
  return `${title || '（未命名對話）'} · ${source} · ${updated}${goalLabel ? ` · ${goalLabel}` : ''}`.slice(0, 100);
}

export function historyListPayload({ workspaceName, threads, candidateTokens, nextToken = null, flow = 'history' }) {
  if (!Array.isArray(threads) || !Array.isArray(candidateTokens) || threads.length !== candidateTokens.length
    || threads.length > 25) throw new TypeError('history list entries are invalid');
  if (threads.length === 0) return { content: `**${sanitizeHistoryText(workspaceName, 80)}** 沒有可顯示的對話。`, components: [] };
  const continueFlow = flow === 'continue';
  const menu = new StringSelectMenuBuilder().setCustomId(continueFlow ? 'codex:continue:select' : 'codex:history:preview')
    .setPlaceholder(continueFlow ? '選擇要延續的 Codex 對話' : '選擇一個對話以查看唯讀預覽')
    .addOptions(threads.map((thread, index) => ({ label: historyChoiceLabel(thread), value: candidateTokens[index] })));
  const components = [new ActionRowBuilder().addComponents(menu)];
  if (nextToken) components.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`codex:history:page:${nextToken}`).setLabel('下一頁').setStyle(ButtonStyle.Secondary)));
  const choices = threads.map((thread, index) => `- ${historyChoiceLabel(thread)} · 候選碼：\`${candidateTokens[index]}\``).join('\n');
  const intro = continueFlow
    ? `**${sanitizeHistoryText(workspaceName, 80)}** 的可延續對話（私密清單）。選一筆後可預覽，再選一般對話或 Goal 接續。\n`
    : `**${sanitizeHistoryText(workspaceName, 80)}** 的可讀對話（私密清單）。選擇項目或使用候選碼只會開啟預覽，不會啟動 Codex。\n`;
  return { content: `${intro}${choices}`.slice(0, 1_850), components };
}

export function historyPreviewPayload({ workspaceName, thread, turns, messages, more = false,
  nextItemToken = null, nextTurnToken = null, candidateToken = null, continueMode = false, goalStatus = 'unknown' }) {
  const title = sanitizeHistoryText(thread?.title || '（未命名對話）', 100).replace(/\s+/g, ' ').trim();
  const lines = [`**${sanitizeHistoryText(workspaceName, 80)} · ${title || '（未命名對話）'}**`,
    `來源：${sanitizeHistoryText(thread?.source || 'unknown', 20)} · 只讀預覽`];
  if (continueMode) {
    const goalLabel = goalStatus === null ? '無 Goal'
      : NATIVE_GOAL_STATUSES.has(goalStatus) ? goalStatus : '狀態未知';
    lines.push(`Goal：${goalLabel}`);
    if (goalStatus === 'active') lines.push('延續一般對話會先暫停由此 Bot 控制的來源 Goal；其他 App 控制的工作須先在來源端停止。');
  }
  if (!Array.isArray(messages) || messages.length === 0) lines.push('這個頁面沒有可顯示的已送出文字。');
  else for (const message of messages) {
    const role = message.role === 'user' ? '使用者' : 'Codex';
    lines.push(`**${role}**\n${sanitizeHistoryText(message.text, 1_500)}`);
  }
  if (more) lines.push('目前顯示一個有界歷史頁面；可按鈕繼續讀取更舊內容。');
  const components = [];
  const buttons = [];
  if (nextItemToken) buttons.push(new ButtonBuilder().setCustomId(`codex:history:more:${nextItemToken}`)
    .setLabel('較早訊息').setStyle(ButtonStyle.Secondary));
  if (nextTurnToken) buttons.push(new ButtonBuilder().setCustomId(`codex:history:more:${nextTurnToken}`)
    .setLabel('較舊回合').setStyle(ButtonStyle.Secondary));
  if (candidateToken && continueMode) {
    buttons.push(new ButtonBuilder().setCustomId(`codex:continue:chat:${candidateToken}`)
      .setLabel('延續一般對話').setStyle(ButtonStyle.Primary));
    if (['active', 'paused', 'blocked'].includes(goalStatus)) buttons.push(new ButtonBuilder()
      .setCustomId(`codex:continue:goal:${candidateToken}`).setLabel('接續 Goal').setStyle(ButtonStyle.Success));
  } else if (candidateToken) buttons.push(new ButtonBuilder().setCustomId(`codex:history:select:${candidateToken}`)
    .setLabel('選取此對話').setStyle(ButtonStyle.Primary));
  if (buttons.length) components.push(new ActionRowBuilder().addComponents(...buttons));
  return { contents: splitDiscordMessage(lines.join('\n\n').slice(0, 7_500), 1_800),
    turns: Array.isArray(turns) ? turns.length : 0, components };
}

export async function loadHistoryList({ client, access, context, workspaceName, query = '', source = 'cli', cursors = [] }) {
  const workspace = await access.authorizeContext({ ...context, workspaceName });
  const sourceKinds = source === 'all' ? ['cli', 'vscode', 'appServer'] : [source];
  const page = await listThreads(client, { workspaces: [workspace.workspacePath], sourceKinds, cursors, limit: 10 });
  const visible = await access.filterThreads({ ...context, workspaceName }, page.threads);
  const needle = query.trim().toLocaleLowerCase();
  const matched = visible.filter(thread => !needle || thread.title.toLocaleLowerCase().includes(needle));
  const candidateTokens = await Promise.all(matched.map(async thread =>
    (await access.issueCandidate({ ...context, workspaceName }, thread, { query })).token));
  let nextToken = null;
  if (page.nextCursors.length) nextToken = (await access.issueCursor({ ...context, workspaceName },
    { query, source, cursors: page.nextCursors })).token;
  return { threads: matched.slice(0, 25), candidateTokens: candidateTokens.slice(0, 25), nextToken };
}

export async function loadHistoryPreview({ client, access, context, workspaceName, token, query = '',
  turnCursor = null, turnId = null, itemCursor = null }) {
  const authorized = await access.resolveCandidate({ ...context, workspaceName }, { token, query,
    readMetadata: args => readThreadMetadata(client, args) });
  const metadata = await readThreadMetadata(client, { threadId: authorized.threadId,
    cwd: (await access.authorizeContext({ ...context, workspaceName })).workspacePath,
    sourceKinds: [authorized.source] });
  let turnPage = { turns: [], nextCursor: turnCursor };
  let turn = null;
  if (!turnId) {
    let cursor = turnCursor;
    const seen = new Set(cursor ? [cursor] : []);
    for (let pageNumber = 0; pageNumber < MAX_ANCHOR_TURN_PAGES; pageNumber++) {
      turnPage = await listTurns(client, { threadId: authorized.threadId, cursor, limit: 5 });
      turn = [...turnPage.turns].filter(value => value.status === 'completed')
        .sort((left, right) => (right.completedAt ?? right.startedAt ?? 0) - (left.completedAt ?? left.startedAt ?? 0))[0] ?? null;
      if (turn || !turnPage.nextCursor) break;
      if (seen.has(turnPage.nextCursor)) throw Object.assign(new Error('Thread history pagination unavailable'), { code: 'THREAD_PAGINATION_INVALID' });
      seen.add(turnPage.nextCursor);
      cursor = turnPage.nextCursor;
    }
  }
  const activeTurnId = turnId ?? turn?.id;
  const itemPage = activeTurnId ? await listItems(client, { threadId: authorized.threadId,
    turnId: activeTurnId, cursor: itemCursor, limit: 10 }) : { messages: [], nextCursor: null };
  return { metadata, turns: turn ? [turn] : [], turnId: activeTurnId, messages: itemPage.messages,
    nextItemCursor: itemPage.nextCursor, nextTurnCursor: turnPage.nextCursor,
    more: Boolean(itemPage.nextCursor) || Boolean(turnPage.nextCursor) };
}

/** Revalidate source ownership/activity and the exact preview anchor before a controlled fork. */
export async function validateHistoryForkSource({ client, access, context, workspaceName,
  sourceThreadId, source, lastCompletedTurnId, sourceUpdatedAt = null }) {
  if (typeof sourceThreadId !== 'string' || typeof source !== 'string'
      || typeof lastCompletedTurnId !== 'string') throw new TypeError('Fork source binding is invalid');
  const scopedContext = { ...context, workspaceName };
  const scope = await access.authorizeContext(scopedContext);
  const metadata = await readThreadMetadata(client, { threadId: sourceThreadId,
    cwd: scope.workspacePath, sourceKinds: [source] });
  await access.assertThreadReadable(scopedContext, metadata);
  if (Number.isFinite(sourceUpdatedAt) && metadata.updatedAt !== sourceUpdatedAt) {
    throw Object.assign(new Error('來源對話在預覽後已有更新；請重新預覽並選取最新內容。'), { code: 'HISTORY_SOURCE_STALE' });
  }
  if (metadata.runtimeStatus === 'active') {
    throw Object.assign(new Error('來源工作仍顯示為執行中；請先停止來源工作再重試。'), { code: 'HISTORY_SOURCE_ACTIVE' });
  }

  let cursor = null;
  const seen = new Set();
  const turns = [];
  for (let page = 0; page < MAX_ANCHOR_TURN_PAGES; page++) {
    const result = await listTurns(client, { threadId: sourceThreadId, cursor, limit: 5 });
    turns.push(...result.turns);
    if (turns.some(turn => turn.id === lastCompletedTurnId)) break;
    if (!result.nextCursor) break;
    if (seen.has(result.nextCursor)) throw Object.assign(new Error('Thread history pagination unavailable'), { code: 'THREAD_PAGINATION_INVALID' });
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
    if (page === MAX_ANCHOR_TURN_PAGES - 1) {
      throw Object.assign(new Error('來源歷史更新檢查超出安全頁數；請重新預覽後再試。'), { code: 'HISTORY_SOURCE_UNCERTAIN' });
    }
  }
  if (turns.some(turn => ['inProgress', 'running', 'active', 'pending'].includes(turn.status))) {
    throw Object.assign(new Error('來源仍有未完成回合；請先停止來源工作再重試。'), { code: 'HISTORY_SOURCE_ACTIVE' });
  }
  const anchor = turns.find(turn => turn.id === lastCompletedTurnId && turn.status === 'completed');
  if (!anchor) throw Object.assign(new Error('預覽錨點已不在可讀歷史中；請重新選取來源對話。'), { code: 'HISTORY_SOURCE_STALE' });
  if (!Number.isFinite(sourceUpdatedAt) && turns.some(turn => turn.id !== anchor.id
      && !Number.isFinite(turn.startedAt) && !Number.isFinite(turn.completedAt))) {
    throw Object.assign(new Error('來源歷史缺少足夠時間資料，無法證明預覽錨點仍是最新內容。'), { code: 'HISTORY_SOURCE_UNCERTAIN' });
  }
  const anchorTime = anchor.completedAt ?? anchor.startedAt ?? 0;
  const anchorIndex = turns.findIndex(turn => turn.id === anchor.id);
  const newer = turns.some((turn, index) => turn.id !== anchor.id
    && ((turn.startedAt ?? turn.completedAt ?? 0) > anchorTime
      || (index < anchorIndex && !turn.startedAt && !turn.completedAt)));
  if (newer) throw Object.assign(new Error('來源對話在預覽後已有新回合；請重新預覽並選取最新內容。'), { code: 'HISTORY_SOURCE_STALE' });
  return Object.freeze({ metadata, anchor });
}
