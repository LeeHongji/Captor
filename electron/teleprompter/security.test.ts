import { describe, expect, it } from "vitest";
import { isTrustedPrompterDocument } from "./security";
describe("prompter document trust", () => {
	const bases = [
		"http://localhost:5173/",
		"file:///Applications/Captor.app/Contents/Resources/app.asar/dist/index.html",
	];
	it("grants audio only to the exact HUD document", () => {
		expect(
			isTrustedPrompterDocument("http://localhost:5173/?windowType=hud-overlay", bases, [
				"hud-overlay",
			]),
		).toBe(true);
		expect(
			isTrustedPrompterDocument(`${bases[1]}?windowType=hud-overlay`, bases, ["hud-overlay"]),
		).toBe(true);
		expect(
			isTrustedPrompterDocument("http://localhost:5173/?windowType=teleprompter", bases, [
				"hud-overlay",
			]),
		).toBe(false);
	});
	it("keeps existing editor dev and smoke URLs usable without granting media access", () => {
		const url = "http://localhost:5173/?windowType=editor&smokeExport=1&smokeInput=fixture.mp4";
		expect(isTrustedPrompterDocument(url, bases, ["editor"])).toBe(true);
		expect(isTrustedPrompterDocument(url, bases, ["hud-overlay"])).toBe(false);
	});
	it.each([
		"https://example.com/?windowType=hud-overlay",
		"http://localhost:9999/?windowType=hud-overlay",
		"http://user:password@localhost:5173/?windowType=hud-overlay",
		"http://localhost:5173/other?windowType=hud-overlay",
		"http://localhost:5173/?windowType=hud-overlay&windowType=editor",
		"file:///tmp/index.html?windowType=hud-overlay",
	])("rejects %s", (url) =>
		expect(isTrustedPrompterDocument(url, bases, ["hud-overlay"])).toBe(false));
});
