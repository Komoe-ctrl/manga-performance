# syntax=docker/dockerfile:1
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli openssl tzdata
COPY infra/backup/backup.sh infra/backup/restore.sh /usr/local/bin/
COPY infra/docker/backup-entrypoint.sh /usr/local/bin/backup-entrypoint.sh
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["backup-entrypoint.sh"]
