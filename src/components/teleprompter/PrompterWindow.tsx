import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, XIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { tokenizeScript } from "@/lib/prompterAlignment";
import { usePrompterState } from "./usePrompterState";

export default function PrompterWindow() {
	const t = useScopedT("launch");
	const state = usePrompterState();
	const tokens = useMemo(() => tokenizeScript(state.draft.text), [state.draft.text]);
	const current = tokens.findIndex((token) => token.end > state.cursor);
	const visibleStart = Math.max(0, (current < 0 ? tokens.length : current) - 100);
	const visibleTokens = tokens.slice(visibleStart, visibleStart + 600);
	const active = useRef<HTMLButtonElement>(null);
	const move = (direction: number) => {
		const index = current < 0 ? tokens.length : current;
		void window.teleprompterAPI?.setCursor(
			tokens[Math.max(0, Math.min(tokens.length - 1, index + direction))]?.start ?? 0,
		);
	};
	useEffect(() => {
		if (current >= 0) active.current?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [current]);
	return (
		<section
			aria-label={t("prompter.window", "Teleprompter")}
			className="flex h-screen flex-col overflow-hidden rounded-2xl border border-white/15 text-white shadow-xl"
			style={{ backgroundColor: `rgba(16, 18, 24, ${state.draft.opacity})` }}
		>
			<header
				className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<span className="min-w-0 flex-1 truncate text-xs text-white/70">
					{t(`prompter.${state.recognition}`, state.recognition)}
				</span>
				<div className="flex gap-1" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7 text-white hover:bg-white/10"
						aria-label={t("prompter.previous", "Previous word")}
						onClick={() => move(-1)}
					>
						<ArrowLeft className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7 text-white hover:bg-white/10"
						aria-label={t("prompter.next", "Next word")}
						onClick={() => move(1)}
					>
						<ArrowRight className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7 text-white hover:bg-white/10"
						aria-label={t("prompter.close", "Hide teleprompter")}
						onClick={() => void window.teleprompterAPI?.hide()}
					>
						<XIcon className="size-4" />
					</Button>
				</div>
			</header>
			{state.error && (
				<p role="alert" className="shrink-0 px-4 py-2 text-xs text-amber-200">
					{state.error}
				</p>
			)}
			<div
				className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-20 leading-relaxed"
				style={{ fontSize: state.draft.fontSize }}
			>
				{visibleTokens.map((token, localIndex) => {
					const index = visibleStart + localIndex;
					return (
						<span key={token.start}>
							{state.draft.text
								.slice(index ? tokens[index - 1].end : 0, token.start)
								.split("\n")
								.map((line, lineIndex) => (
									<span key={lineIndex}>
										{lineIndex > 0 && <br />}
										{line}
									</span>
								))}
							<button
								type="button"
								tabIndex={-1}
								ref={index === current ? active : undefined}
								data-current-word={index === current ? "true" : undefined}
								className={`rounded-sm text-left transition-colors ${index === current ? "bg-amber-300/20 text-amber-200" : token.end <= state.cursor ? "text-white/35" : "text-white"}`}
								onClick={() => void window.teleprompterAPI?.setCursor(token.start)}
							>
								{state.draft.text.slice(token.start, token.end)}
							</button>
						</span>
					);
				})}
				{visibleStart + visibleTokens.length === tokens.length &&
					state.draft.text.slice(tokens[tokens.length - 1]?.end ?? 0)}
			</div>
		</section>
	);
}
