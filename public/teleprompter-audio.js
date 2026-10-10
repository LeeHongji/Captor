/* 80 ms PCM batches. Web Audio resamples the source to the context's 16 kHz. */
class TeleprompterAudio extends globalThis.AudioWorkletProcessor {
	constructor() {
		super();
		this.samples = new Float32Array(1280);
		this.offset = 0;
	}
	process(inputs) {
		const channels = inputs[0];
		if (!channels?.length) return true;
		for (let i = 0; i < channels[0].length; i++) {
			let sample = 0;
			for (const channel of channels) sample += channel[i];
			this.samples[this.offset++] = sample / channels.length;
			if (this.offset === this.samples.length) {
				this.port.postMessage(this.samples, [this.samples.buffer]);
				this.samples = new Float32Array(1280);
				this.offset = 0;
			}
		}
		return true;
	}
}
globalThis.registerProcessor("captor-teleprompter", TeleprompterAudio);
