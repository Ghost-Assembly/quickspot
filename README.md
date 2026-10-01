# QuickSpot

Spotify in the GNOME panel, powered by Spotify Soloist. Part of the
[Ghost Assembly](https://github.com/Ghost-Assembly) family.

QuickSpot targets **GNOME Shell 50**. It provides now playing information,
play/pause, previous/next, device activation, Liked Songs, an automatically loaded playlist
menu, a Discover Weekly shortcut, and an action to open Spotify in your default
browser. Preferences can install or update the official Soloist binary and manage
its user service.

## Audio quality

[Soloist supports lossless audio up to 24-bit/44.1 kHz with Premium](https://github.com/spotify/soloist).
However, its current [CLI](https://developer.spotify.com/documentation/soloist/reference/command-line)
and [WebSocket API](https://developer.spotify.com/documentation/soloist/reference/websocket-api)
provide no audio quality control or active bitrate report. QuickSpot cannot set a
lossless default or offer a working bitrate selector through those interfaces.

Select QuickSpot in the Spotify app's Connect device menu, then choose
**Change quality settings → Lossless**. You can choose other quality levels there.
See [Spotify's Connect guide](https://support.spotify.com/us/article/spotify-connect/).
QuickSpot does not label playback as lossless without evidence from the player.

## Install and connect

Requires GNOME 50, GJS, libsecret, libsoup 3, GTK 4, libadwaita, Python 3.12 or newer,
a graphical systemd user session, and PipeWire or PulseAudio. These GNOME libraries
are host packages; development tooling is managed by mise.

1. Run `mise install`, `mise exec -- just setup`, and `mise exec -- just install`.
2. Log out and back in so GNOME discovers the new extension. Run `just enable`,
   then `just prefs`. After updating a loaded extension, log out and back in again
   to load its new panel code; opening preferences alone does not reload GNOME Shell.
3. On the **Player** page, choose **Install** and save your own
   [Soloist API key](https://developer.spotify.com/dashboard/soloist). You can import
   an `.env` file containing `SPOTIFY_SOLOIST_KEY` instead. Choose **Start**.
   The same control becomes **Stop** while the service is running.
4. Wait for **Ready to pair**, then open Spotify on your phone or desktop on the
   same local network. Play something, open the device menu, and select **QuickSpot**
   (or the device name you saved). The web player cannot discover an unpaired
   local speaker. The status changes when pairing succeeds.
5. To play Liked Songs or browse saved playlists, open the **Library** page. In your
   [Spotify developer app](https://developer.spotify.com/dashboard), register
   `http://127.0.0.1:43821/callback` as its redirect URI, enter your client ID, and choose
   **Connect**. Keep preferences open to finish authorization, or choose **Cancel**.
   An `.env` import also accepts `SPOTIFY_CLIENT_ID`. No client secret is needed.
   Development-mode apps must allow your Spotify account.
   Connect the same account you paired with the speaker. **Liked Songs** resolves
   that account's playable collection; Spotify's `spotify:collection:tracks` app
   navigation URI is not accepted by Soloist's playback API.
6. Save **Discover Weekly** to your Spotify library once. QuickSpot detects it
   automatically when it loads your playlists. **Library → Discover Weekly** shows
   whether it was found and has a **Refresh** button. No playlist URL is required.
   For a localized name or a playlist absent from the API response, expand
   **Manual override (optional)**. **Use automatic** removes an existing override.

For this checkout, `mise exec -- just import-credentials` imports the local `.env`
without printing credential values. The extension ZIP excludes that file.

Preferences show the installed Soloist version, service state, saved-key presence,
local API connection, and pairing state. **Start at login** is a switch that reflects
systemd's actual configuration. Saving a device name or API key restarts a running
player to apply it. Updating restores a previously running player even if the
download fails or preferences close.

The top bar shows the active artist and song. The player service exports MPRIS
media controls so desktop play/pause, previous/next keys, and QuickMusic can control
QuickSpot. Playing from QuickSpot activates this speaker before sending playback.
Media controls remain available when the panel extension is disabled while the
player service is running and paired.

The panel's **Shuffle** menu controls ordinary shuffle and follows the actual player
state, including changes from Spotify. **Smart Shuffle in Spotify…** opens Spotify;
select this speaker and enable Smart Shuffle there. QuickSpot displays Smart Shuffle
when Soloist reports shuffle with recommendation enhancement. Soloist's current
[local API](https://developer.spotify.com/documentation/soloist/reference/websocket-api)
provides an on/off shuffle command but no Smart Shuffle activation command. Desktop
media clients can also read and change ordinary shuffle through MPRIS.

## Device missing from Spotify

Run `mise exec -- just doctor`. It reports installation, service, saved-key presence,
local API readiness, and pairing without printing credentials or account information.
**Service: active** alone does not mean that pairing or audio playback works.

For first pairing, use the phone or desktop app, with both devices on the same
local network. [Spotify's Connect troubleshooting](https://support.spotify.com/us/article/spotify-connect/)
explains why the web player only shows devices you have already logged into.
On iOS, allow Spotify access to the local network. Guest Wi-Fi, client isolation,
and VPN routing can prevent devices from discovering one another.

Soloist advertises `_spotify-connect._tcp` over multicast DNS (UDP 5353) and uses
a dynamic TCP port for pairing. The local WebSocket port is separate and stays on
loopback. A network must allow the advertised pairing port and mDNS; check the
current firewall configuration instead of disabling it. **Device missing from Spotify?**
in preferences summarizes these checks.

Use `just logs` for extension logs and `just logs-player` for the launcher.
The launcher deliberately avoids raw Soloist logs because they can contain credentials.

## Uninstall and recovery

To stop Soloist, disable its automatic startup, and uninstall QuickSpot:

```sh
mise exec -- just uninstall
```

If Extensions Manager will not open, remove the extension directly without
opening any graphical app:

```sh
gnome-extensions disable quickspot@napalm255.github.io
gnome-extensions uninstall quickspot@napalm255.github.io
```

The two GNOME commands remove the extension only. If you installed Soloist,
stop and disable it with `systemctl --user disable --now quickspot-soloist.service`.
Uninstalling preserves saved credentials, player data, downloaded binaries, and
the disabled service definition.

If Extensions Manager still exits with a Wayland protocol error after removal,
try launching it with GTK's software renderer:

```sh
flatpak run --env=GSK_RENDERER=cairo com.mattjakeman.ExtensionManager
```

This changes rendering for that launch only. A protocol error can occur
independently of QuickSpot; uninstalling an extension does not necessarily fix it.

The optional playlist connection uses Spotify's
[Authorization Code with PKCE flow](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
with `playlist-read-private` and `playlist-read-collaborative`. It follows pagination,
refreshes expired tokens, and respects API rate limits. The saved library belongs
to the account you authorize; Soloist can be paired to a different Connect account.

## Local storage and service

API keys and OAuth tokens are stored in **GNOME Keyring**, never in GSettings,
service files, or the extension bundle. Soloist requires an API key argument at
startup, so the key is visible to processes allowed to inspect its command line.
The launcher silences Soloist output to prevent credentials or account data from
reaching the journal; it logs fixed failure messages instead.

- Binary and upstream license notices: `$XDG_DATA_HOME/quickspot/`.
- Persistent device identity and pairing: `$XDG_DATA_HOME/quickspot/player/`.
- Audio cache, limited to 1 GiB: `$XDG_CACHE_HOME/quickspot/`.
- User service: `$XDG_CONFIG_HOME/systemd/user/quickspot-soloist.service`.

The installer downloads directly from Spotify over HTTPS, validates archive members,
and replaces the binary after a version check. Spotify provides mutable download
URLs; this installer does not claim signature or independent checksum verification.
It supports x86_64, aarch64, and armv7l. No root privileges are needed. Soloist is
proprietary and is downloaded separately, never redistributed with QuickSpot.

The local WebSocket binds to `127.0.0.1` on a dynamically assigned port. Disabling
the extension releases its sockets and UI; the independent Soloist service keeps
playing. Stop Soloist in preferences or with
`systemctl --user stop quickspot-soloist.service`.

If a Soloist build expires, update it from preferences. To inspect launcher failures:
`journalctl --user -u quickspot-soloist.service`.

## Development and verification

`mise.toml` owns tool versions; `justfile` owns commands. This project uses native
GJS JavaScript modules to match GNOME's runtime and its sibling extensions without
a transpilation layer. There are no npm runtime dependencies.

```sh
mise exec -- just ci
mise exec -- just test-live
```

The offline suite tests input validation, archive safety, PKCE and OAuth callbacks,
playlist pagination, and native WebSocket events. `test-live` creates private XDG
directories and D-Bus/dconf state, checks failed startup cleanup and populated
playlist menus across enable/disable/re-enable in headless GNOME, exercises the
dynamic settings controls with native GTK and Adwaita, and verifies command-line uninstall.
It does not alter your desktop's enabled extensions.

Actual Spotify authorization, audio playback, and active stream quality need a
real account and a paired device. The offline suite cannot verify those.

Builds produce `dist/quickspot@napalm255.github.io.shell-extension.zip` from a
runtime file allowlist. This repository's license is GPL-3.0-or-later; Spotify
Soloist has separate upstream terms and third-party notices.

See [REVIEW.md](REVIEW.md) for the review findings and remaining upstream constraints.
