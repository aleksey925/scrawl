# Cutover runbook

The writes switch of the [move to PostgreSQL](../postgres-migration.md), in a
quiet hour. Takes about 20 minutes.

## Before

- [ ] Replica lag under one second, see
      [replication](../../databases/replication.md)
- [ ] Row counts match in all 48 tables
- [ ] Support team told about the window

## Switch

1. Put the Orders API in read-only mode.
2. Wait until the change stream has nothing left to copy.
3. Point writes to PostgreSQL in the config and restart the API.
4. Place a test order and find it in PostgreSQL.

## If it goes wrong

Point writes back to MySQL and restart. The steps are in the
[rollback drill](rollback-drill.md), which is still to be written.

Back to the [index](../../index.md).
