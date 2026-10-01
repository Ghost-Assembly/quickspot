# QuickSpot review

Reviewed the extension lifecycle, preferences, player launcher, service integration,
Spotify/OAuth boundaries, credential handling, installer, packaging, and tests.
Compared commands and native Adwaita controls with QuickMusic, QuickClip, QuickRem,
QuickTS, and QuickTiler. No runtime dependencies were added.

## Fixed

- **Misleading readiness:** service startup was reported as success without checking
  installation, API connectivity, or pairing. A shared player controller now
  reports each state and polls for external changes. Stop remains available for
  a running player even when the keyring is locked.
- **Redundant controls:** separate Start/Stop and Enable/Disable rows are replaced
  by a dynamic player control and a Start at login switch. Install changes to
  Update or Repair. Preferences separate speaker setup from optional playlist login.
- **Discover Weekly setup:** automatic library detection now has a visible status
  and Refresh action in preferences. The manual URL field is an optional override;
  Use automatic clears it. Both panel and preferences share the same detection
  logic, including case and whitespace normalization. Spotify must return the
  saved playlist; a live check found no Discover Weekly in this account's list.
- **Shuffle:** the panel and MPRIS now expose ordinary shuffle control. The panel
  distinguishes Smart Shuffle using reported recommendation enhancement and follows
  remote option changes. Smart Shuffle activation remains in Spotify because the
  public Soloist API and installed CLI expose only shuffle on/off; the UI labels
  that handoff explicitly.
- **Invalid Liked Songs URI:** the earlier test only checked that a command was sent.
  A live reproduction showed that Soloist rejects `spotify:collection:tracks`.
  Liked Songs now resolves `spotify:user:<id>:collection` from the library account's
  profile. Connect the same account used for speaker pairing. Live playback with
  an account-specific collection produced track and playing events.
- **Missing desktop controls:** the service now exports MPRIS metadata and media
  commands, including play/pause, previous/next, and volume. This uses the same
  interface consumed by QuickMusic and remains independent of Shell's lifetime.
  Commands await acknowledgements, report rejections, and activate an inactive
  speaker before playing. Artist and song appear in the top bar.
- **Update interruption:** failed or canceled updates could leave playback stopped.
  Updates now restore a previously running service, including when preferences close.
- **Credential duplication and validation:** CLI and preferences imports share
  bounded, asynchronous reads. Both values are validated before either is saved.
  Soloist-only imports work without a developer client ID. Device names and keys
  use the same validation when saving and launching.
- **OAuth and request boundaries:** requests explicitly restrict their destination
  before attaching credentials. Callback paths and empty authorization codes are
  rejected; concurrent login is blocked. Login has a visible Cancel action. Late
  credential loading cannot overwrite a newly connected or disconnected state.
- **Subprocess lifetime:** helper operations have deadlines and cancel their child
  process. Raw upstream diagnostics do not reach the UI or journal.
- **Installer bounds:** the uncompressed size limit applies to the whole archive.
  Unsafe paths, links, unexpected members, and duplicate files remain rejected.
- **Lifecycle cleanup:** failed extension startup rolls back its resources; teardown
  releases menu references and state before another enable cycle.
- **Project commands:** added enable, disable, prefs, logs, logs-player, and doctor;
  run now opens a GNOME development window. Command identity comes from metadata.

## Verification and limits

Unit and native integration checks cover input boundaries, PKCE, callbacks, playlist
pagination, refresh concurrency, rejected request destinations, credential imports,
account-specific Liked Songs commands, activation ordering, command rejection,
real MPRIS calls on a private session bus, canceled-update recovery, and generated service validation.
Isolated GNOME tests exercise populated menus through re-enable, failed startup,
native dynamic settings clicks, error feedback, close cleanup, and uninstall.

On the local machine, Soloist 1.3.8.99 was installed, active, paired, and playing.
The loopback API connected and the local mDNS advertisement resolved. A live
account-specific collection command produced a playable track and playing events.
The installed service registered `org.mpris.MediaPlayer2.quickspot`; live MPRIS
PlayPause calls paused and resumed Soloist. The isolated GNOME test verified the
accessible artist/song label and its reset when this speaker becomes inactive.
These observations verify the playback state, not audibility or visibility from
another device; those require checking the audio output and Spotify app directly.

Dependency scans with npm audit and OSV found no known vulnerabilities. ESLint's
security rules, Ruff's security rules, schema checks, and the secret scan are part
of the local checks. No GitHub settings were changed.

## Upstream security constraints

- Soloist requires its API key in argv. The keyring and launcher keep it out of
  source, service files, and logs, but processes with sufficient inspection access
  can see it. [Upstream request for an alternative](https://github.com/spotify/soloist/issues/12).
- The [Soloist local API](https://developer.spotify.com/documentation/soloist/reference/websocket-api)
  has no authentication or Origin validation. Loopback binding limits network
  exposure; it does not establish isolation from local processes or browser code
  capable of reaching the port.
- Spotify's official downloads use mutable HTTPS URLs without an independently
  verified signature or checksum in this installer. Archive validation and the
  binary version check do not establish supply-chain authenticity beyond HTTPS.
- Soloist's active stream quality is not exposed by its local API. QuickSpot cannot
  verify or promise that current playback is lossless.
