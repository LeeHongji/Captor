import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const companion of ["camera", "microphone", "browser-camera"] as const) {
	test(`${companion === "browser-camera" ? "browser" : "native"} trial waits for ${companion === "browser-camera" ? "camera" : companion} persistence before checking completion`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(companion) => {
				localStorage.setItem("captor.locale", "en");
				let release!: () => void;
				const pending = new Promise<void>((resolve) => {
					release = resolve;
				});
				window.addEventListener("test-release-companion", () => release());
				let webcamPath: string | null = null;
				let microphoneSaved = false;
				const choices = {
					camera: companion !== "microphone",
					microphone: companion === "microphone",
					systemAudio: false,
					voiceFollow: false,
				};
				Object.assign(window.electronAPI, {
					getCountdownDelay: async () => ({ success: true, delay: 0 }),
					getRecordingPreferences: async () => ({
						success: true,
						webcamEnabled: choices.camera,
						microphoneEnabled: choices.microphone,
						systemAudioEnabled: false,
					}),
					startNativeScreenRecording:
						companion === "browser-camera"
							? undefined
							: async () => ({
									success: true,
									microphoneFallbackRequired: choices.microphone,
								}),
					stopNativeScreenRecording: async () => ({
						success: true,
						path: "/recordings/trial.mp4",
					}),
					setRecordingState: async () => ({ success: true }),
					switchToEditor: async () => {
						document.documentElement.dataset.editorOpened = "true";
						return { success: true };
					},
					hudOverlayClose: async () => {
						document.documentElement.dataset.hudClosed = "true";
					},
					storeRecordedVideo: async (_bytes: ArrayBuffer, name: string) => {
						if (!name.includes("-webcam"))
							return { success: true, path: "/recordings/trial.mp4" };
						document.documentElement.dataset.companionSaving = "true";
						await pending;
						return { success: true, path: "/recordings/camera.mp4" };
					},
					storeMicrophoneSidecar: async () => {
						document.documentElement.dataset.companionSaving = "true";
						await pending;
						microphoneSaved = true;
						return { success: true };
					},
					setCurrentRecordingSession: async (session: { webcamPath?: string | null }) => {
						webcamPath = session.webcamPath ?? null;
						return { success: true };
					},
				});
				Object.assign(window, {
					recordingSetupAPI: {
						snapshot: async () => ({
							installation: "applications",
							platform: "darwin",
							permissions: {
								screen: "granted",
								accessibility: "granted",
								microphone: "granted",
								camera: "granted",
							},
							runtime: { supported: true, binaries: true, storage: true },
							model: { exists: true },
							busy: false,
							verificationFailures: [],
						}),
						trialChoices: async () => choices,
						onStopTrial: () => () => undefined,
						finishTrial: async () => {
							document.documentElement.dataset.finishCalls = String(
								Number(document.documentElement.dataset.finishCalls || "0") + 1,
							);
							document.documentElement.dataset.trialComplete = String(
								choices.camera ? !!webcamPath : microphoneSaved,
							);
						},
					},
				});
				class Recorder {
					static isTypeSupported(type: string) {
						return type.includes("mp4");
					}
					state = "inactive";
					mimeType: string;
					ondataavailable: ((event: BlobEvent) => void) | null = null;
					onstop: (() => void) | null = null;
					onerror: (() => void) | null = null;
					constructor(
						public stream: MediaStream,
						options: MediaRecorderOptions = {},
					) {
						this.mimeType = options.mimeType ?? "video/mp4";
					}
					start() {
						this.state = "recording";
					}
					requestData() {
						// The fixture emits one chunk when the recorder stops.
					}
					stop() {
						this.state = "inactive";
						queueMicrotask(() => {
							this.ondataavailable?.(
								new BlobEvent("dataavailable", {
									data: new Blob(["test bytes"], { type: this.mimeType }),
								}),
							);
							this.onstop?.();
						});
					}
				}
				Object.defineProperty(window, "MediaRecorder", { value: Recorder });
				navigator.mediaDevices.enumerateDevices = async () => [
					{
						kind: "audioinput",
						deviceId: "default",
						groupId: "test",
						label: "Test microphone",
						toJSON: () => ({}),
					},
				];
				navigator.mediaDevices.getUserMedia = async (constraints) => {
					if (constraints.audio)
						return new AudioContext().createMediaStreamDestination().stream;
					const canvas = document.createElement("canvas");
					canvas.width = canvas.height = 320;
					canvas.getContext("2d")!.fillRect(0, 0, 320, 320);
					return canvas.captureStream(24);
				};
			},
			companion,
		);
		await page.goto("/?windowType=hud-overlay");
		await page.evaluate(() => {
			document.documentElement.dataset.finishCalls = "0";
		});
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await page.getByRole("button", { name: "Stop", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-companion-saving", "true");
		await expect(page.locator("html")).toHaveAttribute("data-editor-opened", "true");
		await expect(page.locator("html")).toHaveAttribute("data-finish-calls", "0");
		await page.evaluate(() => window.dispatchEvent(new Event("test-release-companion")));
		await expect(page.locator("html")).toHaveAttribute("data-finish-calls", "1");
		await expect(page.locator("html")).toHaveAttribute("data-trial-complete", "true");
		await expect(page.locator("html")).toHaveAttribute("data-hud-closed", "true");
	});
}
