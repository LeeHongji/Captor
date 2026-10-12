import { EventEmitter } from "node:events";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
const m = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: m.spawn }));
vi.mock("../ipc/paths/binaries", () => ({
	getPrebundledNativeHelperPath: () => "/bundled/cursor",
}));
let probe: typeof import("./mouseTest");
let owner: WebContents;
let stdout: EventEmitter;
let stderr: EventEmitter;
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	m.spawn.mockReturnValue(Object.assign(new EventEmitter(), { stdout, stderr, kill: m.kill }));
	owner = Object.assign(new EventEmitter(), { id: 1 }) as unknown as WebContents;
	probe = await import("./mouseTest");
});
afterEach(() => {
	probe.stopSetupMouseTest();
	vi.useRealTimers();
});
it("distinguishes no physical click from an unavailable event tap", async () => {
	const result = probe.testSetupMouse(owner);
	vi.advanceTimersByTime(10000);
	expect(await result).toBe("no-events");
	expect(m.kill).toHaveBeenCalledOnce();
});
it("reports a confirmed event-tap failure separately", async () => {
	const result = probe.testSetupMouse(owner);
	stderr.emit(
		"data",
		Buffer.from("Mouse interaction event tap unavailable; click telemetry disabled\n"),
	);
	expect(await result).toBe("unavailable");
});
it("accepts a real mouse-down line even when the stdout line is split", async () => {
	const result = probe.testSetupMouse(owner);
	stdout.emit("data", Buffer.from("INTERACTION:mouse"));
	stdout.emit("data", Buffer.from("down:1\n"));
	expect(await result).toBe("detected");
	expect(probe.hasSetupMouseTest()).toBe(false);
});
it("keeps the helper stdin alive and cleans up when the owner navigates", async () => {
	const result = probe.testSetupMouse(owner);
	expect(m.spawn).toHaveBeenCalledWith("/bundled/cursor", [], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	owner.emit("did-start-navigation");
	expect(await result).toBe("cancelled");
	expect(m.kill).toHaveBeenCalledOnce();
});
