#!/usr/bin/env bash
set -euo pipefail
release=${1:?release required}
port=${2:-3101}
[[ "$port" =~ ^310[12]$ ]]
[[ "$release" =~ ^[a-zA-Z0-9-]+$ ]]
base=/srv/echo-product
directory="$base/releases/$release"
cd "$directory"
umask 077
if [[ ! -s "$base/runtime.env" ]]; then
  db_password=$(openssl rand -hex 24)
  encryption_key=$(openssl rand -base64 32)
  docker exec -i semantic-retell-v2-postgres-1 psql -X -v ON_ERROR_STOP=1 -U semantic -d postgres >/dev/null <<SQL
SELECT 'CREATE ROLE echo_training LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'echo_training')\gexec
ALTER ROLE echo_training PASSWORD '$db_password';
SELECT 'CREATE DATABASE echo_training OWNER echo_training' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'echo_training')\gexec
SQL
  {
    printf '%s\n' 'NODE_ENV=production' 'PORT=3000' 'WEB_ROOT=/echo/dist/web' 'PUBLIC_ORIGIN=https://47.239.63.61.sslip.io'
    printf 'DATABASE_URL=postgresql://echo_training:%s@postgres:5432/echo_training\n' "$db_password"
    printf 'ENCRYPTION_MASTER_KEY=%s\n' "$encryption_key"
    printf '%s\n' 'REDIS_URL=redis://redis:6379/4' 'S3_ENDPOINT=http://seaweedfs:8333' 'S3_PUBLIC_ENDPOINT=https://s3.47.239.63.61.sslip.io' 'S3_BUCKET=echo-training-room' 'AI_MODE=real' 'FFMPEG_PATH=/app/node_modules/ffmpeg-static/ffmpeg' 'COMPARISON_CONCURRENCY=1'
    awk -F= '/^(S3_ACCESS_KEY|S3_SECRET_KEY|S3_REGION|ARK_API_KEY|ARK_MODEL_ID|SPEECH_API_KEY)=/{print} /^SPEECH_RESOURCE_ID=/{sub(/^SPEECH_RESOURCE_ID=/,"SPEECH_FILE_RESOURCE_ID=");print}' /opt/semantic-retell-v2/.env
  } > "$base/runtime.env.new"
  mv "$base/runtime.env.new" "$base/runtime.env"
fi

image=semantic-retell-v2-worker:latest
runtime=(--network semantic-retell-v2_default --env-file "$base/runtime.env" -v "$directory:/echo" -w /echo)
gateway=$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' semantic-retell-v2_default)
[[ "$gateway" =~ ^[0-9.]+$ ]]
docker run --rm "${runtime[@]}" "$image" npm ci --omit=dev --no-audit --no-fund
docker run --rm "${runtime[@]}" "$image" npm run db:migrate:built
docker run --rm -i "${runtime[@]}" "$image" node --input-type=module <<'JS'
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION,
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } });
const bucket = { Bucket: process.env.S3_BUCKET };
try { await client.send(new HeadBucketCommand(bucket)); }
catch (error) {
  if (error.$metadata?.httpStatusCode !== 404) throw error;
  await client.send(new CreateBucketCommand(bucket));
}
client.destroy();
JS
docker run -d --restart unless-stopped --name "echo-api-$release" "${runtime[@]}" -e "TRUSTED_PROXY=$gateway" -p "127.0.0.1:$port:3000" "$image" npm run start:api
docker run -d --restart unless-stopped --name "echo-worker-$release" "${runtime[@]}" --memory=384m --cpus=1 "$image" npm run start:worker
for attempt in {1..20}; do
  if curl -fsS "http://127.0.0.1:$port/health/ready"; then exit 0; fi
  sleep 1
done
exit 1
