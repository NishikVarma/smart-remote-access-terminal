# No space left on device (ENOSPC)

## Symptoms

`ENOSPC: no space left on device`, `No space left on device`,
`There is not enough space on the disk`, failed writes or installs.

## Likely causes

- The disk or partition is full, often because of logs, caches, Docker images or build output.
- Inodes are exhausted by very many small files (Linux).

## Fix

Check usage with `df -h` and `df -i`. Find large folders with `du -sh *`. Clean package caches,
old logs and unused Docker data with `docker system prune`. Empty the recycle bin on Windows.
