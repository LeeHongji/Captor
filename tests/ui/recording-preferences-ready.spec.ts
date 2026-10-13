import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const mode of ["preferences", "devices", "script", "failure", "refresh"] as const) {
	test(`${mode} waits for recording preferences before capturing the enabled microphone`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(mode) => {
				localStorage.setItem("captor.locale", "en");
				let release!: () => void;
				let failed = mode === "failure";
				let refreshing = false;
				const pending = new Promise<void>((resolve) => {
					release = resolve;
				});
				const listeners = new Set<() => void>();
				window.addEventListener("test-begin-preferences-refresh", () => {
					refreshing = true;
					listeners.forEach((listener) => listener());
				});
				window.addEventListener("test-release-recording-preferences", () => {
					failed = false;
					release();
					listeners.forEach((listener) => listener());
				});
				Object.assign(window.electronAPI, {
					getCountdownDelay: async () => ({ success: true, delay: 0 }),
					getRecordingPreferences: async () => {
						document.documentElement.dataset.nativeStarts ??= "0";
						if (
							(mode !== "devices" && mode !== "failure" && mode !== "refresh") ||
							refreshing
						)
							await pending;
						return {
							success: !failed,
							microphoneEnabled: true,
							systemAudioEnabled: false,
							webcamEnabled: false,
						};
					},
					onRecordingPreferencesChanged: (listener: () => void) => {
						listeners.add(listener);
						return () => listeners.delete(listener);
					},
					startNativeScreenRecording: async (
						_source: unknown,
						options: { capturesMicrophone: boolean },
					) => {
						document.documentElement.dataset.nativeStarts = String(
							Number(document.documentElement.dataset.nativeStarts) + 1,
						);
						document.documentElement.dataset.nativeMicrophone = String(
							options.capturesMicrophone,
						);
						return { success: true };
					},
				});
				navigator.mediaDevices.enumerateDevices = async () => {
					if (mode === "devices") await pending;
					return [
						{
							kind: "audioinput",
							deviceId: "default",
							label: "Microphone",
							groupId: "test",
							toJSON: () => ({}),
						},
					];
				};
				if (mode === "script")
					Object.assign(window, {
						teleprompterAPI: {
							getState: async () => ({
								draft: {
									version: 1,
									text: "Read this script",
									voiceFollow: false,
									fontSize: 32,
									width: 640,
									opacity: 0.85,
									hideFromCapture: true,
								},
								sequence: 1,
								cursor: 0,
								phase: "ready",
								armed: true,
								recognition: "idle",
								error: null,
							}),
							onState: () => () => undefined,
							onModel: () => () => undefined,
							recordingPhase: async () => undefined,
						},
					});
			},
			mode,
		);
		await page.goto("/?windowType=hud-overlay");
		await page.evaluate(async () => {
			const reactUrl = "/node_modules/.vite/deps/react.js";
			const domUrl = "/node_modules/.vite/deps/react-dom_client.js";
			const hookUrl = "/src/hooks/useScreenRecorder.ts";
			const React = (await import(reactUrl)).default;
			const { createRoot } = (await import(domUrl)).default;
			const { useScreenRecorder } = await import(hookUrl);
			const host = document.createElement("div");
			host.id = "recording-readiness-check";
			document.body.append(host);
			function Check() {
				const recorder = useScreenRecorder();
				Object.assign(window, { testInvokeRecordingHook: recorder.toggleRecording });
				return React.createElement(
					"button",
					{ onClick: recorder.toggleRecording },
					"Invoke recording hook",
				);
			}
			createRoot(host).render(React.createElement(Check));
		});
		if (mode === "refresh") {
			await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
			await page.evaluate(() => {
				window.dispatchEvent(new Event("test-begin-preferences-refresh"));
				(
					window as unknown as { testInvokeRecordingHook(): void }
				).testInvokeRecordingHook();
			});
		} else await page.getByRole("button", { name: "Invoke recording hook" }).click();
		await page.waitForTimeout(200);
		await expect(page.locator("html")).toHaveAttribute("data-native-starts", "0");
		await expect(page.getByRole("button", { name: "Record", exact: true })).toBeDisabled();
		await page.evaluate(() =>
			window.dispatchEvent(new Event("test-release-recording-preferences")),
		);
		await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
		await page.getByRole("button", { name: "Invoke recording hook" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-native-starts", "1");
		await expect(page.locator("html")).toHaveAttribute("data-native-microphone", "true");
	});
}
