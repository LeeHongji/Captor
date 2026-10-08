import packageInfo from "../../../package.json";

export const FEEDBACK_EMAIL = "2020124002@email.szu.edu.cn";

export type FeedbackEmailInput = { subject: string; message: string };

export function buildFeedbackDraft(input: unknown, platform: string) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Add a subject and description.");
	}
	const { subject, message } = input as Partial<FeedbackEmailInput>;
	if (
		typeof subject !== "string" ||
		typeof message !== "string" ||
		!subject.trim() ||
		!message.trim()
	) {
		throw new Error("Add a subject and description.");
	}
	if (
		subject.length > 160 ||
		message.length > 10000 ||
		/[\r\n\0]/.test(subject) ||
		/\0/.test(message)
	) {
		throw new Error(
			"Use a single-line subject (up to 160 characters) and a description up to 10,000 characters.",
		);
	}
	const system =
		platform === "darwin"
			? "macOS"
			: platform === "win32"
				? "Windows"
				: platform === "linux"
					? "Linux"
					: "unknown";
	const title = `[Captor] ${subject.trim()}`;
	const body = `${message.trim()}\n\n---\nCaptor ${packageInfo.version}\nSystem: ${system}`;
	return {
		subject: title,
		body,
		url: `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`,
	};
}
