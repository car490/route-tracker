#!/usr/bin/env bash
# Installed to /usr/local/bin/coachmate-healthcheck by bootstrap-controller.sh,
# run every minute by coachmate-healthcheck.timer.
#
# Restarts coachmate-onboard if it has stopped answering on its own port. A
# crashed process is already restarted by systemd (Restart=always); this
# catches one that is still running but hung. Only while the service is meant
# to be running — a service stopped on purpose (maintenance) is left alone.
# server.mjs serves https when it has a certificate and http otherwise, so
# either answering counts.
set -euo pipefail

PORT="${PORT:-8080}"

systemctl is-active --quiet coachmate-onboard || exit 0

if curl -fsk --max-time 5 "https://127.0.0.1:${PORT}/api/schedule" >/dev/null 2>&1 \
  || curl -fs --max-time 5 "http://127.0.0.1:${PORT}/api/schedule" >/dev/null 2>&1; then
  exit 0
fi

echo "coachmate-onboard not answering on port ${PORT} — restarting it"
systemctl restart coachmate-onboard
