// Runs in Electron's utility process. The GUI process never decodes audio.
const path = require("node:path");
const { createRequire } = require("node:module");
let recognizer;
let stream;
let port;
try {
	const requireFromApp = createRequire(path.join(process.argv[2], "package.json"));
	const sherpa = requireFromApp("sherpa-onnx-node");
	const directory = process.argv[3];
	recognizer = new sherpa.OnlineRecognizer({
		featConfig: { sampleRate: 16000, featureDim: 80 },
		modelConfig: {
			transducer: {
				encoder: path.join(directory, "encoder-epoch-99-avg-1.int8.onnx"),
				decoder: path.join(directory, "decoder-epoch-99-avg-1.onnx"),
				joiner: path.join(directory, "joiner-epoch-99-avg-1.int8.onnx"),
			},
			tokens: path.join(directory, "tokens.txt"),
			numThreads: 2,
			provider: "cpu",
			debug: false,
		},
		decodingMethod: "greedy_search",
		enableEndpoint: true,
		rule1MinTrailingSilence: 2.4,
		rule2MinTrailingSilence: 0.8,
		rule3MinUtteranceLength: 20,
	});
	stream = recognizer.createStream();
	process.parentPort.postMessage({ type: "ready" });
} catch (error) {
	process.parentPort.postMessage({ type: "error", error: String(error) });
}
process.parentPort.on("message", (event) => {
	if (!event.ports.length || !recognizer) return;
	port = event.ports[0];
	port.on("message", ({ data }) => {
		try {
			if (data.type === "reset") {
				recognizer.reset(stream);
				port.postMessage({ type: "reset" });
				return;
			}
			const samples =
				data.samples instanceof Float32Array
					? data.samples
					: new Float32Array(data.samples);
			stream.acceptWaveform({ samples, sampleRate: data.sampleRate });
			while (recognizer.isReady(stream)) recognizer.decode(stream);
			const result = recognizer.getResult(stream);
			const final = recognizer.isEndpoint(stream);
			port.postMessage({ type: "result", text: result.text, final });
			if (final) recognizer.reset(stream);
			port.postMessage({ type: "ack", seconds: samples.length / data.sampleRate });
		} catch (error) {
			port.postMessage({ type: "error", error: String(error) });
		}
	});
	port.start();
});
