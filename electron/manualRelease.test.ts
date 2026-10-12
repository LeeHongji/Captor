import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchManualRelease, selectManualRelease } from "./manualRelease";

const release = (version: string, prerelease = false, arch = "arm64") => ({
	tag_name: `v${version}`,
	draft: false,
	prerelease,
	assets: [{ name: `Captor-${version}-${arch}.dmg`, state: "uploaded", size: 100 }],
});
afterEach(() => vi.unstubAllGlobals());
describe("manual installer discovery", () => {
	it("offers the matching architecture with a fixed project URL", () => {
		expect(selectManualRelease(release("0.0.3"), "0.0.2", false, "arm64")).toEqual({
			version: "0.0.3",
			prerelease: false,
			url: "https://github.com/LeeHongji/Captor/releases/tag/v0.0.3",
		});
		expect(selectManualRelease(release("0.0.3"), "0.0.2", false, "x64")).toBeNull();
	});
	it("rejects drafts, malformed tags, incomplete uploads and downgrades", () => {
		for (const item of [
			{ ...release("0.0.3"), draft: true },
			{ ...release("0.0.3"), tag_name: "../../evil" },
			{ ...release("0.0.3"), assets: [] },
			release("0.0.2"),
			release("0.0.1"),
		])
			expect(selectManualRelease(item, "0.0.2", true, "arm64")).toBeNull();
	});
	it("keeps stable users out of beta and sorts versions numerically", () => {
		const list = [
			release("0.0.3-beta.2", true),
			release("0.0.3-beta.10", true),
			release("0.0.2"),
		];
		expect(selectManualRelease(list, "0.0.2", false, "arm64")).toBeNull();
		expect(selectManualRelease(list, "0.0.2", true, "arm64")?.version).toBe("0.0.3-beta.10");
		expect(
			selectManualRelease([...list, release("0.0.3")], "0.0.3-beta.10", true, "arm64")
				?.version,
		).toBe("0.0.3");
	});
	it("handles an empty public repository without treating it as a network failure", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
		vi.stubGlobal("fetch", fetchMock);
		expect(await fetchManualRelease("0.0.2", false, "arm64")).toBeNull();
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.github.com/repos/LeeHongji/Captor/releases?per_page=100",
		);
	});
	it("reports API failures and requests beta only with explicit opt-in", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ status: 403, ok: false });
		vi.stubGlobal("fetch", fetchMock);
		await expect(fetchManualRelease("0.0.2", true, "arm64")).rejects.toThrow("403");
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.github.com/repos/LeeHongji/Captor/releases?per_page=100",
		);
	});
	it("finds an installable stable release beyond a page of newer betas", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				status: 200,
				ok: true,
				headers: new Headers({ Link: '<https://example.com/untrusted>; rel="next"' }),
				json: async () =>
					Array.from({ length: 100 }, (_, i) => release(`0.0.5-beta.${i}`, true)),
			})
			.mockResolvedValueOnce({
				status: 200,
				ok: true,
				headers: new Headers(),
				json: async () => [release("0.0.4")],
			});
		vi.stubGlobal("fetch", fetchMock);
		expect((await fetchManualRelease("0.0.2", false, "arm64"))?.version).toBe("0.0.4");
		expect(fetchMock.mock.calls[1][0]).toBe(
			"https://api.github.com/repos/LeeHongji/Captor/releases?per_page=100&page=2",
		);
	});
});
