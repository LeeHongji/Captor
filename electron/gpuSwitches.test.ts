import { describe, expect, it } from "vitest";

import { getGpuSwitches, shouldForceLinuxEgl } from "./gpuSwitches";

describe("shouldForceLinuxEgl", () => {
	it("does not force EGL in a Wayland session", () => {
		expect(
			shouldForceLinuxEgl({
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(false);
	});

	it("does not force EGL when Wayland is explicitly requested via Ozone", () => {
		expect(
			shouldForceLinuxEgl({
				OZONE_PLATFORM: "wayland",
				XDG_SESSION_TYPE: "x11",
			}),
		).toBe(false);
	});

	it("falls back to Electron's ozone hint when OZONE_PLATFORM is invalid", () => {
		expect(
			shouldForceLinuxEgl({
				OZONE_PLATFORM: "auto",
				ELECTRON_OZONE_PLATFORM_HINT: "wayland",
				XDG_SESSION_TYPE: "x11",
			}),
		).toBe(false);
	});

	it("forces EGL in an X11 session", () => {
		expect(shouldForceLinuxEgl({ XDG_SESSION_TYPE: "x11" })).toBe(true);
	});

	it("forces EGL when x11 is explicitly requested via Electron's ozone hint", () => {
		expect(
			shouldForceLinuxEgl({
				ELECTRON_OZONE_PLATFORM_HINT: "x11",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(true);
	});
});

describe("getGpuSwitches", () => {
	it("returns the Linux VAAPI workaround without forcing EGL on Wayland", () => {
		expect(
			getGpuSwitches("linux", {
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toEqual({
			useGl: undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("returns the X11 EGL workaround on Linux X11", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			useGl: "egl",
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});
});

describe("macOS export verification graphics", () => {
	it("uses a software graphics driver only for an explicit CI smoke export", () => {
		expect(
			getGpuSwitches("darwin", {
				CI: "true",
				CAPTOR_SMOKE_EXPORT: "1",
				CAPTOR_SMOKE_EXPORT_SOFTWARE_GL: "1",
			}),
		).toEqual({
			useAngle: "swiftshader",
			useGl: "angle",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
		});
	});
	it("preserves Metal for normal app starts and physical Mac export tests", () => {
		for (const env of [
			{},
			{ CI: "true" },
			{ CAPTOR_SMOKE_EXPORT: "1", CAPTOR_SMOKE_EXPORT_SOFTWARE_GL: "1" },
			{ CI: "true", CAPTOR_SMOKE_EXPORT_SOFTWARE_GL: "1" },
		])
			expect(getGpuSwitches("darwin", env)).toEqual({
				useAngle: "metal",
				disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
			});
	});
});
