const $=id=>document.getElementById(id),S=chrome.storage.local;
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function draw(){const {items=[],skew=0}=await S.get(['items','skew']);const now=Date.now()+skew;
 $('clk').textContent='Ledger clock: '+new Date(now).toLocaleString()+(skew?' (simulated)':'');
 $('list').innerHTML=items.length?'':'<div class=card>No commitments yet. Open the demo chat, let the agent make a promise, and confirm it.</div>';
 items.slice().reverse().forEach(i=>{
  const od=!i.verified&&i.due&&i.due<now,ct=i.claimed&&i.observed&&i.observed.ok===false;
  const on=[1,!!i.claimed,!!i.observed,i.verified];
  const d=document.createElement('div');d.className='card'+(ct||od?' bad':'');
  d.innerHTML=`<div class=top><div><span class=co>${esc(i.company)}</span><div>“${esc(i.promise)}”</div></div><div>
  ${i.verified?'<span class="flag ok">VERIFIED</span>':''}${ct?'<span class=flag>CONTRADICTION</span>':''}${od&&!ct?'<span class=flag>OVERDUE</span>':''}${!od&&!i.verified&&!ct?'<span class="flag w">OPEN</span>':''}</div></div>
  <div class=m>Due: ${i.due?new Date(i.due).toLocaleString():'unspecified'}${i.condition?' · Condition: '+esc(i.condition):''}</div>
  <div class=steps>
  <div class="s ${on[0]?'on':''}"><b>PROMISED</b>${esc(i.promise.slice(0,50))}</div>
  <div class="s ${on[1]?'on':''}"><b>CLAIMED</b>${i.claimed?esc(i.claimed.text.slice(0,50)):'—'}</div>
  <div class="s ${on[2]?'on':''}"><b>OBSERVED</b>${i.observed?esc(i.observed.note):'—'}</div>
  <div class="s vf ${on[3]?'on':''}"><b>VERIFIED</b>${i.verified?'Evidence supports it':'Not yet verified'}</div></div>
  <details><summary class=m>Evidence from chat</summary><div class=m>${esc(i.evidence)}</div></details>
  <div class=act>${i.verified?'':`<button data-a=ok>✓ It happened</button><button data-a=no>✗ It didn’t</button>${i.observed?.ok?'<button data-a=ver>Mark VERIFIED</button>':''}`}<button data-a=del>Delete</button></div>`;
  d.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const a=b.dataset.a;
   if(a==='del')items.splice(items.indexOf(i),1);
   else if(a==='ver')i.verified=true;
   else{const n=prompt(a==='ok'?'What did you observe? (e.g. Refund visible in bank)':'What did you observe? (e.g. No money in my account)');if(n===null)return;i.observed={ok:a==='ok',note:n||(a==='ok'?'Outcome seen':'Outcome not seen'),at:Date.now()};}
   await S.set({items});});
  $('list').appendChild(d);});}
$('ff').onclick=async()=>S.set({skew:((await S.get('skew')).skew||0)+3*864e5});
$('rs').onclick=()=>S.set({skew:0});
$('cl').onclick=()=>confirm('Delete all commitments?')&&S.set({items:[]});
$('ex').onclick=async()=>{const {items=[]}=await S.get('items');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(items,null,2)],{type:'application/json'}));a.download='promise_ledger.json';a.click();};
$('sv').onclick=async()=>{await S.set({geminiKey:$('key').value.trim()});alert('Saved');};
chrome.storage.onChanged.addListener(draw);draw();setInterval(draw,30000);
