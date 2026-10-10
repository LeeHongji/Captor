import { afterEach, describe, expect, it, vi } from "vitest";
import { flushRecordingDraft, registerRecordingDraftFlush } from "./recordingDraftFlush";
afterEach(() => vi.unstubAllGlobals());
describe("save recording draft before closing", () => {
	it("waits for current input and main-process queued writes", async () => {
		const calls: string[] = [];
		vi.stubGlobal("window", {
			teleprompterAPI: {
				flushDraft: async () => {
					calls.push("disk");
				},
			},
		});
		const unregister = registerRecordingDraftFlush(async () => {
			calls.push("input");
			return true;
		});
		expect(await flushRecordingDraft()).toBe(true);
		expect(calls).toEqual(["input", "disk"]);
		unregister();
	});
	it("blocks close when input cannot be saved", async () => {
		const flush = vi.fn();
		vi.stubGlobal("window", { teleprompterAPI: { flushDraft: flush } });
		const unregister = registerRecordingDraftFlush(async () => false);
		expect(await flushRecordingDraft()).toBe(false);
		expect(flush).not.toHaveBeenCalled();
		unregister();
	});
});
