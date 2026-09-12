'use strict';
(()=>{
 const {auth,db}=UCVM.init(),$=id=>document.getElementById(id),e=UCVM.esc;
 let me,groups=[],sessions=[],facultyRecord=null,weekStart=null,currentView='calendar';
 const norm=v=>String(v||'').trim().toLowerCase();
 const normName=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(dr|doctor|prof|professor)\.?\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
 const parseDate=s=>new Date(`${s}T12:00:00`);
 const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
 const monday=d=>{const x=new Date(d),day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(12,0,0,0);return x};
 const fmtDay=d=>d.toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
 const fmtWeek=(start)=>`${start.toLocaleDateString('en-CA',{month:'short',day:'numeric'})} – ${addDays(start,4).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})}`;
 function facultyNames(f){const names=new Set(),add=v=>{const n=normName(v);if(n)names.add(n)};add(f?.preferredFullName);add(f?.hrFullName);add(f?.name);if(f?.firstName&&f?.lastName){add(`${f.firstName} ${f.lastName}`);add(`${f.lastName} ${f.firstName}`)}return names}
 function facultyIds(f){return new Set([me?.facultyId,f?.id,f?.ucid].map(v=>norm(v)).filter(Boolean))}
 function assignmentMatches(a){if(!facultyRecord)return false;const ids=facultyIds(facultyRecord),names=facultyNames(facultyRecord),aid=norm(a?.ucid||a?.facultyId||a?.id),an=normName(a?.name||a?.facultyName);return(!!aid&&ids.has(aid))||(!!an&&names.has(an))}
 function instructorMatches(raw){if(!facultyRecord||!raw)return false;const names=facultyNames(facultyRecord),whole=` ${normName(raw)} `;return[...names].some(n=>whole.includes(` ${n} `))}
 function isMine(s){if(UCVM.admin(me))return true;if((s.assignments||[]).some(assignmentMatches))return true;if(instructorMatches(s.instructor))return true;return groups.some(g=>(g.courseIds||[]).map(String).includes(String(s.course)))}
 function mine(){return sessions.filter(isMine).sort((a,b)=>`${a.date||''}${a.start||''}`.localeCompare(`${b.date||''}${b.start||''}`))}
 function matchingAssignment(s){return(s.assignments||[]).find(assignmentMatches)||null}
 async function resolveFaculty(user){
  if(UCVM.admin(me))return null;
  const candidates=[user.email,me.email].map(v=>String(v||'').trim()).filter((v,i,a)=>v&&a.indexOf(v)===i);
  for(const email of candidates){
   try{const q=await db.collection('faculty').where('email','==',email).limit(2).get();if(!q.empty){const d=q.docs[0];return{id:d.id,...d.data(),matchedEmail:email}}}catch(_){/* Try the next safe identity source. */}
  }
  return null;
 }
 function setIdentityNote(user){
  if(UCVM.admin(me)){$('match-note').textContent='ADFA view: all teaching sessions are shown.';return}
  if(facultyRecord){const name=facultyRecord.preferredFullName||facultyRecord.hrFullName||facultyRecord.name||facultyRecord.id;$('match-note').innerHTML=`Matched <strong>${e(user.email||me.email||'')}</strong> to Faculty Directory record <strong>${e(name)}</strong>. Sessions are matched by the assigned UCID/name on each course.`;return}
  $('match-note').innerHTML=`No Faculty Directory record matches the signed-in email <strong>${e(user.email||me.email||'')}</strong>. Add the same email to this person's Faculty Directory record; My Timetable will remain empty until the identity can be verified.`;
 }
 function chooseInitialWeek(items){if(weekStart)return;const today=ymd(new Date()),future=items.find(s=>String(s.date||'')>=today),pick=future||items[items.length-1];weekStart=monday(pick?.date?parseDate(pick.date):new Date())}
 function renderCalendar(items){
  chooseInitialWeek(items);$('week-label').textContent=fmtWeek(weekStart);let html='';
  for(let i=0;i<5;i++){
   const d=addDays(weekStart,i),date=ymd(d),dayItems=items.filter(s=>s.date===date);
   html+=`<section class="my-day"><h3>${e(fmtDay(d))}</h3><div class="my-day-events">${dayItems.map(s=>{const a=matchingAssignment(s),faculty=(s.assignments||[]).map(x=>x.name).filter(Boolean).join('; ')||s.instructor||'TBD';return`<article class="my-session-card"><strong>${e(s.start||'')}–${e(s.end||'')} · ${e(s.course||'')}</strong><span>${e(s.topic||s.type||'Teaching session')}</span><small>${e(faculty)}</small>${a?.role?`<small>${e(a.role)}</small>`:''}</article>`}).join('')||'<p class="my-empty">No teaching sessions.</p>'}</div></section>`;
  }
  $('week-grid').innerHTML=html;
 }
 function renderList(items){$('sessions-body').innerHTML=items.map(s=>{const a=matchingAssignment(s),faculty=(s.assignments||[]).map(x=>x.name).filter(Boolean).join('; ')||s.instructor||'TBD';return`<tr><td>${e(s.date)}<small>${e(s.start)}–${e(s.end)}</small></td><td><strong>${e(s.course)}</strong><small>${e(s.topic||s.type||'')}</small></td><td>${e(faculty)}</td><td>${a?.role?e(a.role):['hicc','visc'].includes(me.role)?'Group course':'Assigned faculty'}</td></tr>`}).join('')||'<tr><td colspan="4">No sessions matched to this signed-in faculty account.</td></tr>'}
 function render(){const items=mine();renderCalendar(items);renderList(items);$('session-count').textContent=`${items.length} session${items.length===1?'':'s'} matched`;}
 function show(view){currentView=view;const calendar=view==='calendar',list=view==='list',history=view==='history';$('calendar-view').hidden=!calendar;$('list-view').hidden=!list;$('history-panel').hidden=!history;$('sessions-panel').hidden=history;for(const [id,v] of [['calendar-tab','calendar'],['list-tab','list'],['history-tab','history']])$(id).classList.toggle('primary',view===v);if(history)UCVM.logs($('history-panel'));}
 async function loadGroups(){if(UCVM.admin(me)||!['hicc','visc'].includes(me.role)){groups=[];return}const s=await db.collection('faculty_groups').where('memberUids','array-contains',auth.currentUser.uid).get();groups=s.docs.map(d=>({id:d.id,...d.data()}));}
 $('signout').onclick=()=>auth.signOut();$('calendar-tab').onclick=()=>show('calendar');$('list-tab').onclick=()=>show('list');$('history-tab').onclick=()=>show('history');$('week-prev').onclick=()=>{weekStart=addDays(weekStart,-7);renderCalendar(mine())};$('week-next').onclick=()=>{weekStart=addDays(weekStart,7);renderCalendar(mine())};$('week-current').onclick=()=>{weekStart=null;renderCalendar(mine())};
 auth.onAuthStateChanged(async u=>{if(!u){location.replace('index.html');return}try{const profile=(await db.doc(`users/${u.uid}`).get()).data()||{};me=profile;if(!await UCVM.ready(u,me))return;me={...me,role:UCVM.role(me.role)};UCVM.watch(u,profile);$('identity').textContent=`${me.name||u.email} · ${UCVM.label(me.role)}`;$('management-link').hidden=!(UCVM.general(me)||me.role==='hicc');$('directory-link').hidden=!UCVM.admin(me);await loadGroups();facultyRecord=await resolveFaculty(u);setIdentityNote(u);$('session-note').textContent=['hicc','visc'].includes(me.role)?'Shows your own assigned sessions plus courses attached to your HICC group. Instructor replacement remains ADFA-only in Spark Basic Mode.':'Shows only sessions assigned to the Faculty Directory person verified by your signed-in email.';$('content').hidden=false;show(currentView);db.collection('sessions').onSnapshot(s=>{sessions=s.docs.map(d=>({id:d.id,...d.data()}));render()},err=>$('status').textContent=err.message)}catch(err){$('status').textContent=err.message}});
})();
