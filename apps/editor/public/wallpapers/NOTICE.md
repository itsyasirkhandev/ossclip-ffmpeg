# Wallpaper catalog

The 17 photographs in `images/` and their picker thumbnails in `thumbnails/`
are copied unmodified from [ScreenArc](https://github.com/tamnguyenvan/screenarc)
(`public/wallpapers/`), Copyright (c) Tam Nguyen, licensed under the
GNU General Public License v3.0 — the full text is in `LICENSE` beside this
file.

They are redistributed here as an unmodified aggregate alongside ossclip's
own work; no ScreenArc code is included. Selecting one in the editor stages it
into the project's render directory on every `produce` run, exactly like a
picked image.

`wallpapers/images/wallpaper-0001.jpg` … `wallpaper-0017.jpg` are the names
the catalog is addressed by. Do not add, remove, or rename files without
updating `WALLPAPER_COUNT` and `wallpaperFile()` in
`packages/core/src/frame-style.ts` — the producer rebuilds every path from a
validated index rather than trusting a string in `overrides.json`, so the two
have to agree.
