import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, symlink, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discordOutputImages, discordOutputAttachments, withoutLocalFileLinks } from "../src/output-images.mjs";
import { completedTaskPayload, statusChunks } from "../src/bot.mjs";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JAR_HEADER = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26)]);

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "codex-discord-attachments-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  try { await run({ root, workspace }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("final JAR links become Discord files, with image support and deduplication", async () => fixture(async ({ workspace }) => {
  const jar = path.join(workspace, "test build.JAR");
  const image = path.join(workspace, "screenshot.png");
  await writeFile(jar, JAR_HEADER);
  await writeFile(image, PNG_HEADER);
  const payload = await completedTaskPayload({
    message: `[JAR](<${jar}>)\n[again](<${jar}>)\n![preview](${image})`
  }, workspace);
  assert.equal(payload.warning, "");
  assert.deepEqual(payload.files.map(file => file.name), ["test build.JAR", "screenshot.png"]);
  const edits = [];
  assert.equal(await statusChunks({ edit: async value => {
    edits.push(value);
    return { attachments: new Map(payload.files.map((file, i) => [String(i), {
      id: String(i), name: file.name, size: 30, url: `https://cdn.discordapp.com/attachments/1/2/${i}`
    }])) };
  }, channel: { send: async () => {} } }, `Test build [JAR](<${jar}>)`, payload.files), true);
  assert.deepEqual(edits[0].files, payload.files);
  assert.deepEqual(edits[0].allowedMentions, { parse: [] });
  assert.match(edits[1].content, /附件已由 Discord 確認/);
  assert.ok(!edits[1].content.includes(workspace));
  assert.equal(edits[1].attachments, undefined);
}));

test("JAR output rejects outside paths, escaping symlinks, false formats and missing files with a warning", async () => fixture(async ({ root, workspace }) => {
  const outside = path.join(root, "outside.jar");
  await writeFile(outside, JAR_HEADER);
  await symlink(outside, path.join(workspace, "escape.jar"));
  await writeFile(path.join(workspace, "fake.jar"), "not an archive");
  await mkdir(path.join(workspace, "directory.jar"));
  const candidates = [outside, ...["escape.jar", "fake.jar", "directory.jar", "missing.jar"].map(name => path.join(workspace, name))];
  const payload = await completedTaskPayload({ message: candidates.map(file => `[file](${file})`).join("\n") }, workspace);
  assert.deepEqual(payload.files, []);
  assert.match(payload.warning, /5 個附件/);
  assert.ok(!payload.warning.includes(root));
}));

test("generated image provenance never grants temporary JAR uploads", async () => fixture(async ({ root, workspace }) => {
  const temporary = path.join(root, "temporary.jar");
  const local = path.join(workspace, "local.jar");
  await writeFile(temporary, JAR_HEADER);
  await writeFile(local, JAR_HEADER);
  const result = await discordOutputAttachments({ workspace, generatedPaths: [temporary, local] });
  assert.deepEqual(result.files, []);
  assert.equal(result.skipped, 2);
  assert.ok(result.issues.every(issue => issue.reason === "格式檢查失敗或來源不允許"));
}));

test("bare paths, remote links and arbitrary file types are not auto-uploaded", async () => fixture(async ({ workspace }) => {
  const jar = path.join(workspace, "test.jar");
  const secret = path.join(workspace, "credentials.txt");
  await writeFile(jar, JAR_HEADER);
  await writeFile(secret, "private fixture");
  const result = await discordOutputAttachments({ workspace,
    message: `${jar}\n[remote](https://example.com/test.jar)\n[text](${secret})`
  });
  assert.deepEqual(result.files, []);
  assert.equal(result.skipped, 2);
  assert.match(result.issues[0].reason, /不支援/);
  assert.match(result.issues[1].reason, /僅有本機路徑/);
}));

test("unusable local attachment links and paths are replaced, not external download links", () => {
  const text = withoutLocalFileLinks("[jar](</workspace/a b.jar>) ![image](/tmp/test.png) `/tmp/file.zip`\n/tmp/other.pdf\n[web](https://example.com/download.jar)");
  assert.ok(!text.includes("/workspace/"));
  assert.ok(!text.includes("/tmp/"));
  assert.match(text, /a b.jar/);
  assert.match(text, /https:\/\/example.com\/download.jar/);
});

test("output count and combined byte budgets remain bounded", async () => fixture(async ({ workspace }) => {
  const files = Array.from({ length: 5 }, (_, i) => path.join(workspace, `${i}.jar`));
  for (const file of files) await writeFile(file, JAR_HEADER);
  const message = files.map(file => `[file](${file})`).join("\n");
  const count = await discordOutputAttachments({ workspace, message });
  assert.equal(count.files.length, 4);
  assert.equal(count.skipped, 1);
  await truncate(files[0], 26 * 1024 * 1024);
  await truncate(files[1], 13 * 1024 * 1024);
  await truncate(files[2], 13 * 1024 * 1024);
  const bytes = await discordOutputAttachments({ workspace, message });
  assert.deepEqual(bytes.files.map(file => file.name), ["1.jar", "3.jar", "4.jar"]);
  assert.equal(bytes.skipped, 2);
}));

test("Codex output images upload only validated files inside the selected workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-discord-images-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside.png");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "screenshot.png"), PNG_HEADER);
  await writeFile(path.join(workspace, "fake.png"), "not an image");
  await writeFile(outside, PNG_HEADER);
  await symlink(outside, path.join(workspace, "escape.png"));

  try {
    const result = await discordOutputImages({
      workspace,
      generatedPaths: [],
      message: [
        `[valid](${path.join(workspace, "screenshot.png")})`,
        `[wrong bytes](${path.join(workspace, "fake.png")})`,
        `[outside](${outside})`,
        `[symlink escape](${path.join(workspace, "escape.png")})`
      ].join("\n")
    });

    assert.deepEqual(result.files, [{
      attachment: path.join(workspace, "screenshot.png"),
      name: "screenshot.png"
    }]);
    assert.equal(result.skipped, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authoritative image-generation results may upload from temporary storage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-discord-generated-"));
  const workspace = path.join(root, "workspace");
  const generated = path.join(root, "generated.webp");
  await mkdir(workspace);
  await writeFile(generated, Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x04, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii")
  ]));

  try {
    const result = await discordOutputImages({ generatedPaths: [generated], workspace });
    assert.deepEqual(result.files, [{ attachment: generated, name: "generated.webp" }]);
    assert.equal(result.skipped, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
