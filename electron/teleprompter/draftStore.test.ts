import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRecordingDraftStore } from "./draftStore";
import { DEFAULT_RECORDING_DRAFT, normalizeRecordingDraft } from "../../src/types/teleprompter";
let directory: string;
afterEach(async () => {
	if (directory) await fs.rm(directory, { recursive: true, force: true });
});
describe("local recording draft", () => {
	it("restores the last full generation after a damaged write", async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "captor-draft-"));
		const file = path.join(directory, "recording-draft.json");
		const store = createRecordingDraftStore(file);
		expect(await store.read()).toEqual(DEFAULT_RECORDING_DRAFT);
		await store.write({ ...DEFAULT_RECORDING_DRAFT, text: "第一份稿件" });
		await store.write({ ...DEFAULT_RECORDING_DRAFT, text: "下一份稿件" });
		await fs.writeFile(file, "{broken");
		expect((await store.read()).text).toBe("第一份稿件");
	});
	it("normalizes malformed settings without allowing unbounded window sizes", () => {
		expect(
			normalizeRecordingDraft({ fontSize: Infinity, width: 100000, opacity: -1 }).fontSize,
		).toBe(32);
		expect(normalizeRecordingDraft({ width: 100000 }).width).toBe(1000);
		expect(normalizeRecordingDraft({ opacity: -1 }).opacity).toBe(0.15);
	});
	it("preserves filesystem errors instead of replacing them with a missing-backup error", async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "captor-draft-error-"));
		const target = path.join(directory, "recording-draft.json");
		await fs.mkdir(target);
		await expect(createRecordingDraftStore(target).read()).rejects.toMatchObject({
			code: "EISDIR",
		});
	});
});
