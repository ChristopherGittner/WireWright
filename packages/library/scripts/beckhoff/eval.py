import json,re,sys,os
from mapper import *
d=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../src/devices/plc-beckhoff.json')))
strip=lambda chs:[(c['channel'],c['pin'],tuple(e['pin'] for e in c.get('extraPins',[]))) for c in chs]
ok=lab=bad=0; bads=[]
for x in d:
    m=re.search(r'https://infosys\S+',x['description']['en'])
    if not m or 'plc' not in x: continue
    rows=table_for(m.group(0),x['partNumber'])
    got=channels(rows,x['plc']['channels'][0]['kind']) if rows else []
    if got==x['plc']['channels']: ok+=1
    elif strip(got)==strip(x['plc']['channels']): lab+=1
    else: bad+=1; bads.append(x['partNumber'])
print('exact',ok,'same terminals, other labels',lab,'different',bad); print(bads)
