import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { _electron, expect } from "@playwright/test";

const arch = process.argv[2];
if (process.platform !== "darwin" || process.arch !== arch)
	throw Error("Run on the matching native macOS architecture.");
const executable =
	process.argv[3] ??
	path.resolve(
		"release",
		arch === "arm64" ? "mac-arm64" : "mac",
		"Captor.app/Contents/MacOS/Captor",
	);
const profile = fs.realpathSync(
	fs.mkdtempSync(path.join(os.tmpdir(), "captor-packaged-prompter-")),
);
const app = await _electron.launch({
	executablePath: executable,
	args: [`--user-data-dir=${profile}`, "--lang=en-US"],
	env: { ...process.env, CAPTOR_DISABLE_AUTO_UPDATES: "1" },
	timeout: 30_000,
});
try {
	const userData = await app.evaluate(({ app }) => app.getPath("userData"));
	assert.equal(userData, profile, "Smoke must use an isolated profile");
	const initialWindow = await app.firstWindow();
	let dialogs = 0;
	initialWindow.on("dialog", async (dialog) => { dialogs++; await dialog.dismiss(); });
	await initialWindow.waitForLoadState("domcontentloaded");
	await expect(initialWindow.getByRole("heading", { name: "Prepare your recording environment" })).toBeVisible();
	const environment = await initialWindow.evaluate(() => window.recordingSetupAPI.snapshot());
	assert.equal(environment.runtime.binaries, true);
	assert.equal(environment.runtime.storage, true);
	assert.equal(environment.platform, "darwin");
	assert.equal((await initialWindow.evaluate(() => window.recordingSetupAPI.repair("screen", false))).code, "cancelled");
	await initialWindow.getByRole("button", { name: "View projects first", exact: true }).click();
	assert.equal(dialogs, 0, "Setup must not produce startup permission alerts");
	await expect
		.poll(() => app.windows().some((page) => page.url().includes("windowType=editor")), {
			timeout: 30_000,
		})
		.toBe(true);
	const editor = app.windows().find((page) => page.url().includes("windowType=editor"));
	assert.match(editor.url(), /^http:\/\/127\.0\.0\.1:\d+\/\?windowType=editor/);
	await editor.waitForLoadState("domcontentloaded");
	const getState = () => editor.evaluate(() => window.teleprompterAPI.getState());
	const initial = await getState();
	await editor
		.getByRole("button", { name: "Record new", exact: true })
		.click();
	await expect.poll(async () => (await getState()).sequence).toBeGreaterThan(initial.sequence);
	assert.equal((await getState()).armed, false);
	await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().includes("windowType=hud-overlay") && window.isVisible()),
	), { timeout: 30_000 }).toBe(true);
	const hud = app.windows().find((page) => page.url().includes("windowType=hud-overlay"));
	assert.ok(hud);
	assert.equal(new URL(hud.url()).origin, new URL(editor.url()).origin, "Device tests and capture must use the same origin");
	await hud.evaluate(() => window.electronAPI.showProjectDashboard());
	await editor.getByRole("button", { name: "Prepare narration", exact: true }).click();
	await editor.getByLabel("Narration script").fill("大家好，这是正式安装包的带稿录制验证。");
	await editor.getByRole("button", { name: "Record with script", exact: true }).click();
	await expect.poll(async () => (await getState()).armed).toBe(true);
	assert.equal((await getState()).phase, "ready");
	await expect
		.poll(() => app.windows().some((page) => page.url().includes("windowType=teleprompter")))
		.toBe(true);
	const prompt = app.windows().find((page) => page.url().includes("windowType=teleprompter"));
	await expect(prompt.getByRole("button", { name: "Next word" })).toBeVisible();
	await prompt.getByRole("button", { name: "Next word" }).click();
	await expect.poll(async () => (await getState()).cursor).toBeGreaterThan(0);
	await hud.evaluate(() => window.electronAPI.showProjectDashboard());
	await editor.getByRole("button", { name: "Skip preparation and record", exact: true }).click();
	await expect.poll(async () => (await getState()).armed).toBe(false);
	console.log(
		JSON.stringify({
			arch,
			packagedEditor: editor.url(),
			setupEntry: true,
			unsolicitedDialogs: dialogs,
			directEntry: true,
			scriptEntry: true,
			promptControl: true,
			skipEntry: true,
		}),
	);
} finally {
	await app.close();
	fs.rmSync(profile, { recursive: true, force: true });
}
