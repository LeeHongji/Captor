import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowClockwiseIcon, DownloadSimpleIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { SettingsRow } from "./SettingsRow";

export function UpdateSettings() {
	const t = useScopedT("settings");
	const [summary, setSummary] = useState<UpdateStatusSummary | null>(null);
	const [checking, setChecking] = useState(false);
	useEffect(() => {
		let active = true;
		void window.electronAPI
			.getUpdateStatusSummary()
			.then((value) => {
				if (active) setSummary(value);
			})
			.catch(() => {
				if (active)
					setSummary({ status: "error", currentVersion: "", availableVersion: null });
			});
		return () => {
			active = false;
		};
	}, []);
	const check = async () => {
		setChecking(true);
		try {
			await window.electronAPI.checkForAppUpdates();
			setSummary(await window.electronAPI.getUpdateStatusSummary());
		} catch {
			toast.error(
				t(
					"updates.checkFailed",
					"Could not check for updates. Try again or browse releases.",
				),
			);
		} finally {
			setChecking(false);
		}
	};
	return (
		<SettingsRow
			title={summary?.currentVersion ? `Captor ${summary.currentVersion}` : "Captor"}
			stacked
			description={
				summary?.distributionMode === "manual"
					? t(
							"updates.manualDescription",
							"Updates are installed manually. Save your work and quit Captor before replacing the app.",
						)
					: undefined
			}
		>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					disabled={checking}
					onClick={() => void check()}
				>
					<ArrowClockwiseIcon />
					{checking
						? t("updates.checking", "Checking…")
						: t("updates.checkNow", "Check for updates")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={async () => {
						try {
							const result = await window.electronAPI.openUpdateDownloadPage();
							if (!result.success)
								toast.error(
									t("updates.openFailed", "Could not open the download page."),
								);
						} catch {
							toast.error(
								t("updates.openFailed", "Could not open the download page."),
							);
						}
					}}
				>
					<DownloadSimpleIcon />
					{t("updates.browseReleases", "Downloads and releases")}
				</Button>
			</div>
			<p role="status" className="text-xs text-muted-foreground">
				{summary?.status === "available"
					? `${t("updates.available", "New version available")}: ${summary.availableVersion}`
					: summary?.status === "up-to-date"
						? t("updates.upToDate", "No newer installer is available.")
						: summary?.status === "error"
							? t(
									"updates.checkFailed",
									"Could not check for updates. Try again or browse releases.",
								)
							: null}
			</p>
		</SettingsRow>
	);
}
