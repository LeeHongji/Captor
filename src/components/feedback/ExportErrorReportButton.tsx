import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildExportErrorReport } from "@/lib/feedback/exportErrorReporting";
import { FEEDBACK_EMAIL } from "@/lib/feedback/emailDraft";
import { copyFeedbackEmail } from "@/lib/feedback/prepareEmail";

export function ExportErrorReportButton({
	error,
	format,
}: {
	error: string;
	format: "mp4" | "gif";
}) {
	const [open, setOpen] = useState(false);
	const [opening, setOpening] = useState(false);
	const [status, setStatus] = useState("");
	const [openError, setOpenError] = useState("");
	const openingRef = useRef(false);
	const report = buildExportErrorReport(error, format);
	const input = {
		subject: `Export error (${format.toUpperCase()})`,
		message: JSON.stringify(report, null, 2),
	};
	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="h-8 text-xs"
				onClick={() => setOpen(true)}
			>
				Report error
			</Button>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!openingRef.current) setOpen(value);
				}}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Report export error</DialogTitle>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">
						Prepare an email to {FEEDBACK_EMAIL} with technical details. No recording,
						file paths, attachments or console logs are included.
					</p>
					<details>
						<summary className="cursor-pointer text-sm">View data to be sent</summary>
						<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs mt-2">
							{input.message}
						</pre>
					</details>
					{status && (
						<p role="status" className="text-sm">
							{status}
						</p>
					)}
					{openError && (
						<p role="alert" className="text-sm text-destructive">
							{openError}
						</p>
					)}
					<Button
						disabled={opening}
						onClick={async () => {
							if (openingRef.current) return;
							openingRef.current = true;
							setOpening(true);
							setOpenError("");
							setStatus("");
							try {
								const result = await window.electronAPI.prepareFeedbackEmail(input);
								if (!result.success)
									throw new Error(
										result.error || "Could not open your email app.",
									);
								setStatus(
									"Your email app was opened. Review the draft and send it there.",
								);
							} catch (error) {
								setOpenError(
									error instanceof Error
										? error.message
										: "Could not open your email app.",
								);
							} finally {
								openingRef.current = false;
								setOpening(false);
							}
						}}
					>
						{opening ? "Opening…" : "Prepare email"}
					</Button>
					{openError && (
						<Button
							variant="outline"
							onClick={async () => {
								try {
									await copyFeedbackEmail(input);
									setOpenError("");
									setStatus("Report copied. Paste it into your email app.");
								} catch {
									setOpenError(
										"Could not copy. Select the report and copy it manually.",
									);
								}
							}}
						>
							Copy report
						</Button>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
