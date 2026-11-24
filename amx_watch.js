(()=>{
const SEL='[data-role="agent"],.msg.agent',seen=new WeakSet();
const CUE=/\b(will|within|shortly|by (tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const DONE=/\b(has been|have been|is now|was) (processed|completed|issued|shipped|resolved|dispatched|refunded)\b/i;
const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const company=()=>document.querySelector('[data-company]')?.dataset.company||location.hostname;
function due(t){let m,n=Date.now(),D=864e5;
 if(m=t.match(/within (\d+) (business |working )?(day|hour)s?/i))return n+(/hour/i.test(m[3])?+m[1]*36e5:+m[1]*D*(m[2]?1.4:1));
 if(/tomorrow/i.test(t))return n+D;
 if(/today/i.test(t))return n+D/2;
 if(m=t.match(/by (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i)){const x=new Date(),k=DAYS.indexOf(m[1].toLowerCase());x.setDate(x.getDate()+((k-x.getDay()+7)%7||7));x.setHours(18,0,0,0);return +x;}
 if(/shortly/i.test(t))return n+D*2;return null;}
async function llm(text,key){const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Extract the company promise from this support message. Reply ONLY JSON {"promise":"","deadline_hours":number or null,"condition":string or null}, or null if no promise.\n'+text}]}]})});
 const j=await r.json();return JSON.parse(j.candidates[0].content.parts[0].text.replace(/```json|```/g,'').trim());}
function toast(html,onYes){const d=document.createElement('div');
 d.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;background:#111827;color:#fff;font:14px system-ui;padding:14px;border-radius:12px;box-shadow:0 8px 30px #0006;border-left:4px solid #f59e0b';
 d.innerHTML='<b style="color:#f59e0b">AFTERMATH LIVE</b><div style="margin:8px 0">'+html+'</div>';
 const mk=(t,bg,f)=>{const b=document.createElement('button');b.textContent=t;b.style.cssText='margin-right:8px;padding:6px 12px;border:0;border-radius:8px;cursor:pointer;color:#fff;background:'+bg;b.onclick=()=>{d.remove();f&&f()};d.appendChild(b)};
 mk('Confirm','#16a34a',onYes);mk('Dismiss','#4b5563');document.body.appendChild(d);}
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function handle(el){const text=el.innerText.trim();if(!text)return;
 let {items=[],geminiKey}=await chrome.storage.local.get(['items','geminiKey']);const co=company();
 if(DONE.test(text)){const it=[...items].reverse().find(i=>i.company===co&&!i.claimed&&!i.verified);
  if(!it)return;toast('Company <b>claims</b> it is done: “'+esc(text.slice(0,110))+'”<br>Log as CLAIMED for “'+esc(it.promise.slice(0,60))+'”?',async()=>{
   it.claimed={text,at:Date.now()};await chrome.storage.local.set({items});});return;}
 if(!CUE.test(text))return;
 const sentence=text.split(/(?<=[.!?])\s+/).find(s=>CUE.test(s))||text;
 let p={promise:sentence,due:due(sentence),condition:(sentence.match(/\b(provided|if|once|subject to|after)\b[^.]*/i)||[])[0]||null};
 if(geminiKey){try{const r=await llm(text,geminiKey);if(r){p.promise=r.promise||p.promise;if(r.deadline_hours)p.due=Date.now()+r.deadline_hours*36e5;p.condition=r.condition||p.condition;}}catch(e){console.warn('LLM failed, using local extractor')}}
 toast('<b>Promise detected</b><br>'+esc(co)+': “'+esc(p.promise)+'”<br>Due: '+(p.due?new Date(p.due).toLocaleString():'unspecified')+(p.condition?'<br>Condition: '+esc(p.condition):''),async()=>{
  items.push({id:Date.now(),company:co,...p,evidence:text,chat:location.href,created:Date.now(),claimed:null,observed:null,verified:false});
  await chrome.storage.local.set({items});});}
function scan(n){if(n.nodeType!==1)return;const els=n.matches(SEL)?[n]:[...n.querySelectorAll(SEL)];
 els.forEach(e=>{if(seen.has(e))return;seen.add(e);setTimeout(()=>handle(e),400)});}
document.querySelectorAll(SEL).forEach(e=>seen.add(e));
new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
})();
