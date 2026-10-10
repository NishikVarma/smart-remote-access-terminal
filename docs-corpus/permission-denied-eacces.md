# Permission denied (EACCES)

## Symptoms

`EACCES: permission denied`, `Permission denied`, `Access is denied`, or
`EPERM: operation not permitted` when reading, writing or running a file, or when listening on a port.

## Likely causes

- The file or folder belongs to another user, often after running a command with sudo once.
- The file is not executable. A script needs the execute bit.
- Ports below 1024 need elevated rights on Linux and macOS.
- On Windows the file is locked by another program or the folder is protected.

## Fix

Check ownership with `ls -l`. Fix it with `chown` or `chmod` rather than running everything as root.
Use a port above 1024. On Windows close the program that holds the file or run from a writable folder.
