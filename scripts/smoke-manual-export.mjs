import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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
const log = fs.createWriteStream(`${output}.log`);
// Start the real packaged app normally: _electron.launch omits WebCodecs on macOS.
const child = spawn(executable, [], {
	env: {
		...process.env,
		CAPTOR_SMOKE_EXPORT: "1",
		CAPTOR_SMOKE_EXPORT_INPUT: path.resolve("tests/ui/fixtures/preview.mp4"),
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
console.log(JSON.stringify({ arch, output, bytes: fs.statSync(output).size, report }));
