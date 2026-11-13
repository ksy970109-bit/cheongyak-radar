#!/bin/bash
# 청약레이더 — Oracle Cloud (Ubuntu 24.04) 첫 부팅 자동 세팅 스크립트
#
# VM을 만들 때 [고급 옵션 표시 → 관리 → 초기화 스크립트 → cloud-init 스크립트 붙여넣기]에
# 이 파일 전체를 붙여넣으세요. 아래 따옴표 안에 공공데이터포털 인증키(Decoding)를 넣으면
# 로또 판별까지 바로 켜집니다. 비워 두고 나중에 `sudo cheongyak-key`로 넣어도 됩니다.
DATA_GO_KR_KEY=""
REPO="https://github.com/ksy970109-bit/cheongyak-radar.git"

set -euxo pipefail
exec > >(tee -a /var/log/cheongyak-setup.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

APP=/opt/cheongyak-radar
DATA=/var/lib/cheongyak-radar
ENVF=/etc/cheongyak-radar.env

# ---- 1. swap (1GB RAM micro VM) ----
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- 2. packages: Node 22, git, Caddy ----
apt-get update
apt-get install -y ca-certificates curl git gnupg
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
if ! apt-get install -y caddy; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# ---- 3. app user, code, data dir ----
id cheongyak >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/cheongyak --shell /usr/sbin/nologin cheongyak
mkdir -p "$DATA" && chown cheongyak:cheongyak "$DATA"
if [ ! -d "$APP/.git" ]; then git clone --depth 1 "$REPO" "$APP"; fi
chown -R cheongyak:cheongyak "$APP"
sudo -u cheongyak bash -c "cd $APP && npm ci --omit=dev"

# ---- 4. config (key stays on the server only) ----
if [ ! -f "$ENVF" ]; then
  cat > "$ENVF" <<EOF
PORT=4320
HOST=127.0.0.1
DATA_DIR=$DATA
DATA_GO_KR_KEY=$DATA_GO_KR_KEY
EOF
fi
chown root:cheongyak "$ENVF" && chmod 640 "$ENVF"

# ---- 5. service ----
cat > /etc/systemd/system/cheongyak-radar.service <<EOF
[Unit]
Description=Cheongyak Radar
After=network-online.target
Wants=network-online.target

[Service]
User=cheongyak
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ---- 6. auto-update: pull GitHub every 30 min, restart when it changed ----
cat > /usr/local/bin/cheongyak-update <<'EOF'
#!/bin/bash
set -e
APP=/opt/cheongyak-radar
old=$(sudo -u cheongyak git -C "$APP" rev-parse HEAD)
sudo -u cheongyak git -C "$APP" pull --ff-only -q
new=$(sudo -u cheongyak git -C "$APP" rev-parse HEAD)
if [ "$old" != "$new" ]; then
  sudo -u cheongyak bash -c "cd $APP && npm ci --omit=dev"
  systemctl restart cheongyak-radar
  echo "updated $old -> $new"
fi
EOF
chmod 755 /usr/local/bin/cheongyak-update
cat > /etc/systemd/system/cheongyak-update.service <<'EOF'
[Unit]
Description=Pull Cheongyak Radar updates from GitHub

[Service]
Type=oneshot
ExecStart=/usr/local/bin/cheongyak-update
EOF
cat > /etc/systemd/system/cheongyak-update.timer <<'EOF'
[Unit]
Description=Check Cheongyak Radar updates every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
EOF

# ---- 7. helper: set or replace the data.go.kr key later ----
cat > /usr/local/bin/cheongyak-key <<'EOF'
#!/bin/bash
set -e
read -rsp "공공데이터포털 일반 인증키(Decoding)를 붙여넣고 Enter: " KEY; echo
[ -n "$KEY" ] || { echo "키가 비어 있어요."; exit 1; }
sed -i "s|^DATA_GO_KR_KEY=.*|DATA_GO_KR_KEY=$KEY|" /etc/cheongyak-radar.env
systemctl restart cheongyak-radar
echo "저장했어요. 1~2분 안에 로또 판별을 계산합니다."
EOF
chmod 755 /usr/local/bin/cheongyak-key

# ---- 8. firewall: Oracle Ubuntu images only allow SSH by default ----
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save || iptables-save > /etc/iptables/rules.v4

# ---- 9. HTTPS via Caddy on <ip>.sslip.io (free, no domain needed) ----
IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
DOMAIN="${IP//./-}.sslip.io"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:4320
}

http://$IP {
	redir https://$DOMAIN{uri}
}
EOF
echo "https://$DOMAIN" > /etc/cheongyak-radar.url

systemctl daemon-reload
systemctl enable --now cheongyak-radar cheongyak-update.timer caddy
systemctl restart caddy
echo "DONE → https://$DOMAIN"
