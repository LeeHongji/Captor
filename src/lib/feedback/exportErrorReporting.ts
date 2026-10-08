import packageInfo from "../../../package.json";
export interface DecoderAttempt {
	code: string;
	sourceTimeSec?: number;
	chunkIndex?: number;
	chunkBytes?: number;
}
export interface ExportErrorReport {
	schemaVersion: number;
	format: "mp4" | "gif" | "unknown";
	failure: DecoderAttempt;
	stage: "input_decoding" | "saving" | "export";
	initialDecoder?: DecoderAttempt;
	softwareDecoder?: DecoderAttempt;
	appVersion?: string;
	platform: string;
	output?: { width: number; height: number; fps: number };
}

const FAILURE_CODES = new Set([
	"VIDEO_DECODE_ENCODING_ERROR",
	"VIDEO_DECODER_RESOURCE_EXHAUSTED",
	"VIDEO_DECODER_INVALID_STATE",
	"VIDEO_DECODE_FAILED",
	"VIDEO_CODEC_UNSUPPORTED",
	"VIDEO_DECODE_RECOVERY_FAILED",
]);
function decodeAttempt(message: string) {
	const numeric = (key: string) => {
		const match = message.match(new RegExp(`\\b${key}=([0-9]+(?:\\.[0-9]+)?)(?=[,;)\\s]|$)`));
		const value = match ? Number(match[1]) : undefined;
		return value !== undefined && Number.isFinite(value) ? value : undefined;
	};
	const match = message.match(/\[(VIDEO_[A-Z_]+)\]/)?.[1];
	return {
		code: match && FAILURE_CODES.has(match) ? match : "UNKNOWN",
		sourceTimeSec: numeric("sourceTimeSec"),
		chunkIndex: numeric("chunkIndex"),
		chunkBytes: numeric("chunkBytes"),
	};
}
/** Allowlist only: never include free-text errors, stack traces, paths, logs, or media. */
export function buildExportErrorReport(
	message: string,
	format: "mp4" | "gif" | "unknown" = "unknown",
): ExportErrorReport {
	const bounded = message.slice(0, 32_000);
	const software = bounded.split("Software decoder failure: ")[1];
	const initial = bounded
		.split("Initial decoder failure: ")[1]
		?.split("\nSoftware decoder failure:")[0];
	const output = bounded.match(/Output: (\d{1,5})x(\d{1,5}) @ (\d{1,3}(?:\.\d{1,3})?) FPS/);
	const version =
		bounded.match(/Captor version: (\d{1,4}\.\d{1,4}\.\d{1,4})\b/)?.[1] ?? packageInfo.version;
	const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
	const platform =
		bounded.match(/Platform: (Windows|macOS|Linux)\b/)?.[1] ??
		(/Windows/.test(userAgent)
			? "Windows"
			: /Macintosh|Mac OS/.test(userAgent)
				? "macOS"
				: /Linux/.test(userAgent)
					? "Linux"
					: "unknown");
	const failure = decodeAttempt(bounded);
	const inputDecoding = failure.code !== "UNKNOWN";
	if (!inputDecoding) {
		failure.code = /Failed to save (?:video|GIF)|No pending export to save/i.test(bounded)
			? "SAVE_FAILED"
			: /audio/i.test(bounded)
				? "AUDIO_FAILED"
				: /encod|ffmpeg/i.test(bounded)
					? "ENCODE_FAILED"
					: "EXPORT_FAILED";
	}
	return {
		format,
		schemaVersion: 1,
		failure,
		stage:
			inputDecoding || /Failure stage: Input video decoding/.test(bounded)
				? "input_decoding"
				: /Failed to save (?:video|GIF)|No pending export to save/i.test(bounded)
					? "saving"
					: "export",
		initialDecoder: initial ? decodeAttempt(initial) : undefined,
		softwareDecoder: software ? decodeAttempt(software) : undefined,
		appVersion: version,
		platform: platform ?? "unknown",
		output: output
			? { width: Number(output[1]), height: Number(output[2]), fps: Number(output[3]) }
			: undefined,
	};
}
