# Out of memory

## Symptoms

`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`, `Killed`,
`MemoryError`, `java.lang.OutOfMemoryError`, or the OS OOM killer ending a process.

## Likely causes

- A build or process needs more memory than the default limit.
- A memory leak or reading a very large file into memory at once.
- The machine or container has too little memory.

## Fix

For Node.js raise the limit with `node --max-old-space-size=4096`. Process large files as streams.
Check memory use with Task Manager or `free -h`. Fix leaks before only raising limits.
