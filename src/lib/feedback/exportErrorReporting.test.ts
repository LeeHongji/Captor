import { expect, it } from "vitest";
import { buildExportErrorReport } from "./exportErrorReporting";
import { buildVideoDecodeRecoveryFailure } from "../exporter/streamingDecoderSupport";

it("keeps both decoder failures and allowlists numerical positions without uploading private text", () => {
	const first = new Error(
		"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: private /Users/name/video.mp4 user@example.com (sourceTimeSec=0.500, chunkIndex=25, chunkBytes=101256)",
	);
	const second = new Error(
		"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: Bearer secret (sourceTimeSec=0.520, chunkIndex=26, chunkBytes=5)",
	);
	const combined = buildVideoDecodeRecoveryFailure(first, second);
	expect(combined.message).toContain("Source corruption is not confirmed");
	expect(combined.cause).toEqual({ initial: first, software: second });
	const report = buildExportErrorReport(
		`${combined.message}\nFailure stage: Input video decoding\nOutput: 1920x1080 @ 30 FPS\nPlatform: Windows\nCaptor version: 1.4.0`,
		"mp4",
	);
	expect(report.failure.code).toBe("VIDEO_DECODE_RECOVERY_FAILED");
	expect(report.initialDecoder).toEqual({
		code: "VIDEO_DECODE_ENCODING_ERROR",
		sourceTimeSec: 0.5,
		chunkIndex: 25,
		chunkBytes: 101256,
	});
	expect(report.softwareDecoder?.sourceTimeSec).toBe(0.52);
	const payload = JSON.stringify(report);
	for (const privateValue of [
		"/Users/",
		"name",
		"user@example.com",
		"Bearer",
		"secret",
		"video.mp4",
	])
		expect(payload).not.toContain(privateValue);
});
it("handles GIF, legacy and save failures with no free-text fallback", () => {
	const report = buildExportErrorReport(
		"Failed to save GIF at C:\\Users\\Alice\\private.gif",
		"gif",
	);
	expect(report).toMatchObject({
		format: "gif",
		failure: { code: "SAVE_FAILED" },
		stage: "saving",
		platform: "unknown",
	});
	expect(JSON.stringify(report)).not.toContain("Alice");
});
