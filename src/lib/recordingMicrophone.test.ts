import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireRecordingMicrophone } from "./recordingMicrophone";
afterEach(() => vi.unstubAllGlobals());
describe("shared recording microphone", () => {
	it("opens one device and keeps recording alive when following stops", async () => {
		const stopSource = vi.fn();
		const copies: ReturnType<typeof vi.fn>[] = [];
		const source = {
			getTracks: () => [{ stop: stopSource }],
			clone: () => {
				const stop = vi.fn();
				copies.push(stop);
				return { getTracks: () => [{ stop }] };
			},
		};
		const getUserMedia = vi.fn().mockResolvedValue(source);
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
		const constraints = { audio: true };
		const recording = await acquireRecordingMicrophone(constraints);
		const following = await acquireRecordingMicrophone(constraints);
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		following.release();
		following.release();
		expect(copies[1]).toHaveBeenCalledTimes(1);
		expect(stopSource).not.toHaveBeenCalled();
		recording.release();
		await Promise.resolve();
		expect(stopSource).toHaveBeenCalledTimes(1);
	});
	it("releases a denied acquisition so retry can request the device again", async () => {
		const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
		await expect(acquireRecordingMicrophone({ audio: true })).rejects.toThrow("denied");
		await expect(acquireRecordingMicrophone({ audio: true })).rejects.toThrow("denied");
		expect(getUserMedia).toHaveBeenCalledTimes(2);
	});
});
