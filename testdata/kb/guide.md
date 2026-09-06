# Guide

Back to the [index](index.md).

## Table

| language | fence tag | used for |
|---|---|---|
| Go | `go` | the server itself |
| Python | `python` | helper scripts |
| SQL | `sql` | reporting queries |
| Bash | `bash` | one-off commands |

## Code fences

```go
package main

func main() {
	println("hello")
}
```

```python
def greet(name: str) -> str:
    return f"hello, {name}"
```

```sql
select path, count(*) as hits
from page_views
where viewed_at > now() - interval '7 days'
group by path
order by hits desc;
```

```bash
curl -sS http://localhost:8080/ping
```

## Task list

- [x] render tables
- [x] highlight code
- [ ] render mermaid diagrams
- [ ] export to PDF

## Blockquote

> Every filesystem operation goes through `store`, which is built on
> `os.Root`, so path traversal is impossible by construction.
>
> -- the architecture contract

## Collapsible block

<details markdown="span">
<summary>Raw HTML has to survive sanitizing</summary>

The block below is a **markdown** list inside a `details` element:

- first
- second

</details>

## Attachments

- the [python snippet](snippet.py) is served raw, not rendered
- the [logo](images/logo.png) is an image in a sibling directory
- this [dangling link](notes/gone.md) must be marked as broken

![Logo](images/logo.png)
