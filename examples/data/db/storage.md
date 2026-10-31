# Data storage

A note on how a relational database lays rows out in files, what it does
with them on a read, and why the same query can run in ten milliseconds
or in ten seconds. The document is long on purpose: it shows the side
outline, anchor links and code highlighting in one place.

Contents:

- [Pages and heaps](#pages-and-heaps)
- [Indexes](#indexes)
- [Planner](#planner)
- [Maintenance](#maintenance)

Related notes: [vacuum](vacuum.md), [replication](replication.md),
[locks](locks.md).

## Pages and heaps

A table file is split into pages of a fixed size. A page is the unit of
reading and writing: the database never reads a single row, it reads the
whole page and then looks for the row versions it needs inside it. This
is why short rows are better than long ones: more of them fit on a page,
and the same number of reads returns more useful data.

Inside a page, rows lie in no particular order. This kind of storage is
called a heap, and a heap has exactly one advantage: writing to it is
cheap. A new row goes into the first page that has room for it, and no
sorting happens at all.

The downside is clear too. To find a row by a column value, you have to
read every single page of the table. On a hundred-megabyte table you do
not notice it, on a hundred-gigabyte table it is minutes of disk work,
and no amount of memory helps here.

You can check the size of a table right from the shell:

```bash
psql -c "select pg_size_pretty(pg_total_relation_size('orders'))"
```

The number from this query includes both the table's own pages and
everything built on top of it. The difference between the table size and
the full relation size is the price of fast reads described below.

## Indexes

Indexes are a separate structure that keeps the values of a column in
sorted order and, next to each value, holds a link to the page with the
row itself. The database walks down this structure in a few reads instead
of scanning the whole table.

The most common kind is btree. It keeps values in a balanced tree, so it
handles equality lookups and range lookups equally well, and it can
return rows already in order, saving a separate sort.

Indexes are not free. Every insert and every update of an indexed column
also writes an entry into the tree, and the tree itself takes space on
disk and in memory. A table with eight indexes is written noticeably
slower than the same table with one.

This gives a simple rule: an index pays off where selectivity is high
and the query really is frequent. An index on a column with two distinct
values is almost always useless - the planner will ignore it and read
the whole table, because that is cheaper.

```sql
create index concurrently orders_created_at_idx
    on orders (created_at desc);
```

The key word in this query is `concurrently`: without it, building the
index holds a lock and stops writes to the table for the whole time it
runs, which is usually not acceptable on a live database.

## Planner

The planner picks how to run a query not by rules but by cost. It
estimates how many pages each option will have to read and takes the
cheapest one. The estimate is based on statistics that the database
collects about tables in a separate background process.

When the statistics are out of date, the estimate drifts away from
reality, and the chosen plan turns out bad even with perfectly healthy
indexes. So the first question about a slow query is not "which index is
missing" but "which plan was chosen and why".

You can see the plan together with the actual timing like this:

```sql
explain (analyze, buffers)
select * from orders where created_at > now() - interval '7 days';
```

The `Buffers` lines in the output show how many pages were actually
read. If there are thousands where you expected dozens, the cause is
almost always the estimate, not the index itself.

## Maintenance

Indexes grow over time: tree pages end up half full, and the same number
of values starts to take twice as much space. A rebuild brings the size
back to where it was, but it needs time and disk space, so it is
scheduled rather than run at peak hours.

Unused indexes are a separate story. They keep slowing down writes but
do not speed up a single read, because the queries they were once
created for were rewritten long ago. Such indexes are worth finding by
usage statistics and dropping.

Cleaning up dead row versions is covered in the related note on
[vacuum](vacuum.md).
