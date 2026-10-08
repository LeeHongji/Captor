import { expect, it, vi } from "vitest";
import { trashLibraryProjects } from "./trashProjects";
it("rejects paths outside the project library before touching files", async () => {
	const trash = vi.fn();
	await expect(
		trashLibraryProjects(["/private/tmp/a.captor", "/private/tmp/private.txt"], {
			list: async () => ({ entries: [{ path: "/private/tmp/a.captor" }] }),
			trash,
			thumbnailPath: (p) => p + ".png",
		}),
	).rejects.toThrow("not in the library");
	expect(trash).not.toHaveBeenCalled();
});
it("trashes only selected project files, deduplicates paths, and reports partial failures", async () => {
	const trash = vi.fn(async (p: string) => {
		if (p.endsWith("b.captor")) throw Error("locked");
	});
	const result = await trashLibraryProjects(
		["/private/tmp/a.captor", "/private/tmp/a.captor", "/private/tmp/b.captor"],
		{
			list: async () => ({
				entries: [{ path: "/private/tmp/a.captor" }, { path: "/private/tmp/b.captor" }],
			}),
			trash,
			thumbnailPath: (p) => p + ".missing.png",
		},
	);
	expect(result.deleted).toEqual(["/private/tmp/a.captor"]);
	expect(result.errors).toEqual(["Could not trash b.captor"]);
	expect(trash.mock.calls.map(([p]) => p)).toEqual([
		"/private/tmp/a.captor",
		"/private/tmp/b.captor",
	]);
});
