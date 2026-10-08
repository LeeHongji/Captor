import { useRef, useState } from "react";
import { Button, Description, Form, Input, Label, TextArea, TextField } from "@heroui/react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ChatDots } from "@/components/ui/icons";
import { FEEDBACK_EMAIL } from "@/lib/feedback/emailDraft";
import { copyFeedbackEmail } from "@/lib/feedback/prepareEmail";

export function FeedbackDialog({
	className,
	showLabel = true,
}: {
	className?: string;
	showLabel?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [subject, setSubject] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [opening, setOpening] = useState(false);
	const [status, setStatus] = useState("");
	const openingRef = useRef(false);
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!openingRef.current) setOpen(value);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm" className={className} aria-label="Feedback">
					<ChatDots className="size-4" />
					{showLabel && "Feedback"}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Send feedback</DialogTitle>
				</DialogHeader>
				<Form
					className="flex flex-col gap-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (openingRef.current) return;
						openingRef.current = true;
						setOpening(true);
						setError("");
						setStatus("");
						try {
							const result = await window.electronAPI.prepareFeedbackEmail({
								subject,
								message,
							});
							if (!result.success)
								throw new Error(result.error || "Could not open your email app.");
							setStatus(
								"Your email app was opened. Review the draft and send it there.",
							);
						} catch (error) {
							setError(
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
					<TextField
						name="subject"
						isRequired
						isDisabled={opening}
						value={subject}
						onChange={(value) => {
							setSubject(value);
							setError("");
							setStatus("");
						}}
						className="w-full"
					>
						<Label>Subject</Label>
						<Input maxLength={160} placeholder="What’s on your mind?" />
					</TextField>
					<TextField
						name="description"
						isRequired
						isDisabled={opening}
						value={message}
						onChange={(value) => {
							setMessage(value);
							setError("");
							setStatus("");
						}}
						className="w-full"
					>
						<Label>Description</Label>
						<TextArea
							maxLength={10000}
							rows={5}
							className="resize-y"
							placeholder="Tell us more…"
						/>
					</TextField>
					<Description className="text-xs">
						Opens your email app with a draft to {FEEDBACK_EMAIL}. Review and send it
						there. You can add attachments in your email app.
					</Description>
					{status && <Description role="status">{status}</Description>}
					{error && (
						<Description role="alert" className="text-danger">
							{error}
						</Description>
					)}
					<Button type="submit" isDisabled={opening} className="w-full">
						{opening ? "Opening…" : "Prepare email"}
					</Button>
					{error && (
						<Button
							type="button"
							variant="secondary"
							onPress={async () => {
								try {
									await copyFeedbackEmail({ subject, message });
									setError("");
									setStatus("Feedback copied. Paste it into your email app.");
								} catch {
									setError(
										"Could not copy. Select your feedback and copy it manually.",
									);
								}
							}}
						>
							Copy feedback
						</Button>
					)}
				</Form>
			</DialogContent>
		</Dialog>
	);
}
