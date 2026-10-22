#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

set -a
source .env
set +a

export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

aws s3 ls "s3://${R2_BUCKET_NAME}/" \
  --endpoint-url "${R2_ENDPOINT_URL}" \
  --region auto

aws s3 cp "s3://${R2_BUCKET_NAME}/supabase_backup_20261022_162817.sql.gz" ./backup.sql.gz \
  --endpoint-url "${R2_ENDPOINT_URL}" \
  --region auto
