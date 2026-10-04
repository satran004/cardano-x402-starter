#!/usr/bin/env python3
"""Render this repository's limited Markdown syntax to portable, illustrated HTML."""
import html
import re
import shutil
from pathlib import Path

root=Path(__file__).resolve().parent.parent

def inline(text):
    tokens=[]
    def stash(value):
        tokens.append(value)
        return '\x00'+str(len(tokens)-1)+'\x00'
    text=re.sub(r'`([^`]+)`',lambda m:stash('<code>'+html.escape(m[1])+'</code>'),text)
    text=re.sub(r'!\[([^]]*)\]\(([^)]+)\)',lambda m:stash('<img src="'+html.escape(m[2],quote=True)+'" alt="'+html.escape(m[1],quote=True)+'"/>'),text)
    def link(m):
        url=m[2]
        if url.endswith('.md') and not url.startswith('http'): url=url[:-3]+'.html'
        return stash('<a href="'+html.escape(url,quote=True)+'">'+html.escape(m[1])+'</a>')
    text=re.sub(r'\[([^]]+)\]\(([^)]+)\)',link,text)
    text=html.escape(text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    for i,token in enumerate(tokens): text=text.replace('\x00'+str(i)+'\x00',token)
    return text

def render(source):
    lines=source.splitlines(); out=[]; i=0
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
            out.append(f'<h{level} id="{anchor}">'+inline(text)+f'</h{level}>');i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=[c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r'[: -]+',c) for c in cells): rows.append(cells)
                i+=1
            out.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in rows[0])+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>' for row in rows[1:])+'</tbody></table></div>');continue
        if re.match(r'^\d+\. |^- ',line):
            ordered=bool(re.match(r'^\d+\. ',line));tag='ol' if ordered else 'ul';items=[]
            while i<len(lines) and re.match(r'^\d+\. |^- ',lines[i]):
                items.append('<li>'+inline(re.sub(r'^\d+\. |^- ','',lines[i]))+'</li>');i+=1
            out.append('<'+tag+'>'+''.join(items)+'</'+tag+'>');continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|```|\||\d+\. |\- )',lines[i]): paragraph.append(lines[i]);i+=1
        out.append('<p>'+inline(' '.join(paragraph))+'</p>')
    return '\n'.join(out)

css='''body{margin:0;background:#0a111b;color:#d6e1e7;font:16px/1.75 system-ui,sans-serif}nav{padding:22px 6%;border-bottom:1px solid #294134;display:flex;gap:22px;font-size:13px;color:#a6ecc6}nav a:first-child{margin-right:auto;font-weight:700}main{max-width:920px;margin:auto;padding:48px 28px 80px}h1{font-size:42px;letter-spacing:-1.5px;line-height:1.15;color:#f1f6f4;margin:0 0 28px}h2{font-size:25px;letter-spacing:-.5px;color:#a6ecc6;margin:50px 0 14px}p{margin:18px 0}a{color:#a6ecc6;text-underline-offset:4px}strong{color:#eef7f2}img{width:100%;height:auto;margin:20px 0;border-radius:14px}code{background:#182838;color:#bcebcf;padding:2px 5px;border-radius:4px;font-size:13px;overflow-wrap:anywhere}pre{background:#101c29;border:1px solid #314756;border-radius:10px;padding:22px;overflow:auto;font-size:13px;line-height:1.6}pre code{background:transparent;padding:0;overflow-wrap:normal}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #314756;padding:13px;text-align:left;vertical-align:top}th{background:#172c27;color:#a6ecc6}.table-wrap{overflow:auto;margin:24px 0}li{margin:12px 0;padding-left:4px}footer{border-top:1px solid #314756;margin-top:50px;padding-top:20px;font-size:12px;color:#8ca0b2}@media(max-width:600px){h1{font-size:32px}main{padding:30px 18px}nav{padding:18px;font-size:11px;gap:12px}}'''
public=root/'frontend/public'
public.mkdir(parents=True,exist_ok=True)
for name in ['tutorial','architecture','validation']:
    source=root/'docs'/f'{name}.md'
    if not source.exists(): continue
    markdown=source.read_text();title=markdown.splitlines()[0].lstrip('# ')
    page='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(title)+'</title><style>'+css+'</style></head><body><nav><a href="/">Cardano x402</a><a href="tutorial.html">Tutorial</a><a href="architecture.html">Architecture</a><a href="validation.html">Validation</a></nav><main>'+render(markdown)+'<footer>Local Cardano preprod demo · Test ADA only · x402 v2</footer></main></body></html>'
    (root/'docs'/f'{name}.html').write_text(page)
    (public/f'{name}.html').write_text(page)
shutil.copytree(root/'docs/images',public/'images',dirs_exist_ok=True)
print('Rendered local documentation and copied illustrated pages into frontend/public.')
