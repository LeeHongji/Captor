import { expect, test } from "@playwright/test";

test("export-error email is prepared explicitly with sanitized technical details", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("functions/v1")) requests.push(request.url());
	});
	await page.goto("/tests/ui/export-error-report.html");
	await page.getByRole("button", { name: "Report error", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Report export error", exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-prepared-email");
	await dialog.getByText("View data to be sent", { exact: true }).click();
	await expect(dialog.locator("pre")).toContainText("VIDEO_DECODE_ENCODING_ERROR");
	await expect(dialog.locator("pre")).not.toContainText("Alice");
	await expect(dialog.locator("pre")).not.toContainText("cloudPlan");
	await expect(dialog.getByLabel("Cloud plan", { exact: false })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Prepare email", exact: true }).click();
	await expect(dialog.getByRole("status")).toContainText("Review the draft");
	const draft = JSON.parse(
		(await page.locator("html").getAttribute("data-prepared-email")) || "{}",
	);
	expect(draft.subject).toBe("Export error (MP4)");
	expect(JSON.parse(draft.message)).toMatchObject({
		format: "mp4",
		failure: { code: "VIDEO_DECODE_ENCODING_ERROR" },
	});
	expect(draft.message).not.toMatch(/Alice|\/Users\/|alice@example|cloudPlan/);
	await expect(page.getByText("Report sent", { exact: true })).toHaveCount(0);
	expect(requests).toEqual([]);
});
