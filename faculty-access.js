/* Shared Firebase identity and faculty portal helpers for Spark Basic Mode. */
window.UCVM=(()=>{
 const config={apiKey:'AIzaSyDS9VE2zTXv0656_Mh0uDXB67-mZ5Y_LkY',authDomain:'tester-teaching.firebaseapp.com',projectId:'tester-teaching',storageBucket:'tester-teaching.firebasestorage.app',messagingSenderId:'566638053186',appId:'1:566638053186:web:90e04b52251c4b859baadb'};
 const rawRole=r=>String((r&&typeof r==='object'?r.role:r)||'').toLowerCase();
 const role=r=>({owner:'adfa_general',administrator:'adfa_regular',other_office:'adfa_regular',adfa_general:'adfa_general',adfa_regular:'adfa_regular',admin:'adfa_regular',editor:'faculty',viewer:'faculty'}[rawRole(r)]||rawRole(r));
 const admin=p=>['adfa_general','adfa_regular'].includes(role(p?.role));
 const general=p=>role(p?.role)==='adfa_general';
 const label=r=>({owner:'Owner',adfa_general:'Owner',administrator:'Administrator',adfa_regular:'Administrator',admin:'Administrator',other_office:'Other Office',hicc:'HICC',visc:'VISC',faculty:'Faculty',editor:'Faculty',viewer:'Faculty'}[rawRole(r)]||rawRole(r));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function installWeekTimeAlignmentFix(){if(document.getElementById('ucvm-week-time-alignment-fix'))return;const style=document.createElement('style');style.id='ucvm-week-time-alignment-fix';style.textContent='.tg-track{top:0!important;bottom:0!important}.tg-block{position:absolute!important}';document.head.appendChild(style)}
 installWeekTimeAlignmentFix();
 function installStableWeekLanes(){
  const keyFor=b=>(b.querySelector('.tg-block-l1')?.textContent||b.dataset.sessionId||'').trim().toLowerCase();
  const alignColumn=col=>{
   const items=[...col.querySelectorAll('.tg-block')].map(block=>{const start=parseFloat(block.style.top),height=parseFloat(block.style.height);return{block,key:keyFor(block),start,end:start+height,lane:0}}).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)).sort((a,b)=>a.start-b.start||a.end-b.end);
   if(!items.length)return;
   const preferred=new Map();let group=[],groupMaxEnd=-Infinity;
   const flush=()=>{
    if(!group.length)return;
    if(group.length===1){const x=group[0];x.block.style.left='2px';x.block.style.right='auto';x.block.style.width='calc(100% - 4px)';group=[];groupMaxEnd=-Infinity;return}
    const laneEnds=[];
    group.forEach(x=>{let lane=-1,p=preferred.get(x.key);if(Number.isInteger(p)&&(laneEnds[p]??-Infinity)<=x.start+0.0001)lane=p;if(lane<0)lane=laneEnds.findIndex(end=>end<=x.start+0.0001);if(lane<0)lane=laneEnds.length;laneEnds[lane]=x.end;x.lane=lane;if(!preferred.has(x.key))preferred.set(x.key,lane)});
    const laneCount=Math.max(1,laneEnds.length),laneWidth=100/laneCount;
    group.forEach(x=>{x.block.style.left=`calc(${x.lane*laneWidth}% + 2px)`;x.block.style.right='auto';x.block.style.width=`calc(${laneWidth}% - 4px)`});
    group=[];groupMaxEnd=-Infinity;
   };
   items.forEach(x=>{if(group.length&&x.start>=groupMaxEnd-0.0001)flush();group.push(x);groupMaxEnd=Math.max(groupMaxEnd,x.end)});flush();
  };
  let queued=false;const align=()=>document.querySelectorAll('.tg-day-col').forEach(alignColumn);const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;align()})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',queue,{once:true});else queue();
  new MutationObserver(m=>{if(m.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.tg-day-col,.tg-block')||n.querySelector?.('.tg-day-col,.tg-block')))))queue()}).observe(document.documentElement,{childList:true,subtree:true});
 }
 installStableWeekLanes();
 function init(){if(!firebase.apps.length)firebase.initializeApp(config);return {auth:firebase.auth(),db:firebase.firestore()};}
 function installLandingReset(){if(window.__ucvmLandingResetInstalled||typeof firebase==='undefined')return;window.__ucvmLandingResetInstalled=true;try{firebase.auth().onAuthStateChanged(u=>{if(!u)sessionStorage.removeItem('ucvm-admin-default-landing')})}catch(_){}}
 async function linkFacultyIdentity(user,p){
  if(admin(p))return;
  const emails=[user?.email,p?.email].map(v=>String(v||'').trim()).filter((v,i,a)=>v&&a.indexOf(v)===i);
  for(const email of emails){
   try{
    const q=await firebase.firestore().collection('faculty').where('email','==',email).limit(2).get();
    if(q.empty)continue;
    const d=q.docs[0],f=d.data()||{},raw=String(f.preferredFullName||f.hrFullName||f.name||'').trim(),comma=raw.match(/^([^,]+),\s*(.+)$/),firstLast=String(f.hrFirstLast||f.teachingAssignmentName||((f.firstName&&f.lastName)?`${f.firstName} ${f.lastName}`:'')||(comma?`${comma[2]} ${comma[1]}`:'')||raw||p.instructor||p.name||'').trim(),name=firstLast;
    if(!p.facultyId)p.facultyId=d.id||f.ucid||'';
    if(name)p.instructor=name;
    p.facultyDirectoryMatch={id:d.id,email,name};
    return;
   }catch(_){/* Keep the account usable even if the optional directory match is unavailable. */}
  }
 }
 async function ready(user,p){if(!p?.active)throw Error('This account is inactive.');if(p.mustChangePassword){location.replace('password.html');return false}installLandingReset();await linkFacultyIdentity(user,p);const page=(location.pathname.split('/').pop()||'index.html').toLowerCase(),raw=rawRole(p);if(page==='index.html'&&['owner','administrator','adfa_general','adfa_regular','admin'].includes(raw)){try{if(sessionStorage.getItem('ucvm-admin-default-landing')!==user.uid){sessionStorage.setItem('ucvm-admin-default-landing',user.uid);location.replace('faculty-admin.html');return false}}catch(_){}}return true}
 function watch(user,p){let initial=true;return firebase.firestore().doc(`users/${user.uid}`).onSnapshot(s=>{const n=s.data();if(initial){initial=false;return}if(!n||['role','active','mustChangePassword'].some(k=>n[k]!==p[k]))location.reload()})}
 const value=v=>v===null||v===undefined?'—':Array.isArray(v)?v.map(x=>typeof x==='object'?`${x.name||x.ucid||''}${x.role?' ('+x.role+')':''}`:String(x)).filter(Boolean).join('; '):typeof v==='object'?JSON.stringify(v):String(v);
 const time=e=>e.changedAt?.toDate?e.changedAt.toDate().toLocaleString('en-CA',{timeZone:'America/Edmonton'}):'Pending';
 function normalizeEntry(raw,source){const e={...raw,source};if(Array.isArray(e.changes)&&e.changes.length)return e;if(source==='session'&&e.action==='swap_faculty')e.changes=[{field:'assignments',label:'Faculty',before:e.fromFaculty?.name||e.fromFaculty?.ucid||'',after:e.toFaculty?.name||e.toFaculty?.ucid||''}];else if(source==='session'&&e.action==='create')e.changes=[{field:'session',label:'Session',before:null,after:[e.course,e.date,e.topic].filter(Boolean).join(' · ')}];else if(source==='session'&&e.action==='delete')e.changes=[{field:'session',label:'Session',before:[e.course,e.date,e.topic].filter(Boolean).join(' · '),after:null}];else if(source==='faculty'&&e.action==='create')e.changes=[{field:'faculty',label:'Faculty record',before:null,after:e.facultyName||e.facultyId}];else if(source==='faculty'&&e.action==='delete')e.changes=[{field:'faculty',label:'Faculty record',before:e.facultyName||e.facultyId,after:null}];else e.changes=[];return e}
 async function logs(container,{includeFaculty=false}={}){
  includeFaculty=includeFaculty||container?.id==='faculty-audit';
  const {db}=init();let entries=[],loading=false;const cursors={session:null,faculty:null};const exhausted={session:false,faculty:!includeFaculty};
  container.innerHTML='<p>Session additions, deletions, time, name and faculty changes. Times shown in Calgary time. Spark Basic Mode records changes made through these dashboard pages.</p><label>Search loaded history <input id="audit-search" placeholder="Course, name, person or change"></label> <select id="audit-kind" aria-label="Change type"><option value="">All changes</option><option value="create">Added</option><option value="delete">Deleted</option><option value="time">Time/date</option><option value="name">Name</option><option value="faculty">Faculty</option></select><p id="audit-status" role="status"></p><div class="table-scroll"><table><thead><tr><th>When (Calgary)</th><th>By whom</th><th>Session / record</th><th>Action</th><th>Before → after</th></tr></thead><tbody id="audit-body"></tbody></table></div><button id="audit-more">Load older changes</button>';
  const $=id=>container.querySelector('#'+id),actionLabel=a=>({create:'Added',delete:'Deleted',update:'Changed',update_doe_roles:'DOE roles / override changed',swap_faculty:'Faculty changed',replace_from_all_faculty_summaries:'Timetable synchronized',replace_and_sync_all_faculty_summaries:'Faculty/timetable synchronized',replace_away_from_campus_afc:'AFC imported',replace_workload_doe_breakdown_2026_27:'Workload DOE imported'})[a]||a||'Changed';
  function kindMatch(e,kind){if(!kind)return true;if(kind==='create'||kind==='delete')return e.action===kind;return(e.changes||[]).some(c=>kind==='time'?['date','start','end'].includes(c.field):kind==='name'?/name|topic/i.test(`${c.field} ${c.label}`):kind==='faculty'?/faculty|assignment/i.test(`${c.field} ${c.label}`):false)}
  function render(){const q=$('audit-search').value.toLowerCase(),kind=$('audit-kind').value;const rows=entries.filter(e=>(!q||JSON.stringify(e).toLowerCase().includes(q))&&kindMatch(e,kind));$('audit-body').innerHTML=rows.map(e=>`<tr><td>${esc(time(e))}</td><td>${esc(e.changedByName||e.changedBy||'Unknown')}<small>${esc(e.changedByEmail||'')}</small></td><td>${esc([e.course,e.date,e.topic].filter(Boolean).join(' · ')||e.facultyName||e.facultyId||e.sessionId||e.recordId||'Record')}</td><td>${esc(actionLabel(e.action))}</td><td>${(e.changes||[]).map(c=>`<div><strong>${esc(c.label||c.field||'Change')}:</strong> ${esc(value(c.before))} → ${esc(value(c.after))}</div>`).join('')||'<span>Legacy entry; detailed before/after values were not recorded.</span>'}</td></tr>`).join('')||'<tr><td colspan="5">No matching changes.</td></tr>'}
  async function page(collection,key){if(exhausted[key])return;let q=db.collection(collection).orderBy('changedAt','desc').limit(50);if(cursors[key])q=q.startAfter(cursors[key]);const s=await q.get();entries.push(...s.docs.map(d=>normalizeEntry({id:d.id,...d.data()},key)));cursors[key]=s.docs.at(-1)||cursors[key];if(s.size<50)exhausted[key]=true}
  async function more(){if(loading)return;loading=true;$('audit-more').disabled=true;$('audit-status').textContent='Loading changes…';try{await page('session_change_log','session');if(includeFaculty)await page('faculty_change_log','faculty');entries.sort((a,b)=>{const at=a.changedAt?.toMillis?a.changedAt.toMillis():0,bt=b.changedAt?.toMillis?b.changedAt.toMillis():0;return bt-at});render();$('audit-more').hidden=exhausted.session&&exhausted.faculty;$('audit-status').textContent=`${entries.length} changes loaded. Basic Mode logs dashboard-originated writes; direct Firebase Console edits are not automatically logged.`}catch(e){$('audit-status').textContent='Could not load history: '+e.message}finally{loading=false;$('audit-more').disabled=false}}
  $('audit-search').oninput=render;$('audit-kind').onchange=render;$('audit-more').onclick=more;await more()
 }
 const snapshots=new WeakMap();
 const fieldValue=(form,name,initial=false)=>{const el=form?.elements?.namedItem(name);if(!el)return null;if(el.tagName==='SELECT'&&initial){const o=[...el.options].find(x=>x.defaultSelected);return o?o.value:el.options[0]?.value??''}return initial?(el.defaultValue??''):el.value};
 const instructorState=form=>[...form.querySelectorAll('[data-instructor-select]')].map(sel=>({ucid:sel.value,name:(sel.selectedOptions[0]?.textContent||'').replace(/\s+—\s+(UNAVAILABLE|CHECK NEEDED).*$/,'').trim()}));
 function sessionState(form,initial=false){const out={};for(const [f,l] of [['date','Date'],['start','Start time'],['end','End time'],['course','Course'],['topic','Session name'],['type','Session type'],['room','Room']])out[f]={label:l,value:fieldValue(form,f,initial)};out.assignments={label:'Faculty',value:instructorState(form)};return out}
 function facultyState(form,initial=false){const out={};for(const [f,l] of [['ucid','UCID'],['preferredFullName','Preferred name'],['hrFullName','HR full name'],['firstName','First name'],['lastName','Last name'],['email','Email'],['reportsTo','Reports to'],['assignedAD','Assigned AD'],['currentTitle','Current title'],['rank','Rank'],['teachingArea','Teaching area'],['teachingAreaEmphasis','Teaching emphasis'],['fte','FTE'],['campus','Campus'],['office','Office']])out[f]={label:l,value:fieldValue(form,f,initial)};return out}
 function changes(before,after,creating=false,deleting=false){const out=[];for(const key of Object.keys(after||before||{})){const b=deleting?before[key]?.value:(creating?null:before[key]?.value),a=deleting?null:after[key]?.value;if(JSON.stringify(b??null)!==JSON.stringify(a??null))out.push({field:key,label:(after[key]||before[key]).label,before:b??null,after:a??null})}return out}
 function watchForms(){const inspect=()=>{const sf=document.getElementById('session-form');if(sf&&!snapshots.has(sf))snapshots.set(sf,{kind:'session',creating:!document.getElementById('delete-session'),before:sessionState(sf,true)});const ff=document.getElementById('edit-form');if(ff&&!ff.children.length)snapshots.delete(ff);if(ff&&ff.children.length&&!snapshots.has(ff))snapshots.set(ff,{kind:'faculty',creating:(document.getElementById('edit-title')?.textContent||'').includes('Add'),before:facultyState(ff,true)})};inspect();new MutationObserver(inspect).observe(document.documentElement,{childList:true,subtree:true})}
 async function actorName(db,user){try{const s=await db.doc(`users/${user.uid}`).get();return s.data()?.name||user.displayName||user.email||user.uid}catch(_){return user.displayName||user.email||user.uid}}
 async function patchRecent(collection,matcher,patch){const {auth,db}=init(),user=auth.currentUser;if(!user)return;const s=await db.collection(collection).orderBy('changedAt','desc').limit(20).get(),now=Date.now();const d=s.docs.find(doc=>{const x=doc.data(),ms=x.changedAt?.toMillis?x.changedAt.toMillis():0;return x.changedBy===user.uid&&now-ms<30000&&matcher(x)});if(d)await d.ref.update({...patch,changedByEmail:user.email||''})}
 function waitClosed(form,kind,fn){let n=0;const t=setInterval(()=>{n++;const done=kind==='faculty'?(!form.children.length||document.getElementById('edit-modal')?.classList.contains('hidden')):!form.isConnected;if(done){clearInterval(t);fn().catch(()=>{})}else if(n>=30)clearInterval(t)},500)}
 document.addEventListener('submit',ev=>{const form=ev.target,s=snapshots.get(form);if(!s)return;const after=s.kind==='session'?sessionState(form,false):facultyState(form,false),detail=changes(s.before,after,s.creating,false);if(!detail.length&&!s.creating)return;waitClosed(form,s.kind,async()=>{const {auth,db}=init(),user=auth.currentUser;if(!user)return;const name=await actorName(db,user);if(s.kind==='session'){const action=s.creating?'create':'update',v=k=>after[k]?.value||'';await patchRecent('session_change_log',x=>x.action===action&&String(x.course||'')===String(v('course'))&&String(x.date||'')===String(v('date'))&&String(x.topic||'')===String(v('topic')),{changes:detail,changedByName:name})}else{const action=s.creating?'create':'update',id=after.ucid?.value||s.before.ucid?.value||'';await patchRecent('faculty_change_log',x=>x.action===action&&String(x.facultyId||'')===String(id),{changes:detail,facultyName:after.preferredFullName?.value||after.hrFullName?.value||id,changedByName:name})}})},true);
 document.addEventListener('click',ev=>{const b=ev.target.closest?.('#delete-session');if(!b)return;const form=document.getElementById('session-form'),s=form&&snapshots.get(form);if(!form||!s)return;const detail=changes(s.before,s.before,false,true);waitClosed(form,'session',async()=>{const v=k=>s.before[k]?.value||'';await patchRecent('session_change_log',x=>x.action==='delete'&&String(x.course||'')===String(v('course'))&&String(x.date||'')===String(v('date'))&&String(x.topic||'')===String(v('topic')),{changes:detail})})},true);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watchForms,{once:true});else watchForms();
 return {config,role,admin,general,label,esc,init,ready,watch,logs};
})();

(()=>{
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 const load=(src,key)=>{if(document.querySelector(`script[data-${key}]`))return;const s=document.createElement('script');s.src=src;s.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]='1';s.async=false;document.head.appendChild(s)};
 const run=()=>{if(page==='index.html')load('approval-workflow.js','ucvm-approval-workflow');if(page==='faculty-admin.html')load('faculty-admin-enhancements.js','ucvm-faculty-admin-enhancements')};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(run,0),{once:true});else setTimeout(run,0);
})();