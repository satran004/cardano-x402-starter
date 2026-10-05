#!/usr/bin/env python3
"""Render this repository's limited Markdown syntax to portable, illustrated HTML."""
import html
import argparse
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

root=Path(__file__).resolve().parent.parent
repository='https://github.com/satran004/cardano-x402-starter'
pages={
    'index': (root/'docs/index.md', 'Overview'),
    'tutorial': (root/'docs/tutorial.md', 'Tutorial'),
    'wire-format': (root/'docs/wire-format.md', 'HTTP messages'),
    'javascript': (root/'resource-server-js/README.md', 'JavaScript'),
    'architecture': (root/'docs/architecture.md', 'Architecture'),
    'validation': (root/'docs/validation.md', 'Validation'),
}

def resolve_link(url, source, home):
    parsed=urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path: return url
    target=(source.parent/parsed.path).resolve()
    for name,(path,_) in pages.items():
        if target==path.resolve(): return urlunsplit(('', '', (home if name=='index' else name)+'.html', parsed.query, parsed.fragment))
    if parsed.path.endswith('.md'):
        return repository+'/blob/main/'+target.relative_to(root).as_posix()+('#'+parsed.fragment if parsed.fragment else '')
    return url

def inline(text, source, home):
    tokens=[]
    def stash(value):
        tokens.append(value)
        return '\x00'+str(len(tokens)-1)+'\x00'
    text=re.sub(r'`([^`]+)`',lambda m:stash('<code>'+html.escape(m[1])+'</code>'),text)
    text=re.sub(r'!\[([^]]*)\]\(([^)]+)\)',lambda m:stash('<img src="'+html.escape(m[2],quote=True)+'" alt="'+html.escape(m[1],quote=True)+'"/>'),text)
    def link(m):
        url=resolve_link(m[2], source, home)
        return stash('<a href="'+html.escape(url,quote=True)+'">'+html.escape(m[1])+'</a>')
    text=re.sub(r'\[([^]]+)\]\(([^)]+)\)',link,text)
    text=html.escape(text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    for i,token in enumerate(tokens): text=text.replace('\x00'+str(i)+'\x00',token)
    return text

def render(markdown, source, home):
    lines=markdown.splitlines(); out=[]; i=0
    while i<len(lines):
        line=lines[i]
        if not line.strip(): i+=1; continue
        if line.startswith('```'):
            code=[];i+=1
            while i<len(lines) and not lines[i].startswith('```'): code.append(lines[i]);i+=1
            out.append('<pre><code>'+html.escape('\n'.join(code))+'</code></pre>');i+=1;continue
        if line.startswith('#'):
            level=len(line)-len(line.lstrip('#'));text=line[level:].strip()
            anchor=re.sub(r'[^a-z0-9]+','-',text.lower()).strip('-')
            out.append(f'<h{level} id="{anchor}">'+inline(text,source,home)+f'</h{level}>');i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=[c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r'[: -]+',c) for c in cells): rows.append(cells)
                i+=1
            out.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+inline(c,source,home)+'</th>' for c in rows[0])+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+inline(c,source,home)+'</td>' for c in row)+'</tr>' for row in rows[1:])+'</tbody></table></div>');continue
        if re.match(r'^\d+\. |^- ',line):
            ordered=bool(re.match(r'^\d+\. ',line));tag='ol' if ordered else 'ul';items=[]
            while i<len(lines) and re.match(r'^\d+\. |^- ',lines[i]):
                items.append('<li>'+inline(re.sub(r'^\d+\. |^- ','',lines[i]),source,home)+'</li>');i+=1
            out.append('<'+tag+'>'+''.join(items)+'</'+tag+'>');continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|```|\||\d+\. |\- )',lines[i]): paragraph.append(lines[i]);i+=1
        out.append('<p>'+inline(' '.join(paragraph),source,home)+'</p>')
    return '\n'.join(out)

css='''
*{box-sizing:border-box}
body{margin:0;background:#f7faf8;color:#24352f;font:16px/1.75 system-ui,sans-serif;color-scheme:light}
nav{padding:22px 6%;border-bottom:1px solid #ccd9d1;background:#fff;display:flex;flex-wrap:wrap;align-items:center;gap:22px;font-size:13px}
nav a{text-decoration:none}
nav a:first-child{margin-right:auto;font-weight:700}
nav a[aria-current=page]{color:#132d24;text-decoration:underline}
nav .brand{font-size:16px}
nav .repository{margin-left:auto}
.layout{max-width:1260px;margin:auto;display:grid;grid-template-columns:240px minmax(0,920px);gap:36px;padding:0 28px}
main{width:100%;max-width:920px;min-width:0;padding:40px 24px 72px;margin:0}
h1{font-size:38px;letter-spacing:-1.5px;line-height:1.15;color:#132d24;margin:0 0 28px}
h2{font-size:25px;letter-spacing:-.5px;color:#166448;margin:50px 0 14px}
h3{color:#254d3d;margin-top:32px}
h2,h3{scroll-margin-top:24px}
p{margin:18px 0}
a{color:#176649;text-underline-offset:4px}
a:hover{color:#0e4933}
a:focus-visible,summary:focus-visible{outline:2px solid #176649;outline-offset:4px;border-radius:3px}
strong{color:#132d24}
img{width:100%;height:auto;margin:20px 0;border-radius:14px}
code{background:#e8f0eb;color:#254d3d;padding:2px 5px;border-radius:4px;font:13px ui-monospace,monospace;overflow-wrap:anywhere}
pre{background:#edf4f0;border:1px solid #ccd9d1;border-radius:10px;padding:22px;overflow:auto;font-size:13px;line-height:1.6}
pre code{background:transparent;padding:0;overflow-wrap:normal}
table{border-collapse:collapse;width:100%;font-size:13px;background:#fff}
th,td{border:1px solid #ccd9d1;padding:13px;text-align:left;vertical-align:top}
th{background:#eaf3ed;color:#254d3d}
.table-wrap{overflow:auto;margin:24px 0}
li{margin:12px 0;padding-left:4px}
.contents{position:sticky;top:24px;align-self:start;max-height:85vh;overflow:auto;padding:40px 8px;font-size:13px}
.contents summary{color:#53685e;font-weight:600;margin-bottom:16px;cursor:pointer}
.contents ul{list-style:none;padding:0;margin:0}
.contents li{padding:0;margin:12px 0;line-height:1.5}
.contents a{color:#53685e;text-decoration:none}
.contents a:hover{color:#176649}
.skip-link{position:absolute;left:16px;top:-80px;padding:10px;background:#e8f0eb;z-index:1}
.skip-link:focus{top:12px}
footer{border-top:1px solid #ccd9d1;margin-top:50px;padding-top:20px;font-size:12px;color:#53685e}
footer a{margin-right:18px}
@media(max-width:900px){.layout{grid-template-columns:1fr;gap:0;padding:0 16px}.contents{position:static;max-height:none;padding:22px 24px 0}.contents ul{display:flex;flex-wrap:wrap;gap:10px 18px}.contents li{margin:0}.contents a{font-size:12px}main{padding-top:28px}}
@media(max-width:600px){nav{gap:14px;padding:18px 20px;font-size:11px}nav .brand{width:100%;margin:0}nav .repository{margin-left:0}main{padding:28px 8px 64px}h1{font-size:32px}.contents{padding:20px 8px 0}th,td{padding:10px}}
'''

def build(destination, hosted, home='index'):
    destination.mkdir(parents=True,exist_ok=True)
    for name,(source,label) in pages.items():
        markdown=source.read_text();title=markdown.splitlines()[0].lstrip('# ')
        headings=[line[3:].strip() for line in markdown.splitlines() if line.startswith('## ')]
        toc='<details open><summary>On this page</summary><ul>'+''.join('<li><a href="#'+re.sub(r'[^a-z0-9]+','-',heading.lower()).strip('-')+'">'+html.escape(heading)+'</a></li>' for heading in headings)+'</ul></details>'
        nav='<a class="brand" href="'+home+'.html">Cardano x402 starter</a>'+''.join('<a href="'+key+'.html"'+(' aria-current="page"' if key==name else '')+'>'+text+'</a>' for key,(_,text) in pages.items() if key!='index')
        nav+='<a class="repository" href="'+repository+'">GitHub ↗</a>'
        if not hosted: nav+='<a href="/">Local demo ↗</a>'
        source_url=repository+'/blob/main/'+source.relative_to(root).as_posix()
        page='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2212%22 fill=%22%23e5efe8%22/%3E%3Ctext x=%2232%22 y=%2246%22 text-anchor=%22middle%22 font-size=%2246%22 fill=%22%23166448%22%3E%E2%82%B3%3C/text%3E%3C/svg%3E"><meta name="description" content="Learn x402 payments on Cardano with a Spring Boot or JavaScript resource server, browser wallet, and CF facilitator."><title>'+html.escape(title)+' · Cardano x402 starter</title><style>'+css+'</style></head><body><a class="skip-link" href="#content">Skip to content</a><nav aria-label="Documentation">'+nav+'</nav><div class="layout"><aside class="contents" aria-label="Page contents">'+toc+'</aside><main id="content">'+render(markdown,source,home)+'<footer><a href="'+source_url+'">View Markdown source</a>Cardano preprod learning example · Test ADA · x402 v2</footer></main></div><script>if (matchMedia("(max-width: 900px)").matches) document.querySelector(".contents details").open = false;</script></body></html>'
        (destination/((home if name=='index' else name)+'.html')).write_text(page)
    images=destination/'images';images.mkdir(exist_ok=True)
    for image in (root/'docs/images').iterdir():
        if image.suffix in {'.svg','.png'} and image.resolve()!=(images/image.name).resolve():
            shutil.copyfile(image,images/image.name)
    if hosted: (destination/'.nojekyll').touch()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-dir',type=Path,help='Build only a standalone documentation site into this directory.')
    args=parser.parse_args()
    if args.site_dir:
        build(args.site_dir,hosted=True)
        print('Built standalone documentation in '+str(args.site_dir))
    else:
        build(root/'docs',hosted=False)
        build(root/'frontend/public',hosted=False,home='docs')
        print('Rendered local documentation and copied illustrated pages into frontend/public.')
