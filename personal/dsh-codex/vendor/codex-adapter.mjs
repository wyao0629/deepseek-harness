// Codex events are informational projections; native transcripts are stored by Codex.
function appendCodexEvent(session, type, data) {
    return session?.append(type, data, { ignorable: true });
}
import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

//#region src/events.ts
/** Fold the newest Codex thread checkpoint from a session log. */
function latestBinding(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "codex/thread-bound") return event.data;
	}
}

//#endregion
//#region src/json.ts
/** Require a non-array JSON object. */
function asObject(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`dsh-plugin-codex: app-server returned invalid ${label}`);
	return value;
}
/** Require a non-empty string. */
function asString(value, label) {
	if (typeof value !== "string" || value.length === 0) throw new Error(`dsh-plugin-codex: app-server returned invalid ${label}`);
	return value;
}
/** Convert an arbitrary failure to Error. */
function asError(value) {
	return value instanceof Error ? value : new Error(String(value));
}
/** Render JSON for a bounded diagnostic without throwing. */
function boundedJson(value, maxBytes) {
	let raw;
	try {
		raw = JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		raw = String(value);
	}
	const bytes = Buffer.from(raw);
	if (bytes.byteLength <= maxBytes) return {
		text: raw,
		truncated: false
	};
	const suffix = "\n… output truncated by dsh-plugin-codex";
	let end = Math.max(0, maxBytes - Buffer.byteLength(suffix));
	while (end > 0 && ((bytes[end] ?? 0) & 192) === 128) end -= 1;
	return {
		text: bytes.subarray(0, end).toString("utf8") + suffix,
		truncated: true
	};
}

//#endregion
//#region src/activity.ts
function commandTitle(item) {
	if (typeof item.command === "string") return item.command;
	if (Array.isArray(item.command)) return item.command.map(String).join(" ");
	return "命令执行";
}
/** Convert one provider item into a bounded, provider-neutral durable projection. */
function projectItem(threadId, turnId, phase, item, maxBytes) {
	const kind = typeof item.type === "string" ? item.type : "unknown";
	const itemId = typeof item.id === "string" && item.id !== "" ? item.id : `${kind}:${turnId}`;
	const status = typeof item.status === "string" ? item.status : void 0;
	let title;
	switch (kind) {
		case "commandExecution":
			title = commandTitle(item);
			break;
		case "fileChange":
			title = "文件变更";
			break;
		case "mcpToolCall":
			title = typeof item.tool === "string" ? `MCP · ${item.tool}` : "MCP 调用";
			break;
		case "webSearch":
			title = typeof item.query === "string" ? `搜索 · ${item.query}` : "网页搜索";
			break;
		case "plan":
			title = "执行计划";
			break;
		case "reasoning":
			title = "推理";
			break;
		default: title = kind;
	}
	const bounded = boundedJson(kind === "commandExecution" ? item.aggregatedOutput ?? item.output ?? item : kind === "fileChange" ? item.changes ?? item : item, maxBytes);
	return {
		threadId,
		turnId,
		itemId,
		phase,
		kind,
		...status === void 0 ? {} : { status },
		title,
		...bounded.text === "{}" ? {} : { detail: bounded.text },
		...bounded.truncated ? { truncated: true } : {}
	};
}
/** Select a final-answer text from a completed agentMessage item. */
function completedAgentText(item) {
	if (item.type !== "agentMessage" || typeof item.text !== "string") return void 0;
	return {
		phase: typeof item.phase === "string" ? item.phase : null,
		text: item.text
	};
}

//#endregion
//#region src/interaction.ts
const labels = {
	accept: "允许一次",
	acceptForSession: "本会话允许",
	decline: "拒绝",
	cancel: "取消"
};
function append(context, params, requestId, kind, phase, summary, decision) {
	appendCodexEvent(context.session, "codex/approval", {
		threadId: typeof params.threadId === "string" ? params.threadId : "unknown",
		...typeof params.turnId === "string" ? { turnId: params.turnId } : {},
		requestId,
		kind,
		phase,
		summary,
		...decision === void 0 ? {} : { decision }
	});
}
function safeDecision(params) {
	return Array.isArray(params.availableDecisions) && params.availableDecisions.includes("cancel") ? "cancel" : "decline";
}
async function askDecision(context, params, kind) {
	const requestId = typeof params.requestId === "string" ? params.requestId : randomUUID();
	const detail = boundedJson(params, context.maxBytes).text;
	const summary = typeof params.reason === "string" ? params.reason : kind === "command" ? "Codex 请求执行命令。" : kind === "file" ? "Codex 请求修改文件。" : "Codex 请求额外权限。";
	append(context, params, requestId, kind, "requested", summary);
	if (context.approvalPolicy === "never") {
		const decision$1 = safeDecision(params);
		append(context, params, requestId, kind, "resolved", summary, decision$1);
		return decision$1;
	}
    const supplied = Array.isArray(params.availableDecisions) ? params.availableDecisions : ['accept', 'acceptForSession', 'decline', 'cancel'];
    const available = supplied.flatMap(value => {
        if (typeof value === 'string' && value in labels) return [{ value, label: labels[value] }];
        if (value && typeof value === 'object' && 'acceptWithExecpolicyAmendment' in value) return [{ value, label: '允许并保存此命令规则' }];
        if (value && typeof value === 'object' && 'applyNetworkPolicyAmendment' in value) return [{ value, label: '应用此网络规则' }];
        return [];
    });
    const options = available.map(({ value, label }) => ({ label, description: typeof value === 'string' ? value : boundedJson(value, context.maxBytes).text }));
	const selected = (await context.userQuestions.ask({
		questions: [{
			id: requestId,
			header: "Codex 权限",
			question: summary,
			detail,
			options
		}],
		...context.agent === void 0 ? {} : { agent: context.agent },
		...context.signal === void 0 ? {} : { signal: context.signal }
	})).answers[0]?.selected[0];
	const decision = available.find(value => value.label === selected)?.value ?? "cancel";
	append(context, params, requestId, kind, "resolved", summary, typeof decision === "string" ? decision : JSON.stringify(decision));
	return decision;
}
async function askToolQuestions(context, params) {
	const raw = Array.isArray(params.questions) ? params.questions : [];
	if (raw.length === 0) return { answers: {} };
	const questions = raw.map((value, index) => {
		const question = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
		const id = typeof question.id === "string" ? question.id : `question-${index + 1}`;
		const options = Array.isArray(question.options) ? question.options.flatMap((option) => {
			if (typeof option === "string") return [{ label: option }];
			if (option !== null && typeof option === "object" && !Array.isArray(option)) {
				const record = option;
				const label = typeof record.label === "string" ? record.label : typeof record.value === "string" ? record.value : void 0;
				return label === void 0 ? [] : [{
					label,
					...typeof record.description === "string" ? { description: record.description } : {}
				}];
			}
			return [];
		}) : void 0;
		return {
			id,
			question: typeof question.question === "string" ? question.question : "Codex 需要你的输入。",
			...typeof question.header === "string" ? { header: question.header } : {},
			...options === void 0 || options.length === 0 ? {} : { options },
			...question.multiSelect === true ? { multiSelect: true } : {}
		};
	});
    const answers = {};
    for (let offset = 0; offset < questions.length; offset += 3) {
        const answer = await context.userQuestions.ask({
            questions: questions.slice(offset, offset + 3),
            ...(context.agent ? { agent: context.agent } : {}),
            ...(context.signal ? { signal: context.signal } : {}),
        });
        for (const item of answer.answers) answers[item.id] = {
            answers: [...item.selected, ...(item.custom?.trim() ? [item.custom] : [])],
        };
    }
    return { answers };
}
async function askMcpElicitation(context, params) {
	if (context.approvalPolicy === "never") return {
		action: "decline",
		content: null,
		_meta: null
	};
	if (params.mode === "form" || params.mode === "openai/form") {
		const id = typeof params.elicitationId === "string" ? params.elicitationId : randomUUID();
		const text = (await context.userQuestions.ask({
			questions: [{
				id,
				header: "MCP 表单",
				question: typeof params.message === "string" ? params.message : "MCP 服务器请求结构化输入。",
				detail: boundedJson(params.requestedSchema ?? {}, context.maxBytes).text
			}],
			...context.agent === void 0 ? {} : { agent: context.agent },
			...context.signal === void 0 ? {} : { signal: context.signal }
		})).answers[0]?.custom;
		if (text === void 0 || text.trim() === "") return {
			action: "decline",
			content: null,
			_meta: null
		};
		try {
			return {
				action: "accept",
				content: JSON.parse(text),
				_meta: null
			};
		} catch {
			return {
				action: "decline",
				content: null,
				_meta: null
			};
		}
	}
	const decision = await askDecision(context, params, "mcp-elicitation");
	return {
		action: decision === "accept" || decision === "acceptForSession" ? "accept" : decision,
		content: null,
		_meta: null
	};
}
/** Build a fail-closed App Server request handler backed by the DSH Web interaction service. */
function interactionHandler(context) {
	return async (method, params) => {
		switch (method) {
			case "item/commandExecution/requestApproval":
			case "item/fileChange/requestApproval": return { decision: await askDecision(context, params, method.includes("commandExecution") ? "command" : "file") };
			case "item/permissions/requestApproval": {
				const decision = await askDecision(context, params, "permissions");
				if (decision !== "accept" && decision !== "acceptForSession") return {
					permissions: {},
					scope: "turn"
				};
				return {
					permissions: params.permissions ?? params.requestedPermissions ?? {},
					scope: decision === "acceptForSession" ? "session" : "turn"
				};
			}
			case "item/tool/requestUserInput":
			case "tool/requestUserInput": return askToolQuestions(context, params);
			case "mcpServer/elicitation/request": return askMcpElicitation(context, params);
			default: throw new Error(`dsh-plugin-codex: unsupported app-server request ${JSON.stringify(method)}`);
		}
	};
}

//#endregion
//#region src/jsonrpc.ts
/** Minimal newline-delimited JSON-RPC 2.0 transport for Codex App Server. */
var JsonRpcLineTransport = class {
	input;
	output;
	decoder = new StringDecoder("utf8");
	pending = /* @__PURE__ */ new Map();
	buffer = "";
	nextId = 1;
	started = false;
	closed = false;
	requestHandler;
	notificationHandler;
	constructor(input, output) {
		this.input = input;
		this.output = output;
	}
	onRequest(handler) {
		this.requestHandler = handler;
	}
	onNotification(handler) {
		this.notificationHandler = handler;
	}
	start() {
		if (this.started || this.closed) return;
		this.started = true;
		this.input.on("data", this.onData);
		this.input.on("error", this.onError);
		this.input.on("end", this.onEnd);
	}
	async request(method, params, signal) {
		if (this.closed) throw new Error("dsh-plugin-codex: JSON-RPC transport is closed");
		if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("request aborted");
		const id = this.nextId++;
		return new Promise((resolve$1, reject) => {
			const abort = () => reject(signal?.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("request aborted"));
			const cleanup = () => signal?.removeEventListener("abort", abort);
			this.pending.set(id, {
				resolve: resolve$1,
				reject,
				cleanup
			});
			signal?.addEventListener("abort", abort, { once: true });
			this.write({
				jsonrpc: "2.0",
				id,
				method,
				params
			}).catch((error) => {
				const pending = this.pending.get(id);
				this.pending.delete(id);
				pending?.cleanup();
				reject(asError(error));
			});
		}).finally(() => {
			const pending = this.pending.get(id);
			this.pending.delete(id);
			pending?.cleanup();
		});
	}
	notify(method, params = {}) {
		this.write({
			jsonrpc: "2.0",
			method,
			params
		}).catch(this.onError);
	}
	flush() {
		if (!this.output.writableNeedDrain) return Promise.resolve();
		return new Promise((resolve$1, reject) => {
			const done = () => {
				cleanup();
				resolve$1();
			};
			const failed = (error) => {
				cleanup();
				reject(error);
			};
			const cleanup = () => {
				this.output.off("drain", done);
				this.output.off("error", failed);
			};
			this.output.once("drain", done);
			this.output.once("error", failed);
		});
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		this.input.off("data", this.onData);
		this.input.off("error", this.onError);
		this.input.off("end", this.onEnd);
		this.rejectAll(/* @__PURE__ */ new Error("dsh-plugin-codex: JSON-RPC transport closed"));
	}
	onData = (chunk) => {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) return;
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line === "") continue;
			let frame;
			try {
				frame = JSON.parse(line);
			} catch {
				continue;
			}
			this.handleFrame(frame).catch(this.onError);
		}
	};
	onError = (error) => {
		this.rejectAll(asError(error));
	};
	onEnd = () => {
		this.rejectAll(/* @__PURE__ */ new Error("dsh-plugin-codex: JSON-RPC input ended"));
	};
	async handleFrame(value) {
		const frame = asObject(value, "JSON-RPC frame");
		if ((typeof frame.id === "number" || typeof frame.id === "string") && typeof frame.method !== "string") {
			const pending = this.pending.get(frame.id);
			if (pending === void 0) return;
			this.pending.delete(frame.id);
			pending.cleanup();
			if (frame.error !== void 0) {
				const error = asObject(frame.error, "JSON-RPC error");
				pending.reject(new Error(typeof error.message === "string" ? error.message : "JSON-RPC request failed"));
			} else pending.resolve(frame.result);
			return;
		}
		if (typeof frame.method !== "string") return;
		const params = frame.params === void 0 ? {} : asObject(frame.params, "JSON-RPC params");
		if (typeof frame.id !== "number" && typeof frame.id !== "string") {
			await this.notificationHandler?.(frame.method, params);
			return;
		}
		try {
			if (this.requestHandler === void 0) throw new Error(`unsupported server request ${frame.method}`);
			const result = await this.requestHandler(frame.method, params);
			await this.write({
				jsonrpc: "2.0",
				id: frame.id,
				result: result ?? null
			});
		} catch (error) {
			await this.write({
				jsonrpc: "2.0",
				id: frame.id,
				error: {
					code: -32603,
					message: asError(error).message
				}
			});
		}
	}
	async write(frame) {
		if (this.closed) throw new Error("dsh-plugin-codex: JSON-RPC transport is closed");
		if (!this.output.write(`${JSON.stringify(frame)}\n`)) await this.flush();
	}
	rejectAll(error) {
		for (const pending of this.pending.values()) {
			pending.cleanup();
			pending.reject(error);
		}
		this.pending.clear();
	}
};

//#endregion
//#region src/app-server.ts
var AsyncEventQueue = class {
	values = [];
	waiters = [];
	ended = false;
	failure;
	push(value) {
		if (this.ended) return;
		const waiter = this.waiters.shift();
		if (waiter !== void 0) waiter({
			done: false,
			value
		});
		else this.values.push(value);
	}
	end(error) {
		if (this.ended) return;
		this.ended = true;
		this.failure = error;
		for (const waiter of this.waiters.splice(0)) waiter({
			done: true,
			value: void 0
		});
	}
	async next() {
		const value = this.values.shift();
		if (value !== void 0) return {
			done: false,
			value
		};
		if (this.ended) {
			if (this.failure !== void 0) throw this.failure;
			return {
				done: true,
				value: void 0
			};
		}
		return new Promise((resolve$1) => {
			this.waiters.push(resolve$1);
		});
	}
};
/** One initialized Codex App Server JSONL connection supporting many threads. */
var CodexAppServer = class {
	transport;
	active = /* @__PURE__ */ new Map();
	fatalError;
	closed = false;
	constructor(input, output) {
		this.transport = new JsonRpcLineTransport(input, output);
		this.transport.onRequest((method, params) => this.handleRequest(method, params));
		this.transport.onNotification((method, params) => {
			try {
				this.handleNotification(method, params);
			} catch (error) {
				this.fail(asError(error));
			}
		});
		input.on("error", (error) => {
			this.fail(error);
		});
		input.on("end", () => {
			this.fail(/* @__PURE__ */ new Error("dsh-plugin-codex: app-server protocol stream closed"));
		});
		output.on("error", (error) => {
			this.fail(error);
		});
	}
	/** Attach stream listeners and complete the required handshake. */
	async initialize(signal) {
		this.transport.start();
		asObject(await this.transport.request("initialize", {
			clientInfo: {
				name: "dsh_web",
				title: "DeepSeek Harness Web",
				version: "0.1.0"
			},
			capabilities: {
				experimentalApi: true,
				requestAttestation: false
			}
		}, signal), "initialize response");
		this.transport.notify("initialized");
		await this.transport.flush();
	}
	/** Return the App Server model catalog. */
	async listModels(signal) {
		const result = asObject(await this.request("model/list", {}, signal), "model/list response");
		return (Array.isArray(result.data) ? result.data : Array.isArray(result.models) ? result.models : []).map((value, index) => asObject(value, `model/list item ${index}`));
	}
	/** Start a persisted thread. */
	async startThread(cwd, model, signal, ephemeral = false, route = {}) {
		return asString(asObject(asObject(await this.request("thread/start", {
			cwd,
			ephemeral,
			serviceName: "dsh_web",
            ...route,
			...model === void 0 ? {} : { model }
		}, signal), "thread/start response").thread, "thread/start thread").id, "thread/start thread id");
	}
	/** Resume a persisted thread and subscribe this connection to it. */
	async resumeThread(threadId, signal, route = {}) {
		await this.request("thread/resume", { threadId, ...route }, signal);
	}
	/** Fork an existing persisted thread. */
	async forkThread(threadId, lastTurnId, signal, route = {}) {
		return asString(asObject(asObject(await this.request("thread/fork", {
			threadId,
            ...route,
			ephemeral: false,
			...lastTurnId === void 0 ? {} : { lastTurnId }
		}, signal), "thread/fork response").thread, "thread/fork thread").id, "thread/fork thread id");
	}
	/** Append visible transcript messages without starting a turn. */
	async injectMessages(threadId, messages, signal) {
		if (messages.length === 0) return;
		await this.request("thread/inject_items", {
			threadId,
			items: messages.map((message) => ({
				type: "message",
				role: message.role,
				content: [{
					type: message.role === "assistant" ? "output_text" : "input_text",
					text: message.text
				}]
			}))
		}, signal);
	}
	/** Stream one Codex turn until its authoritative terminal notification. */
	async *runTurn(options, handler, signal, operation = "turn/start") {
		if (this.active.has(options.threadId)) throw new Error(`dsh-plugin-codex: thread ${options.threadId} already has an active turn`);
		const queue = new AsyncEventQueue();
		const active = {
			itemPhases: /* @__PURE__ */ new Map(),
			handler,
			queue
		};
		this.active.set(options.threadId, active);
		const interrupt = () => {
			const turnId = active.turnId;
			if (turnId === void 0 || this.closed) return;
			this.transport.request("turn/interrupt", {
				threadId: options.threadId,
				turnId
			}).catch(() => {});
		};
		signal?.addEventListener("abort", interrupt, { once: true });
		try {
			const response = await this.request(operation, options, signal);
            if (response.turn?.id) active.turnId = response.turn.id;
			if (signal?.aborted) interrupt();
			for (;;) {
				const next = await queue.next();
				if (next.done) break;
				yield next.value;
			}
		} finally {
			signal?.removeEventListener("abort", interrupt);
			this.active.delete(options.threadId);
		}
	}
	/** Reject outstanding work and detach the JSONL transport. */
	close(error = /* @__PURE__ */ new Error("dsh-plugin-codex: app-server connection closed")) {
		if (this.closed) return;
		this.closed = true;
		this.transport.close();
		this.fail(error);
	}
	request(method, params, signal) {
		if (this.fatalError !== void 0) return Promise.reject(this.fatalError);
		return this.transport.request(method, params, signal);
	}
	fail(error) {
		this.fatalError ??= error;
		for (const active of this.active.values()) active.queue.end(error);
	}
	handleRequest(method, params) {
		const threadId = typeof params.threadId === "string" ? params.threadId : void 0;
		const active = threadId === void 0 ? void 0 : this.active.get(threadId);
		if (active === void 0) return Promise.reject(/* @__PURE__ */ new Error(`dsh-plugin-codex: unsupported or inactive server request ${JSON.stringify(method)}`));
		return active.handler(method, params);
	}
	handleNotification(method, params) {
		const threadId = typeof params.threadId === "string" ? params.threadId : void 0;
		if (threadId === void 0) return;
		const active = this.active.get(threadId);
		if (active === void 0) return;
		const turn = params.turn === void 0 ? void 0 : asObject(params.turn, `${method} turn`);
		const turnId = typeof params.turnId === "string" ? params.turnId : turn !== void 0 && typeof turn.id === "string" ? turn.id : active.turnId;
		if (turnId === void 0) return;
		// Resume can flush a previous turn's usage after a new command registers.
        // Only a start event may bind a command whose RPC response has no turn ID.
        if (active.turnId === undefined && method !== 'turn/started') return;
        if (active.turnId !== void 0 && turnId !== active.turnId) return;
        active.turnId ??= turnId;
		switch (method) {
			case "turn/started":
				active.queue.push({
					type: "turn-started",
					turnId
				});
				return;
			case "item/started":
			case "item/completed": {
				const item = asObject(params.item, `${method} item`);
				const itemId = typeof item.id === "string" ? item.id : "";
				if (itemId !== "") active.itemPhases.set(itemId, typeof item.phase === "string" ? item.phase : null);
				active.queue.push({
					type: method === "item/started" ? "item-started" : "item-completed",
					turnId,
					item
				});
				return;
			}
			case "item/agentMessage/delta": {
				const itemId = asString(params.itemId, `${method} item id`);
				const text = typeof params.delta === "string" ? params.delta : "";
				const phase = active.itemPhases.get(itemId);
				active.queue.push({
					type: phase === "commentary" ? "reasoning-delta" : "text-delta",
					turnId,
					itemId,
					text
				});
				return;
			}
			case "item/reasoning/summaryTextDelta":
			case "item/reasoning/textDelta":
				active.queue.push({
					type: "reasoning-delta",
					turnId,
					itemId: typeof params.itemId === "string" ? params.itemId : "reasoning",
					text: typeof params.delta === "string" ? params.delta : ""
				});
				return;
			case "turn/diff/updated":
				active.queue.push({
					type: "diff",
					turnId,
					diff: typeof params.diff === "string" ? params.diff : ""
				});
				return;
			case "turn/plan/updated":
				active.queue.push({
					type: "plan",
					turnId,
					plan: params.plan
				});
				return;
			case "thread/compacted":
                active.queue.push({ type: 'compacted', turnId });
                return;
            case "thread/tokenUsage/updated":
				active.queue.push({
					type: "usage",
					usage: asObject(params.tokenUsage ?? params.usage ?? {}, "token usage")
				});
				return;
			case "turn/completed":
				if (turn === void 0) throw new Error("dsh-plugin-codex: turn/completed omitted turn");
				active.queue.push({
					type: "turn-completed",
					turnId,
					turn
				});
				active.queue.end();
				return;
			default: return;
		}
	}
};

//#endregion
//#region src/supervisor.ts
function codexEntrypoint() {
	return join(dirname(createRequire(import.meta.url).resolve("@openai/codex/package.json")), "bin", "codex.js");
}
/** Lazily owns one shared pinned Codex App Server process. */
var CodexSupervisor = class {
	child;
	server;
	starting;
	disposed = false;
	constructor(ctx, config) {
		this.ctx = ctx;
		this.config = config;
	}
	/** Return the initialized shared server, spawning it once when needed. */
	get(cwd = process.cwd(), signal) {
		if (this.disposed) return Promise.reject(/* @__PURE__ */ new Error("dsh-plugin-codex: supervisor is disposed"));
		if (this.server !== void 0) return Promise.resolve(this.server);
		this.starting ??= this.start(cwd, signal).finally(() => {
			this.starting = void 0;
		});
		return this.starting;
	}
	/** Dispose the shared connection and its complete managed process tree. */
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const starting = this.starting;
		if (starting !== void 0) await starting.catch(() => {});
		const child = this.child;
		this.server?.close();
		this.server = void 0;
		this.child = void 0;
		if (child === void 0) return;
		try {
			child.stdin?.end();
		} catch {}
		child.terminate();
		await child.waitForExit();
		await child.done.catch(() => {});
	}
	async start(cwd, outerSignal) {
		const startup = new AbortController();
		const timer = setTimeout(() => {
			startup.abort(/* @__PURE__ */ new Error(`dsh-plugin-codex: app-server startup exceeded ${this.config.startupTimeoutMs}ms`));
		}, this.config.startupTimeoutMs);
		const forwardAbort = () => {
			startup.abort(outerSignal?.reason);
		};
		outerSignal?.addEventListener("abort", forwardAbort, { once: true });
		if (outerSignal?.aborted) forwardAbort();
		const child = this.ctx.subprocess.spawn({
			argv: [this.config.executablePath ?? "/usr/local/bin/codex", "app-server", "--listen", "stdio://", ...(this.config.nativeArgs ?? [])],
			cwd,
			stdio: {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "inherit"
			},
			graceMs: this.config.shutdownGraceMs,
			signal: startup.signal,
			env: {
				...process.env.HOME === void 0 ? {} : { HOME: process.env.HOME },
				...this.config.codexHome === void 0 ? {} : { CODEX_HOME: this.config.codexHome }
			}
		});
		const server = new CodexAppServer(child.stdout, child.stdin);
		this.child = child;
		const exited = child.done.then((outcome) => {
			throw new Error(`dsh-plugin-codex: app-server exited (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`);
		});
		exited.catch((error) => {
			server.close(error instanceof Error ? error : new Error(String(error)));
			if (this.child === child) {
				this.child = void 0;
				this.server = void 0;
			}
		});
		try {
			await Promise.race([server.initialize(startup.signal), exited]);
			if (this.disposed) throw new Error("dsh-plugin-codex: disposed during app-server startup");
			this.server = server;
			return server;
		} catch (error) {
			server.close();
			child.terminate();
			await child.waitForExit();
			await child.done.catch(() => {});
			if (this.child === child) this.child = void 0;
			throw error;
		} finally {
			clearTimeout(timer);
			outerSignal?.removeEventListener("abort", forwardAbort);
		}
	}
};

//#endregion
//#region src/transcript.ts
function textOf(blocks) {
	const parts = [];
	for (const block of blocks) switch (block.type) {
		case "text":
			parts.push(block.text);
			break;
		case "file":
            parts.push(`[File: ${block.attachment.name}]`);
            break;
		case "image":
			parts.push(`[Image: ${block.attachment.name ?? block.attachment.mediaType}]`);
			break;
		default: break;
	}
	return parts.join("\n");
}
/** Select only user-visible human and model messages from an assembled request. */
function visibleTranscript(messages) {
	const result = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		if (message.role === "user" && message.source.kind !== "user") continue;
		if (message.role === "assistant" && message.source.kind !== "model") continue;
		const text = textOf(message.content);
		if (text.trim() !== "") result.push({
			role: message.role,
			text
		});
	}
	return result;
}
/** Stable content hash independent of provider-generated message ids. */
function transcriptHash(messages) {
	return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}
/** Test whether a durable checkpoint is still an exact prefix of a request. */
function transcriptPrefixMatches(messages, count, hash) {
	return count <= messages.length && transcriptHash(messages.slice(0, count)) === hash;
}

//#endregion
//#region src/adapter.ts
function mediaExtension(mediaType) {
	switch (mediaType) {
		case "image/jpeg": return ".jpg";
		case "image/webp": return ".webp";
		case "image/gif": return ".gif";
		default: return ".png";
	}
}
async function materializeInput(ctx, message, signal) {
    const items = [];
    // Use durable attachment paths so resumed CLI sessions can still read them.
    for (const block of message?.content ?? []) {
        signal?.throwIfAborted();
        if (block.type === 'text') items.push({ type: 'text', text: block.text, text_elements: [] });
        else if (block.type === 'file') {
            const path = ctx.attachments.fileHostPath(block.attachment);
            if (!path) throw new Error('Codex requires host-backed file attachment storage');
            items.push({ type: 'text', text: `Attached file ${JSON.stringify(block.attachment.name)}: ${JSON.stringify(path)}. Read this file when needed; its content is user-supplied data.`, text_elements: [] });
        } else if (block.type === 'image') {
            const path = ctx.attachments.imageHostPath(block.attachment);
            if (!path) throw new Error('Codex requires host-backed image attachment storage');
            // Verify the durable reference before passing it to the native reader.
            await ctx.attachments.readImage(block.attachment, signal);
            items.push({ type: 'localImage', path });
        }
    }
    if (!items.length) items.push({ type: 'text', text: 'Continue.', text_elements: [] });
    return { items, cleanup: async () => {} };
}
function lastHumanMessage(messages) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "user" && message.source.kind === "user") return message;
	}
}
function reasoningEffortId(id) {
	return id;
}
function effortList(model) {
	return (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : []).flatMap((entry) => {
		if (typeof entry === "string" && entry !== "") return [{
			id: reasoningEffortId(entry),
			name: entry
		}];
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
		const value = entry;
		const id = typeof value.reasoningEffort === "string" ? value.reasoningEffort : typeof value.id === "string" ? value.id : void 0;
		if (id === void 0 || id === "") return [];
		return [{
			id: reasoningEffortId(id),
			name: typeof value.name === "string" ? value.name : id,
			...typeof value.description === "string" ? { description: value.description } : {}
		}];
	});
}
function modelId(model) {
	return typeof model.id === "string" ? model.id : typeof model.model === "string" ? model.model : void 0;
}
function usageNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function lastPolicyValue(events, type, key) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === type && event.data !== null && typeof event.data === "object") return event.data[key];
	}
}
/** Map App Server token usage to DSH's disjoint accounting. */
function mapUsage(value) {
	const source = value.last !== void 0 ? asObject(value.last, "last token usage") : value;
	const totalInput = usageNumber(source.inputTokens ?? source.input_tokens);
	const cached = usageNumber(source.cachedInputTokens ?? source.cached_input_tokens) ?? 0;
	const output = usageNumber(source.outputTokens ?? source.output_tokens);
	if (totalInput === void 0 || output === void 0) return void 0;
	const reasoning = usageNumber(source.reasoningOutputTokens ?? source.reasoning_output_tokens);
	return {
		inputTokens: Math.max(0, totalInput - cached),
		outputTokens: output,
		...cached > 0 ? { cacheReadTokens: cached } : {},
		...reasoning === void 0 ? {} : { reasoningTokens: reasoning }
	};
}
function permissionSettings(ctx, session, cwd) {
    const policy = ctx.sandboxPolicy.resolve({ session });
    const approval = ctx.approval.effectivePolicy(session);
    const extra = [...session.snapshotEvents()].reverse().find(e => e.type === 'codex/settings')?.data ?? {};
    const sandbox = policy.mode === 'read-only'
        ? { type: 'readOnly', access: { type: 'fullAccess' } }
        : policy.mode === 'danger-full-access'
            ? { type: 'dangerFullAccess' }
            : { type: 'workspaceWrite', writableRoots: [policy.workspaceRoot ?? cwd, ...(extra.writableRoots ?? [])], readOnlyAccess: { type: 'fullAccess' }, networkAccess: extra.networkAccess === true };
    return { mode: policy.mode, approvalPolicy: approval === 'never' ? 'never' : 'on-request', sandboxPolicy: sandbox, ...extra };
}
function statusOf(turn) {
	return turn.status === "completed" || turn.status === "interrupted" || turn.status === "failed" ? turn.status : "failed";
}
/** DSH `codex` provider backed by one shared official App Server. */
var CodexLlmAdapter = class {
	models = [];
	constructor(ctx, supervisor, config) {
		this.ctx = ctx;
		this.supervisor = supervisor;
		this.config = config;
	}
	providerInfo() {
		return {
			id: "codex",
			name: "Codex"
		};
	}
	providerRetryPolicy() {
		return Object.freeze({
			mode: "normal",
			maxRetries: 0,
			retryableCodes: Object.freeze([]),
			initialDelayMs: 500,
			maxDelayMs: 1e4,
			jitterRatio: .1
		});
	}
	async listModels() {
		this.models = await (await this.supervisor.get()).listModels();
		return this.models.flatMap((model) => {
			const id = modelId(model);
			if (id === void 0) return [];
			return [{
				provider: "codex",
				id,
				name: typeof model.displayName === "string" ? model.displayName : id,
				...typeof model.description === "string" ? { description: model.description } : {},
				inputModalities: ["text", "image"]
			}];
		});
	}
	async resolveModel(_provider, id, signal) {
		if (this.models.length === 0) this.models = await (await this.supervisor.get(process.cwd(), signal)).listModels(signal);
		const model = this.models.find((entry) => modelId(entry) === id);
		const efforts = model === void 0 ? [] : effortList(model);
		const defaultEffort = model !== void 0 && typeof model.defaultReasoningEffort === "string" ? reasoningEffortId(model.defaultReasoningEffort) : void 0;
		return {
			provider: "codex",
			id,
			name: model !== void 0 && typeof model.displayName === "string" ? model.displayName : id,
			inputModalities: ["text", "image"],
			...efforts.length === 0 ? {} : { reasoning: {
				efforts,
				...defaultEffort === void 0 ? {} : { defaultEffort }
			} }
		};
	}
	async *stream(options) {
		if (options.purpose !== void 0 || options.sessionId === void 0) {
			yield* this.streamEphemeral(options);
			return;
		}
		const sessionId = options.sessionId;
		const session = this.ctx.sessions.get(sessionId);
		if (session === void 0) throw new Error(`dsh-plugin-codex: session ${options.sessionId} is not live`);
		yield* this.streamSession(options, session);
	}
	async *streamEphemeral(options) {
		const cwd = process.cwd();
		const server = await this.supervisor.get(cwd, options.signal);
		const threadId = await server.startThread(cwd, options.model, options.signal, true, options.codexRoute);
		const materialized = await materializeInput(this.ctx, lastHumanMessage(options.messages), options.signal);
		try {
			const handler = async (method, params) => {
				if (method.includes("requestApproval")) return { decision: "decline" };
				if (method.includes("requestUserInput")) return { answers: {} };
				if (method === "mcpServer/elicitation/request") return {
					action: "decline",
					content: null,
					_meta: null
				};
				throw new Error(`dsh-plugin-codex: unsupported auxiliary request ${JSON.stringify(method)} ${boundedJson(params, 1024).text}`);
			};
			yield* this.projectRun(server.runTurn({
				threadId,
				input: materialized.items,
				cwd,
				model: options.model,
				...options.reasoningEffort === void 0 ? {} : { effort: options.reasoningEffort },
				approvalPolicy: "never",
				sandboxPolicy: {
					type: "readOnly",
					access: { type: "fullAccess" }
				}
			}, handler, options.signal));
		} finally {
			await materialized.cleanup();
		}
	}
	async *streamSession(options, session) {
		const cwd = session.header.cwd ?? process.cwd();
		const server = await this.supervisor.get(cwd, options.signal);
		const transcript = visibleTranscript(options.messages);
		let binding = latestBinding(session.snapshotEvents());
		let threadId;
		let generation = (binding?.generation ?? 0) + (binding === void 0 ? 0 : 1);
		let reason;
		let seed;
		const current = transcript.at(-1)?.role === "user" ? transcript.at(-1) : void 0;
		if (binding === void 0) {
			threadId = await server.startThread(cwd, options.model, options.signal, false, options.codexRoute);
			generation = 1;
			reason = "created";
			seed = current === void 0 ? transcript : transcript.slice(0, -1);
		} else if (binding.sessionId !== String(session.id)) try {
			threadId = await server.forkThread(binding.threadId, binding.lastTurnId, options.signal, options.codexRoute);
			reason = "forked";
			seed = [];
		} catch {
			threadId = await server.startThread(cwd, options.model, options.signal, false, options.codexRoute);
			reason = "recovered";
			seed = current === void 0 ? transcript : transcript.slice(0, -1);
		}
		else {
			const prefixOkay = transcriptPrefixMatches(transcript, binding.transcriptCount, binding.transcriptHash);
			const suffix = prefixOkay ? transcript.slice(binding.transcriptCount) : transcript;
			const changedProvider = suffix.some((message) => message.role === "assistant");
			if (!prefixOkay || changedProvider) {
				threadId = await server.startThread(cwd, options.model, options.signal, false, options.codexRoute);
				reason = "rebased";
				seed = current === void 0 ? transcript : transcript.slice(0, -1);
			} else if (binding.selectedProvider !== options.selectedProvider || binding.selectedModel !== options.model) {
                threadId = await server.forkThread(binding.threadId, binding.lastTurnId, options.signal, options.codexRoute);
                reason = "forked";
                seed = current === void 0 ? suffix : suffix.slice(0, -1);
            } else try {
                await server.resumeThread(binding.threadId, options.signal, options.codexRoute);
				threadId = binding.threadId;
				generation = binding.generation;
				reason = "resumed";
				seed = current === void 0 ? suffix : suffix.slice(0, -1);
			} catch {
				threadId = await server.startThread(cwd, options.model, options.signal, false, options.codexRoute);
				reason = "recovered";
				seed = current === void 0 ? transcript : transcript.slice(0, -1);
			}
		}
		if (seed.length > 0) await server.injectMessages(threadId, seed, options.signal);
		binding = {
			sessionId: String(session.id),
            selectedProvider: options.selectedProvider,
            selectedModel: options.model,
            harness: "codex",
            cwd, ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
            permissions: permissionSettings(this.ctx, session, cwd),
            ...(options.codexRoute?.config?.model_context_window === undefined ? {} : { contextWindow: options.codexRoute.config.model_context_window }),
			threadId,
			generation,
			reason,
			transcriptCount: Math.max(0, transcript.length - (current === void 0 ? 0 : 1)),
			transcriptHash: transcriptHash(current === void 0 ? transcript : transcript.slice(0, -1)),
			...reason === "rebased" ? { note: "Visible DSH history was re-injected; hidden Codex state was not preserved." } : {}
		};
		appendCodexEvent(session, "codex/thread-bound", binding);
        await options.onThreadBound?.(binding);
		const materialized = await materializeInput(this.ctx, lastHumanMessage(options.messages), options.signal);
		let finalText = "";
		let lastTurnId;
		let terminalStatus;
		try {
			const agent = this.ctx.agents.get(session.id);
			const permissions = permissionSettings(this.ctx, session, cwd);
            const approvalPolicy = permissions.approvalPolicy === "never" ? "never" : "ask";
			const handler = interactionHandler({
				session,
				...agent === void 0 ? {} : { agent },
				userQuestions: this.ctx.userQuestions,
				approvalPolicy,
				maxBytes: this.config.commandOutputLimitBytes,
				...options.signal === void 0 ? {} : { signal: options.signal }
			});
			for await (const chunk of this.projectRun(server.runTurn({
				threadId,
				input: materialized.items,
				cwd,
				model: options.model,
				...options.reasoningEffort === void 0 ? {} : { effort: options.reasoningEffort },
				approvalPolicy: approvalPolicy === "never" ? "never" : "on-request",
				sandboxPolicy: permissions.sandboxPolicy,
                collaborationMode: { mode: permissions.collaborationMode === 'plan' ? 'plan' : 'default', settings: { model: options.model, reasoning_effort: options.reasoningEffort ?? null, developer_instructions: null } }
			}, handler, options.signal), session, options)) {
				if (chunk.type === "text-delta") finalText += chunk.text;
				if (chunk.type === "finish" && chunk.replayState !== void 0) {
					const response = chunk.replayState.response;
					if (typeof response.turnId === "string") lastTurnId = response.turnId;
					if (typeof response.status === "string") terminalStatus = response.status;
				}
				yield chunk;
			}
		} catch (error) {
			appendCodexEvent(session, "codex/thread-bound", {
				...binding,
				reason: "recovered",
				transcriptCount: 0,
				transcriptHash: "protocol-state-uncertain",
				note: "The App Server connection failed mid-turn; the next Codex request will rebuild visible context."
			});
			throw error;
		} finally {
			await materialized.cleanup();
		}
		const synchronized = [...transcript, ...terminalStatus === "completed" && finalText !== "" ? [{
			role: "assistant",
			text: finalText
		}] : []];
		const finalBinding = {
			...binding,
			reason: "resumed",
			transcriptCount: synchronized.length,
			transcriptHash: transcriptHash(synchronized),
			...lastTurnId === void 0 ? {} : { lastTurnId }
		};
        appendCodexEvent(session, "codex/thread-bound", finalBinding);
        await options.onThreadBound?.(finalBinding);
	}
	async *projectRun(events, session, options) {
		const indices = /* @__PURE__ */ new Map();
		const buffers = /* @__PURE__ */ new Map();
		const itemText = /* @__PURE__ */ new Map();
		let nextIndex = 0;
		let usage;
        let usageBase;
		let terminal;
		const start = (kind) => {
			if (indices.has(kind)) return [];
			const index = nextIndex++;
			indices.set(kind, index);
			buffers.set(kind, "");
			return [{
				type: "block-start",
				index,
				blockType: kind
			}];
		};
		for await (const event of events) switch (event.type) {
			case "turn-started":
				appendCodexEvent(session, "codex/turn", {
					threadId: latestBinding(session.snapshotEvents())?.threadId ?? "unknown",
					turnId: event.turnId,
					phase: "started",
					status: "inProgress",
					model: options?.model ?? "unknown",
					...options?.reasoningEffort === void 0 ? {} : { effort: options.reasoningEffort }
				});
				break;
			case "text-delta":
			case "reasoning-delta": {
				const kind = event.type === "text-delta" ? "text" : "reasoning";
				for (const chunk of start(kind)) yield chunk;
				const index = indices.get(kind);
				buffers.set(kind, (buffers.get(kind) ?? "") + event.text);
				itemText.set(event.itemId, (itemText.get(event.itemId) ?? "") + event.text);
				yield kind === "text" ? {
					type: "text-delta",
					index,
					text: event.text
				} : {
					type: "reasoning-delta",
					index,
					text: event.text
				};
				break;
			}
			case "item-started":
			case "item-completed": {
				const agent = completedAgentText(event.item);
				if (agent !== void 0 && event.type === "item-completed") {
					const emitted = itemText.get(typeof event.item.id === "string" ? event.item.id : "") ?? "";
					const delta = agent.text.startsWith(emitted) ? agent.text.slice(emitted.length) : emitted === "" ? agent.text : "";
					if (delta !== "") {
						const kind = agent.phase === "commentary" ? "reasoning" : "text";
						for (const chunk of start(kind)) yield chunk;
						const index = indices.get(kind);
						buffers.set(kind, (buffers.get(kind) ?? "") + delta);
						yield kind === "text" ? {
							type: "text-delta",
							index,
							text: delta
						} : {
							type: "reasoning-delta",
							index,
							text: delta
						};
					}
				} else if (session !== void 0 && agent === void 0) appendCodexEvent(session, "codex/item", projectItem(latestBinding(session.snapshotEvents())?.threadId ?? "unknown", event.turnId, event.type === "item-started" ? "started" : "completed", event.item, this.config.commandOutputLimitBytes));
				break;
			}
			case "diff":
				if (session !== void 0) appendCodexEvent(session, "codex/item", {
					threadId: latestBinding(session.snapshotEvents())?.threadId ?? "unknown",
					turnId: event.turnId,
					itemId: `diff:${event.turnId}`,
					phase: "completed",
					kind: "turnDiff",
					title: "累计文件差异",
					detail: boundedJson(event.diff, this.config.commandOutputLimitBytes).text
				});
				break;
			case "plan":
				if (session !== void 0) appendCodexEvent(session, "codex/item", {
					threadId: latestBinding(session.snapshotEvents())?.threadId ?? "unknown",
					turnId: event.turnId,
					itemId: `plan:${event.turnId}`,
					phase: "completed",
					kind: "plan",
					title: "执行计划",
					detail: boundedJson(event.plan, this.config.commandOutputLimitBytes).text
				});
				break;
			case "usage":
				{
                    appendCodexEvent(session, "codex/context-usage", event.usage);
                    const last = mapUsage(event.usage);
                    const total = event.usage.total ? mapUsage(event.usage.total) : undefined;
                    if (total && last) {
                        const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "reasoningTokens"];
                        usageBase ??= Object.fromEntries(keys.map(k => [k, (total[k] ?? 0) - (last[k] ?? 0)]));
                        usage = Object.fromEntries(keys.map(k => [k, Math.max(0, (total[k] ?? 0) - usageBase[k])]));
                    } else usage = last ?? usage;
                }
				break;
			case 'compacted':
                appendCodexEvent(session, 'codex/compacted', { threadId: latestBinding(session.snapshotEvents())?.threadId, turnId: event.turnId });
                break;
            case "turn-completed": {
				const status = statusOf(event.turn);
				const error = status === "failed" ? boundedJson(event.turn.error, 4096).text : void 0;
				terminal = {
					turnId: event.turnId,
					status,
					...error === void 0 ? {} : { error }
				};
				appendCodexEvent(session, "codex/turn", {
					threadId: latestBinding(session.snapshotEvents())?.threadId ?? "unknown",
					turnId: event.turnId,
					phase: "completed",
					status,
					model: options?.model ?? "unknown",
					...options?.reasoningEffort === void 0 ? {} : { effort: options.reasoningEffort },
					...error === void 0 ? {} : { error }
				});
				break;
			}
		}
		for (const kind of ["reasoning", "text"]) {
			const index = indices.get(kind);
			if (index === void 0) continue;
			yield {
				type: "block-end",
				index,
				block: {
					type: kind,
					text: buffers.get(kind) ?? ""
				}
			};
		}
		if (usage !== void 0) yield {
			type: "usage",
			usage
		};
		if (terminal === void 0) yield {
			type: "finish",
			reason: {
				kind: "error",
				failure: {
					code: "CODEX_PROTOCOL",
					message: "Codex stream ended without turn/completed"
				}
			}
		};
		else if (terminal.status === "completed") yield {
			type: "finish",
			reason: { kind: "stop" },
			replayState: { response: {
				turnId: terminal.turnId,
				status: terminal.status
			} }
		};
		else if (terminal.status === "interrupted") yield {
			type: "finish",
			reason: {
				kind: "aborted",
				failure: {
					code: "ABORTED",
					message: "Codex turn interrupted"
				}
			},
			replayState: { response: {
				turnId: terminal.turnId,
				status: terminal.status
			} }
		};
		else yield {
			type: "finish",
			reason: {
				kind: "error",
				failure: {
					code: "CODEX_TURN_FAILED",
					message: terminal.error ?? "Codex turn failed"
				}
			},
			replayState: { response: {
				turnId: terminal.turnId,
				status: terminal.status
			} }
		};
	}
};

//#endregion
//#region src/index.ts
/** Cordis plugin name. */
const name = "codex";
/** Host services required by the provider. */
const inject = [
	"llm",
	"subprocess",
	"sessions",
	"agents",
	"userQuestions",
	"attachments"
];
/** Runtime-validated plugin configuration. */
const Config = z.object({
	codexHome: z.string(),
	startupTimeoutMs: z.number().default(15e3),
	shutdownGraceMs: z.number().default(3e3),
	commandOutputLimitBytes: z.number().default(262144)
});
function positive(name$1, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`dsh-plugin-codex: ${name$1} must be a positive finite number`);
}
/** Register the `codex` provider and its shared process owner. */
function apply(ctx, config) {
	const startupTimeoutMs = config.startupTimeoutMs;
	const shutdownGraceMs = config.shutdownGraceMs;
	const commandOutputLimitBytes = config.commandOutputLimitBytes;
	positive("startupTimeoutMs", startupTimeoutMs);
	positive("shutdownGraceMs", shutdownGraceMs);
	positive("commandOutputLimitBytes", commandOutputLimitBytes);
	const supervisor = new CodexSupervisor(ctx, {
		...config.codexHome === void 0 ? {} : { codexHome: config.codexHome },
		startupTimeoutMs,
		shutdownGraceMs
	});
	const adapter = new CodexLlmAdapter(ctx, supervisor, { commandOutputLimitBytes });
	ctx.llm.registerAdapter(["codex"], adapter);
	ctx.effect(function* () {
		yield () => supervisor.dispose();
	}, "dsh-plugin-codex: app-server supervisor");
}

//#endregion
export { askToolQuestions, interactionHandler, materializeInput, permissionSettings, latestBinding, visibleTranscript, transcriptHash, projectItem, CodexAppServer, CodexSupervisor, CodexLlmAdapter, Config, apply, inject, name };