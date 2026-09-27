"""Render humanizer/README.md (German report) to a print-quality PDF via Chromium.
Usage: python3 build_pdf.py <readme.md> <out.pdf>"""
import sys, os, re, datetime, markdown
from playwright.sync_api import sync_playwright
src, out = sys.argv[1], sys.argv[2]
base = os.path.dirname(os.path.abspath(src))
md = open(src).read()
# split the H1 title from the body; first paragraph becomes the meta line
title = re.search(r"^# (.+)$", md, re.M).group(1)
body_md = md.replace(f"# {title}\n", "", 1)
html_body = markdown.markdown(body_md, extensions=["tables", "fenced_code", "sane_lists", "toc"], output_format="html5")
# figures: wrap images with captions from alt text
html_body = re.sub(r'<img alt="([^"]*)" src="([^"]+)"\s*/?>', r'</p><figure><img src="\2" alt="\1"><figcaption>\1</figcaption></figure><p>', html_body)
html_body = re.sub(r'<p>\s*</p>', '', html_body)
html_body = re.sub(r'src="(?!https?://|file://|/)([^"]+)"', lambda m: 'src="file://' + os.path.join(base, m.group(1)) + '"', html_body)
import pymupdf
def _size(m):
    path = m.group(1).replace("file://", "")
    try:
        pix = pymupdf.Pixmap(path); ratio = pix.height / pix.width
    except Exception:
        ratio = 0.6
    content_w = 174.0; max_h = 105.0          # mm
    w_pct = min(100.0, max_h / (content_w * ratio) * 100.0)
    return f'<figure style="width:{w_pct:.0f}%;margin-left:auto;margin-right:auto"><img src="file://{path}"'
html_body = re.sub(r'<figure><img src="file://([^"]+)"', _size, html_body)
CSS = """
@page { size: A4; margin: 20mm 18mm 22mm 18mm; }
html { font-size: 10.6pt; }
body { font-family: "Bitstream Charter", "Liberation Serif", "DejaVu Serif", serif; color: #111; line-height: 1.42; margin: 0; }
.titleblock { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 18px; page-break-after: avoid; }
.titleblock h1 { font-family: "Liberation Sans", "DejaVu Sans", sans-serif; font-size: 22pt; line-height: 1.15; margin: 0 0 8px 0; letter-spacing: -0.01em; }
.titleblock .meta { font-family: "Liberation Sans", sans-serif; font-size: 9pt; color: #555; }
h2 { font-family: "Liberation Sans", "DejaVu Sans", sans-serif; font-size: 14pt; margin: 22px 0 8px; padding-top: 6px; border-top: 1px solid #ddd; page-break-after: avoid; }
h3 { font-family: "Liberation Sans", sans-serif; font-size: 11pt; margin: 16px 0 6px; page-break-after: avoid; }
p { margin: 0 0 8px 0; text-align: left; hyphens: auto; -webkit-hyphens: auto; }
ul, ol { margin: 0 0 8px 18px; padding: 0; }
li { margin: 0 0 4px 0; }
strong { font-weight: 700; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 8.6pt; background: #f3f2ee; padding: 0 3px; border-radius: 2px; }
pre { font-family: "DejaVu Sans Mono", monospace; font-size: 8.2pt; background: #f3f2ee; padding: 8px 10px; border-radius: 3px; white-space: pre-wrap; line-height: 1.35; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; font-family: "Liberation Sans", "DejaVu Sans", sans-serif; font-size: 8.4pt; margin: 8px 0 14px; page-break-inside: auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th { text-align: left; border-bottom: 1.5px solid #111; padding: 4px 6px; font-weight: 700; background: #fff; }
td { border-bottom: 1px solid #e2e1dc; padding: 3.5px 6px; vertical-align: top; }
tbody tr:nth-child(even) td { background: #faf9f6; }
figure { margin: 12px 0 16px; page-break-inside: avoid; text-align: center; }
img { max-width: 100%; }
figure img { width: 100%; height: auto; display: block; margin: 0 auto; }

figcaption { font-family: "Liberation Sans", sans-serif; font-size: 8.4pt; color: #555; margin-top: 4px; }
blockquote { border-left: 3px solid #ccc; margin: 8px 0; padding: 2px 12px; color: #333; }
a { color: #1a4f9c; text-decoration: none; }
.box { border: 1px solid #ccc; border-radius: 4px; padding: 10px 14px; margin: 10px 0 14px; background: #fbfaf7; page-break-inside: avoid; }
"""
now = datetime.date.today().strftime("%d.%m.%Y")
page = f"""<!doctype html><html lang="de"><head><meta charset="utf-8"><title>{title}</title><style>{CSS}</style></head>
<body><div class="titleblock"><h1>{title}</h1><div class="meta">WinFuture · ai-reviewer/humanizer · Stand {now} · Grundlage: Russell et al., StoryScope (COLM 2026)</div></div>
{html_body}</body></html>"""
html_path = out.replace(".pdf", ".html")
open(html_path, "w").write(page)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    pg = b.new_page()
    pg.goto("file://" + os.path.abspath(html_path))
    pg.wait_for_load_state("networkidle")
    pg.pdf(path=out, format="A4", print_background=True, prefer_css_page_size=True, display_header_footer=True,
           header_template='<div style="font-family:Liberation Sans,sans-serif;font-size:7.5pt;color:#777;width:100%;padding:0 18mm;">Humanisierungs-Prompt nach StoryScope — Messung, Test, Ergebnis</div>',
           footer_template='<div style="font-family:Liberation Sans,sans-serif;font-size:7.5pt;color:#777;width:100%;padding:0 18mm;display:flex;justify-content:space-between;"><span>WinFuture · humanizer</span><span>Seite <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
           margin={"top": "20mm", "bottom": "22mm", "left": "18mm", "right": "18mm"})
    b.close()
print("wrote", out, os.path.getsize(out), "bytes")
