#!/usr/bin/env bash
set -euo pipefail

release=${1:?release required}
[[ "$release" =~ ^[a-zA-Z0-9-]+$ ]]
host=${ECHO_DEMO_HOST:?ECHO_DEMO_HOST required}
[[ "$host" =~ ^[a-zA-Z0-9.-]+$ ]]
base=/srv/echo-demo
directory="$base/releases/$release"
config=/etc/caddy/Caddyfile
cd "$directory"
assets=(index.html app.js style.css speaker-sample.mp3)
for asset in "${assets[@]}"; do
  test -s "$asset"
  chmod 644 "$asset"
done
chmod 755 "$base" "$base/releases" "$directory"

exec 9>"$base/deploy.lock"
flock 9
candidate=$(mktemp /etc/caddy/Caddyfile.echo-demo.XXXXXX)
trap 'rm -f -- "$candidate" "$base/.current-$release"' EXIT
backup="$base/Caddyfile.before-$release"
cp -p "$config" "$backup"
old_release=$(readlink "$base/current" || true)

# The managed host serves the demo. Leave all other Caddy host blocks intact.
awk -v host="$host" '
  $0 == host " {" {
    matches++
    replacing=1
    print host " {"
    print "  # echo-demo root"
    print "  encode zstd gzip"
    print "  @previousDemo path /echo-demo /echo-demo/*"
    print "  redir @previousDemo / 302"
    print "  @demoAssets path / /index.html /app.js /style.css /speaker-sample.mp3"
    print "  handle @demoAssets {"
    print "    root * /srv/echo-demo/current"
    print "    header Cache-Control \"no-cache\""
    print "    header X-Content-Type-Options \"nosniff\""
    print "    header Referrer-Policy \"no-referrer\""
    print "    header Content-Security-Policy \"default-src '\''self'\''; script-src '\''self'\''; style-src '\''self'\'' '\''unsafe-inline'\''; media-src '\''self'\''; object-src '\''none'\''; base-uri '\''none'\''; form-action '\''none'\''\""
    print "    file_server"
    print "  }"
    print "  respond 404"
    next
  }
  replacing && $0 == "}" { print; replacing=0; next }
  !replacing { print }
  END { if (matches != 1 || replacing) exit 1 }
' "$config" > "$candidate"
caddy validate --config "$candidate" --adapter caddyfile

ln -s "$directory" "$base/.current-$release"
mv -Tf "$base/.current-$release" "$base/current"
rollback() {
  if [[ -n "$old_release" ]]; then
    ln -s "$old_release" "$base/.rollback-$release"
    mv -Tf "$base/.rollback-$release" "$base/current"
  else
    rm -f "$base/current"
  fi
  cp -p "$backup" "$candidate"
  mv -f "$candidate" "$config"
  systemctl reload caddy
}
chmod --reference="$config" "$candidate"
chown --reference="$config" "$candidate"
mv -f "$candidate" "$config"
if ! systemctl reload caddy; then rollback; exit 1; fi

origin="https://$host"
curl_options=(--fail --silent --show-error --max-time 10 --resolve "$host:443:127.0.0.1")
for asset in "${assets[@]}"; do
  path="/$asset"
  if [[ "$asset" == index.html ]]; then path=/; fi
  if ! curl "${curl_options[@]}" "$origin$path" | cmp - "$asset"; then
    rollback
    exit 1
  fi
done
if ! curl "${curl_options[@]}" --location "$origin/echo-demo/" | cmp - index.html; then
  rollback
  exit 1
fi
printf 'Published %s/ (%s)\n' "$origin" "$release"
