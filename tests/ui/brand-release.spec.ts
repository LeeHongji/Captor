import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("manual update notification opens downloads without requesting install or restart", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentUpdateToastPayload = async () => ({
			version: "0.0.3",
			detail: "",
			phase: "available",
			delayMs: 60_000,
			primaryAction: "open-download",
		});
		window.electronAPI.openUpdateDownloadPage = async () => {
			document.documentElement.dataset.downloadOpened = "true";
			return { success: true };
		};
		window.electronAPI.downloadAvailableUpdate = async () => {
			throw Error("Manual mode must not download an automatic update");
		};
		window.electronAPI.installDownloadedUpdate = async () => {
			throw Error("Manual mode must not restart");
		};
	});
	await page.setViewportSize({ width: 480, height: 220 });
	await page.goto("/?windowType=update-toast");
	await expect(page.getByText(/Save your work and quit Captor/)).toBeVisible();
	await page.getByRole("button", { name: "Download installer" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-download-opened", "true");
});

for (const theme of ["light", "dark"] as const) {
	test(`lavender ${theme} controls remain readable in compact settings`, async ({ page }) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(theme) => {
				localStorage.setItem("captor.theme", theme);
				window.electronAPI.getUpdateStatusSummary = async () => ({
					status: "idle",
					currentVersion: "0.0.2",
					availableVersion: null,
					distributionMode: "manual",
				});
			},
			theme,
		);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/?windowType=editor");
		await page.getByRole("radio", { name: "Settings", exact: true }).click();
		await expect(page.getByRole("button", { name: "Downloads and releases" })).toBeVisible();
		await expect(page.getByText("Captor 0.0.2", { exact: true })).toBeVisible();
		const colors = await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			return [
				style.getPropertyValue("--accent").trim(),
				style.getPropertyValue("--accent-foreground").trim(),
			];
		});
		expect(colors).toEqual(theme === "light" ? ["#4e3282", "#ffffff"] : ["#b69cd2", "#191321"]);
		await page.screenshot({
			path: `test-results/lavender-settings-${theme}.png`,
			animations: "disabled",
		});
	});
}

test("manual download failures stay visible and can be retried", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentUpdateToastPayload = async () => ({
			version: "0.0.3",
			detail: "",
			phase: "available",
			delayMs: 60000,
			primaryAction: "open-download",
		});
		window.electronAPI.openUpdateDownloadPage = async () => ({
			success: false,
			message: "unavailable",
		});
	});
	await page.setViewportSize({ width: 420, height: 172 });
	await page.goto("/?windowType=update-toast");
	await page.getByRole("button", { name: "Download installer" }).click();
	await expect(page.getByRole("alert")).toHaveText("Could not open the download page.");
	await expect(page.getByRole("button", { name: "Download installer" })).toBeEnabled();
});
