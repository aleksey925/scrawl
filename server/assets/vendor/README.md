# Vendored libraries

Third-party code, checked in on purpose. The NAS this runs on may have
no internet access and the CSP is `script-src 'self'`, so nothing may be
pulled from a CDN at runtime. Everything here is embedded with
`//go:embed` and served from `/static/<version>/vendor/...`.

Both libraries are loaded lazily by `assets/js/math.js` and
`assets/js/diagram.js`: a page with no math and no diagram downloads
neither.

## KaTeX 0.18.5

Math typesetting. <https://katex.org>

Source: `https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.18.5/`
License: MIT.

| file | note |
|---|---|
| `katex/katex.min.js` | UMD build, defines `window.katex` |
| `katex/katex.min.css` | edited, see below |
| `katex/fonts/*.woff2` | the 20 faces `katex.min.css` declares |

`katex.min.css` is the upstream file with the `.woff` and `.ttf`
fallbacks removed from every `@font-face`, so only the 20 `.woff2` files
have to be vendored. Nothing else was touched. To refresh it:

```sh
sed -E 's/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)//g'
```

`sha256(katex.min.js) = 30c9f7c07bf54d341ffd8f16dc6632766f12b16d0a064e2a08f2d6b1744396a6`

## Mermaid 11.15.0

Diagrams. <https://mermaid.js.org>

Source: `https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.15.0/mermaid.min.js`
License: MIT.

The UMD bundle, unmodified, defines `globalThis.mermaid`. It is one
3.3 MB file because that build carries every diagram type; the ESM build
splits into 81 chunks for the same total, which is not worth the extra
files here.

`sha256(mermaid.min.js) = 70137e77bb273bb2ef972b86e8b0400cca8be53cb25bfc45911a186dc98665de`

## Size

| | bytes |
|---|---|
| KaTeX (js + css + 20 fonts) | 554 563 |
| Mermaid | 3 312 967 |
| total | 3 867 530 |
