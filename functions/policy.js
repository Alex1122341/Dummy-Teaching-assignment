'use strict';
const ROLES=['adfa_general','adfa_regular','hicc','visc','faculty'];
const normalizeRole=r=>({admin:'adfa_regular',editor:'faculty',viewer:'faculty'}[r]||r);
const isAdmin=p=>['adfa_general','adfa_regular'].includes(normalizeRole(p?.role));
const isGeneral=p=>normalizeRole(p?.role)==='adfa_general';
const isFaculty=p=>['hicc','visc','faculty'].includes(normalizeRole(p?.role));
function changes(before,after){
  const fields={date:'Date',start:'Start time',end:'End time',topic:'Session name',course:'Course',courseName:'Course name',type:'Session type',room:'Room',instructor:'Faculty',assignments:'Faculty assignments',preferredFullName:'Faculty name',hrFullName:'HR name',firstName:'First name',lastName:'Last name',email:'Email'};
  return Object.entries(fields).filter(([k])=>JSON.stringify(before?.[k]??null)!==JSON.stringify(after?.[k]??null)).map(([field,label])=>({field,label,before:before?.[field]??null,after:after?.[field]??null}));
}
module.exports={ROLES,normalizeRole,isAdmin,isGeneral,isFaculty,changes};
