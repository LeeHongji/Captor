import { DashboardAnnouncements } from "./DashboardAnnouncements";
import { Card, Modal } from "@heroui/react";
import { DashboardFilters } from "./DashboardFilters";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardToolbar } from "./DashboardToolbar";
import type { DashboardProps } from "./types";
import { useDashboardModel } from "./useDashboardModel";
import { useEffect } from "react";
import { RecordingPreparation } from "@/components/teleprompter/RecordingPreparation";
export function Dashboard(props: DashboardProps) {
	useEffect(() => window.recordingSetupAPI?.onOpen(() => props.onOpenChange(false)), [props.onOpenChange]);
	const model = useDashboardModel(props);
	const view = { ...props, ...model };
	useEffect(() => {
		const openPreparation = () => {
			if (!props.open || !localStorage.getItem("captor.open-preparation")) return;
			localStorage.removeItem("captor.open-preparation");
			model.setSection("preparation");
		};
		openPreparation();
		window.addEventListener("storage", openPreparation);
		return () => window.removeEventListener("storage", openPreparation);
	}, [props.open, model.setSection]);
	return (
		<>
			<Modal isOpen={props.open} onOpenChange={props.onOpenChange}>
				<Modal.Backdrop>
					<Modal.Container size="full">
						<Modal.Dialog
							aria-label="Projects dashboard"
							className="dashboard-surface dashboard-shell flex h-full flex-row gap-0 rounded-none bg-background p-0 text-foreground"
						>
							<DashboardSidebar {...view} />
							<Card className="my-3 mr-3 flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-2xl bg-background p-0 shadow-sm">
								{model.section !== "settings" &&
									model.section !== "preparation" && (
										<>
											<DashboardAnnouncements />
											<DashboardToolbar {...view} />
											<DashboardFilters {...view} />
										</>
									)}
								{model.section === "preparation" ? (
									<RecordingPreparation />
								) : (
									<DashboardGrid {...view} />
								)}
							</Card>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
