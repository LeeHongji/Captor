import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../ipc/captions/whisper", () => ({ downloadFileWithProgress: vi.fn() }));
import {
	createPrompterModelStore,
	PROMPTER_MODEL_FILES,
	PROMPTER_MODEL_REVISION,
	sha256ModelFile,
} from "./model";
let directory: string;
afterEach(async () => {
	if (directory) await fs.rm(directory, { recursive: true, force: true });
});
describe("local model integrity", () => {
	it("rejects same-size corrupted model files and offers a repair diagnostic", async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "captor-model-integrity-"));
		for (const file of PROMPTER_MODEL_FILES) {
			const handle = await fs.open(path.join(directory, file.name), "w");
			await handle.truncate(file.bytes);
			await handle.close();
		}
		await fs.writeFile(
			path.join(directory, "ready.json"),
			JSON.stringify({ revision: PROMPTER_MODEL_REVISION }),
		);
		const status = await createPrompterModelStore(directory, () => undefined).status();
		expect(status.exists).toBe(false);
		expect(status.error).toContain("Download the model again");
	});
	it("streams SHA-256 without loading the complete model into memory", async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "captor-model-hash-"));
		const file = path.join(directory, "model");
		const input = "known local model bytes";
		await fs.writeFile(file, input);
		expect(await sha256ModelFile(file)).toBe(createHash("sha256").update(input).digest("hex"));
	});
});
