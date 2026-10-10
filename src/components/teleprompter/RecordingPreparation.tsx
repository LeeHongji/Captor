import { registerRecordingDraftFlush } from "@/lib/recordingDraftFlush";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useScopedT } from "@/contexts/I18nContext";
import {
	DEFAULT_RECORDING_DRAFT,
	type RecordingDraft,
	type PrompterModelStatus,
} from "@/types/teleprompter";
import { usePrompterState } from "./usePrompterState";

export function RecordingPreparation() {
	const t = useScopedT("launch");
	const state = usePrompterState();
	const [draft, setDraft] = useState<RecordingDraft>(DEFAULT_RECORDING_DRAFT);
	const [saved, setSaved] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
	const [error, setError] = useState<string | null>(null);
	const [platform, setPlatform] = useState("");
	const [model, setModel] = useState<PrompterModelStatus>({
		exists: false,
		downloading: false,
		progress: 0,
		error: null,
	});
	const dirty = useRef(false);
	const latest = useRef(draft);
	const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busy = ["preparing", "recording", "paused", "finalizing", "rehearsal"].includes(
		state.phase,
	);
	useEffect(() => {
		if (!dirty.current) {
			setDraft(state.draft);
			latest.current = state.draft;
		}
	}, [state.draft]);
	useEffect(() => {
		void window.electronAPI.getPlatform().then(setPlatform);
		const api = window.teleprompterAPI;
		if (!api) return;
		const unsubscribe = api.onModel(setModel);
		void api
			.modelStatus()
			.then(setModel)
			.catch((error) => setError(String(error)));
		return unsubscribe;
	}, []);
	const save = useCallback(async () => {
		if (timer.current) clearTimeout(timer.current);
		const candidate = latest.current;
		setSaved("saving");
		const operation = saveQueue.current
			.catch(() => undefined)
			.then(async () => {
				if (!window.teleprompterAPI) throw new Error("Desktop connection unavailable.");
				await window.teleprompterAPI.saveDraft(candidate);
				if (latest.current === candidate) {
					dirty.current = false;
					window.teleprompterAPI?.draftDirty(false);
					setSaved("saved");
				}
				setError(null);
			});
		saveQueue.current = operation;
		try {
			await operation;
			return true;
		} catch (error) {
			setSaved("error");
			setError(String(error));
			return false;
		}
	}, []);
	useEffect(
		() => registerRecordingDraftFlush(() => (dirty.current ? save() : Promise.resolve(true))),
		[save],
	);
	const edit = (patch: Partial<RecordingDraft>) => {
		const next = { ...latest.current, ...patch };
		latest.current = next;
		dirty.current = true;
		window.teleprompterAPI?.draftDirty(true);
		setDraft(next);
		setSaved("unsaved");
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => void save(), 500);
	};
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			if (dirty.current) void save();
		},
		[save],
	);
	const run = async (action: () => Promise<unknown>) => {
		try {
			await action();
		} catch (error) {
			setError(String(error));
		}
	};
	const start = async (withScript: boolean) => {
		if (!(await save())) return;
		await window.teleprompterAPI?.arm(withScript);
		await window.electronAPI.showRecordingHud();
	};
	return (
		<section
			aria-label={t("prompter.prepare", "Prepare narration")}
			className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-7 py-8 lg:px-10"
		>
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold">
						{t("prompter.prepare", "Prepare narration")}
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						{t(
							"prompter.subtitle",
							"Write, rehearse, then record. Your current draft is saved on this device.",
						)}
					</p>
				</div>
				<span role="status" className="text-xs text-muted-foreground">
					{t(`prompter.${saved === "error" ? "unsaved" : saved}`, saved)}
				</span>
			</div>
			{error && (
				<p role="alert" className="mb-4 text-sm text-danger">
					{error}{" "}
					<Button size="sm" variant="ghost" onClick={() => void save()}>
						{t("prompter.retry", "Retry save")}
					</Button>
				</p>
			)}
			<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
				<div className="min-w-0">
					<label className="mb-2 block text-sm font-medium" htmlFor="recording-script">
						{t("prompter.script", "Narration script")}
					</label>
					<textarea
						id="recording-script"
						value={draft.text}
						disabled={busy}
						maxLength={100000}
						onChange={(event) => edit({ text: event.target.value })}
						placeholder={t("prompter.placeholder", "Paste the words you want to say…")}
						className="min-h-80 w-full resize-y rounded-xl border border-default/50 bg-default/15 p-5 text-base leading-relaxed outline-none focus:border-accent disabled:opacity-60"
					/>
					<label className="mt-2 inline-flex cursor-pointer text-xs text-muted-foreground hover:text-foreground">
						{t("prompter.import", "Import plain text")}
						<input
							type="file"
							accept=".txt,.md,text/plain,text/markdown"
							disabled={busy}
							className="sr-only"
							onChange={(event) => {
								const file = event.target.files?.[0];
								if (file)
									void file
										.text()
										.then((text) => edit({ text: text.slice(0, 100000) }))
										.catch((error) => setError(String(error)));
								event.target.value = "";
							}}
						/>
					</label>
				</div>
				<div className="space-y-6 rounded-xl border border-default/40 p-5">
					{(
						[
							["fontSize", "Font size", 18, 64, 1],
							["width", "Window width", 320, 1000, 10],
							["opacity", "Background opacity", 0.15, 1, 0.05],
						] as const
					).map(([key, label, min, max, step]) => (
						<div key={key}>
							<label
								className="mb-3 block text-xs text-muted-foreground"
								id={`prompter-${key}`}
							>
								{t(`prompter.${key}`, label)}
							</label>
							<Slider
								aria-labelledby={`prompter-${key}`}
								min={min}
								max={max}
								step={step}
								value={[draft[key]]}
								onValueChange={([value]) => edit({ [key]: value })}
							/>
						</div>
					))}
					<div className="flex items-center justify-between gap-4">
						<label htmlFor="prompter-hidden" className="text-sm">
							{t("prompter.hidden", "Hide from recording")}
						</label>
						<Switch
							id="prompter-hidden"
							checked={draft.hideFromCapture}
							disabled={busy || platform === "linux"}
							onCheckedChange={(value) => edit({ hideFromCapture: value })}
						/>
					</div>
					{platform === "linux" && (
						<p className="text-xs text-warning">
							{t(
								"prompter.linux",
								"This platform cannot guarantee hiding the prompter from captures.",
							)}
						</p>
					)}
					<div className="flex items-center justify-between gap-4">
						<label htmlFor="prompter-follow" className="text-sm">
							{t("prompter.follow", "Follow my voice")}
						</label>
						<Switch
							id="prompter-follow"
							checked={draft.voiceFollow}
							disabled={busy}
							onCheckedChange={(value) => edit({ voiceFollow: value })}
						/>
					</div>
					{draft.voiceFollow && (
						<div className="space-y-2 border-t border-default/40 pt-4">
							<p className="text-xs text-muted-foreground">
								{t(
									"prompter.modelDescription",
									"Local Chinese / English recognition. A one-time 200 MB download; no account or cloud audio.",
								)}
							</p>
							{model.exists ? (
								<span className="text-xs text-success">
									{t("prompter.modelReady", "Local model ready")}
								</span>
							) : (
								<Button
									size="sm"
									variant="secondary"
									disabled={model.downloading || busy}
									onClick={() =>
										void run(async () => {
											const result =
												await window.teleprompterAPI?.downloadModel();
											if (result) setModel(result);
										})
									}
								>
									{model.downloading
										? `${t("prompter.downloading", "Downloading")} ${model.progress}%`
										: t("prompter.download", "Download local model")}
								</Button>
							)}
							{model.error && (
								<p role="alert" className="text-xs text-danger">
									{model.error}
								</p>
							)}
						</div>
					)}
				</div>
			</div>
			<div className="mt-6 flex flex-wrap items-center gap-3">
				<Button
					variant="secondary"
					disabled={!draft.text.trim() || (busy && state.phase !== "rehearsal")}
					onClick={() =>
						void run(async () => {
							if (state.phase === "rehearsal") {
								await window.teleprompterAPI?.stopRehearsal();
								return;
							}
							if (await save()) {
								await window.electronAPI.showRecordingHud();
								await window.teleprompterAPI?.rehearse();
							}
						})
					}
				>
					{state.phase === "rehearsal"
						? t("prompter.stopRehearsal", "Stop rehearsal")
						: t("prompter.rehearse", "Rehearse")}
				</Button>
				<Button
					disabled={!draft.text.trim() || busy}
					onClick={() => void run(() => start(true))}
				>
					{t("prompter.record", "Record with script")}
				</Button>
				<Button
					variant="ghost"
					disabled={busy}
					onClick={() => void run(() => start(false))}
				>
					{t("prompter.skip", "Skip preparation and record")}
				</Button>
			</div>
			<p className="mt-4 text-xs text-muted-foreground">
				{t(
					"prompter.footer",
					"Prompting does not create subtitles. Your recording microphone setting still controls whether voice is saved in the video.",
				)}
			</p>
		</section>
	);
}
