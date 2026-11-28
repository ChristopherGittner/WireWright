import re,html,json,sys
from menu import get, BASE
def entries(nid):
    s=get(BASE+f'menu.php?id={nid}&noHl=1&ancRel=1')
    out=[]
    for m in re.finditer(r'<a[^>]*href="(https://infosys\.beckhoff\.com/content/1033/[^"]+)"[^>]*>(.*?)</a>',s,re.S):
        url=m.group(1); t=html.unescape(re.sub(r'<[^>]+>',' | ',m.group(2)))
        t=re.sub(r'\s*\|\s*(\|\s*)*',' | ',t).strip(' |')
        nid2=re.search(r'id=(\d+)',url).group(1)
        out.append({'title':t,'url':url.split('?')[0],'id':nid2})
    return out
def children(nid, parent_ids):
    root={e['id'] for e in entries(parent_ids)} if parent_ids else set()
    return [e for e in entries(nid) if e['id'] not in root and e['id']!=nid]
if __name__=='__main__':
    res={}
    for name,nid in [('EtherCAT Terminals','1665754046226245738'),('EtherCAT Box','9203986393866024696'),('Bus Terminals','602659079751629572'),('EtherCAT plug-in modules','8866154596185715741')]:
        res[name]=children(nid,'4211986674403809096')
        print(name,len(res[name]))
    json.dump(res,open('families.json','w'),indent=1)
