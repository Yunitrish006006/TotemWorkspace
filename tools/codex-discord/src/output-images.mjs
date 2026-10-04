import path from "node:path";
import { open, realpath, stat } from "node:fs/promises";

const MAX_OUTPUT_FILES = 4;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const LOCAL_FILE_LINK = /!?\[[^\]\n]*\]\(\s*<?(\/[^)\n>]+?\.(?:png|jpe?g|webp|gif|jar))>?\s*\)/gi;
const OTHER_FILE_LINK = /!?\[[^\]\n]*\]\(\s*<?(\/[^)\n>]+?\.[a-z0-9]{1,16})>?\s*\)/gi;
const INLINE_FILE = /`(\/[^`\n]+?\.(?:png|jpe?g|webp|gif|jar|zip|pdf|txt|csv|json|log))`/gi;
const BARE_FILE = /(^|\s)(\/[^\s<>`"']+?\.(?:png|jpe?g|webp|gif|jar|zip|pdf|txt|csv|json|log))(?=$|[\s),;。])/gi;

export function outputFileName(filePath) {
  return path.basename(String(filePath)).replace(/[\x00-\x1f\x7f`*_~|<>\[\]@]/g, "_").slice(0, 100);
}

/** Local filesystem links are never downloadable Discord links. */
export function withoutLocalFileLinks(message) {
  return String(message ?? "")
    .replace(OTHER_FILE_LINK, (_, file) => `檔案「${outputFileName(file)}」`)
    .replace(INLINE_FILE, (_, file) => `檔案「${outputFileName(file)}」`)
    .replace(BARE_FILE, (_, prefix, file) => `${prefix}檔案「${outputFileName(file)}」`);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function linkedFilePaths(message) {
  if (typeof message !== "string" || !message) return [];
  return [...message.matchAll(LOCAL_FILE_LINK)].map((match) => match[1]);
}

function unhandledReferences(message) {
  const issues = [];
  // Do not silently turn unsupported local links or bare paths into delivery.
  let remaining = String(message ?? "").replace(LOCAL_FILE_LINK, "");
  remaining = remaining.replace(OTHER_FILE_LINK, (_, file) => {
    issues.push({ name: outputFileName(file), reason: "不支援的附件格式" });
    return "";
  });
  remaining = remaining.replace(INLINE_FILE, (_, file) => {
    issues.push({ name: outputFileName(file), reason: "僅有本機路徑，需明確的附件 Markdown 連結" });
    return "";
  });
  remaining.replace(BARE_FILE, (_, prefix, file) => {
    issues.push({ name: outputFileName(file), reason: "僅有本機路徑，需明確的附件 Markdown 連結" });
    return prefix;
  });
  return issues;
}

async function detectedFileType(filePath) {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
    if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return ".jpg";
    if (bytesRead >= 6 && (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a")) return ".gif";
    if (bytesRead >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
    // JARs are ZIP containers. This is a format/signature check, not archive
    // integrity, malware scanning, or permission to execute/extract the file.
    if (bytesRead >= 4 && header.readUInt32LE(0) === 0x04034b50) return ".jar";
    return null;
  } finally {
    await handle.close();
  }
}

function extensionMatches(filePath, detectedType) {
  const extension = path.extname(filePath).toLocaleLowerCase();
  return extension === detectedType || (detectedType === ".jpg" && extension === ".jpeg");
}

/**
 * Resolves explicit output image/JAR links into Discord.js attachments.
 * Generated-image events may use /tmp; paths merely mentioned in prose must
 * stay inside the selected allow-listed workspace.
 */
export async function discordOutputAttachments({ generatedPaths = [], message = "", workspace }) {
  const issues = unhandledReferences(message);
  const reject = (file, reason) => issues.push({ name: outputFileName(file), reason });
  const candidates = [
    ...generatedPaths.map((filePath) => ({ filePath, generated: true })),
    ...linkedFilePaths(message).map((filePath) => ({ filePath, generated: false }))
  ];
  let workspaceRoot;
  let temporaryRoot;
  try {
    workspaceRoot = await realpath(workspace);
    temporaryRoot = await realpath("/tmp");
  } catch {
    for (const candidate of candidates) reject(candidate.filePath, "無法確認允許的工作區");
    return { files: [], skipped: issues.length, issues };
  }

  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (typeof candidate.filePath !== "string" || !path.isAbsolute(candidate.filePath)) {
      reject(candidate.filePath, "無效的附件路徑");
      continue;
    }
    try {
      const resolved = await realpath(candidate.filePath);
      if (seen.has(resolved)) continue;
      if (files.length >= MAX_OUTPUT_FILES) {
        reject(candidate.filePath, "超過附件數量限制");
        continue;
      }
      const allowed = isWithin(workspaceRoot, resolved)
        || (candidate.generated && isWithin(temporaryRoot, resolved));
      if (!allowed) {
        reject(candidate.filePath, "不在目前允許的工作區");
        continue;
      }
      const metadata = await stat(resolved);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_OUTPUT_BYTES
          || totalBytes + metadata.size > MAX_OUTPUT_BYTES) {
        reject(candidate.filePath, "檔案為空、不是一般檔案或超過大小限制");
        continue;
      }
      const detectedType = await detectedFileType(resolved);
      if (!detectedType || !extensionMatches(resolved, detectedType)
          || (candidate.generated && detectedType === ".jar")) {
        reject(candidate.filePath, "格式檢查失敗或來源不允許");
        continue;
      }
      seen.add(resolved);
      totalBytes += metadata.size;
      files.push({ attachment: resolved, name: path.basename(resolved) });
    } catch {
      reject(candidate.filePath, "檔案不存在或無法讀取");
    }
  }
  return { files, skipped: issues.length, issues };
}

// Retained for existing callers; the final-reply path uses the general name.
export const discordOutputImages = discordOutputAttachments;
