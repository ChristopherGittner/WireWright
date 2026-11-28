import re,sys,html,urllib.request,json,os,time,hashlib
BASE='https://infosys.beckhoff.com/english/menu/'
CACHE='cache'; os.makedirs(CACHE,exist_ok=True)
def get(url):
    f=os.path.join(CACHE,hashlib.md5(url.encode()).hexdigest())
    if os.path.exists(f): return open(f,encoding='utf-8',errors='ignore').read()
    for k in range(4):
        try:
            data=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'wirewright-library-builder'}),timeout=40).read().decode('utf-8','ignore'); break
        except Exception as e:
            time.sleep(2*(k+1)); data=None
    if data is None: raise RuntimeError(url)
    open(f,'w',encoding='utf-8').write(data); return data
def children(nid):
    """children of a node: list of (id, title, href, expandable)"""
    s=get(BASE+f'menu.php?id={nid}&noHl=1&ancRel=1')
    out=[]
    # each entry: <a ... href="menu.php?id=X...">  or links to content
    for m in re.finditer(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',s,re.S):
        href,txt=m.group(1),html.unescape(re.sub(r'<[^>]+>','',m.group(2))).strip()
        out.append((href,txt))
    return s,out
if __name__=='__main__':
    s,out=children(sys.argv[1])
    for h,t in out: print(t,'|',h)
