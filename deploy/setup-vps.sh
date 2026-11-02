#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
command -v node >/dev/null
id webank >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/webank --shell /bin/bash webank
install -d -o webank -g webank /srv/webank/releases /srv/webank/incoming /srv/webank/shared/.wrangler/state
install -d -m 700 -o webank -g webank /srv/webank/.ssh
if [[ ! -e /srv/webank/shared/.dev.vars ]]; then
  install -o webank -g webank -m 600 voice-bank/.dev.vars.example /srv/webank/shared/.dev.vars
fi
if ! grep -q '^TAILSCALE_SERVE_ORIGIN=' /srv/webank/shared/.dev.vars; then
  printf '\nTAILSCALE_SERVE_ORIGIN=https://<your-host>.<tailnet>.ts.net\n' >> /srv/webank/shared/.dev.vars
fi
install -m 644 deploy/webank.service /etc/systemd/system/webank.service
install -m 755 deploy/deploy.sh /usr/local/bin/webank-deploy
printf '%s\n' 'webank ALL=(root) NOPASSWD: /usr/bin/systemctl restart webank.service' >/etc/sudoers.d/webank
chmod 440 /etc/sudoers.d/webank
visudo -cf /etc/sudoers.d/webank
systemctl daemon-reload
systemctl enable webank.service
