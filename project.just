
doctor:
    /usr/bin/gjs -m scripts/doctor.js


logs-player:
    journalctl --user -f -u quickspot-soloist.service -o cat


import-credentials:
    /usr/bin/gjs -m scripts/import-credentials.js .env


# Project-specific offline integration tests
test-extra:
    python3 scripts/run_native.py

# Isolated GNOME lifecycle test
live-check:
    python3 scripts/check_live.py

# Additional integration checks
live-extra:
    @true

# Project services stopped before uninstalling
uninstall-extra:
    if /usr/bin/systemctl --user cat quickspot-soloist.service >/dev/null 2>&1; then /usr/bin/systemctl --user disable --now quickspot-soloist.service; fi
