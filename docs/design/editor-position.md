# Editor position

How the editor opens where the reader was, and how the split panes follow each
other.

## Opening at the reader's place

- The editor opens where the reader was. The rendered page carries the source
  line range of every block it emits, so the position crosses as a line and not
  as a pixel offset, and both panes are held at it until the preview has
  arrived and the document has stopped moving.
- The position is the top edge of the screen, on both sides. Taken a quarter
  down, it kept what sat above it at its rendered height, and in the wrapped
  source on a phone the heading at the top went under the toolbar. The edge
  often cuts a sliver off the block above, and that sliver is a line or two of
  source, so a block that starts in the top quarter is the anchor, kept at its
  distance from the edge; only a block that fills the top is anchored where it
  is cut. The anchor is always a line the other side can place exactly: a
  block's first line, a row of code, never the middle of a paragraph, an
  opening fence or an alert's marker. A position the reader did not move goes
  back as it came, because each side picks the block nearest its own top and a
  round trip with no scroll in it crept every time. The source is placed with
  codemirror's `scrollIntoView` and never by setting `scrollTop`, because the
  height of a line not drawn yet is an estimate, hundreds of pixels off in a
  wrapped note. A line's top is read off its glyph and not its line box, since
  the glyph is what `scrollIntoView` lines up, and the space between the two
  crept on every round trip.

## Split panes

- In the split editor only the pane the reader is working in moves the other,
  and an interaction on a pane is what makes it that one. A scroll event says
  an element moved, never who moved it, so two panes that both follow never
  settle: each lands a little off where the other put it, and the page shakes
  under a finger that is already scrolling. A flag around the programmatic move
  does not help - the echo arrives a frame later, after any rendering callback
  has cleared it.
- The follower is placed by interpolating between measured pixel pairs, the top
  and bottom of every rendered block with the document ends around them, and
  never by way of a source line
  ([ADR 16](../adr/0016-scroll-sync-by-pixel-pairs.md)). The pairs are measured
  once per layout, because a wheel sends an event a frame and a long note has
  hundreds of blocks.
