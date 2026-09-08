/* Shared Firebase identity and faculty portal helpers. No passwords are persisted here. */
window.UCVM=(()=>{
 const config={apiKey:'AIzaSyDS9VE2zTXv0656_Mh0uDXB67-mZ5Y_LkY',authDomain:'tester-teaching.firebaseapp.com',projectId:'tester-teaching',storageBucket:'tester-teaching.firebasestorage.app',messagingSenderId:'566638053186',appId:'1:566638053186:web:90e04b52251c4b859baadb'};
 const role=r=>({admin:'adfa_regular',editor:'faculty',viewer:'faculty'}[r]||r);
 const admin=p=>['adfa_general','adfa_regular'].includes(role(p?.role));
 const general=p=>role(p?.role)==='adfa_general';
 const label=r=>({adfa_general:'ADFA General',adfa_regular:'ADFA Regular',hicc:'HICC',visc:'VISC',faculty:'Faculty'}[role(r)]||r);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function init(){if(!firebase.apps.length)firebase.initializeApp(config);return {auth:firebase.auth(),db:firebase.firestore(),call:async(name,data={})=>(await firebase.app().functions('us-central1').httpsCallable(name)(data)).data};}
 async function ready(user,p){
  if(!p?.active)throw Error('This account is inactive.');
  if(p.mustChangePassword){location.replace('password.html');return false;}
  const token=await user.getIdTokenResult();if(Number(token.claims.auth_time)<(p.validAfterSeconds||0)){await firebase.auth().signOut();throw Error('Please sign in again.');}
  return true;
 }
 function watch(user,p){let initial=true;return firebase.firestore().doc(`users/${user.uid}`).onSnapshot(s=>{const n=s.data();if(initial){initial=false;}if(!n||['role','active','mustChangePassword','validAfterSeconds'].some(k=>n[k]!==p[k]))location.reload();});}
 const value=v=>v===null||v===undefined?'—':Array.isArray(v)?v.map(x=>typeof x==='object'?`${x.name||''}${x.role?' ('+x.role+')':''}`:String(x)).join('; '):typeof v==='object'?JSON.stringify(v):String(v);
 async function logs(container){
  const {db}=init();let cursor=null,entries=[],loading=false;
  container.innerHTML='<p>Session additions, deletions, time, name and faculty changes. Times shown in Calgary time. History begins when logging is activated.</p><label>Search loaded history <input id="audit-search" placeholder="Course, name, person or change"></label> <select id="audit-kind" aria-label="Change type"><option value="">All changes</option><option value="create">Added</option><option value="delete">Deleted</option><option value="time">Time/date</option><option value="name">Name</option><option value="faculty">Faculty</option></select><p id="audit-status" role="status"></p><div class="table-scroll"><table><thead><tr><th>When (Calgary)</th><th>By whom</th><th>Session / record</th><th>Action</th><th>Before → after</th></tr></thead><tbody id="audit-body"></tbody></table></div><button id="audit-more">Load older changes</button>';
  const $=id=>container.querySelector('#'+id);
  function render(){const q=$('audit-search').value.toLowerCase(),kind=$('audit-kind').value;const rows=entries.filter(e=>(!q||JSON.stringify(e).toLowerCase().includes(q))&&(!kind||e.action===kind||(e.changes||[]).some(c=>kind==='time'?['date','start','end'].includes(c.field):kind==='name'?/name|topic/i.test(c.field):kind==='faculty'?['assignments','instructor'].includes(c.field):false)));
   $('audit-body').innerHTML=rows.map(e=>`<tr><td>${esc(e.changedAt?.toDate?e.changedAt.toDate().toLocaleString('en-CA',{timeZone:'America/Edmonton'}):'Pending')}</td><td>${esc(e.changedByName||e.changedBy)}<small>${esc(e.changedByEmail||'')}</small></td><td>${esc([e.course,e.date,e.topic].filter(Boolean).join(' · ')||e.recordId)}</td><td>${esc(({create:'Added',delete:'Deleted',update:'Changed'})[e.action]||e.action)}</td><td>${(e.changes||[]).map(c=>`<div><strong>${esc(c.label)}:</strong> ${esc(value(c.before))} → ${esc(value(c.after))}</div>`).join('')||'No field details recorded'}</td></tr>`).join('')||'<tr><td colspan="5">No matching changes.</td></tr>';
  }
  async function more(){if(loading)return;loading=true;$('audit-more').disabled=true;$('audit-status').textContent='Loading changes…';try{let query=db.collection('audit_events').orderBy('changedAt','desc').limit(50);if(cursor)query=query.startAfter(cursor);const s=await query.get();entries.push(...s.docs.map(d=>d.data()));cursor=s.docs.at(-1)||cursor;$('audit-more').hidden=s.size<50;render();$('audit-status').textContent=`${entries.length} changes loaded. New changes can take a few seconds to appear; reopen this tab to refresh.`;}catch(e){$('audit-status').textContent='Could not load history: '+e.message;}finally{loading=false;$('audit-more').disabled=false}}
  $('audit-search').oninput=render;$('audit-kind').onchange=render;$('audit-more').onclick=more;await more();
 }
 return {config,role,admin,general,label,esc,init,ready,watch,logs};
})();
