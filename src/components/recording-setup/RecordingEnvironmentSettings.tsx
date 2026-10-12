import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/video-editor/SettingsRow";
import { useI18n } from "@/contexts/I18nContext";
export function RecordingEnvironmentSettings() {
	const { t } = useI18n();
	const [supported, setSupported] = useState(false);
	useEffect(() => {
		let current = true;
		void window.electronAPI.getPlatform().then((platform) => {
			if (current) setSupported(platform === "darwin");
		});
		return () => {
			current = false;
		};
	}, []);
	if (!supported || !window.recordingSetupAPI) return null;
	return (
		<SettingsRow title={t("setup.prepareTitle")}>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void window.recordingSetupAPI!.open()}
			>
				{t("setup.openEnvironment")}
			</Button>
		</SettingsRow>
	);
}
