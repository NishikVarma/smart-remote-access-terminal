# Connection refused and timeouts

## Symptoms

`ECONNREFUSED`, `connect ETIMEDOUT`, `ENOTFOUND`, `Connection timed out`, `Could not resolve host`.

## Likely causes

- ECONNREFUSED: nothing is listening on that host and port, the service is not started, or the
  address is wrong (localhost versus another machine).
- ETIMEDOUT: a firewall drops packets, or the host is unreachable or slow.
- ENOTFOUND: the host name does not resolve. Check spelling, DNS and VPN settings.

## Fix

Confirm the service is running and listening on the expected port. Test with `curl -v <url>`.
Check firewall rules and proxy settings. Verify the host name with `nslookup`.
