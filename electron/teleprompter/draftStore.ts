import fs from "node:fs/promises";
import path from "node:path";
import { normalizeRecordingDraft, type RecordingDraft } from "../../src/types/teleprompter";
import { writeProjectFileAtomically } from "../ipc/project/atomicSave";

export function createRecordingDraftStore(filePath: string) {
	return {
		async read(): Promise<RecordingDraft> {
			let content: string;
			try {
				content = await fs.readFile(filePath, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					return normalizeRecordingDraft(null);
				throw error;
			}
			try {
				return normalizeRecordingDraft(JSON.parse(content));
			} catch (parseError) {
				try {
					return normalizeRecordingDraft(
						JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8")),
					);
				} catch {
					throw parseError;
				}
			}
		},
		async write(draft: RecordingDraft) {
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await writeProjectFileAtomically(
				filePath,
				JSON.stringify(normalizeRecordingDraft(draft), null, 2),
			);
		},
	};
}
