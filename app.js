import { db, login, logout, watchAuth } from "./auth.js";
import { doc, getDoc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const KEY = "my-money-data-v2";
const defaultData = {
  accounts: [
    {id:"a1", name:"SBI Savings", type:"Bank", balance:0},
    {id:"a2", name:"Cash Wallet", type:"Cash", balance:0}
  ],
  categories: ["Food & Dining","Transport","Shopping","Bills & Utilities","Entertainment","Health","Salary","Other"],
  accountTypes: ["Bank","Cash","Wallet","Credit Card","Investment","Other"],
  transactions: [],
  goals: [],
  budgets: [],
  emis: [],
  loans: []
};

const dateKey = (d=new Date()) => {
  const x=d instanceof Date ? d : new Date(d);
  const pad=n=>String(n).padStart(2,"0");
  return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
};
const today = () => dateKey(new Date());
const localDateTimeValue = (d=new Date()) => {
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const txDateTime = t => {
  if(t.timestamp) return t.timestamp;
  return t.date ? `${t.date}T00:00` : localDateTimeValue();
};
const txDisplayDateTime = t => {
  const raw=txDateTime(t);
  const d=new Date(raw);
  if(Number.isNaN(d.getTime())) return t.date||"";
  return d.toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true});
};

let data = load();
let currentPage = "dashboard";
let analyticsFrom = dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
let analyticsTo = today();
let analyticsPreset = "30 days";
let currentUser = null;
let cloudUnsubscribe = null;
let syncing = false;
let cloudReady = false;

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(n)||0);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function icon(name,size=18,cls=""){
  return `<i data-lucide="${name}" class="${cls}" width="${size}" height="${size}" aria-hidden="true"></i>`;
}
function refreshIcons(){
  if(window.lucide && window.lucide.createIcons){
    window.lucide.createIcons({attrs:{"stroke-width":1.8}});
  }
}

function load(){
  try { return {...structuredClone(defaultData), ...JSON.parse(localStorage.getItem(KEY)||"{}")}; }
  catch { return structuredClone(defaultData); }
}
function save(){
  syncAutoGoalDeposits();
  localStorage.setItem(KEY, JSON.stringify(data));
  if(currentUser && cloudReady) queueCloudSave();
}
let cloudSaveTimer;
let cloudRevision = 0;
function queueCloudSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(saveCloud,350);
}
async function saveCloud(){
  if(!currentUser || !cloudReady) return;
  const revision=++cloudRevision;
  try{
    await setDoc(doc(db,"users",currentUser.uid),{
      data: structuredClone(data),
      updatedAt: Date.now()
    },{merge:true});
    if(revision===cloudRevision) toast("Saved to Google account.");
  }catch(e){
    console.error("Firestore save failed:",e);
    toast(`Sync failed: ${friendlyFirestoreError(e)}`);
  }
}
function friendlyFirestoreError(e){
  const code=e?.code||"";
  if(code.includes("permission-denied")) return "permission denied — publish firestore.rules";
  if(code.includes("failed-precondition")) return "Firestore database is not ready";
  if(code.includes("not-found")) return "Firestore database not found";
  if(code.includes("unavailable")) return "Firebase is temporarily unavailable";
  return e?.message ? String(e.message).slice(0,90) : "check Firebase setup";
}
function normalizeCloud(x){
  const base=structuredClone(defaultData);
  data={...base,...(x||{})};
  data.accounts=Array.isArray(data.accounts)?data.accounts:base.accounts;
  data.categories=Array.isArray(data.categories)?data.categories:base.categories;
  data.accountTypes=Array.isArray(data.accountTypes)?data.accountTypes:base.accountTypes;
  data.transactions=Array.isArray(data.transactions)?data.transactions:[];
  data.goals=Array.isArray(data.goals)?data.goals:[];
  data.goals.forEach(g=>{ if(!Object.prototype.hasOwnProperty.call(g,"accountId")) g.accountId=""; });
  data.budgets=Array.isArray(data.budgets)?data.budgets:[];
  data.emis=Array.isArray(data.emis)?data.emis:[];
  data.emis.forEach(e=>{
    if(!e.startDate){
      const first=(data.transactions||[]).filter(t=>t.emiId===e.id).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")))[0];
      if(first?.date) e.startDate=first.date;
    }
  });
  data.loans=Array.isArray(data.loans)?data.loans:[];
  data.accounts.forEach(a=>{ if(!Object.prototype.hasOwnProperty.call(a,"includeInTotal")) a.includeInTotal=!/credit\s*card|card/i.test(String(a.type||"")+" "+String(a.name||"")); });
  syncAutoGoalDeposits();
}
async function loadCloud(user){
  if(cloudUnsubscribe){cloudUnsubscribe();cloudUnsubscribe=null;}
  cloudReady=false;
  const ref=doc(db,"users",user.uid);
  try{
    const snap=await getDoc(ref);
    if(snap.exists() && snap.data()?.data){
      normalizeCloud(snap.data().data);
      localStorage.setItem(KEY,JSON.stringify(data));
      render();
    }else{
      await setDoc(ref,{data:structuredClone(data),updatedAt:Date.now()},{merge:true});
      localStorage.setItem(KEY,JSON.stringify(data));
    }
    cloudReady=true;
    cloudUnsubscribe=onSnapshot(ref,s=>{
      if(!s.exists()) return;
      const remote=s.data()?.data;
      if(!remote) return;
      normalizeCloud(remote);
      localStorage.setItem(KEY,JSON.stringify(data));
      render();
    },e=>{
      console.error("Firestore listener failed:",e);
      toast(`Sync listener: ${friendlyFirestoreError(e)}`);
    });
    toast("Google data loaded.");
  }catch(e){
    console.error("Firestore load failed:",e);
    cloudReady=false;
    render();
    toast(`Could not load data: ${friendlyFirestoreError(e)}`);
  }
}
function uid(p="id"){ return p+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,7); }
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2200); }
function syncAutoGoalDeposits(){
  (data.goals||[]).forEach(g=>{
    if(!g.autoTrackAccount || !g.accountId) return;
    const a=(data.accounts||[]).find(x=>x.id===g.accountId);
    if(!a) return;
    g.saved=Math.min(Math.max(0,Number(a.balance||0)),Math.max(0,Number(g.target||0)));
  });
}

function totalBalance(){ return data.accounts.filter(a=>a.includeInTotal!==false).reduce((s,a)=>s+Number(a.balance||0),0); }
function excludedBalance(){ return data.accounts.filter(a=>a.includeInTotal===false).reduce((s,a)=>s+Number(a.balance||0),0); }
function monthTx(){ const m=today().slice(0,7); return data.transactions.filter(t=>t.date.startsWith(m)); }
function weekTx(){
  const d=new Date();
  const day=(d.getDay()+6)%7;
  const start=new Date(d.getFullYear(),d.getMonth(),d.getDate()-day,12,0,0);
  const end=new Date(start); end.setDate(start.getDate()+6);
  const from=dateKey(start),to=dateKey(end);
  return data.transactions.filter(t=>t.date>=from&&t.date<=to);
}
function sum(list,type){ return list.filter(t=>t.type===type).reduce((s,t)=>s+Number(t.amount),0); }
function greeting(){ const h=new Date().getHours(); if(h<5) return "Good night"; if(h<12) return "Good morning"; if(h<17) return "Good afternoon"; if(h<21) return "Good evening"; return "Good night"; }
function goalMonthsRemaining(g){
  if(!g.targetDate) return null;
  const now=new Date();
  const target=new Date(`${g.targetDate}T12:00:00`);
  if(Number.isNaN(target.getTime())) return null;
  const monthDiff=(target.getFullYear()-now.getFullYear())*12+(target.getMonth()-now.getMonth());
  return Math.max(1,monthDiff+(target.getDate()>=now.getDate()?1:0));
}
function goalMonthlyRequired(g){
  const remaining=Math.max(0,Number(g.target||0)-Number(g.saved||0));
  const months=goalMonthsRemaining(g);
  if(!remaining||months===null) return 0;
  return remaining/months;
}
function overallGoalPlan(){
  const items=(data.goals||[]).map(g=>({g,remaining:Math.max(0,Number(g.target||0)-Number(g.saved||0)),months:goalMonthsRemaining(g),monthly:goalMonthlyRequired(g)}));
  const active=items.filter(x=>x.remaining>0);
  return {items,active,totalTarget:(data.goals||[]).reduce((s,g)=>s+Math.max(0,Number(g.target||0)),0),totalSaved:(data.goals||[]).reduce((s,g)=>s+Math.max(0,Number(g.saved||0)),0),totalRemaining:active.reduce((s,x)=>s+x.remaining,0),monthly:active.reduce((s,x)=>s+x.monthly,0)};
}
function weeklyGoalRequired(){ return overallGoalPlan().monthly/4.34524; }
function upcomingCommitments7(){ const end=new Date(); end.setDate(end.getDate()+7); const endKey=dateKey(end); return upcomingEmis().filter(e=>e.nextDate>=today()&&e.nextDate<=endKey).reduce((s,e)=>s+Math.min(Number(e.monthly||0),Number(e.remainingAmount||0)),0); }


function accountIcon(a){
  const n=String(a?.name||'').toLowerCase(), t=String(a?.type||'').toLowerCase();
  if(a?.logo) return `<img class="account-logo-img" src="${esc(a.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` + `<span class="account-auto-icon" style="display:none">${accountEmoji(a)}</span>`;
  return `<span class="account-auto-icon">${accountEmoji(a)}</span>`;
}
function accountEmoji(a){
  const n=String(a?.name||'').toLowerCase(),t=String(a?.type||'').toLowerCase();
  if(/sbi|state bank/.test(n))return '🏦'; if(/hdfc/.test(n))return '🏛️'; if(/icici/.test(n))return '🏦';
  if(/axis/.test(n))return '🏦'; if(/kotak/.test(n))return '🏦'; if(/cash|wallet/.test(t+' '+n))return '👛';
  if(/credit|card/.test(t+' '+n))return '💳'; if(/upi/.test(t+' '+n))return '📱'; if(/fd|fixed/.test(t+' '+n))return '🔒';
  if(/investment|mutual|stock|demat/.test(t+' '+n))return '📈'; return '🏦';
}
function accountVisual(a){ return `<span class="account-visual">${accountIcon(a)}</span>`; }

function syncEmiDatesFromPayments(){
  (data.emis||[]).forEach(e=>{
    if(Number(e.remainingAmount||0)<=0 || Number(e.remainingEmis||0)<=0){ e.nextDate=null; return; }
    e.nextDate=calculateEmiNextDate(e);
  });
}
function render(){
  syncEmiDatesFromPayments();
  const titles={dashboard:`${greeting()} 👋`,accounts:"Accounts",transactions:"Transactions",analytics:"Analytics",goals:"Goals",budgets:"Budgets",emis:"EMIs & Loans",settings:"Settings"};
  $("pageTitle").textContent=titles[currentPage]||"My Money";
  $("pageSubtitle").textContent=currentPage==="dashboard"?"Here's what's happening with your money today.":"Manage your finances with clarity.";
  document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===currentPage));
  $("sideBalance").textContent=money(totalBalance());
  $("sideMessage").textContent=data.accounts.length ? `${data.accounts.length} account${data.accounts.length===1?"":"s"} connected.` : "Add an account to get started.";
  const pages={dashboard:dashboard,accounts:accounts,transactions:transactions,analytics:analytics,goals:goals,budgets:budgets,emis:emis,settings:settings};
  $("content").innerHTML=pages[currentPage]();
  bindPageActions();
  if(window.lucide?.createIcons) window.lucide.createIcons({attrs:{"stroke-width":1.8}});
}

function metric(title,value,note){
  const icons={"Total Balance":"wallet","This Month Income":"trending-up","This Month Expenses":"trending-down","Net Savings":"piggy-bank"};
  const tone={"Total Balance":"green","This Month Income":"lime","This Month Expenses":"red","Net Savings":"blue"};
  const negative=Number(value)<0;
  return `<div class="card metric ${negative?"negative-state":""}"><div class="metric-icon-wrap"><span class="metric-icon ${negative?"red":(tone[title]||"green")}"><i data-lucide="${icons[title]||"wallet"}"></i></span><small>${title}</small></div><strong>${money(value)}</strong><span class="muted">${note}</span></div>`
}

function dashboard(){
  const mt=monthTx(), wt=weekTx(), income=sum(mt,"income"), expense=sum(mt,"expense"), savings=income-expense;
  const weekly=sum(wt,"expense");
  const recent=[...data.transactions].sort((a,b)=>`${b.date} ${b.time||""}`.localeCompare(`${a.date} ${a.time||""}`)).slice(0,3);
  const aiPreview="AI considers your cash-flow, spending history, goals, EMIs and upcoming commitments. Your long-term accumulated balance is context only and is never treated as weekly spending money.";
  const goalTotal=data.goals.reduce((s,g)=>s+Math.max(0,Number(g.target||0)-Number(g.saved||0)),0);
  const goalWeekly=weeklyGoalRequired();
  const weeklyIncome=sum(wt,"income");
  const commitment7=upcomingCommitments7();
  const safeRaw=weeklyIncome-weekly-commitment7-goalWeekly;
  const safePreview=Math.max(0,safeRaw);
  const safeReasons=[];
  if(weeklyIncome<=0) safeReasons.push("No income recorded for this week");
  if(weekly>0) safeReasons.push(`${money(weekly)} already spent this week`);
  if(commitment7>0) safeReasons.push(`${money(commitment7)} upcoming EMI/loan commitments`);
  if(goalWeekly>0) safeReasons.push(`${money(goalWeekly)} needed for goal funding`);
  const safeExplanation=safePreview>0
    ? `After this week's income, spending, commitments and goal funding, ${money(safePreview)} is currently available for flexible spending.`
    : `No flexible spending money is available right now. ${safeReasons.length?safeReasons.join(" · ")+".":"Add income, spending and commitment data for a more accurate decision."}`;
  const d=new Date(); const monday=(d.getDay()+6)%7;
  const labels=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const points=[0,1,2,3,4,5,6].map(i=>{
    const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()-monday+i);
    const ds=dateKey(x);
    return {label:labels[i],date:x, value:sum(wt.filter(t=>t.date===ds),"expense")};
  });
  const max=Math.max(1,...points.map(p=>p.value));
  const svgW=620, svgH=170, padX=28, padTop=25, padBottom=42;
  const chartPoints=points.map((p,i)=>`${padX+i*((svgW-padX*2)/6)},${padTop+(max-p.value)/max*(svgH-padTop-padBottom)}`).join(" ");
  const dots=points.map((p,i)=>{
    const x=padX+i*((svgW-padX*2)/6),y=padTop+(max-p.value)/max*(svgH-padTop-padBottom);
    const labelY=Math.max(12,y-9);
    return `<circle cx="${x}" cy="${y}" r="3.5" class="chart-dot"/>
      <text x="${x}" y="${labelY}" text-anchor="middle" class="chart-value">${money(p.value)}</text>
      <text x="${x}" y="${svgH-17}" text-anchor="middle" class="chart-label">${p.label}</text>
      <text x="${x}" y="${svgH-3}" text-anchor="middle" class="chart-date">${p.date.getDate()} ${p.date.toLocaleString("en-IN",{month:"short"})}</text>`;
  }).join("");
  const grids=[0,.33,.66,1].map(v=>{const y=padTop+v*(svgH-padTop-padBottom);return `<line x1="${padX}" x2="${svgW-padX}" y1="${y}" y2="${y}" class="chart-grid"/>`}).join("");

  return `<div class="dashboard-head-space"></div>
  <div class="grid4 metrics-grid">
    ${metric("Total Balance",totalBalance(),"All accounts")}
    ${metric("This Month Income",income,"Money received")}
    ${metric("This Month Expenses",expense,"Money spent")}
    ${metric("Net Savings",savings,"Income − expenses")}
  </div>
  <div class="grid2 spaced dashboard-main-grid">
    <div class="card smart-card ${safeRaw<=0?"negative-state":""}">
      <div class="section-row"><h2>🧠 AI Smart Money Management</h2><span class="badge">AI Advisor</span></div>
      <small>Personalized decision window</small>
      <div class="smart-amount ${safeRaw<=0?'smart-zero':''}">${money(safePreview)}</div>
      <b>${safeRaw<=0?'No money left to spend':'currently safe to spend'}</b>
      <p>${aiPreview}</p>
      <div class="smart-reason ${safeRaw<=0?'warning':''}"><strong>${safeRaw<=0?'⚠️ Why ₹0?':'✓ How this is calculated'}</strong><span>${esc(safeExplanation)}</span></div>
      <div class="smart-formula"><span>Weekly income</span><b>${money(weeklyIncome)}</b><span>− Spending</span><b>${money(weekly)}</b><span>− Commitments</span><b>${money(commitment7)}</b><span>− Goal funding</span><b>${money(goalWeekly)}</b></div>
      <div class="smart-stats"><div>This week<strong>${money(weekly)}</strong></div><div>Goals remaining<strong>${money(goalTotal)}</strong></div><div>Monthly savings<strong>${money(savings)}</strong></div></div>
      <button class="primary smart-button" data-action="smart">Ask AI for My Money Decision →</button>
    </div>
    <div class="card weekly-card">
      <div class="section-row"><h2>📊 Weekly Spending</h2><span class="badge">AI input ›</span></div>
      <div class="weekly-head"><div><small>Total spent this week</small><strong>${money(weekly)}</strong></div><select aria-label="Weekly spending range"><option>This Week</option><option>Last Week</option></select></div>
      <div class="line-chart-wrap">
        <svg viewBox="0 0 ${svgW} ${svgH+10}" preserveAspectRatio="none" class="line-chart">
          ${grids}<polyline points="${chartPoints}" class="chart-line"/>${dots}
        </svg>
      </div>
      ${weekly===0?`<div class="weekly-empty compact"><div class="empty-icon">ⓘ</div><div><strong>No spending yet this week.</strong><p>Your weekly spending will appear here as you add transactions.</p></div></div>`:""}
    </div>
  </div>
  <div class="grid2 spaced">
    <div class="card bottom-card"><div class="section-row"><h2>Accounts Overview</h2><button class="link-btn" data-action="add-account">+ Add Account</button></div>
      ${data.accounts.slice(0,2).map(a=>`<div class="list-row account-overview-row"><div class="overview-left">${accountVisual(a)}<div><strong>${esc(a.name)}</strong><small>${esc(a.type)}</small></div></div><strong>${money(a.balance)} <span class="row-arrow">›</span></strong></div>`).join("")||'<div class="empty">No accounts yet.</div>'}
      ${data.accounts.length>0?`<button class="link-btn view-all-btn" data-page-go="accounts">View All Accounts →</button>`:""}
    </div>
    <div class="card bottom-card"><div class="section-row"><h2>Recent Transactions</h2><button class="link-btn" data-page-go="transactions">View All</button></div>
      ${recent.map(transactionRow).join("")||'<div class="empty">No transactions yet. Tap + to add one.</div>'}
      ${recent.length?`<button class="link-btn view-all-btn" data-page-go="transactions">View All Transactions →</button>`:""}
    </div>
  </div>
  <div class="tip-bar"><span>💡</span><span><strong>Tip:</strong> Add more transactions to get better insights and AI recommendations.</span><button data-action="dismiss-tip">×</button></div>`;
}
function transactionRow(t){
  const sign=t.type==="income"?"+":t.type==="expense"?"−":t.type==="goal"?"↗":"⇄";
  return `<div class="list-row"><div><strong>${sign} ${money(t.amount)} · ${esc(t.category||"Transfer")}</strong><small>${esc(t.note||"")} ${t.note?"· ":""}${esc(txDisplayDateTime(t))} · ${esc(t.accountName||"")}${t.toAccountName?` → ${esc(t.toAccountName)}`:""}</small></div><span class="${t.type}">${t.type}</span></div>`;
}

function accounts(){
  return `<div class="section-row page-head"><div><div class="eyebrow">🏦 MONEY HUB</div><h2>Your Accounts</h2><p class="muted">Keep every bank, wallet and card in one clean view.</p></div><button class="primary" data-action="add-account">+ Add Account</button></div>
  <div class="account-summary-row"><div class="summary-pill"><span>💰</span><div><small>Total Money</small><strong>${money(totalBalance())}</strong><em>Included accounts</em></div></div><div class="summary-pill"><span>🚫</span><div><small>Excluded</small><strong>${money(excludedBalance())}</strong><em>Cards / other excluded</em></div></div><div class="summary-pill"><span>🏦</span><div><small>Accounts</small><strong>${data.accounts.length}</strong><em>${data.accounts.filter(a=>a.includeInTotal!==false).length} included</em></div></div></div>
  <div class="accounts-modern-grid">${data.accounts.map(a=>`<div class="card account-modern-card"><div class="account-card-top"><div class="account-brand">${accountVisual(a)}<div><strong>${esc(a.name)}</strong><small>${esc(a.type)}</small></div></div><div class="row-actions"><button class="secondary ghost" data-edit-account="${a.id}">Edit</button><button class="danger ghost" data-delete-account="${a.id}">Delete</button></div></div><div class="account-card-balance">${money(a.balance)}</div><div class="account-card-footer"><label class="include-total-toggle"><input type="checkbox" data-toggle-account-total="${a.id}" ${a.includeInTotal!==false?'checked':''}><span>Include in Total Money</span></label><span>${a.includeInTotal!==false?'✓ Included':'Excluded'} · ✨ ${data.goals.filter(g=>g.accountId===a.id).length} goal${data.goals.filter(g=>g.accountId===a.id).length===1?'':'s'}</span></div></div>`).join("")||'<div class="card empty">No accounts yet. Add your first account.</div>'}</div>`;
}

function transactions(){
  const q=($("searchInput")?.value||"").toLowerCase();
  const list=[...data.transactions].sort((a,b)=>txDateTime(b).localeCompare(txDateTime(a))).filter(t=>`${t.category} ${t.note} ${t.accountName} ${t.toAccountName}`.toLowerCase().includes(q));
  return `<div class="section-row page-head"><div><h2>Transactions</h2><p class="muted">${list.length} transaction${list.length===1?"":"s"}</p></div><button class="primary" data-action="add-transaction">+ Add Transaction</button></div>
  <div class="card">${list.map(t=>`<div class="transaction-full">${transactionRow(t)}<div class="row-actions"><button class="secondary ghost" data-edit-tx="${t.id}">Edit</button><button class="danger ghost" data-delete-tx="${t.id}">Delete</button></div></div>`).join("")||'<div class="empty">No transactions found.</div>'}</div>`;
}

function analytics(){
  const monthStart=dateKey(new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const from=analyticsFrom||monthStart,to=analyticsTo||today();
  const rangeTx=data.transactions.filter(t=>t.date>=from&&t.date<=to);
  const income=sum(rangeTx,"income"),expense=sum(rangeTx,"expense"),net=income-expense;
  const byCat={},byAccount={};
  rangeTx.filter(t=>t.type==="expense").forEach(t=>byCat[t.category||"Other"]=(byCat[t.category||"Other"]||0)+Number(t.amount||0));
  rangeTx.forEach(t=>{
    const k=t.accountName||"Unassigned";
    byAccount[k]=(byAccount[k]||0)+(t.type==="income"?Number(t.amount||0):-Number(t.amount||0));
  });

  const sd=new Date(from+"T12:00:00"),ed=new Date(to+"T12:00:00");
  const span=Math.max(1,Math.round((ed-sd)/86400000)+1),monthly=span>90,groups={};
  rangeTx.forEach(t=>{
    let key=t.date,label=new Date(t.date+"T12:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"});
    if(monthly){
      key=t.date.slice(0,7);
      const [y,m]=key.split("-");
      label=new Date(+y,+m-1,1).toLocaleDateString("en-IN",{month:"short",year:"numeric"});
    }
    groups[key]??={label,income:0,expense:0};
    if(t.type==="income")groups[key].income+=Number(t.amount||0);
    if(t.type==="expense")groups[key].expense+=Number(t.amount||0);
  });
  if(monthly){
    let d=new Date(sd.getFullYear(),sd.getMonth(),1),last=new Date(ed.getFullYear(),ed.getMonth(),1);
    while(d<=last){
      const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      groups[k]??={label:d.toLocaleDateString("en-IN",{month:"short",year:"numeric"}),income:0,expense:0};
      d.setMonth(d.getMonth()+1);
    }
  }else{
    let d=new Date(sd);
    while(d<=ed){
      const k=d.toISOString().slice(0,10);
      groups[k]??={label:d.toLocaleDateString("en-IN",{day:"numeric",month:"short"}),income:0,expense:0};
      d.setDate(d.getDate()+1);
    }
  }

  const trend=Object.keys(groups).sort().map(k=>groups[k]);
  const maxTrend=Math.max(1,...trend.flatMap(x=>[x.income,x.expense]));
  const W=1000,H=360,L=70,R=28,T=38,B=72,IW=W-L-R,IH=H-T-B;
  const px=i=>L+(trend.length<=1?IW/2:i*IW/(trend.length-1));
  const py=v=>T+(maxTrend-v)/maxTrend*IH;
  const step=Math.max(1,Math.ceil(trend.length/(monthly?10:8)));
  const fmtCompact=n=>money(n).replace(".00","");
  const pathFor=key=>{
    if(!trend.length)return "";
    return trend.map((x,i)=>`${i===0?"M":"L"} ${px(i).toFixed(1)} ${py(x[key]).toFixed(1)}`).join(" ");
  };
  const areaFor=key=>{
    if(!trend.length)return "";
    return `${pathFor(key)} L ${px(trend.length-1).toFixed(1)} ${(T+IH).toFixed(1)} L ${px(0).toFixed(1)} ${(T+IH).toFixed(1)} Z`;
  };

  const yGrid=[0,.25,.5,.75,1].map(v=>{
    const y=T+v*IH;
    return `<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="cf-grid"/>
      <text x="${L-12}" y="${y+4}" text-anchor="end" class="cf-y">${esc(fmtCompact(maxTrend*(1-v)))}</text>`;
  }).join("");

  const showPoint=i=>monthly||i%step===0||i===trend.length-1;
  const points=trend.map((x,i)=>{
    if(!showPoint(i))return "";
    const xi=px(i),yi=py(x.income),ye=py(x.expense);
    const incomeLabel=x.income>0?`<g class="cf-value income-value"><rect x="${xi-43}" y="${yi-31}" width="86" height="21" rx="7"/><text x="${xi}" y="${yi-17}" text-anchor="middle">${esc(fmtCompact(x.income))}</text></g>`:"";
    const expenseLabel=x.expense>0?`<g class="cf-value expense-value"><rect x="${xi-43}" y="${ye+10}" width="86" height="21" rx="7"/><text x="${xi}" y="${ye+24}" text-anchor="middle">${esc(fmtCompact(x.expense))}</text></g>`:"";
    return `<circle cx="${xi}" cy="${yi}" r="5" class="cf-dot cf-income"/><circle cx="${xi}" cy="${ye}" r="5" class="cf-dot cf-expense"/>
      <circle cx="${xi}" cy="${yi}" r="10" class="cf-hit"><title>${esc(x.label)} · Income ${money(x.income)} · Expense ${money(x.expense)}</title></circle>
      ${incomeLabel}${expenseLabel}`;
  }).join("");

  const labels=trend.map((x,i)=>showPoint(i)?
    `<text x="${px(i)}" y="${H-30}" text-anchor="middle" class="cf-x">${esc(x.label)}</text>`:"").join("");

  const topCats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const maxCat=Math.max(1,...topCats.map(x=>x[1]));
  const avgDaily=expense/span;
  const goalRemaining=data.goals.reduce((s,g)=>s+Math.max(0,Number(g.target||0)-Number(g.saved||0)),0);
  const quick=[["7 days",7],["30 days",30],["3 months",90],["6 months",180],["1 year",365]];
  const presetButtons=quick.map(([label,n])=>`<button class="range-btn ${label===analyticsPreset?'active':''}" data-analytics-range="${n}">${label}</button>`).join("");

  return `
  <div class="analytics-head card analytics-v17-head">
    <div class="section-row">
      <div><h2>${icon("bar-chart-3",20)} Analytics</h2><p class="muted">See where your money goes and how your cash flow changes over time.</p></div>
      <button class="secondary" id="analyticsReset">${icon("rotate-ccw",15)} This Month</button>
    </div>
    <div class="range-presets">${presetButtons}<button class="range-btn ${analyticsPreset==='custom'?'active':''}" data-analytics-custom="1">Custom</button></div>
    <div class="cashflow-controls analytics-controls">
      <div class="field"><label>From</label><input id="analyticsFrom" type="date" value="${esc(from)}"></div>
      <div class="field"><label>To</label><input id="analyticsTo" type="date" value="${esc(to)}"></div>
    </div>
  </div>

  <div class="grid4 analytics-kpis analytics-v17-kpis">
    ${metric("Money In",income,"Selected period")}
    ${metric("Money Out",expense,"Selected period")}
    ${metric("Net Cash Flow",net,net>=0?"Positive cash flow":"Negative cash flow")}
    ${metric("Avg. Daily Spend",avgDaily,`${span} day${span===1?'':'s'} selected`)}
  </div>

  <div class="card spaced analytics-trend-card analytics-v17-chart">
    <div class="cf-head">
      <div>
        <div class="cf-title">${icon("activity",18)} <h2>Cash Flow Trend</h2></div>
        <p class="muted">${monthly?"Monthly view":"Daily view"} · ${trend.length} ${monthly?"months":"days"} · Income vs expenses</p>
      </div>
      <div class="cf-legend">
        <span><i class="cf-legend-dot income"></i>Income</span>
        <span><i class="cf-legend-dot expense"></i>Expense</span>
      </div>
    </div>
    ${trend.length?`
      <div class="cf-chart">
        <svg viewBox="0 0 ${W} ${H}" class="cf-svg" role="img" aria-label="Cash flow trend">
          <defs>
            <linearGradient id="cfIncomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-opacity=".20"/><stop offset="100%" stop-opacity="0"/></linearGradient>
            <linearGradient id="cfExpenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-opacity=".14"/><stop offset="100%" stop-opacity="0"/></linearGradient>
            <filter id="cfGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          ${yGrid}
          <path d="${areaFor("income")}" class="cf-area cf-income-area"/>
          <path d="${areaFor("expense")}" class="cf-area cf-expense-area"/>
          <path d="${pathFor("income")}" class="cf-line cf-income-line" filter="url(#cfGlow)"/>
          <path d="${pathFor("expense")}" class="cf-line cf-expense-line" filter="url(#cfGlow)"/>
          ${points}${labels}
        </svg>
      </div>
      <div class="cf-summary-row">
        <div><span class="cf-mini-dot income"></span><small>Total Income</small><strong>${money(income)}</strong></div>
        <div><span class="cf-mini-dot expense"></span><small>Total Expense</small><strong>${money(expense)}</strong></div>
        <div><span class="cf-mini-dot net"></span><small>Net Flow</small><strong class="${net>=0?'positive':'negative'}">${net>=0?"+":""}${money(net)}</strong></div>
      </div>
    `:'<div class="empty">No income or expenses in this period.</div>'}
  </div>

  <div class="grid2 spaced">
    <div class="card">
      <div class="section-row"><div><h2>${icon("pie-chart",18)} Where You Spend</h2><small class="muted">Expense breakdown by category</small></div></div>
      <div class="rank-list">${topCats.slice(0,8).map(([c,v],i)=>`<div class="rank-row"><div class="rank-label"><b>${i+1}</b><span>${esc(c)}</span><strong>${money(v)}</strong></div><div class="rank-track"><i style="width:${v/maxCat*100}%"></i></div></div>`).join("")||'<div class="empty">No expenses in this period.</div>'}</div>
    </div>
    <div class="card">
      <div class="section-row"><div><h2>${icon("wallet-cards",18)} Cash Flow by Account</h2><small class="muted">Net movement in selected period</small></div></div>
      ${Object.entries(byAccount).sort((a,b)=>b[1]-a[1]).map(([a,v])=>`<div class="account-flow"><span>${esc(a)}</span><strong class="${v>=0?'income':'expense'}">${v>=0?'+':''}${money(v)}</strong></div>`).join("")||'<div class="empty">No account activity in this period.</div>'}
    </div>
  </div>

  <div class="grid3 spaced analytics-bottom-kpis">
    ${metric("Top Category",topCats[0]?topCats[0][1]:0,topCats[0]?topCats[0][0]:"No expenses")}
    ${metric("Goal Money Remaining",goalRemaining,"Across active goals")}
    ${metric("Transactions",rangeTx.length,monthly?"Selected months":"Selected dates")}
  </div>`;
}
function goals(){
  const plan=overallGoalPlan();
  const noDeadline=plan.active.filter(x=>x.months===null).length;
  return `<div class="section-row page-head"><div><h2>Goals</h2><p class="muted">Each goal is linked to an account. Adding money reserves it from that account and does not count as spending.</p></div><button class="primary" data-action="add-goal">+ Add Goal</button></div>
  <div class="card goal-plan-card ${plan.monthly>0?'':'goal-plan-complete'}">
    <div class="section-row"><div><div class="eyebrow">🎯 OVERALL SAVING PLAN</div><h2>${plan.monthly>0?`${money(plan.monthly)} / month`:'All goals completed 🎉'}</h2><small class="muted">Based on all active goals, their saved amounts and target deadlines.</small></div><div class="goal-plan-total"><small>Total remaining</small><strong>${money(plan.totalRemaining)}</strong></div></div>
    ${plan.monthly>0?`<div class="goal-plan-stats"><div><small>Total target</small><strong>${money(plan.totalTarget)}</strong></div><div><small>Total saved</small><strong>${money(plan.totalSaved)}</strong></div><div><small>Monthly saving needed</small><strong>${money(plan.monthly)}</strong></div></div>`:`<p class="muted">You have reached every goal target.</p>`}
    ${noDeadline?`<small class="muted block">ℹ️ ${noDeadline} active goal${noDeadline===1?'':'s'} has no target date and is not included in the monthly plan.</small>`:''}
  </div>
  <div class="grid2">${data.goals.map(g=>{const target=Number(g.target||0),saved=Number(g.saved||0),remaining=Math.max(0,target-saved),pct=Math.min(100,target?saved/target*100:0),monthly=goalMonthlyRequired(g),months=goalMonthsRemaining(g);const linked=data.accounts.find(a=>a.id===g.accountId);return `<div class="card">
    <div class="section-row"><div><h2>${esc(g.name)}</h2><small>${g.targetDate?`Target ${esc(g.targetDate)}`:"No target date"}</small></div><div class="row-actions"><button class="secondary ghost" data-edit-goal="${g.id}">Edit</button><button class="danger ghost" data-delete-goal="${g.id}">Delete</button></div></div>
    <div class="goal-linked-account"><span>🏦</span><div><small>Linked account</small><strong>${linked?esc(linked.name):"Not linked"}</strong></div></div>
    <div class="grid3 goal-stats"><div><small>Saved</small><strong>${money(saved)}</strong></div><div><small>Remaining</small><strong>${money(remaining)}</strong></div><div><small>Target</small><strong>${money(target)}</strong></div></div>
    ${remaining>0&&g.targetDate?`<div class="goal-saving-plan"><span>📅 Save</span><strong>${money(monthly)}/month</strong><small>${months} month${months===1?'':'s'} remaining</small></div>`:remaining>0?`<div class="goal-saving-plan"><span>📅 Saving plan</span><strong>Set a target date</strong><small>Required monthly saving will appear here.</small></div>`:`<div class="goal-saving-plan complete"><span>✓ Goal complete</span><strong>₹0/month</strong><small>Target achieved</small></div>`}
    <div class="progress"><i style="width:${pct}%"></i></div><small>${pct.toFixed(0)}% complete</small>
    ${linked?(g.autoTrackAccount?`<small class="muted block goal-reserve">🔗 Auto-tracked from ${esc(linked.name)} · goal deposit follows this account's current balance.</small>`:`<small class="muted block goal-reserve">Reserved from ${esc(linked.name)} · available balance ${money(Math.max(0,Number(linked.balance||0)-saved))}</small>`):`<small class="danger-text block">Link an account before adding money.</small>`}
    <button class="primary full goal-add-btn" data-add-goal-money="${g.id}" ${remaining<=0||!linked||g.autoTrackAccount?'disabled':''}>+ Add Money from ${linked?esc(linked.name):'Linked Account'}</button>
  </div>`}).join("")||'<div class="card empty">No goals yet. Create one and link it to an account.</div>'}</div>`;
}
function budgets(){
  return `<div class="section-row page-head"><div><h2>Budgets</h2><p class="muted">Set category spending limits.</p></div><button class="primary" data-action="add-budget">+ Add Budget</button></div>
  <div class="grid2">${data.budgets.map(b=>{const spent=sum(monthTx(),"expense") && monthTx().filter(t=>t.category===b.category&&t.type==="expense").reduce((s,t)=>s+Number(t.amount),0);const pct=Math.min(100,b.limit?spent/b.limit*100:0);return `<div class="card"><div class="section-row"><h2>${esc(b.category)}</h2><button class="danger ghost" data-delete-budget="${b.id}">Delete</button></div><strong>${money(spent)} / ${money(b.limit)}</strong><div class="progress"><i style="width:${pct}%"></i></div></div>`}).join("")||'<div class="card empty">No budgets yet.</div>'}</div>`;
}

function formatEmiDate(value){
  const d=new Date(String(value||"")+"T12:00:00");
  return Number.isNaN(d.getTime()) ? String(value||"") : d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
}
function emiDateForMonth(year,monthIndex,day){
  const safeDay=Math.max(1,Math.min(31,Number(day||1)));
  const last=new Date(year,monthIndex+1,0).getDate();
  return new Date(year,monthIndex,Math.min(safeDay,last),12,0,0);
}
function emiPaymentTransactions(e){
  return (data.transactions||[])
    .filter(t=>t.emiId===e.id && (t.transactionKind==="emi_payment" || t.type==="expense"))
    .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
}
function emiCycleForDate(year,monthIndex,day){
  const due=emiDateForMonth(year,monthIndex,day);
  return {year:due.getFullYear(),month:due.getMonth(),due};
}
function emiIsPaidForCycle(e,year,monthIndex){
  return emiPaymentTransactions(e).some(t=>{
    const d=new Date(String(t.date||"")+"T12:00:00");
    return !Number.isNaN(d.getTime()) && d.getFullYear()===year && d.getMonth()===monthIndex;
  });
}
function calculateEmiNextDate(e){
  const now=new Date();
  const day=Math.max(1,Math.min(31,Number(e.paymentDay||1)));
  const startDate=e.startDate?new Date(`${e.startDate}T12:00:00`):null;
  if(startDate && !Number.isNaN(startDate.getTime())){
    const todayKey=dateKey(now);
    const startKey=dateKey(startDate);
    if(todayKey < startKey) return startKey;

    // The first EMI is anchored to the selected start date. Once that cycle
    // is paid, future cycles use the selected payment day each month.
    if(now.getFullYear()===startDate.getFullYear() && now.getMonth()===startDate.getMonth()){
      if(emiIsPaidForCycle(e,startDate.getFullYear(),startDate.getMonth())){
        return dateKey(emiDateForMonth(now.getFullYear(),now.getMonth()+1,day));
      }
      return startKey;
    }
  }

  let cycle=emiCycleForDate(now.getFullYear(),now.getMonth(),day);
  if(emiIsPaidForCycle(e,cycle.year,cycle.month)){
    cycle=emiCycleForDate(cycle.year,cycle.month+1,day);
  }
  return dateKey(cycle.due);
}
function upcomingEmis(){
  return (data.emis||[])
    .filter(e=>Number(e.remainingAmount||0)>0 && Number(e.remainingEmis||0)>0)
    .map(e=>({...e,nextDate:calculateEmiNextDate(e)}))
    .sort((a,b)=>String(a.nextDate).localeCompare(String(b.nextDate)));
}
function openLoanPaymentModal(loanId){
  const l=(data.loans||[]).find(x=>x.id===loanId);
  if(!l) return;
  const isLent=l.direction==='lent';
  const paid=Number(isLent?l.repaid:l.paid||0), total=Number(l.amount||0);
  const remaining=Math.max(0,total-paid);
  const accounts=data.accounts||[];
  const modal=document.createElement('div');
  modal.className='modal-overlay';
  modal.innerHTML=`<div class="modal-card">
    <div class="modal-head"><div><h2>${isLent?'💚 Record Money Received':'❤️ Record Payment'}</h2><p class="muted">${esc(l.person)} · Remaining ${money(remaining)}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
    <form id="loan-payment-form">
      <label>Amount<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" required placeholder="0.00"></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Time<input name="time" type="time" value="${new Date().toTimeString().slice(0,5)}" required></label>
      <label>${isLent?'Money received into':'Payment made from'} account<select name="accountId" required><option value="">Select account</option>${accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance)}</option>`).join("")}</select></label>
      <label>Note (optional)<input name="note" maxlength="120" placeholder="${isLent?'Partial repayment':'Loan payment'}"></label>
      <div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancel</button><button type="submit" class="primary">${isLent?'Record Received':'Record Payment'}</button></div>
    </form>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-modal]').forEach(b=>b.onclick=()=>modal.remove());
  modal.querySelector('#loan-payment-form').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), amount=Number(fd.get('amount')), accountId=fd.get('accountId');
    const account=accounts.find(a=>a.id===accountId);
    if(!account||!amount||amount<=0||amount>remaining) return alert('Please enter a valid amount and account.');
    const payment={id:crypto.randomUUID(),amount,date:fd.get('date'),accountId,note:fd.get('note')||'',accountName:account.name};
    l.payments=Array.isArray(l.payments)?l.payments:[]; l.payments.push(payment);
    if(isLent) l.repaid=paid+amount; else l.paid=paid+amount;
    account.balance=Number(account.balance||0)+(isLent?amount:-amount);
    data.transactions=data.transactions||[];
    data.transactions.push({
      id:crypto.randomUUID(),date:payment.date,timestamp:`${payment.date}T${fd.get('time')||"00:00"}`,type:isLent?'income':'expense',amount,
      category:isLent?'Loan Repayment Received':'Loan Payment',
      description:`${isLent?'Received from':'Paid to'} ${l.person}`,
      accountId,loanId:l.id,loanPaymentId:payment.id
    });
    modal.remove();
    await persist();
    render();
  };
}

async function deleteLoanPayment(loanId,paymentId){
  const l=(data.loans||[]).find(x=>x.id===loanId);
  if(!l||!Array.isArray(l.payments)) return;
  const p=l.payments.find(x=>x.id===paymentId);
  if(!p) return;
  if(!confirm(`Delete this payment of ${money(p.amount)}? The account balance will be reverted.`)) return;
  const isLent=l.direction==='lent';
  if(isLent) l.repaid=Math.max(0,Number(l.repaid||0)-Number(p.amount||0));
  else l.paid=Math.max(0,Number(l.paid||0)-Number(p.amount||0));
  const account=(data.accounts||[]).find(a=>a.id===p.accountId);
  if(account) account.balance=Number(account.balance||0)+(isLent?-Number(p.amount||0):Number(p.amount||0));
  data.transactions=(data.transactions||[]).filter(t=>t.loanPaymentId!==paymentId);
  l.payments=l.payments.filter(x=>x.id!==paymentId);
  await persist();
  render();
}

document.addEventListener('click',e=>{
  const pay=e.target.closest('[data-loan-payment]');
  if(pay){ openLoanPaymentModal(pay.dataset.loanPayment); return; }
  const del=e.target.closest('[data-delete-loan-payment]');
  if(del){ const [loanId,paymentId]=del.dataset.deleteLoanPayment.split('|'); deleteLoanPayment(loanId,paymentId); }
});

function emis(){
  const list=data.emis||[], loans=data.loans||[];
  const lent=loans.filter(l=>l.direction==='lent');
  const owe=loans.filter(l=>l.direction==='owe');
  const emiRemaining=list.reduce((s,e)=>s+Math.max(0,Number(e.remainingAmount||0)),0);
  const toReceive=lent.reduce((s,l)=>s+Math.max(0,Number(l.amount||0)-Number(l.repaid||0)),0);
  const toGive=owe.reduce((s,l)=>s+Math.max(0,Number(l.amount||0)-Number(l.paid||0)),0);
  const loanCard=(l)=>{
    const isLent=l.direction==='lent', paid=Number(isLent?l.repaid:l.paid||0), total=Number(l.amount||0);
    const remaining=Math.max(0,total-paid), pct=total?Math.min(100,paid/total*100):0;
    return `<div class="card loan-card ${isLent?'loan-receive':'loan-give'}">
      <div class="loan-card-head">
        <div class="loan-person">
          <span class="loan-avatar ${isLent?'receive':'give'}">${isLent?'🤝':'📌'}</span>
          <div><h3>${esc(l.person)}</h3><small>${isLent?'They owe you':'You need to pay them'}${l.dueDate?' · Due '+esc(l.dueDate):''}</small></div>
        </div>
        <div class="row-actions"><button class="primary ghost" data-loan-payment="${l.id}">${isLent?'＋ Record Received':'＋ Record Payment'}</button><button class="secondary ghost" data-edit-loan="${l.id}">Edit</button><button class="danger ghost" data-delete-loan="${l.id}">Delete</button></div>
      </div>
      <div class="loan-amount ${isLent?'positive':'negative'}">${money(remaining)}</div>
      <div class="loan-meta"><span>${isLent?'Remaining to receive':'Remaining to give'}</span><span>${money(paid)} settled</span></div>
      <div class="progress loan-progress"><i style="width:${pct}%"></i></div>
      <div class="loan-foot"><strong>${pct.toFixed(0)}% settled</strong>${l.note?`<span> · ${esc(l.note)}</span>`:""}</div>
      ${Array.isArray(l.payments)&&l.payments.length?`<div class="loan-payments"><strong>Payment history</strong>${l.payments.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(p=>`<div class="loan-payment-row"><span>${money(p.amount)} · ${esc(p.date||'')}</span><span>${esc(p.accountName||'Account')}${p.note?' · '+esc(p.note):''}</span><button class="danger ghost tiny" data-delete-loan-payment="${l.id}|${p.id}">Delete</button></div>`).join("")}</div>`:""}
    </div>`;
  };
  const emiRows=list.map(e=>{
    const paid=Math.max(0,Number(e.totalAmount||0)-Number(e.remainingAmount||0)), pct=e.totalAmount?Math.min(100,paid/Number(e.totalAmount)*100):0;
    const account=data.accounts.find(a=>a.id===e.paymentAccount);
    const due=formatEmiDate(calculateEmiNextDate(e));
    return `<div class="emi-table-row">
      <div class="emi-name"><span class="emi-icon">💳</span><div><strong>${esc(e.name)}</strong><small>${esc(e.lender||"EMI / Loan")}</small></div></div>
      <div>${money(e.totalAmount)}</div><div>${money(e.monthly)}</div><div>${Number(e.totalEmis||0)}</div><div>${Number(e.paidEmis||0)}</div><div>${Number(e.remainingEmis||0)}</div>
      <div>${money(paid)}</div><div><strong>${money(e.remainingAmount)}</strong><div class="mini-progress"><i style="width:${pct}%"></i></div></div>
      <div>${esc(due)}</div><div class="emi-account">${account?`🏦 ${esc(account.name)}`:"—"}</div>
      <div class="row-actions emi-actions"><button class="primary ghost" data-pay-emi="${e.id}">Mark Paid</button><button class="secondary ghost" data-edit-emi="${e.id}">Edit</button><button class="danger ghost" data-delete-emi="${e.id}">Delete</button></div>
    </div>`;
  }).join("");

  return `<div class="emi-loans-page">
    <div class="section-row page-head"><div><h2>💳 EMIs & Loans</h2><p class="muted">Track your monthly EMIs and every amount you owe or are owed.</p></div><div class="row-actions"><button class="secondary" data-action="add-loan">+ Add Loan</button><button class="primary" data-action="add-emi">+ Add EMI / Loan</button></div></div>

    <div class="loan-summary-row v23-summary">
      <div class="summary-pill summary-liability"><span>💳</span><div><small>EMI Remaining</small><strong>${money(emiRemaining)}</strong></div></div>
      <div class="summary-pill summary-receive"><span>💚</span><div><small>To Receive</small><strong>${money(toReceive)}</strong></div></div>
      <div class="summary-pill summary-give"><span>❤️</span><div><small>To Give</small><strong>${money(toGive)}</strong></div></div>
    </div>

    <section class="loan-section receive-section">
      <div class="loan-section-head"><div><h2>💚 Money Someone Owes You</h2><span class="section-badge receive-badge">To Receive</span></div><button class="secondary receive-btn" data-action="add-loan">＋ Add Loan (To Receive)</button></div>
      <p class="muted">Money you have already given and expect to receive back.</p>
      <div class="grid2 spaced">${lent.map(loanCard).join("")||'<div class="card empty">No money to receive yet.</div>'}</div>
    </section>

    <section class="loan-section give-section">
      <div class="loan-section-head"><div><h2>❤️ Money You Owe Someone</h2><span class="section-badge give-badge">To Give</span></div><button class="secondary give-btn" data-action="add-loan">＋ Add Loan (To Give)</button></div>
      <p class="muted">Money you still need to pay someone. This is excluded from Total Money.</p>
      <div class="grid2 spaced">${owe.map(loanCard).join("")||'<div class="card empty">No money to give yet.</div>'}</div>
    </section>

    <section class="loan-section emi-section">
      <div class="loan-section-head"><div><h2>💜 EMIs / Loans You Are Paying</h2><span class="section-badge liability-badge">Liability</span></div><button class="secondary emi-btn" data-action="add-emi">＋ Add EMI / Loan</button></div>
      <div class="emi-table-wrap"><div class="emi-table">
        <div class="emi-table-head"><div>Loan / EMI</div><div>Total Amount</div><div>Monthly EMI</div><div>Total EMIs</div><div>Paid EMIs</div><div>Remaining</div><div>Amount Paid</div><div>Remaining Amount</div><div>Next Due</div><div>Account</div><div>Action</div></div>
        ${emiRows||'<div class="card empty">No EMIs yet. Add your first EMI or loan.</div>'}
      </div></div>
    </section>
    <div class="loan-disclaimer">ℹ️ Loans (To Receive / To Give) and EMIs are tracked separately and are <strong>not included in Total Money</strong>.</div>
  </div>`;
}

function settings(){return `<div class="grid2"><div class="card"><h2>Categories</h2><div class="chip-list">${data.categories.map(c=>`<span class="chip">${esc(c)} <button data-delete-category="${esc(c)}">×</button></span>`).join("")}</div><button class="primary" data-action="add-category">+ Add Category</button></div><div class="card"><h2>Account Types</h2><p class="muted">Create custom account types just like categories.</p><div class="chip-list">${(data.accountTypes||[]).map(t=>`<span class="chip">${esc(t)} <button data-delete-account-type="${esc(t)}">×</button></span>`).join("")}</div><button class="primary" data-action="add-account-type">+ Add Account Type</button></div><div class="card"><h2>Import your TimelyBills Excel</h2><p class="muted">Import transaction history from a TimelyBills Excel or CSV statement. Your existing account balances are not changed unless you choose to update them.</p><div class="import-help"><strong>Recommended</strong><span>Use TimelyBills → Transactions → Download → Excel. A Transaction List is easiest to import. TimelyBills also supports grouped Excel statements with separate sheets per account.</span></div><label class="primary file-btn import-excel-label">Choose Excel / CSV<input id="timelyBillsFile" type="file" accept=".xlsx,.xls,.csv" hidden></label><small class="muted block">Supports .xlsx, .xls and .csv</small></div><div class="card"><h2>Backup</h2><p class="muted">Use My Money Backup for moving your complete app data between browsers.</p><button class="secondary" data-action="export">Export Backup</button><label class="secondary file-btn">Import Backup<input id="importFile" type="file" accept=".json" hidden></label><button class="danger" data-action="clear">Clear Local Data</button></div></div>`}

function bindPageActions(){
  document.querySelectorAll("[data-page-go]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.pageGo;render()});
  document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>actions(b.dataset.action));
  document.querySelectorAll("[data-delete-tx]").forEach(b=>b.onclick=()=>deleteTx(b.dataset.deleteTx));
  document.querySelectorAll("[data-delete-account]").forEach(b=>b.onclick=()=>deleteAccount(b.dataset.deleteAccount));
  document.querySelectorAll("[data-delete-goal]").forEach(b=>b.onclick=()=>{data.goals=data.goals.filter(x=>x.id!==b.dataset.deleteGoal);save();render()});
  document.querySelectorAll("[data-add-goal-money]").forEach(b=>b.onclick=()=>addGoalMoney(b.dataset.addGoalMoney));
  document.querySelectorAll("[data-delete-budget]").forEach(b=>b.onclick=()=>{data.budgets=data.budgets.filter(x=>x.id!==b.dataset.deleteBudget);save();render()});
  document.querySelectorAll("[data-delete-category]").forEach(b=>b.onclick=()=>{if(confirm("Delete this category?")){data.categories=data.categories.filter(x=>x!==b.dataset.deleteCategory);save();render()}});
  document.querySelectorAll("[data-delete-account-type]").forEach(b=>b.onclick=()=>deleteAccountType(b.dataset.deleteAccountType));
  document.querySelectorAll("[data-delete-emi]").forEach(b=>b.onclick=()=>deleteEmi(b.dataset.deleteEmi));
  document.querySelectorAll("[data-edit-loan]").forEach(b=>b.onclick=()=>editLoan(b.dataset.editLoan));
  document.querySelectorAll("[data-delete-loan]").forEach(b=>b.onclick=()=>deleteLoan(b.dataset.deleteLoan));
  document.querySelectorAll("[data-pay-emi]").forEach(b=>b.onclick=()=>payEmi(b.dataset.payEmi));
  const f=$("importFile"); if(f) f.onchange=importBackup;
  const tf=$("timelyBillsFile"); if(tf) tf.onchange=importTimelyBills;
  const af=$("analyticsFrom"), at=$("analyticsTo");
  if(af) af.onchange=()=>{ analyticsFrom=af.value; analyticsPreset="custom"; if(analyticsTo && analyticsFrom>analyticsTo) analyticsTo=analyticsFrom; render(); };
  if(at) at.onchange=()=>{ analyticsTo=at.value; analyticsPreset="custom"; if(analyticsFrom && analyticsTo<analyticsFrom) analyticsFrom=analyticsTo; render(); };
  const ar=$("analyticsReset"); if(ar) ar.onclick=()=>{ analyticsFrom=dateKey(new Date(new Date().getFullYear(),new Date().getMonth(),1)); analyticsTo=today(); analyticsPreset="This Month"; render(); };
  document.querySelectorAll("[data-analytics-range]").forEach(b=>b.onclick=()=>{ const n=Number(b.dataset.analyticsRange); const d=new Date(); d.setDate(d.getDate()-n+1); analyticsFrom=dateKey(d); analyticsTo=today(); analyticsPreset=b.textContent; render(); });
  const ac=document.querySelector("[data-analytics-custom]"); if(ac) ac.onclick=()=>{analyticsPreset="custom"; render();};

  document.querySelectorAll("[data-toggle-account-total]").forEach(b=>b.onchange=()=>{const a=data.accounts.find(x=>x.id===b.dataset.toggleAccountTotal);if(a){a.includeInTotal=b.checked;save();render();toast(b.checked?`${a.name} included in Total Money.`:`${a.name} excluded from Total Money.`);}});
  document.querySelectorAll("[data-edit-account]").forEach(b=>b.onclick=()=>editAccount(b.dataset.editAccount));
  document.querySelectorAll("[data-edit-goal]").forEach(b=>b.onclick=()=>editGoal(b.dataset.editGoal));
  document.querySelectorAll("[data-edit-emi]").forEach(b=>b.onclick=()=>editEmi(b.dataset.editEmi));
  document.querySelectorAll("[data-edit-tx]").forEach(b=>b.onclick=()=>editTransaction(b.dataset.editTx));
}

async function openSmartDecision(){
  const mt=monthTx(), wt=weekTx();
  const payload={
    today:today(),
    accounts:data.accounts.map(a=>({name:a.name,type:a.type,balance:Number(a.balance||0),includeInTotal:a.includeInTotal!==false})),
    loans:(data.loans||[]).map(l=>({person:l.person,direction:l.direction,amount:Number(l.amount||0),settled:Number(l.direction==='lent'?l.repaid:l.paid||0),dueDate:l.dueDate||null,note:l.note||''})),
    goals:(data.goals||[]).map(g=>({name:g.name,target:Number(g.target||0),saved:Number(g.saved||0),remaining:Math.max(0,Number(g.target||0)-Number(g.saved||0)),targetDate:g.targetDate||null,linkedAccount:(data.accounts||[]).find(a=>a.id===g.accountId)?.name||null,autoTrack:!!g.autoTrackAccount})),
    budgets:data.budgets,
    emis:(data.emis||[]).map(e=>({name:e.name,lender:e.lender,totalAmount:Number(e.totalAmount||0),remainingAmount:Number(e.remainingAmount||0),monthly:Number(e.monthly||0),remainingEmis:Number(e.remainingEmis||0),paymentDay:Number(e.paymentDay||1),paymentAccount:e.paymentAccount||null,nextDate:calculateEmiNextDate(e),nextDateDisplay:formatEmiDate(calculateEmiNextDate(e))})),
    categories:data.categories,
    thisMonth:{income:sum(mt,"income"),expense:sum(mt,"expense"),savings:sum(mt,"income")-sum(mt,"expense")},
    thisWeek:{income:sum(wt,"income"),expense:sum(wt,"expense")},
    transactionHistory:[...data.transactions].sort((a,b)=>b.date.localeCompare(a.date)),
    spendingDefinition:"Weekly spending = expense transactions dated Monday-Sunday of the current local week. Exclude income, transfers between own accounts, balances, and long-term accumulated savings.",
    safeSpendRule:"The app-calculated dashboard safe-to-spend value is authoritative. Do not replace it with total account balance or liquid balance. Consider every supplied EMI, loan commitment, goal reserve/contribution and actual spending. If the safe amount is below zero, display ₹0 and explain why."
  };
  modal("🧠 AI Money Decision",`<div class="ai-loading"><div class="big-emoji">🧠</div><h3>Analyzing your money…</h3><p class="muted">AI is reviewing your spending, goals, balances and recent transactions.</p></div>`);
  try{
    const { getSmartMoneyAdvice } = await import("./ai.js");
    const advice=await getSmartMoneyAdvice(payload);
    $("modalBody").innerHTML=`<div class="ai-result"><div class="ai-badge">AI MONEY ADVISOR</div><div class="ai-text">${esc(advice).replace(/\n/g,"<br>")}</div><p class="muted ai-note">This is a recommendation, not an automatic money transfer. Review every action before making it.</p></div>`;
  }catch(e){
    $("modalBody").innerHTML=`<div class="empty"><h3>AI advisor isn't connected yet.</h3><p>${esc(e.message||"Enable Firebase AI Logic for this Firebase project, then try again.")}</p><button class="primary" id="retryAi">Try Again</button></div>`;
    $("retryAi").onclick=openSmartDecision;
  }
}

function actions(a){
  if(a==="add-transaction") openTransaction();
  if(a==="add-account") openAccount();
  if(a==="add-category") openCategory();
  if(a==="add-account-type") openAccountType();
  if(a==="add-goal") openGoal();
  if(a==="add-budget") openBudget();
  if(a==="add-emi") openEmi();
  if(a==="add-loan") openLoan();
  if(a==="smart") openSmartDecision();
  if(a==="dismiss-tip"){ const el=document.querySelector(".tip-bar"); if(el) el.remove(); }
  if(a==="export") exportBackup();
  if(a==="clear" && confirm("Clear all local My Money data?")){localStorage.removeItem(KEY);data=load();render();toast("Local data cleared.");}
}

function modal(title,body){$("modalTitle").textContent=title;$("modalBody").innerHTML=body;$("modal").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}

function openTransaction(){
  const options=data.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance)}</option>`).join("");
  const transactionCategories=[...new Set([...(data.categories||[]),"Bills & Utilities","Goal Savings"])];
  const cats=transactionCategories.map(c=>`<option>${esc(c)}</option>`).join("");
  const emis=data.emis||[];
  const goals=data.goals||[];
  modal("Add Transaction",`<div class="tabs"><button class="active" data-tab="expense">Expense</button><button data-tab="income">Income</button><button data-tab="transfer">Transfer</button><button data-tab="emi">EMI Payment</button><button data-tab="goal">Goal Contribution</button></div>
  <form id="txForm" class="form-grid"><input type="hidden" name="type" value="expense">
  <div class="field full"><label>Amount</label><input id="txAmount" name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></div>
  <div class="field expense-only"><label>Category</label><select name="category">${cats}</select></div>
  <div class="field expense-only"><label>From Account</label><select name="accountId">${options||'<option value="">Add an account first</option>'}</select></div>
  <div class="field income-only hidden-field"><label>Category</label><select name="incomeCategory"><option>Salary</option>${cats}</select></div>
  <div class="field income-only hidden-field"><label>To Account</label><select name="incomeAccountId">${options||'<option value="">Add an account first</option>'}</select></div>
  <div class="field transfer-only hidden-field"><label>From Account</label><select name="fromId">${options||'<option value="">Add an account first</option>'}</select></div>
  <div class="field transfer-only hidden-field"><label>To Account</label><select name="toId">${options||'<option value="">Add an account first</option>'}</select></div>
  <div class="field emi-only hidden-field full"><label>Which EMI?</label><select id="txEmiId" name="emiId"><option value="">Select EMI</option>${emis.map(e=>`<option value="${e.id}" data-amount="${Number(e.monthly||0)}">${esc(e.name)} · ${money(e.monthly)} · ${Number(e.remainingEmis||0)} left</option>`).join("")}</select></div>
  <div class="field emi-only hidden-field"><label>Category</label><select name="emiCategory"><option selected>Bills &amp; Utilities</option>${transactionCategories.filter(c=>c!=="Bills & Utilities").map(c=>`<option>${esc(c)}</option>`).join("")}</select></div>
  <div class="field emi-only hidden-field"><label>From Account</label><select name="emiAccountId">${options||'<option value="">Add an account first</option>'}</select></div>
  <div class="field goal-only hidden-field full"><label>Which Goal?</label><select name="goalId"><option value="">Select Goal</option>${goals.map(g=>`<option value="${g.id}" data-remaining="${Math.max(0,Number(g.target||0)-Number(g.saved||0))}">${esc(g.name)} · ${money(g.saved||0)} saved · ${money(Math.max(0,Number(g.target||0)-Number(g.saved||0)))} left</option>`).join("")}</select></div>
  <div class="field goal-only hidden-field"><label>Category</label><select name="goalCategory"><option selected>Goal Savings</option>${transactionCategories.filter(c=>c!=="Goal Savings").map(c=>`<option>${esc(c)}</option>`).join("")}</select></div>
  <div class="field goal-only hidden-field"><label>From Account</label><select name="goalAccountId">${options||'<option value="">Add an account first</option>'}</select></div>
  <div class="field"><label>Date</label><input name="date" type="date" value="${today()}" required></div>
  <div class="field"><label>Time</label><input name="time" type="time" value="${new Date().toTimeString().slice(0,5)}" required></div>
  <div class="field full"><label>Note</label><input name="note" placeholder="Optional note"></div>
  <button class="primary full" type="submit">Save Transaction</button></form>`);
  document.querySelectorAll("[data-tab]").forEach(btn=>btn.onclick=()=>switchTab(btn.dataset.tab));
  const emiSelect=$("txEmiId"); if(emiSelect) emiSelect.onchange=()=>{const opt=emiSelect.selectedOptions[0]; if(opt?.dataset.amount) $("txAmount").value=opt.dataset.amount;};
  const goalSelect=document.querySelector('[name="goalId"]'); if(goalSelect) goalSelect.onchange=()=>{const opt=goalSelect.selectedOptions[0]; if(opt?.dataset.remaining) $("txAmount").max=opt.dataset.remaining;};
  $("txForm").onsubmit=e=>{e.preventDefault();saveTransaction(new FormData(e.target));};
}
function switchTab(type){
  $("txForm").elements.type.value=type;
  document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===type));
  document.querySelectorAll(".expense-only").forEach(x=>x.classList.toggle("hidden-field",type!=="expense"));
  document.querySelectorAll(".income-only").forEach(x=>x.classList.toggle("hidden-field",type!=="income"));
  document.querySelectorAll(".transfer-only").forEach(x=>x.classList.toggle("hidden-field",type!=="transfer"));
  document.querySelectorAll(".emi-only").forEach(x=>x.classList.toggle("hidden-field",type!=="emi"));
  document.querySelectorAll(".goal-only").forEach(x=>x.classList.toggle("hidden-field",type!=="goal"));
  if(type==="emi"){
    const sel=$("txEmiId"); if(sel?.value) $("txAmount").value=sel.selectedOptions[0].dataset.amount||"";
  }
}
function saveTransaction(f){
  const type=f.get("type"), amount=Number(f.get("amount")); if(!amount||amount<=0)return toast("Enter a valid amount.");
  if(type==="transfer"){
    const from=data.accounts.find(a=>a.id===f.get("fromId")), to=data.accounts.find(a=>a.id===f.get("toId"));
    if(!from||!to||from.id===to.id)return toast("Choose two different accounts.");
    if(from.balance<amount)return toast("Insufficient balance in source account.");
    from.balance-=amount;to.balance+=amount;
    data.transactions.push({id:uid("tx"),type,amount,date:f.get("date"),timestamp:`${f.get("date")}T${f.get("time")||"00:00"}`,note:f.get("note"),category:"Transfer",accountName:from.name,toAccountName:to.name,fromAccountId:from.id,toAccountId:to.id,transactionKind:"transfer"});
  } else if(type==="expense"){
    const ac=data.accounts.find(a=>a.id===f.get("accountId")); if(!ac)return toast("Add an account first.");
    if(ac.balance<amount)return toast("Insufficient balance in this account.");
    ac.balance-=amount;data.transactions.push({id:uid("tx"),type,amount,date:f.get("date"),timestamp:`${f.get("date")}T${f.get("time")||"00:00"}`,note:f.get("note"),category:f.get("category"),accountName:ac.name,accountId:ac.id,transactionKind:"expense"});
  } else if(type==="income"){
    const ac=data.accounts.find(a=>a.id===f.get("incomeAccountId")); if(!ac)return toast("Add an account first.");
    ac.balance+=amount;data.transactions.push({id:uid("tx"),type,amount,date:f.get("date"),timestamp:`${f.get("date")}T${f.get("time")||"00:00"}`,note:f.get("note"),category:f.get("incomeCategory"),accountName:ac.name,accountId:ac.id,transactionKind:"income"});
  } else if(type==="emi"){
    const e=(data.emis||[]).find(x=>x.id===f.get("emiId")); const ac=data.accounts.find(a=>a.id===f.get("emiAccountId"));
    if(!e)return toast("Select which EMI was paid."); if(!ac)return toast("Select the payment account.");
    const remaining=Math.max(0,Number(e.remainingAmount||0)); if(remaining<=0||Number(e.remainingEmis||0)<=0)return toast("This EMI is already fully paid.");
    const before={remainingAmount:remaining,paidEmis:Number(e.paidEmis||0),remainingEmis:Number(e.remainingEmis||0),nextDate:e.nextDate||calculateEmiNextDate(e)};
    const payment=Math.min(amount,remaining,Number(e.monthly||amount)); if(ac.balance<payment)return toast("Insufficient balance in payment account.");
    ac.balance-=payment; e.remainingAmount=Math.max(0,remaining-payment); e.paidEmis=Math.min(Number(e.totalEmis||0),Number(e.paidEmis||0)+1); e.remainingEmis=Math.max(0,Number(e.totalEmis||0)-Number(e.paidEmis||0));
    e.nextDate=(e.remainingAmount<=0||e.remainingEmis<=0)?null:nextEmiDate(e.paymentDay,e.nextDate);
    data.transactions.push({id:uid("tx"),type:"expense",amount:payment,date:f.get("date"),timestamp:`${f.get("date")}T${f.get("time")||"00:00"}`,note:f.get("note")||`EMI payment · ${e.name}`,category:f.get("emiCategory")||"Bills & Utilities",accountName:ac.name,accountId:ac.id,emiId:e.id,transactionKind:"emi_payment",emiBefore:before});
  } else if(type==="goal"){
    const g=(data.goals||[]).find(x=>x.id===f.get("goalId")); const ac=data.accounts.find(a=>a.id===f.get("goalAccountId"));
    if(!g)return toast("Select which goal this money is for."); if(!g.accountId)return toast("Link this goal to an account first."); if(!ac)return toast("Select the account to take the money from.");
    if(ac.id!==g.accountId)return toast("This goal is linked to another account. Use its linked account.");
    const remaining=Math.max(0,Number(g.target||0)-Number(g.saved||0)); if(remaining<=0)return toast("This goal is already complete."); if(amount>remaining)return toast(`Maximum you can add is ${money(remaining)}.`); if(ac.balance<amount)return toast("Insufficient balance in this account.");
    ac.balance-=amount; g.saved=Number(g.saved||0)+amount; data.transactions.push({id:uid("tx"),type:"goal",amount,date:f.get("date"),timestamp:`${f.get("date")}T${f.get("time")||"00:00"}`,note:f.get("note")||`Goal contribution · ${g.name}`,category:f.get("goalCategory")||"Goal Savings",accountName:ac.name,accountId:ac.id,goalId:g.id,goalAccountId:ac.id,transactionKind:"goal_contribution"});
  }
  save();closeModal();render();toast("Transaction saved.");
}
function nextEmiDate(day,current){ if(!current)return null; const d=new Date(current+"T12:00:00"); d.setMonth(d.getMonth()+1); return new Date(d.getFullYear(),d.getMonth(),Math.min(28,Number(day||1))).toISOString().slice(0,10); }
function openAccount(editId=null){
  const existing=editId?data.accounts.find(a=>a.id===editId):null; const a=existing||{}; const types=data.accountTypes||[];
  modal(existing?"Edit Account":"Add Account",`<form id="accountForm" class="form-grid"><div class="field full"><label>Account name</label><input name="name" value="${esc(a.name||"")}" required placeholder="e.g. HDFC Bank"></div><div class="field"><label>Account type</label><select name="type">${types.map(t=>`<option ${t===a.type?'selected':''}>${esc(t)}</option>`).join("")}</select></div><div class="field"><label>Current balance</label><input name="balance" type="number" step="0.01" value="${Number(a.balance||0)}"></div><div class="field full"><label>Logo URL <span class="muted">(optional)</span></label><input name="logo" value="${esc(a.logo||"")}" placeholder="https://.../logo.png"><small class="muted">Leave empty and My Money will automatically choose an emoji/icon based on the account name and type.</small></div><div class="field full"><label class="checkbox-row"><input type="checkbox" name="includeInTotal" ${a.includeInTotal!==false?'checked':''}> <span>Include this account in Total Money</span></label><small class="muted">Turn this off for credit cards or money you don't want treated as your actual available money.</small></div><button class="primary full">${existing?"Save Changes":"Save Account"}</button></form>`);
  $("accountForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const name=f.get("name").trim();if(!name)return; if(existing){existing.name=name;existing.type=f.get("type");existing.balance=Number(f.get("balance")||0);existing.logo=f.get("logo").trim()||null;existing.includeInTotal=f.get("includeInTotal")==="on";}else data.accounts.push({id:uid("a"),name,type:f.get("type"),balance:Number(f.get("balance")||0),logo:f.get("logo").trim()||null,includeInTotal:f.get("includeInTotal")==="on"});save();closeModal();render();toast(existing?"Account updated.":"Account added.");}
}
function editAccount(id){openAccount(id);}

function openAccountType(){modal("Add Account Type",`<form id="accountTypeForm" class="form-grid"><div class="field full"><label>Account type name</label><input name="name" required placeholder="e.g. UPI Wallet, Loan, FD"></div><button class="primary full">Add Account Type</button></form>`);$("accountTypeForm").onsubmit=e=>{e.preventDefault();const n=new FormData(e.target).get("name").trim();if(!n)return;if(!data.accountTypes)data.accountTypes=[];if(data.accountTypes.some(x=>x.toLowerCase()===n.toLowerCase()))return toast("Account type already exists.");data.accountTypes.push(n);save();closeModal();render();toast("Account type added.");}}
function deleteAccountType(type){if((data.accountTypes||[]).length<=1)return toast("Keep at least one account type.");if(data.accounts.some(a=>a.type===type))return toast("This account type is currently in use.");if(confirm(`Delete account type "${type}"?`)){data.accountTypes=data.accountTypes.filter(x=>x!==type);save();render();toast("Account type deleted.");}}
function openCategory(){modal("Add Category",`<form id="catForm" class="form-grid"><div class="field full"><label>Category name</label><input name="name" required placeholder="e.g. Travel"></div><button class="primary full">Add Category</button></form>`);$("catForm").onsubmit=e=>{e.preventDefault();const n=new FormData(e.target).get("name").trim();if(n&&!data.categories.includes(n)){data.categories.push(n);save();closeModal();render();toast("Category added.");}}}
function openGoal(){
  const options=data.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance)} available</option>`).join("");
  modal("Add Goal",`<form id="goalForm" class="form-grid">
    <div class="field full"><label>Goal name</label><input name="name" required placeholder="Goa Trip"></div>
    <div class="field"><label>Target amount</label><input name="target" type="number" min="1" step="0.01" required placeholder="50000"></div>
    <div class="field"><label>Target date <span class="muted">(optional)</span></label><input name="targetDate" type="date"></div>
    <div class="field full"><label>Link this goal to an account</label><select name="accountId" id="goalAccountSelect" required><option value="">Select account</option>${options||'<option value="">Add an account first</option>'}</select><small class="muted">Use a dedicated account if you want the goal deposit to follow that account automatically.</small></div>
    <div class="field full"><label class="checkbox-row"><input type="checkbox" name="autoTrackAccount" id="autoTrackAccount"> <span>Automatically use this account balance as the goal deposit</span></label><small class="muted">When enabled, every income, expense or transfer changes the goal's current deposit automatically. The goal never exceeds its target.</small></div>
    <div class="field full goal-initial-box">
      <label class="checkbox-row"><input type="checkbox" name="hasInitialDeposit" id="hasInitialDeposit"> <span>Some money is already saved for this goal</span></label>
      <div id="initialDepositFields" class="hidden-field">
        <label>Current deposit for this goal</label>
        <input name="initialDeposit" id="initialDeposit" type="number" min="0" step="0.01" value="0" placeholder="e.g. 8000">
        <small class="muted">This does not move money or create a transaction. It marks part of the linked account's existing balance as already reserved for this goal.</small>
      </div>
    </div>
    <button class="primary full">Create Goal</button>
  </form>`);
  const check=$("hasInitialDeposit"), fields=$("initialDepositFields"), amount=$("initialDeposit"), account=$("goalAccountSelect");
  if(check) check.onchange=()=>fields.classList.toggle("hidden-field",!check.checked);
  if(account) account.onchange=()=>{ if(amount && check?.checked) amount.max=String(Math.max(0,Number(data.accounts.find(a=>a.id===account.value)?.balance||0))); };
  $("goalForm").onsubmit=e=>{
    e.preventDefault();
    const f=new FormData(e.target);
    const name=f.get("name").trim(),target=Number(f.get("target")),accountId=f.get("accountId");
    const autoTrack=f.get("autoTrackAccount")==="on";
    const hasInitial=f.get("hasInitialDeposit")==="on";
    const initial=hasInitial?Number(f.get("initialDeposit")||0):0;
    const linked=data.accounts.find(a=>a.id===accountId);
    if(!name||target<=0)return toast("Enter a valid goal.");
    if(!linked)return toast("Select the account linked to your goal.");
    if(initial<0||initial>Number(linked.balance||0))return toast("Initial deposit cannot be greater than the linked account balance.");
    if(initial>target)return toast("Initial deposit cannot be greater than the goal target.");
    if(autoTrack && initial>0 && initial!==Math.min(Number(linked.balance||0),target)) return toast("For auto tracking, the current goal deposit follows the linked account balance. Remove the initial deposit or turn off auto tracking.");
    const saved=autoTrack?Math.min(Math.max(0,Number(linked.balance||0)),target):initial;
    data.goals.push({id:uid("g"),name,target,saved,targetDate:f.get("targetDate")||null,accountId,initialDeposit:initial,autoTrackAccount:autoTrack});
    save();closeModal();render();toast(initial>0?"Goal created with existing money reserved.":"Goal created and linked to your account.");
  };
}
function editGoal(id){
  const g=(data.goals||[]).find(x=>x.id===id); if(!g)return;
  const options=data.accounts.map(a=>`<option value="${a.id}" ${a.id===g.accountId?"selected":""}>${esc(a.name)} · ${money(a.balance)}</option>`).join("");
  modal("Edit Goal",`<form id="editGoalForm" class="form-grid">
    <div class="field full"><label>Goal name</label><input name="name" value="${esc(g.name||"")}" required></div>
    <div class="field"><label>Target amount</label><input name="target" type="number" min="0.01" step="0.01" value="${Number(g.target||0)}" required></div>
    <div class="field"><label>Target date</label><input name="targetDate" type="date" value="${esc(g.targetDate||"")}"></div>
    <div class="field full"><label>Linked account</label><select name="accountId">${options||'<option value="">Add an account first</option>'}</select></div>
    <div class="field full"><label class="checkbox-row"><input type="checkbox" name="autoTrackAccount" ${g.autoTrackAccount?'checked':''}> <span>Automatically use linked account balance as goal deposit</span></label><small class="muted">If enabled, the saved amount updates automatically whenever the linked account balance changes.</small></div>
    <div class="field full"><label>Current deposit</label><input name="saved" type="number" min="0" step="0.01" value="${Number(g.saved||0)}"><small class="muted">This changes the goal's reserved amount only; it does not create a transaction.</small></div>
    <button class="primary full">Save Changes</button>
  </form>`);
  $("editGoalForm").onsubmit=e=>{
    e.preventDefault(); const f=new FormData(e.target);
    const target=Number(f.get("target")),saved=Number(f.get("saved")),accountId=f.get("accountId");
    if(saved<0||saved>target)return toast("Saved amount must be between ₹0 and the target.");
    if(accountId&&!data.accounts.some(a=>a.id===accountId))return toast("Select a valid account.");
    g.name=f.get("name").trim();g.target=target;g.targetDate=f.get("targetDate")||null;g.accountId=accountId||null;g.autoTrackAccount=f.get("autoTrackAccount")==="on";
    if(g.autoTrackAccount){ const a=data.accounts.find(x=>x.id===g.accountId); if(!a)return toast("Select a valid linked account for auto tracking."); g.saved=Math.min(Math.max(0,Number(a.balance||0)),target); } else { g.saved=saved; }
    g.initialDeposit=Number(g.initialDeposit||0);
    save();closeModal();render();toast("Goal updated.");
  };
}
function addGoalMoney(id){
  const g=data.goals.find(x=>x.id===id); if(!g)return;
  if(!g.accountId) return toast("Link this goal to an account first.");
  openTransaction();
  switchTab("goal");
  const sel=document.querySelector('[name="goalId"]'); if(sel){sel.value=id; sel.dispatchEvent(new Event("change"));}
  const accountSel=document.querySelector('[name="goalAccountId"]'); if(accountSel){accountSel.value=g.accountId; accountSel.dispatchEvent(new Event("change"));}
}
function openBudget(){modal("Add Budget",`<form id="budgetForm" class="form-grid"><div class="field full"><label>Category</label><select name="category">${data.categories.map(c=>`<option>${esc(c)}</option>`).join("")}</select></div><div class="field full"><label>Monthly limit</label><input name="limit" type="number" min="1" required></div><button class="primary full">Save Budget</button></form>`);$("budgetForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);data.budgets.push({id:uid("b"),category:f.get("category"),limit:Number(f.get("limit"))});save();closeModal();render();toast("Budget added.");}}
function openLoan(editId=null){
  const existing=editId?(data.loans||[]).find(x=>x.id===editId):null; const l=existing||{}; const isLent=l.direction!=='owe';
  modal(existing?'Edit Loan':'Add Loan',`<form id="loanForm" class="form-grid">
    <div class="field full"><label>Loan type</label><div class="segmented"><label><input type="radio" name="direction" value="lent" ${isLent?'checked':''}> 🤝 I gave money / someone owes me</label><label><input type="radio" name="direction" value="owe" ${!isLent?'checked':''}> 📌 I have to give money / I owe someone</label></div></div>
    <div class="field full"><label>Person / Name</label><input name="person" value="${esc(l.person||"")}" required placeholder="e.g. Rahul"></div>
    <div class="field"><label>Total amount</label><input name="amount" type="number" min="0.01" step="0.01" value="${Number(l.amount||0)}" required></div>
    <div class="field"><label>${isLent?'Already repaid':'Already paid'}</label><input name="settled" type="number" min="0" step="0.01" value="${Number(isLent?l.repaid:l.paid||0)}"></div>
    <div class="field"><label>Due date <span class="muted">(optional)</span></label><input name="dueDate" type="date" value="${esc(l.dueDate||"")}"></div>
    <div class="field full"><label>Note <span class="muted">(optional)</span></label><input name="note" value="${esc(l.note||"")}" placeholder="What is this for?"></div>
    <div class="field full loan-info"><span>ℹ️</span><small>This loan is tracked separately. It will <strong>not change or be included in Total Money</strong>.</small></div>
    <button class="primary full">${existing?'Save Changes':'Add Loan'}</button>
  </form>`);
  document.querySelectorAll('#loanForm input[name="direction"]').forEach(r=>r.onchange=()=>{const label=document.querySelector('#loanForm input[name="settled"]')?.closest('.field')?.querySelector('label');if(label)label.innerHTML=(r.value==='lent'?'Already repaid':'Already paid');});
  $('loanForm').onsubmit=ev=>{ev.preventDefault();const f=new FormData(ev.target);const direction=f.get('direction'),amount=Number(f.get('amount')),settled=Number(f.get('settled')||0);if(!amount||amount<=0)return toast('Enter a valid amount.');if(settled<0||settled>amount)return toast('Settled amount cannot exceed the total.');const obj=existing||{id:uid('loan')};obj.direction=direction;obj.person=f.get('person').trim();obj.amount=amount;obj.dueDate=f.get('dueDate')||null;obj.note=f.get('note').trim();if(direction==='lent'){obj.repaid=settled;delete obj.paid;}else{obj.paid=settled;delete obj.repaid;}data.loans=data.loans||[];if(!existing)data.loans.push(obj);save();closeModal();render();toast(existing?'Loan updated.':'Loan added.');};
}
function editLoan(id){openLoan(id);}
function openEmi(editId=null){
  const existing=editId?(data.emis||[]).find(x=>x.id===editId):null;
  const e=existing||{};
  const options=data.accounts.map(a=>`<option value="${a.id}" ${a.id===e.paymentAccount?"selected":""}>${esc(a.name)}</option>`).join("");
  modal(existing?"Edit EMI / Loan":"Add EMI / Loan",`<form id="emiForm" class="form-grid">
    <div class="field full"><label>EMI / Loan name</label><input name="name" value="${esc(e.name||"")}" required placeholder="e.g. iPhone EMI"></div>
    <div class="field full"><label>Lender</label><input name="lender" value="${esc(e.lender||"")}" placeholder="e.g. HDFC Bank"></div>
    <div class="field"><label>Total loan amount</label><input name="totalAmount" type="number" min="0" step="0.01" value="${Number(e.totalAmount||0)}" required></div>
    <div class="field"><label>Amount already paid</label><input name="paidAmount" type="number" min="0" step="0.01" value="${existing?Math.max(0,Number(e.totalAmount||0)-Number(e.remainingAmount||0)):0}" required></div>
    <div class="field"><label>Monthly EMI</label><input name="monthly" type="number" min="0.01" step="0.01" value="${Number(e.monthly||0)}" required></div>
    <div class="field"><label>Total EMI count</label><input name="totalEmis" type="number" min="1" step="1" value="${Number(e.totalEmis||1)}" required></div>
    <div class="field"><label>EMIs already paid</label><input name="paidEmis" type="number" min="0" step="1" value="${Number(e.paidEmis||0)}" required></div>
    <div class="field"><label>EMI Start Date</label><input name="startDate" type="date" value="${esc(e.startDate||"")}" required></div>
    <div class="field"><label>Payment date</label><input name="paymentDay" type="number" min="1" max="31" value="${Number(e.paymentDay||((e.startDate||"").slice(8,10))||10)}" required></div>
    <div class="field full"><label>Payment account</label><select name="paymentAccount">${options||'<option value="">Add an account first</option>'}</select></div>
    <button class="primary full">${existing?"Save Changes":"Save EMI"}</button>
  </form>`);
  $("emiForm").onsubmit=ev=>{
    ev.preventDefault(); const f=new FormData(ev.target);
    const total=Number(f.get("totalAmount")),paidAmount=Number(f.get("paidAmount")),totalEmis=Number(f.get("totalEmis")),paidEmis=Number(f.get("paidEmis"));
    if(total<0||paidAmount<0||paidAmount>total)return toast("Check the total and paid amount.");
    if(paidEmis<0||paidEmis>totalEmis)return toast("Paid EMIs cannot exceed total EMIs.");
    const obj=existing||{id:uid("emi")};
    obj.name=f.get("name").trim();obj.lender=f.get("lender").trim();obj.totalAmount=total;
    obj.remainingAmount=Math.max(0,total-paidAmount);obj.monthly=Number(f.get("monthly"));obj.totalEmis=totalEmis;
    const startDate=f.get("startDate");
    if(!startDate)return toast("Select an EMI start date.");
    obj.paidEmis=paidEmis;obj.remainingEmis=Math.max(0,totalEmis-paidEmis);obj.startDate=startDate;obj.paymentDay=Number(f.get("paymentDay"));obj.paymentAccount=f.get("paymentAccount"); obj.nextDate=(obj.remainingEmis>0&&obj.remainingAmount>0)?calculateEmiNextDate(obj):null;
    data.emis=data.emis||[]; if(!existing)data.emis.push(obj);
    save();closeModal();render();toast(existing?"EMI updated.":"EMI added and included in Smart Money.");
  };
}
function editEmi(id){openEmi(id);}
function payEmi(id){
  const e=(data.emis||[]).find(x=>x.id===id); if(!e)return;
  const remaining=Math.max(0,Number(e.remainingAmount||0));
  const remainingEmis=Math.max(0,Number(e.remainingEmis||0));
  if(remaining<=0 || remainingEmis<=0)return toast("This EMI is already fully paid.");
  const account=data.accounts.find(a=>a.id===e.paymentAccount); if(!account)return toast("Payment account is missing.");
  const payment=Math.min(Number(e.monthly||0),remaining);
  if(payment<=0)return toast("Invalid EMI amount.");
  const categories=[...new Set([...(data.categories||[]),"Bills & Utilities"])];
  modal("Pay EMI",`<form id="payEmiForm" class="form-grid">
    <div class="field full"><label>EMI</label><input value="${esc(e.name)} · ${money(payment)} · ${esc(account.name)}" disabled></div>
    <div class="field full"><label>Category</label><select name="category">${categories.map(c=>`<option ${c==="Bills & Utilities"?'selected':''}>${esc(c)}</option>`).join("")}</select></div>
    <div class="field"><label>Date</label><input name="date" type="date" value="${today()}" required></div>
    <div class="field"><label>Time</label><input name="time" type="time" value="${new Date().toTimeString().slice(0,5)}" required></div>
    <div class="field full"><label>Note</label><input name="note" value="EMI payment · ${esc(e.name)}" placeholder="Optional note"></div>
    <button class="primary full">Pay ${money(payment)}</button>
  </form>`);
  $("payEmiForm").onsubmit=ev=>{
    ev.preventDefault();
    if(Number(account.balance||0)<payment)return toast("Insufficient balance in payment account.");
    if(!confirm(`Pay ${money(payment)} for ${e.name} from ${account.name}?`))return;
    const f=new FormData(ev.target);
    const before={remainingAmount:remaining,paidEmis:Number(e.paidEmis||0),remainingEmis:Number(e.remainingEmis||0),nextDate:e.nextDate||calculateEmiNextDate(e)};
    account.balance-=payment;
    e.remainingAmount=Math.max(0,remaining-payment);
    e.paidEmis=Math.min(Number(e.totalEmis||0),Number(e.paidEmis||0)+1);
    e.remainingEmis=Math.max(0,Number(e.totalEmis||0)-Number(e.paidEmis||0));
    if(e.remainingAmount<=0 || e.remainingEmis<=0)e.nextDate=null;
    else e.nextDate=dateKey(emiDateForMonth(new Date(f.get("date")+"T12:00:00").getFullYear(),new Date(f.get("date")+"T12:00:00").getMonth()+1,Number(e.paymentDay||1)));
    data.transactions.push({id:uid("tx"),type:"expense",amount:payment,date:f.get("date"),timestamp:`${f.get("date")}T${f.get("time")||"00:00"}`,note:f.get("note")||`EMI payment · ${e.name}`,category:f.get("category")||"Bills & Utilities",accountName:account.name,accountId:account.id,emiId:e.id,transactionKind:"emi_payment",emiBefore:before});
    save();closeModal();render();toast(e.remainingEmis>0?"EMI Payment. Next payment date updated.":"EMI fully paid. Congratulations!");
  };
}
function deleteEmi(id){if(!confirm("Delete this EMI?"))return;data.emis=(data.emis||[]).filter(e=>e.id!==id);save();render();toast("EMI deleted.");}
function editTransaction(id){
  const t=data.transactions.find(x=>x.id===id); if(!t)return;
  // Editing a goal contribution or EMI payment through this simple editor is intentionally
  // constrained to its safe metadata/amount fields. Account and linked object stay fixed.
  const editCategories=[...new Set([...(data.categories||[]),...(t.category?[t.category]:[]),"Bills & Utilities","Goal Savings"])]; const cats=editCategories.map(c=>`<option ${c===(t.category||"")?"selected":""}>${esc(c)}</option>`).join("");
  const account=data.accounts.find(a=>a.id===t.accountId)||data.accounts.find(a=>a.name===t.accountName);
  const title=t.type==="income"?"Edit Income":t.type==="expense"?"Edit Expense":t.type==="transfer"?"Edit Transfer":t.type==="goal"?"Edit Goal Contribution":"Edit Transaction";
  modal(title,`<form id="editTxForm" class="form-grid">
    <div class="field full"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" value="${Number(t.amount||0)}" required></div>
    <div class="field"><label>Date</label><input name="date" type="date" value="${esc(t.date||today())}" required></div>
    <div class="field"><label>Time</label><input name="time" type="time" value="${esc((txDateTime(t).split("T")[1]||"00:00").slice(0,5))}" required></div>
    <div class="field"><label>Category</label><select name="category">${cats}</select></div>
    <div class="field full"><label>Note</label><input name="note" value="${esc(t.note||"")}" placeholder="Optional note"></div>
    <div class="field full"><small class="muted">${t.type==="transfer"?"Transfer accounts cannot be changed here.":t.type==="goal"?"The linked goal/account stays fixed to protect goal balances.":t.type==="expense"&&t.emiId?"The linked EMI/account stays fixed; use Edit on the EMI card to change the loan itself.":account?`Account: ${esc(account.name)}`:"Account: Unassigned"}</small></div>
    <button class="primary full">Save Changes</button>
  </form>`);
  $("editTxForm").onsubmit=e=>{
    e.preventDefault(); const f=new FormData(e.target); const newAmount=Number(f.get("amount"));
    if(!newAmount||newAmount<=0)return toast("Enter a valid amount.");
    const oldAmount=Number(t.amount||0);
    const findA=()=>data.accounts.find(a=>a.id===t.accountId)||data.accounts.find(a=>a.name===t.accountName);
    const a=findA();
    // Reverse old balance impact.
    if(t.type==="income"){if(a)a.balance-=oldAmount;}
    else if(t.type==="expense"||t.type==="goal"){if(a)a.balance+=oldAmount;}
    else if(t.type==="transfer"){
      const from=data.accounts.find(x=>x.id===t.fromAccountId)||data.accounts.find(x=>x.name===t.accountName);
      const to=data.accounts.find(x=>x.id===t.toAccountId)||data.accounts.find(x=>x.name===t.toAccountName);
      if(from)from.balance+=oldAmount;if(to)to.balance-=oldAmount;
    }
    // Apply new impact, validating available funds where necessary.
    if(t.type==="income"){if(a)a.balance+=newAmount;}
    else if(t.type==="expense"||t.type==="goal"){
      if(!a){toast("Account not found.");render();return;}
      if(a.balance<newAmount){ // restore old impact before abort
        a.balance-=newAmount;
        if(t.type==="income")a.balance+=oldAmount;
        else a.balance+=oldAmount;
        return toast("Insufficient balance for the new amount.");
      }
      a.balance-=newAmount;
    }else if(t.type==="transfer"){
      const from=data.accounts.find(x=>x.id===t.fromAccountId)||data.accounts.find(x=>x.name===t.accountName);
      const to=data.accounts.find(x=>x.id===t.toAccountId)||data.accounts.find(x=>x.name===t.toAccountName);
      if(!from||!to||from.id===to.id){ if(from)from.balance-=oldAmount; if(to)to.balance+=oldAmount; return toast("Transfer accounts are missing.");}
      if(from.balance<newAmount){from.balance+=oldAmount;to.balance-=oldAmount;return toast("Insufficient balance in source account.");}
      from.balance-=newAmount;to.balance+=newAmount;
    }
    if(t.type==="goal"){
      const g=(data.goals||[]).find(x=>x.id===t.goalId);
      if(g){const delta=newAmount-oldAmount;const newSaved=Number(g.saved||0)+delta;if(newSaved<0||newSaved>Number(g.target||0)){
        // undo applied account change
        if(a)a.balance+=newAmount-oldAmount;
        return toast("New amount would exceed the goal target.");
      }g.saved=newSaved;}
    }
    t.amount=newAmount;t.date=f.get("date");t.timestamp=`${f.get("date")}T${f.get("time")||"00:00"}`;t.note=f.get("note");if(t.type!=="transfer")t.category=f.get("category");
    if(t.loanPaymentId){
      const loan=(data.loans||[]).find(l=>(l.payments||[]).some(p=>p.id===t.loanPaymentId));
      const payment=loan?.payments?.find(p=>p.id===t.loanPaymentId);
      if(payment) payment.date=t.date;
    }
    save();closeModal();render();toast("Transaction updated.");
  };
}
function deleteTx(id){
  const t=data.transactions.find(x=>x.id===id); if(!t)return;
  if(!confirm("Delete this transaction and reverse its account/goal effect?"))return;
  const amount=Number(t.amount||0);
  const findAccount=(accountId,name)=>data.accounts.find(a=>accountId&&a.id===accountId)||data.accounts.find(a=>name&&a.name===name);
  if(t.type==="income"){
    const a=findAccount(t.accountId,t.accountName);
    if(a)a.balance-=amount;
  }else if(t.type==="expense"){
    const a=findAccount(t.accountId,t.accountName);
    if(a)a.balance+=amount;
    if(t.emiId){
      const e=(data.emis||[]).find(x=>x.id===t.emiId);
      if(e){
        const before=t.emiBefore;
        if(before && Number.isFinite(Number(before.remainingAmount))){
          e.remainingAmount=Number(before.remainingAmount);
          e.paidEmis=Number(before.paidEmis||0);
          e.remainingEmis=Number(before.remainingEmis||0);
        }else{
          e.remainingAmount=Number(e.remainingAmount||0)+amount;
          e.paidEmis=Math.max(0,Number(e.paidEmis||0)-1);
          e.remainingEmis=Math.min(Number(e.totalEmis||0),Number(e.remainingEmis||0)+1);
        }
        // The deleted payment must no longer influence the EMI's next due date.
        const otherPayments=(data.transactions||[])
          .filter(x=>x.id!==id && x.emiId===e.id)
          .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
        if(Number(e.remainingAmount||0)<=0 || Number(e.remainingEmis||0)<=0){
          e.nextDate=null;
        }else if(otherPayments.length){
          const last=new Date(String(otherPayments[0].date)+"T12:00:00");
          e.nextDate=dateKey(emiDateForMonth(last.getFullYear(),last.getMonth()+1,Number(e.paymentDay||1)));
        }else if(before?.nextDate){
          e.nextDate=before.nextDate;
        }else{
          e.nextDate=calculateEmiNextDate(e);
        }
      }
    }
  }else if(t.type==="goal"){
    const a=findAccount(t.accountId||t.goalAccountId,t.accountName);
    if(a)a.balance+=amount;
    const g=data.goals.find(x=>x.id===t.goalId);
    if(g)g.saved=Math.max(0,Number(g.saved||0)-amount);
  }else if(t.type==="transfer"){
    const from=findAccount(t.fromAccountId,t.accountName);
    const to=findAccount(t.toAccountId,t.toAccountName);
    if(from)from.balance+=amount;
    if(to)to.balance-=amount;
  }
  data.transactions=data.transactions.filter(x=>x.id!==id);
  save();render();toast("Transaction deleted and balances reversed.");
}
function deleteLoan(id){if(!confirm("Delete this loan record?"))return;data.loans=(data.loans||[]).filter(l=>l.id!==id);save();render();toast("Loan deleted.");}
function deleteAccount(id){if(data.accounts.length<=1)return toast("Keep at least one account.");if(confirm("Delete this account?")){data.accounts=data.accounts.filter(a=>a.id!==id);save();render();}}
function exportBackup(){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="my-money-backup.json";a.click();URL.revokeObjectURL(a.href);toast("Backup exported.");}
function importBackup(e){const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);if(!x.accounts||!x.transactions)throw Error();data=x;save();render();toast("Backup imported.")}catch{toast("Invalid backup file.")}};r.readAsText(file);}


function normalHeader(v){return String(v??"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function findCol(headers, patterns){
  for(const p of patterns){ const i=headers.findIndex(h=>p.some(x=>normalHeader(h)===x||normalHeader(h).includes(x))); if(i>=0)return i; }
  return -1;
}
function parseImportedDate(v){
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  if(typeof v==="number" && window.XLSX?.SSF){
    const d=window.XLSX.SSF.parse_date_code(v); if(d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  const s=String(v??"").trim(); if(!s)return "";
  let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if(m){const [,a,b,y]=m; const day=Number(a)>12?Number(a):Number(b); const mon=Number(a)>12?Number(b):Number(a); return `${y}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}`;}
  const d=new Date(s); return isNaN(d)?"":d.toISOString().slice(0,10);
}
function amountNumber(v){
  if(typeof v==="number")return v;
  const s=String(v??"").replace(/₹|Rs\.?|INR|,/gi,"").trim();
  if(!s)return 0;
  const neg=/^\(.*\)$/.test(s)||/^-/.test(s)||/\bdr\b/i.test(s); const n=Number(s.replace(/[()]/g,"")); return isNaN(n)?0:(neg?-Math.abs(n):Math.abs(n));
}
function inferAccountName(row,headers,sheetName){
  const i=findCol(headers,[["account"],["account name"],["from account"],["bank account"]]);
  const value=i>=0?String(row[i]??"").trim():"";
  return value || (sheetName && !/sheet\d+/i.test(sheetName)?sheetName.trim():"");
}
function ensureImportedAccount(name){
  const clean=String(name||"").trim();
  if(!clean)return data.accounts[0]?.name||"Imported";
  let a=data.accounts.find(x=>normalHeader(x.name)===normalHeader(clean));
  if(!a){ a={id:uid("a"),name:clean,type:"Bank",balance:0}; data.accounts.push(a); }
  return a.name;
}
function categoryFromImported(v,type){
  const raw=String(v??"").trim();
  if(raw){ if(!data.categories.includes(raw)) data.categories.push(raw); return raw; }
  return type==="income"?"Salary":"Other";
}
function buildImportedRows(rows,sheetName){
  if(!rows.length)return [];
  let headerAt=0;
  for(let i=0;i<Math.min(rows.length,12);i++){
    const h=rows[i].map(normalHeader);
    if(h.some(x=>/date|amount|category|transaction|description|account|type|debit|credit/.test(x))){headerAt=i;break;}
  }
  const rawHeaders=rows[headerAt].map(x=>String(x??""));
  const headers=rawHeaders.map(normalHeader); const body=rows.slice(headerAt+1);
  const dateI=findCol(headers,[["date"],["transaction date"],["txn date"],["entry date"]]);
  const typeI=findCol(headers,[["type"],["transaction type"],["transaction"]]);
  const descI=findCol(headers,[["description"],["details"],["particulars"],["merchant"],["payee"],["narration"],["note"]]);
  const catI=findCol(headers,[["category"],["expense category"],["income category"]]);
  const amtI=findCol(headers,[["amount"],["transaction amount"],["value"]]);
  const debitI=findCol(headers,[["debit"],["withdrawal"],["expense"]]);
  const creditI=findCol(headers,[["credit"],["deposit"],["income"]]);
  const accountI=findCol(headers,[["account"],["account name"],["from account"],["bank account"]]);
  const out=[];
  for(const row of body){
    if(!Array.isArray(row))continue;
    const date=parseImportedDate(dateI>=0?row[dateI]:"");
    if(!date)continue;
    let amount=amtI>=0?amountNumber(row[amtI]):0;
    const debit=debitI>=0?amountNumber(row[debitI]):0, credit=creditI>=0?amountNumber(row[creditI]):0;
    let type="expense";
    const tv=typeI>=0?normalHeader(row[typeI]):"";
    if(/income|credit|deposit|salary|received/.test(tv))type="income";
    else if(/transfer/.test(tv))type="transfer";
    else if(debit>0||credit>0){ if(credit>0&&debit===0){type="income";amount=credit;} else if(debit>0&&credit===0){type="expense";amount=debit;} else amount=credit-debit; }
    else if(amount<0){type="expense";amount=Math.abs(amount);} else if(/income|salary|credit/.test(String(row[catI>=0?catI:-1]??"")))type="income";
    if(amount<0) amount=Math.abs(amount);
    if(amount<=0)continue;
    const note=descI>=0?String(row[descI]??"").trim():"Imported from TimelyBills";
    const accountName=inferAccountName(row,headers,sheetName) || data.accounts[0]?.name || "Imported";
    out.push({id:uid("tx"),type,amount,date,note,category:categoryFromImported(catI>=0?row[catI]:"",type),accountName,imported:true});
  }
  return out;
}
function importTimelyBills(e){
  const file=e.target.files?.[0]; if(!file)return;
  if(!window.XLSX){toast("Excel reader is not loaded. Check your internet connection and reload.");return;}
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const wb=XLSX.read(reader.result,{type:"array",cellDates:true});
      const imported=[];
      for(const sheetName of wb.SheetNames){
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:"",raw:true});
        imported.push(...buildImportedRows(rows,sheetName));
      }
      if(!imported.length){toast("No usable transactions found. Use a TimelyBills Transaction List Excel/CSV.");return;}
      showImportPreview(imported,file.name);
    }catch(err){console.error(err);toast("Could not read that Excel file.");}
  };
  reader.readAsArrayBuffer(file);
  e.target.value="";
}
function showImportPreview(rows,fileName){
  const dates=rows.map(x=>x.date).sort(); const income=rows.filter(x=>x.type==="income").reduce((s,x)=>s+x.amount,0), expense=rows.filter(x=>x.type==="expense").reduce((s,x)=>s+x.amount,0);
  modal("Import TimelyBills Data",`<div class="import-preview"><h3>${esc(fileName)}</h3><p class="muted">Found <strong>${rows.length}</strong> transactions${dates.length?` from ${esc(dates[0])} to ${esc(dates.at(-1))}`:""}.</p><div class="import-summary"><span>Income <strong class="income">${money(income)}</strong></span><span>Expenses <strong class="expense">${money(expense)}</strong></span></div><label class="check-row"><input id="importAdjustBalances" type="checkbox"> Update current account balances using imported transactions</label><p class="muted small">Recommended: leave this OFF when importing old history. This keeps your current real account balances unchanged while adding the history for Analytics and Weekly Spending.</p><button class="primary full" id="confirmTimelyImport">Import ${rows.length} transactions</button></div>`);
  $("confirmTimelyImport").onclick=()=>{
    const adjust=$("importAdjustBalances").checked;
    for(const t of rows) t.accountName=ensureImportedAccount(t.accountName);
    const existing=new Set(data.transactions.map(t=>[t.date,t.type,Number(t.amount||0),normalHeader(t.accountName),normalHeader(t.note)].join("|")));
    const fresh=rows.filter(t=>{const k=[t.date,t.type,Number(t.amount||0),normalHeader(t.accountName),normalHeader(t.note)].join("|"); if(existing.has(k)) return false; existing.add(k); return true;});
    if(adjust){
      for(const t of fresh){const a=data.accounts.find(x=>normalHeader(x.name)===normalHeader(t.accountName));if(!a)continue;if(t.type==="income")a.balance+=t.amount;else if(t.type==="expense")a.balance-=t.amount;}
    }
    data.transactions.push(...fresh); save(); closeModal(); render(); toast(`${fresh.length} transactions imported${rows.length-fresh.length?` · ${rows.length-fresh.length} duplicate(s) skipped`:""}.`);
  };
}

window.addEventListener("error", e => {
  console.error("My Money runtime error:", e.error || e.message);
  const content = $("content");
  if (content && !content.innerHTML.trim()) {
    content.innerHTML = `<div class="card error-card"><h2>My Money could not load this screen</h2><p class="muted">${esc(e.message || "Unknown error")}</p><button class="primary" onclick="location.reload()">Reload</button></div>`;
  }
});
window.addEventListener("unhandledrejection", e => {
  console.error("My Money promise error:", e.reason);
});

document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.page;render()});
const mobileMore=$("mobileMore");
if(mobileMore) mobileMore.onclick=()=>{const m=$("mobileMoreMenu");if(m){m.classList.remove("hidden");m.setAttribute("aria-hidden","false");}};
document.querySelectorAll("[data-close-mobile-more]").forEach(b=>b.onclick=()=>{const m=$("mobileMoreMenu");if(m){m.classList.add("hidden");m.setAttribute("aria-hidden","true");}});
document.querySelectorAll("[data-mobile-more-page]").forEach(b=>b.onclick=()=>{currentPage=b.dataset.mobileMorePage;const m=$("mobileMoreMenu");if(m){m.classList.add("hidden");m.setAttribute("aria-hidden","true");}render();});
$("mobileAdd").onclick=()=>openTransaction();
$("closeModal").onclick=closeModal;
$("modal").onclick=e=>{if(e.target.id==="modal")closeModal()};
$("searchInput").oninput=()=>{if(currentPage==="transactions")render()};

async function authClick(){try{if(currentUser)await logout();else await login()}catch(e){toast(e.code==="auth/unauthorized-domain"?"Add 127.0.0.1 to Firebase Authorized Domains.":(e.message||"Google sign-in failed"))}}
$("topGoogleBtn").onclick=authClick;$("sideGoogleBtn").onclick=authClick;
watchAuth(async u=>{
  currentUser=u;
  const name=u?.displayName||"Guest";
  $("userName").textContent=u?.displayName?.split(" ")[0]||"Guest";
  $("avatar").textContent=u?.displayName?.[0]||"G";
  $("topGoogleBtn").title=u?`Signed in as ${name}`:"Sign in with Google";
  $("sideGoogleBtn").textContent=u?"Sign Out":"Continue with Google";
  if($("sideUserName")) $("sideUserName").textContent=name;
  if($("sideUserEmail")) $("sideUserEmail").textContent=u?.email||"Not signed in";
  const photo=u?.photoURL||"";
  const topImg=$("avatarImg"), sideImg=$("sideAvatarImg");
  if(topImg){ topImg.src=photo; topImg.hidden=!photo; }
  if(sideImg){ sideImg.src=photo; sideImg.hidden=!photo; }
  if($("sideAvatarText")) $("sideAvatarText").textContent=u?.displayName?.[0]||"G";
  if($("todayLabel")) $("todayLabel").textContent=new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",year:"numeric",weekday:"short"}).format(new Date());
  if(u){
    await loadCloud(u);
    toast(`Signed in as ${name}`);
  } else {
    if(cloudUnsubscribe){cloudUnsubscribe();cloudUnsubscribe=null;}
    cloudReady=false;
  }
});
render();

window.addEventListener("DOMContentLoaded",()=>setTimeout(refreshIcons,50));

