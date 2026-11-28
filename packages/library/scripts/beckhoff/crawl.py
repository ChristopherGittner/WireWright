# Walks the documentation of each Beckhoff family on infosys and collects the pages about
# connections / pin assignments (title match), with their family. Output: pages.json
import json,re,sys,time
from tree import entries
SKIP=re.compile(r'(?i)^(foreword|basics communication|commissioning|appendix|twincat|object description|ethercat basics|guidelines|notes on|safety|documentation issue|version identification|support|firmware|restoring|diagnostics|process data|settings|configuration|application|example|sample|startup|cooling|installation positions|mounting and demounting|disposal|uL notice|ATEX|ex marking|beckhoff identification)')
WANT=re.compile(r'(?i)(connection|pin assignment|terminal point|contact assignment|connector|pin-out|pinout|wiring)')
fams=json.load(open('families.json'))
out=[]
def walk(nid, visible, depth, family):
    ents=entries(nid)
    kids=[e for e in ents if e['id'] not in visible and e['id']!=nid]
    vis=visible|{e['id'] for e in ents}
    for e in kids:
        t=e['title'].split(' | ')[0]
        if WANT.search(t): out.append({**e,'family':family})
        if depth<3 and not SKIP.search(t):
            walk(e['id'], vis, depth+1, family)
group=sys.argv[1]
base={e['id'] for e in entries({'EtherCAT Terminals':'1665754046226245738','EtherCAT Box':'9203986393866024696','Bus Terminals':'602659079751629572','EtherCAT plug-in modules':'8866154596185715741'}[group])}
for f in fams[group]:
    name=f['title'].split(' | ')[0]
    if re.search(r'(?i)system manual|infrastructure|analog manual',name): continue
    try: walk(f['id'], base, 1, name)
    except Exception as ex: print('ERR',name,ex,flush=True)
    print(name, len(out), flush=True)
json.dump(out,open(f'pages-{group.replace(" ","_")}.json','w'),indent=1)
