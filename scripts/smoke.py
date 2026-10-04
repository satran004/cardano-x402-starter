"""Exercise live HTTP services and a 402 challenge without spending funds."""
import base64
import json
import urllib.request
import urllib.error

def request(url, body=None, headers=None):
    r=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers=headers or {})
    if body is not None: r.add_header('Content-Type','application/json')
    try: response=urllib.request.urlopen(r,timeout=25)
    except urllib.error.HTTPError as e: response=e
    text=response.read().decode()
    try: payload=json.loads(text)
    except ValueError: payload=text
    return response.status,response.headers,payload

fac='http://facilitator:4022'
api='http://resource-server:8080'
front='http://frontend:5173'
status,_,health=request(fac+'/actuator/health/readiness')
assert status==200 and health['status']=='UP',f'Facilitator not ready: {health}'
status,_,supported=request(fac+'/supported')
assert status==200 and any(k['network']=='cardano:preprod' and k['x402Version']==2 for k in supported['kinds'])
print('PASS facilitator readiness and preprod capabilities')
status,_,config=request(api+'/api/config')
assert status==200 and int(config['amount'])>=2000000 and config['payTo'].startswith('addr_test1')
status,_,block=request(api+'/api/chain/blocks/latest')
assert status==200 and block['height']>0
status,_,_=request(api+'/api/chain/tx/submit')
assert status==404
print('PASS private Blockfrost proxy and prohibited submission route')
status,_,quote=request(api+'/api/quotes',{'question':'What does a facilitator do?'})
assert status==200,quote
status,headers,required=request(api+'/api/answers/'+quote['id'])
assert status==402
assert json.loads(base64.b64decode(headers['PAYMENT-REQUIRED']))==required
terms=required['accepts'][0]
assert terms['amount']==config['amount'] and terms['payTo']==config['payTo'] and terms['extra']['confirmationPolicy']['l1Confirmations']==1
status,_,_=request(api+'/api/answers/'+quote['id'],headers={'PAYMENT-SIGNATURE':'not-base64'})
assert status==400
print('PASS durable question quote, v2 402 header, and malformed-payment rejection')
status,_,html=request(front)
assert status==200 and 'root' in html
status,_,_=request(front+'/api/config')
assert status==200
status,_,tutorial=request(front+'/tutorial.html')
assert status==200 and 'Cardano x402' in tutorial
print('PASS separate frontend, same-origin API proxy, and illustrated tutorial')
print('Live no-spend smoke checks passed. Wallet signing and funded on-chain settlement are separate checks.')
