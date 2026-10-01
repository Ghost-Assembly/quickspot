# QuickSpot engineering instructions

QuickSpot is a GNOME Shell 50 extension with a separate Spotify Soloist systemd
user service. Use native GJS ES modules; keep GNOME Shell and GTK preferences
imports in their respective processes. Do not add a transpilation layer or npm
runtime dependencies without a concrete requirement.

## Code and boundaries

- `extension.js` owns the panel and menu; `prefs.js` owns GTK/Adwaita preferences.
- `modules/model.js` contains pure validation shared by GJS and Node tests.
- `modules/player.js` tracks installation, service, credentials, and playback as
  distinct states. `modules/soloist.js` owns the loopback WebSocket connection.
- `modules/spotify.js` owns Web API requests and PKCE login. Bind tokens to the
  client ID that issued them, restrict request destinations before adding tokens,
  and keep cancellation scoped to its login attempt.
- `scripts/soloist-runner.js` owns the player process and independent MPRIS bridge.
  Secrets belong in GNOME Keyring; never print upstream diagnostics, tokens, keys,
  account data, or track metadata in logs or test failure output.
- Treat network responses, saved settings, imported credentials, and downloaded
  archives as untrusted. Validate at the boundary and bound reads and extraction.
- Release signals, timers, sockets, subprocesses, and UI references on teardown.
  Guard asynchronous completions against closed windows and replaced clients.
  Preserve startup rollback and restoration of a running service after failed updates.
- Use native accessible controls with plain-text user content. Do not claim a
  running service is paired, or label a stream lossless without player evidence.

## Tools and verification

`mise.toml` owns tool versions; `justfile` owns commands; npm owns development
dependencies and `package-lock.json`. GNOME libraries come from the host. Python
helpers use the standard library and support Python 3.12 or newer at runtime.
Do not retrofit a second task runner or add Python packaging for these scripts.

- `just setup`: install tools and development dependencies.
- `just fmt`: format changes.
- `just ci`: lint, schemas, offline tests, docs, secrets, and build.
- `just test-docs`: documentation checks in Chromium and Firefox,
  also included in `ci`; `setup` installs both browsers.
- `just docs`: serve the static documentation site locally.
- `just pack-check`: compare the root ZIP with GNOME’s official packer.
- `just test-live`: packer comparison and isolated GNOME Shell/GTK checks.

Add behavior regressions for bugs, especially credentials, cancellation, archive
safety, service recovery, and lifecycle changes. Tests must use fixtures, temporary
XDG paths, and private session buses. Never use the real Spotify account, keyring,
player service, or desktop settings for automated tests. Run `test-live` when
changing panel or preferences behavior. Report actual results and any unverified
account, audio, network-discovery, or upstream behavior.

`scripts/build.py` packages only its runtime allowlist into the repository-root
ZIP, using Python’s standard library. `just install` builds and installs that ZIP. Update that list when adding
runtime files, and keep credentials, downloaded binaries, docs, tests, dependencies,
and planning artifacts out of the ZIP.

## Documentation and scope

Maintain user and development instructions in `README.md` and `docs/`, and agent
instructions here. Keep them aligned with actual code and commands. The docs site
uses the sibling Quick projects' shared CSS and self-hosted assets, with local
additions in `docs/project.css`. It has no JavaScript or external asset requests.
Do not add review reports, planning documents, task logs, or historical
machine-specific verification claims.
Preserve upstream license notices; do not redistribute Soloist in the bundle.
Write new prose, comments, and identifiers in American English. Keep fixes focused
and ask before pushing, opening or merging pull requests, changing remote settings,
or deleting user data. Local fixes and the checks above are authorized by a request
to review or improve this repository.
