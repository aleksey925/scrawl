"""Turn a note title into a file name."""

from __future__ import annotations

import sys


def slugify(title: str) -> str:
    return "-".join(title.lower().split())


if __name__ == "__main__":
    print(slugify(" ".join(sys.argv[1:]) or "Meeting notes"))
