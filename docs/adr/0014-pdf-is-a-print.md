# 14. A PDF is a print of the note on screen

Status: accepted. Where it applies: [command line](../design/cli.md).

## Decision

The export menu offers PDF as the browser's print of the note on screen.

## Options turned down

- Make the PDF on the server: no engine that lays out HTML fits in the binary.

## Consequences

- The print depends on each browser's print rules, and the page carries fixes
  for Safari and Firefox.
