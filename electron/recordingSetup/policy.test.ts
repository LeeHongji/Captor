import { describe, expect, it } from "vitest";
import {
	requiredSetupPermissions,
	setupIsReady,
	type SetupSnapshot,
} from "../../src/types/recordingSetup";
const choices = { microphone: false, camera: false, systemAudio: false, voiceFollow: false };
const ready: SetupSnapshot = {
	platform: "darwin",
	appVersion: "0.0.4",
	installation: "applications",
	identityChanged: false,
	fingerprint: "current",
	record: null,
	permissions: {
		screen: "granted",
		accessibility: "granted",
		microphone: "denied",
		camera: "denied",
	},
	runtime: { supported: true, binaries: true, storage: true },
	model: { exists: false, downloading: false, progress: 0, error: null },
	busy: false,
};
describe("recording environment requirements", () => {
	it("allows explicitly disabled devices without pretending they are authorized", () =>
		expect(setupIsReady(ready, choices)).toBe(true));
	it("requires microphone access for voice following even when recorded microphone audio is off", () => {
		expect(requiredSetupPermissions({ ...choices, voiceFollow: true })).toContain("microphone");
		expect(setupIsReady(ready, { ...choices, voiceFollow: true })).toBe(false);
	});
	it.each([
		"denied",
		"not-determined",
		"restricted",
		"unknown",
	] as const)("does not treat %s accessibility as a successful setup", (status) => {
		expect(
			setupIsReady(
				{ ...ready, permissions: { ...ready.permissions, accessibility: status } },
				choices,
			),
		).toBe(false);
	});
	it("checks live permission status even after a previous setup completed", () => {
		expect(
			setupIsReady(
				{
					...ready,
					record: { version: 1, step: 4, completed: true, fingerprint: "old", choices },
					permissions: { ...ready.permissions, screen: "denied" },
				},
				choices,
			),
		).toBe(false);
	});
	it.each([
		"supported",
		"binaries",
		"storage",
	] as const)("blocks recording when %s is unavailable", (field) =>
		expect(
			setupIsReady({ ...ready, runtime: { ...ready.runtime, [field]: false } }, choices),
		).toBe(false));
	it("requires camera permission only when camera is enabled", () =>
		expect(setupIsReady(ready, { ...choices, camera: true })).toBe(false));
	it("requires verified model files for voice following", () => {
		const snapshot = {
			...ready,
			permissions: { ...ready.permissions, microphone: "granted" as const },
		};
		expect(setupIsReady(snapshot, { ...choices, voiceFollow: true })).toBe(false);
		expect(
			setupIsReady(
				{ ...snapshot, model: { ...snapshot.model, exists: true } },
				{ ...choices, voiceFollow: true },
			),
		).toBe(true);
	});
});
it("ignores an old microphone failure after microphone and voice following were disabled", () => {
	expect(setupIsReady({ ...ready, verificationFailures: ["microphone"] }, choices)).toBe(true);
	expect(setupIsReady({ ...ready, verificationFailures: ["screen"] }, choices)).toBe(false);
});
it("does not confuse the OS toggle with successful use of a required permission", () => {
	expect(setupIsReady({ ...ready, verificationFailures: ["accessibility"] }, choices)).toBe(
		false,
	);
});
