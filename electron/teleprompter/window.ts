import path from "node:path";
import { app, BrowserWindow, screen } from "electron";
import type { RecordingDraft } from "../../src/types/teleprompter";

let window: BrowserWindow | null = null;
let hiddenFromCapture = true;
let currentDraft: RecordingDraft | null = null;
let capturing = false;
let onClose: (() => void) | null = null;
export function setPrompterCloseHandler(handler: () => void) {
	onClose = handler;
}

export function isPrompterCaptureActive() {
	return capturing;
}
export function protectPrompterCapture(active: boolean) {
	capturing = active;
	if (window && !window.isDestroyed() && process.platform !== "linux") {
		window.setContentProtection(active && hiddenFromCapture);
	}
}

export function getPrompterCaptureWindow() {
	if (!window || window.isDestroyed()) return null;
	const id = Number(window.getMediaSourceId().split(":")[1]);
	return Number.isSafeInteger(id) && id > 0 ? { id, hidden: hiddenFromCapture } : null;
}

export function updatePrompterWindow(draft: RecordingDraft) {
	currentDraft = draft;
	hiddenFromCapture = draft.hideFromCapture;
	if (window && !window.isDestroyed()) {
		const width = Math.min(
			draft.width,
			screen.getDisplayMatching(window.getBounds()).workArea.width,
		);
		window.setSize(Math.round(width), window.getSize()[1]);
		protectPrompterCapture(capturing);
	}
}

export function showPrompterWindow(draft: RecordingDraft) {
	if (!window || window.isDestroyed()) {
		const area = screen.getPrimaryDisplay().workArea;
		window = new BrowserWindow({
			title: "Captor Prompter",
			width: Math.min(draft.width, area.width),
			height: 300,
			x: Math.round(area.x + (area.width - Math.min(draft.width, area.width)) / 2),
			y: area.y + 24,
			minWidth: 320,
			minHeight: 180,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			alwaysOnTop: true,
			skipTaskbar: true,
			show: false,
			webPreferences: {
				preload: path.join(app.getAppPath(), "dist-electron", "preload.mjs"),
				nodeIntegration: false,
				contextIsolation: true,
				backgroundThrottling: false,
			},
		});
		const created = window;
		created.setAlwaysOnTop(true, "screen-saver");
		if (process.platform === "darwin")
			created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		// Keep the same native window ID for the lifetime of a capture filter.
		created.on("close", (event) => {
			event.preventDefault();
			created.hide();
			onClose?.();
		});
		created.once("ready-to-show", () => {
			if (currentDraft) updatePrompterWindow(currentDraft);
			created.showInactive();
		});
		const devUrl = process.env.VITE_DEV_SERVER_URL;
		if (devUrl) void created.loadURL(`${devUrl}?windowType=teleprompter`);
		else
			void created.loadFile(path.join(app.getAppPath(), "dist", "index.html"), {
				query: { windowType: "teleprompter" },
			});
	}
	updatePrompterWindow(draft);
	window.showInactive();
}

export function hidePrompterWindow() {
	window?.hide();
}
export function destroyPrompterWindow() {
	window?.destroy();
	window = null;
}
