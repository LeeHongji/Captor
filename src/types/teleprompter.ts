export interface RecordingDraft {
	version: 1;
	text: string;
	fontSize: number;
	width: number;
	opacity: number;
	hideFromCapture: boolean;
	voiceFollow: boolean;
}

export type PrompterPhase =
	| "idle"
	| "ready"
	| "rehearsal"
	| "preparing"
	| "recording"
	| "paused"
	| "finalizing";
export interface PrompterState {
	sequence: number;
	draft: RecordingDraft;
	cursor: number;
	phase: PrompterPhase;
	armed: boolean;
	recognition: "idle" | "loading" | "listening" | "holding" | "error";
	error: string | null;
}

export interface PrompterModelStatus {
	exists: boolean;
	downloading: boolean;
	progress: number;
	error: string | null;
}

export interface TeleprompterAPI {
	getState(): Promise<PrompterState>;
	saveDraft(draft: RecordingDraft): Promise<PrompterState>;
	draftDirty(dirty: boolean): void;
	flushDraft(): Promise<void>;
	show(): Promise<void>;
	hide(): Promise<void>;
	arm(enabled: boolean): Promise<void>;
	rehearse(): Promise<void>;
	stopRehearsal(): Promise<void>;
	setCursor(offset: number): Promise<void>;
	recordingPhase(phase: PrompterPhase): Promise<void>;
	modelStatus(): Promise<PrompterModelStatus>;
	downloadModel(): Promise<PrompterModelStatus>;
	startRecognition(): Promise<string>;
	stopRecognition(session: string): Promise<void>;
	recognitionFailed(session: string | null, error: string): Promise<void>;
	pushAudio(session: string, samples: Float32Array, sampleRate: number): void;
	onState(listener: (state: PrompterState) => void): () => void;
	onModel(listener: (status: PrompterModelStatus) => void): () => void;
}

declare global {
	interface Window {
		teleprompterAPI?: TeleprompterAPI;
	}
}

export const DEFAULT_RECORDING_DRAFT: RecordingDraft = {
	version: 1,
	text: "",
	fontSize: 32,
	width: 640,
	opacity: 0.85,
	hideFromCapture: true,
	voiceFollow: true,
};

export const INITIAL_PROMPTER_STATE: PrompterState = {
	sequence: 0,
	draft: DEFAULT_RECORDING_DRAFT,
	cursor: 0,
	phase: "idle",
	armed: false,
	recognition: "idle",
	error: null,
};

export function normalizeRecordingDraft(value: unknown): RecordingDraft {
	const input = value && typeof value === "object" ? (value as Partial<RecordingDraft>) : {};
	const number = (value: unknown, fallback: number, min: number, max: number) =>
		typeof value === "number" && Number.isFinite(value)
			? Math.max(min, Math.min(max, value))
			: fallback;
	return {
		version: 1,
		text: typeof input.text === "string" ? input.text.slice(0, 100_000) : "",
		fontSize: number(input.fontSize, 32, 18, 64),
		width: number(input.width, 640, 320, 1000),
		opacity: number(input.opacity, 0.85, 0.15, 1),
		hideFromCapture: input.hideFromCapture !== false,
		voiceFollow: input.voiceFollow !== false,
	};
}
