# 12. A webhook delivery is a trigger, never a payload

Status: accepted. Where it applies:
[remote sync](../design/remote-sync.md#webhook).

## Context

The webhook is an optional second trigger for the same `Sync` the pull ticker
runs. `Sync` takes the history lock for a network round trip.

## Decision

A verified POST only starts a `Sync`: no JSON is parsed, no event type is read,
no branch is filtered. The endpoint answers `202` and never runs git itself,
and deliveries coalesce through one channel of capacity one.

## Options turned down

- Read the payload. A GitLab token is the secret itself in a header and signs
  nothing of the body, so a plain token is usable only because nothing in the
  body is used.
- Run `Sync` inline: it would block every save for the length of somebody
  else's network.

## Consequences

- `history` knows nothing about the webhook.
