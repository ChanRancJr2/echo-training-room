#!/usr/bin/env bash
set -euo pipefail
base=/srv/echo-product
config=/etc/caddy/Caddyfile
host=47.239.63.61.sslip.io
release=${1:?release required}
port=${2:-3101}
[[ "$port" =~ ^310[12]$ ]]
[[ "$release" =~ ^[a-zA-Z0-9-]+$ ]]
directory="$base/releases/$release"
test -s "$directory/dist/web/index.html"
curl -fsS --max-time 5 "http://127.0.0.1:$port/health/ready" >/dev/null
curl -fsS --max-time 5 "http://127.0.0.1:$port/" | cmp - "$directory/dist/web/index.html"
exec 9>"$base/deploy.lock"
flock 9
backup="$base/Caddyfile.before-$release"
test ! -e "$backup"
cp -p "$config" "$backup"
candidate=$(mktemp /etc/caddy/Caddyfile.echo-product.XXXXXX)
trap 'rm -f -- "$candidate"' EXIT
awk -v host="$host" -v port="$port" '
  $0 == host " {" {
    matches++
    replacing=1
    print host " {"
    print "  encode zstd gzip"
    print "  @previousDemo path /echo-demo /echo-demo/*"
    print "  redir @previousDemo / 302"
    print "  reverse_proxy 127.0.0.1:" port
    next
  }
  replacing && $0 == "}" { print; replacing=0; next }
  !replacing { print }
  END { if (matches != 1 || replacing) exit 1 }
' "$config" > "$candidate"
caddy validate --config "$candidate" --adapter caddyfile
chmod --reference="$config" "$candidate"
chown --reference="$config" "$candidate"
mv -f "$candidate" "$config"
rollback() {
  cp -p "$backup" "$candidate"
  mv -f "$candidate" "$config"
  systemctl reload caddy
}
options=(--fail --silent --show-error --max-time 10 --resolve "$host:443:127.0.0.1")
if ! systemctl reload caddy ||
   ! curl "${options[@]}" "https://$host/" | cmp - "$directory/dist/web/index.html" ||
   ! curl "${options[@]}" "https://$host/health/ready" | grep -Fq '"status":"ok"'; then
  rollback
  exit 1
fi
printf '%s\n' "$release" > "$base/active-release"
printf 'Full-stack demo published at https://%s/ (%s)\n' "$host" "$release"
