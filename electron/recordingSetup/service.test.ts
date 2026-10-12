import type { SetupRecord, SetupSnapshot, SetupActionResult } from "../../src/types/recordingSetup";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	record: null as SetupRecord | null,
	capturing: false,
	path: null as string | null,
	trusted: true,
	dirty: false,
	ax: false,
	media: "denied",
	windows: [] as Array<{ isDestroyed(): boolean; webContents: { getURL(): string } }>,
	ask: vi.fn(),
	sources: vi.fn(),
	axCheck: vi.fn(),
	shell: vi.fn(),
	exec: vi.fn(),
	send: vi.fn(),
	relaunch: vi.fn(),
	quit: vi.fn(),
	prefs: "{}",
}));
vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getVersion: () => "0.0.4",
		getAppPath: () => "/Applications/Captor.app/Contents/Resources/app.asar",
		on: vi.fn(),
		relaunch: m.relaunch,
		quit: m.quit,
	},
	BrowserWindow: { getAllWindows: () => m.windows },
	ipcMain: {
		handle: (name: string, fn: (...args: unknown[]) => unknown) => m.handlers.set(name, fn),
		on: (name: string, fn: (...args: unknown[]) => unknown) => m.handlers.set(name, fn),
	},
	desktopCapturer: { getSources: m.sources },
	shell: { openExternal: m.shell },
	systemPreferences: {
		isTrustedAccessibilityClient: m.axCheck,
		getMediaAccessStatus: () => m.media,
		askForMediaAccess: m.ask,
	},
}));
vi.mock("node:child_process", () => ({
	execFile: Object.assign(vi.fn(), {
		[Symbol.for("nodejs.util.promisify.custom")]: async (
			file: string,
			args: string[],
			options: unknown,
		) => {
			m.exec(file, args, options);
			return { stdout: "", stderr: 'designated => cdhash H"candidate"' };
		},
	}),
}));
vi.mock("node:fs/promises", () => ({
	default: {
		access: vi.fn(async () => undefined),
		readFile: vi.fn(async () => m.prefs),
		stat: vi.fn(async () => {
			throw Error("ENOENT");
		}),
	},
}));
vi.mock("node:os", () => ({ default: { homedir: () => "/Users/test", release: () => "24.0" } }));
vi.mock("../appSettingsStore", () => ({
	readAppSetting: () => m.record,
	writeAppSetting: (_: string, record: unknown) => {
		m.record = record;
	},
}));
vi.mock("../ipc/paths/binaries", () => ({
	getPrebundledNativeHelperPath: (name: string) => `/bin/${name}`,
}));
vi.mock("../ipc/ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "/bin/ffmpeg" }));
vi.mock("../ipc/constants", () => ({ RECORDINGS_SETTINGS_FILE: "/prefs" }));
vi.mock("../ipc/utils", () => ({
	getRecordingsDir: async () => "/recordings",
	getMacPrivacySettingsUrl: (kind: string) => `settings:${kind}`,
}));
vi.mock("../ipc/state", () => ({
	get nativeScreenRecordingActive() {
		return m.capturing;
	},
	windowsNativeCaptureActive: false,
	ffmpegScreenRecordingActive: false,
	currentRecordingSession: null,
	get currentVideoPath() {
		return m.path;
	},
}));
vi.mock("../windows", () => ({ getHudOverlayWindow: () => ({ webContents: { send: m.send } }) }));
vi.mock("../teleprompter/controller", () => ({
	getPrompterModelStatus: async () => ({
		exists: true,
		downloading: false,
		progress: 0,
		error: null,
	}),
	isTrustedPrompterSender: (event: { role: string }, roles: string[]) =>
		m.trusted && roles.includes(event.role),
}));
vi.mock("./voiceTest", () => ({
	hasSetupVoiceTest: () => false,
	startSetupVoiceTest: vi.fn(),
	stopSetupVoiceTest: vi.fn(),
	pushSetupVoiceAudio: vi.fn(),
}));
vi.mock("./mouseTest", () => ({
	hasSetupMouseTest: () => false,
	stopSetupMouseTest: vi.fn(),
	testSetupMouse: async () => true,
}));
const choices = { microphone: false, camera: false, systemAudio: false, voiceFollow: false };
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
let service: typeof import("./service");
let owner: EventEmitter & { id: number };
const call = async <T = SetupActionResult>(name: string, ...args: unknown[]): Promise<T> =>
	(await m.handlers.get(`setup:${name}`)!({ sender: owner, role: "editor" }, ...args)) as T;
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
	m.record = null;
	m.capturing = false;
	m.path = null;
	m.prefs = "{}";
	m.trusted = true;
	m.dirty = false;
	m.ax = false;
	m.media = "denied";
	m.windows = [];
	m.handlers.clear();
	m.axCheck.mockImplementation(() => m.ax);
	owner = Object.assign(new EventEmitter(), { id: 1 });
	service = await import("./service");
	service.registerRecordingSetupHandlers({ openEditor: vi.fn(), canRestart: () => !m.dirty });
});
afterEach(() => {
	vi.useRealTimers();
	Object.defineProperty(process, "platform", platformDescriptor);
});
it("reads startup and denied status without requesting permission, opening Settings or relaunching", async () => {
	expect(await call("startup")).toBe(true);
	expect((await call<SetupSnapshot>("snapshot")).permissions.accessibility).toBe("denied");
	expect(m.ask).not.toHaveBeenCalled();
	expect(m.sources).not.toHaveBeenCalled();
	expect(m.shell).not.toHaveBeenCalled();
	expect(m.relaunch).not.toHaveBeenCalled();
	expect(m.axCheck.mock.calls.every(([prompt]) => prompt === false)).toBe(true);
});
it("requests Accessibility only on a click and opens Settings on later explicit attempts", async () => {
	await call("request", "accessibility");
	await call("request", "accessibility");
	expect(m.axCheck.mock.calls.filter(([prompt]) => prompt === true)).toHaveLength(1);
	expect(m.shell).toHaveBeenCalledExactlyOnceWith("settings:accessibility");
});
it("retains a reported verification failure when the OS still reports granted", async () => {
	m.media = "granted";
	service.reportSetupPermissionFailure("microphone");
	await call("request", "microphone");
	expect((await call<SetupSnapshot>("snapshot")).verificationFailures).toContain("microphone");
	expect(m.shell).toHaveBeenCalledWith("settings:microphone");
});
it("does not reset any permission without confirmation", async () => {
	expect((await call("repair", "camera", false)).success).toBe(false);
	expect(m.exec).not.toHaveBeenCalled();
});
it("repairs only the named Captor permission with fixed executable and bundle identity", async () => {
	await call("repair", "camera", true);
	expect(m.exec).toHaveBeenCalledWith("/usr/bin/tccutil", ["reset", "Camera", "dev.captor.app"], {
		timeout: 10000,
	});
});
it("rejects invalid kinds, foreign documents and recording-time repairs", async () => {
	await expect(call("repair", "All", true)).rejects.toThrow();
	m.trusted = false;
	await expect(call<SetupSnapshot>("snapshot")).rejects.toThrow();
	m.trusted = true;
	m.capturing = true;
	expect((await call("repair", "screen", true)).success).toBe(false);
	expect(m.exec).not.toHaveBeenCalled();
});
it("does not give the HUD reset or restart privileges", async () => {
	expect(() =>
		m.handlers.get("setup:restart")!({ sender: owner, role: "hud-overlay" }),
	).toThrow();
	await expect(
		m.handlers.get("setup:repair")!({ sender: owner, role: "hud-overlay" }, "screen", true),
	).rejects.toThrow();
});
it("retains an open request while a new editor has no committed URL yet", async () => {
	m.windows = [{ isDestroyed: () => false, webContents: { getURL: () => "" } }];
	service.openRecordingSetup();
	expect(await call("startup")).toBe(true);
});
it("scopes media leases by owner, media kind and time", async () => {
	m.media = "granted";
	await call("media-start", "audio");
	await call("media-start", "video");
	await call("media-stop", "video");
	expect(service.hasSetupMediaLease(1, "audio")).toBe(true);
	expect(service.hasSetupMediaLease(1, "video")).toBe(false);
	expect(service.hasSetupMediaLease(2, "audio")).toBe(false);
	vi.advanceTimersByTime(60001);
	expect(service.hasSetupMediaLease(1, "audio")).toBe(false);
});
it("does not silently complete setup without an actual trial", async () => {
	m.media = "granted";
	m.ax = true;
	expect((await call("save", 4, choices, true)).success).toBe(false);
});
async function prepareTrial() {
	m.media = "granted";
	m.ax = true;
	await call("save", 4, choices, false);
	expect((await call("trial-start")).success).toBe(true);
}
it("a cancelled waiting trial cannot stop the next ordinary recording", async () => {
	await prepareTrial();
	await call("trial-cancel");
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(6000);
	expect(m.send).not.toHaveBeenCalled();
	expect(await call<{ phase: string } | null>("trial-status")).toBeNull();
});
it("abandons a waiting trial when its editor is destroyed", async () => {
	await prepareTrial();
	owner.emit("destroyed");
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(6000);
	expect(m.send).not.toHaveBeenCalled();
});
it("expires abandoned trial preparation", async () => {
	await prepareTrial();
	vi.advanceTimersByTime(120001);
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(6000);
	expect(m.send).not.toHaveBeenCalled();
});
it("stops a live trial once after five seconds and accepts only a new saved clip", async () => {
	await prepareTrial();
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(5000);
	expect(m.send).toHaveBeenCalledExactlyOnceWith("setup:stop-trial");
	service.setupRecordingStateChanged(false);
	m.path = "/recordings/new.mp4";
	await m.handlers.get("setup:trial-finish")!({ sender: owner, role: "hud-overlay" });
	expect((await call<{ phase: string } | null>("trial-status"))?.phase).toBe("complete");
	await call("trial-cancel");
	expect((await call<{ phase: string } | null>("trial-status"))?.phase).toBe("complete");
	expect((await call("save", 4, choices, true)).success).toBe(true);
});
it("refuses restart and trial while work needs saving", async () => {
	m.dirty = true;
	expect((await call("restart")).success).toBe(false);
	m.media = "granted";
	m.ax = true;
	await call("save", 4, choices, false);
	expect((await call("trial-start")).success).toBe(false);
	expect(m.relaunch).not.toHaveBeenCalled();
});
it("releases active media leases on main document reload and renderer exit", async () => {
	m.media = "granted";
	await call("media-start", "audio");
	owner.emit("did-start-navigation", {}, "http://app/?windowType=editor", false, true);
	expect(service.hasSetupMediaLease(1, "audio")).toBe(false);
	expect((await call("restart")).success).toBe(true);
	await call("media-start", "video");
	owner.emit("render-process-gone");
	expect(service.hasSetupMediaLease(1, "video")).toBe(false);
});
it("expired media leases cannot permanently prevent restart", async () => {
	m.media = "granted";
	await call("media-start", "audio");
	vi.advanceTimersByTime(60001);
	expect((await call("restart")).success).toBe(true);
});
it("closing the setup window while a trial records requests an actual stop", async () => {
	await prepareTrial();
	service.setupRecordingStateChanged(true);
	owner.emit("destroyed");
	expect(m.send).toHaveBeenCalledExactlyOnceWith("setup:stop-trial");
});
it("repeated media tests do not accumulate window lifecycle listeners", async () => {
	m.media = "granted";
	for (let i = 0; i < 30; i++) {
		await call("media-start", "audio");
		await call("media-stop", "audio");
	}
	expect(owner.listenerCount("destroyed")).toBe(1);
	expect(owner.listenerCount("did-start-navigation")).toBe(1);
});
it("cannot approve a camera trial that only saved the main screen video", async () => {
	m.media = "granted";
	m.ax = true;
	await call("save", 4, { ...choices, camera: true }, false);
	await call("trial-start");
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(5000);
	service.setupRecordingStateChanged(false);
	m.path = "/recordings/clip.mp4";
	await m.handlers.get("setup:trial-finish")!({ sender: owner, role: "hud-overlay" });
	expect((await call<{ phase: string }>("trial-status")).phase).toBe("failed");
});
it("cannot approve microphone recording without a saved microphone track", async () => {
	m.media = "granted";
	m.ax = true;
	await call("save", 4, { ...choices, microphone: true }, false);
	await call("trial-start");
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(5000);
	service.setupRecordingStateChanged(false);
	m.path = "/recordings/clip.mp4";
	await m.handlers.get("setup:trial-finish")!({ sender: owner, role: "hud-overlay" });
	expect((await call<{ phase: string }>("trial-status")).phase).toBe("failed");
});
it("cannot finish with different device preferences from the actual trial", async () => {
	await prepareTrial();
	service.setupRecordingStateChanged(true);
	vi.advanceTimersByTime(5000);
	service.setupRecordingStateChanged(false);
	m.path = "/recordings/clip.mp4";
	await m.handlers.get("setup:trial-finish")!({ sender: owner, role: "hud-overlay" });
	m.prefs = JSON.stringify({ microphoneDeviceLabel: "another device" });
	expect((await call("save", 4, choices, true)).success).toBe(false);
});
it("blocks restart and trial throughout renderer-only export and pending-save activity", async () => {
	m.handlers.get("setup:export-busy")!({ sender: owner, role: "editor" }, true);
	expect((await call("restart")).success).toBe(false);
	m.media = "granted";
	m.ax = true;
	await call("save", 4, choices, false);
	expect((await call("trial-start")).success).toBe(false);
	m.handlers.get("setup:export-busy")!({ sender: owner, role: "editor" }, false);
	expect((await call("restart")).success).toBe(true);
});
