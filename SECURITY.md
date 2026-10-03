# Security policy

The latest release is supported on the GNOME Shell versions declared in
`metadata.json`. Report suspected vulnerabilities privately through
[GitHub's security advisory form](https://github.com/Ghost-Assembly/quickspot/security/advisories/new).
Include the extension version, GNOME Shell version, and reproduction steps.
Never include Spotify tokens, API keys, account data, or track metadata.

Credential storage, PKCE login and cancellation, authenticated request destinations,
loopback connections, archive extraction, player updates, service recovery, and
extension lifecycle behavior are in scope. Credentials belong in GNOME Keyring;
Soloist is downloaded separately from Spotify and is not included in the extension
ZIP. Disabling or uninstalling the extension preserves user data; uninstall also
stops its player service.
