import { describe, expect, it } from "vitest";
import { buildFeedbackDraft, FEEDBACK_EMAIL } from "./emailDraft";

describe("feedback email drafts", () => {
	it("preserves Chinese, newlines, spaces and reserved characters in exactly two mailto fields", () => {
		const draft = buildFeedbackDraft(
			{
				subject: "录制 & 导出？ + #",
				message: "第一行 &bcc=attacker@example.com\n第二行 + ? # /",
			},
			"darwin",
		);
		const url = new URL(draft.url);
		expect(url.protocol).toBe("mailto:");
		expect(url.pathname).toBe(FEEDBACK_EMAIL);
		expect([...url.searchParams.keys()]).toEqual(["subject", "body"]);
		expect(url.searchParams.get("subject")).toBe(draft.subject);
		expect(url.searchParams.get("body")).toBe(draft.body);
		expect(draft.body).toContain("第一行 &bcc=attacker@example.com\n第二行 + ? # /");
		expect(draft.body).toContain("System: macOS");
		expect(draft.url).not.toContain("subject=[Captor]+");
	});
	it.each([
		null,
		[],
		{},
		{ subject: "", message: "ok" },
		{ subject: "ok", message: "  " },
		{ subject: "x\r\nBcc: bad@example.com", message: "ok" },
		{ subject: "x".repeat(161), message: "ok" },
		{ subject: "ok", message: "x".repeat(10001) },
		{ subject: "ok", message: "x\0y" },
	])("rejects invalid feedback before opening an external app: %j", (input) =>
		expect(() => buildFeedbackDraft(input, "linux")).toThrow());
	it.each([
		["win32", "Windows"],
		["linux", "Linux"],
		["unknown", "unknown"],
	])("adds only version and platform metadata for %s", (platform, label) => {
		const draft = buildFeedbackDraft({ subject: "feedback", message: "test" }, platform);
		expect(draft.body).toContain(`System: ${label}`);
		expect(draft.body).not.toMatch(/\/Users\/|Bearer |token|recording/);
	});
	it("keeps the feedback address fixed even if extra fields are supplied", () => {
		const draft = buildFeedbackDraft(
			{
				subject: "hello",
				message: "body",
				to: "attacker@example.com",
				url: "file:///tmp/test",
			},
			"darwin",
		);
		expect(new URL(draft.url).pathname).toBe(FEEDBACK_EMAIL);
	});
});
