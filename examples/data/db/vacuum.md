# Vacuum

Updating a row does not change it in place: the database writes a new
version, and the old one stays in the page while anyone can still see
it. Vacuum is a background process that removes such dead versions.

## What it does

- frees space inside the table's pages
- removes links to dead rows from the trees, so indexes take less space
  after it
- updates the statistics the planner uses to estimate cost

## When it falls behind

If writes come faster than vacuum can clean up, the table bloats, and
the indexes bloat along with it. The symptom is simple: the size on disk
grows, but the number of rows does not.

How indexes themselves work is covered in the note on
[data storage](storage.md).
