#!/bin/sh
# Runs backup.sh every day at 02:30 (Africa/Abidjan) with BusyBox cron.
set -eu
echo "30 2 * * * /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
exec crond -f -l 8
