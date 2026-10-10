interface MicrophoneSlot {
	key: string;
	users: number;
	stream: Promise<MediaStream>;
}
let slot: MicrophoneSlot | null = null;

/** Each consumer owns a clone; releasing the prompter never stops recording. */
export async function acquireRecordingMicrophone(constraints: MediaStreamConstraints) {
	const key = JSON.stringify(constraints);
	if (slot && slot.key !== key)
		throw new Error("Stop microphone use before changing the input device.");
	if (!slot) slot = { key, users: 0, stream: navigator.mediaDevices.getUserMedia(constraints) };
	const acquired = slot;
	acquired.users++;
	let released = false;
	let clone: MediaStream | null = null;
	const release = () => {
		if (released) return;
		released = true;
		clone?.getTracks().forEach((track) => track.stop());
		if (--acquired.users === 0) {
			if (slot === acquired) slot = null;
			void acquired.stream
				.then((stream) => stream.getTracks().forEach((track) => track.stop()))
				.catch(() => undefined);
		}
	};
	try {
		clone = (await acquired.stream).clone();
		return { stream: clone, release };
	} catch (error) {
		release();
		throw error;
	}
}
