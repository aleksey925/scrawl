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

```plantuml
@startuml
autonumber
actor Author
participant Editor
participant Server
collections Index
database Git

Author -> Editor : Ctrl+S
activate Editor
Editor -> Editor : Prettier
Editor -> Server : PUT /api/file\nIf-Match: rev
activate Server
alt revision matches
  Server -> Server : write atomically
  Server -> Index : update
  Server -> Git : add + commit
  Git --> Server : sha
  group background push
    loop while there is something to push
      Server -> Git : push
      alt the remote is ahead
        Git --> Server : rejected
        Server -> Git : fetch, merge --ff-only
      else accepted
        Git --> Server : ok
      end
    end
  end
  Server --> Editor : 200 OK, rev
else revision is stale
  Server --> Editor : 409 Conflict
  note right of Editor
    The file changed
    somewhere else
  end note
end
deactivate Server
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
