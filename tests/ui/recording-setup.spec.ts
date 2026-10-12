import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
async function setup(page: Page, options = { denied: false, failed: false, theme: "light" }) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		(options) => {
			localStorage.setItem("captor.locale", "en");
			localStorage.setItem("captor.theme", options.theme);
			window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
			const choices = {
				microphone: false,
				camera: false,
				systemAudio: false,
				voiceFollow: false,
			};
			let state: import("../../src/types/recordingSetup").SetupSnapshot = {
				platform: "darwin",
				appVersion: "0.0.4",
				installation: "applications",
				fingerprint: "candidate",
				identityChanged: false,
				record: {
					version: 1,
					step: 0,
					completed: false,
					fingerprint: "candidate",
					choices,
				},
				permissions: {
					screen: options.denied ? "denied" : "granted",
					accessibility: "granted",
					microphone: "denied",
					camera: "denied",
				},
				runtime: { supported: true, binaries: true, storage: true },
				model: { exists: false, downloading: false, progress: 0, error: null },
				busy: false,
				verificationFailures: options.failed ? ["screen"] : [],
			};
			let trial: { phase: string; path?: string; duration?: number } | null = null;
			const opened = new Set<() => void>();
			window.recordingSetupAPI = {
				snapshot: async () => structuredClone(state),
				startupRequired: async () => true,
				request: async (permission) => {
					document.documentElement.dataset.requests = permission;
					return { success: true };
				},
				repair: async (permission, confirmed) => {
					document.documentElement.dataset.repaired = `${permission}:${confirmed}`;
					state.permissions[permission] = "denied";
					state.verificationFailures = [];
					return { success: true };
				},
				save: async (step, choices, completed) => {
					state.record = {
						version: 1,
						step,
						choices,
						completed: !!completed,
						fingerprint: "candidate",
					};
					document.documentElement.dataset.saved = `${step}:${!!completed}`;
					return { success: true };
				},
				open: async () => {
					opened.forEach((listener) => listener());
				},
				onOpen: (listener) => {
					opened.add(listener);
					return () => opened.delete(listener);
				},
				acknowledgeOpen: async () => undefined,
				restart: async () => ({ success: true }),
				startMedia: async () => ({ success: true }),
				stopMedia: async () => undefined,
				mediaResult: async () => undefined,
				testMouse: async () => ({ success: true }),
				startTrial: async () => {
					trial = { phase: "waiting" };
					return { success: true };
				},
				cancelTrial: async () => {
					if (trial?.phase === "waiting") trial = null;
				},
				finishTrial: async () => undefined,
				trialChoices: async () => null,
				canFinish: async () => ({ success: true }),
				reportFailure: async () => undefined,
				exportBusy: () => undefined,
				trialStatus: async () => trial,
				onStopTrial: () => () => undefined,
				startVoiceTest: async () => ({ session: "test" }),
				stopVoiceTest: async () => undefined,
				pushVoiceAudio: () => undefined,
				onVoiceResult: () => () => undefined,
			};
			window.teleprompterAPI = {
				getState: async () => ({
					draft: {
						version: 1,
						text: "",
						fontSize: 32,
						width: 640,
						opacity: 0.85,
						hideFromCapture: true,
						voiceFollow: false,
					},
					sequence: 1,
					cursor: 0,
					phase: "idle",
					armed: false,
					recognition: "idle",
					error: null,
				}),
				saveDraft: async () => await window.teleprompterAPI!.getState(),
				onModel: () => () => undefined,
				onState: () => () => undefined,
				draftDirty: () => undefined,
				flushDraft: async () => undefined,
			} as typeof window.teleprompterAPI;
			Object.assign(window, {
				testSetupGrant: () => {
					state.permissions.screen = "granted";
				},
				testSetupTrialComplete: () => {
					trial = {
						phase: "complete",
						path: `${location.origin}/setup-trial.mp4`,
						duration: 6,
					};
				},
			});
		},
		options,
	);
	await page.goto("/?windowType=editor");
	await expect(
		page.getByRole("heading", { name: "Prepare your recording environment" }),
	).toBeVisible();
}
test("first setup checks silently, explicit requests and recovery stay inside the wizard", async ({
	page,
}) => {
	let dialogs = 0;
	page.on("dialog", async (d) => {
		dialogs++;
		await d.accept();
	});
	await setup(page, { denied: true, failed: false, theme: "light" });
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByText("Screen recording", { exact: true })).toBeVisible();
	await page.waitForTimeout(1700);
	expect(dialogs).toBe(0);
	await expect(page.locator("html")).not.toHaveAttribute("data-requests", /.+/);
	await page.getByRole("button", { name: "Open System Settings", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-requests", "screen");
	await page.getByRole("button", { name: "I already enabled this", exact: true }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-repaired", /.+/);
	await page.getByRole("button", { name: "Reset this permission", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-repaired", "screen:true");
	expect(dialogs).toBe(0);
});
test("a granted OS toggle with a failed native check exposes recovery and blocks Continue", async ({
	page,
}) => {
	await setup(page, { denied: false, failed: true, theme: "light" });
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "I already enabled this", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
});
test("all explicitly disabled features still complete the full trial route", async ({ page }) => {
	await page.route("**/setup-trial.mp4", (route) =>
		route.fulfill({ path: "tests/ui/fixtures/preview.mp4", contentType: "video/mp4" }),
	);
	await setup(page);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("button", { name: "Test mouse interaction", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByText("Configured without camera video.", { exact: false }),
	).toBeVisible();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		page.getByText("Configured for manual prompting.", { exact: false }),
	).toBeVisible();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.evaluate(() =>
		(window as unknown as { testSetupTrialComplete(): void }).testSetupTrialComplete(),
	);
	await page.getByRole("button", { name: "Check again", exact: true }).count();
	await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeEnabled({
		timeout: 10000,
	});
	await page.getByRole("button", { name: "Finish setup", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-saved", "4:true");
});
test("switching language keeps the current step and does not reopen startup checks", async ({
	page,
}) => {
	await setup(page);
	await page
		.getByRole("combobox", { name: "Interface language", exact: true })
		.selectOption("zh-CN");
	await expect(page.getByRole("heading", { name: "准备你的录制环境" })).toBeVisible();
	await page.getByRole("button", { name: "继续", exact: true }).click();
	await page.waitForTimeout(1800);
	await expect(page.getByRole("heading", { name: "让 Captor 录制屏幕与鼠标操作" })).toBeVisible();
});
for (const theme of ["light", "dark"])
	test(`compact ${theme} wizard keeps recovery and navigation reachable`, async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 600 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await setup(page, { denied: true, failed: false, theme });
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await page.getByRole("button", { name: "I already enabled this", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "View projects first", exact: true }),
		).toBeInViewport();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.screenshot({
			path: `test-results/setup-${theme}-compact.png`,
			animations: "disabled",
		});
		await page.getByRole("button", { name: "View projects first", exact: true }).click();
		await expect(page.getByRole("button", { name: "Record new", exact: true })).toBeVisible();
	});
test("opening the HUD with denied permissions never requests access or shows startup alerts", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAccessibilityPermissionStatus = async () => ({
			success: true,
			trusted: false,
		});
		window.electronAPI.requestAccessibilityPermission = async () => {
			document.documentElement.dataset.unwantedRequest = "true";
			return { success: true, trusted: false };
		};
		window.electronAPI.openAccessibilityPreferences = async () => {
			document.documentElement.dataset.unwantedSettings = "true";
			return { success: true };
		};
	});
	let dialogs = 0;
	page.on("dialog", async (d) => {
		dialogs++;
		await d.accept();
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
	await page.waitForTimeout(1700);
	expect(dialogs).toBe(0);
	await expect(page.locator("html")).not.toHaveAttribute("data-unwanted-request", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-unwanted-settings", "true");
});

test("changes to this step autosave before viewing projects and reopening setup", async ({
	page,
}) => {
	await setup(page);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("button", { name: "Test mouse interaction", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("switch", { name: "Record system audio", exact: true }).press("Space");
	await page.getByRole("button", { name: "View projects first", exact: true }).click();
	await expect(page.getByRole("button", { name: "Record new", exact: true })).toBeVisible();
	await page.evaluate(() => window.recordingSetupAPI!.open());
	await expect(
		page.getByRole("switch", { name: "Record system audio", exact: true }),
	).toBeChecked();
});
test("finishing checks unsaved work before changing the narration draft", async ({ page }) => {
	await page.route("**/setup-trial.mp4", (route) =>
		route.fulfill({ path: "tests/ui/fixtures/preview.mp4", contentType: "video/mp4" }),
	);
	await setup(page);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("button", { name: "Test mouse interaction", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await page.evaluate(() =>
		(window as unknown as { testSetupTrialComplete(): void }).testSetupTrialComplete(),
	);
	await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeEnabled();
	await page.evaluate(() => {
		window.recordingSetupAPI!.canFinish = async () => ({
			success: false,
			code: "save-work-first",
		});
		const save = window.recordingSetupAPI!.save;
		window.recordingSetupAPI!.save = (step, choices, completed) =>
			completed
				? Promise.resolve({ success: false, code: "save-work-first" })
				: save(step, choices, completed);
		window.teleprompterAPI!.saveDraft = async () => {
			document.documentElement.dataset.changedDraft = "true";
			return window.teleprompterAPI!.getState();
		};
	});
	await page.getByRole("button", { name: "Finish setup", exact: true }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-changed-draft", "true");
	await expect(page.getByRole("alert")).toContainText("Save your work");
});
