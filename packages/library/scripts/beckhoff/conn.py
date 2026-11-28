# Parses the connection tables ("Terminal point | Name | No. | Description") of an infosys page.
import re,html
from menu import get
def text(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s))).strip()
def tables(url):
    """[(heading, rows)] rows: [(name, number, description)]"""
    s=get(url)
    out=[]
    # heading: closest preceding h1-h4 / caption / bold paragraph
    for m in re.finditer(r'<table.*?</table>',s,re.S):
        t=m.group(0)
        if not re.search(r'(?i)terminal\s*point|pin|contact|connector',text(t)[:200]): continue
        before=s[max(0,m.start()-3000):m.start()]
        heads=re.findall(r'<(?:h\d|p|caption|strong|b)[^>]*>(.*?)</(?:h\d|p|caption|strong|b)>',before,re.S)
        heading=next((text(h) for h in reversed(heads) if text(h)),'')
        cap=re.search(r'<caption[^>]*>(.*?)</caption>',t,re.S)
        if cap and text(cap.group(1)): heading=text(cap.group(1))
        rows=[]
        for r in re.findall(r'<tr.*?</tr>',t,re.S):
            cells=[text(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>',r,re.S)]
            if len(cells)>=3 and re.fullmatch(r'\d+',cells[1] or ''): rows.append((cells[0],cells[1],cells[2]))
            elif len(cells)>=2 and re.fullmatch(r'\d+',cells[1] or ''): rows.append((cells[0],cells[1],''))
        own=text(t)[:400]
        if rows: out.append((heading,rows,own,text(before)[-1500:]))
    return out
if __name__=='__main__':
    import sys
    for h,rows,own,before in tables(sys.argv[1]):
        print('##',h,'|',own[:80])
        for r in rows: print('  ',r)
