"""Non-markdown attachment: served raw, never rendered."""

from __future__ import annotations


def slugify(title: str) -> str:
    return "-".join(title.lower().split())


if __name__ == "__main__":
    print(slugify("Hello Notes"))
