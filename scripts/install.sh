#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Lancez ce script avec sudo." >&2; exit 1; fi
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  echo "Node.js 22 ou supérieur est requis." >&2; exit 1
fi

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${MATRIXAI_INSTALL_DIR:-/opt/matrixai}"
DATA_DIR="${MATRIXAI_DATA_DIR:-/var/lib/matrixai}"
CONFIG_DIR="${MATRIXAI_CONFIG_DIR:-/etc/matrixai}"

getent group matrixai >/dev/null || groupadd --system matrixai
id matrixai >/dev/null 2>&1 || useradd --system --gid matrixai --home-dir "$DATA_DIR" --shell /usr/sbin/nologin matrixai
install -d -m 0755 "$INSTALL_DIR" "$CONFIG_DIR"
install -d -o matrixai -g matrixai -m 0700 "$DATA_DIR"

rm -rf "$INSTALL_DIR/server" "$INSTALL_DIR/web"
cp -a "$SOURCE_DIR/server" "$INSTALL_DIR/server"
cp -a "$SOURCE_DIR/web" "$INSTALL_DIR/web"
rm -rf "$INSTALL_DIR/server/data" "$INSTALL_DIR/server/node_modules" "$INSTALL_DIR/web/node_modules" "$INSTALL_DIR/web/dist"

npm ci --prefix "$INSTALL_DIR/server" --omit=dev
npm ci --prefix "$INSTALL_DIR/web"
npm --prefix "$INSTALL_DIR/web" run build
rm -rf "$INSTALL_DIR/web/node_modules"
chown -R root:root "$INSTALL_DIR"

if [[ ! -f "$CONFIG_DIR/matrixai.env" ]]; then
  sed "s|MATRIXAI_DATA_DIR=/var/lib/matrixai|MATRIXAI_DATA_DIR=$DATA_DIR|;s|MATRIXAI_WEB_DIST=/opt/matrixai/web/dist|MATRIXAI_WEB_DIST=$INSTALL_DIR/web/dist|" "$SOURCE_DIR/deploy/matrixai.env.example" > "$CONFIG_DIR/matrixai.env"
  chmod 0600 "$CONFIG_DIR/matrixai.env"
fi
install -m 0644 "$SOURCE_DIR/deploy/matrixai.service" /etc/systemd/system/matrixai.service
sed -i "s|WorkingDirectory=/opt/matrixai/server|WorkingDirectory=$INSTALL_DIR/server|;s|ReadWritePaths=/var/lib/matrixai|ReadWritePaths=$DATA_DIR|" /etc/systemd/system/matrixai.service
systemctl daemon-reload
systemctl enable --now matrixai
systemctl --no-pager --full status matrixai

echo "MatrixAI installé. Identifiants initiaux : $DATA_DIR/bootstrap-credentials.txt"
