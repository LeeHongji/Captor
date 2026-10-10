import { describe, expect, it } from "vitest";
import { getPrompterCaptureExclusions } from "./prompterCapture";
describe("independent HUD / prompter capture visibility", () => {
	it.each([
		[true, true, [], []],
		[true, false, [17], []],
		[false, true, [], [17]],
		[false, false, [], []],
	])("HUD hidden=%s prompter hidden=%s", (hud, hidden, included, excluded) => {
		expect(
			getPrompterCaptureExclusions(hud as boolean, { id: 17, hidden: hidden as boolean }),
		).toEqual({ includedWindowIds: included, excludedWindowIds: excluded });
	});
	it("preserves the capture policy without a prompter", () => {
		expect(getPrompterCaptureExclusions(true, null)).toEqual({
			includedWindowIds: [],
			excludedWindowIds: [],
		});
	});
});
