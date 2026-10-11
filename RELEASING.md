# Releasing Captor

This repository now uses `electron-builder` + `electron-updater` for macOS, Windows, and Linux auto-updates.

For this Electron app, that is the right path instead of wiring Sparkle.framework directly. On macOS, `electron-updater` handles the release metadata and update flow that Sparkle would otherwise cover in a native app, while still sharing the same GitHub Releases pipeline used by Windows and Linux.

## Current distribution: manual macOS installation

Captor uses its own 0.0.x version line; the Recordly 1.4.0 snapshot is an upstream source baseline, not a Captor release version.

`package.json` sets `captorDistribution` to `manual`. macOS builds use the existing GitHub version checks but direct users to release installers instead of downloading or restarting automatically. Development builds retain their update guards. Public GitHub release reads require no user token.

Build a candidate from the intended branch:

```bash
gh workflow run build.yml --ref <branch> -f manual_release=v0.0.2
```

This dispatch calls `manual-macos-release.yml`, runs repository and UI checks, and builds on native Apple Silicon and Intel runners. It uses `electron-builder.manual.json5`: ad-hoc signing, no Developer ID certificate, no notarization, macOS 14+ and no automatic-update metadata. Candidate builds never publish unless `publish_manual=true` is explicitly passed. Both matrix jobs and the quality job must pass before release.

Download the `manual-macos-arm64` and `manual-macos-x64` artifacts from that exact run. Check both `source-sha.txt` files against the intended commit, validate each checksum file and inspect the DMG/ZIP verification reports. Publish only `Captor-<version>-arm64.dmg`, `Captor-<version>-x64.dmg` and a merged `SHA256SUMS.txt` covering those two installers. Do not upload `latest-mac.yml` or other automatic-update feeds for this lane.

To publish the verified source, dispatch the same branch with `-f manual_release=v0.0.2 -f publish_manual=true`. The publishing job waits for quality and both native packages, checks their source SHA, architecture reports and checksums, creates a draft, uploads both installers and checksums, and then publishes it. It uses the workflow GITHUB_TOKEN so release events do not invoke the separate signed-release workflow; see [GitHub token event rules](https://docs.github.com/en/actions/concepts/security/github_token). Existing releases are never overwritten. Publication atomically creates a new tag at the verified source SHA and refuses an existing tag; if a network interruption leaves a tag or draft behind, inspect the remote state before recovering that same release. The body must include `<!-- captor-distribution: manual -->`; this prevents the separate signed-release workflow from starting. Keep the tag, package, lockfile and release notes at the same version. Never replace an already published version with rebuilt binaries.

Install by dragging Captor into Applications. After the first blocked launch, use System Settings → Privacy & Security → Open Anyway for this app. Document that this build is not Developer ID signed or notarized. Updating requires saving, quitting and replacing the app; test project/settings retention and capture permissions after replacement. Managed Macs may prohibit this exception.

When certificates are ready, change `captorDistribution` to `signed`, use the signed candidate gates below and manually install the first signed version. Subsequent signed versions can use automatic updates. Preserve `dev.captor.app`, `.captor` compatibility and the production data directory throughout. If an installer has a defect, withdraw that release and publish a new patch; do not change user data or silently reuse a tag.

## Signed release workflow (after certificate setup)

When you publish a GitHub release tagged like `v1.2.3`, `.github/workflows/release.yml` will:

- validate that `package.json` is also `1.2.3`
- build signed macOS x64 and arm64 artifacts
- notarize the macOS builds
- merge the dual-architecture `latest-mac.yml` metadata into one release asset
- build and sign the Windows NSIS installer
- build the Linux AppImage
- publish installer artifacts and auto-update metadata files to the GitHub release
- keep distribution scoped to this repository; Homebrew and WinGet are not configured

The packaged app then checks GitHub Releases for:

- `latest-mac.yml`
- `latest.yml`
- `latest-linux.yml`

## Required GitHub secrets

### macOS signing and notarization

Set these repository secrets:

- `APPLE_SIGNING_CERTIFICATE_P12_BASE64`
- `APPLE_SIGNING_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

`APPLE_SIGNING_CERTIFICATE_P12_BASE64` must be a base64-encoded `.p12` export of a `Developer ID Application` certificate.

If the certificate you currently have is only `Apple Development`, that is not enough for public notarized releases and auto-update distribution. You need `Developer ID Application`.

To export and encode the certificate:

```bash
security export -k ~/Library/Keychains/login.keychain-db -t identities -f pkcs12 -P "YOUR_P12_PASSWORD" -o captor-mac-signing.p12
base64 < captor-mac-signing.p12 | pbcopy
```

Paste the copied base64 into `APPLE_SIGNING_CERTIFICATE_P12_BASE64` and the export password into `APPLE_SIGNING_CERTIFICATE_PASSWORD`.

### Windows signing

Set these repository secrets:

- `WINDOWS_SIGNING_CERTIFICATE_P12_BASE64`
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`

These should point to an Authenticode code-signing certificate exported as `.p12` and then base64-encoded.

### Homebrew tap automation

Set this repository secret if you want the cask PR to open automatically:

- `HOMEBREW_TAP_TOKEN`

Optional repository variables:

- `HOMEBREW_TAP_REPO`
- `HOMEBREW_TAP_AUTO_MERGE`

## Release flow

1. Bump `package.json` to the version you want to ship.
2. Commit and push that version.
3. Create a Git tag in the form `vX.Y.Z`.
4. Create and publish a GitHub release for that tag. Prefer the helper so custom notes are prepended while GitHub still generates the contributor section:

```bash
npm run release:create -- --tag v1.2.3 --title "v1.2.3" --notes-file ./release-notes.md
```

For prereleases:

```bash
npm run release:create -- --tag v1.2.0-beta.2 --title "v1.2.0 beta-2" --prerelease --notes-file ./release-notes.md
```

This uses `gh release create --generate-notes`, which keeps GitHub's generated change summary and contributor list instead of replacing it with a fully manual release body.

5. The `Publish Release` workflow builds, signs, notarizes, uploads, and publishes update metadata.

That is the normal path if you want “click new release and let CI do the rest.”

## Rebuilding an existing release

If you need to rerun publishing for an existing tag, use the manual dispatch for `.github/workflows/release.yml` and provide the existing tag.

## Notes

- macOS auto-updates require the `zip` target in addition to `dmg`, because `latest-mac.yml` is generated from the zipped build.
- macOS arm64 and x64 builds both publish updater zips, and the release workflow merges them into one `latest-mac.yml` so `electron-updater` can choose the correct architecture automatically.
- The release workflow publishes versioned artifact names so the generated update metadata matches the uploaded files.
- `build.yml` is intentionally forced to `--publish never` so ad hoc CI builds do not accidentally upload to a draft release.

## Captor distribution

Updates use GitHub Releases in `LeeHongji/Captor`. Publish installer/archive assets together with the generated `latest.yml`, `latest-mac.yml`, or `latest-linux.yml` metadata and blockmaps/checksums needed for the corresponding platform. macOS metadata must include both architectures when publishing both. Build and release workflows require an explicit dispatch or published Release; a source push to main does not publish a release. Homebrew and WinGet distribution are not configured. Never reuse the upstream Recordly feed or assets.
