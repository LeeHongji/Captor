import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadFileWithProgress } from "../ipc/captions/whisper";
import type { PrompterModelStatus } from "../../src/types/teleprompter";

export const PROMPTER_MODEL_REVISION = "98590b7ed6443e77b714204da2757d75e1a642f4";
const modelBase = `https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/resolve/${PROMPTER_MODEL_REVISION}`;
export const PROMPTER_MODEL_FILES = [
	{
		name: "encoder-epoch-99-avg-1.int8.onnx",
		bytes: 181895032,
		sha256: "8fa764187a261844f859d7143ebaa563af5d10adfece4c18a8f414c88cba2a9b",
	},
	{
		name: "decoder-epoch-99-avg-1.onnx",
		bytes: 13876452,
		sha256: "2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d",
	},
	{
		name: "joiner-epoch-99-avg-1.int8.onnx",
		bytes: 3228404,
		sha256: "1ed689c5ed19dbaa725d9d191bb4822b5f4855a39e1ffd28cbc1f340d25b2ee0",
	},
	{
		name: "tokens.txt",
		bytes: 56317,
		sha256: "a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3",
	},
];

export async function sha256ModelFile(filePath: string) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

export function createPrompterModelStore(
	directory: string,
	notify: (status: PrompterModelStatus) => void,
) {
	let downloading: Promise<PrompterModelStatus> | null = null;
	let state: PrompterModelStatus = {
		exists: false,
		downloading: false,
		progress: 0,
		error: null,
	};
	const manifest = path.join(directory, "ready.json");
	let verifiedSignature = "";
	const status = async () => {
		if (downloading) return state;
		try {
			const ready = JSON.parse(await fs.readFile(manifest, "utf8"));
			const stats = await Promise.all(
				PROMPTER_MODEL_FILES.map((file) => fs.stat(path.join(directory, file.name))),
			);
			state.exists =
				ready.revision === PROMPTER_MODEL_REVISION &&
				stats.every((stat, i) => stat.size === PROMPTER_MODEL_FILES[i].bytes);
			if (state.exists) {
				const signature = JSON.stringify(stats.map((stat) => [stat.size, stat.mtimeMs]));
				if (signature !== verifiedSignature) {
					for (const file of PROMPTER_MODEL_FILES) {
						if (
							(await sha256ModelFile(path.join(directory, file.name))) !== file.sha256
						) {
							state.exists = false;
							state.error =
								"Local model integrity check failed. Download the model again.";
							break;
						}
					}
					if (state.exists) {
						verifiedSignature = signature;
						state.error = null;
					}
				}
			}
		} catch {
			state.exists = false;
		}
		return { ...state };
	};
	return {
		status,
		download() {
			if (downloading) return downloading;
			downloading = (async () => {
				state = { exists: false, downloading: true, progress: 0, error: null };
				notify({ ...state });
				try {
					await fs.mkdir(directory, { recursive: true });
					const total = PROMPTER_MODEL_FILES.reduce((n, file) => n + file.bytes, 0);
					let completed = 0;
					for (const file of PROMPTER_MODEL_FILES) {
						const temporary = path.join(directory, `${file.name}.download`);
						try {
							await downloadFileWithProgress(
								`${modelBase}/${file.name}`,
								temporary,
								(progress) => {
									state.progress = Math.round(
										((completed + (file.bytes * progress) / 100) / total) * 100,
									);
									notify({ ...state });
								},
							);
							if (
								(await fs.stat(temporary)).size !== file.bytes ||
								(await sha256ModelFile(temporary)) !== file.sha256
							)
								throw new Error("Model integrity check failed.");
							await fs.rename(temporary, path.join(directory, file.name));
							completed += file.bytes;
						} finally {
							await fs.rm(temporary, { force: true });
						}
					}
					await fs.writeFile(
						manifest,
						JSON.stringify({ revision: PROMPTER_MODEL_REVISION }),
					);
					state = { exists: true, downloading: false, progress: 100, error: null };
				} catch (error) {
					state = {
						exists: false,
						downloading: false,
						progress: 0,
						error: String(error),
					};
				} finally {
					downloading = null;
				}
				notify({ ...state });
				return { ...state };
			})();
			return downloading;
		},
	};
}
