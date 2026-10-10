# Recording preparation and local voice following

Captor keeps direct recording available. **Prepare narration** opens one current draft in the local dashboard; **Record new** and **Skip preparation and record** explicitly disarm the draft. A draft is not a `.captor` project and does not generate captions.

The current draft and display settings are stored in `recording-draft.json` under Electron's user-data directory, using the existing atomic-write and backup mechanism. Input autosaves after 500 ms and is flushed before starting a prepared recording or closing its editor. A failed save retains the input and blocks starting a prepared recording. Rehearsal and cancellation retain the draft.

## Prompt window

The separate, draggable prompt window displays Chinese characters and Latin words at their original text offsets. Click a word or use the previous/next controls to re-anchor. Only a bounded slice of a long script is rendered. Font size, width and background opacity are independent of capture exclusion. Text and capture visibility are locked during recording. Closing the prompt hides it; its native window ID stays stable for the capture filter.

Hide-from-recording defaults on. Windows uses content protection. Captor's macOS ScreenCaptureKit filter preserves the existing whole-process exclusion when the HUD is hidden, with an exception when the prompt should be captured; otherwise it excludes the prompt window alone. This applies to Captor recordings, not every third-party capture application. Linux exposes ordinary prompting without promising capture exclusion.

## Local speech

`sherpa-onnx-node` 1.13.8 runs in an Electron utility process. The Chinese/English streaming Zipformer model is downloaded on demand from the pinned revision `98590b7ed6443e77b714204da2757d75e1a642f4` of [the upstream model](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20). Downloads are size- and SHA-256-verified before a ready manifest is written. Model content is reverified on first status inspection and when file size/mtime changes, with a cached signature to avoid repeated full reads. Model replacement is blocked while recognition or capture is active. No account, API key, Python installation, or hosted recognition service is used. Model files remain local after the first download.

Prepared recording warms the recognizer before the countdown. Rehearsal and recording share one browser microphone source through independently owned stream clones. Guided native capture records microphone audio through the existing browser sidecar path, preserving its offset, pause handling and post-processing. The microphone recording toggle controls whether voice is saved; following still needs microphone permission when recording audio is off.

Pausing stops audio delivery and resets the recognizer while retaining the model. New consumers receive new session tokens, so late cleanup cannot stop another consumer. Manual re-anchoring ignores queued results until reset is acknowledged. Startup failure, device disconnection, or more than two seconds of pending inference leaves manual prompting available and does not stop the recording.

The matcher prioritizes nearby tokens and requires independent confirmation for unique remote relocation. Silence, unrelated speech and ambiguous repeated remote text hold position. Recognition partials are not persisted or turned into caption timings.

## Attribution and licensing

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), its Node runtime and the selected model use Apache-2.0.
- The nearby-match and confirmed-relocation mechanisms were informed by [CueFlow](https://github.com/binghe1980/cueflow) (MIT). Captor's matcher is implemented in TypeScript.
- The existing Captor license and Recordly attribution remain unchanged.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run i18n:check`, and the relevant `npm run test:ui` cases, including `tests/ui/teleprompter.spec.ts`. Exercise a normal Electron startup for actual speech, pause/resume, capture exclusion, companion audio and exports. Browser tests use a mocked bridge and do not establish native capture or speech accuracy. Package checks use `--publish never`.
