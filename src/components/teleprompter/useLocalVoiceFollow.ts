import { useEffect } from "react";
import type { PrompterState } from "@/types/teleprompter";

export function useLocalVoiceFollow(
	state: PrompterState,
	acquire: () => Promise<{ stream: MediaStream; release: () => void }>,
) {
	const active =
		state.draft.voiceFollow &&
		state.recognition !== "error" &&
		(state.phase === "rehearsal" || (state.phase === "recording" && state.armed));
	useEffect(() => {
		const api = window.teleprompterAPI;
		if (!api || !active) return;
		let cancelled = false;
		let id: string | null = null;
		let lease: { stream: MediaStream; release: () => void } | null = null;
		let context: AudioContext | null = null;
		let processor: AudioWorkletNode | null = null;
		const cleanup = () => {
			processor?.disconnect();
			if (processor) processor.port.onmessage = null;
			lease?.release();
			lease = null;
			void context?.close().catch(() => undefined);
			context = null;
			if (id) void api.stopRecognition(id).catch(() => undefined);
		};
		const fail = (error: unknown) => {
			if (cancelled) return;
			void api.recognitionFailed(id, String(error)).catch(() => undefined);
			cleanup();
		};
		void (async () => {
			try {
				id = await api.startRecognition();
				if (cancelled) {
					cleanup();
					return;
				}
				lease = await acquire();
				if (cancelled) {
					cleanup();
					return;
				}
				context = new AudioContext({ sampleRate: 16000 });
				await context.audioWorklet.addModule(
					new URL("teleprompter-audio.js", window.location.href).href,
				);
				if (cancelled) {
					cleanup();
					return;
				}
				const source = context.createMediaStreamSource(lease.stream);
				processor = new AudioWorkletNode(context, "captor-teleprompter");
				processor.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
					if (!cancelled && id) api.pushAudio(id, data, 16000);
				};
				processor.onprocessorerror = () =>
					fail("The microphone audio processor stopped. Manual prompting is available.");
				for (const track of lease.stream.getAudioTracks())
					track.addEventListener(
						"ended",
						() => fail("The microphone was disconnected."),
						{ once: true },
					);
				// A zero-output worklet still needs a graph sink to be pulled by Web Audio.
				const silence = context.createGain();
				silence.gain.value = 0;
				source.connect(processor).connect(silence).connect(context.destination);
				await context.resume();
			} catch (error) {
				fail(error);
			}
		})();
		return () => {
			cancelled = true;
			cleanup();
		};
	}, [active, acquire]);
}
