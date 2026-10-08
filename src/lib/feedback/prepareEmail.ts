import { buildFeedbackDraft, FEEDBACK_EMAIL, type FeedbackEmailInput } from "./emailDraft";

export async function copyFeedbackEmail(input: FeedbackEmailInput) {
	const platform = await window.electronAPI.getPlatform();
	const draft = buildFeedbackDraft(input, platform);
	await navigator.clipboard.writeText(
		`To: ${FEEDBACK_EMAIL}\nSubject: ${draft.subject}\n\n${draft.body}`,
	);
}
