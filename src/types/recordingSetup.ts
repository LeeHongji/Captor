export const SETUP_PERMISSIONS = ["screen", "accessibility", "microphone", "camera"] as const;
export type SetupPermission = (typeof SETUP_PERMISSIONS)[number];
export type SetupPermissionStatus =
	| "granted"
	| "not-determined"
	| "denied"
	| "restricted"
	| "unknown";
export const SETUP_VOICE_TEST_SCRIPTS = {
	zh: "你好，欢迎使用 Captor。现在我们测试语音跟读，让光标跟着这段稿件移动。",
	en: "Hello, welcome to Captor. Let's test voice following and start recording.",
};
export interface SetupChoices {
	microphone: boolean;
	camera: boolean;
	systemAudio: boolean;
	voiceFollow: boolean;
}
export interface SetupRecord {
	version: 1;
	step: number;
	completed: boolean;
	fingerprint: string;
	choices: SetupChoices;
}
export interface SetupSnapshot {
	platform: string;
	appVersion: string;
	installation: "applications" | "disk-image" | "other";
	identityChanged: boolean;
	fingerprint: string;
	record: SetupRecord | null;
	permissions: Record<SetupPermission, SetupPermissionStatus>;
	runtime: { supported: boolean; binaries: boolean; storage: boolean };
	model: { exists: boolean; downloading: boolean; progress: number; error: string | null };
	busy: boolean;
	verificationFailures?: SetupPermission[];
}
export type SetupActionResult = { success: boolean; code?: string; snapshot?: SetupSnapshot };
export interface SetupVoiceResult {
	session: string;
	text: string;
	cursor: number;
	error?: string;
}
export interface RecordingSetupAPI {
	snapshot(): Promise<SetupSnapshot>;
	request(permission: SetupPermission): Promise<SetupActionResult>;
	repair(permission: SetupPermission, confirmed: boolean): Promise<SetupActionResult>;
	save(step: number, choices: SetupChoices, completed?: boolean): Promise<SetupActionResult>;
	open(): Promise<void>;
	restart(): Promise<SetupActionResult>;
	onOpen(listener: () => void): () => void;
	acknowledgeOpen(): Promise<void>;
	startupRequired(): Promise<boolean>;
	startMedia(kind: "audio" | "video"): Promise<SetupActionResult>;
	stopMedia(kind: "audio" | "video"): Promise<void>;
	mediaResult(kind: "audio" | "video", success: boolean): Promise<void>;
	startTrial(): Promise<SetupActionResult>;
	cancelTrial(): Promise<void>;
	finishTrial(): Promise<void>;
	trialChoices(): Promise<SetupChoices | null>;
	reportFailure(permission: SetupPermission): Promise<void>;
	exportBusy(busy: boolean): void;
	testMouse(): Promise<SetupActionResult>;
	trialStatus(): Promise<{ phase: string; path?: string; duration?: number } | null>;
	onStopTrial(listener: () => void): () => void;
	startVoiceTest(language: "zh" | "en"): Promise<{ session: string }>;
	stopVoiceTest(session?: string): Promise<void>;
	pushVoiceAudio(session: string, samples: Float32Array): void;
	onVoiceResult(listener: (result: SetupVoiceResult) => void): () => void;
}
declare global {
	interface Window {
		recordingSetupAPI?: RecordingSetupAPI;
	}
}
export function requiredSetupPermissions(choices: SetupChoices): SetupPermission[] {
	return [
		"screen",
		"accessibility",
		...(choices.microphone || choices.voiceFollow ? ["microphone" as const] : []),
		...(choices.camera ? ["camera" as const] : []),
	];
}
export function setupIsReady(snapshot: SetupSnapshot, choices: SetupChoices) {
	return (
		snapshot.runtime.supported &&
		snapshot.runtime.binaries &&
		snapshot.runtime.storage &&
		!snapshot.verificationFailures?.some((permission) =>
			requiredSetupPermissions(choices).includes(permission),
		) &&
		requiredSetupPermissions(choices).every(
			(permission) => snapshot.permissions[permission] === "granted",
		) &&
		(!choices.voiceFollow || snapshot.model.exists)
	);
}
export function normalizeSetupChoices(input: unknown): SetupChoices {
	const value = input && typeof input === "object" ? (input as Partial<SetupChoices>) : {};
	return {
		microphone: value.microphone === true,
		camera: value.camera === true,
		systemAudio: value.systemAudio === true,
		voiceFollow: value.voiceFollow !== false,
	};
}
