/* HICC timetable + Spark-safe approval workflow for the main timetable only. */
(()=>{
 'use strict';
 if(!window.UCVM||typeof firebase==='undefined')return;
 const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
 if(page&&page!=='index.html')return;

 const {auth,db}=UCVM.init();
 const $=id=>document.getElementById(id), esc=UCVM.esc;
 const REQUESTS='change_requests', SESSIONS='sessions', LOGS='session_change_log';
 let me=null,user=null,role='',sessions=new Map(),people=[],peopleByUid=new Map(),groups=[],myGroups=[],hiccScope=new Set();
 let hiccMode=false,requests=[],requestUnsub=null,sessionUnsub=null,groupUnsub=null,peopleUnsub=null,renderQueued=false;

 const css=document.createElement('style');
 css.id='ucvm-approval-workflow-style';
 css.textContent=`
 .workflow-btn{padding:5px 12px;font-size:12px;font-weight:650;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-2);white-space:nowrap}
 .workflow-btn:hover,.workflow-btn.active{border-color:var(--uc-red,#d6001c);color:var(--uc-red,#d6001c)}
 .workflow-count{display:inline-flex;min-width:18px;height:18px;padding:0 5px;align-items:center;justify-content:center;margin-left:4px;border-radius:999px;background:var(--uc-red,#d6001c);color:#fff;font-size:9px;font-weight:800}
 .workflow-modal-box{width:min(980px,96vw)!important;max-height:90vh;overflow:auto}
 .workflow-note{font-size:11px;color:var(--text-3);line-height:1.45;margin:6px 0 12px}
 .workflow-card{border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin:8px 0;background:var(--surface)}
 .workflow-card.pending{border-left:4px solid #b7791f}.workflow-card.approved{border-left:4px solid #287a3f}.workflow-card.rejected{border-left:4px solid #b91c1c}
 .workflow-card-head{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}.workflow-card-title{font-weight:800}.workflow-card-meta{font-size:10px;color:var(--text-3)}
 .workflow-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.workflow-grid .form-field{margin:0}
 .workflow-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.workflow-pill{display:inline-block;padding:2px 6px;border:1px solid var(--border);border-radius:999px;font-size:9.5px;font-weight:750}
 .workflow-hidden-by-hicc{display:none!important}.workflow-session-pending{outline:2px dashed #b7791f;outline-offset:-2px}
 .workflow-approval-change{margin-top:6px;font-size:11px}.workflow-approval-change strong{display:inline-block;min-width:90px}
 @media(max-width:680px){.workflow-grid{grid-template-columns:1fr}}
 `;
 document.head.appendChild(css);

 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const stamp=()=>firebase.firestore.FieldValue.serverTimestamp();
 const roleIsFaculty=r=>['faculty','hicc','visc'].includes(UCVM.role(r));
 const isApprover=()=>['adfa_general','adfa_regular'].includes(role);
 const ownFacultyId=()=>String(me?.facultyId||me?.facultyDirectoryMatch?.id||'').trim();
 const ownAliases=()=>new Set([me?.name,me?.instructor,me?.facultyDirectoryMatch?.name,user?.displayName].map(norm).filter(Boolean));
 const peopleName=p=>String(p?.name||p?.email||p?.uid||'');
 const assignedArray=s=>Array.isArray(s?.assignments)&&s.assignments.length?s.assignments.map(a=>({...a})):(String(s?.instructor||'').split(';').map(x=>x.trim()).filter(Boolean).map(name=>({name,ucid:'',role:s?.type||''})));
 const sameVal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 const ymd=v=>String(v||'').slice(0,10);

 function showModal(html){
  const modal=$('modal'); if(!modal)return;
  modal.innerHTML=`<div class="modal-box workflow-modal-box">${html}</div>`;
  modal.classList.add('open');
  modal.querySelectorAll('[data-workflow-close]').forEach(b=>b.onclick=()=>closeModal());
 }
 function closeModal(){const modal=$('modal');if(!modal)return;modal.classList.remove('open');modal.innerHTML=''}
 function toast(msg,error=false){
  const t=$('toast'); if(!t){alert(msg);return} t.textContent=msg;t.classList.toggle('error',error);t.classList.add('show');setTimeout(()=>t.classList.remove('show'),error?6000:3200);
 }

 async function loadPeopleOnce(){
  if(!roleIsFaculty(role))return;
  const q=await db.collection('users').where('role','in',['faculty','hicc','visc']).get();
  people=q.docs.map(d=>({uid:d.id,...d.data(),role:UCVM.role(d.data().role)})).filter(p=>p.active===true);
  peopleByUid=new Map(people.map(p=>[p.uid,p]));
 }
 function listenPeople(){
  if(peopleUnsub){peopleUnsub();peopleUnsub=null}
  if(!roleIsFaculty(role))return;
  peopleUnsub=db.collection('users').where('role','in',['faculty','hicc','visc']).onSnapshot(q=>{
    people=q.docs.map(d=>({uid:d.id,...d.data(),role:UCVM.role(d.data().role)})).filter(p=>p.active===true);
    peopleByUid=new Map(people.map(p=>[p.uid,p]));
    rebuildHiccScope();
  },e=>console.warn('[workflow people]',e));
 }
 function listenGroups(){
  if(groupUnsub){groupUnsub();groupUnsub=null}
  if(role!=='hicc'){groups=[];myGroups=[];hiccScope.clear();return}
  groupUnsub=db.collection('faculty_groups').where('ownerUid','==',user.uid).onSnapshot(q=>{
    groups=q.docs.map(d=>({id:d.id,...d.data()}));myGroups=groups;rebuildHiccScope();injectButtons();
  },e=>console.warn('[workflow groups]',e));
 }
 function listenSessions(){
  if(sessionUnsub){sessionUnsub();sessionUnsub=null}
  if(!user)return;
  sessionUnsub=db.collection(SESSIONS).onSnapshot(q=>{
    sessions=new Map(q.docs.map(d=>[d.id,{id:d.id,...d.data()}]));rebuildHiccScope();queueDecorate();
  },e=>console.warn('[workflow sessions]',e));
 }
 function listenRequests(){
  if(requestUnsub){requestUnsub();requestUnsub=null}
  if(!user)return;
  let q=db.collection(REQUESTS);
  if(!isApprover())q=q.where('requesterUid','==',user.uid);
  requestUnsub=q.onSnapshot(s=>{
    requests=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>((b.requestedAt?.toMillis?.()||0)-(a.requestedAt?.toMillis?.()||0)));
    injectButtons();queueDecorate();
  },e=>console.warn('[workflow requests]',e));
 }

 function groupTokens(g){
  const vals=[g?.name,g?.tag,g?.groupTag].flatMap(v=>Array.isArray(v)?v:[v]);
  return vals.map(norm).filter(Boolean);
 }
 function sessionTextTokens(s){
  const raw=[s?.course,s?.topic,s?.groupTag,s?.hicc,s?.category,...(Array.isArray(s?.groupTags)?s.groupTags:[])];
  return raw.map(norm).filter(Boolean);
 }
 function sessionMatchesGroup(s,g){
  if(!s||!g)return false;
  const courseIds=new Set((g.courseIds||[]).map(v=>norm(v)).filter(Boolean));
  if(courseIds.has(norm(s.course)))return true;
  const gt=groupTokens(g), st=sessionTextTokens(s);
  if(gt.some(t=>st.some(v=>v===t||v.includes(t)||t.includes(v))))return true;
  const memberProfiles=(g.memberUids||[]).map(uid=>peopleByUid.get(uid)).filter(Boolean);
  const facultyIds=new Set(memberProfiles.map(p=>String(p.facultyId||'').trim()).filter(Boolean));
  const aliases=new Set(memberProfiles.flatMap(p=>[p.name,p.email?.split('@')[0]].map(norm).filter(Boolean)));
  return assignedArray(s).some(a=>facultyIds.has(String(a.ucid||'').trim())||aliases.has(norm(a.name)));
 }
 function rebuildHiccScope(){
  hiccScope=new Set();
  if(role==='hicc')for(const [id,s] of sessions)if(myGroups.some(g=>sessionMatchesGroup(s,g)))hiccScope.add(id);
  queueDecorate();
 }

 function toolbar(){return document.querySelector('.cal-toolbar-right')}
 function mkButton(id,label){let b=$(id);if(b)return b;b=document.createElement('button');b.id=id;b.className='workflow-btn';b.type='button';b.textContent=label;return b}
 function injectButtons(){
  const bar=toolbar();if(!bar||!user)return;
  if(role==='hicc'){
    const b=mkButton('hicc-timetable-btn','HICC Timetable');
    if(!b.isConnected){const my=$('my-timetable-btn');my?.insertAdjacentElement('afterend',b)}
    b.onclick=()=>{hiccMode=!hiccMode;b.classList.toggle('active',hiccMode);b.textContent=hiccMode?'Show All Timetable':'HICC Timetable';if(hiccMode&&$('my-timetable-btn')?.textContent==='Show All Timetable')$('my-timetable-btn').click();queueDecorate()};
  }else $('hicc-timetable-btn')?.remove();

  if(roleIsFaculty(role)){
    const mine=requests.filter(r=>r.status==='pending').length,b=mkButton('my-requests-btn','Requests');
    b.innerHTML=`Requests${mine?` <span class="workflow-count">${mine}</span>`:''}`;
    if(!b.isConnected)bar.insertBefore(b,bar.firstChild);b.onclick=()=>openMyRequests();
  }else $('my-requests-btn')?.remove();

  if(isApprover()){
    const pending=requests.filter(r=>r.status==='pending').length,b=mkButton('approval-queue-btn','Approvals');
    b.innerHTML=`Approvals${pending?` <span class="workflow-count">${pending}</span>`:''}`;
    if(!b.isConnected)bar.insertBefore(b,bar.firstChild);b.onclick=()=>openApprovalQueue();
  }else $('approval-queue-btn')?.remove();
 }

 function realignVisible(){
  document.querySelectorAll('.tg-day-col').forEach(col=>{
    const items=[...col.querySelectorAll('.tg-block:not(.workflow-hidden-by-hicc)')].map(block=>({block,start:parseFloat(block.style.top),end:parseFloat(block.style.top)+parseFloat(block.style.height)})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)).sort((a,b)=>a.start-b.start||a.end-b.end);
    let active=[];
    for(const item of items){active=active.filter(x=>x.end>item.start+.0001);active.push(item);const count=active.length;if(count===1){item.block.style.left='2px';item.block.style.width='calc(100% - 4px)'}else active.forEach((x,i)=>{x.block.style.left=`calc(${i*(100/count)}% + 2px)`;x.block.style.width=`calc(${100/count}% - 4px)`})}
  });
 }
 function decorate(){
  renderQueued=false;
  const pendingIds=new Set(requests.filter(r=>r.status==='pending').map(r=>r.sessionId));
  document.querySelectorAll('[data-session-id]').forEach(el=>{
    const id=el.dataset.sessionId;
    el.classList.toggle('workflow-hidden-by-hicc',hiccMode&&role==='hicc'&&!hiccScope.has(id));
    el.classList.toggle('workflow-session-pending',pendingIds.has(id));
  });
  if(hiccMode)realignVisible();
 }
 function queueDecorate(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(decorate)}
 new MutationObserver(m=>{if(m.some(x=>[...x.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('[data-session-id],.cal-toolbar-right')||n.querySelector?.('[data-session-id],.cal-toolbar-right'))))){injectButtons();queueDecorate()}}).observe(document.documentElement,{childList:true,subtree:true});

 function selfAssignmentIndexes(s){
  const fid=ownFacultyId(),aliases=ownAliases();return assignedArray(s).map((a,i)=>({a,i})).filter(x=>(fid&&String(x.a.ucid||'')===fid)||aliases.has(norm(x.a.name))).map(x=>x.i);
 }
 function groupForSession(s){return myGroups.find(g=>sessionMatchesGroup(s,g))||null}
 function personByFacultyId(id){return people.find(p=>String(p.facultyId||'')===String(id||''))||null}
 function optionPeople(list,excludeFacultyIds=new Set()){
  return list.filter(p=>p.facultyId&&!excludeFacultyIds.has(String(p.facultyId))).sort((a,b)=>peopleName(a).localeCompare(peopleName(b))).map(p=>`<option value="${esc(p.uid)}">${esc(peopleName(p))}</option>`).join('');
 }

 document.addEventListener('click',ev=>{
  if(!roleIsFaculty(role))return;
  const block=ev.target.closest?.('[data-session-id]');if(!block)return;
  const s=sessions.get(block.dataset.sessionId);if(!s)return;
  ev.preventDefault();ev.stopImmediatePropagation();ev.stopPropagation();openFacultySession(s);
 },true);

 function sessionSummary(s){return `<div class="workflow-card"><div class="workflow-card-title">${esc(s.course||'')} · ${esc(s.type||'')}</div><div>${esc(s.topic||'')}</div><div class="workflow-card-meta">${esc(ymd(s.date))} · ${esc(s.start||'')}–${esc(s.end||'')} · ${esc(s.room||'')}</div><div class="workflow-card-meta">Faculty: ${esc(assignedArray(s).map(a=>a.name).filter(Boolean).join('; ')||'TBD')}</div></div>`}
 function openFacultySession(s){
  const g=role==='hicc'?groupForSession(s):null,own=selfAssignmentIndexes(s),canHicc=!!g;
  showModal(`<div class="modal-header"><div class="modal-title">${esc(s.course||'')} · ${esc(s.topic||'')}</div><div class="modal-subtitle">Requests do not change the live timetable until ADFA approves them.</div></div><div class="modal-body">${sessionSummary(s)}${canHicc?`<div class="workflow-note">HICC scope: <strong>${esc(g.name||'')}</strong>. This session is included because its course/tag matches the group or a group member is assigned.</div>`:''}<div class="workflow-actions">${canHicc?'<button class="btn btn-primary" id="workflow-hicc-edit">Request session change</button><button class="btn btn-primary" id="workflow-hicc-swap">Request HICC faculty swap</button>':''}<button class="btn btn-secondary" id="workflow-self-swap">${own.length?'Request replacement for me':'Request to take this session'}</button></div></div><div class="modal-footer"><button class="btn btn-secondary" data-workflow-close>Close</button></div>`);
  $('workflow-self-swap').onclick=()=>openSelfSwap(s);
  if(canHicc){$('workflow-hicc-edit').onclick=()=>openHiccEdit(s,g);$('workflow-hicc-swap').onclick=()=>openHiccSwap(s,g)}
 }

 async function createRequest(payload){
  const base={status:'pending',requesterUid:user.uid,requesterName:me?.name||user.email||'',requesterEmail:user.email||me?.email||'',requesterRole:role,requesterFacultyId:ownFacultyId(),requestedAt:stamp()};
  await db.collection(REQUESTS).add({...base,...payload});closeModal();toast('Request submitted to ADFA for approval.');
 }
 function baseSnapshot(s){return{course:s.course||'',date:ymd(s.date),start:s.start||'',end:s.end||'',topic:s.topic||'',type:s.type||'',room:s.room||'',assignments:assignedArray(s).map(a=>({ucid:String(a.ucid||''),name:a.name||'',role:a.role||'',category:a.category||'',creditedHours:a.creditedHours??null,doeRate:a.doeRate??null,doeCredit:a.doeCredit??null}))}}

 function openHiccEdit(s,g){
  showModal(`<div class="modal-header"><div class="modal-title">Request HICC session change</div><div class="modal-subtitle">${esc(g.name)} · ADFA approval required</div></div><form id="workflow-edit-form"><div class="modal-body">${sessionSummary(s)}<div class="workflow-grid"><label class="form-field"><span class="form-label">Date</span><input class="form-input" name="date" type="date" value="${esc(ymd(s.date))}"></label><label class="form-field"><span class="form-label">Room</span><input class="form-input" name="room" value="${esc(s.room||'')}"></label><label class="form-field"><span class="form-label">Start</span><input class="form-input" name="start" type="time" value="${esc(s.start||'')}"></label><label class="form-field"><span class="form-label">End</span><input class="form-input" name="end" type="time" value="${esc(s.end||'')}"></label><label class="form-field" style="grid-column:1/-1"><span class="form-label">Session name / topic</span><input class="form-input" name="topic" value="${esc(s.topic||'')}"></label><label class="form-field"><span class="form-label">Type</span><input class="form-input" name="type" value="${esc(s.type||'')}"></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
  $('workflow-edit-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),patch={date:f.get('date'),start:f.get('start'),end:f.get('end'),topic:String(f.get('topic')||'').trim(),type:String(f.get('type')||'').trim(),room:String(f.get('room')||'').trim()},before=baseSnapshot(s),changes=[];for(const k of Object.keys(patch))if(!sameVal(before[k],patch[k]))changes.push({field:k,before:before[k],after:patch[k]});if(!changes.length)return toast('No changes were entered.',true);try{await createRequest({requestType:'session_edit',scope:'hicc',groupId:g.id,groupName:g.name||'',sessionId:s.id,course:s.course||'',date:ymd(s.date),topic:s.topic||'',base:before,patch,changes,reason:String(f.get('reason')||'').trim()})}catch(e){toast(e.message,true)}};
 }

 function openHiccSwap(s,g){
  const arr=assignedArray(s),members=(g.memberUids||[]).map(uid=>peopleByUid.get(uid)).filter(p=>p?.active&&p.facultyId),existing=new Set(arr.map(a=>String(a.ucid||'')).filter(Boolean));
  if(!arr.length)return toast('This session has no assigned faculty to swap.',true);
  showModal(`<div class="modal-header"><div class="modal-title">Request HICC faculty swap</div><div class="modal-subtitle">${esc(g.name)} · group-member replacement · ADFA approval required</div></div><form id="workflow-hicc-swap-form"><div class="modal-body">${sessionSummary(s)}<label class="form-field"><span class="form-label">Replace current instructor</span><select class="form-select" name="out">${arr.map((a,i)=>`<option value="${i}">${esc(a.name||'Unknown')}</option>`).join('')}</select></label><label class="form-field"><span class="form-label">With HICC group member</span><select class="form-select" name="to">${optionPeople(members,existing)}</select></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label><div class="workflow-note">Only active dashboard accounts that are members of this HICC group are shown as HICC replacement candidates.</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
  $('workflow-hicc-swap-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),idx=Number(f.get('out')),incoming=peopleByUid.get(String(f.get('to')||'')),out=arr[idx];if(!out||!incoming)return toast('Select both faculty members.',true);try{await createSwapRequest(s,out,idx,incoming,'hicc',g,String(f.get('reason')||''))}catch(e){toast(e.message,true)}};
 }

 function openSelfSwap(s){
  const arr=assignedArray(s),own=selfAssignmentIndexes(s),myPerson=people.find(p=>p.uid===user.uid)||{uid:user.uid,name:me?.name||me?.instructor||user.email,facultyId:ownFacultyId(),active:true};
  if(!myPerson.facultyId)return toast('Your account needs a linked faculty record before you can request a swap.',true);
  if(own.length){
    const idx=own[0],out=arr[idx],existing=new Set(arr.map(a=>String(a.ucid||'')).filter(Boolean));
    showModal(`<div class="modal-header"><div class="modal-title">Request replacement for me</div><div class="modal-subtitle">You are currently assigned. ADFA approval is required.</div></div><form id="workflow-self-swap-form"><div class="modal-body">${sessionSummary(s)}<div class="workflow-card">You: <strong>${esc(out.name||peopleName(myPerson))}</strong></div><label class="form-field"><span class="form-label">Replace me with</span><select class="form-select" name="to">${optionPeople(people.filter(p=>p.uid!==user.uid),existing)}</select></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
    $('workflow-self-swap-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),incoming=peopleByUid.get(String(f.get('to')||''));if(!incoming)return toast('Choose a replacement faculty member.',true);try{await createSwapRequest(s,out,idx,incoming,'self',null,String(f.get('reason')||''))}catch(e){toast(e.message,true)}};
  }else{
    if(!arr.length)return toast('This session has no current instructor to replace.',true);
    showModal(`<div class="modal-header"><div class="modal-title">Request to take this session</div><div class="modal-subtitle">You are not currently assigned. Choose the instructor you would replace; ADFA approval is required.</div></div><form id="workflow-self-take-form"><div class="modal-body">${sessionSummary(s)}<label class="form-field"><span class="form-label">I will replace</span><select class="form-select" name="out">${arr.map((a,i)=>`<option value="${i}">${esc(a.name||'Unknown')}</option>`).join('')}</select></label><label class="form-field"><span class="form-label">Reason / note</span><input class="form-input" name="reason" placeholder="Optional"></label></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-workflow-close>Cancel</button><button class="btn btn-primary" type="submit">Submit for approval</button></div></form>`);
    $('workflow-self-take-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),idx=Number(f.get('out')),out=arr[idx];if(!out)return toast('Choose an instructor to replace.',true);try{await createSwapRequest(s,out,idx,myPerson,'self',null,String(f.get('reason')||''))}catch(e){toast(e.message,true)}};
  }
 }

 async function createSwapRequest(s,out,idx,incoming,scope,g,reason){
  let fromFacultyId=String(out.ucid||''); if(scope==='self'&&selfAssignmentIndexes(s).includes(idx))fromFacultyId=ownFacultyId(); const toFacultyId=String(incoming.facultyId||'');
  if(!toFacultyId)throw Error('The replacement account has no linked faculty record.');
  await createRequest({requestType:'faculty_swap',scope,groupId:g?.id||'',groupName:g?.name||'',sessionId:s.id,course:s.course||'',date:ymd(s.date),topic:s.topic||'',base:baseSnapshot(s),assignmentIndex:idx,fromFaculty:{facultyId:fromFacultyId,name:out.name||''},toFaculty:{uid:incoming.uid||'',facultyId:toFacultyId,name:peopleName(incoming)},reason:String(reason||'').trim()});
 }

 function statusLabel(r){return r.status==='approved'?'Approved':r.status==='rejected'?'Rejected':'Pending'}
 function requestDetail(r){
  if(r.requestType==='faculty_swap')return `<div class="workflow-approval-change"><strong>Faculty swap</strong>${esc(r.fromFaculty?.name||'')} → ${esc(r.toFaculty?.name||'')}</div>`;
  return (r.changes||[]).map(c=>`<div class="workflow-approval-change"><strong>${esc(c.field)}</strong>${esc(c.before)} → ${esc(c.after)}</div>`).join('');
 }
 function requestCard(r,admin=false){const when=r.requestedAt?.toDate?.().toLocaleString('en-CA',{timeZone:'America/Edmonton'})||'Pending timestamp';return `<div class="workflow-card ${esc(r.status||'pending')}"><div class="workflow-card-head"><div><div class="workflow-card-title">${esc(r.course||'')} · ${esc(r.topic||'')}</div><div class="workflow-card-meta">${esc(r.requesterName||r.requesterEmail||'')} · ${esc(UCVM.label(r.requesterRole||''))} · ${esc(when)}</div></div><span class="workflow-pill">${statusLabel(r)}</span></div>${requestDetail(r)}${r.reason?`<div class="workflow-note">Reason: ${esc(r.reason)}</div>`:''}${admin&&r.status==='pending'?`<div class="workflow-actions"><button class="btn btn-primary" data-approve-request="${esc(r.id)}">Approve & apply</button><button class="btn btn-secondary" data-reject-request="${esc(r.id)}">Reject</button></div>`:''}</div>`}
 function openMyRequests(){showModal(`<div class="modal-header"><div class="modal-title">My change requests</div><div class="modal-subtitle">Pending requests do not change the live timetable until ADFA approves.</div></div><div class="modal-body">${requests.map(r=>requestCard(r,false)).join('')||'<p>No requests yet.</p>'}</div><div class="modal-footer"><button class="btn btn-secondary" data-workflow-close>Close</button></div>`)}
 function openApprovalQueue(){const pending=requests.filter(r=>r.status==='pending'),done=requests.filter(r=>r.status!=='pending').slice(0,20);showModal(`<div class="modal-header"><div class="modal-title">ADFA approval queue</div><div class="modal-subtitle">ADFA General or ADFA Regular approval applies the request to the live Firestore timetable.</div></div><div class="modal-body"><h3>Pending (${pending.length})</h3>${pending.map(r=>requestCard(r,true)).join('')||'<p>No pending requests.</p>'}${done.length?`<h3 style="margin-top:18px">Recent decisions</h3>${done.map(r=>requestCard(r,false)).join('')}`:''}</div><div class="modal-footer"><button class="btn btn-secondary" data-workflow-close>Close</button></div>`);document.querySelectorAll('[data-approve-request]').forEach(b=>b.onclick=()=>approveRequest(b.dataset.approveRequest));document.querySelectorAll('[data-reject-request]').forEach(b=>b.onclick=()=>rejectRequest(b.dataset.rejectRequest))}

 function validateBase(current,base,fields){for(const f of fields)if(!sameVal(f==='date'?ymd(current[f]):current[f],base?.[f]))return false;return true}
 async function approveRequest(id){
  if(!isApprover())return;const r=requests.find(x=>x.id===id);if(!r||r.status!=='pending')return;
  const ref=db.doc(`${SESSIONS}/${r.sessionId}`),snap=await ref.get();if(!snap.exists)return toast('The session no longer exists. Reject or review this request manually.',true);const current={id:snap.id,...snap.data()};
  let patch={},log={};
  if(r.requestType==='session_edit'){
    const fields=(r.changes||[]).map(c=>c.field);if(!validateBase(current,r.base,fields))return toast('This session changed after the request was submitted. Approval is blocked to prevent overwriting newer data.',true);
    patch={...(r.patch||{})};log={action:'approved_session_edit',changes:r.changes||[]};
  }else if(r.requestType==='faculty_swap'){
    if(!validateBase(current,r.base,['course','date','start','end','topic','type','room']))return toast('This session changed after the swap request was submitted. Approval is blocked.',true);
    const arr=assignedArray(current),fromId=String(r.fromFaculty?.facultyId||''),fromName=norm(r.fromFaculty?.name),idx=arr.findIndex(a=>(fromId&&String(a.ucid||'')===fromId)||(fromName&&norm(a.name)===fromName));if(idx<0)return toast('The outgoing instructor is no longer assigned. Approval is blocked.',true);
    const incoming={...(arr[idx]||{}),ucid:String(r.toFaculty?.facultyId||''),name:r.toFaculty?.name||'',category:'Faculty',source:'Approved swap request',swappedFrom:{ucid:String(arr[idx]?.ucid||''),name:arr[idx]?.name||''},swappedAt:new Date().toISOString()};arr[idx]=incoming;patch={assignments:arr,instructor:arr.map(a=>a.name).filter(Boolean).join('; ')};log={action:'swap_faculty',fromFaculty:r.fromFaculty||{},toFaculty:r.toFaculty||{},role:incoming.role||current.type||''};
  }else return;
  if(!confirm(`Approve and apply this ${r.requestType==='faculty_swap'?'faculty swap':'session change'} to the live timetable?`))return;
  try{
    const batch=db.batch(),reqRef=db.doc(`${REQUESTS}/${id}`),logRef=db.collection(LOGS).doc();batch.set(ref,{...patch,updatedBy:user.uid,updatedByName:me?.name||user.email||'',updatedAt:stamp()},{merge:true});batch.set(logRef,{...log,requestId:id,sessionId:r.sessionId,course:current.course||r.course||'',date:ymd(patch.date||current.date),topic:patch.topic||current.topic||'',changedBy:user.uid,changedByName:me?.name||user.email||'',changedByEmail:user.email||'',changedAt:stamp()});batch.update(reqRef,{status:'approved',approvedBy:user.uid,approvedByName:me?.name||user.email||'',approvedAt:stamp(),appliedAt:stamp()});await batch.commit();toast('Approved and applied to the live timetable.');closeModal();
  }catch(e){console.error(e);toast(e.message,true)}
 }
 async function rejectRequest(id){
  if(!isApprover())return;const reason=prompt('Optional rejection reason:','')??null;if(reason===null)return;try{await db.doc(`${REQUESTS}/${id}`).update({status:'rejected',rejectedBy:user.uid,rejectedByName:me?.name||user.email||'',rejectedAt:stamp(),rejectionReason:String(reason||'').trim()});toast('Request rejected.');closeModal()}catch(e){toast(e.message,true)}
 }

 auth.onAuthStateChanged(async u=>{
  user=u;me=null;role='';hiccMode=false;sessions.clear();requests=[];if(sessionUnsub){sessionUnsub();sessionUnsub=null}if(requestUnsub){requestUnsub();requestUnsub=null}if(groupUnsub){groupUnsub();groupUnsub=null}if(peopleUnsub){peopleUnsub();peopleUnsub=null}
  if(!u){injectButtons();queueDecorate();return}
  try{const d=await db.doc(`users/${u.uid}`).get();me=d.data()||{};await UCVM.ready(u,me);role=UCVM.role(me.role);await loadPeopleOnce();listenPeople();listenGroups();listenSessions();listenRequests();injectButtons()}catch(e){console.warn('[approval workflow init]',e)}
 });
})();