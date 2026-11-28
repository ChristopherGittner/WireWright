# New Beckhoff device definitions from the crawled infosys connection pages.
import json,re,glob,collections,os
from conn import tables
from mapper import channels, kind_of, table_pns, PN
lib=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../src/devices/plc-beckhoff.json')))
have={x['partNumber'] for x in lib}
pages=[p for f in sorted(glob.glob('pages-*.json')) if 'Box' not in f for p in json.load(open(f))]
fams={}
for g in json.load(open('families.json')).values():
    for e in g:
        t=e['title'].split(' | '); fams[t[0]]=(t[1] if len(t)>1 else t[0])
found=collections.OrderedDict()   # pn -> (rows,url,family)
for pg in pages:
    try: ts=tables(pg['url'])
    except Exception as ex: print('ERR',pg['url'],ex); continue
    fam=pg['family']
    for h,rows,own,before in ts:
        pns=table_pns(h,own,before) or PN.findall(pg['title']) or PN.findall(fam)
        for pn in dict.fromkeys(pns):
            if pn in have or pn in found: continue
            found[pn]=(rows,pg['url'],fam)
# part numbers named in family titles (single products) without a connection table: part only
for fam in fams:
    for pn in PN.findall(fam):
        if pn not in have and pn not in found: found[pn]=(None,None,fam)
out=[]
for pn,(rows,url,fam) in found.items():
    kind=kind_of(pn)
    chs=channels(rows,kind) if rows and kind else []
    sub=fams.get(fam,fam)
    name=f'Beckhoff {pn}, {sub}' if sub and sub!=fam else f'Beckhoff {pn}'
    d={'id':'beckhoff.'+pn.lower(),'name':{'de':name,'en':name},'category':'plc.cpu' if re.match(r'(EK|CX|BK|BC|BX)',pn) else 'plc.beckhoff','manufacturer':'Beckhoff','partNumber':pn}
    if chs:
        d['description']={'de':f'Klemmenbelegung aus der Beckhoff-Dokumentation, Stand 2026-11: {url}','en':f'Pin assignment from the Beckhoff documentation, as of 2026-11: {url}'}
    else:
        src=f': {url}' if url else ''
        d['description']={'de':f'Ohne Kanalliste (Sonderklemme oder Versorgung); Anschlussbelegung in der Beckhoff-Dokumentation{src}','en':f'Without a channel list (special or supply terminal); connection in the Beckhoff documentation{src}'}
    fn=[{'symbol':'wirewright.plc.card','main':True,'label':{'de':'Kartenübersicht','en':'Card overview'}}]
    for c in chs:
        pins=[e['pin'] for e in c.get('extraPins',[]) if not e.get('after')]+[c['pin']]+[e['pin'] for e in c.get('extraPins',[]) if e.get('after')]
        fn.append({'symbol':f"wirewright.plc.{c['kind'].lower()}{'.'+str(len(pins)) if len(pins)>1 else ''}",'channel':c['channel'],'pins':{str(k+1):p for k,p in enumerate(pins)},'label':f"{c['kind']} {c['channel']} (pin {', '.join(pins)})"})
    d['functions']=fn
    if chs: d['plc']={'channels':chs}
    out.append(d)
json.dump(out,open('new-devices.json','w'),indent=2,ensure_ascii=False)
c=collections.Counter((re.match(r'[A-Z]+\d?',x['partNumber']).group(0), 'ch' if 'plc' in x else 'part') for x in out)
print(len(out)); print(sorted(c.items()))
