"""Render the controlled Chinese Markdown guide to standalone HTML, without dependencies."""
from pathlib import Path
import html
import re

root=Path(__file__).resolve().parents[1]
source=(root/'README_使用说明.md').read_text(encoding='utf-8')

def inline(value):
    value=html.escape(value)
    value=re.sub(r'!\[([^\]]+)\]\(([^)]+)\)',r'<figure><img src="\2" alt="\1"><figcaption>\1</figcaption></figure>',value)
    value=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',value)
    value=re.sub(r'`([^`]+)`',r'<code>\1</code>',value)
    return re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',value)

lines=source.splitlines();output=[];toc=[];index=0;list_kind=None;heading_index=0
def close_list():
    global list_kind
    if list_kind:output.append('</'+list_kind+'>');list_kind=None
while index<len(lines):
    line=lines[index].strip()
    if not line:close_list();index+=1;continue
    if line.startswith('#'):
        close_list();level=len(line)-len(line.lstrip('#'));title=line[level:].strip();heading_index+=1;anchor='section-'+str(heading_index)
        output.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
        if level==2:toc.append((anchor,title))
    elif line.startswith('|'):
        close_list();table=[]
        while index<len(lines) and lines[index].strip().startswith('|'):
            cells=[x.strip() for x in lines[index].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-+:?',x) for x in cells):table.append(cells)
            index+=1
        output.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in table[0])+'</tr></thead><tbody>')
        for row in table[1:]:output.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>')
        output.append('</tbody></table></div>');continue
    elif re.match(r'^\d+\. ',line) or line.startswith('- '):
        kind='ol' if re.match(r'^\d+\. ',line) else 'ul'
        if list_kind!=kind:close_list();output.append('<'+kind+'>');list_kind=kind
        content=re.sub(r'^\d+\. |^- ','',line);output.append('<li>'+inline(content)+'</li>')
    else:
        close_list();output.append(inline(line) if line.startswith('![') else '<p>'+inline(line)+'</p>')
    index+=1
close_list()
css='''body{margin:0;background:#f3f2ec;color:#253c30;font:17px/1.9 "Segoe UI","Microsoft YaHei",sans-serif}header{padding:32px 8vw;background:#245742;color:#fff}header p{margin:5px 0;font-size:14px;letter-spacing:1px}header strong{font-size:30px}.layout{display:grid;grid-template-columns:230px minmax(0,930px);gap:28px;max-width:1240px;margin:30px auto;padding:0 22px}nav{position:sticky;top:22px;align-self:start;background:#e8ede3;border-radius:12px;padding:20px;font-size:14px}nav a{display:block;margin:8px 0;color:#31583e;text-decoration:none}main{background:#fffdf8;border:1px solid #d9e0d3;border-radius:14px;padding:38px;min-width:0}h1{font-size:32px;line-height:1.4;margin-top:0}h2{font-size:24px;line-height:1.5;margin-top:44px;border-top:1px solid #d9e0d3;padding-top:24px;scroll-margin-top:20px}p,li{overflow-wrap:anywhere}li{padding-left:5px;margin:12px 0}code{background:#edf1e6;padding:2px 5px;border-radius:4px;font:14px/1.7 Consolas,monospace}a{color:#22634b}strong{color:#204d38}.table-wrap{overflow-x:auto;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.75}td,th{padding:11px 13px;text-align:left;border:1px solid #d7dfd1;vertical-align:top}th{background:#e8efe1}tr:nth-child(even) td{background:#f5f7f0}figure{margin:24px 0}img{display:block;max-width:100%;max-height:700px;object-fit:contain;border:1px solid #cbd8c5;border-radius:10px}figcaption{font-size:13px;color:#5c6c5c;margin-top:7px}footer{padding:20px;text-align:center;color:#5c6c5c;font-size:13px}@media(max-width:900px){.layout{display:block;margin:18px auto;padding:0 14px}nav{position:static;margin-bottom:20px}main{padding:22px}h1{font-size:28px}h2{font-size:22px}header{padding:25px}}@media print{body{background:white;font-size:11pt}.layout{display:block;padding:0;margin:0}nav,header{display:none}main{border:0;padding:0}h2{break-after:avoid}tr,img{break-inside:avoid}a{color:inherit}}'''
navigation=''.join(f'<a href="#{a}">{html.escape(t)}</a>' for a,t in toc)
document='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMG 真实采集详细使用说明</title><style>'+css+'</style></head><body><header><p>BN5213 · EMG INTEGRATION 1.4.0</p><strong>短促激活确认，自动进入下一题</strong><p>中文使用说明 · 英文操作界面</p></header><div class="layout"><nav aria-label="说明目录"><strong>按步骤查看</strong>'+navigation+'</nav><main>'+''.join(output)+'</main></div><footer>本机项目使用说明 · 2026-11-20 · 如需 PDF，可使用浏览器打印并另存为 PDF</footer></body></html>'
for name in ['USER_GUIDE_ZH.html','使用说明.html']:(root/name).write_text(document,encoding='utf-8')
print('Built two standalone HTML guide entry points.')
