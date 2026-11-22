# UML

## Sequence

Small:

```plantuml
@startuml
Browser -> Server : GET /s/notes/doc/index.md
Server --> Browser : 200 OK
@enduml
```

Large: saving a note with formatting, history and a push to the remote.
It is wider than the page, so the page shows it smaller; open it to zoom
in. Its boxes have colors of their own, so in the dark theme it sits on
a light card.

```plantuml
@startuml
autonumber
actor Author
box "Browser" #EEF
  participant Editor
  participant Prettier as P1
end box
box "Server" #EFE
  participant API
  participant Store
  participant History
  participant Sync
end box
database Git
collections Index

Author -> Editor : Ctrl+S
activate Editor
Editor -> P1 : format
P1 --> Editor : text
Editor -> API : PUT /api/file/notes.md\nIf-Match: rev
activate API
API -> Store : write atomically
alt revision matches
  Store --> API : new revision
  API -> Index : update
  API -> History : record a commit
  activate History
  History -> Git : add + commit
  Git --> History : sha
  deactivate History
  group background push
    API ->> Sync : mark changes
    loop every 2 seconds, while there is something to push
      Sync -> Git : push --ff-only
      alt the remote branch moved ahead
        Git --> Sync : rejected
        Sync -> Git : fetch + merge --ff-only
      else accepted
        Git --> Sync : ok
      end
    end
  end
  API --> Editor : 200 OK, rev
else revision is stale
  Store --> API : conflict
  API --> Editor : 409 Conflict
  note right of Editor
    The editor shows
    that the file changed
    somewhere else
  end note
end
deactivate API
Editor --> Author : "Saved"
deactivate Editor
@enduml
```

## Class

Medium:

```plantuml
@startuml
interface Store {
  +Read(path string) ([]byte, error)
  +Write(path string, data []byte) error
  +Delete(path string) error
}
abstract class Watcher {
  #events chan Event
  +{abstract} Start(ctx Context)
}
class FileStore {
  -root *os.Root
  -readOnly bool
}
class PollingWatcher
class NotifyWatcher
enum EventKind {
  Created
  Changed
  Removed
}
class Event<T> {
  +Kind EventKind
  +Path string
  +Payload T
}
Store <|.. FileStore
Watcher <|-- PollingWatcher
Watcher <|-- NotifyWatcher
FileStore *-- "1" Watcher : watches with
Watcher ..> Event : sends
Event --> EventKind
@enduml
```

Large, in three packages:

```plantuml
@startuml
package "server" {
  class Web {
    +Run(ctx) error
  }
  class mount
  class pageCache {
    -entries map
    +get(path) Result
  }
  interface Formatter
  interface DiagramRenderer
}
package "render" {
  class Renderer {
    +Render(src, path) Result
  }
  class Result {
    +HTML string
    +Title string
    +TOC []Heading
  }
  class Heading
  class linkTransformer
}
package "store" {
  class Store
  class FileInfo
  class Tree
  class Node
}
Web "1" *-- "many" mount
Web o-- pageCache
Web --> Formatter
Web --> DiagramRenderer
mount --> Store : reads
mount --> Renderer : renders
Renderer --> Result
Result *-- "many" Heading
Renderer *-- linkTransformer
Store --> FileInfo
Store --> Tree
Tree *-- "many" Node
Node --> Node : children
pageCache ..> Result : keeps
@enduml
```

## Activity

```plantuml
@startuml
|Reader|
start
:Open;
|Server|
:Page\nfrom cache;
|Browser|
if (plantuml?) then (yes)
  :Engine;
  fork
    :Diagrams;
  fork again
    :Code;
  end fork
  while (!include?) is (yes)
    :Library;
  endwhile (no)
else (no)
endif
|Reader|
:Read;
stop
@enduml
```

## State

```plantuml
@startuml
[*] --> Clean
Clean --> Changed : edit
Changed --> Saving : Ctrl+S
state Saving {
  [*] --> Formatting
  Formatting --> Writing
  Writing --> [*]
}
Saving --> Clean : 200
Saving --> Conflict : 409
state Sync {
  [*] --> Waiting
  Waiting --> Pushing : has commits
  Pushing --> Waiting
  --
  [*] --> Listening
  Listening --> Fetching : webhook
  Fetching --> Listening
}
Clean --> Sync
Conflict --> Changed : resolve by hand
Conflict --> [*] : cancel
@enduml
```

## Use case

```plantuml
@startuml
left to right direction
actor Reader
actor Author
actor "Bot with a token" as Bot
Author --|> Reader
rectangle scrawl {
  usecase "Read a note" as UC1
  usecase "Search" as UC2
  usecase "Edit" as UC3
  usecase "See the history" as UC4
  usecase "Export" as UC5
  usecase "Sign in" as UC6
}
Reader --> UC1
Reader --> UC2
Reader --> UC4
Reader --> UC5
Author --> UC3
Bot --> UC3
UC3 ..> UC6 : <<include>>
UC5 ..> UC1 : <<extend>>
@enduml
```

## Component

```plantuml
@startuml
left to right direction
package "scrawl" {
  [HTTP server] as http
  [Renderer] as render
  [Store] as store
  [Search] as search
  [History] as history
  [Formatter] as fmt
  [PlantUML] as uml
  interface "REST API" as api
  http - api
  http --> render
  http --> store
  http --> search
  http --> history
  http --> fmt
  http --> uml
}
database "Note files" as files
node "Worker process" as worker {
  [QuickJS] as qjs
}
cloud "Remote git" as remote
store --> files
history --> remote
fmt ..> worker
uml ..> worker
@enduml
```

## Deployment

```plantuml
@startuml
actor User
node "Laptop" {
  artifact "Browser"
}
cloud "Internet"
node "VPS" {
  node "Docker" {
    component "scrawl" as app
    folder "/data/notes" as notes
  }
  node "Caddy" as proxy
}
database "GitHub" as gh
User --> Browser
Browser --> Internet
Internet --> proxy : HTTPS
proxy --> app : HTTP :8080
app --> notes
app --> gh : git push
@enduml
```

## Object

```plantuml
@startuml
object "notes : Space" as space {
  name = "notes"
  readOnly = false
}
object "store : Store" as store {
  root = "/data/notes"
}
object "remote : Clone" as remote {
  url = "git@github.com:me/notes"
  pull = "2s"
}
map "Settings" as settings {
  formatOnSave => true
  history => on
}
space --> store
space --> remote
space --> settings
@enduml
```

## Timing

Time is in tenths of a second:

```plantuml
@startuml
scale 1 as 12 pixels
robust "Worker process" as W
concise "Export" as E
@0
W is Off
E is Waiting
@1
W is Starting
@13
W is Drawing
E is Drawing
@25
W is Idle
E is Done
@40
W is Off
@enduml
```
