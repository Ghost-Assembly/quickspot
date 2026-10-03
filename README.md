# QuickSpot

<!-- quick-template:badges:start -->

[![CI](https://github.com/Ghost-Assembly/quickspot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Ghost-Assembly/quickspot/actions/workflows/ci.yml)
[![Security](https://github.com/Ghost-Assembly/quickspot/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Ghost-Assembly/quickspot/actions/workflows/security.yml)
[![Docs](https://img.shields.io/website?url=https%3A%2F%2Fghost-assembly.com%2Fquickspot%2F&label=docs)](https://ghost-assembly.com/quickspot/)
[![Release](https://img.shields.io/github/v/release/Ghost-Assembly/quickspot)](https://github.com/Ghost-Assembly/quickspot/releases/latest)
[![License](https://img.shields.io/github/license/Ghost-Assembly/quickspot)](https://github.com/Ghost-Assembly/quickspot/blob/main/LICENSE)
[![GNOME](https://img.shields.io/badge/GNOME-50-blue)](https://ghost-assembly.com/quickspot/#install)
[![Security issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickspot%26metricKeys%3Dsoftware_quality_security_issues&query=%24.component.measures%5B0%5D.value&label=Security+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickspot)
[![Reliability issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickspot%26metricKeys%3Dsoftware_quality_reliability_issues&query=%24.component.measures%5B0%5D.value&label=Reliability+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickspot)
[![Maintainability issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickspot%26metricKeys%3Dsoftware_quality_maintainability_issues&query=%24.component.measures%5B0%5D.value&label=Maintainability+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickspot)
[![Duplication](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickspot%26metricKeys%3Dduplicated_lines_density&query=%24.component.measures%5B0%5D.value&label=Duplication)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickspot)
[![Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickspot%26metricKeys%3Dcoverage&query=%24.component.measures%5B0%5D.value&label=Coverage)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickspot)
[![Sonar policy](https://github.com/Ghost-Assembly/quickspot/actions/workflows/sonar.yml/badge.svg?branch=main)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickspot)
<!-- quick-template:badges:end -->

A Spotify speaker and playback controls for **GNOME Shell 50**, powered by
[Spotify Soloist](https://developer.spotify.com/documentation/soloist). Part of
[Ghost Assembly](https://github.com/Ghost-Assembly).

QuickSpot shows the active artist and song in the top bar and provides play/pause,
previous/next, device activation, shuffle, Liked Songs, saved playlists, and named
playlist shortcuts. Preferences install or update Soloist and manage its systemd
user service. The service exports MPRIS controls for desktop media keys and other
media clients, even while the extension is disabled. When no track is available on
the active device, the top bar shows only the music icon.

**[Documentation →](https://ghost-assembly.com/quickspot/)** —
[player setup](https://ghost-assembly.com/quickspot/#player),
[playlist examples](https://ghost-assembly.com/quickspot/#library),
[troubleshooting](https://ghost-assembly.com/quickspot/#troubleshooting),
architecture, testing, and packaging.

## Requirements

- GNOME Shell 50 with GJS, libsecret, libsoup 3, GTK 4, and libadwaita.
- Python 3.12 or newer, a graphical systemd user session, and PipeWire or PulseAudio.
- A Spotify Premium account and your own Soloist API key.
- An x86_64, aarch64, or armv7l Linux system for the official Soloist download.
- [mise](https://mise.jdx.dev) for development tools and installation from source.

GNOME libraries come from the host. `mise.toml` pins development runtimes and tools;
Python development checks use the pinned interpreter.

## Player setup

On the **Player** page:

1. Choose **Install** and save your [Soloist API key](https://developer.spotify.com/dashboard/soloist).
2. Choose **Start** and wait for **Ready to pair**.
3. Open Spotify on your phone or desktop on the same local network, play something,
   and select **QuickSpot** in the device menu. The name can be changed in preferences.

First pairing requires the phone or desktop app; the web player cannot discover an
unpaired speaker. Preferences distinguish a running service, a connected local API,
and a paired speaker. **Stop** remains available while the player runs, including
when the keyring is locked. **Start at login** follows systemd's configuration.
Saving a device name or API key restarts a running player to apply it. An update
attempts to restore a previously running service even if downloading fails or the
preferences window closes.

## Playlists and Liked Songs

**Library → Playlist shortcuts** accepts a name and a playlist's 22-character ID,
Spotify link, or `spotify:playlist:…` URI. Select its saved name from the panel to
play it. Shortcuts work without a library login, including playlists such as
Discover Weekly that Spotify may omit from the library API. Add the same playlist
with a new name to rename it; choose **Remove** to delete its shortcut.

To browse saved playlists and play Liked Songs:

1. Create or use a [Spotify developer app](https://developer.spotify.com/dashboard)
   and register `http://127.0.0.1:43821/callback` as its redirect URI.
2. On the **Library** page, enter its client ID and choose **Connect**. Keep
   preferences open to finish browser authorization; **Cancel** stops the login.
3. Authorize the same account paired with the speaker. Liked Songs uses that
   account's collection; the library login and speaker pairing are separate.

No client secret is needed. Development-mode apps require the app owner to retain
Premium and allow the connecting account. New apps have limits of one client ID per
developer and five users; see [Spotify's development-mode requirements](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
Login uses PKCE with `playlist-read-private` and `playlist-read-collaborative`.
Playlist loading follows pagination, refreshes expired tokens, and observes rate limits.

Credentials can also be imported from an `.env` file containing
`SPOTIFY_SOLOIST_KEY` and/or `SPOTIFY_CLIENT_ID`. Use **Import credentials** in
preferences or `just import-credentials` for this checkout's `.env`.
The file is parsed as literal values and excluded from the extension bundle.

## Shuffle and audio quality

**Shuffle → On/Off** activates this speaker before changing ordinary shuffle.
QuickSpot follows changes made in Spotify and displays Smart Shuffle when reported
by Soloist. Enable Smart Shuffle in Spotify's phone app with this speaker selected;
Soloist's [local API](https://developer.spotify.com/documentation/soloist/reference/websocket-api)
does not expose a command to enable that mode.

Choose audio quality in Spotify with this device selected. Soloist's
[command line](https://developer.spotify.com/documentation/soloist/reference/command-line)
and local API do not expose quality controls or the active bitrate, so QuickSpot
cannot confirm that a stream is lossless.

## Troubleshooting

Run `just doctor` to check installation, service state, saved-key
presence, local API connectivity, and pairing without printing credentials or
account information. A running service alone does not confirm pairing or audible
playback. If Soloist has expired, choose **Update** in preferences.

For a missing speaker, use the phone or desktop app on the same local network.
Allow Spotify local-network access on iOS. Guest Wi-Fi, client isolation, and VPN
routing can prevent discovery. Soloist uses multicast DNS (UDP 5353) and a dynamic
TCP pairing port, separate from its loopback API. Check network and firewall rules;
see [Spotify Connect troubleshooting](https://support.spotify.com/us/article/spotify-connect/).

Use `just logs` for extension logs and `just logs-player`
for fixed launcher diagnostics. Raw Soloist output is silenced because it can
contain credentials and account information.

## Storage and security

API keys and OAuth tokens live in GNOME Keyring, outside GSettings, service files,
and the extension bundle. Playlist names, shortcut URIs, and the device name live
in GSettings. The following paths use the standard XDG defaults when unset:

| Data                                | Location                                                  |
| ----------------------------------- | --------------------------------------------------------- |
| Soloist binary and upstream notices | `$XDG_DATA_HOME/quickspot/`                               |
| Device identity and pairing         | `$XDG_DATA_HOME/quickspot/player/`                        |
| Audio cache, limited to 1 GiB       | `$XDG_CACHE_HOME/quickspot/`                              |
| User service                        | `$XDG_CONFIG_HOME/systemd/user/quickspot-soloist.service` |

Soloist requires its API key in process arguments; processes with sufficient
inspection access can see it. Its WebSocket API binds to `127.0.0.1` on a dynamic
port, but [upstream provides no authentication or Origin validation](https://developer.spotify.com/documentation/soloist/reference/websocket-api).
Loopback binding restricts network access without isolating the API from local
processes or browser code able to reach the port.

The installer bounds download and extracted sizes, rejects unsafe archive members,
restricts redirects to Spotify's HTTPS download origin, and checks the binary's
version response before replacing it. Downloads use mutable upstream URLs with no
independent signature or checksum verification; archive validation does not prove
authenticity beyond HTTPS. Soloist is downloaded separately and is never included
in QuickSpot's bundle.

## Install

<!-- quick-template:install:start -->

Requires GNOME Shell 50. Requires GJS, libsecret, libsoup 3, GTK 4, libadwaita, Python 3.12 or newer, a graphical systemd user session, PipeWire or PulseAudio, Spotify Premium, and your own Soloist API key. Official Soloist downloads support x86_64, aarch64, and armv7l Linux.

### From a release

Download the latest release ZIP and install it for your user. xh is a download tool; you can also download the ZIP from GitHub in a browser. Installing compiles the settings schema.

```sh
xh --download GET https://github.com/Ghost-Assembly/quickspot/releases/latest/download/quickspot@napalm255.github.io.shell-extension.zip
gnome-extensions install --force quickspot@napalm255.github.io.shell-extension.zip
```

Log out and back in so GNOME discovers the extension, then enable it:

```sh
gnome-extensions enable quickspot@napalm255.github.io
```

### From a clone

Install mise and activate it in your shell. Clone the repository, install its pinned tools, and build and install the same ZIP used for releases:

```sh
git clone https://github.com/Ghost-Assembly/quickspot.git
cd quickspot
mise install
mise exec -- just setup
mise exec -- just install
```

Log out and back in, then run just enable. Run just prefs to open preferences. After updating a loaded extension, start a new session to load its new code; opening preferences does not reload GNOME Shell.
<!-- quick-template:install:end -->

## Uninstall

<!-- quick-template:uninstall:start -->

Disable and uninstall the extension for your user. These commands preserve saved settings and other user data.

```sh
if systemctl --user cat quickspot-soloist.service >/dev/null 2>&1; then
    systemctl --user disable --now quickspot-soloist.service
fi
gnome-extensions disable quickspot@napalm255.github.io
gnome-extensions uninstall quickspot@napalm255.github.io
```

From a clone, just uninstall performs the same steps. Disabling with just disable leaves the extension installed.
<!-- quick-template:uninstall:end -->

This preserves keyring credentials, player data, the downloaded binary, and the disabled service definition. Disabling the extension alone leaves Soloist running.

## Testing

<!-- quick-template:testing:start -->

just test runs the JavaScript suite with Vitest, the shared tooling tests, and any project-specific offline suites. just coverage reports runtime JavaScript and Python tooling coverage, including untested files. Test stubs and generated reports are not runtime source.

just test-docs runs Playwright and axe in Chromium and Firefox: dark and light accessibility checks, keyboard navigation, mobile layout, reduced motion, links, metadata, local assets, and no page JavaScript. Automated accessibility checks still require human review of reading and focus order.

just test-live checks the package and runs isolated GNOME lifecycle checks. It is a separate local check, not proof of compatibility from a hosted runner. Verify each declared GNOME version and complete the project's manual checks before releasing.
<!-- quick-template:testing:end -->

### Project checks

Offline GJS and Python suites use temporary XDG paths and private buses. The isolated Shell and GTK checks cover startup rollback, populated menus across disable/re-enable, preferences, and command-line uninstall. Actual Spotify authorization, audible playback, discovery from another device, and audio quality require a real account and manual verification.

## Packaging

<!-- quick-template:packaging:start -->

```sh
just build
just pack-check
```

The output is quickspot@napalm255.github.io.shell-extension.zip at the repository root, with metadata.json at the archive root. Python's standard library packages the explicit runtimeFiles allowlist in quick-project.json, using stable file order and timestamps.

just pack-check compares both filenames and file contents with GNOME's official packer and validates shipped icons. Docs, tests, dependencies, credentials, downloaded binaries, and development artifacts stay outside the ZIP. Update the runtime allowlist when adding a runtime file.
<!-- quick-template:packaging:end -->

## Releasing

<!-- quick-template:releasing:start -->

Run just ci, just test-live, and the project manual checklist. Set metadata.json version-name and package.json version to the same new version. The GNOME Extensions website assigns the numeric metadata.json version during submission. Update the npm lockfile, regenerate the docs, and commit the reviewed changes to main through a passing pull request.

Create and push a v-prefixed tag for that version. The release workflow verifies the version, main ancestry, and successful required checks for the tagged commit, then attaches its tested ZIP to a GitHub release. It does not upload to extensions.gnome.org; that submission and its review remain manual.
<!-- quick-template:releasing:end -->

## Development

<!-- quick-template:development:start -->

mise.toml pins runtime and CLI versions; justfile owns commands; npm owns development dependencies and the lockfile. GNOME libraries come from the host. On image-based Fedora, use the host's available tools or a toolbox/distrobox for missing system packages; do not layer packages onto the OS.

```sh
just setup        # install pinned tools, dependencies, and browsers
just fmt          # format source and configuration
just lint         # verify template, generated docs, source, and schemas
just test         # JavaScript, Python, and project offline tests
just coverage     # report JavaScript and Python coverage without source exclusions
just test-docs    # Chromium and Firefox documentation checks
just security     # dependencies, secrets, and workflow checks
just build        # build the runtime-only extension ZIP
just pack-check   # compare files and contents with GNOME's packer
just ci           # complete local verification and packaging
just test-live    # isolated GNOME lifecycle and project integration checks
just docs         # serve the static site at localhost:8000
just template-check  # verify the pinned canonical template
just template-status # report a newer approved template revision
```

GitHub requires local verification, security analysis, and completed Sonar analysis. The shared Sonar policy requires zero security, reliability, and maintainability issues and zero duplicated lines. PR checks cover changed code; main checks cover the entire project. Missing configuration fails instead of silently skipping analysis. Pages publishes the tested docs only after the required checks pass on main.

Common tooling and these instructions are generated from a pinned canonical template. Change that source and synchronize its approved revision; do not edit generated sections or locally bless drift. Extension-specific behavior belongs in project configuration and project.just.
<!-- quick-template:development:end -->

## License

[GPL-3.0-or-later](LICENSE).
