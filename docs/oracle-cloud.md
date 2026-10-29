# Oracle Cloud backend setup

This guide deploys only the Node.js and Socket.IO backend. Vercel hosts the React client. The Oracle service binds to `127.0.0.1:3001`; Nginx provides public HTTPS/WSS. Room snapshots live at `/var/lib/mission-zero/rooms.json` on the VM boot volume and survive service and VM restarts.

## Isolation requirement

Use a **new, dedicated Ubuntu VM**, its own reserved public IP, and a new Network Security Group for Mission Zero. Do not install or restart Nginx, edit firewall rules, or change ports on the VM that serves your existing website. Do not attach this service's NSG to that website's VNIC. If you cannot create a separate VM, stop before the Nginx/firewall steps and review the existing host's layout first.

## Deployment order

1. Create and push the `mission-zero` GitHub repository using the root README instructions.
2. Create a dedicated Ubuntu 24.04 Compute VM in OCI. Assign a reserved public IPv4 address to its VNIC and create/attach a dedicated NSG. Keep SSH key access; do not enable password SSH.
3. Create a free DuckDNS subdomain such as `your-choice.duckdns.org` and point its A record at the **new VM's** reserved public IP. No domain or IP is assumed here. If you do not reserve the IP, configure DuckDNS's HTTPS updater to keep the record current; keep its token outside the Git repository in a root-readable file.
4. Create the Vercel project and set `VITE_SERVER_URL` to the planned API origin, for example `https://your-choice.duckdns.org`. Deploy the frontend and note its exact production origin, such as `https://mission-zero.vercel.app` (use the actual URL Vercel assigns).
5. Install the backend on the new VM and set `CLIENT_ORIGIN` to that exact Vercel origin. Install Nginx and TLS on that same new VM, then verify `/health` over HTTPS.
6. Redeploy Vercel after confirming `VITE_SERVER_URL` is the live HTTPS API origin. Verify the frontend connects to the backend and run the two-browser manual check in the root README.

## OCI and Ubuntu ingress rules

In the OCI console, create an NSG dedicated to this new VM's VNIC. Add only these inbound rules:

| Protocol/port | Source | Purpose |
| --- | --- | --- |
| TCP 22 | Your current public IP with `/32` | SSH administration |
| TCP 80 | `0.0.0.0/0` | Let's Encrypt HTTP validation and HTTP-to-HTTPS redirect |
| TCP 443 | `0.0.0.0/0` | HTTPS and WSS |

If you assign IPv6, add equivalent TCP 80/443 rules for `::/0`. Do **not** open TCP 3001. OCI NSGs/security lists and the operating-system firewall both affect reachability; keep their rules aligned. Oracle's [network security rules guide](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm) describes NSGs and security lists.

On the new VM, first allow your SSH source and web traffic, then enable UFW:

```bash
sudo ufw allow from YOUR_PUBLIC_IP/32 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status verbose
```

Replace `YOUR_PUBLIC_IP` with your current public IPv4. Never apply these commands to the existing website VM without checking its current firewall rules. Ubuntu documents [UFW and host firewalls](https://documentation.ubuntu.com/security/security-features/network/firewall/).

## Install Node and deploy the backend

Use Node.js 22.12 or later (the Vite toolchain requires it); `/usr/bin/node` is used by the supplied systemd unit. On Ubuntu 24.04, install the NodeSource 22.x APT package so the runtime is at `/usr/bin/node`:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node --version
command -v node
```

Confirm Node is at least 22.12 and `command -v node` prints `/usr/bin/node`. See the [NodeSource Ubuntu instructions](https://github.com/nodesource/distributions#debian-and-ubuntu-based-distributions) or [official Node.js downloads](https://nodejs.org/en/download) for alternatives; update the systemd unit's `ExecStart` if using a different Node path.

Create a dedicated non-login account and persistent data directory:

```bash
sudo adduser --system --group --home /var/lib/mission-zero missionzero
sudo install -d -o missionzero -g missionzero /opt/mission-zero /var/lib/mission-zero
```

Clone the new repository. Replace the GitHub owner with your own account:

```bash
sudo -u missionzero git clone https://github.com/YOUR_GITHUB_OWNER/mission-zero.git /opt/mission-zero
cd /opt/mission-zero
sudo -u missionzero npm ci
```

If the GitHub repo is private, use a read-only deploy key or another GitHub-supported SSH setup. Do not put a personal access token in the clone URL or in this repository.

Create the system environment file outside the repo:

```bash
sudo install -d -o root -g missionzero -m 0750 /etc/mission-zero
sudo install -o root -g missionzero -m 0640 /dev/null /etc/mission-zero/mission-zero.env
sudoedit /etc/mission-zero/mission-zero.env
```

Set these values in that file, using the actual Vercel production URL:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
CLIENT_ORIGIN=https://mission-zero.vercel.app
ROOM_TTL_MINUTES=30
DATA_DIR=/var/lib/mission-zero
```

For a Vercel custom production domain, add it as another exact origin, comma-separated, with no spaces, for example `CLIENT_ORIGIN=https://mission-zero.vercel.app,https://game.example.org`. If you want multiplayer on a Vercel Preview deployment, add only its stable exact branch alias as another origin. Do not use `*`, an origin with a path, or a catch-all for Vercel preview deployments. Update the file and restart the service whenever the frontend origin changes.

Install and enable the supplied systemd unit:

```bash
sudo install -o root -g root -m 0644 /opt/mission-zero/deploy/mission-zero.service /etc/systemd/system/mission-zero.service
sudo systemctl daemon-reload
sudo systemctl enable --now mission-zero
sudo systemctl status mission-zero --no-pager
sudo journalctl -u mission-zero -n 100 --no-pager
```

The unit restarts the Node process after a failure and starts it after a VM reboot. The app writes snapshots to the boot volume under `/var/lib/mission-zero`. Back up that directory if room recovery matters. Do not run multiple instances: rooms are coordinated in one Node process and a local JSON file.

The production command is `npm start` (equivalent to `node server/index.js`). For code updates:

```bash
cd /opt/mission-zero
sudo -u missionzero git pull --ff-only
sudo -u missionzero npm ci
sudo systemctl restart mission-zero
sudo systemctl status mission-zero --no-pager
```

## Nginx and HTTPS/WSS

First confirm the DuckDNS hostname resolves to the new VM and the OCI/UFW rules allow TCP 80 and 443. Install Nginx on this dedicated VM:

```bash
sudo apt update
sudo apt install -y nginx
```

Install the supplied reverse-proxy server block as a **new** file and replace `api.example.invalid` with your DuckDNS hostname:

```bash
sudo cp /opt/mission-zero/deploy/nginx-mission-zero.conf /etc/nginx/sites-available/mission-zero-api
sudoedit /etc/nginx/sites-available/mission-zero-api
sudo ln -s /etc/nginx/sites-available/mission-zero-api /etc/nginx/sites-enabled/mission-zero-api
sudo nginx -t
sudo systemctl reload nginx
```

On this new VM, obtain and install a Let's Encrypt certificate. Certbot's Nginx integration edits this new host's Nginx configuration to add TLS and redirect HTTP:

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d your-choice.duckdns.org
sudo certbot renew --dry-run
```

Follow the [Certbot Nginx instructions](https://certbot.eff.org/instructions?os=snap&ws=nginx). Let's Encrypt needs the hostname to resolve to this VM and inbound TCP 80 reachable for the standard HTTP validation. Verify automatic renewal with `sudo certbot renew --dry-run` and `sudo systemctl list-timers | grep -i certbot`.

With `VITE_SERVER_URL=https://your-choice.duckdns.org`, Socket.IO uses HTTPS for HTTP polling and upgrades to WSS for WebSocket transport. Nginx forwards the `Upgrade` and `Connection` headers; the Node port remains private on loopback. DuckDNS documents its [free subdomains and HTTPS update API](https://www.duckdns.org/spec.jsp); never commit its update token.

Check the backend before the Vercel redeploy:

```bash
curl --fail --show-error https://your-choice.duckdns.org/health
```

Expected JSON includes `"ok":true`. Also check `sudo systemctl is-enabled mission-zero`, `sudo systemctl is-active mission-zero`, and `sudo nginx -t`. After reboot, repeat the health check. The Vercel `VITE_SERVER_URL` is public frontend configuration, not a secret; the `CLIENT_ORIGIN` allowlist must match the actual frontend origin exactly.

## Relevant deployment references

- [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel SPA rewrites](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [Oracle Cloud NSG/security-list rules](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm)
- [PM2 startup and saved process lists](https://pm2.keymetrics.io/docs/usage/startup/) (use only if you choose PM2 instead of the supplied systemd unit)
