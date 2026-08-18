// Unit test for dsh-plugin-knowledge-base host half.
// Runs from the dsh profile context so the @deepseek-ai deps resolve.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readdir, stat, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import z from "@deepseek-ai/schemastery";
import * as kb from "dsh-plugin-knowledge-base";

const ok = (label) => console.log("ok -", label);

// tokenizeQuery: CJK bigrams + latin terms
{
	const tokens = kb.tokenizeQuery("如何配置 API 密钥?");
	const map = new Map(tokens);
	assert.equal(map.get("api"), 3);
	assert.ok(map.has("如何"), "cjk bigram");
	assert.ok(map.has("配置"), "cjk bigram");
	assert.ok(map.has("密钥"), "cjk bigram");
	ok("tokenizeQuery mixed CJK/latin");
}

// scoreText / countOccurrences
{
	assert.ok(kb.scoreText("the database is a database".toLowerCase(), kb.tokenizeQuery("database")) > 0);
	assert.equal(kb.scoreText("nothing here", kb.tokenizeQuery("database")), 0);
	ok("scoreText basic");
}

// paragraphsOf + bestExcerpt
{
	const text = "Intro line one.\n\nTarget paragraph with 配置说明 and more text to fill the window.\n\nTail.";
	const tokens = kb.tokenizeQuery("配置说明");
	const { excerpt, line } = kb.bestExcerpt(text, tokens, 40);
	assert.ok(excerpt.includes("配置"), "excerpt contains hit");
	assert.equal(line, 3, "paragraph 3 line number");
	ok("bestExcerpt paragraph select + line");
}

// normalizeConnections defensive + source fallback
{
	assert.equal(kb.normalizeConnections(undefined).length, 0);
	const list = kb.normalizeConnections({ connections: [
		{ path: "D:\\docs", kind: "weird" },
		{ path: "/a.md", kind: "file", enabled: false },
		{ path: "/b.md", kind: "file", source: "/orig/b.md" }
	] });
	assert.equal(list.length, 3);
	assert.equal(list[0].kind, "directory");
	assert.equal(list[0].source, "D:\\docs", "source falls back to path");
	assert.equal(list[1].enabled, false);
	assert.equal(list[2].source, "/orig/b.md", "explicit source kept");
	ok("normalizeConnections defensive + source");
}

// settings schema resolves a stored document and applies defaults
{
	const Settings = z.object({ connections: z.array(z.object({
		id: z.string(),
		source: z.string().default(""),
		path: z.string(),
		kind: z.string(),
		enabled: z.boolean().default(true)
	})).default([]) });
	const filled = Settings({ connections: [{ id: "a", path: "D:\\x", kind: "directory" }] });
	assert.equal(filled.connections[0].enabled, true);
	assert.equal(filled.connections[0].source, "");
	ok("settings schema defaults");
}

// Config defaults resolve
{
	const resolved = kb.Config({});
	for (const key of ["maxResults", "excerptChars", "maxFileBytes", "maxFilesPerConnection", "maxCacheBytes", "cacheTtlMs", "timeoutMs", "sectionOrder", "copyMaxFileBytes", "copyMaxFiles", "copyMaxTotalBytes"]) {
		assert.equal(typeof resolved[key], "number", `config ${key}`);
	}
	ok("Config defaults");
}

// dataDir: platform rule (home + dsh-kb-data)
{
	assert.equal(kb.dataDir(), path.join(homedir(), "dsh-kb-data"));
	ok("dataDir platform rule");
}

// sanitizeBase / storedFolderName
{
	assert.equal(kb.sanitizeBase("a<b:c?d|e"), "a_b_c_d_e");
	assert.equal(kb.sanitizeBase("con"), "_con");
	assert.equal(kb.sanitizeBase("trailing... "), "trailing");
	assert.equal(kb.sanitizeBase(""), "item");
	const folder = kb.storedFolderName("D:\\Docs\\笔记.md");
	assert.ok(/^.+-[0-9a-f]{8}$/.test(folder), "folder name shape");
	assert.ok(folder.includes("笔记"), "unicode basename kept");
	assert.notEqual(kb.storedFolderName("D:\\a\\x"), kb.storedFolderName("D:\\b\\x"), "hash separates same basenames");
	assert.equal(kb.storedFolderName("D:\\A\\X").toLowerCase(), kb.storedFolderName("d:\\a\\x").toLowerCase(), "case-insensitive stable target");
	ok("sanitizeBase + storedFolderName");
}

// removableFolder safety
{
	assert.equal(kb.removableFolder(path.join(kb.dataDir(), "x-12345678"), "directory"), path.resolve(path.join(kb.dataDir(), "x-12345678")));
	assert.equal(kb.removableFolder(path.join(kb.dataDir(), "x-12345678", "f.md"), "file"), path.resolve(path.join(kb.dataDir(), "x-12345678")));
	assert.equal(kb.removableFolder("D:\\Windows\\System32", "directory"), undefined);
	assert.equal(kb.removableFolder(path.join(kb.dataDir(), "nested", "deeper"), "directory"), undefined);
	ok("removableFolder guards");
}

// pickCommand: platform command shape (no dialog is opened by this builder)
{
	const command = kb.pickCommand("file");
	assert.ok(typeof command.cmd === "string" && Array.isArray(command.args) && command.args.length > 0);
	if (process.platform === "win32") {
		assert.equal(command.cmd, "powershell.exe");
		assert.ok(command.args.some((arg) => typeof arg === "string" && arg.includes("OpenFileDialog")), "win32 file dialog script");
		assert.ok(command.args.includes("-STA"), "STA required for WinForms");
		const scriptText = command.args.join(" ");
		assert.ok(scriptText.includes("TopMost"), "invisible TopMost owner keeps the dialog on top");
		assert.ok(scriptText.includes("ShowDialog($o)"), "dialog shown with the owner");
		const folder = kb.pickCommand("directory");
		assert.ok(folder.args.some((arg) => typeof arg === "string" && arg.includes("FolderBrowserDialog")), "win32 folder dialog script");
		assert.ok(folder.args.join(" ").includes("TopMost"), "folder dialog also topmost");
	}
	assert.equal(typeof kb.pickNative, "function");
	ok("pickCommand platform shape");
}

// connectSource + removeStored round trip into the real data dir
{
	const config = kb.Config({});
	const root = await mkdtemp(path.join(tmpdir(), "dskb-c-"));
	await writeFile(path.join(root, "note.md"), "# Note\n\n数据库配置说明。");
	await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
	await writeFile(path.join(root, "node_modules", "pkg", "junk.txt"), "database junk");
	const single = path.join(root, "note.md");

	const fileItem = await kb.connectSource(config, single);
	assert.equal(fileItem.error, undefined, "file connect ok");
	assert.equal(fileItem.kind, "file");
	assert.equal((await stat(fileItem.stored)).size, (await stat(single)).size, "file copied byte-identical");
	const firstFolder = path.dirname(fileItem.stored);

	const dirItem = await kb.connectSource(config, root);
	assert.equal(dirItem.error, undefined, "dir connect ok");
	assert.equal(dirItem.kind, "directory");
	const copied = await readdir(dirItem.stored);
	assert.ok(copied.includes("note.md"), "dir content copied");
	assert.ok(!copied.includes("node_modules"), "node_modules not copied");

	// re-connect replaces (same folder) instead of duplicating
	await writeFile(single, "# Note v2\n\n数据库配置说明 v2。");
	const again = await kb.connectSource(config, single);
	assert.equal(again.error, undefined);
	assert.equal(again.replaced, true, "second connect reports replaced");
	assert.equal(path.dirname(again.stored), firstFolder, "same managed folder");
	assert.ok((await readFile(again.stored, "utf8")).includes("v2"), "copy refreshed");

	// oversized single file is refused
	const big = path.join(root, "big.bin");
	await writeFile(big, "x");
	const bigItem = await kb.connectSource({ ...config, copyMaxFileBytes: 0 }, big);
	assert.ok(bigItem.error !== undefined, "oversized file refused");

	// remove deletes the managed folder only
	const removed = await kb.removeStored(again.stored, "file");
	assert.deepEqual(removed, { ok: true, deleted: true });
	await assert.rejects(stat(firstFolder));
	const outside = await kb.removeStored(path.join(root, "note.md"), "file");
	assert.deepEqual(outside, { ok: true, deleted: false }, "non-managed path is a no-op ok");
	ok("connectSource + removeStored round trip");
}

// KbIndexCache over a temp KB directory (with noise that must be skipped)
{
	const root = await mkdtemp(path.join(tmpdir(), "dskb-"));
	await writeFile(path.join(root, "guide.md"), "# Guide\n\n数据库配置说明在 config.yaml。\nUse DATABASE_URL.\n\nOther paragraph about nothing.");
	await writeFile(path.join(root, "config.yaml"), "database:\n  url: postgres://db\n");
	await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
	await writeFile(path.join(root, "node_modules", "pkg", "database.txt"), "database database database");
	await mkdir(path.join(root, ".git"), { recursive: true });
	await writeFile(path.join(root, ".git", "database.txt"), "skip me");
	await writeFile(path.join(root, "image.png"), "PNGDATA");
	const cache = new kb.KbIndexCache(kb.Config({}));
	const record = await cache.entry({ id: "t", source: root, path: root, kind: "directory", enabled: true }, new AbortController().signal);
	const paths = record.files.map((file) => file.path);
	assert.ok(paths.some((p) => p.endsWith("guide.md")), "guide indexed");
	assert.ok(paths.some((p) => p.endsWith("config.yaml")), "config indexed");
	assert.ok(!paths.some((p) => p.includes("node_modules")), "node_modules skipped");
	assert.ok(!paths.some((p) => p.includes(".git")), "hidden dir skipped");
	assert.ok(!paths.some((p) => p.endsWith("image.png")), "binary skipped");
	const tokens = kb.tokenizeQuery("数据库 配置 database");
	const ranked = [];
	for (const file of record.files) {
		const score = kb.scoreText(file.text.toLowerCase(), tokens);
		if (score > 0) ranked.push({ file, score });
	}
	ranked.sort((a, b) => b.score - a.score);
	assert.ok(ranked.length >= 2, "both docs matched");
	assert.ok(ranked[0].file.path.endsWith("guide.md"), "guide ranks first");
	cache.invalidate("directory", root);
	const missing = await cache.entry({ id: "m", source: "nope", path: path.join(root, "nope"), kind: "directory", enabled: true }, new AbortController().signal);
	assert.equal(missing.files.length, 0);
	assert.ok(missing.error !== undefined, "missing dir reports error");
	ok("KbIndexCache walk + search + invalidate + missing path");
}

console.log("ALL PASS");
