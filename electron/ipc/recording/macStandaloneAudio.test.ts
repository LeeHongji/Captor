import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");
const ffprobePath: string = require("ffprobe-static").path;
const run = promisify(execFile);
vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getAppPath: () => process.cwd(),
		getPath: () => os.tmpdir(),
		setPath: () => undefined,
	},
	BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => ffmpegPath,
	getFfprobeBinaryPath: () => ffprobePath,
}));
vi.mock("../cursor/telemetry", () => ({
	persistPendingCursorTelemetry: async () => undefined,
	snapshotCursorTelemetryForPersistence: () => undefined,
}));
const roots: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createAudioRecording() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "captor-standalone-audio-"));
	roots.push(root);
	const video = path.join(root, "recording.mp4");
	const system = path.join(root, "recording.system.m4a");
	const mic = path.join(root, "recording.mic.wav");
	await run(ffmpegPath, [
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=black:s=64x64:r=10:d=2",
		"-f",
		"lavfi",
		"-i",
		"anullsrc=r=48000:cl=stereo",
		"-t",
		"2",
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-c:a",
		"aac",
		video,
	]);
	await run(ffmpegPath, [
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		video,
		"-vn",
		"-c:a",
		"copy",
		system,
	]);
	await run(ffmpegPath, [
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=1000:sample_rate=48000:duration=1.5",
		"-c:a",
		"pcm_s16le",
		mic,
	]);
	await fs.writeFile(`${mic}.json`, JSON.stringify({ startDelayMs: 100 }));
	return { root, video, system, mic };
}

it("produces an independently audible MP4 without re-encoding video or losing companion tracks", async () => {
	const { video, system, mic } = await createAudioRecording();
	const videoHash = async () =>
		(
			await run(ffmpegPath, [
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				video,
				"-map",
				"0:v:0",
				"-c:v",
				"copy",
				"-f",
				"hash",
				"-hash",
				"sha256",
				"-",
			])
		).stdout.trim();
	const originalHash = await videoHash();
	const { muxNativeMacRecordingWithAudio } = await import("./mac");
	await muxNativeMacRecordingWithAudio(video, system, mic);
	const { stderr } = await run(ffmpegPath, [
		"-hide_banner",
		"-i",
		video,
		"-vn",
		"-af",
		"volumedetect",
		"-f",
		"null",
		"-",
	]);
	const volume = Number(stderr.match(/mean_volume:\s*([-\d.]+) dB/)?.[1]);
	expect(volume).toBeGreaterThan(-30);
	expect(await videoHash()).toBe(originalHash);
	const report = JSON.parse(
		(
			await run(ffprobePath, [
				"-v",
				"error",
				"-show_entries",
				"format=duration:stream=codec_type",
				"-of",
				"json",
				video,
			])
		).stdout,
	);
	expect(report.streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual([
		"video",
		"audio",
	]);
	expect(Number(report.format.duration)).toBeGreaterThanOrEqual(2);
	expect((await fs.stat(mic)).size).toBeGreaterThan(0);
	expect((await fs.stat(system)).size).toBeGreaterThan(0);
	const once = await fs.readFile(video);
	await muxNativeMacRecordingWithAudio(video, system, mic);
	expect(await fs.readFile(video)).toEqual(once);
	expect(JSON.parse(await fs.readFile(`${mic}.json`, "utf8"))).toMatchObject({
		startDelayMs: 100,
		embeddedInVideo: true,
	});
}, 30_000);

it("keeps microphone-only playback separate from an already complete MP4", async () => {
	const { video, system, mic } = await createAudioRecording();
	await fs.rm(system);
	const { muxNativeMacRecordingWithAudio } = await import("./mac");
	await muxNativeMacRecordingWithAudio(video, null, mic);
	const { getCompanionAudioFallbackInfo } = await import("./diagnostics");
	const info = await getCompanionAudioFallbackInfo(video);
	expect(info.paths).toEqual([mic]);
	const { resolveSourceTrackRoutingPolicy } = await import(
		"../../../src/lib/exporter/sourceTrackRoutingPolicy"
	);
	const plan = resolveSourceTrackRoutingPolicy(video, info.paths);
	expect(plan.includeEmbeddedInExport).toBe(false);
	expect(plan.muteEmbeddedPreview).toBe(true);
}, 30_000);

it("preserves original video, tracks and timing when audio materialization fails", async () => {
	const { root, video, system, mic } = await createAudioRecording();
	await fs.writeFile(mic, "invalid audio");
	const originalVideo = await fs.readFile(video);
	const originalTiming = await fs.readFile(`${mic}.json`);
	const { muxNativeMacRecordingWithAudio } = await import("./mac");
	await expect(muxNativeMacRecordingWithAudio(video, system, mic)).rejects.toThrow();
	expect(await fs.readFile(video)).toEqual(originalVideo);
	expect(await fs.readFile(`${mic}.json`)).toEqual(originalTiming);
	expect(await fs.readFile(mic, "utf8")).toBe("invalid audio");
	expect(
		(await fs.readdir(root)).filter(
			(name) => name.includes(".audio-") || name.endsWith(".tmp"),
		),
	).toEqual([]);
}, 30_000);

it("refuses renderer-selected paths while allowing the capture-owned target and retry", async () => {
	const { video, system, mic } = await createAudioRecording();
	const { registerRecordedAudioTarget, finalizeOwnedRecordingAudio } = await import(
		"./standaloneAudio"
	);
	registerRecordedAudioTarget(`${video}.different`);
	const original = await fs.readFile(video);
	await expect(finalizeOwnedRecordingAudio(video, true)).rejects.toThrow(
		"Invalid recording audio finalization target",
	);
	expect(await fs.readFile(video)).toEqual(original);
	registerRecordedAudioTarget(video);
	await fs.writeFile(mic, "invalid audio");
	await expect(finalizeOwnedRecordingAudio(video, true)).rejects.toThrow();
	await fs.rm(mic);
	await run(ffmpegPath, [
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=1000:duration=1.5",
		mic,
	]);
	await finalizeOwnedRecordingAudio(video, true);
	await finalizeOwnedRecordingAudio(video, true);
	expect((await fs.stat(system)).size).toBeGreaterThan(0);
}, 30_000);

it("rolls back timing metadata and preserves the original if replacing the MP4 fails", async () => {
	const { root, video, mic } = await createAudioRecording();
	const original = await fs.readFile(video);
	const timing = await fs.readFile(`${mic}.json`);
	const rename = fs.rename.bind(fs);
	vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
		if (to === video) throw Error("replacement unavailable");
		return rename(from, to);
	});
	const { finalizeStandaloneRecordingAudio } = await import("./standaloneAudio");
	await expect(finalizeStandaloneRecordingAudio(video, true)).rejects.toThrow(
		"replacement unavailable",
	);
	expect(await fs.readFile(video)).toEqual(original);
	expect(await fs.readFile(`${mic}.json`)).toEqual(timing);
	expect(
		(await fs.readdir(root)).filter(
			(name) => name.includes(".audio-") || name.endsWith(".tmp"),
		),
	).toEqual([]);
}, 30_000);

it("cancels pending finalization without changing original files", async () => {
	const { root, video, mic } = await createAudioRecording();
	const original = await fs.readFile(video);
	const timing = await fs.readFile(`${mic}.json`);
	const {
		finalizeStandaloneRecordingAudio,
		cancelRecordingAudioFinalizations,
		hasRecordingAudioFinalization,
	} = await import("./standaloneAudio");
	const pending = finalizeStandaloneRecordingAudio(video, true);
	expect(hasRecordingAudioFinalization()).toBe(true);
	cancelRecordingAudioFinalizations();
	await expect(pending).rejects.toThrow();
	expect(hasRecordingAudioFinalization()).toBe(false);
	expect(await fs.readFile(video)).toEqual(original);
	expect(await fs.readFile(`${mic}.json`)).toEqual(timing);
	expect(
		(await fs.readdir(root)).filter(
			(name) => name.includes(".audio-") || name.endsWith(".tmp"),
		),
	).toEqual([]);
}, 30_000);

it("waits for metadata rollback when quitting during the commit window", async () => {
	const { video, mic } = await createAudioRecording();
	const original = await fs.readFile(video);
	const timing = await fs.readFile(`${mic}.json`);
	let entered!: () => void;
	let release!: () => void;
	const commitReached = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const rename = fs.rename.bind(fs);
	let committed = false;
	vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
		await rename(from, to);
		if (to === `${mic}.json` && !committed) {
			committed = true;
			entered();
			await gate;
		}
	});
	const { finalizeStandaloneRecordingAudio, cancelAndWaitForRecordingAudioFinalizations } =
		await import("./standaloneAudio");
	const pending = finalizeStandaloneRecordingAudio(video, true);
	const rejected = expect(pending).rejects.toThrow();
	await commitReached;
	let settled = false;
	const quitting = cancelAndWaitForRecordingAudioFinalizations().then(() => {
		settled = true;
	});
	await Promise.resolve();
	expect(settled).toBe(false);
	release();
	await Promise.all([quitting, rejected]);
	expect(await fs.readFile(video)).toEqual(original);
	expect(await fs.readFile(`${mic}.json`)).toEqual(timing);
}, 30_000);
