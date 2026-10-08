import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const theme of ["light", "dark"] as const) {
	test(`local app has no login or cloud entrypoints (${theme})`, async ({ page }) => {
		await page.setViewportSize({
			width: theme === "light" ? 1440 : 1280,
			height: theme === "light" ? 1000 : 800,
		});
		await page.emulateMedia({ colorScheme: theme });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await expect(page.getByRole("navigation", { name: "Editor tools" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Captor account", exact: true })).toHaveCount(
			0,
		);
		await expect(page.getByText("Welcome to Captor", { exact: true })).toHaveCount(0);
		await page.screenshot({
			path: `test-results/local-editor-${theme}.png`,
			animations: "disabled",
		});
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(home).toBeVisible();
		await expect(home.getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
		await expect(home.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
		await expect(home.getByRole("button", { name: "Record new", exact: true })).toBeVisible();
		await expect(home.getByText("Forked from Recordly", { exact: true })).toBeVisible();
		expect(
			await home.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
		).toBe(true);
		await page.screenshot({
			path: `test-results/local-home-${theme}.png`,
			animations: "disabled",
		});
		await home.getByRole("button", { name: "Feedback", exact: true }).click();
		const feedback = page.getByRole("dialog", { name: "Send feedback", exact: true });
		await expect(feedback.getByRole("textbox", { name: /Subject/ })).toBeVisible();
		await expect(feedback.getByText("Attach files", { exact: true })).toHaveCount(0);
		await page.screenshot({
			path: `test-results/local-feedback-${theme}.png`,
			animations: "disabled",
		});
	});
}

test("feedback prepares an email without sending or clearing the user's text", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Feedback", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await dialog.getByRole("button", { name: "Prepare email", exact: true }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-prepared-email");
	await dialog.getByRole("textbox", { name: /Subject/ }).fill("录屏 & 导出？");
	await dialog.getByRole("textbox", { name: /Description/ }).fill("第一行\n第二行 + #");
	await dialog.getByRole("button", { name: "Prepare email", exact: true }).click();
	await expect(dialog.getByRole("status")).toContainText("Review the draft");
	expect(
		JSON.parse((await page.locator("html").getAttribute("data-prepared-email")) || "{}"),
	).toEqual({ subject: "录屏 & 导出？", message: "第一行\n第二行 + #" });
	await expect(dialog.getByRole("textbox", { name: /Subject/ })).toHaveValue("录屏 & 导出？");
	await expect(dialog.getByText("Thanks for your feedback", { exact: true })).toHaveCount(0);
});

test("failed email opening preserves input and offers copying the draft", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			value: {
				writeText: async (text: string) => {
					document.documentElement.dataset.copiedFeedback = text;
				},
			},
		});
	});
	await page.goto("/?windowType=editor&email-fails");
	await page.getByRole("button", { name: "Feedback", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Send feedback", exact: true });
	await dialog.getByRole("textbox", { name: /Subject/ }).fill("Problem");
	await dialog.getByRole("textbox", { name: /Description/ }).fill("My description");
	await dialog.getByRole("button", { name: "Prepare email", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("Could not open");
	await expect(dialog.getByRole("textbox", { name: /Description/ })).toHaveValue(
		"My description",
	);
	await dialog.getByRole("button", { name: "Copy feedback", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-copied-feedback",
		/To: 2020124002@email.szu.edu.cn/,
	);
	await expect(page.locator("html")).toHaveAttribute("data-copied-feedback", /My description/);
});

for (const theme of ["light", "dark"] as const) {
	test(`export goes straight to local format and settings (${theme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: theme });
		await page.goto("/tests/ui/export.html");
		await page.getByRole("button", { name: "Export", exact: true }).click();
		await expect(page.getByRole("grid", { name: "Format", exact: true })).toBeVisible();
		await expect(page.getByRole("row", { name: "Link", exact: true })).toHaveCount(0);
		await expect(page.getByRole("row", { name: "Local", exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Export Video", exact: true })).toBeVisible();
		await page.screenshot({
			path: `test-results/local-export-${theme}.png`,
			animations: "disabled",
		});
		await page.getByRole("row", { name: "GIF", exact: true }).click();
		await expect(page.getByRole("switch", { name: "Loop", exact: false })).toBeVisible();
		await page.getByRole("button", { name: "Export GIF", exact: true }).click();
		await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-export-canceled", "true");
	});
}

test("local export preserves retry-save and reveal-in-folder controls", async ({ page }) => {
	await page.goto("/tests/ui/export.html");
	await page.getByRole("button", { name: "Fixture save canceled", exact: true }).click();
	await expect(page.getByRole("button", { name: "Save Again", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Save Again", exact: true }).click();
	await expect(page.getByText("Export complete", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Show In Folder", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-revealed", "true");
});
