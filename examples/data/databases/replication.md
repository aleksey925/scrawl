# Replication

A replica replays the primary server's write-ahead log and lags behind
it by the delivery time. You can read from a replica, but you cannot
count on the data being fresh.

## Lag

Lag is measured not in bytes of the log but in seconds: bytes say
nothing about how long a client will keep seeing an old row version.
