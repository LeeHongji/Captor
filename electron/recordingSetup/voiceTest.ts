import path from "node:path";
import { randomUUID } from "node:crypto";
import {
	app,
	MessageChannelMain,
	utilityProcess,
	type WebContents,
	type UtilityProcess,
	type MessagePortMain,
} from "electron";
import { PrompterAlignment } from "../../src/lib/prompterAlignment";
import type { SetupVoiceResult } from "../../src/types/recordingSetup";
import { SETUP_VOICE_TEST_SCRIPTS } from "../../src/types/recordingSetup";

interface VoiceTest {
	session: string;
	owner: WebContents;
	child: UtilityProcess;
	port: MessagePortMain | null;
	pending: number;
	cancel?: () => void;
	cleanup?: () => void;
}
let test: VoiceTest | null = null;
export function stopSetupVoiceTest(ownerId?: number, session?: string) {
	if (
		!test ||
		(ownerId !== undefined && test.owner.id !== ownerId) ||
		(session !== undefined && test.session !== session)
	)
		return;
	const previous = test;
	test = null;
	previous.cancel?.();
	previous.cleanup?.();
	previous.port?.close();
	previous.child.kill();
}
export function hasSetupVoiceTest() {
	return test !== null;
}
export async function startSetupVoiceTest(owner: WebContents, language: "zh" | "en") {
	if (test) throw Error("voice-test-active");
	const child = utilityProcess.fork(
		path.join(app.getAppPath(), "electron", "teleprompter", "recognizer.cjs"),
		[app.getAppPath(), path.join(app.getPath("userData"), "prompter-model", "zipformer-zh-en")],
		{ stdio: "ignore", serviceName: "Captor setup voice test" },
	);
	const session = randomUUID();
	const current: VoiceTest = { session, owner, child, port: null, pending: 0 };
	test = current;
	const matcher = new PrompterAlignment(SETUP_VOICE_TEST_SCRIPTS[language]);
	const send = (result: Omit<SetupVoiceResult, "session">) => {
		if (!owner.isDestroyed()) owner.send("setup:voice-result", { ...result, session });
	};
	const stop = () => stopSetupVoiceTest(owner.id, session);
	owner.once("destroyed", stop);
	owner.once("did-start-navigation", stop);
	current.cleanup = () => {
		owner.removeListener("destroyed", stop);
		owner.removeListener("did-start-navigation", stop);
	};
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		current.cancel = () => {
			clearTimeout(timer);
			if (!settled) reject(Error("voice-test-cancelled"));
			settled = true;
		};
		const fail = (error: string) => {
			clearTimeout(timer);
			if (test !== current) return;
			send({ text: "", cursor: 0, error });
			if (!settled) reject(Error(error));
			settled = true;
			stopSetupVoiceTest(owner.id, session);
		};
		const timer = setTimeout(() => fail("voice-start-timeout"), 20_000);
		child.on("exit", () => fail("voice-engine-stopped"));
		child.on("message", (message) => {
			if (test !== current) return;
			if (message.type === "error") {
				fail("voice-engine-unavailable");
				return;
			}
			if (message.type !== "ready" || settled) return;
			settled = true;
			clearTimeout(timer);
			const channel = new MessageChannelMain();
			current.port = channel.port1;
			channel.port1.on("message", ({ data }) => {
				if (test !== current) return;
				if (data.type === "ack")
					current.pending = Math.max(0, current.pending - data.seconds);
				else if (data.type === "error") fail("voice-engine-unavailable");
				else if (data.type === "result" && typeof data.text === "string") {
					send({ text: data.text, cursor: matcher.consume(data.text).cursor });
					if (data.final) matcher.beginUtterance();
				}
			});
			channel.port1.start();
			child.postMessage({ type: "audio-port" }, [channel.port2]);
			resolve();
		});
	});
	return { session };
}
export function pushSetupVoiceAudio(ownerId: number, session: unknown, samples: unknown) {
	if (!test || test.owner.id !== ownerId || test.session !== session || !test.port) return;
	if (
		!(samples instanceof Float32Array) ||
		samples.length > 8000 ||
		!samples.every(Number.isFinite)
	)
		return;
	test.pending += samples.length / 16000;
	if (test.pending > 2) {
		if (!test.owner.isDestroyed())
			test.owner.send("setup:voice-result", {
				session: test.session,
				text: "",
				cursor: 0,
				error: "voice-too-slow",
			});
		stopSetupVoiceTest();
		return;
	}
	test.port.postMessage({ samples, sampleRate: 16000 });
}
