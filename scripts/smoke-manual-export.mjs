import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const arch = process.argv[2];
if (process.platform !== "darwin" || process.arch !== arch)
	throw Error("Run this export smoke on the matching native macOS architecture.");
fs.mkdirSync(".tmp", { recursive: true });
const executable = path.resolve(
	"release",
	arch === "arm64" ? "mac-arm64" : "mac",
	"Captor.app/Contents/MacOS/Captor",
);
const output = path.resolve(".tmp", `manual-export-${arch}-${Date.now()}.mp4`);
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
const input = output.replace(/\.mp4$/, "-input.mp4");
const system = input.replace(/\.mp4$/, ".system.m4a");
const microphone = input.replace(/\.mp4$/, ".mic.wav");
const transcode = (args) =>
	execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
		timeout: 60_000,
	});
transcode([
	"-f",
	"lavfi",
	"-i",
	"sine=frequency=440:sample_rate=48000:duration=6",
	"-ac",
	"2",
	"-c:a",
	"aac",
	system,
]);
transcode([
	"-f",
	"lavfi",
	"-i",
	"sine=frequency=1000:sample_rate=48000:duration=5.75",
	"-ac",
	"2",
	"-c:a",
	"pcm_s16le",
	microphone,
]);
fs.writeFileSync(
	`${microphone}.json`,
	JSON.stringify({ startDelayMs: 250, embeddedInVideo: true }),
);
// An already finalized MP4 plus editable mixed-format companions exercises the real export routing.
transcode([
	"-i",
	path.resolve("tests/ui/fixtures/preview.mp4"),
	"-i",
	system,
	"-i",
	microphone,
	"-filter_complex",
	"[2:a]adelay=250:all=1,apad[mic];[1:a][mic]amix=inputs=2:normalize=0[audio]",
	"-map",
	"0:v:0",
	"-map",
	"[audio]",
	"-c:v",
	"copy",
	"-c:a",
	"aac",
	"-t",
	"6",
	input,
]);
const log = fs.createWriteStream(`${output}.log`);
// Start the real packaged app normally: _electron.launch omits WebCodecs on macOS.
const child = spawn(executable, [], {
	env: {
		...process.env,
		CAPTOR_SMOKE_EXPORT: "1",
		CAPTOR_SMOKE_EXPORT_INPUT: input,
		CAPTOR_SMOKE_EXPORT_OUTPUT: output,
		CAPTOR_SMOKE_EXPORT_FPS: "30",
		CAPTOR_SMOKE_EXPORT_QUALITY: "medium",
		CAPTOR_DISABLE_AUTO_UPDATES: "1",
		...(process.env.CI === "true" && arch === "x64"
			? {
					CAPTOR_SMOKE_EXPORT_SOFTWARE_GL: "1",
					CAPTOR_SMOKE_EXPORT_RENDER_BACKEND: "webgl",
				}
			: {}),
	},
	stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
const exitCode = await new Promise((resolve, reject) => {
	child.once("error", reject);
	child.once("close", resolve);
}).finally(() => {
	clearTimeout(timer);
	log.end();
});
if (exitCode !== 0) {
	console.error(fs.readFileSync(`${output}.log`, "utf8").slice(-12000));
	throw Error(`Packaged export exited ${exitCode}; see ${output}.log`);
}
const report = JSON.parse(fs.readFileSync(`${output}.report.json`, "utf8"));
if (report.success !== true) {
	console.error(JSON.stringify({ arch, report }));
	console.error(fs.readFileSync(`${output}.log`, "utf8").slice(-12000));
	throw Error(`Packaged export failed; see ${output}.report.json`);
}
if (!fs.statSync(output).size) throw Error("Packaged export produced an empty video.");
const volumes = {};
for (const frequency of [440, 1000]) {
	// spawnSync exposes FFmpeg's volume report on stderr even after a successful decode.
	const volume = (file) => {
		const result = spawnSync(
			ffmpeg,
			[
				"-hide_banner",
				"-i",
				file,
				"-vn",
				"-af",
				`bandpass=f=${frequency}:width_type=h:w=100,volumedetect`,
				"-f",
				"null",
				"-",
			],
			{ encoding: "utf8", timeout: 30_000 },
		);
		if (result.status !== 0) throw Error("Audio verification failed to decode the export.");
		const db = Number(result.stderr.match(/mean_volume:\s*([-\d.]+) dB/)?.[1]);
		if (!Number.isFinite(db) || db < -35)
			throw Error(`Missing ${frequency} Hz audio in packaged export.`);
		return db;
	};
	volumes[frequency] = { input: volume(input), output: volume(output) };
	if (Math.abs(volumes[frequency].input - volumes[frequency].output) > 1.5)
		throw Error(`Packaged export changed the ${frequency} Hz track gain.`);
}
console.log(JSON.stringify({ arch, output, volumes, bytes: fs.statSync(output).size, report }));
