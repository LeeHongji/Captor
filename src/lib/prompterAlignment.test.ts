import { describe, expect, it } from "vitest";
import { PrompterAlignment, tokenizeScript } from "./prompterAlignment";

describe("script alignment", () => {
	it("maps mixed Chinese / English and emoji to original UTF-16 offsets", () => {
		const text = "🎬 大家好，Captor开始录制。";
		const tokens = tokenizeScript(text);
		expect(tokens.map((token) => text.slice(token.start, token.end))).toEqual([
			"大",
			"家",
			"好",
			"Captor",
			"开",
			"始",
			"录",
			"制",
		]);
	});
	it("follows Chinese partials and holds on silence and unrelated speech", () => {
		const align = new PrompterAlignment("大家好，今天介绍录屏软件。");
		expect(align.consume("大家好").cursor).toBe(3);
		expect(align.consume("").cursor).toBe(3);
		expect(align.consume("请问午饭吃什么").cursor).toBe(3);
		expect(align.consume("今天介绍").cursor).toBe(8);
	});
	it("does not reinterpret a repeated partial as another occurrence", () => {
		const align = new PrompterAlignment("大家好大家好大家好");
		expect(align.consume("大家好").cursor).toBe(3);
		expect(align.consume("大家好").cursor).toBe(3);
		expect(align.consume("大家好大家").cursor).toBe(5);
	});
	it("accepts filler and a skipped word while keeping source offsets", () => {
		const align = new PrompterAlignment("Hello everyone welcome to our new screen recorder");
		expect(align.consume("hello everyone welcome our new screen recorder").cursor).toBe(49);
	});
	it("requires fresh consistent hypotheses to relocate outside the nearby range", () => {
		const text = "one two three " + "noise ".repeat(70) + "welcome to our new recorder today";
		const align = new PrompterAlignment(text);
		align.consume("one two three");
		expect(align.consume("welcome to our new recorder").cursor).toBe(13);
		expect(align.consume("welcome to our new recorder").cursor).toBe(13);
		expect(align.consume("welcome to our new recorder today").cursor).toBe(text.length);
	});
	it("recovers a deliberate reread after independent confirmation", () => {
		const text = "welcome to our new recorder today " + "next ".repeat(70);
		const align = new PrompterAlignment(text);
		align.jump(text.length);
		align.consume("welcome to our new recorder");
		expect(align.consume("welcome to our new recorder today").cursor).toBe(33);
	});
	it("does not jump to ambiguous repeated remote paragraphs", () => {
		const phrase = "welcome to our new recorder today ";
		const text = phrase + "noise ".repeat(70) + phrase;
		const align = new PrompterAlignment(text);
		align.jump(250);
		align.consume("welcome to our new recorder");
		expect(align.consume("welcome to our new recorder today").matched).toBe(false);
	});
});
