import { spawn } from "node:child_process";
import type { WebContents } from "electron";
import { getPrebundledNativeHelperPath } from "../ipc/paths/binaries";

// Use the same helper as recordings. This probe neither stores events nor requests permissions.
let cancel: (() => void) | null = null;
export function hasSetupMouseTest() {
	return cancel !== null;
}
export function stopSetupMouseTest() {
	cancel?.();
}
export function testSetupMouse(owner: WebContents): Promise<boolean> {
	if (cancel) throw Error("mouse-test-active");
	return new Promise((resolve) => {
		const child = spawn(getPrebundledNativeHelperPath("captor-native-cursor-monitor"), [], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let settled = false;
		const finish = (success = false) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			owner.removeListener("destroyed", stop);
			owner.removeListener("did-start-navigation", stop);
			cancel = null;
			child.kill();
			resolve(success);
		};
		const stop = () => finish();
		cancel = stop;
		const timer = setTimeout(stop, 10_000);
		owner.once("destroyed", stop);
		owner.once("did-start-navigation", stop);
		let buffer = "";
		child.stdout.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			if (lines.some((line) => /^INTERACTION:mousedown:[123]$/.test(line))) finish(true);
		});
		child.stderr.on("data", (data: Buffer) => {
			if (data.toString().includes("event tap unavailable")) finish();
		});
		child.once("error", stop);
		child.once("close", stop);
	});
}
