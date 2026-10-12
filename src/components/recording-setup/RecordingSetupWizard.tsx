import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CheckCircleIcon, ArrowRight, ArrowLeft } from "@/components/ui/icons";
import { useI18n } from "@/contexts/I18nContext";
import { SUPPORTED_LOCALES, type AppLocale } from "@/i18n/config";
import {
	normalizeSetupChoices,
	requiredSetupPermissions,
	setupIsReady,
	type SetupSnapshot,
	type SetupChoices,
	type SetupPermission,
} from "@/types/recordingSetup";
import { SetupMediaTest } from "./SetupMediaTest";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";

const STEPS = ["welcome", "permissions", "devices", "voice", "trial"] as const;
const LANGUAGE_LABELS: Record<AppLocale, string> = {
	en: "English",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	it: "Italiano",
	nl: "Nederlands",
	ko: "한국어",
	"pt-BR": "Português",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
};
const assertResult = (result: { success: boolean; code?: string }) => {
	if (!result.success) throw Error(result.code ?? "action-failed");
};
export function RecordingSetupWizard({ onClose }: { onClose: () => void }) {
	const { t, locale, setLocale } = useI18n();
	const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
	const [step, setStep] = useState(0);
	const [choices, setChoices] = useState<SetupChoices>({
		microphone: false,
		camera: false,
		systemAudio: false,
		voiceFollow: true,
	});
	const [microphoneDevice, setMicrophoneDevice] = useState({ id: "", label: "" });
	const [cameraDevice, setCameraDevice] = useState({ id: "", label: "" });
	const persistQueue = useRef(Promise.resolve());
	const initialComplete = useRef(false);
	const changedConfiguration = useRef(false);
	const initialConfiguration = useRef("");
	const [hydrated, setHydrated] = useState(false);
	const [folder, setFolder] = useState("");
	const [mouseVerified, setMouseVerified] = useState(false);
	const translation = useRef(t);
	translation.current = t;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [requested, setRequested] = useState<Partial<Record<SetupPermission, boolean>>>({});
	const [repair, setRepair] = useState<SetupPermission | null>(null);
	const [checks, setChecks] = useState({ microphone: false, camera: false, voice: false });
	const [trial, setTrial] = useState<{ phase: string; path?: string; duration?: number } | null>(
		null,
	);
	const [preview, setPreview] = useState("");
	const [playable, setPlayable] = useState(false);
	const refresh = useCallback(async () => {
		const next = await window.recordingSetupAPI!.snapshot();
		setSnapshot(next);
		const result = await window.recordingSetupAPI!.trialStatus();
		setTrial(result);
		return next;
	}, []);
	useEffect(() => {
		let current = true;
		void window.electronAPI.getRecordingsDirectory().then((result) => {
			if (current && result.success) setFolder(result.path);
		});
		void Promise.all([refresh(), window.electronAPI.getRecordingPreferences()])
			.then(([initial, prefs]) => {
				setMicrophoneDevice({
					id: prefs.microphoneDeviceId ?? "",
					label: prefs.microphoneDeviceLabel ?? "",
				});
				setCameraDevice({
					id: prefs.webcamDeviceId ?? "",
					label: prefs.webcamDeviceLabel ?? "",
				});
				if (!current) return;
				initialComplete.current =
					initial.record?.completed === true && !initial.identityChanged;
				initialConfiguration.current = JSON.stringify({
					choices: initial.record?.choices ?? normalizeSetupChoices(undefined),
					microphoneDevice: {
						id: prefs.microphoneDeviceId ?? "",
						label: prefs.microphoneDeviceLabel ?? "",
					},
					cameraDevice: {
						id: prefs.webcamDeviceId ?? "",
						label: prefs.webcamDeviceLabel ?? "",
					},
				});
				setHydrated(true);
				if (initial.record) {
					setChoices(initial.record.choices);
					setStep(
						initial.identityChanged || initial.record.completed
							? 1
							: initial.record.step,
					);
				}
			})
			.catch(() => {
				if (current) setError(translation.current("setup.checkFailed"));
			});
		const update = () => {
			if (document.visibilityState === "visible")
				void refresh().catch(() => setError(translation.current("setup.checkFailed")));
		};
		window.addEventListener("focus", update);
		document.addEventListener("visibilitychange", update);
		const timer = setInterval(update, 1500);
		return () => {
			current = false;
			clearInterval(timer);
			window.removeEventListener("focus", update);
			document.removeEventListener("visibilitychange", update);
		};
	}, [refresh]);
	useEffect(() => {
		const unsubscribe = window.teleprompterAPI?.onModel(() => void refresh());
		return unsubscribe;
	}, [refresh]);
	useEffect(() => {
		setPlayable(false);
		setPreview("");
		if (trial?.phase === "complete" && trial.path)
			void resolveMediaResourceUrl(trial.path)
				.then(setPreview)
				.catch(() => setError(t("setup.previewFailed")));
	}, [trial?.path, trial?.phase, t]);
	useEffect(
		() => () => {
			void window.recordingSetupAPI?.cancelTrial();
		},
		[],
	);
	useEffect(() => {
		if (step !== 4) {
			void window.recordingSetupAPI?.cancelTrial();
			setTrial(null);
		}
	}, [step]);
	const run = async (action: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (error) {
			const code = error instanceof Error ? error.message : "check-failed";
			setError(
				t(
					code === "mouse-test-failed"
						? "setup.mouseFailed"
						: code === "save-work-first"
							? "setup.saveWorkFirst"
							: code === "environment-not-ready"
								? "setup.environmentNotReady"
								: "setup.actionFailed",
				),
			);
		} finally {
			setBusy(false);
		}
	};

	const save = useCallback(
		(next: number, completed = false) => {
			const operation = persistQueue.current
				.catch(() => undefined)
				.then(async () => {
					if (completed) assertResult(await window.recordingSetupAPI!.canFinish());
					assertResult(
						await window.electronAPI.setRecordingPreferences({
							microphoneEnabled: choices.microphone,
							systemAudioEnabled: choices.systemAudio,
							webcamEnabled: choices.camera,
							// Keep valid IDs; labels allow a safe unique-device fallback after the origin changes.
							microphoneDeviceId: microphoneDevice.id,
							microphoneDeviceLabel: microphoneDevice.label,
							webcamDeviceId: cameraDevice.id,
							webcamDeviceLabel: cameraDevice.label,
						}),
					);
					if (completed) {
						const state = await window.teleprompterAPI!.getState();
						await window.teleprompterAPI!.saveDraft({
							...state.draft,
							voiceFollow: choices.voiceFollow,
						});
					}
					assertResult(await window.recordingSetupAPI!.save(next, choices, completed));
				});
			persistQueue.current = operation;
			return operation;
		},
		[choices, microphoneDevice, cameraDevice],
	);
	const configuration = JSON.stringify({ choices, microphoneDevice, cameraDevice });
	if (hydrated && configuration !== initialConfiguration.current)
		changedConfiguration.current = true;
	const unchangedCompleted =
		initialComplete.current &&
		!changedConfiguration.current &&
		configuration === initialConfiguration.current;
	useEffect(() => {
		if (!hydrated || unchangedCompleted || busy || snapshot?.busy) return;
		const timer = setTimeout(() => {
			void save(step).catch(() => setError(translation.current("setup.actionFailed")));
		}, 500);
		return () => clearTimeout(timer);
	}, [hydrated, step, save, unchangedCompleted, busy, snapshot?.busy]);
	const next = () =>
		void run(async () => {
			await save(Math.min(step + 1, 4));
			if (step === 4) onClose();
			else setStep(step + 1);
		});
	const permissionItem = (permission: SetupPermission) => {
		const status = snapshot?.permissions[permission] ?? "unknown";
		const ready = status === "granted" && !snapshot?.verificationFailures?.includes(permission);
		return (
			<div key={permission} className="border-b border-separator py-5 last:border-0">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<h3 className="text-base font-semibold">{t(`setup.${permission}`)}</h3>
						<p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
							{t(`setup.${permission}Description`)}
						</p>
					</div>
					<span
						role="status"
						className={`shrink-0 text-sm ${ready ? "text-success" : "text-muted-foreground"}`}
					>
						{t(
							ready
								? "setup.ready"
								: status === "restricted"
									? "setup.restricted"
									: status === "unknown"
										? "setup.unknown"
										: "setup.notActive",
						)}
					</span>
				</div>
				{!ready && (
					<div className="mt-3 space-y-3">
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="secondary"
								disabled={busy || status === "restricted"}
								onClick={() =>
									void run(async () => {
										setRequested((old) => ({ ...old, [permission]: true }));
										assertResult(
											await window.recordingSetupAPI!.request(permission),
										);
										await refresh();
									})
								}
							>
								{t(
									status === "not-determined"
										? "setup.authorize"
										: "setup.openSettings",
								)}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setRepair(repair === permission ? null : permission)}
							>
								{t("setup.alreadyEnabled")}
							</Button>
						</div>
						{requested[permission] && (
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t("setup.returnFromSettings")}
							</p>
						)}
						{repair === permission && (
							<div className="space-y-3 rounded-xl bg-default p-4">
								<p className="text-sm leading-relaxed">
									{t("setup.repairExplanation")}
								</p>
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="secondary"
										disabled={busy}
										onClick={() =>
											void run(async () => {
												assertResult(
													await (async () => {
														if (!unchangedCompleted) await save(step);
														return window.recordingSetupAPI!.restart();
													})(),
												);
											})
										}
									>
										{t("setup.restart")}
									</Button>
									<Button
										size="sm"
										variant="destructive-soft"
										disabled={busy}
										onClick={() =>
											void run(async () => {
												assertResult(
													await window.recordingSetupAPI!.repair(
														permission,
														true,
													),
												);
												setRepair(null);
												setRequested((old) => ({
													...old,
													[permission]: true,
												}));
												await refresh();
											})
										}
									>
										{t("setup.confirmRepair")}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setRepair(null)}
									>
										{t("setup.cancel")}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		);
	};
	const permissionsReady =
		snapshot &&
		requiredSetupPermissions({
			...choices,
			microphone: false,
			camera: false,
			voiceFollow: false,
		}).every(
			(permission) =>
				snapshot.permissions[permission] === "granted" &&
				!snapshot.verificationFailures?.includes(permission),
		);
	const ready = !!snapshot && setupIsReady(snapshot, choices);
	const canContinue =
		step === 0
			? !!snapshot?.runtime.supported &&
				snapshot.runtime.binaries &&
				snapshot.runtime.storage &&
				snapshot.installation !== "disk-image"
			: step === 1
				? !!permissionsReady && mouseVerified
				: step === 2
					? !!snapshot &&
						requiredSetupPermissions(choices).every(
							(permission) => snapshot.permissions[permission] === "granted",
						) &&
						(!(choices.microphone || choices.voiceFollow) || checks.microphone) &&
						(!choices.camera || checks.camera)
					: step === 3
						? !choices.voiceFollow || (!!snapshot?.model.exists && checks.voice)
						: ready && trial?.phase === "complete" && playable;
	const toggle = (key: keyof SetupChoices, checked: boolean) => {
		setChoices((old) => ({ ...old, [key]: checked }));
		setChecks((old) => ({
			...old,
			camera: key === "camera" ? false : old.camera,
			voice: key === "voiceFollow" ? false : old.voice,
			microphone:
				checked &&
				!choices.microphone &&
				!choices.voiceFollow &&
				(key === "microphone" || key === "voiceFollow")
					? false
					: old.microphone,
		}));
	};
	return (
		<section
			aria-label={t("setup.title")}
			className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
		>
			<header className="recording-setup-drag flex h-12 shrink-0 items-center justify-between border-b border-separator bg-card pl-28 pr-6">
				<span className="text-sm font-medium">Captor</span>
				<span className="text-xs text-muted-foreground">{snapshot?.appVersion}</span>
			</header>
			<div className="grid min-h-0 flex-1 md:grid-cols-[220px_minmax(0,1fr)]">
				<aside className="min-h-0 overflow-y-auto border-b border-separator bg-secondary px-5 py-5 md:border-b-0 md:border-r md:py-8">
					<div className="mb-8 hidden md:block">
						<img
							src="/app-icons/captor-128.png"
							alt="Captor"
							width={48}
							height={48}
							className="mb-4 rounded-xl"
						/>
						<p className="text-sm font-semibold">{t("setup.prepareTitle")}</p>
						<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
							{t("setup.prepareDescription")}
						</p>
					</div>
					<nav
						aria-label={t("setup.steps")}
						className="flex gap-2 overflow-x-auto md:flex-col md:gap-2"
					>
						{STEPS.map((name, index) => (
							<button
								key={name}
								type="button"
								aria-current={step === index ? "step" : undefined}
								disabled={
									busy ||
									["recording", "finalizing"].includes(trial?.phase ?? "") ||
									index > step
								}
								onClick={() => setStep(index)}
								className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring ${index === step ? "bg-card font-semibold text-primary" : "text-muted-foreground"}`}
							>
								<span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">
									{index < step ? (
										<CheckCircleIcon className="size-4" />
									) : (
										index + 1
									)}
								</span>
								{t(`setup.step_${name}`)}
							</button>
						))}
					</nav>
					<p className="mt-8 hidden text-xs leading-relaxed text-muted-foreground md:block">
						{t("setup.localOnly")}
					</p>
				</aside>
				<div className="flex min-h-0 flex-col">
					<main
						id="setup-content"
						className="min-h-0 flex-1 overflow-y-auto px-6 py-7 md:px-10"
					>
						<div className="mx-auto max-w-2xl">
							<p className="mb-2 text-xs font-medium uppercase text-primary">
								{t("setup.stepCount", undefined, { current: step + 1, total: 5 })}
							</p>
							<h1 className="text-2xl font-semibold leading-snug">
								{t(`setup.heading_${STEPS[step]}`)}
							</h1>
							<p className="mt-3 mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
								{t(`setup.description_${STEPS[step]}`)}
							</p>
							{snapshot?.identityChanged && (
								<p className="mb-5 rounded-xl bg-warning/10 p-4 text-sm leading-relaxed">
									{t("setup.identityChanged")}
								</p>
							)}
							{error && (
								<p
									role="alert"
									className="mb-5 rounded-xl bg-destructive/10 p-4 text-sm leading-relaxed text-destructive"
								>
									{error}
								</p>
							)}
							{step === 0 && (
								<div className="space-y-6">
									<label className="block max-w-xs text-sm">
										<span>{t("setup.language")}</span>
										<select
											aria-label={t("setup.language")}
											className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2"
											value={locale}
											onChange={(event) =>
												setLocale(event.target.value as AppLocale)
											}
										>
											{SUPPORTED_LOCALES.map((value) => (
												<option key={value} value={value}>
													{LANGUAGE_LABELS[value]}
												</option>
											))}
										</select>
									</label>
									<div className="divide-y divide-separator">
										{(["supported", "binaries", "storage"] as const).map(
											(field) => (
												<div
													key={field}
													className="flex items-center justify-between gap-4 py-4 text-sm"
												>
													<span>{t(`setup.runtime_${field}`)}</span>
													<span
														className={
															snapshot?.runtime[field]
																? "text-success"
																: "text-destructive"
														}
													>
														{t(
															snapshot?.runtime[field]
																? "setup.ready"
																: snapshot
																	? "setup.checkFailed"
																	: "setup.checking",
														)}
													</span>
												</div>
											),
										)}
									</div>
									<div className="flex flex-wrap items-center justify-between gap-3 border-b border-separator pb-4 text-sm">
										<span className="min-w-0 flex-1 truncate" title={folder}>
											{folder}
										</span>
										<Button
											size="sm"
											variant="secondary"
											disabled={busy}
											onClick={() =>
												void run(async () => {
													const result =
														await window.electronAPI.chooseRecordingsDirectory();
													if (result.canceled) return;
													if (!result.success)
														throw Error("storage-unavailable");
													setFolder(result.path ?? "");
													await refresh();
												})
											}
										>
											{t("setup.changeFolder")}
										</Button>
									</div>
									{snapshot?.installation === "disk-image" && (
										<p role="alert" className="text-sm text-destructive">
											{t("setup.moveToApplications")}
										</p>
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											void run(async () => {
												await refresh();
											})
										}
									>
										{t("setup.recheck")}
									</Button>
								</div>
							)}
							{step === 1 && (
								<div>
									{permissionItem("screen")}
									{permissionItem("accessibility")}
									<div className="space-y-3 border-b border-separator py-5">
										<p className="text-sm text-muted-foreground">
											{t("setup.mouseInstructions")}
										</p>
										<Button
											variant="secondary"
											disabled={
												busy ||
												snapshot?.permissions.accessibility !== "granted"
											}
											onClick={() =>
												void run(async () => {
													const result =
														await window.recordingSetupAPI!.testMouse();
													setMouseVerified(result.success);
													if (result.snapshot)
														setSnapshot(result.snapshot);
													assertResult(result);
												})
											}
										>
											{t("setup.testMouse")}
										</Button>
										{busy && (
											<div className="rounded-xl border border-dashed border-primary p-6 text-center text-sm">
												{t("setup.clickHere")}
											</div>
										)}
										{mouseVerified && (
											<p className="text-sm text-success">
												{t("setup.mouseVerified")}
											</p>
										)}
									</div>
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											void run(async () => {
												await refresh();
											})
										}
									>
										{t("setup.recheck")}
									</Button>
								</div>
							)}
							{step === 2 && (
								<div className="space-y-6">
									<div className="flex items-center justify-between gap-4 border-b border-separator pb-4 text-sm">
										<span>{t("setup.recordMicrophone")}</span>
										<Switch
											aria-label={t("setup.recordMicrophone")}
											checked={choices.microphone}
											onCheckedChange={(value) => toggle("microphone", value)}
										/>
									</div>
									<div className="flex items-center justify-between gap-4 border-b border-separator pb-4 text-sm">
										<span>{t("setup.recordSystemAudio")}</span>
										<Switch
											aria-label={t("setup.recordSystemAudio")}
											checked={choices.systemAudio}
											onCheckedChange={(value) =>
												toggle("systemAudio", value)
											}
										/>
									</div>
									<div className="flex items-center justify-between gap-4 border-b border-separator pb-4 text-sm">
										<span>{t("setup.useVoiceFollow")}</span>
										<Switch
											aria-label={t("setup.useVoiceFollow")}
											checked={choices.voiceFollow}
											onCheckedChange={(value) =>
												toggle("voiceFollow", value)
											}
										/>
									</div>
									{(choices.microphone || choices.voiceFollow) && (
										<div>
											{permissionItem("microphone")}
											<SetupMediaTest
												kind="audio"
												onFailure={() =>
													setChecks((old) => ({
														...old,
														microphone: false,
														voice: false,
													}))
												}
												allowed={
													snapshot?.permissions.microphone === "granted"
												}
												device={microphoneDevice}
												onDevice={(device) => {
													setMicrophoneDevice(device);
													setChecks((old) => ({
														...old,
														microphone: false,
														voice: false,
													}));
												}}
												onVerified={() =>
													setChecks((old) => ({
														...old,
														microphone: true,
													}))
												}
											/>
											<p className="mt-3 text-xs text-success">
												{checks.microphone
													? t("setup.microphoneVerified")
													: ""}
											</p>
										</div>
									)}
									<div className="flex items-center justify-between gap-4 border-b border-separator pb-4 text-sm">
										<span>{t("setup.useCamera")}</span>
										<Switch
											aria-label={t("setup.useCamera")}
											checked={choices.camera}
											onCheckedChange={(value) => toggle("camera", value)}
										/>
									</div>
									{choices.camera ? (
										<div>
											{permissionItem("camera")}
											<SetupMediaTest
												kind="video"
												onFailure={() =>
													setChecks((old) => ({ ...old, camera: false }))
												}
												allowed={snapshot?.permissions.camera === "granted"}
												device={cameraDevice}
												onDevice={(device) => {
													setCameraDevice(device);
													setChecks((old) => ({ ...old, camera: false }));
												}}
												onVerified={() =>
													setChecks((old) => ({ ...old, camera: true }))
												}
											/>
										</div>
									) : (
										<p className="text-xs text-muted-foreground">
											{t("setup.cameraOff")}
										</p>
									)}
								</div>
							)}
							{step === 3 && (
								<div className="space-y-5">
									{choices.voiceFollow ? (
										<>
											<div className="flex flex-wrap items-center justify-between gap-3 border-b border-separator pb-5">
												<div>
													<p className="text-sm font-semibold">
														{t("setup.localModel")}
													</p>
													<p className="mt-1 text-xs text-muted-foreground">
														{t("setup.modelSize")}
													</p>
												</div>
												<span
													className={
														snapshot?.model.exists
															? "text-sm text-success"
															: "text-sm text-muted-foreground"
													}
												>
													{t(
														snapshot?.model.exists
															? "setup.ready"
															: snapshot?.model.downloading
																? "setup.downloading"
																: "setup.modelMissing",
													)}
												</span>
											</div>
											{!snapshot?.model.exists && (
												<>
													<Button
														variant="secondary"
														disabled={
															busy || snapshot?.model.downloading
														}
														onClick={() => {
															setError("");
															void window
																.teleprompterAPI!.downloadModel()
																.then((model) => {
																	if (!model.exists)
																		setError(
																			translation.current(
																				"setup.modelFailed",
																			),
																		);
																	return refresh();
																})
																.catch(() =>
																	setError(
																		translation.current(
																			"setup.modelFailed",
																		),
																	),
																);
														}}
													>
														{snapshot?.model.downloading
															? `${t("setup.downloading")} ${snapshot.model.progress}%`
															: t("setup.downloadModel")}
													</Button>
													{snapshot?.model.error && (
														<p
															role="alert"
															className="text-sm text-destructive"
														>
															{t("setup.modelFailed")}
														</p>
													)}
												</>
											)}
											<SetupMediaTest
												kind="audio"
												onFailure={() =>
													setChecks((old) => ({
														...old,
														microphone: false,
														voice: false,
													}))
												}
												voice
												device={microphoneDevice}
												allowed={
													!!snapshot?.model.exists &&
													snapshot.permissions.microphone === "granted"
												}
												onVerified={() =>
													setChecks((old) => ({ ...old, voice: true }))
												}
											/>
											<p className="text-sm text-success">
												{checks.voice ? t("setup.voiceVerified") : ""}
											</p>
										</>
									) : (
										<p className="rounded-xl bg-default p-4 text-sm leading-relaxed">
											{t("setup.manualPrompt")}
										</p>
									)}
								</div>
							)}
							{step === 4 && (
								<div className="space-y-5">
									<div className="divide-y divide-separator">
										{requiredSetupPermissions(choices).map((permission) => (
											<div
												key={permission}
												className="flex items-center justify-between py-3 text-sm"
											>
												<span>{t(`setup.${permission}`)}</span>
												<span
													className={
														snapshot?.permissions[permission] ===
															"granted" &&
														!snapshot.verificationFailures?.includes(
															permission,
														)
															? "text-success"
															: "text-muted-foreground"
													}
												>
													{t(
														snapshot?.permissions[permission] ===
															"granted" &&
															!snapshot?.verificationFailures?.includes(
																permission,
															)
															? "setup.ready"
															: "setup.notActive",
													)}
												</span>
											</div>
										))}
									</div>
									<p className="text-sm leading-relaxed text-muted-foreground">
										{t("setup.trialInstructions")}
									</p>
									<Button
										variant="secondary"
										disabled={
											busy ||
											!ready ||
											["recording", "finalizing"].includes(
												trial?.phase ?? "",
											) ||
											trial?.phase === "waiting"
										}
										onClick={() =>
											void run(async () => {
												await save(4);
												assertResult(
													await window.recordingSetupAPI!.startTrial(),
												);
												await window.teleprompterAPI!.arm(false);
												await window.electronAPI.showRecordingHud();
												await refresh();
											})
										}
									>
										{t(
											["recording", "finalizing"].includes(trial?.phase ?? "")
												? "setup.trialRecording"
												: "setup.startTrial",
										)}
									</Button>
									{trial?.phase === "failed" && (
										<p role="alert" className="text-sm text-destructive">
											{t("setup.trialFailed")}
										</p>
									)}
									{preview && (
										<div>
											<video
												src={preview}
												controls
												playsInline
												aria-label={t("setup.trialPreview")}
												className="aspect-video w-full rounded-xl bg-default"
												onLoadedData={(event) => {
													if (
														event.currentTarget.duration >= 4 &&
														event.currentTarget.videoWidth > 0
													)
														setPlayable(true);
												}}
												onError={() => setError(t("setup.previewFailed"))}
											/>
											<p className="mt-3 text-sm text-success">
												{playable
													? t("setup.trialVerified")
													: t("setup.checking")}
											</p>
										</div>
									)}
								</div>
							)}
						</div>
					</main>
					<footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-separator bg-card px-6 py-4 md:px-10">
						<Button
							variant="ghost"
							size="sm"
							disabled={
								busy || ["recording", "finalizing"].includes(trial?.phase ?? "")
							}
							onClick={() =>
								void run(async () => {
									if (!unchangedCompleted) await save(step);
									onClose();
								})
							}
						>
							{t("setup.viewProjects")}
						</Button>
						<div className="flex gap-2">
							{step > 0 && (
								<Button
									variant="ghost"
									disabled={
										busy ||
										["recording", "finalizing"].includes(trial?.phase ?? "")
									}
									onClick={() => setStep(step - 1)}
								>
									<ArrowLeft />
									{t("setup.back")}
								</Button>
							)}
							<Button
								disabled={busy || !canContinue}
								onClick={
									step === 4
										? () =>
												void run(async () => {
													await save(4, true);
													onClose();
												})
										: next
								}
							>
								{busy
									? t("setup.checking")
									: t(step === 4 ? "setup.finish" : "setup.continue")}
								<ArrowRight />
							</Button>
						</div>
					</footer>
				</div>
			</div>
		</section>
	);
}
