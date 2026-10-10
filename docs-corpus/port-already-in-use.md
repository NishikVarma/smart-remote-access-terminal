# Port already in use (EADDRINUSE)

## Symptoms

`Error: listen EADDRINUSE: address already in use :::3000` or `Address already in use` when a
server starts.

## Likely causes

- A previous instance of the same server is still running, often in another terminal.
- A different program uses the same port.

## Fix

Find the process: `netstat -ano | findstr :3000` on Windows, `lsof -i :3000` on Linux and macOS.
Stop it, or start the server on another port with the PORT setting.
