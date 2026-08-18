window.__ModuleLoader__.load({
	id: "dsh-plugin-knowledge-base",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region styles
		const css = [
			".dskb-root{position:relative;display:inline-flex}",
			".dskb-trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:none;border:0;border-radius:6px;align-items:center;gap:5px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex;font-family:inherit}",
			".dskb-trigger:hover,.dskb-trigger:focus-visible,.dskb-triggerOpen{color:var(--dsw-alias-label-secondary)}",
			".dskb-trigger svg{flex:none}",
			".dskb-count{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:9px;padding:0 6px;font-size:11px;line-height:18px;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}",
			".dskb-countOn{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
			".dskb-menu{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);width:420px;max-width:min(460px,100vw - 32px);max-height:min(60vh,520px);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;flex-direction:column;gap:6px;padding:10px;display:flex;position:absolute;bottom:calc(100% + 8px);left:0;overflow-y:auto}",
			".dskb-head{align-items:baseline;gap:8px;display:flex;padding:0 2px}",
			".dskb-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".dskb-sub{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".dskb-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px;overflow-y:auto;min-height:0}",
			".dskb-row{align-items:center;gap:8px;padding:6px 8px;border-radius:8px;display:flex}",
			".dskb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dskb-check{flex:none;accent-color:var(--dsw-alias-state-business-primary);margin:0;width:14px;height:14px;cursor:pointer}",
			".dskb-kindIcon{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex}",
			".dskb-kindIcon svg{width:14px;height:14px}",
			".dskb-path{flex:1;min-width:0;font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr}",
			".dskb-rowOff .dskb-path{color:var(--dsw-alias-label-dimmed)}",
			".dskb-kind{flex:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:5px;padding:0 6px;font-size:11px;line-height:18px}",
			".dskb-remove{flex:none;width:22px;height:22px;border:0;background:none;color:var(--dsw-alias-label-dimmed);border-radius:6px;cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}",
			".dskb-remove:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".dskb-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:12px 8px;text-align:center}",
			".dskb-add{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;display:flex;flex-direction:column;gap:6px}",
			".dskb-addRow{align-items:center;gap:6px;flex-wrap:wrap;display:flex}",
			".dskb-connect{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:8px;font-size:12px;line-height:18px;padding:5px 10px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px}",
			".dskb-connect:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".dskb-connect:disabled{cursor:default;opacity:.6}",
			".dskb-foot{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:0 2px;word-break:break-all}",
			".dskb-error{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;padding:0 2px;word-break:break-all}"
		].join("");
		const tagId = "dsh-plugin-knowledge-base/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-knowledge-base";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region locale
		const NS = "knowledge-base";
		const zh = {
			"trigger.label": "知识库",
			"title": "本地知识库",
			"subtitle": "已启用 {enabled}/{total} · 每次提问自动检索",
			"row.directory": "目录",
			"row.file": "文件",
			"row.remove": "断开并删除副本",
			"row.toggle": "切换启用",
			"row.storedAt": "副本位置：{path}",
			"empty": "暂无连接。点击下方按钮打开系统选择框。",
			"pick.file": "选择文件…",
			"pick.folder": "选择文件夹…",
			"pick.busy": "正在处理…",
			"pick.waiting": "请选择…",
			"dir.change": "修改知识库同步地址…",
			"dir.busy": "正在迁移…",
			"error.relocate": "修改知识库同步地址失败：{message}",
			"foot": "连接的目录/文件会保存到 {dir}，之后每次提问自动检索并引用来源。",
			"dataDir": "~/dsh-kb-data（Windows 为用户目录下）",
			"error.connect": "连接失败：{message}",
			"error.remove": "副本删除失败：{message}",
			"error.write": "保存失败，请重试。",
			"status.loading": "正在读取连接列表…",
			"status.unavailable": "连接列表暂不可用（设置服务未就绪）。"
		};
		const en = {
			"trigger.label": "Knowledge",
			"title": "Local knowledge base",
			"subtitle": "{enabled}/{total} enabled · searched on every question",
			"row.directory": "dir",
			"row.file": "file",
			"row.remove": "Disconnect and delete copy",
			"row.toggle": "Toggle enabled",
			"row.storedAt": "Stored copy: {path}",
			"empty": "No connections yet. Use a button below to open the system picker.",
			"pick.file": "Choose files…",
			"pick.folder": "Choose folder…",
			"pick.busy": "Working…",
			"pick.waiting": "Select…",
			"dir.change": "Change sync location…",
			"dir.busy": "Moving…",
			"error.relocate": "Change sync location failed: {message}",
			"foot": "Picked files/folders are saved to {dir}, then searched and cited on every question.",
			"dataDir": "~/dsh-kb-data (Windows: under the user profile)",
			"error.connect": "Connect failed: {message}",
			"error.remove": "Copy deletion failed: {message}",
			"error.write": "Save failed, please retry.",
			"status.loading": "Loading connections…",
			"status.unavailable": "Connections unavailable (settings service not ready)."
		};
		//#endregion
		//#region helpers
		/** Normalize a path for duplicate detection (case-insensitive, forward slashes). */
		function normPath(value) {
			return String(value).trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
		}
		/** Display label for a connection: basename only (filename.ext or folder name), never the full path. */
		function baseName(value) {
			const text = String(value).replace(/[\\/]+$/, "");
			const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
			return cut === -1 ? text : text.slice(cut + 1);
		}
		/** New connection identity. */
		function newId() {
			return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		}
		/**
		* Defensive decoder for the settings scope: accepts the served value and
		* answers the well-formed subset, or undefined to keep the scope not-ready.
		* @param value - the namespace's resolved value from the settings wire.
		* @returns the normalized `{ connections, dataDir }` object, or undefined.
		*/
		function decode(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
			const list = Array.isArray(value.connections) ? value.connections : [];
			const connections = [];
			for (const entry of list) {
				if (typeof entry !== "object" || entry === null) continue;
				const path = typeof entry.path === "string" ? entry.path.trim() : "";
				if (path === "") continue;
				const source = typeof entry.source === "string" && entry.source.trim() !== "" ? entry.source.trim() : path;
				connections.push({
					id: typeof entry.id === "string" && entry.id !== "" ? entry.id : newId(),
					source,
					path,
					kind: entry.kind === "file" ? "file" : "directory",
					enabled: entry.enabled !== false
				});
			}
			return { connections, dataDir: typeof value.dataDir === "string" ? value.dataDir : "" };
		}
		/**
		* POST one /kb endpoint (loopback host route owned by the host half).
		* @param endpoint - 'pick' | 'connect' | 'remove'.
		* @param payload - the JSON body.
		* @returns the parsed response; throws on HTTP/transport/business error.
		*/
		async function kbFetch(endpoint, payload) {
			let response;
			try {
				response = await fetch(`/kb/${endpoint}`, {
					method: "POST",
					headers: { "content-type": "application/json", "x-dsh-kb": "1" },
					body: JSON.stringify(payload ?? {})
				});
			} catch (failure) {
				throw new Error(`network error (${failure instanceof Error ? failure.message : String(failure)})`);
			}
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (data !== null && typeof data === "object" && typeof data.error === "string") throw new Error(data.error);
			return data;
		}
		//#endregion
		//#region component
		const h = react.createElement;
		/**
		* The composer tool-row entry: a trigger listing enabled-connection count
		* and, while open, the management popover — connection rows with enable
		* toggles and disconnect (which also deletes the managed copy), and two
		* buttons that open the HOST's native Explorer choosers (files / folder).
		* Picked paths are copied into the data dir through /kb/connect.
		* @param props - slot props plus `{ scope }` from apply.
		* @returns the trigger, with the popover while open.
		*/
		function KnowledgeBaseTrigger(props) {
			const scope = props.scope;
			const t = props.t;
			const state = react.useSyncExternalStore((listener) => scope.subscribe(listener), () => scope.getSnapshot());
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [picking, setPicking] = react.useState(null);
			const [relocating, setRelocating] = react.useState(false);
			const [error, setError] = react.useState(null);
			const rootRef = react.useRef(null);
			const triggerRef = react.useRef(null);
			primitives.useDismissOnOutsidePointer(rootRef, open, setOpen);
			const ready = state.status === "ready";
			const connections = ready ? state.value.connections : [];
			const dataDirValue = ready && typeof state.value.dataDir === "string" ? state.value.dataDir : "";
			const dirLabel = dataDirValue.trim() !== "" ? dataDirValue : t("dataDir");
			const enabledCount = connections.reduce((count, connection) => count + (connection.enabled ? 1 : 0), 0);
			const writable = state.writable !== false;
			const commit = (next) => {
				scope.set("connections", next.map((connection) => ({
					id: connection.id,
					source: connection.source,
					path: connection.path,
					kind: connection.kind,
					enabled: connection.enabled
				})));
			};
			/**
			* Merge connected items (from /kb/connect) into the settings list,
			* deduplicating by original source path (re-connect replaces).
			*/
			const mergeConnected = (items) => {
				if (items.length === 0) return;
				const bySource = new Map(connections.map((connection) => [normPath(connection.source), connection]));
				for (const item of items) {
					const existing = bySource.get(normPath(item.source));
					bySource.set(normPath(item.source), existing === undefined ? { id: newId(), source: item.source, path: item.stored, kind: item.kind, enabled: true } : { ...existing, source: item.source, path: item.stored, kind: item.kind });
				}
				commit([...bySource.values()]);
			};
			/**
			* Open the HOST's native chooser for one kind, then connect whatever
			* the operator picked. Cancelling the chooser is a silent no-op.
			*/
			const pickAndConnect = async (kind) => {
				setError(null);
				setBusy(true);
				setPicking(kind);
				try {
					const picked = await kbFetch("pick", { kind });
					const sources = Array.isArray(picked.paths) ? picked.paths.filter((item) => typeof item === "string" && item.trim() !== "") : [];
					if (sources.length === 0) return;
					const data = await kbFetch("connect", { sources });
					const items = Array.isArray(data.items) ? data.items : [];
					const failed = items.filter((item) => item.error !== undefined);
					if (failed.length > 0) setError(t("error.connect", { message: `${failed[0].source}: ${failed[0].error}` }));
					mergeConnected(items.filter((item) => item.error === undefined));
				} catch (failure) {
					setError(t("error.connect", { message: String(failure instanceof Error ? failure.message : failure) }));
				} finally {
					setPicking(null);
					setBusy(false);
				}
			};
			const removeConnection = async (connection) => {
				setError(null);
				setBusy(true);
				try {
					await kbFetch("remove", { stored: connection.path, kind: connection.kind });
					commit(connections.filter((item) => item.id !== connection.id));
				} catch (failure) {
					setError(t("error.remove", { message: String(failure instanceof Error ? failure.message : failure) }));
				} finally {
					setBusy(false);
				}
			};
			/**
			* Change the backup directory: open the HOST's native folder chooser,
			* then move every managed copy to the picked target through
			* /kb/relocate (the server also rewrites connection paths and clears
			* its index cache, so retrieval immediately targets the new address).
			* Cancelling the chooser is a silent no-op.
			*/
			const relocateBackupDir = async () => {
				setError(null);
				setBusy(true);
				setPicking("relocate");
				try {
					const picked = await kbFetch("pick", { kind: "directory" });
					const paths = Array.isArray(picked.paths) ? picked.paths.filter((item) => typeof item === "string" && item.trim() !== "") : [];
					if (paths.length === 0) return;
					setRelocating(true);
					await kbFetch("relocate", { target: paths[0] });
				} catch (failure) {
					setError(t("error.relocate", { message: String(failure instanceof Error ? failure.message : failure) }));
				} finally {
					setRelocating(false);
					setPicking(null);
					setBusy(false);
				}
			};
			const onKeyDown = (event) => {
				if (event.key !== "Escape" || !open) return;
				event.preventDefault();
				setOpen(false);
				triggerRef.current?.focus();
			};
			const rows = connections.map((connection) => {
				const label = baseName(connection.source);
				return h("li", {
					key: connection.id,
					className: connection.enabled ? "dskb-row" : "dskb-row dskb-rowOff"
				}, h("input", {
					type: "checkbox",
					className: "dskb-check",
					checked: connection.enabled,
					disabled: !writable || busy,
					"aria-label": t("row.toggle") + ": " + label,
					onChange: () => {
						setError(null);
						commit(connections.map((item) => item.id === connection.id ? { ...item, enabled: !item.enabled } : item));
					}
				}), h("span", { className: "dskb-kindIcon", "aria-hidden": "true" }, connection.kind === "file" ? h(primitives.IconListPenOutline16, null) : h(primitives.IconFolderOpenOutline16, null)), h("span", {
					className: "dskb-path",
					title: t("row.storedAt", { path: connection.path }),
					dir: "ltr"
				}, label), h("span", { className: "dskb-kind" }, t(connection.kind === "file" ? "row.file" : "row.directory")), h("button", {
					type: "button",
					className: "dskb-remove",
					disabled: !writable || busy,
					title: t("row.remove"),
					"aria-label": t("row.remove") + ": " + label,
					onClick: () => {
						removeConnection(connection);
					}
				}, "×"));
			});
			return h("div", { ref: rootRef, className: "dskb-root", onKeyDown }, [				h("button", {
					key: "trigger",
					ref: triggerRef,
					type: "button",
					className: open ? "dskb-trigger dskb-triggerOpen" : "dskb-trigger",
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					disabled: !writable && !ready,
					onClick: () => {
						setError(null);
						setOpen((current) => !current);
					}
				}, h(primitives.IconListPenOutline16, null), h("span", null, t("trigger.label")), enabledCount > 0 ? h("span", { className: "dskb-count dskb-countOn" }, String(enabledCount)) : null),
				open ? h("div", {
					key: "menu",
					className: "dskb-menu",
					role: "dialog",
					"aria-label": t("title")
				}, h("div", { className: "dskb-head" }, h("span", { className: "dskb-title" }, t("title")), h("span", { className: "dskb-sub" }, t("subtitle", { enabled: String(enabledCount), total: String(connections.length) }))), ready ? connections.length > 0 ? h("ul", { className: "dskb-list" }, rows) : h("div", { className: "dskb-empty" }, t("empty")) : h("div", { className: "dskb-empty" }, t(state.status === "loading" ? "status.loading" : "status.unavailable")), h("div", { className: "dskb-add" }, h("div", { className: "dskb-addRow" }, h("button", {
					type: "button",
					className: "dskb-connect",
					disabled: !writable || busy,
					onClick: () => {
						pickAndConnect("file");
					}
				}, h(primitives.IconPaperclipOutline16, null), t(busy ? (picking === "file" ? "pick.waiting" : "pick.busy") : "pick.file")), h("button", {
					type: "button",
					className: "dskb-connect",
					disabled: !writable || busy,
					onClick: () => {
						pickAndConnect("directory");
					}
				}, h(primitives.IconFolderOpenOutline16, null), t(busy ? (picking === "directory" ? "pick.waiting" : "pick.busy") : "pick.folder")), h("button", {
				type: "button",
				className: "dskb-connect",
				disabled: !writable || busy,
				onClick: () => {
					relocateBackupDir();
				}
			}, h(primitives.IconSettingsOutline16, null), t(busy && picking === "relocate" ? (relocating ? "dir.busy" : "pick.waiting") : "dir.change")))), error === null ? null : h("div", { className: "dskb-error", role: "alert" }, error), h("div", { className: "dskb-foot" }, t("foot", { dir: dirLabel }))) : null
			]);
		}
		//#endregion
		//#region plugin
		/** Required client services: slot registry, locale, the wire connection (settings transport), and the settings scope binder. */
		const inject = ["slots", "locale", "connection", "settingsScope"];
		/**
		* Client plugin body: register dictionaries and the composer tool-row entry.
		* @param ctx - browser root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "knowledge-base: dictionaries");
			const scope = ctx.settingsScope.bind({ namespace: NS, decode });
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "knowledge-base",
				order: 40,
				locale: NS
			}, (props) => h(KnowledgeBaseTrigger, { ...props, scope, t })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
