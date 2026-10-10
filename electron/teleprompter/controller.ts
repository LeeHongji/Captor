import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	ipcMain,
	MessageChannelMain,
	utilityProcess,
	type IpcMainInvokeEvent,
	type UtilityProcess,
	type MessagePortMain,
} from "electron";
import { USER_DATA_PATH } from "../appPaths";
import { PrompterAlignment } from "../../src/lib/prompterAlignment";
import {
	INITIAL_PROMPTER_STATE,
	normalizeRecordingDraft,
	type PrompterState,
	type PrompterPhase,
} from "../../src/types/teleprompter";
import { createRecordingDraftStore } from "./draftStore";
import { createPrompterModelStore } from "./model";
import { isTrustedPrompterDocument } from "./security";
import {
	hidePrompterWindow,
	showPrompterWindow,
	updatePrompterWindow,
	destroyPrompterWindow,
	isPrompterCaptureActive,
	setPrompterCloseHandler,
	getPrompterCaptureWindow,
} from "./window";

let state: PrompterState = {
	...INITIAL_PROMPTER_STATE,
	draft: { ...INITIAL_PROMPTER_STATE.draft },
};
const draftStore = createRecordingDraftStore(path.join(USER_DATA_PATH, "recording-draft.json"));
let loaded: Promise<void> | null = null;
let saves: Promise<unknown> = Promise.resolve();
const dirtyEditors = new Set<number>();
export function hasUnsavedRecordingDraft(editorId: number) {
	return dirtyEditors.has(editorId);
}
export function clearUnsavedRecordingDraft(editorId: number) {
	dirtyEditors.delete(editorId);
}
let matcher = new PrompterAlignment("");
let child: UtilityProcess | null = null;
let audioPort: MessagePortMain | null = null;
let session: string | null = null;
let pendingSeconds = 0;
let resetPending = false;
let cancelStartup: (() => void) | null = null;
let startupPromise: Promise<string> | null = null;
let lastTranscript = "";
const directory = path.join(USER_DATA_PATH, "prompter-model", "zipformer-zh-en");

function send(channel: string, value: unknown) {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(channel, value);
	}
}
function publish() {
	state.sequence++;
	send("prompter:state", state);
}
function load() {
	loaded ??= draftStore
		.read()
		.then((draft) => {
			state.draft = draft;
			matcher = new PrompterAlignment(draft.text);
			publish();
		})
		.catch((error) => {
			state.error = `Could not read recording draft: ${String(error)}`;
			publish();
		});
	return loaded;
}
const model = createPrompterModelStore(directory, (status) => send("prompter:model", status));

export function isTrustedPrompterSender(
	event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
	allowed: readonly string[],
) {
	if (event.senderFrame !== event.sender.mainFrame) return false;
	const bases = [
		pathToFileURL(path.join(app.getAppPath(), "dist", "index.html")).href,
		process.env.VITE_DEV_SERVER_URL,
	].filter(Boolean) as string[];
	return isTrustedPrompterDocument(event.sender.getURL(), bases, allowed);
}

function stopRecognition() {
	cancelStartup?.();
	cancelStartup = null;
	startupPromise = null;
	lastTranscript = "";
	session = null;
	audioPort?.close();
	audioPort = null;
	const previous = child;
	child = null;
	previous?.kill();
	pendingSeconds = 0;
	resetPending = false;
	state.recognition = "idle";
}
function recognitionError(error: string) {
	stopRecognition();
	state.recognition = "error";
	state.error = error;
	publish();
}

export function registerTeleprompterHandlers() {
	setPrompterCloseHandler(() => {
		if (state.phase === "rehearsal") {
			stopRecognition();
			state.phase = "idle";
			publish();
		}
	});
	const handle = (
		name: string,
		action: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
		allowed = ["editor", "hud-overlay", "teleprompter"],
	) => {
		ipcMain.handle(`prompter:${name}`, async (event, ...args: unknown[]) => {
			if (!isTrustedPrompterSender(event, allowed))
				throw new Error("Untrusted prompter request.");
			await load();
			return action(event, ...args);
		});
	};
	handle("get", () => state);
	handle("flush", async () => {
		await saves;
	}, ["editor"]);
	ipcMain.on("prompter:dirty", (event, dirty: unknown) => {
		if (!isTrustedPrompterSender(event, ["editor"])) return;
		if (dirty === true) dirtyEditors.add(event.sender.id);
		else dirtyEditors.delete(event.sender.id);
	});
	handle(
		"save",
		(_event, input) => {
			const operation = saves
				.catch(() => undefined)
				.then(async () => {
					const draft = normalizeRecordingDraft(input);
					if (
						(isPrompterCaptureActive() ||
							state.phase === "rehearsal" ||
							state.phase === "preparing") &&
						draft.text !== state.draft.text
					)
						throw new Error("Stop prompting before editing the script.");
					if (
						isPrompterCaptureActive() &&
						draft.hideFromCapture !== state.draft.hideFromCapture
					)
						throw new Error("Capture visibility is locked while recording.");
					await draftStore.write(draft);
					if (draft.text !== state.draft.text) {
						matcher = new PrompterAlignment(draft.text);
						state.cursor = 0;
					}
					state.draft = draft;
					state.error = null;
					updatePrompterWindow(draft);
					publish();
					return state;
				});
			saves = operation;
			return operation;
		},
		["editor", "hud-overlay"],
	);
	handle("show", () => {
		if (isPrompterCaptureActive() && !getPrompterCaptureWindow())
			throw new Error("Open the prompter before starting a recording.");
		showPrompterWindow(state.draft);
	});
	handle("hide", () => {
		hidePrompterWindow();
		if (state.phase === "rehearsal") {
			stopRecognition();
			state.phase = "idle";
			publish();
		}
	});
	handle(
		"arm",
		(_event, enabled) => {
			if (isPrompterCaptureActive())
				throw new Error("Finish recording before changing the script mode.");
			stopRecognition();
			state.armed = enabled === true && !!state.draft.text.trim();
			state.phase = state.armed ? "ready" : "idle";
			state.cursor = 0;
			matcher.jump(0);
			state.error = null;
			if (state.armed) showPrompterWindow(state.draft);
			else hidePrompterWindow();
			publish();
		},
		["editor", "hud-overlay"],
	);
	handle("rehearse", () => {
		if (isPrompterCaptureActive()) throw new Error("Cannot rehearse while recording.");
		if (!state.draft.text.trim()) throw new Error("Add a script first.");
		stopRecognition();
		state.phase = "rehearsal";
		state.armed = true;
		state.cursor = 0;
		matcher.jump(0);
		state.error = null;
		showPrompterWindow(state.draft);
		publish();
	}, ["editor", "hud-overlay"]);
	handle("stop-rehearsal", () => {
		if (state.phase !== "rehearsal") return;
		stopRecognition();
		state.phase = "idle";
		hidePrompterWindow();
		publish();
	});
	handle("cursor", (_event, offset) => {
		if (typeof offset !== "number" || !Number.isFinite(offset)) return;
		state.cursor = Math.max(0, Math.min(state.draft.text.length, Math.round(offset)));
		matcher.jump(state.cursor);
		resetPending = !!audioPort;
		audioPort?.postMessage({ type: "reset" });
		publish();
	});
	handle(
		"phase",
		(_event, input) => {
			if (!["idle", "preparing", "recording", "paused", "finalizing"].includes(String(input)))
				return;
			const phase = input as PrompterPhase;
			if (phase === "idle" && state.phase === "rehearsal") return;
			if (phase === "preparing" && state.armed) {
				matcher.jump(0);
				state.cursor = 0;
				showPrompterWindow(state.draft);
			}
			if (phase === "preparing" || phase === "paused") {
				matcher.beginUtterance();
				lastTranscript = "";
				resetPending = !!audioPort;
				audioPort?.postMessage({ type: "reset" });
				state.recognition = child ? "holding" : "idle";
			} else if (phase !== "recording") stopRecognition();
			if (phase === "finalizing") hidePrompterWindow();
			state.phase = phase;
			publish();
		},
		["hud-overlay"],
	);
	handle("model-status", () => model.status());
	handle("download-model", () => {
		if (child || isPrompterCaptureActive())
			throw new Error("Stop voice following before downloading the model.");
		return model.download();
	}, ["editor", "hud-overlay"]);
	handle("recognition-start", async () => {
		if (
			!(
				state.phase === "rehearsal" ||
				((state.phase === "recording" || state.phase === "preparing") && state.armed)
			) ||
			!state.draft.voiceFollow
		)
			throw new Error("Voice following is not active.");
		if (!(await model.status()).exists)
			throw new Error(
				"Download the local voice-following model first. Manual prompting is still available.",
			);
		if (child && session) {
			if (startupPromise) await startupPromise;
			// A new consumer gets a fresh token. Cleanup from rehearsal or an old
			// microphone cannot stop the recording's warmed recognizer.
			session = randomUUID();
			return session;
		}
		stopRecognition();
		const id = randomUUID();
		session = id;
		matcher = new PrompterAlignment(state.draft.text);
		matcher.jump(state.cursor);
		state.recognition = "loading";
		state.error = null;
		publish();
		let process: UtilityProcess;
		try {
			process = utilityProcess.fork(
				path.join(app.getAppPath(), "electron", "teleprompter", "recognizer.cjs"),
				[app.getAppPath(), directory],
				{ stdio: "ignore", serviceName: "Captor voice following" },
			);
		} catch (error) {
			recognitionError(String(error));
			throw error;
		}
		child = process;
		process.on("exit", () => {
			if (child === process)
				recognitionError(
					"Local speech recognition stopped. Recording is unaffected; use manual prompting or restart voice following.",
				);
		});
		const pending = new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (child === process) recognitionError("Speech recognition startup timed out.");
				reject(new Error("Speech recognition startup timed out."));
			}, 20_000);
			cancelStartup = () => {
				clearTimeout(timer);
				reject(new Error("Speech recognition cancelled."));
			};
			process.on("message", (message) => {
				if (child !== process) {
					clearTimeout(timer);
					reject(new Error("Speech recognition cancelled."));
					return;
				}
				if (message.type === "error") {
					clearTimeout(timer);
					cancelStartup = null;
					recognitionError(message.error);
					reject(new Error(message.error));
					return;
				}
				if (message.type !== "ready") return;
				clearTimeout(timer);
				cancelStartup = null;
				const channel = new MessageChannelMain();
				audioPort = channel.port1;
				audioPort.on("message", ({ data }) => {
					if (child !== process) return;
					if (data.type === "ack") {
						pendingSeconds = Math.max(0, pendingSeconds - data.seconds);
						return;
					}
					if (data.type === "reset") {
						matcher.beginUtterance();
						lastTranscript = "";
						resetPending = false;
						return;
					}
					if (data.type === "error") {
						recognitionError(data.error);
						return;
					}
					if (
						data.type !== "result" ||
						resetPending ||
						!(state.phase === "recording" || state.phase === "rehearsal")
					)
						return;
					if (data.text === lastTranscript && !data.final) return;
					lastTranscript = data.text;
					const result = matcher.consume(data.text);
					state.cursor = result.cursor;
					state.recognition = result.matched && !data.final ? "listening" : "holding";
					if (data.final) {
						matcher.beginUtterance();
						lastTranscript = "";
					}
					publish();
				});
				audioPort.start();
				process.postMessage({ type: "audio-port" }, [channel.port2]);
				state.recognition = "holding";
				publish();
				resolve(id);
			});
		});
		startupPromise = pending;
		void pending.then(
			() => {
				if (startupPromise === pending) startupPromise = null;
			},
			() => {
				if (startupPromise === pending) startupPromise = null;
			},
		);
		return pending;
	}, ["hud-overlay"]);
	handle(
		"recognition-stop",
		(_event, id) => {
			if (state.phase === "paused" || state.phase === "preparing") return;
			if (id === session) {
				stopRecognition();
				publish();
			}
		},
		["hud-overlay"],
	);
	handle(
		"recognition-failed",
		(_event, id, error) => {
			if (
				id === session &&
				state.recognition !== "error" &&
				typeof error === "string" &&
				(state.phase === "rehearsal" ||
					((state.phase === "recording" || state.phase === "preparing") && state.armed))
			)
				recognitionError(error.slice(0, 500));
		},
		["hud-overlay"],
	);
	ipcMain.on("prompter:audio", (event, id: unknown, samples: unknown, sampleRate: unknown) => {
		if (!isTrustedPrompterSender(event, ["hud-overlay"]) || id !== session || !audioPort)
			return;
		if (
			!(samples instanceof Float32Array) ||
			samples.length > 8000 ||
			sampleRate !== 16000 ||
			!samples.every(Number.isFinite)
		)
			return;
		if (!(state.phase === "recording" || state.phase === "rehearsal")) return;
		pendingSeconds += samples.length / sampleRate;
		if (pendingSeconds > 2) {
			recognitionError(
				"Voice following could not keep up. Use manual prompting; recording continues.",
			);
			return;
		}
		audioPort.postMessage({ samples, sampleRate });
	});
	// The editor can cancel quitting after this event. Cleanup must run on each
	// attempt and leave a published stopped state that can restart safely.
	app.on("before-quit", () => {
		stopRecognition();
		state.phase = "idle";
		state.armed = false;
		destroyPrompterWindow();
		publish();
	});
}
