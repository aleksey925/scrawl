# Move orders to PostgreSQL

Orders move from MySQL 5.7 to PostgreSQL 17, both kept in sync until the
cutover.

## This week

- [x] Compare row counts in all 48 tables
- [x] Load test: 3x the peak, p99 under 40 ms
- [ ] Switch writes in a quiet hour
- [ ] Keep MySQL read-only for two weeks

## Plan

```mermaid
---
config:
  gantt:
    useWidth: 720
    barHeight: 22
    barGap: 6
    leftPadding: 10
    rightPadding: 30
    fontSize: 13
    sectionFontSize: 13
  themeVariables:
    doneTaskBkgColor: "#2f80ed"
    doneTaskBorderColor: "#2f80ed"
    activeTaskBkgColor: "#f2994a"
    activeTaskBorderColor: "#f2994a"
    taskBkgColor: "#c9ced6"
    taskBorderColor: "#c9ced6"
    taskTextColor: "#333333"
    taskTextDarkColor: "#ffffff"
    taskTextOutsideColor: "#8a8f98"
    gridColor: "#9aa0a6"
    sectionBkgColor: "transparent"
    altSectionBkgColor: "transparent"
---
gantt
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  tickInterval 2week
  todayMarker off
  Schema :done, 2026-09-21, 2026-10-06
  Change stream :done, 2026-10-06, 2026-10-20
  Reads on replica :done, 2026-10-20, 2026-11-10
  Writes switch :active, 2026-11-10, 2026-11-30
  Drop MySQL : 2026-11-30, 2026-12-15
```

## How it works

```mermaid
flowchart LR
  API["Orders API"] --> MY[("MySQL 5.7")]
  MY -- "change stream" --> CDC["Debezium"] --> PG[("PostgreSQL 17")]
  API -. "reads, 10%" .-> PG
  PG --> R[("Replica")]
```

## Stages

| Stage            | Owner  | Due    | Status      |
| ---------------- | ------ | ------ | ----------- |
| Schema and types | Anna   | 6 Oct  | Done        |
| Change stream    | Marco  | 20 Oct | Done        |
| Reads on replica | Anna   | 10 Nov | Done        |
| Writes switch    | Li Wei | 30 Nov | In progress |
| Drop MySQL       | Marco  | 15 Dec | Planned     |

## Rollback

Point the API back to MySQL in the config and restart it. The change stream
keeps MySQL up to date until the end of the cutover, so no order is lost.
