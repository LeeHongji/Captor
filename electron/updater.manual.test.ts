import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	app: { isPackaged: true, getVersion: () => "0.0.2" },
	experimental: false,
	open: vi.fn().mockResolvedValue(undefined),
	dialog: vi.fn().mockResolvedValue({ response: 1 }),
	auto: { checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() },
}));
vi.mock("electron", () => ({
	app: state.app,
	BrowserWindow: {},
	shell: { openExternal: state.open },
	dialog: { showMessageBox: state.dialog },
}));
vi.mock("electron-updater", () => ({ autoUpdater: state.auto }));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "/tmp/captor-test" }));
vi.mock("./appSettingsStore", () => ({
	readAppSetting: () => state.experimental,
	writeAppSetting: vi.fn((_key, value) => {
		state.experimental = value;
	}),
}));

const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
let updater: typeof import("./updater");
beforeAll(async () => {
	Object.defineProperty(process, "platform", { value: "darwin" });
	vi.useFakeTimers();
	updater = await import("./updater");
});
afterAll(() => {
	Object.defineProperty(process, "platform", descriptor);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
describe("manual packaged updater", () => {
	it("discovers releases, opens the fixed project page, and never installs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					tag_name: "v0.0.3",
					draft: false,
					prerelease: false,
					html_url: "https://evil.example",
					assets: [
						{
							name: `Captor-0.0.3-${process.arch}.dmg`,
							state: "uploaded",
							size: 100,
						},
					],
				}),
			}),
		);
		const send = vi.fn(() => true);
		updater.setupAutoUpdates(() => null, send);
		await updater.checkForAppUpdates(() => null);
		expect(updater.getUpdateStatusSummary()).toMatchObject({
			status: "available",
			distributionMode: "manual",
			availableVersion: "0.0.3",
		});
		expect(send).toHaveBeenCalledWith(
			"update-toast-state",
			expect.objectContaining({ primaryAction: "open-download" }),
		);
		await updater.downloadAvailableUpdate();
		updater.installDownloadedUpdateNow();
		expect(state.open).toHaveBeenCalledWith(
			"https://github.com/LeeHongji/Captor/releases/tag/v0.0.3",
		);
		expect(state.auto.checkForUpdates).not.toHaveBeenCalled();
		expect(state.auto.downloadUpdate).not.toHaveBeenCalled();
		expect(state.auto.quitAndInstall).not.toHaveBeenCalled();
	});
	it("clears an old invitation when a successful check finds no installer", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }),
		);
		await updater.checkForAppUpdates(() => null);
		expect(updater.getUpdateStatusSummary().status).toBe("up-to-date");
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
	});
	it("coalesces checks and discards beta results after opting out", async () => {
		let complete!: (response: unknown) => void;
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						complete = resolve;
					}),
			)
			.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
		vi.stubGlobal("fetch", fetchMock);
		updater.setExperimentalUpdatesEnabled(true);
		const background = updater.checkForAppUpdates(() => null);
		let finished = false;
		const manual = updater
			.checkForAppUpdates(() => null, { manual: true })
			.then(() => {
				finished = true;
			});
		await Promise.resolve();
		expect(finished).toBe(false);
		updater.setExperimentalUpdatesEnabled(false);
		complete({
			ok: true,
			status: 200,
			json: async () => [
				{
					tag_name: "v0.0.3-beta.1",
					draft: false,
					prerelease: true,
					assets: [
						{
							name: `Captor-0.0.3-beta.1-${process.arch}.dmg`,
							state: "uploaded",
							size: 100,
						},
					],
				},
			],
		});
		await Promise.all([background, manual]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(finished).toBe(true);
		expect(updater.getUpdateStatusSummary()).toMatchObject({
			status: "up-to-date",
			availableVersion: null,
		});
		expect(updater.getCurrentUpdateToastPayload()).toBeNull();
	});
	it("returns a retryable failure when the browser cannot open", async () => {
		state.open.mockRejectedValueOnce(Error("Browser unavailable"));
		expect(await updater.openUpdateDownloadPage()).toEqual({
			success: false,
			message: "Could not open the Captor releases page.",
		});
	});
	it("retains development guards", async () => {
		state.app.isPackaged = false;
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await updater.checkForAppUpdates(() => null);
		await updater.downloadAvailableUpdate();
		updater.installDownloadedUpdateNow();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(state.auto.quitAndInstall).not.toHaveBeenCalled();
	});
});
