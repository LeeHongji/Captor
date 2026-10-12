import { resolveSetupDevice } from "@/lib/setupDevice";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import type { SetupVoiceResult } from "@/types/recordingSetup";
import { SETUP_VOICE_TEST_SCRIPTS } from "@/types/recordingSetup";

export function SetupMediaTest({
	kind,
	voice = false,
	allowed,
	onVerified,
	onFailure,
	onDevice,
	device = { id: "", label: "" },
}: {
	kind: "audio" | "video";
	voice?: boolean;
	allowed: boolean;
	onVerified: () => void;
	onFailure?: () => void;
	onDevice?: (device: { id: string; label: string }) => void;
	device?: { id: string; label: string };
}) {
	const { t, locale } = useI18n();
	const language = locale.startsWith("zh") ? "zh" : "en";
	const testText = SETUP_VOICE_TEST_SCRIPTS[language];
	const [active, setActive] = useState(false);
	const [loading, setLoading] = useState(false);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const selected =
		devices.find(
			(d) => d.deviceId === device.id || (!!device.label && d.label === device.label),
		)?.deviceId ?? (device.id || device.label ? "missing" : "");
	const callbacks = useRef({ t, onVerified, onFailure });
	callbacks.current = { t, onVerified, onFailure };
	const [level, setLevel] = useState(0);
	const [error, setError] = useState("");
	const [result, setResult] = useState<SetupVoiceResult | null>(null);
	const video = useRef<HTMLVideoElement>(null);
	const stream = useRef<MediaStream | null>(null);
	const audio = useRef<AudioContext | null>(null);
	const worklet = useRef<AudioWorkletNode | null>(null);
	const session = useRef<string | null>(null);
	const frame = useRef<number | null>(null);
	const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const generation = useRef(0);
	const verified = useRef(false);
	const verify = () => {
		if (verified.current) return;
		verified.current = true;
		callbacks.current.onVerified();
		void window.recordingSetupAPI
			?.mediaResult(kind, true)
			.catch(() => setError(callbacks.current.t("setup.actionFailed")));
	};
	const stop = useCallback(() => {
		generation.current++;
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		if (timeout.current) clearTimeout(timeout.current);
		if (worklet.current) {
			worklet.current.port.onmessage = null;
			worklet.current.disconnect();
		}
		worklet.current = null;
		stream.current?.getTracks().forEach((track) => track.stop());
		stream.current = null;
		void audio.current?.close().catch(() => undefined);
		audio.current = null;
		if (voice) void window.recordingSetupAPI?.stopVoiceTest(session.current ?? undefined);
		session.current = null;
		void window.recordingSetupAPI?.stopMedia(kind);
		setActive(false);
		setLoading(false);
		setLevel(0);
	}, [kind, voice]);
	useEffect(() => {
		if (allowed)
			void navigator.mediaDevices
				.enumerateDevices()
				.then((list) =>
					setDevices(
						list.filter(
							(device) =>
								device.kind === (kind === "audio" ? "audioinput" : "videoinput"),
						),
					),
				)
				.catch(() => setError(t("setup.mediaUnavailable")));
	}, [allowed, kind, t]);
	useEffect(() => {
		const unsubscribe = window.recordingSetupAPI?.onVoiceResult((next) => {
			if (next.session !== session.current) return;
			if (next.error) {
				callbacks.current.onFailure?.();
				setError(callbacks.current.t("setup.voiceFailed"));
				stop();
			} else {
				setResult(next);
				if (next.cursor > 0) callbacks.current.onVerified();
			}
		});
		return () => {
			unsubscribe?.();
			stop();
		};
	}, [stop]);
	const start = async () => {
		stop();
		verified.current = false;
		const current = generation.current;
		setLoading(true);
		setError("");
		setResult(null);
		try {
			const lease = await window.recordingSetupAPI!.startMedia(kind);
			if (!lease.success) throw Error("permission-not-active");
			const inputs = await navigator.mediaDevices.enumerateDevices();
			const resolved = resolveSetupDevice(
				inputs,
				kind === "audio" ? "audioinput" : "videoinput",
				device.id,
				device.label,
			);
			const media = await navigator.mediaDevices.getUserMedia(
				kind === "audio"
					? { audio: resolved ? { deviceId: { exact: resolved } } : true, video: false }
					: { audio: false, video: resolved ? { deviceId: { exact: resolved } } : true },
			);
			if (current !== generation.current) {
				media.getTracks().forEach((track) => track.stop());
				return;
			}
			stream.current = media;
			// Chromium exposes device labels after an explicit, successful media request.
			const actualDevices = await navigator.mediaDevices.enumerateDevices();
			if (current !== generation.current) {
				media.getTracks().forEach((track) => track.stop());
				return;
			}
			setDevices(
				actualDevices.filter(
					(input) => input.kind === (kind === "audio" ? "audioinput" : "videoinput"),
				),
			);
			if (device.id || device.label)
				onDevice?.({
					id: resolved ?? "",
					label:
						actualDevices.find((input) => input.deviceId === resolved)?.label ??
						device.label,
				});
			media.getTracks().forEach((track) =>
				track.addEventListener(
					"ended",
					() => {
						callbacks.current.onFailure?.();
						setError(t("setup.deviceDisconnected"));
						stop();
					},
					{ once: true },
				),
			);
			setActive(true);
			if (kind === "video") {
				if (video.current) video.current.srcObject = media;
			} else {
				const context = new AudioContext({ sampleRate: 16000 });
				audio.current = context;
				const source = context.createMediaStreamSource(media);
				const analyser = context.createAnalyser();
				analyser.fftSize = 256;
				source.connect(analyser);
				const samples = new Float32Array(analyser.fftSize);
				const sample = () => {
					if (current !== generation.current) return;
					analyser.getFloatTimeDomainData(samples);
					const value = Math.min(
						1,
						Math.sqrt(
							samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
						) * 8,
					);
					setLevel(value);
					if (value > 0.02 && !voice) verify();
					frame.current = requestAnimationFrame(sample);
				};
				sample();
				if (voice) {
					const started = await window.recordingSetupAPI!.startVoiceTest(language);
					if (current !== generation.current) {
						await window.recordingSetupAPI!.stopVoiceTest(started.session);
						return;
					}
					session.current = started.session;
					await context.audioWorklet.addModule(
						new URL("teleprompter-audio.js", window.location.href).href,
					);
					if (current !== generation.current) return;
					const processor = new AudioWorkletNode(context, "captor-teleprompter");
					worklet.current = processor;
					processor.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
						if (session.current)
							window.recordingSetupAPI!.pushVoiceAudio(session.current, data);
					};
					processor.onprocessorerror = () => {
						if (current !== generation.current) return;
						callbacks.current.onFailure?.();
						setError(t("setup.voiceFailed"));
						stop();
					};
					const silence = context.createGain();
					silence.gain.value = 0;
					source.connect(processor).connect(silence).connect(context.destination);
				}
				await context.resume();
			}
			timeout.current = setTimeout(stop, 30_000);
		} catch (error) {
			if (current !== generation.current) return;
			if (error instanceof DOMException && error.name === "NotAllowedError")
				void window.recordingSetupAPI?.mediaResult(kind, false).catch(() => undefined);
			callbacks.current.onFailure?.();
			if (current === generation.current) {
				setError(t("setup.mediaUnavailable"));
				stop();
			}
		} finally {
			if (current === generation.current) setLoading(false);
		}
	};
	return (
		<div className="space-y-4">
			{!voice && (
				<label className="block space-y-2 text-sm">
					<span>
						{t(kind === "audio" ? "setup.microphoneDevice" : "setup.cameraDevice")}
					</span>
					<select
						aria-label={t(
							kind === "audio" ? "setup.microphoneDevice" : "setup.cameraDevice",
						)}
						className="w-full rounded-lg border border-input bg-card px-3 py-2 text-foreground"
						value={selected}
						disabled={active || loading}
						onChange={(event) => {
							onDevice?.({
								id: event.target.value,
								label: event.target.value
									? (devices.find((d) => d.deviceId === event.target.value)
											?.label ?? "")
									: "",
							});
						}}
					>
						<option value="">{t("setup.defaultDevice")}</option>
						{selected === "missing" && (
							<option value="missing" disabled>
								{t("setup.deviceDisconnected")}
							</option>
						)}
						{devices
							.filter(
								(device) =>
									device.deviceId !== "default" &&
									device.deviceId !== "communications",
							)
							.map((device) => (
								<option key={device.deviceId} value={device.deviceId}>
									{device.label || t("setup.unnamedDevice")}
								</option>
							))}
					</select>
				</label>
			)}
			{kind === "video" && (
				<video
					ref={video}
					autoPlay
					muted
					playsInline
					aria-label={t("setup.cameraPreview")}
					className="aspect-video w-full max-w-md rounded-xl bg-default object-cover"
					onLoadedData={() => {
						if (video.current?.videoWidth) verify();
					}}
				/>
			)}
			{kind === "audio" && (
				<div>
					<div
						className="h-2 overflow-hidden rounded-full bg-default"
						role="meter"
						aria-label={t("setup.microphoneLevel")}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(level * 100)}
					>
						<div
							className="h-full origin-left bg-primary"
							style={{ transform: `scaleX(${level})` }}
						/>
					</div>
					<p className="mt-2 text-xs text-muted-foreground">{t("setup.localTest")}</p>
				</div>
			)}
			{voice && (
				<div
					className="rounded-xl bg-default p-4 text-lg leading-relaxed"
					aria-label={t("setup.voiceTestScript")}
				>
					<span className="text-primary">{testText.slice(0, result?.cursor ?? 0)}</span>
					<span>{testText.slice(result?.cursor ?? 0)}</span>
					{result?.text && (
						<p className="mt-3 text-sm text-muted-foreground">{result.text}</p>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<Button
				variant="secondary"
				disabled={!allowed && !active && !loading}
				onClick={active || loading ? stop : () => void start()}
			>
				{loading
					? t("setup.stopTest")
					: active
						? t("setup.stopTest")
						: t(
								voice
									? "setup.startVoiceTest"
									: kind === "audio"
										? "setup.testMicrophone"
										: "setup.testCamera",
							)}
			</Button>
		</div>
	);
}
