import { RECORDINGS_SETTINGS_FILE } from "../ipc/constants";
import { hasSetupMouseTest, stopSetupMouseTest, testSetupMouse } from "./mouseTest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	ipcMain,
	shell,
	systemPreferences,
	type IpcMainInvokeEvent,
	type WebContents,
} from "electron";
import { readAppSetting, writeAppSetting } from "../appSettingsStore";
import { getPrebundledNativeHelperPath } from "../ipc/paths/binaries";
import { getFfmpegBinaryPath } from "../ipc/ffmpeg/binary";
import { getRecordingsDir, getMacPrivacySettingsUrl } from "../ipc/utils";
import {
	nativeScreenRecordingActive,
	windowsNativeCaptureActive,
	ffmpegScreenRecordingActive,
	currentVideoPath,
	currentRecordingSession,
} from "../ipc/state";
import { getHudOverlayWindow } from "../windows";
import { getPrompterModelStatus, isTrustedPrompterSender } from "../teleprompter/controller";
import {
	SETUP_PERMISSIONS,
	normalizeSetupChoices,
	setupIsReady,
	type SetupSnapshot,
	type SetupPermission,
	type SetupPermissionStatus,
	type SetupRecord,
} from "../../src/types/recordingSetup";
import {
	hasSetupVoiceTest,
	startSetupVoiceTest,
	stopSetupVoiceTest,
	pushSetupVoiceAudio,
} from "./voiceTest";

const exec = promisify(execFile);
const KEY = "recordingSetup";
let fingerprint: Promise<string> | null = null;
let snapshotPending: Promise<SetupSnapshot> | null = null;
let repairPending = false;
let requestPending: { permission: SetupPermission; promise: Promise<unknown> } | null = null;
let openEditor: (() => void) | null = null;
let setupOpenRequested = false;
let canRestart: () => boolean = () => true;
const mediaLeases = new Map<number, Partial<Record<"audio" | "video", number>>>();
const exportingOwners = new Set<number>();
const observedOwners = new Set<number>();
const requestedPermissions = new Set<SetupPermission>();
const verificationFailures = new Set<SetupPermission>();
export function reportSetupPermissionFailure(permission: SetupPermission) {
	verificationFailures.add(permission);
	const record = getRecord();
	if (record) writeAppSetting(KEY, { ...record, step: 1, completed: false });
}
let trial: {
	ownerId: number;
	phase: "waiting" | "recording" | "finalizing" | "complete" | "failed";
	before: string | null;
	started: number;
	timer: ReturnType<typeof setTimeout> | null;
	path?: string;
	duration?: number;
	choices: ReturnType<typeof normalizeSetupChoices>;
	configuration: string;
} | null = null;
export function setupCaptureBusy() {
	return nativeScreenRecordingActive || windowsNativeCaptureActive || ffmpegScreenRecordingActive;
}
export async function installationFingerprint() {
	fingerprint ??= (async () => {
		let requirement = "development";
		if (process.platform === "darwin" && app.isPackaged) {
			const result = await exec("/usr/bin/codesign", ["-d", "-r-", process.execPath], {
				timeout: 5000,
			});
			const designated = (result.stdout + result.stderr).match(/designated\s*=>[^\n]+/);
			if (!designated) throw Error("Installation identity unavailable");
			requirement = designated[0];
		}
		return createHash("sha256")
			.update(app.getVersion() + requirement)
			.digest("hex");
	})();
	return fingerprint;
}
function getRecord(): SetupRecord | null {
	const raw = readAppSetting(KEY) as Partial<SetupRecord> | null;
	if (!raw || raw.version !== 1 || typeof raw.fingerprint !== "string") return null;
	return {
		version: 1,
		step: Number.isInteger(raw.step) ? Math.min(4, Math.max(0, raw.step!)) : 0,
		completed: raw.completed === true,
		fingerprint: raw.fingerprint,
		choices: normalizeSetupChoices(raw.choices),
	};
}
function permissionStatus(permission: SetupPermission): SetupPermissionStatus {
	if (process.platform !== "darwin") return "granted";
	try {
		if (permission === "accessibility")
			return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
		return systemPreferences.getMediaAccessStatus(permission);
	} catch {
		return "unknown";
	}
}
export function getSetupSnapshot(): Promise<SetupSnapshot> {
	if (snapshotPending) return snapshotPending;
	snapshotPending = (async () => {
		const record = getRecord();
		const identity = await installationFingerprint().catch(() => "unknown");
		let binaries = identity !== "unknown";
		if (process.platform === "darwin") {
			try {
				await Promise.all(
					["captor-screencapturekit-helper", "captor-native-cursor-monitor"].map((name) =>
						fs.access(getPrebundledNativeHelperPath(name), constants.X_OK),
					),
				);
				await fs.access(getFfmpegBinaryPath(), constants.X_OK);
			} catch {
				binaries = false;
			}
		}
		let storage = true;
		try {
			await fs.access(await getRecordingsDir(), constants.W_OK);
		} catch {
			storage = false;
		}
		const appPath = app.getAppPath();
		return {
			platform: process.platform,
			appVersion: app.getVersion(),
			fingerprint: identity,
			record,
			installation:
				appPath.startsWith("/Volumes/") || appPath.includes("/AppTranslocation/")
					? "disk-image"
					: appPath.startsWith("/Applications/") ||
							appPath.startsWith(path.join(os.homedir(), "Applications") + path.sep)
						? "applications"
						: "other",
			identityChanged: !!record && record.fingerprint !== identity,
			permissions: Object.fromEntries(
				SETUP_PERMISSIONS.map((permission) => [permission, permissionStatus(permission)]),
			) as SetupSnapshot["permissions"],
			runtime: {
				supported:
					process.platform !== "darwin" || Number(os.release().split(".")[0]) >= 23,
				binaries,
				storage,
			},
			model: await getPrompterModelStatus(),
			busy:
				setupCaptureBusy() ||
				!!requestPending ||
				repairPending ||
				hasSetupVoiceTest() ||
				hasSetupMouseTest(),
			verificationFailures: [...verificationFailures],
		};
	})();
	void snapshotPending
		.finally(() => {
			snapshotPending = null;
		})
		.catch(() => undefined);
	return snapshotPending;
}
export async function shouldShowSetupAtStartup() {
	if (
		!app.isPackaged ||
		process.platform !== "darwin" ||
		process.env.VITE_DEV_SERVER_URL ||
		process.env.CAPTOR_SMOKE_EXPORT === "1"
	)
		return false;
	const state = await getSetupSnapshot();
	return (
		!state.record?.completed ||
		state.identityChanged ||
		!setupIsReady(state, state.record.choices)
	);
}
export function openRecordingSetup() {
	if (process.platform !== "darwin") return;
	if (setupCaptureBusy()) return;
	setupOpenRequested = true;
	openEditor?.();
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || !win.webContents.getURL()) continue;
		try {
			if (new URL(win.webContents.getURL()).searchParams.get("windowType") === "editor")
				win.webContents.send("setup:open");
		} catch {
			/* a new window has not committed its document yet */
		}
	}
}
function observeOwner(owner: WebContents) {
	if (observedOwners.has(owner.id)) return;
	const ownerId = owner.id;
	observedOwners.add(ownerId);
	const clearMedia = () => {
		mediaLeases.delete(ownerId);
		exportingOwners.delete(ownerId);
		stopSetupVoiceTest(ownerId);
		if (trial?.ownerId === ownerId && trial.phase === "waiting") cancelTrial(ownerId);
	};
	const navigating = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
		if (!inPlace && mainFrame) clearMedia();
	};
	owner.on("did-start-navigation", navigating);
	owner.on("render-process-gone", clearMedia);
	owner.once("destroyed", () => {
		clearMedia();
		if (trial?.ownerId === ownerId) {
			if (trial.phase === "recording")
				getHudOverlayWindow()?.webContents.send("setup:stop-trial");
			cancelTrial(ownerId);
		}
		observedOwners.delete(ownerId);
		owner.removeListener("did-start-navigation", navigating);
		owner.removeListener("render-process-gone", clearMedia);
	});
}
async function recordingConfiguration() {
	let prefs: Record<string, unknown> = {};
	try {
		prefs = JSON.parse(await fs.readFile(RECORDINGS_SETTINGS_FILE, "utf8"));
	} catch {
		/* first launch uses defaults */
	}
	return JSON.stringify([
		prefs.microphoneEnabled === true,
		prefs.systemAudioEnabled === true,
		prefs.webcamEnabled === true,
		prefs.microphoneDeviceId ?? "",
		prefs.microphoneDeviceLabel ?? "",
		prefs.webcamDeviceId ?? "",
		prefs.webcamDeviceLabel ?? "",
	]);
}
export function hasSetupMediaLease(id: number, mediaType?: string) {
	const lease = mediaLeases.get(id);
	if (lease) {
		for (const kind of ["audio", "video"] as const) {
			if ((lease[kind] ?? 0) <= Date.now()) delete lease[kind];
		}
		if (!Object.keys(lease).length) mediaLeases.delete(id);
	}
	return (
		!!lease &&
		(mediaType === "audio" || mediaType === "video"
			? (lease[mediaType] ?? 0) > Date.now()
			: Object.values(lease).some((expires) => expires > Date.now()))
	);
}
function cancelTrial(ownerId?: number) {
	if (!trial || (ownerId !== undefined && trial.ownerId !== ownerId)) return;
	if (trial.timer) clearTimeout(trial.timer);
	trial = null;
}
export function setupRecordingStateChanged(recording: boolean) {
	if (!trial || !["waiting", "recording"].includes(trial.phase)) return;
	if (recording && trial.phase === "waiting") {
		if (trial.timer) clearTimeout(trial.timer);
		trial.phase = "recording";
		trial.started = Date.now();
		trial.timer = setTimeout(
			() => getHudOverlayWindow()?.webContents.send("setup:stop-trial"),
			5000,
		);
	} else if (!recording && trial.phase === "recording") {
		if (trial.timer) clearTimeout(trial.timer);
		trial.duration = (Date.now() - trial.started) / 1000;
		trial.phase = "finalizing";
		trial.timer = setTimeout(() => {
			if (trial?.phase === "finalizing") trial.phase = "failed";
		}, 60_000);
	}
}
function assertSender(event: IpcMainInvokeEvent, roles = ["editor", "hud-overlay"]) {
	if (!isTrustedPrompterSender(event, roles)) throw Error("Untrusted recording setup request.");
}
function parsePermission(value: unknown): SetupPermission {
	if (!SETUP_PERMISSIONS.includes(value as SetupPermission))
		throw Error("Invalid recording setup permission.");
	return value as SetupPermission;
}
export function registerRecordingSetupHandlers(options: {
	openEditor: () => void;
	canRestart: () => boolean;
}) {
	openEditor = options.openEditor;
	canRestart = options.canRestart;
	ipcMain.on("setup:export-busy", (event, value: unknown) => {
		if (!isTrustedPrompterSender(event, ["editor"]) || typeof value !== "boolean") return;
		observeOwner(event.sender);
		if (value) exportingOwners.add(event.sender.id);
		else exportingOwners.delete(event.sender.id);
	});
	ipcMain.handle("setup:failure", (event, permission: unknown) => {
		assertSender(event);
		reportSetupPermissionFailure(parsePermission(permission));
		if (trial?.phase === "waiting") trial.phase = "failed";
	});
	ipcMain.handle("setup:trial-choices", (event) => {
		assertSender(event, ["hud-overlay"]);
		return trial && ["waiting", "recording", "finalizing"].includes(trial.phase)
			? trial.choices
			: null;
	});
	ipcMain.handle("setup:snapshot", (event) => {
		assertSender(event);
		return getSetupSnapshot();
	});
	ipcMain.handle("setup:startup", (event) => {
		assertSender(event, ["editor"]);
		if (setupOpenRequested) {
			setupOpenRequested = false;
			return true;
		}
		return shouldShowSetupAtStartup();
	});
	ipcMain.handle("setup:ack-open", (event) => {
		assertSender(event, ["editor"]);
		setupOpenRequested = false;
	});
	ipcMain.handle("setup:request", (event, value: unknown) => {
		assertSender(event, ["editor"]);
		const permission = parsePermission(value);
		if (setupCaptureBusy() || repairPending)
			return { success: false, code: "recording-active" };
		if (requestPending)
			return requestPending.permission === permission
				? requestPending.promise
				: { success: false, code: "request-active" };
		const promise = (async () => {
			try {
				const status = permissionStatus(permission);
				if (
					(status !== "granted" || verificationFailures.has(permission)) &&
					status !== "restricted"
				) {
					if (process.platform === "darwin") {
						if (
							permission === "accessibility" &&
							!requestedPermissions.has(permission)
						) {
							requestedPermissions.add(permission);
							systemPreferences.isTrustedAccessibilityClient(true);
						} else if (permission === "screen" && status === "not-determined")
							await desktopCapturer.getSources({
								types: ["screen"],
								thumbnailSize: { width: 1, height: 1 },
							});
						else if (
							(permission === "microphone" || permission === "camera") &&
							status === "not-determined"
						)
							await systemPreferences.askForMediaAccess(permission);
						else
							await shell.openExternal(
								getMacPrivacySettingsUrl(
									permission === "screen" ? "screen" : permission,
								),
							);
					}
				}
				return { success: true, snapshot: await getSetupSnapshot() };
			} catch {
				return { success: false, code: "permission-request-failed" };
			} finally {
				requestPending = null;
			}
		})();
		requestPending = { permission, promise };
		return promise;
	});
	ipcMain.handle("setup:repair", async (event, value: unknown, confirmed: unknown) => {
		assertSender(event, ["editor"]);
		const permission = parsePermission(value);
		if (confirmed !== true) return { success: false, code: "cancelled" };
		if (
			setupCaptureBusy() ||
			requestPending ||
			repairPending ||
			hasSetupVoiceTest() ||
			hasSetupMouseTest()
		)
			return { success: false, code: "recording-active" };
		if (process.platform !== "darwin" || !app.isPackaged)
			return { success: false, code: "repair-unavailable" };
		repairPending = true;
		try {
			await exec(
				"/usr/bin/tccutil",
				[
					"reset",
					{
						screen: "ScreenCapture",
						accessibility: "Accessibility",
						microphone: "Microphone",
						camera: "Camera",
					}[permission],
					"dev.captor.app",
				],
				{ timeout: 10_000 },
			);
			verificationFailures.delete(permission);
			return { success: true, snapshot: await getSetupSnapshot() };
		} catch {
			return { success: false, code: "repair-failed" };
		} finally {
			repairPending = false;
		}
	});
	ipcMain.handle(
		"setup:save",
		async (event, step: unknown, input: unknown, completed: unknown) => {
			assertSender(event, ["editor"]);
			if (setupCaptureBusy() || repairPending)
				return { success: false, code: "recording-active" };
			const snapshot = await getSetupSnapshot();
			const choices = normalizeSetupChoices(input);
			if (
				completed === true &&
				(!setupIsReady(snapshot, choices) ||
					trial?.phase !== "complete" ||
					trial.ownerId !== event.sender.id ||
					!canRestart() ||
					exportingOwners.size > 0 ||
					JSON.stringify(choices) !== JSON.stringify(trial.choices) ||
					(await recordingConfiguration()) !== trial.configuration)
			)
				return { success: false, code: "environment-not-ready" };
			writeAppSetting(KEY, {
				version: 1,
				step:
					typeof step === "number" && Number.isInteger(step)
						? Math.min(4, Math.max(0, step))
						: 0,
				completed: completed === true,
				fingerprint: snapshot.fingerprint,
				choices,
			} satisfies SetupRecord);
			return { success: true, snapshot: await getSetupSnapshot() };
		},
	);
	ipcMain.handle("setup:open", (event) => {
		assertSender(event);
		openRecordingSetup();
	});
	ipcMain.handle("setup:restart", (event) => {
		assertSender(event, ["editor"]);
		if (
			setupCaptureBusy() ||
			requestPending ||
			repairPending ||
			hasSetupVoiceTest() ||
			hasSetupMouseTest() ||
			[...mediaLeases.keys()].some((id) => hasSetupMediaLease(id)) ||
			!canRestart() ||
			exportingOwners.size > 0
		)
			return { success: false, code: "save-work-first" };
		app.relaunch();
		app.quit();
		return { success: true };
	});
	ipcMain.handle("setup:mouse-test", async (event) => {
		assertSender(event, ["editor"]);
		if ((await getSetupSnapshot()).busy || permissionStatus("accessibility") !== "granted")
			return { success: false, code: "permission-not-active" };
		const success = await testSetupMouse(event.sender);
		if (success) verificationFailures.delete("accessibility");
		else reportSetupPermissionFailure("accessibility");
		return {
			success,
			code: success ? undefined : "mouse-test-failed",
			snapshot: await getSetupSnapshot(),
		};
	});
	ipcMain.handle("setup:media-start", (event, kind: unknown) => {
		assertSender(event, ["editor"]);
		if (kind !== "audio" && kind !== "video") throw Error("Invalid setup media kind");
		if (
			permissionStatus(kind === "audio" ? "microphone" : "camera") !== "granted" ||
			setupCaptureBusy() ||
			repairPending
		)
			return { success: false, code: "permission-not-active" };
		observeOwner(event.sender);
		mediaLeases.set(event.sender.id, {
			...mediaLeases.get(event.sender.id),
			[kind]: Date.now() + 60_000,
		});
		return { success: true };
	});
	ipcMain.handle("setup:media-result", (event, kind: unknown, success: unknown) => {
		assertSender(event, ["editor"]);
		if (
			(kind !== "audio" && kind !== "video") ||
			typeof success !== "boolean" ||
			!hasSetupMediaLease(event.sender.id, kind)
		)
			throw Error("Invalid media test result");
		const permission = kind === "audio" ? "microphone" : "camera";
		if (success) verificationFailures.delete(permission);
		else reportSetupPermissionFailure(permission);
	});
	ipcMain.handle("setup:media-stop", (event, kind: unknown) => {
		assertSender(event, ["editor"]);
		if (kind !== "audio" && kind !== "video") return;
		const lease = mediaLeases.get(event.sender.id);
		if (lease) {
			delete lease[kind];
			if (!Object.keys(lease).length) mediaLeases.delete(event.sender.id);
		}
		if (kind === "audio") stopSetupVoiceTest(event.sender.id);
	});
	ipcMain.handle("setup:voice-start", async (event, language: unknown) => {
		assertSender(event, ["editor"]);
		const snapshot = await getSetupSnapshot();
		if (
			snapshot.busy ||
			!snapshot.model.exists ||
			snapshot.permissions.microphone !== "granted" ||
			!hasSetupMediaLease(event.sender.id, "audio")
		)
			throw Error("voice-environment-not-ready");
		if (language !== "zh" && language !== "en") throw Error("Invalid voice test language");
		return startSetupVoiceTest(event.sender, language);
	});
	ipcMain.handle("setup:voice-stop", (event, id: unknown) => {
		assertSender(event, ["editor"]);
		if (id !== undefined && typeof id !== "string") throw Error("Invalid voice session");
		stopSetupVoiceTest(event.sender.id, id);
	});
	ipcMain.on("setup:voice-audio", (event, id: unknown, samples: unknown) => {
		if (isTrustedPrompterSender(event, ["editor"]))
			pushSetupVoiceAudio(event.sender.id, id, samples);
	});
	ipcMain.handle("setup:trial-start", async (event) => {
		assertSender(event, ["editor"]);
		const snapshot = await getSetupSnapshot();
		if (!canRestart() || exportingOwners.size > 0 || snapshot.busy)
			return { success: false, code: "save-work-first" };
		if (!snapshot.record || !setupIsReady(snapshot, snapshot.record.choices))
			return { success: false, code: "environment-not-ready" };
		cancelTrial();
		trial = {
			ownerId: event.sender.id,
			phase: "waiting",
			before: currentVideoPath,
			started: 0,
			choices: snapshot.record.choices,
			configuration: await recordingConfiguration(),
			timer: null,
		};
		const ownerId = event.sender.id;
		trial.timer = setTimeout(() => cancelTrial(ownerId), 120_000);
		observeOwner(event.sender);
		return { success: true };
	});
	ipcMain.handle("setup:trial-finish", async (event) => {
		assertSender(event, ["hud-overlay"]);
		if (trial?.phase !== "finalizing") return;
		if (trial.timer) clearTimeout(trial.timer);
		const finished = trial;
		let success =
			!!currentVideoPath &&
			currentVideoPath !== finished.before &&
			(finished.duration ?? 0) >= 4;
		const exists = async (file: string | null | undefined) => {
			if (!file) return false;
			try {
				return (await fs.stat(file)).size > 0;
			} catch {
				return false;
			}
		};
		if (
			success &&
			finished.choices.camera &&
			(currentRecordingSession?.videoPath !== currentVideoPath ||
				!(await exists(currentRecordingSession?.webcamPath)))
		)
			success = false;
		if (success && finished.choices.microphone) {
			const base = currentVideoPath!.slice(0, -path.extname(currentVideoPath!).length);
			if (
				!(
					await Promise.all(
						[".mic.wav", ".mic.m4a"].map((suffix) => exists(base + suffix)),
					)
				).some(Boolean)
			)
				success = false;
		}
		if (trial !== finished) return;
		finished.phase = success ? "complete" : "failed";
		finished.path = success ? currentVideoPath! : undefined;
	});
	ipcMain.handle("setup:trial-cancel", (event) => {
		assertSender(event, ["editor"]);
		if (trial?.phase === "waiting") cancelTrial(event.sender.id);
	});
	ipcMain.handle("setup:trial-status", (event) => {
		assertSender(event, ["editor"]);
		return trial && trial.ownerId === event.sender.id
			? { phase: trial.phase, path: trial.path, duration: trial.duration }
			: null;
	});
	app.on("before-quit", () => {
		stopSetupVoiceTest();
		stopSetupMouseTest();
		cancelTrial();
		mediaLeases.clear();
	});
}
