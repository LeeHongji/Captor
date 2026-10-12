import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const setting of ["clip-mute", "default-mute", "unedited"] as const) {
	test(`complete mix fallback preserves ${setting} when audio metadata refreshes`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.evaluate(async (setting) => {
			const reactUrl = "/node_modules/.vite/deps/react.js";
			const domUrl = "/node_modules/.vite/deps/react-dom_client.js";
			const hookUrl = "/src/components/video-editor/audio/useClipAudioSettingsController.ts";
			const React = (await import(reactUrl)).default;
			const { createRoot } = (await import(domUrl)).default;
			const { useClipAudioSettingsController } = await import(hookUrl);
			const host = document.createElement("div");
			host.id = "audio-fallback-check";
			document.body.append(host);
			function Check() {
				const [defaults, setDefaults] = React.useState({
					mic: { volume: setting === "default-mute" ? 0 : 1, normalize: false },
				});
				const [clips, setClips] = React.useState(
					setting === "clip-mute"
						? { clip: { mic: { volume: 0, normalize: false } } }
						: {},
				);
				const audio = useClipAudioSettingsController({
					preserveMissingTracks: true,
					selectedClipId: "clip",
					activeClipId: "clip",
					sourceAudioTrackSettingsByClip: clips,
					setSourceAudioTrackSettingsByClip: setClips,
					defaultSourceAudioTrackSettings: defaults,
					setDefaultSourceAudioTrackSettings: setDefaults,
				});
				React.useEffect(() => {
					audio.onSourceAudioTracksMetaChange([{ id: "mixed", label: "MP4 mix" }]);
				}, [audio.onSourceAudioTracksMetaChange]);
				return React.createElement("output", {
					"data-gain": String(audio.embeddedSourcePreviewGain),
					"data-microphone-volume": String(defaults.mic?.volume),
					"data-metadata-refreshed": String(audio.sourceAudioTrackMeta.length > 0),
				});
			}
			createRoot(host).render(React.createElement(Check));
		}, setting);
		const output = page.locator("#audio-fallback-check output");
		await expect(output).toHaveAttribute("data-metadata-refreshed", "true");
		await expect(output).toHaveAttribute("data-gain", setting === "unedited" ? "1" : "0");
		await expect(output).toHaveAttribute(
			"data-microphone-volume",
			setting === "default-mute" ? "0" : "1",
		);
	});
}

for (const pipeline of ["modern", "legacy"] as const) {
	test(`project export protects a different clip's microphone mute through ${pipeline}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.evaluate(async (pipeline) => {
			window.electronAPI.getVideoAudioFallbackPaths = async () => {
				document.documentElement.dataset.exportAudioChecking = "true";
				await new Promise<void>((resolve) =>
					window.addEventListener("release-export-audio", () => resolve(), {
						once: true,
					}),
				);
				return { success: true, paths: ["/recording.mp4"], startDelayMsByPath: {} };
			};
			const reactUrl = "/node_modules/.vite/deps/react.js";
			const domUrl = "/node_modules/.vite/deps/react-dom_client.js";
			const hookUrl = "/src/components/video-editor/export/useExportRunner.ts";
			const React = (await import(reactUrl)).default;
			const { createRoot } = (await import(domUrl)).default;
			const { useExportRunner } = await import(hookUrl);
			const host = document.createElement("div");
			host.id = "export-fallback-check";
			document.body.append(host);
			function Check() {
				const [error, setError] = React.useState("");
				const noop = () => undefined;
				const { handleExport } = useExportRunner({
					videoPath: "file:///recording.mp4",
					isPlaying: false,
					videoPlaybackRef: {
						current: { video: { currentTime: 0 }, containerRef: { current: null } },
					},
					appearance: { shadowIntensity: 0, padding: 0 },
					timeline: {
						audioRegions: [],
						clipRegions: [],
						selectedClipId: "A",
						defaultSourceAudioTrackSettings: {},
						sourceAudioTrackSettingsByClip: {
							B: { mic: { volume: 0, normalize: false } },
						},
					},
					exportSettings: { exportPipelineModel: pipeline },
					audio: {
						sourceAudioFallbackPaths: [],
						selectedClipSourceAudioTrackSettings: {},
						activeSourceAudioTrackSettings: {},
					},
					smokeExportConfig: { enabled: false },
					exportSession: {
						setIsExporting: noop,
						setExportProgress: noop,
						setExportError: setError,
						setShowExportDropdown: noop,
						setExportedFilePath: noop,
						setHasPendingExportSave: noop,
						clearPendingExportSave: noop,
						markExportAsSaving: noop,
						exporterRef: { current: null },
						pendingExportSaveRef: { current: null },
						exportRunIdRef: { current: 0 },
						cancelledExportRunIdRef: { current: null },
					},
				});
				React.useEffect(() => {
					void handleExport({ format: "mp4" });
				}, [handleExport]);
				return React.createElement("output", {}, error);
			}
			createRoot(host).render(React.createElement(Check));
		}, pipeline);
		await expect(page.locator("html")).toHaveAttribute("data-export-audio-checking", "true");
		await expect(page.locator("#export-fallback-check output")).toBeEmpty();
		await page.evaluate(() => window.dispatchEvent(new Event("release-export-audio")));
		await expect(page.locator("#export-fallback-check output")).toContainText(
			"original audio tracks",
		);
	});
}
