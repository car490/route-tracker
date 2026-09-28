#!/usr/bin/env bash
# Updates the Bus Controller's copy of this repo — run this ON the Controller,
# over SSH, as the mele user:
#   ~/route-tracker/pcv-dashboard/busops/announce/mele-server/update-controller.sh [branch]
#
# With the read-only system disk on (config/overlayroot.conf, the normal state
# once bootstrap-controller.sh has run), a plain `git pull` would only change
# the RAM copy and vanish at the next power-off. This makes the real disk
# writable for the update alone (overlayroot-chroot), pulls and installs
# there, and leaves it read-only again. The running system doesn't see the
# change until the next boot, so it ends by asking for a restart.
#
# Only fast-forwards (never merges or rewrites anything on the box), and
# installs exact dependency versions from package-lock.json.
#
# Updates the code only. If a release changes a file under config/ (systemd
# units, overlayroot, watchdog), re-run bootstrap-controller.sh instead, with
# the read-only disk switched off first — see mele-server/DEPLOY.md
# "Updating the Controller".
#
# To confirm on the bench (docs/TESTING.md §19 part A): that the chroot has
# network (DNS) for git/npm on this Ubuntu image.
set -euo pipefail

REPO_BRANCH="${1:-develop}"
OWNER="$(id -un)"
REPO_DIR="$HOME/route-tracker"
SERVER_DIR="$REPO_DIR/pcv-dashboard/busops/announce/mele-server"

# The branch name ends up inside a command run as root: plain names only.
if ! [[ "$REPO_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Not a branch name: $REPO_BRANCH"
  exit 1
fi

if [ "$OWNER" = "root" ]; then
  echo "Run this as the Controller's own user (mele), not root."
  exit 1
fi

# Runs as root (under sudo, or inside the chroot); every change is made as
# the repo's owner so file ownership never changes.
do_update() {
  set -euo pipefail
  sudo -H -u "$OWNER" git -C "$REPO_DIR" pull --ff-only origin "$REPO_BRANCH"
  cd "$SERVER_DIR"
  sudo -H -u "$OWNER" npm ci --omit=dev
}

PAYLOAD="$(declare -f do_update)
OWNER='$OWNER' REPO_DIR='$REPO_DIR' SERVER_DIR='$SERVER_DIR' REPO_BRANCH='$REPO_BRANCH'
do_update"

if [ "$(findmnt -n -o FSTYPE /)" = "overlay" ]; then
  echo "== Read-only disk is on: updating the real disk underneath =="
  sudo overlayroot-chroot /bin/bash -c "$PAYLOAD"
  echo ""
  echo "Updated on disk. Restart the Controller to run the new version:"
  echo "  sudo reboot"
else
  echo "== Read-only disk is off: updating in place =="
  sudo /bin/bash -c "$PAYLOAD"
  echo ""
  echo "Updated. Restart the server to run the new version (or reboot):"
  echo "  sudo systemctl restart coachmate-onboard"
fi
