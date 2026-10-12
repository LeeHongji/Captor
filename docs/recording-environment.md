# Recording environment setup

On macOS, the first launch opens a five-step recording setup. Check the installation and recordings folder, authorize screen and mouse access, choose and test devices, configure local voice following, then make a five-second test recording. Captor requests permissions only when you select an authorization button. Returning from System Settings refreshes the status silently.

Choose the microphone and camera you intend to use. Microphone recording and voice following are separate choices; voice following needs a microphone even when microphone audio is not saved into the recording. The local voice model supports Chinese and English, requires about 200 MB, and needs no account. Device and voice tests do not save audio. You can explicitly disable camera, microphone recording or voice following and use manual prompting.

The test recording is a real saved clip in the recordings folder. Select a screen or window in the HUD and press Record; it stops after five seconds. Play it in the setup preview before finishing. Existing projects can be opened through View projects first without completing recording setup.

## An enabled permission still fails

Open Settings → Check recording environment. First save current work, stop active recordings and device tests, and fully quit/reopen Captor. If access remains inactive, expand I already enabled this and confirm Reset this permission. Only that Captor permission is reset. Authorize the current Applications copy again and restart when macOS requires it. Projects, scripts, downloaded models and other applications' permissions remain intact.

Manual releases currently use ad-hoc signatures. Replacing the app with different build bytes can invalidate existing screen, Accessibility, microphone or camera authorization. Install the published release rather than switching between a local rebuild and the downloaded app under the same version. Captor records installation identity for rechecking; it cannot bypass macOS consent or make ad-hoc signatures stable between releases.


## Recorded audio

After stopping a macOS recording, Captor waits for camera and microphone files to finish saving and combines the original audio tracks into the MP4 before opening the editor. The MP4 plays independently with system and microphone audio when those features are enabled. The original sidecars remain available for separate track editing. Preview, export and recording append use the same original-track selection and capture timing, avoiding duplicate microphone playback. Concurrent completion requests share one task. Missing system tracks cannot be silently discarded while finalizing a microphone recording. A failed or cancelled audio finalization preserves the original files; quitting waits for pending finalization to cancel and clean up.
