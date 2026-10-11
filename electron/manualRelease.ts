export const CAPTOR_RELEASES_URL = "https://github.com/LeeHongji/Captor/releases";
const RELEASES_API = "https://api.github.com/repos/LeeHongji/Captor/releases";

// Captor publishes stable X.Y.Z and experimental X.Y.Z-beta.N versions.
function versionParts(value: string) {
	const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/.exec(
		value,
	);
	return match
		? [
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
				match[4] === undefined ? Infinity : Number(match[4]),
			]
		: null;
}

function compareVersions(left: string, right: string) {
	const a = versionParts(left);
	const b = versionParts(right);
	if (!a || !b) return 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
	}
	return 0;
}

export interface ManualRelease {
	version: string;
	url: string;
	prerelease: boolean;
}

export function selectManualRelease(
	data: unknown,
	currentVersion: string,
	experimental: boolean,
	arch: string,
): ManualRelease | null {
	if (!versionParts(currentVersion) || !["arm64", "x64"].includes(arch)) return null;
	const candidates: ManualRelease[] = [];
	for (const item of Array.isArray(data) ? data : [data]) {
		if (!item || typeof item !== "object") continue;
		const release = item as Record<string, unknown>;
		if (
			release.draft !== false ||
			typeof release.tag_name !== "string" ||
			typeof release.prerelease !== "boolean"
		)
			continue;
		const tag = release.tag_name;
		const parts = versionParts(tag);
		if (!parts || (!experimental && (release.prerelease || parts[3] !== Infinity))) continue;
		if (compareVersions(tag, currentVersion) <= 0 || !Array.isArray(release.assets)) continue;
		const version = tag.replace(/^v/, "");
		// A source-only or partially uploaded release must not be offered as installable.
		const installer = release.assets.some((asset: unknown) => {
			if (!asset || typeof asset !== "object") return false;
			const entry = asset as Record<string, unknown>;
			return (
				entry.name === `Captor-${version}-${arch}.dmg` &&
				entry.state === "uploaded" &&
				typeof entry.size === "number" &&
				entry.size > 0
			);
		});
		if (installer)
			candidates.push({
				version,
				url: `${CAPTOR_RELEASES_URL}/tag/${encodeURIComponent(tag)}`,
				prerelease: release.prerelease,
			});
	}
	return candidates.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

export async function fetchManualRelease(
	currentVersion: string,
	experimental: boolean,
	arch: string,
) {
	const response = await fetch(`${RELEASES_API}?per_page=100`, {
		headers: { Accept: "application/vnd.github+json" },
		signal: AbortSignal.timeout(15_000),
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`GitHub update check failed (${response.status}).`);
	return selectManualRelease(await response.json(), currentVersion, experimental, arch);
}
