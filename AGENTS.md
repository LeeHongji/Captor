# Captor development

Captor is a local screen recorder and editor. Recording, editing, project libraries, captions, and export must work without authentication or a hosted service.

- Keep export local. Preserve streamed temporary files, save retries, cancellation, subtitle sidecars, and project compatibility when changing export code.
- Feedback prepares a draft through `prepare-feedback-email`; only the fixed project support mailbox may be used. Encode subject/body, reject multiline subjects, and never claim an email was sent. Export-error details must remain allowlisted and must not include media, paths, or logs.
- Manual macOS releases must use the ad-hoc profile, preserve development update guards, publish both architecture DMGs and checksums, and omit automatic-update metadata. Keep the release marker `<!-- captor-distribution: manual -->`; never claim notarization for this lane. Regenerate all application icon mirrors from `branding/source-assets/Captor.svg` with `npm run icons:build`.
- Renderer IPC trust must include the exact running packaged renderer server URL alongside file and development URLs; never trust arbitrary loopback ports. Verify recording preparation with `scripts/smoke-packaged-prompter.mjs` on each packaged architecture, using an isolated user profile.
- GitHub updates and announcements belong to `LeeHongji/Captor`; retain development-build update guards. Optional model downloads and explicit external-link/email actions are allowed.
- Preserve the original license and Recordly attribution. `.ref/` is a read-only, ignored reference; `.tmp/`, credentials, dependencies, and generated test/build output must not be committed.
- Follow existing UI components and styling. Validate light/dark and compact layouts after changing navigation, dialogs, or export controls.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run i18n:check`, and relevant `npm run test:ui` cases. Verify real exports using normal Electron startup; instrumentation that omits WebCodecs is not evidence of a production export failure. Package checks must use `--publish never` unless an actual release was requested.
- Recording setup snapshots are passive: never request OS permissions, open System Settings, or reset TCC from startup, polling, or recording retries. Explicit requests and confirmed repairs use fixed Captor bundle identity and resource enums. Keep optional-device requirements consistent with actual recording choices, and keep completed setup trials across editor reloads.
- Ad-hoc manual releases must promote the same successful CI candidate files used for local acceptance; never substitute a local rebuild of the same version. Keep exact source-SHA, native-package verification, and checksum gates when promoting a prior run.
