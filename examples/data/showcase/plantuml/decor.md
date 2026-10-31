# Look

## Themes

The same diagram in two themes:

```plantuml
@startuml
!theme cerulean
Reader -> Server : page
Server --> Reader : HTML
@enduml
```

```plantuml
@startuml
!theme sketchy-outline
Reader -> Server : page
Server --> Reader : HTML
@enduml
```

## Own colors and style

```plantuml
@startuml
<style>
  componentDiagram {
    BackgroundColor #FDF6E3
    LineColor #586E75
    FontColor #073642
  }
</style>
skinparam roundCorner 12
skinparam shadowing false
[Reading] #B5E8C9
[Editing] #FFE3A3
[History] #C9D7FF
[Reading] --> [Editing] : Edit button
[Editing] --> [History] : commit
@enduml
```

## Icons and emoji

```plantuml
@startuml
title <&book> Notes <:books:>
rectangle "<&cloud-upload> Push <:rocket:>" as push
rectangle "<&cloud-download> Fetch <:inbox_tray:>" as pull
rectangle "<&warning> Diverged <:warning:>" as diverged
rectangle "<#red&heart> Done <:white_check_mark:>" as done
push --> done
pull --> done
push --> diverged
diverged --> pull : reset to the remote
@enduml
```

## Text: lists, tables, links

```plantuml
@startuml
note as N
  = Features
  * **bold**, //italic//, ""monospace""
  * --strikethrough--, __underlined__
  * <color:red>red</color> and <back:yellow>highlighted</back>

  |= Mode |= Where |= Speed |
  | browser | app, site | instant |
  | server | export, render | 0.1-10 s |

  Docs: [[https://plantuml.com PlantUML]]
end note
@enduml
```

## Very wide

The page shows it smaller; open it to see it at full size.

```plantuml
@startuml
left to right direction
rectangle "Draft" as s1
rectangle "Edit" as s2
rectangle "Prettier" as s3
rectangle "Write" as s4
rectangle "Index" as s5
rectangle "Commit" as s6
rectangle "Push" as s7
rectangle "Webhook" as s8
rectangle "Fetch" as s9
rectangle "Merge --ff-only" as s10
rectangle "Page cache" as s11
rectangle "Reader" as s12
s1 --> s2
s2 --> s3
s3 --> s4
s4 --> s5
s5 --> s6
s6 --> s7
s7 --> s8
s8 --> s9
s9 --> s10
s10 --> s11
s11 --> s12
@enduml
```

## Very small

```plantuml
(Note)
```
