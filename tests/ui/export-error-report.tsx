import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ExportErrorReportButton } from "@/components/feedback/ExportErrorReportButton";
import "@/index.css";
window.electronAPI = {
	prepareFeedbackEmail: async (input: { subject: string; message: string }) => {
		document.documentElement.dataset.preparedEmail = JSON.stringify(input);
		return { success: true };
	},
} as unknown as typeof window.electronAPI;
createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<I18nProvider>
			<main className="p-8">
				<ExportErrorReportButton
					format="mp4"
					error="[VIDEO_DECODE_ENCODING_ERROR] private /Users/Alice/video.mp4 alice@example.com (sourceTimeSec=0.500, chunkIndex=25)"
				/>
			</main>
		</I18nProvider>
	</ThemeProvider>,
);
