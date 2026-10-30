# Architecture

Diagrams from PlantUML's standard library. A library is loaded only
when a diagram includes it.

## C4

Context, small:

```plantuml
@startuml
!include <C4/C4_Context>
Person(author, "Author", "Writes notes")
System(scrawl, "scrawl", "Notes in markdown")
System_Ext(git, "Git host", "GitHub, Gitea")
Rel(author, scrawl, "Reads and edits")
Rel(scrawl, git, "Pushes commits", "SSH")
@enduml
```

Containers, medium, with a legend:

```plantuml
@startuml
!include <C4/C4_Container>
Person(reader, "Reader")
Person(bot, "Bot", "API with a token")
System_Boundary(scrawl, "scrawl") {
  Container(spa, "App", "React", "Reader and editor")
  Container(api, "Server", "Go", "Pages and API")
  Container(worker, "Worker process", "wasm", "Prettier, PlantUML")
  ContainerDb(files, "Notes", "markdown")
}
System_Ext(git, "Git host")
Rel(reader, spa, "Reads", "HTTPS")
Rel(bot, api, "Writes", "REST")
Rel(spa, api, "Calls", "JSON")
Rel(api, worker, "Formats, draws")
Rel(api, files, "Reads and writes")
Rel(api, git, "push, fetch")
SHOW_LEGEND()
@enduml
```

## Kubernetes

```plantuml
@startuml
!include <kubernetes/k8s-sprites-unlabeled-25pct>
actor User
rectangle "<$ing>\nIngress" as ing
rectangle "<$svc>\nService" as svc
rectangle "Namespace notes" {
  rectangle "<$deploy>\nDeployment" as dep
  rectangle "<$pod>\nscrawl-0" as pod0
  rectangle "<$pod>\nscrawl-1" as pod1
  rectangle "<$pvc>\nPVC" as pvc
  rectangle "<$secret>\ngit token" as secret
  rectangle "<$cm>\nspaces.yml" as cm
}
rectangle "<$pv>\nDisk" as pv
User --> ing
ing --> svc
svc --> pod0
svc --> pod1
dep --> pod0
dep --> pod1
pod0 --> pvc
pod0 --> secret
pod0 --> cm
pvc --> pv
@enduml
```

## tupadr3 icons

```plantuml
@startuml
!include <tupadr3/common>
!include <tupadr3/font-awesome-5/users>
!include <tupadr3/font-awesome-5/laptop>
!include <tupadr3/font-awesome-5/mobile>
!include <tupadr3/font-awesome-5/server>
!include <tupadr3/devicons/go>
!include <tupadr3/devicons/react>
!include <tupadr3/devicons/nginx>
!include <tupadr3/devicons/docker>
!include <tupadr3/devicons/postgresql>
FA5_USERS(users, "Readers")
FA5_LAPTOP(laptop, "Laptop")
FA5_MOBILE(phone, "Phone")
DEV_NGINX(nginx, "nginx", node)
FA5_SERVER(server, "Server", node) {
  DEV_DOCKER(docker, "Docker", node) {
    DEV_GO(go, "scrawl", node)
    DEV_REACT(react, "Reader", component)
  }
}
DEV_POSTGRESQL(pg, "Reports", database)
users --> laptop
users --> phone
laptop --> nginx
phone --> nginx
nginx --> go
go --> react
go ..> pg
@enduml
```

## ArchiMate

```plantuml
@startuml
!include <archimate/Archimate>
Business_Actor(author, "Author")
Business_Role(editor, "Knowledge base editor")
Business_Process(write, "Write a note")
Business_Object(note, "Note")
Application_Component(scrawl, "scrawl")
Application_Service(save, "Saving")
Technology_Node(vps, "VPS")
Rel_Assignment(author, editor)
Rel_Assignment(editor, write)
Rel_Access_w(write, note)
Rel_Serving(save, write)
Rel_Realization(scrawl, save)
Rel_Realization(vps, scrawl)
@enduml
```
