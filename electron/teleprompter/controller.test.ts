import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	directory: "",
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	callbacks: new Map<string, Array<() => void>>(),
	capturing: false,
	window: null as { id: number; hidden: boolean } | null,
	workerKills: 0,
	workerStarts: 0,
	downloads: 0,
	packagedRendererBase: null as string | null,
	senderUrl: "file:///repo/dist/index.html?windowType=hud-overlay",
}));
vi.mock("../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => mocks.packagedRendererBase,
}));
vi.mock("electron", () => ({
	app: {
		getPath: () => mocks.directory,
		getAppPath: () => "/repo",
		on: (event: string, callback: () => void) => {
			const callbacks = mocks.callbacks.get(event) ?? [];
			callbacks.push(callback);
			mocks.callbacks.set(event, callbacks);
		},
	},
	BrowserWindow: { getAllWindows: () => [] },
	ipcMain: {
		handle: (name: string, callback: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(name, callback),
		on: vi.fn(),
	},
	MessageChannelMain: class {
		port1 = { on: vi.fn(), start: vi.fn(), close: vi.fn(), postMessage: vi.fn() };
		port2 = {};
	},
	utilityProcess: {
		fork: () => {
			mocks.workerStarts++;
			return {
				kill: () => {
					mocks.workerKills++;
				},
				postMessage: vi.fn(),
				on: (event: string, callback: (message: unknown) => void) => {
					if (event === "message") queueMicrotask(() => callback({ type: "ready" }));
				},
			};
		},
	},
}));
vi.mock("./window", () => ({
	isPrompterCaptureActive: () => mocks.capturing,
	getPrompterCaptureWindow: () => mocks.window,
	showPrompterWindow: () => {
		mocks.window ??= { id: 17, hidden: true };
	},
	destroyPrompterWindow: () => {
		mocks.window = null;
	},
	hidePrompterWindow: vi.fn(),
	updatePrompterWindow: vi.fn(),
	setPrompterCloseHandler: vi.fn(),
}));
vi.mock("./model", () => ({
	createPrompterModelStore: () => ({
		status: async () => ({ exists: true }),
		download: () => {
			mocks.downloads++;
		},
	}),
}));

async function call(name: string, ...args: unknown[]) {
	const frame = {};
	const event = {
		sender: {
			id: 1,
			mainFrame: frame,
			getURL: () => mocks.senderUrl,
		},
		senderFrame: frame,
	};
	return await mocks.handlers.get(`prompter:${name}`)!(event, ...args);
}
beforeEach(async () => {
	vi.resetModules();
	mocks.handlers.clear();
	mocks.callbacks.clear();
	mocks.capturing = false;
	mocks.window = null;
	mocks.workerKills = 0;
	mocks.workerStarts = 0;
	mocks.downloads = 0;
	mocks.packagedRendererBase = null;
	mocks.senderUrl = "file:///repo/dist/index.html?windowType=hud-overlay";
	mocks.directory = await fs.mkdtemp(path.join(os.tmpdir(), "captor-prompter-controller-"));
	const { registerTeleprompterHandlers } = await import("./controller");
	registerTeleprompterHandlers();
	await call("save", { text: "大家好，欢迎使用 Captor" });
});
afterEach(async () => {
	for (const callback of mocks.callbacks.get("before-quit") ?? []) callback();
	await fs.rm(mocks.directory, { recursive: true, force: true });
});

describe("packaged recording entry trust", () => {
	it.each([false, true])("arms the packaged editor with script=%s", async (withScript) => {
		mocks.packagedRendererBase = "http://127.0.0.1:49152";
		mocks.senderUrl = `${mocks.packagedRendererBase}/?windowType=editor`;
		await call("arm", withScript);
		const state = (await call("get")) as { armed: boolean; phase: string };
		expect(state.armed).toBe(withScript);
		expect(state.phase).toBe(withScript ? "ready" : "idle");
		expect(mocks.window !== null).toBe(withScript);
	});
	it.each([
		"http://127.0.0.1:49153/?windowType=editor",
		"http://localhost:49152/?windowType=editor",
		"http://127.0.0.1:49152/other?windowType=editor",
		"http://user@127.0.0.1:49152/?windowType=editor",
		"http://127.0.0.1:49152/?windowType=editor&windowType=hud-overlay",
		"http://127.0.0.1:49152/?windowType=teleprompter",
	])("rejects an unauthorized arm request from %s", async (url) => {
		mocks.packagedRendererBase = "http://127.0.0.1:49152";
		mocks.senderUrl = url;
		await expect(call("arm", true)).rejects.toThrow("Untrusted prompter request.");
		expect(mocks.window).toBeNull();
	});
	it("does not trust a loopback URL before the packaged server exists", async () => {
		mocks.senderUrl = "http://127.0.0.1:49152/?windowType=editor";
		await expect(call("arm", false)).rejects.toThrow("Untrusted prompter request.");
	});
	it("rejects subframes even when the packaged document URL matches", async () => {
		mocks.packagedRendererBase = "http://127.0.0.1:49152";
		const { isTrustedPrompterSender } = await import("./controller");
		const mainFrame = {};
		expect(
			isTrustedPrompterSender(
				{
					sender: {
						mainFrame,
						getURL: () => `${mocks.packagedRendererBase}/?windowType=editor`,
					},
					senderFrame: {},
				} as Parameters<typeof isTrustedPrompterSender>[0],
				["editor"],
			),
		).toBe(false);
	});
});

describe("prompter lifecycle boundaries", () => {
	it("cleans each quit attempt even after an earlier quit was cancelled", async () => {
		await call("rehearse");
		await call("recognition-start");
		for (const callback of mocks.callbacks.get("before-quit") ?? []) callback();
		expect(mocks.window).toBeNull();
		expect(((await call("get")) as { phase: string }).phase).toBe("idle");
		await call("rehearse");
		await call("recognition-start");
		for (const callback of mocks.callbacks.get("before-quit") ?? []) callback();
		expect(mocks.window).toBeNull();
		expect(mocks.workerKills).toBe(2);
	});
	it("rejects creating a prompt after the capture filter was built but can reshow its existing window", async () => {
		mocks.capturing = true;
		await expect(call("show")).rejects.toThrow("before starting");
		mocks.window = { id: 17, hidden: true };
		await expect(call("show")).resolves.toBeUndefined();
		expect(mocks.window.id).toBe(17);
	});
	it("retains the warmed model through pause and rejects cleanup from an old consumer", async () => {
		await call("arm", true);
		await call("phase", "preparing");
		const warm = await call("recognition-start");
		await call("phase", "recording");
		const recording = await call("recognition-start");
		await call("recognition-stop", warm);
		expect(mocks.workerKills).toBe(0);
		await call("phase", "paused");
		await call("recognition-stop", recording);
		expect(mocks.workerKills).toBe(0);
		await call("phase", "recording");
		const resumed = await call("recognition-start");
		expect(mocks.workerStarts).toBe(1);
		expect(resumed).not.toBe(recording);
		await call("recognition-stop", recording);
		expect(mocks.workerKills).toBe(0);
		await call("recognition-stop", resumed);
		expect(mocks.workerKills).toBe(1);
	});
	it("blocks model replacement while a recognizer has the model open", async () => {
		await call("rehearse");
		await call("recognition-start");
		await expect(call("download-model")).rejects.toThrow("Stop voice following");
		expect(mocks.downloads).toBe(0);
		await call("stop-rehearsal");
		await call("download-model");
		expect(mocks.downloads).toBe(1);
	});
});
