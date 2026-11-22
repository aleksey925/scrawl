# Icon sets

The icon sets of PlantUML's standard library, one diagram each. A set is loaded
only when a diagram includes it.

## Material Design Icons

Version 2, the default one, through its macros:

```plantuml
@startuml
!include <material/common>
!include <material/account>
!include <material/laptop>
!include <material/server>
!include <material/database>
!include <material/cloud_upload>
MA_ACCOUNT(Black, 1, reader, rectangle, "Reader")
MA_LAPTOP(Black, 1, browser, rectangle, "Browser")
MA_SERVER(Black, 1, app, rectangle, "scrawl")
MA_DATABASE(Black, 1, notes, rectangle, "Notes")
MA_CLOUD_UPLOAD(Black, 1, remote, rectangle, "Remote")
reader --> browser
browser --> app : HTTP
app --> notes : read, write
app --> remote : push
@enduml
```

Version 7, its sprites in the text:

```plantuml
@startuml
!include <material7/AccountUser/Account>
!include <material7/DeviceTech/Laptop>
!include <material7/Database/Database>
!include <material7/Cloud/CloudSync>
!include <material7/FilesFolders/FileDocument>
rectangle "<$mdiAccount>\nReader" as reader
rectangle "<$mdiLaptop>\nBrowser" as browser
rectangle "<$mdiFileDocument>\nNote" as note
rectangle "<$mdiDatabase>\nHistory" as history
rectangle "<$mdiCloudSync>\nRemote" as remote
reader --> browser
browser --> note : edit
note --> history : commit
history --> remote : push
@enduml
```

## Bootstrap Icons

```plantuml
@startuml
!include <bootstrap/bootstrap>
rectangle "<$bi-person-circle{scale=2}>\nReader" as reader
rectangle "<$bi-phone{scale=2}>\nPhone" as phone
rectangle "<$bi-laptop{scale=2}>\nLaptop" as laptop
rectangle "<$bi-hdd-stack{scale=2,color=#0d6efd}>\nscrawl" as app
rectangle "<$bi-git{scale=2,color=#f05033}>\nGit" as git
reader --> phone
reader --> laptop
phone --> app
laptop --> app
app --> git : commit, push
@enduml
```

## OpenIconic

Built in, with no include:

```plantuml
@startuml
rectangle "<&person> Reader" as reader
rectangle "<&laptop> Browser" as browser
rectangle "<&document> Note" as note
rectangle "<&clock> History" as history
rectangle "<&cloud-upload> Remote" as remote
rectangle "<&lock-locked> Sign in" as login
reader --> login
login --> browser
browser --> note : <&pencil> edit
note --> history : <&check> commit
history --> remote : <&arrow-right> push
@enduml
```
