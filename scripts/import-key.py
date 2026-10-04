#!/usr/bin/env python3
"""Import only a preprod Blockfrost token. Never print credential file contents."""
import os
import re
from pathlib import Path

target = Path(__file__).resolve().parent.parent / '.env'
source = Path.home() / 'keys'
values = set(re.findall(r'preprod[a-zA-Z0-9]+', source.read_text()))
if len(values) != 1:
    raise SystemExit('Expected one distinct preprod Blockfrost token in ~/keys; set .env manually instead.')
env = target.read_text() if target.exists() else 'PAY_TO=\nPAYMENT_AMOUNT=2000000\n'
key = next(iter(values))
env = re.sub(r'^BLOCKFROST_PROJECT_ID=.*$', 'BLOCKFROST_PROJECT_ID=' + key, env, flags=re.M) if re.search(r'^BLOCKFROST_PROJECT_ID=', env, re.M) else 'BLOCKFROST_PROJECT_ID=' + key + '\n' + env
target.write_text(env)
os.chmod(target, 0o600)
print('Preprod key imported into private .env; credential not displayed.')
