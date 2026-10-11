import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const arch = process.argv[2];
if (process.platform !== "darwin" || !["arm64", "x64"].includes(arch))
	throw Error("Run on macOS with arm64 or x64.");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const stem = `Captor-${pkg.version}-${arch}`;
const run = (command, args, options = {}) =>
	execFileSync(command, args, { encoding: "utf8", timeout: 60_000, ...options });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "captor-manual-verify-"));
const mount = path.join(scratch, "mount");
const zip = path.join(scratch, "zip");
let mounted = false;
function verifyApp(appPath) {
	run("codesign", ["--verify", "--deep", "--strict", appPath]);
	const signingResult = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
		encoding: "utf8",
	});
	const signing = signingResult.stderr;
	if (signingResult.status !== 0 || !signing.includes("Signature=adhoc"))
		throw Error("Expected ad-hoc application signature");
	const plist = path.join(appPath, "Contents/Info.plist");
	for (const [key, value] of [
		["CFBundleIdentifier", "dev.captor.app"],
		["CFBundleShortVersionString", pkg.version],
		["LSMinimumSystemVersion", "14.0"],
	]) {
		if (run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]).trim() !== value)
			throw Error(`Invalid ${key}`);
	}
	const binary = path.join(appPath, "Contents/MacOS/Captor");
	const expectedArch = arch === "x64" ? "x86_64" : "arm64";
	if (!run("lipo", ["-archs", binary]).trim().split(/\s+/).includes(expectedArch))
		throw Error("App architecture mismatch");
	const archive = path.join(appPath, "Contents/Resources/app.asar");
	const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString());
	if (metadata.version !== pkg.version || metadata.captorDistribution !== "manual")
		throw Error("Packaged metadata mismatch");
	if (!asar.extractFile(archive, metadata.main).length)
		throw Error("Missing packaged main entry");
	if (fs.existsSync(path.join(appPath, "Contents/Resources/app-update.yml")))
		throw Error("Manual package must not contain automatic update metadata");
	// Exercise native addons with the packaged Electron runtime on its native CI host.
	if (process.arch === arch) {
		const smoke = `const root=${JSON.stringify(archive)}; for(const name of ['sherpa-onnx-node','uiohook-napi']) { const mod=require(root+'/node_modules/'+name); if(!mod || !Object.keys(mod).length) throw Error(name+' did not load'); console.log(name+' loaded'); }`;
		run(binary, ["-e", smoke], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
	}
	return {
		architecture: expectedArch,
		version: metadata.version,
		distribution: metadata.captorDistribution,
		signingOutput: signing.trim(),
	};
}
try {
	for (const ext of ["dmg", "zip"])
		if (!fs.statSync(path.join("release", `${stem}.${ext}`)).size) throw Error(`Empty ${ext}`);
	fs.mkdirSync(mount);
	run("hdiutil", [
		"attach",
		path.resolve("release", `${stem}.dmg`),
		"-readonly",
		"-nobrowse",
		"-mountpoint",
		mount,
	]);
	mounted = true;
	const dmg = verifyApp(path.join(mount, "Captor.app"));
	run("ditto", ["-x", "-k", path.resolve("release", `${stem}.zip`), zip]);
	const zipped = verifyApp(path.join(zip, "Captor.app"));
	const report = {
		lane: "manual-ad-hoc-not-notarized",
		version: pkg.version,
		arch,
		nativeAddonsExecuted: process.arch === arch,
		dmg,
		zip: zipped,
	};
	fs.writeFileSync(
		path.join("release", `manual-verification-${arch}.json`),
		JSON.stringify(report, null, 2) + "\n",
	);
	console.log(JSON.stringify(report));
} finally {
	if (mounted) run("hdiutil", ["detach", mount]);
	fs.rmSync(scratch, { recursive: true, force: true });
}
