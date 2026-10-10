let flush: (() => Promise<boolean>) | null = null;
export function registerRecordingDraftFlush(callback: () => Promise<boolean>) {
	flush = callback;
	return () => {
		if (flush === callback) flush = null;
	};
}
export async function flushRecordingDraft() {
	if (flush && !(await flush())) return false;
	try {
		await window.teleprompterAPI?.flushDraft();
		return true;
	} catch {
		return false;
	}
}
