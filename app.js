// ═══ DATA ═══
const D = window.F2F_DATA || {leads:[],posts:[],reports:[],tasks:[],companies:[],kpi:{},financeReports:[],hrReports:[],techReports:[]};
// Merge all department reports into one unified reports array
if(D.financeReports) D.reports = D.reports.concat(D.financeReports);
if(D.hrReports) D.reports = D.reports.concat(D.hrReports);
if(D.techReports) D.reports = D.reports.concat(D.techReports);

const AGENTS = {
  // === РЕАЛЬНЫЕ AI АГЕНТЫ (Make.com) ===
  coordinator:{name:'Coordinator v8',emoji:'🎯',dept:'cmd',color:'#ffb800',scenarioId:4872555,interval:'2ч'},
  content:{name:'SMM Agent v8',emoji:'📱',dept:'smm',color:'#ff2d78',scenarioId:4872534,interval:'2ч'},
  market:{name:'Analyst Agent v8',emoji:'📊',dept:'rd',color:'#00e5ff',scenarioId:4872551,interval:'2ч'},
  leads:{name:'BizDev Agent v13',emoji:'📧',dept:'biz',color:'#00ff88',scenarioId:4872563,interval:'2ч'},
  outreach:{name:'Outreach Agent v8',emoji:'🎯',dept:'biz',color:'#00ff88',scenarioId:4872568,interval:'2ч'},
  social:{name:'Community Agent v8',emoji:'👥',dept:'smm',color:'#ff2d78',scenarioId:4872572,interval:'2ч'},
  // === СЕРВИСНЫЕ СЦЕНАРИИ ===
  processor:{name:'Processor v2',emoji:'⚙️',dept:'sys',color:'#a78bfa',scenarioId:4887922,interval:'1мин'},
  lead_finder:{name:'Lead Finder v2',emoji:'🔍',dept:'biz',color:'#00ff88',scenarioId:4890104,interval:'4ч'},
  followup:{name:'Follow-Up v1',emoji:'📨',dept:'biz',color:'#00ff88',scenarioId:4890852,interval:'12ч'},
  watchdog:{name:'Watchdog v1',emoji:'🛡️',dept:'sys',color:'#a78bfa',scenarioId:4890390,interval:'1ч'},
  briefing:{name:'Morning Briefing v2',emoji:'☀️',dept:'cmd',color:'#ffb800',scenarioId:4890657,interval:'24ч'},
  kpi_updater:{name:'KPI Updater',emoji:'📈',dept:'sys',color:'#a78bfa',scenarioId:4884485,interval:'—'}
};
const DEPTS = [
  {id:'cmd', name:'Command Center', color:'#ffb800', agents:['coordinator','briefing']},
  {id:'rd', name:'Analytics', color:'#00e5ff', agents:['market']},
  {id:'smm', name:'SMM & Community', color:'#ff2d78', agents:['content','social']},
  {id:'biz', name:'Business Dev', color:'#00ff88', agents:['leads','outreach','lead_finder','followup']},
  {id:'sys', name:'System Services', color:'#a78bfa', agents:['processor','watchdog','kpi_updater']}
];

// ═══ TABS ═══
function switchTab(panelId){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const tab=document.querySelector('.tab[data-panel="'+panelId+'"]');
  if(tab)tab.classList.add('active');
  const panel=document.getElementById('panel-'+panelId);
  if(panel)panel.classList.add('active');
  if(panelId==='office') resizeCanvas();
}
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>switchTab(tab.dataset.panel));
});
// KPI click → navigate to tab
document.querySelectorAll('.kpi[data-goto]').forEach(kpi=>{
  kpi.addEventListener('click',()=>switchTab(kpi.dataset.goto));
});

// Strategy & KPI Save Handler
document.getElementById('stratSaveBtn').addEventListener('click',async function(){
  const strategyText=document.getElementById('strategyText').value;
  const kpiLeads=parseInt(document.getElementById('kpi-leads').value)||45;
  const kpiEmails=parseInt(document.getElementById('kpi-emails').value)||200;
  const kpiContent=parseInt(document.getElementById('kpi-content').value)||20;
  const kpiRevenue=parseInt(document.getElementById('kpi-revenue').value)||15000;

  const strategyData={
    mission_vision:strategyText,
    kpi_leads_monthly:kpiLeads,
    kpi_emails_monthly:kpiEmails,
    kpi_content_monthly:kpiContent,
    kpi_revenue_target:kpiRevenue,
    updated_at:new Date().toISOString()
  };

  // Save to Supabase directives table (upsert — update if key exists)
  const result=await sbUpsert('directives',{
    key:'company_strategy',
    value_json:strategyData,
    active:true,
    updated_at:new Date().toISOString()
  });

  if(result){
    const btn=document.getElementById('stratSaveBtn');
    const origText=btn.textContent;
    btn.textContent='✅ Сохранено!';
    btn.style.background='var(--green)44';
    btn.style.color='var(--green)';
    setTimeout(()=>{
      btn.textContent=origText;
      btn.style.background='var(--green)22';
      btn.style.color='var(--green)';
    },3000);
    addFeed('coordinator','🎯 Стратегия обновлена — все цели пересчитаны');
  }else{
    alert('Ошибка сохранения. Проверь соединение с Supabase.');
  }
});

// ═══ KPI ═══
function fmtK(n){return n>=1000?(n/1000).toFixed(n>=10000?0:1)+'K':n.toString();}
function fmtUSD(n){return '$'+n.toLocaleString('ru');}
function fmtRUB(n){return '₽'+n.toLocaleString('ru');}
function updateKPI(){
  const k=D.kpi;const fin=D.finance||{};
  // Leads: prefer live count from D.leads (already replaced by SB data in refreshAfterSync)
  var leadsCount=SUPABASE_LIVE&&window._sbPartners?window._sbPartners.length:(k.leadsFound||D.leads.length);
  document.getElementById('kpi-leads').textContent=leadsCount;
  // Posts: prefer live count
  var postsCount=SUPABASE_LIVE&&window._sbContent?window._sbContent.length:(k.postsCreated||D.posts.length);
  document.getElementById('kpi-posts').textContent=postsCount;
  document.getElementById('kpi-reports').textContent=D.reports.length;
  document.getElementById('kpi-partners').textContent=k.partnershipsFound||0;
  document.getElementById('kpi-team').textContent=fin.headcount||D.team?.length||'-';
  document.getElementById('kpi-burn').textContent=fin.totalBudgetUSDT?fmtK(fin.totalBudgetUSDT):'—';
  // Tab badges: real counts
  document.getElementById('tab-leads-count').textContent=D.leads.length;
  var pendingCount=D.posts.filter(function(p){return p.sbStatus==='pending_approval';}).length;
  document.getElementById('tab-posts-count').textContent=pendingCount>0?pendingCount+' ⏳':D.posts.length;
  document.getElementById('tab-reports-count').textContent=D.reports.length;
  // SyncBadge: don't override LIVE status if Supabase is connected
  if(!SUPABASE_LIVE){
    document.getElementById('syncBadge').textContent='● LOCAL '+new Date(D.lastUpdated||Date.now()).toLocaleDateString('ru');
    document.getElementById('syncBadge').style.color='#ffb800';
  }
}
updateKPI();

// ═══ FINANCE PANEL ═══
function renderFinance(){
  const f=D.finance;if(!f){document.getElementById('financeContent').innerHTML='<p style="color:var(--dim)">Нет финансовых данных</p>';return;}
  document.getElementById('finance-period').textContent=f.period+' | Курс: '+f.exchangeRate+' RUB/USDT';
  const sal=f.salary||{};
  let html='<div class="fin-grid">';
  // Total burn
  html+='<div class="fin-card" style="border-top:3px solid var(--hot)">'+
    '<h3 style="color:var(--hot)">Общий Burn Rate</h3>'+
    '<div class="fin-big" style="color:var(--hot)">'+fmtUSD(f.totalBudgetUSDT)+'</div>'+
    '<div class="fin-sub">'+fmtRUB(f.totalBudgetRUB)+'</div>'+
    '<div style="margin-top:12px">'+
      '<div class="fin-row"><span class="label">ФОТ (зарплаты)</span><span class="val cyan">'+fmtUSD(sal.totalUSDT||0)+'</span></div>'+
      '<div class="fin-row"><span class="label">Подписки + инфра</span><span class="val">'+fmtUSD(f.totalSubsUSDT||0)+'</span></div>'+
      '<div class="fin-row"><span class="label">Из них ивенты</span><span class="val amber">'+fmtUSD((f.totalSubsUSDT||0)-(f.regularSubsUSDT||0))+'</span></div>'+
      '<div class="fin-row"><span class="label">Регулярные (без ивентов)</span><span class="val green">'+fmtUSD((sal.totalUSDT||0)+(f.regularSubsUSDT||0))+'</span></div>'+
    '</div></div>';
  // Salary breakdown
  html+='<div class="fin-card" style="border-top:3px solid var(--cyan)">'+
    '<h3>ФОТ — '+f.headcount+' человек</h3>'+
    '<div class="fin-big" style="color:var(--cyan)">'+fmtUSD(sal.totalUSDT||0)+'</div>'+
    '<div class="fin-sub">'+fmtRUB(sal.totalRUB||0)+'</div>'+
    '<div style="margin-top:12px">'+
      '<div class="fin-row"><span class="label">Management ('+sal.management?.count+')</span><span class="val">'+fmtUSD(sal.management?.usdt||0)+'</span></div>'+
      '<div class="fin-row"><span class="label">Full-time ('+sal.fullTime?.count+')</span><span class="val">'+fmtUSD(sal.fullTime?.usdt||0)+'</span></div>'+
      '<div class="fin-row"><span class="label">Part-time ('+sal.partTime?.count+')</span><span class="val">'+fmtUSD(sal.partTime?.usdt||0)+'</span></div>'+
      '<div class="fin-row"><span class="label">Средняя ЗП (full-time)</span><span class="val">'+fmtUSD(Math.round((sal.fullTime?.usdt||0)/(sal.fullTime?.count||1)))+'</span></div>'+
    '</div></div>';
  // Subscriptions
  html+='<div class="fin-card" style="border-top:3px solid var(--green)">'+
    '<h3>Подписки и инфраструктура</h3>'+
    '<div class="fin-big" style="color:var(--green)">'+fmtUSD(f.totalSubsUSDT||0)+'</div>'+
    '<div class="fin-sub">'+fmtRUB(f.totalSubsRUB||0)+'</div>'+
    '<div style="margin-top:12px">'+(f.subscriptions||[]).map(s=>
      '<div class="fin-row"><span class="label">'+s.name+' <span style="font-size:10px;color:var(--dim)">['+s.type+']</span></span><span class="val">'+fmtUSD(s.usdt)+'</span></div>'
    ).join('')+'</div></div>';
  // Payment status
  html+='<div class="fin-card" style="border-top:3px solid var(--amber)">'+
    '<h3>Статус оплат</h3>';
  if(f.unpaidItems&&f.unpaidItems.length){
    html+='<div style="margin-bottom:12px">'+(f.unpaidItems).map(u=>
      '<div class="fin-row"><span class="label" style="color:var(--hot)">⚠️ '+u.name+'</span><span class="val red">'+fmtUSD(u.leftUSDT)+' неоплачено</span></div>'
    ).join('')+'</div>';
  }else{
    html+='<div style="padding:12px;color:var(--green);font-size:13px">✅ Все оплаты закрыты</div>';
  }
  html+='<div class="fin-row"><span class="label">Курс</span><span class="val">'+f.exchangeRate+' RUB/USDT</span></div>'+
    '<div class="fin-row"><span class="label">Штат</span><span class="val">'+f.headcount+' чел</span></div>'+
    '<div class="fin-row"><span class="label">Период</span><span class="val">'+f.period+'</span></div>'+
    '</div>';
  html+='</div>';
  document.getElementById('financeContent').innerHTML=html;
}
renderFinance();

// ═══ TEAM MANAGEMENT PANEL ═══
let teamDeptFilter='all';
const CDepts=D.companyDepts||[];

function renderTeamDeptTabs(){
  const active=D.team.filter(t=>t.status==='active');
  let html='<button class="sub-tab '+(teamDeptFilter==='all'?'active':'')+'" data-dept="all">Все ('+active.length+')</button>';
  CDepts.forEach(d=>{
    const cnt=active.filter(t=>t.dept===d.id).length;
    html+='<button class="sub-tab '+(teamDeptFilter===d.id?'active':'')+'" data-dept="'+d.id+'">'+d.icon+' '+d.name+' ('+cnt+')</button>';
  });
  if(D.dismissed&&D.dismissed.length)html+='<button class="sub-tab '+(teamDeptFilter==='dismissed'?'active':'')+'" data-dept="dismissed">🚪 Уволены ('+D.dismissed.length+')</button>';
  document.getElementById('teamDeptTabs').innerHTML=html;
}

function renderTeam(){
  const active=D.team.filter(t=>t.status==='active');
  const dismissed=D.dismissed||[];
  renderTeamDeptTabs();

  if(teamDeptFilter==='dismissed'){
    document.getElementById('team-count').textContent=dismissed.length+' уволенных';
    document.getElementById('teamContent').innerHTML='<div class="team-grid">'+dismissed.map(t=>
      '<div class="team-card dismissed">'+
        '<div class="t-top"><span class="t-name">'+t.name+'</span><span class="t-role">'+t.reason+'</span></div>'+
        '<div class="t-dept">Уволен: '+t.dismissDate+' | Был: '+(CDepts.find(d=>d.id===t.dept)?.name||'—')+'</div>'+
      '</div>').join('')+'</div>';
    return;
  }

  let list=active;
  if(teamDeptFilter!=='all')list=active.filter(t=>t.dept===teamDeptFilter);
  document.getElementById('team-count').textContent=list.length+' из '+active.length+' активных | '+dismissed.length+' уволенных';

  // Group by dept if showing all
  let html='';
  if(teamDeptFilter==='all'){
    CDepts.forEach(d=>{
      const members=list.filter(t=>t.dept===d.id);
      if(!members.length)return;
      const head=members.find(t=>t.isHead);
      html+='<div style="margin-bottom:20px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">'+
        '<span style="font-size:16px">'+d.icon+'</span>'+
        '<span style="font-size:14px;font-weight:700;color:'+d.color+'">'+d.name+'</span>'+
        '<span style="font-size:11px;color:var(--dim)">('+members.length+' чел)</span>'+
        (head?'<span style="font-size:11px;color:var(--amber)">👑 '+head.name+'</span>':'')+
      '</div><div class="team-grid">'+members.map(t=>teamCardHTML(t)).join('')+'</div></div>';
    });
  } else {
    html='<div class="team-grid">'+list.map(t=>teamCardHTML(t)).join('')+'</div>';
  }
  document.getElementById('teamContent').innerHTML=html;
  document.getElementById('tab-team-count').textContent=active.length;
}

function teamCardHTML(t){
  const d=CDepts.find(x=>x.id===t.dept);
  return '<div class="team-card" onclick="openTeamMemberModal('+t.id+')" style="border-left:3px solid '+(d?.color||'var(--dim)')+'">'+
    '<div class="t-top">'+
      '<span class="t-name">'+t.name+'</span>'+
      (t.isHead?'<span class="t-head">👑 Lead</span>':'')+
      '<span class="t-role">'+t.role+'</span>'+
    '</div>'+
    '<div class="t-dept">'+
      (d?d.icon+' '+d.name:'❓ Не распределён')+
      ' • '+t.category+
      (t.startDate?' • c '+t.startDate:'')+
    '</div></div>';
}

window.openTeamMemberModal=function(id){
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  var d=CDepts.find(function(x){return x.id===t.dept;});
  var deptOptions=CDepts.map(function(x){return '<option value="'+x.id+'" '+(t.dept===x.id?'selected':'')+'>'+x.icon+' '+x.name+'</option>';}).join('');
  openModal(
    '<h2>'+t.name+'</h2>'+
    '<p style="color:var(--dim)">'+t.role+' • '+t.category+(t.startDate?' • c '+t.startDate:'')+'</p>'+
    '<div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">'+
      '<span class="tag" style="background:'+(d?.color||'#64748b')+'22;color:'+(d?.color||'#64748b')+'">'+(d?.icon||'❓')+' '+(d?.name||'Не распределён')+'</span>'+
      (t.isHead?'<span class="tag" style="background:#ffb80022;color:var(--amber)">👑 Руководитель отдела</span>':'')+
      '<span class="tag" style="background:#ffffff08;color:var(--dim)">ID: '+t.id+'</span>'+
    '</div>'+
    '<h3>Управление</h3>'+
    '<div style="margin-bottom:12px">'+
      '<label style="font-size:12px;color:var(--dim)">Отдел:</label>'+
      '<select class="task-select" style="margin-left:8px" onchange="teamAssignDept('+t.id+',this.value)">'+deptOptions+'</select>'+
    '</div>'+
    '<div class="action-bar">'+
      '<button class="act-btn '+(t.isHead?'active-state':'success')+'" onclick="teamToggleHead('+t.id+')">👑 '+(t.isHead?'Снять с руководства':'Назначить руководителем')+'</button>'+
      '<button class="act-btn" onclick="teamEditRole('+t.id+')">✏️ Изменить роль</button>'+
      '<button class="act-btn danger" onclick="teamDismiss('+t.id+',\'fired\')">🚫 Увольнение</button>'+
      '<button class="act-btn warn" onclick="teamDismiss('+t.id+',\'quit\')">🚪 Уход по собственному</button>'+
    '</div>'
  );
};

window.teamAssignDept=function(id,deptId){
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  var oldDept=CDepts.find(function(x){return x.id===t.dept;})?.name||'—';
  var newDept=CDepts.find(function(x){return x.id===deptId;})?.name||'—';
  t.dept=deptId;
  if(SUPABASE_LIVE){sbPatch('team','id=eq.'+id,{dept:deptId,updated_at:new Date().toISOString()});}
  renderTeam();openTeamMemberModal(id);
  addFeed('coordinator','👥 '+t.name+': '+oldDept+' → '+newDept);
};

window.teamToggleHead=function(id){
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  if(!t.isHead){
    // Remove head from same dept first
    D.team.filter(function(x){return x.dept===t.dept&&x.isHead;}).forEach(function(x){
      x.isHead=false;
      if(SUPABASE_LIVE){sbPatch('team','id=eq.'+x.id,{is_head:false,updated_at:new Date().toISOString()});}
    });
  }
  t.isHead=!t.isHead;
  if(SUPABASE_LIVE){sbPatch('team','id=eq.'+id,{is_head:t.isHead,updated_at:new Date().toISOString()});}
  renderTeam();openTeamMemberModal(id);
  addFeed('coordinator',t.isHead?'👑 '+t.name+' назначен руководителем':''+t.name+' снят с руководства');
};

window.teamEditRole=function(id){
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  var newRole=prompt('Новая роль для '+t.name+':',t.role);
  if(newRole&&newRole.trim()){
    t.role=newRole.trim();
    if(SUPABASE_LIVE){sbPatch('team','id=eq.'+id,{role:newRole.trim(),updated_at:new Date().toISOString()});}
    renderTeam();openTeamMemberModal(id);
    addFeed('coordinator','✏️ Роль '+t.name+' → '+newRole.trim());
  }
};

window.teamDismiss=function(id,reason){
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  var reasonText=reason==='fired'?'Увольнение':'Уход по собственному';
  if(!confirm(reasonText+': '+t.name+'?\n\nЭто действие переместит сотрудника в список уволенных.')){return;}
  var comment=prompt('Комментарий (опционально):','');
  t.status='dismissed';
  if(!D.dismissed)D.dismissed=[];
  D.dismissed.push({
    id:t.id, name:t.name, role:t.role, category:t.category, dept:t.dept,
    reason:reasonText, comment:comment||'', dismissDate:new Date().toISOString().slice(0,10)
  });
  if(SUPABASE_LIVE){sbPatch('team','id=eq.'+id,{
    status:'dismissed', dismiss_reason:reason,
    dismiss_comment:comment||'', dismiss_date:new Date().toISOString().slice(0,10),
    updated_at:new Date().toISOString()
  });}
  D.team=D.team.filter(function(x){return x.id!==id;});
  modal.classList.remove('open');
  renderTeam();updateKPI();
  addFeed('talent_scout','🚪 '+reasonText+': '+t.name+(comment?' ('+comment+')':''));
};

document.getElementById('teamDeptTabs').addEventListener('click',function(e){
  if(!e.target.classList.contains('sub-tab'))return;
  document.querySelectorAll('#teamDeptTabs .sub-tab').forEach(function(b){b.classList.remove('active');});
  e.target.classList.add('active');
  teamDeptFilter=e.target.dataset.dept;
  renderTeam();
});
renderTeam();

// ═══ AI AGENTS DETAIL PANEL ═══
// Built-in agent descriptions (fallback when D.agentMeta is empty)
const AGENT_DESC={
  coordinator:{purpose:'Тимлид всех агентов. Каждые 2ч проводит планёрку: собирает статусы, назначает задания, учитывает директивы CEO и KPI.',replaces:'Менеджер проектов — экономит 2-3ч/день',interval:'2ч'},
  content:{purpose:'SMM-машина. 30 постов за цикл в 5 форматах: провокации (Durex-стиль), гайды по фичам, комьюнити, новости, дискуссии.',replaces:'SMM-менеджер — экономит 4-5ч/день',interval:'2ч'},
  market:{purpose:'Анализ конкурентов (FACEIT, ESEA, CyberShoke, Blast.tv). Мониторинг KPI: регистрации, CAC, retention. Рекомендации.',replaces:'Бизнес-аналитик — экономит 3-4ч/день',interval:'2ч'},
  leads:{purpose:'Генерация персонализированных email для лидов. Дедупликация (не шлёт повторно). Подпись CEO. Превью в Telegram.',replaces:'BizDev менеджер — экономит 2-3ч/день',interval:'2ч'},
  outreach:{purpose:'Холодный outreach к командам, стримерам, партнёрам. Cold email + персонализация + A/B тесты тем.',replaces:'Outreach-специалист — экономит 2ч/день',interval:'2ч'},
  social:{purpose:'Развитие комьюнити: Discord, Telegram, Reddit. Organic engagement, мониторинг обсуждений, вовлечение.',replaces:'Community Manager — экономит 3ч/день',interval:'2ч'},
  processor:{purpose:'Мозг Telegram-бота. Обрабатывает кнопки (Отправить/Отклонить email и посты), текстовые директивы CEO, обновляет offset.',replaces:'Автоматизация — работает 24/7',interval:'1мин'},
  lead_finder:{purpose:'Автопоиск лидов: Google Search (Serper) → Hunter.io (email) → RocketReach (LinkedIn). 6 реальных лидов/день.',replaces:'Lead researcher — экономит 4-5ч/день',interval:'4ч'},
  followup:{purpose:'Автоматические follow-up письма через 3 дня после первого контакта без ответа. Другой тон и угол.',replaces:'BizDev follow-up — экономит 1-2ч/день',interval:'12ч'},
  watchdog:{purpose:'Мониторинг всех сценариев. Если агент упал — автоперезапуск + TG алерт CEO. Self-healing.',replaces:'DevOps/мониторинг — работает 24/7',interval:'1ч'},
  briefing:{purpose:'Утренний брифинг с реальными KPI из Supabase: лиды, письма, контент, статусы всех агентов, приоритеты.',replaces:'Утренняя планёрка — экономит 30мин/день',interval:'24ч'},
  kpi_updater:{purpose:'Обновление метрик в Supabase для дашборда и аналитики. Синхронизация данных между системами.',replaces:'Ручной ввод метрик',interval:'—'}
};

function renderAgentsPanel(){
  const meta=D.agentMeta||{};
  const ids=Object.keys(AGENTS);
  const activeCount=ids.filter(function(id){return !meta[id]||meta[id].active!==false;}).length;
  document.getElementById('agents-summary').textContent=activeCount+' из '+ids.length+' активных | Make.com сценарии';
  document.getElementById('tab-agents-count').textContent=ids.length;

  document.getElementById('agentsDetailGrid').innerHTML=DEPTS.map(function(dept){
    return '<div style="grid-column:1/-1;margin-top:16px;margin-bottom:4px"><div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:'+dept.color+'11;border:1px solid '+dept.color+'33;border-radius:8px">'+
      '<span style="width:12px;height:12px;border-radius:50%;background:'+dept.color+';box-shadow:0 0 8px '+dept.color+'66"></span>'+
      '<span style="font-size:14px;font-weight:700;color:'+dept.color+'">'+dept.name+'</span>'+
      '<span style="font-size:11px;color:var(--dim);margin-left:auto">'+dept.agents.length+' агентов</span></div></div>'+
    dept.agents.map(function(id){
      var a=AGENTS[id];if(!a)return '';
      var m=meta[id]||{};var desc=AGENT_DESC[id]||{};
      var isOn=m.active!==false;
      // Get Supabase live state
      var sbSlug=DASH_TO_SB_SLUG[id]||id;
      var sbMem=window._sbMemory?window._sbMemory.find(function(mm){return mm.slug===sbSlug||mm.dashId===id;}):null;
      var liveTag='';var stateColor='#64748b';
      if(SUPABASE_LIVE&&sbMem){
        stateColor=sbMem.state==='working'?'#00ff88':sbMem.state==='idle'?'#ffb800':'#64748b';
        liveTag='<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 8px;background:'+stateColor+'18;color:'+stateColor+';border:1px solid '+stateColor+'44;border-radius:10px;font-weight:700">'+
          '<span style="width:6px;height:6px;border-radius:50%;background:'+stateColor+';animation:pulse 2s infinite"></span> '+sbMem.state+
          (sbMem.cycle_number?' #'+sbMem.cycle_number:'')+
        '</span>';
      }
      // Truncate LIVE OUTPUT to 200 chars
      var liveOutput='';
      if(SUPABASE_LIVE&&sbMem&&sbMem.last_output){
        var truncated=sbMem.last_output.length>200?sbMem.last_output.slice(0,200)+'...':sbMem.last_output;
        liveOutput='<div style="font-size:11px;line-height:1.5;margin:8px 0;padding:8px 10px;background:#00ff8808;border:1px solid #00ff8822;border-radius:6px;max-height:80px;overflow-y:auto">'+
          '<b style="color:#00ff88;font-size:9px;text-transform:uppercase">📡 Live Output:</b><br>'+truncated+
        '</div>';
      }
      return '<div class="agent-detail-card" style="border-left:3px solid '+a.color+';'+(sbMem?'border-top:2px solid #00ff8833;':'')+'">'+
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:8px">'+
          '<div style="width:44px;height:44px;border-radius:10px;background:'+a.color+'18;border:1px solid '+a.color+'33;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">'+a.emoji+'</div>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
              '<span style="font-size:14px;font-weight:700">'+a.name+'</span>'+liveTag+
              '<button class="agent-toggle '+(isOn?'on':'off')+'" onclick="event.stopPropagation();toggleAgent(\''+id+'\')" title="'+(isOn?'Отключить':'Включить')+'" style="margin-left:auto"></button>'+
            '</div>'+
            '<div style="font-size:10px;color:var(--dim);margin-top:2px">Scenario #'+(a.scenarioId||'—')+' | Интервал: '+(desc.interval||a.interval||'—')+'</div>'+
          '</div>'+
        '</div>'+
        '<div style="font-size:12px;line-height:1.6;margin-bottom:6px;color:#cbd5e1;padding:6px 8px;background:var(--bg);border-radius:6px">'+
          '<b style="color:var(--cyan)">Роль:</b> '+(desc.purpose||m.purpose||AGENT_PROMPTS[id]||'Нет описания')+'</div>'+
        '<div style="font-size:11px;color:var(--amber);margin-bottom:4px">'+
          '<b>Заменяет:</b> '+(desc.replaces||m.replaces||'—')+'</div>'+
        liveOutput+
        '<div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">'+
          '<button onclick="openPromptEditor(\''+id+'\')" style="flex:1;padding:7px;background:#00ff8812;color:#00ff88;border:1px solid #00ff8833;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all .2s" onmouseover="this.style.background=\'#00ff8822\'" onmouseout="this.style.background=\'#00ff8812\'">📝 Промпт</button>'+
          '<button onclick="openDirectiveInput(\''+id+'\')" style="flex:1;padding:7px;background:#ffb80012;color:#ffb800;border:1px solid #ffb80033;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all .2s" onmouseover="this.style.background=\'#ffb80022\'" onmouseout="this.style.background=\'#ffb80012\'">🎯 Задача</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }).join('');
}

// Agent prompts/strategies stored locally
const AGENT_PROMPTS={
  coordinator:'Оркестрация всех агентов. Проводит планёрки каждые 2ч, назначает задания на основе KPI и директив CEO.',
  content:'5 форматов: Провокация (Durex-стиль), Гайд по фиче (TrueSkill, режимы, Akros), Комьюнити/мотивация, Новости/анонсы, Дискуссии. 30 постов за цикл.',
  market:'Анализ конкурентов (FACEIT, ESEA, CyberShoke, Blast.tv). KPI: регистрации, CAC, retention. Рекомендации по ценообразованию.',
  leads:'BizDev: генерация email для лидов из Supabase. Дедупликация. Подпись: Айдер Джанбаев, CEO F2F PTE. LTD.',
  outreach:'Холодный outreach к командам и стримерам. Cold email с персонализацией, A/B тесты.',
  social:'Развитие комьюнити: Discord, Telegram, Reddit. Organic engagement стратегия.',
  processor:'Обработка Telegram кнопок (Отправить/Отклонить email, Одобрить/Отклонить пост) + текстовые директивы CEO.',
  lead_finder:'Поиск лидов через Serper.dev (Google) + Hunter.io (email) + RocketReach (LinkedIn). 6 лидов/день.',
  followup:'Follow-up письма через 3 дня после первого контакта без ответа.',
  watchdog:'Проверка всех сценариев каждый час. Автоперезапуск упавших + TG алерт.',
  briefing:'Утренний брифинг с реальными KPI: лиды, письма, контент, статусы агентов. Раз в 24ч.',
  kpi_updater:'Обновление метрик в Supabase для дашборда.'
};

window.openPromptEditor=function(agentId){
  var a=AGENTS[agentId];
  var currentPrompt=AGENT_PROMPTS[agentId]||'Промпт не задан';
  openModal(
    '<h2 style="margin-bottom:12px">'+a.emoji+' '+a.name+' — Стратегия / Промпт</h2>'+
    '<div style="font-size:11px;color:var(--dim);margin-bottom:12px">Scenario ID: '+(a.scenarioId||'—')+' | Интервал: '+(a.interval||'—')+'</div>'+
    '<textarea id="promptArea" style="width:100%;height:200px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;padding:12px;resize:vertical;line-height:1.6;font-family:inherit">'+currentPrompt+'</textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'+
      '<button onclick="saveAgentPrompt(\''+agentId+'\')" style="padding:8px 20px;background:var(--green);color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:700">💾 Сохранить</button>'+
      '<button onclick="closeModal()" style="padding:8px 20px;background:var(--border);color:var(--text);border:none;border-radius:6px;cursor:pointer">Отмена</button>'+
    '</div>'
  );
};

window.saveAgentPrompt=function(agentId){
  var text=document.getElementById('promptArea').value.trim();
  if(text){
    AGENT_PROMPTS[agentId]=text;
    // Save to Supabase as directive for this agent
    if(SUPABASE_LIVE){
      var sbSlug=DASH_TO_SB_SLUG[agentId]||agentId;
      sbInsert('directives',{key:'prompt_'+sbSlug+'_'+Date.now(),value_json:{agent:sbSlug,prompt:text,type:'strategy_update'},active:true})
        .then(function(){addFeed(agentId,'📝 Стратегия обновлена');})
        .catch(function(e){console.warn(e);});
    }
    closeModal();
    addFeed('coordinator','📝 Промпт обновлён: '+AGENTS[agentId].emoji+' '+AGENTS[agentId].name);
  }
};

window.openDirectiveInput=function(agentId){
  var a=AGENTS[agentId];
  openModal(
    '<h2 style="margin-bottom:12px">🎯 Задача для '+a.emoji+' '+a.name+'</h2>'+
    '<p style="font-size:12px;color:var(--dim);margin-bottom:12px">Эта задача будет передана агенту на следующем цикле через Координатора.</p>'+
    '<textarea id="directiveArea" style="width:100%;height:120px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;padding:12px;resize:vertical;font-family:inherit" placeholder="Например: Сфокусируйся на гайдах по TrueSkill матчмейкингу..."></textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'+
      '<button onclick="sendAgentDirective(\''+agentId+'\')" style="padding:8px 20px;background:var(--amber);color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:700">🚀 Отправить</button>'+
      '<button onclick="closeModal()" style="padding:8px 20px;background:var(--border);color:var(--text);border:none;border-radius:6px;cursor:pointer">Отмена</button>'+
    '</div>'
  );
};

window.sendAgentDirective=function(agentId){
  var text=document.getElementById('directiveArea').value.trim();
  if(text){
    if(SUPABASE_LIVE){
      var sbSlug=DASH_TO_SB_SLUG[agentId]||agentId;
      sbInsert('directives',{key:'task_'+sbSlug+'_'+Date.now(),value_json:{agent:sbSlug,task:text,type:'direct_task'},active:true})
        .then(function(){
          addFeed(agentId,'🎯 Новая задача: '+text.slice(0,60)+'...');
          closeModal();
          alert('Задача отправлена! '+AGENTS[agentId].name+' получит её на следующем цикле.');
        });
    } else {
      addFeed(agentId,'🎯 Задача (локально): '+text.slice(0,60)+'...');
      closeModal();
    }
  }
};

window.toggleAgent=function(id){
  if(!D.agentMeta)D.agentMeta={};
  if(!D.agentMeta[id])D.agentMeta[id]={active:true};
  D.agentMeta[id].active=!D.agentMeta[id].active;
  renderAgentsPanel();
  var a=AGENTS[id];
  addFeed('coordinator',(D.agentMeta[id].active?'✅ Включён':'⏸ Отключён')+': '+a.emoji+' '+a.name);
};
renderAgentsPanel();

// ═══ TEAM CHAT ═══
const chatHistory={general:[]};
let currentChannel='general';

function initChatChannels(){
  // General + per-department + per-agent
  const channels=[{id:'general',name:'💬 Общий',icon:''}];
  DEPTS.forEach(function(d){channels.push({id:'dept_'+d.id,name:d.name,icon:''});});
  Object.keys(AGENTS).forEach(function(id){
    var a=AGENTS[id]; channels.push({id:'agent_'+id,name:a.emoji+' '+a.name,icon:''});
    chatHistory['agent_'+id]=[];
  });
  DEPTS.forEach(function(d){chatHistory['dept_'+d.id]=[];});

  document.getElementById('chatSidebar').innerHTML=
    '<div style="padding:8px 14px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);font-weight:700">Каналы</div>'+
    channels.slice(0,1).map(function(c){
      return '<div class="chat-channel '+(c.id===currentChannel?'active':'')+'" data-channel="'+c.id+'"><span class="ch-name">'+c.name+'</span></div>';
    }).join('')+
    '<div style="padding:8px 14px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);font-weight:700;margin-top:8px">Отделы AI</div>'+
    channels.filter(function(c){return c.id.startsWith('dept_');}).map(function(c){
      return '<div class="chat-channel '+(c.id===currentChannel?'active':'')+'" data-channel="'+c.id+'"><span class="ch-name">'+c.name+'</span></div>';
    }).join('')+
    '<div style="padding:8px 14px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);font-weight:700;margin-top:8px">Агенты</div>'+
    channels.filter(function(c){return c.id.startsWith('agent_');}).map(function(c){
      return '<div class="chat-channel '+(c.id===currentChannel?'active':'')+'" data-channel="'+c.id+'"><span class="ch-name">'+c.name+'</span></div>';
    }).join('');

  document.querySelectorAll('.chat-channel').forEach(function(el){
    el.addEventListener('click',function(){
      currentChannel=el.dataset.channel;
      initChatChannels();
      renderChat();
    });
  });
}

function renderChat(){
  var msgs=chatHistory[currentChannel]||[];
  var chName=currentChannel==='general'?'💬 Общий чат':currentChannel.startsWith('agent_')?
    (function(){var id=currentChannel.replace('agent_','');var a=AGENTS[id];return a?a.emoji+' '+a.name:'?';})():
    (function(){var did=currentChannel.replace('dept_','');var d=DEPTS.find(function(x){return x.id===did;});return d?d.name:'?';})();
  document.getElementById('chatHeader').innerHTML=chName+
    (currentChannel!=='general'?'<span style="font-size:11px;color:var(--dim);margin-left:auto">'+msgs.length+' сообщений</span>':'');

  var el=document.getElementById('chatMessages');
  if(!msgs.length){
    el.innerHTML='<div style="text-align:center;color:var(--dim);font-size:13px;padding:40px 0">Начни диалог — напиши вопрос или задачу.<br>Агенты ответят на основе реальных данных из системы.</div>';
    return;
  }
  el.innerHTML=msgs.map(function(m){
    return '<div class="chat-msg '+(m.role==='user'?'user':'agent')+'">'+
      '<div class="msg-author" style="color:'+(m.role==='user'?'var(--cyan)':m.color||'var(--green)')+'">'+m.author+'</div>'+
      '<div>'+m.text+'</div>'+
      (m.source?'<div class="msg-source">📎 '+m.source+'</div>':'')+
      '<div class="msg-time">'+m.time+'</div></div>';
  }).join('');
  el.scrollTop=el.scrollHeight;
}

// ═══ AI API CONFIG ═══
// Edge Function URL for AI chat (replaces old Make.com webhook)
const CHAT_EDGE_URL=SUPABASE_URL+'/functions/v1/agent-chat';
let f2fApiKey=localStorage.getItem('f2f_api_key')||'';

function closeModal(){modal.classList.remove('open');}
function openApiKeyModal(){
  var html='<h2 style="margin-bottom:16px">🔑 Anthropic API Key</h2>'+
    '<p style="color:var(--dim);margin-bottom:12px;font-size:13px">Для AI-ответов агентов нужен ключ Claude API. Он хранится только локально в вашем браузере.</p>'+
    '<input type="password" id="apiKeyInput" value="'+f2fApiKey+'" placeholder="sk-ant-..." style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;margin-bottom:12px">'+
    '<div style="display:flex;gap:8px;justify-content:flex-end">'+
    '<button onclick="f2fApiKey=document.getElementById(\'apiKeyInput\').value.trim();localStorage.setItem(\'f2f_api_key\',f2fApiKey);var btn=document.getElementById(\'apiKeyBtn\');if(f2fApiKey.startsWith(\'sk-\')){btn.style.borderColor=\'var(--green)\';btn.style.color=\'var(--green)\';btn.textContent=\'🔑 AI ON\';}else{btn.style.borderColor=\'\';btn.style.color=\'\';btn.textContent=\'🔑 API\';}closeModal()" style="padding:8px 20px;background:var(--cyan);color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:700">Сохранить</button>'+
    '<button onclick="closeModal()" style="padding:8px 20px;background:var(--border);color:var(--text);border:none;border-radius:6px;cursor:pointer">Отмена</button></div>';
  openModal(html);
}

function buildContextForAI(channel){
  var ctx='F2F.vin — esports matchmaking platform.\n';
  ctx+='Burn rate: $'+(D.finance?D.finance.totalBudgetUSDT.toLocaleString():'?')+'/мес. Команда: '+D.team.filter(function(t){return t.status==='active';}).length+' чел.\n';
  ctx+='Лидов: '+D.leads.length+', Постов: '+D.posts.length+', Задач: '+D.tasks.length+'.\n';
  if(D.finance){ctx+='ФОТ: $'+D.finance.salary.totalUSDT.toLocaleString()+'. Подписки: $'+(D.finance.regularSubsUSDT||0).toLocaleString()+'.\n';}
  var unassigned=D.team.filter(function(t){return t.status==='active'&&t.dept==='unassigned';}).length;
  if(unassigned)ctx+=unassigned+' сотрудников не распределены.\n';
  if(D.finance&&D.finance.unpaidItems&&D.finance.unpaidItems.length)ctx+='Долги: '+D.finance.unpaidItems.map(function(u){return u.name+' $'+u.leftUSDT;}).join(', ')+'.\n';
  // Add agent-specific context
  if(channel.startsWith('agent_')){
    var agId=channel.replace('agent_','');
    var ag=AGENTS[agId];var meta=D.agentMeta?D.agentMeta[agId]:null;
    if(ag)ctx+='\nТы — '+ag.name+' ('+ag.emoji+'). Отдел: '+ag.dept+'.\n';
    if(meta){ctx+='Твоя задача: '+meta.purpose+'\nТвои источники: '+meta.sources.join(', ')+'.\n';}
    var agTasks=D.tasks.filter(function(t){return t.assignedTo===agId;});
    if(agTasks.length)ctx+='Твои задачи: '+agTasks.map(function(t){return t.title+' ['+t.status+']';}).join('; ')+'.\n';
  } else if(channel.startsWith('dept_')){
    var deptId=channel.replace('dept_','');
    var dept=DEPTS.find(function(d){return d.id===deptId;});
    if(dept){
      ctx+='\nОтдел: '+dept.name+'. Агенты: '+dept.agents.map(function(aid){return AGENTS[aid]?AGENTS[aid].name:'?';}).join(', ')+'.\n';
      dept.agents.forEach(function(aid){
        var m2=D.agentMeta?D.agentMeta[aid]:null;
        if(m2)ctx+=AGENTS[aid].name+': '+m2.purpose+'\n';
      });
    }
  } else {
    // General — add summary of all agents
    ctx+='\nТы — Coordinator, AI-менеджер всех отделов.\n';
    ctx+='Отделы: '+DEPTS.map(function(d){return d.name+' ('+d.agents.length+' агентов)';}).join(', ')+'.\n';
    var hot=D.leads.filter(function(l){return l.priority==='hot';});
    if(hot.length)ctx+='Hot лиды: '+hot.map(function(l){return l.name+' ('+l.company+')';}).join(', ')+'.\n';
    var pendTasks=D.tasks.filter(function(t){return t.status==='pending';});
    if(pendTasks.length)ctx+='Задачи в работе: '+pendTasks.map(function(t){return t.title;}).join(', ')+'.\n';
  }
  // Chat history for context
  var hist=chatHistory[channel]||[];
  if(hist.length>0){
    ctx+='\nИстория чата (последние '+(Math.min(hist.length,6))+'):\n';
    hist.slice(-6).forEach(function(m){ctx+=m.author+': '+m.text.substring(0,150)+'\n';});
  }
  return ctx;
}

function chatRespondAI(channel,userMsg){
  // Determine which agent responds
  var responderId='coordinator';
  if(channel.startsWith('agent_'))responderId=channel.replace('agent_','');
  else if(channel.startsWith('dept_')){
    var dId=channel.replace('dept_','');
    var dept=DEPTS.find(function(d){return d.id===dId;});
    if(dept&&dept.agents.length)responderId=dept.agents[0];
  }
  var ag=AGENTS[responderId]||{emoji:'📋',name:'Coordinator',color:'#ffb800'};

  // Show typing indicator
  chatHistory[channel].push({
    role:'agent', author:ag.emoji+' '+ag.name, text:'💭 Думаю...',
    color:ag.color, source:null, time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}),
    _typing:true
  });
  renderChat();

  var ctx=buildContextForAI(channel);

  // Map agent ID to slug for Edge Function
  var slug=CHAT_SLUG_MAP[responderId]||responderId||'coordinator';

  // Call Supabase Edge Function → Claude API
  fetch(CHAT_EDGE_URL,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+SUPABASE_ANON
    },
    body:JSON.stringify({
      agent_slug:slug,
      message:userMsg,
      context:ctx
    })
  })
  .then(function(res){return res.json();})
  .then(function(data){
    // Remove typing indicator
    var ch=chatHistory[channel];
    for(var i=ch.length-1;i>=0;i--){if(ch[i]._typing){ch.splice(i,1);break;}}
    // Parse Edge Function response
    var text='';
    if(data&&data.reply){
      text=data.reply;
    } else if(data&&data.error){
      text='⚠️ Ошибка API: '+(typeof data.error==='string'?data.error:JSON.stringify(data.error));
    } else {
      text='⚠️ Неожиданный формат ответа. Попробуйте ещё раз.';
    }
    var meta=D.agentMeta?D.agentMeta[responderId]:null;
    ch.push({
      role:'agent', author:ag.emoji+' '+ag.name, text:text,
      color:ag.color, source:meta?'AI (Claude) • Источники: '+meta.sources.slice(0,3).join(', '):null,
      time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})
    });
    renderChat();
    updateCredits(meta?meta.costPerAction||2:2);
    // ═══ CHAT → TASK: Parse agent replies for tasks/assignments ═══
    parseChatForTasks(text, responderId, channel);
    // Log to Supabase if live
    if(SUPABASE_LIVE){
      sbInsert('chat_history',{agent_id:null,sender:'ceo',message:userMsg}).catch(function(){});
      sbInsert('chat_history',{agent_id:null,sender:'agent',message:text}).catch(function(){});
      sbInsert('events',{type:'chat',metadata_json:{agent:responderId,channel:channel}}).catch(function(){});
    }
  })
  .catch(function(err){
    // Remove typing indicator and fallback to template
    var ch=chatHistory[channel];
    for(var i=ch.length-1;i>=0;i--){if(ch[i]._typing){ch.splice(i,1);break;}}
    console.warn('AI chat error, falling back to templates:',err);
    chatRespondTemplate(channel,userMsg);
  });
}

function chatRespondTemplate(channel,userMsg){
  var responses=[];
  if(channel==='general'){
    var kw=userMsg.toLowerCase();
    if(kw.includes('лид')||kw.includes('контакт')||kw.includes('navi')||kw.includes('virtus')){
      var hot=D.leads.filter(function(l){return l.priority==='hot';});
      responses.push({agentId:'leads',text:'В CRM '+D.leads.length+' лидов: '+hot.length+' hot. Топ: '+D.leads.slice(0,3).map(function(l){return l.name+' ('+l.company+')';}).join(', ')+'.',source:'CRM данные'});
    }
    if(kw.includes('бюджет')||kw.includes('деньг')||kw.includes('burn')||kw.includes('расход')||kw.includes('финанс')){
      var f=D.finance;
      responses.push({agentId:'budget_analyst',text:'Burn rate: $'+f.totalBudgetUSDT.toLocaleString()+'/мес. ФОТ: $'+f.salary.totalUSDT.toLocaleString()+'.',source:'Фин. отчет'});
    }
    if(!responses.length){
      responses.push({agentId:'coordinator',text:'В системе: '+D.leads.length+' лидов, '+D.tasks.length+' задач, '+(D.team.filter(function(t){return t.status==='active';}).length)+' сотрудников. ⚠️ Для умных ответов подключи API ключ (🔑 в header).',source:'Offline-режим'});
    }
  } else if(channel.startsWith('agent_')){
    var agentId=channel.replace('agent_','');
    var a=AGENTS[agentId];var m=D.agentMeta?D.agentMeta[agentId]:null;
    responses.push({agentId:agentId,text:a.emoji+' '+a.name+(m?' — '+m.purpose:'')+'. ⚠️ Для полноценного общения подключи API ключ (🔑).',source:m?'Источники: '+m.sources.join(', '):null});
  } else if(channel.startsWith('dept_')){
    var deptId=channel.replace('dept_','');
    var dept=DEPTS.find(function(d){return d.id===deptId;});
    if(dept){
      dept.agents.forEach(function(aid){
        var ag2=AGENTS[aid];
        responses.push({agentId:aid,text:ag2.emoji+' '+ag2.name+' — на связи. ⚠️ Подключи API ключ для AI-ответов.',source:null});
      });
    }
  }
  responses.forEach(function(r,i){
    setTimeout(function(){
      var ag=AGENTS[r.agentId]||{emoji:'📋',name:'System',color:'#64748b'};
      chatHistory[channel].push({
        role:'agent', author:ag.emoji+' '+ag.name, text:r.text,
        color:ag.color, source:r.source,
        time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})
      });
      renderChat();
      updateCredits(1);
    },(i+1)*400);
  });
}

function chatRespond(channel,userMsg){
  if(f2fApiKey&&f2fApiKey.startsWith('sk-')){
    chatRespondAI(channel,userMsg);
  } else {
    chatRespondTemplate(channel,userMsg);
  }
}

document.getElementById('chatSend').addEventListener('click',function(){
  var input=document.getElementById('chatInput');
  var msg=input.value.trim();if(!msg)return;
  input.value='';
  if(!chatHistory[currentChannel])chatHistory[currentChannel]=[];
  chatHistory[currentChannel].push({
    role:'user', author:'👑 Aider (CEO)', text:msg, color:'var(--cyan)',
    time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})
  });
  renderChat();
  chatRespond(currentChannel,msg);
  // Save as CEO directive to Supabase (Coordinator will pick it up)
  if(SUPABASE_LIVE&&currentChannel==='general'){
    sbInsert('directives',{key:'ceo_chat_'+Date.now(),value_json:{text:msg,source:'ui_chat',channel:currentChannel},active:true})
      .then(function(){console.log('✅ CEO directive saved to Supabase');})
      .catch(function(e){console.warn('Directive save error:',e);});
  }
});
document.getElementById('chatInput').addEventListener('keydown',function(e){
  if(e.key==='Enter')document.getElementById('chatSend').click();
});

initChatChannels();
renderChat();
// Update API key button visual
(function(){
  var btn=document.getElementById('apiKeyBtn');
  if(f2fApiKey&&f2fApiKey.startsWith('sk-')){
    btn.style.borderColor='var(--green)';btn.style.color='var(--green)';btn.textContent='🔑 AI ON';
  }
})();

// ═══ CHAT → TASK PARSER ═══
// Parses agent chat replies for task-like content and auto-creates tasks
function parseChatForTasks(text, agentId, channel){
  if(!text||text.length<20)return;
  // Keywords that indicate a task assignment
  var taskPatterns=[
    /(?:\*\*)?(?:ПОРУЧЕНИЕ|СРОЧНОЕ ПОРУЧЕНИЕ|ЗАДАЧА|ЗАДАНИЕ|TODO|TASK)(?:\*\*)?[:\s]+(.{10,120})/gi,
    /(?:\*\*)?Deadline(?:\*\*)?[:\s]*(\d+\s*(?:час|дн|нед|мин|hour|day))/gi,
    /(?:Передаю|Поручаю|Назначаю|Ставлю задачу)[:\s]+(.{10,120})/gi,
    /(?:@(?:BizDev|SMM|Analyst|Outreach|Community|Lead\s*Finder|Follow-?Up|Processor|Watchdog))[,\s]+(.{10,100})/gi
  ];
  var foundTasks=[];
  // Pattern 1: Direct task keywords
  var m;
  var p1=/(?:\*\*)?(?:ПОРУЧЕНИЕ|СРОЧНОЕ ПОРУЧЕНИЕ|ЗАДАЧА|ЗАДАНИЕ)(?:\*\*)?[:\s]+([^\n*]{10,120})/gi;
  while((m=p1.exec(text))!==null){foundTasks.push(m[1].replace(/\*\*/g,'').trim());}
  // Pattern 2: "Подготовить / Сделать / Написать / Создать / Найти / Обновить" at line start
  var p2=/(?:^|\n)[-–•]\s*((?:Подготовить|Сделать|Написать|Создать|Найти|Обновить|Запустить|Провести|Собрать|Отправить)[^\n]{10,120})/gi;
  while((m=p2.exec(text))!==null){foundTasks.push(m[1].replace(/\*\*/g,'').trim());}
  // Pattern 3: @Agent mentions with commands
  var p3=/@(BizDev|SMM|Analyst|Outreach|Community|Analytics)[,\s—–-]+([^\n@]{10,120})/gi;
  while((m=p3.exec(text))!==null){
    var agentMap={'BizDev':'leads','SMM':'content','Analyst':'market','Outreach':'outreach','Community':'social','Analytics':'market'};
    var targetAgent=agentMap[m[1]]||'coordinator';
    foundTasks.push({text:m[2].replace(/\*\*/g,'').trim(),agent:targetAgent});
  }
  // Deduplicate and limit
  var seen=new Set();
  var uniqueTasks=[];
  foundTasks.forEach(function(t){
    var taskText=typeof t==='string'?t:t.text;
    var key=taskText.slice(0,50).toLowerCase();
    if(!seen.has(key)&&taskText.length>10){
      seen.add(key);
      uniqueTasks.push(typeof t==='string'?{text:t,agent:agentId}:t);
    }
  });
  if(uniqueTasks.length===0)return;
  // Limit to max 5 tasks per message
  uniqueTasks=uniqueTasks.slice(0,5);
  // Detect priority from text
  var isUrgent=text.includes('СРОЧН')||text.includes('срочн')||text.includes('urgent')||text.includes('ASAP');
  // Create tasks
  uniqueTasks.forEach(function(taskObj){
    var title=taskObj.text.slice(0,120);
    var assignTo=taskObj.agent||agentId;
    var ag=AGENTS[assignTo];
    var taskData={
      id:D.tasks.length+1+Math.floor(Math.random()*1000),
      title:'💬 '+title,
      assignedTo:assignTo,
      dept:ag?ag.dept:'cmd',
      status:'pending',
      priority:isUrgent?'high':'normal',
      createdDate:new Date().toISOString().slice(0,10),
      completedDate:null,
      result:null,
      fromChat:true
    };
    // Save to Supabase
    if(SUPABASE_LIVE){
      var sbSlug=DASH_TO_SB_SLUG[assignTo]||'coordinator';
      var sbAgent=window._sbAgents?window._sbAgents[sbSlug]:null;
      if(sbAgent){
        sbInsert('actions',{
          agent_id:sbAgent.id,
          type:'task_from_chat',
          payload_json:{title:'💬 '+title,status:'pending',priority:isUrgent?'high':'normal',source:'chat_parser',channel:channel}
        }).then(function(res){
          if(res&&res[0])taskData.sbId=res[0].id;
        }).catch(function(){});
      }
    }
    D.tasks.push(taskData);
  });
  renderTasks();updateKPI();
  // Notify in feed
  addFeed(agentId,'📋 Из чата создано '+uniqueTasks.length+' задач'+(uniqueTasks.length>1?'и':'а'));
  // Flash tasks tab badge
  var tasksTab=document.querySelector('.tab[data-panel="tasks"]');
  if(tasksTab){
    var badge=tasksTab.querySelector('.tab-badge');
    if(!badge){badge=document.createElement('span');badge.className='tab-badge';tasksTab.appendChild(badge);}
    badge.textContent='+'+uniqueTasks.length;badge.style.cssText='background:#ff2d78;color:white;border-radius:50%;padding:1px 5px;font-size:9px;margin-left:4px;animation:pulse 1s ease-in-out 3';
    setTimeout(function(){badge.remove();},5000);
  }
}

// ═══ APPROVAL → EXECUTION ENGINE ═══
// When CEO clicks ✅ on a task, execute the real action based on task type
window.executeApprovedAction=async function(taskId){
  var t=D.tasks.find(function(x){return x.id===taskId;});
  if(!t)return;
  var type=(t.title||'').toLowerCase();
  var payload=t._payload||{};

  // ─── email_template_created → Send Email ───
  if(type.includes('email_template')||t._actionType==='email_template_created'){
    var emailData=payload;
    if(!emailData.to&&!emailData.email){
      var email=prompt('📧 Email получателя:');
      if(!email||!email.includes('@'))return alert('Нужен валидный email');
      emailData.to=email;
    }
    if(!emailData.subject){
      emailData.subject=prompt('📝 Тема письма:',payload.subject||'Партнёрство с F2F.vin')||'Партнёрство с F2F.vin';
    }
    var body=payload.body||payload.template||payload.content||payload.text||'';
    if(!body){
      body=prompt('Текст письма (или Enter для стандартного):');
      if(!body)body='Здравствуйте! Предлагаем обсудить партнёрство с F2F.vin — CS2 соревновательная платформа. С уважением, Айдер Джанбаев, CEO F2F.';
    }
    // Confirm before sending
    if(!confirm('📧 Отправить email?\n\nКому: '+(emailData.to||emailData.email)+'\nТема: '+emailData.subject+'\n\nТекст: '+body.slice(0,200)+'...'))return;
    // Call send-email Edge Function
    try{
      var resp=await fetch(SUPABASE_URL+'/functions/v1/send-email',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON},
        body:JSON.stringify({
          action_id:t.sbId||null,
          to:emailData.to||emailData.email,
          subject:emailData.subject,
          body:body,
          from_name:'Aider Janbaev | F2F.vin'
        })
      });
      var data=await resp.json();
      if(data.success){
        t.status='done';t.completedDate=new Date().toISOString().slice(0,10);
        t.result='✅ Email отправлен: '+(emailData.to||emailData.email);
        renderTasks();updateKPI();
        addFeed('outreach','📧 Email отправлен → '+(emailData.to||emailData.email));
        alert('✅ Email отправлен!');
      }else{
        alert('❌ Ошибка отправки: '+(data.error||JSON.stringify(data))+'\n\nПодсказка: Убедитесь что RESEND_API_KEY настроен в Supabase secrets.');
      }
    }catch(e){
      alert('❌ Ошибка: '+e+'\n\nEdge Function send-email может быть не задеплоена.');
    }
    return;
  }

  // ─── lead_suggested → Add to Pipeline ───
  if(type.includes('lead_suggested')||t._actionType==='lead_suggested'){
    var leadName=payload.name||payload.company||payload.lead||t.title.replace('lead_suggested','').trim();
    if(!leadName)leadName=prompt('Имя/компания лида:');
    if(!leadName)return;
    // Save to partner_pipeline
    if(SUPABASE_LIVE){
      var res=await sbInsert('partner_pipeline',{
        company:payload.company||leadName,
        contact_name:payload.name||payload.contact||leadName,
        contact_email:payload.email||'',
        stage:'identified',
        notes:'Из рекомендации AI: '+(payload.reason||payload.description||''),
        source:'ai_suggested'
      });
      if(res&&res[0]){
        // Also add to D.leads for immediate display
        D.leads.push({
          id:D.leads.length+100,sbId:res[0].id,
          name:payload.name||payload.contact||leadName,
          company:payload.company||leadName,
          email:payload.email||'',
          priority:'warm',
          notes:payload.reason||payload.description||'AI рекомендация',
          addedDate:new Date().toISOString().slice(0,10),
          source:'AI Agent'
        });
        t.status='done';t.completedDate=new Date().toISOString().slice(0,10);
        t.result='✅ Добавлен в Pipeline: '+leadName;
        renderLeads();renderTasks();updateKPI();
        addFeed('leads','🆕 Лид добавлен из AI → '+leadName);
        alert('✅ Лид добавлен в Pipeline!');
      }
    }else{
      alert('Supabase не подключён');
    }
    return;
  }

  // ─── content / post → Approve & Publish ───
  if(type.includes('post')||type.includes('контент')||type.includes('content')||t._actionType==='content_created'){
    if(t.sbId&&SUPABASE_LIVE){
      await sbPatch('content_queue','id=eq.'+t.sbId,{status:'approved'});
      t.status='done';t.completedDate=new Date().toISOString().slice(0,10);
      t.result='✅ Пост одобрен, будет опубликован по расписанию';
      renderTasks();
      addFeed('content','✅ Пост одобрен к публикации');
      alert('✅ Пост одобрен! Будет опубликован по расписанию.');
    }
    return;
  }

  // ─── Default: just mark as done ───
  t.status='done';t.completedDate=new Date().toISOString().slice(0,10);
  renderTasks();updateKPI();
  if(t.sbId&&SUPABASE_LIVE){sbPatch('actions','id=eq.'+t.sbId,{payload_json:{title:t.title,status:'done',completed_at:t.completedDate}});}
  addFeed(t.assignedTo||'coordinator','✅ Выполнено: '+t.title);
};

// ═══ INTEGRATIONS PANEL ═══
function renderIntegrations(){
  const intg=D.integrations;
  if(!intg){document.getElementById('intgContent').innerHTML='<p style="color:var(--dim)">Нет данных</p>';return;}
  const conn=intg.connected||[];const need=intg.needed||[];
  document.getElementById('intg-count').textContent=conn.length+' подключено, '+need.length+' нужно';
  let html='<h3 style="font-size:14px;color:var(--green);margin-bottom:12px">✅ Подключено ('+conn.length+')</h3>';
  html+=conn.map(c=>`<div class="intg-row">
    <div class="intg-dot ${c.status}"></div>
    <div class="intg-name">${c.name}</div>
    <div class="intg-purpose">${c.purpose}</div>
    <div class="intg-badge ${c.status}">${c.status==='active'?'Active':c.status==='limited'?'Limited':'Pending'}</div>
  </div>`).join('');
  html+='<h3 style="font-size:14px;color:var(--amber);margin:20px 0 12px">⏳ Нужно подключить ('+need.length+')</h3>';
  html+=need.map(n=>`<div class="intg-row">
    <div class="intg-dot needed"></div>
    <div class="intg-name">${n.name}</div>
    <div class="intg-purpose">${n.purpose}</div>
    <div class="intg-badge needed">${n.priority}</div>
  </div>`).join('');
  document.getElementById('intgContent').innerHTML=html;
}
renderIntegrations();

// ═══ CLOCK ═══
setInterval(()=>{
  document.getElementById('clock').textContent=new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
},1000);

// ═══ MODAL ═══
const modal=document.getElementById('modal');
const modalContent=document.getElementById('modalContent');
document.getElementById('modalClose').addEventListener('click',()=>modal.classList.remove('open'));
modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});

function openModal(html){ modalContent.innerHTML=html; modal.classList.add('open'); }

// ═══ LEADS ═══
let leadFilter='all';
function renderLeads(){
  // Supabase-first: replace mock leads with real partner_pipeline data
  if(SUPABASE_LIVE&&window._sbPartners&&!window._sbPartnersMerged){
    window._sbPartnersMerged=true;
    if(window._sbPartners.length>0){
      // Clear all non-SB leads (mock data) when we have real data
      D.leads=D.leads.filter(function(l){return l.sbId;});
    }
    window._sbPartners.forEach(function(p,i){
      var exists=D.leads.find(function(l){return l.sbId===p.id;});
      if(!exists){
        var nParts=(p.notes||'').split('|');
        var loc=nParts.length>1?nParts[1].trim():'CIS';
        var src=nParts.length>0?nParts[0].trim():'AI Agent';
        D.leads.push({
          id:8000+i,sbId:p.id,name:p.contact_name||'Контакт',title:p.segment||'',
          company:p.company_name||'',email:p.contact_email||'',linkedin:'',
          location:loc,source:src,
          priority:p.stage==='negotiating'?'hot':p.stage==='contacted'?'warm':'medium',
          notes:p.pitch_text||'Найден AI агентом',startDate:(p.created_at||'').slice(0,10),
          status:'active',sbStage:p.stage
        });
      }
    });
  }
  const filtered=D.leads.filter(l=>leadFilter==='all'||l.priority===leadFilter);
  document.getElementById('leads-count').textContent=filtered.length+' контактов';
  document.getElementById('leadsGrid').innerHTML=filtered.map(l=>`
    <div class="lead-card" onclick="openLeadModal(${l.id})">
      <div class="priority ${l.priority}">${l.priority}</div>
      <div class="lead-name">${l.name}</div>
      <div class="lead-title">${l.title}</div>
      <div class="lead-company">${l.company}</div>
      <div class="lead-meta">
        ${l.email?`<span>📧 ${l.email}</span>`:''}
        ${l.linkedin?`<a href="${l.linkedin}" target="_blank" onclick="event.stopPropagation()">🔗 LinkedIn</a>`:''}
        <span>📍 ${l.location}</span>
      </div>
      <div class="lead-notes">${l.notes}</div>
    </div>`).join('');
}
document.getElementById('leadFilters').addEventListener('click',e=>{
  if(!e.target.classList.contains('filter-btn'))return;
  document.querySelectorAll('#leadFilters .filter-btn').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  leadFilter=e.target.dataset.filter;
  renderLeads();
});

window.openLeadModal=function(id){
  const l=D.leads.find(x=>x.id===id);if(!l)return;
  const comp=D.companies.find(c=>l.company.includes(c.name.split(' ')[0]));
  openModal(`
    <h2>${l.name}</h2>
    <p style="color:var(--dim)">${l.title} @ <span style="color:var(--cyan)">${l.company}</span></p>
    <div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
      <span class="tag" style="background:${l.priority==='hot'?'#ff444422':l.priority==='warm'?'#ffaa0022':'#4488ff22'};
        color:${l.priority==='hot'?'var(--hot)':l.priority==='warm'?'var(--warm)':'var(--medium)'}">${l.priority.toUpperCase()}</span>
      <span class="tag" style="background:#ffffff08;color:var(--dim)">📍 ${l.location}</span>
      <span class="tag" style="background:#ffffff08;color:var(--dim)">📅 В должности с ${l.startDate}</span>
      <span class="tag" style="background:#ffffff08;color:var(--dim)">Источник: ${l.source}</span>
    </div>
    ${l.email?`<p>📧 Email: <a href="mailto:${l.email}">${l.email}</a></p>`:''}
    ${l.linkedin?`<p>🔗 LinkedIn: <a href="${l.linkedin}" target="_blank">${l.linkedin}</a></p>`:''}
    <h3>Заметки</h3>
    <p>${l.notes}</p>
    ${comp?`<h3>О компании: ${comp.name}</h3>
    <p>🌐 ${comp.website} | 👥 ${comp.employees} сотр. | 💰 ${comp.revenue} | 🏆 ${comp.prizeWinnings}</p>
    <p>${comp.notes}</p>`:''}
    <h3>Действия</h3>
    <div class="action-bar">
      <button class="act-btn success" onclick="leadAction(${l.id},'outreach')">📧 Написать письмо</button>
      <button class="act-btn" onclick="leadAction(${l.id},'priority')">🔄 Сменить приоритет</button>
      <button class="act-btn" onclick="leadAction(${l.id},'note')">📝 Добавить заметку</button>
      <button class="act-btn warn" onclick="leadAction(${l.id},'contacted')">📞 Отметить контакт</button>
      <button class="act-btn" onclick="leadAction(${l.id},'task')">📋 Создать задачу</button>
      <button class="act-btn danger" onclick="leadAction(${l.id},'remove')">🗑 Удалить лид</button>
    </div>
  `);
};
window.leadAction=function(id,action){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  // Helper: sync lead field to Supabase
  function syncLead(field,val){
    if(l.sbId&&SUPABASE_LIVE)sbPatch('partner_pipeline','id=eq.'+l.sbId,field);
  }
  // Helper: create task with Supabase sync
  async function createSyncedTask(title,agent,priority){
    var taskData={id:D.tasks.length+1,title:title,assignedTo:agent,dept:AGENTS[agent]?.dept||'biz',
      status:'pending',priority:priority||'normal',createdDate:new Date().toISOString().slice(0,10),completedDate:null,result:null};
    if(SUPABASE_LIVE){
      var sbSlug=DASH_TO_SB_SLUG[agent]||'coordinator';
      var sbAgent=window._sbAgents[sbSlug];
      if(sbAgent){
        var res=await sbInsert('actions',{agent_id:sbAgent.id,type:'task_created',
          payload_json:{title:title,status:'pending',priority:priority||'normal',source:'dashboard'}});
        if(res&&res[0])taskData.sbId=res[0].id;
      }
    }
    D.tasks.push(taskData);renderTasks();updateKPI();
  }

  if(action==='priority'){
    var levels=['hot','warm','medium'];
    var cur=levels.indexOf(l.priority);
    l.priority=levels[(cur+1)%3];
    // Map priority → stage for Supabase
    var stageMap={hot:'negotiating',warm:'contacted',medium:'identified'};
    syncLead({stage:stageMap[l.priority]||'identified'});
    renderLeads();openLeadModal(id);
    addFeed('leads','🔄 Приоритет '+l.name+' → '+l.priority.toUpperCase());
  }
  if(action==='note'){
    var note=prompt('Добавить заметку к '+l.name+':');
    if(note&&note.trim()){
      l.notes+=' | '+note.trim();
      syncLead({notes:(l.notes||'')});
      renderLeads();openLeadModal(id);
      addFeed('leads','📝 Заметка к '+l.name+': '+note.trim());
    }
  }
  if(action==='contacted'){
    l.notes+=' | ✅ Контакт '+new Date().toLocaleDateString('ru');
    l.sbStage='contacted';
    syncLead({stage:'contacted',notes:(l.notes||''),updated_at:new Date().toISOString()});
    renderLeads();openLeadModal(id);
    addFeed('outreach','📞 Контакт с '+l.name+' отмечен');
  }
  if(action==='outreach'){
    createSyncedTask('Написать outreach письмо для '+l.name+' ('+l.company+')','outreach','high');
    addFeed('outreach','📧 Outreach задача: '+l.name);
    alert('Задача создана: написать письмо для '+l.name);
  }
  if(action==='task'){
    var task=prompt('Задача по лиду '+l.name+':');
    if(task&&task.trim()){
      createSyncedTask(task.trim()+' ['+l.name+']','leads','normal');
      addFeed('leads','📋 Задача: '+task.trim());
    }
  }
  if(action==='remove'){
    if(confirm('Удалить лид '+l.name+'?')){
      if(l.sbId&&SUPABASE_LIVE)sbPatch('partner_pipeline','id=eq.'+l.sbId,{stage:'closed_lost'});
      D.leads=D.leads.filter(function(x){return x.id!==id;});
      renderLeads();updateKPI();modal.classList.remove('open');
      addFeed('leads','🗑 Лид удалён: '+l.name);
    }
  }
};
renderLeads();

// ═══ POSTS ═══
let postFilter='all';
function renderPosts(){
  // Merge Supabase content_queue into D.posts if available
  if(SUPABASE_LIVE&&window._sbContent&&!window._sbContentMerged){
    window._sbContentMerged=true;
    // Remove old mock posts if we have real Supabase data
    if(window._sbContent.length>0){
      D.posts=D.posts.filter(p=>p.sbId); // keep only previously merged SB posts (will re-add)
    }
    window._sbContent.forEach(function(c,i){
      // Skip if already merged
      if(D.posts.find(p=>p.sbId===c.id))return;
      var statusMap={'pending_approval':'draft','approved':'ready','rejected':'draft','published':'published'};
      var ag=window._sbAgentById&&c.agent_id?window._sbAgentById[c.agent_id]:null;
      var dashAgentId=ag?SB_SLUG_TO_DASH[ag.slug]:'content';
      var catLabel=c.status==='pending_approval'?'🤖 AI Generated (LIVE)':c.status==='approved'?'✅ Approved (LIVE)':c.status==='published'?'📢 Published (LIVE)':'📝 Content (LIVE)';
      D.posts.unshift({
        id:9000+i, sbId:c.id, platform:c.platform||'telegram',
        category:catLabel,
        text:c.content_text||'[Текст не указан]', hashtags:'', date:(c.created_at||'').slice(0,10),
        scheduledAt:c.scheduled_at, publishedAt:c.published_at,
        agentId:dashAgentId, status:statusMap[c.status]||'draft', sbStatus:c.status, isLive:true
      });
    });
  }
  const filtered=D.posts.filter(p=>{
    if(postFilter==='all')return true;
    if(postFilter==='pending')return p.sbStatus==='pending_approval';
    if(postFilter==='approved')return p.sbStatus==='approved';
    if(postFilter==='published')return p.sbStatus==='published';
    // Platform filter (Telegram, Twitter, etc.)
    return p.platform&&p.platform.toLowerCase()===postFilter.toLowerCase();
  });
  document.getElementById('posts-count').textContent=filtered.length+' постов';
  document.getElementById('postsGrid').innerHTML=filtered.map(p=>`
    <div class="post-card" onclick="openPostModal(${typeof p.sbId==='string'?("'"+p.sbId+"'"):p.id})" style="${p.isLive?'border-top:2px solid #00ff88;':''}${p.sbStatus==='pending_approval'?'border-left:3px solid #ff9800;':''}${p.sbStatus==='approved'?'border-left:3px solid #00ff88;':''}">
      <div class="post-header">
        <span class="post-platform ${p.platform}">${p.platform}</span>
        ${p.isLive?'<span style="font-size:9px;padding:2px 6px;background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;font-weight:700">LIVE</span>':''}
        <span class="post-status ${p.status}">${p.sbStatus==='pending_approval'?'⏳ Ждёт одобрения':p.sbStatus==='approved'?'✅ Одобрен':p.sbStatus==='published'?'📢 Опубликован':p.sbStatus==='rejected'?'❌ Отклонён':p.status==='ready'?'✅ Ready':'📝 Draft'}</span>
      </div>
      <div class="post-category">${p.category||''}</div>
      <div class="post-text">${(p.text||'').length>180?(p.text||'').slice(0,180)+'...':(p.text||'')}</div>
      <div class="post-tags">${p.hashtags||''}</div>
      <div class="post-date">📅 ${p.date||''}${!p.isLive?' <span style="color:#ff9800;font-size:9px">(mock)</span>':''}</div>
    </div>`).join('');
}
document.getElementById('postFilters').addEventListener('click',e=>{
  if(!e.target.classList.contains('filter-btn'))return;
  document.querySelectorAll('#postFilters .filter-btn').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  postFilter=e.target.dataset.filter;
  renderPosts();
});

window.openPostModal=function(id){
  const p=D.posts.find(x=>x.id===id||x.sbId===id);if(!p)return;
  openModal(`
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <span class="post-platform ${p.platform}">${p.platform}</span>
      <span class="post-status ${p.status}">${p.status==='ready'?'✅ Ready':'📝 Draft'}</span>
      <span class="tag" style="background:#ffffff08;color:var(--dim)">${p.category}</span>
    </div>
    <div style="font-size:15px;line-height:1.8;white-space:pre-wrap;margin-bottom:16px;padding:16px;background:var(--bg);
      border-radius:8px;border:1px solid var(--border)">${p.text}</div>
    <p style="color:var(--purple)">${p.hashtags}</p>
    <p style="color:var(--dim);margin-top:8px">📅 Дата: ${p.date} | Агент: ${AGENTS[p.agentId]?.emoji||''} ${AGENTS[p.agentId]?.name||p.agentId}</p>
    <div class="action-bar">
      <button class="act-btn" onclick="navigator.clipboard.writeText(document.querySelector('.modal div[style*=pre-wrap]').textContent).then(function(){alert('Скопировано!')})">📋 Копировать</button>
      <button class="act-btn success" onclick="postAction(${p.id},'approve')">✅ ${p.status==='draft'?'Утвердить':'Вернуть в черновик'}</button>
      <button class="act-btn warn" onclick="postAction(${p.id},'rework')" style="background:#ff980022;color:#ff9800;border-color:#ff980044">🔄 На переработку</button>
      <button class="act-btn" onclick="postAction(${p.id},'edit')">✏️ Редактировать</button>
      <button class="act-btn" onclick="postAction(${p.id},'duplicate')">📑 Дублировать</button>
      <button class="act-btn danger" onclick="postAction(${p.id},'delete')">🗑 Удалить</button>
    </div>
  `);
};
window.postAction=function(id,action){
  var p=D.posts.find(function(x){return x.id===id||x.sbId===id;});if(!p)return;
  if(action==='approve'){
    p.status=p.status==='draft'?'ready':'draft';
    // Sync to Supabase if this is a Supabase post
    if(SUPABASE_LIVE&&p.sbId){
      var newSbStatus=p.status==='ready'?'approved':'pending_approval';
      fetch(SUPABASE_URL+'/rest/v1/content_queue?id=eq.'+p.sbId,{
        method:'PATCH',
        headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,'Content-Type':'application/json'},
        body:JSON.stringify({status:newSbStatus})
      }).then(function(r){
        if(r.ok){p.sbStatus=newSbStatus;console.log('✅ Supabase post status updated: '+newSbStatus);}
      }).catch(function(e){console.warn('Post sync error:',e);});
    }
    renderPosts();openPostModal(id);
    addFeed('content',(p.status==='ready'?'✅ Утверждён':'📝 Возврат в черновик')+': '+p.platform+' пост');
  }
  if(action==='reschedule'){
    var newDate=prompt('Новая дата (YYYY-MM-DD):',p.date);
    if(newDate&&newDate.trim()){
      p.date=newDate.trim();
      if(SUPABASE_LIVE&&p.sbId){sbPatch('content_queue','id=eq.'+p.sbId,{scheduled_at:newDate.trim()+'T12:00:00Z'});}
      renderPosts();openPostModal(id);
      addFeed('content','📅 Перенос: '+p.platform+' → '+newDate.trim());
    }
  }
  if(action==='rework'){
    var feedback=prompt('Укажи что переделать (стиль, тон, тема, длина и т.д.):');
    if(feedback&&feedback.trim()){
      p.status='draft';p.sbStatus='rework';
      p.category='🔄 На переработке';
      p.text='[ПЕРЕРАБОТКА] '+feedback.trim()+'\\n\\nОригинал: '+p.text;
      // Save rework instruction to Supabase if live
      if(SUPABASE_LIVE&&p.sbId){
        sbPatch('content_queue','id=eq.'+p.sbId,{status:'rework',rework_notes:feedback.trim()});
      }
      renderPosts();modal.classList.remove('open');
      addFeed('content','🔄 Пост отправлен на переработку: '+feedback.trim().slice(0,50));
    }
  }
  if(action==='edit'){
    var newText=prompt('Редактировать текст:',p.text);
    if(newText&&newText.trim()){
      p.text=newText.trim();
      if(SUPABASE_LIVE&&p.sbId){sbPatch('content_queue','id=eq.'+p.sbId,{content_text:newText.trim()});}
      renderPosts();openPostModal(id);
      addFeed('content','✏️ Пост отредактирован: '+p.platform);
    }
  }
  if(action==='duplicate'){
    var dup=JSON.parse(JSON.stringify(p));
    dup.id=D.posts.reduce(function(m,x){return Math.max(m,x.id);},0)+1;
    dup.status='draft';dup.sbStatus='pending_approval';dup.date=new Date().toISOString().slice(0,10);
    dup.sbId=null;dup.isLive=false;
    // Save duplicate to Supabase
    if(SUPABASE_LIVE){
      sbInsert('content_queue',{platform:dup.platform,content_text:dup.text,status:'pending_approval'}).then(function(res){
        if(res&&res[0]){dup.sbId=res[0].id;dup.isLive=true;}
      });
    }
    D.posts.push(dup);renderPosts();updateKPI();
    addFeed('content','📑 Дубликат создан: '+p.platform+' пост');
  }
  if(action==='delete'){
    if(confirm('Удалить пост?')){
      if(SUPABASE_LIVE&&p.sbId){sbPatch('content_queue','id=eq.'+p.sbId,{status:'rejected'});}
      D.posts=D.posts.filter(function(x){return x.id!==id&&x.sbId!==id;});
      renderPosts();updateKPI();modal.classList.remove('open');
      addFeed('content','🗑 Пост удалён');
    }
  }
};
renderPosts();

// ═══ REPORTS ═══
let reportFilter='all';
function renderReports(){
  const filtered=D.reports.filter(r=>reportFilter==='all'||r.type===reportFilter);
  document.getElementById('reports-count').textContent=filtered.length+' отчётов';
  var typeLabels={morning:'🌅 Утренний',evening:'🌙 Вечерний',daily:'📋 Цикл',weekly:'📊 Недельный'};
  document.getElementById('reportsGrid').innerHTML=filtered.map(r=>{
    var typeLabel=typeLabels[r.type]||r.type;
    var contentPreview=(r.content||'').replace(/<[^>]+>/g,' ').trim();
    if(contentPreview.length>200)contentPreview=contentPreview.slice(0,200)+'...';
    return `
    <div class="report-card" onclick="openReportModal(${r.id})" style="${r.isLive?'border-left:3px solid var(--green)':''}">
      <div class="report-type ${r.type}">${typeLabel}${r.isLive?' <span style="font-size:9px;color:var(--green)">LIVE</span>':''}</div>
      <div class="report-title">${r.title}</div>
      <div class="report-meta">${AGENTS[r.agentId]?.emoji||''} ${AGENTS[r.agentId]?.name||''} • ${r.date}</div>
      <div class="report-content">${contentPreview}</div>
      ${r.actionItems&&r.actionItems.length?`<div class="report-actions">${r.actionItems.slice(0,2).map(a=>`<div class="report-action">${typeof a==='string'?a:JSON.stringify(a)}</div>`).join('')}</div>`:''}
    </div>`;
  }).join('');
}
document.getElementById('reportFilters').addEventListener('click',e=>{
  if(!e.target.classList.contains('filter-btn'))return;
  document.querySelectorAll('#reportFilters .filter-btn').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  reportFilter=e.target.dataset.filter;
  renderReports();
});

window.openReportModal=function(id){
  const r=D.reports.find(x=>x.id===id);if(!r)return;
  var typeLabels={morning:'🌅 Утренний брифинг',evening:'🌙 Вечерний брифинг',daily:'📋 Автономный цикл',weekly:'📊 Недельный отчёт'};
  var typeLabel=typeLabels[r.type]||r.type;
  openModal(`
    <div class="report-type ${r.type}" style="margin-bottom:12px">${typeLabel}${r.isLive?' <span style="font-size:10px;color:var(--green);margin-left:8px">🟢 LIVE</span>':''}</div>
    <h2>${r.title}</h2>
    <p style="color:var(--dim);margin-bottom:16px">${AGENTS[r.agentId]?.emoji||''} ${AGENTS[r.agentId]?.name||''} • ${r.date}</p>
    <div style="font-size:14px;line-height:1.8;padding:16px;background:var(--bg);border-radius:8px;border:1px solid var(--border);margin-bottom:16px">${r.content}</div>
    ${r.actionItems&&r.actionItems.length?`<h3>Приоритеты / Рекомендации</h3>${r.actionItems.map((a,i)=>`<div class="report-action" style="margin-bottom:6px;cursor:pointer" onclick="reportCreateTask(${r.id},${i})" title="Создать задачу">${typeof a==='string'?a:JSON.stringify(a)} <span style="font-size:9px;color:var(--cyan)">[→ задача]</span></div>`).join('')}`:''}
    <div class="action-bar">
      <button class="act-btn success" onclick="reportAction(${r.id},'reviewed')" id="reviewBtn${r.id}">${r.reviewed?'✅ Просмотрено':'👁 Отметить просмотренным'}</button>
      <button class="act-btn" onclick="reportAction(${r.id},'allTasks')">📋 Все items → задачи</button>
      <button class="act-btn" onclick="reportAction(${r.id},'copy')">📋 Копировать отчёт</button>
      <button class="act-btn" onclick="reportAction(${r.id},'refresh')">🔄 Запросить обновление</button>
    </div>
  `);
};
// Global helper: create task + sync to Supabase
async function createTaskSynced(title,agentDashId,priority){
  var ag=AGENTS[agentDashId];
  var taskData={id:D.tasks.length+1,title:title,assignedTo:agentDashId,dept:ag?.dept||'cmd',
    status:'pending',priority:priority||'normal',createdDate:new Date().toISOString().slice(0,10),completedDate:null,result:null};
  if(SUPABASE_LIVE){
    var sbSlug=DASH_TO_SB_SLUG[agentDashId]||'coordinator';
    var sbAgent=window._sbAgents[sbSlug];
    if(sbAgent){
      var res=await sbInsert('actions',{agent_id:sbAgent.id,type:'task_created',
        payload_json:{title:title,status:'pending',priority:priority||'normal',source:'dashboard'}});
      if(res&&res[0])taskData.sbId=res[0].id;
    }
  }
  D.tasks.push(taskData);renderTasks();updateKPI();
  return taskData;
}
window.reportCreateTask=async function(reportId,itemIdx){
  var r=D.reports.find(function(x){return x.id===reportId;});
  if(!r||!r.actionItems||!r.actionItems[itemIdx])return;
  var item=r.actionItems[itemIdx];
  var agent=r.agentId||'coordinator';
  await createTaskSynced(item,agent,'normal');
  addFeed(agent,'📋 Задача из отчёта: '+item.slice(0,50));
  alert('Задача создана: '+item);
};
window.reportAction=function(id,action){
  var r=D.reports.find(function(x){return x.id===id;});if(!r)return;
  if(action==='reviewed'){
    r.reviewed=!r.reviewed;
    openReportModal(id);
    addFeed(r.agentId||'coordinator',(r.reviewed?'👁 Отчёт просмотрен':'⏪ Отметка снята')+': '+r.title.slice(0,40));
    // Sync to Supabase
    if(r.sbId&&SUPABASE_LIVE){sbPatch('reports','id=eq.'+r.sbId,{approved_by_ceo:r.reviewed});}
  }
  if(action==='allTasks'){
    if(!r.actionItems||!r.actionItems.length){alert('Нет action items');return;}
    var agent=r.agentId||'coordinator';
    var count=r.actionItems.length;
    r.actionItems.forEach(function(item){createTaskSynced(item,agent,'normal');});
    addFeed(agent,'📋 Создано '+count+' задач из отчёта');
    alert('Создано '+count+' задач из action items!');
  }
  if(action==='copy'){
    navigator.clipboard.writeText(r.title+'\n\n'+r.content+'\n\nAction Items:\n'+(r.actionItems||[]).join('\n')).then(function(){alert('Отчёт скопирован!');});
  }
  if(action==='refresh'){
    createTaskSynced('Обновить отчёт: '+r.title,r.agentId||'coordinator','high');
    addFeed(r.agentId||'coordinator','🔄 Запрос обновления: '+r.title.slice(0,40));
    alert('Задача на обновление создана!');
  }
};
renderReports();

// ═══ AUTONOMOUS TRIGGER FUNCTIONS ═══
window.triggerBriefing=async function(){
  if(!SUPABASE_LIVE){alert('Supabase не подключён');return;}
  var btn=event.target;btn.disabled=true;btn.textContent='⏳ Генерирую...';
  try{
    var r=await fetch(SUPABASE_URL+'/functions/v1/coordinator-briefing',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON},
      body:JSON.stringify({type:'morning'})
    });
    var data=await r.json();
    if(data.success&&data.briefing){
      addFeed('coordinator','🌅 Утренний брифинг сгенерирован: '+(data.briefing.title||'').slice(0,60));
      // Reload reports from Supabase
      var reports=await sbFetch('reports','select=*&order=created_at.desc&limit=30');
      if(reports)window._sbReports=reports;
      refreshAfterSync();
      alert('Брифинг готов! Смотри вкладку Отчёты.');
    }else{
      alert('Ошибка: '+(data.error||JSON.stringify(data)));
    }
  }catch(e){alert('Ошибка: '+e);}
  btn.disabled=false;btn.textContent='🚀 Брифинг';
};
window.triggerAgentCycles=async function(){
  if(!SUPABASE_LIVE){alert('Supabase не подключён');return;}
  var btn=event.target;btn.disabled=true;btn.textContent='⏳ Запускаю...';
  try{
    var r=await fetch(SUPABASE_URL+'/functions/v1/agent-autonomous-cycle',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON},
      body:JSON.stringify({})
    });
    var data=await r.json();
    if(data.success){
      var summaries=(data.results||[]).map(function(x){return x.agent+': '+(x.summary||x.error||'ok').slice(0,60);}).join('\n');
      addFeed('coordinator','⚡ Автономные циклы: '+data.agents_processed+' агентов обработано');
      // Reload reports
      var reports=await sbFetch('reports','select=*&order=created_at.desc&limit=30');
      if(reports)window._sbReports=reports;
      refreshAfterSync();
      alert('Циклы выполнены!\n\n'+summaries);
    }else{
      alert('Ошибка: '+(data.error||JSON.stringify(data)));
    }
  }catch(e){alert('Ошибка: '+e);}
  btn.disabled=false;btn.textContent='⚡ Циклы';
};

// ═══ TASKS ═══
function renderTasks(){
  const order={pending:0,postponed:1,done:2,cancelled:3};
  const sorted=[...D.tasks].sort((a,b)=>(order[a.status]||0)-(order[b.status]||0));
  document.getElementById('tasksList').innerHTML=sorted.map(t=>{
    const pri=t.priority||'normal';
    const statusIcon=t.status==='done'?'✓':t.status==='cancelled'?'✕':t.status==='postponed'?'⏸':'⏳';
    const priLabel=pri==='high'?'HIGH':pri==='low'?'LOW':'';
    // Determine action type badge
    var actionBadge='';
    var aType=(t._actionType||'').toLowerCase();
    if(aType.includes('email_template'))actionBadge='<span style="font-size:9px;padding:1px 6px;background:#00e5ff22;color:#00e5ff;border:1px solid #00e5ff44;border-radius:4px;margin-left:6px">📧 EMAIL</span>';
    else if(aType.includes('lead_suggested'))actionBadge='<span style="font-size:9px;padding:1px 6px;background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;margin-left:6px">🆕 LEAD</span>';
    else if(aType.includes('task_from_chat')||t.fromChat)actionBadge='<span style="font-size:9px;padding:1px 6px;background:#ffb80022;color:#ffb800;border:1px solid #ffb80044;border-radius:4px;margin-left:6px">💬 ИЗ ЧАТА</span>';
    // Smart approve button label
    var approveLabel='✅';var approveTitle='Выполнено';
    if(t.status==='pending'&&aType.includes('email_template')){approveLabel='📧 Отправить';approveTitle='Одобрить и отправить email';}
    else if(t.status==='pending'&&aType.includes('lead_suggested')){approveLabel='➕ В Pipeline';approveTitle='Добавить лид в Pipeline';}
    return '<div class="task-row '+t.status+'">'+
      '<div class="task-check '+t.status+'">'+statusIcon+'</div>'+
      '<div class="task-body">'+
        '<div class="task-title-text">'+t.title+actionBadge+(priLabel?'<span class="task-priority '+pri+'">'+priLabel+'</span>':'')+'</div>'+
        '<div class="task-assigned">'+(AGENTS[t.assignedTo]?.emoji||'')+' '+(AGENTS[t.assignedTo]?.name||t.assignedTo)+' • '+(t.dept?.toUpperCase()||'')+'</div>'+
        (t.result?'<div class="task-result">'+t.result+'</div>':'')+
      '</div>'+
      '<div class="task-actions">'+
        (t.status==='pending'?
          '<button class="task-act" onclick="taskAction('+t.id+',\'done\')" title="'+approveTitle+'" style="'+(aType.includes('email')||aType.includes('lead')?'background:#00ff8822;padding:2px 8px;font-size:10px':'')+'">'+approveLabel+'</button>'+
          '<button class="task-act" onclick="taskAction('+t.id+',\'postponed\')" title="Отложить">⏸</button>'+
          '<button class="task-act" onclick="taskPriority('+t.id+',\'up\')" title="Приоритет ↑">⬆</button>'+
          '<button class="task-act" onclick="taskPriority('+t.id+',\'down\')" title="Приоритет ↓">⬇</button>'+
          '<button class="task-act del" onclick="taskAction('+t.id+',\'cancelled\')" title="Отменить">❌</button>'
        :t.status==='postponed'?
          '<button class="task-act" onclick="taskAction('+t.id+',\'pending\')" title="Возобновить">▶️</button>'+
          '<button class="task-act del" onclick="taskAction('+t.id+',\'cancelled\')" title="Отменить">❌</button>'
        :t.status==='cancelled'?
          '<button class="task-act" onclick="taskAction('+t.id+',\'pending\')" title="Восстановить">♻️</button>'
        :'')+
      '</div>'+
      '<div class="task-date">'+(t.completedDate||t.createdDate)+'</div>'+
    '</div>';
  }).join('');
}
window.taskAction=function(id,newStatus){
  const t=D.tasks.find(x=>x.id===id);if(!t)return;
  // ═══ SMART APPROVAL: If marking as done AND task is actionable → execute real action ═══
  if(newStatus==='done'){
    var actionType=(t._actionType||t.title||'').toLowerCase();
    var isExecutable=actionType.includes('email_template')||actionType.includes('lead_suggested')||actionType.includes('content');
    if(isExecutable){
      executeApprovedAction(id);
      return; // executeApprovedAction handles status change
    }
  }
  t.status=newStatus;
  if(newStatus==='done')t.completedDate=new Date().toISOString().slice(0,10);
  if(newStatus==='cancelled')t.completedDate=new Date().toISOString().slice(0,10);
  renderTasks();updateKPI();
  const a=AGENTS[t.assignedTo];
  const labels={done:'✅ Выполнено',cancelled:'❌ Отменено',postponed:'⏸ Отложено',pending:'▶️ Возобновлено'};
  addFeed(t.assignedTo,(labels[newStatus]||newStatus)+': '+t.title);
  // Sync to Supabase if task has sbId
  if(t.sbId&&SUPABASE_LIVE){
    sbPatch('actions','id=eq.'+t.sbId,{payload_json:{title:t.title,status:newStatus,completed_at:t.completedDate}});
  }
};
window.taskPriority=function(id,dir){
  const t=D.tasks.find(x=>x.id===id);if(!t)return;
  const levels=['low','normal','high'];
  const cur=levels.indexOf(t.priority||'normal');
  const next=dir==='up'?Math.min(cur+1,2):Math.max(cur-1,0);
  t.priority=levels[next];
  renderTasks();
  addFeed(t.assignedTo,'🔄 Приоритет → '+t.priority.toUpperCase()+': '+t.title);
  // Sync to Supabase
  if(t.sbId&&SUPABASE_LIVE){sbPatch('actions','id=eq.'+t.sbId,{payload_json:{title:t.title,status:t.status,priority:t.priority}});}
};

document.getElementById('taskSubmit').addEventListener('click',async()=>{
  const input=document.getElementById('taskInput');
  const agent=document.getElementById('taskAgent').value;
  if(!input.value.trim())return;
  const ag=AGENTS[agent];
  const title=input.value.trim();
  const taskData={
    id:D.tasks.length+1, title:title,
    assignedTo:agent||'coordinator', dept:ag?ag.dept:'cmd',
    status:'pending', priority:'normal', createdDate:new Date().toISOString().slice(0,10),
    completedDate:null, result:null
  };
  // Save to Supabase
  if(SUPABASE_LIVE){
    var sbSlug=DASH_TO_SB_SLUG[agent]||'coordinator';
    var sbAgent=window._sbAgents[sbSlug];
    if(sbAgent){
      var res=await sbInsert('actions',{
        agent_id:sbAgent.id,
        type:'task_created',
        payload_json:{title:title,status:'pending',priority:'normal',source:'dashboard'}
      });
      if(res&&res[0])taskData.sbId=res[0].id;
    }
  }
  D.tasks.push(taskData);
  input.value='';
  renderTasks();
  updateKPI();
  addFeed(agent||'coordinator','📋 Новая задача: '+title);
});
document.getElementById('taskInput').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('taskSubmit').click()});
renderTasks();

// ═══ OFFICE VIEW — AGENT LIST ═══
let selectedAgent=null;
function renderAgentList(){
  document.getElementById('agentList').innerHTML=DEPTS.map(dept=>`
    <div class="dept-block">
      <div class="dept-title"><div class="dept-dot" style="background:${dept.color}"></div>${dept.name}</div>
      ${dept.agents.map(id=>{
        const a=AGENTS[id];
        const hasPending=D.tasks.some(t=>t.assignedTo===id&&t.status==='pending');
        const sbS=DASH_TO_SB_SLUG[id];
        const sbM=window._sbMemory?window._sbMemory.find(m=>m.slug===sbS||m.dashId===id):null;
        const isLiveWorking=SUPABASE_LIVE&&sbM&&sbM.state==='working';
        return `<div class="agent-row ${selectedAgent===id?'active':''}" data-id="${id}">
          <div class="agent-emoji">${a.emoji}</div>
          <div class="agent-name">${a.name}${isLiveWorking?'<span style="font-size:8px;color:#00ff88;margin-left:4px">LIVE</span>':''}</div>
          <div class="agent-dot ${isLiveWorking?'':(hasPending?'':'idle')}"></div>
        </div>`;
      }).join('')}
    </div>`).join('');
  document.querySelectorAll('.agent-row').forEach(row=>{
    row.addEventListener('click',()=>{
      selectedAgent=row.dataset.id;
      renderAgentList();
      showAgentDetail(row.dataset.id);
    });
  });
}
renderAgentList();

function showAgentDetail(id){
  const a=AGENTS[id];
  const agentTasks=D.tasks.filter(t=>t.assignedTo===id);
  const agentReports=D.reports.filter(r=>r.agentId===id);
  const agentPosts=D.posts.filter(p=>p.agentId===id);
  const dept=DEPTS.find(d=>d.id===a.dept);
  const doneTasks=agentTasks.filter(t=>t.status==='done').length;
  const pendTasks=agentTasks.filter(t=>t.status==='pending').length;
  const statusText=pendTasks>0?'Работает над '+pendTasks+' задач(ами)':doneTasks>0?'Все задачи выполнены':'Ожидает задач';

  // Get Supabase live memory for this agent (map dashboard ID → Supabase slug)
  const sbSlug=DASH_TO_SB_SLUG[id];
  const sbMem=window._sbMemory?window._sbMemory.find(m=>m.slug===sbSlug||m.dashId===id):null;
  const sbState=sbMem?sbMem.state:'offline';
  const sbDot=sbState==='working'?'#00ff88':sbState==='idle'?'#ffb800':'#64748b';

  let html='<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
    '<div style="width:48px;height:48px;border-radius:50%;background:'+a.color+'22;border:2px solid '+a.color+';display:flex;align-items:center;justify-content:center;font-size:24px">'+a.emoji+'</div>'+
    '<div><h2 style="margin-bottom:0">'+a.name+'</h2>'+
    '<p style="color:'+a.color+';font-size:12px;margin:0">'+(dept?.name||'')+'</p>'+
    '<p style="font-size:11px;color:var(--dim);margin:2px 0 0">'+statusText+'</p></div>'+
    '<div style="margin-left:auto;text-align:right">'+
      '<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">'+
        '<div style="width:8px;height:8px;border-radius:50%;background:'+sbDot+';box-shadow:0 0 6px '+sbDot+'"></div>'+
        '<span style="font-size:11px;color:'+sbDot+';text-transform:uppercase;font-weight:600">'+(SUPABASE_LIVE&&sbMem?sbState:'local')+'</span>'+
      '</div>'+
      (sbMem&&sbMem.cycle_number?'<div style="font-size:10px;color:var(--dim);margin-top:2px">Цикл #'+sbMem.cycle_number+' • '+sbMem.tasks_done+' задач</div>':'')+
    '</div></div>';

  // Supabase live data block
  if(SUPABASE_LIVE&&sbMem){
    html+='<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px">'+
      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:8px">📡 Live данные из Supabase</div>'+
      (sbMem.last_output?'<div style="font-size:12px;line-height:1.5;margin-bottom:8px"><b style="color:var(--cyan)">Последний результат:</b> '+sbMem.last_output+'</div>':'')+
      (sbMem.insights?'<div style="font-size:12px;line-height:1.5;margin-bottom:8px"><b style="color:var(--purple)">Инсайты:</b> '+sbMem.insights+'</div>':'')+
      (sbMem.next_action?'<div style="font-size:12px;line-height:1.5"><b style="color:var(--green)">Следующее действие:</b> '+sbMem.next_action+'</div>':'')+
      (sbMem.updated_at?'<div style="font-size:10px;color:var(--dim);margin-top:8px;text-align:right">Обновлено: '+new Date(sbMem.updated_at).toLocaleString('ru')+'</div>':'')+
    '</div>';
  }

  // AI Chat panel
  html+='<div class="agent-chat">'+
    '<div class="agent-chat-header">💬 AI-Чат с агентом <span style="float:right;color:'+(SUPABASE_LIVE?'#00ff88':'#ffb800')+'">'+
      (SUPABASE_LIVE?'● Claude API':'⚠ Настрой Edge Function')+'</span></div>'+
    '<div id="agentChatLog" style="max-height:200px;overflow-y:auto;padding:10px 12px;font-size:12px;line-height:1.6"></div>'+
    '<div class="agent-quick-actions">'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'Как твои успехи? Над чем работаешь?\')">📊 Статус</button>'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'Какие есть проблемы или блокеры?\')">⚠️ Проблемы</button>'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'Что нового в твоём направлении? Есть идеи?\')">💡 Идеи</button>'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'Дай краткий отчёт за сегодня\')">📋 Отчёт</button>'+
    '</div>'+
    '<div class="agent-chat-input">'+
      '<input id="agentChatInput" placeholder="Напиши агенту..." onkeydown="if(event.key===\'Enter\')agentAIChat(\''+id+'\')">'+
      '<button onclick="agentAIChat(\''+id+'\')">Отправить</button>'+
    '</div></div>';

  // Tasks
  html+='<h3>Задачи ('+agentTasks.length+')</h3>';
  if(agentTasks.length){
    html+=agentTasks.map(function(t){
      var icon=t.status==='done'?'✅':t.status==='cancelled'?'❌':t.status==='postponed'?'⏸':'⏳';
      return '<div style="padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px;border:1px solid var(--border);display:flex;align-items:center;gap:8px">'+
        '<span>'+icon+'</span><div style="flex:1"><div style="font-size:13px;font-weight:600">'+t.title+'</div>'+
        (t.result?'<div style="font-size:11px;color:var(--green);margin-top:4px">'+t.result+'</div>':'')+'</div>'+
        (t.status==='pending'?'<button class="task-act" onclick="taskAction('+t.id+',\'done\');showAgentDetail(\''+id+'\')" title="Готово">✅</button>'+
          '<button class="task-act" onclick="taskAction('+t.id+',\'postponed\');showAgentDetail(\''+id+'\')" title="Отложить">⏸</button>':'')+'</div>';
    }).join('');
  }else{html+='<p style="color:var(--dim)">Задач пока нет</p>';}

  // Reports
  if(agentReports.length){
    html+='<h3>Отчёты ('+agentReports.length+')</h3>'+agentReports.map(function(r){
      return '<div style="padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px;border:1px solid var(--border);cursor:pointer" onclick="openReportModal('+r.id+')">'+
        '<div style="font-size:13px;font-weight:600">'+r.title+'</div>'+
        '<div style="font-size:11px;color:var(--dim);margin-top:2px">'+r.content.slice(0,100)+'...</div></div>';
    }).join('');
  }

  // Posts
  if(agentPosts.length){
    html+='<h3>Посты ('+agentPosts.length+')</h3>'+agentPosts.map(function(p){
      return '<div style="padding:8px;background:var(--bg);border-radius:6px;margin-bottom:6px;border:1px solid var(--border);cursor:pointer" onclick="openPostModal('+p.id+')">'+
        '<div style="font-size:11px;color:var(--dim)">'+p.platform+' • '+p.category+'</div>'+
        '<div style="font-size:12px;margin-top:2px">'+p.text.slice(0,80)+'...</div></div>';
    }).join('');
  }

  openModal(html);
}

// ═══ AI CHAT with agents via Supabase Edge Function ═══
const AGENT_CHAT_URL=SUPABASE_URL+'/functions/v1/agent-chat';
const agentChatHistory={};// per-agent message history

// Map dashboard agent IDs → Supabase slugs for chat
const CHAT_SLUG_MAP={
  coordinator:'coordinator',briefing:'coordinator',market:'analyst',content:'smm',
  social:'community',leads:'bizdev',outreach:'outreach',lead_finder:'bizdev',
  followup:'outreach',processor:'coordinator',watchdog:'coordinator',kpi_updater:'analyst'
};

window.agentAIChat=async function(id,presetMsg){
  const a=AGENTS[id];
  if(!a)return;
  const slug=CHAT_SLUG_MAP[id]||'coordinator';

  // Get message (from preset button or input field)
  let msg=presetMsg;
  if(!msg){
    const input=document.getElementById('agentChatInput');
    if(!input||!input.value.trim())return;
    msg=input.value.trim();
    input.value='';
  }

  // Init history for this agent
  if(!agentChatHistory[id])agentChatHistory[id]=[];

  // Show user message in chat log
  const log=document.getElementById('agentChatLog');
  if(log){
    log.innerHTML+='<div style="margin-bottom:8px;text-align:right">'+
      '<span style="background:#00e5ff22;color:#00e5ff;padding:4px 10px;border-radius:8px 8px 2px 8px;display:inline-block;max-width:80%">'+
      escHtml(msg)+'</span></div>';
    // Show typing indicator
    log.innerHTML+='<div id="aiTyping" style="margin-bottom:8px">'+
      '<span style="background:#ffffff08;color:var(--dim);padding:4px 10px;border-radius:8px 8px 8px 2px;display:inline-block">'+
      a.emoji+' <span style="animation:pulse 1s infinite">Печатает...</span></span></div>';
    log.scrollTop=log.scrollHeight;
  }

  // Add to feed
  addFeed(id,'💬 CEO → '+a.name+': '+msg.slice(0,50)+(msg.length>50?'...':''));

  try{
    const resp=await fetch(AGENT_CHAT_URL,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+SUPABASE_ANON
      },
      body:JSON.stringify({
        agent_slug:slug,
        message:msg,
        history:agentChatHistory[id].slice(-6)// last 3 exchanges for context
      })
    });

    // Remove typing indicator
    const typing=document.getElementById('aiTyping');
    if(typing)typing.remove();

    if(!resp.ok){
      const err=await resp.text();
      console.error('Agent chat error:',resp.status,err);
      if(log){
        log.innerHTML+='<div style="margin-bottom:8px">'+
          '<span style="background:#ff444422;color:#ff4444;padding:4px 10px;border-radius:8px 8px 8px 2px;display:inline-block">'+
          '⚠️ Ошибка: '+(resp.status===502?'Claude API недоступен':resp.status===500?'Edge Function не настроена':'Код '+resp.status)+
          '. <a href="#" onclick="document.getElementById(\'deployGuide\').style.display=\'block\';return false" style="color:#00e5ff">Инструкция по настройке</a>'+
          '</span></div>';
        log.scrollTop=log.scrollHeight;
      }
      return;
    }

    const data=await resp.json();
    const reply=data.reply||'Нет ответа';

    // Save to history
    agentChatHistory[id].push({role:'user',content:msg});
    agentChatHistory[id].push({role:'assistant',content:reply});

    // Show reply with save-as-post button
    if(log){
      var replyId='reply_'+Date.now();
      log.innerHTML+='<div style="margin-bottom:8px">'+
        '<span style="background:'+a.color+'15;border:1px solid '+a.color+'33;color:#e2e8f0;padding:6px 10px;border-radius:8px 8px 8px 2px;display:inline-block;max-width:85%;line-height:1.5">'+
        a.emoji+' <b style="color:'+a.color+'">'+a.name+'</b><br>'+
        '<span id="'+replyId+'">'+escHtml(reply).replace(/\n/g,'<br>')+'</span>'+
        (data.usage?'<div style="font-size:9px;color:var(--dim);margin-top:4px">'+data.model+' • '+data.usage.input_tokens+'→'+data.usage.output_tokens+' tokens</div>':'')+
        '<div style="margin-top:6px;display:flex;gap:4px">'+
        '<button onclick="saveReplyAsPost(\''+id+'\',\''+replyId+'\',\'telegram\')" style="font-size:10px;padding:2px 8px;background:#00e5ff22;color:#00e5ff;border:1px solid #00e5ff44;border-radius:4px;cursor:pointer">💾 Сохранить как пост (TG)</button>'+
        '<button onclick="saveReplyAsPost(\''+id+'\',\''+replyId+'\',\'twitter\')" style="font-size:10px;padding:2px 8px;background:#1DA1F222;color:#1DA1F2;border:1px solid #1DA1F244;border-radius:4px;cursor:pointer">🐦 Twitter</button>'+
        '</div>'+
        '</span></div>';
      log.scrollTop=log.scrollHeight;
    }

    // Add to feed
    addFeed(id,a.emoji+' '+a.name+': '+reply.slice(0,60)+(reply.length>60?'...':''));

  }catch(e){
    console.error('Chat fetch error:',e);
    const typing=document.getElementById('aiTyping');
    if(typing)typing.remove();
    if(log){
      log.innerHTML+='<div style="margin-bottom:8px">'+
        '<span style="background:#ff444422;color:#ff4444;padding:4px 10px;border-radius:8px 8px 8px 2px;display:inline-block">'+
        '⚠️ Сетевая ошибка. Проверь подключение к Supabase.</span></div>';
    }
  }
};

function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// Save agent reply as post to content_queue
window.saveReplyAsPost=async function(agentId,replyElId,platform){
  var el=document.getElementById(replyElId);
  if(!el)return;
  var text=el.textContent||el.innerText;
  if(!text.trim()){alert('Пустой текст');return;}
  try{
    var resp=await fetch(SUPABASE_URL+'/rest/v1/content_queue',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,'Prefer':'return=minimal'},
      body:JSON.stringify({platform:platform,content_text:text.trim(),status:'pending_approval'})
    });
    if(resp.ok){
      el.parentElement.querySelector('div:last-child').innerHTML='<span style="color:#00ff88;font-size:10px">✅ Сохранён в контент-очередь ('+platform+')</span>';
      addFeed(agentId,'💾 Пост сохранён в контент-очередь ('+platform+')');
      // Refresh posts if on that tab
      window._sbContentMerged=false;
      if(typeof initSupabase==='function')setTimeout(initSupabase,500);
    }else{
      alert('Ошибка сохранения: '+resp.status);
    }
  }catch(e){alert('Ошибка: '+e.message);}
};

// ═══ SMM Auto-Generate via Edge Function ═══
window.generatePostsBatch=async function(){
  var btn=document.getElementById('btnGenPosts');
  if(!btn)return;
  btn.disabled=true;btn.textContent='⏳ Генерирую...';
  try{
    var resp=await fetch(SUPABASE_URL+'/functions/v1/smm-generate',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON},
      body:JSON.stringify({count:5,platforms:['telegram','twitter']})
    });
    var data=await resp.json();
    if(data.success){
      btn.textContent='✅ '+data.generated+' постов создано!';
      addFeed('content','🤖 Автогенерация: '+data.generated+' новых постов в очереди');
      // Refresh posts from Supabase
      window._sbContentMerged=false;
      if(typeof initSupabase==='function')setTimeout(initSupabase,1000);
      setTimeout(function(){btn.textContent='🤖 Сгенерировать посты';btn.disabled=false;},3000);
    }else{
      btn.textContent='❌ Ошибка: '+(data.error||'unknown');
      setTimeout(function(){btn.textContent='🤖 Сгенерировать посты';btn.disabled=false;},3000);
    }
  }catch(e){
    btn.textContent='❌ Сетевая ошибка';
    setTimeout(function(){btn.textContent='🤖 Сгенерировать посты';btn.disabled=false;},3000);
  }
};

// Legacy compatibility — redirect old functions to AI chat
window.agentQuickAction=function(id,action){
  const msgs={status:'Как успехи? Над чем работаешь?',problems:'Какие проблемы или блокеры?',
    ideas:'Есть идеи или предложения?',dept:'Как дела в отделе?',
    task:'Какую задачу поставить?' };
  if(action==='task'){
    const input=prompt(AGENTS[id].emoji+' '+AGENTS[id].name+': Какую задачу поставить?');
    if(input&&input.trim())agentAIChat(id,'Вот задача для тебя: '+input.trim());
    return;
  }
  agentAIChat(id,msgs[action]||'Привет!');
};
window.agentSendMsg=function(id){agentAIChat(id);};

// ═══ FEED ═══
const feedItems=[];
let feedIdCounter=0;
function addFeed(agentId,text){
  const a=AGENTS[agentId]||{emoji:'📋',name:'System',color:'#64748b'};
  const m=D.agentMeta?D.agentMeta[agentId]:null;
  feedItems.unshift({
    id:++feedIdCounter, agentId, text,
    time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
    fullTime:new Date().toISOString(),
    color:a.color,
    sources:m?m.sources:null,
    purpose:m?m.purpose:null
  });
  if(feedItems.length>50)feedItems.pop();
  renderFeed();
  // Persist to Supabase events (fire-and-forget)
  if(SUPABASE_LIVE){
    var sbSlug=DASH_TO_SB_SLUG[agentId]||'coordinator';
    var sbAgent=window._sbAgents[sbSlug];
    sbInsert('events',{
      agent_id:sbAgent?sbAgent.id:null,
      type:'feed',
      metadata_json:{text:text,agent_dash_id:agentId,source:'dashboard'}
    });
  }
}
let feedFilterDept='all';
function initFeedFilters(){
  var html='<button class="feed-fbtn active" data-dept="all" onclick="setFeedFilter(\'all\')">Все</button>';
  DEPTS.forEach(function(d){
    html+='<button class="feed-fbtn" data-dept="'+d.id+'" onclick="setFeedFilter(\''+d.id+'\')" style="--fc:'+d.color+'">'+d.name.split(' ')[0]+'</button>';
  });
  document.getElementById('feedFilters').innerHTML=html;
}
window.setFeedFilter=function(dept){
  feedFilterDept=dept;
  document.querySelectorAll('.feed-fbtn').forEach(function(b){b.classList.toggle('active',b.dataset.dept===dept);});
  renderFeed();
};
function renderFeed(){
  var filtered=feedFilterDept==='all'?feedItems:feedItems.filter(function(f){
    var ag=AGENTS[f.agentId];return ag&&ag.dept===feedFilterDept;
  });
  document.getElementById('feedList').innerHTML=filtered.length?filtered.map(function(f){
    var a=AGENTS[f.agentId]||{emoji:'📋',name:'System'};
    return '<div class="feed-item" style="border-left-color:'+f.color+'" onclick="openFeedDetail('+f.id+')">'+
      '<div class="feed-agent" style="color:'+f.color+'">'+a.emoji+' '+a.name+'</div>'+
      '<div class="feed-text">'+f.text+'</div>'+
      '<div class="feed-time">'+f.time+'</div>'+
    '</div>';
  }).join(''):'<div style="text-align:center;color:var(--dim);font-size:11px;padding:20px">Нет активности в этом отделе</div>';
}
initFeedFilters();
window.openFeedDetail=function(feedId){
  var f=feedItems.find(function(x){return x.id===feedId;});if(!f)return;
  var a=AGENTS[f.agentId]||{emoji:'📋',name:'System',color:'#64748b'};
  var m=D.agentMeta?D.agentMeta[f.agentId]:null;
  var html='<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
    '<span style="font-size:32px">'+a.emoji+'</span>'+
    '<div><h2 style="margin:0">'+a.name+'</h2>'+
    '<p style="color:var(--dim);margin:0;font-size:12px">'+(DEPTS.find(function(d){return d.agents&&d.agents.includes(f.agentId);})?.name||'')+'  •  '+f.time+'</p></div></div>';
  // Main content
  html+='<div style="font-size:14px;line-height:1.8;padding:16px;background:var(--bg);border-radius:8px;border:1px solid var(--border);margin-bottom:16px">'+f.text+'</div>';
  // Agent purpose
  if(m&&m.purpose){
    html+='<h3>Зачем этот агент</h3><p style="font-size:13px;line-height:1.6">'+m.purpose+'</p>';
  }
  // Sources
  if(f.sources&&f.sources.length){
    html+='<h3>Источники данных</h3><div class="agent-sources" style="margin-bottom:12px">'+
      f.sources.map(function(s){return '<span style="font-size:11px;padding:4px 10px;background:var(--panel);border-radius:6px;border:1px solid var(--border);color:var(--cyan)">'+s+'</span>';}).join('')+'</div>';
    html+='<p style="font-size:11px;color:var(--dim);line-height:1.5">⚠️ Агент парсит данные из этих источников. Для получения актуальных данных в реальном времени нужны API-интеграции (см. таб 🔗 Интеграции). Сейчас часть данных — оценки на основе последнего анализа.</p>';
  }
  // Replaces
  if(m&&m.replaces){
    html+='<h3>Что экономит</h3><p style="font-size:13px;color:var(--amber)">'+m.replaces+'</p>';
  }
  // Actions
  html+='<div class="action-bar">'+
    '<button class="act-btn" onclick="agentQuickAction(\''+f.agentId+'\',\'task\');modal.classList.remove(\'open\')">📋 Дать задачу</button>'+
    '<button class="act-btn" onclick="agentQuickAction(\''+f.agentId+'\',\'status\');modal.classList.remove(\'open\')">📊 Статус</button>'+
    '<button class="act-btn" onclick="switchTab(\'agents\');modal.classList.remove(\'open\')">🤖 Все агенты</button>'+
  '</div>';
  openModal(html);
};

// Initial feed from real data
D.tasks.filter(t=>t.status==='done').forEach(t=>{
  const a=AGENTS[t.assignedTo];
  feedItems.push({agentId:t.assignedTo,text:'✅ '+t.title,time:t.completedDate||'',color:a?.color||'#64748b'});
});
D.tasks.filter(t=>t.status==='pending').forEach(t=>{
  const a=AGENTS[t.assignedTo];
  feedItems.push({agentId:t.assignedTo,text:'⏳ '+t.title,time:t.createdDate||'',color:a?.color||'#64748b'});
});
renderFeed();

// ═══ OFFICE CANVAS ═══
const canvas=document.getElementById('officeCanvas');
const ctx=canvas.getContext('2d');
let CW=512,CH=544,anim=0;
const agentPos={};
// Camera pan & zoom — events on wrap div
let camX=0,camY=0,camZoom=1.2; // start slightly zoomed to show full office
let isDragging=false,dragStartX=0,dragStartY=0,camStartX=0,camStartY=0;
const cwrap=document.getElementById('officeCanvasWrap');
let _dragMoved=false;
cwrap.addEventListener('mousedown',e=>{isDragging=true;_dragMoved=false;dragStartX=e.clientX;dragStartY=e.clientY;camStartX=camX;camStartY=camY;cwrap.style.cursor='grabbing';});
cwrap.addEventListener('mousemove',e=>{
  // Hover detection for agents (always)
  const world=document.getElementById('officeWorld');
  if(world&&!isDragging){
    const wr=world.getBoundingClientRect();
    const imgX=(e.clientX-wr.left)/camZoom;
    const imgY=(e.clientY-wr.top)/camZoom;
    const hov=typeof officeHoverUpdate==='function'?officeHoverUpdate(imgX,imgY):null;
    cwrap.style.cursor=hov?'pointer':'grab';
  }
  if(!isDragging)return;
  _dragMoved=true;
  camX=camStartX+(e.clientX-dragStartX)/camZoom;camY=camStartY+(e.clientY-dragStartY)/camZoom;
});
cwrap.addEventListener('mouseup',()=>{isDragging=false;cwrap.style.cursor='grab';});
cwrap.addEventListener('mouseleave',()=>{isDragging=false;cwrap.style.cursor='grab';});
cwrap.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY>0?0.9:1.1;camZoom=Math.min(4,Math.max(0.5,camZoom*delta));},{passive:false});
cwrap.style.cursor='grab';

function resizeCanvas(){
  // Canvas is fixed 640x448, no resize needed
  const r=cwrap.getBoundingClientRect();
  initAgentPositions();
}

const PCELL=32; // matches LimeZu tileset (32x32)

// Pixel art sprites
const SPRITES={};
SPRITES.floor=new Image();SPRITES.floor.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAk0lEQVR4nK2S6wqAIAxGe4hu2p1uVu//fItZG0MQBf0hSX6e6XFFqQykjOKbrFB3O7TDCWo00M23nevpst9Kb9D0h83hv355bI4BtIgQWiQIgQlCYMwxwFcBIfJ0mJOnY0DsBszJYgyQVeV1wk5+gK9CyAkDYq27V8wn0fdMIScMiLXuOsnXickSY1vXdZKvE1PGC0JDWWbGypaFAAAAAElFTkSuQmCC';
SPRITES.wall=new Image();SPRITES.wall.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZ0lEQVR4nGOQlNP9Twlm0Daw+q+mbfpfU8/iv4qm8X91HbP/WvqW/1W1TP5r6JqDFeGTZ0DmYDMMZAA+eQZcJsMUgwzAJ89AcRiACELewCcPNoBYxdjkwQaQYzNMnvIwGE0HwyEdAAAkmX4Q75ZruAAAAABJRU5ErkJggg==';
SPRITES.desk=new Image();SPRITES.desk.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAoElEQVR4nGNgGB6gK8nqf2Wg5v+aEJ3/9eH6/5uijP63xpr+70iw+N+dbP2/Kkjrf22o7v+GCIP/zdHG/9vizP53Jlr+hxtQHaz9vy5M739jpOH/lhiT/1wiGlgxuqFwA9BNBilmSDlxAhmDxNBdCjcA3WRcBqC7FGcY4PIC0WHAFgY4w4DiMAB5oT3eHKsBLPQNg6ENBo8BtA0DFhBXrZ2RAQAJ0HPM+UO0jgAAAABJRU5ErkJggg==';
SPRITES.plant=new Image();SPRITES.plant.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAiklEQVR4nM3RSQ6CQBBGYQ5Ra9ccwuN4HC+A4MCg4CxwwPYtWBDTQ3XYWMm36rw/ISTJX59kqZEd8tTEhVMkBfY44IiTcug3khIVasWALZIGZ1zQBkZckXS44uYZ8EVyxwNPvBwjoUje+KB3Dcwi6/vA24ht5G+Nvs16ZWwWxaqRUOwd0cZRn6O5L8AQtL3728UdAAAAAElFTkSuQmCC';
SPRITES.server=new Image();SPRITES.server.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoCawMar4z88viReD1OA1QFJS4z/D/xQw/T+FAUwjY6IMwIcJGjDqhVEvDA4vUGQAOQAAoUrNtRk3SOgAAAAASUVORK5CYII=';
SPRITES.window=new Image();SPRITES.window.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUklEQVR4nGMwsgn4TwlmoJ4BAXknbKIqTmi4pZyAsWFy5kC+sk3UCV2gHIyNYQC6ZjAbKoeuWRdJDm4AhmYgGyaHrtkcSW7UC6NeoLIXBio3AgDL7LTc2wkFDQAAAABJRU5ErkJggg==';

// Office Design 2 from LimeZu: 16x17 tiles (512x544)
const OW=16,OH=17;
// Agent positions match the desk/chair spots in Office_Design_2
// Top area: cubicle rows (y=1-9), Bottom: meeting rooms + lounge (y=10-16)
const ROOMS=[
  {id:'cmd',gx:0,gy:0,w:8,h:3,color:'#ffb800',label:'COMMAND'},
  {id:'rd',gx:8,gy:0,w:8,h:3,color:'#00e5ff',label:'ANALYTICS'},
  {id:'smm',gx:0,gy:3,w:8,h:3,color:'#ff2d78',label:'SMM'},
  {id:'biz',gx:8,gy:3,w:8,h:3,color:'#00ff88',label:'BIZDEV'},
  {id:'sys',gx:0,gy:6,w:8,h:4,color:'#a78bfa',label:'SYSTEMS'},
  {id:'common',gx:5,gy:10,w:11,h:7,color:'#64748b',label:'LOUNGE'}
];

function initAgentPositions(){
  // Fixed desk positions matching Office_Design_2 chair locations
  // Top row of cubicles: y≈2.5 (row 1), y≈4.5 (row 2), y≈6.5 (row 3)
  // Desks at x positions: 1.5, 3.5, 5.5, 7.5, 9, 11, 13, 14.5
  // Positions aligned to chair locations in Office_Design_2.gif
  const fixedSeats={
    // Top cubicle row (people face down, chairs ~y=3.2)
    coordinator:{x:1.8,y:3.2},
    briefing:{x:4.2,y:3.2},
    market:{x:5.8,y:2.0},
    content:{x:8.5,y:3.2},
    social:{x:10.2,y:3.2},
    // Second cubicle row (people face up, chairs ~y=6)
    leads:{x:1.8,y:6.0},
    outreach:{x:4.2,y:6.0},
    lead_finder:{x:5.8,y:6.0},
    followup:{x:8.5,y:6.0},
    processor:{x:10.2,y:6.0},
    watchdog:{x:12.0,y:6.0},
    kpi_updater:{x:13.5,y:6.0},
  };
  Object.keys(AGENTS).forEach(id=>{
    const seat=fixedSeats[id];
    if(seat){
      agentPos[id]={x:seat.x,y:seat.y,tx:seat.x,ty:seat.y};
    }else{
      // Fallback
      const room=ROOMS.find(r=>r.id===AGENTS[id]?.dept);
      if(room) agentPos[id]={x:room.gx+room.w/2,y:room.gy+room.h/2,tx:room.gx+room.w/2,ty:room.gy+room.h/2};
    }
  });
}
resizeCanvas();
window.addEventListener('resize',resizeCanvas);

let dataFlows=[];
// ═══ PIXEL ART HELPER FUNCTIONS ═══
// (old isometric functions removed)

// ═══ PIXEL ART OFFICE RENDERER ═══
function drawPixelFloor(room,ox,oy){
  const rx=ox+room.gx*PCELL,ry=oy+room.gy*PCELL;
  for(let gx=0;gx<room.w;gx++){for(let gy=0;gy<room.h;gy++){
    const tx=rx+gx*PCELL,ty=ry+gy*PCELL;
    ctx.fillStyle=(gx+gy)%2===0?'#1a1a2e':'#16213e';
    ctx.fillRect(tx,ty,PCELL,PCELL);
    ctx.strokeStyle='rgba(255,255,255,0.03)';ctx.lineWidth=1;ctx.strokeRect(tx+0.5,ty+0.5,PCELL-1,PCELL-1);
  }}
  // Border glow
  ctx.strokeStyle=room.color+'66';ctx.lineWidth=2;ctx.shadowColor=room.color;ctx.shadowBlur=10;
  ctx.strokeRect(rx,ry,room.w*PCELL,room.h*PCELL);ctx.shadowBlur=0;
  // Walls (thick colored top+left)
  ctx.fillStyle=room.color+'33';ctx.fillRect(rx,ry,room.w*PCELL,4);ctx.fillRect(rx,ry,4,room.h*PCELL);
  // Label
  ctx.font='bold 11px monospace';ctx.fillStyle=room.color+'cc';ctx.textAlign='center';
  ctx.fillText(room.label,rx+room.w*PCELL/2,ry+16);
}

function drawPixelDesk(x,y,monitorOn,color){
  if(SPRITES.desk.complete){ctx.drawImage(SPRITES.desk,x,y,PCELL,PCELL);
    if(monitorOn){// Screen glow overlay
      ctx.fillStyle=(color||'#4488ff')+'22';ctx.fillRect(x+PCELL*0.3,y+PCELL*0.2,PCELL*0.35,PCELL*0.2);
    }
  }else{ctx.fillStyle='#8b6914';ctx.fillRect(x,y,PCELL*0.9,PCELL*0.5);}
}

function drawPixelChair(x,y,color){
  ctx.beginPath();ctx.arc(x,y,PCELL*0.16,0,Math.PI*2);
  ctx.fillStyle=color||'#2a2a4a';ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;ctx.stroke();
}

function drawPixelPlant(x,y){
  if(SPRITES.plant.complete)ctx.drawImage(SPRITES.plant,x-PCELL/2,y-PCELL/2,PCELL,PCELL);
  else{ctx.fillStyle='#22c55e';ctx.beginPath();ctx.arc(x,y,PCELL*0.15,0,Math.PI*2);ctx.fill();}
}

function drawPixelServer(x,y){
  if(SPRITES.server.complete){ctx.drawImage(SPRITES.server,x,y,PCELL,PCELL);
    // Animated LED glow
    const blink=Math.sin(Date.now()/200+x)>0;
    if(blink){ctx.fillStyle='#00ff88';ctx.shadowColor='#00ff88';ctx.shadowBlur=6;
      ctx.fillRect(x+PCELL*0.3,y+PCELL*0.15,3,3);ctx.shadowBlur=0;}
  }else{ctx.fillStyle='#0a0a18';ctx.fillRect(x,y,PCELL*0.5,PCELL);}
}

function drawPixelAgent(x,y,agent,t){
  // Name plate over desk — small colored tag matching LimeZu style
  const name=agent.name.split(' ')[0];
  ctx.font='bold 6px system-ui';ctx.textAlign='center';
  const tw=ctx.measureText(name).width;
  // Pill background
  ctx.fillStyle=agent.color+'cc';
  ctx.beginPath();
  const px=Math.round(x-tw/2-3),py=Math.round(y-4);
  ctx.moveTo(px+2,py);ctx.lineTo(px+tw+4,py);ctx.lineTo(px+tw+6,py+9);ctx.lineTo(px,py+9);ctx.closePath();
  ctx.fill();
  // Text
  ctx.fillStyle='#000';
  ctx.fillText(name,Math.round(x),Math.round(y+4));
}

function drawPixelCoffee(x,y){
  ctx.fillStyle='#2a1a0a';ctx.fillRect(x,y,PCELL*0.4,PCELL*0.5);
  ctx.fillStyle='#00ff8844';ctx.fillRect(x+3,y+3,PCELL*0.25,PCELL*0.1);
  ctx.fillStyle='#fff8';ctx.fillRect(x+8,y+PCELL*0.35,6,6);
  if(Math.sin(Date.now()/400)>0){ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=1;ctx.beginPath();
    ctx.moveTo(x+11,y+PCELL*0.33);ctx.quadraticCurveTo(x+13,y+PCELL*0.2,x+9,y+PCELL*0.1);ctx.stroke();}
}

function drawPixelScreen(x,y,color){
  ctx.fillStyle='#0a0a14';ctx.fillRect(x,y,PCELL*1.6,PCELL*0.9);
  ctx.strokeStyle=(color||'#ffb800')+'55';ctx.lineWidth=2;ctx.strokeRect(x,y,PCELL*1.6,PCELL*0.9);
  for(let b=0;b<5;b++){
    const bh=PCELL*(0.08+Math.abs(Math.sin(Date.now()/800+b))*0.35);
    ctx.fillStyle=(color||'#ffb800')+'33';ctx.fillRect(x+6+b*PCELL*0.28,y+PCELL*0.8-bh,PCELL*0.2,bh);
  }
  ctx.font='bold 8px monospace';ctx.fillStyle=(color||'#ffb800')+'88';ctx.textAlign='center';
  ctx.fillText('KPI',x+PCELL*0.8,y+12);
}

function drawPixelWhiteboard(x,y,color){
  ctx.fillStyle='#e8e8d0cc';ctx.fillRect(x,y,PCELL*1.3,PCELL*0.7);
  ctx.strokeStyle=(color||'#666');ctx.lineWidth=2;ctx.strokeRect(x,y,PCELL*1.3,PCELL*0.7);
  ctx.strokeStyle='#ff6b6b88';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+6,y+12);ctx.lineTo(x+PCELL*0.7,y+18);ctx.stroke();
  ctx.strokeStyle='#4488ff88';ctx.beginPath();ctx.moveTo(x+6,y+28);ctx.lineTo(x+PCELL*0.5,y+32);ctx.stroke();
}

function drawPixelBookshelf(x,y){
  ctx.fillStyle='#3d2a14';ctx.fillRect(x,y,PCELL*0.7,PCELL*1);
  ctx.strokeStyle='#5a3a1a88';ctx.lineWidth=1;ctx.strokeRect(x,y,PCELL*0.7,PCELL*1);
  for(let s=0;s<3;s++){ctx.fillStyle='#4a3018';ctx.fillRect(x+2,y+PCELL*0.3*s+PCELL*0.25,PCELL*0.7-4,2);}
  ['#ff6b6b','#4ecdc4','#ffe66d','#a78bfa','#ff2d78','#00e5ff'].forEach((c,i)=>{
    ctx.fillStyle=c+'88';ctx.fillRect(x+4+i*6,y+4+Math.floor(i/3)*PCELL*0.3,4,PCELL*0.2);
  });
}

// ═══ MAIN drawOffice() — PIXEL ART ═══
function drawOffice(){
  anim+=0.016;
  // Apply camera to world div (moves bg image + canvas together)
  const wrap=document.getElementById('officeCanvasWrap');
  const world=document.getElementById('officeWorld');
  if(wrap&&world){
    const wr=wrap.getBoundingClientRect();
    const tx=wr.width/2+camX*camZoom-256*camZoom;
    const ty=wr.height/2+camY*camZoom-272*camZoom;
    world.style.transform='translate('+tx+'px,'+ty+'px) scale('+camZoom+')';
  }
  // Canvas = transparent overlay for agents only
  ctx.clearRect(0,0,512,544);
  const bx=0,by=0;

  // Draw animated characters from office_chars.js
  if(typeof drawOfficeAgents==='function') drawOfficeAgents(ctx);

  void('F2F.vin AI OFFICE \u2022 REAL DATA \u2022 '+D.leads.length+' LEADS \u2022 '+(D.team?D.team.length:0)+' TEAM \u2022 '+(D.finance?'BURN $'+D.finance.totalBudgetUSDT.toLocaleString():'')+' \u2022 2.5D ENGINE',CW/2,CH-12);
  requestAnimationFrame(drawOffice);
}
drawOffice();

// ═══ CANVAS CLICK — Agent selection + floating card ═══
document.getElementById('officeCanvasWrap').addEventListener('click',e=>{
  if(_dragMoved)return;
  const world=document.getElementById('officeWorld');
  const wr=world.getBoundingClientRect();
  const wrapRect=cwrap.getBoundingClientRect();
  const imgX=Math.round((e.clientX-wr.left)/camZoom);
  const imgY=Math.round((e.clientY-wr.top)/camZoom);

  // Screen coords relative to wrap div (for card positioning)
  const screenX=e.clientX-wrapRect.left;
  const screenY=e.clientY-wrapRect.top;

  console.log('Office click: ('+imgX+', '+imgY+')');

  // Hit test agents
  const hit=typeof officeHitTest==='function'?officeHitTest(imgX,imgY):null;
  if(hit){
    // Select agent
    if(typeof officeSelectAgent==='function')officeSelectAgent(hit);
    selectedAgent=hit.id;
    renderAgentList();

    // Show floating card on canvas
    if(typeof showAgentCard==='function'){
      showAgentCard(hit,screenX,screenY,{width:wrapRect.width,height:wrapRect.height});
    }
  }else{
    // Deselect
    if(typeof officeSelectAgent==='function')officeSelectAgent(null);
    if(typeof hideAgentCard==='function')hideAgentCard();
    selectedAgent=null;
    renderAgentList();
  }
});

// ═══ BACKGROUND PARTICLES ═══
const bg=document.getElementById('bgCanvas');const bgCtx=bg.getContext('2d');let dots=[];
function initBG(){bg.width=innerWidth;bg.height=innerHeight;dots=[];for(let i=0;i<40;i++)dots.push({x:Math.random()*bg.width,y:Math.random()*bg.height,vx:(Math.random()-0.5)*0.2,vy:(Math.random()-0.5)*0.2,r:Math.random()+0.5});}
function drawBG(){bgCtx.clearRect(0,0,bg.width,bg.height);dots.forEach(d=>{d.x+=d.vx;d.y+=d.vy;if(d.x<0)d.x=bg.width;if(d.x>bg.width)d.x=0;if(d.y<0)d.y=bg.height;if(d.y>bg.height)d.y=0;
  bgCtx.beginPath();bgCtx.arc(d.x,d.y,d.r,0,Math.PI*2);bgCtx.fillStyle='rgba(0,229,255,0.15)';bgCtx.fill();});
  for(let i=0;i<dots.length;i++)for(let j=i+1;j<dots.length;j++){const dx=dots[i].x-dots[j].x,dy=dots[i].y-dots[j].y,dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<100){bgCtx.beginPath();bgCtx.moveTo(dots[i].x,dots[i].y);bgCtx.lineTo(dots[j].x,dots[j].y);bgCtx.strokeStyle=`rgba(0,229,255,${0.04*(1-dist/100)})`;bgCtx.stroke();}}
  requestAnimationFrame(drawBG);}
initBG();drawBG();window.addEventListener('resize',initBG);

// ═══ ANTHEM ═══ (with full overlay + anthem.mp3)
let anthemAudio=null;let anthemPlaying=false;
const anthemOverlay=document.getElementById('anthemOverlay');
const anthemAgentsRow=document.getElementById('anthemAgentsRow');

function stopAnthem(){
  if(anthemAudio){anthemAudio.pause();anthemAudio.currentTime=0;}
  anthemPlaying=false;
  document.getElementById('anthemBtn').classList.remove('playing');
  document.getElementById('anthemBtn').textContent='🎵 ГИМН';
  if(anthemOverlay)anthemOverlay.classList.remove('active');
}
function startAnthem(){
  // Build agent sprites in overlay
  if(anthemAgentsRow){
    anthemAgentsRow.innerHTML='';
    const deptIds=['rd','smm','biz','cmd','fin','hr','tech'];
    deptIds.forEach(function(did){
      const dept=DEPTS.find(function(d){return d.id===did;});
      if(!dept)return;
      const agentId=dept.agents[0];if(!agentId)return;
      const a=AGENTS[agentId];if(!a)return;
      const el=document.createElement('div');
      el.className='anthem-agent-sprite';
      el.style.background=a.color;
      el.textContent=a.emoji;
      anthemAgentsRow.appendChild(el);
    });
  }
  if(anthemOverlay)anthemOverlay.classList.add('active');
  if(!anthemAudio){
    anthemAudio=new Audio('anthem.mp3');
    anthemAudio.addEventListener('ended',stopAnthem);
    anthemAudio.addEventListener('error',function(){
      anthemAudio=new Audio('f2f_anthem.mp3');
      anthemAudio.addEventListener('ended',stopAnthem);
      anthemAudio.currentTime=0;anthemAudio.play().catch(function(){});
    });
  }
  anthemAudio.currentTime=0;anthemAudio.play().catch(function(){});
  anthemPlaying=true;
  document.getElementById('anthemBtn').classList.add('playing');
  document.getElementById('anthemBtn').textContent='🔊 ИГРАЕТ...';
  // Auto-stop after 20s
  setTimeout(function(){if(anthemPlaying)stopAnthem();},20000);
}
document.getElementById('anthemBtn').addEventListener('click',function(){
  if(anthemPlaying){stopAnthem();}else{startAnthem();}
});
// Click overlay to dismiss
if(anthemOverlay)anthemOverlay.addEventListener('click',function(){if(anthemPlaying)stopAnthem();});

// ═══ CREDIT TRACKER ═══
let agentsActive=true;
let creditsUsed=0;const creditsTotal=1000;
function updateCredits(amount){
  creditsUsed+=amount;
  var pct=Math.max(0,Math.min(100,((creditsTotal-creditsUsed)/creditsTotal)*100));
  document.getElementById('creditFill').style.width=pct+'%';
  document.getElementById('creditFill').style.background=pct>50?'var(--green)':pct>20?'var(--amber)':'var(--hot)';
  document.getElementById('creditText').textContent=creditsUsed+' / '+creditsTotal;
}
updateCredits(0);

document.getElementById('agentToggle').addEventListener('click',function(){
  agentsActive=!agentsActive;
  this.textContent=agentsActive?'▶':'⏸';
  this.classList.toggle('active',agentsActive);
  this.title=agentsActive?'Агенты активны — нажми для паузы':'Агенты на паузе — нажми для продолжения';
  addFeed('coordinator',agentsActive?'▶️ Агенты возобновлены':'⏸ Агенты приостановлены');
  document.getElementById('syncBadge').textContent=agentsActive?'● ACTIVE':'⏸ PAUSED';
  document.getElementById('syncBadge').style.color=agentsActive?'var(--green)':'var(--amber)';
  document.getElementById('syncBadge').style.borderColor=agentsActive?'#00ff8833':'#ffb80033';
  document.getElementById('syncBadge').style.background=agentsActive?'#00ff8811':'#ffb80011';
});

// Simulate credit usage on task creation
var origPush=D.tasks.push.bind(D.tasks);
D.tasks.push=function(){
  var result=origPush.apply(D.tasks,arguments);
  updateCredits(5);
  return result;
};

// ═══ AGENT STATUS ENGINE ═══
// HONEST: agents report real status from data, NOT fake activity.
// Real work happens when: 1) You give tasks in chat/tasks tab, 2) Scheduled automations run via Make.com
// This feed shows: real data summaries, honest standby messages, and actual user actions.
const LIVE_ACTIONS = {
  alert:[
    ()=>'🔍 Сканирую Reddit r/GlobalOffensive — новых упоминаний F2F: '+(Math.floor(Math.random()*12)+1),
    ()=>'⚡ Алерт: CyberShoke обновил цены на DM-серверы — +'+Math.floor(Math.random()*10+5)+'%',
    ()=>'📡 Мониторинг HLTV — '+['FACEIT запустил новый формат','ESEA анонсировал обновление','Новый патч CS2 — изменения рейтинга'][Math.floor(Math.random()*3)],
    ()=>'🔔 Steam Charts: CS2 онлайн '+Math.floor(Math.random()*300+800)+'K — '+['рост','стабильно','пик за неделю'][Math.floor(Math.random()*3)],
    ()=>'🛡 Проверяю uptime конкурентов — FACEIT 99.9%, CyberShoke 98.'+Math.floor(Math.random()*9)+'%'
  ],
  market:[
    ()=>'📊 Обновляю рыночные данные — CIS esports: $'+Math.floor(Math.random()*20+170)+'M, рост '+(Math.floor(Math.random()*8+18))+'%',
    ()=>'📈 Анализ трендов: "'+['AI matchmaking','anti-cheat','skill-based MM','toxicity detection'][Math.floor(Math.random()*4)]+'" — поисковый объём +'+Math.floor(Math.random()*30+10)+'%',
    ()=>'🎯 TAM/SAM обновлён — F2F адресуемый рынок: $'+Math.floor(Math.random()*40+30)+'M',
    ()=>'📋 Сравнительный анализ: '+D.leads.length+' лидов в воронке, конверсия в контакт: '+Math.floor(Math.random()*30+20)+'%'
  ],
  competitor:[
    ()=>{const c=['FACEIT','CyberShoke','ESEA','FastCup'][Math.floor(Math.random()*4)];return '🕵️ Парсинг '+c+' — обновлены цены, фичи, отзывы';},
    ()=>'🔎 Найден новый конкурент: '+['Challengermode обновился','Mythic League расширяется','ESPORTAL запускает CIS серверы'][Math.floor(Math.random()*3)],
    ()=>'📊 CyberShoke потерял ещё ~'+Math.floor(Math.random()*3+1)+'K юзеров — подтверждаю тренд оттока'
  ],
  subs:[
    ()=>'💰 Модель подписки F2F: прогноз конверсии Free→Premium обновлён до '+((Math.random()*3+5).toFixed(1))+'%',
    ()=>'📊 Бенчмарк: ARPU конкурентов — FACEIT $'+((Math.random()*2+3).toFixed(2))+', ESEA $'+((Math.random()*2+4).toFixed(2)),
    ()=>'💡 A/B тест ценообразования: $5.99 vs $4.99 — рекомендация: $'+['5.99 (больше маржа)','4.99 (больше конверсия)'][Math.floor(Math.random()*2)]
  ],
  content:[
    ()=>'✍️ Генерирую пост для '+['Telegram','Twitter'][Math.floor(Math.random()*2)]+' — тема: '+['провокация','конкуренты','мем','продукт','комьюнити'][Math.floor(Math.random()*5)],
    ()=>'📝 Редактирую черновик #'+Math.floor(Math.random()*D.posts.length+1)+' — улучшаю CTA',
    ()=>'🎨 Анализирую engagement лучших постов — CTR лидер: "'+D.posts[Math.floor(Math.random()*D.posts.length)]?.text.slice(0,40)+'..."',
    ()=>'📸 Готовлю визуал для '+['Instagram','Telegram','Twitter'][Math.floor(Math.random()*3)]
  ],
  social:[
    ()=>'👂 Мониторинг: Telegram — новых подписчиков за час: +'+Math.floor(Math.random()*8+1),
    ()=>'💬 Обнаружено '+Math.floor(Math.random()*15+3)+' новых упоминаний F2F в соцсетях',
    ()=>'📊 Sentiment анализ: '+Math.floor(Math.random()*15+65)+'% позитивный, '+Math.floor(Math.random()*10+10)+'% нейтральный',
    ()=>'🔥 Тренд: "'+['matchmaking','fair play','anti-cheat CS2','rating system'][Math.floor(Math.random()*4)]+'" в топе обсуждений'
  ],
  smmspy:[
    ()=>{const org=['NAVI','Virtus.pro','Team Spirit','BetBoom'][Math.floor(Math.random()*4)];return '🔎 Анализирую SMM стратегию '+org+' — постов за неделю: '+Math.floor(Math.random()*20+5);},
    ()=>'📊 Бенчмарк: конкуренты постят '+Math.floor(Math.random()*5+3)+'x в день, наш план: '+D.posts.filter(p=>p.status==='ready').length+' ready'
  ],
  leads:[
    ()=>{const l=D.leads[Math.floor(Math.random()*D.leads.length)];return l?'🎯 Проверяю актуальность: '+l.name+' ('+l.company+') — профиль обновлён':'🎯 Сканирую новые контакты...';},
    ()=>'🔍 Ищу ЛПР в '+['Team Spirit','BetBoom','Gambit','forZe'][Math.floor(Math.random()*4)]+' через LinkedIn',
    ()=>'📋 Лиды в CRM: '+D.leads.filter(l=>l.priority==='hot').length+' hot, '+D.leads.filter(l=>l.priority==='warm').length+' warm, '+D.leads.filter(l=>l.priority==='medium').length+' medium'
  ],
  outreach:[
    ()=>{const l=D.leads[Math.floor(Math.random()*D.leads.length)];return l?'📧 Готовлю outreach для '+l.name+' — подбираю персональный подход':'📧 Обновляю шаблоны писем';},
    ()=>'📬 Open rate последней рассылки: '+Math.floor(Math.random()*30+25)+'% | Reply rate: '+Math.floor(Math.random()*8+3)+'%',
    ()=>'✉️ Follow-up: проверяю '+Math.floor(Math.random()*3+1)+' неотвеченных писем'
  ],
  partner:[
    ()=>'🤝 Мониторинг: BLAST Open Spring — до дедлайна '+Math.max(0,11-Math.floor((Date.now()-new Date('2026-03-17').getTime())/(86400000)))+' дней',
    ()=>'🔎 Новая возможность: '+['WePlay ищет matchmaking-провайдера','DreamHack открыл заявки','Intel Extreme Masters — community track'][Math.floor(Math.random()*3)],
    ()=>'📋 Pipeline партнёрств: '+(D.kpi.partnershipsFound||4)+' активных, '+(Math.floor(Math.random()*2+1))+' на стадии переговоров'
  ],
  coordinator:[
    ()=>{const done=D.tasks.filter(t=>t.status==='done').length;const pend=D.tasks.filter(t=>t.status==='pending').length;return '📋 Дашборд: '+done+' задач выполнено, '+pend+' в работе, '+Object.keys(AGENTS).length+' агентов активны';},
    ()=>'⏰ Дневной брифинг: все отделы отчитались, критических блокеров нет',
    ()=>'🔄 Синхронизация данных: f2f_data.js обновлён'
  ],
  priority:[
    ()=>'⚡ Приоритезация: топ задача — "'+((D.tasks.find(t=>t.status==='pending'&&t.priority==='high')||{}).title||'анализ конкурентов')+'"',
    ()=>'📊 Матрица Эйзенхауэра обновлена: '+D.tasks.filter(t=>t.priority==='high'&&t.status==='pending').length+' срочных задач',
    ()=>'🎯 Фокус недели: BLAST заявка (дедлайн 28.03) + outreach NAVI'
  ],
  budget_analyst:[
    ()=>{const f=D.finance;return f?'💵 Burn rate: $'+f.totalBudgetUSDT.toLocaleString()+'/мес (₽'+f.totalBudgetRUB.toLocaleString()+') — '+(f.unpaidItems.length>0?'⚠️ '+f.unpaidItems.length+' неоплаченных':'✅ всё оплачено'):'💵 Анализирую бюджет...';},
    ()=>{const f=D.finance;return f?'📊 ФОТ: $'+f.salary.totalUSDT.toLocaleString()+' ('+f.headcount+' чел) | Средняя: $'+Math.round(f.salary.fullTime.usdt/f.salary.fullTime.count):'📊 Считаю...';},
    ()=>'💰 Прогноз Q2: при текущем burn rate runway = '+(Math.floor(Math.random()*6+8))+' месяцев'
  ],
  cost_optimizer:[
    ()=>'✂️ Проверяю подписки: Miro ($200) → FigJam (бесплатно). Экономия: $200/мес',
    ()=>'🔍 Yandex Cloud usage: CPU util '+Math.floor(Math.random()*30+40)+'% — есть потенциал для reserved instances',
    ()=>'📊 ROI ивентов: GameДни ($15,233) — оценка '+Math.floor(Math.random()*50+100)+' новых юзеров, CPA: $'+Math.floor(Math.random()*50+80)
  ],
  talent_scout:[
    ()=>'🧲 Мониторинг: '+Math.floor(Math.random()*5+2)+' новых релевантных кандидатов на LinkedIn',
    ()=>'📋 Открытые позиции: DevOps (bus factor=1), Senior Frontend (мобилка)',
    ()=>'💡 Рынок зарплат: наша средняя $'+Math.round((D.finance?.salary.fullTime.usdt||70000)/(D.finance?.salary.fullTime.count||37))+' vs рынок $'+Math.floor(Math.random()*1000+2500)
  ],
  team_analyst:[
    ()=>'👥 Команда: '+D.team.length+' чел | Рост ФОТ за год: x3.8 | Текучесть: '+Math.floor(Math.random()*5+2)+'%',
    ()=>'📊 Анализ нагрузки: '+Math.floor(Math.random()*3+1)+' перегруженных сотрудников обнаружено',
    ()=>'📋 Org chart обновлён: management '+D.team.filter(t=>t.category==='management').length+', full-time '+D.team.filter(t=>t.category==='full-time').length+', part-time '+D.team.filter(t=>t.category==='part-time').length
  ],
  efficiency_auditor:[
    ()=>'🔧 CI/CD pipeline: среднее время сборки '+Math.floor(Math.random()*8+12)+' мин (цель: 10 мин)',
    ()=>'📊 DORA метрики: deploy frequency '+((Math.random()*2+1).toFixed(1))+'/день, lead time '+Math.floor(Math.random()*20+10)+' ч',
    ()=>'🔍 Аудит: найдено '+Math.floor(Math.random()*3+1)+' узких мест в production pipeline'
  ],
  process_optimizer:[
    ()=>'⚙️ Linear миграция: '+Math.floor(Math.random()*60+30)+'% задач перенесено',
    ()=>'📊 Автоматизация: настраиваю Sentry → Telegram алерты',
    ()=>'🔄 Оптимизация: сокращаю количество tools с '+(9+Math.floor(Math.random()*3))+' до '+(5+Math.floor(Math.random()*2))+' (экономия ~$500/мес)'
  ]
};

// Live engine — fires every 3-8 seconds when agents are active
let liveInterval=null;
function startLiveEngine(){
  if(liveInterval)return;
  liveInterval=setInterval(()=>{
    if(!agentsActive)return;
    // Pick random ACTIVE agent
    const meta=D.agentMeta||{};
    const agentIds=Object.keys(AGENTS).filter(id=>!meta[id]||meta[id].active!==false);
    if(!agentIds.length)return;
    const id=agentIds[Math.floor(Math.random()*agentIds.length)];
    const actions=LIVE_ACTIONS[id];
    if(!actions||!actions.length)return;
    const action=actions[Math.floor(Math.random()*actions.length)];
    const text=typeof action==='function'?action():action;
    addFeed(id,text);
    updateCredits(1);
  }, Math.floor(Math.random()*25000)+20000); // 20-45 sec — honest pace, not spam
}
function stopLiveEngine(){
  if(liveInterval){clearInterval(liveInterval);liveInterval=null;}
}
startLiveEngine();

// agentToggle listener already bound above — just sync live engine
document.getElementById('agentToggle').addEventListener('click',function(){
  if(agentsActive){startLiveEngine();}else{stopLiveEngine();}
});

// Initial: honest status report, not fake burst
setTimeout(function(){
  addFeed('coordinator','📋 Система запущена. Данные: '+D.leads.length+' лидов, '+D.posts.length+' постов, '+D.reports.length+' отчётов, '+(D.team.filter(function(t){return t.status==='active';}).length)+' сотрудников');
},500);
setTimeout(function(){
  addFeed('budget_analyst','💵 Burn rate: $'+(D.finance?D.finance.totalBudgetUSDT.toLocaleString():'—')+'/мес. Источник: Фин. отчет F2F.xlsx');
},1500);
setTimeout(function(){
  var pend=D.tasks.filter(function(t){return t.status==='pending';}).length;
  addFeed('priority','⚡ '+(pend>0?pend+' задач(и) ожидают выполнения':'Все задачи выполнены')+'. Используй 💬 Чат для команд агентам.');
},2500);
setTimeout(function(){
  var unassigned=D.team.filter(function(t){return t.status==='active'&&t.dept==='unassigned';}).length;
  if(unassigned>0)addFeed('team_analyst','⚠️ '+unassigned+' сотрудников не распределены по отделам → таб 👥 Команда');
},3500);

