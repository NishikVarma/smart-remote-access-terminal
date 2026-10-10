# TLS and certificate errors

## Symptoms

`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `CERT_HAS_EXPIRED`,
`self signed certificate in certificate chain`, `SSL: CERTIFICATE_VERIFY_FAILED`.

## Likely causes

- The server certificate expired or the system clock is wrong.
- A corporate proxy or antivirus re-signs traffic with its own certificate authority.
- The server does not send its intermediate certificates.

## Fix

Check the system date and time. Install the proxy root certificate into the trust store or set
`NODE_EXTRA_CA_CERTS`. Do not disable certificate verification in production.
