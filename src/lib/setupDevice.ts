/** Device IDs belong to a renderer origin. Resolve a saved label in the current origin. */
export function resolveSetupDevice(
	devices: Array<Pick<MediaDeviceInfo, "deviceId" | "label" | "kind">>,
	kind: "audioinput" | "videoinput",
	deviceId?: string,
	label?: string,
): string | undefined {
	if (!deviceId && !label) return undefined;
	const inputs = devices.filter((device) => device.kind === kind);
	if (deviceId && inputs.some((device) => device.deviceId === deviceId)) return deviceId;
	const matches = inputs.filter(
		(device) =>
			device.label === label &&
			device.deviceId !== "default" &&
			device.deviceId !== "communications",
	);
	if (label && matches.length === 1) return matches[0].deviceId;
	throw Error("setup-device-unavailable");
}
