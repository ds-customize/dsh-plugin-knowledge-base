//#region knowledge-base host plugin
/**
 * dsh-plugin-knowledge-base — host half.
 *
 * Owns four host-plane contributions:
 *
 * 1. The `knowledge-base` settings namespace (persisted in
 *    `$DSH_HOME/settings.yaml`, hot-reloaded, editable from the browser
 *    through the settings RPC): the ordered connection list
 *    `connections: [{ id, source, path, kind, enabled }]` where `source` is
 *    the user-picked original path and `path` is the managed copy under the
 *    platform data directory (see {@link dataDir}).
 * 2. A `/kb` HTTP prefix on the webserver — loopback-only JSON endpoints the
 *    composer's "connect local files" buttons drive:
 *    `pick` (open the HOST's native Explorer chooser — files or folders),
 *    `connect` (copy picked files/directories into the data dir), `remove`
 *    (delete one managed copy).
 * 3. A global system-prompt section that lists the ENABLED connections and
 *    instructs the model to ground every answer in the knowledge base via
 *    the tool below. An empty section (nothing enabled) is dropped from the
 *    rendered prompt, so a dormant plugin costs nothing.
 * 4. The `knowledge_base` model tool: lexical full-text search over the
 *    enabled connections' managed copies with an in-memory TTL cache,
 *    returning ranked excerpts with file paths and line numbers.
 */
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { promises as fsp } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

/** Cordis plugin name used by loader diagnostics. */
const name = "knowledge-base";

/** Host services required before activation (webServer: the /kb route). */
const inject = ["tools", "systemPrompt", "settings", "webServer"];

/** The settings namespace this plugin owns (kebab-case, like plugin short names). */
const NS = settingsNamespace("knowledge-base");

/** One knowledge-base connection as stored in the settings document. */
const ConnectionConfig = z.object({
	id: z.string().description("stable client-generated identity"),
	source: z.string().default("").description("absolute original path the user picked"),
	path: z.string().description("absolute path of the managed copy that retrieval indexes"),
	kind: z.string().description("'directory' or 'file'"),
	enabled: z.boolean().default(true).description("whether retrieval consults this connection")
});

/** Plugin config (composition-entry tunables; every field defaulted). */
const Config = z.object({
	/** Max matched excerpts returned by one search. */
	maxResults: z.number().default(6),
	/** Characters per returned excerpt. */
	excerptChars: z.number().default(480),
	/** Files larger than this are skipped while indexing. */
	maxFileBytes: z.number().default(524288),
	/** Per-connection cap on indexed files (walk stops beyond it). */
	maxFilesPerConnection: z.number().default(4000),
	/** Total cached text bytes across connections before eviction. */
	maxCacheBytes: z.number().default(33554432),
	/** A connection index older than this is rebuilt on next use. */
	cacheTtlMs: z.number().default(120000),
	/** Cooperative tool-call budget forwarded to the timeout policy. */
	timeoutMs: z.number().default(120000),
	/** Prompt-section order (tool guidance convention: 100-199). */
	sectionOrder: z.number().default(120),
	/** Per-file cap while copying a picked source into the data dir. */
	copyMaxFileBytes: z.number().default(33554432),
	/** Per-directory cap on copied files. */
	copyMaxFiles: z.number().default(4000),
	/** Per-source cap on total copied bytes. */
	copyMaxTotalBytes: z.number().default(1073741824)
});

/** Directory names never descended into (indexing AND copying). */
const SKIP_DIRS = new Set([
	"node_modules", ".git", ".hg", ".svn", ".turbo", ".next", ".nuxt", ".output",
	"dist", "build", "out", "coverage", ".cache", ".parcel-cache", ".yarn",
	"venv", ".venv", "__pycache__", ".idea", ".vscode", "target", ".gradle",
	".pytest_cache", ".mypy_cache", ".ruff_cache"
]);

/** Extensions never read as text. */
const BINARY_EXT = new Set([
	".exe", ".dll", ".so", ".dylib", ".a", ".lib", ".obj", ".o", ".bin",
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tif", ".tiff",
	".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tar",
	".jar", ".class", ".war", ".wasm", ".vsix", ".crx",
	".woff", ".woff2", ".ttf", ".otf", ".eot",
	".mp3", ".mp4", ".avi", ".mkv", ".mov", ".flv", ".wmv",
	".sqlite", ".sqlite3", ".db", ".mdb", ".accdb",
	".pyc", ".pyo", ".ipdb", ".pdb", ".idb", ".ncb", ".suo"
]);

/** Directory walk depth bound (defensive; the file-count cap does the real work). */
const MAX_DEPTH = 16;

/** Managed data directory name. */
const DATA_DIR_NAME = "dsh-kb-data";

/**
 * Custom backup directory configured through the settings namespace (empty
 * string = use the default under the user's home). Module-level state kept
 * fresh by every settings read in {@link apply}; the relocate endpoint also
 * assigns it directly after a successful move.
 */
let customDataDir = "";

/**
 * The managed data directory that stores copies of connected sources.
 * Defaults to `%USERPROFILE%\\dsh-kb-data` (Windows) / `~/dsh-kb-data`
 * (Linux, macOS); when the user relocated the backup through the panel,
 * the configured custom directory wins.
 *
 * @returns the absolute data directory path (created on demand by callers).
 */
function dataDir() {
	const custom = customDataDir.trim();
	return custom !== "" ? path.resolve(custom) : path.join(homedir(), DATA_DIR_NAME);
}

/**
 * Sanitize one path segment into a safe folder-name fragment: strip
 * filesystem-illegal characters, Windows reserved device names, and trailing
 * dots/spaces; cap the length.
 *
 * @param input - the raw basename of a picked source.
 * @returns a safe fragment (never empty).
 */
function sanitizeBase(input) {
	let base = String(input ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0, 60);
	if (base === "") base = "item";
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `_${base}`;
	return base;
}

/**
 * The managed per-source folder name: sanitized basename plus a short hash of
 * the normalized source path, so two same-named sources never collide and
 * re-connecting the same source lands on the same folder (refresh semantics).
 *
 * @param source - the picked absolute source path.
 * @returns the folder name under the data dir.
 */
function storedFolderName(source) {
	const normalized = String(source).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 8);
	const base = String(source).replace(/[\\/]+$/, "");
	return `${sanitizeBase(path.basename(base))}-${hash}`;
}

/**
 * Whether `stored` is a managed path this plugin may delete: it (or, for a
 * file connection, its parent folder) must be a DIRECT child of the data dir.
 *
 * @param stored - the connection's stored path.
 * @param kind - the connection kind ('file' or 'directory').
 * @returns the folder to delete, or undefined when the path is not managed.
 */
function removableFolder(stored, kind) {
	const root = path.resolve(dataDir());
	const target = path.resolve(String(stored ?? ""));
	const folder = kind === "file" ? path.dirname(target) : target;
	if (path.dirname(folder) !== root) return undefined;
	if (!folder.startsWith(root + path.sep)) return undefined;
	return folder;
}

/**
 * Whether one character belongs to a script that writes without spaces.
 * Such query runs are additionally decomposed into bigrams so a long Chinese
 * phrase still scores documents that contain only part of it.
 */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Split a query into weighted lowercase search terms.
 *
 * Alphanumeric terms keep their weight by length; CJK runs contribute their
 * bigrams plus the full run. Terms are deduplicated keeping the max weight.
 *
 * @param query - the model-provided search text.
 * @returns unique `[term, weight]` pairs.
 */
function tokenizeQuery(query) {
	const raw = String(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 0);
	const tokens = new Map();
	const add = (term, weight) => {
		tokens.set(term, Math.max(tokens.get(term) ?? 0, weight));
	};
	for (const term of raw.slice(0, 32)) {
		if (CJK_RUN.test(term)) {
			if (term.length <= 2) {
				add(term, term.length === 2 ? 2 : 1);
			} else {
				for (let i = 0; i + 2 <= term.length; i += 1) add(term.slice(i, i + 2), 1.5);
				add(term, Math.min(4, term.length / 2));
			}
		} else {
			add(term, term.length >= 3 ? 3 : 2);
		}
	}
	return [...tokens.entries()];
}

/**
 * Count non-overlapping occurrences of `needle` in `hay`, bounded so a huge
 * file cannot make one term dominate the run.
 *
 * @param hay - lowercased haystack.
 * @param needle - lowercased needle.
 * @param cap - inclusive count ceiling.
 * @returns the bounded occurrence count.
 */
function countOccurrences(hay, needle, cap = 64) {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = 0;
	while (count < cap) {
		const found = hay.indexOf(needle, index);
		if (found === -1) return count;
		count += 1;
		index = found + needle.length;
	}
	return count;
}

/**
 * Lexical relevance of one lowercased text to the query terms.
 *
 * @param lowerText - the file or paragraph text, lowercased.
 * @param tokens - `tokenizeQuery` output.
 * @returns the additive score; 0 when nothing matches.
 */
function scoreText(lowerText, tokens) {
	let score = 0;
	for (const [term, weight] of tokens) {
		const count = countOccurrences(lowerText, term);
		if (count > 0) score += Math.min(count, 8) * weight;
	}
	return score;
}

/**
 * Tolerant reader over the settings value: accepts anything the settings
 * service resolved and answers the well-formed connection subset.
 *
 * @param value - the resolved namespace value (trusted shape, but defensive
 *   anyway — an externally edited document may predate the schema).
 * @returns the connections array (possibly empty); entries with a blank path
 *   or an unknown kind are dropped.
 */
function normalizeConnections(value) {
	if (typeof value !== "object" || value === null) return [];
	const list = Array.isArray(value.connections) ? value.connections : [];
	const connections = [];
	for (const entry of list) {
		if (typeof entry !== "object" || entry === null) continue;
		const pathValue = typeof entry.path === "string" ? entry.path.trim() : "";
		if (pathValue === "") continue;
		const kind = entry.kind === "file" ? "file" : "directory";
		const source = typeof entry.source === "string" && entry.source.trim() !== "" ? entry.source.trim() : pathValue;
		connections.push({
			id: typeof entry.id === "string" && entry.id !== "" ? entry.id : `${kind}:${pathValue}`,
			source,
			path: pathValue,
			kind,
			enabled: entry.enabled !== false
		});
	}
	return connections;
}

/**
 * Split text into paragraphs while recording each paragraph's absolute offset
 * (needed to translate a paragraph window back to a line number).
 *
 * @param text - the full file text.
 * @returns `[{ text, offset }]` for every paragraph, in order.
 */
function paragraphsOf(text) {
	const parts = [];
	const pattern = /\n{2,}/g;
	let offset = 0;
	let match;
	while ((match = pattern.exec(text)) !== null) {
		parts.push({ text: text.slice(offset, match.index), offset });
		offset = pattern.lastIndex;
	}
	parts.push({ text: text.slice(offset), offset });
	return parts.filter((part) => part.text.trim().length > 0);
}

/**
 * The best excerpt window for one matched file: the highest-scoring
 * paragraph, centered on its first strong term when it exceeds the budget.
 *
 * @param text - the full file text.
 * @param tokens - query terms.
 * @param excerptChars - window budget.
 * @returns `{ excerpt, line }` (1-based line of the window start).
 */
function bestExcerpt(text, tokens, excerptChars) {
	const hit = paragraphsOf(text).map((part) => ({ ...part, score: scoreText(part.text.toLowerCase(), tokens) })).filter((part) => part.score > 0).sort((a, b) => b.score - a.score)[0];
	const anchor = hit ?? { text: text.slice(0, excerptChars), offset: 0 };
	let start = anchor.offset;
	let end = anchor.offset + anchor.text.length;
	if (end - start > excerptChars) {
		const lowerAnchor = anchor.text.toLowerCase();
		let first = -1;
		for (const [term] of tokens) {
			const found = lowerAnchor.indexOf(term);
			if (found !== -1 && (first === -1 || found < first)) first = found;
		}
		const relative = first === -1 ? 0 : Math.max(0, first - Math.floor(excerptChars / 3));
		start = anchor.offset + Math.min(relative, Math.max(0, anchor.text.length - excerptChars));
		end = start + excerptChars;
	}
	const excerpt = text.slice(start, end).trim();
	let line = 1;
	for (let i = 0; i < start; i += 1) if (text.charCodeAt(i) === 10) line += 1;
	return { excerpt, line };
}

/**
 * The per-process connection index cache. Entries carry their built files and
 * a build stamp; TTL governs staleness and a byte budget governs memory, with
 * least-recently-built entries evicted first.
 */
class KbIndexCache {
	/** config.maxCacheBytes */
	#maxBytes;
	/** config.cacheTtlMs */
	#ttlMs;
	/** config.maxFileBytes */
	#maxFileBytes;
	/** config.maxFilesPerConnection */
	#maxFiles;
	/** connection key -> index record */
	#entries = new Map();

	/**
	 * @param config - the resolved plugin config.
	 */
	constructor(config) {
		this.#maxBytes = config.maxCacheBytes;
		this.#ttlMs = config.cacheTtlMs;
		this.#maxFileBytes = config.maxFileBytes;
		this.#maxFiles = config.maxFilesPerConnection;
	}

	/**
	 * Read one connection's file set, rebuilding the index when absent or
	 * stale. Filesystem failures degrade to an empty set plus the error text
	 * (surfaced to the model as a notice) instead of failing the tool call.
	 *
	 * @param connection - one enabled connection.
	 * @param signal - cooperative cancellation from the tool call.
	 * @returns the connection's index record.
	 */
	async entry(connection, signal) {
		const key = `${connection.kind}:${connection.path}`;
		const cached = this.#entries.get(key);
		if (cached !== undefined && Date.now() - cached.at <= this.#ttlMs) return cached;
		const record = await this.#build(connection, signal);
		this.#entries.set(key, record);
		this.#evict();
		return record;
	}

	/**
	 * Drop one connection's index (called after its managed copy changed
	 * through connect/remove so the next search sees fresh bytes at once).
	 *
	 * @param kind - the connection kind.
	 * @param storedPath - the connection's stored path.
	 */
	invalidate(kind, storedPath) {
		this.#entries.delete(`${kind}:${storedPath}`);
	}

	/**
	 * Drop every cached index (called after the backup directory moved, so
	 * the next search rebuilds from the new locations at once).
	 */
	clear() {
		this.#entries.clear();
	}

	/**
	 * Walk and read one connection. Directories are traversed breadth-first
	 * with the skip/binary/size rules; a single file is stat-checked and read
	 * directly.
	 *
	 * @param connection - the connection to index.
	 * @param signal - aborts the walk between entries.
	 * @returns the built record (possibly `error`-carrying).
	 */
	async #build(connection, signal) {
		const record = { at: Date.now(), files: [], truncated: false, error: undefined };
		try {
			if (connection.kind === "file") {
				const file = await this.#readFile(connection.path);
				if (file !== undefined) record.files.push(file);
				return record;
			}
			const queue = [{ dir: connection.path, depth: 0 }];
			while (queue.length > 0 && record.files.length < this.#maxFiles) {
				if (signal.aborted) return record;
				const { dir, depth } = queue.shift();
				const children = await fsp.readdir(dir, { withFileTypes: true });
				for (const child of children) {
					if (record.files.length >= this.#maxFiles) {
						record.truncated = true;
						break;
					}
					const childPath = path.join(dir, child.name);
					if (child.isDirectory()) {
						if (child.isSymbolicLink()) continue;
						if (depth >= MAX_DEPTH) continue;
						if (child.name.startsWith(".") || SKIP_DIRS.has(child.name)) continue;
						queue.push({ dir: childPath, depth: depth + 1 });
					} else if (child.isFile() && !child.isSymbolicLink()) {
						if (child.name.startsWith(".")) continue;
						if (BINARY_EXT.has(path.extname(child.name).toLowerCase())) continue;
						const file = await this.#readFile(childPath);
						if (file !== undefined) record.files.push(file);
					}
				}
			}
			if (queue.length > 0) record.truncated = true;
		} catch (error) {
			record.error = error.code === "ENOENT" ? "path not found" : error.code === "EACCES" || error.code === "EPERM" ? "permission denied" : String(error.message ?? error);
		}
		return record;
	}

	/**
	 * Stat-check and read one file as UTF-8 text under the size bound.
	 * Binary-looking content (NUL byte) and oversized files read as skipped.
	 *
	 * @param file - absolute file path.
	 * @returns the indexed file, or undefined when skipped.
	 */
	async #readFile(file) {
		const stat = await fsp.stat(file);
		if (!stat.isFile() || stat.size > this.#maxFileBytes) return undefined;
		const text = await fsp.readFile(file, "utf8");
		if (text.includes("\u0000")) return undefined;
		return { path: file, text };
	}

	/**
	 * Drop least-recently-built entries until the byte budget holds.
	 */
	#evict() {
		let total = 0;
		for (const record of this.#entries.values()) total += record.bytes ?? 0;
		if (total <= this.#maxBytes) return;
		const ordered = [...this.#entries.entries()].sort((left, right) => left[1].at - right[1].at);
		for (const [key, record] of ordered) {
			if (total <= this.#maxBytes) break;
			total -= record.bytes ?? 0;
			this.#entries.delete(key);
		}
	}
}

/** How long the native chooser may stay open before its helper is killed. */
const PICK_TIMEOUT_MS = 600000;

/**
 * Build the host platform's native-chooser command for one pick kind:
 * Windows PowerShell WinForms dialogs (Explorer-style), macOS `osascript`,
 * Linux `zenity`. Throws on unsupported platforms.
 *
 * The Windows dialogs are shown with a SHOWN-but-minimized TopMost owner
 * form (no taskbar button). An owned window renders above its owner, and a
 * topmost owner keeps the dialog in the topmost band, so the chooser comes
 * to the front instead of sinking behind the browser. The owner must be
 * really shown: a never-shown form's handle produces an INVISIBLE dialog in
 * some window stations, which is worse than the original behind-the-window
 * placement.
 *
 * @param kind - 'file' (multi-select) or 'directory'.
 * @returns the `{ cmd, args }` spawn specification.
 */
function pickCommand(kind) {
	if (process.platform === "win32") {
		const owner = "$o = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized'}; [void]$o.Show()";
		const script = kind === "directory" ? `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; ${owner}; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.ShowNewFolderButton = $false; $r = $d.ShowDialog($o); $o.Close(); if ($r -eq [System.Windows.Forms.DialogResult]::OK) { ConvertTo-Json -Compress -InputObject @($d.SelectedPath) } else { '[]' }` : `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; ${owner}; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; $d.CheckFileExists = $true; $d.Filter = 'All files (*.*)|*.*'; $r = $d.ShowDialog($o); $o.Close(); if ($r -eq [System.Windows.Forms.DialogResult]::OK) { ConvertTo-Json -Compress -InputObject @($d.FileNames) } else { '[]' }`;
		return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script] };
	}
	if (process.platform === "darwin") {
		return kind === "directory" ? { cmd: "osascript", args: ["-e", "POSIX path of (choose folder)"] } : { cmd: "osascript", args: ["-e", "set picks to choose file with multiple selections allowed", "-e", "set out to \"\"", "-e", "repeat with p in picks", "-e", "set out to out & POSIX path of p & linefeed", "-e", "end repeat", "-e", "return out"] };
	}
	if (process.platform === "linux") {
		return kind === "directory" ? { cmd: "zenity", args: ["--file-selection", "--directory"] } : { cmd: "zenity", args: ["--file-selection", "--multiple", "--separator", "\n"] };
	}
	throw new Error(`native picker unsupported on ${process.platform}`);
}

/**
 * Open the HOST's native chooser (Windows Explorer file/folder dialog) and
 * wait for the operator. Resolves the picked absolute paths — `[]` on cancel,
 * unsupported platform, spawn failure, or timeout. Never rejects.
 *
 * @param kind - 'file' or 'directory'.
 * @returns the picked paths (possibly empty).
 */
function pickNative(kind) {
	return new Promise((resolve) => {
		let command;
		try {
			command = pickCommand(kind);
		} catch {
			resolve([]);
			return;
		}
		let child;
		try {
			child = spawn(command.cmd, command.args, { windowsHide: true });
		} catch {
			resolve([]);
			return;
		}
		let out = "";
		const timer = setTimeout(() => {
			child.kill();
		}, PICK_TIMEOUT_MS);
		child.stdout.on("data", (chunk) => {
			out += String(chunk);
		});
		// Drain stderr: an unread stderr pipe can fill its OS buffer and block
		// the child forever — the dialog would close but the process never exit.
		child.stderr?.on("data", () => {});
		child.on("error", () => {
			clearTimeout(timer);
			resolve([]);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				resolve([]);
				return;
			}
			let paths = [];
			const text = out.trim();
			try {
				const parsed = JSON.parse(text);
				if (typeof parsed === "string") paths = [parsed];
				else if (Array.isArray(parsed)) paths = parsed.filter((item) => typeof item === "string");
			} catch {
				paths = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
			}
			resolve(paths.filter((item) => item !== ""));
		});
	});
}

/**
 * Copy one picked source into the managed data directory. Re-connecting the
 * same source replaces its managed copy in place (same target folder).
 *
 * Layout: `<dataDir>/<basename>-<hash8>/` — a file source copies to
 * `<folder>/<basename>`; a directory source copies its CONTENTS into
 * `<folder>/`. Skip rules (node_modules, hidden dirs) and the copy caps
 * apply to directory copies.
 *
 * @param config - the resolved plugin config.
 * @param source - the picked absolute path.
 * @returns the connect outcome for this source.
 */
async function connectSource(config, source) {
	const result = { source, stored: undefined, kind: undefined, replaced: false, skipped: 0, error: undefined };
	try {
		const stat = await fsp.stat(String(source));
		const isDir = stat.isDirectory();
		if (!isDir && !stat.isFile()) throw new Error("unsupported file type");
		result.kind = isDir ? "directory" : "file";
		if (!isDir && stat.size > config.copyMaxFileBytes) throw new Error(`file exceeds the ${(config.copyMaxFileBytes / 1048576).toFixed(0)} MB copy limit`);
		const folder = path.join(dataDir(), storedFolderName(source));
		result.stored = isDir ? folder : path.join(folder, sanitizeBase(path.basename(String(source).replace(/[\\/]+$/, ""))));
		result.replaced = await fsp.stat(folder).then(() => true, () => false);
		await fsp.rm(folder, { recursive: true, force: true });
		await fsp.mkdir(folder, { recursive: true });
		if (isDir) {
			let files = 0;
			let total = 0;
			await fsp.cp(String(source), folder, {
				recursive: true,
				force: true,
				filter: async (src) => {
					if (src === String(source)) return true;
					const name = path.basename(src);
					const st = await fsp.lstat(src).catch(() => undefined);
					if (st === undefined) return false;
					if (st.isSymbolicLink()) return false;
					if (st.isDirectory()) return !SKIP_DIRS.has(name) && !name.startsWith(".") && files < config.copyMaxFiles;
					if (!st.isFile()) return false;
					if (files >= config.copyMaxFiles || st.size > config.copyMaxFileBytes || total + st.size > config.copyMaxTotalBytes) {
						result.skipped += 1;
						return false;
					}
					files += 1;
					total += st.size;
					return true;
				}
			});
		} else {
			await fsp.copyFile(String(source), result.stored);
		}
	} catch (error) {
		result.error = error.code === "ENOENT" ? "path not found" : error.code === "EACCES" || error.code === "EPERM" ? "permission denied" : String(error.message ?? error);
	}
	return result;
}

/**
 * Delete one managed copy. A path that is not a direct child of the data
 * dir (e.g. a connection saved by an older plugin version pointing at the
 * original file) deletes nothing and still succeeds — disconnecting must
 * always be possible.
 *
 * @param stored - the connection's stored path.
 * @param kind - the connection kind.
 * @returns `{ ok, deleted }` or `{ error }`.
 */
async function removeStored(stored, kind) {
	const folder = removableFolder(stored, kind);
	if (folder === undefined) return { ok: true, deleted: false };
	try {
		await fsp.rm(folder, { recursive: true, force: true });
		return { ok: true, deleted: true };
	} catch (error) {
		return { error: String(error.message ?? error) };
	}
}

/**
 * Move every managed copy from the current data directory to a newly picked
 * backup directory, then rewrite all managed connection paths and clear the
 * index cache — after this returns, connections, retrieval, and reconnects
 * all target the new address.
 *
 * Rejection rules: the target must differ from (and not nest with) the
 * current data directory. Moves prefer `rename` (same volume) and fall back
 * to copy+delete (cross volume or occupied destination child).
 *
 * @param config - the resolved plugin config (unused caps today; kept for
 *   symmetry with the other endpoints).
 * @param scope - the settings scope (read connections, write back paths and
 *   the custom data dir).
 * @param cache - the index cache to clear after the move.
 * @param target - the picked absolute backup directory.
 * @returns `{ ok, dataDir, moved, connections }` or `{ error }`.
 */
async function relocateDataDir(config, scope, cache, target) {
	const from = dataDir();
	const to = path.resolve(String(target ?? "").trim());
	const fail = (message) => ({ error: message });
	if (String(target ?? "").trim() === "") return fail("target must be a non-empty directory path");
	if (to === path.resolve(from)) return fail("target is the current backup directory");
	const relTarget = path.relative(path.resolve(from), to);
	if (relTarget !== "" && !relTarget.startsWith("..") && !path.isAbsolute(relTarget)) return fail("target is inside the current backup directory");
	const relFrom = path.relative(to, path.resolve(from));
	if (relFrom !== "" && !relFrom.startsWith("..") && !path.isAbsolute(relFrom)) return fail("current backup directory is inside the target");
	let children;
	try {
		children = await fsp.readdir(from, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") children = [];
		else return fail(error.code === "EACCES" || error.code === "EPERM" ? "permission denied reading the current backup directory" : String(error.message ?? error));
	}
	try {
		await fsp.mkdir(to, { recursive: true });
	} catch (error) {
		return fail(error.code === "EACCES" || error.code === "EPERM" ? "permission denied creating the target directory" : String(error.message ?? error));
	}
	const list = normalizeConnections(scope.get());
	const managed = new Set();
	for (const connection of list) {
		const resolved = path.resolve(connection.path);
		const folder = connection.kind === "file" ? path.dirname(resolved) : resolved;
		if (path.dirname(folder) === path.resolve(from)) managed.add(path.basename(folder));
	}
	let moved = 0;
	const movedPairs = [];
	try {
		for (const child of children) {
			if (!child.isDirectory() || !managed.has(child.name)) continue;
			const src = path.join(from, child.name);
			const dest = path.join(to, child.name);
			try {
				await fsp.rename(src, dest);
			} catch {
				await fsp.cp(src, dest, { recursive: true, force: true });
				await fsp.rm(src, { recursive: true, force: true });
			}
			movedPairs.push({ src, dest });
			moved += 1;
		}
	} catch (error) {
		return fail(`move incomplete (${moved} folder(s) moved): ${String(error.message ?? error)}`);
	}
	const rewritten = list.map((connection) => {
		const resolved = path.resolve(connection.path);
		const folder = connection.kind === "file" ? path.dirname(resolved) : resolved;
		if (path.dirname(folder) !== path.resolve(from)) return connection;
		const newFolder = path.join(to, path.basename(folder));
		return { ...connection, path: connection.kind === "file" ? path.join(newFolder, path.basename(resolved)) : newFolder };
	});
	const changed = rewritten.some((connection, index) => connection.path !== list[index].path);
	try {
		await scope.update({
			connections: rewritten.map(({ id, source, path: storedPath, kind, enabled }) => ({ id, source, path: storedPath, kind, enabled })),
			dataDir: to
		});
	} catch (error) {
		// Settings write refused: roll the move back so folders and settings
		// stay consistent, then surface the write failure.
		for (const { src, dest } of movedPairs.reverse()) {
			try {
				await fsp.rename(dest, src);
			} catch {
				await fsp.cp(dest, src, { recursive: true, force: true });
				await fsp.rm(dest, { recursive: true, force: true });
			}
		}
		return fail(`settings write failed (move rolled back): ${String(error.message ?? error)}`);
	}
	customDataDir = to;
	cache.clear();
	return { ok: true, dataDir: to, moved, connectionsChanged: changed ? rewritten.length : 0 };
}

/** Request-body read cap for the /kb endpoints (1 MB — path lists only). */
const KB_BODY_CAP = 1048576;

/**
 * Read one JSON request body under the cap.
 *
 * @param req - the incoming request.
 * @returns the parsed body object.
 */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > KB_BODY_CAP) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch {
				reject(new Error("invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}

/**
 * Whether a request may use the /kb endpoints: loopback Host header plus the
 * plugin's custom header (a cross-site form post cannot set a custom header
 * without a CORS preflight, which this route never approves).
 *
 * @param req - the incoming request.
 * @returns true when allowed.
 */
function kbRequestAllowed(req) {
	if (req.method !== "POST") return false;
	if (req.headers["x-dsh-kb"] !== "1") return false;
	const host = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
	return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

/**
 * Render the canonical tool value as the model-facing text block.
 *
 * @param value - the validated canonical output.
 * @returns one text content block.
 */
function formatOutput(value) {
	const parts = [];
	if (value.notice !== undefined) parts.push(value.notice);
	if (value.connections.length === 0) {
		parts.push("Knowledge base has no enabled connections.");
		return parts.join("\n\n");
	}
	if (value.matches.length === 0) {
		parts.push(`No matching content found in ${value.filesScanned} searched file(s).`);
		return parts.join("\n\n");
	}
	const header = `${value.matches.length} passage(s) from ${value.filesScanned} searched file(s)${value.truncated ? " (more matches truncated — refine the query or use the path filter)" : ""}.`;
	const blocks = value.matches.map((match) => `### ${match.path}:${match.line}\n${match.excerpt}`);
	parts.push([header, ...blocks].join("\n\n"));
	parts.push("Grounded claims must cite the source path (and line) above. If nothing here answers the question, say the knowledge base lacks it.");
	return parts.join("\n\n");
}

/**
 * Register the settings namespace, the /kb route, the prompt section, and the
 * search tool.
 *
 * @param ctx - host plugin context (carries the four injected registries).
 * @param config - resolved plugin config.
 */
function apply(ctx, config) {
	const scope = ctx.settings.register(NS, z.object({
		connections: z.array(ConnectionConfig).default([]).description("knowledge base connections"),
		dataDir: z.string().default("").description("custom backup directory for managed copies (empty = default under the user home)")
	}));
	const readScope = () => {
		const value = scope.get();
		customDataDir = typeof value?.dataDir === "string" ? value.dataDir : "";
		return value;
	};
	const connections = () => normalizeConnections(readScope());
	const cache = new KbIndexCache(config);

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/kb",
		handler: async (req, res) => {
			const finish = (code, payload) => {
				res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(JSON.stringify(payload));
			};
			if (!kbRequestAllowed(req)) {
				res.writeHead(405);
				res.end();
				return;
			}
			const endpoint = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/kb\/?/, "").replace(/\/+$/, "");
			let body;
			try {
				body = await readJsonBody(req);
			} catch (error) {
				finish(400, { error: String(error.message ?? error) });
				return;
			}
			try {
				readScope();
				if (endpoint === "pick") {
					finish(200, { paths: await pickNative(body.kind === "directory" ? "directory" : "file") });
				} else if (endpoint === "connect") {
					const sources = Array.isArray(body.sources) ? body.sources.filter((item) => typeof item === "string" && item.trim() !== "").slice(0, 64) : [];
					if (sources.length === 0) {
						finish(400, { error: "sources must be a non-empty path array" });
						return;
					}
					const items = [];
					for (const source of sources) {
						const item = await connectSource(config, source);
						if (item.error === undefined) cache.invalidate(item.kind, item.stored);
						items.push(item);
					}
					finish(200, { dataDir: dataDir(), items });
				} else if (endpoint === "relocate") {
					finish(200, await relocateDataDir(config, scope, cache, typeof body.target === "string" ? body.target : ""));
				} else if (endpoint === "remove") {
					finish(200, await removeStored(typeof body.stored === "string" ? body.stored : "", body.kind === "file" ? "file" : "directory"));
				} else {
					finish(404, { error: "unknown endpoint" });
				}
			} catch (error) {
				finish(500, { error: String(error.message ?? error) });
			}
		}
	}), "knowledge-base: /kb route");

	ctx.systemPrompt.section({
		name: "knowledge-base",
		order: config.sectionOrder,
		text: () => {
			const enabled = connections().filter((connection) => connection.enabled);
			if (enabled.length === 0) return "";
			const lines = enabled.map((connection) => `- ${connection.kind}: ${connection.path}`);
			return [
				"The user connected a local knowledge base for grounding (managed from the composer's knowledge-base panel).",
				"- Before answering ANY question, call the knowledge_base tool with the question's key terms (in the user's language) and ground the answer in the returned passages.",
				"- Cite the source file path (with line number) next to claims drawn from it. If the knowledge base has no relevant material, say so explicitly, then answer from general knowledge.",
				"- Connected sources:",
				...lines
			].join("\n");
		}
	});

	ctx.tools.register(defineTool({
		name: "knowledge_base",
		description: "Search the user's connected local knowledge base (directories/files managed in the composer's knowledge-base panel). Returns ranked text passages with source paths and line numbers. Search it before answering any question while connections are enabled.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "Search terms — use the user's question or its key phrases (Chinese or English)."
			},
			path: {
				type: "string",
				description: "Optional substring filter: only search files whose absolute path contains this text (e.g. a directory or file name)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					matches: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: { type: "string", required: true },
								line: { type: "integer", required: true },
								excerpt: { type: "string", required: true },
								score: { type: "number", required: true }
							}
						}
					},
					filesScanned: { type: "integer", required: true },
					connections: { type: "array", required: true, items: { type: "string" } },
					truncated: { type: "boolean", required: true },
					notice: { type: "string" }
				}
			},
			render: (_args, value) => [{ type: "text", text: formatOutput(value) }]
		},
		timeoutMs: config.timeoutMs,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const query = String(args.query ?? "").trim();
			const pathFilter = typeof args.path === "string" ? args.path.trim().toLowerCase() : "";
			const enabled = connections().filter((connection) => connection.enabled);
			const base = { connections: enabled.map((connection) => connection.path) };
			if (enabled.length === 0) return { ...base, matches: [], filesScanned: 0, truncated: false, notice: "No enabled knowledge base connections." };
			const tokens = tokenizeQuery(query);
			if (tokens.length === 0) return { ...base, matches: [], filesScanned: 0, truncated: false, notice: "The search query contains no usable terms." };
			const notices = [];
			const ranked = [];
			let filesScanned = 0;
			let matched = 0;
			for (const connection of enabled) {
				if (exec.signal.aborted) break;
				const record = await cache.entry(connection, exec.signal);
				if (record.error !== undefined) notices.push(`${connection.path}: ${record.error}`);
				if (record.truncated) notices.push(`${connection.path}: index capped at ${config.maxFilesPerConnection} files`);
				for (const file of record.files) {
					if (pathFilter !== "" && !file.path.toLowerCase().includes(pathFilter)) continue;
					filesScanned += 1;
					const score = scoreText(file.text.toLowerCase(), tokens);
					if (score <= 0) continue;
					matched += 1;
					ranked.push({ file, score });
				}
			}
			ranked.sort((left, right) => right.score - left.score);
			const selected = ranked.slice(0, config.maxResults);
			const matches = selected.map(({ file, score }) => {
				const { excerpt, line } = bestExcerpt(file.text, tokens, config.excerptChars);
				return { path: file.path, line, excerpt, score };
			});
			const notice = notices.length > 0 ? `Skipped sources: ${notices.join("; ")}` : undefined;
			return { ...base, matches, filesScanned, truncated: matched > selected.length, ...notice !== undefined ? { notice } : {} };
		}
	}));
}

export { Config, KbIndexCache, apply, bestExcerpt, connectSource, dataDir, inject, name, normalizeConnections, paragraphsOf, pickCommand, pickNative, removableFolder, removeStored, sanitizeBase, scoreText, storedFolderName, tokenizeQuery };
//#endregion
