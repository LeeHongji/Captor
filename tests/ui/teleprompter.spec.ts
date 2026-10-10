import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function installPrompter(page: Page) {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const listeners = new Set<(state: unknown) => void>();
		const defaults = {
			version: 1,
			text: "",
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: true,
		};
		const state = {
			sequence: 1,
			draft: JSON.parse(localStorage.getItem("test-draft") ?? "null") ?? defaults,
			cursor: 0,
			phase: "idle",
			armed: false,
			recognition: "idle",
			error: null,
		};
		const emit = () => {
			state.sequence++;
			for (const listener of listeners) listener(structuredClone(state));
		};
		Object.assign(window, {
			teleprompterAPI: {
				getState: async () => structuredClone(state),
				draftDirty: () => undefined,
				flushDraft: async () => undefined,
				saveDraft: async (draft: typeof defaults) => {
					if (location.search.includes("save-fails")) throw new Error("Disk unavailable");
					state.draft = draft;
					localStorage.setItem("test-draft", JSON.stringify(draft));
					emit();
					return structuredClone(state);
				},
				onState: (listener: (state: unknown) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				onModel: () => () => undefined,
				modelStatus: async () => ({
					exists: false,
					downloading: false,
					progress: 0,
					error: null,
				}),
				downloadModel: async () => ({
					exists: true,
					downloading: false,
					progress: 100,
					error: null,
				}),
				arm: async (armed: boolean) => {
					state.armed = armed;
					state.phase = armed ? "ready" : "idle";
					document.documentElement.dataset.scriptArmed = String(armed);
					emit();
				},
				show: async () => undefined,
				hide: async () => {
					document.documentElement.dataset.prompterHidden = "true";
				},
				rehearse: async () => {
					state.phase = "rehearsal";
					emit();
				},
				stopRehearsal: async () => {
					state.phase = "idle";
					emit();
				},
				setCursor: async (cursor: number) => {
					state.cursor = cursor;
					emit();
				},
			},
		});
	});
}

test("saves one draft, restores it, rehearses, and can skip preparation", async ({ page }) => {
	await installPrompter(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.getByRole("button", { name: "Prepare narration", exact: true }).click();
	const preparation = page.getByRole("region", { name: "Prepare narration" });
	await preparation.getByLabel("Narration script").fill("大家好，今天介绍 Captor 的录屏功能。");
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(localStorage.getItem("test-draft") ?? "{}").text),
		)
		.toContain("Captor");
	await page.reload();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.getByRole("button", { name: "Prepare narration", exact: true }).click();
	await expect(preparation.getByLabel("Narration script")).toHaveValue(
		"大家好，今天介绍 Captor 的录屏功能。",
	);
	await preparation.getByRole("button", { name: "Rehearse", exact: true }).click();
	await expect(preparation.getByLabel("Narration script")).toBeDisabled();
	await preparation.getByRole("button", { name: "Stop rehearsal" }).click();
	await preparation.getByRole("button", { name: "Record with script" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-script-armed", "true");
	await preparation.getByRole("button", { name: "Skip preparation and record" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-script-armed", "false");
	await page.getByRole("button", { name: "Record new", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-script-armed", "false");
});

test("failed saves retain input and block launching a prepared recording", async ({ page }) => {
	await installPrompter(page);
	await page.goto("/?windowType=editor&save-fails=1");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.getByRole("button", { name: "Prepare narration", exact: true }).click();
	await page.getByLabel("Narration script").fill("稿件不能丢失");
	await expect(page.getByRole("alert").filter({ hasText: "Disk unavailable" })).toBeVisible();
	await page.getByRole("button", { name: "Record with script" }).click();
	await expect(page.getByLabel("Narration script")).toHaveValue("稿件不能丢失");
	await expect(page.locator("html")).not.toHaveAttribute("data-script-armed");
});

test("manual floating prompt maps a click to the original mixed-script position", async ({
	page,
}) => {
	await installPrompter(page);
	await page.goto("/?windowType=teleprompter");
	await page.evaluate(async () => {
		await window.teleprompterAPI!.saveDraft({
			version: 1,
			text: "🎬 大家好，Captor开始录制。",
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: false,
		});
	});
	await page.getByRole("button", { name: "Captor", exact: true }).click();
	await expect(page.locator('[data-current-word="true"]')).toHaveText("Captor");
	await page.getByRole("button", { name: "Next word" }).click();
	await expect(page.locator('[data-current-word="true"]')).toHaveText("开");
	await page.getByRole("button", { name: "Hide teleprompter" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-prompter-hidden", "true");
});

test("preparation fits light, dark and compact layouts", async ({ page }) => {
	await installPrompter(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.getByRole("button", { name: "Prepare narration", exact: true }).click();
	await page.getByLabel("Narration script").fill("这是用于检查界面的口播稿。Hello from Captor.");
	for (const dark of [false, true]) {
		await page.evaluate((dark) => {
			document.documentElement.classList.toggle("dark", dark);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
		}, dark);
		await expect(page.getByLabel("Narration script")).toBeVisible();
		await page.screenshot({ path: `.tmp/prompter-${dark ? "dark" : "light"}.png` });
	}
	await page.setViewportSize({ width: 800, height: 600 });
	await page
		.getByRole("button", { name: "Skip preparation and record" })
		.scrollIntoViewIfNeeded();
	await expect(page.getByRole("button", { name: "Skip preparation and record" })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true);
	await page.screenshot({ path: ".tmp/prompter-compact.png" });
});
