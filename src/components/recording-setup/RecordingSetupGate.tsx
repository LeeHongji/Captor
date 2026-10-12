import { EditorLoadingSkeleton } from "@/components/video-editor/layout/EditorLoadingSkeleton";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { RecordingSetupWizard } from "./RecordingSetupWizard";
import { useI18n } from "@/contexts/I18nContext";
export function RecordingSetupGate({ children }: { children: ReactNode }) {
	const [visible, setVisible] = useState(false);
	const [entered, setEntered] = useState(!window.recordingSetupAPI);
	const [checking, setChecking] = useState(!!window.recordingSetupAPI);
	const { t } = useI18n();
	useEffect(() => {
		const api = window.recordingSetupAPI;
		if (!api) return;
		let cancelled = false;
		let opened = false;
		void api
			.startupRequired()
			.then((required) => {
				if (cancelled || opened) return;
				setVisible(required);
				setEntered(!required);
				setChecking(false);
			})
			.catch(() => {
				if (!cancelled) {
					setVisible(true);
					setChecking(false);
				}
			});
		const stop = api.onOpen(() => {
			opened = true;
			void api.acknowledgeOpen();
			setVisible(true);
			setChecking(false);
		});
		return () => {
			cancelled = true;
			stop();
		};
	}, []);
	if (checking)
		return (
			<div
				role="status"
				className="flex h-full items-center justify-center bg-background text-muted-foreground"
			>
				{t("setup.checking")}
			</div>
		);
	return (
		<>
			<div className={visible ? "hidden" : "h-full"}>
				{entered && <Suspense fallback={<EditorLoadingSkeleton />}>{children}</Suspense>}
			</div>
			{visible && (
				<RecordingSetupWizard
					onClose={() => {
						setEntered(true);
						setVisible(false);
					}}
				/>
			)}
		</>
	);
}
