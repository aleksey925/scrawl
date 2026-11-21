# Move orders to PostgreSQL

The orders service moves from MySQL 5.7 to PostgreSQL 17. Both databases stay
in sync until the cutover, so we can switch back at any time.

## How it works

```mermaid
flowchart LR
  API["Orders API"] --> MY[("MySQL 5.7")]
  MY -- "change stream" --> CDC["Debezium"] --> PG[("PostgreSQL 17")]
  API -. "reads, 10%" .-> PG
  PG --> R[("Replica")]
```

## Progress

```mermaid
---
config:
  xyChart:
    height: 260
  themeVariables:
    xyChart:
      plotColorPalette: "#2f80ed, #9aa0a6"
---
xychart-beta
  x-axis [W1, W2, W3, W4, W5, W6, W7, W8, W9, W10]
  y-axis 0 --> 60
  bar [48, 45, 41, 33, 28, 22, 15, 9]
  line [48, 43, 38, 34, 29, 24, 19, 14, 10, 5]
```

## Stages

| Stage            | Owner  | Due    | Status      |
| ---------------- | ------ | ------ | ----------- |
| Schema and types | Anna   | 6 Oct  | Done        |
| Change stream    | Marco  | 20 Oct | Done        |
| Reads on replica | Anna   | 10 Nov | Done        |
| Writes switch    | Li Wei | 30 Nov | In progress |
| Drop MySQL       | Marco  | 15 Dec | Planned     |

## Cutover

- [x] Freeze schema changes
- [x] Compare row counts in all 48 tables
- [x] Load test: 3x the peak, p99 under 40 ms
- [ ] Switch writes in a quiet hour
- [ ] Keep MySQL read-only for two weeks
