import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { calculateMp4ExportDimensions } from "@/components/video-editor/exportDimensions";
import { I18nProvider, useI18n } from "@/contexts/I18nContext";
import { EditorExportMenu } from "@/components/video-editor/layout/EditorExportMenu";
import { loadEditorPreferences } from "@/components/video-editor/editorPreferences";
import { useExportSettings } from "@/components/video-editor/export/useExportSettings";
import "@/index.css";

window.electronAPI = {
	prepareFeedbackEmail: async (input: { subject: string; message: string }) => {
		document.documentElement.dataset.preparedEmail = JSON.stringify(input);
		return { success: true };
	},
	getPlatform: async () => "darwin",
} as unknown as typeof window.electronAPI;
function Preview() {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState("idle");
	const { t } = useI18n();
	const [preferences] = useState(loadEditorPreferences);
	const exportSettings = useExportSettings(preferences, [], []);
	const props = {
		t,
		exportSettings,
		exportSession: {
			showExportDropdown: open,
			setShowExportDropdown: setOpen,
			isExporting: state === "exporting",
			exportProgress: { percentage: 37 },
			exportError:
				state === "error"
					? "[VIDEO_DECODE_ENCODING_ERROR] sourceTimeSec=0.500"
					: state === "save-canceled"
						? "Save dialog canceled. Click Save Again to save without re-rendering."
						: null,
			hasPendingExportSave: state === "save-canceled",
			exportedFilePath: state === "saved" ? "/exports/demo.mp4" : undefined,
		},
		exportDimensions: {
			gifOutputDimensions: { width: 800, height: 450 },
			mp4OutputDimensions: {
				medium: calculateMp4ExportDimensions(1920, 1080, "medium"),
				good: calculateMp4ExportDimensions(1920, 1080, "good"),
				high: calculateMp4ExportDimensions(1920, 1080, "high"),
				source: calculateMp4ExportDimensions(1920, 1080, "source"),
			},
		},
		exportStatus: { exportPercentLabel: "37%" },
		hasCaptionsForSidecar: true,
		nvidiaCudaExportAvailable: false,
		experimentalNvidiaCudaExport: false,
		setExperimentalNvidiaCudaExport: () => undefined,
		handleOpenExportDropdown: () => {
			setOpen(true);
			setState("idle");
		},
		handleExportDropdownClose: () => setOpen(false),
		handleCancelExport: () => {
			setState("idle");
			setOpen(false);
			document.documentElement.dataset.exportCanceled = "true";
		},
		handleRetrySaveExport: () => {
			setState("saved");
			document.documentElement.dataset.saveRetried = "true";
		},
		handleStartExportFromDropdown: () => setState("exporting"),
		revealExportedFile: () => {
			document.documentElement.dataset.revealed = "true";
		},
	} as unknown as ComponentProps<typeof EditorExportMenu>;
	return (
		<div className="flex justify-end p-12">
			<div className="mr-auto flex gap-3">
				<button
					type="button"
					onClick={() => {
						setOpen(true);
						setState("error");
					}}
				>
					Fixture export error
				</button>
				<button
					type="button"
					onClick={() => {
						setOpen(true);
						setState("save-canceled");
					}}
				>
					Fixture save canceled
				</button>
				<button
					type="button"
					onClick={() => {
						setOpen(true);
						setState("saved");
					}}
				>
					Fixture export saved
				</button>
			</div>
			<EditorExportMenu {...props} />
		</div>
	);
}
createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<I18nProvider>
			<Preview />
		</I18nProvider>
	</ThemeProvider>,
);
