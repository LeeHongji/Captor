import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
const m = vi.hoisted(() => ({ fork: vi.fn(), kill: vi.fn(), post: vi.fn(), send: vi.fn() }));
let child: EventEmitter;
vi.mock("electron", () => ({
	app: { getAppPath: () => "/app", getPath: () => "/profile" },
	utilityProcess: { fork: m.fork },
	MessageChannelMain: class {
		port1 = { on: vi.fn(), start: vi.fn(), close: vi.fn(), postMessage: m.post };
		port2 = {};
	},
}));
let voice: typeof import("./voiceTest");
let owner: WebContents;
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	child = Object.assign(new EventEmitter(), { kill: m.kill, postMessage: vi.fn() });
	m.fork.mockReturnValue(child);
	owner = Object.assign(new EventEmitter(), {
		id: 17,
		isDestroyed: () => false,
		send: m.send,
	}) as unknown as WebContents;
	voice = await import("./voiceTest");
});
afterEach(() => {
	voice.stopSetupVoiceTest();
	vi.useRealTimers();
});
it("cancels worker startup promptly when the test is stopped before ready", async () => {
	const pending = voice.startSetupVoiceTest(owner, "zh");
	const rejection = expect(pending).rejects.toThrow("voice-test-cancelled");
	voice.stopSetupVoiceTest(17);
	await rejection;
	expect(m.kill).toHaveBeenCalledOnce();
	expect(voice.hasSetupVoiceTest()).toBe(false);
});
it("cleans up on navigation and does not leave a pending startup promise", async () => {
	const pending = voice.startSetupVoiceTest(owner, "en");
	const rejection = expect(pending).rejects.toThrow();
	owner.emit("did-start-navigation");
	await rejection;
	expect(owner.listenerCount("destroyed")).toBe(0);
	expect(m.kill).toHaveBeenCalledOnce();
});
it("rejects foreign ownership and drops invalid audio without sending it to the worker", async () => {
	const pending = voice.startSetupVoiceTest(owner, "zh");
	child.emit("message", { type: "ready" });
	const { session } = await pending;
	voice.pushSetupVoiceAudio(18, session, new Float32Array(160));
	voice.pushSetupVoiceAudio(17, "wrong", new Float32Array(160));
	voice.pushSetupVoiceAudio(17, session, new Float32Array([NaN]));
	expect(m.post).not.toHaveBeenCalled();
	voice.stopSetupVoiceTest(18, session);
	expect(voice.hasSetupVoiceTest()).toBe(true);
	voice.pushSetupVoiceAudio(17, session, new Float32Array(160));
	expect(m.post).toHaveBeenCalledOnce();
});
it("times out a worker that never becomes ready", async () => {
	const pending = voice.startSetupVoiceTest(owner, "zh");
	const rejection = expect(pending).rejects.toThrow("voice-start-timeout");
	vi.advanceTimersByTime(20000);
	await rejection;
	expect(m.kill).toHaveBeenCalledOnce();
});
