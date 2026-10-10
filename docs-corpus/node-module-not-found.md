# Node.js: Cannot find module

## Symptoms

Errors such as `Error: Cannot find module 'express'`, `MODULE_NOT_FOUND`, or `ERR_MODULE_NOT_FOUND`
when starting a Node.js program.

## Likely causes

- Dependencies were never installed in this folder, or `node_modules` was deleted.
- The package is missing from `package.json`, so a fresh `npm install` does not fetch it.
- A relative import has the wrong path or letter case. Linux and macOS are case sensitive.
- ES modules require the file extension in relative imports, for example `./util.js`.

## Fix

Run `npm install` in the project root. For a missing package run `npm install <name>`. Check the
import path and its capitalisation. Delete `node_modules` and the lock file only as a last resort.
