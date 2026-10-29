# Locks

A lock protects a row or a table from being changed at the same time. It
is taken automatically and released at the end of the transaction, so a
long transaction is always a long lock.

## Deadlocks

Two transactions that take the same rows in a different order will
sooner or later end up facing each other. The database breaks the circle
itself by aborting one of them with an error.
