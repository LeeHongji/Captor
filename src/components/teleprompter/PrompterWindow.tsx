import { useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from "react";
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
	const word = tokens[current];
	const start = word?.start ?? state.draft.text.length;
	const end = word?.end ?? start;
	const active = useRef<HTMLSpanElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const scrollTarget = useRef<{ top: number; cursor: number; interrupted: boolean } | null>(null);
	const interruptScroll = () => {
		if (scrollTarget.current) scrollTarget.current.interrupted = true;
	};
	const move = (direction: number) => {
		const index = current < 0 ? tokens.length : current;
		scrollTarget.current = null;
		void window.teleprompterAPI?.setCursor(
			tokens[Math.max(0, Math.min(tokens.length - 1, index + direction))]?.start ?? 0,
		);
	};
	const selectWord = (event: MouseEvent<HTMLDivElement>) => {
		const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
		const node = caret?.startContainer;
		const segment = node?.parentElement;
		if (!caret || node?.nodeType !== Node.TEXT_NODE || !segment?.dataset.scriptStart) return;
		const index =
			caret.startOffset - (event.clientX < caret.getBoundingClientRect().left ? 1 : 0);
		if (index < 0 || index >= (node.textContent?.length ?? 0)) return;
		// A caret is the nearest insertion point, even when the click is in padding.
		caret.setStart(node, index);
		caret.setEnd(node, index + 1);
		const rect = caret.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		)
			return;
		const offset = Number(segment.dataset.scriptStart) + index;
		const token = tokens.find((token) => token.start <= offset && token.end > offset);
		if (token) {
			scrollTarget.current = null;
			void window.teleprompterAPI?.setCursor(token.start);
		}
	};
	useLayoutEffect(() => {
		const container = scroller.current;
		const element = active.current;
		if (!container || !element) return;
		const rect = element.getBoundingClientRect();
		const top = container.scrollTop + rect.top - container.getBoundingClientRect().top;
		const target = Math.round(
			Math.max(
				0,
				Math.min(
					container.scrollHeight - container.clientHeight,
					top - (container.clientHeight - rect.height) / 2,
				),
			),
		);
		// Same-line speech preserves the animation unless a user scroll interrupted it.
		const previous = scrollTarget.current;
		if (
			!previous ||
			target !== previous.top ||
			(previous.interrupted && state.cursor !== previous.cursor)
		) {
			scrollTarget.current = { top: target, cursor: state.cursor, interrupted: false };
			container.scrollTo({ top: target, behavior: "smooth" });
		} else previous.cursor = state.cursor;
	});
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
				ref={scroller}
				className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-20 leading-relaxed"
				style={{
					fontSize: state.draft.fontSize,
					whiteSpace: "pre-wrap",
					overflowAnchor: "none",
				}}
				onClick={selectWord}
				onWheel={interruptScroll}
				onTouchMove={interruptScroll}
				onPointerDown={interruptScroll}
			>
				{/* Keep the whole text in normal flow: trimming its prefix rewraps every line. */}
				<span data-script-start="0" className="text-white/35">
					{state.draft.text.slice(0, start)}
				</span>
				{word && (
					<span
						ref={active}
						data-script-start={start}
						data-current-word="true"
						className="rounded-sm bg-amber-300/20 text-amber-200"
					>
						{state.draft.text.slice(start, end)}
					</span>
				)}
				<span data-script-start={end}>{state.draft.text.slice(end)}</span>
			</div>
		</section>
	);
}
