# Fonts

The board and admin UI ask for **Prestige Elite Std** first.

That face is licensed from Adobe, so the font file can't be committed to this
repo. Drop your licensed copy in *this folder* and it will be picked up
automatically the next time the page loads — no code change needed.

Any one of these filenames works (woff2 is smallest and loads fastest):

```
public/fonts/PrestigeEliteStd.woff2      <- regular
public/fonts/PrestigeEliteStd.woff
public/fonts/PrestigeEliteStd.otf
public/fonts/PrestigeEliteStd.ttf

public/fonts/PrestigeEliteStd-Bd.woff2   <- bold (optional)
public/fonts/PrestigeEliteStd-Bd.woff
public/fonts/PrestigeEliteStd-Bd.otf
public/fonts/PrestigeEliteStd-Bd.ttf
```

If you have the `.otf` from Adobe, you can convert it to `.woff2` at
<https://transfonter.org> or with `fonttools`:

```bash
pip install fonttools brotli
fonttools ttLib.woff2 compress PrestigeEliteStd.otf
```

Until a file is present, the pages fall back to `Courier Prime` → `Courier New`
→ the system monospace, which keeps the same typewriter feel and the same
metrics-driven layout.

**Note on the Pi:** installing the font into the Raspberry Pi's system fonts is
*not* enough on its own — the page is served to a browser, so the file needs to
live here where the browser can fetch it.
