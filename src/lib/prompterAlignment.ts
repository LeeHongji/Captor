// Nearby matching and confirmed relocation follow the mechanisms in CueFlow
// (MIT, https://github.com/binghe1980/cueflow). No speech/audio is persisted here.
export interface ScriptToken {
	text: string;
	start: number;
	end: number;
}

export function tokenizeScript(text: string): ScriptToken[] {
	const tokens: ScriptToken[] = [];
	const pattern =
		/[\u3400-\u9fff\uf900-\ufaff]|[\p{Script=Latin}\p{N}]+(?:['’][\p{Script=Latin}\p{N}]+)*/gu;
	for (const match of text.matchAll(pattern)) {
		tokens.push({
			text: match[0].normalize("NFKC").toLowerCase(),
			start: match.index!,
			end: match.index! + match[0].length,
		});
	}
	return tokens;
}

function similar(a: string, b: string): boolean {
	if (a === b) return true;
	if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
	let i = 0,
		j = 0,
		edits = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			i++;
			j++;
			continue;
		}
		if (++edits > 1) return false;
		if (a.length >= b.length) i++;
		if (a.length <= b.length) j++;
	}
	return edits + a.length - i + b.length - j <= 1;
}

export class PrompterAlignment {
	readonly tokens: ScriptToken[];
	private position = 0;
	private previous = "";
	private pending: number | null = null;
	private candidates = new Map<string, number[]>();
	constructor(text: string) {
		this.tokens = tokenizeScript(text);
		this.tokens.forEach((token, i) => {
			const positions = this.candidates.get(token.text) ?? [];
			positions.push(i);
			this.candidates.set(token.text, positions);
		});
	}
	jump(offset: number) {
		this.position = this.tokens.findIndex((token) => token.end > offset);
		if (this.position < 0) this.position = this.tokens.length;
		this.beginUtterance();
	}
	beginUtterance() {
		this.previous = "";
		this.pending = null;
	}
	get cursor() {
		return this.position ? this.tokens[this.position - 1].end : 0;
	}
	consume(text: string): { cursor: number; matched: boolean } {
		if (!text || text === this.previous) return { cursor: this.cursor, matched: false };
		const revising = !!this.previous && this.previous.startsWith(text);
		this.previous = text;
		const tail = tokenizeScript(text)
			.slice(-12)
			.map((token) => token.text);
		if (!tail.length) return { cursor: this.cursor, matched: false };
		const score = (end: number) => {
			let s = end,
				t = tail.length - 1,
				count = 0,
				gaps = 0;
			while (s >= 0 && t >= 0) {
				if (similar(this.tokens[s].text, tail[t])) {
					count++;
					s--;
					t--;
				} else if (++gaps <= 2) s--;
				else break;
			}
			return count;
		};
		let best = -1,
			bestScore = 0;
		for (
			let i = Math.max(0, this.position - 1);
			i < Math.min(this.tokens.length, this.position + 48);
			i++
		) {
			if (!similar(this.tokens[i].text, tail[tail.length - 1])) continue;
			const value = score(i);
			if (value > bestScore) {
				best = i;
				bestScore = value;
			}
		}
		const required = best - this.position > 12 ? 4 : Math.min(3, tail.length);
		if (
			best >= 0 &&
			best - this.position <= 12 &&
			bestScore >= required &&
			(tail.length >= 2 || best === this.position)
		) {
			this.position = best + 1;
			this.pending = null;
			return { cursor: this.cursor, matched: true };
		}
		// Only search indexed candidate ends on loss of tracking, not the whole
		// script on every audio frame. Repeated remote phrases remain ambiguous.
		const remote = (this.candidates.get(tail[tail.length - 1]) ?? []).filter(
			(i) => score(i) >= Math.max(5, tail.length - 2),
		);
		if (remote.length === 1 && !revising && tail.length >= 5) {
			const end = remote[0] + 1;
			if (this.pending !== null && end >= this.pending && end - this.pending <= 12) {
				this.position = end;
				this.pending = null;
				return { cursor: this.cursor, matched: true };
			}
			this.pending = end;
		} else this.pending = null;
		return { cursor: this.cursor, matched: false };
	}
}
