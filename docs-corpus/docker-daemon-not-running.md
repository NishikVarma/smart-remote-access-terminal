# Docker daemon not reachable

## Symptoms

`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`, `error during connect`,
`docker: command not found`, `permission denied while trying to connect to the Docker daemon socket`.

## Likely causes

- Docker Desktop or the docker service is not running.
- The user is not in the `docker` group (Linux).
- The CLI points at a different context or host.

## Fix

Start Docker Desktop or run `sudo systemctl start docker`. Add the user to the `docker` group and
log in again. Check the active context with `docker context ls`.
