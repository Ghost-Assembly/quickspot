set shell := ["bash", "-euo", "pipefail", "-c"]

# Match the Quick apps: derive the extension identity from its metadata.
_uuid := replace_regex(read("metadata.json"), '(?s)^.*?"uuid"\s*:\s*"([^"]+)".*$', '$1')
uuid := if _uuid =~ '^[A-Za-z0-9._@-]+$' { _uuid } else { error("no uuid in metadata.json") }

# List project commands
default:
    @just --list

# Install development tools and dependencies
setup:
    mise install
    npm ci --ignore-scripts
    /usr/bin/gjs -c 'imports.gi.Soup; imports.gi.Secret; imports.gi.Adw;'

# Format source and configuration
fmt:
    npx prettier --write .
    ruff format scripts tests
    ruff check --fix scripts tests

# Check source, formatting, and settings schemas
lint:
    npx eslint --max-warnings=0 .
    npx prettier --check .
    ruff check scripts tests
    ruff format --check scripts tests
    /usr/bin/glib-compile-schemas --strict --dry-run schemas

# Run offline boundary and installer tests
test:
    node --test tests/*.test.js
    python3 -m unittest discover -s tests -p 'test_*.py' -v
    python3 scripts/run_native.py

# Scan for accidentally included secrets
security:
    gitleaks dir --redact --no-banner --config .gitleaks.toml .

# Build the extension ZIP without credentials or Spotify binaries
build:
    python3 scripts/build.py

# Run GNOME Shell in a separate development window
run:
    /usr/bin/dbus-run-session -- /usr/bin/gnome-shell --devkit --wayland

# Open preferences for an installed extension
prefs:
    /usr/bin/gnome-extensions prefs {{ uuid }}

# Enable the installed extension
enable:
    /usr/bin/gnome-extensions enable {{ uuid }}

# Disable the installed extension
disable:
    /usr/bin/gnome-extensions disable {{ uuid }}

# Follow extension log output
logs:
    journalctl --user -f -o cat | rg --line-buffered -i quickspot

# Follow the player's credential-safe launcher log
logs-player:
    journalctl --user -f -u quickspot-soloist.service -o cat

# Check installation, running state, and pairing without printing credentials
doctor:
    /usr/bin/gjs -m scripts/doctor.js

# Remove only generated artifacts
clean:
    python3 -c 'from pathlib import Path; files = list(Path("dist").glob("*.shell-extension.zip")) + [Path("schemas/gschemas.compiled")]; [p.unlink(missing_ok=True) for p in files]'

# Run reproducible checks and build
ci: lint test security build

# Exercise GNOME enable, disable, re-enable, and preferences in an isolated session
test-live: build
    python3 scripts/check_live.py

# Save this repository's local credentials in GNOME Keyring
import-credentials:
    /usr/bin/gjs -m scripts/import-credentials.js .env

# Install the built extension for the current user
install: build
    /usr/bin/gnome-extensions install --force dist/{{ uuid }}.shell-extension.zip

# Stop and disable Soloist, then remove the extension (keep saved data)
uninstall:
    if /usr/bin/systemctl --user cat quickspot-soloist.service >/dev/null 2>&1; then /usr/bin/systemctl --user disable --now quickspot-soloist.service; fi
    /usr/bin/gnome-extensions disable {{ uuid }}
    /usr/bin/gnome-extensions uninstall {{ uuid }}
