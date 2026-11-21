# Engineering notes

Notes of a small backend team: the projects under way, how our databases work,
and the references we keep coming back to.

## Projects

- [Move orders to PostgreSQL](projects/postgres-migration.md) - writes switch
  on 30 Nov, step by step in the
  [cutover runbook](projects/postgres-migration/cutover.md)
- [Search for orders](projects/order-search.md) - not written yet

## Databases

- [Data storage](databases/storage.md) - pages, indexes and the planner
- [Vacuum](databases/vacuum.md) - where dead rows go
- [Replication](databases/replication.md) - why a replica lags
- [Locks](databases/locks.md) - and how deadlocks happen

## Tools

- [PostgreSQL config](tools/pg-config/index.html) - settings for a new server
  from its memory, cores and load

## Reference

- [Caching in HTTP](reference/http-caching.md) - `Cache-Control`, `ETag` and
  the rest
- [Shell cookbook](reference/shell-cookbook.md) - commands worth remembering
- [Шпаргалка по Docker](reference/шпаргалка-docker.md) - на русском
- [PlantUML](reference/plantuml/index.md) - diagrams of every kind PlantUML
  draws
- [Writing notes](markdown.md) - the markdown a note can use
