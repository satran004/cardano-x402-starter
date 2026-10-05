#!/usr/bin/env python3
"""Validate the Pages artifact: relative navigation, existing assets and section anchors."""
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.ids=[];self.links=[];self.has_main=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if 'id' in attrs: self.ids.append(attrs['id'])
        if tag=='main': self.has_main=True
        for key in ('href','src'):
            if key in attrs: self.links.append(attrs[key])

def check(directory):
    directory=directory.resolve()
    expected={'index.html','tutorial.html','wire-format.html','javascript.html','architecture.html','validation.html',
        'images/payment-flow.svg','images/payment-flow.png','images/http-messages.svg','.nojekyll'}
    actual={p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
    assert actual==expected, f'Unexpected or missing published files: {actual ^ expected}'
    pages={}
    for name in expected:
        if not name.endswith('.html'): continue
        page=Page();page.feed((directory/name).read_text());pages[directory/name]=page
        duplicates=[key for key,n in Counter(page.ids).items() if n>1]
        assert not duplicates, f'{name}: duplicate section IDs {duplicates}'
        assert page.has_main, f'{name}: missing main content'
    checked=0
    for source,page in pages.items():
        for url in page.links:
            parsed=urlsplit(url)
            if parsed.scheme or parsed.netloc: continue
            assert not parsed.path.startswith('/'), f'{source.name}: root-relative link breaks project Pages: {url}'
            target=(source.parent/unquote(parsed.path)).resolve() if parsed.path else source
            assert target.is_relative_to(directory), f'{source.name}: link escapes published site: {url}'
            assert target.is_file(), f'{source.name}: missing link/asset: {url}'
            if parsed.fragment and target in pages:
                assert unquote(parsed.fragment) in pages[target].ids, f'{source.name}: missing anchor: {url}'
            checked+=1
    print(f'PASS: {len(pages)} documentation pages, {checked} local links/assets, and publication allowlist.')

if __name__=='__main__':
    check(Path(sys.argv[1] if len(sys.argv)>1 else '_site'))
