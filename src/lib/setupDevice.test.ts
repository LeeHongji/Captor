import { expect, it } from "vitest";
import { resolveSetupDevice } from "./setupDevice";
const devices = [
	{ kind: "audioinput" as const, deviceId: "hud-A", label: "USB Microphone" },
	{ kind: "audioinput" as const, deviceId: "default", label: "Default - USB Microphone" },
	{ kind: "videoinput" as const, deviceId: "camera-A", label: "Camera" },
];
it("resolves the same microphone across origins without using the editor's ID", () => {
	expect(resolveSetupDevice(devices, "audioinput", "editor-A", "USB Microphone")).toBe("hud-A");
});
it("keeps valid existing device IDs", () =>
	expect(resolveSetupDevice(devices, "videoinput", "camera-A")).toBe("camera-A"));
it("uses the system default only when explicitly selected", () =>
	expect(resolveSetupDevice(devices, "audioinput", "", "")).toBeUndefined());
it("does not silently switch a disconnected selected microphone to the default", () =>
	expect(() => resolveSetupDevice(devices, "audioinput", "old", "Disconnected")).toThrow(
		"setup-device-unavailable",
	));
it("does not guess between identically named devices", () =>
	expect(() =>
		resolveSetupDevice(
			[...devices, { kind: "audioinput", deviceId: "hud-B", label: "USB Microphone" }],
			"audioinput",
			"editor-A",
			"USB Microphone",
		),
	).toThrow());
it("retains a valid selected ID when devices have the same label in the shared capture origin", () => {
	expect(
		resolveSetupDevice(
			[...devices, { kind: "audioinput", deviceId: "hud-B", label: "USB Microphone" }],
			"audioinput",
			"hud-B",
			"USB Microphone",
		),
	).toBe("hud-B");
});
