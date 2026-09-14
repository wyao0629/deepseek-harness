window.__ModuleLoader__.load({ id: "dsh-codex", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/index.tsx
const runDefinition = {
	kind: "codex-run",
	target: "chat",
	match: (event) => {
		if (event.type === "codex/turn") return {
			id: event.data.turnId,
			role: event.data.phase === "started" ? "start" : "update"
		};
		if (event.type === "codex/item") return {
			id: event.data.turnId,
			role: "update"
		};
		if (event.type === "codex/approval" && event.data.turnId !== void 0) return {
			id: event.data.turnId,
			role: "update"
		};
		return null;
	},
	start: (_context, match) => {
		if (match.event.type !== "codex/turn") throw new Error("codex-run requires codex/turn start");
		return {
			turnId: match.event.data.turnId,
			status: match.event.data.status,
			model: match.event.data.model,
			...match.event.data.effort === void 0 ? {} : { effort: match.event.data.effort },
			items: [],
			approvals: []
		};
	},
	update: (context, match) => {
		const event = match.event;
		if (event.type === "codex/turn") return {
			...context.state,
			status: event.data.status,
			...event.data.error === void 0 ? {} : { error: event.data.error }
		};
		if (event.type === "codex/item") return {
			...context.state,
			items: [...context.state.items, event.data]
		};
		if (event.type === "codex/approval") return {
			...context.state,
			approvals: [...context.state.approvals, event.data]
		};
		return context.state;
	},
	buildViewNode: (context) => {
		if (context.start === void 0 || context.state === void 0) return null;
		const { turnId: _turnId,...data } = context.state;
		return {
			key: context.key,
			kind: "codex-run",
			id: context.id,
			target: "chat",
			anchorSeq: context.start.event.seq,
			location: context.start.location,
			visibility: "visible",
			data
		};
	}
};
const contextDefinition = {
	kind: "codex-context",
	target: "chat",
	match: (event) => event.type === "codex/thread-bound" && event.data.reason !== "resumed" ? {
		id: `${event.data.generation}:${event.data.threadId}`,
		role: "start"
	} : null,
	start: (_context, match) => {
		if (match.event.type !== "codex/thread-bound") throw new Error("codex-context requires thread binding");
		return {
			reason: match.event.data.reason,
            threadId: match.event.data.threadId,
            selectedProvider: match.event.data.selectedProvider,
            selectedModel: match.event.data.selectedModel,
			generation: match.event.data.generation,
			...match.event.data.note === void 0 ? {} : { note: match.event.data.note }
		};
	},
	update: (context) => context.state,
	buildViewNode: (context) => context.start === void 0 || context.state === void 0 ? null : {
		key: context.key,
		kind: "codex-context",
		id: context.id,
		target: "chat",
		anchorSeq: context.start.event.seq,
		location: context.start.location,
		visibility: "visible",
		data: context.state
	}
};
function statusLabel(status) {
	switch (status) {
		case "inProgress": return "运行中";
		case "completed": return "已完成";
		case "interrupted": return "已取消";
		case "failed": return "失败";
	}
}
function RunPanel({ node }) {
	const data = node.data;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
		open: data.status !== "completed",
		"data-codex-run": data.status,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
				"Codex · ",
				data.model,
				data.effort === void 0 ? "" : ` · ${data.effort}`,
				" · ",
				statusLabel(data.status)
			] }),
			data.items.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
				item.phase === "started" ? "○" : "●",
				" ",
				item.title,
				item.status === void 0 ? "" : ` · ${item.status}`
			] }), item.detail === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: item.detail })] }, `${item.itemId}:${item.phase}:${index}`)),
			data.approvals.map((approval, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
				"权限 · ",
				approval.summary,
				approval.decision === void 0 ? "" : ` · ${approval.decision}`
			] }, `${approval.requestId}:${approval.phase}:${index}`)),
			data.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				role: "alert",
				children: data.error
			})
		]
	});
}
function ContextNotice({ node }) {
	const data = node.data;
	const label = data.reason === "rebased" ? "已根据当前网页对话重建 Codex 上下文" : data.reason === "forked" ? "已分叉独立 Codex 会话" : data.reason === "recovered" ? "已恢复为新的 Codex 会话" : "已创建 Codex 会话";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
		"data-codex-context": data.reason,
		children: [label, ` · ${data.selectedProvider ?? ""}/${data.selectedModel ?? ""} · Codex session: ${data.threadId ?? ""}`, data.note === void 0 ? "" : `：${data.note}`]
	});
}
/** Services required for Conversation Definition and keyed render registration. */
const inject = ["uiConversation", "slots"];
/** Register durable Codex activity and context nodes. */
function apply(ctx) {
	ctx.uiConversation.events.register(runDefinition);
	ctx.uiConversation.events.register(contextDefinition);
	ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
		name: "conversation.chat.node",
		key: "codex-run"
	}, RunPanel));
	ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
		name: "conversation.chat.node",
		key: "codex-context"
	}, ContextNotice));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map