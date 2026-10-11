import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function scriptCharacterRect(page: Page, target: number | string) {
	return page.evaluate((offset) => {
		const scroller = document.querySelector<HTMLElement>("section .overflow-y-auto")!;
		const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		while (node) {
			const length = node.textContent!.length;
			const index = typeof offset === "string" ? node.textContent!.indexOf(offset) : offset;
			if (index >= 0 && index < length) {
				const range = document.createRange();
				range.setStart(node, index);
				range.setEnd(node, index + 1);
				const rect = range.getBoundingClientRect();
				return {
					x: rect.left,
					y: rect.top + scroller.scrollTop,
					centerX: rect.left + rect.width / 2,
					centerY: rect.top + rect.height / 2,
				};
			}
			if (typeof offset === "number") offset -= length;
			node = walker.nextNode();
		}
		throw new Error("Script character not found");
	}, target);
}

async function installPrompter(page: Page) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		// Preparation starts without media; a fixture video can finish importing and close the dashboard.
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
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
	await page.getByRole("button", { name: "Prepare narration", exact: true }).click();
	const preparation = page.getByRole("region", { name: "Prepare narration" });
	await preparation.getByLabel("Narration script").fill("大家好，今天介绍 Captor 的录屏功能。");
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(localStorage.getItem("test-draft") ?? "{}").text),
		)
		.toContain("Captor");
	await page.reload();
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
	await expect(page.locator('[data-current-word="true"]')).toHaveText("大");
	const point = await scriptCharacterRect(page, "🎬 大家好，Captor开始录制。".indexOf("Captor"));
	await page.mouse.click(point.centerX, point.centerY);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("Captor");
	await page.getByRole("button", { name: "Next word" }).click();
	await expect(page.locator('[data-current-word="true"]')).toHaveText("开");
	await page.getByRole("button", { name: "Hide teleprompter" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-prompter-hidden", "true");
});

test("word clicks work on both halves of Chinese glyphs and after a manual rewind", async ({
	page,
}) => {
	await installPrompter(page);
	await page.setViewportSize({ width: 640, height: 600 });
	await page.goto("/?windowType=teleprompter");
	const text = "🎬 大家好，今天介绍 Captor 的录屏功能。\n\nHello from Captor, let's record!";
	await page.evaluate(async (text) => {
		await window.teleprompterAPI!.saveDraft({
			version: 1,
			text,
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: false,
		});
	}, text);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("大");
	for (const [offset, expected] of [
		[text.indexOf("天"), "天"],
		[text.indexOf("家"), "家"],
		[text.indexOf("let's") + 3, "let's"],
	] as const) {
		for (const fraction of [0.25, 0.75]) {
			const rect = await scriptCharacterRect(page, offset);
			await page.mouse.click(rect.x + (rect.centerX - rect.x) * 2 * fraction, rect.centerY);
			await expect(page.locator('[data-current-word="true"]')).toHaveText(expected);
		}
	}
	await page.getByRole("button", { name: "Previous word" }).click();
	await expect(page.locator('[data-current-word="true"]')).toHaveText("Captor");
	await page.getByRole("button", { name: "Next word" }).click();
	await expect(page.locator('[data-current-word="true"]')).toHaveText("let's");
});

test("maximum-length scripts retain whitespace and can jump to the end and back", async ({
	page,
}) => {
	await installPrompter(page);
	await page.setViewportSize({ width: 320, height: 180 });
	await page.goto("/?windowType=teleprompter");
	await expect(page.getByRole("button", { name: "Next word" })).toBeVisible({ timeout: 15_000 });
	const text = "大家好，Hello Captor.\n\n  一起录制。".repeat(5000).slice(0, 100_000);
	await page.evaluate(
		(text) =>
			window.teleprompterAPI!.saveDraft({
				version: 1,
				text,
				fontSize: 64,
				width: 320,
				opacity: 0.85,
				hideFromCapture: true,
				voiceFollow: true,
			}),
		text,
	);
	const script = page.locator("section .overflow-y-auto");
	expect(await script.textContent()).toBe(text);
	await expect(script.locator("span")).toHaveCount(3);
	await page.evaluate(
		(cursor) => window.teleprompterAPI!.setCursor(cursor),
		text.lastIndexOf("Captor"),
	);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("Captor");
	await expect
		.poll(() => script.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(100_000);
	await page.evaluate(() => window.teleprompterAPI!.setCursor(0));
	await expect(page.locator('[data-current-word="true"]')).toHaveText("大");
	await expect.poll(() => script.evaluate((element) => element.scrollTop)).toBeLessThan(100);
	expect(await script.textContent()).toBe(text);
});

test("clicking empty prompt space or punctuation does not change the current word", async ({
	page,
}) => {
	await installPrompter(page);
	await page.setViewportSize({ width: 640, height: 300 });
	await page.goto("/?windowType=teleprompter");
	await expect(page.getByRole("button", { name: "Next word" })).toBeVisible({ timeout: 15_000 });
	await page.evaluate(() =>
		window.teleprompterAPI!.saveDraft({
			version: 1,
			text: "大家好，朋友。",
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: false,
		}),
	);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("大");
	const bounds = await page.locator("section .overflow-y-auto").boundingBox();
	await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 10);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("大");
	const punctuation = await scriptCharacterRect(page, 3);
	await page.mouse.click(punctuation.centerX, punctuation.centerY);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("大");
	const word = await scriptCharacterRect(page, 1);
	await page.mouse.click(word.centerX, word.centerY);
	await expect(page.locator('[data-current-word="true"]')).toHaveText("家");
});

test("following a long script keeps word layout fixed while the cursor advances", async ({
	page,
}) => {
	await installPrompter(page);
	await page.setViewportSize({ width: 640, height: 300 });
	await page.goto("/?windowType=teleprompter");
	await expect(page.getByRole("button", { name: "Next word" })).toBeVisible({ timeout: 15_000 });
	const text = Array.from({ length: 900 }, (_, i) => String.fromCharCode(0x4e00 + i)).join("");
	await page.evaluate(async (text) => {
		await window.teleprompterAPI!.saveDraft({
			version: 1,
			text,
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: true,
		});
		await window.teleprompterAPI!.setCursor(100);
	}, text);
	await expect(page.locator('[data-current-word="true"]')).toHaveText(text[100]);
	const position = async () => {
		const { x, y } = await scriptCharacterRect(page, text[160]);
		return { x, y };
	};
	const before = await position();
	for (const cursor of [101, 105, 120, 140]) {
		await page.evaluate((cursor) => window.teleprompterAPI!.setCursor(cursor), cursor);
		await expect(page.locator('[data-current-word="true"]')).toHaveText(text[cursor]);
		expect(await position()).toEqual(before);
	}
});

test("continuous forward following does not scroll backwards between words", async ({ page }) => {
	await installPrompter(page);
	await page.setViewportSize({ width: 640, height: 300 });
	await page.goto("/?windowType=teleprompter");
	await expect(page.getByRole("button", { name: "Next word" })).toBeVisible({ timeout: 15_000 });
	const samples = await page.evaluate(async () => {
		await window.teleprompterAPI!.saveDraft({
			version: 1,
			text: "今天我们一起学习如何使用提词器，让口播录制更加自然流畅。".repeat(40),
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: true,
		});
		await window.teleprompterAPI!.setCursor(100);
		await new Promise((resolve) => setTimeout(resolve, 500));
		const scroller = document.querySelector<HTMLElement>("section .overflow-y-auto")!;
		const samples: number[] = [];
		let sampling = true;
		const sample = () => {
			samples.push(scroller.scrollTop);
			if (sampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
		for (let cursor = 101; cursor <= 260; cursor += 2) {
			await window.teleprompterAPI!.setCursor(cursor);
			await new Promise((resolve) => setTimeout(resolve, 80));
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
		sampling = false;
		return samples;
	});
	const backwards = samples.slice(1).filter((y, i) => y < samples[i] - 1);
	console.log({
		frames: samples.length,
		backwards: backwards.length,
		start: samples[0],
		end: samples.at(-1),
	});
	expect(backwards).toHaveLength(0);
	expect(samples.at(-1)!).toBeGreaterThan(samples[0] + 100);
});

test("manual scrolling does not prevent same-line controls or voice updates from re-anchoring", async ({
	page,
}) => {
	await installPrompter(page);
	await page.setViewportSize({ width: 640, height: 300 });
	await page.goto("/?windowType=teleprompter");
	await expect(page.getByRole("button", { name: "Next word" })).toBeVisible({ timeout: 15_000 });
	const text = Array.from({ length: 900 }, (_, i) => String.fromCharCode(0x4e00 + i)).join("");
	await page.evaluate(async (text) => {
		await window.teleprompterAPI!.saveDraft({
			version: 1,
			text,
			fontSize: 32,
			width: 640,
			opacity: 0.85,
			hideFromCapture: true,
			voiceFollow: true,
		});
		await window.teleprompterAPI!.setCursor(75);
	}, text);
	const scroller = page.locator("section .overflow-y-auto");
	const centerError = () =>
		scroller.evaluate((container) => {
			const word = container
				.querySelector('[data-current-word="true"]')!
				.getBoundingClientRect();
			const bounds = container.getBoundingClientRect();
			return Math.abs(word.top + word.height / 2 - (bounds.top + bounds.height / 2));
		});
	await expect.poll(centerError).toBeLessThan(2);
	for (const action of ["next", "previous", "voice"]) {
		const centeredTop = await scroller.evaluate((element) => element.scrollTop);
		await page.mouse.move(320, 180);
		await page.mouse.wheel(0, 900);
		await expect
			.poll(() => scroller.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(centeredTop + 200);
		if (action === "voice") await page.evaluate(() => window.teleprompterAPI!.setCursor(76));
		else
			await page
				.getByRole("button", { name: action === "next" ? "Next word" : "Previous word" })
				.click();
		await expect(page.locator('[data-current-word="true"]')).toHaveText(
			text[action === "previous" ? 75 : 76],
		);
		await expect.poll(centerError).toBeLessThan(2);
	}
});

test("preparation fits light, dark and compact layouts", async ({ page }) => {
	await installPrompter(page);
	await page.goto("/?windowType=editor");
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
