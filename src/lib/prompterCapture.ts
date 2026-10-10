export function getPrompterCaptureExclusions(
	hideHud: boolean,
	prompter: { id: number; hidden: boolean } | null,
) {
	return {
		// Preserve the existing whole-application exclusion when the HUD is hidden.
		includedWindowIds: hideHud && prompter && !prompter.hidden ? [prompter.id] : [],
		excludedWindowIds: !hideHud && prompter?.hidden ? [prompter.id] : [],
	};
}
