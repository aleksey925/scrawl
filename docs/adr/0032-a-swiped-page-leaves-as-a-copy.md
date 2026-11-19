# 32. A swiped page leaves as a copy of itself

Status: proposed. Where it applies: [phone](../ui/phone.md).

## Context

In an app opened from an iPhone's home screen a swipe from the left edge goes
to the folder above. The page let go slid off first, and the way back came only
after its move had ended. So the screen stood empty while the next page was
drawn, and then the next page snapped in, which read as a spring. A phone's own
back moves both pages at once: the page on top slides off while the one under
it slides in from the left.

## Decision

- A swipe let go goes back at once. The page leaves as a copy of itself, laid
  over the page gone back to, which is drawn under it and slides in as the copy
  slides off. The page under starts where it would stand under the copy and
  moves on the copy's clock and curve, so it keeps its place under the copy and
  both end together. A page that comes only after the copy has left shows in
  its place with no move of its own.
- The copy lies on a sheet as large as the screen, with the page's ground,
  above the page and under the bars. The copy takes no touch and the sheet
  takes every tap while it covers the page. The copy carries no test id, and no
  id but those of its diagrams, which get ids of their own.
- The page itself is hidden until the next one enters, three seconds at most.

## Options turned down

- View Transitions: the browser takes a picture of the old page and moves it
  over the new one. The pictures sit above everything else on the page, so the
  bar on top and the tab bar would slide off with the page, and the browser
  draws nothing new until the next page is ready, so on a slow answer the swipe
  would freeze ([quirks](../quirks.md#browsers)). Not every browser has them.
- The leave as it was, held off the edge until the next page enters, with the
  way back after its move: the screen is empty while the next page is drawn,
  and the next page comes in after the leave, not under it.
