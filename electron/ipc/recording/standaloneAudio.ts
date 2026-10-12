import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { parseJsonWithByteOrderMark } from "../utils";
import {
	getCompanionAudioStartDelayMs,
	getRecordingAudioMuxTimeoutMs,
	hasEmbeddedAudioStream,
	resolveRecordingAudioSources,
	validateRecordedVideo,
} from "./diagnostics";

const run = promisify(execFile);
const jobs = new Map<
	string,
	{
		promise: Promise<void>;
		microphoneExpected: boolean;
		systemExpected: boolean;
	}
>();
const controllers = new Map<string, AbortController>();
// Only the main process capture-start path grants permission to rewrite an MP4.
let recordedAudioTarget: {
	path: string;
	systemExpected: boolean;
	microphoneFinalized: boolean | null;
} | null = null;
export function registerRecordedAudioTarget(videoPath: string, systemExpected = false) {
	recordedAudioTarget = { path: videoPath, systemExpected, microphoneFinalized: null };
}
export function hasFinalizedRecordingMicrophone(videoPath: string) {
	return (
		recordedAudioTarget?.path === videoPath && recordedAudioTarget.microphoneFinalized === true
	);
}
export async function finalizeOwnedRecordingAudio(videoPath: string, microphoneExpected: boolean) {
	const target = recordedAudioTarget;
	if (videoPath !== target?.path) throw Error("Invalid recording audio finalization target.");
	if (target.microphoneFinalized !== null && (!microphoneExpected || target.microphoneFinalized))
		return;
	await finalizeStandaloneRecordingAudio(videoPath, microphoneExpected, target.systemExpected);
	if (recordedAudioTarget === target)
		target.microphoneFinalized = microphoneExpected || hasFinalizedRecordingMicrophone(videoPath);
}
export function cancelRecordingAudioFinalizations() {
	for (const controller of controllers.values()) controller.abort();
}
export async function cancelAndWaitForRecordingAudioFinalizations() {
	cancelRecordingAudioFinalizations();
	await Promise.allSettled([...jobs.values()].map((job) => job.promise));
}
export function hasRecordingAudioFinalization() {
	return jobs.size > 0;
}

/** Rebuild from original tracks, never add the microphone to an already mixed MP4. */
export async function finalizeStandaloneRecordingAudio(
	videoPath: string,
	microphoneExpected = false,
	systemExpected = false,
) {
	const pending = jobs.get(videoPath);
	if (pending) {
		await pending.promise;
		if (
			(microphoneExpected && !pending.microphoneExpected) ||
			(systemExpected && !pending.systemExpected)
		) {
			return finalizeStandaloneRecordingAudio(videoPath, microphoneExpected, systemExpected);
		}
		return;
	}
	const controller = new AbortController();
	controllers.set(videoPath, controller);
	const task = (async () => {
		const { systemPath, microphonePath, microphoneEmbeddedInVideo } =
			await resolveRecordingAudioSources(videoPath);
		if (microphoneExpected && !microphonePath)
			throw Error("The recorded microphone audio is missing. The video has been preserved.");
		if (systemExpected && microphonePath && !systemPath)
			throw Error(
				"The recorded system audio source is missing. Original video and audio files have been preserved.",
			);
		if (!systemPath && !microphonePath) return;
		if (microphoneEmbeddedInVideo && (await hasEmbeddedAudioStream(videoPath))) return;
		if (!microphonePath && (await hasEmbeddedAudioStream(videoPath))) return;
		const { durationSeconds } = await validateRecordedVideo(videoPath);
		if (!durationSeconds || !Number.isFinite(durationSeconds))
			throw Error("The recording duration could not be verified.");
		const id = randomUUID();
		const output = path.join(
			path.dirname(videoPath),
			`.${path.basename(videoPath)}.audio-${id}.mp4`,
		);
		const metadataPath = microphonePath ? `${microphonePath}.json` : null;
		const metadataTemp = metadataPath ? `${metadataPath}.${id}.tmp` : null;
		let originalMetadata: string | null = null;
		let metadataWritten = false;
		const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", videoPath];
		const filters: string[] = [];
		const inputs = [systemPath, microphonePath].filter((file): file is string => !!file);
		for (const [index, file] of inputs.entries()) {
			args.push("-i", file);
			const delay = (await getCompanionAudioStartDelayMs(file)) ?? 0;
			if (delay / 1000 >= durationSeconds)
				throw Error(
					"The recorded audio timing does not fit the video. Original files have been preserved.",
				);
			filters.push(
				`[${index + 1}:a:0]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${delay}:all=1,apad,atrim=duration=${durationSeconds}[track${index}]`,
			);
		}
		const labels = inputs.map((_file, index) => `[track${index}]`).join("");
		filters.push(
			inputs.length === 1
				? `${labels}anull[mix]`
				: `${labels}amix=inputs=${inputs.length}:normalize=0[mix]`,
		);
		args.push(
			"-filter_complex",
			filters.join(";"),
			"-map",
			"0:v:0",
			"-map",
			"[mix]",
			"-map_metadata",
			"0",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-t",
			String(durationSeconds),
			"-movflags",
			"+faststart",
			output,
		);
		try {
			await run(getFfmpegBinaryPath(), args, {
				signal: controller.signal,
				timeout: getRecordingAudioMuxTimeoutMs(durationSeconds),
				maxBuffer: 10 * 1024 * 1024,
			});
			await validateRecordedVideo(output);
			if (!(await hasEmbeddedAudioStream(output)))
				throw Error("The finalized MP4 has no audio stream.");
			if (metadataPath && metadataTemp) {
				controller.signal.throwIfAborted();
				try {
					originalMetadata = await fs.readFile(metadataPath, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				const metadata = originalMetadata
					? parseJsonWithByteOrderMark<Record<string, unknown>>(originalMetadata)
					: {};
				if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
					throw Error("Invalid microphone timing metadata.");
				await fs.writeFile(
					metadataTemp,
					JSON.stringify({ ...metadata, embeddedInVideo: true }),
				);
				await fs.rename(metadataTemp, metadataPath);
				metadataWritten = true;
			}
			controller.signal.throwIfAborted();
			await fs.rename(output, videoPath);
		} catch (error) {
			if (metadataWritten && metadataPath && metadataTemp) {
				if (originalMetadata === null) await fs.rm(metadataPath, { force: true });
				else {
					await fs.writeFile(metadataTemp, originalMetadata);
					await fs.rename(metadataTemp, metadataPath);
				}
			}
			throw error;
		} finally {
			await fs.rm(output, { force: true });
			if (metadataTemp) await fs.rm(metadataTemp, { force: true });
		}
	})();
	const job = { promise: task, microphoneExpected, systemExpected };
	jobs.set(videoPath, job);
	try {
		await task;
	} finally {
		if (jobs.get(videoPath) === job) jobs.delete(videoPath);
		if (controllers.get(videoPath) === controller) controllers.delete(videoPath);
	}
}
