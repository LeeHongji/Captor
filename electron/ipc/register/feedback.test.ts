import { beforeEach, expect, it, vi } from "vitest";
const { handlers, openExternal } = vi.hoisted(() => ({
	handlers: new Map<
		string,
		(_event: unknown, input: unknown) => Promise<{ success: boolean; error?: string }>
	>(),
	openExternal: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (
			name: string,
			handler: (
				_event: unknown,
				input: unknown,
			) => Promise<{ success: boolean; error?: string }>,
		) => handlers.set(name, handler),
	},
	shell: { openExternal },
}));
import { registerFeedbackHandlers } from "./feedback";
beforeEach(() => {
	handlers.clear();
	openExternal.mockReset().mockResolvedValue(undefined);
	registerFeedbackHandlers();
});
it("opens a fixed-recipient draft only after the explicit IPC call", async () => {
	expect(openExternal).not.toHaveBeenCalled();
	await expect(
		handlers.get("prepare-feedback-email")?.(null, {
			subject: "录屏",
			message: "问题\n下一行",
		}),
	).resolves.toEqual({ success: true });
	expect(openExternal).toHaveBeenCalledTimes(1);
	const url = new URL(openExternal.mock.calls[0][0]);
	expect(url.protocol).toBe("mailto:");
	expect(url.pathname).toBe("2020124002@email.szu.edu.cn");
	expect(url.searchParams.get("body")).toContain("问题\n下一行");
});
it("does not open a URL for blank or injected input", async () => {
	for (const input of [
		{ subject: "", message: "x" },
		{ subject: "x\r\nbcc=bad", message: "x" },
	]) {
		expect(await handlers.get("prepare-feedback-email")?.(null, input)).toMatchObject({
			success: false,
		});
	}
	expect(openExternal).not.toHaveBeenCalled();
});
it("returns a safe actionable failure without claiming email delivery", async () => {
	openExternal.mockRejectedValue(new Error("private system information"));
	const result = await handlers.get("prepare-feedback-email")?.(null, {
		subject: "x",
		message: "y",
	});
	expect(result).toMatchObject({
		success: false,
		error: expect.stringContaining("Copy the feedback"),
	});
	expect(JSON.stringify(result)).not.toContain("private system information");
	expect(result).not.toHaveProperty("sent");
});
