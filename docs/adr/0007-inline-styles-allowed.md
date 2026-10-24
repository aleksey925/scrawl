# 7. Inline styles are allowed, inline scripts are not

Status: accepted. Where it applies: [server](../design/server.md#guards).

## Context

`script-src` is `'self'` with nothing inline, and that is the line that stops a
script. The libraries the app uses write styles of their own at runtime.

## Decision

Styles are `'self' 'unsafe-inline'`, the way github.com has them.

## Options turned down

- A nonce on styles. It had to be threaded into mantine, `react-remove-scroll`
  and CodeMirror one by one, and mermaid takes none: it measures its labels in
  a scratch svg under a `<style>` of its own, and with that style blocked every
  diagram came out with text at the browser's default size, at the top of boxes
  cut for it.

## Consequences

- A note still cannot carry a style: the bluemonday policy in `render` refuses
  the element and the attribute whatever the header allows.
