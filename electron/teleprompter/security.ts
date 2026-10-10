export function isTrustedPrompterDocument(
	documentUrl: string,
	bases: readonly string[],
	allowed: readonly string[],
) {
	try {
		const url = new URL(documentUrl);
		if (
			url.username ||
			url.password ||
			url.searchParams.getAll("windowType").length !== 1 ||
			!allowed.includes(url.searchParams.get("windowType") ?? "")
		)
			return false;
		if (url.searchParams.get("windowType") !== "editor" && url.searchParams.size !== 1)
			return false;
		return bases.some((base) => {
			const trusted = new URL(base);
			return (
				url.protocol === trusted.protocol &&
				url.host === trusted.host &&
				url.pathname === trusted.pathname
			);
		});
	} catch {
		return false;
	}
}
