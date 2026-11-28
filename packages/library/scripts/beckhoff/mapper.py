# Turns a Beckhoff connection table into Wirewright channels (same conventions as plc-beckhoff.json).
import re
from conn import tables, get, text
PN=re.compile(r'\b(E[LMPJDQRS]{1,2}X?\d{4}(?:-\d{4})?|K[LSM]\d{4}(?:-\d{4})?)\b')
SUPPLY=re.compile(r'(?i)^(\+?\s?\d+\s?V( DC)?|0 ?V|GND|AGND|Ground|PE|⏚|Shield|S|L|N|L/\+|N/0 V|Uv\d*|U[sv]|\+Us|n\.c\.|NC|n\.c|-|24 V|\+24V|0V)$')
def kind_of(pn):
    m=re.match(r'E[LJDP]{1,2}(\d)|K[LS](\d)|ELM(\d)|EPP?(\d)|EQ(\d)|ER(\d)',pn)
    d=next(g for g in m.groups() if g) if m else '0'
    return {'1':'DI','2':'DO','3':'AI','4':'AO'}.get(d)
def chan_num(name,desc):
    m=re.match(r'(?i)ch\.?\s?(\d+)\b',name)
    if m: return int(m.group(1))
    m=re.match(r'(?i)relay\s*(\d+),',desc)
    if m: return int(m.group(1))
    m=re.search(r'(\d+)\s*\'?$',name) if not re.fullmatch(r'\+?\d+\s?V.*|\d+',name) else None
    if m and not SUPPLY.match(name): return int(m.group(1))
    m=re.search(r'(?i)\b(?:input|output|channel|relay|sensor|signal|contact)\s*(\d+)\b',desc)
    if m: return int(m.group(1))
    m=re.search(r'(\d+)$',name)
    if m and SUPPLY.match(re.sub(r'\s?\d+$','',name)): return int(m.group(1))
    return None
def is_signal(name,desc,kind):
    if re.search(r'(?i)relay \d+, NO contact',desc): return True
    if re.search(r'(?i)relay \d+, (common|NC)',desc): return False
    name=re.sub(r'(?i)^ch\.?\s?\d+\s*','',name)
    if not name:  # "Ch 1" with the signal in the description
        dl=desc.lower()
        return {'DI':('input','digital input'),'DO':('output','digital output'),'AI':('input','analog input','+input'),'AO':('output','analog output','+output')}.get(kind,()) and dl.startswith({'DI':('input','digital input'),'DO':('output','digital output'),'AI':('input','analog input','+input'),'AO':('output','analog output','+output')}[kind])
    if SUPPLY.match(name): return False
    n=name.lower()
    if kind=='DI': return bool(re.match(r'(input|in|i|di|e)\s*\d+$',n)) or desc.lower().startswith('input')
    if kind=='DO': return bool(re.match(r'(output|out|o|do|a|q|relay)\s*\d+$',n)) or desc.lower().startswith(('output','relay'))
    return bool(re.match(r'(\+?input|\+in|in|i|u|\+u|u\+|\+r|r\+|\+tc|tc\+|\+output|output|out|ai|ao)\s*\d*\+?$',n)) or desc.lower().startswith(('input','output','+input','+output'))
def label(name): return 'PE' if name=='⏚' else name
def norm(n):
    n=n.strip()
    n=re.sub(r'\s*\(.*\)$','',n) if re.match(r'\d \d',n) else n
    n=re.sub(r'^(\d) (\d)$',r'\1\2',n)
    n=re.sub(r'^([+-])\s+',r'\1',n)
    n=re.sub(r'\s*/\s*','/',n) if re.search(r'\bN\s*/\s*0',n) else n
    return n
def shared(desc):
    m=re.search(r'(?i)internally connected (?:to|with) terminal points? ([\d, and]+)',desc)
    return bool(m) and len(re.findall(r'\d+',m.group(1)))>=4
def channels(rows,kind):
    rows=[(norm(n),int(no),d) for n,no,d in rows if not re.fullmatch(r'(?i)-|n\.?\s?c\.?|not connected|',n.strip()) and not re.match(r'(?i)not connected',d)]
    nums=[chan_num(n,d) for n,_,d in rows]
    sig={}
    for (n,no,d),c in zip(rows,nums):
        if c is not None and c not in sig and is_signal(n,d,kind): sig[c]=(n,no)
    if not sig: return []
    # abbreviated tables ("Ch 1 … Ch 16"): fill channels between two signal terminals in step
    ks=sorted(sig)
    for a,b in zip(ks,ks[1:]):
        pa,pb=sig[a][1],sig[b][1]
        used={no for _,no,_ in rows}
        if b-a>1 and pb-pa==b-a and not any(pa<p<pb for p in used):
            for k in range(a+1,b): sig[k]=(re.sub(str(a),str(k),sig[a][0]),pa+k-a)
    # unnumbered (not shared) terminals go to the nearest signal terminal in the same column of 4
    owner=[None]*len(rows)
    sigpins={no:c for c,(n,no) in sig.items()}
    for k,((n,no,d),c) in enumerate(zip(rows,nums)):
        if c is not None or no in sigpins: owner[k]=c; continue
        col=(no-1)//4
        best=sorted((abs(no-p),p) for p in sigpins if (p-1)//4==col and p!=no)
        owner[k]=sigpins[best[0][1]] if best else None
    out=[]
    for c in sorted(sig):
        n,no=sig[c]
        extra=[]
        for (rn,rno,rd),cn,ow in zip(rows,nums,owner):
            if rno==no: continue
            if shared(rd): continue
            if cn==c: extra.append((0,rno,label(re.sub(r'(?i)^ch\.?\s?\d+\s*','',rn))))
            elif cn is None and ow==c: extra.append((1+abs(rno-no)/100,rno,label(rn)))
        # one terminal per label (the nearest); channel-numbered terminals first
        seen=set(); keep=[]
        for e in sorted(extra):
            lab=re.sub(r'\s*\d+$','',e[2]) if e[0]>=1 else e[2]
            if (e[0]>=1 and lab in seen): continue
            seen.add(lab); keep.append(e)
        extra=keep
        # unnumbered terminals shared by several channels: leave out
        extra=sorted(extra)[:3]; extra.sort(key=lambda e:e[1])
        ch={'channel':c,'kind':kind,'pin':str(no)}
        n2=re.sub(r'(?i)^ch\.?\s?\d+\s*','',n)
        if n2 and not re.fullmatch(rf'(?i)(input|output)\s*{c}',n2): ch['pinLabel']=n2
        if extra: ch['extraPins']=[{'pin':str(p),'label':l,'after':True} for _,p,l in extra]
        out.append(ch)
    return out
def table_pns(h,own,before):
    for src in (own,h,before[-400:],before):
        found=PN.findall(src)
        if found: return found
    return []
def table_for(url,pn):
    ts=tables(url)
    for h,rows,own,before in ts:
        if pn in table_pns(h,own,before): return rows
    return ts[0][1] if len(ts)==1 else None
