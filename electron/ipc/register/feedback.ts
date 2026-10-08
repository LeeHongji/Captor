import { ipcMain, shell } from "electron";
import { buildFeedbackDraft } from "../../../src/lib/feedback/emailDraft";

export function registerFeedbackHandlers() {
	ipcMain.handle("prepare-feedback-email", async (_event, input: unknown) => {
		let url: string;
		try {
			url = buildFeedbackDraft(input, process.platform).url;
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Invalid feedback.",
			};
		}
		try {
			await shell.openExternal(url);
			return { success: true };
		} catch {
			return {
				success: false,
				error: "Could not open your email app. Copy the feedback and email it to the address below.",
			};
		}
	});
}
