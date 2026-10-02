# QuickSpot

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

## Install

With mise activated in your shell and `just` available, from this checkout:

```sh
just setup
just install
```

Log out and back in so GNOME discovers the extension, then run:

```sh
just enable
just prefs
```

Log out and back in after updating a loaded extension to load its new panel code.
Opening preferences does not reload GNOME Shell.

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

## Uninstall

```sh
just uninstall
```

This stops and disables Soloist, then removes the extension. It preserves keyring
credentials, player data, the downloaded binary, and the disabled service definition.
Disabling the extension alone leaves the independent player service running. Stop
it from preferences or with `systemctl --user stop quickspot-soloist.service`.

## Development

The project uses native GJS ES modules without a transpilation step or npm runtime
dependencies. `justfile` defines project commands; run `just` to list them.

```sh
just ci
just test-live
just test-docs
just pack-check
just docs
```

`ci` runs ESLint and Ruff security rules, formatting checks, schema validation,
Node unit tests, Python installer and bundle tests, native GJS integration tests,
documentation browser checks in Chromium and Firefox,
secret scans of working files and Git history, and the build. Dependency checks can
be run with `mise exec -- npm audit --ignore-scripts`.

`setup` installs Chromium and Firefox for `test-docs`. The documentation suite
checks accessibility in both color schemes, mobile layout, keyboard navigation,
reduced motion, local assets, links, and project metadata. `docs` serves the static
site at `http://127.0.0.1:8000`; there is no documentation build step or JavaScript.

`test-live` uses temporary XDG directories, private D-Bus/dconf state, and a headless
GNOME Shell to test startup rollback, populated menus through disable/re-enable,
native GTK preferences, and command-line uninstall. It does not change your
desktop's enabled extensions. Both suites use local fixtures; actual Spotify
authorization, audible playback, discovery from another device, and stream quality
require a real account and manual verification.

`just build` writes `quickspot@napalm255.github.io.shell-extension.zip` at the
repository root, assembled
from an explicit runtime file allowlist using Python’s standard library.
`just install` builds and installs that ZIP for the current user. `just pack-check`
compares its files and contents with GNOME’s official packer and runs before
`just test-live`. See [AGENTS.md](AGENTS.md) for contribution
instructions. QuickSpot is [GPL-3.0-or-later](LICENSE); Soloist has separate upstream
terms and third-party notices.
