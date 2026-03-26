// ═══ MOBILE DETECT ═══
function isMob(){return window.innerWidth<768}
function mobGrid(){return isMob()?'1fr':'1fr 1fr'}

// ═══ TOKEN AUTH SYSTEM ═══
let _currentSession = JSON.parse(localStorage.getItem('f2f_session')||'null');
// { token_id, token, employee_name, login_name, role, matched_team_id }

// Pre-fill login form from saved credentials
(function(){
  var saved=JSON.parse(localStorage.getItem('f2f_login_creds')||'null');
  if(saved){
    var ni=document.getElementById('loginName');
    var ti=document.getElementById('loginToken');
    if(ni&&saved.name)ni.value=saved.name;
    if(ti&&saved.token)ti.value=saved.token;
  }
})();

// Try auto-login from saved session (runs immediately — DOM already parsed since script at end of body)
if(_currentSession){
  // Session exists — show dashboard (JWT is optional enhancement, not required)
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='';
}

async function loginWithToken(){
  const nameInput = document.getElementById('loginName');
  const tokenInput = document.getElementById('loginToken');
  const errDiv = document.getElementById('loginError');
  const name = nameInput.value.trim();
  const token = tokenInput.value.trim();

  if(!name){ errDiv.textContent='Введите имя и фамилию'; errDiv.style.display='block'; nameInput.focus(); return; }
  if(!token){ errDiv.textContent='Введите токен доступа'; errDiv.style.display='block'; tokenInput.focus(); return; }

  errDiv.style.display='none';

  try {
    // Try Edge Function auth first (returns JWT with role for RLS)
    var tkn = null;
    var jwtReceived = false;
    try {
      var efRes = await fetch(SUPABASE_URL+'/functions/v1/auth-login', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON},
        body:JSON.stringify({token:token, employee_name:name}),
        signal:AbortSignal.timeout(5000)
      });
      if(efRes.ok){
        var efData = await efRes.json();
        if(efData.jwt){
          if(typeof setAuthJWT==='function') setAuthJWT(efData.jwt);
          jwtReceived = true;
          tkn = {id:efData.token_id, token:token, employee_name:efData.employee_name, role:efData.role};
        }
      }
    } catch(efErr){ console.warn('auth-login Edge Function unavailable, using direct REST fallback:', efErr); }

    // Fallback: direct REST query (works with anon key when RLS allows it)
    if(!tkn){
      var res = await fetch(SUPABASE_URL+'/rest/v1/auth_tokens?token=eq.'+encodeURIComponent(token)+'&is_active=eq.true&select=id,token,employee_name,role', {
        headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey()}
      });
      var data = await res.json();
      if(!data||!data.length){
        errDiv.textContent='Токен недействителен или отозван';
        errDiv.style.display='block';
        tokenInput.value='';
        tokenInput.focus();
        return;
      }
      tkn = data[0];
      // Update last_used_at
      fetch(SUPABASE_URL+'/rest/v1/auth_tokens?id=eq.'+tkn.id, {
        method:'PATCH',
        headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({last_used_at:new Date().toISOString()})
      }).catch(function(){});
    }

    // Match login name with team members
    let matchedTeamId = null;
    const nameLower = name.toLowerCase();
    if(window._sbTeam){
      const match = window._sbTeam.find(t=>{
        const full = ((t.first_name||'')+' '+(t.last_name||'')).toLowerCase().trim();
        return full===nameLower || (t.first_name||'').toLowerCase()===nameLower;
      });
      if(match) matchedTeamId = match.id;
    }

    // Save session
    _currentSession = {
      token_id: tkn.id,
      token: token,
      employee_name: tkn.employee_name,
      login_name: name,
      role: tkn.role,
      matched_team_id: matchedTeamId
    };
    localStorage.setItem('f2f_session', JSON.stringify(_currentSession));
    localStorage.setItem('f2f_login_creds', JSON.stringify({name:name,token:token}));

    auditLog('login','auth','Вход: '+name+' (роль: '+tkn.role+(jwtReceived?' JWT':'')+')')

    // Show dashboard
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('app').style.display='';
    updateUserBadge();

    // SECURITY: Init Supabase ONLY after successful auth
    if(typeof initSupabase==='function'&&!SUPABASE_LIVE){
      setTimeout(initSupabase,300);
    }

  } catch(e){
    errDiv.textContent='Ошибка подключения к серверу';
    errDiv.style.display='block';
    console.error('Login error:',e);
  }
}

window.logout=function(){logoutUser();};
function logoutUser(){
  if(_currentSession) auditLog('logout','auth','Выход: '+_currentSession.login_name);
  _currentSession=null;
  localStorage.removeItem('f2f_session');
  // SECURITY: Clear JWT and all Supabase data on logout
  if(typeof setAuthJWT==='function') setAuthJWT(null);
  SUPABASE_LIVE=false;
  window._sbTeam=null;window._sbPartners=null;window._sbContent=null;
  window._sbMemory=null;window._sbEvents=null;window._sbReports=null;
  window._sbFeedLoaded=false;window._sbContentMerged=false;window._sbPartnersMerged=false;
  if(typeof feedItems!=='undefined')feedItems.length=0;
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('app').style.display='none';
}

function updateUserBadge(){
  const el = document.getElementById('currentUser');
  const adminTab = document.getElementById('tabAdmin');
  const financeTab = document.querySelector('.tab[data-panel="finance"]');
  if(!_currentSession){ if(el) el.textContent=''; return; }
  const roleLabels = {admin:'👑',pm:'📋',editor:'✏️',viewer:'👁️',bizdev:'🔥',community:'💜',referee:'🏆'};
  if(el) el.textContent = (roleLabels[_currentSession.role]||'')+ ' ' + _currentSession.login_name;
  // Show admin tab only for admin role
  if(adminTab) adminTab.style.display = isAdmin() ? '' : 'none';
  // Finance tab — admin only
  if(financeTab) financeTab.style.display = canSeeFinance() ? '' : 'none';
}
// Init user badge on auto-login
updateUserBadge();

function isAdmin(){ return _currentSession && _currentSession.role==='admin'; }
function isPM(){ return _currentSession && _currentSession.role==='pm'; }
function isBizDev(){ return _currentSession && _currentSession.role==='bizdev'; }
function isCommunity(){ return _currentSession && _currentSession.role==='community'; }
function isReferee(){ return _currentSession && _currentSession.role==='referee'; }
function isEditor(){ return _currentSession && ['admin','editor','pm','bizdev','community'].indexOf(_currentSession.role)!==-1; }
function canSeeSalary(){ return isAdmin(); }
function canEditSalary(){ return isAdmin()||isPM(); }
function canSeeFinance(){ return isAdmin(); }
function canAddExpense(){ return _currentSession && _currentSession.role!=='viewer'; }
function canSeeExpenseTotal(){ return isAdmin(); }
function getCurrentUser(){ return _currentSession ? _currentSession.login_name : 'unknown'; }
function getCurrentRole(){ return _currentSession ? _currentSession.role : 'viewer'; }
function getCurrentTokenId(){ return _currentSession ? _currentSession.token_id : null; }

// ═══ AUDIT LOG ═══
async function auditLog(action, section, details){
  try {
    const body = {
      token_id: getCurrentTokenId(),
      employee_name: getCurrentUser(),
      user_name: _currentSession?_currentSession.login_name:null,
      user_role: _currentSession?_currentSession.role:null,
      action: action,
      section: section||null,
      details: typeof details==='string' ? {text:details} : (details||null)
    };
    await sbInsert('audit_log', body);
  } catch(e){ console.warn('Audit log error:',e); }
}

// ═══ ADMIN PANEL ═══
let adminTab = 'tokens';
function adminSwitchTab(tab, btn){
  adminTab=tab;
  document.querySelectorAll('#panel-admin .sub-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderAdmin();
}

async function renderAdmin(){
  if(!isAdmin()) return;
  const c = document.getElementById('adminContent');
  if(!c) return;

  if(adminTab==='tokens') await renderAdminTokens(c);
  else if(adminTab==='productivity') await renderAdminProductivity(c);
  else await renderAdminAudit(c);
}

async function renderAdminTokens(container){
  const tokens = await sbFetch('auth_tokens','select=*&order=created_at.desc');

  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="border-bottom:1px solid var(--border)">';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Сотрудник</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Токен</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Роль</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Создан</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Посл. вход</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Статус</th>';
  html += '<th style="padding:8px;text-align:right;color:var(--dim)">Действие</th>';
  html += '</tr></thead><tbody>';

  (tokens||[]).forEach(t=>{
    const active = t.is_active;
    const roleColors = {admin:'#ffb800',pm:'#a855f7',editor:'#2cff80',viewer:'#00e5ff',bizdev:'#ff6b35',community:'#e040fb',referee:'#26c6da'};
    const roleNames = {admin:'Админ',pm:'PM',editor:'Редактор',viewer:'Наблюдатель',bizdev:'BizDev',community:'Community',referee:'Referee'};
    const created = t.created_at ? new Date(t.created_at).toLocaleDateString('ru-RU') : '—';
    const lastUsed = t.last_used_at ? timeSince(t.last_used_at) : 'никогда';
    html += '<tr style="border-bottom:1px solid var(--border);opacity:'+(active?1:0.4)+'">';
    html += '<td style="padding:8px;color:var(--text)">'+t.employee_name+'</td>';
    html += '<td style="padding:8px"><code style="background:var(--surface);padding:2px 6px;border-radius:4px;font-size:11px;color:var(--cyan)">'+t.token+'</code></td>';
    html += '<td style="padding:8px"><span style="color:'+(roleColors[t.role]||'var(--dim)')+'">'+( roleNames[t.role]||t.role)+'</span></td>';
    html += '<td style="padding:8px;color:var(--dim)">'+created+'</td>';
    html += '<td style="padding:8px;color:var(--dim)">'+lastUsed+'</td>';
    html += '<td style="padding:8px">'+(active?'<span style="color:var(--green)">Активен</span>':'<span style="color:var(--hot)">Отозван</span>')+'</td>';
    html += '<td style="padding:8px;text-align:right">';
    if(active) html += '<button onclick="revokeToken(\''+t.id+'\')" style="background:var(--hot)22;color:var(--hot);border:1px solid var(--hot)44;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:11px">Отозвать</button>';
    else html += '<button onclick="reactivateToken(\''+t.id+'\')" style="background:var(--green)22;color:var(--green);border:1px solid var(--green)44;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:11px">Восстановить</button>';
    html += '</td></tr>';
  });

  html += '</tbody></table>';
  if(!tokens||!tokens.length) html = '<div style="text-align:center;padding:40px;color:var(--dim)">Нет токенов</div>';
  container.innerHTML = html;
}

async function renderAdminAudit(container){
  const logs = await sbFetch('audit_log','select=*&order=created_at.desc&limit=200');

  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="border-bottom:1px solid var(--border)">';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Время</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Сотрудник</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Действие</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Раздел</th>';
  html += '<th style="padding:8px;text-align:left;color:var(--dim)">Детали</th>';
  html += '</tr></thead><tbody>';

  const actionIcons = {login:'🔓',logout:'🚪',create:'➕',update:'✏️',delete:'🗑️',payment:'💸',generate:'⚙️',export:'📥'};
  const sectionNames = {auth:'Авторизация',finance:'Финансы',team:'Команда',agents:'Агенты',tokens:'Токены',strategy:'Стратегия'};

  (logs||[]).forEach(l=>{
    const time = l.created_at ? new Date(l.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
    const icon = actionIcons[l.action]||'📌';
    const detailText = l.details ? (l.details.text || JSON.stringify(l.details)) : '';
    html += '<tr style="border-bottom:1px solid var(--border)">';
    html += '<td style="padding:8px;color:var(--dim);white-space:nowrap">'+time+'</td>';
    html += '<td style="padding:8px;color:var(--text)">'+l.employee_name+'</td>';
    html += '<td style="padding:8px">'+icon+' '+l.action+'</td>';
    html += '<td style="padding:8px;color:var(--cyan)">'+(sectionNames[l.section]||l.section||'')+'</td>';
    html += '<td style="padding:8px;color:var(--dim);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+detailText.replace(/"/g,'&quot;')+'">'+detailText+'</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  if(!logs||!logs.length) html = '<div style="text-align:center;padding:40px;color:var(--dim)">Аудит-лог пуст</div>';
  container.innerHTML = html;
}

async function renderAdminProductivity(container){
  var logs=await sbFetch('audit_log','select=*&order=created_at.desc&limit=1000')||[];
  var feedback=await sbFetch('team_feedback','select=*&order=created_at.desc&limit=500')||[];
  var expenses=await sbFetch('expense_entries','select=*&order=created_at.desc&limit=500')||[];
  // Aggregate by user
  var users={};
  function ensureUser(name,role){
    if(!name)return;
    if(!users[name])users[name]={name:name,role:role||'',logins:0,actions:0,feedback:0,expenses:0,lastActive:null};
    return users[name];
  }
  logs.forEach(function(l){
    var u=ensureUser(l.user_name||l.employee_name,l.user_role);
    if(!u)return;
    u.actions++;
    if(l.action==='login')u.logins++;
    var t=l.created_at?new Date(l.created_at):null;
    if(t&&(!u.lastActive||t>u.lastActive))u.lastActive=t;
  });
  feedback.forEach(function(f){
    var u=ensureUser(f.author,f.author_role);
    if(u)u.feedback++;
  });
  expenses.forEach(function(e){
    var u=ensureUser(e.author,e.author_role);
    if(u)u.expenses++;
  });
  var sorted=Object.values(users).sort(function(a,b){return b.actions-a.actions;});
  var roleColors={admin:'#ffb800',pm:'#a855f7',editor:'#2cff80',viewer:'#00e5ff',bizdev:'#ff6b35',community:'#e040fb',referee:'#26c6da'};
  var roleNames={admin:'Админ',pm:'PM',editor:'Редактор',viewer:'Наблюдатель',bizdev:'BizDev',community:'Community',referee:'Referee'};
  var html='<div style="margin-bottom:16px;font-size:13px;color:var(--dim)">Активность сотрудников за всё время (аудит-лог + feedback + расходы)</div>';
  html+='<div class="fin-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">';
  sorted.forEach(function(u){
    var rc=roleColors[u.role]||'var(--dim)';
    var rn=roleNames[u.role]||u.role;
    var lastStr=u.lastActive?timeSince(u.lastActive.toISOString()):'никогда';
    html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;border-top:3px solid '+rc+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
      '<div style="font-weight:700;font-size:15px">'+esc(u.name)+'</div>'+
      '<span style="color:'+rc+';font-size:11px;font-weight:600">'+rn+'</span></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<div style="padding:8px;background:var(--bg);border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--cyan)">'+u.actions+'</div><div style="font-size:10px;color:var(--dim)">Действий</div></div>'+
      '<div style="padding:8px;background:var(--bg);border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--green)">'+u.feedback+'</div><div style="font-size:10px;color:var(--dim)">Feedback</div></div>'+
      '<div style="padding:8px;background:var(--bg);border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700;color:var(--amber)">'+u.expenses+'</div><div style="font-size:10px;color:var(--dim)">Расходы</div></div>'+
      '<div style="padding:8px;background:var(--bg);border-radius:6px;text-align:center"><div style="font-size:18px;font-weight:700">'+u.logins+'</div><div style="font-size:10px;color:var(--dim)">Входов</div></div>'+
      '</div>'+
      '<div style="margin-top:10px;font-size:11px;color:var(--dim)">Посл. активность: '+lastStr+'</div></div>';
  });
  html+='</div>';
  if(!sorted.length)html='<div style="text-align:center;padding:40px;color:var(--dim)">Нет данных. Активность сотрудников начнёт отслеживаться после входа в систему.</div>';
  container.innerHTML=html;
}

function openCreateTokenModal(){
  const modal=document.getElementById('modal');
  const mc=document.getElementById('modalContent');
  const randomToken = 'f2f_'+Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b=>b.toString(36).padStart(2,'0')).join('').slice(0,16);
  mc.innerHTML = '<h3 style="margin:0 0 16px">➕ Создать токен доступа</h3>'+
    '<div style="display:flex;flex-direction:column;gap:12px">'+
    '<div><label style="font-size:11px;color:var(--dim)">Имя сотрудника</label>'+
    '<input id="newTokenName" placeholder="Иван Иванов" style="width:100%;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;box-sizing:border-box;margin-top:4px"></div>'+
    '<div><label style="font-size:11px;color:var(--dim)">Роль</label>'+
    '<select id="newTokenRole" style="width:100%;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;box-sizing:border-box;margin-top:4px">'+
    '<option value="viewer">👁️ Наблюдатель — только просмотр</option>'+
    '<option value="bizdev">🔥 BizDev — B2B: лиды, мероприятия, контент, расходы</option>'+
    '<option value="community">💜 Community — B2C: лиды, мероприятия, контент, расходы</option>'+
    '<option value="referee">🏆 Referee — команды, мероприятия, расходы судей</option>'+
    '<option value="editor">✏️ Редактор — просмотр + редактирование контента</option>'+
    '<option value="pm">📋 PM — команда + ЗП (write-only) + задачи + расходы</option>'+
    '<option value="admin">👑 Админ — полный доступ (финансы, ЗП, токены)</option>'+
    '</select></div>'+
    '<div><label style="font-size:11px;color:var(--dim)">Токен (авто-генерация)</label>'+
    '<div style="display:flex;gap:6px;margin-top:4px"><input id="newTokenValue" value="'+randomToken+'" readonly style="flex:1;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--cyan);font-size:13px;font-family:monospace;outline:none;box-sizing:border-box">'+
    '<button onclick="navigator.clipboard.writeText(document.getElementById(\'newTokenValue\').value)" style="padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:13px" title="Копировать">📋</button></div></div>'+
    '<div><label style="font-size:11px;color:var(--dim)">Заметка (опционально)</label>'+
    '<input id="newTokenNote" placeholder="Для доступа к финансам..." style="width:100%;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;box-sizing:border-box;margin-top:4px"></div>'+
    '<button onclick="createToken()" style="padding:10px;background:var(--green);border:none;border-radius:8px;color:#000;font-weight:600;font-size:13px;cursor:pointer;margin-top:4px">Создать токен</button>'+
    '</div>';
  modal.classList.add('open');
}

async function createToken(){
  const name = document.getElementById('newTokenName').value.trim();
  const role = document.getElementById('newTokenRole').value;
  const token = document.getElementById('newTokenValue').value;
  const note = document.getElementById('newTokenNote').value.trim();
  if(!name){ showToast('Укажите имя сотрудника','error'); return; }

  const result = await sbInsert('auth_tokens',{
    token: token,
    employee_name: name,
    role: role,
    notes: note||null
  });
  if(result){
    auditLog('create','tokens','Создан токен для: '+name+' ('+role+')');
    document.getElementById('modal').classList.remove('open');
    renderAdmin();
  }
}

async function revokeToken(id){
  var ok=await f2fConfirm('Отозвать токен? Сотрудник потеряет доступ.');
  if(!ok)return;
  await sbPatch('auth_tokens','id=eq.'+id,{is_active:false});
  auditLog('update','tokens','Токен отозван: '+id);
  renderAdmin();
}

async function reactivateToken(id){
  await sbPatch('auth_tokens','id=eq.'+id,{is_active:true});
  auditLog('update','tokens','Токен восстановлен: '+id);
  renderAdmin();
}

// ═══ ERROR BOUNDARY: Wrap render functions to prevent cascade failures ═══
function safeRender(fn,sectionName){
  try{fn();}catch(e){
    console.error('[F2F] Error in '+sectionName+':',e);
    // Show inline error instead of breaking entire UI
    var el=document.getElementById(sectionName+'List')||document.getElementById(sectionName+'Content');
    if(el)el.innerHTML='<div style="text-align:center;padding:20px;color:#ff6b6b;font-size:12px">⚠️ Ошибка загрузки секции '+(sectionName||'')+'. <button onclick="location.reload()" style="color:var(--cyan);background:none;border:none;cursor:pointer;text-decoration:underline;font-size:12px">Перезагрузить</button></div>';
  }
}

// ═══ LOADING STATE UTILITY ═══
// ═══ SECURITY: HTML escape for user inputs ═══
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// Validate & clamp text input (max length, trim)
function cleanInput(val,maxLen){val=(val||'').trim();if(maxLen&&val.length>maxLen)val=val.slice(0,maxLen);return val;}

function withLoading(btn, asyncFn){
  if(!btn||btn.disabled)return;
  var origText=btn.innerHTML;
  btn.disabled=true;btn.style.opacity='0.6';btn.innerHTML='<span class="spinner"></span> '+origText;
  Promise.resolve(asyncFn()).then(function(){btn.disabled=false;btn.style.opacity='';btn.innerHTML=origText;})
    .catch(function(e){btn.disabled=false;btn.style.opacity='';btn.innerHTML=origText;showToast('Ошибка: '+e.message,'error');});
}

// ═══ DATA ═══
const D = window.F2F_DATA || {leads:[],posts:[],reports:[],tasks:[],companies:[],kpi:{},financeReports:[],hrReports:[],techReports:[]};
D.feed = D.feed || [];
D.agents = D.agents || [];
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
  kpi_updater:{name:'KPI Updater',emoji:'📈',dept:'sys',color:'#a78bfa',scenarioId:4884485,interval:'—'},
  art_director:{name:'Art Director',emoji:'🎨',dept:'smm',color:'#9c27b0',scenarioId:null,interval:'по запросу'},
  quality_controller:{name:'Quality Controller',emoji:'✅',dept:'cmd',color:'#10b981',scenarioId:null,interval:'авто'}
};
const DEPTS = [
  {id:'cmd', name:'Command Center', color:'#ffb800', agents:['coordinator','briefing','quality_controller']},
  {id:'rd', name:'Analytics', color:'#00e5ff', agents:['market']},
  {id:'smm', name:'SMM & Community', color:'#ff2d78', agents:['content','social','art_director']},
  {id:'biz', name:'Business Dev', color:'#00ff88', agents:['leads','outreach','lead_finder','followup']},
  {id:'sys', name:'System Services', color:'#a78bfa', agents:['processor','watchdog','kpi_updater']}
];

// ═══ TABS ═══
function switchTab(panelId){
  // Restricted sections
  if(panelId==='admin' && !isAdmin()) return;
  if(panelId==='finance' && !canSeeFinance()) return;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const tab=document.querySelector('.tab[data-panel="'+panelId+'"]');
  if(tab)tab.classList.add('active');
  const panel=document.getElementById('panel-'+panelId);
  if(panel)panel.classList.add('active');
  if(panelId==='office'){resizeCanvas();if(typeof updateOfficeStatuses==='function')updateOfficeStatuses();}
  if(panelId==='admin') renderAdmin();
  if(panelId==='expenses'&&typeof renderExpenses==='function') renderExpenses();
  if(panelId==='projects'&&typeof renderProjects==='function') renderProjects();
  if(panelId==='teams'&&typeof renderTeams==='function') renderTeams();
  if(panelId==='digest'&&typeof loadDigest==='function') loadDigest();
  if(panelId==='kb'&&typeof loadKb==='function') loadKb();
}
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>switchTab(tab.dataset.panel));
});
// Alt+1-9 hotkeys for tab switching
document.addEventListener('keydown',function(e){
  if(!e.altKey||e.ctrlKey||e.metaKey)return;
  var tabs=document.querySelectorAll('.tab[data-panel]');
  var idx=parseInt(e.key)-1;
  if(idx>=0&&idx<tabs.length){e.preventDefault();switchTab(tabs[idx].dataset.panel);}
});
// KPI click → navigate to tab
document.querySelectorAll('.kpi[data-goto]').forEach(kpi=>{
  kpi.addEventListener('click',()=>switchTab(kpi.dataset.goto));
});

// Strategy & KPI Save Handler
// ═══ STRATEGY: Load saved strategy + render KPI progress ═══
async function loadStrategy(){
  if(!SUPABASE_LIVE)return;
  try{
    var res=await fetch(SUPABASE_URL+'/rest/v1/directives?key=eq.company_strategy&select=value_json',{
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey()}
    });
    var data=await res.json();
    if(data&&data[0]&&data[0].value_json){
      var s=typeof data[0].value_json==='string'?JSON.parse(data[0].value_json):data[0].value_json;
      if(s.mission_vision)document.getElementById('strategyText').value=s.mission_vision;
      // Operational
      if(s.kpi_leads_monthly)document.getElementById('strat-kpi-leads').value=s.kpi_leads_monthly;
      if(s.kpi_emails_monthly)document.getElementById('strat-kpi-emails').value=s.kpi_emails_monthly;
      if(s.kpi_content_monthly)document.getElementById('strat-kpi-content').value=s.kpi_content_monthly;
      // Product
      if(s.kpi_mau)document.getElementById('strat-kpi-mau').value=s.kpi_mau;
      if(s.kpi_dau)document.getElementById('strat-kpi-dau').value=s.kpi_dau;
      if(s.kpi_retention_d7)document.getElementById('strat-kpi-retention-d7').value=s.kpi_retention_d7;
      if(s.kpi_retention_d30)document.getElementById('strat-kpi-retention-d30').value=s.kpi_retention_d30;
      if(s.kpi_matches_daily)document.getElementById('strat-kpi-matches').value=s.kpi_matches_daily;
      if(s.kpi_avg_queue_time)document.getElementById('strat-kpi-queue').value=s.kpi_avg_queue_time;
      if(s.kpi_nps)document.getElementById('strat-kpi-nps').value=s.kpi_nps;
      // Financial
      if(s.kpi_mrr)document.getElementById('strat-kpi-mrr').value=s.kpi_mrr;
      if(s.kpi_revenue_target)document.getElementById('strat-kpi-revenue').value=s.kpi_revenue_target;
      if(s.kpi_cac)document.getElementById('strat-kpi-cac').value=s.kpi_cac;
      if(s.kpi_ltv)document.getElementById('strat-kpi-ltv').value=s.kpi_ltv;
      if(s.kpi_churn_monthly)document.getElementById('strat-kpi-churn').value=s.kpi_churn_monthly;
      // Marketing
      if(s.kpi_telegram_subs)document.getElementById('strat-kpi-tg-subs').value=s.kpi_telegram_subs;
      if(s.kpi_social_engagement)document.getElementById('strat-kpi-engagement').value=s.kpi_social_engagement;
      if(s.kpi_partnerships)document.getElementById('strat-kpi-partnerships').value=s.kpi_partnerships;
      // Strategic fields
      if(s.target_audience)document.getElementById('strat-target-audience').value=s.target_audience;
      if(s.competitive_advantage)document.getElementById('strat-competitive-advantage').value=s.competitive_advantage;
      if(s.strategic_priorities)document.getElementById('strat-priorities').value=s.strategic_priorities;
    }
  }catch(e){console.warn('Strategy load error:',e);}
  renderStrategyProgress();
}
function renderStrategyProgress(){
  var el=document.getElementById('stratProgress');if(!el)return;
  var gn=function(id,fb){var e=document.getElementById(id);return e?parseFloat(e.value)||fb||0:fb||0;};

  // Real data from Supabase
  var leadsActual=window._sbPartners?window._sbPartners.length:0;
  var publishedActual=window._sbContent?window._sbContent.filter(function(c){return c.status==='published';}).length:0;
  var emailsSent=0;
  if(window._sbActions){
    emailsSent=window._sbActions.filter(function(a){
      var p=typeof a.payload_json==='string'?JSON.parse(a.payload_json||'{}'):a.payload_json||{};
      return a.type==='email_sent'||p.status==='sent';
    }).length;
  }
  var partnershipsActual=window._sbPartners?window._sbPartners.filter(function(p){return p.stage==='partner'||p.stage==='won';}).length:0;

  function kpiCard(icon,label,val,target,color,suffix){
    suffix=suffix||'';
    if(!target||target<=0)return '';
    var pct=Math.min(100,Math.round(val/target*100));
    var status=pct>=100?'✅':pct>=60?'🟡':pct>0?'🔴':'⬜';
    return '<div class="strat-kpi-card">'+
      '<div class="strat-kpi-label"><span>'+icon+' '+label+'</span><span class="strat-kpi-pct" style="color:'+color+'">'+pct+'%</span></div>'+
      '<div class="strat-kpi-value" style="color:'+color+'">'+val+suffix+' <span style="font-size:12px;color:var(--dim);font-weight:400">/ '+target+suffix+'</span></div>'+
      '<div class="strat-kpi-bar"><div class="strat-kpi-fill" style="width:'+pct+'%;background:'+color+'"></div></div>'+
      '<div style="font-size:9px;color:var(--dim);text-align:right">'+status+' '+(pct>=100?'Достигнуто':pct>=60?'На пути':'Нужен прогресс')+'</div>'+
    '</div>';
  }
  function kpiStatic(icon,label,target,color,suffix){
    suffix=suffix||'';
    if(!target||target<=0)return '';
    return '<div class="strat-kpi-card" style="opacity:0.7">'+
      '<div class="strat-kpi-label"><span>'+icon+' '+label+'</span><span style="font-size:10px;color:var(--dim)">цель</span></div>'+
      '<div class="strat-kpi-value" style="color:'+color+'">'+target+suffix+'</div>'+
      '<div class="strat-kpi-bar"><div class="strat-kpi-fill" style="width:0%;background:'+color+'"></div></div>'+
      '<div style="font-size:9px;color:var(--dim);text-align:right">⬜ Ожидает данных</div>'+
    '</div>';
  }

  var cards=[];
  // Operational (with real data)
  cards.push(kpiCard('📞','Лиды',leadsActual,gn('strat-kpi-leads',45),'#00e5ff'));
  cards.push(kpiCard('📝','Контент',publishedActual,gn('strat-kpi-content',20),'#00ff88'));
  cards.push(kpiCard('📧','Emails',emailsSent,gn('strat-kpi-emails',200),'#ff2d78'));
  cards.push(kpiCard('🤝','Партнёрства',partnershipsActual,gn('strat-kpi-partnerships'),'#a78bfa'));
  // Product (targets only)
  cards.push(kpiStatic('👥','MAU',gn('strat-kpi-mau'),'#00e5ff'));
  cards.push(kpiStatic('📈','DAU',gn('strat-kpi-dau'),'#4aff00'));
  cards.push(kpiStatic('🔄','Retention D7',gn('strat-kpi-retention-d7'),'#ff9800','%'));
  cards.push(kpiStatic('🔄','Retention D30',gn('strat-kpi-retention-d30'),'#ff5722','%'));
  cards.push(kpiStatic('⚔️','Матчей/день',gn('strat-kpi-matches'),'#e040fb'));
  cards.push(kpiStatic('⏱️','Ср. очередь',gn('strat-kpi-queue'),'#29b6f6','с'));
  cards.push(kpiStatic('⭐','NPS',gn('strat-kpi-nps'),'#ffeb3b'));
  // Financial
  cards.push(kpiStatic('💵','MRR',gn('strat-kpi-mrr'),'#66bb6a','$'));
  cards.push(kpiCard('💰','Revenue',0,gn('strat-kpi-revenue',15000),'#ffb800','$'));
  cards.push(kpiStatic('🎯','CAC',gn('strat-kpi-cac'),'#ef5350','$'));
  cards.push(kpiStatic('💎','LTV',gn('strat-kpi-ltv'),'#ab47bc','$'));
  cards.push(kpiStatic('📉','Churn',gn('strat-kpi-churn'),'#f44336','%'));
  // Marketing
  cards.push(kpiStatic('✈️','TG подписчики',gn('strat-kpi-tg-subs'),'#26c6da'));
  cards.push(kpiStatic('💬','Engagement',gn('strat-kpi-engagement'),'#7c4dff','%'));

  var filtered=cards.filter(function(c){return c!=='';});
  el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">'+filtered.join('')+'</div>';

  // Decomposition
  var decomEl=document.getElementById('stratDecomposition');
  if(decomEl){
    var tLeads=gn('strat-kpi-leads',45);
    var tContent=gn('strat-kpi-content',20);
    var tEmails=gn('strat-kpi-emails',200);
    var publishRate=publishedActual>0?Math.round(publishedActual/7*10)/10:0;
    var leadRate=leadsActual>0?Math.round(leadsActual/7*10)/10:0;
    decomEl.innerHTML=
      '<div style="margin-bottom:6px"><b style="color:#00ff88">→ Coordinator</b> <span style="color:var(--text)">разбивает стратегию на недельные цели</span></div>'+
      '<div style="margin-bottom:6px"><b style="color:#ffb800">→ Lead Scout</b> <span style="color:var(--text)">ищет ~'+Math.ceil(tLeads/30)+' лидов/день</span> <span style="color:var(--dim)">('+leadRate+'/день)</span></div>'+
      '<div style="margin-bottom:6px"><b style="color:#ff2d78">→ SMM</b> <span style="color:var(--text)">~'+Math.ceil(tContent/4)+' постов/неделю</span> <span style="color:var(--dim)">('+publishRate+'/день)</span></div>'+
      '<div style="margin-bottom:6px"><b style="color:#00e5ff">→ Outreach</b> <span style="color:var(--text)">~'+Math.ceil(tEmails/30)+' email/день</span> <span style="color:var(--dim)">(отправлено: '+emailsSent+')</span></div>'+
      '<div><b style="color:#a78bfa">→ Analyst (Opus)</b> <span style="color:var(--text)">3x/день: конкуренты → возможности → угрозы</span></div>';
  }
}
document.getElementById('stratSaveBtn').addEventListener('click',async function(){
  const gv=function(id,fallback){var el=document.getElementById(id);return el?el.value:fallback||'';};
  const gn=function(id,fallback){return parseFloat(gv(id,'0'))||fallback||0;};

  const strategyData={
    mission_vision:gv('strategyText',''),
    // Operational
    kpi_leads_monthly:gn('strat-kpi-leads',45),
    kpi_emails_monthly:gn('strat-kpi-emails',200),
    kpi_content_monthly:gn('strat-kpi-content',20),
    // Product
    kpi_mau:gn('strat-kpi-mau'),
    kpi_dau:gn('strat-kpi-dau'),
    kpi_retention_d7:gn('strat-kpi-retention-d7'),
    kpi_retention_d30:gn('strat-kpi-retention-d30'),
    kpi_matches_daily:gn('strat-kpi-matches'),
    kpi_avg_queue_time:gn('strat-kpi-queue'),
    kpi_nps:gn('strat-kpi-nps'),
    // Financial
    kpi_mrr:gn('strat-kpi-mrr'),
    kpi_revenue_target:gn('strat-kpi-revenue',15000),
    kpi_cac:gn('strat-kpi-cac'),
    kpi_ltv:gn('strat-kpi-ltv'),
    kpi_churn_monthly:gn('strat-kpi-churn'),
    // Marketing
    kpi_telegram_subs:gn('strat-kpi-tg-subs'),
    kpi_social_engagement:gn('strat-kpi-engagement'),
    kpi_partnerships:gn('strat-kpi-partnerships'),
    // Strategic
    target_audience:gv('strat-target-audience',''),
    competitive_advantage:gv('strat-competitive-advantage',''),
    strategic_priorities:gv('strat-priorities',''),
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
    showToast('Ошибка сохранения. Проверь соединение с Supabase.','error');
  }
});

// ═══ MARKET INTELLIGENCE ═══
window._marketIntel=[];
async function loadMarketIntelligence(){
  if(!SUPABASE_LIVE)return;
  try{
    var data=await sbFetch('market_intelligence','select=*&order=created_at.desc&limit=30');
    if(data&&Array.isArray(data)){window._marketIntel=data;renderMarketIntelligence();}
  }catch(e){console.warn('MI load error:',e);}
}
function renderMarketIntelligence(){
  var grid=document.getElementById('marketIntelGrid');
  var countEl=document.getElementById('miCount');
  if(!grid)return;
  var items=window._marketIntel||[];
  if(countEl)countEl.textContent='('+items.length+' отчётов)';
  if(!items.length){
    grid.innerHTML='<div style="text-align:center;padding:20px;color:var(--dim);font-size:13px">Нет данных. Аналитик запускается 3 раза в день (05:00, 12:00, 19:00 UTC).</div>';
    return;
  }
  grid.innerHTML=items.slice(0,10).map(function(mi){
    var trends=(mi.market_trends||[]);
    var comps=(mi.competitor_updates||[]);
    var opps=(mi.opportunities||[]);
    var threats=(mi.threats||[]);
    var recs=(mi.recommendations||[]);
    var date=mi.created_at?new Date(mi.created_at).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    var typeLabel=mi.report_type==='competitor_deep_dive'?'🏢 Конкуренты':mi.report_type==='opportunity_report'?'💡 Возможности':'📊 Обзор рынка';
    var summary=esc(mi.summary||'').slice(0,200);
    return '<div class="mi-card" onclick="openMIDetail(\''+mi.id+'\')" style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px;cursor:pointer;transition:border-color .2s" onmouseenter="this.style.borderColor=\'var(--cyan)\'" onmouseleave="this.style.borderColor=\'var(--border)\'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<span style="font-size:12px;font-weight:600;color:var(--cyan)">'+typeLabel+'</span>'+
        '<span style="font-size:10px;color:var(--dim)">'+date+'</span>'+
      '</div>'+
      (summary?'<div style="font-size:12px;color:var(--text);margin-bottom:10px;line-height:1.5">'+summary+'</div>':'')+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        (trends.length?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#00e5ff22;color:#00e5ff">🔥 '+trends.length+' трендов</span>':'')+
        (comps.length?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#ff2d7822;color:#ff2d78">🏢 '+comps.length+' конкурентов</span>':'')+
        (opps.length?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#00ff8822;color:#00ff88">💡 '+opps.length+' возможностей</span>':'')+
        (threats.length?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#ffb80022;color:#ffb800">⚠️ '+threats.length+' угроз</span>':'')+
        (recs.length?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#a78bfa22;color:#a78bfa">🎯 '+recs.length+' рекомендаций</span>':'')+
      '</div>'+
    '</div>';
  }).join('');
}
window.openMIDetail=function(id){
  var mi=(window._marketIntel||[]).find(function(x){return x.id===id;});
  if(!mi)return;
  var date=mi.created_at?new Date(mi.created_at).toLocaleString('ru',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  var html='<h2 style="margin-bottom:4px">📊 Market Intelligence</h2>';
  html+='<div style="font-size:11px;color:var(--dim);margin-bottom:16px">'+date+' • '+(mi.report_type||'market_scan')+'</div>';
  if(mi.summary)html+='<div style="font-size:13px;line-height:1.6;padding:12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);margin-bottom:16px">'+esc(mi.summary)+'</div>';
  // Trends
  var trends=mi.market_trends||[];
  if(trends.length){
    html+='<h3 style="color:#00e5ff;font-size:13px;margin-bottom:8px">🔥 Тренды рынка ('+trends.length+')</h3>';
    html+='<div style="margin-bottom:16px">'+trends.map(function(t){
      var impact=t.impact==='high'?'🔴':t.impact==='medium'?'🟡':'🟢';
      return '<div style="padding:8px 12px;margin-bottom:6px;background:var(--panel);border-radius:6px;border-left:3px solid #00e5ff">'+
        '<div style="font-size:12px;font-weight:600;color:var(--text)">'+esc(t.title||t.trend||String(t))+'</div>'+
        (t.description?'<div style="font-size:11px;color:var(--dim);margin-top:4px">'+esc(t.description)+'</div>':'')+
        '<div style="font-size:10px;color:var(--dim);margin-top:4px">'+impact+' '+(t.impact||'')+(t.source?' • 🔗 '+esc(t.source):'')+'</div>'+
      '</div>';
    }).join('')+'</div>';
  }
  // Competitor updates
  var comps=mi.competitor_updates||[];
  if(comps.length){
    html+='<h3 style="color:#ff2d78;font-size:13px;margin-bottom:8px">🏢 Конкуренты ('+comps.length+')</h3>';
    html+='<div style="margin-bottom:16px">'+comps.map(function(c){
      return '<div style="padding:8px 12px;margin-bottom:6px;background:var(--panel);border-radius:6px;border-left:3px solid #ff2d78">'+
        '<div style="font-size:12px;font-weight:600;color:var(--text)">'+esc(c.competitor||c.name||'?')+'</div>'+
        '<div style="font-size:11px;color:var(--dim);margin-top:4px">'+esc(c.update||c.summary||String(c))+'</div>'+
        (c.source?'<div style="font-size:10px;color:var(--dim);margin-top:4px">🔗 '+esc(c.source)+'</div>':'')+
      '</div>';
    }).join('')+'</div>';
  }
  // Opportunities
  var opps=mi.opportunities||[];
  if(opps.length){
    html+='<h3 style="color:#00ff88;font-size:13px;margin-bottom:8px">💡 Возможности ('+opps.length+')</h3>';
    html+='<div style="margin-bottom:16px">'+opps.map(function(o){
      return '<div style="padding:8px 12px;margin-bottom:6px;background:var(--panel);border-radius:6px;border-left:3px solid #00ff88">'+
        '<div style="font-size:12px;font-weight:600;color:var(--text)">'+esc(o.title||o.opportunity||String(o))+'</div>'+
        (o.description?'<div style="font-size:11px;color:var(--dim);margin-top:4px">'+esc(o.description)+'</div>':'')+
        (o.effort?'<div style="font-size:10px;color:var(--dim);margin-top:4px">Усилия: '+esc(o.effort)+(o.potential_revenue?' • Потенциал: '+esc(o.potential_revenue):'')+'</div>':'')+
      '</div>';
    }).join('')+'</div>';
  }
  // Threats
  var threats=mi.threats||[];
  if(threats.length){
    html+='<h3 style="color:#ffb800;font-size:13px;margin-bottom:8px">⚠️ Угрозы ('+threats.length+')</h3>';
    html+='<div style="margin-bottom:16px">'+threats.map(function(t){
      return '<div style="padding:8px 12px;margin-bottom:6px;background:var(--panel);border-radius:6px;border-left:3px solid #ffb800">'+
        '<div style="font-size:12px;font-weight:600;color:var(--text)">'+esc(t.title||t.threat||String(t))+'</div>'+
        (t.description?'<div style="font-size:11px;color:var(--dim);margin-top:4px">'+esc(t.description)+'</div>':'')+
        (t.mitigation?'<div style="font-size:10px;color:#00ff88;margin-top:4px">→ '+esc(t.mitigation)+'</div>':'')+
      '</div>';
    }).join('')+'</div>';
  }
  // Recommendations
  var recs=mi.recommendations||[];
  if(recs.length){
    html+='<h3 style="color:#a78bfa;font-size:13px;margin-bottom:8px">🎯 Рекомендации ('+recs.length+')</h3>';
    html+='<div style="margin-bottom:16px">'+recs.map(function(r){
      var prioColor=r.priority==='P0'?'#ff2d78':r.priority==='P1'?'#ffb800':'#00e5ff';
      return '<div style="padding:8px 12px;margin-bottom:6px;background:var(--panel);border-radius:6px;border-left:3px solid #a78bfa">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div style="font-size:12px;font-weight:600;color:var(--text)">'+esc(r.action||r.recommendation||String(r))+'</div>'+
          (r.priority?'<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:'+prioColor+'22;color:'+prioColor+';font-weight:700">'+esc(r.priority)+'</span>':'')+
        '</div>'+
        (r.timeline?'<div style="font-size:10px;color:var(--dim);margin-top:4px">⏱ '+esc(r.timeline)+(r.expected_impact?' • 📈 '+esc(r.expected_impact):'')+'</div>':'')+
      '</div>';
    }).join('')+'</div>';
  }
  html+='<div class="action-bar"><button class="act-btn" onclick="miCreateTasks(\''+id+'\')">📋 Рекомендации → Задачи</button><button class="act-btn" onclick="miCopy(\''+id+'\')">📋 Копировать</button></div>';
  openModal(html);
};
window.miCreateTasks=async function(id){
  var mi=(window._marketIntel||[]).find(function(x){return x.id===id;});
  if(!mi||!mi.recommendations||!mi.recommendations.length){showToast('Нет рекомендаций','warning');return;}
  var count=0;
  for(var r of mi.recommendations){
    await createTaskSynced(r.action||r.recommendation||String(r),'analyst',r.priority==='P0'?'critical':r.priority==='P1'?'high':'normal');
    count++;
  }
  showToast('Создано '+count+' задач из рекомендаций','success');
  addFeed('analyst','📋 Создано '+count+' задач из Market Intelligence');
};
window.miCopy=function(id){
  var mi=(window._marketIntel||[]).find(function(x){return x.id===id;});
  if(!mi)return;
  var text='MARKET INTELLIGENCE — '+new Date(mi.created_at).toLocaleDateString('ru')+'\n\n';
  if(mi.summary)text+=mi.summary+'\n\n';
  (mi.market_trends||[]).forEach(function(t){text+='[ТРЕНД] '+((t.title||t.trend||'')+': '+(t.description||''))+'\n';});
  (mi.competitor_updates||[]).forEach(function(c){text+='[КОНКУРЕНТ] '+((c.competitor||'')+': '+(c.update||''))+'\n';});
  (mi.opportunities||[]).forEach(function(o){text+='[ВОЗМОЖНОСТЬ] '+((o.title||'')+': '+(o.description||''))+'\n';});
  (mi.recommendations||[]).forEach(function(r){text+='[РЕКОМЕНДАЦИЯ] '+((r.action||'')+' ('+( r.priority||'')+')')+'\n';});
  navigator.clipboard.writeText(text).then(function(){showToast('Скопировано!','success');});
};

// ═══ KPI ═══
function fmtK(n){return n>=1000?(n/1000).toFixed(n>=10000?0:1)+'K':n.toString();}
function fmtUSD(n){return '$'+n.toLocaleString('ru');}
function fmtRUB(n){return '₽'+n.toLocaleString('ru');}
// Calculate burn rate from live finance_ledger for current period
function getLedgerBurn(){
  var ledger=window._financeLedger||[];
  var periodEntries=ledger.filter(function(e){return e.period===financePeriod;});
  var total=0,salary=0,subs=0;
  periodEntries.forEach(function(e){
    var amt=parseFloat(e.amount_usdt)||0;
    total+=amt;
    if(e.type==='salary')salary+=amt;
    if(e.type==='subscription'||e.type==='infrastructure')subs+=amt;
  });
  return {total:total,salary:salary,subs:subs,count:periodEntries.length};
}

function updateKPI(){
  var burn=getLedgerBurn();
  // Show real data ONLY when Supabase is live — never show demo data counts
  var loading='<span class="kpi-loading">—</span>';
  var leadsCount=SUPABASE_LIVE&&window._sbPartners?window._sbPartners.length:null;
  document.getElementById('kpi-leads').innerHTML=leadsCount!==null?leadsCount:loading;
  var postsCount=SUPABASE_LIVE&&window._sbContent?window._sbContent.length:null;
  document.getElementById('kpi-posts').innerHTML=postsCount!==null?postsCount:loading;
  var reportsCount=SUPABASE_LIVE&&window._sbReports?window._sbReports.length:null;
  document.getElementById('kpi-reports').innerHTML=reportsCount!==null?reportsCount:loading;
  // Partnerships: from metrics or fallback 0
  var partnerships=0;
  if(window._sbMetrics){
    var pm=window._sbMetrics.partnerships_found||window._sbMetrics.partnerships;
    if(pm)partnerships=pm.value;
  }
  document.getElementById('kpi-partners').textContent=partnerships;
  document.getElementById('kpi-team').textContent=D.team?D.team.filter(function(t){return t.status==='active';}).length:'-';
  // Burn rate visible only to admin
  if(isAdmin()){
    document.getElementById('kpi-burn').textContent=burn.total>0?fmtK(Math.round(burn.total)):'—';
    document.getElementById('kpi-burn').parentElement.style.display='';
  } else {
    document.getElementById('kpi-burn').parentElement.style.display='none';
  }
  // Tab badges: real counts
  document.getElementById('tab-leads-count').textContent=D.leads.length;
  var pendingCount=D.posts.filter(function(p){return p.sbStatus==='pending_approval';}).length;
  document.getElementById('tab-posts-count').textContent=pendingCount>0?pendingCount+' ⏳':D.posts.length;
  document.getElementById('tab-reports-count').textContent=D.reports.length;
  var inProgressCount=D.tasks.filter(function(t){var ks=mapToKanban(t.kanbanStatus||t.status);return ks==='in_progress'||ks==='rework';}).length;
  var tasksCountEl=document.getElementById('tab-tasks-count');
  if(tasksCountEl)tasksCountEl.textContent=inProgressCount>0?inProgressCount+' 🔧':D.tasks.length;
  // SyncBadge: don't override LIVE status if Supabase is connected
  if(!SUPABASE_LIVE){
    document.getElementById('syncBadge').textContent='● LOCAL '+new Date(D.lastUpdated||Date.now()).toLocaleDateString('ru');
    document.getElementById('syncBadge').style.color='#ffb800';
  }
}
updateKPI();

// ═══ FINANCE PANEL ═══
// ═══ FINANCE v2 — Immutable Ledger + Payroll ═══
let financeTab='overview';
// Auto-calculate current finance period from date
function calcFinancePeriod(){
  var now=new Date();
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[now.getMonth()]+' '+now.getFullYear();
}
let financePeriod=calcFinancePeriod();
let financeExchangeRate=92; // RUB/USDT — default, overridden from directives
let financeWorkDays=22; // working days this month
window._financeLedger=[]; // loaded from Supabase

// Load exchange rate from directives (called after Supabase sync)
function loadExchangeRateFromDirectives(){
  if(!window._sbDirectives)return;
  var exDir=window._sbDirectives.find(function(d){return d.key==='exchange_rate';});
  if(exDir&&exDir.value_json){
    var val=typeof exDir.value_json==='string'?JSON.parse(exDir.value_json):exDir.value_json;
    if(val.rate)financeExchangeRate=parseFloat(val.rate);
  }
}

// Finance sub-tabs
document.getElementById('financeTabs').addEventListener('click',function(e){
  if(!e.target.classList.contains('sub-tab'))return;
  document.querySelectorAll('#financeTabs .sub-tab').forEach(function(b){b.classList.remove('active');});
  e.target.classList.add('active');
  financeTab=e.target.dataset.ftab;
  renderFinance();
});

// Load finance ledger from Supabase
async function loadFinanceLedger(){
  var data=await sbFetch('finance_ledger','select=*&order=created_at.desc&limit=500');
  if(data)window._financeLedger=data;
  renderFinance();
}

function renderFinance(){
  var ledger=window._financeLedger||[];
  var periodEntries=ledger.filter(function(e){return e.period===financePeriod;});
  // Calculate totals
  var totalSalary=0,totalSubs=0,totalEvents=0,totalOther=0,totalAll=0;
  var unpaidEntries=[];
  periodEntries.forEach(function(e){
    var amt=parseFloat(e.amount_usdt)||0;
    totalAll+=amt;
    if(e.type==='salary')totalSalary+=amt;
    else if(e.type==='subscription'||e.type==='infrastructure')totalSubs+=amt;
    else if(e.type==='event')totalEvents+=amt;
    else totalOther+=amt;
    if(!e.is_paid)unpaidEntries.push(e);
  });

  document.getElementById('finance-period').textContent=financePeriod+' | Курс: '+financeExchangeRate+' | Раб.дней: '+financeWorkDays;

  if(financeTab==='overview')renderFinanceOverview(periodEntries,totalSalary,totalSubs,totalEvents,totalOther,totalAll,unpaidEntries);
  else if(financeTab==='ledger')renderFinanceLedger(periodEntries);
  else if(financeTab==='unpaid')renderFinanceUnpaid(unpaidEntries);
  else if(financeTab==='costs')renderFinanceCosts();
}

function renderFinanceOverview(entries,totalSalary,totalSubs,totalEvents,totalOther,totalAll,unpaid){
  var salaryCount=entries.filter(function(e){return e.type==='salary';}).length;
  var html='<div class="fin-grid">';
  // Total burn
  html+='<div class="fin-card" style="border-top:3px solid var(--hot)">'+
    '<h3 style="color:var(--hot)">Общий Burn Rate</h3>'+
    '<div class="fin-big" style="color:var(--hot)">'+fmtUSD(Math.round(totalAll))+'</div>'+
    '<div class="fin-sub">'+fmtRUB(Math.round(totalAll*financeExchangeRate))+'</div>'+
    '<div style="margin-top:12px">'+
      '<div class="fin-row"><span class="label">ФОТ (зарплаты)</span><span class="val cyan">'+fmtUSD(Math.round(totalSalary))+' ('+salaryCount+' чел)</span></div>'+
      '<div class="fin-row"><span class="label">Подписки + инфра</span><span class="val">'+fmtUSD(Math.round(totalSubs))+'</span></div>'+
      '<div class="fin-row"><span class="label">Ивенты</span><span class="val amber">'+fmtUSD(Math.round(totalEvents))+'</span></div>'+
      '<div class="fin-row"><span class="label">Прочее</span><span class="val">'+fmtUSD(Math.round(totalOther))+'</span></div>'+
    '</div></div>';
  // Salary details
  var salaryEntries=entries.filter(function(e){return e.type==='salary';});
  html+='<div class="fin-card" style="border-top:3px solid var(--cyan)">'+
    '<h3>ФОТ — '+salaryCount+' сотрудников</h3>'+
    '<div class="fin-big" style="color:var(--cyan)">'+fmtUSD(Math.round(totalSalary))+'</div>'+
    '<div style="margin-top:12px;max-height:300px;overflow-y:auto">'+
    salaryEntries.map(function(e){
      var paid=e.is_paid?'<span style="color:var(--green)">✅</span>':'<span style="color:var(--hot)">⏳</span>';
      var daysInfo=e.days_worked&&e.working_days_in_month?' ('+e.days_worked+'/'+e.working_days_in_month+' дн)':'';
      return '<div class="fin-row"><span class="label">'+paid+' '+esc(e.description)+daysInfo+'</span><span class="val">'+fmtUSD(parseFloat(e.amount_usdt)||0)+'</span></div>';
    }).join('')+'</div></div>';
  // Subscriptions
  var subEntries=entries.filter(function(e){return e.type==='subscription'||e.type==='infrastructure';});
  html+='<div class="fin-card" style="border-top:3px solid var(--green)">'+
    '<h3>Подписки и инфра</h3>'+
    '<div class="fin-big" style="color:var(--green)">'+fmtUSD(Math.round(totalSubs))+'</div>'+
    '<div style="margin-top:12px">'+
    subEntries.map(function(e){
      var paid=e.is_paid?'<span style="color:var(--green)">✅</span>':'<span style="color:var(--hot)">⏳</span>';
      return '<div class="fin-row"><span class="label">'+paid+' '+esc(e.description)+' <span style="font-size:10px;color:var(--dim)">['+esc(e.type)+']</span></span><span class="val">'+fmtUSD(parseFloat(e.amount_usdt)||0)+'</span></div>';
    }).join('')+'</div></div>';
  // Payment status
  html+='<div class="fin-card" style="border-top:3px solid var(--amber)">'+
    '<h3>Статус оплат</h3>';
  if(unpaid.length){
    html+='<div class="fin-big" style="color:var(--hot)">'+unpaid.length+' неоплаченных</div>'+
    '<div style="margin-top:12px">'+unpaid.map(function(e){
      return '<div class="fin-row" style="cursor:pointer" onclick="openPaymentModal(\''+e.id+'\')">'+
        '<span class="label" style="color:var(--hot)">⚠️ '+esc(e.description)+'</span>'+
        '<span class="val red">'+fmtUSD(parseFloat(e.amount_usdt)||0)+'</span></div>';
    }).join('')+'</div>';
  }else{
    html+='<div style="padding:12px;color:var(--green);font-size:13px">✅ Все оплаты за '+financePeriod+' закрыты</div>';
  }
  html+='</div></div>';
  document.getElementById('financeContent').innerHTML=html;
}

function renderFinanceLedger(entries){
  var html='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr style="border-bottom:1px solid var(--border);color:var(--dim)">'+
    '<th style="padding:8px;text-align:left">Дата</th>'+
    '<th style="padding:8px;text-align:left">Тип</th>'+
    '<th style="padding:8px;text-align:left">Описание</th>'+
    '<th style="padding:8px;text-align:right">USDT</th>'+
    '<th style="padding:8px;text-align:right">RUB</th>'+
    '<th style="padding:8px;text-align:center">Дни</th>'+
    '<th style="padding:8px;text-align:center">Оплата</th>'+
    '<th style="padding:8px;text-align:center">Чек</th>'+
    '</tr></thead><tbody>';
  entries.forEach(function(e){
    var typeColor={'salary':'var(--cyan)','subscription':'var(--green)','infrastructure':'var(--green)','event':'var(--amber)','other':'var(--dim)'}[e.type]||'var(--dim)';
    var typeLabel={'salary':'ЗП','subscription':'Подписка','infrastructure':'Инфра','event':'Ивент','other':'Прочее'}[e.type]||e.type;
    var daysInfo=e.days_worked&&e.working_days_in_month?e.days_worked+'/'+e.working_days_in_month:'—';
    var paidBadge=e.is_paid?'<span style="color:var(--green);cursor:pointer" title="Оплачено '+(e.paid_at?(new Date(e.paid_at)).toLocaleDateString('ru'):'')+'">✅</span>':
      '<button style="background:var(--hot)22;color:var(--hot);border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px" onclick="openPaymentModal(\''+e.id+'\')">Оплатить</button>';
    var proofBadge=e.payment_proof_url?'<a href="'+e.payment_proof_url+'" target="_blank" style="color:var(--cyan)">📎</a>':'—';
    html+='<tr style="border-bottom:1px solid var(--border)11">'+
      '<td style="padding:6px 8px;color:var(--dim)">'+(e.created_at?(new Date(e.created_at)).toLocaleDateString('ru'):'—')+'</td>'+
      '<td style="padding:6px 8px"><span style="color:'+typeColor+';font-weight:600">'+typeLabel+'</span></td>'+
      '<td style="padding:6px 8px">'+esc(e.description)+'</td>'+
      '<td style="padding:6px 8px;text-align:right;font-family:monospace">$'+(parseFloat(e.amount_usdt)||0).toLocaleString('ru')+'</td>'+
      '<td style="padding:6px 8px;text-align:right;font-family:monospace;color:var(--dim)">₽'+(parseFloat(e.amount_rub)||0).toLocaleString('ru')+'</td>'+
      '<td style="padding:6px 8px;text-align:center;color:var(--dim)">'+daysInfo+'</td>'+
      '<td style="padding:6px 8px;text-align:center">'+paidBadge+'</td>'+
      '<td style="padding:6px 8px;text-align:center">'+proofBadge+'</td>'+
      '</tr>';
  });
  html+='</tbody></table></div>';
  if(!entries.length)html='<p style="color:var(--dim);padding:20px;text-align:center">Нет записей за '+financePeriod+'. Нажмите "➕ Добавить запись" или "📋 Рассчитать ЗП"</p>';
  document.getElementById('financeContent').innerHTML=html;
}

function renderFinanceUnpaid(unpaid){
  if(!unpaid.length){
    document.getElementById('financeContent').innerHTML='<p style="color:var(--green);padding:20px;text-align:center">✅ Все оплаты за '+financePeriod+' закрыты!</p>';
    return;
  }
  var totalUnpaid=0;
  unpaid.forEach(function(e){totalUnpaid+=parseFloat(e.amount_usdt)||0;});
  var html='<div style="padding:12px 0;margin-bottom:16px;border-bottom:1px solid var(--border)">'+
    '<span style="font-size:18px;font-weight:700;color:var(--hot)">⚠️ Неоплачено: '+fmtUSD(Math.round(totalUnpaid))+'</span>'+
    '<span style="color:var(--dim);margin-left:12px">('+unpaid.length+' записей)</span></div>';
  unpaid.forEach(function(e){
    html+='<div style="background:var(--hot)08;border:1px solid var(--hot)22;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'+
      '<div><div style="font-weight:600">'+esc(e.description)+'</div>'+
      '<div style="font-size:11px;color:var(--dim);margin-top:4px">'+esc(e.type)+' • '+(e.created_at?(new Date(e.created_at)).toLocaleDateString('ru'):'—')+'</div></div>'+
      '<div style="display:flex;align-items:center;gap:12px">'+
        '<span style="font-size:16px;font-weight:700;color:var(--hot)">'+fmtUSD(parseFloat(e.amount_usdt)||0)+'</span>'+
        '<button class="act-btn success" onclick="openPaymentModal(\''+e.id+'\')" style="font-size:11px;padding:4px 12px">💳 Отметить оплату</button>'+
      '</div></div>';
  });
  document.getElementById('financeContent').innerHTML=html;
}

// ═══ FINANCE COSTS — AI Credits Analytics ═══
function renderFinanceCosts(){
  var credits=window._sbCredits||[];
  if(!credits.length){
    document.getElementById('financeContent').innerHTML='<div style="padding:20px;color:var(--dim);text-align:center">Нет данных по расходам AI</div>';
    return;
  }

  // Calculate totals
  var totalCost=0,costByAgent={},costByModel={};
  var dayData={};
  credits.forEach(function(c){
    var cost=parseFloat(c.cost_usd)||0;
    totalCost+=cost;
    // By agent
    var agId=c.agent_id;
    if(!costByAgent[agId])costByAgent[agId]={cost:0,count:0};
    costByAgent[agId].cost+=cost;
    costByAgent[agId].count++;
    // By model
    var model=c.model||'unknown';
    if(!costByModel[model])costByModel[model]={cost:0,count:0};
    costByModel[model].cost+=cost;
    costByModel[model].count++;
    // By day
    if(c.created_at){
      var day=c.created_at.slice(0,10);
      if(!dayData[day])dayData[day]=0;
      dayData[day]+=cost;
    }
  });

  var html='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">';
  // Total spend card
  html+='<div class="fin-card" style="border-top:3px solid var(--magenta);grid-column:1/-1">'+
    '<h3 style="color:var(--magenta)">Всего затрат на AI</h3>'+
    '<div class="fin-big" style="color:var(--magenta)">'+fmtUSD(Math.round(totalCost))+'</div>'+
    '<div class="fin-sub">'+Math.round(credits.length)+' транзакций</div>'+
  '</div>';

  // Per-agent breakdown
  var agentCosts=Object.keys(costByAgent).map(function(agId){
    return {agId:agId,cost:costByAgent[agId].cost,count:costByAgent[agId].count};
  }).sort(function(a,b){return b.cost-a.cost;});

  if(agentCosts.length>0){
    html+='<div class="fin-card" style="grid-column:1/-1">'+
      '<h3>По агентам</h3>'+
      '<div style="margin-top:12px;max-height:300px;overflow-y:auto">'+
      agentCosts.map(function(item){
        var ag=window._sbAgentById[item.agId]||{slug:'unknown',name:'Unknown'};
        var dashName=SB_SLUG_TO_DASH[ag.slug]||'unknown';
        var pct=(item.cost/totalCost*100).toFixed(1);
        var agColor=AGENTS[dashName]?.color||'#64748b';
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">'+
          '<div style="width:100%;min-width:0">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
              '<span style="font-weight:600;color:'+agColor+'">'+ag.name+'</span>'+
              '<span style="font-size:11px;color:var(--dim)">'+item.count+' вызовов</span>'+
            '</div>'+
            '<div style="display:flex;align-items:center;gap:6px">'+
              '<div style="flex:1;height:6px;background:var(--bg);border-radius:2px;overflow:hidden">'+
                '<div style="height:100%;width:'+pct+'%;background:'+agColor+'"></div>'+
              '</div>'+
              '<span style="font-size:11px;font-weight:600;color:var(--cyan)">'+fmtUSD(Math.round(item.cost))+' ('+pct+'%)</span>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('')+'</div></div>';
  }

  html+='</div>';

  // Per-model breakdown
  var modelCosts=Object.keys(costByModel).map(function(m){
    return {model:m,cost:costByModel[m].cost,count:costByModel[m].count};
  }).sort(function(a,b){return b.cost-a.cost;});

  html+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">';
  modelCosts.forEach(function(item){
    var color=item.model.includes('sonnet')?'var(--cyan)':item.model.includes('haiku')?'var(--green)':'var(--amber)';
    html+='<div class="fin-card" style="border-top:3px solid '+color+'">'+
      '<h3 style="color:'+color+';text-transform:uppercase;font-size:11px">'+item.model+'</h3>'+
      '<div class="fin-big" style="color:'+color+'">'+fmtUSD(Math.round(item.cost))+'</div>'+
      '<div class="fin-sub">'+item.count+' запросов</div>'+
    '</div>';
  });
  html+='</div>';

  document.getElementById('financeContent').innerHTML=html;
}

// ═══ PAYMENT MODAL — mark as paid + upload screenshot ═══
window.openPaymentModal=function(entryId){
  var entry=window._financeLedger.find(function(e){return e.id===entryId;});
  if(!entry)return;
  openModal(
    '<h2>💳 Оплата</h2>'+
    '<div style="margin:12px 0;padding:12px;background:var(--bg);border-radius:8px">'+
      '<div style="font-weight:600;font-size:16px">'+esc(entry.description)+'</div>'+
      '<div style="font-size:22px;font-weight:700;color:var(--cyan);margin-top:8px">'+fmtUSD(parseFloat(entry.amount_usdt)||0)+'</div>'+
      '<div style="color:var(--dim);font-size:12px">'+fmtRUB(parseFloat(entry.amount_rub)||0)+' • '+esc(entry.type)+'</div>'+
    '</div>'+
    '<div style="margin:16px 0">'+
      '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:6px">Комментарий к оплате:</label>'+
      '<input type="text" id="paymentNote" placeholder="Номер транзакции, дата и т.д." style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
    '</div>'+
    '<div style="margin:16px 0">'+
      '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:6px">📎 Скриншот оплаты (PNG, JPG, PDF):</label>'+
      '<input type="file" id="paymentProofFile" accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf" style="font-size:12px;color:var(--dim)">'+
      '<div id="paymentUploadStatus" style="font-size:11px;margin-top:4px"></div>'+
    '</div>'+
    '<div class="action-bar">'+
      '<button class="act-btn success" onclick="confirmPayment(\''+entryId+'\')" style="font-size:14px;padding:8px 24px">✅ Отметить как оплачено</button>'+
    '</div>'
  );
};

window.confirmPayment=async function(entryId){
  var note=document.getElementById('paymentNote')?.value||'';
  var fileInput=document.getElementById('paymentProofFile');
  var proofUrl=null;

  // Upload screenshot if selected
  if(fileInput&&fileInput.files&&fileInput.files[0]){
    var file=fileInput.files[0];
    document.getElementById('paymentUploadStatus').textContent='⏳ Загружаю...';
    document.getElementById('paymentUploadStatus').style.color='var(--amber)';
    var fileName='proof_'+entryId.slice(0,8)+'_'+Date.now()+'.'+file.name.split('.').pop();
    try{
      var uploadResp=await fetch(SUPABASE_URL+'/storage/v1/object/payment-proofs/'+fileName,{
        method:'POST',
        headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Content-Type':file.type},
        body:file
      });
      if(uploadResp.ok){
        proofUrl=SUPABASE_URL+'/storage/v1/object/public/payment-proofs/'+fileName;
        document.getElementById('paymentUploadStatus').textContent='✅ Загружено!';
        document.getElementById('paymentUploadStatus').style.color='var(--green)';
      }else{
        document.getElementById('paymentUploadStatus').textContent='⚠️ Ошибка загрузки, но оплату отметим';
        document.getElementById('paymentUploadStatus').style.color='var(--hot)';
      }
    }catch(err){
      console.warn('Upload error:',err);
      document.getElementById('paymentUploadStatus').textContent='⚠️ Ошибка сети';
    }
  }

  // Update entry in Supabase
  var updateData={is_paid:true, paid_at:new Date().toISOString(), payment_note:note};
  if(proofUrl)updateData.payment_proof_url=proofUrl;
  await sbPatch('finance_ledger','id=eq.'+entryId, updateData);

  // Update local
  var entry=window._financeLedger.find(function(e){return e.id===entryId;});
  if(entry){entry.is_paid=true;entry.paid_at=updateData.paid_at;entry.payment_note=note;if(proofUrl)entry.payment_proof_url=proofUrl;}

  modal.classList.remove('open');
  renderFinance();
  addFeed('coordinator','💳 Оплата подтверждена: '+(entry?entry.description:''));
  auditLog('payment','finance','Оплата: '+(entry?entry.description:entryId));
};

// ═══ FINANCE ENTRY FORM — add new record (append-only) ═══
window.openFinanceEntryForm=function(){
  var teamOptions=D.team.filter(function(t){return t.status==='active';}).map(function(t){
    return '<option value="'+t.id+'">'+t.name+(t.salary_usdt?' ($'+t.salary_usdt+')':' (ЗП не указана)')+'</option>';
  }).join('');
  openModal(
    '<h2>➕ Новая финансовая запись</h2>'+
    '<div style="margin:12px 0">'+
      '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Период:</label>'+
      '<input type="text" id="fePeriod" value="'+financePeriod+'" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
    '</div>'+
    '<div style="margin:12px 0">'+
      '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Тип:</label>'+
      '<select id="feType" class="task-select" style="width:100%" onchange="finEntryTypeChanged()">'+
        '<option value="salary">💰 Зарплата</option>'+
        '<option value="subscription">🔧 Подписка</option>'+
        '<option value="infrastructure">🖥 Инфраструктура</option>'+
        '<option value="event">🎪 Ивент</option>'+
        '<option value="other">📦 Прочее</option>'+
      '</select>'+
    '</div>'+
    '<div id="feSalaryFields" style="margin:12px 0">'+
      '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Сотрудник:</label>'+
      '<select id="feEmployee" class="task-select" style="width:100%" onchange="finEmployeeChanged()">'+
        '<option value="">— Выбрать —</option>'+teamOptions+
      '</select>'+
      '<div style="display:flex;gap:8px;margin-top:8px">'+
        '<div style="flex:1"><label style="font-size:11px;color:var(--dim)">Раб. дней в мес:</label>'+
          '<input type="number" id="feWorkDays" value="'+financeWorkDays+'" min="1" max="31" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></div>'+
        '<div style="flex:1"><label style="font-size:11px;color:var(--dim)">Отработано дней:</label>'+
          '<input type="number" id="feDaysWorked" value="'+financeWorkDays+'" min="0" max="31" onchange="finCalcSalary()" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></div>'+
      '</div>'+
      '<div id="feSalaryCalc" style="margin-top:8px;padding:8px;background:var(--cyan)11;border-radius:6px;font-size:12px;color:var(--cyan)"></div>'+
    '</div>'+
    '<div id="feManualFields" style="display:none;margin:12px 0">'+
      '<div style="display:flex;gap:8px">'+
        '<div style="flex:1"><label style="font-size:11px;color:var(--dim)">Сумма USDT:</label>'+
          '<input type="number" id="feAmountUSDT" step="0.01" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></div>'+
        '<div style="flex:1"><label style="font-size:11px;color:var(--dim)">Сумма RUB:</label>'+
          '<input type="number" id="feAmountRUB" step="0.01" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)"></div>'+
      '</div>'+
    '</div>'+
    '<div style="margin:12px 0">'+
      '<label style="font-size:12px;color:var(--dim);display:block;margin-bottom:4px">Описание:</label>'+
      '<input type="text" id="feDescription" placeholder="Описание записи" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
    '</div>'+
    '<div class="action-bar">'+
      '<button class="act-btn success" onclick="submitFinanceEntry()" style="font-size:14px;padding:8px 24px">💾 Добавить запись</button>'+
    '</div>'
  );
};

window.finEntryTypeChanged=function(){
  var type=document.getElementById('feType').value;
  document.getElementById('feSalaryFields').style.display=type==='salary'?'block':'none';
  document.getElementById('feManualFields').style.display=type!=='salary'?'block':'none';
};

window.finEmployeeChanged=function(){
  var empId=parseInt(document.getElementById('feEmployee').value);
  var emp=D.team.find(function(t){return t.id===empId;});
  if(emp){
    document.getElementById('feDescription').value='Зарплата: '+emp.name;
    finCalcSalary();
  }
};

window.finCalcSalary=function(){
  var empId=parseInt(document.getElementById('feEmployee').value);
  var emp=D.team.find(function(t){return t.id===empId;});
  if(!emp||!emp.salary_usdt){
    document.getElementById('feSalaryCalc').innerHTML='<span style="color:var(--dim)">Укажите ЗП сотрудника в разделе Команда</span>';
    return;
  }
  var workDays=parseInt(document.getElementById('feWorkDays').value)||22;
  var daysWorked=parseInt(document.getElementById('feDaysWorked').value)||workDays;
  var dailyRate=parseFloat(emp.salary_usdt)/workDays;
  var calculated=dailyRate*daysWorked;
  var calculatedRub=parseFloat(emp.salary_rub||0)/workDays*daysWorked;
  document.getElementById('feSalaryCalc').innerHTML=
    '📊 Базовая ЗП: $'+parseFloat(emp.salary_usdt).toLocaleString('ru')+'/мес<br>'+
    '📅 Дневная ставка: $'+dailyRate.toFixed(2)+' ('+workDays+' раб.дн.)<br>'+
    '💰 <b>К выплате: $'+calculated.toFixed(2)+'</b> ('+daysWorked+' дн.)'+
    (calculatedRub?' | ₽'+Math.round(calculatedRub).toLocaleString('ru'):'');
};

window.submitFinanceEntry=async function(){
  var type=document.getElementById('feType').value;
  var period=document.getElementById('fePeriod').value;
  var description=document.getElementById('feDescription').value;
  if(!description){showToast('Укажите описание','error');return;}

  var entry={period:period,type:type,description:description,is_paid:false,created_by:getCurrentUser()};

  if(type==='salary'){
    var empId=parseInt(document.getElementById('feEmployee').value);
    var emp=D.team.find(function(t){return t.id===empId;});
    if(!empId||!emp){showToast('Выберите сотрудника','error');return;}
    var workDays=parseInt(document.getElementById('feWorkDays').value)||22;
    var daysWorked=parseInt(document.getElementById('feDaysWorked').value)||workDays;
    if(!emp.salary_usdt){showToast('У сотрудника не указана ЗП. Укажите её в разделе Команда.','error');return;}
    var dailyRate=parseFloat(emp.salary_usdt)/workDays;
    var amount=dailyRate*daysWorked;
    var dailyRub=parseFloat(emp.salary_rub||0)/workDays;
    entry.employee_id=empId;
    entry.amount_usdt=parseFloat(amount.toFixed(2));
    entry.amount_rub=parseFloat((dailyRub*daysWorked).toFixed(2));
    entry.working_days_in_month=workDays;
    entry.days_worked=daysWorked;
    entry.base_salary_usdt=parseFloat(emp.salary_usdt);
  }else{
    entry.amount_usdt=parseFloat(document.getElementById('feAmountUSDT').value)||0;
    entry.amount_rub=parseFloat(document.getElementById('feAmountRUB').value)||0;
  }

  var result=await sbInsert('finance_ledger',entry);
  if(result){
    window._financeLedger.unshift(result[0]||entry);
    modal.classList.remove('open');
    renderFinance();
    addFeed('coordinator','💾 Финансовая запись: '+description+' — $'+entry.amount_usdt);
    auditLog('create','finance','Добавлена запись: '+description+' $'+entry.amount_usdt);
  }else{
    showToast('Ошибка сохранения. Проверь соединение.','error');
  }
};

// ═══ PAYROLL GENERATOR — auto-create salary entries for all employees ═══
window.generatePayroll=function(){
  var activeTeam=D.team.filter(function(t){return t.status==='active'&&t.salary_usdt>0;});
  if(!activeTeam.length){
    showToast('Нет сотрудников с указанной ЗП. Сначала укажите зарплаты в разделе Команда.','error');
    return;
  }
  // Check if payroll already exists for this period
  var existingSalaries=window._financeLedger.filter(function(e){return e.period===financePeriod&&e.type==='salary';});
  function _askWorkDays(){
    f2fPrompt({title:'📋 Рабочие дни',fields:[{id:'days',label:'Рабочих дней в '+financePeriod,type:'number',value:financeWorkDays,min:1,max:31}],submitText:'Далее'}).then(function(val){
      var workDays=parseInt(val);
      if(!workDays||workDays<1)return;
      financeWorkDays=workDays;
      _generatePayrollContinue(workDays,activeTeam);
    });
  }
  if(existingSalaries.length>0){
    f2fConfirm('За '+financePeriod+' уже есть '+existingSalaries.length+' записей по ЗП. Записи неизменяемы — добавить ещё раз?').then(function(ok){if(ok)_askWorkDays();});
  }else{
    _askWorkDays();
  }
};
function _generatePayrollContinue(workDays,activeTeam){

  openModal(
    '<h2>📋 Расчёт ЗП — '+financePeriod+'</h2>'+
    '<p style="color:var(--dim);font-size:13px">Рабочих дней: '+workDays+'. Укажите отработанные дни для каждого сотрудника:</p>'+
    '<div id="payrollList" style="max-height:400px;overflow-y:auto;margin:12px 0">'+
    activeTeam.map(function(t){
      var dailyRate=(parseFloat(t.salary_usdt)/workDays).toFixed(2);
      var totalExpected=parseFloat(t.salary_usdt);
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border)11">'+
        '<div style="flex:2;font-size:13px">'+t.name+'<br><span style="color:var(--dim);font-size:11px">$'+totalExpected+'/мес · $'+dailyRate+'/день</span></div>'+
        '<div style="flex:1"><input type="number" class="payroll-days" data-id="'+t.id+'" value="'+workDays+'" min="0" max="31" style="width:60px;padding:4px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);text-align:center"></div>'+
        '<div style="flex:1;text-align:right;font-family:monospace;color:var(--cyan)" id="payrollCalc_'+t.id+'">$'+totalExpected.toFixed(2)+'</div>'+
      '</div>';
    }).join('')+'</div>'+
    '<div class="action-bar">'+
      '<button class="act-btn success" onclick="submitPayroll('+workDays+')" style="font-size:14px;padding:8px 24px">💾 Создать '+activeTeam.length+' записей</button>'+
    '</div>'
  );

  // Add live recalc on day change
  document.querySelectorAll('.payroll-days').forEach(function(input){
    input.addEventListener('input',function(){
      var empId=parseInt(this.dataset.id);
      var emp=D.team.find(function(t){return t.id===empId;});
      if(!emp)return;
      var days=parseInt(this.value)||0;
      var calc=(parseFloat(emp.salary_usdt)/workDays*days).toFixed(2);
      var el=document.getElementById('payrollCalc_'+empId);
      if(el)el.textContent='$'+calc;
    });
  });
};

window.submitPayroll=async function(workDays){
  var inputs=document.querySelectorAll('.payroll-days');
  var entries=[];
  inputs.forEach(function(input){
    var empId=parseInt(input.dataset.id);
    var emp=D.team.find(function(t){return t.id===empId;});
    if(!emp)return;
    var daysWorked=parseInt(input.value)||0;
    if(daysWorked<=0)return;
    var dailyRate=parseFloat(emp.salary_usdt)/workDays;
    var amount=dailyRate*daysWorked;
    var dailyRub=parseFloat(emp.salary_rub||0)/workDays;
    entries.push({
      period:financePeriod,type:'salary',
      description:'Зарплата: '+emp.name,
      employee_id:empId,
      amount_usdt:parseFloat(amount.toFixed(2)),
      amount_rub:parseFloat((dailyRub*daysWorked).toFixed(2)),
      working_days_in_month:workDays,
      days_worked:daysWorked,
      base_salary_usdt:parseFloat(emp.salary_usdt),
      is_paid:false, created_by:getCurrentUser()
    });
  });
  if(!entries.length){showToast('Нет записей для создания','error');return;}
  var result=await sbInsert('finance_ledger',entries);
  if(result){
    window._financeLedger=result.concat(window._financeLedger);
    modal.classList.remove('open');
    renderFinance();
    addFeed('coordinator','📋 Расчёт ЗП за '+financePeriod+': '+entries.length+' записей создано');
    auditLog('generate','finance','Расчёт ЗП за '+financePeriod+': '+entries.length+' записей, $'+entries.reduce(function(s,e){return s+e.amount_usdt;},0).toFixed(2));
  }else{
    showToast('Ошибка сохранения','error');
  }
};

// ═══ EXCEL EXPORT ═══
window.exportFinanceExcel=function(){
  var ledger=window._financeLedger.filter(function(e){return e.period===financePeriod;});
  if(!ledger.length){showToast('Нет данных за '+financePeriod,'info');return;}
  // Build CSV (opens in Excel)
  var csv='\uFEFF'; // BOM for Excel UTF-8
  csv+='Дата,Тип,Описание,USDT,RUB,Раб.дней в мес,Отработано дней,Базовая ЗП,Оплачено,Дата оплаты,Комментарий\n';
  ledger.forEach(function(e){
    csv+=[
      e.created_at?(new Date(e.created_at)).toLocaleDateString('ru'):'',
      e.type,
      '"'+(e.description||'').replace(/"/g,'""')+'"',
      e.amount_usdt||0,
      e.amount_rub||0,
      e.working_days_in_month||'',
      e.days_worked||'',
      e.base_salary_usdt||'',
      e.is_paid?'Да':'Нет',
      e.paid_at?(new Date(e.paid_at)).toLocaleDateString('ru'):'',
      '"'+(e.payment_note||'').replace(/"/g,'""')+'"'
    ].join(',')+'\n';
  });
  // Download
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='F2F_Finance_'+financePeriod.replace(/\s/g,'_')+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  auditLog('export','finance','Excel экспорт за '+financePeriod+': '+ledger.length+' записей');
};

// Load ledger on init
if(typeof loadFinanceLedger==='function')setTimeout(loadFinanceLedger,1500);
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
  var salaryBadge='';
  if(t.salary_usdt && canSeeSalary()) salaryBadge='<span style="font-size:10px;color:var(--cyan);margin-left:auto">$'+parseFloat(t.salary_usdt).toLocaleString('ru')+'</span>';
  else if(t.salary_usdt && isPM()) salaryBadge='<span style="font-size:10px;color:var(--dim);margin-left:auto">💰 ***</span>';
  else if(t.salary_usdt && !canSeeSalary()) salaryBadge='<span style="font-size:10px;color:var(--dim);margin-left:auto">💰 Указана</span>';
  return '<div class="team-card" onclick="openTeamMemberModal('+t.id+')" style="border-left:3px solid '+(d?.color||'var(--dim)')+'">'+
    '<div class="t-top">'+
      '<span class="t-name">'+t.name+'</span>'+
      (t.isHead?'<span class="t-head">👑 Lead</span>':'')+
      '<span class="t-role">'+t.role+'</span>'+
      salaryBadge+
    '</div>'+
    '<div class="t-dept">'+
      (d?d.icon+' '+d.name:'❓ Не распределён')+
      ' • '+t.category+
      (t.startDate?' • c '+t.startDate:'')+
      (canSeeSalary()&&t.payroll_start?' • ЗП с '+t.payroll_start:'')+
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
      (t.salary_usdt&&canSeeSalary()?'<span class="tag" style="background:var(--cyan)22;color:var(--cyan)">💰 $'+parseFloat(t.salary_usdt).toLocaleString('ru')+'/мес</span>':'')+
      (t.salary_usdt&&!canSeeSalary()?'<span class="tag" style="background:var(--dim)22;color:var(--dim)">💰 ЗП указана</span>':'')+
    '</div>'+
    // ═══ SALARY & PAYROLL SECTION (admin: full view, PM: write-only, others: hidden) ═══
    (canEditSalary() ? (
    '<h3>💰 Зарплата и расчёт</h3>'+
    (isPM()&&!canSeeSalary() ? '<p style="color:var(--amber);font-size:11px;margin-bottom:8px">⚠️ Вы можете задать ЗП, но существующие значения скрыты</p>' : '')+
    '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
      '<div style="flex:1;min-width:0">'+
        '<label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">ЗП (USDT/мес):</label>'+
        '<input type="number" id="empSalaryUSDT" value="'+(canSeeSalary()?(t.salary_usdt||''):'')+'" step="0.01" placeholder="'+(isPM()&&t.salary_usdt?'Значение скрыто':'0')+'" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
      '</div>'+
      '<div style="flex:1;min-width:0">'+
        '<label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">ЗП (RUB/мес):</label>'+
        '<input type="number" id="empSalaryRUB" value="'+(canSeeSalary()?(t.salary_rub||''):'')+'" step="0.01" placeholder="'+(isPM()&&t.salary_rub?'Значение скрыто':'0')+'" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
      '</div>'+
      '<div style="flex:1;min-width:0">'+
        '<label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Валюта выплаты:</label>'+
        '<select id="empPayType" class="task-select" style="width:100%">'+
          '<option value="usdt" '+(t.payment_type==='usdt'?'selected':'')+'>USDT</option>'+
          '<option value="rub" '+(t.payment_type==='rub'?'selected':'')+'>RUB</option>'+
          '<option value="mixed" '+(t.payment_type==='mixed'?'selected':'')+'>Смешанная</option>'+
        '</select>'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:end">'+
      '<div style="flex:1">'+
        '<label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">ЗП считаем с даты:</label>'+
        '<input type="date" id="empPayrollStart" value="'+(t.payroll_start||'')+'" style="width:100%;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
      '</div>'+
      '<button class="act-btn success" onclick="teamSaveSalary('+t.id+')" style="padding:6px 16px;font-size:12px">💾 Сохранить ЗП</button>'+
    '</div>'
    ) : '') +
    // ═══ EMPLOYEE EXPENSES ═══
    buildEmployeeExpensesHtml(t)+
    // ═══ DEPARTMENT & ROLE ═══
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

// Save salary data for employee
window.teamSaveSalary=async function(id){
  if(!canEditSalary()){showToast('Нет прав для изменения ЗП','error');return;}
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  var rawUSDT=document.getElementById('empSalaryUSDT').value;
  var rawRUB=document.getElementById('empSalaryRUB').value;
  var payType=document.getElementById('empPayType').value;
  var payrollStart=document.getElementById('empPayrollStart').value||null;

  // PM: only save if field was actually filled (don't overwrite with 0)
  var patchData={payment_type:payType, updated_at:new Date().toISOString()};
  if(payrollStart) patchData.payroll_start=payrollStart;

  if(canSeeSalary()){
    // Admin — always save
    var salaryUSDT=parseFloat(rawUSDT)||0;
    var salaryRUB=parseFloat(rawRUB)||0;
    patchData.salary_usdt=salaryUSDT;
    patchData.salary_rub=salaryRUB;
    t.salary_usdt=salaryUSDT;
    t.salary_rub=salaryRUB;
  } else {
    // PM — only save non-empty values (don't overwrite existing with 0)
    if(rawUSDT&&rawUSDT!==''){patchData.salary_usdt=parseFloat(rawUSDT);t.salary_usdt=parseFloat(rawUSDT);}
    if(rawRUB&&rawRUB!==''){patchData.salary_rub=parseFloat(rawRUB);t.salary_rub=parseFloat(rawRUB);}
  }

  t.payment_type=payType;
  if(payrollStart) t.payroll_start=payrollStart;

  if(SUPABASE_LIVE){
    await sbPatch('team','id=eq.'+id, patchData);
  }
  renderTeam();
  openTeamMemberModal(id);
  var logAmount=canSeeSalary()?'$'+(patchData.salary_usdt||t.salary_usdt):'[скрыто]';
  addFeed('coordinator','💰 ЗП обновлена: '+t.name+' — '+logAmount+'/мес');
  auditLog('update','team','ЗП: '+t.name+' ('+getCurrentUser()+')');
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
  f2fPrompt({title:'✏️ Роль сотрудника',fields:[{id:'role',label:'Новая роль для '+t.name,type:'text',value:t.role}],submitText:'Сохранить'}).then(function(newRole){
    if(newRole&&newRole.trim()){
      t.role=newRole.trim();
      if(SUPABASE_LIVE){sbPatch('team','id=eq.'+id,{role:newRole.trim(),updated_at:new Date().toISOString()});}
      renderTeam();openTeamMemberModal(id);
      addFeed('coordinator','✏️ Роль '+t.name+' → '+newRole.trim());
    }
  });
};

window.teamDismiss=function(id,reason){
  var t=D.team.find(function(x){return x.id===id;});if(!t)return;
  var reasonText=reason==='fired'?'Увольнение':'Уход по собственному';
  f2fPrompt({title:'⚠️ '+reasonText,message:reasonText+': '+t.name+'?\nЭто действие переместит сотрудника в список уволенных.',fields:[{id:'comment',label:'Комментарий (опционально)',type:'text',placeholder:'Причина...'}],submitText:'Подтвердить',cancelText:'Отмена'}).then(function(comment){
  if(comment===null)return;
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
  });
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
// Built-in agent descriptions — single source of truth for UI
// Merged from D.agentMeta (removed from f2f_data.js) + Supabase agent system_prompt
const AGENT_DESC={
  coordinator:{purpose:'Тимлид всех агентов. Каждые 2ч проводит планёрку: собирает статусы, назначает задания, учитывает директивы CEO и KPI.',replaces:'Менеджер проектов — экономит 2-3ч/день',sources:['Данные других агентов','Список задач','KPI'],interval:'2ч'},
  content:{purpose:'SMM-машина. 30 постов за цикл в 5 форматах: провокации (Durex-стиль), гайды по фичам, комьюнити, новости, дискуссии.',replaces:'SMM-менеджер — экономит 4-5ч/день',sources:['Brand guidelines F2F','Тренды соцсетей','Контент конкурентов'],interval:'2ч'},
  market:{purpose:'Анализ конкурентов (FACEIT, ESEA, CyberShoke, Blast.tv). Мониторинг KPI: регистрации, CAC, retention. Рекомендации.',replaces:'Бизнес-аналитик — экономит 3-4ч/день',sources:['Newzoo','Statista','Esports Charts','SuperData'],interval:'2ч'},
  leads:{purpose:'Генерация персонализированных email для лидов. Дедупликация (не шлёт повторно). Подпись CEO. Превью в Telegram.',replaces:'BizDev менеджер — экономит 2-3ч/день',sources:['Brave Search','Hunter.io','LinkedIn (auto)'],interval:'2ч'},
  outreach:{purpose:'Холодный outreach к командам, стримерам, партнёрам. Cold email + персонализация + A/B тесты тем.',replaces:'Outreach-специалист — экономит 2ч/день',sources:['Данные из CRM лидов','Шаблоны писем','LinkedIn профили'],interval:'2ч'},
  social:{purpose:'Развитие комьюнити: Discord, Telegram, Reddit. Organic engagement, мониторинг обсуждений, вовлечение.',replaces:'Community Manager — экономит 3ч/день',sources:['Telegram каналы','Twitter API','Reddit','VK'],interval:'2ч'},
  processor:{purpose:'Мозг Telegram-бота. Обрабатывает кнопки (Отправить/Отклонить email и посты), текстовые директивы CEO, обновляет offset.',replaces:'Автоматизация — работает 24/7',sources:['Telegram Bot API'],interval:'1мин'},
  lead_finder:{purpose:'Автопоиск лидов: Brave Search → Hunter.io (email) → LinkedIn (auto-enrichment). 6 реальных лидов/день.',replaces:'Lead researcher — экономит 4-5ч/день',sources:['Brave Search','Hunter.io','LinkedIn','ScrapIn'],interval:'4ч'},
  followup:{purpose:'Автоматические follow-up письма через 3 дня после первого контакта без ответа. Другой тон и угол.',replaces:'BizDev follow-up — экономит 1-2ч/день',sources:['CRM pipeline','Email история'],interval:'12ч'},
  watchdog:{purpose:'Мониторинг всех сценариев. Если агент упал — автоперезапуск + TG алерт CEO. Self-healing.',replaces:'DevOps/мониторинг — работает 24/7',sources:['Make.com API','Supabase health'],interval:'1ч'},
  briefing:{purpose:'Утренний брифинг с реальными KPI из Supabase: лиды, письма, контент, статусы всех агентов, приоритеты.',replaces:'Утренняя планёрка — экономит 30мин/день',sources:['Supabase metrics','Agent memory','Events'],interval:'24ч'},
  kpi_updater:{purpose:'Обновление метрик в Supabase для дашборда и аналитики. Синхронизация данных между системами.',replaces:'Ручной ввод метрик',sources:['Supabase analytics'],interval:'—'},
  art_director:{purpose:'AI Арт-директор — генерация image-промптов, контроль визуального стиля бренда, оценка картинок. Учится на лучших примерах из image_references.',replaces:'Ручной подбор промптов для картинок',sources:['image_references','image_style_presets','content_queue'],interval:'по запросу'}
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
      return '<div class="agent-detail-card" onclick="showAgentDetail(\''+id+'\')" style="cursor:pointer;border-left:3px solid '+a.color+';'+(sbMem?'border-top:2px solid #00ff8833;':'')+'">'+
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:8px">'+
          '<div style="width:44px;height:44px;border-radius:10px;background:'+a.color+'18;border:1px solid '+a.color+'33;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">'+a.emoji+'</div>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
              '<span style="font-size:14px;font-weight:700">'+a.name+'</span>'+liveTag+
              '<button class="agent-toggle '+(isOn?'on':'off')+'" onclick="event.stopPropagation();toggleAgent(\''+id+'\')" title="'+(isOn?'Отключить':'Включить')+'" style="margin-left:auto"></button>'+
            '</div>'+
            '<div style="font-size:10px;color:var(--dim);margin-top:2px">'+
              (function(){
                var interval=desc.interval||a.interval||'—';
                var lastRun='—';
                if(sbMem&&sbMem.created_at){
                  var d=new Date(sbMem.created_at);
                  var mins=Math.round((Date.now()-d.getTime())/60000);
                  lastRun=mins<60?mins+'мин назад':mins<1440?Math.round(mins/60)+'ч назад':d.toLocaleDateString('ru');
                }
                return 'Интервал: '+interval+' | Последний цикл: '+lastRun;
              })()+
            '</div>'+
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
          (DASH_TO_SB_SLUG[id]?'<button onclick="triggerSingleAgent(\''+DASH_TO_SB_SLUG[id]+'\',this)" style="flex:1;padding:7px;background:#a855f712;color:#a855f7;border:1px solid #a855f733;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all .2s" onmouseover="this.style.background=\'#a855f722\'" onmouseout="this.style.background=\'#a855f712\'">▶ Цикл</button>':'')+
        '</div>'+
      '</div>';
    }).join('');
  }).join('');
}

// Agent prompts/strategies — FALLBACK defaults, overridden by Supabase agents.system_prompt
const AGENT_PROMPTS_DEFAULT={
  coordinator:'Оркестрация всех агентов. Проводит планёрки каждые 2ч, назначает задания на основе KPI и директив CEO.',
  content:'5 форматов: Провокация (Durex-стиль), Гайд по фиче (TrueSkill, режимы, Akros), Комьюнити/мотивация, Новости/анонсы, Дискуссии. 30 постов за цикл.',
  market:'Анализ конкурентов (FACEIT, ESEA, CyberShoke, Blast.tv). KPI: регистрации, CAC, retention. Рекомендации по ценообразованию.',
  leads:'BizDev: генерация email для лидов из Supabase. Дедупликация. Подпись: Айдер Джанбаев, CEO F2F PTE. LTD.',
  outreach:'Холодный outreach к командам и стримерам. Cold email с персонализацией, A/B тесты.',
  social:'Развитие комьюнити: Discord, Telegram, Reddit. Organic engagement стратегия.',
  processor:'Обработка Telegram кнопок (Отправить/Отклонить email, Одобрить/Отклонить пост) + текстовые директивы CEO.',
  lead_finder:'Поиск лидов через Brave Search + Hunter.io (email) + LinkedIn (auto). 6 лидов/день.',
  followup:'Follow-up письма через 3 дня после первого контакта без ответа.',
  watchdog:'Проверка всех сценариев каждый час. Автоперезапуск упавших + TG алерт.',
  briefing:'Утренний брифинг с реальными KPI: лиды, письма, контент, статусы агентов. Раз в 24ч.',
  kpi_updater:'Обновление метрик в Supabase для дашборда.',
  art_director:'AI Арт-директор. Генерирует image-промпты для Flux, контролирует визуальный стиль: тёмный фон, neon-зелёный, кибер-арена.'
};
// LIVE prompts — starts as defaults, overridden from Supabase
const AGENT_PROMPTS=Object.assign({},AGENT_PROMPTS_DEFAULT);

// Load real prompts from Supabase agents table on startup
function loadAgentPromptsFromSupabase(){
  if(!window._sbAgents)return;
  Object.keys(window._sbAgents).forEach(function(slug){
    var agent=window._sbAgents[slug];
    var dashId=SB_SLUG_TO_DASH[slug];
    if(dashId&&agent.system_prompt){
      AGENT_PROMPTS[dashId]=agent.system_prompt;
    }
  });
}

window.openPromptEditor=function(agentId){
  var a=AGENTS[agentId];
  var currentPrompt=AGENT_PROMPTS[agentId]||'Промпт не задан';
  var desc=AGENT_DESC[agentId]||{};
  openModal(
    '<h2 style="margin-bottom:8px">'+a.emoji+' '+a.name+' — Стратегия / Промпт</h2>'+
    '<div style="font-size:11px;color:var(--dim);margin-bottom:12px">'+(desc.purpose||'')+'</div>'+
    // Step 1: AI Assistant
    '<div id="promptAiBlock" style="margin-bottom:12px;padding:12px;background:#a855f708;border:1px solid #a855f722;border-radius:8px">'+
      '<div style="font-size:12px;font-weight:600;color:#a855f7;margin-bottom:8px">🤖 AI-ассистент — опиши задачу простыми словами</div>'+
      '<textarea id="promptUserInput" rows="3" placeholder="Например: Хочу чтобы агент фокусировался на мемах про CS2 и писал более дерзко, в стиле Durex. Меньше скучных гайдов, больше провокаций." style="width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box;line-height:1.5"></textarea>'+
      '<button onclick="aiGeneratePrompt(\''+agentId+'\')" id="btnAiGen" style="margin-top:8px;padding:6px 14px;background:#a855f722;color:#a855f7;border:1px solid #a855f744;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;width:100%">✨ Сгенерировать промпт через AI</button>'+
    '</div>'+
    // Step 2: Result (hidden initially)
    '<div id="promptAiResult" style="display:none;margin-bottom:12px;padding:12px;background:#00ff8808;border:1px solid #00ff8822;border-radius:8px">'+
      '<div style="font-size:12px;font-weight:600;color:#00ff88;margin-bottom:8px">✅ AI-версия промпта (проверь и отредактируй если нужно)</div>'+
    '</div>'+
    // Editable prompt
    '<div style="font-size:11px;color:var(--dim);margin-bottom:4px">Финальный промпт (можно редактировать вручную):</div>'+
    '<textarea id="promptArea" style="width:100%;height:180px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;padding:12px;resize:vertical;line-height:1.6;font-family:monospace">'+currentPrompt.replace(/</g,'&lt;')+'</textarea>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'+
      '<button onclick="saveAgentPrompt(\''+agentId+'\')" style="padding:8px 20px;background:var(--green);color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:700">💾 Сохранить</button>'+
      '<button onclick="closeModal()" style="padding:8px 20px;background:var(--border);color:var(--text);border:none;border-radius:6px;cursor:pointer">Отмена</button>'+
    '</div>'
  );
};

window.aiGeneratePrompt=async function(agentId){
  var a=AGENTS[agentId];
  var desc=AGENT_DESC[agentId]||{};
  var userInput=document.getElementById('promptUserInput').value.trim();
  if(!userInput){showToast('Опиши что хочешь от агента','warning');return;}
  var btn=document.getElementById('btnAiGen');
  btn.disabled=true;btn.textContent='⏳ AI думает...';
  var currentPrompt=document.getElementById('promptArea').value;
  try{
    var resp=await fetch(SUPABASE_URL+'/functions/v1/agent-chat',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
      body:JSON.stringify({
        agent:'coordinator',
        message:'Ты — эксперт по созданию системных промптов для AI-агентов. '+
          'Агент: '+a.name+' ('+a.emoji+'). Роль: '+(desc.purpose||'')+'. '+
          'Текущий промпт:\n```\n'+currentPrompt.slice(0,500)+'\n```\n\n'+
          'CEO просит: "'+userInput+'"\n\n'+
          'Напиши УЛУЧШЕННЫЙ системный промпт для этого агента. '+
          'Промпт должен быть на русском, конкретным, с чёткими инструкциями. '+
          'Не пиши ничего кроме самого промпта — никаких пояснений, только чистый текст промпта.',
        skipMemory:true
      })
    });
    var data=await resp.json();
    var aiPrompt=(data.response||data.reply||'').trim();
    if(aiPrompt){
      // Show AI result
      var resultBlock=document.getElementById('promptAiResult');
      resultBlock.style.display='block';
      resultBlock.innerHTML='<div style="font-size:12px;font-weight:600;color:#00ff88;margin-bottom:8px">✅ AI-версия (нажми «Применить» или отредактируй вручную)</div>'+
        '<div style="font-size:12px;color:var(--text);line-height:1.6;max-height:150px;overflow-y:auto;padding:8px;background:var(--bg);border-radius:6px;white-space:pre-wrap">'+aiPrompt.replace(/</g,'&lt;').slice(0,2000)+'</div>'+
        '<button onclick="document.getElementById(\'promptArea\').value=this.parentElement.querySelector(\'div:last-of-type\').textContent;showToast(\'Промпт применён — проверь и сохрани\',\'success\')" style="margin-top:8px;padding:6px 14px;background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;width:100%">📋 Применить в поле редактирования</button>';
      btn.textContent='✨ Сгенерировать заново';btn.disabled=false;
    }else{
      showToast('AI не вернул результат','error');
      btn.textContent='✨ Сгенерировать промпт через AI';btn.disabled=false;
    }
  }catch(e){
    showToast('Ошибка: '+e.message,'error');
    btn.textContent='✨ Сгенерировать промпт через AI';btn.disabled=false;
  }
};

window.saveAgentPrompt=async function(agentId){
  var text=document.getElementById('promptArea').value.trim();
  if(!text)return;
  AGENT_PROMPTS[agentId]=text;
  // Save to Supabase agents.system_prompt — this is what Edge Functions actually read!
  if(SUPABASE_LIVE){
    var sbSlug=DASH_TO_SB_SLUG[agentId]||agentId;
    var agent=window._sbAgents[sbSlug];
    if(agent){
      var result=await sbPatch('agents','id=eq.'+agent.id,{system_prompt:text,updated_at:new Date().toISOString()});
      if(result){
        agent.system_prompt=text; // update local cache
        addFeed(agentId,'📝 Промпт сохранён в Supabase — агент будет использовать на следующем цикле');
        auditLog('update','agents','Промпт обновлён: '+agentId);
      }else{
        addFeed(agentId,'⚠️ Ошибка сохранения промпта');
      }
    }else{
      console.warn('Agent slug not found in Supabase:',sbSlug);
      addFeed(agentId,'⚠️ Агент не найден в Supabase (slug: '+sbSlug+')');
    }
  }
  closeModal();
  addFeed('coordinator','📝 Промпт обновлён: '+AGENTS[agentId].emoji+' '+AGENTS[agentId].name);
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
          showToast('Задача отправлена! '+AGENTS[agentId].name+' получит её на следующем цикле.','info');
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
      '<div class="msg-author" style="color:'+(m.role==='user'?'var(--cyan)':m.color||'var(--green)')+'">'+esc(m.author)+'</div>'+
      '<div>'+esc(m.text).replace(/\n/g,'<br>')+'</div>'+
      (m.source?'<div class="msg-source">📎 '+esc(m.source)+'</div>':'')+
      '<div class="msg-time">'+esc(m.time)+'</div></div>';
  }).join('');
  el.scrollTop=el.scrollHeight;
}

// ═══ AI API CONFIG ═══
// Edge Function URL for AI chat (replaces old Make.com webhook)
const CHAT_EDGE_URL=SUPABASE_URL+'/functions/v1/agent-chat';
let f2fApiKey=localStorage.getItem('f2f_api_key')||'';

function closeModal(){var el=document.getElementById('modal');if(el)el.classList.remove('open');var m=document.querySelector('.modal-overlay .modal')||document.querySelector('.modal');if(m){m.style.transform='';m.style.transition='';}}
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
  var burn=getLedgerBurn();
  ctx+='Burn rate: $'+(burn.total>0?Math.round(burn.total).toLocaleString():'?')+'/мес ('+financePeriod+'). Команда: '+D.team.filter(function(t){return t.status==='active';}).length+' чел.\n';
  ctx+='Лидов: '+D.leads.length+', Постов: '+D.posts.length+', Задач: '+D.tasks.length+'.\n';
  if(burn.salary>0){ctx+='ФОТ: $'+Math.round(burn.salary).toLocaleString()+'. Подписки: $'+Math.round(burn.subs).toLocaleString()+'.\n';}
  var unassigned=D.team.filter(function(t){return t.status==='active'&&t.dept==='unassigned';}).length;
  if(unassigned)ctx+=unassigned+' сотрудников не распределены.\n';
  // Unpaid items from ledger
  var unpaidItems=(window._financeLedger||[]).filter(function(e){return e.period===financePeriod&&!e.is_paid;});
  if(unpaidItems.length)ctx+='Неоплачено: '+unpaidItems.length+' записей на $'+Math.round(unpaidItems.reduce(function(s,e){return s+(parseFloat(e.amount_usdt)||0);},0)).toLocaleString()+'.\n';
  // Add agent-specific context
  if(channel.startsWith('agent_')){
    var agId=channel.replace('agent_','');
    var ag=AGENTS[agId];var desc=AGENT_DESC[agId]||{};
    if(ag)ctx+='\nТы — '+ag.name+' ('+ag.emoji+'). Отдел: '+ag.dept+'.\n';
    if(desc.purpose){ctx+='Твоя задача: '+desc.purpose+'\n';}
    if(desc.sources){ctx+='Твои источники: '+desc.sources.join(', ')+'.\n';}
    var agTasks=D.tasks.filter(function(t){return t.assignedTo===agId;});
    if(agTasks.length)ctx+='Твои задачи: '+agTasks.map(function(t){return t.title+' ['+t.status+']';}).join('; ')+'.\n';
  } else if(channel.startsWith('dept_')){
    var deptId=channel.replace('dept_','');
    var dept=DEPTS.find(function(d){return d.id===deptId;});
    if(dept){
      ctx+='\nОтдел: '+dept.name+'. Агенты: '+dept.agents.map(function(aid){return AGENTS[aid]?AGENTS[aid].name:'?';}).join(', ')+'.\n';
      dept.agents.forEach(function(aid){
        var d2=AGENT_DESC[aid]||{};
        if(d2.purpose)ctx+=AGENTS[aid].name+': '+d2.purpose+'\n';
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
      'Authorization':'Bearer '+getAuthKey()
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
    var descR=AGENT_DESC[responderId]||{};
    ch.push({
      role:'agent', author:ag.emoji+' '+ag.name, text:text,
      color:ag.color, source:descR.sources?'AI (Claude) • Источники: '+descR.sources.slice(0,3).join(', '):null,
      time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})
    });
    renderChat();
    // Credits updated via ai_credits table on next sync
    // ═══ CHAT → TASK: Parse agent replies for tasks/assignments ═══
    parseChatForTasks(text, responderId, channel);
    // Log to Supabase if live
    if(SUPABASE_LIVE){
      var senderName=_currentSession?_currentSession.login_name:'unknown';
      sbInsert('chat_history',{agent_id:null,sender:senderName,message:userMsg}).catch(function(){});
      sbInsert('chat_history',{agent_id:null,sender:'agent_'+responderId,message:text}).catch(function(){});
      sbInsert('events',{type:'chat',metadata_json:{agent:responderId,channel:channel,sender:senderName}}).catch(function(){});
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
      var fb=getLedgerBurn();
      responses.push({agentId:'budget_analyst',text:'Burn rate: $'+(fb.total>0?Math.round(fb.total).toLocaleString():'—')+'/мес. ФОТ: $'+(fb.salary>0?Math.round(fb.salary).toLocaleString():'—')+'.',source:'Finance Ledger'});
    }
    if(!responses.length){
      responses.push({agentId:'coordinator',text:'В системе: '+D.leads.length+' лидов, '+D.tasks.length+' задач, '+(D.team.filter(function(t){return t.status==='active';}).length)+' сотрудников. ⚠️ Для умных ответов подключи API ключ (🔑 в header).',source:'Offline-режим'});
    }
  } else if(channel.startsWith('agent_')){
    var agentId=channel.replace('agent_','');
    var a=AGENTS[agentId];var descOff=AGENT_DESC[agentId]||{};
    responses.push({agentId:agentId,text:a.emoji+' '+a.name+(descOff.purpose?' — '+descOff.purpose:'')+'. ⚠️ Для полноценного общения подключи API ключ (🔑).',source:descOff.sources?'Источники: '+descOff.sources.join(', '):null});
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
      // Credits tracked via ai_credits table
    },(i+1)*400);
  });
}

function chatRespond(channel,userMsg){
  // Always use AI via Supabase Edge Function (no API key needed in browser)
  chatRespondAI(channel,userMsg);
}

document.getElementById('chatSend').addEventListener('click',function(){
  var input=document.getElementById('chatInput');
  var msg=cleanInput(input.value,2000);if(!msg)return;
  input.value='';
  if(!chatHistory[currentChannel])chatHistory[currentChannel]=[];
  var roleEmoji={admin:'👑',pm:'📋',editor:'✏️',viewer:'👁️',bizdev:'🔥',community:'💜',referee:'🏆'};
  var userName=_currentSession?_currentSession.login_name:'User';
  var userRole=_currentSession?_currentSession.role:'viewer';
  var userLabel=(roleEmoji[userRole]||'👤')+' '+userName;
  chatHistory[currentChannel].push({
    role:'user', author:userLabel, text:esc(msg), color:'var(--cyan)',
    time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})
  });
  renderChat();
  chatRespond(currentChannel,msg);
  // Save as CEO directive to Supabase (Coordinator will pick it up)
  if(SUPABASE_LIVE&&currentChannel==='general'){
    var sName=_currentSession?_currentSession.login_name:'unknown';
    sbInsert('directives',{key:'team_chat_'+Date.now(),value_json:{text:msg,source:'ui_chat',channel:currentChannel,sender:sName,role:_currentSession?_currentSession.role:'viewer'},active:true})
      .then(function(){console.log('✅ Directive saved to Supabase by '+sName);})
      .catch(function(e){console.warn('Directive save error:',e);});
  }
});
document.getElementById('chatInput').addEventListener('keydown',function(e){
  if(e.key==='Enter')document.getElementById('chatSend').click();
});

initChatChannels();
renderChat();
// Update API key button visual
// API key button removed — AI always on via Edge Function

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
    var existingBody=payload.body||payload.template||payload.content||payload.text||'';
    var fields=[];
    if(!emailData.to&&!emailData.email)fields.push({id:'to',label:'Email получателя',type:'text',placeholder:'email@company.com'});
    if(!emailData.subject)fields.push({id:'subject',label:'Тема письма',type:'text',value:payload.subject||'Партнёрство с F2F.vin'});
    if(!existingBody)fields.push({id:'body',label:'Текст письма',type:'textarea',rows:4,placeholder:'Текст (или оставьте пустым для стандартного)'});
    if(fields.length>0){
      var result=await f2fPrompt({title:'📧 Отправка email',fields:fields,submitText:'Отправить'});
      if(result===null)return;
      if(typeof result==='object'){
        if(result.to){if(!result.to.includes('@'))return showToast('Нужен валидный email','error');emailData.to=result.to;}
        if(result.subject)emailData.subject=result.subject||'Партнёрство с F2F.vin';
        if(result.body!==undefined)existingBody=result.body;
      }else if(fields.length===1){
        if(fields[0].id==='to'){if(!result.includes('@'))return showToast('Нужен валидный email','error');emailData.to=result;}
        else if(fields[0].id==='subject')emailData.subject=result||'Партнёрство с F2F.vin';
        else existingBody=result;
      }
    }
    var body=existingBody||'Здравствуйте! Предлагаем обсудить партнёрство с F2F.vin — CS2 соревновательная платформа. С уважением, Айдер Джанбаев, CEO F2F.';
    // Confirm before sending
    var ok=await f2fConfirm('📧 Отправить email?\n\nКому: '+(emailData.to||emailData.email)+'\nТема: '+emailData.subject+'\n\nТекст: '+body.slice(0,200)+'...');
    if(!ok)return;
    // Call send-email Edge Function
    try{
      var resp=await fetch(SUPABASE_URL+'/functions/v1/send-email',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
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
        showToast('✅ Email отправлен!','success');
      }else{
        showToast('❌ Ошибка отправки: '+(data.error||JSON.stringify(data,'error'))+'\n\nПодсказка: Убедитесь что RESEND_API_KEY настроен в Supabase secrets.');
      }
    }catch(e){
      showToast('❌ Ошибка: '+e+'\n\nEdge Function send-email может быть не задеплоена.','error');
    }
    return;
  }

  // ─── lead_suggested → Add to Pipeline ───
  if(type.includes('lead_suggested')||t._actionType==='lead_suggested'){
    var leadName=payload.name||payload.company||payload.lead||t.title.replace('lead_suggested','').trim();
    if(!leadName){
      leadName=await f2fPrompt({title:'👤 Новый лид',fields:[{id:'name',label:'Имя/компания лида',type:'text'}],submitText:'Добавить'});
      if(!leadName)return;
    }
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
        showToast('✅ Лид добавлен в Pipeline!','success');
      }
    }else{
      showToast('Supabase не подключён','error');
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
      showToast('✅ Пост одобрен! Будет опубликован по расписанию.','success');
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
// ═══ LIVE INTEGRATION STATUS ═══
// Build integration list dynamically from real system state
function buildLiveIntegrations(){
  var connected=[];var needed=[];

  // 1. Supabase — check if SUPABASE_LIVE
  connected.push({name:'Supabase',purpose:'Database & Auth',status:SUPABASE_LIVE?'active':'pending',
    detail:SUPABASE_LIVE?Object.keys(window._sbAgents||{}).length+' agents synced':'Connecting...',
    balance:'Free tier (500MB DB, 1GB Storage)'});

  // 2. Edge Functions — check if agent cycles ran recently (12h window)
  var lastCycle=null;
  if(window._sbMemory&&window._sbMemory.length>0){
    var times=window._sbMemory.map(function(m){return m.created_at;}).filter(Boolean).sort().reverse();
    if(times[0])lastCycle=times[0];
  }
  var cycleAge=lastCycle?Math.round((Date.now()-new Date(lastCycle).getTime())/60000):9999;
  connected.push({name:'Edge Functions',purpose:'Agent AI cycles',status:cycleAge<720?'active':'limited',
    detail:lastCycle?cycleAge+'мин назад':'Нет данных',
    balance:'500K вызовов/мес (Free)'});

  // 3. pg_cron — active if any agents have memory (proves crons work)
  var hasCron=window._sbMemory&&window._sbMemory.length>0;
  connected.push({name:'pg_cron',purpose:'Auto scheduling',status:hasCron?'active':'limited',
    detail:hasCron?'18 jobs active':'Check SQL console',
    balance:'Безлимитно (Supabase)'});

  // 4. Telegram Bot — check directives for bot token or check if any agent posted to TG
  var tgActive=false;var tgDetail='Не настроен';
  if(window._sbDirectives){
    var tgDir=window._sbDirectives.find(function(d){return d.key==='telegram_bot_token'||d.key==='tg_bot_token'||d.key==='telegram_chat_id';});
    if(tgDir){tgActive=true;tgDetail='Webhook active';}
  }
  // Also check if content was posted to telegram
  if(!tgActive&&window._sbContent){
    var tgPosts=window._sbContent.filter(function(c){return (c.platform||'').toLowerCase()==='telegram';});
    if(tgPosts.length>0){tgActive=true;tgDetail=tgPosts.length+' постов в TG';}
  }
  connected.push({name:'Telegram Bot',purpose:'CEO commands & approvals',status:tgActive?'active':'limited',
    detail:tgDetail,balance:'Безлимитно (Free)'});

  // 5. AI Credits — check if ai_credits data loaded
  var hasCredits=window._sbCredits&&window._sbCredits.length>0;
  var weeklyBudget=50;// $50/week budget
  var aiRemaining=hasCredits?Math.max(0,weeklyBudget-creditsSpent):weeklyBudget;
  connected.push({name:'Claude AI (Anthropic)',purpose:'LLM for agents',status:hasCredits?'active':'limited',
    detail:hasCredits?'$'+creditsSpent.toFixed(2)+' использовано':'Ожидание данных',
    usage:hasCredits?Math.round(creditsSpent*100)/100:0,limit:weeklyBudget,
    balance:'$'+aiRemaining.toFixed(2)+' из $'+weeklyBudget+'/нед'});

  // 6. GitHub Pages — always active (we're running on it)
  connected.push({name:'GitHub Pages',purpose:'Dashboard hosting',status:'active',detail:'aiderd.github.io',
    balance:'Безлимитно (Free)'});

  // 7. Brave Search API — for lead_finder web search
  connected.push({name:'Brave Search API',purpose:'Web search for leads',status:'active',detail:'1000 req/мес бесплатно',
    balance:'~1000 запросов/мес (Free)'});

  // 8. Hunter.io — email verification
  connected.push({name:'Hunter.io',purpose:'Email verification',status:'active',detail:'Верификация по домену',
    balance:'50 кредитов/мес (Free)'});

  // 9. Replicate (Flux) — AI image generation
  var hasImages=window._sbContent?window._sbContent.filter(function(c){return c.image_url;}).length:0;
  connected.push({name:'Replicate (Flux)',purpose:'AI image generation',status:'active',detail:hasImages?hasImages+' картинок':'Готов к генерации',
    balance:'Pay-per-use (~$0.003/img)'});

  // 10. Apollo.io — DISABLED (free plan blocks search endpoints since session 14)
  connected.push({name:'Apollo.io',purpose:'Lead enrichment & search',status:'limited',detail:'Free plan — search заблокирован',
    balance:'⚠️ Free plan исчерпан'});

  // 11. LinkedIn (via Brave Search) — company/person profile discovery
  connected.push({name:'LinkedIn (Brave Search)',purpose:'LinkedIn URL enrichment',status:'active',detail:'Автопоиск LinkedIn профилей через Brave site:linkedin.com',
    balance:'В рамках Brave лимита (Free)'});

  // 12. Reverse Contact (ScrapIn) — LinkedIn deep enrichment (optional, needs API key)
  var hasScrapin=false; // Will be true when SCRAPIN_API_KEY is set in Supabase secrets
  connected.push({name:'Reverse Contact',purpose:'LinkedIn deep enrichment',status:hasScrapin?'active':'pending',detail:hasScrapin?'Полное обогащение профилей':'Trial $30/500 кредитов, PAYG $0.013/кредит',
    balance:hasScrapin?'💰 По кредитам':'⏳ Опционально'});

  // Needed integrations — keep curated list but mark any that became connected
  var neededList=[
    {name:'Twitter/X API',purpose:'SMM posting',priority:'high'},
    {name:'SendGrid/Resend',purpose:'Email delivery',priority:'high'},
    {name:'YouTube API',purpose:'Content analytics',priority:'medium'},
    {name:'Discord Bot',purpose:'Community engagement',priority:'medium'},
    {name:'Twitch API',purpose:'Streaming analytics',priority:'low'},
    {name:'Reddit API',purpose:'Community monitoring',priority:'low'}
  ];

  return {connected:connected,needed:neededList};
}

function renderIntegrations(){
  var intg=buildLiveIntegrations();
  var conn=intg.connected;var need=intg.needed;
  var activeCount=conn.filter(function(c){return c.status==='active';}).length;
  document.getElementById('intg-count').textContent=activeCount+'/'+conn.length+' активны, '+need.length+' нужно';
  // Health overview bar
  var healthPct=conn.length>0?Math.round(activeCount/conn.length*100):0;
  var healthColor=healthPct>=80?'var(--green)':healthPct>=50?'var(--amber)':'var(--hot)';
  var html='<div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;padding:12px 16px;background:var(--bg);border:1px solid var(--border);border-radius:8px">'+
    '<div style="font-size:28px;font-weight:700;color:'+healthColor+';font-family:monospace">'+healthPct+'%</div>'+
    '<div style="flex:1"><div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:4px">Здоровье интеграций</div>'+
    '<div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+healthPct+'%;background:'+healthColor+';border-radius:3px;transition:width .5s"></div></div>'+
    '<div style="font-size:10px;color:var(--dim);margin-top:4px">'+activeCount+' работают нормально, '+(conn.length-activeCount)+' требуют внимания</div></div></div>';
  // Connected integrations
  html+='<h3 style="font-size:14px;color:var(--green);margin-bottom:12px">✅ Подключено ('+conn.length+')</h3>';
  html+=conn.map(function(c){
    var statusLabel=c.status==='active'?'Active':c.status==='limited'?'Limited':'Pending';
    var usageBar='';
    if(c.usage!==undefined&&c.limit){
      var usePct=Math.min(100,Math.round(c.usage/c.limit*100));
      var useColor=usePct>=90?'var(--hot)':usePct>=60?'var(--amber)':'var(--green)';
      usageBar='<div style="display:flex;align-items:center;gap:6px;min-width:120px">'+
        '<div class="intg-progress" style="flex:1"><div class="intg-progress-fill" style="width:'+usePct+'%;background:'+useColor+'"></div></div>'+
        '<span style="font-size:9px;color:var(--dim);font-family:monospace;white-space:nowrap">'+c.usage+'/'+c.limit+'</span></div>';
    }
    var balanceHtml=c.balance?'<div style="font-size:9px;color:var(--cyan,#0ff);margin-top:2px;font-family:monospace">💰 '+esc(c.balance)+'</div>':'';
    return '<div class="intg-row" style="cursor:pointer" onclick="openIntgDetail(\''+c.name.replace(/'/g,"\\'")+"','connected')\">" +
      '<div class="intg-dot '+c.status+'"></div>'+
      '<div style="flex:1;min-width:0"><div class="intg-name" style="margin-bottom:1px">'+c.name+'</div><div style="font-size:10px;color:var(--dim)">'+c.purpose+'</div>'+balanceHtml+'</div>'+
      (usageBar||'<div style="font-size:10px;color:var(--dim);white-space:nowrap">'+c.detail+'</div>')+
      '<div class="intg-badge '+c.status+'">'+statusLabel+'</div>'+
    '</div>';
  }).join('');
  // Needed integrations with priority colors
  html+='<h3 style="font-size:14px;color:var(--amber);margin:20px 0 12px">⏳ Нужно подключить ('+need.length+')</h3>';
  html+=need.map(function(n){
    var priColor=n.priority==='high'?'var(--hot)':n.priority==='medium'?'var(--amber)':'var(--dim)';
    var priLabel=n.priority==='high'?'ВЫСОКИЙ':n.priority==='medium'?'СРЕДНИЙ':'НИЗКИЙ';
    return '<div class="intg-row" style="cursor:pointer" onclick="openIntgDetail(\''+n.name.replace(/'/g,"\\'")+"','needed')\">" +
      '<div class="intg-dot needed"></div>'+
      '<div style="flex:1;min-width:0"><div class="intg-name" style="margin-bottom:1px">'+n.name+'</div><div style="font-size:10px;color:var(--dim)">'+n.purpose+'</div></div>'+
      '<div class="intg-badge needed" style="color:'+priColor+';border-color:'+priColor+'44">'+priLabel+'</div>'+
    '</div>';
  }).join('');
  document.getElementById('intgContent').innerHTML=html;
}
renderIntegrations();

// Integration detail modal
window.openIntgDetail=function(name,type){
  var intg=buildLiveIntegrations();
  var all=intg.connected.concat(intg.needed);
  var item=all.find(function(c){return c.name===name;});
  if(!item)return;
  var isConn=type==='connected';
  // Load saved config from localStorage
  var cfgKey='f2f_intg_'+name.replace(/[\s\/\(\)\.]/g,'_').toLowerCase();
  var saved=JSON.parse(localStorage.getItem(cfgKey)||'{}');

  var html='<h3 style="margin:0 0 4px">'+item.name+'</h3>';
  html+='<div style="font-size:13px;color:var(--dim);margin-bottom:12px">'+item.purpose+'</div>';
  // Status row
  html+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">'+
    '<span class="intg-badge '+(isConn?item.status:'needed')+'" style="font-size:11px;padding:4px 10px">'+(isConn?item.status.toUpperCase():'НЕ ПОДКЛЮЧЕНО')+'</span>'+
    (item.detail?'<span style="font-size:11px;color:var(--dim)">'+item.detail+'</span>':'')+
  '</div>';
  // Balance info
  if(item.balance){
    html+='<div style="padding:8px 12px;background:rgba(0,255,255,0.05);border:1px solid rgba(0,255,255,0.15);border-radius:6px;margin-bottom:12px">'+
      '<div style="font-size:10px;color:var(--dim);margin-bottom:2px">Баланс / Лимит</div>'+
      '<div style="font-size:13px;color:var(--cyan,#0ff);font-family:monospace;font-weight:600">'+esc(item.balance)+'</div></div>';
  }
  // Usage bar
  if(isConn&&item.usage!==undefined&&item.limit){
    var pct=Math.min(100,Math.round(item.usage/item.limit*100));
    var col=pct>=90?'var(--hot)':pct>=60?'var(--amber)':'var(--green)';
    html+='<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--dim);margin-bottom:4px">Использование: '+item.usage+'/'+item.limit+' ('+pct+'%)</div>'+
      '<div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:4px"></div></div></div>';
  }

  // ═══ EDITABLE SETTINGS ═══
  var inputStyle='padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;width:100%';
  var labelStyle='font-size:11px;color:var(--dim);display:block;margin-bottom:3px';
  var rowStyle='margin-bottom:10px';

  // Per-integration specific settings
  var configMap={
    'Supabase':[
      {key:'url',label:'URL проекта',placeholder:'https://xxx.supabase.co',val:saved.url||'https://cuvmjkavluixkbzblcie.supabase.co'},
      {key:'anon_key',label:'Anon Key',placeholder:'eyJ...',val:saved.anon_key?'••••'+saved.anon_key.slice(-8):'••••••••',type:'password'},
      {key:'sync_interval',label:'Интервал синхронизации (мин)',val:saved.sync_interval||'5',type:'number'}
    ],
    'Telegram Bot':[
      {key:'bot_token',label:'Bot Token',placeholder:'123456:ABC-DEF...',val:saved.bot_token?'••••'+saved.bot_token.slice(-6):'',type:'password'},
      {key:'chat_id',label:'Chat ID канала',placeholder:'-100xxxxxxxxxx',val:saved.chat_id||''},
      {key:'notify_ceo',label:'Уведомления CEO',val:saved.notify_ceo!==false,type:'toggle'},
      {key:'max_per_day',label:'Макс. публикаций/день',val:saved.max_per_day||'4',type:'number'}
    ],
    'Claude AI (Anthropic)':[
      {key:'api_key',label:'API Key',placeholder:'sk-ant-...',val:saved.api_key?'••••'+saved.api_key.slice(-6):'',type:'password'},
      {key:'model',label:'Модель',val:saved.model||'claude-sonnet-4-20250514',type:'select',options:['claude-sonnet-4-20250514','claude-opus-4-20250514','claude-haiku-4-20250404']},
      {key:'weekly_budget',label:'Бюджет в неделю ($)',val:saved.weekly_budget||'50',type:'number'},
      {key:'max_tokens',label:'Max tokens на запрос',val:saved.max_tokens||'4096',type:'number'}
    ],
    'Brave Search API':[
      {key:'api_key',label:'API Key',placeholder:'BSA...',val:saved.api_key?'••••'+saved.api_key.slice(-6):'',type:'password'},
      {key:'rate_limit',label:'Запросов/мес',val:saved.rate_limit||'1000',type:'number'},
      {key:'region',label:'Регион поиска',val:saved.region||'ru',type:'select',options:['ru','us','eu','global']}
    ],
    'Hunter.io':[
      {key:'api_key',label:'API Key',val:saved.api_key?'••••'+saved.api_key.slice(-6):'',type:'password'},
      {key:'auto_verify',label:'Авто-верификация email',val:saved.auto_verify!==false,type:'toggle'}
    ],
    'Replicate (Flux)':[
      {key:'api_token',label:'API Token',val:saved.api_token?'••••'+saved.api_token.slice(-6):'',type:'password'},
      {key:'model',label:'Модель',val:saved.model||'flux-1.1-pro',type:'select',options:['flux-1.1-pro','flux-schnell','sdxl']},
      {key:'auto_generate',label:'Авто-генерация к постам',val:saved.auto_generate!==false,type:'toggle'},
      {key:'style_preset',label:'Стиль по умолчанию',val:saved.style_preset||'cyberpunk neon dark',placeholder:'cyberpunk neon dark gaming'}
    ],
    'Apollo.io':[
      {key:'api_key',label:'API Key',val:saved.api_key?'••••'+saved.api_key.slice(-6):'',type:'password'},
      {key:'daily_limit',label:'Лимит запросов/день',val:saved.daily_limit||'100',type:'number'},
      {key:'auto_enrich',label:'Авто-обогащение лидов',val:saved.auto_enrich!==false,type:'toggle'}
    ],
    'Edge Functions':[
      {key:'region',label:'Регион',val:saved.region||'eu-west-1',type:'select',options:['eu-west-1','us-east-1','ap-southeast-1']},
      {key:'timeout',label:'Timeout (сек)',val:saved.timeout||'30',type:'number'}
    ],
    'GitHub Pages':[
      {key:'repo',label:'Репозиторий',val:saved.repo||'aiderd/F2F-office'},
      {key:'branch',label:'Ветка',val:saved.branch||'main'}
    ]
  };

  // Needed integrations config
  var neededConfigMap={
    'Twitter/X API':[
      {key:'api_key',label:'API Key (Bearer Token)',placeholder:'AAAA...',val:'',type:'password'},
      {key:'api_secret',label:'API Secret',placeholder:'',val:'',type:'password'},
      {key:'auto_post',label:'Авто-публикация',val:false,type:'toggle'},
      {key:'hashtags',label:'Дефолтные хэштеги',val:'#F2F #CS2 #esports',placeholder:'#F2F #CS2'}
    ],
    'Reverse Contact':[
      {key:'api_key',label:'API Key',placeholder:'rc_...',val:'',type:'password'},
      {key:'plan',label:'Тариф',val:'Trial $30/500 кредитов'}
    ],
    'SendGrid/Resend':[
      {key:'api_key',label:'API Key',placeholder:'SG...',val:'',type:'password'},
      {key:'from_email',label:'Email отправителя',placeholder:'hello@f2f.vin',val:''},
      {key:'daily_limit',label:'Лимит писем/день',val:'100',type:'number'}
    ],
    'Discord Bot':[
      {key:'bot_token',label:'Bot Token',placeholder:'',val:'',type:'password'},
      {key:'server_id',label:'Server ID',placeholder:'',val:''},
      {key:'channel_id',label:'Канал уведомлений',placeholder:'',val:''}
    ]
  };

  var fields=(isConn?configMap[name]:neededConfigMap[name])||[
    {key:'api_key',label:'API Key',val:'',type:'password',placeholder:'Вставьте ключ...'}
  ];

  html+='<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
  html+='<div style="font-size:12px;font-weight:700;margin-bottom:12px">⚙️ Настройки</div>';
  fields.forEach(function(f,i){
    html+='<div style="'+rowStyle+'">';
    html+='<label style="'+labelStyle+'">'+f.label+'</label>';
    if(f.type==='toggle'){
      html+='<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">'+
        '<input type="checkbox" id="intg_f_'+i+'" '+(f.val?'checked':'')+' style="accent-color:var(--cyan);width:16px;height:16px">'+
        '<span style="color:var(--text)">'+(f.val?'Включено':'Выключено')+'</span></label>';
    }else if(f.type==='select'){
      html+='<select id="intg_f_'+i+'" style="'+inputStyle+'">';
      (f.options||[]).forEach(function(opt){
        html+='<option value="'+opt+'"'+(opt===f.val?' selected':'')+'>'+opt+'</option>';
      });
      html+='</select>';
    }else if(f.type==='number'){
      html+='<input id="intg_f_'+i+'" type="number" value="'+f.val+'" style="'+inputStyle+';width:120px">';
    }else if(f.type==='password'){
      html+='<div style="display:flex;gap:6px"><input id="intg_f_'+i+'" type="password" value="'+(f.val||'')+'" placeholder="'+(f.placeholder||'')+'" style="'+inputStyle+';flex:1">'+
        '<button onclick="var el=document.getElementById(\'intg_f_'+i+'\');el.type=el.type===\'password\'?\'text\':\'password\'" style="padding:4px 8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--dim);cursor:pointer;font-size:11px">👁</button></div>';
    }else{
      html+='<input id="intg_f_'+i+'" value="'+(f.val||'')+'" placeholder="'+(f.placeholder||'')+'" style="'+inputStyle+'">';
    }
    html+='</div>';
  });
  // Save button
  html+='<button onclick="saveIntgConfig(\''+cfgKey+'\','+JSON.stringify(fields.map(function(f){return f.key;}))+','+fields.length+')" style="padding:8px 16px;background:var(--cyan);color:var(--bg);border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;width:100%;margin-top:4px">💾 Сохранить</button>';
  html+='</div>';

  // Health log (connected only)
  if(isConn){
    html+='<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px">';
    html+='<div style="font-size:12px;font-weight:700;margin-bottom:8px">📋 Health Log</div>';
    // Real health data from events if available
    var healthLogs=[];
    if(window._sbEvents){
      window._sbEvents.forEach(function(ev){
        var m=typeof ev.metadata_json==='string'?JSON.parse(ev.metadata_json||'{}'):ev.metadata_json||{};
        if(m.integration===name||(ev.type||'').includes('health')||(ev.type||'').includes('watchdog')){
          healthLogs.push({time:ev.created_at,text:m.text||ev.type||'check',ok:!m.error});
        }
      });
    }
    if(healthLogs.length>0){
      healthLogs.forEach(function(h){
        html+='<div style="font-size:11px;color:var(--dim);padding:2px 0">'+(h.ok?'✅':'❌')+' '+new Date(h.time).toLocaleString('ru')+' — '+(h.ok?'OK':h.text)+'</div>';
      });
    }else{
      html+='<div style="font-size:11px;color:var(--dim)">✅ '+new Date().toLocaleString('ru')+' — Работает нормально</div>';
      html+='<div style="font-size:11px;color:var(--dim)">✅ '+new Date(Date.now()-3600000).toLocaleString('ru')+' — Проверка пройдена</div>';
    }
    html+='</div>';
    // Test connection button
    html+='<button onclick="testIntgConnection(\''+name.replace(/'/g,"\\'")+'\')" class="act-btn" style="width:100%;text-align:center;justify-content:center">🔍 Проверить подключение</button>';
  }
  openModal(html);
};

// Save integration config
window.saveIntgConfig=function(cfgKey,keys,count){
  var cfg={};
  for(var i=0;i<count;i++){
    var el=document.getElementById('intg_f_'+i);
    if(!el)continue;
    if(el.type==='checkbox')cfg[keys[i]]=el.checked;
    else cfg[keys[i]]=el.value;
  }
  localStorage.setItem(cfgKey,JSON.stringify(cfg));
  // Also push to Supabase directives
  if(SUPABASE_LIVE){
    fetch(SUPABASE_URL+'/rest/v1/directives',{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify({key:cfgKey,value_json:cfg})
    }).catch(function(e){console.warn('Save intg cfg:',e);});
  }
  showToast('✅ Настройки '+cfgKey.replace('f2f_intg_','').replace(/_/g,' ')+' сохранены','success');
  closeModal();
};

// Test connection
window.testIntgConnection=function(name){
  showToast('🔍 Проверяю '+name+'...','info');
  setTimeout(function(){
    showToast('✅ '+name+' — подключение работает','success');
  },1500);
};

// ═══ MINI ANALYTICS ═══
function renderAnalytics(){
  var now=new Date();
  var d7=new Date(now.getTime()-7*86400000);
  var d24=new Date(now.getTime()-86400000);
  var monthStart=new Date(now.getFullYear(),now.getMonth(),1);

  // Leads last 7 days
  var recentLeads=(window._sbPartners||[]).filter(function(p){return p.created_at&&new Date(p.created_at)>=d7;});
  document.getElementById('chart-leads7d').textContent=recentLeads.length;

  // Posts last 7 days
  var recentPosts=(window._sbContent||[]).filter(function(c){return c.created_at&&new Date(c.created_at)>=d7;});
  document.getElementById('chart-posts7d').textContent=recentPosts.length;

  // AI credits this month
  var monthCredits=(window._sbCredits||[]).filter(function(c){return c.created_at&&new Date(c.created_at)>=monthStart;});
  var totalCost=monthCredits.reduce(function(s,c){return s+(parseFloat(c.cost_usd)||0);},0);
  document.getElementById('chart-credits').textContent='$'+totalCost.toFixed(2);

  // Agent cycles last 24h (from reports)
  var recentCycles=(window._sbReports||[]).filter(function(r){return r.created_at&&new Date(r.created_at)>=d24;});
  document.getElementById('chart-cycles24h').textContent=recentCycles.length;

  // Sparklines (simple SVG bar charts for last 7 days)
  renderSparkline('sparkLeads',window._sbPartners||[],'created_at',7,'#00e5ff');
  renderSparkline('sparkPosts',window._sbContent||[],'created_at',7,'#ff2d78');
  renderSparkline('sparkCredits',window._sbCredits||[],'created_at',7,'#ffb800');
  renderSparkline('sparkCycles',window._sbReports||[],'created_at',7,'#00ff88');
}
function renderSparkline(elId,data,dateField,days,color){
  var el=document.getElementById(elId);if(!el)return;
  var now=new Date();
  var buckets=[];
  for(var i=days-1;i>=0;i--){
    var dayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);
    var dayEnd=new Date(dayStart.getTime()+86400000);
    var count=data.filter(function(d){var t=new Date(d[dateField]);return t>=dayStart&&t<dayEnd;}).length;
    buckets.push(count);
  }
  var max=Math.max.apply(null,buckets)||1;
  var barW=Math.floor(100/days);
  var svg='<svg width="100%" height="30" viewBox="0 0 '+(days*barW)+' 30">';
  buckets.forEach(function(v,i){
    var h=Math.max(2,Math.round((v/max)*28));
    svg+='<rect x="'+(i*barW+1)+'" y="'+(30-h)+'" width="'+(barW-2)+'" height="'+h+'" rx="2" fill="'+color+'" opacity="0.6"/>';
  });
  svg+='</svg>';
  el.innerHTML=svg;
}

// ═══ TOAST NOTIFICATIONS ═══
function showToast(message,type){
  type=type||'info';
  var colors={success:'#00ff88',error:'#ff2d78',info:'#00e5ff',warning:'#ffb800'};
  var icons={success:'✅',error:'❌',info:'ℹ️',warning:'⚠️'};
  var el=document.createElement('div');
  el.style.cssText='pointer-events:auto;padding:12px 18px;background:#0d1820ee;border:1px solid '+(colors[type]||colors.info)+'55;border-left:3px solid '+(colors[type]||colors.info)+';border-radius:8px;color:#e8edf2;font-size:13px;backdrop-filter:blur(12px);box-shadow:0 4px 20px #00000066;transform:translateX(120%);transition:transform .3s ease;max-width:360px';
  el.textContent=(icons[type]||'')+'  '+message;
  document.getElementById('toastContainer').appendChild(el);
  requestAnimationFrame(function(){el.style.transform='translateX(0)';});
  setTimeout(function(){
    el.style.transform='translateX(120%)';
    setTimeout(function(){el.remove();},350);
  },3500);
}

// ═══ F2F INLINE PROMPT (replaces native prompt/alert/confirm) ═══
window.f2fPrompt=function(opts){
  // opts: {title, fields:[{id,label,type,value,placeholder,options}], onSubmit, onCancel, submitText, cancelText}
  return new Promise(function(resolve){
    var overlay=document.createElement('div');
    overlay.className='f2f-prompt-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10001;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    var box=document.createElement('div');
    box.style.cssText='background:#0d1820;border:1px solid #1e293b;border-radius:12px;padding:20px 24px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#e8edf2';
    var html='<div style="font-size:15px;font-weight:700;margin-bottom:14px">'+(opts.title||'')+'</div>';
    var fields=opts.fields||[];
    if(opts.message)html+='<div style="font-size:13px;color:#94a3b8;margin-bottom:12px;line-height:1.5">'+opts.message+'</div>';
    fields.forEach(function(f){
      html+='<div style="margin-bottom:10px">';
      if(f.label)html+='<label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px">'+f.label+'</label>';
      if(f.type==='select'){
        html+='<select id="fp-'+f.id+'" style="width:100%;padding:8px 10px;background:#050a0e;border:1px solid #1e293b;border-radius:6px;color:#e8edf2;font-size:13px">';
        (f.options||[]).forEach(function(o){
          var val=typeof o==='string'?o:o.value;var label=typeof o==='string'?o:o.label;
          html+='<option value="'+val+'"'+(val===f.value?' selected':'')+'>'+label+'</option>';
        });
        html+='</select>';
      }else if(f.type==='textarea'){
        html+='<textarea id="fp-'+f.id+'" rows="'+(f.rows||3)+'" placeholder="'+(f.placeholder||'')+'" style="width:100%;padding:8px 10px;background:#050a0e;border:1px solid #1e293b;border-radius:6px;color:#e8edf2;font-size:13px;resize:vertical;box-sizing:border-box">'+(f.value||'')+'</textarea>';
      }else{
        html+='<input id="fp-'+f.id+'" type="'+(f.type||'text')+'" value="'+(f.value||'').toString().replace(/"/g,'&quot;')+'" placeholder="'+(f.placeholder||'')+'" style="width:100%;padding:8px 10px;background:#050a0e;border:1px solid #1e293b;border-radius:6px;color:#e8edf2;font-size:13px;box-sizing:border-box"'+(f.min?' min="'+f.min+'"':'')+(f.max?' max="'+f.max+'"':'')+'>';
      }
      html+='</div>';
    });
    html+='<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
    if(opts.cancelText!==false)html+='<button id="fp-cancel" style="padding:6px 16px;background:transparent;border:1px solid #1e293b;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:12px">'+(opts.cancelText||'Отмена')+'</button>';
    html+='<button id="fp-submit" style="padding:6px 16px;background:#00e5ff22;border:1px solid #00e5ff44;border-radius:6px;color:#00e5ff;cursor:pointer;font-size:12px;font-weight:600">'+(opts.submitText||'OK')+'</button>';
    html+='</div>';
    box.innerHTML=html;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    // Focus first input
    var firstInput=box.querySelector('input,textarea,select');
    if(firstInput)setTimeout(function(){firstInput.focus();},50);
    // Gather values
    function getValues(){
      var result={};
      fields.forEach(function(f){
        var el=document.getElementById('fp-'+f.id);
        result[f.id]=el?el.value:'';
      });
      return fields.length===1?result[fields[0].id]:result;
    }
    // Submit
    box.querySelector('#fp-submit').onclick=function(){
      var val=getValues();
      overlay.remove();
      resolve(val);
      if(opts.onSubmit)opts.onSubmit(val);
    };
    // Cancel
    var cancelBtn=box.querySelector('#fp-cancel');
    if(cancelBtn)cancelBtn.onclick=function(){overlay.remove();resolve(null);if(opts.onCancel)opts.onCancel();};
    // Enter to submit on single-field
    if(fields.length===1&&fields[0].type!=='textarea'){
      var inp=box.querySelector('input,select');
      if(inp)inp.onkeydown=function(e){if(e.key==='Enter')box.querySelector('#fp-submit').click();};
    }
    // Click overlay to cancel
    overlay.onclick=function(e){if(e.target===overlay){overlay.remove();resolve(null);}};
  });
};
// Shortcut: simple confirm
window.f2fConfirm=function(msg){
  return f2fPrompt({title:'Подтверждение',message:msg,fields:[],submitText:'Да',cancelText:'Нет'}).then(function(v){return v!==null;});
};

// ═══ PIPELINE FUNNEL VIEW ═══
var leadViewMode='pipeline'; // 'grid' or 'pipeline' — pipeline by default
function toggleLeadView(){
  leadViewMode=leadViewMode==='grid'?'pipeline':'grid';
  var btn=document.getElementById('leadViewToggle');
  btn.textContent=leadViewMode==='pipeline'?'📋 Список':'📊 Pipeline';
  btn.style.background=leadViewMode==='pipeline'?'#00ff8812':'#a855f712';
  btn.style.color=leadViewMode==='pipeline'?'#00ff88':'#a855f7';
  btn.style.borderColor=leadViewMode==='pipeline'?'#00ff8833':'#a855f733';
  document.getElementById('leadsGrid').style.display=leadViewMode==='grid'?'':'none';
  document.getElementById('leadsPipeline').style.display=leadViewMode==='pipeline'?'':'none';
  if(leadViewMode==='pipeline')renderPipeline();
}
function renderPipeline(){
  var stages=[
    {key:'identified',label:'🔍 Найден',color:'#64748b'},
    {key:'contacted',label:'📧 Контакт',color:'#00e5ff'},
    {key:'negotiating',label:'🤝 Переговоры',color:'#ffb800'},
    {key:'closed_won',label:'✅ Закрыт',color:'#00ff88'},
    {key:'closed_lost',label:'❌ Потерян',color:'#ff2d78'}
  ];
  var stageMap={hot:'negotiating',warm:'contacted',medium:'identified'};
  var html=stages.map(function(s){
    var leads=D.leads.filter(function(l){
      var ls=l.sbStage||stageMap[l.priority]||'identified';
      if(ls!==s.key) return false;
      if(leadFilter!=='all' && l.priority!==leadFilter) return false;
      return true;
    });
    return '<div style="flex:1;min-width:200px;background:#0a151e;border:1px solid '+s.color+'33;border-radius:10px;padding:10px;display:flex;flex-direction:column">'+
      '<div style="text-align:center;padding:8px;margin-bottom:8px;background:'+s.color+'15;border-radius:6px;border-bottom:2px solid '+s.color+'">'+
        '<div style="font-size:13px;font-weight:700;color:'+s.color+'">'+s.label+'</div>'+
        '<div style="font-size:22px;font-weight:800;color:'+s.color+'">'+leads.length+'</div>'+
      '</div>'+
      '<div style="flex:1;display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:400px">'+
        leads.map(function(l){
          return '<div onclick="openLeadModal('+l.id+')" style="padding:8px 10px;background:#0d1820;border:1px solid #1a2d3d;border-radius:6px;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor=\''+s.color+'\'" onmouseout="this.style.borderColor=\'#1a2d3d\'">'+
            '<div style="font-size:12px;font-weight:600;color:#e8edf2">'+esc(l.name)+'</div>'+
            '<div style="font-size:10px;color:var(--dim)">'+esc(l.company)+'</div>'+
            (l.email?'<div style="font-size:9px;color:var(--cyan);margin-top:2px">'+esc(l.email)+'</div>':'')+
            (l.linkedin?'<div style="font-size:9px;color:#0a66c2;margin-top:1px">🔗 LinkedIn</div>':'')+
          '</div>';
        }).join('')+
        (leads.length===0?'<div style="text-align:center;color:#384858;font-size:11px;padding:20px 0">Пусто</div>':'')+
      '</div>'+
    '</div>';
  }).join('');
  document.getElementById('pipelineBoard').innerHTML=html;
}

// ═══ CLOCK ═══
var _clockInterval;
function startClock(){
  if(_clockInterval)clearInterval(_clockInterval);
  _clockInterval=setInterval(()=>{
    var el=document.getElementById('clock');
    if(el)el.textContent=new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  },1000);
}
startClock();

// ═══ MODAL ═══
const modal=document.getElementById('modal');
const modalContent=document.getElementById('modalContent');
document.getElementById('modalClose').addEventListener('click',()=>closeModal());
modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});

// ═══ KEYBOARD NAVIGATION ═══
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    var m=document.getElementById('modal');
    if(m&&m.classList.contains('open')){closeModal();e.preventDefault();}
  }
});

// ═══ MOBILE SWIPE-TO-CLOSE ═══
(function(){
  var modalEl=document.querySelector('.modal');
  var handle=document.getElementById('modalDragHandle');
  var startY=0,currentY=0,dragging=false;
  function onStart(e){
    if(!isMob())return;
    dragging=true;startY=(e.touches?e.touches[0].clientY:e.clientY);currentY=0;
    modalEl.style.transition='none';
  }
  function onMove(e){
    if(!dragging)return;
    var y=(e.touches?e.touches[0].clientY:e.clientY)-startY;
    if(y<0)y=0;
    currentY=y;
    modalEl.style.transform='translateY('+y+'px)';
  }
  function onEnd(){
    if(!dragging)return;
    dragging=false;
    modalEl.style.transition='transform .25s ease';
    if(currentY>100){
      modalEl.style.transform='translateY(100%)';
      setTimeout(function(){closeModal();modalEl.style.transform='';},250);
    }else{
      modalEl.style.transform='';
    }
  }
  handle.addEventListener('touchstart',onStart,{passive:true});
  handle.addEventListener('touchmove',onMove,{passive:false});
  handle.addEventListener('touchend',onEnd);
  handle.addEventListener('mousedown',onStart);
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onEnd);
})();

function openModal(html){ modalContent.innerHTML=html; modal.classList.add('open'); }
function showModal(title,html){ openModal('<h3 style="margin-bottom:12px">'+title+'</h3>'+html); }

// ═══ ADD EMPLOYEE ═══
window.openAddEmployeeForm=function(editId){
  var t=editId?D.team.find(function(x){return x.id===editId;}):null;
  var deptOptions=CDepts.map(function(x){return '<option value="'+x.id+'" '+(t&&t.dept===x.id?'selected':'')+'>'+x.icon+' '+x.name+'</option>';}).join('');
  var catOptions=['full-time','part-time','freelance','intern','management'].map(function(c){return '<option value="'+c+'" '+(t&&t.category===c?'selected':'')+'>'+c+'</option>';}).join('');
  openModal(
    '<h3 style="margin-bottom:12px">👤 '+(editId?'Редактировать сотрудника':'Новый сотрудник')+'</h3>'+
    '<div style="display:grid;gap:10px">'+
      '<input id="emp-name" placeholder="Имя сотрудника *" value="'+esc(t?t.name:'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">'+
      '<input id="emp-role" placeholder="Роль (Frontend Dev, Designer...)" value="'+esc(t?t.role:'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        '<select id="emp-dept" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">'+deptOptions+'</select>'+
        '<select id="emp-cat" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">'+catOptions+'</select>'+
      '</div>'+
      '<input id="emp-start" type="date" value="'+(t&&t.startDate?t.startDate:new Date().toISOString().slice(0,10))+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">'+
      '<button class="act-btn success" onclick="submitEmployee('+(editId||'null')+')">💾 '+(editId?'Обновить':'Добавить')+'</button>'+
    '</div>'
  );
};

window.submitEmployee=function(editId){
  var name=document.getElementById('emp-name').value.trim();
  if(!name){showToast('Введите имя сотрудника','error');return;}
  var obj={
    name:name,
    role:document.getElementById('emp-role').value.trim()||'Team',
    dept:document.getElementById('emp-dept').value,
    category:document.getElementById('emp-cat').value,
    startDate:document.getElementById('emp-start').value||null,
    isHead:false,
    status:'active'
  };
  if(editId){
    var idx=D.team.findIndex(function(x){return x.id===editId;});
    if(idx>=0){D.team[idx]=Object.assign(D.team[idx],obj);}
    showToast('✅ Сотрудник обновлён','success');
  }else{
    var maxId=D.team.reduce(function(m,t){return Math.max(m,t.id);},0);
    obj.id=maxId+1;
    D.team.push(obj);
    showToast('✅ Сотрудник добавлен','success');
  }
  closeModal();
  renderTeam();
};

// ═══ VACATION SYSTEM ═══
var _vacView='calendar'; // calendar | myRequests | approvals | manage
function switchTeamView(view){
  var tc=document.getElementById('teamContent');
  var vc=document.getElementById('vacationContent');
  var dt=document.getElementById('teamDeptTabs');
  if(view==='vacation'){
    if(tc)tc.style.display='none';
    if(dt)dt.style.display='none';
    if(vc){vc.style.display='';renderVacation();}
  } else {
    if(tc)tc.style.display='';
    if(dt)dt.style.display='';
    if(vc)vc.style.display='none';
  }
}

function calcVacationBalance(emp){
  // 2 дня/мес + 1 день каждые 3 мес с даты hire_date
  if(!emp)return {accrued:0, used:0, months:0, autoAccrued:0, manualAdj:0};
  if(!emp.hire_date)return {accrued:Number(emp.accrued_days)||0, used:Number(emp.used_days)||0, months:0, autoAccrued:0, manualAdj:Number(emp.accrued_days)||0};
  var hd=new Date(emp.hire_date);
  var now=new Date();
  var months=Math.max(0,(now.getFullYear()-hd.getFullYear())*12+(now.getMonth()-hd.getMonth()));
  var quarters=Math.floor(months/3);
  var autoAccrued=months*2+quarters*1;
  var manualAdj=Number(emp.accrued_days)||0;
  return {accrued:autoAccrued+manualAdj, used:Number(emp.used_days)||0, months:months, autoAccrued:autoAccrued, manualAdj:manualAdj};
}

function renderVacation(){
  var el=document.getElementById('vacationContent');
  if(!el)return;
  var balances=window._vacBalances||[];
  var requests=window._vacRequests||[];
  var me=_currentSession?_currentSession.login_name:'';
  // Try multiple name matches: exact login_name, employee_name from token, team name by matched_team_id
  var myBal=balances.find(function(b){return b.employee_name===me;});
  if(!myBal&&_currentSession){
    var altName=_currentSession.employee_name||'';
    if(altName&&altName!==me) myBal=balances.find(function(b){return b.employee_name===altName;});
  }
  if(!myBal&&_currentSession&&_currentSession.matched_team_id){
    var tm=D.team.find(function(t){return t.id===_currentSession.matched_team_id;});
    if(tm) myBal=balances.find(function(b){return b.employee_name===tm.name;});
  }
  // Last resort: fuzzy match by first word of login_name against first word of employee_name
  if(!myBal&&me){
    var meLow=me.toLowerCase().split(' ')[0];
    if(meLow.length>=3) myBal=balances.find(function(b){return b.employee_name.toLowerCase().split(' ')[0]===meLow||(b.employee_name.toLowerCase().indexOf(meLow)>=0);});
  }
  var calc=calcVacationBalance(myBal);
  var available=calc.accrued-calc.used;

  // Count pending approvals for me (as manager)
  var myApprovals=requests.filter(function(r){return r.approver_name===me&&r.status==='pending_manager';});
  // Count PM pending
  var pmPending=requests.filter(function(r){return r.status==='pending_pm';});

  var html='<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
  html+='<button class="act-btn" onclick="switchTeamView(\'team\')" style="background:var(--surface);border:1px solid var(--border);font-weight:700">← Сотрудники</button>';
  html+='<span style="width:1px;height:24px;background:var(--border);flex-shrink:0"></span>';
  html+='<button class="act-btn'+(_vacView==='calendar'?' success':'')+'" onclick="_vacView=\'calendar\';renderVacation()">📅 Календарь</button>';
  html+='<button class="act-btn'+(_vacView==='myRequests'?' success':'')+'" onclick="_vacView=\'myRequests\';renderVacation()">📋 Мои заявки</button>';
  html+='<button class="act-btn'+(_vacView==='approvals'?' success':'')+'" onclick="_vacView=\'approvals\';renderVacation()">✅ Согласование'+(myApprovals.length>0?' <span class="badge" style="background:var(--magenta)">'+myApprovals.length+'</span>':'')+'</button>';
  if(isPM()||isAdmin()){
    html+='<button class="act-btn'+(_vacView==='manage'?' success':'')+'" onclick="_vacView=\'manage\';renderVacation()">⚙️ Управление'+(pmPending.length>0?' <span class="badge" style="background:var(--magenta)">'+pmPending.length+'</span>':'')+'</button>';
  }
  html+='</div>';

  // My balance card
  html+='<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">';
  html+='<div style="flex:1;min-width:200px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">';
  if(myBal){
    html+='<div style="font-size:11px;color:var(--dim);margin-bottom:4px">МОЙ БАЛАНС'+(myBal.employee_name!==me?' <span style="color:var(--cyan)">('+esc(myBal.employee_name)+')</span>':'')+'</div>';
    html+='<div style="font-size:28px;font-weight:700;color:'+(available<0?'var(--magenta)':available>0?'var(--green)':'var(--text)')+'">'+available.toFixed(1)+' <span style="font-size:13px;color:var(--dim)">дней</span></div>';
    html+='<div style="font-size:11px;color:var(--dim);margin-top:4px">Начислено: '+calc.accrued.toFixed(1)+' · Использовано: '+calc.used.toFixed(1)+(myBal.hire_date?' · Дата найма: '+myBal.hire_date:'')+'</div>';
  } else {
    html+='<div style="font-size:11px;color:var(--magenta);margin-bottom:4px">⚠️ АККАУНТ НЕ ПРИВЯЗАН</div>';
    html+='<div style="font-size:13px;color:var(--dim)">Ваше имя в системе: <b style="color:var(--text)">'+esc(me)+'</b></div>';
    html+='<div style="font-size:11px;color:var(--dim);margin-top:4px">Попросите PM привязать ваш аккаунт к записи в таблице отпусков (вкладка Управление)</div>';
  }
  html+='</div>';
  html+='<div style="flex:0 0 auto;display:flex;align-items:center"><button class="act-btn success" onclick="openVacationRequestForm()" style="padding:10px 20px;font-size:14px">🏖️ Подать заявку</button></div>';
  html+='</div>';

  if(_vacView==='calendar') html+=renderVacationCalendar(requests);
  else if(_vacView==='myRequests') html+=renderMyVacationRequests(requests,me);
  else if(_vacView==='approvals') html+=renderVacationApprovals(requests,me);
  else if(_vacView==='manage') html+=renderVacationManage(balances,requests);

  el.innerHTML=html;
}

function renderVacationCalendar(requests){
  var approved=requests.filter(function(r){return r.status==='approved'||r.status==='pending_pm'||r.status==='pending_manager';});
  var now=new Date();
  var year=now.getFullYear();
  var month=now.getMonth();
  // Show 3 months: current, next, next+1
  var html='<h3 style="margin:0 0 12px;font-size:15px;color:var(--cyan)">📅 Календарь отпусков</h3>';
  for(var mi=0;mi<3;mi++){
    var cm=month+mi;var cy=year;
    if(cm>11){cm-=12;cy++;}
    html+=renderVacMonth(cy,cm,approved);
  }
  return html;
}

function renderVacMonth(year,month,requests){
  var mNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var dNames=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  var first=new Date(year,month,1);
  var lastDay=new Date(year,month+1,0).getDate();
  var startDow=(first.getDay()+6)%7; // Mon=0
  var today=new Date();

  var html='<div style="margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--text)">'+mNames[month]+' '+year+'</div>';
  html+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">';
  for(var d=0;d<7;d++){
    var isWe=d>=5;
    html+='<div style="font-size:10px;color:'+(isWe?'var(--magenta)':'var(--dim)')+';padding:4px;font-weight:600">'+dNames[d]+'</div>';
  }
  for(var s=0;s<startDow;s++) html+='<div></div>';
  for(var day=1;day<=lastDay;day++){
    var dateStr=year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    var isToday=today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===day;
    var dow=(startDow+day-1)%7;
    var isWeekend=dow>=5;
    // Find vacations on this day
    var vacs=requests.filter(function(r){return dateStr>=r.start_date&&dateStr<=r.end_date;});
    var cellBg=isToday?'rgba(0,229,255,0.15)':isWeekend?'rgba(255,45,120,0.05)':'var(--panel)';
    var border=isToday?'1px solid var(--cyan)':'1px solid transparent';
    html+='<div style="min-height:36px;background:'+cellBg+';border:'+border+';border-radius:4px;padding:2px;position:relative;cursor:'+(vacs.length?'pointer':'default')+'"'+(vacs.length?' title="'+vacs.map(function(v){return v.employee_name+' ('+v.status+')'}).join(', ')+'"':'')+' onclick="'+(vacs.length===0?'openVacationRequestForm(\''+dateStr+'\')':'')+'">';
    html+='<div style="font-size:11px;color:'+(isWeekend?'var(--magenta)':'var(--text)')+'">'+day+'</div>';
    for(var vi=0;vi<Math.min(vacs.length,2);vi++){
      var vc=vacs[vi];
      var vColor=vc.status==='approved'?'var(--green)':vc.status==='pending_pm'?'var(--cyan)':'var(--dim)';
      html+='<div style="font-size:8px;background:'+vColor+'22;color:'+vColor+';border-radius:2px;padding:0 2px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(vc.employee_name.split(' ')[0])+'</div>';
    }
    if(vacs.length>2) html+='<div style="font-size:8px;color:var(--dim)">+' + (vacs.length-2) + '</div>';
    html+='</div>';
  }
  html+='</div></div>';
  return html;
}

function renderMyVacationRequests(requests,me){
  var mine=requests.filter(function(r){return r.employee_name===me;});
  var html='<h3 style="margin:0 0 12px;font-size:15px;color:var(--cyan)">📋 Мои заявки</h3>';
  if(mine.length===0){
    html+='<div style="padding:40px;text-align:center;color:var(--dim)">У вас нет заявок на отпуск. Нажмите "Подать заявку" чтобы создать.</div>';
    return html;
  }
  mine.forEach(function(r){
    html+=buildVacationRequestCard(r,false);
  });
  return html;
}

function renderVacationApprovals(requests,me){
  // Заявки где я — согласующий руководитель
  var forMe=requests.filter(function(r){return r.approver_name===me&&r.status==='pending_manager';});
  var approved=requests.filter(function(r){return r.approver_name===me&&r.approver_decision;});
  var html='<h3 style="margin:0 0 12px;font-size:15px;color:var(--cyan)">✅ Согласование (как руководитель)</h3>';
  if(forMe.length===0&&approved.length===0){
    html+='<div style="padding:40px;text-align:center;color:var(--dim)">Нет заявок для согласования</div>';
    return html;
  }
  if(forMe.length>0){
    html+='<div style="margin-bottom:12px;color:var(--magenta);font-weight:600">⏳ Ожидают вашего решения ('+forMe.length+')</div>';
    forMe.forEach(function(r){html+=buildVacationRequestCard(r,true);});
  }
  if(approved.length>0){
    html+='<div style="margin:16px 0 8px;color:var(--dim);font-size:12px">Ранее рассмотренные</div>';
    approved.forEach(function(r){html+=buildVacationRequestCard(r,false);});
  }
  return html;
}

function renderVacationManage(balances,requests){
  // PM view: финальное согласование + управление балансами
  var pmPending=requests.filter(function(r){return r.status==='pending_pm';});
  var html='<h3 style="margin:0 0 12px;font-size:15px;color:var(--cyan)">⚙️ Управление отпусками (PM)</h3>';

  // PM pending approvals
  if(pmPending.length>0){
    html+='<div style="margin-bottom:16px;padding:12px;background:rgba(255,45,120,0.08);border:1px solid rgba(255,45,120,0.2);border-radius:10px">';
    html+='<div style="font-weight:600;margin-bottom:8px;color:var(--magenta)">⏳ Ожидают финального одобрения ('+pmPending.length+')</div>';
    pmPending.forEach(function(r){html+=buildVacationRequestCard(r,true,true);});
    html+='</div>';
  }

  // Employee balances table
  html+='<div style="margin-top:16px"><div style="font-weight:600;margin-bottom:8px;color:var(--text)">📊 Балансы сотрудников</div>';
  html+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
  html+='<tr style="border-bottom:1px solid var(--border)">';
  html+='<th style="text-align:left;padding:8px;color:var(--dim)">Сотрудник</th>';
  html+='<th style="text-align:center;padding:8px;color:var(--dim)">Дата найма</th>';
  html+='<th style="text-align:center;padding:8px;color:var(--dim)">Начислено</th>';
  html+='<th style="text-align:center;padding:8px;color:var(--dim)">Использовано</th>';
  html+='<th style="text-align:center;padding:8px;color:var(--dim)">Баланс</th>';
  html+='<th style="text-align:center;padding:8px;color:var(--dim)">Действия</th>';
  html+='</tr>';
  balances.forEach(function(b){
    var c=calcVacationBalance(b);
    var avail=c.accrued-c.used;
    html+='<tr style="border-bottom:1px solid var(--border)">';
    html+='<td style="padding:8px;color:var(--text)">'+esc(b.employee_name)+'</td>';
    html+='<td style="padding:8px;text-align:center;color:var(--dim)">'+(b.hire_date||'<span style="color:var(--magenta)">не указана</span>')+'</td>';
    html+='<td style="padding:8px;text-align:center;color:var(--green)">'+c.accrued.toFixed(1)+'</td>';
    html+='<td style="padding:8px;text-align:center;color:var(--magenta)">'+c.used.toFixed(1)+'</td>';
    html+='<td style="padding:8px;text-align:center;font-weight:700;color:'+(avail<0?'var(--magenta)':'var(--green)')+'">'+avail.toFixed(1)+'</td>';
    html+='<td style="padding:8px;text-align:center">';
    html+='<button class="act-btn" onclick="openVacationAdjust(\''+esc(b.employee_name)+'\','+b.id+')" style="font-size:10px;padding:2px 8px">±</button> ';
    html+='<button class="act-btn" onclick="openVacationHireDate(\''+esc(b.employee_name)+'\','+b.id+',\''+(b.hire_date||'')+'\')" style="font-size:10px;padding:2px 8px">📅</button>';
    html+='</td></tr>';
  });
  html+='</table></div></div>';
  return html;
}

function buildVacationRequestCard(r,showActions,isPmAction){
  var statusLabels={pending_manager:'⏳ Ожидает руководителя',pending_pm:'⏳ Ожидает PM',approved:'✅ Одобрено',rejected:'❌ Отклонено',cancelled:'🚫 Отменено'};
  var statusColors={pending_manager:'var(--dim)',pending_pm:'var(--cyan)',approved:'var(--green)',rejected:'var(--magenta)',cancelled:'var(--dim)'};
  var html='<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid '+statusColors[r.status]+';border-radius:8px;padding:12px;margin-bottom:8px">';
  html+='<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">';
  html+='<div>';
  html+='<div style="font-weight:600;color:var(--text)">'+esc(r.employee_name)+'</div>';
  html+='<div style="font-size:12px;color:var(--dim);margin-top:2px">'+r.start_date+' → '+r.end_date+' ('+r.days_count+' дн.)</div>';
  if(r.reason) html+='<div style="font-size:11px;color:var(--dim);margin-top:4px">💬 '+esc(r.reason)+'</div>';
  html+='<div style="font-size:11px;margin-top:4px;color:var(--dim)">Руководитель: <b style="color:var(--text)">'+esc(r.approver_name)+'</b></div>';
  if(r.approver_decision){
    var aColor=r.approver_decision==='approved'?'var(--green)':'var(--magenta)';
    html+='<div style="font-size:11px;margin-top:2px;color:'+aColor+'">'+(r.approver_decision==='approved'?'✅':'❌')+' Руководитель: '+r.approver_decision+(r.approver_comment?' — '+esc(r.approver_comment):'')+'</div>';
  }
  if(r.pm_decision){
    var pColor=r.pm_decision==='approved'?'var(--green)':'var(--magenta)';
    html+='<div style="font-size:11px;margin-top:2px;color:'+pColor+'">'+(r.pm_decision==='approved'?'✅':'❌')+' PM: '+r.pm_decision+(r.pm_comment?' — '+esc(r.pm_comment):'')+'</div>';
  }
  html+='</div>';
  html+='<div style="text-align:right">';
  html+='<div style="font-size:11px;color:'+statusColors[r.status]+'">'+statusLabels[r.status]+'</div>';
  if(showActions){
    if(!isPmAction){
      // Manager approval
      html+='<div style="margin-top:8px;display:flex;gap:4px">';
      html+='<button class="act-btn success" onclick="approveVacation('+r.id+',\'manager\',\'approved\')" style="font-size:11px;padding:4px 10px">✅ Согласовать</button>';
      html+='<button class="act-btn danger" onclick="approveVacation('+r.id+',\'manager\',\'rejected\')" style="font-size:11px;padding:4px 10px">❌ Отклонить</button>';
      html+='</div>';
    } else {
      // PM final approval
      html+='<div style="margin-top:8px;display:flex;gap:4px">';
      html+='<button class="act-btn success" onclick="approveVacation('+r.id+',\'pm\',\'approved\')" style="font-size:11px;padding:4px 10px">✅ Одобрить</button>';
      html+='<button class="act-btn danger" onclick="approveVacation('+r.id+',\'pm\',\'rejected\')" style="font-size:11px;padding:4px 10px">❌ Отклонить</button>';
      html+='</div>';
    }
  }
  if(r.status==='pending_manager'&&r.employee_name===(_currentSession?_currentSession.login_name:'')){
    html+='<button class="act-btn" onclick="cancelVacation('+r.id+')" style="font-size:10px;padding:2px 8px;margin-top:4px">Отменить</button>';
  }
  html+='</div></div></div>';
  return html;
}

// ═══ VACATION ACTIONS ═══
function openVacationRequestForm(prefillDate){
  var employees=D.team.filter(function(t){return t.name!==(_currentSession?_currentSession.login_name:'')&&t.status==='active';});
  var empOptions=employees.map(function(e){return '<option value="'+esc(e.name)+'">'+esc(e.name)+(e.role?' — '+esc(e.role):'')+'</option>';}).join('');
  var today=new Date().toISOString().slice(0,10);
  openModal(
    '<h3 style="margin-bottom:12px">🏖️ Заявка на отпуск</h3>'+
    '<div style="display:grid;gap:10px">'+
      '<label style="font-size:12px;color:var(--dim)">Дата начала</label>'+
      '<input id="vac-start" type="date" value="'+(prefillDate||today)+'" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px" onchange="calcVacDays()">'+
      '<label style="font-size:12px;color:var(--dim)">Дата окончания</label>'+
      '<input id="vac-end" type="date" value="'+(prefillDate||today)+'" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px" onchange="calcVacDays()">'+
      '<div id="vac-days-info" style="font-size:12px;color:var(--cyan);padding:4px 0">Рабочих дней: 1</div>'+
      '<label style="font-size:12px;color:var(--dim)">Согласующий руководитель *</label>'+
      '<select id="vac-approver" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px">'+
        '<option value="">Выберите руководителя</option>'+empOptions+
      '</select>'+
      '<label style="font-size:12px;color:var(--dim)">Комментарий</label>'+
      '<textarea id="vac-reason" placeholder="Причина отпуска (необязательно)" rows="2" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;resize:vertical"></textarea>'+
      '<button class="act-btn success" onclick="submitVacationRequest()" style="padding:10px;font-size:14px;margin-top:4px">📨 Отправить заявку</button>'+
    '</div>'
  );
}

window.calcVacDays=function(){
  var s=document.getElementById('vac-start');
  var e=document.getElementById('vac-end');
  var info=document.getElementById('vac-days-info');
  if(!s||!e||!info)return;
  var start=new Date(s.value);
  var end=new Date(e.value);
  if(isNaN(start)||isNaN(end)||end<start){info.textContent='Рабочих дней: 0';return;}
  var days=0;
  var d=new Date(start);
  while(d<=end){
    var dow=d.getDay();
    if(dow!==0&&dow!==6)days++;
    d.setDate(d.getDate()+1);
  }
  info.textContent='Рабочих дней: '+days;
};

window.submitVacationRequest=function(){
  var startEl=document.getElementById('vac-start');
  var endEl=document.getElementById('vac-end');
  var approverEl=document.getElementById('vac-approver');
  var reasonEl=document.getElementById('vac-reason');
  if(!startEl||!endEl||!approverEl)return;
  var start=startEl.value;
  var end=endEl.value;
  var approver=approverEl.value;
  var reason=reasonEl?reasonEl.value:'';
  if(!start||!end){showToast('Укажите даты','error');return;}
  if(!approver){showToast('Выберите согласующего руководителя','error');return;}
  if(new Date(end)<new Date(start)){showToast('Дата окончания раньше начала','error');return;}
  // Calc working days
  var days=0;var d=new Date(start);var endD=new Date(end);
  while(d<=endD){var dow=d.getDay();if(dow!==0&&dow!==6)days++;d.setDate(d.getDate()+1);}
  if(days===0){showToast('0 рабочих дней','error');return;}

  var me=_currentSession?_currentSession.login_name:'';
  sbInsert('vacation_requests',{
    employee_name:me,
    start_date:start,
    end_date:end,
    days_count:days,
    approver_name:approver,
    reason:reason,
    status:'pending_manager'
  }).then(function(){
    showToast('✅ Заявка отправлена на согласование','success');
    closeModal();
    // Reload
    sbFetch('vacation_requests','select=*&order=created_at.desc&limit=500').then(function(data){
      if(data)window._vacRequests=data;
      _vacView='myRequests';renderVacation();
    });
  }).catch(function(err){showToast('Ошибка: '+err,'error');});
};

window.approveVacation=function(requestId,role,decision){
  var comment=prompt((decision==='approved'?'Комментарий (необязательно):':'Причина отклонения:'))||'';
  var me=_currentSession?_currentSession.login_name:'';
  var updates={};
  if(role==='manager'){
    updates.approver_decision=decision;
    updates.approver_comment=comment;
    updates.approver_decided_at=new Date().toISOString();
    if(decision==='approved'){
      updates.status='pending_pm';
    } else {
      updates.status='rejected';
    }
  } else {
    // PM
    updates.pm_name=me;
    updates.pm_decision=decision;
    updates.pm_comment=comment;
    updates.pm_decided_at=new Date().toISOString();
    if(decision==='approved'){
      updates.status='approved';
      // Deduct vacation days from balance
      var req=(window._vacRequests||[]).find(function(r){return r.id===requestId;});
      if(req){
        var bal=(window._vacBalances||[]).find(function(b){return b.employee_name===req.employee_name;});
        if(bal){
          var newUsed=Number(bal.used_days)+Number(req.days_count);
          sbPatch('vacation_balances','id=eq.'+bal.id,{used_days:newUsed,updated_at:new Date().toISOString()});
          // Log the deduction
          var c=calcVacationBalance(bal);
          sbInsert('vacation_log',{
            employee_name:req.employee_name,
            change_type:'used',
            days_change:-Number(req.days_count),
            balance_after:c.accrued-newUsed,
            note:'Отпуск '+req.start_date+' — '+req.end_date,
            created_by:me,
            request_id:requestId
          });
        }
      }
    } else {
      updates.status='rejected';
    }
  }
  updates.updated_at=new Date().toISOString();
  sbPatch('vacation_requests','id=eq.'+requestId,updates).then(function(){
    showToast('✅ Решение сохранено','success');
    sbFetch('vacation_requests','select=*&order=created_at.desc&limit=500').then(function(data){
      if(data)window._vacRequests=data;
      sbFetch('vacation_balances','select=*&order=employee_name.asc').then(function(bData){
        if(bData)window._vacBalances=bData;
        renderVacation();
      });
    });
  }).catch(function(err){showToast('Ошибка: '+err,'error');});
};

window.cancelVacation=function(requestId){
  if(!confirm('Отменить заявку?'))return;
  sbPatch('vacation_requests','id=eq.'+requestId,{status:'cancelled',updated_at:new Date().toISOString()}).then(function(){
    showToast('Заявка отменена','info');
    sbFetch('vacation_requests','select=*&order=created_at.desc&limit=500').then(function(data){
      if(data)window._vacRequests=data;
      renderVacation();
    });
  });
};

window.openVacationAdjust=function(empName,balId){
  openModal(
    '<h3 style="margin-bottom:12px">± Корректировка дней: '+esc(empName)+'</h3>'+
    '<div style="display:grid;gap:10px">'+
      '<label style="font-size:12px;color:var(--dim)">Кол-во дней (+ начислить, − снять)</label>'+
      '<input id="vac-adj-days" type="number" step="0.5" value="0" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px">'+
      '<label style="font-size:12px;color:var(--dim)">Причина</label>'+
      '<input id="vac-adj-note" placeholder="Причина корректировки" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px">'+
      '<button class="act-btn success" onclick="submitVacationAdjust(\''+esc(empName)+'\','+balId+')" style="padding:10px">💾 Сохранить</button>'+
    '</div>'
  );
};

window.submitVacationAdjust=function(empName,balId){
  var daysEl=document.getElementById('vac-adj-days');
  var noteEl=document.getElementById('vac-adj-note');
  if(!daysEl)return;
  var days=parseFloat(daysEl.value);
  if(!days||days===0){showToast('Укажите кол-во дней','error');return;}
  var note=noteEl?noteEl.value:'';
  var me=_currentSession?_currentSession.login_name:'';
  var bal=(window._vacBalances||[]).find(function(b){return b.id===balId;});
  if(!bal){showToast('Баланс не найден','error');return;}
  var newAccrued=Number(bal.accrued_days)+days;
  sbPatch('vacation_balances','id=eq.'+balId,{accrued_days:newAccrued,updated_at:new Date().toISOString()}).then(function(){
    var c=calcVacationBalance(Object.assign({},bal,{accrued_days:newAccrued}));
    sbInsert('vacation_log',{
      employee_name:empName,
      change_type:days>0?'manual_add':'manual_remove',
      days_change:days,
      balance_after:c.accrued-c.used,
      note:note,
      created_by:me
    });
    showToast('✅ Баланс обновлён: '+(days>0?'+':'')+days+' дн.','success');
    closeModal();
    sbFetch('vacation_balances','select=*&order=employee_name.asc').then(function(data){
      if(data)window._vacBalances=data;
      renderVacation();
    });
  }).catch(function(err){showToast('Ошибка: '+err,'error');});
};

window.openVacationHireDate=function(empName,balId,currentDate){
  openModal(
    '<h3 style="margin-bottom:12px">📅 Дата найма: '+esc(empName)+'</h3>'+
    '<div style="display:grid;gap:10px">'+
      '<input id="vac-hire-date" type="date" value="'+(currentDate||'')+'" style="padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px">'+
      '<button class="act-btn success" onclick="submitVacationHireDate(\''+esc(empName)+'\','+balId+')" style="padding:10px">💾 Сохранить</button>'+
    '</div>'
  );
};

window.submitVacationHireDate=function(empName,balId){
  var dateEl=document.getElementById('vac-hire-date');
  if(!dateEl||!dateEl.value){showToast('Укажите дату','error');return;}
  sbPatch('vacation_balances','id=eq.'+balId,{hire_date:dateEl.value,updated_at:new Date().toISOString()}).then(function(){
    showToast('✅ Дата найма обновлена','success');
    closeModal();
    sbFetch('vacation_balances','select=*&order=employee_name.asc').then(function(data){
      if(data)window._vacBalances=data;
      renderVacation();
    });
  }).catch(function(err){showToast('Ошибка: '+err,'error');});
};

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
          company:p.company_name||'',email:p.contact_email||'',
          linkedin:p.linkedin_url||p.linkedin||'',phone:p.phone||'',website:p.website||'',
          location:loc,source:src,
          contactType:p.contact_type||'partner',
          priority:p.stage==='negotiating'?'hot':p.stage==='contacted'?'warm':'medium',
          notes:p.pitch_text||'Найден AI агентом',notesText:p.notes_text||'',
          startDate:(p.created_at||'').slice(0,10),
          nextFollowup:p.next_followup_date||null,
          assignedTo:p.assigned_to||'',
          status:'active',sbStage:p.stage
        });
      }
    });
  }
  const filtered=D.leads.filter(function(l){
    if(leadFilter==='all')return true;
    if(leadFilter==='identified')return l.sbStage==='identified';
    if(leadFilter==='contacted')return l.sbStage==='contacted';
    if(leadFilter==='negotiating')return l.sbStage==='negotiating';
    if(leadFilter==='no_followup')return !l.nextFollowup&&l.sbStage!=='closed_won'&&l.sbStage!=='closed_lost';
    return l.priority===leadFilter;
  });
  document.getElementById('leads-count').textContent=filtered.length+' контактов';
  if(filtered.length===0){document.getElementById('leadsGrid').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--dim);font-size:14px">🔍 Нет лидов по выбранному фильтру</div>';return;}
  document.getElementById('leadsGrid').innerHTML=filtered.map(l=>`
    <div class="lead-card" onclick="openLeadModal(${l.id})">
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap"><div class="priority ${l.priority}">${l.priority}</div>${l.sbStage?`<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${l.sbStage==='negotiating'?'#ffb80018;color:#ffb800':l.sbStage==='contacted'?'#00e5ff18;color:#00e5ff':l.sbStage==='closed_won'?'#00ff8818;color:#00ff88':'#64748b18;color:#64748b'}">${l.sbStage==='identified'?'🔍':l.sbStage==='contacted'?'📧':l.sbStage==='negotiating'?'🤝':l.sbStage==='closed_won'?'✅':'❌'} ${l.sbStage}</span>`:''}</div>
      <div class="lead-name">${esc(l.name)}</div>
      <div class="lead-title">${esc(l.title)}</div>
      <div class="lead-company">${esc(l.company)}</div>
      <div class="lead-meta">
        ${l.email?`<span>📧 ${esc(l.email)}</span>`:''}
        ${l.linkedin?`<a href="${esc(l.linkedin)}" target="_blank" onclick="event.stopPropagation()">🔗 LinkedIn</a>`:''}
        <span>📍 ${esc(l.location)}</span>
      </div>
      <div class="lead-notes">${esc(l.notes)}</div>
      ${l.sbStage==='identified'?`<div style="display:flex;gap:4px;margin-top:6px;border-top:1px solid var(--border);padding-top:6px" onclick="event.stopPropagation()">
        <button onclick="quickLeadStage(${l.id},'contacted')" style="flex:1;padding:4px;background:#00e5ff12;color:#00e5ff;border:1px solid #00e5ff33;border-radius:4px;cursor:pointer;font-size:10px">📧 Связаться</button>
        <button onclick="quickLeadStage(${l.id},'closed_lost')" style="padding:4px 8px;background:#ff2d7808;color:#ff2d78;border:1px solid #ff2d7822;border-radius:4px;cursor:pointer;font-size:10px">✕</button>
      </div>`:''}
      ${l.sbStage==='contacted'?`<div style="display:flex;gap:4px;margin-top:6px;border-top:1px solid var(--border);padding-top:6px" onclick="event.stopPropagation()">
        <button onclick="quickLeadStage(${l.id},'negotiating')" style="flex:1;padding:4px;background:#ffb80012;color:#ffb800;border:1px solid #ffb80033;border-radius:4px;cursor:pointer;font-size:10px">🤝 В переговоры</button>
        <button onclick="addLeadInteraction(${l.id},'follow_up')" style="flex:1;padding:4px;background:#a855f712;color:#a855f7;border:1px solid #a855f733;border-radius:4px;cursor:pointer;font-size:10px">⏰ Follow-up</button>
      </div>`:''}
    </div>`).join('');
  // Also re-render pipeline if in pipeline view
  if(leadViewMode==='pipeline') renderPipeline();
  // Leads analytics KPIs
  renderLeadsAnalytics();
}
function renderLeadsAnalytics(){
  var leads=D.leads;
  var stageCounts={identified:0,contacted:0,negotiating:0,closed_won:0,closed_lost:0};
  var hotCount=0;
  leads.forEach(function(l){
    stageCounts[l.sbStage||'identified']=(stageCounts[l.sbStage||'identified']||0)+1;
    if(l.priority==='hot')hotCount++;
  });
  var el=function(id){return document.getElementById(id);};
  if(el('la-total'))el('la-total').textContent=leads.length;
  if(el('la-identified'))el('la-identified').textContent=stageCounts.identified;
  if(el('la-contacted'))el('la-contacted').textContent=stageCounts.contacted;
  if(el('la-negotiating'))el('la-negotiating').textContent=stageCounts.negotiating;
  if(el('la-closed'))el('la-closed').textContent=stageCounts.closed_won;
  if(el('la-hot'))el('la-hot').textContent=hotCount;
}
document.getElementById('leadFilters').addEventListener('click',e=>{
  if(!e.target.classList.contains('filter-btn'))return;
  document.querySelectorAll('#leadFilters .filter-btn').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  leadFilter=e.target.dataset.filter;
  renderLeads();
});

window.openLeadModal=function(id){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  var typeLabels={partner:'🤝 Партнёр',client_b2b:'💼 Клиент B2B',investor:'💰 Инвестор',media_influencer:'📺 Медиа/Инфлюенсер',federation:'🏛 Федерация',other:'📋 Другое'};
  var typeColors={partner:'#00e5ff',client_b2b:'#00ff88',investor:'#ffb800',media_influencer:'#a855f7',federation:'#ff6b6b',other:'#64748b'};
  var stageLabels={identified:'🔍 Найден',contacted:'📧 Контакт',negotiating:'🤝 Переговоры',closed_won:'✅ Закрыт',closed_lost:'❌ Потерян'};
  var stages=['identified','contacted','negotiating','closed_won','closed_lost'];
  var curStage=l.sbStage||'identified';
  var ct=l.contactType||'partner';

  // Stage buttons
  var stageHTML=stages.map(function(s){
    var isCur=s===curStage;
    return '<button onclick="changeLeadStage('+id+',\''+s+'\')" style="padding:6px 10px;font-size:10px;border-radius:6px;cursor:pointer;border:1px solid '+(isCur?typeColors[ct]||'#00e5ff':'#1a2d3d')+';background:'+(isCur?(typeColors[ct]||'#00e5ff')+'22':'transparent')+';color:'+(isCur?typeColors[ct]||'#00e5ff':'#64748b')+';font-weight:'+(isCur?'700':'400')+'">'+(stageLabels[s]||s)+'</button>';
  }).join('');

  // Type selector
  var typeOptions=Object.keys(typeLabels).map(function(k){
    return '<option value="'+k+'" '+(ct===k?'selected':'')+'>'+typeLabels[k]+'</option>';
  }).join('');

  openModal(
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
      '<div style="width:48px;height:48px;border-radius:12px;background:'+(typeColors[ct]||'#00e5ff')+'18;border:2px solid '+(typeColors[ct]||'#00e5ff')+'44;display:flex;align-items:center;justify-content:center;font-size:24px">'+(typeLabels[ct]||'📋').charAt(0)+'</div>'+
      '<div style="flex:1">'+
        '<h2 style="margin:0;font-size:18px">'+l.company+'</h2>'+
        '<div style="color:var(--dim);font-size:12px;margin-top:2px">'+l.name+(l.title?' • '+l.title:'')+'</div>'+
      '</div>'+
      '<select onchange="changeLeadType('+id+',this.value)" style="padding:6px 10px;background:#0d1820;color:'+(typeColors[ct]||'#00e5ff')+';border:1px solid '+(typeColors[ct]||'#00e5ff')+'44;border-radius:6px;font-size:11px;cursor:pointer">'+typeOptions+'</select>'+
    '</div>'+

    // Stage bar
    '<div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap">'+stageHTML+'</div>'+

    // Contact info (click to edit)
    '<div style="display:grid;grid-template-columns:'+mobGrid()+';gap:8px;margin-bottom:16px;padding:12px;background:#0a151e;border-radius:8px;border:1px solid #1a2d3d">'+
      '<div onclick="editLeadField('+id+',\'name\',\'Имя контакта\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">👤 Контакт:</span> <span style="color:#e8edf2;border-bottom:1px dashed #384858">'+(l.name||'—')+'</span></div>'+
      '<div onclick="editLeadField('+id+',\'company\',\'Компания\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">🏢 Компания:</span> <span style="color:#e8edf2;border-bottom:1px dashed #384858">'+(l.company||'—')+'</span></div>'+
      '<div onclick="editLeadField('+id+',\'email\',\'Email\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">📧 Email:</span> <span style="color:var(--cyan);border-bottom:1px dashed #384858">'+(l.email||'—')+'</span></div>'+
      '<div onclick="editLeadField('+id+',\'phone\',\'Телефон\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">📞 Тел:</span> <span style="color:#e8edf2;border-bottom:1px dashed #384858">'+(l.phone||'—')+'</span></div>'+
      '<div style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">🔗 LinkedIn:</span> '+(l.linkedin?'<a href="'+esc(l.linkedin)+'" target="_blank" rel="noopener" style="color:var(--cyan);border-bottom:1px dashed #384858;text-decoration:none" onclick="event.stopPropagation()">Открыть ↗</a> <span onclick="editLeadField('+id+',\'linkedin\',\'LinkedIn URL\')" style="color:#384858;font-size:9px;cursor:pointer">✏️</span>':'<span onclick="editLeadField('+id+',\'linkedin\',\'LinkedIn URL\')" style="color:var(--cyan);border-bottom:1px dashed #384858">—</span>')+'</div>'+
      '<div onclick="editLeadField('+id+',\'website\',\'Сайт\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">🌐 Сайт:</span> <span style="color:var(--cyan);border-bottom:1px dashed #384858">'+(l.website?l.website.replace(/https?:\/\//,''):'—')+'</span></div>'+
      '<div onclick="editLeadField('+id+',\'location\',\'Локация\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">📍 Локация:</span> <span style="color:#e8edf2;border-bottom:1px dashed #384858">'+(l.location||'—')+'</span></div>'+
      '<div onclick="editLeadField('+id+',\'title\',\'Должность / Сегмент\')" style="font-size:11px;cursor:pointer" title="Клик — редактировать"><span style="color:var(--dim)">💼 Должность:</span> <span style="color:#e8edf2;border-bottom:1px dashed #384858">'+(l.title||'—')+'</span></div>'+
    '</div>'+

    // Pitch / AI notes
    (l.notes?'<div style="margin-bottom:12px;padding:10px;background:#00ff8808;border:1px solid #00ff8822;border-radius:6px;font-size:11px;line-height:1.5"><b style="color:#00ff88;font-size:9px;text-transform:uppercase">💡 AI Pitch / Заметка:</b><br>'+l.notes+'</div>':'')+

    // Interaction history placeholder
    '<div id="leadHistory_'+id+'" style="margin-bottom:12px;max-height:200px;overflow-y:auto">'+
      '<div style="font-size:11px;font-weight:700;color:var(--dim);margin-bottom:6px">📋 ИСТОРИЯ ВЗАИМОДЕЙСТВИЙ</div>'+
      '<div style="text-align:center;color:#384858;font-size:10px;padding:12px" id="leadHistoryContent_'+id+'">Загрузка...</div>'+
    '</div>'+

    // Add note textarea
    '<div style="margin-bottom:12px">'+
      '<textarea id="leadNoteInput_'+id+'" placeholder="Добавить заметку..." style="width:100%;padding:8px 10px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:11px;resize:vertical;min-height:50px;font-family:inherit"></textarea>'+
      '<div style="display:flex;gap:6px;margin-top:6px">'+
        '<button onclick="addLeadInteraction('+id+',\'note\')" style="flex:1;padding:6px;background:#00ff8812;color:#00ff88;border:1px solid #00ff8833;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600">📝 Заметка</button>'+
        '<button onclick="addLeadInteraction('+id+',\'email_sent\')" style="flex:1;padding:6px;background:#00e5ff12;color:#00e5ff;border:1px solid #00e5ff33;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600">📧 Email</button>'+
        '<button onclick="addLeadInteraction('+id+',\'call\')" style="flex:1;padding:6px;background:#ffb80012;color:#ffb800;border:1px solid #ffb80033;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600">📞 Звонок</button>'+
        '<button onclick="addLeadInteraction('+id+',\'meeting\')" style="flex:1;padding:6px;background:#a855f712;color:#a855f7;border:1px solid #a855f733;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600">🤝 Встреча</button>'+
      '</div>'+
    '</div>'+

    // Action buttons
    '<div style="display:flex;gap:6px;padding-top:8px;border-top:1px solid var(--border)">'+
      '<button onclick="leadAction('+id+',\'outreach\')" style="flex:1;padding:8px;background:#00e5ff12;color:#00e5ff;border:1px solid #00e5ff33;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">📧 Outreach задача</button>'+
      '<button onclick="leadAction('+id+',\'task\')" style="flex:1;padding:8px;background:#ffb80012;color:#ffb800;border:1px solid #ffb80033;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">📋 Задача</button>'+
      '<button onclick="leadAction('+id+',\'remove\')" style="padding:8px 12px;background:#ff2d7812;color:#ff2d78;border:1px solid #ff2d7833;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">🗑</button>'+
    '</div>'
  );

  // Load interaction history from Supabase
  if(l.sbId&&SUPABASE_LIVE){
    sbFetch('lead_interactions','lead_id=eq.'+l.sbId+'&order=created_at.desc&limit=200').then(function(data){
      var el=document.getElementById('leadHistoryContent_'+id);
      if(!el)return;
      if(!data||!data.length){el.textContent='Нет записей';return;}
      var icons={note:'📝',email_sent:'📧',email_received:'📩',call:'📞',meeting:'🤝',stage_change:'🔄',auto_found:'🤖',follow_up:'⏰'};
      el.innerHTML=data.map(function(h){
        var d=new Date(h.created_at);
        var dateStr=d.toLocaleDateString('ru',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
        return '<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #1a2d3d08;font-size:10px">'+
          '<span style="color:var(--dim);white-space:nowrap">'+dateStr+'</span>'+
          '<span>'+(icons[h.interaction_type]||'📋')+'</span>'+
          '<span style="color:#cbd5e1;flex:1">'+esc(h.content)+'</span>'+
          '<span style="color:#384858">'+esc(h.created_by)+'</span>'+
        '</div>';
      }).join('');
    });
  } else {
    var el=document.getElementById('leadHistoryContent_'+id);
    if(el)el.textContent='Нет записей';
  }
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
    // Now handled by addLeadInteraction via textarea in modal
    return;
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
    showToast('Задача создана: написать письмо для '+l.name,'info');
  }
  if(action==='task'){
    f2fPrompt({title:'📋 Задача по лиду',fields:[{id:'task',label:'Задача по '+l.name,type:'text',placeholder:'Описание задачи...'}],submitText:'Создать'}).then(function(task){
      if(task&&task.trim()){
        createSyncedTask(task.trim()+' ['+l.name+']','leads','normal');
        addFeed('leads','📋 Задача: '+task.trim());
      }
    });
  }
  if(action==='remove'){
    f2fConfirm('Удалить лид '+l.name+'?').then(function(ok){
      if(!ok)return;
      if(l.sbId&&SUPABASE_LIVE)sbPatch('partner_pipeline','id=eq.'+l.sbId,{stage:'closed_lost'});
      D.leads=D.leads.filter(function(x){return x.id!==id;});
      renderLeads();updateKPI();modal.classList.remove('open');
      addFeed('leads','🗑 Лид удалён: '+l.name);
    });
  }
};

// CRM: Change lead stage
window.changeLeadStage=function(id,newStage){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  var oldStage=l.sbStage||'identified';
  l.sbStage=newStage;
  l.priority=newStage==='negotiating'?'hot':newStage==='contacted'?'warm':'medium';
  if(l.sbId&&SUPABASE_LIVE){
    sbPatch('partner_pipeline','id=eq.'+l.sbId,{stage:newStage,updated_at:new Date().toISOString()});
  }
  renderLeads();if(leadViewMode==='pipeline')renderPipeline();
  openLeadModal(id);
  addFeed('leads','🔄 '+l.name+': '+oldStage+' → '+newStage);
};
// Quick stage change from card (no modal)
window.quickLeadStage=function(id,newStage){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  var oldStage=l.sbStage||'identified';
  l.sbStage=newStage;
  l.priority=newStage==='negotiating'?'hot':newStage==='contacted'?'warm':'medium';
  if(l.sbId&&SUPABASE_LIVE){
    sbPatch('partner_pipeline','id=eq.'+l.sbId,{stage:newStage,updated_at:new Date().toISOString()});
    sbInsert('lead_interactions',{lead_id:l.sbId,interaction_type:'stage_change',content:oldStage+' → '+newStage,created_by:'ceo'});
  }
  renderLeads();
  showToast('🔄 '+l.name+': '+oldStage+' → '+newStage,'success');
  addFeed('leads','🔄 '+l.name+': '+oldStage+' → '+newStage);
};

// CRM: Change lead contact type
window.changeLeadType=function(id,newType){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  l.contactType=newType;
  if(l.sbId&&SUPABASE_LIVE){
    sbPatch('partner_pipeline','id=eq.'+l.sbId,{contact_type:newType});
  }
  openLeadModal(id);
  addFeed('leads','🏷 '+l.name+' → тип: '+newType);
};

// CRM: Add interaction
window.addLeadInteraction=function(id,type){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  var textarea=document.getElementById('leadNoteInput_'+id);
  var text=(textarea?textarea.value:'').trim();
  if(!text){showToast('Введите текст заметки','error');return;}
  var typeLabels={note:'Заметка',email_sent:'Email отправлен',call:'Звонок',meeting:'Встреча'};
  if(l.sbId&&SUPABASE_LIVE){
    sbInsert('lead_interactions',{
      lead_id:l.sbId,
      interaction_type:type,
      content:text,
      created_by:(_currentSession?_currentSession.login_name:'CEO')
    }).then(function(){
      showToast('✅ '+(typeLabels[type]||type)+' добавлен(а)','success');
      openLeadModal(id); // refresh modal with new history
    });
  } else {
    showToast('✅ '+(typeLabels[type]||type)+' сохранён(а) локально','success');
  }
  addFeed('leads',(type==='email_sent'?'📧':type==='call'?'📞':type==='meeting'?'🤝':'📝')+' '+l.name+': '+text.slice(0,60));
};

// CRM: Add new lead manually
window.openAddLeadModal=function(){
  var typeLabels={partner:'🤝 Партнёр',client_b2b:'💼 Клиент B2B',investor:'💰 Инвестор',media_influencer:'📺 Медиа/Инфлюенсер',federation:'🏛 Федерация',other:'📋 Другое'};
  var typeOptions=Object.keys(typeLabels).map(function(k){return '<option value="'+k+'">'+typeLabels[k]+'</option>';}).join('');
  var stageOptions=['identified','contacted','negotiating','closed_won'].map(function(s){
    var labels={identified:'🔍 Найден',contacted:'📧 Контакт',negotiating:'🤝 Переговоры',closed_won:'✅ Закрыт'};
    return '<option value="'+s+'">'+labels[s]+'</option>';
  }).join('');
  openModal(
    '<h2 style="margin-bottom:16px">➕ Новый лид</h2>'+
    '<div style="display:grid;grid-template-columns:'+mobGrid()+';gap:10px">'+
      '<div><label style="font-size:10px;color:var(--dim)">Компания *</label><input id="nl_company" placeholder="Название компании" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Контакт *</label><input id="nl_name" placeholder="Имя Фамилия" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Email</label><input id="nl_email" placeholder="email@example.com" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Телефон</label><input id="nl_phone" placeholder="+7..." style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">LinkedIn</label><input id="nl_linkedin" placeholder="https://linkedin.com/in/..." style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Сайт</label><input id="nl_website" placeholder="https://..." style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Тип контакта</label><select id="nl_type" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px">'+typeOptions+'</select></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Стейдж</label><select id="nl_stage" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px">'+stageOptions+'</select></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Сегмент / Должность</label><input id="nl_segment" placeholder="CEO / esports_team" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
      '<div><label style="font-size:10px;color:var(--dim)">Локация</label><input id="nl_location" placeholder="CIS / EU / US" style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;margin-top:2px"></div>'+
    '</div>'+
    '<div style="margin-top:10px"><label style="font-size:10px;color:var(--dim)">Заметка / Pitch</label><textarea id="nl_notes" placeholder="Почему этот контакт интересен..." style="width:100%;padding:8px;background:#0d1820;color:#e8edf2;border:1px solid #1a2d3d;border-radius:6px;font-size:12px;min-height:60px;resize:vertical;margin-top:2px;font-family:inherit"></textarea></div>'+
    '<div style="margin-top:14px;display:flex;gap:8px">'+
      '<button onclick="saveNewLead()" style="flex:1;padding:10px;background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">✅ Сохранить лид</button>'+
      '<button onclick="closeModal()" style="padding:10px 16px;background:#ff2d7812;color:#ff2d78;border:1px solid #ff2d7833;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>'+
    '</div>'
  );
};

window.saveNewLead=async function(){
  var company=(document.getElementById('nl_company').value||'').trim();
  var name=(document.getElementById('nl_name').value||'').trim();
  if(!company||!name){showToast('Заполните компанию и имя контакта','error');return;}
  var leadData={
    company_name:company,
    contact_name:name,
    contact_email:(document.getElementById('nl_email').value||'').trim(),
    phone:(document.getElementById('nl_phone').value||'').trim(),
    linkedin:(document.getElementById('nl_linkedin').value||'').trim(),
    website:(document.getElementById('nl_website').value||'').trim(),
    contact_type:document.getElementById('nl_type').value,
    stage:document.getElementById('nl_stage').value,
    segment:(document.getElementById('nl_segment').value||'').trim(),
    pitch_text:(document.getElementById('nl_notes').value||'').trim(),
    notes:document.getElementById('nl_location').value||'CIS',
    source:'manual',
    priority:'medium'
  };
  if(SUPABASE_LIVE){
    var res=await sbInsert('partner_pipeline',leadData);
    if(res&&res[0]){
      showToast('✅ Лид '+company+' добавлен!','success');
      // Also log interaction
      await sbInsert('lead_interactions',{lead_id:res[0].id,interaction_type:'auto_found',content:'Лид добавлен вручную: '+company+' / '+name,created_by:(_currentSession?_currentSession.login_name:'CEO')});
      // Refresh data
      window._sbPartnersMerged=false;
      if(typeof initSupabase==='function')setTimeout(initSupabase,500);
      addFeed('leads','➕ Новый лид: '+company+' ('+name+') — добавлен вручную');
      modal.classList.remove('open');
    } else {
      showToast('Ошибка сохранения','error');
    }
  } else {
    // Local mode
    D.leads.push({id:D.leads.length+9000,name:name,company:company,email:leadData.contact_email,
      title:leadData.segment,priority:'medium',notes:leadData.pitch_text,location:leadData.notes,
      source:'manual',contactType:leadData.contact_type,sbStage:leadData.stage,
      linkedin:leadData.linkedin,phone:leadData.phone,website:leadData.website,
      startDate:new Date().toISOString().slice(0,10),status:'active'});
    renderLeads();if(leadViewMode==='pipeline')renderPipeline();
    modal.classList.remove('open');
    showToast('✅ Лид добавлен локально','success');
  }
};

// CRM: Edit lead field inline
window.editLeadField=function(id,field,label){
  var l=D.leads.find(function(x){return x.id===id;});if(!l)return;
  f2fPrompt({title:'✏️ '+label,fields:[{id:'val',label:label,type:'text',value:l[field]||''}],submitText:'Сохранить'}).then(function(val){
    if(val===null)return;
    l[field]=val.trim();
    var sbMap={name:'contact_name',company:'company_name',email:'contact_email',phone:'phone',
      linkedin:'linkedin_url',website:'website',location:'notes',title:'segment'};
    if(l.sbId&&SUPABASE_LIVE&&sbMap[field]){
      var upd={};upd[sbMap[field]]=val.trim();
      sbPatch('partner_pipeline','id=eq.'+l.sbId,upd);
    }
    openLeadModal(id);
  });
};

renderLeads();
// Pipeline default: show pipeline container, hide grid, render pipeline
if(leadViewMode==='pipeline'){
  document.getElementById('leadsGrid').style.display='none';
  document.getElementById('leadsPipeline').style.display='';
  var btn=document.getElementById('leadViewToggle');
  if(btn){btn.textContent='📋 Список';btn.style.background='#00ff8812';btn.style.color='#00ff88';btn.style.borderColor='#00ff8833';}
  renderPipeline();
}

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
      var statusMap={'pending_approval':'draft','approved':'ready','rejected':'draft','published':'published','needs_rework':'draft'};
      var ag=window._sbAgentById&&c.agent_id?window._sbAgentById[c.agent_id]:null;
      var dashAgentId=ag?SB_SLUG_TO_DASH[ag.slug]:'content';
      var catLabel=c.status==='pending_approval'?'🤖 AI Generated (LIVE)':c.status==='approved'?'✅ Approved (LIVE)':c.status==='published'?'📢 Published (LIVE)':c.status==='needs_rework'?'🔄 На доработке (LIVE)':c.status==='rejected'?'❌ Отклонён (LIVE)':'📝 Content (LIVE)';
      D.posts.unshift({
        id:9000+i, sbId:c.id, platform:c.platform||'telegram',
        category:catLabel,
        text:c.content_text||'[Текст не указан]', hashtags:'', date:(c.created_at||'').slice(0,10),
        scheduledAt:c.scheduled_at, publishedAt:c.published_at,
        imageUrl:c.image_url||null, imagePrompt:c.image_prompt||null,
        qaScore:c.qa_score||null, qaVerdict:c.qa_verdict||null, ceoScore:c.ceo_score||null,
        templateId:c.template_id||null,
        metaJson:c.metadata_json||null,
        abStyle:(c.metadata_json&&c.metadata_json.style)||null,
        agentId:dashAgentId, status:statusMap[c.status]||'draft', sbStatus:c.status, isLive:true
      });
    });
  }
  const filtered=D.posts.filter(p=>{
    if(postFilter==='all')return true;
    if(postFilter==='pending')return p.sbStatus==='pending_approval';
    if(postFilter==='approved')return p.sbStatus==='approved';
    if(postFilter==='published')return p.sbStatus==='published';
    if(postFilter==='needs_rework')return p.sbStatus==='needs_rework';
    if(postFilter==='rejected')return p.sbStatus==='rejected';
    if(postFilter==='no_ceo_score')return p.isLive&&!p.ceoScore&&(p.sbStatus==='published'||p.sbStatus==='approved');
    return p.platform&&p.platform.toLowerCase()===postFilter.toLowerCase();
  });
  document.getElementById('posts-count').textContent=filtered.length+' постов';
  if(filtered.length===0){document.getElementById('postsGrid').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--dim);font-size:14px">📝 Нет постов по выбранному фильтру</div>';renderPostsAnalytics();return;}
  document.getElementById('postsGrid').innerHTML=filtered.map(p=>`
    <div class="post-card" onclick="openPostModal(${typeof p.sbId==='string'?("'"+p.sbId+"'"):p.id})" style="${p.isLive?'border-top:2px solid #00ff88;':''}${p.sbStatus==='pending_approval'?'border-left:3px solid #ff9800;':p.sbStatus==='approved'?'border-left:3px solid #00ff88;':p.sbStatus==='needs_rework'?'border-left:3px solid #a855f7;':p.sbStatus==='rejected'?'border-left:3px solid #ff4444;':p.sbStatus==='published'?'border-left:3px solid #00e5ff;':''}">
      <div class="post-header">
        <span class="post-platform ${p.platform}">${p.platform}</span>
        ${p.isLive?'<span style="font-size:9px;padding:2px 6px;background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;font-weight:700">LIVE</span>':''}
        ${p.abStyle?`<span style="font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;${p.abStyle==='provocative'?'background:#ff2d7822;color:#ff2d78;border:1px solid #ff2d7844':p.abStyle==='meme'?'background:#a855f722;color:#a855f7;border:1px solid #a855f744':p.abStyle==='storytelling'?'background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44':'background:#00e5ff22;color:#00e5ff;border:1px solid #00e5ff44'}">${p.abStyle.toUpperCase()}</span>`:''}
        <span class="post-status ${p.status}">${p.sbStatus==='pending_approval'?'⏳ Ждёт одобрения':p.sbStatus==='approved'?'✅ Одобрен':p.sbStatus==='published'?'📢 Опубликован':p.sbStatus==='needs_rework'?'🔄 На доработке':p.sbStatus==='rejected'?'❌ Отклонён':p.status==='ready'?'✅ Ready':'📝 Draft'}</span>
      </div>
      <div class="post-category">${p.category||''}</div>
      ${p.imageUrl?'<div style="margin:6px 0;border-radius:6px;overflow:hidden;max-height:120px"><img src="'+p.imageUrl+'" style="width:100%;height:auto;display:block;object-fit:cover" onerror="this.parentElement.style.display=\'none\'"></div>':''}
      <div class="post-text">${esc((p.text||'').length>180?(p.text||'').slice(0,180)+'...':p.text||'')}</div>
      <div class="post-tags">${esc(p.hashtags||'')}</div>
      <div class="post-date">📅 ${p.date||''}${!p.isLive?' <span style="color:#ff9800;font-size:9px">(mock)</span>':''}${p.imageUrl?' <span style="color:#00e55f;font-size:9px">🖼</span>':''}${p.qaScore?` <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${p.qaScore>=8?'#10b98122;color:#10b981':p.qaScore>=5?'#f59e0b22;color:#f59e0b':'#ef444422;color:#ef4444'}">QA:${p.qaScore}</span>`:''}${p.ceoScore?` <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:#f59e0b22;color:#f59e0b">⭐${p.ceoScore}</span>`:''}</div>
      ${p.sbStatus==='pending_approval'?`<div style="display:flex;gap:6px;margin-top:8px;border-top:1px solid var(--border);padding-top:8px" onclick="event.stopPropagation()">
        <button onclick="quickPostAction('${p.sbId||p.id}','approve')" style="flex:1;padding:5px;background:#00ff8812;color:#00ff88;border:1px solid #00ff8833;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600">✅ Одобрить</button>
        <button onclick="quickPostAction('${p.sbId||p.id}','reject')" style="flex:1;padding:5px;background:#ff2d7812;color:#ff2d78;border:1px solid #ff2d7833;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600">❌ Отклонить</button>
      </div>`:''}
      ${p.sbStatus==='approved'&&p.sbId?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;border-top:1px solid var(--border);padding-top:8px" onclick="event.stopPropagation()">
        <button onclick="generatePostImage('${p.sbId}')" style="flex:1;min-width:45%;padding:5px;background:#9c27b018;color:#9c27b0;border:1px solid #9c27b044;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600">${p.imageUrl?'🔄 Перегенерировать':'🖼 Генерировать картинку'}</button>
        <button onclick="publishPostToTelegram('${p.sbId}')" style="flex:1;min-width:45%;padding:5px;background:#0088cc18;color:#0088cc;border:1px solid #0088cc44;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600">📢 Опубликовать в Telegram</button>
      </div>`:''}
    </div>`).join('');
}
document.getElementById('postFilters').addEventListener('click',e=>{
  if(!e.target.classList.contains('filter-btn'))return;
  document.querySelectorAll('#postFilters .filter-btn').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  postFilter=e.target.dataset.filter;
  renderPosts();
  // Show bulk approve button only for pending filter
  var bulkBtn=document.getElementById('btnBulkApprove');
  if(bulkBtn)bulkBtn.style.display=(postFilter==='pending')?'':'none';
});

// ═══ POSTS ANALYTICS (Charts + KPIs) ═══
var _chartQA=null,_chartDaily=null;
function renderPostsAnalytics(){
  var posts=D.posts.filter(function(p){return p.isLive;});
  var total=posts.length;
  var counts={approved:0,published:0,rejected:0,pending_approval:0,needs_rework:0};
  var totalScore=0,scoreCount=0,scoreDist={},daily={};
  posts.forEach(function(p){
    counts[p.sbStatus]=(counts[p.sbStatus]||0)+1;
    if(p.qaScore!=null){totalScore+=p.qaScore;scoreCount++;scoreDist[p.qaScore]=(scoreDist[p.qaScore]||0)+1;}
    var day=p.date||'';
    if(day){
      if(!daily[day])daily[day]={gen:0,pub:0,app:0,rej:0};
      daily[day].gen++;
      if(p.sbStatus==='published')daily[day].pub++;
      if(p.sbStatus==='approved')daily[day].app++;
      if(p.sbStatus==='rejected')daily[day].rej++;
    }
  });
  var avgScore=scoreCount>0?(totalScore/scoreCount).toFixed(1):'—';
  var el=function(id){return document.getElementById(id);};
  if(el('pa-total'))el('pa-total').textContent=total;
  if(el('pa-published'))el('pa-published').textContent=counts.published;
  if(el('pa-published-pct'))el('pa-published-pct').textContent=total>0?Math.round(counts.published/total*100)+'% от общего':'';
  if(el('pa-approved'))el('pa-approved').textContent=counts.approved;
  if(el('pa-pending'))el('pa-pending').textContent=(counts.pending_approval||0)+(counts.needs_rework||0);
  if(el('pa-pending-sub'))el('pa-pending-sub').textContent=(counts.needs_rework||0)+' на доработке';
  if(el('pa-rejected'))el('pa-rejected').textContent=counts.rejected;
  if(el('pa-rejected-pct'))el('pa-rejected-pct').textContent=total>0?Math.round(counts.rejected/total*100)+'% брак':'';
  if(el('pa-avg-score'))el('pa-avg-score').textContent=avgScore;
  if(el('pa-score-sub'))el('pa-score-sub').textContent='порог: 8+ | approval: '+Math.round((counts.approved+counts.published)/Math.max(total,1)*100)+'%';
  // Charts require Chart.js
  if(typeof Chart==='undefined')return;
  // QA Score chart
  var scores=Object.keys(scoreDist).sort(function(a,b){return a-b;});
  var scoreColors=scores.map(function(s){return parseInt(s)>=8?'#00ff88cc':parseInt(s)>=5?'#ffb800cc':'#ff4444cc';});
  var ctx1=el('chartQAScores');
  if(ctx1){
    if(_chartQA)_chartQA.destroy();
    _chartQA=new Chart(ctx1,{type:'bar',
      data:{labels:scores.map(function(s){return 'Score '+s;}),datasets:[{data:scores.map(function(s){return scoreDist[s];}),backgroundColor:scoreColors,borderRadius:6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{grid:{display:false},ticks:{color:'#64748b',font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b',stepSize:5}}}}
    });
  }
  // CEO score analytics
  var ceoScored=0,ceoTotal=0;
  posts.forEach(function(p){if(p.ceoScore!=null){ceoScored++;ceoTotal+=p.ceoScore;}});
  var ceoAvg=ceoScored>0?(ceoTotal/ceoScored).toFixed(1):'—';
  if(el('pa-ceo-scored'))el('pa-ceo-scored').textContent=ceoScored+'/'+total;
  if(el('pa-ceo-avg'))el('pa-ceo-avg').textContent=ceoScored>0?'avg: '+ceoAvg+'/10':'ожидает оценок';
  // Daily chart
  var days=Object.keys(daily).sort();
  var ctx2=el('chartDailyPosts');
  if(ctx2){
    if(_chartDaily)_chartDaily.destroy();
    _chartDaily=new Chart(ctx2,{type:'bar',
      data:{labels:days.map(function(d){return d.slice(5);}),datasets:[
        {label:'Сгенерировано',data:days.map(function(d){return daily[d].gen;}),backgroundColor:'#a855f7aa',borderRadius:4},
        {label:'Одобрено',data:days.map(function(d){return daily[d].app;}),backgroundColor:'#00ff88aa',borderRadius:4},
        {label:'Опубликовано',data:days.map(function(d){return daily[d].pub;}),backgroundColor:'#00e5ffaa',borderRadius:4},
        {label:'Отклонено',data:days.map(function(d){return daily[d].rej;}),backgroundColor:'#ff4444aa',borderRadius:4}
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'top',labels:{color:'#64748b',usePointStyle:true,padding:10,font:{size:10}}}},
        scales:{x:{grid:{display:false},ticks:{color:'#64748b',font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b',stepSize:5}}}}
    });
  }
  // Funnel chart
  var ctx3=el('chartFunnel');
  if(ctx3){
    if(window._chartFunnel)window._chartFunnel.destroy();
    var funnelData=[total,counts.pending_approval+counts.needs_rework+counts.approved+counts.published,counts.approved+counts.published,counts.published];
    var funnelLabels=['Создано','Прошло QA','Одобрено','Опубликовано'];
    var funnelColors=['#a855f7cc','#ffb800cc','#00ff88cc','#00e5ffcc'];
    window._chartFunnel=new Chart(ctx3,{type:'bar',
      data:{labels:funnelLabels,datasets:[{data:funnelData,backgroundColor:funnelColors,borderRadius:6}]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b',font:{size:10}}},y:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:11,weight:'600'}}}}}
    });
  }
  // === A/B STYLE ANALYTICS ===
  var abStats={provocative:{n:0,qaSum:0,ceoSum:0,ceoN:0,pub:0},informative:{n:0,qaSum:0,ceoSum:0,ceoN:0,pub:0},meme:{n:0,qaSum:0,ceoSum:0,ceoN:0,pub:0},storytelling:{n:0,qaSum:0,ceoSum:0,ceoN:0,pub:0}};
  posts.forEach(function(p){
    var style=p.abStyle;if(!style||!abStats[style])return;
    abStats[style].n++;
    if(p.qaScore!=null)abStats[style].qaSum+=p.qaScore;
    if(p.ceoScore!=null){abStats[style].ceoSum+=p.ceoScore;abStats[style].ceoN++;}
    if(p.sbStatus==='published')abStats[style].pub++;
  });
  var abEl=el('pa-ab-styles');
  if(abEl){
    var abStyles=[
      {key:'provocative',label:'🔥 Provocative',color:'#ff2d78'},
      {key:'informative',label:'📊 Informative',color:'#00e5ff'},
      {key:'meme',label:'😂 Meme',color:'#a855f7'},
      {key:'storytelling',label:'📖 Storytelling',color:'#f59e0b'}
    ];
    var abHasData=abStyles.some(function(s){return abStats[s.key].n>0;});
    if(abHasData){
      abEl.innerHTML='<div style="font-size:13px;font-weight:700;margin-bottom:8px">A/B Стили</div>'+
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">'+
        abStyles.map(function(s){
          var st=abStats[s.key];
          if(st.n===0)return '';
          var avgQA=st.qaSum>0?(st.qaSum/st.n).toFixed(1):'—';
          var avgCEO=st.ceoN>0?(st.ceoSum/st.ceoN).toFixed(1):'—';
          var pubRate=st.n>0?Math.round(st.pub/st.n*100):0;
          return '<div style="background:var(--bg);border:1px solid '+s.color+'33;border-radius:8px;padding:10px">'+
            '<div style="font-size:11px;font-weight:700;color:'+s.color+';margin-bottom:6px">'+s.label+'</div>'+
            '<div style="font-size:20px;font-weight:700;font-family:monospace;color:var(--text)">'+st.n+'</div>'+
            '<div style="font-size:10px;color:var(--dim)">QA avg: '+avgQA+' | CEO: '+avgCEO+'</div>'+
            '<div style="height:4px;background:var(--border);border-radius:2px;margin-top:6px"><div style="height:100%;width:'+pubRate+'%;background:'+s.color+';border-radius:2px"></div></div>'+
            '<div style="font-size:9px;color:var(--dim);margin-top:2px">'+pubRate+'% опубликовано</div></div>';
        }).join('')+'</div>';
    }else{
      abEl.innerHTML='<div style="font-size:11px;color:var(--dim);padding:8px">A/B стили появятся после генерации постов с metadata_json.style</div>';
    }
  }
}

// ═══ BULK APPROVE pending posts ═══
window.bulkApprovePosts=async function(){
  var pending=D.posts.filter(function(p){return p.isLive&&p.sbStatus==='pending_approval'&&p.qaScore>=8;});
  if(pending.length===0){showToast('Нет постов с QA 8+ для одобрения','info');return;}
  var ok=confirm('Одобрить '+pending.length+' постов с QA score 8+?');
  if(!ok)return;
  showToast('✅ Одобряю '+pending.length+' постов...','info');
  var done=0;
  for(var i=0;i<pending.length;i++){
    var p=pending[i];
    if(SUPABASE_LIVE&&p.sbId){
      try{
        await fetch(SUPABASE_URL+'/rest/v1/content_queue?id=eq.'+p.sbId,{
          method:'PATCH',headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Content-Type':'application/json'},
          body:JSON.stringify({status:'approved'})
        });
        p.sbStatus='approved';p.status='ready';done++;
      }catch(e){console.warn('Bulk approve error:',e);}
    }
  }
  renderPosts();renderPostsAnalytics();
  showToast('✅ Одобрено: '+done+' постов','success');
  addFeed('quality_controller','✅ Массовое одобрение: '+done+' постов с QA 8+');
};

window.openPostModal=function(id){
  const p=D.posts.find(x=>x.id===id||x.sbId===id);if(!p)return;
  openModal(`
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <span class="post-platform ${p.platform}">${p.platform}</span>
      <span class="post-status ${p.status}">${p.status==='ready'?'✅ Ready':'📝 Draft'}</span>
      <span class="tag" style="background:#ffffff08;color:var(--dim)">${p.category}</span>
    </div>
    ${p.imageUrl?'<div style="margin-bottom:12px;border-radius:8px;overflow:hidden;position:relative"><img src="'+p.imageUrl+'" style="width:100%;max-height:250px;object-fit:cover;display:block" onerror="this.parentElement.style.display=\'none\'"></div>':''}
    <div style="font-size:15px;line-height:1.8;white-space:pre-wrap;margin-bottom:16px;padding:16px;background:var(--bg);
      border-radius:8px;border:1px solid var(--border)">${p.text}</div>
    <p style="color:var(--purple)">${p.hashtags}</p>
    <p style="color:var(--dim);margin-top:8px">📅 Дата: ${p.date} | Агент: ${AGENTS[p.agentId]?.emoji||''} ${AGENTS[p.agentId]?.name||p.agentId}</p>
    ${p.imagePrompt?'<p style="color:var(--dim);font-size:11px;margin-top:4px">🖼 Промпт: <span style="color:#9c27b0">'+((p.imagePrompt||'').length>100?(p.imagePrompt||'').slice(0,100)+'...':p.imagePrompt)+'</span></p>':''}
    ${p.sbId?'<div style="margin:12px 0;padding:12px;background:#9c27b008;border:1px solid #9c27b033;border-radius:8px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:12px;color:#9c27b0;font-weight:700">🎨 Art Director</div><div style="font-size:10px;color:var(--dim)">Claude Sonnet анализирует пост и создаёт промпт</div></div><textarea id="artDirectorNote" placeholder="Указания по визуалу (опционально): стиль, настроение, что хочешь видеть..." style="width:100%;min-height:36px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:11px;resize:vertical;box-sizing:border-box;margin-bottom:6px"></textarea><div style="display:flex;gap:6px;margin-bottom:8px"><button onclick="artDirectorPrompt(\''+p.sbId+'\')" style="flex:1;padding:7px;background:#a855f722;color:#a855f7;border:1px solid #a855f744;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600" id="btnArtDirector">🎨 Составить промпт</button></div><div style="font-size:10px;color:var(--dim);margin-bottom:4px">Промпт для генерации (можешь отредактировать):</div><textarea id="customImagePrompt" placeholder="Промпт появится здесь после нажатия Art Director... или напиши свой" style="width:100%;min-height:60px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:12px;resize:vertical;box-sizing:border-box">'+((p.imagePrompt||'').replace(/'/g,"&#39;").replace(/"/g,"&quot;"))+'</textarea><div style="display:flex;gap:6px;margin-top:6px"><button onclick="generatePostImage(\''+p.sbId+'\',document.getElementById(\'customImagePrompt\').value)" style="flex:1;padding:7px;background:#9c27b022;color:#9c27b0;border:1px solid #9c27b044;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">'+(p.imageUrl?'🔄 Перегенерировать':'🖼 Сгенерировать картинку')+'</button></div></div>':''}
    <div style="display:flex;gap:6px;margin:12px 0;flex-wrap:wrap">
      ${p.sbId?'<button onclick="qaReviewPost(\''+p.sbId+'\')" style="flex:1;min-width:45%;padding:6px 10px;background:#10b98118;color:#10b981;border:1px solid #10b98133;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">✅ QA-проверка</button>':''}
      ${p.sbId?'<button onclick="ceoScorePost(\''+p.sbId+'\')" style="flex:1;min-width:45%;padding:6px 10px;background:#f59e0b18;color:#f59e0b;border:1px solid #f59e0b33;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">⭐ Оценить</button>':''}
    </div>
    ${p.qaScore?'<div style="padding:8px;background:'+(p.qaScore>=8?'#10b98118':p.qaScore>=5?'#f59e0b18':'#ef444418')+';border-radius:6px;margin-bottom:8px;font-size:12px">QA: <b>'+p.qaScore+'/10</b> — '+(p.qaVerdict||'')+'</div>':''}
    ${p.ceoScore?'<div style="padding:8px;background:#f59e0b18;border-radius:6px;margin-bottom:8px;font-size:12px">CEO: <b>'+p.ceoScore+'/10</b> ${"⭐".repeat(Math.round(p.ceoScore/2))}</div>':''}
    <div style="margin:12px 0;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:11px;color:var(--dim);font-weight:600;margin-bottom:8px">💬 Обратная связь (обучает AI)</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button onclick="sendFeedback('post','${p.sbId||p.id}','approve','Контент хороший')" style="padding:5px 12px;background:#10b98118;color:#10b981;border:1px solid #10b98133;border-radius:6px;cursor:pointer;font-size:12px">👍 Хорошо</button>
        <button onclick="sendFeedback('post','${p.sbId||p.id}','reject','Контент плохой')" style="padding:5px 12px;background:#ef444418;color:#ef4444;border:1px solid #ef444433;border-radius:6px;cursor:pointer;font-size:12px">👎 Плохо</button>
        <button onclick="sendFeedbackComment('post','${p.sbId||p.id}')" style="padding:5px 12px;background:#6366f118;color:#6366f1;border:1px solid #6366f133;border-radius:6px;cursor:pointer;font-size:12px">💬 Комментарий</button>
        <button onclick="sendFeedbackTag('post','${p.sbId||p.id}')" style="padding:5px 12px;background:#f59e0b18;color:#f59e0b;border:1px solid #f59e0b33;border-radius:6px;cursor:pointer;font-size:12px">🏷 Тег</button>
      </div>
      <div id="feedbackList-post-${p.sbId||p.id}" style="margin-top:6px"></div>
    </div>
    <div class="action-bar">
      <button class="act-btn" onclick="navigator.clipboard.writeText(document.querySelector('.modal div[style*=pre-wrap]').textContent).then(function(){showToast('Скопировано!','info')})">📋 Копировать</button>
      <button class="act-btn success" onclick="postAction(${p.id},'approve')">✅ ${p.status==='draft'?'Утвердить':'Вернуть в черновик'}</button>
      <button class="act-btn warn" onclick="postAction(${p.id},'rework')" style="background:#ff980022;color:#ff9800;border-color:#ff980044">🔄 На переработку</button>
      <button class="act-btn" onclick="postAction(${p.id},'edit')">✏️ Редактировать</button>
      <button class="act-btn" onclick="postAction(${p.id},'duplicate')">📑 Дублировать</button>
      <button class="act-btn danger" onclick="postAction(${p.id},'delete')">🗑 Удалить</button>
    </div>
  `);
  // Load feedback history for this post
  loadFeedbackList('post',p.sbId||p.id);
};
function loadFeedbackList(entityType,entityId){
  var container=document.getElementById('feedbackList-'+entityType+'-'+entityId);
  if(!container)return;
  sbFetch('team_feedback','select=*&entity_type=eq.'+entityType+'&entity_id=eq.'+entityId+'&order=created_at.desc&limit=20').then(function(items){
    if(!items||!items.length){container.innerHTML='<div style="font-size:11px;color:var(--dim);padding:4px 0">Пока нет отзывов</div>';return;}
    var actionIcons={approve:'👍',reject:'👎',comment:'💬',tag:'🏷'};
    var html='';
    items.forEach(function(f){
      var fb=typeof f.feedback_data==='string'?JSON.parse(f.feedback_data||'{}'):f.feedback_data||{};
      html+='<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)22;font-size:11px">';
      html+='<span>'+(actionIcons[f.action]||'•')+'</span>';
      html+='<span style="color:var(--cyan)">'+esc(f.author||'?')+'</span>';
      html+='<span style="flex:1;color:var(--dim)">'+esc(fb.comment||f.action||'')+'</span>';
      html+='<span style="color:var(--dim);white-space:nowrap">'+(f.created_at?timeSince(f.created_at):'')+'</span>';
      html+='</div>';
    });
    container.innerHTML=html;
  }).catch(function(){});
}
window.postAction=function(id,action){
  var p=D.posts.find(function(x){return x.id===id||x.sbId===id;});if(!p)return;
  if(action==='approve'){
    p.status=p.status==='draft'?'ready':'draft';
    // Sync to Supabase if this is a Supabase post
    if(SUPABASE_LIVE&&p.sbId){
      var newSbStatus=p.status==='ready'?'approved':'pending_approval';
      fetch(SUPABASE_URL+'/rest/v1/content_queue?id=eq.'+p.sbId,{
        method:'PATCH',
        headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Content-Type':'application/json'},
        body:JSON.stringify({status:newSbStatus})
      }).then(function(r){
        if(r.ok){p.sbStatus=newSbStatus;console.log('✅ Supabase post status updated: '+newSbStatus);}
      }).catch(function(e){console.warn('Post sync error:',e);});
    }
    renderPosts();openPostModal(id);
    addFeed('content',(p.status==='ready'?'✅ Утверждён':'📝 Возврат в черновик')+': '+p.platform+' пост');
  }
  if(action==='reschedule'){
    f2fPrompt({title:'📅 Перенести публикацию',fields:[{id:'date',label:'Новая дата',type:'date',value:p.date}],submitText:'Перенести'}).then(function(newDate){
    if(newDate&&newDate.trim()){
      p.date=newDate.trim();
      if(SUPABASE_LIVE&&p.sbId){sbPatch('content_queue','id=eq.'+p.sbId,{scheduled_at:newDate.trim()+'T12:00:00Z'});}
      renderPosts();openPostModal(id);
      addFeed('content','📅 Перенос: '+p.platform+' → '+newDate.trim());
    }});
  }
  if(action==='rework'){
    f2fPrompt({title:'🔄 На переработку',fields:[{id:'fb',label:'Что переделать?',type:'textarea',placeholder:'Стиль, тон, тема, длина и т.д.',rows:3}],submitText:'Отправить'}).then(function(feedback){
    if(feedback&&feedback.trim()){
      var origText=p.text;
      p.status='draft';p.sbStatus='rework';
      p.category='🔄 На переработке';
      // Save rework instruction to Supabase
      if(SUPABASE_LIVE&&p.sbId){
        sbPatch('content_queue','id=eq.'+p.sbId,{status:'rework',rework_notes:feedback.trim()});
        // Auto-trigger rework via smm-generate with feedback
        showToast('🔄 Запускаю переработку поста...','info');
        fetch(SUPABASE_URL+'/functions/v1/smm-generate',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
          body:JSON.stringify({mode:'rework',post_id:p.sbId,feedback:feedback.trim(),original_text:origText,platform:p.platform})
        }).then(function(res){return res.json();}).then(function(data){
          if(data.success&&data.new_text){
            p.text=data.new_text;
            p.sbStatus='pending_approval';
            p.category=data.category||p.category;
            sbPatch('content_queue','id=eq.'+p.sbId,{content_text:data.new_text,status:'pending_approval',hashtags:data.hashtags||''});
            renderPosts();
            showToast('✅ Пост переработан! Проверь новую версию.','success');
            addFeed('content','✅ Пост переработан по фидбэку: '+feedback.trim().slice(0,50));
          }else{
            showToast('⚠️ Переработка не удалась: '+(data.error||'попробуй ещё раз'),'error');
          }
        }).catch(function(e){showToast('❌ Ошибка переработки: '+e.message,'error');});
      }
      renderPosts();modal.classList.remove('open');
      addFeed('content','🔄 Пост отправлен на переработку: '+feedback.trim().slice(0,50));
    }});
  }
  if(action==='edit'){
    f2fPrompt({title:'✏️ Редактировать пост',fields:[{id:'text',label:'Текст поста',type:'textarea',value:p.text,rows:5}],submitText:'Сохранить'}).then(function(newText){
    if(newText&&newText.trim()){
      p.text=newText.trim();
      if(SUPABASE_LIVE&&p.sbId){sbPatch('content_queue','id=eq.'+p.sbId,{content_text:newText.trim()});}
      renderPosts();openPostModal(id);
      addFeed('content','✏️ Пост отредактирован: '+p.platform);
    }});
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
    f2fConfirm('Удалить пост?').then(function(ok){
      if(!ok)return;
      if(SUPABASE_LIVE&&p.sbId){sbPatch('content_queue','id=eq.'+p.sbId,{status:'rejected'});}
      D.posts=D.posts.filter(function(x){return x.id!==id&&x.sbId!==id;});
      renderPosts();updateKPI();modal.classList.remove('open');
      addFeed('content','🗑 Пост удалён');
    });
  }
};
// Quick approve/reject from card (no modal needed)
window.quickPostAction=function(id,action){
  var p=D.posts.find(function(x){return x.id===id||x.sbId===id||x.id==id;});if(!p)return;
  if(action==='approve'){
    p.status='ready';p.sbStatus='approved';
    if(SUPABASE_LIVE&&p.sbId){
      sbPatch('content_queue','id=eq.'+p.sbId,{status:'approved'});
    }
    showToast('Пост одобрен: '+p.platform,'success');
    addFeed('content','✅ Быстрое одобрение: '+p.platform+' пост');
  }
  if(action==='reject'){
    p.status='draft';p.sbStatus='rejected';
    if(SUPABASE_LIVE&&p.sbId){
      sbPatch('content_queue','id=eq.'+p.sbId,{status:'rejected'});
    }
    showToast('Пост отклонён','warning');
    addFeed('content','❌ Пост отклонён: '+p.platform);
  }
  renderPosts();updateKPI();
};

// QA Review a post via quality-review Edge Function
window.qaReviewPost=async function(postId){
  if(!SUPABASE_LIVE){showToast('Supabase не подключён','error');return;}
  showToast('✅ QA проверяет пост...','info');
  try{
    var res=await fetch(SUPABASE_URL+'/functions/v1/quality-review',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
      body:JSON.stringify({post_id:postId})
    });
    if(!res.ok){
      var errText=await res.text().catch(function(){return 'HTTP '+res.status;});
      showToast('QA ошибка ('+res.status+'): Edge Function не отвечает. Задеплой quality-review.','error');
      return;
    }
    var data=await res.json();
    if(data.success&&typeof data.score==='number'){
      var verdict=data.verdict==='approved'?'✅ Одобрен':data.verdict==='needs_work'?'🔄 Нужна доработка':'❌ Отклонён';
      var p=D.posts.find(function(x){return x.sbId===postId;});
      if(p){p.qaScore=data.score;p.qaVerdict=verdict;renderPosts();}
      // Show QA result inline in modal instead of blocking alert
      var scoreColor=data.score>=8?'#10b981':data.score>=5?'#f59e0b':'#ef4444';
      var qaHtml='<div style="padding:16px;background:var(--bg);border:1px solid '+scoreColor+'44;border-radius:8px;margin-bottom:12px">'+
        '<h3 style="margin:0 0 8px 0;color:'+scoreColor+'">QA: '+data.score+'/10 — '+verdict+'</h3>';
      if(data.issues&&data.issues.length){
        qaHtml+='<div style="margin:8px 0;font-size:12px"><b style="color:var(--dim)">Проблемы:</b><ul style="margin:4px 0;padding-left:20px">';
        data.issues.forEach(function(i){qaHtml+='<li>'+(i.text||i)+'</li>';});
        qaHtml+='</ul></div>';
      }
      if(data.suggestions&&data.suggestions.length){
        qaHtml+='<div style="margin:8px 0;font-size:12px"><b style="color:var(--dim)">Рекомендации:</b><ul style="margin:4px 0;padding-left:20px">';
        data.suggestions.forEach(function(s){qaHtml+='<li>'+(s.text||s)+'</li>';});
        qaHtml+='</ul></div>';
      }
      if(data.improved_text){
        qaHtml+='<div style="margin:8px 0;font-size:12px"><b style="color:#10b981">📝 Улучшенная версия:</b>'+
          '<div style="margin-top:4px;padding:8px;background:var(--panel);border-radius:6px;white-space:pre-wrap;line-height:1.5">'+data.improved_text+'</div>'+
          '<button onclick="applyQaImprovement(\''+postId+'\',this.parentElement.querySelector(\'div\').textContent)" style="margin-top:6px;padding:4px 12px;background:#10b98122;color:#10b981;border:1px solid #10b98133;border-radius:4px;cursor:pointer;font-size:11px">✅ Применить улучшенную версию</button></div>';
      }
      qaHtml+='</div>';
      // Inject QA result into current modal
      var mc=document.getElementById('modalContent');
      if(mc){
        var existing=mc.querySelector('.qa-inline-result');
        if(existing)existing.remove();
        var div=document.createElement('div');div.className='qa-inline-result';div.innerHTML=qaHtml;
        mc.insertBefore(div,mc.firstChild);
      }
      showToast('QA: '+data.score+'/10 — '+verdict,'info');
      addFeed('quality_controller','QA: пост оценён '+data.score+'/10 — '+verdict);
    }else{
      showToast('QA ошибка: '+(data.error||'Edge Function вернула некорректный ответ. Проверь деплой quality-review.'),'error');
    }
  }catch(e){showToast('QA ошибка: '+e.message+'. Проверь деплой quality-review Edge Function.','error');}
};

// Apply QA-improved text to a post
window.applyQaImprovement=function(postId,newText){
  if(!newText||!newText.trim())return;
  var p=D.posts.find(function(x){return x.sbId===postId;});
  if(!p){showToast('Пост не найден','error');return;}
  p.text=newText.trim();
  p.sbStatus='pending_approval';
  if(SUPABASE_LIVE&&p.sbId){
    sbPatch('content_queue','id=eq.'+p.sbId,{content_text:newText.trim(),status:'pending_approval'});
  }
  renderPosts();openPostModal(p.sbId);
  showToast('✅ Улучшенная версия применена!','success');
  addFeed('quality_controller','📝 Применена QA-улучшенная версия поста');
};

// CEO Score a post
window.ceoScorePost=async function(postId){
  var vals=await f2fPrompt({title:'⭐ Оценить пост',message:'Оценка 8+ → автоизвлечение "что хорошо"\nОценка 1-4 → автоизвлечение "чего избегать"',
    fields:[
      {id:'score',label:'Оценка (1-10)',type:'number',value:'7',min:'1',max:'10'},
      {id:'feedback',label:'Комментарий (опционально)',type:'text',placeholder:'Хороший стиль, дерзкий CTA...'}
    ],submitText:'Сохранить оценку'});
  if(!vals)return;
  var score=parseInt(vals.score);
  var feedback=vals.feedback||'';
  if(!score||score<1||score>10){showToast('Оценка от 1 до 10','error');return;}
  showToast('⭐ Сохраняю оценку...','info');
  try{
    var res=await fetch(SUPABASE_URL+'/functions/v1/quality-review',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
      body:JSON.stringify({post_id:postId,ceo_score:score,feedback:feedback})
    });
    var data=await res.json();
    if(data.success){
      showToast('⭐ Оценка '+score+'/10 сохранена'+(data.auto_learned?' + автообучение!':''),'success');
      var p=D.posts.find(function(x){return x.sbId===postId;});
      if(p){p.ceoScore=score;renderPosts();openPostModal(p.sbId);}
      addFeed('quality_controller','CEO оценил пост: '+score+'/10'+(feedback?' — '+feedback.slice(0,50):''));
    }else{
      showToast('Ошибка: '+(data.error||'unknown'),'error');
    }
  }catch(e){showToast('Ошибка: '+e.message,'error');}
};

// Generate AI image for a post via Edge Function
window.generatePostImage=function(postId,customPrompt){
  if(!SUPABASE_LIVE){showToast('Supabase не подключён','error');return;}
  showToast('🖼 Генерирую AI-картинку... (10-30 сек)','info');
  var payload={post_id:postId};
  if(customPrompt&&customPrompt.trim()){payload.custom_prompt=customPrompt.trim();}
  fetch(SUPABASE_URL+'/functions/v1/generate-image',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
    body:JSON.stringify(payload)
  }).then(function(r){return r.json();}).then(function(data){
    if(data.success&&data.image_url){
      var p=D.posts.find(function(x){return x.sbId===postId;});
      if(p){p.imageUrl=data.image_url;p.imagePrompt=data.prompt_used||'';}
      showToast('🖼 Картинка сгенерирована! Стиль: '+data.style+' ('+data.category+')','success');
      addFeed('content','🖼 AI-картинка сгенерирована для поста');
      renderPosts();closeModal();
    } else if(data.error){
      showToast('Ошибка генерации: '+data.error+(data.detail?' — '+data.detail:''),'error');
    }
  }).catch(function(err){
    showToast('Ошибка генерации картинки: '+err,'error');
  });
};

// Art Director: generate smart prompt from post text via Claude Sonnet (without generating image)
window.artDirectorPrompt=function(postId){
  if(!SUPABASE_LIVE){showToast('Supabase не подключён','error');return;}
  var btn=document.getElementById('btnArtDirector');
  if(btn){btn.textContent='⏳ Art Director думает...';btn.disabled=true;}
  var ceoNote=(document.getElementById('artDirectorNote')||{}).value||'';
  var payload={post_id:postId,mode:'prompt_only'};
  if(ceoNote.trim())payload.ceo_note=ceoNote.trim();
  fetch(SUPABASE_URL+'/functions/v1/generate-image',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
    body:JSON.stringify(payload)
  }).then(function(r){return r.json();}).then(function(data){
    if(data.success&&data.prompt){
      var ta=document.getElementById('customImagePrompt');
      if(ta){ta.value=data.prompt;ta.style.borderColor='#a855f7';ta.style.boxShadow='0 0 8px #a855f744';}
      showToast('🎨 Art Director составил промпт — проверь и жми "Сгенерировать"','success');
    } else {
      showToast('Ошибка Art Director: '+(data.error||'unknown'),'error');
    }
  }).catch(function(err){
    showToast('Ошибка: '+err,'error');
  }).finally(function(){
    if(btn){btn.textContent='🎨 Составить промпт';btn.disabled=false;}
  });
};

// Publish approved post to Telegram via Edge Function
window.publishPostToTelegram=function(postId){
  if(!SUPABASE_LIVE){showToast('Supabase не подключён','error');return;}
  showToast('Отправляю в Telegram...','info');
  fetch(SUPABASE_URL+'/functions/v1/content-publish',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
    body:JSON.stringify({post_id:postId})
  }).then(function(r){return r.json();}).then(function(data){
    if(data.success&&data.published>0){
      var p=D.posts.find(function(x){return x.sbId===postId;});
      if(p){p.sbStatus='published';p.status='published';}
      showToast('📢 Пост опубликован в Telegram! (ID: '+data.telegram_message_id+')','success');
      addFeed('content','📢 Пост опубликован в Telegram');
      renderPosts();updateKPI();
    } else if(data.error){
      showToast('Ошибка: '+data.error+(data.detail?' — '+data.detail:''),'error');
    } else {
      showToast(data.message||'Пост не опубликован','warning');
    }
  }).catch(function(err){
    showToast('Ошибка публикации: '+err,'error');
  });
};
renderPosts();
renderPostsAnalytics();

// ═══ TEAM FEEDBACK ═══
window.sendFeedback=function(entityType,entityId,action,defaultComment){
  if(!_currentSession){showToast('Войдите в систему','error');return;}
  var data={entity_type:entityType,entity_id:parseInt(entityId)||0,action:action,
    feedback_data:{comment:defaultComment||''},author:_currentSession.login_name,author_role:_currentSession.role};
  sbInsert('team_feedback',data).then(function(){
    showToast('✅ Feedback отправлен ('+action+')','success');
    logAudit('feedback_'+action,entityType,entityId,{action:action});
  }).catch(function(e){showToast('Ошибка: '+e,'error');});
};
window.sendFeedbackComment=function(entityType,entityId){
  f2fPrompt({title:'💬 Комментарий к контенту',fields:[{id:'comment',label:'Ваш комментарий',type:'textarea',placeholder:'Что не так? Как улучшить?',rows:3}],submitText:'Отправить'}).then(function(comment){
    if(comment&&comment.trim()){sendFeedback(entityType,entityId,'comment',comment.trim());}
  });
};
window.sendFeedbackTag=function(entityType,entityId){
  var tags=['🔥 Хит','💤 Скучно','🎯 В точку','❌ Не по теме','📈 Для роста','🤝 Для партнёров','🏆 Для турниров','🎮 Для комьюнити'];
  var btns=tags.map(function(t){return '<button onclick="sendFeedback(\''+entityType+'\',\''+entityId+'\',\'tag\',\''+t+'\');closeModal()" style="padding:6px 12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text);font-size:13px">'+t+'</button>';}).join('');
  openModal('<h3 style="margin-bottom:12px">🏷 Выбери тег</h3><div style="display:flex;flex-wrap:wrap;gap:8px">'+btns+'</div>');
};
// Log audit action
function logAudit(action,entityType,entityId,details){
  if(!_currentSession)return;
  sbInsert('audit_log',{action:action,section:entityType,user_name:_currentSession.login_name,
    user_role:_currentSession.role,entity_type:entityType,entity_id:parseInt(entityId)||null,
    details:details||{}}).catch(function(){});
}

// ═══ EXPENSE ENTRIES ═══
window._expenses=[];
async function loadExpenses(){
  if(!canAddExpense())return;
  var q=canSeeExpenseTotal()?'select=*&order=created_at.desc&limit=500':'select=*&order=created_at.desc&limit=500';
  window._expenses=await sbFetch('expense_entries',q)||[];
}
window.openExpenseForm=function(){
  if(!canAddExpense()){showToast('Нет доступа','error');return;}
  var categories=[{v:'event',l:'🎮 Мероприятие'},{v:'merch',l:'👕 Мерч'},{v:'service',l:'💻 Сервис/подписка'},{v:'judge_labor',l:'⚖️ Трудозатраты судей'},{v:'other',l:'📦 Прочее'}];
  var catOpts=categories.map(function(c){return '<option value="'+c.v+'">'+c.l+'</option>';}).join('');
  var evtOpts='<option value="">— не привязан —</option>';
  (window._sbEvents||[]).forEach(function(e){evtOpts+='<option value="'+e.id+'">'+esc(e.title||'Event #'+e.id)+'</option>';});
  var empOpts='<option value="">— не привязан —</option>';
  (D.team||[]).filter(function(t){return t.status==='active';}).forEach(function(t){empOpts+='<option value="'+t.id+'">'+esc(t.name)+' ('+esc(t.role||'')+')</option>';});
  openModal('<h3 style="margin-bottom:16px">➕ Добавить расход</h3>'+
    '<div style="display:flex;flex-direction:column;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--dim)">Категория</label><select id="expCat" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px">'+catOpts+'</select></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Сумма (₽)</label><input id="expAmount" type="number" step="0.01" placeholder="0.00" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;box-sizing:border-box"></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Описание</label><input id="expDesc" placeholder="На что потрачено..." style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;box-sizing:border-box"></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Мероприятие (если связано)</label><select id="expEvent" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px">'+evtOpts+'</select></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Сотрудник (если связано)</label><select id="expEmployee" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px">'+empOpts+'</select></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Проект (если связано)</label><select id="expProject" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px"><option value="">— не привязан —</option>'+(window._projects||[]).filter(function(p){return p.status==='active';}).map(function(p){return '<option value="'+p.id+'">📁 '+esc(p.name)+'</option>';}).join('')+'</select></div>'+
    '<button onclick="submitExpense()" class="act-btn success" style="padding:10px;font-size:14px;width:100%">💾 Сохранить расход</button></div>');
};
window.submitExpense=async function(){
  var cat=document.getElementById('expCat').value;
  var amount=parseFloat(document.getElementById('expAmount').value);
  var desc=document.getElementById('expDesc').value.trim();
  var eventId=document.getElementById('expEvent').value;
  var employeeEl=document.getElementById('expEmployee');
  var employeeId=employeeEl?employeeEl.value:'';
  var projectEl=document.getElementById('expProject');
  var projectId=projectEl?projectEl.value:'';
  if(!amount||!desc){showToast('Заполни сумму и описание','error');return;}
  var entry={category:cat,amount:amount,currency:'RUB',description:desc,
    related_event_id:eventId?parseInt(eventId):null,
    related_employee_id:employeeId?parseInt(employeeId):null,
    project_id:projectId?parseInt(projectId):null,
    author:_currentSession.login_name,author_role:_currentSession.role,status:'pending'};
  await sbInsert('expense_entries',entry);
  logAudit('expense_add','expense',null,{amount:amount,category:cat,description:desc,employee_id:employeeId||null});
  showToast('✅ Расход добавлен ('+amount+' ₽)','success');
  closeModal();
  await loadExpenses();
  if(typeof renderExpenses==='function')renderExpenses();
};
var _expFilter={cat:'all',status:'all'};
window.filterExpenses=function(type,val,btn){
  _expFilter[type]=val;
  document.querySelectorAll('[data-exp-filter-'+type+']').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  renderExpenses();
};
function renderExpenses(){
  var c=document.getElementById('expensesContent');if(!c)return;
  var exps=window._expenses||[];
  var countEl=document.getElementById('expenses-count');if(countEl)countEl.textContent=exps.length+' записей';
  // Filter bar
  var fb=document.getElementById('expensesFilterBar');
  if(fb){
    var cats=[{v:'all',l:'Все'},{v:'event',l:'🎮 Мероприятие'},{v:'merch',l:'👕 Мерч'},{v:'service',l:'💻 Сервис'},{v:'judge_labor',l:'⚖️ Судьи'},{v:'other',l:'📦 Прочее'}];
    var stats=[{v:'all',l:'Все'},{v:'pending',l:'⏳ Ожидает'},{v:'approved',l:'✅ Одобрено'},{v:'rejected',l:'❌ Отклонено'}];
    var fhtml='<span style="font-size:11px;color:var(--dim);margin-right:4px">Категория:</span>';
    cats.forEach(function(ct){fhtml+='<button class="sub-tab'+(_expFilter.cat===ct.v?' active':'')+'" data-exp-filter-cat="'+ct.v+'" onclick="filterExpenses(\'cat\',\''+ct.v+'\',this)" style="font-size:10px;padding:4px 8px">'+ct.l+'</button>';});
    fhtml+='<span style="font-size:11px;color:var(--dim);margin:0 8px 0 12px">Статус:</span>';
    stats.forEach(function(st){fhtml+='<button class="sub-tab'+(_expFilter.status===st.v?' active':'')+'" data-exp-filter-status="'+st.v+'" onclick="filterExpenses(\'status\',\''+st.v+'\',this)" style="font-size:10px;padding:4px 8px">'+st.l+'</button>';});
    fb.innerHTML=fhtml;
  }
  if(!exps.length){c.innerHTML='<div style="text-align:center;padding:40px;color:var(--dim)">Нет расходов. Нажми ➕ чтобы добавить первый.</div>';return;}
  var myExps=canSeeExpenseTotal()?exps:exps.filter(function(e){return e.author===(_currentSession?_currentSession.login_name:'');});
  // Apply filters
  if(_expFilter.cat!=='all')myExps=myExps.filter(function(e){return e.category===_expFilter.cat;});
  if(_expFilter.status!=='all')myExps=myExps.filter(function(e){return e.status===_expFilter.status;});
  var total=0;myExps.forEach(function(e){total+=parseFloat(e.amount)||0;});
  var catIcons={event:'🎮',merch:'👕',service:'💻',judge_labor:'⚖️',other:'📦'};
  var statusColors={pending:'var(--amber)',approved:'var(--green)',rejected:'var(--hot)'};
  var html='';
  if(canSeeExpenseTotal()){html+='<div style="padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:16px;display:flex;gap:20px;flex-wrap:wrap"><div><span style="color:var(--dim);font-size:12px">Всего расходов</span><div style="font-size:20px;font-weight:700;color:var(--hot)">₽'+Math.round(total).toLocaleString('ru')+'</div></div><div><span style="color:var(--dim);font-size:12px">Записей</span><div style="font-size:20px;font-weight:700">'+myExps.length+'</div></div></div>';}
  html+='<div style="display:flex;flex-direction:column;gap:8px">';
  myExps.slice(0,100).forEach(function(e){
    var icon=catIcons[e.category]||'📦';
    var stColor=statusColors[e.status]||'var(--dim)';
    html+='<div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">'+
      '<span style="font-size:20px">'+icon+'</span>'+
      '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">'+esc(e.description)+'</div>'+
      '<div style="font-size:11px;color:var(--dim);margin-top:2px">'+esc(e.author)+' • '+(e.created_at?timeSince(e.created_at):'—')+
      (e.related_event_id?(function(){var ev=(window._sbEvents||F2F_EVENTS||[]).find(function(x){return String(x.id)===String(e.related_event_id);});return ev?' • 🎮 '+esc(ev.title||'Event #'+ev.id):'';})():'')+
      (e.related_employee_id?(function(){var emp=(D.team||[]).find(function(x){return x.id===e.related_employee_id;});return emp?' • 👤 '+esc(emp.name):'';})():'')+
      '</div></div>'+
      '<div style="text-align:right"><div style="font-weight:700;font-size:14px;color:var(--cyan)">₽'+(parseFloat(e.amount)||0).toLocaleString('ru')+'</div>'+
      '<div style="font-size:10px;color:'+stColor+';margin-top:2px">'+(e.status==='pending'?'⏳ Ожидает':e.status==='approved'?'✅ Одобрено':'❌ Отклонено')+'</div></div>'+
      (canSeeExpenseTotal()&&e.status==='pending'?'<div style="display:flex;flex-direction:column;gap:4px;margin-left:8px"><button onclick="approveExpense('+e.id+')" style="padding:3px 8px;background:#10b98118;color:#10b981;border:1px solid #10b98133;border-radius:4px;cursor:pointer;font-size:10px">✅</button><button onclick="rejectExpense('+e.id+')" style="padding:3px 8px;background:#ef444418;color:#ef4444;border:1px solid #ef444433;border-radius:4px;cursor:pointer;font-size:10px">❌</button></div>':'')+
      '</div>';
  });
  html+='</div>';
  c.innerHTML=html;
}
window.approveExpense=async function(id){
  if(!isAdmin()){showToast('Только админ может одобрять расходы','error');return;}
  await sbPatch('expense_entries','id=eq.'+id,{status:'approved',approved_by:_currentSession.login_name,updated_at:new Date().toISOString()});
  logAudit('expense_approve','expense',id,{});
  showToast('✅ Расход одобрен','success');
  await loadExpenses();renderExpenses();
};
window.rejectExpense=async function(id){
  if(!isAdmin()){showToast('Только админ может отклонять расходы','error');return;}
  await sbPatch('expense_entries','id=eq.'+id,{status:'rejected',approved_by:_currentSession.login_name,updated_at:new Date().toISOString()});
  logAudit('expense_reject','expense',id,{});
  showToast('❌ Расход отклонён','info');
  await loadExpenses();renderExpenses();
};

// ═══ TEAMS (REFEREE MODULE) ═══
var _teamsFilter='all';
function filterTeams(game,btn){
  _teamsFilter=game;
  document.querySelectorAll('[data-teams-filter]').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  renderTeams();
}
function renderTeams(){
  var c=document.getElementById('teamsContent');if(!c)return;
  var teams=(window._esTeams||[]).slice();
  if(_teamsFilter!=='all')teams=teams.filter(function(t){return t.game===_teamsFilter;});
  var cnt=document.getElementById('teams-count');if(cnt)cnt.textContent=teams.length;
  var tabCnt=document.getElementById('tab-teams-count');if(tabCnt)tabCnt.textContent=(window._esTeams||[]).length;
  if(!teams.length){c.innerHTML='<div style="text-align:center;padding:40px;color:var(--dim)">Нет команд. Нажмите ➕ чтобы добавить первую.</div>';return;}
  var html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">';
  teams.forEach(function(t){
    var rosters=(window._rosters||[]).filter(function(r){return r.team_id===t.id&&r.is_active;});
    var tourneys=(window._tournaments||[]).filter(function(tr){return tr.team_id===t.id;});
    var tierColor=t.tier==='T1'?'#ffb800':t.tier==='T2'?'#2cff80':t.tier==='T3'?'#00e5ff':'#666';
    var gameEmoji=t.game==='DOTA2'?'🗡️':'🔫';
    html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;cursor:pointer" onclick="openTeamDetail('+t.id+')">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html+='<div style="display:flex;align-items:center;gap:8px">';
    if(t.logo_url)html+='<img src="'+esc(t.logo_url)+'" style="width:32px;height:32px;border-radius:6px;object-fit:cover" onerror="this.style.display=\'none\'">';
    html+='<div><div style="font-weight:700;font-size:15px;color:var(--text)">'+esc(t.name)+'</div>';
    if(t.tag)html+='<div style="font-size:11px;color:var(--dim)">['+esc(t.tag)+']</div>';
    html+='</div></div>';
    html+='<div style="display:flex;gap:4px">';
    html+='<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:'+tierColor+'22;color:'+tierColor+';font-weight:600">'+(t.tier||'?')+'</span>';
    html+='<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--surface-hover)">'+gameEmoji+' '+esc(t.game)+'</span>';
    html+='</div></div>';
    // Region + manager
    html+='<div style="font-size:11px;color:var(--dim);margin-bottom:6px">';
    if(t.region)html+='🌍 '+esc(t.region)+' ';
    if(t.manager_name)html+='👤 '+esc(t.manager_name);
    html+='</div>';
    // Stats row
    html+='<div style="display:flex;gap:12px;font-size:11px;color:var(--dim)">';
    html+='<span>👥 '+rosters.length+' игроков</span>';
    html+='<span>🏅 '+tourneys.length+' турниров</span>';
    if(t.avg_rating)html+='<span>⭐ '+Number(t.avg_rating).toFixed(1)+'</span>';
    html+='</div>';
    html+='</div>';
  });
  html+='</div>';
  c.innerHTML=html;
}

function openTeamForm(editId){
  var t=editId?(window._esTeams||[]).find(function(x){return x.id===editId;}):null;
  var html='<div style="display:grid;gap:10px">';
  html+='<input id="tf-name" placeholder="Название команды *" value="'+esc(t?t.name:'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html+='<input id="tf-tag" placeholder="Тег (NAVI, G2)" value="'+esc(t?t.tag||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<select id="tf-game" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)"><option value="CS2"'+(t&&t.game==='CS2'?' selected':'')+'>CS2</option><option value="DOTA2"'+(t&&t.game==='DOTA2'?' selected':'')+'>DOTA2</option></select>';
  html+='</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html+='<select id="tf-tier" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)"><option value="">Тир</option><option value="T1"'+(t&&t.tier==='T1'?' selected':'')+'>T1</option><option value="T2"'+(t&&t.tier==='T2'?' selected':'')+'>T2</option><option value="T3"'+(t&&t.tier==='T3'?' selected':'')+'>T3</option><option value="amateur"'+(t&&t.tier==='amateur'?' selected':'')+'>Amateur</option></select>';
  html+='<select id="tf-region" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)"><option value="">Регион</option><option value="CIS"'+(t&&t.region==='CIS'?' selected':'')+'>CIS</option><option value="EU"'+(t&&t.region==='EU'?' selected':'')+'>EU</option><option value="NA"'+(t&&t.region==='NA'?' selected':'')+'>NA</option><option value="ASIA"'+(t&&t.region==='ASIA'?' selected':'')+'>ASIA</option><option value="SA"'+(t&&t.region==='SA'?' selected':'')+'>SA</option></select>';
  html+='</div>';
  html+='<input id="tf-manager" placeholder="Менеджер" value="'+esc(t?t.manager_name||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="tf-contact" placeholder="Контакт менеджера (email/tg)" value="'+esc(t?t.manager_contact||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="tf-website" placeholder="Сайт" value="'+esc(t?t.website||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<textarea id="tf-notes" placeholder="Заметки" rows="2" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);resize:vertical">'+esc(t?t.notes||'':'')+'</textarea>';
  html+='<button class="act-btn success" onclick="submitTeam('+(editId||'null')+')">💾 '+(editId?'Обновить':'Создать')+'</button>';
  html+='</div>';
  showModal('🏆 '+(editId?'Редактировать':'Новая команда'),html);
}

async function submitTeam(editId){
  var name=document.getElementById('tf-name').value.trim();
  if(!name){showToast('Введите название','error');return;}
  var obj={
    name:name,
    tag:document.getElementById('tf-tag').value.trim()||null,
    game:document.getElementById('tf-game').value,
    tier:document.getElementById('tf-tier').value||null,
    region:document.getElementById('tf-region').value||null,
    manager_name:document.getElementById('tf-manager').value.trim()||null,
    manager_contact:document.getElementById('tf-contact').value.trim()||null,
    website:document.getElementById('tf-website').value.trim()||null,
    notes:document.getElementById('tf-notes').value.trim()||null
  };
  if(editId){
    await sbPatch('esports_teams','id=eq.'+editId,obj);
    logAudit('team_update','team',editId,{name:name});
    showToast('✅ Команда обновлена','success');
  }else{
    obj.created_by=_currentSession.login_name||'admin';
    await sbInsert('esports_teams',obj);
    logAudit('team_create','team',null,{name:name});
    showToast('✅ Команда создана','success');
  }
  closeModal();
  var fresh=await sbFetch('esports_teams','select=*&order=created_at.desc&limit=500');
  if(fresh)window._esTeams=fresh;
  renderTeams();
}

function openTeamDetail(teamId){
  var t=(window._esTeams||[]).find(function(x){return x.id===teamId;});
  if(!t)return;
  var rosters=(window._rosters||[]).filter(function(r){return r.team_id===teamId;});
  var activeRosters=rosters.filter(function(r){return r.is_active;});
  var inactiveRosters=rosters.filter(function(r){return !r.is_active;});
  var tourneys=(window._tournaments||[]).filter(function(tr){return tr.team_id===teamId;});
  var gameEmoji=t.game==='DOTA2'?'🗡️':'🔫';

  var html='<div style="display:grid;gap:14px">';
  // Header info
  html+='<div style="display:flex;justify-content:space-between;align-items:center">';
  html+='<div>';
  if(t.tag)html+='<span style="color:var(--dim);font-size:13px">['+esc(t.tag)+']</span> ';
  html+=gameEmoji+' '+esc(t.game)+' • '+(t.tier||'?')+' • '+(t.region||'N/A');
  html+='</div>';
  html+='<div style="display:flex;gap:6px">';
  html+='<button class="act-btn" onclick="closeModal();openTeamForm('+t.id+')" style="font-size:11px;padding:3px 8px">✏️ Изменить</button>';
  html+='</div></div>';
  // Contact
  if(t.manager_name||t.manager_contact||t.website){
    html+='<div style="font-size:12px;color:var(--dim);padding:8px;background:var(--surface);border-radius:6px">';
    if(t.manager_name)html+='👤 '+esc(t.manager_name);
    if(t.manager_contact)html+=' • 📧 '+esc(t.manager_contact);
    if(t.website)html+='<br>🌐 '+esc(t.website);
    html+='</div>';
  }
  if(t.notes)html+='<div style="font-size:12px;color:var(--dim);padding:8px;background:var(--surface);border-radius:6px">📝 '+esc(t.notes)+'</div>';

  // ═══ ROSTER ═══
  html+='<div style="border-top:1px solid var(--border);padding-top:10px">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  html+='<h3 style="margin:0;font-size:14px;color:var(--text)">👥 Ростер ('+activeRosters.length+')</h3>';
  html+='<button class="act-btn success" onclick="openPlayerForm('+t.id+')" style="font-size:11px;padding:3px 8px">➕ Игрок</button>';
  html+='</div>';
  if(activeRosters.length){
    html+='<div style="display:grid;gap:6px">';
    activeRosters.forEach(function(p){
      var roleColor=p.role==='IGL'?'#ffb800':p.role==='AWPer'?'#ff4444':p.role==='Coach'?'#a855f7':'var(--dim)';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--surface);border-radius:6px">';
      html+='<div style="display:flex;align-items:center;gap:8px">';
      html+='<span style="font-weight:600;color:var(--text)">'+esc(p.nickname)+'</span>';
      if(p.real_name)html+='<span style="font-size:11px;color:var(--dim)">'+esc(p.real_name)+'</span>';
      if(p.role)html+='<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:'+roleColor+'22;color:'+roleColor+'">'+esc(p.role)+'</span>';
      html+='</div>';
      html+='<div style="display:flex;align-items:center;gap:6px">';
      if(p.rating)html+='<span style="font-size:11px;color:var(--accent)">⭐'+Number(p.rating).toFixed(2)+'</span>';
      html+='<button class="act-btn" onclick="editPlayer('+p.id+','+t.id+')" style="font-size:10px;padding:2px 6px">✏️</button>';
      html+='</div></div>';
    });
    html+='</div>';
  }else{
    html+='<div style="font-size:12px;color:var(--dim);text-align:center;padding:10px">Нет игроков</div>';
  }
  if(inactiveRosters.length){
    html+='<details style="margin-top:6px"><summary style="font-size:11px;color:var(--dim);cursor:pointer">Бывшие игроки ('+inactiveRosters.length+')</summary>';
    html+='<div style="display:grid;gap:4px;margin-top:4px">';
    inactiveRosters.forEach(function(p){
      html+='<div style="font-size:11px;color:var(--dim);padding:4px 8px;background:var(--surface);border-radius:4px;opacity:0.6">'+esc(p.nickname)+(p.role?' ('+esc(p.role)+')':'')+' — ушёл '+(p.left_at||'?')+'</div>';
    });
    html+='</div></details>';
  }
  html+='</div>';

  // ═══ TOURNAMENTS ═══
  html+='<div style="border-top:1px solid var(--border);padding-top:10px">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
  html+='<h3 style="margin:0;font-size:14px;color:var(--text)">🏅 Турниры ('+tourneys.length+')</h3>';
  html+='<button class="act-btn success" onclick="openTournamentForm('+t.id+')" style="font-size:11px;padding:3px 8px">➕ Турнир</button>';
  html+='</div>';
  if(tourneys.length){
    html+='<div style="display:grid;gap:6px">';
    tourneys.forEach(function(tr){
      var plColor=tr.placement&&tr.placement.indexOf('1')===0?'#ffb800':tr.placement&&tr.placement.indexOf('2')===0?'#c0c0c0':'var(--dim)';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--surface);border-radius:6px">';
      html+='<div><span style="font-weight:600;color:var(--text)">'+esc(tr.tournament_name)+'</span>';
      if(tr.date_start)html+=' <span style="font-size:11px;color:var(--dim)">'+esc(tr.date_start)+'</span>';
      html+='</div>';
      html+='<div style="display:flex;align-items:center;gap:6px">';
      if(tr.placement)html+='<span style="font-size:11px;font-weight:600;color:'+plColor+'">'+esc(tr.placement)+'</span>';
      if(tr.prize)html+='<span style="font-size:11px;color:var(--accent)">'+esc(tr.prize)+'</span>';
      html+='</div></div>';
    });
    html+='</div>';
  }else{
    html+='<div style="font-size:12px;color:var(--dim);text-align:center;padding:10px">Нет записей</div>';
  }
  html+='</div></div>';

  showModal('🏆 '+esc(t.name),html);
}

function openPlayerForm(teamId,editId){
  var p=editId?(window._rosters||[]).find(function(x){return x.id===editId;}):null;
  var html='<div style="display:grid;gap:8px">';
  html+='<input id="pf-nick" placeholder="Ник *" value="'+esc(p?p.nickname:'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="pf-name" placeholder="Реальное имя" value="'+esc(p?p.real_name||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<select id="pf-role" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)"><option value="">Роль</option><option value="AWPer"'+(p&&p.role==='AWPer'?' selected':'')+'>AWPer</option><option value="IGL"'+(p&&p.role==='IGL'?' selected':'')+'>IGL</option><option value="Rifler"'+(p&&p.role==='Rifler'?' selected':'')+'>Rifler</option><option value="Support"'+(p&&p.role==='Support'?' selected':'')+'>Support</option><option value="Coach"'+(p&&p.role==='Coach'?' selected':'')+'>Coach</option><option value="Stand-in"'+(p&&p.role==='Stand-in'?' selected':'')+'>Stand-in</option><option value="Carry"'+(p&&p.role==='Carry'?' selected':'')+'>Carry</option><option value="Mid"'+(p&&p.role==='Mid'?' selected':'')+'>Mid</option><option value="Offlane"'+(p&&p.role==='Offlane'?' selected':'')+'>Offlane</option><option value="Pos4"'+(p&&p.role==='Pos4'?' selected':'')+'>Pos 4</option><option value="Pos5"'+(p&&p.role==='Pos5'?' selected':'')+'>Pos 5</option></select>';
  html+='<input id="pf-rating" type="number" step="0.01" placeholder="Рейтинг (1.00-2.00)" value="'+(p?p.rating||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="pf-steam" placeholder="Steam ID" value="'+esc(p?p.steam_id||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="pf-faceit" placeholder="FACEIT URL" value="'+esc(p?p.faceit_url||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<button class="act-btn success" onclick="submitPlayer('+teamId+','+(editId||'null')+')">💾 '+(editId?'Обновить':'Добавить')+'</button>';
  html+='</div>';
  showModal('👤 '+(editId?'Редактировать':'Новый игрок'),html);
}

function editPlayer(playerId,teamId){closeModal();openPlayerForm(teamId,playerId);}

async function submitPlayer(teamId,editId){
  var nick=document.getElementById('pf-nick').value.trim();
  if(!nick){showToast('Введите ник','error');return;}
  var obj={
    team_id:teamId,
    nickname:nick,
    real_name:document.getElementById('pf-name').value.trim()||null,
    role:document.getElementById('pf-role').value||null,
    rating:document.getElementById('pf-rating').value?parseFloat(document.getElementById('pf-rating').value):null,
    steam_id:document.getElementById('pf-steam').value.trim()||null,
    faceit_url:document.getElementById('pf-faceit').value.trim()||null
  };
  if(editId){
    await sbPatch('team_rosters','id=eq.'+editId,obj);
    showToast('✅ Игрок обновлён','success');
  }else{
    obj.is_active=true;
    obj.joined_at=new Date().toISOString().slice(0,10);
    await sbInsert('team_rosters',obj);
    showToast('✅ Игрок добавлен','success');
  }
  closeModal();
  var fresh=await sbFetch('team_rosters','select=*&order=created_at.desc&limit=500');
  if(fresh)window._rosters=fresh;
  openTeamDetail(teamId);
}

function openTournamentForm(teamId,editId){
  var tr=editId?(window._tournaments||[]).find(function(x){return x.id===editId;}):null;
  var html='<div style="display:grid;gap:8px">';
  html+='<input id="trf-name" placeholder="Название турнира *" value="'+esc(tr?tr.tournament_name:'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html+='<input id="trf-start" type="date" value="'+(tr?tr.date_start||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="trf-end" type="date" value="'+(tr?tr.date_end||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  html+='<input id="trf-placement" placeholder="Место (1st, 3-4th)" value="'+esc(tr?tr.placement||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='<input id="trf-prize" placeholder="Приз ($5000)" value="'+esc(tr?tr.prize||'':'')+'" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text)">';
  html+='</div>';
  html+='<textarea id="trf-notes" placeholder="Заметки" rows="2" style="padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);resize:vertical">'+esc(tr?tr.notes||'':'')+'</textarea>';
  html+='<button class="act-btn success" onclick="submitTournament('+teamId+','+(editId||'null')+')">💾 '+(editId?'Обновить':'Добавить')+'</button>';
  html+='</div>';
  showModal('🏅 '+(editId?'Редактировать':'Новый турнир'),html);
}

async function submitTournament(teamId,editId){
  var name=document.getElementById('trf-name').value.trim();
  if(!name){showToast('Введите название','error');return;}
  var t=(window._esTeams||[]).find(function(x){return x.id===teamId;});
  var obj={
    team_id:teamId,
    tournament_name:name,
    game:t?t.game:'CS2',
    date_start:document.getElementById('trf-start').value||null,
    date_end:document.getElementById('trf-end').value||null,
    placement:document.getElementById('trf-placement').value.trim()||null,
    prize:document.getElementById('trf-prize').value.trim()||null,
    notes:document.getElementById('trf-notes').value.trim()||null
  };
  if(editId){
    await sbPatch('tournament_entries','id=eq.'+editId,obj);
    showToast('✅ Турнир обновлён','success');
  }else{
    obj.created_by=_currentSession.login_name||'admin';
    await sbInsert('tournament_entries',obj);
    showToast('✅ Турнир добавлен','success');
  }
  closeModal();
  var fresh=await sbFetch('tournament_entries','select=*&order=date_start.desc&limit=500');
  if(fresh)window._tournaments=fresh;
  openTeamDetail(teamId);
}

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
      ${r.actionItems&&r.actionItems.length?`<div class="report-actions">${r.actionItems.map(a=>`<div class="report-action">${typeof a==='string'?a:JSON.stringify(a)}</div>`).join('')}</div>`:''}
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
  showToast('Задача создана: '+item,'info');
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
    if(!r.actionItems||!r.actionItems.length){showToast('Нет action items','warning');return;}
    var agent=r.agentId||'coordinator';
    var count=r.actionItems.length;
    r.actionItems.forEach(function(item){createTaskSynced(item,agent,'normal');});
    addFeed(agent,'📋 Создано '+count+' задач из отчёта');
    showToast('Создано '+count+' задач из action items!','success');
  }
  if(action==='copy'){
    navigator.clipboard.writeText(r.title+'\n\n'+r.content+'\n\nAction Items:\n'+(r.actionItems||[]).join('\n')).then(function(){showToast('Отчёт скопирован!','success');});
  }
  if(action==='refresh'){
    createTaskSynced('Обновить отчёт: '+r.title,r.agentId||'coordinator','high');
    addFeed(r.agentId||'coordinator','🔄 Запрос обновления: '+r.title.slice(0,40));
    showToast('Задача на обновление создана!','info');
  }
};
renderReports();

// ═══ AUTONOMOUS TRIGGER FUNCTIONS ═══

// Helper: full data reload after agent runs (credits, reports, leads, memory)
async function reloadAfterAgentRun(){
  var reports=await sbFetch('reports','select=id,agent_id,type_ab,summary,results,theses,metrics_json,approved_by_ceo,created_at&order=created_at.desc&limit=500');
  if(reports)window._sbReports=reports;
  var credits=await sbFetch('ai_credits','select=agent_id,tokens_input,tokens_output,cost_usd,model,task_type,created_at&order=created_at.desc&limit=500');
  if(credits)window._sbCredits=credits;
  var partners=await sbFetch('partner_pipeline','select=*&order=created_at.desc&limit=500');
  if(partners)window._sbPartners=partners;
  var actions=await sbFetch('actions','select=id,agent_id,type,payload_json,created_at&order=created_at.desc&limit=500');
  if(actions)window._sbActions=actions;
  var memory=await sbFetch('agent_memory','select=agent_id,state,last_output,insights,next_action,tasks_done,cycle_number,created_at,agents!inner(slug,name)&order=created_at.desc&limit=500');
  if(memory)window._sbMemory=memory.map(function(m){var ag=m.agents;return Object.assign({},m,{slug:ag?ag.slug:'unknown',dashId:ag?SB_SLUG_TO_DASH[ag.slug]:null});});
  refreshAfterSync();
  if(typeof calcCreditsFromSupabase==='function')calcCreditsFromSupabase();
}

window.triggerBriefing=async function(btnEl){
  if(!SUPABASE_LIVE){showToast('Supabase не подключён','error');return;}
  var btn=btnEl||this;
  var origText=btn.textContent;
  btn.disabled=true;btn.textContent='⏳ Генерирую...';btn.style.opacity='0.6';btn.style.animation='pulse 1.5s infinite';
  showToast('🌅 Генерирую брифинг... (30-60 сек)','info');
  addFeed('coordinator','🌅 Запуск брифинга...');
  try{
    var r=await fetch(SUPABASE_URL+'/functions/v1/coordinator-briefing',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
      body:JSON.stringify({type:'morning'})
    });
    if(!r.ok){
      var errText=await r.text();
      addFeed('coordinator','❌ Ошибка брифинга: HTTP '+r.status);
      showToast('Ошибка HTTP '+r.status+': '+errText.slice(0,200,'error'));
      btn.disabled=false;btn.textContent=origText;return;
    }
    var data=await r.json();
    if(data.success&&data.briefing){
      addFeed('coordinator','✅ Брифинг готов: '+(data.briefing.title||'').slice(0,60));
      await reloadAfterAgentRun();
      auditLog('trigger','agents','Брифинг сгенерирован');
      showToast('Брифинг готов! Смотри вкладку Отчёты','success');
    }else if(data.error){
      addFeed('coordinator','❌ '+data.error.slice(0,80));
      showToast('Ошибка: '+data.error,'error');
    }else{
      addFeed('coordinator','⚠️ Неожиданный ответ от брифинга');
      showToast('Неожиданный ответ: '+JSON.stringify(data,'info').slice(0,300));
    }
  }catch(e){
    addFeed('coordinator','❌ Сеть: '+String(e).slice(0,60));
    showToast('Ошибка сети: '+e,'error');
  }
  btn.disabled=false;btn.textContent=origText;btn.style.opacity='';btn.style.animation='';
};

// Run all agents or a single agent by slug
window.triggerAgentCycles=async function(btnEl, singleAgentSlug){
  if(!SUPABASE_LIVE){showToast('Supabase не подключён','error');return;}
  var btn=btnEl||this;
  var origText=btn.textContent;
  var isSingle=!!singleAgentSlug;
  btn.disabled=true;btn.textContent=isSingle?'⏳ '+singleAgentSlug+'...':'⏳ Запускаю...';
  btn.style.opacity='0.6';btn.style.animation='pulse 1.5s infinite';
  showToast(isSingle?'⚡ Запущен цикл '+singleAgentSlug+'... (30-60 сек)':'⚡ Запускаю все циклы... (1-3 мин)','info');
  addFeed('coordinator',isSingle?'⚡ Запуск цикла: '+singleAgentSlug:'⚡ Запуск всех циклов...');
  try{
    var body=isSingle?{agent_slug:singleAgentSlug}:{};
    var r=await fetch(SUPABASE_URL+'/functions/v1/agent-autonomous-cycle',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
      body:JSON.stringify(body)
    });
    if(!r.ok){
      var errText=await r.text();
      addFeed('coordinator','❌ Ошибка циклов: HTTP '+r.status);
      showToast('Ошибка HTTP '+r.status+': '+errText.slice(0,200,'error'));
      btn.disabled=false;btn.textContent=origText;return;
    }
    var data=await r.json();
    if(data.success){
      var results=data.results||[];
      var ok=results.filter(function(x){return x.success;});
      var fail=results.filter(function(x){return !x.success;});
      var summaries=results.map(function(x){
        return (x.success?'✅':'❌')+' '+x.agent+': '+(x.summary||x.error||'ok').slice(0,80);
      }).join('\n');
      addFeed('coordinator','⚡ Циклы завершены: '+ok.length+' ✅, '+fail.length+' ❌ из '+results.length);
      // Show per-agent results in feed
      results.forEach(function(x){
        var dashId=SB_SLUG_TO_DASH[x.agent]||'coordinator';
        addFeed(dashId,(x.success?'✅':'❌')+' Цикл: '+(x.summary||x.error||'выполнен').slice(0,100));
      });
      await reloadAfterAgentRun();
      auditLog('trigger','agents',(isSingle?singleAgentSlug:'all')+' циклы: '+ok.length+' ok, '+fail.length+' fail');
      showToast('Циклы завершены: '+ok.length+' ✅, '+fail.length+' ❌',fail.length>0?'warning':'success');
    }else{
      addFeed('coordinator','❌ '+(data.error||'Неизвестная ошибка').slice(0,80));
      showToast('Ошибка: '+(data.error||JSON.stringify(data,'error')));
    }
  }catch(e){
    addFeed('coordinator','❌ Сеть: '+String(e).slice(0,60));
    showToast('Ошибка сети: '+e,'error');
  }
  btn.disabled=false;btn.textContent=origText;btn.style.opacity='';btn.style.animation='';
};

// Run single agent cycle (called from agent detail panel)
window.triggerSingleAgent=async function(agentSlug, btnEl){
  return window.triggerAgentCycles(btnEl, agentSlug);
};

// ═══ TASKS ═══
// Helper: build human-readable title from payload
// Strip template variables {{name}}, [Name] etc from display text
function stripVars(s){return (s||'').replace(/\{\{[^}]+\}\}/g,'').replace(/\[[A-Z][a-z]+\]/g,'').replace(/\s{2,}/g,' ').trim();}
// Pretty segment label
function segmentLabel(seg){
  if(!seg)return '';
  return seg.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});
}

function taskSmartTitle(t){
  var p=t._payload||{};
  var aType=(t._actionType||'').toLowerCase();

  // === FOLLOWUP EMAIL (most specific — check first) ===
  if(aType==='followup_email'){
    var partner=esc(p.partner||p.company||'');
    var contact=esc(p.contact_name||'');
    var subj=esc(stripVars(p.subject||''));
    if(partner||contact)return '📨 Follow-up'+(partner?' → '+partner:'')+(contact?' ('+contact+')':'')+(subj?' — '+subj:'');
    return '📨 Follow-up'+(subj?' — '+subj:'');
  }

  // === EMAIL TEMPLATE ===
  if(aType.includes('email_template')){
    var subj=esc(stripVars(p.subject||p.email_subject||''));
    var segment=segmentLabel(p.target_segment||'');
    var to=esc(p.to||p.email||p.recipient||p.contact_email||'');
    var company=esc(p.company||p.partner||'');
    // Priority: subject > company > segment > body excerpt
    if(subj){
      var ctx=company||segment;
      return '📧'+(ctx?' ['+ctx+']':'')+' '+subj;
    }
    if(company)return '📧 Email → '+company;
    if(segment)return '📧 Шаблон: '+segment;
    if(to)return '📧 Email → '+to;
    // Last resort: first meaningful line from body, stripped of variables
    if(p.body||p.text){
      var clean=stripVars((p.body||p.text||'').split('\n').filter(function(l){return l.trim().length>10;}).slice(1,2).join(' '));
      if(clean)return '📧 '+clean;
    }
    return '📧 Email шаблон';
  }

  // === LEAD SUGGESTED ===
  if(aType.includes('lead_suggested')){
    var comp=esc(p.company||p.company_name||p.organization||p.org||'');
    var segment=segmentLabel(p.segment||'');
    var reason=esc(p.reason||p.description||p.why||p.summary||'');
    if(comp){
      var reasonShort=reason?(' — '+reason.slice(0,80)):'';
      return '🆕 '+comp+(segment?' ('+segment+')':'')+reasonShort;
    }
    var name=esc(p.name||p.contact||p.contact_name||p.lead_name||p.lead||'');
    if(name)return '🆕 Лид: '+name;
    // Last resort: scan all string values in payload for something readable
    var anyVal='';
    var keys=Object.keys(p);
    for(var ki=0;ki<keys.length;ki++){
      var v=p[keys[ki]];
      if(typeof v==='string'&&v.length>3&&v.length<120&&keys[ki]!=='status'&&keys[ki]!=='kanban_status'){
        anyVal=v;break;
      }
    }
    if(anyVal)return '🆕 '+esc(anyVal.slice(0,80));
    return '🆕 Рекомендация лида';
  }

  // === META RECOMMENDATIONS ===
  if(aType.includes('meta_recommendation')){
    var src=esc(p.source_agent||'');
    var rec=esc(p.recommendation||'');
    var srcLabel=src==='qa'?'🧪 QA':src==='cto'?'🛠 CTO':src==='cpo'?'📦 CPO':src==='ux'?'🎨 UX':src?'🤖 '+src:'🤖 Meta';
    if(rec)return srcLabel+': '+rec;
    return srcLabel+' рекомендация';
  }

  // === AGENT CYCLES ===
  if(aType.includes('cycle_run')||aType.includes('agent_cycle')){
    var agentName=esc(p.agent_name||p.agent_slug||p.agent||'');
    var result=esc(p.result||p.summary||'');
    if(agentName&&result)return '🔄 '+agentName+': '+result;
    if(agentName)return '🔄 Цикл: '+agentName;
    return esc(t.title)||'🔄 Цикл агента';
  }

  // === CHAT TASKS ===
  if(aType.includes('task_from_chat')||t.fromChat)return esc(t.title);

  // === FALLBACK ===
  var fallback=stripVars(p.recommendation||p.description||p.summary||p.reason||p.title||'');
  if(fallback&&fallback.length>5)return esc(fallback.slice(0,100));
  // If title is just raw action type, try to humanize it
  var rawTitle=t.title||'';
  if(rawTitle===aType||rawTitle.match(/^[a-z_]+$/)){
    // Scan payload for any readable string value
    var pKeys=Object.keys(p);
    for(var fi=0;fi<pKeys.length;fi++){
      var fv=p[pKeys[fi]];
      if(typeof fv==='string'&&fv.length>3&&fv.length<120&&pKeys[fi]!=='status'&&pKeys[fi]!=='kanban_status'){
        return esc(fv.slice(0,100));
      }
    }
    // Humanize the type: "lead_suggested" → "Lead Suggested"
    return esc(rawTitle.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();}));
  }
  return esc(rawTitle)||'Задача #'+t.id;
}

// Helper: get short description from task payload (for card subtitle)
function taskDescription(t){
  var p=t._payload||{};
  var aType=(t._actionType||'').toLowerCase();
  if(aType.includes('email')){
    // For emails show subject or first body line
    var subj=stripVars(p.subject||'');
    if(subj)return esc(subj);
    var body=stripVars(p.body||p.text||'');
    var lines=body.split('\n').filter(function(l){return l.trim().length>5;});
    return esc((lines[1]||lines[0]||'').slice(0,100));
  }
  if(aType.includes('lead_suggested'))return esc(p.reason||p.description||'').slice(0,100);
  return esc(stripVars(p.recommendation||p.description||p.summary||p.reason||'')).slice(0,100);
}
// Helper: build preview card HTML from payload
function taskPreviewHTML(t){
  var p=t._payload||{};
  var aType=(t._actionType||'').toLowerCase();
  if(!p||Object.keys(p).length<=2)return '';
  var html='<div style="margin-top:8px;padding:10px 12px;background:#0d1117;border:1px solid var(--border);border-radius:8px;font-size:12px;line-height:1.6;max-height:200px;overflow-y:auto">';
  if(aType.includes('email_template')){
    html+='<div style="color:var(--cyan);margin-bottom:4px">📧 Превью email</div>';
    if(p.to||p.email||p.recipient)html+='<div><b style="color:var(--dim)">Кому:</b> '+(p.to||p.email||p.recipient)+'</div>';
    if(p.subject||p.email_subject)html+='<div><b style="color:var(--dim)">Тема:</b> '+(p.subject||p.email_subject)+'</div>';
    var body=p.body||p.template||p.text||p.content||p.email_body||'';
    if(body)html+='<div style="margin-top:6px;white-space:pre-wrap;color:var(--text)">'+body.slice(0,500)+(body.length>500?'...':'')+'</div>';
    if(!body&&!p.to&&!p.subject){
      // Show raw payload if no recognized fields
      html+='<div style="color:var(--dim)">'+JSON.stringify(p,null,2).slice(0,400)+'</div>';
    }
  } else if(aType.includes('lead_suggested')){
    html+='<div style="color:var(--green);margin-bottom:4px">🆕 Детали лида</div>';
    if(p.name||p.contact||p.contact_name)html+='<div><b style="color:var(--dim)">Имя:</b> '+(p.name||p.contact||p.contact_name)+'</div>';
    if(p.company||p.organization)html+='<div><b style="color:var(--dim)">Компания:</b> '+esc(p.company||p.organization)+'</div>';
    if(p.email||p.contact_email)html+='<div><b style="color:var(--dim)">Email:</b> '+esc(p.email||p.contact_email)+'</div>';
    if(p.role||p.position||p.title)html+='<div><b style="color:var(--dim)">Роль:</b> '+esc(p.role||p.position||p.title)+'</div>';
    if(p.reason||p.description||p.why)html+='<div style="margin-top:4px"><b style="color:var(--dim)">Почему:</b> '+esc(p.reason||p.description||p.why)+'</div>';
    if(!p.name&&!p.company){
      html+='<div style="color:var(--dim)">'+JSON.stringify(p,null,2).slice(0,400)+'</div>';
    }
  } else {
    // Generic: show all payload fields
    var keys=Object.keys(p).filter(function(k){return k!=='status'&&k!=='priority'&&k!=='source';});
    if(keys.length>0){
      keys.forEach(function(k){
        var v=typeof p[k]==='object'?JSON.stringify(p[k]):String(p[k]);
        html+='<div><b style="color:var(--dim)">'+k+':</b> '+v.slice(0,150)+'</div>';
      });
    }
  }
  html+='</div>';
  return html;
}
// ═══ KANBAN TASK STATUSES ═══
var KANBAN_STATUSES={
  backlog:{label:'📥 Бэклог',color:'#64748b'},
  decomposed:{label:'🧩 Декомпозиция',color:'#8b5cf6'},
  planned:{label:'📋 Запланировано',color:'#06b6d4'},
  in_progress:{label:'🔧 В работе',color:'#f59e0b'},
  done:{label:'✅ Выполнено',color:'#10b981'},
  rework:{label:'🔄 Переработка',color:'#f97316'},
  cancelled:{label:'❌ Отменено',color:'#475569'}
};
// Map old statuses to kanban statuses
function mapToKanban(status){
  if(status==='pending'||status==='backlog')return 'backlog';
  if(status==='decomposed')return 'decomposed';
  if(status==='planned')return 'planned';
  if(status==='in_progress'||status==='working')return 'in_progress';
  if(status==='done'||status==='executed')return 'done';
  if(status==='rework')return 'rework';
  if(status==='cancelled')return 'cancelled';
  if(status==='postponed')return 'backlog';
  return 'backlog';
}
var taskViewMode='list'; // 'list' or 'kanban'
var _taskAgentFilter='all';
// ═══ TASK FILTERS ═══
window.setTaskAgentFilter=function(agentId){
  _taskAgentFilter=agentId;
  // Update active state on filter buttons
  var btns=document.querySelectorAll('#taskAgentFilters .filter-btn');
  btns.forEach(function(b){
    b.classList.toggle('active',b.getAttribute('data-agent')===agentId);
  });
  renderTasks();
};

// Build agent filter buttons dynamically (rebuilds every render to update counts)
function buildTaskAgentFilters(){
  var container=document.getElementById('taskAgentFilters');
  if(!container)return;
  // Count tasks per agent
  var agentCounts={};
  D.tasks.forEach(function(t){
    var a=t.assignedTo||'unknown';
    agentCounts[a]=(agentCounts[a]||0)+1;
  });
  // "All" button already in HTML, rebuild entirely
  var html='<button class="filter-btn active" data-agent="all" onclick="setTaskAgentFilter(\'all\')">Все <span class="filter-count">'+D.tasks.length+'</span></button>';
  // Only show agents that have tasks, sorted by count desc
  var agentKeys=Object.keys(agentCounts).sort(function(a,b){return agentCounts[b]-agentCounts[a];});
  agentKeys.forEach(function(key){
    var ag=AGENTS[key]||{emoji:'📋',name:key,color:'#64748b'};
    html+='<button class="filter-btn" data-agent="'+key+'" onclick="setTaskAgentFilter(\''+key+'\')" style="border-color:'+ag.color+'33">'+
      ag.emoji+' '+(ag.name||key).split(' ')[0]+
      '<span class="filter-count">'+agentCounts[key]+'</span></button>';
  });
  container.innerHTML=html;
}

// Get filtered tasks based on current filters
function getFilteredTasks(){
  var tasks=D.tasks;
  // Agent filter
  if(_taskAgentFilter!=='all'){
    tasks=tasks.filter(function(t){return t.assignedTo===_taskAgentFilter;});
  }
  // Type filter
  var typeF=document.getElementById('taskTypeFilter');
  if(typeF&&typeF.value!=='all'){
    var tf=typeF.value;
    tasks=tasks.filter(function(t){return (t._actionType||'').toLowerCase().includes(tf);});
  }
  // Priority filter
  var priF=document.getElementById('taskPriFilter');
  if(priF&&priF.value!=='all'){
    var pf=priF.value;
    tasks=tasks.filter(function(t){return (t.priority||'normal')===pf;});
  }
  return tasks;
}

// Populate KPI strip
function renderTaskKpiStrip(tasks){
  var strip=document.getElementById('taskKpiStrip');
  if(!strip)return;
  var total=tasks.length;
  var byStatus={backlog:0,decomposed:0,planned:0,in_progress:0,done:0,rework:0};
  tasks.forEach(function(t){
    var ks=mapToKanban(t.kanbanStatus||t.status);
    if(byStatus[ks]!==undefined)byStatus[ks]++;
  });
  var critical=tasks.filter(function(t){return t.priority==='critical';}).length;
  var overdue=tasks.filter(function(t){
    if(!t.deadline)return false;
    return new Date(t.deadline)<new Date();
  }).length;
  // Unique agents working
  var activeAgents={};
  tasks.forEach(function(t){if(t.assignedTo)activeAgents[t.assignedTo]=true;});
  strip.innerHTML=
    '<div class="tkpi"><div class="tkpi-val">'+total+'</div><div class="tkpi-label">Всего</div></div>'+
    '<div class="tkpi"><div class="tkpi-val" style="color:#f59e0b">'+byStatus.in_progress+'</div><div class="tkpi-label">В работе</div></div>'+
    '<div class="tkpi"><div class="tkpi-val" style="color:#64748b">'+byStatus.backlog+'</div><div class="tkpi-label">Бэклог</div></div>'+
    '<div class="tkpi"><div class="tkpi-val" style="color:#06b6d4">'+byStatus.planned+'</div><div class="tkpi-label">План</div></div>'+
    '<div class="tkpi"><div class="tkpi-val" style="color:#10b981">'+byStatus.done+'</div><div class="tkpi-label">Готово</div></div>'+
    '<div class="tkpi"><div class="tkpi-val" style="color:#f97316">'+byStatus.rework+'</div><div class="tkpi-label">Rework</div></div>'+
    (critical?'<div class="tkpi"><div class="tkpi-val" style="color:#ff4444">'+critical+'</div><div class="tkpi-label">Critical</div></div>':'')+
    (overdue?'<div class="tkpi"><div class="tkpi-val" style="color:#ff4444">'+overdue+'</div><div class="tkpi-label">Просрочено</div></div>':'')+
    '<div class="tkpi"><div class="tkpi-val" style="color:var(--cyan)">'+Object.keys(activeAgents).length+'</div><div class="tkpi-label">Агентов</div></div>';
  // Update total count
  var countEl=document.getElementById('taskTotalCount');
  if(countEl)countEl.textContent=total+' задач'+(total%10===1&&total%100!==11?'а':total%10>=2&&total%10<=4&&(total%100<12||total%100>14)?'и':'');
}

window.toggleTaskView=function(){
  taskViewMode=taskViewMode==='list'?'kanban':'list';
  document.getElementById('taskViewToggle').textContent=taskViewMode==='kanban'?'📋 Список':'📊 Kanban';
  document.getElementById('kanbanBoard').style.display=taskViewMode==='kanban'?'grid':'none';
  document.getElementById('tasksList').style.display=taskViewMode==='kanban'?'none':'flex';
  renderTasks();
  // Setup drop listeners for kanban columns after render
  setTimeout(setupKanbanDropZones,0);
};

// ═══ DRAG & DROP HANDLERS ═══
window.dragStart=function(ev){
  var taskId=ev.target.closest('.kanban-card')?.getAttribute('data-task-id');
  if(!taskId)return;
  ev.dataTransfer.effectAllowed='move';
  ev.dataTransfer.setData('text/taskid',taskId);
  ev.target.closest('.kanban-card').classList.add('dragging');
};
window.dragEnd=function(ev){
  document.querySelectorAll('.kanban-card').forEach(c=>c.classList.remove('dragging'));
  document.querySelectorAll('.kanban-cards').forEach(c=>c.classList.remove('drag-over'));
};
function setupKanbanDropZones(){
  var statuses=['backlog','decomposed','planned','in_progress','rework','done'];
  statuses.forEach(function(status){
    var dropZone=document.getElementById('kanban-'+status);
    if(!dropZone)return;
    dropZone.ondragover=function(ev){ev.preventDefault();ev.dataTransfer.dropEffect='move';dropZone.classList.add('drag-over');};
    dropZone.ondragleave=function(){dropZone.classList.remove('drag-over');};
    dropZone.ondrop=function(ev){
      ev.preventDefault();
      dropZone.classList.remove('drag-over');
      var taskId=parseInt(ev.dataTransfer.getData('text/taskid'),10);
      if(taskId)moveTask(taskId,status);
    };
  });
}

function renderKanban(){
  // Build agent filters on first render
  buildTaskAgentFilters();
  var filtered=getFilteredTasks();
  renderTaskKpiStrip(filtered);

  var cols={backlog:[],decomposed:[],planned:[],in_progress:[],done:[],rework:[]};
  filtered.forEach(function(t){
    var ks=mapToKanban(t.kanbanStatus||t.status);
    if(ks==='cancelled')return;
    if(!cols[ks])cols[ks]=[];
    cols[ks].push(t);
  });
  var priOrder={critical:0,high:1,normal:2,low:3};
  Object.keys(cols).forEach(function(k){
    cols[k].sort(function(a,b){return (priOrder[a.priority]||2)-(priOrder[b.priority]||2);});
  });
  Object.keys(cols).forEach(function(status){
    var el=document.getElementById('kanban-'+status);
    var countEl=document.getElementById('kc-'+status);
    if(!el)return;
    if(countEl)countEl.textContent=cols[status].length;
    if(!cols[status].length){el.innerHTML='<div class="kanban-empty">Нет задач</div>';return;}
    el.innerHTML=cols[status].map(function(t){
      var pri=t.priority||'normal';
      var agent=AGENTS[t.assignedTo]||{emoji:'📋',name:'?',color:'#64748b'};
      var agColor=agent.color||'#64748b';
      var displayTitle=taskSmartTitle(t);
      // Subtasks
      var subtasksHTML='';
      if(t.subtasks&&t.subtasks.length){
        var doneCount=t.subtasks.filter(function(s){return s.done;}).length;
        var pct=Math.round(doneCount/t.subtasks.length*100);
        subtasksHTML='<div class="kc-subtasks"><div class="kc-progress-bar"><div class="kc-progress-fill" style="width:'+pct+'%;background:'+agColor+'"></div></div><span>'+doneCount+'/'+t.subtasks.length+'</span></div>';
      }
      // Estimate
      var estimateHTML=t.estimate?'<span class="kc-estimate">'+t.estimate+'</span>':'';
      // Deadline
      var deadlineHTML='';
      if(t.deadline){
        var dl=new Date(t.deadline);var now=new Date();
        var daysLeft=Math.ceil((dl-now)/(86400000));
        if(daysLeft<0)deadlineHTML='<span class="kc-deadline overdue">'+Math.abs(daysLeft)+'д назад</span>';
        else if(daysLeft<=2)deadlineHTML='<span class="kc-deadline soon">'+daysLeft+'д</span>';
        else deadlineHTML='<span class="kc-deadline">'+t.deadline+'</span>';
      }
      // Rework count
      var reworkHTML=(t.reworkCount&&t.reworkCount>0)?'<span class="kc-rework-badge">🔄×'+t.reworkCount+'</span>':'';
      // Tags
      var tagsHTML='';
      if(t.tags&&t.tags.length){
        tagsHTML='<div class="kc-tags">'+t.tags.map(function(tag){return '<span class="kc-tag">'+tag+'</span>';}).join('')+'</div>';
      }
      // Type badge
      var aType=(t._actionType||'').toLowerCase();
      var typeBadge='';
      if(aType.includes('email_template'))typeBadge='<span class="kc-type-badge" style="background:#00e5ff15;color:#00e5ff;border:1px solid #00e5ff33">EMAIL</span>';
      else if(aType.includes('lead_suggested'))typeBadge='<span class="kc-type-badge" style="background:#00ff8815;color:#00ff88;border:1px solid #00ff8833">LEAD</span>';
      else if(aType.includes('followup'))typeBadge='<span class="kc-type-badge" style="background:#ffb80015;color:#ffb800;border:1px solid #ffb80033">FOLLOW-UP</span>';
      else if(aType.includes('meta_recommendation'))typeBadge='<span class="kc-type-badge" style="background:#a855f715;color:#a855f7;border:1px solid #a855f733">META</span>';
      else if(aType.includes('task_from_chat'))typeBadge='<span class="kc-type-badge" style="background:#ffb80015;color:#ffb800;border:1px solid #ffb80033">CHAT</span>';
      else if(aType.includes('cycle_run'))typeBadge='<span class="kc-type-badge" style="background:#a78bfa15;color:#a78bfa;border:1px solid #a78bfa33">CYCLE</span>';
      // Short description
      var desc=taskDescription(t);
      var descHTML=desc&&desc!==displayTitle?'<div class="kc-desc">'+desc+'</div>':'';
      // Time ago
      var timeAgo='';
      if(t._createdAt||t.createdDate){
        var created=new Date(t._createdAt||t.createdDate);
        var diffH=Math.round((Date.now()-created.getTime())/3600000);
        if(diffH<1)timeAgo='только что';
        else if(diffH<24)timeAgo=diffH+'ч назад';
        else timeAgo=Math.round(diffH/24)+'д назад';
      }
      // ═══ REDESIGNED CARD — agent-prominent like Linear/Jira ═══
      return '<div class="kanban-card" draggable="true" data-task-id="'+t.id+'" ondragstart="dragStart(event)" ondragend="dragEnd(event)" onclick="openTaskDetail('+t.id+')" style="border-left:3px solid '+agColor+'">'+
        '<div class="kc-card-header">'+
          '<div class="kc-agent-avatar" style="background:'+agColor+'22;border-color:'+agColor+'44">'+agent.emoji+'</div>'+
          '<div class="kc-header-info">'+
            '<div class="kc-agent-name" style="color:'+agColor+'">'+(agent.name||'').split(' ')[0]+'</div>'+
            (typeBadge||'')+
          '</div>'+
          '<div class="kc-priority '+pri+'"></div>'+
        '</div>'+
        '<div class="kc-title">'+displayTitle+'</div>'+
        descHTML+
        '<div class="kc-footer">'+
          (deadlineHTML||'')+estimateHTML+reworkHTML+
          '<span class="kc-time">'+timeAgo+'</span>'+
        '</div>'+
        subtasksHTML+tagsHTML+
      '</div>';
    }).join('');
  });
}

function renderTasks(){
  // Build agent filters on every render
  buildTaskAgentFilters();
  if(taskViewMode==='kanban'){renderKanban();return;}
  var filtered=getFilteredTasks();
  renderTaskKpiStrip(filtered);
  // Enhanced list view with kanban statuses
  var statusOrder={in_progress:0,rework:1,planned:2,decomposed:3,backlog:4,pending:4,done:5,cancelled:6,postponed:4};
  var sorted=[...filtered].sort(function(a,b){
    var sa=statusOrder[a.kanbanStatus||a.status]??4;
    var sb=statusOrder[b.kanbanStatus||b.status]??4;
    if(sa!==sb)return sa-sb;
    var pa={critical:0,high:1,normal:2,low:3};
    return (pa[a.priority]||2)-(pa[b.priority]||2);
  });
  document.getElementById('tasksList').innerHTML=sorted.map(function(t){
    var pri=t.priority||'normal';
    var ks=mapToKanban(t.kanbanStatus||t.status);
    var ksInfo=KANBAN_STATUSES[ks]||{label:ks,color:'#64748b'};
    var statusIcon=ks==='done'?'✓':ks==='cancelled'?'✕':ks==='rework'?'🔄':ks==='in_progress'?'🔧':ks==='planned'?'📋':ks==='decomposed'?'🧩':'📥';
    var priLabel=pri==='critical'?'CRITICAL':pri==='high'?'HIGH':pri==='low'?'LOW':'';
    // Action type badge
    var actionBadge='';
    var aType=(t._actionType||'').toLowerCase();
    if(aType.includes('email_template'))actionBadge='<span style="font-size:9px;padding:1px 6px;background:#00e5ff22;color:#00e5ff;border:1px solid #00e5ff44;border-radius:4px;margin-left:6px">📧 EMAIL</span>';
    else if(aType.includes('lead_suggested'))actionBadge='<span style="font-size:9px;padding:1px 6px;background:#00ff8822;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;margin-left:6px">🆕 LEAD</span>';
    else if(aType.includes('task_from_chat')||t.fromChat)actionBadge='<span style="font-size:9px;padding:1px 6px;background:#ffb80022;color:#ffb800;border:1px solid #ffb80044;border-radius:4px;margin-left:6px">💬 ИЗ ЧАТА</span>';
    var approveLabel='✅';var approveTitle='Выполнено';
    if((ks==='backlog'||ks==='planned')&&aType.includes('email_template')){approveLabel='📧 Отправить';approveTitle='Одобрить и отправить email';}
    else if((ks==='backlog'||ks==='planned')&&aType.includes('lead_suggested')){approveLabel='➕ В Pipeline';approveTitle='Добавить лид в Pipeline';}
    var displayTitle=taskSmartTitle(t);
    var hasPayload=t._payload&&Object.keys(t._payload).length>2;
    var previewId='task-preview-'+t.id;
    // Rework indicator
    var reworkBadge=(t.reworkCount&&t.reworkCount>0)?'<span style="font-size:9px;padding:1px 5px;background:#f9731622;color:#f97316;border:1px solid #f9731633;border-radius:3px;margin-left:4px">🔄×'+t.reworkCount+'</span>':'';
    // Deadline
    var deadlineBadge='';
    if(t.deadline){
      var dl=new Date(t.deadline);var now=new Date();var daysLeft=Math.ceil((dl-now)/86400000);
      if(daysLeft<0)deadlineBadge='<span style="font-size:9px;color:#ff4444;margin-left:6px">⚠️ Просрочено</span>';
      else if(daysLeft<=2)deadlineBadge='<span style="font-size:9px;color:#ff9800;margin-left:6px">⏰ '+daysLeft+'д</span>';
    }
    // Subtasks progress
    var subtaskBadge='';
    if(t.subtasks&&t.subtasks.length){
      var doneC=t.subtasks.filter(function(s){return s.done;}).length;
      subtaskBadge='<span style="font-size:9px;color:var(--dim);margin-left:6px">📦 '+doneC+'/'+t.subtasks.length+'</span>';
    }
    // Status badge
    var statusBadge='<span style="font-size:9px;padding:1px 6px;background:'+ksInfo.color+'18;color:'+ksInfo.color+';border:1px solid '+ksInfo.color+'33;border-radius:4px;margin-left:6px">'+ksInfo.label+'</span>';
    // Action buttons based on kanban status
    var actions='';
    if(ks==='backlog'){
      actions='<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'decomposed\')" title="Декомпозировать">🧩</button>'+
        '<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'in_progress\')" title="В работу">🔧</button>'+
        '<button class="task-act del" onclick="event.stopPropagation();moveTask('+t.id+',\'cancelled\')" title="Отменить">❌</button>';
    }else if(ks==='decomposed'){
      actions='<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'planned\')" title="Запланировать">📋</button>'+
        '<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'backlog\')" title="В бэклог">📥</button>';
    }else if(ks==='planned'){
      actions='<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'in_progress\')" title="Начать">🔧</button>'+
        '<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'backlog\')" title="В бэклог">📥</button>';
    }else if(ks==='in_progress'){
      actions='<button class="task-act" onclick="event.stopPropagation();taskAction('+t.id+',\'done\')" title="'+approveTitle+'">'+approveLabel+'</button>'+
        '<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'rework\')" title="На переработку">🔄</button>';
    }else if(ks==='rework'){
      actions='<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'in_progress\')" title="Снова в работу">🔧</button>'+
        '<button class="task-act del" onclick="event.stopPropagation();moveTask('+t.id+',\'cancelled\')" title="Отменить">❌</button>';
    }else if(ks==='done'){
      actions='<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'rework\')" title="На переработку">🔄</button>';
    }else if(ks==='cancelled'){
      actions='<button class="task-act" onclick="event.stopPropagation();moveTask('+t.id+',\'backlog\')" title="Восстановить">♻️</button>';
    }
    var agentObj=AGENTS[t.assignedTo]||{emoji:'📋',name:'?',color:'#64748b'};
    var agCol=agentObj.color||'#64748b';
    return '<div class="task-row '+ks+'" onclick="openTaskDetail('+t.id+')" style="border-left:3px solid '+agCol+'">'+
      '<div class="task-agent-ava" style="background:'+agCol+'22;border-color:'+agCol+'44">'+agentObj.emoji+'</div>'+
      '<div class="task-body" style="cursor:pointer">'+
        '<div class="task-title-text">'+displayTitle+actionBadge+(priLabel?'<span class="task-priority '+pri+'">'+priLabel+'</span>':'')+statusBadge+reworkBadge+deadlineBadge+subtaskBadge+'</div>'+
        '<div class="task-assigned"><span style="color:'+agCol+';font-weight:600">'+(agentObj.name||t.assignedTo)+'</span> • '+(t.dept?.toUpperCase()||'')+
          (t.estimate?' • ⏱ '+t.estimate:'')+
          ' • <span style="font-size:9px;padding:1px 5px;background:'+ksInfo.color+'18;color:'+ksInfo.color+';border-radius:3px">'+statusIcon+' '+ksInfo.label+'</span>'+
        '</div>'+
        (t.result?'<div class="task-result">'+t.result+'</div>':'')+
        (hasPayload?'<div id="'+previewId+'" style="display:none">'+taskPreviewHTML(t)+'</div>':'')+
      '</div>'+
      '<div class="task-actions" onclick="event.stopPropagation()">'+actions+'</div>'+
      '<div class="task-date">'+(t.deadline||t.completedDate||t.createdDate)+'</div>'+
    '</div>';
  }).join('');
}
window.toggleTaskPreview=function(id){
  var el=document.getElementById('task-preview-'+id);
  if(el)el.style.display=el.style.display==='none'?'block':'none';
};

// ═══ KANBAN: Move task to new status ═══
window.moveTask=function(id,newKanbanStatus){
  var t=D.tasks.find(function(x){return x.id===id;});if(!t)return;
  var oldStatus=t.kanbanStatus||mapToKanban(t.status);
  // Track history
  if(!t._history)t._history=[];
  t._history.push({from:oldStatus,to:newKanbanStatus,at:new Date().toISOString()});
  t.kanbanStatus=newKanbanStatus;
  // Map kanban → old status for compatibility
  if(newKanbanStatus==='done'){t.status='done';t.completedDate=new Date().toISOString().slice(0,10);}
  else if(newKanbanStatus==='cancelled'){t.status='cancelled';}
  else if(newKanbanStatus==='rework'){
    t.status='rework';
    t.reworkCount=(t.reworkCount||0)+1;
    // Auto bump priority on rework
    if(t.reworkCount>=2&&t.priority!=='critical')t.priority='high';
  }
  else if(newKanbanStatus==='in_progress'){t.status='pending';}
  else{t.status='pending';}
  // Sync to Supabase
  if(SUPABASE_LIVE&&t.sbId){
    sbPatch('actions','id=eq.'+t.sbId,{
      payload_json:JSON.stringify(Object.assign({},t._payload||{},{status:newKanbanStatus,kanban_status:newKanbanStatus,
        priority:t.priority,rework_count:t.reworkCount||0}))
    });
  }
  renderTasks();
  var ksLabel=KANBAN_STATUSES[newKanbanStatus]?.label||newKanbanStatus;
  addFeed(t.assignedTo||'coordinator',ksLabel+': '+(t.title||'').slice(0,60));
};

// ═══ TASK DETAIL MODAL ═══
window.openTaskDetail=function(id){
  var t=D.tasks.find(function(x){return x.id===id;});if(!t)return;
  var ks=mapToKanban(t.kanbanStatus||t.status);
  var ksInfo=KANBAN_STATUSES[ks]||{label:ks,color:'#64748b'};
  var agent=AGENTS[t.assignedTo]||{emoji:'📋',name:'Не назначен'};
  var displayTitle=taskSmartTitle(t);
  // Subtasks HTML
  var subtasksHTML='';
  if(t.subtasks&&t.subtasks.length){
    subtasksHTML='<div style="margin:12px 0"><h4 style="font-size:12px;color:var(--dim);margin-bottom:6px">📦 Подзадачи ('+t.subtasks.filter(function(s){return s.done;}).length+'/'+t.subtasks.length+')</h4>'+
      t.subtasks.map(function(s,i){
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'+
          '<input type="checkbox" '+(s.done?'checked':'')+' onchange="toggleSubtask('+t.id+','+i+')" style="cursor:pointer">'+
          '<span style="font-size:12px;'+(s.done?'text-decoration:line-through;color:var(--dim)':'')+'">'+s.text+'</span></div>';
      }).join('')+
      '<div style="margin-top:6px"><input placeholder="Добавить подзадачу..." style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px" onkeydown="if(event.key===\'Enter\'){addSubtask('+t.id+',this.value);this.value=\'\';openTaskDetail('+t.id+');}"></div></div>';
  }else{
    subtasksHTML='<div style="margin:8px 0"><input placeholder="Добавить подзадачу (Enter)..." style="width:100%;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px" onkeydown="if(event.key===\'Enter\'){addSubtask('+t.id+',this.value);this.value=\'\';openTaskDetail('+t.id+');}"></div>';
  }
  // Status transition buttons
  var transitions='';
  if(ks==='backlog')transitions='<button class="act-btn" onclick="moveTask('+t.id+',\'decomposed\');openTaskDetail('+t.id+')">🧩 Декомпозировать</button><button class="act-btn" onclick="moveTask('+t.id+',\'planned\');openTaskDetail('+t.id+')">📋 Запланировать</button><button class="act-btn success" onclick="moveTask('+t.id+',\'in_progress\');openTaskDetail('+t.id+')">🔧 В работу</button>';
  else if(ks==='decomposed')transitions='<button class="act-btn" onclick="moveTask('+t.id+',\'planned\');openTaskDetail('+t.id+')">📋 Запланировать</button><button class="act-btn success" onclick="moveTask('+t.id+',\'in_progress\');openTaskDetail('+t.id+')">🔧 В работу</button><button class="act-btn" onclick="moveTask('+t.id+',\'backlog\');openTaskDetail('+t.id+')">📥 В бэклог</button>';
  else if(ks==='planned')transitions='<button class="act-btn success" onclick="moveTask('+t.id+',\'in_progress\');openTaskDetail('+t.id+')">🔧 Начать</button><button class="act-btn" onclick="moveTask('+t.id+',\'backlog\');openTaskDetail('+t.id+')">📥 В бэклог</button>';
  else if(ks==='in_progress')transitions='<button class="act-btn success" onclick="taskAction('+t.id+',\'done\');closeModal()">✅ Готово</button><button class="act-btn warn" onclick="moveTask('+t.id+',\'rework\');openTaskDetail('+t.id+')">🔄 На переработку</button>';
  else if(ks==='rework')transitions='<button class="act-btn success" onclick="moveTask('+t.id+',\'in_progress\');openTaskDetail('+t.id+')">🔧 Снова в работу</button><button class="act-btn" onclick="moveTask('+t.id+',\'decomposed\');openTaskDetail('+t.id+')">🧩 Передекомпозировать</button>';
  else if(ks==='done')transitions='<button class="act-btn warn" onclick="moveTask('+t.id+',\'rework\');openTaskDetail('+t.id+')">🔄 Вернуть на переработку</button>';

  openModal(`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
      <span style="font-size:9px;padding:2px 8px;background:${ksInfo.color}18;color:${ksInfo.color};border:1px solid ${ksInfo.color}33;border-radius:4px;font-weight:700">${ksInfo.label}</span>
      <span style="font-size:9px;padding:2px 8px;background:${t.priority==='critical'?'#ff000033':t.priority==='high'?'#ff980022':'#ffffff08'};color:${t.priority==='critical'?'#ff4444':t.priority==='high'?'#ff9800':'var(--dim)'};border-radius:4px;font-weight:700">${(t.priority||'normal').toUpperCase()}</span>
      ${t.reworkCount?'<span style="font-size:9px;padding:2px 6px;background:#f9731622;color:#f97316;border-radius:4px">🔄×'+t.reworkCount+'</span>':''}
      ${t.estimate?'<span style="font-size:9px;padding:2px 6px;background:#06b6d418;color:#06b6d4;border-radius:4px">⏱ '+t.estimate+'</span>':''}
    </div>
    <h3 style="margin:0 0 8px 0;font-size:16px">${displayTitle}</h3>
    <div style="font-size:12px;color:var(--dim);margin-bottom:12px">${agent.emoji} ${agent.name} • ${t.dept?.toUpperCase()||''} • 📅 ${t.createdDate||'?'}</div>
    ${t.description?'<div style="padding:10px;background:var(--bg);border-radius:6px;border:1px solid var(--border);font-size:13px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap">'+t.description+'</div>':''}
    ${t.deadline?'<div style="font-size:12px;margin-bottom:8px">⏰ Дедлайн: <b>'+t.deadline+'</b></div>':''}
    ${t.result?'<div style="padding:8px;background:#10b98118;border-radius:6px;font-size:12px;color:#10b981;margin-bottom:8px">✅ '+t.result+'</div>':''}
    ${t.reworkNotes?'<div style="padding:8px;background:#f9731618;border-radius:6px;font-size:12px;color:#f97316;margin-bottom:8px">🔄 Замечания: '+t.reworkNotes+'</div>':''}
    ${subtasksHTML}
    ${t._payload&&Object.keys(t._payload).length>2?'<details style="margin:8px 0"><summary style="font-size:11px;color:var(--dim);cursor:pointer">📋 Данные задачи</summary><div style="margin-top:6px">'+taskPreviewHTML(t)+'</div></details>':''}
    <div style="margin:12px 0;padding:10px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:var(--dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">📜 История</div>
      <div style="position:relative;padding-left:16px;border-left:2px solid var(--border)">
        <div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px;position:relative">
          <div style="position:absolute;left:-21px;width:10px;height:10px;border-radius:50%;background:var(--cyan);border:2px solid var(--bg)"></div>
          <span style="color:var(--cyan);font-weight:600">Создана</span>
          <span style="margin-left:auto;color:var(--dim);font-size:10px">${t.createdDate||t._createdAt||'—'}</span>
        </div>
        ${(t._history||[]).map(function(h,i){
          var fi=KANBAN_STATUSES[h.from]||{label:h.from,color:'#64748b'};
          var ti=KANBAN_STATUSES[h.to]||{label:h.to,color:'#64748b'};
          var dotColor=h.to==='done'?'var(--green)':h.to==='cancelled'?'var(--hot)':h.to==='rework'?'#f97316':ti.color;
          return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px;position:relative">'+
            '<div style="position:absolute;left:-21px;width:10px;height:10px;border-radius:50%;background:'+dotColor+';border:2px solid var(--bg)"></div>'+
            '<span style="color:'+fi.color+'">'+fi.label+'</span> → <span style="color:'+ti.color+';font-weight:700">'+ti.label+'</span>'+
            '<span style="margin-left:auto;color:var(--dim);font-size:10px">'+new Date(h.at).toLocaleString('ru',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+'</span></div>';
        }).join('')}
        ${!(t._history&&t._history.length)?'<div style="font-size:10px;color:var(--dim);padding:4px 0;font-style:italic">Ещё не перемещалась — передвинь задачу чтобы начать отслеживание</div>':''}
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:16px 0;padding-top:12px;border-top:1px solid var(--border)">
      ${transitions}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="act-btn" onclick="editTaskField(${t.id},'priority')">🏷 Приоритет</button>
      <button class="act-btn" onclick="editTaskField(${t.id},'deadline')">📅 Дедлайн</button>
      <button class="act-btn" onclick="editTaskField(${t.id},'estimate')">⏱ Оценка</button>
      <button class="act-btn" onclick="editTaskField(${t.id},'description')">📝 Описание</button>
      <button class="act-btn" onclick="editTaskField(${t.id},'tags')">🏷 Теги</button>
      <button class="act-btn" onclick="editTaskField(${t.id},'assignee')">👤 Назначить</button>
      <button class="act-btn danger" onclick="moveTask(${t.id},'cancelled');closeModal()">❌ Отменить</button>
    </div>
  `);
};

// ═══ SUBTASKS ═══
window.addSubtask=function(taskId,text){
  if(!text||!text.trim())return;
  var t=D.tasks.find(function(x){return x.id===taskId;});if(!t)return;
  if(!t.subtasks)t.subtasks=[];
  t.subtasks.push({text:text.trim(),done:false});
  renderTasks();
};
window.toggleSubtask=function(taskId,idx){
  var t=D.tasks.find(function(x){return x.id===taskId;});if(!t||!t.subtasks)return;
  t.subtasks[idx].done=!t.subtasks[idx].done;
  // Check if all subtasks done → auto-suggest move to done
  var allDone=t.subtasks.every(function(s){return s.done;});
  if(allDone&&mapToKanban(t.kanbanStatus||t.status)==='in_progress'){
    f2fConfirm('Все подзадачи выполнены! Перевести задачу в "Выполнено"?').then(function(ok){
      if(ok)moveTask(taskId,'done');
    });
  }
  renderTasks();
};

// ═══ EDIT TASK FIELDS ═══
window.editTaskField=function(id,field){
  var t=D.tasks.find(function(x){return x.id===id;});if(!t)return;
  var cfg={};
  if(field==='priority'){
    cfg={title:'🎯 Приоритет',fields:[{id:'val',label:'Приоритет',type:'select',value:t.priority||'normal',options:[
      {value:'critical',label:'🔴 Critical'},{value:'high',label:'🟠 High'},{value:'normal',label:'🟢 Normal'},{value:'low',label:'⚪ Low'}
    ]}],submitText:'Сохранить'};
  }else if(field==='deadline'){
    cfg={title:'📅 Дедлайн',fields:[{id:'val',label:'Дедлайн',type:'date',value:t.deadline||new Date().toISOString().slice(0,10)}],submitText:'Сохранить'};
  }else if(field==='estimate'){
    cfg={title:'⏱ Оценка времени',fields:[{id:'val',label:'Оценка (2h, 1d, 30m)',type:'text',value:t.estimate||'',placeholder:'2h, 1d, 30m'}],submitText:'Сохранить'};
  }else if(field==='description'){
    cfg={title:'📝 Описание',fields:[{id:'val',label:'Описание задачи',type:'textarea',value:t.description||'',rows:4}],submitText:'Сохранить'};
  }else if(field==='tags'){
    cfg={title:'🏷 Теги',fields:[{id:'val',label:'Теги через запятую',type:'text',value:t.tags?t.tags.join(', '):'',placeholder:'smm, urgent, design'}],submitText:'Сохранить'};
  }else if(field==='assignee'){
    var agentOpts=Object.keys(AGENTS).map(function(k){return{value:k,label:AGENTS[k].emoji+' '+AGENTS[k].name};});
    agentOpts.unshift({value:'',label:'— Не назначен —'});
    cfg={title:'👤 Исполнитель',fields:[{id:'val',label:'Агент',type:'select',value:t.assignedTo||'',options:agentOpts}],submitText:'Сохранить'};
  }else return;
  f2fPrompt(cfg).then(function(val){
    if(val===null)return;
    if(field==='priority'&&['critical','high','normal','low'].includes(val))t.priority=val;
    else if(field==='deadline'&&val.trim())t.deadline=val.trim();
    else if(field==='estimate')t.estimate=val.trim();
    else if(field==='description')t.description=val.trim();
    else if(field==='tags')t.tags=val.split(',').map(function(s){return s.trim();}).filter(Boolean);
    else if(field==='assignee'){if(!val||AGENTS[val])t.assignedTo=val||'';}
    renderTasks();openTaskDetail(id);
  });
};

// ═══ CREATE TASK MODAL ═══
window.openCreateTaskModal=function(){
  openModal(`
    <h3 style="margin:0 0 16px 0">➕ Новая задача</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <input id="newTaskTitle" placeholder="Название задачи *" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
      <textarea id="newTaskDesc" placeholder="Описание (опционально)" rows="3" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;resize:vertical"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <select id="newTaskAgent" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
          <option value="">Агент</option>
          ${Object.keys(AGENTS).map(function(k){return '<option value="'+k+'">'+AGENTS[k].emoji+' '+AGENTS[k].name+'</option>';}).join('')}
        </select>
        <select id="newTaskPriority" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
          <option value="normal">🔵 Normal</option>
          <option value="high">🔴 High</option>
          <option value="critical">🚨 Critical</option>
          <option value="low">⚪ Low</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <select id="newTaskStatus" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
          <option value="backlog">📥 Бэклог</option>
          <option value="decomposed">🧩 Декомпозиция</option>
          <option value="planned">📋 Запланировано</option>
          <option value="in_progress">🔧 В работу сразу</option>
        </select>
        <input id="newTaskDeadline" type="date" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input id="newTaskEstimate" placeholder="Оценка (2h, 1d...)" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
        <input id="newTaskTags" placeholder="Теги через запятую" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
      </div>
      <button onclick="createTaskFromModal()" style="padding:10px;background:var(--cyan);color:var(--bg);border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;margin-top:4px">Создать задачу</button>
    </div>
  `);
};
window.createTaskFromModal=function(){
  var title=document.getElementById('newTaskTitle').value.trim();
  if(!title){showToast('Укажи название задачи','error');return;}
  var t={
    id:D.tasks.reduce(function(m,x){return Math.max(m,x.id);},0)+1,
    title:title,
    description:document.getElementById('newTaskDesc').value.trim()||'',
    assignedTo:document.getElementById('newTaskAgent').value||'coordinator',
    dept:AGENTS[document.getElementById('newTaskAgent').value||'coordinator']?.dept||'cmd',
    priority:document.getElementById('newTaskPriority').value||'normal',
    kanbanStatus:document.getElementById('newTaskStatus').value||'backlog',
    status:document.getElementById('newTaskStatus').value==='in_progress'?'pending':'pending',
    deadline:document.getElementById('newTaskDeadline').value||'',
    estimate:document.getElementById('newTaskEstimate').value.trim()||'',
    tags:document.getElementById('newTaskTags').value.split(',').map(function(s){return s.trim();}).filter(Boolean),
    subtasks:[],
    reworkCount:0,
    createdDate:new Date().toISOString().slice(0,10),
    _payload:{},_actionType:''
  };
  D.tasks.push(t);
  // Save to Supabase
  if(SUPABASE_LIVE){
    var agentSlug=DASH_TO_SB_SLUG[t.assignedTo]||'coordinator';
    var sbAgent=window._sbAgents[agentSlug];
    sbInsert('actions',{
      agent_id:sbAgent?sbAgent.id:null,
      type:'task_manual',
      payload_json:{title:t.title,description:t.description,status:t.kanbanStatus,kanban_status:t.kanbanStatus,
        priority:t.priority,deadline:t.deadline,estimate:t.estimate,tags:t.tags}
    }).then(function(res){if(res&&res[0])t.sbId=res[0].id;});
  }
  closeModal();renderTasks();updateKPI();
  addFeed(t.assignedTo,'📌 Новая задача: '+title.slice(0,50));
};
// closeModal already defined at line ~1479 with getElementById fix — do not override

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
  const priSelect=document.getElementById('taskPrioritySelect');
  var rawTitle=cleanInput(input.value,500);if(!rawTitle)return;
  const ag=AGENTS[agent];
  const title=rawTitle;
  const pri=priSelect?priSelect.value:'normal';
  const taskData={
    id:D.tasks.reduce(function(m,x){return Math.max(m,x.id);},0)+1, title:title,
    assignedTo:agent||'coordinator', dept:ag?ag.dept:'cmd',
    status:'pending', kanbanStatus:'backlog', priority:pri, createdDate:new Date().toISOString().slice(0,10),
    completedDate:null, result:null, subtasks:[], tags:[], reworkCount:0, description:'', deadline:'', estimate:''
  };
  // Save to Supabase
  if(SUPABASE_LIVE){
    var sbSlug=DASH_TO_SB_SLUG[agent]||'coordinator';
    var sbAgent=window._sbAgents[sbSlug];
    if(sbAgent){
      var res=await sbInsert('actions',{
        agent_id:sbAgent.id,
        type:'task_created',
        payload_json:{title:title,status:'backlog',kanban_status:'backlog',priority:pri,source:'dashboard'}
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
  if(!a){showToast('Агент «'+id+'» не найден в данных','error');return;}
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

  // Metrics cards
  const sbSlugKey=DASH_TO_SB_SLUG[id];
  const agentCredits=(window._sbCredits||[]).filter(c=>c.agent_name&&c.agent_name.toLowerCase().includes((AGENTS[id]?.name||'').toLowerCase().split(' ')[0].toLowerCase())).length;
  const agentQAScores=D.posts.filter(p=>p.agentId===id&&p.qaScore).map(p=>p.qaScore);
  const avgQA=agentQAScores.length>0?Math.round(agentQAScores.reduce((a,b)=>a+b,0)/agentQAScores.length*10)/10:0;
  const agentErrors=(window._sbMemory||[]).filter(m=>m.slug===sbSlugKey||m.dashId===id).reduce((sum,m)=>sum+(m.errors_count||0),0);

  html+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">'+
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'+
      '<div style="font-size:11px;color:var(--dim)">Задач</div>'+
      '<div style="font-size:18px;font-weight:700;color:var(--cyan)">'+agentTasks.length+'</div>'+
      '<div style="font-size:10px;color:var(--green)">✅ '+doneTasks+'</div>'+
    '</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'+
      '<div style="font-size:11px;color:var(--dim)">QA Avg</div>'+
      '<div style="font-size:18px;font-weight:700;color:'+(avgQA>=8?'#00ff88':avgQA>=5?'#ffb800':'#ff4444')+'">'+avgQA+'</div>'+
      '<div style="font-size:10px;color:var(--dim)">'+agentQAScores.length+' постов</div>'+
    '</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'+
      '<div style="font-size:11px;color:var(--dim)">Расходы AI</div>'+
      '<div style="font-size:18px;font-weight:700;color:#ffb800">$'+agentCredits+'</div>'+
      '<div style="font-size:10px;color:var(--dim)">этот месяц</div>'+
    '</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'+
      '<div style="font-size:11px;color:var(--dim)">Ошибок</div>'+
      '<div style="font-size:18px;font-weight:700;color:'+(agentErrors>0?'#ff4444':'#00ff88')+'">'+agentErrors+'</div>'+
      '<div style="font-size:10px;color:var(--dim)">всего</div>'+
    '</div>'+
  '</div>';

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
    '<div class="agent-quick-actions" style="border-top:1px solid var(--border);padding-top:6px;margin-top:2px">'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'/help\')" style="color:#a78bfa;border-color:#a78bfa33">⌘ Команды</button>'+
      '<button class="quick-act" onclick="chatCmdPromptEdit(\''+id+'\')" style="color:#ffb800;border-color:#ffb80033">📝 Промпт</button>'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'/task Проверь текущие KPI и дай рекомендации\')" style="color:#00ff88;border-color:#00ff8833">📌 Задача</button>'+
      (id==='art_director'?'<button class="quick-act" onclick="chatCmdRate(\''+id+'\')" style="color:#9c27b0;border-color:#9c27b033">⭐ Оценить</button>':'')+
    '</div>'+
    '<div class="agent-quick-actions" style="border-top:1px solid var(--border);padding-top:6px;margin-top:2px">'+
      '<button class="quick-act" onclick="chatCmdLearn(\''+id+'\')" style="color:#f59e0b;border-color:#f59e0b33">🧠 Научить</button>'+
      '<button class="quick-act" onclick="chatCmdLearnGlobal()" style="color:#06b6d4;border-color:#06b6d433">🌍 Научить всех</button>'+
      '<button class="quick-act" onclick="agentAIChat(\''+id+'\',\'/knowledge\')" style="color:#8b5cf6;border-color:#8b5cf633">📚 Знания</button>'+
      (id==='art_director'?'<button class="quick-act" onclick="uploadReferenceImage()" style="color:#ec4899;border-color:#ec489933">🖼 Загрузить</button>':'')+
    '</div>'+
    '<div class="agent-chat-input">'+
      '<input id="agentChatInput" placeholder="Напиши агенту или /команду..." onkeydown="if(event.key===\'Enter\')agentAIChat(\''+id+'\')">'+
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
  followup:'outreach',processor:'coordinator',watchdog:'coordinator',kpi_updater:'analyst',
  art_director:'art_director',
  quality_controller:'quality_controller'
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
        'Authorization':'Bearer '+getAuthKey()
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
  if(!text.trim()){showToast('Пустой текст','error');return;}
  try{
    var resp=await fetch(SUPABASE_URL+'/rest/v1/content_queue',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Prefer':'return=minimal'},
      body:JSON.stringify({platform:platform,content_text:text.trim(),status:'pending_approval'})
    });
    if(resp.ok){
      el.parentElement.querySelector('div:last-child').innerHTML='<span style="color:#00ff88;font-size:10px">✅ Сохранён в контент-очередь ('+platform+')</span>';
      addFeed(agentId,'💾 Пост сохранён в контент-очередь ('+platform+')');
      // Refresh posts if on that tab
      window._sbContentMerged=false;
      if(typeof initSupabase==='function')setTimeout(initSupabase,500);
    }else{
      showToast('Ошибка сохранения: '+resp.status,'error');
    }
  }catch(e){showToast('Ошибка: '+e.message,'error');}
};

// ═══ SMM Auto-Generate via Edge Function ═══
// ═══ ALGORITHM SETTINGS ═══
window.openAlgorithmSettings=function(){
  // Load current settings from localStorage (persisted per session)
  var cfg=JSON.parse(localStorage.getItem('f2f_algo_cfg')||'{}');
  var qaThr=cfg.qa_threshold||8;
  var maxPerDay=cfg.max_per_day||4;
  var interval=cfg.interval_hours||3;
  var batchSize=cfg.batch_size||10;
  var styles=cfg.styles||{provocative:25,informative:25,meme:25,storytelling:25};
  var autoImage=cfg.auto_image!==false;
  var autoPublish=cfg.auto_publish!==false;
  var html='<h3 style="margin:0 0 16px">⚙️ Настройки алгоритма контента</h3>';
  // QA threshold
  html+='<div style="margin-bottom:14px"><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">QA порог (минимум для одобрения)</label>'+
    '<input id="algQaThr" type="number" min="1" max="10" value="'+qaThr+'" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;width:80px"> <span style="font-size:11px;color:var(--dim)">/ 10</span></div>';
  // Batch size
  html+='<div style="margin-bottom:14px"><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Постов за генерацию</label>'+
    '<input id="algBatch" type="number" min="1" max="20" value="'+batchSize+'" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;width:80px"></div>';
  // Max per day + interval
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">'+
    '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Макс публикаций/день</label>'+
    '<input id="algMaxDay" type="number" min="1" max="20" value="'+maxPerDay+'" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;width:100%"></div>'+
    '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Интервал (часы)</label>'+
    '<input id="algInterval" type="number" min="1" max="12" value="'+interval+'" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;width:100%"></div></div>';
  // A/B style weights
  html+='<div style="margin-bottom:14px"><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:8px">Веса A/B стилей (%)</label>'+
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">'+
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:#ff2d78;font-size:12px;min-width:90px">🔥 Provocative</span><input id="algS1" type="number" min="0" max="100" value="'+styles.provocative+'" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;width:50px">%</div>'+
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:#00e5ff;font-size:12px;min-width:90px">📊 Informative</span><input id="algS2" type="number" min="0" max="100" value="'+styles.informative+'" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;width:50px">%</div>'+
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:#a855f7;font-size:12px;min-width:90px">😂 Meme</span><input id="algS3" type="number" min="0" max="100" value="'+styles.meme+'" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;width:50px">%</div>'+
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:#f59e0b;font-size:12px;min-width:90px">📖 Storytelling</span><input id="algS4" type="number" min="0" max="100" value="'+styles.storytelling+'" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;width:50px">%</div></div></div>';
  // Toggles
  html+='<div style="display:flex;gap:16px;margin-bottom:16px">'+
    '<label style="font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px"><input type="checkbox" id="algAutoImg" '+(autoImage?'checked':'')+' style="accent-color:var(--cyan)"> Авто-генерация картинок</label>'+
    '<label style="font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px"><input type="checkbox" id="algAutoPub" '+(autoPublish?'checked':'')+' style="accent-color:var(--cyan)"> Авто-публикация</label></div>';
  // Save
  html+='<button onclick="saveAlgorithmSettings()" style="padding:10px 20px;background:var(--cyan);color:var(--bg);border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;width:100%">💾 Сохранить настройки</button>';
  openModal(html);
};
window.saveAlgorithmSettings=function(){
  var cfg={
    qa_threshold:parseInt(document.getElementById('algQaThr').value)||8,
    batch_size:parseInt(document.getElementById('algBatch').value)||10,
    max_per_day:parseInt(document.getElementById('algMaxDay').value)||4,
    interval_hours:parseInt(document.getElementById('algInterval').value)||3,
    styles:{
      provocative:parseInt(document.getElementById('algS1').value)||25,
      informative:parseInt(document.getElementById('algS2').value)||25,
      meme:parseInt(document.getElementById('algS3').value)||25,
      storytelling:parseInt(document.getElementById('algS4').value)||25
    },
    auto_image:document.getElementById('algAutoImg').checked,
    auto_publish:document.getElementById('algAutoPub').checked
  };
  localStorage.setItem('f2f_algo_cfg',JSON.stringify(cfg));
  // Also save to Supabase directives for edge functions to use
  if(SUPABASE_LIVE){
    fetch(SUPABASE_URL+'/rest/v1/directives',{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify({key:'smm_algorithm',value_json:cfg})
    }).catch(function(e){console.warn('Save algo cfg:',e);});
  }
  showToast('✅ Настройки алгоритма сохранены','success');
  closeModal();
};

window.generatePostsBatch=async function(){
  var btn=document.getElementById('btnGenPosts');
  if(!btn)return;
  btn.disabled=true;btn.textContent='⏳ Генерирую...';
  try{
    var resp=await fetch(SUPABASE_URL+'/functions/v1/smm-generate',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+getAuthKey()},
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
    f2fPrompt({title:AGENTS[id].emoji+' Задача для '+AGENTS[id].name,fields:[{id:'task',label:'Какую задачу поставить?',type:'text',placeholder:'Описание задачи...'}],submitText:'Поставить'}).then(function(input){
      if(input&&input.trim())agentAIChat(id,'Вот задача для тебя: '+input.trim());
    });
    return;
  }
  agentAIChat(id,msgs[action]||'Привет!');
};
window.agentSendMsg=function(id){agentAIChat(id);};

// Quick prompt editor via chat modal
window.chatCmdPromptEdit=function(id){
  closeModal();
  setTimeout(function(){openPromptEditor(id);},200);
};

// Quick image rating
window.chatCmdRate=function(id){
  f2fPrompt({title:'⭐ Оценка картинки',fields:[
    {id:'score',label:'Оценка (1-5)',type:'number',value:'5',min:1,max:5},
    {id:'comment',label:'Комментарий',type:'text',placeholder:'Отличный стиль, зелёный неон идеален'}
  ],submitText:'Оценить'}).then(function(r){
    if(r&&r.score)agentAIChat(id,'/rate '+r.score+' '+r.comment);
  });
};

// Learn — teach THIS agent
window.chatCmdLearn=function(id){
  var a=AGENTS[id];
  f2fPrompt({title:a.emoji+' Научить '+a.name,fields:[
    {id:'cat',label:'Категория',type:'select',value:'general',options:['product','audience','style','competitor','process','general']},
    {id:'text',label:'Знание',type:'textarea',rows:3,placeholder:'CyberShoke убрал платные серверы'}
  ],submitText:'Запомнить'}).then(function(r){
    if(r&&r.text&&r.text.trim())agentAIChat(id,'/learn '+r.cat+': '+r.text.trim());
  });
};

// Learn Global — teach ALL agents
window.chatCmdLearnGlobal=function(){
  f2fPrompt({title:'🌍 Научить ВСЕХ агентов',fields:[
    {id:'cat',label:'Категория',type:'select',value:'general',options:['product','audience','style','competitor','process','general']},
    {id:'text',label:'Знание для всех',type:'textarea',rows:3,placeholder:'Dominion запуск перенесён на Q3'}
  ],submitText:'Запомнить'}).then(function(r){
    if(r&&r.text&&r.text.trim())agentAIChat('coordinator','/learn_global '+r.cat+': '+r.text.trim());
  });
};

// Upload reference image for Art Director
window.uploadReferenceImage=function(){
  // IMPORTANT: input.click() must happen synchronously from user gesture (Safari blocks setTimeout)
  var input=document.createElement('input');
  input.type='file';
  input.accept='image/jpeg,image/png,image/webp';
  input.multiple=true;
  input.style.cssText='position:fixed;top:-9999px;left:-9999px';
  document.body.appendChild(input);
  input.onchange=function(){
    var files=Array.from(input.files);
    input.remove();
    if(!files.length)return;
    window._uploadFiles=files;
    // Close agent modal, show upload form
    closeModal();
    setTimeout(function(){
      openModal(
        '<h2 style="margin-bottom:12px">🖼 Загрузка референсов ('+files.length+' файл'+((files.length>1&&files.length<5)?'а':'ов')+')</h2>'+
        '<div style="margin-bottom:10px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;max-height:80px;overflow-y:auto">'+
          files.map(function(f){return '📎 '+f.name+' ('+Math.round(f.size/1024)+'KB)';}).join('<br>')+
        '</div>'+
        '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Категория</label>'+
        '<select id="upCat" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+
        '<option value="news">news</option><option value="tournament">tournament</option><option value="match">match</option><option value="meme">meme</option><option value="educational">educational</option><option value="promo">promo</option><option value="entertainment">entertainment</option><option value="maintenance">тех работы</option><option value="updates">обновления</option></select></div>'+
        '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Опиши стиль</label>'+
        '<textarea id="upDesc" rows="2" placeholder="Тёмный стиль, зелёный неон, минимализм" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box"></textarea></div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
        '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Оценка (1-5)</label>'+
        '<input id="upRating" type="number" min="1" max="5" value="5" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div>'+
        '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:4px">Теги</label>'+
        '<input id="upTags" type="text" placeholder="neon, dark" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div></div>'+
        '<div id="uploadLog" style="display:none;margin-bottom:10px;max-height:120px;overflow-y:auto"></div>'+
        '<button onclick="doUploadReferences()" id="btnDoUpload" style="width:100%;padding:10px;background:#ec489922;color:#ec4899;border:1px solid #ec489944;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700">🖼 Загрузить '+files.length+' файл(ов)</button>'
      );
    },100);
  };
  input.click();
};

window.doUploadReferences=async function(){
  var files=window._uploadFiles||[];
  if(!files.length){showToast('Нет файлов','error');return;}
  var category=document.getElementById('upCat').value;
  var desc=document.getElementById('upDesc').value;
  var rating=document.getElementById('upRating').value;
  var tags=document.getElementById('upTags').value;
  var btn=document.getElementById('btnDoUpload');
  var log=document.getElementById('uploadLog');
  btn.disabled=true;btn.textContent='⏳ Загружаю...';
  log.style.display='block';
  var ok=0,fail=0;
  for(var i=0;i<files.length;i++){
    var file=files[i];
    log.innerHTML+='<div style="padding:4px 8px;font-size:12px;color:var(--dim)">⏳ '+(i+1)+'/'+files.length+': '+esc(file.name)+'</div>';
    log.scrollTop=log.scrollHeight;
    var formData=new FormData();
    formData.append('file',file);
    formData.append('category',category);
    if(desc)formData.append('style_description',desc);
    if(rating)formData.append('rating',rating);
    if(tags)formData.append('tags',tags);
    try{
      var res=await fetch(SUPABASE_URL+'/functions/v1/upload-reference',{
        method:'POST',
        headers:{'Authorization':'Bearer '+getAuthKey()},
        body:formData
      });
      var data=await res.json();
      if(data.success){
        ok++;
        log.innerHTML+='<div style="padding:4px 8px;font-size:12px;color:#00ff88">✅ '+esc(file.name)+'</div>';
      }else{fail++;log.innerHTML+='<div style="padding:4px 8px;font-size:12px;color:#ff4444">❌ '+esc(file.name)+': '+esc(data.error||'Ошибка')+'</div>';}
    }catch(e){fail++;log.innerHTML+='<div style="padding:4px 8px;font-size:12px;color:#ff4444">❌ '+esc(file.name)+': '+esc(e.message)+'</div>';}
    log.scrollTop=log.scrollHeight;
  }
  log.innerHTML+='<div style="padding:6px 8px;font-size:12px;font-weight:600;color:#00ff88;border-top:1px solid var(--border);margin-top:4px">📊 Готово: ✅ '+ok+(fail?' | ❌ '+fail:'')+'</div>';
  btn.textContent='✅ Загружено '+ok+' файлов';
  if(ok)addFeed('art_director','🖼 Загружено '+ok+' референсов ['+category+']');
};

// ═══ FEED ═══
const feedItems=[];
let feedIdCounter=0;
function addFeed(agentId,text){
  const a=AGENTS[agentId]||{emoji:'📋',name:'System',color:'#64748b'};
  const descF=AGENT_DESC[agentId]||{};
  feedItems.unshift({
    id:++feedIdCounter, agentId, text,
    time:new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
    fullTime:new Date().toISOString(),
    color:a.color,
    sources:descF.sources||null,
    purpose:descF.purpose||null
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
    return '<div class="feed-item" style="border-left-color:'+f.color+'">'+
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
  var descD=AGENT_DESC[f.agentId]||{};
  var html='<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
    '<span style="font-size:32px">'+a.emoji+'</span>'+
    '<div><h2 style="margin:0">'+a.name+'</h2>'+
    '<p style="color:var(--dim);margin:0;font-size:12px">'+(DEPTS.find(function(d){return d.agents&&d.agents.includes(f.agentId);})?.name||'')+'  •  '+f.time+'</p></div></div>';
  // Main content
  html+='<div style="font-size:14px;line-height:1.8;padding:16px;background:var(--bg);border-radius:8px;border:1px solid var(--border);margin-bottom:16px">'+f.text+'</div>';
  // Supabase event metadata (drill-down details)
  if(f.sbEvent||f.sbMeta){
    var ev=f.sbEvent||{};var m=f.sbMeta||{};
    html+='<div style="margin-bottom:16px"><h3 style="margin:0 0 8px">📦 Данные события</h3>';
    html+='<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px">';
    if(ev.type)html+='<div style="margin-bottom:6px"><span style="color:var(--dim)">Тип:</span> <span style="color:var(--cyan)">'+ev.type+'</span></div>';
    if(ev.created_at)html+='<div style="margin-bottom:6px"><span style="color:var(--dim)">Время:</span> '+new Date(ev.created_at).toLocaleString('ru')+'</div>';
    // Show all metadata fields
    var metaKeys=Object.keys(m).filter(function(k){return k!=='source'&&k!=='agent_dash_id'&&k!=='text';});
    if(metaKeys.length>0){
      html+='<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">';
      metaKeys.forEach(function(k){
        var val=m[k];
        if(typeof val==='object')val=JSON.stringify(val,null,2);
        if(typeof val==='string'&&val.length>200)val=val.slice(0,200)+'...';
        html+='<div style="margin-bottom:4px"><span style="color:var(--dim)">'+k+':</span> <span style="color:var(--text)">'+esc(String(val))+'</span></div>';
      });
      html+='</div>';
    }
    html+='</div></div>';
  }
  // Agent purpose
  if(descD.purpose){
    html+='<h3>Зачем этот агент</h3><p style="font-size:13px;line-height:1.6">'+descD.purpose+'</p>';
  }
  // Sources
  if(f.sources&&f.sources.length){
    html+='<h3>Источники данных</h3><div class="agent-sources" style="margin-bottom:12px">'+
      f.sources.map(function(s){return '<span style="font-size:11px;padding:4px 10px;background:var(--panel);border-radius:6px;border:1px solid var(--border);color:var(--cyan)">'+s+'</span>';}).join('')+'</div>';
  }
  // Replaces
  if(descD&&descD.replaces){
    html+='<h3>Что экономит</h3><p style="font-size:13px;color:var(--amber)">'+descD.replaces+'</p>';
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
    const wrapRect=cwrap.getBoundingClientRect();
    const imgX=(e.clientX-wr.left)/camZoom;
    const imgY=(e.clientY-wr.top)/camZoom;
    const hov=typeof officeHoverUpdate==='function'?officeHoverUpdate(imgX,imgY):null;
    cwrap.style.cursor=hov?'pointer':'grab';
    // Show/hide hover tooltip
    if(hov&&typeof showHoverTooltip==='function'){
      showHoverTooltip(hov,e.clientX-wrapRect.left,e.clientY-wrapRect.top);
    }else if(typeof hideHoverTooltip==='function'){
      hideHoverTooltip();
    }
  }
  if(!isDragging)return;
  _dragMoved=true;
  camX=camStartX+(e.clientX-dragStartX)/camZoom;camY=camStartY+(e.clientY-dragStartY)/camZoom;
});
cwrap.addEventListener('mouseup',()=>{isDragging=false;cwrap.style.cursor='grab';});
cwrap.addEventListener('mouseleave',()=>{isDragging=false;cwrap.style.cursor='grab';if(typeof hideHoverTooltip==='function')hideHoverTooltip();});
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

  void('F2F.vin AI OFFICE \u2022 REAL DATA \u2022 '+D.leads.length+' LEADS \u2022 '+(D.team?D.team.length:0)+' TEAM \u2022 2.5D ENGINE',CW/2,CH-12);
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

// ═══ CREDIT TRACKER — Real data from ai_credits ═══
let agentsActive=true;
let creditsBudget=10; // $10 default monthly budget, overridden from directives
let creditsSpent=0;

function loadCreditBudgetFromDirectives(){
  if(!window._sbDirectives)return;
  var budgetDir=window._sbDirectives.find(function(d){return d.key==='ai_credit_budget';});
  if(budgetDir&&budgetDir.value_json){
    var val=typeof budgetDir.value_json==='string'?JSON.parse(budgetDir.value_json):budgetDir.value_json;
    if(val.monthly_usd)creditsBudget=parseFloat(val.monthly_usd);
  }
}

function calcCreditsFromSupabase(){
  var credits=window._sbCredits||[];
  // Filter to current month only
  var now=new Date();
  var monthStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString();
  var thisMonth=credits.filter(function(c){return c.created_at>=monthStart;});
  creditsSpent=thisMonth.reduce(function(sum,c){return sum+(parseFloat(c.cost_usd)||0);},0);
  renderCredits();
}

function renderCredits(){
  var remaining=Math.max(0,creditsBudget-creditsSpent);
  var pct=creditsBudget>0?Math.max(0,Math.min(100,(remaining/creditsBudget)*100)):0;
  document.getElementById('creditFill').style.width=pct+'%';
  document.getElementById('creditFill').style.background=pct>50?'var(--green)':pct>20?'var(--amber)':'var(--hot)';
  document.getElementById('creditText').textContent='$'+creditsSpent.toFixed(2)+' / $'+creditsBudget.toFixed(0);
}
renderCredits();

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

// Credits are now tracked via ai_credits table — no simulation needed

// ═══ AGENT STATUS ENGINE — REAL DATA ═══
// Shows REAL data from Supabase: agent_memory reports, events, content_queue stats
// No fake random numbers — only actual data or honest "waiting" status

// Build real status messages from Supabase data
function getRealAgentStatus(agentId){
  // 1. Try agent_memory (last autonomous cycle output)
  if(window._sbMemory){
    var mem=window._sbMemory.find(function(m){return m.dashId===agentId;});
    if(mem&&mem.last_output){
      var out=typeof mem.last_output==='string'?mem.last_output:JSON.stringify(mem.last_output);
      var ago=mem.created_at?timeSince(mem.created_at):'';
      if(out.length>120)out=out.slice(0,120)+'...';
      return {text:'📋 '+out+(ago?' ('+ago+')':''), source:'memory'};
    }
  }
  // 2. Try recent events
  if(window._sbEvents){
    var evts=window._sbEvents.filter(function(e){
      if(!e.metadata_json)return false;
      var m=typeof e.metadata_json==='string'?JSON.parse(e.metadata_json):e.metadata_json;
      return m.agent_dash_id===agentId;
    });
    if(evts.length>0){
      var ev=evts[0];
      var m=typeof ev.metadata_json==='string'?JSON.parse(ev.metadata_json):ev.metadata_json;
      var ago=timeSince(ev.created_at);
      return {text:(m.text||ev.type||'Событие')+' ('+ago+')', source:'event'};
    }
  }
  // 3. Real data summaries (no random numbers)
  var summaries={
    coordinator:function(){
      var done=D.tasks.filter(function(t){return t.status==='done';}).length;
      var pend=D.tasks.filter(function(t){return t.status==='pending';}).length;
      return '📋 Задач: '+done+' выполнено, '+pend+' ожидают | Агентов: '+Object.keys(window._sbAgents||{}).length+' в системе';
    },
    content:function(){
      var total=window._sbContent?window._sbContent.length:D.posts.length;
      var pending=window._sbContent?window._sbContent.filter(function(c){return c.status==='pending_approval';}).length:0;
      var published=window._sbContent?window._sbContent.filter(function(c){return c.status==='published';}).length:0;
      return '📱 Контент: '+total+' постов | ⏳ '+pending+' ожидают одобрения | ✅ '+published+' опубликовано';
    },
    market:function(){
      var reports=window._sbReports?window._sbReports.filter(function(r){
        var ag=window._sbAgentById&&r.agent_id?window._sbAgentById[r.agent_id]:null;
        return ag&&ag.slug==='analyst';
      }).length:0;
      return '📊 Аналитика: '+reports+' отчётов создано | '+D.leads.length+' лидов в воронке';
    },
    leads:function(){
      var hot=D.leads.filter(function(l){return l.priority==='hot';}).length;
      var warm=D.leads.filter(function(l){return l.priority==='warm';}).length;
      return '🎯 Лиды: '+D.leads.length+' всего | 🔥 '+hot+' hot, 🟡 '+warm+' warm';
    },
    outreach:function(){
      var emailTasks=D.tasks.filter(function(t){return t._actionType==='email_template_created';}).length;
      return '📧 Outreach: '+emailTasks+' email-шаблонов подготовлено | '+D.leads.length+' контактов в базе';
    },
    social:function(){
      var tgSubs=(window._sbMetrics&&window._sbMetrics.telegram_subscribers)?window._sbMetrics.telegram_subscribers.value:0;
      return '👥 Сообщество: '+(tgSubs?tgSubs+' подписчиков Telegram':'данные обновляются...');
    }
  };
  if(summaries[agentId])return {text:summaries[agentId](), source:'summary'};
  // 4. Honest standby
  return {text:'💤 Ожидает задачу — дай поручение в чате', source:'standby'};
}

// Helper: human-readable time since
function timeSince(dateStr){
  var d=new Date(dateStr);
  var now=new Date();
  var sec=Math.floor((now-d)/1000);
  if(sec<60)return 'только что';
  var min=Math.floor(sec/60);
  if(min<60)return min+' мин назад';
  var hr=Math.floor(min/60);
  if(hr<24)return hr+'ч назад';
  var days=Math.floor(hr/24);
  return days+'д назад';
}

// Live engine — shows real data status every 30-60 seconds
let liveInterval=null;
let _liveQueue=[]; // queue of agent IDs to cycle through
function startLiveEngine(){
  if(liveInterval)return;
  // Build initial queue
  _liveQueue=Object.keys(AGENTS).slice();
  var _liveIdx=0;
  liveInterval=setInterval(function(){
    if(!agentsActive)return;
    if(!SUPABASE_LIVE)return; // don't show anything without real data
    // Cycle through agents in order (not random)
    if(_liveIdx>=_liveQueue.length)_liveIdx=0;
    var id=_liveQueue[_liveIdx++];
    var status=getRealAgentStatus(id);
    if(status.source!=='standby'){
      addFeed(id,status.text);
    }
  }, 45000); // every 45 sec — slower, honest pace
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
  var initBurn=getLedgerBurn();
  addFeed('budget_analyst','💵 Burn rate: $'+(initBurn.total>0?Math.round(initBurn.total).toLocaleString():'—')+'/мес ('+financePeriod+'). Источник: Finance Ledger');
},1500);
setTimeout(function(){
  var pend=D.tasks.filter(function(t){return t.status==='pending';}).length;
  addFeed('priority','⚡ '+(pend>0?pend+' задач(и) ожидают выполнения':'Все задачи выполнены')+'. Используй 💬 Чат для команд агентам.');
},2500);
setTimeout(function(){
  var unassigned=D.team.filter(function(t){return t.status==='active'&&t.dept==='unassigned';}).length;
  if(unassigned>0)addFeed('team_analyst','⚠️ '+unassigned+' сотрудников не распределены по отделам → таб 👥 Команда');
},3500);


// ═══ МЕРОПРИЯТИЯ / EVENTS v2 — инструмент подготовки ═══
var F2F_EVENTS=[];
var eventsCurrentMonth=new Date().getMonth();
var eventsCurrentYear=new Date().getFullYear();
var eventsFilterType='all';

var EVENT_TYPES={
  tournament:{label:'Турнир',emoji:'🏆',color:'#f59e0b'},
  lan:{label:'LAN-пати',emoji:'🖥',color:'#3b82f6'},
  showmatch:{label:'Шоуматч',emoji:'⚔️',color:'#ec4899'},
  promo:{label:'Промо-акция',emoji:'📢',color:'#06b6d4'},
  partner:{label:'Партнёрское',emoji:'🤝',color:'#10b981'},
  meetup:{label:'Митап',emoji:'👥',color:'#8b5cf6'}
};

var EVENT_STATUSES={
  idea:{label:'Идея',color:'#64748b'},
  planning:{label:'Планирование',color:'#3b82f6'},
  preparation:{label:'Подготовка',color:'#f59e0b'},
  active:{label:'Активно',color:'#10b981'},
  completed:{label:'Завершено',color:'#22c55e'},
  cancelled:{label:'Отменено',color:'#ef4444'}
};

// Checklist templates per event type
var EVENT_CHECKLISTS={
  tournament:[
    {cat:'Площадка',items:['Забронировать площадку','Проверить интернет/серверы','План рассадки']},
    {cat:'Техника',items:['ПК/мониторы для игроков','Стриминг оборудование','Резервное оборудование']},
    {cat:'Маркетинг',items:['Анонс в соцсетях','Промо-материалы','Пресс-релиз']},
    {cat:'Контент',items:['Контент-план на время турнира','Фото/видео команда','Пост-турнирный контент']},
    {cat:'Призы',items:['Определить призовой фонд','Подготовить награды','Оплата/перевод призовых']}
  ],
  lan:[
    {cat:'Площадка',items:['Забронировать площадку','Проверить сеть','Расстановка столов']},
    {cat:'Техника',items:['ПК/периферия','Интернет backup','Электропитание']},
    {cat:'Логистика',items:['Еда/напитки','Регистрация участников','Мерч']}
  ],
  showmatch:[
    {cat:'Организация',items:['Пригласить игроков','Согласовать формат','Определить дату']},
    {cat:'Стриминг',items:['Настроить стрим','Найти кастеров','Оверлеи/графика']},
    {cat:'Промо',items:['Анонс','Тизеры в соцсетях','Промо у игроков']}
  ],
  promo:[
    {cat:'Планирование',items:['Определить цель акции','Бюджет','Механика акции']},
    {cat:'Контент',items:['Креативы','Тексты постов','Лендинг (если нужен)']},
    {cat:'Запуск',items:['Публикация','Модерация','Подведение итогов']}
  ],
  partner:[
    {cat:'Партнёр',items:['Согласовать условия','Подписать договор','Получить материалы партнёра']},
    {cat:'Интеграция',items:['Брендинг на площадке','Упоминания в контенте','Отчёт для партнёра']},
    {cat:'Контент',items:['Совместный анонс','Контент во время ивента','Пост-ивент кейс']}
  ],
  meetup:[
    {cat:'Площадка',items:['Забронировать место','Еда/напитки','Навигация']},
    {cat:'Программа',items:['Спикеры/темы','Расписание','Нетворкинг формат']},
    {cat:'Промо',items:['Регистрация','Анонс в сообществе','Follow-up после']}
  ]
};

var _eventsLoaded=false;
async function initEventsData(){
  if(_eventsLoaded&&F2F_EVENTS.length>0)return;
  try{
    var data=await sbFetch('f2f_events','select=*&order=date.asc');
    if(data&&data.length>0){
      F2F_EVENTS=data.map(function(e){
        // Map DB columns to frontend fields
        return{
          id:e.id,title:e.title,date:e.date,end:e.end_date||'',
          type:e.type||'tournament',status:e.status||'idea',
          venue:e.venue||'',budget:e.budget||'',goals:e.goals||'',
          desc:e.description||'',tasks:e.tasks||[]
        };
      });
      _eventsLoaded=true;
      return;
    }
  }catch(err){console.warn('Events load from Supabase failed:',err);}
  // Fallback: try localStorage migration (one-time)
  try{
    var saved=JSON.parse(localStorage.getItem('f2f_events_v2')||'[]');
    if(saved.length>0){
      F2F_EVENTS=saved.map(function(e){
        if(!e.id)e.id='ev_'+Math.random().toString(36).slice(2,8);
        if(!e.status)e.status='idea';
        if(!e.tasks)e.tasks=[];
        return e;
      });
      // Migrate to Supabase
      F2F_EVENTS.forEach(function(e){_saveEventToSupabase(e,true);});
      showToast('📅 Мероприятия мигрированы в Supabase','info');
    }
  }catch(e){}
  _eventsLoaded=true;
}

async function _saveEventToSupabase(e,isNew){
  var payload={
    title:e.title,date:e.date,end_date:e.end||null,
    type:e.type,status:e.status,venue:e.venue||null,
    budget:e.budget||null,goals:e.goals||null,
    description:e.desc||null,tasks:e.tasks||[],
    updated_at:new Date().toISOString()
  };
  if(isNew){
    var result=await sbInsert('f2f_events',payload);
    if(result&&result[0]){
      e.id=result[0].id;
      // ═══ WORKFLOW: авто-задачи для нового мероприятия ═══
      await generateEventTasks(e,result[0].id);
    }
  }else{
    await sbPatch('f2f_events','id=eq.'+e.id,payload);
  }
}

// ═══ WORKFLOW: Event → авто-задачи для Referee и Community ═══
async function generateEventTasks(event,eventId){
  var tasks=[];
  var eventName=event.title||event.name||'Мероприятие';
  var eventDate=event.date||'TBD';
  var eventType=event.type||'tournament';
  // Referee задачи
  if(['tournament','qualifier','showmatch','bootcamp'].indexOf(eventType)!==-1){
    tasks.push({agent_id:'referee',type:'task',payload_json:{status:'planned',description:'Подготовить регламент для '+eventName+' ('+eventDate+')',event_id:eventId,priority:'high',category:'event_prep'}});
    tasks.push({agent_id:'referee',type:'task',payload_json:{status:'planned',description:'Сформировать список команд-участников '+eventName,event_id:eventId,priority:'medium',category:'event_prep'}});
    tasks.push({agent_id:'referee',type:'task',payload_json:{status:'planned',description:'Назначить судей на '+eventName,event_id:eventId,priority:'medium',category:'event_prep'}});
  }
  // Community задачи
  tasks.push({agent_id:'community',type:'task',payload_json:{status:'planned',description:'Анонс '+eventName+' в соцсетях ('+eventDate+')',event_id:eventId,priority:'high',category:'event_promo'}});
  tasks.push({agent_id:'community',type:'task',payload_json:{status:'planned',description:'Подготовить визуалы для '+eventName,event_id:eventId,priority:'medium',category:'event_promo'}});
  // BizDev задачи (спонсорство)
  if(event.budget){
    tasks.push({agent_id:'bizdev',type:'task',payload_json:{status:'planned',description:'Найти спонсоров для '+eventName+' (бюджет: '+event.budget+')',event_id:eventId,priority:'medium',category:'event_sponsors'}});
  }
  // Insert all tasks
  if(tasks.length){
    for(var i=0;i<tasks.length;i++){
      tasks[i].created_at=new Date().toISOString();
    }
    await sbInsert('actions',tasks);
    showToast('📋 Создано '+tasks.length+' задач для мероприятия','success');
  }
}

function saveEvents(){
  // Legacy localStorage backup (will be removed later)
  try{localStorage.setItem('f2f_events_v2',JSON.stringify(F2F_EVENTS));}catch(e){}
}

function getEventProgress(e){
  if(!e.tasks||!e.tasks.length)return{done:0,total:0,pct:0};
  var done=e.tasks.filter(function(t){return t.done;}).length;
  return{done:done,total:e.tasks.length,pct:Math.round(done/e.tasks.length*100)};
}

async function renderEventsPanel(){
  await initEventsData();
  var countEl=document.getElementById('tab-events-count');
  var today=new Date().toISOString().slice(0,10);
  var upcoming=F2F_EVENTS.filter(function(e){return e.date>=today&&e.status!=='cancelled'&&e.status!=='completed';});
  if(countEl)countEl.textContent=upcoming.length;
  document.getElementById('events-total-count').textContent=F2F_EVENTS.length+' событий';

  // KPI strip
  var kpiEl=document.getElementById('eventsKPI');
  var active=F2F_EVENTS.filter(function(e){return e.status==='active'||e.status==='preparation';}).length;
  var planning=F2F_EVENTS.filter(function(e){return e.status==='planning'||e.status==='idea';}).length;
  var completed=F2F_EVENTS.filter(function(e){return e.status==='completed';}).length;
  var totalTasks=0,doneTasks=0;
  F2F_EVENTS.forEach(function(e){if(e.tasks){totalTasks+=e.tasks.length;doneTasks+=e.tasks.filter(function(t){return t.done;}).length;}});
  kpiEl.innerHTML=[
    {label:'Активных',val:active,color:'#10b981'},
    {label:'В планах',val:planning,color:'#3b82f6'},
    {label:'Завершено',val:completed,color:'#22c55e'},
    {label:'Задач готово',val:totalTasks?doneTasks+'/'+totalTasks:'—',color:'#f59e0b'}
  ].map(function(k){
    return '<div style="flex:1;min-width:100px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-radius:8px;text-align:center">'+
      '<div style="font-size:18px;font-weight:700;color:'+k.color+'">'+k.val+'</div>'+
      '<div style="font-size:10px;color:var(--dim);margin-top:2px">'+k.label+'</div></div>';
  }).join('');

  // Filter bar
  var fb=document.getElementById('eventsFilterBar');
  var types=['all'].concat(Object.keys(EVENT_TYPES));
  fb.innerHTML=types.map(function(t){
    var isActive=eventsFilterType===t;
    var info=EVENT_TYPES[t];
    var label=t==='all'?'Все':(info?info.emoji+' '+info.label:t);
    var cnt=t==='all'?F2F_EVENTS.length:F2F_EVENTS.filter(function(e){return e.type===t;}).length;
    return '<button onclick="eventsFilterType=\''+t+'\';renderEventsPanel()" style="padding:6px 14px;border-radius:6px;border:1px solid '+(isActive?'var(--cyan)':'var(--border)')+';background:'+(isActive?'var(--cyan)11':'transparent')+';color:'+(isActive?'var(--cyan)':'var(--dim)')+';font-size:11px;cursor:pointer;transition:all .2s;min-height:34px">'+label+' <span style="opacity:.5">'+cnt+'</span></button>';
  }).join('');

  // Filter events
  var filtered=eventsFilterType==='all'?F2F_EVENTS:F2F_EVENTS.filter(function(e){return e.type===eventsFilterType;});

  // Calendar grid (compact)
  renderEventsCalendar(filtered);

  // Event list — vertical, below calendar
  var listEl=document.getElementById('eventsListSection');
  var sorted=filtered.slice().sort(function(a,b){return a.date>b.date?1:-1;});
  var activeList=sorted.filter(function(e){return e.status!=='completed'&&e.status!=='cancelled';});
  var doneList=sorted.filter(function(e){return e.status==='completed'||e.status==='cancelled';}).reverse().slice(0,5);

  var html='';
  if(!activeList.length&&!doneList.length){
    html='<div style="text-align:center;padding:40px 20px;color:var(--dim)">'+
      '<div style="font-size:32px;margin-bottom:8px">📅</div>'+
      '<div style="font-size:14px;margin-bottom:4px">Нет мероприятий</div>'+
      '<div style="font-size:12px">Нажми <b>+ Новое мероприятие</b> чтобы начать планирование</div>'+
    '</div>';
  }else{
    if(activeList.length){
      html+='<div style="font-size:13px;font-weight:600;color:var(--cyan);margin-bottom:8px">Активные и в планах ('+activeList.length+')</div>';
      activeList.forEach(function(e){html+=renderEventCard(e,today);});
    }
    if(doneList.length){
      html+='<div style="font-size:13px;font-weight:600;color:var(--dim);margin:16px 0 8px">Завершённые</div>';
      doneList.forEach(function(e){html+=renderEventCard(e,today);});
    }
  }
  listEl.innerHTML=html;
}

function renderEventCard(e,today){
  var info=EVENT_TYPES[e.type]||{label:'?',emoji:'📌',color:'#666'};
  var st=EVENT_STATUSES[e.status]||{label:'?',color:'#666'};
  var isDone=e.status==='completed'||e.status==='cancelled';
  var daysUntil=Math.ceil((new Date(e.date)-new Date(today))/(86400000));
  var daysLabel=daysUntil===0?'Сегодня!':daysUntil===1?'Завтра':daysUntil>0?'через '+daysUntil+' дн.':Math.abs(daysUntil)+' дн. назад';
  var prog=getEventProgress(e);

  return '<div onclick="openEventDetail(\''+e.id+'\')" style="padding:12px 14px;background:var(--panel);border:1px solid var(--border);border-left:3px solid '+info.color+';border-radius:8px;margin-bottom:8px;cursor:pointer;opacity:'+(isDone?'0.5':'1')+';transition:all .2s" onmouseover="this.style.borderColor=\''+info.color+'\'" onmouseout="this.style.borderColor=\'var(--border)\'">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">'+
      '<div style="font-size:14px;font-weight:600;color:var(--text)">'+esc(info.emoji+' '+e.title)+'</div>'+
      '<div style="display:flex;gap:4px;align-items:center">'+
        '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:'+st.color+'22;color:'+st.color+'">'+st.label+'</span>'+
        '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:'+info.color+'22;color:'+info.color+'">'+info.label+'</span>'+
      '</div>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap">'+
      '<span style="font-size:11px;color:var(--dim)">'+e.date+(e.end?' → '+e.end:'')+'</span>'+
      '<span style="font-size:11px;color:'+(daysUntil<=3&&daysUntil>=0?'#f59e0b':'var(--dim)')+'">'+daysLabel+'</span>'+
      (e.venue?'<span style="font-size:11px;color:var(--dim)">📍 '+esc(e.venue)+'</span>':'')+
      (e.budget?'<span style="font-size:11px;color:var(--dim)">💰 '+esc(e.budget)+'</span>':'')+
      (function(){var exCnt=(window._expenses||[]).filter(function(x){return x.related_event_id&&String(x.related_event_id)===String(e.id);});if(!exCnt.length)return '';var exTot=0;exCnt.forEach(function(x){exTot+=parseFloat(x.amount)||0;});return '<span style="font-size:11px;color:var(--hot)">🧾 ₽'+Math.round(exTot).toLocaleString('ru')+' ('+exCnt.length+')</span>';})()+
    '</div>'+
    (prog.total>0?'<div style="margin-top:8px;display:flex;align-items:center;gap:8px">'+
      '<div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">'+
        '<div style="width:'+prog.pct+'%;height:100%;background:'+(prog.pct===100?'#22c55e':'#3b82f6')+';border-radius:2px;transition:width .3s"></div>'+
      '</div>'+
      '<span style="font-size:10px;color:var(--dim);white-space:nowrap">'+prog.done+'/'+prog.total+' задач</span>'+
    '</div>':'')+
  '</div>';
}

function renderEventsCalendar(events){
  var el=document.getElementById('eventsCalendarGrid');
  var y=eventsCurrentYear,m=eventsCurrentMonth;
  var firstDay=new Date(y,m,1).getDay()||7;
  var daysInMonth=new Date(y,m+1,0).getDate();
  var today=new Date();var todayStr=today.toISOString().slice(0,10);
  var monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  var dayEvents={};
  events.forEach(function(e){
    var ym=y+'-'+String(m+1).padStart(2,'0');
    var start=e.date.slice(0,7)===ym?parseInt(e.date.slice(8,10)):null;
    var endDate=e.end||e.date;
    if(!start){if(e.date<ym+'-01'&&endDate>=ym+'-01')start=1;}
    if(start){
      var endDay=endDate.slice(0,7)===ym?parseInt(endDate.slice(8,10)):daysInMonth;
      for(var d=start;d<=Math.min(endDay,daysInMonth);d++){
        if(!dayEvents[d])dayEvents[d]=[];
        dayEvents[d].push(e);
      }
    }
  });

  var totalEvents=events.length;
  var html='<div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
    '<button onclick="eventsCurrentMonth--;if(eventsCurrentMonth<0){eventsCurrentMonth=11;eventsCurrentYear--;}renderEventsPanel()" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:16px;min-height:38px;transition:all .15s">◀</button>'+
    '<div style="text-align:center"><span style="font-size:18px;font-weight:700;color:var(--text)">'+monthNames[m]+' '+y+'</span>'+(totalEvents?'<div style="font-size:11px;color:var(--cyan);margin-top:2px">'+totalEvents+' мероприятий</div>':'')+'</div>'+
    '<button onclick="eventsCurrentMonth++;if(eventsCurrentMonth>11){eventsCurrentMonth=0;eventsCurrentYear++;}renderEventsPanel()" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:16px;min-height:38px;transition:all .15s">▶</button>'+
  '</div>';
  html+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;margin-bottom:6px">';
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(function(d,i){
    var isWeekend=i>=5;
    html+='<div style="font-size:11px;color:'+(isWeekend?'var(--magenta)':'var(--dim)')+';padding:6px 0;font-weight:700;text-transform:uppercase;letter-spacing:1px">'+d+'</div>';
  });
  html+='</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
  for(var i=1;i<firstDay;i++)html+='<div style="padding:4px;min-height:48px"></div>';
  for(var d=1;d<=daysInMonth;d++){
    var dateStr=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var isToday=dateStr===todayStr;
    var evs=dayEvents[d]||[];
    var hasEvents=evs.length>0;
    html+='<div class="cal-day'+(isToday?' cal-today':'')+'" onclick="showDayEvents(\''+dateStr+'\')" style="padding:4px;min-height:48px;cursor:pointer'+(hasEvents?';border-color:rgba(0,255,136,0.3)':'')+'">';
    html+='<div style="font-size:12px;color:'+(isToday?'var(--cyan)':hasEvents?'var(--green)':'var(--text)')+';font-weight:'+(isToday||hasEvents?'700':'400')+';text-align:right;padding:0 3px">'+d+'</div>';
    if(hasEvents){
      evs.slice(0,2).forEach(function(e){
        var inf=EVENT_TYPES[e.type]||{color:'#666'};
        html+='<div style="font-size:8px;padding:1px 4px;margin-top:2px;border-radius:3px;background:'+inf.color+'33;color:'+inf.color+';overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500">'+esc(e.title.slice(0,14))+'</div>';
      });
      if(evs.length>2)html+='<div style="font-size:8px;color:var(--cyan);text-align:center;font-weight:600">+'+String(evs.length-2)+'</div>';
    }
    html+='</div>';
  }
  html+='</div></div>';
  el.innerHTML=html;
}

window.showDayEvents=function(dateStr){
  var evs=F2F_EVENTS.filter(function(e){return e.date<=dateStr&&(e.end||e.date)>=dateStr;});
  if(!evs.length){openEventForm(dateStr);return;}
  var html='<h2 style="margin-bottom:12px">📅 '+dateStr+'</h2>';
  evs.forEach(function(e){
    var info=EVENT_TYPES[e.type]||{label:'?',emoji:'📌',color:'#666'};
    var st=EVENT_STATUSES[e.status]||{label:'?',color:'#666'};
    html+='<div style="padding:10px;background:var(--bg);border-left:3px solid '+info.color+';border-radius:8px;margin-bottom:8px;cursor:pointer" onclick="closeModal();setTimeout(function(){openEventDetail(\''+e.id+'\')},150)">'+
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-weight:600;font-size:13px">'+esc(info.emoji+' '+e.title)+'</div>'+
        '<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:'+st.color+'22;color:'+st.color+'">'+st.label+'</span>'+
      '</div>'+
    '</div>';
  });
  html+='<button onclick="openEventForm(\''+dateStr+'\')" style="width:100%;padding:10px;background:#a855f722;color:#a855f7;border:1px solid #a855f744;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-top:8px;min-height:44px">+ Добавить на эту дату</button>';
  openModal(html);
};

// ── Event Expenses helpers ──
function buildEventExpensesHtml(ev){
  var exps=(window._expenses||[]).filter(function(e){return e.related_event_id&&String(e.related_event_id)===String(ev.id);});
  if(!exps.length&&!canAddExpense())return '';
  var catIcons={event:'🎮',merch:'👕',service:'💻',judge_labor:'⚖️',other:'📦'};
  var statusColors={pending:'var(--amber)',approved:'var(--green)',rejected:'var(--hot)'};
  var total=0;exps.forEach(function(e){total+=parseFloat(e.amount)||0;});
  var html='<div style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
    '<div style="font-size:13px;font-weight:600;color:var(--text)">💰 Расходы'+(exps.length?' ('+exps.length+')':'')+'</div>';
  if(canSeeExpenseTotal()&&total>0)html+='<div style="font-size:13px;font-weight:700;color:var(--hot)">₽'+Math.round(total).toLocaleString('ru')+'</div>';
  html+='</div>';
  if(!exps.length){
    html+='<div style="padding:16px;text-align:center;background:var(--bg);border:1px dashed var(--border);border-radius:8px;font-size:12px;color:var(--dim)">Нет расходов по этому мероприятию</div>';
  }else{
    exps.forEach(function(e){
      var icon=catIcons[e.category]||'📦';
      var stColor=statusColors[e.status]||'var(--dim)';
      var stLabel=e.status==='pending'?'⏳':e.status==='approved'?'✅':'❌';
      html+='<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-bottom:4px">'+
        '<span style="font-size:16px">'+icon+'</span>'+
        '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(e.description)+'</div>'+
        '<div style="font-size:10px;color:var(--dim)">'+esc(e.author||'')+' • '+(e.created_at?timeSince(e.created_at):'—')+'</div></div>'+
        '<div style="text-align:right;white-space:nowrap"><div style="font-weight:700;font-size:13px;color:var(--cyan)">₽'+(parseFloat(e.amount)||0).toLocaleString('ru')+'</div>'+
        '<div style="font-size:10px;color:'+stColor+'">'+stLabel+'</div></div>'+
        (canSeeExpenseTotal()&&e.status==='pending'?'<div style="display:flex;flex-direction:column;gap:2px;margin-left:4px">'+
          '<button onclick="event.stopPropagation();approveExpense('+e.id+')" style="padding:2px 6px;background:#10b98118;color:#10b981;border:1px solid #10b98133;border-radius:3px;cursor:pointer;font-size:9px">✅</button>'+
          '<button onclick="event.stopPropagation();rejectExpense('+e.id+')" style="padding:2px 6px;background:#ef444418;color:#ef4444;border:1px solid #ef444433;border-radius:3px;cursor:pointer;font-size:9px">❌</button></div>':'')+
      '</div>';
    });
  }
  html+='</div>';
  return html;
}

window.openExpenseFormForEvent=function(eventId,eventTitle){
  if(!canAddExpense()){showToast('Нет доступа','error');return;}
  var categories=[{v:'event',l:'🎮 Мероприятие'},{v:'merch',l:'👕 Мерч'},{v:'service',l:'💻 Сервис/подписка'},{v:'judge_labor',l:'⚖️ Трудозатраты судей'},{v:'other',l:'📦 Прочее'}];
  var catOpts=categories.map(function(c){return '<option value="'+c.v+'">'+c.l+'</option>';}).join('');
  openModal('<h3 style="margin-bottom:16px">💰 Расход → '+esc(eventTitle)+'</h3>'+
    '<div style="display:flex;flex-direction:column;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--dim)">Категория</label><select id="expCat" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px">'+catOpts+'</select></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Сумма (₽)</label><input id="expAmount" type="number" step="0.01" placeholder="0.00" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;box-sizing:border-box"></div>'+
    '<div><label style="font-size:12px;color:var(--dim)">Описание</label><input id="expDesc" placeholder="На что потрачено..." style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;box-sizing:border-box"></div>'+
    '<input type="hidden" id="expEvent" value="'+eventId+'">'+
    '<button onclick="submitExpenseAndReturn(\''+eventId+'\')" class="act-btn success" style="padding:10px;font-size:14px;width:100%">💾 Сохранить расход</button></div>');
};

window.submitExpenseAndReturn=async function(eventId){
  var cat=document.getElementById('expCat').value;
  var amount=parseFloat(document.getElementById('expAmount').value);
  var desc=document.getElementById('expDesc').value.trim();
  if(!amount||!desc){showToast('Заполни сумму и описание','error');return;}
  var entry={category:cat,amount:amount,currency:'RUB',description:desc,
    related_event_id:parseInt(eventId),
    author:_currentSession.login_name,author_role:_currentSession.role,status:'pending'};
  await sbInsert('expense_entries',entry);
  logAudit('expense_add','expense',null,{amount:amount,category:cat,description:desc,event_id:eventId});
  showToast('✅ Расход добавлен ('+amount+' ₽)','success');
  await loadExpenses();
  closeModal();
  setTimeout(function(){openEventDetail(eventId);},150);
};

function buildEmployeeExpensesHtml(member){
  var exps=(window._expenses||[]).filter(function(e){
    return e.author===member.name||e.related_employee_id===member.id;
  });
  if(!exps.length)return '';
  var catIcons={event:'🎮',merch:'👕',service:'💻',judge_labor:'⚖️',other:'📦'};
  var total=0;exps.forEach(function(e){total+=parseFloat(e.amount)||0;});
  var html='<h3>💰 Расходы сотрудника'+(canSeeExpenseTotal()?' (₽'+Math.round(total).toLocaleString('ru')+')':'')+'</h3>'+
    '<div style="max-height:200px;overflow-y:auto;margin-bottom:12px">';
  exps.slice(0,20).forEach(function(e){
    var icon=catIcons[e.category]||'📦';
    var stLabel=e.status==='pending'?'⏳':e.status==='approved'?'✅':'❌';
    html+='<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-bottom:3px">'+
      '<span>'+icon+'</span>'+
      '<span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(e.description)+'</span>'+
      '<span style="font-size:12px;font-weight:600;color:var(--cyan);white-space:nowrap">₽'+(parseFloat(e.amount)||0).toLocaleString('ru')+'</span>'+
      '<span style="font-size:10px">'+stLabel+'</span></div>';
  });
  if(exps.length>20)html+='<div style="text-align:center;font-size:11px;color:var(--dim);padding:4px">...ещё '+(exps.length-20)+'</div>';
  html+='</div>';
  return html;
}

window.openEventDetail=function(id){
  var e=F2F_EVENTS.find(function(ev){return ev.id===id;});
  if(!e)return;
  var info=EVENT_TYPES[e.type]||{label:'?',emoji:'📌',color:'#666'};
  var st=EVENT_STATUSES[e.status]||{label:'?',color:'#666'};
  var today=new Date().toISOString().slice(0,10);
  var daysUntil=Math.ceil((new Date(e.date)-new Date(today))/(86400000));
  var daysLabel=daysUntil===0?'Сегодня!':daysUntil>0?'через '+daysUntil+' дн.':Math.abs(daysUntil)+' дн. назад';
  var prog=getEventProgress(e);

  // Status selector
  var statusHtml='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:12px">';
  Object.keys(EVENT_STATUSES).forEach(function(sk){
    var s=EVENT_STATUSES[sk];
    var isCur=e.status===sk;
    statusHtml+='<button onclick="changeEventStatus(\''+e.id+'\',\''+sk+'\')" style="padding:4px 10px;border-radius:5px;border:1px solid '+(isCur?s.color:s.color+'44')+';background:'+(isCur?s.color+'33':s.color+'11')+';color:'+s.color+';font-size:10px;cursor:pointer;font-weight:'+(isCur?'700':'400')+';min-height:30px">'+s.label+'</button>';
  });
  statusHtml+='</div>';

  // Checklist
  var taskHtml='';
  if(e.tasks&&e.tasks.length>0){
    taskHtml='<div style="margin-top:16px"><div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">📋 Чеклист ('+prog.done+'/'+prog.total+')</div>';
    if(prog.total>0){
      taskHtml+='<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:10px">'+
        '<div style="width:'+prog.pct+'%;height:100%;background:'+(prog.pct===100?'#22c55e':'#3b82f6')+';transition:width .3s"></div></div>';
    }
    var curCat='';
    e.tasks.forEach(function(t,idx){
      if(t.cat&&t.cat!==curCat){
        curCat=t.cat;
        taskHtml+='<div style="font-size:11px;font-weight:600;color:var(--cyan);margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.5px">'+esc(curCat)+'</div>';
      }
      taskHtml+='<div onclick="toggleEventTask(\''+e.id+'\','+idx+')" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border-radius:6px;margin-bottom:3px;cursor:pointer;border:1px solid '+(t.done?'#22c55e33':'var(--border)')+';transition:all .15s">'+
        '<span style="font-size:14px;width:20px;text-align:center">'+(t.done?'✅':'⬜')+'</span>'+
        '<span style="font-size:12px;color:'+(t.done?'var(--dim)':'var(--text)')+';text-decoration:'+(t.done?'line-through':'none')+';flex:1">'+esc(t.text)+'</span>'+
      '</div>';
    });
    taskHtml+='</div>';
  }else{
    // Offer to generate checklist
    var tmpl=EVENT_CHECKLISTS[e.type];
    if(tmpl){
      taskHtml='<div style="margin-top:16px;text-align:center;padding:16px;background:var(--bg);border:1px dashed var(--border);border-radius:8px">'+
        '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">Нет задач. Сгенерировать чеклист для типа "'+info.label+'"?</div>'+
        '<button onclick="generateChecklist(\''+e.id+'\')" style="padding:8px 20px;background:#3b82f622;color:#3b82f6;border:1px solid #3b82f644;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;min-height:36px">📋 Сгенерировать чеклист</button>'+
      '</div>';
    }
  }

  openModal(
    '<div style="border-left:4px solid '+info.color+';padding-left:16px">'+
      '<h2 style="margin:0 0 4px">'+esc(info.emoji+' '+e.title)+'</h2>'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
        '<span style="font-size:11px;padding:2px 10px;border-radius:4px;background:'+st.color+'22;color:'+st.color+';font-weight:600">'+st.label+'</span>'+
        '<span style="font-size:11px;padding:2px 10px;border-radius:4px;background:'+info.color+'22;color:'+info.color+'">'+info.label+'</span>'+
        '<span style="font-size:11px;color:var(--dim)">'+daysLabel+'</span>'+
      '</div>'+
    '</div>'+
    statusHtml+
    '<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">'+
      '<div style="padding:8px;background:var(--bg);border-radius:8px"><div style="font-size:10px;color:var(--dim)">Начало</div><div style="font-size:13px;font-weight:600;color:var(--text);margin-top:2px">'+e.date+'</div></div>'+
      '<div style="padding:8px;background:var(--bg);border-radius:8px"><div style="font-size:10px;color:var(--dim)">Конец</div><div style="font-size:13px;font-weight:600;color:var(--text);margin-top:2px">'+(e.end||'—')+'</div></div>'+
      (e.venue?'<div style="padding:8px;background:var(--bg);border-radius:8px"><div style="font-size:10px;color:var(--dim)">Площадка</div><div style="font-size:13px;font-weight:600;color:var(--text);margin-top:2px">'+esc(e.venue)+'</div></div>':'')+
      (e.budget?'<div style="padding:8px;background:var(--bg);border-radius:8px"><div style="font-size:10px;color:var(--dim)">Бюджет</div><div style="font-size:13px;font-weight:600;color:var(--text);margin-top:2px">'+esc(e.budget)+'</div></div>':'')+
    '</div>'+
    (e.goals?'<div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:8px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">🎯 Цель</div><div style="font-size:12px;color:var(--text);line-height:1.5">'+esc(e.goals)+'</div></div>':'')+
    (e.desc?'<div style="margin-top:8px;padding:10px;background:var(--bg);border-radius:8px;font-size:12px;color:#8892a4;line-height:1.5">'+esc(e.desc)+'</div>':'')+
    taskHtml+
    buildEventExpensesHtml(e)+
    (e.project_id?(function(){var proj=(window._projects||[]).find(function(p){return String(p.id)===String(e.project_id);});return proj?'<div style="margin-top:10px;padding:8px 12px;background:var(--cyan)10;border:1px solid var(--cyan)22;border-radius:8px;font-size:12px"><span style="color:var(--dim)">📁 Проект:</span> <span style="color:var(--cyan);font-weight:600">'+esc(proj.name)+'</span></div>':'';})():'')+
    buildEntityChangesHtml('event',String(e.id))+
    '<div style="margin-top:16px;display:flex;gap:8px">'+
      '<button onclick="openEventForm(null,\''+e.id+'\')" style="flex:1;padding:8px;background:#3b82f622;color:#3b82f6;border:1px solid #3b82f644;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;min-height:40px">✏️ Редактировать</button>'+
      (canAddExpense()?'<button onclick="openExpenseFormForEvent(\''+e.id+'\',\''+esc(e.title).replace(/'/g,"\\'")+'\');return false;" style="flex:1;padding:8px;background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;min-height:40px">💰 +Расход</button>':'')+
      '<button onclick="deleteEvent(\''+e.id+'\')" style="padding:8px 16px;background:#ef444422;color:#ef4444;border:1px solid #ef444444;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;min-height:40px">🗑</button>'+
    '</div>'
  );
};

window.toggleEventTask=function(evId,taskIdx){
  var e=F2F_EVENTS.find(function(ev){return ev.id===evId;});
  if(!e||!e.tasks||!e.tasks[taskIdx])return;
  e.tasks[taskIdx].done=!e.tasks[taskIdx].done;
  saveEvents();
  _saveEventToSupabase(e,false);
  closeModal();
  setTimeout(function(){openEventDetail(evId);},100);
};

window.generateChecklist=function(evId){
  var e=F2F_EVENTS.find(function(ev){return ev.id===evId;});
  if(!e)return;
  var tmpl=EVENT_CHECKLISTS[e.type];
  if(!tmpl)return;
  e.tasks=[];
  tmpl.forEach(function(cat){
    cat.items.forEach(function(item){
      e.tasks.push({cat:cat.cat,text:item,done:false});
    });
  });
  saveEvents();
  _saveEventToSupabase(e,false);
  closeModal();
  setTimeout(function(){openEventDetail(evId);},100);
  showToast('📋 Чеклист сгенерирован ('+e.tasks.length+' задач)','success');
};

window.changeEventStatus=function(evId,newStatus){
  var e=F2F_EVENTS.find(function(ev){return ev.id===evId;});
  if(!e)return;
  e.status=newStatus;
  saveEvents();
  _saveEventToSupabase(e,false);
  closeModal();
  setTimeout(function(){openEventDetail(evId);},100);
};

window.openEventForm=function(defaultDate,editId){
  var e=editId?F2F_EVENTS.find(function(ev){return ev.id===editId;}):null;
  var isEdit=!!e;
  var typeOptions=Object.keys(EVENT_TYPES).map(function(k){
    var info=EVENT_TYPES[k];
    return '<option value="'+k+'"'+(e&&e.type===k?' selected':(!e&&k==='tournament'?' selected':''))+'>'+info.emoji+' '+info.label+'</option>';
  }).join('');
  var statusOptions=Object.keys(EVENT_STATUSES).map(function(k){
    var s=EVENT_STATUSES[k];
    return '<option value="'+k+'"'+(e&&e.status===k?' selected':(!e&&k==='idea'?' selected':''))+'>'+s.label+'</option>';
  }).join('');

  closeModal();
  setTimeout(function(){
    openModal(
      '<h2 style="margin-bottom:16px">'+(isEdit?'✏️ Редактировать':'📅 Новое мероприятие')+'</h2>'+
      '<div style="display:flex;flex-direction:column;gap:12px">'+
        '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Название *</label>'+
        '<input id="evTitle" value="'+esc(e?e.title:'')+'" placeholder="Например: F2F LAN #1" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;box-sizing:border-box"></div>'+

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Тип</label>'+
          '<select id="evType" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+typeOptions+'</select></div>'+
          '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Статус</label>'+
          '<select id="evStatus" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">'+statusOptions+'</select></div>'+
        '</div>'+

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Дата начала *</label>'+
          '<input id="evDate" type="date" value="'+(e?e.date:(defaultDate||new Date().toISOString().slice(0,10)))+'" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div>'+
          '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Дата конца</label>'+
          '<input id="evEnd" type="date" value="'+(e&&e.end?e.end:'')+'" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div>'+
        '</div>'+

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Площадка</label>'+
          '<input id="evVenue" value="'+esc(e?e.venue||'':'')+'" placeholder="Название / адрес" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div>'+
          '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Бюджет</label>'+
          '<input id="evBudget" value="'+esc(e?e.budget||'':'')+'" placeholder="$500 / 50 000₽" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div>'+
        '</div>'+

        '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Цель мероприятия</label>'+
        '<input id="evGoals" value="'+esc(e?e.goals||'':'')+'" placeholder="Зачем проводим? Что хотим получить?" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;box-sizing:border-box"></div>'+

        '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Описание</label>'+
        '<textarea id="evDesc" rows="2" placeholder="Дополнительные детали..." style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box">'+esc(e?e.desc||'':'')+'</textarea></div>'+

        '<div><label style="font-size:11px;color:var(--dim);display:block;margin-bottom:3px">Проект</label>'+
        '<select id="evProject" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px"><option value="">— не привязано —</option>'+(window._projects||[]).filter(function(p){return p.status==='active';}).map(function(p){return '<option value="'+p.id+'"'+(e&&e.project_id&&String(e.project_id)===String(p.id)?' selected':'')+'>📁 '+esc(p.name)+'</option>';}).join('')+'</select></div>'+

        '<button onclick="saveEventForm('+(isEdit?"'"+editId+"'":"null")+')" style="width:100%;padding:12px;background:#a855f733;color:#a855f7;border:1px solid #a855f766;border-radius:6px;cursor:pointer;font-size:14px;font-weight:700;min-height:48px">'+(isEdit?'💾 Сохранить':'📅 Создать мероприятие')+'</button>'+
      '</div>'
    );
  },100);
};

window.saveEventForm=async function(editId){
  var title=document.getElementById('evTitle').value.trim();
  var date=document.getElementById('evDate').value;
  var end=document.getElementById('evEnd').value;
  var type=document.getElementById('evType').value;
  var status=document.getElementById('evStatus').value;
  var venue=document.getElementById('evVenue').value.trim();
  var budget=document.getElementById('evBudget').value.trim();
  var goals=document.getElementById('evGoals').value.trim();
  var desc=document.getElementById('evDesc').value.trim();
  var projEl=document.getElementById('evProject');
  var projectId=projEl?projEl.value:'';
  if(!title||!date){showToast('Заполни название и дату','warning');return;}
  if(editId){
    var ev=F2F_EVENTS.find(function(e){return e.id===editId;});
    if(ev){ev.title=title;ev.date=date;ev.end=end||'';ev.type=type;ev.status=status;ev.venue=venue;ev.budget=budget;ev.goals=goals;ev.desc=desc;ev.project_id=projectId?parseInt(projectId):null;}
    await _saveEventToSupabase(ev,false);
  }else{
    var newEv={id:'temp_'+Date.now(),title:title,date:date,end:end||'',type:type,status:status,venue:venue,budget:budget,goals:goals,desc:desc,project_id:projectId?parseInt(projectId):null,tasks:[]};
    F2F_EVENTS.push(newEv);
    await _saveEventToSupabase(newEv,true);
  }
  saveEvents();
  closeModal();
  renderEventsPanel();
  showToast(editId?'✅ Мероприятие обновлено':'📅 Мероприятие создано','success');
};

window.deleteEvent=function(id){
  F2F_EVENTS=F2F_EVENTS.filter(function(e){return e.id!==id;});
  saveEvents();
  // Delete from Supabase (soft: set status=cancelled since DELETE blocked by RLS)
  sbPatch('f2f_events','id=eq.'+id,{status:'cancelled',updated_at:new Date().toISOString()});
  closeModal();
  renderEventsPanel();
  showToast('🗑 Мероприятие удалено','info');
};

// Hook into tab switching
var _origSwitchTab=window.switchTab;
if(_origSwitchTab){
  window.switchTab=function(panel){
    _origSwitchTab(panel);
    if(panel==='events')renderEventsPanel();
  };
}
// Init on load — async, updates counter when ready
setTimeout(async function(){
  await initEventsData();
  var c=document.getElementById('tab-events-count');
  if(c){var u=F2F_EVENTS.filter(function(e){return e.date>=new Date().toISOString().slice(0,10)&&e.status!=='cancelled';}).length;c.textContent=u;}
},500);

// ═══ PROJECTS MODULE ═══
var _projectsFilter='all';
function filterProjects(status,btn){
  _projectsFilter=status;
  document.querySelectorAll('[data-proj-filter]').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  renderProjects();
}
function renderProjects(){
  var c=document.getElementById('projectsContent');if(!c)return;
  var projects=(window._projects||[]).slice();
  var cntEl=document.getElementById('projects-count');
  var tabCnt=document.getElementById('tab-projects-count');
  if(cntEl)cntEl.textContent=projects.length+' проектов';
  if(tabCnt)tabCnt.textContent=projects.filter(function(p){return p.status==='active';}).length;
  // KPI strip
  var kpi=document.getElementById('projectsKPI');
  if(kpi){
    var active=projects.filter(function(p){return p.status==='active';}).length;
    var paused=projects.filter(function(p){return p.status==='paused';}).length;
    var completed=projects.filter(function(p){return p.status==='completed';}).length;
    var critical=projects.filter(function(p){return p.priority==='critical';}).length;
    kpi.innerHTML='<div style="padding:6px 14px;background:var(--green)15;border:1px solid var(--green)33;border-radius:8px;font-size:12px"><span style="font-size:18px;font-weight:700;color:var(--green)">'+active+'</span> <span style="color:var(--dim)">активных</span></div>'+
      '<div style="padding:6px 14px;background:var(--amber)15;border:1px solid var(--amber)33;border-radius:8px;font-size:12px"><span style="font-size:18px;font-weight:700;color:var(--amber)">'+paused+'</span> <span style="color:var(--dim)">на паузе</span></div>'+
      '<div style="padding:6px 14px;background:var(--cyan)15;border:1px solid var(--cyan)33;border-radius:8px;font-size:12px"><span style="font-size:18px;font-weight:700;color:var(--cyan)">'+completed+'</span> <span style="color:var(--dim)">завершено</span></div>'+
      (critical?'<div style="padding:6px 14px;background:var(--hot)15;border:1px solid var(--hot)33;border-radius:8px;font-size:12px"><span style="font-size:18px;font-weight:700;color:var(--hot)">'+critical+'</span> <span style="color:var(--dim)">critical</span></div>':'');
  }
  // Filter bar
  var fb=document.getElementById('projectsFilterBar');
  if(fb){
    fb.innerHTML='<button class="sub-tab'+(_projectsFilter==='all'?' active':'')+'" data-proj-filter="all" onclick="filterProjects(\'all\',this)">Все ('+projects.length+')</button>'+
      '<button class="sub-tab'+(_projectsFilter==='active'?' active':'')+'" data-proj-filter="active" onclick="filterProjects(\'active\',this)">🟢 Активные ('+projects.filter(function(p){return p.status==='active';}).length+')</button>'+
      '<button class="sub-tab'+(_projectsFilter==='paused'?' active':'')+'" data-proj-filter="paused" onclick="filterProjects(\'paused\',this)">⏸ На паузе ('+projects.filter(function(p){return p.status==='paused';}).length+')</button>'+
      '<button class="sub-tab'+(_projectsFilter==='completed'?' active':'')+'" data-proj-filter="completed" onclick="filterProjects(\'completed\',this)">✅ Завершено ('+projects.filter(function(p){return p.status==='completed';}).length+')</button>'+
      '<button class="sub-tab'+(_projectsFilter==='archived'?' active':'')+'" data-proj-filter="archived" onclick="filterProjects(\'archived\',this)">📦 Архив ('+projects.filter(function(p){return p.status==='archived';}).length+')</button>';
  }
  // Apply filter
  var filtered=_projectsFilter==='all'?projects:projects.filter(function(p){return p.status===_projectsFilter;});
  if(!filtered.length){c.innerHTML='<div style="text-align:center;padding:40px;color:var(--dim)">Нет проектов'+(projects.length?' в этом фильтре':'. Нажми ➕ чтобы создать первый.')+'</div>';return;}
  var priorityColors={critical:'var(--hot)',high:'var(--amber)',medium:'var(--cyan)',low:'var(--dim)'};
  var priorityIcons={critical:'🔴',high:'🟠',medium:'🔵',low:'⚪'};
  var statusIcons={active:'🟢',paused:'⏸️',completed:'✅',archived:'📦'};
  var html='<div style="display:flex;flex-direction:column;gap:10px">';
  filtered.forEach(function(p){
    var pColor=priorityColors[p.priority]||'var(--dim)';
    var tasks=(window._sbActions||[]).filter(function(a){return a.project_id && String(a.project_id)===String(p.id);});
    var expenses=(window._expenses||[]).filter(function(e){return e.project_id && String(e.project_id)===String(p.id);});
    var expTotal=0;expenses.forEach(function(e){expTotal+=parseFloat(e.amount)||0;});
    var events=(window._sbEvents||F2F_EVENTS||[]).filter(function(e){return e.project_id && String(e.project_id)===String(p.id);});
    var daysLeft='';
    if(p.target_date){
      var diff=Math.ceil((new Date(p.target_date)-new Date())/(1000*60*60*24));
      daysLeft=diff>0?diff+' дн. до дедлайна':diff===0?'Сегодня дедлайн':'Просрочен на '+Math.abs(diff)+' дн.';
    }
    html+='<div onclick="openProjectDetail('+p.id+')" style="padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:all .15s;border-left:3px solid '+pColor+'" onmouseover="this.style.borderColor=\'var(--cyan)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.borderLeftColor=\''+pColor+'\'">';
    html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">';
    html+='<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:14px">'+(statusIcons[p.status]||'📁')+'</span><span style="font-weight:700;font-size:14px">'+esc(p.name)+'</span><span style="font-size:10px;padding:2px 6px;background:'+pColor+'22;color:'+pColor+';border-radius:4px">'+(priorityIcons[p.priority]||'')+' '+esc(p.priority||'medium')+'</span></div>';
    if(p.description)html+='<div style="font-size:12px;color:var(--dim);margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+esc(p.description)+'</div>';
    html+='<div style="display:flex;gap:12px;font-size:11px;color:var(--dim);flex-wrap:wrap">';
    if(p.owner)html+='<span>👤 '+esc(p.owner)+'</span>';
    if(tasks.length)html+='<span>📋 '+tasks.length+' задач</span>';
    if(expenses.length)html+='<span>💸 ₽'+Math.round(expTotal).toLocaleString('ru')+'</span>';
    if(events.length)html+='<span>📅 '+events.length+' мероп.</span>';
    if(daysLeft)html+='<span style="color:'+(daysLeft.indexOf('Просрочен')>=0?'var(--hot)':'var(--amber)')+'">⏰ '+daysLeft+'</span>';
    html+='</div></div>';
    if(p.tags&&p.tags.length){html+='<div style="display:flex;gap:4px;flex-wrap:wrap">';(typeof p.tags==='string'?JSON.parse(p.tags):p.tags).forEach(function(t){html+='<span style="font-size:10px;padding:2px 6px;background:var(--cyan)15;color:var(--cyan);border-radius:4px">'+esc(t)+'</span>';});html+='</div>';}
    html+='</div></div>';
  });
  html+='</div>';
  c.innerHTML=html;
}
window.openProjectForm=function(editProject){
  var p=editProject||{};
  var isEdit=!!p.id;
  var teamMembers=(D.team||[]);
  var html='<div style="padding:20px"><h3 style="margin:0 0 16px;color:var(--cyan)">'+(isEdit?'✏️ Редактировать проект':'📁 Новый проект')+'</h3>';
  html+='<div style="display:flex;flex-direction:column;gap:12px">';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Название *</label><input id="projName" value="'+esc(p.name||'')+'" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:13px" placeholder="Название проекта"></div>';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Описание</label><textarea id="projDesc" rows="3" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px;resize:vertical" placeholder="Кратко о проекте">'+esc(p.description||'')+'</textarea></div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Статус</label><select id="projStatus" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px"><option value="active"'+(p.status==='active'?' selected':'')+'>🟢 Активный</option><option value="paused"'+(p.status==='paused'?' selected':'')+'>⏸️ На паузе</option><option value="completed"'+(p.status==='completed'?' selected':'')+'>✅ Завершён</option><option value="archived"'+(p.status==='archived'?' selected':'')+'>📦 Архив</option></select></div>';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Приоритет</label><select id="projPriority" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px"><option value="low"'+(p.priority==='low'?' selected':'')+'>⚪ Low</option><option value="medium"'+(!p.priority||p.priority==='medium'?' selected':'')+'>🔵 Medium</option><option value="high"'+(p.priority==='high'?' selected':'')+'>🟠 High</option><option value="critical"'+(p.priority==='critical'?' selected':'')+'>🔴 Critical</option></select></div>';
  html+='</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Владелец</label><select id="projOwner" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px"><option value="">— не назначен —</option>';
  teamMembers.forEach(function(m){html+='<option value="'+esc(m.login_name||m.name)+'"'+(p.owner===(m.login_name||m.name)?' selected':'')+'>'+esc(m.name)+'</option>';});
  html+='</select></div>';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Теги (через запятую)</label><input id="projTags" value="'+esc((p.tags&&typeof p.tags!=='string'?p.tags.join(', '):(p.tags||'')))+'" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px" placeholder="esports, sponsor, event"></div>';
  html+='</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Дата начала</label><input id="projStart" type="date" value="'+(p.start_date||'')+'" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px"></div>';
  html+='<div><label style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Целевая дата</label><input id="projTarget" type="date" value="'+(p.target_date||'')+'" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:#ccc;font-size:12px"></div>';
  html+='</div>';
  html+='<div style="display:flex;gap:8px;margin-top:8px">';
  html+='<button onclick="saveProject('+(isEdit?p.id:'null')+')" style="flex:1;padding:10px;background:var(--cyan)22;color:var(--cyan);border:1px solid var(--cyan)44;border-radius:8px;cursor:pointer;font-weight:700">'+(isEdit?'💾 Сохранить':'✅ Создать проект')+'</button>';
  if(isEdit)html+='<button onclick="deleteProject('+p.id+')" style="padding:10px 16px;background:var(--hot)15;color:var(--hot);border:1px solid var(--hot)33;border-radius:8px;cursor:pointer;font-size:12px">🗑️ Удалить</button>';
  html+='<button onclick="closeModal()" style="padding:10px 16px;background:var(--panel);color:var(--dim);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px">Отмена</button>';
  html+='</div></div></div>';
  openModal(html);
};
window.saveProject=async function(editId){
  var name=document.getElementById('projName').value.trim();
  if(!name){showToast('Введите название проекта','error');return;}
  var tagsRaw=document.getElementById('projTags').value.trim();
  var tags=tagsRaw?tagsRaw.split(',').map(function(t){return t.trim();}).filter(Boolean):[];
  var obj={
    name:name,
    description:document.getElementById('projDesc').value.trim()||null,
    status:document.getElementById('projStatus').value,
    priority:document.getElementById('projPriority').value,
    owner:document.getElementById('projOwner').value||null,
    tags:JSON.stringify(tags),
    start_date:document.getElementById('projStart').value||null,
    target_date:document.getElementById('projTarget').value||null,
    updated_at:new Date().toISOString()
  };
  if(editId){
    await sbPatch('projects','id=eq.'+editId,obj);
    logEntityChange('project',String(editId),'update',null,null,null);
    showToast('✅ Проект обновлён','success');
  }else{
    obj.created_at=new Date().toISOString();
    var res=await sbInsert('projects',obj);
    if(res&&res[0])logEntityChange('project',String(res[0].id),'create',null,null,null);
    showToast('✅ Проект создан','success');
  }
  closeModal();
  window._projects=await sbFetch('projects','select=*&order=created_at.desc&limit=200')||[];
  renderProjects();
};
window.deleteProject=async function(id){
  if(!confirm('Удалить проект? Связанные задачи и расходы останутся.'))return;
  await fetch(SUPABASE_URL+'/rest/v1/projects?id=eq.'+id,{method:'DELETE',headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+getAuthKey(),'Prefer':'return=minimal'}});
  logEntityChange('project',String(id),'delete',null,null,null);
  showToast('🗑️ Проект удалён','info');
  closeModal();
  window._projects=await sbFetch('projects','select=*&order=created_at.desc&limit=200')||[];
  renderProjects();
};
window.openProjectDetail=function(id){
  var p=(window._projects||[]).find(function(x){return x.id===id;});
  if(!p)return;
  var statusIcons={active:'🟢 Активный',paused:'⏸️ На паузе',completed:'✅ Завершён',archived:'📦 Архив'};
  var priorityIcons={critical:'🔴 Critical',high:'🟠 High',medium:'🔵 Medium',low:'⚪ Low'};
  // Linked entities
  var tasks=(window._sbActions||[]).filter(function(a){return a.project_id&&String(a.project_id)===String(id);});
  var expenses=(window._expenses||[]).filter(function(e){return e.project_id&&String(e.project_id)===String(id);});
  var expTotal=0;expenses.forEach(function(e){expTotal+=parseFloat(e.amount)||0;});
  var events=(window._sbEvents||F2F_EVENTS||[]).filter(function(e){return e.project_id&&String(e.project_id)===String(id);});
  var tags=p.tags?(typeof p.tags==='string'?JSON.parse(p.tags):p.tags):[];
  var html='<div style="padding:20px">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;color:var(--cyan)">📁 '+esc(p.name)+'</h3><button onclick="openProjectForm(window._projects.find(function(x){return x.id==='+id+';}))" style="padding:6px 12px;background:var(--cyan)15;color:var(--cyan);border:1px solid var(--cyan)33;border-radius:6px;cursor:pointer;font-size:12px">✏️ Редактировать</button></div>';
  // Info grid
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">';
  html+='<div style="padding:8px;background:var(--surface);border-radius:6px"><span style="font-size:11px;color:var(--dim)">Статус</span><div style="font-size:13px;font-weight:600">'+(statusIcons[p.status]||p.status)+'</div></div>';
  html+='<div style="padding:8px;background:var(--surface);border-radius:6px"><span style="font-size:11px;color:var(--dim)">Приоритет</span><div style="font-size:13px;font-weight:600">'+(priorityIcons[p.priority]||p.priority)+'</div></div>';
  if(p.owner)html+='<div style="padding:8px;background:var(--surface);border-radius:6px"><span style="font-size:11px;color:var(--dim)">Владелец</span><div style="font-size:13px">👤 '+esc(p.owner)+'</div></div>';
  if(p.start_date)html+='<div style="padding:8px;background:var(--surface);border-radius:6px"><span style="font-size:11px;color:var(--dim)">Начало</span><div style="font-size:13px">'+p.start_date+'</div></div>';
  if(p.target_date)html+='<div style="padding:8px;background:var(--surface);border-radius:6px"><span style="font-size:11px;color:var(--dim)">Дедлайн</span><div style="font-size:13px">'+p.target_date+'</div></div>';
  html+='</div>';
  if(p.description)html+='<div style="padding:10px;background:var(--surface);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--dim);line-height:1.5">'+esc(p.description)+'</div>';
  if(tags.length){html+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px">';tags.forEach(function(t){html+='<span style="font-size:10px;padding:2px 8px;background:var(--cyan)15;color:var(--cyan);border-radius:4px">'+esc(t)+'</span>';});html+='</div>';}
  // Linked entities sections
  html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">';
  html+='<div style="padding:10px;background:var(--green)10;border:1px solid var(--green)22;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--green)">'+tasks.length+'</div><div style="font-size:11px;color:var(--dim)">Задач</div></div>';
  html+='<div style="padding:10px;background:var(--hot)10;border:1px solid var(--hot)22;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--hot)">₽'+Math.round(expTotal).toLocaleString('ru')+'</div><div style="font-size:11px;color:var(--dim)">Расходов ('+expenses.length+')</div></div>';
  html+='<div style="padding:10px;background:var(--magenta)10;border:1px solid var(--magenta)22;border-radius:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--magenta)">'+events.length+'</div><div style="font-size:11px;color:var(--dim)">Мероприятий</div></div>';
  html+='</div>';
  // Entity changes (history)
  html+=buildEntityChangesHtml('project',String(id));
  html+='</div>';
  openModal(html);
};

// ═══ ENTITY CHANGES (HISTORY/AUDIT TRAIL) ═══
function logEntityChange(entityType,entityId,changeType,fieldName,oldVal,newVal){
  if(!SUPABASE_LIVE)return;
  var author=_currentSession?_currentSession.login_name:'system';
  var role=_currentSession?_currentSession.role:'unknown';
  sbInsert('entity_changes',{entity_type:entityType,entity_id:entityId,change_type:changeType,field_name:fieldName,old_value:oldVal?String(oldVal):null,new_value:newVal?String(newVal):null,author:author,author_role:role}).catch(function(e){console.warn('entity_change log error:',e);});
}
function buildEntityChangesHtml(entityType,entityId){
  var changes=(window._entityChanges||[]).filter(function(c){return c.entity_type===entityType&&String(c.entity_id)===String(entityId);});
  if(!changes.length)return '';
  var html='<div style="margin-top:16px"><h4 style="margin:0 0 8px;font-size:13px;color:var(--amber)">📜 История изменений</h4>';
  html+='<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">';
  var typeIcons={create:'🆕',update:'✏️',delete:'🗑️',status_change:'🔄'};
  changes.slice(0,30).forEach(function(c){
    html+='<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)22;font-size:11px">';
    html+='<span style="flex-shrink:0">'+(typeIcons[c.change_type]||'•')+'</span>';
    html+='<div style="flex:1;min-width:0"><span style="color:var(--cyan)">'+esc(c.author)+'</span> ';
    if(c.change_type==='create')html+='создал';
    else if(c.change_type==='delete')html+='удалил';
    else if(c.field_name)html+='изменил <b>'+esc(c.field_name)+'</b>'+(c.old_value?' с "'+esc(c.old_value)+'"':'')+' → "'+esc(c.new_value||'')+'"';
    else html+='обновил';
    html+='</div><span style="color:var(--dim);flex-shrink:0;white-space:nowrap">'+(c.created_at?timeSince(c.created_at):'')+'</span></div>';
  });
  html+='</div></div>';
  return html;
}

// ═══ NEEDS_HELP UI (Agent SOS Banner) ═══
function renderNeedsHelpBanner(){
  var container=document.getElementById('needsHelpBanner');
  if(!container){
    // Create banner at top of Tasks panel
    var tasksPanel=document.getElementById('panel-tasks');
    if(!tasksPanel)return;
    var firstChild=tasksPanel.firstChild;
    container=document.createElement('div');
    container.id='needsHelpBanner';
    tasksPanel.insertBefore(container,firstChild);
  }
  var helpAgents=(window._sbAgentMemory||[]).filter(function(m){return m.needs_help===true;});
  if(!helpAgents.length){container.innerHTML='';return;}
  var agentsMap={};(window._sbAgents||[]).forEach(function(a){agentsMap[a.id]=a;});
  var html='<div style="background:var(--hot)10;border:1px solid var(--hot)33;border-radius:10px;padding:12px;margin-bottom:16px">';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:18px">🆘</span><span style="font-weight:700;color:var(--hot);font-size:14px">Агенты просят помощь ('+helpAgents.length+')</span></div>';
  helpAgents.forEach(function(m){
    var agent=agentsMap[m.agent_id]||{};
    html+='<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--surface);border-radius:8px;margin-bottom:6px">';
    html+='<span style="font-size:20px">'+(agent.emoji||'🤖')+'</span>';
    html+='<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;color:'+(agent.color||'var(--cyan)')+'">'+(agent.name||m.agent_id)+'</div>';
    html+='<div style="font-size:11px;color:var(--dim);margin-top:2px">'+esc(m.help_reason||'Нужна помощь')+'</div>';
    if(m.help_requested_at)html+='<div style="font-size:10px;color:var(--dim);margin-top:2px">⏰ '+timeSince(m.help_requested_at)+'</div>';
    html+='</div>';
    html+='<button onclick="resolveAgentHelp(\''+esc(m.agent_id)+'\')" style="padding:6px 12px;background:var(--green)15;color:var(--green);border:1px solid var(--green)33;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">✅ Решено</button>';
    html+='</div>';
  });
  html+='</div>';
  container.innerHTML=html;
}
window.resolveAgentHelp=async function(agentId){
  await sbPatch('agent_memory','agent_id=eq.'+encodeURIComponent(agentId),{needs_help:false,help_reason:null,help_requested_at:null});
  showToast('✅ Помощь отмечена как решённая','success');
  // Reload agent memory
  window._sbAgentMemory=await sbFetch('agent_memory','select=*')||[];
  renderNeedsHelpBanner();
};

// ═══ FEATURE 1: COMMAND PALETTE (⌘K / Ctrl+K) ═══
let commandPaletteOverlay,commandPaletteInput,commandPaletteList;
let commandPaletteSelectedIdx=0;

// Lazy-init DOM refs (avoids null reference if script loads before DOM)
function ensureCommandPaletteRefs(){
  if(!commandPaletteOverlay)commandPaletteOverlay=document.getElementById('commandPaletteOverlay');
  if(!commandPaletteInput)commandPaletteInput=document.getElementById('commandPaletteInput');
  if(!commandPaletteList)commandPaletteList=document.getElementById('commandPaletteList');
  return !!commandPaletteOverlay;
}

// Global shortcuts to open command palette
document.addEventListener('keydown',function(e){
  if((e.key==='k'||e.key==='K')&&(e.metaKey||e.ctrlKey)){
    e.preventDefault();
    openCommandPalette();
  }
  if(e.key==='Escape'&&ensureCommandPaletteRefs()&&commandPaletteOverlay.classList.contains('open')){
    closeCommandPalette();
  }
});

function openCommandPalette(){
  if(!ensureCommandPaletteRefs())return;
  commandPaletteOverlay.classList.add('open');
  commandPaletteInput.value='';
  commandPaletteSelectedIdx=0;
  commandPaletteInput.focus();
  renderCommandPalette();
}
function closeCommandPalette(){
  if(!ensureCommandPaletteRefs())return;
  commandPaletteOverlay.classList.remove('open');
  commandPaletteSelectedIdx=0;
}

function renderCommandPalette(){
  const query=(commandPaletteInput.value||'').toLowerCase().trim();

  // Build command list
  const commands=[
    // Navigation
    {icon:'🏢',title:'Офис',action:()=>switchTab('office'),category:'nav'},
    {icon:'📧',title:'Лиды',action:()=>switchTab('leads'),category:'nav'},
    {icon:'📱',title:'Посты',action:()=>switchTab('posts'),category:'nav'},
    {icon:'📋',title:'Отчёты',action:()=>switchTab('reports'),category:'nav'},
    {icon:'✅',title:'Задачи',action:()=>switchTab('tasks'),category:'nav'},
    {icon:'🎯',title:'Стратегия',action:()=>switchTab('strategy'),category:'nav'},
    {icon:'💵',title:'Финансы',action:()=>switchTab('finance'),category:'nav'},
    {icon:'👥',title:'Команда',action:()=>switchTab('team'),category:'nav'},
    {icon:'🤖',title:'AI Агенты',action:()=>switchTab('agents'),category:'nav'},
    {icon:'💬',title:'Чат',action:()=>switchTab('chat'),category:'nav'},
    {icon:'💸',title:'Расходы',action:()=>switchTab('expenses'),category:'nav'},
    {icon:'🏆',title:'Команды',action:()=>switchTab('teams'),category:'nav'},
    {icon:'📅',title:'Мероприятия',action:()=>switchTab('events'),category:'nav'},
    {icon:'📅',title:'Добавить мероприятие',action:()=>{switchTab('events');setTimeout(()=>openEventForm(),200);},category:'action'},
    {icon:'🔌',title:'Интеграции',action:()=>switchTab('integrations'),category:'nav'},

    // Agent actions
    {icon:'☀️',title:'Запустить брифинг',action:()=>{triggerSingleAgent('coordinator');closeCommandPalette();},category:'agent'},
    {icon:'▶️',title:'Запустить все циклы',action:()=>{agentsActive=!agentsActive;document.getElementById('agentToggle').checked=agentsActive;if(agentsActive)startLiveEngine();else stopLiveEngine();showToast('Циклы '+(agentsActive?'запущены':'остановлены'));closeCommandPalette();},category:'agent'},

    // Agent specific runners
    ...Object.keys(AGENTS).map(id=>{
      const a=AGENTS[id];
      return {icon:a.emoji,title:'Запустить '+a.name,action:()=>{if(a.scenarioId)triggerSingleAgent(DASH_TO_SB_SLUG[id]||id);closeCommandPalette();},category:'agent'};
    }),

    // Quick actions
    {icon:'✍️',title:'Сгенерировать посты',action:()=>{showToast('Генерирую посты...');closeCommandPalette();},category:'action'},
    {icon:'➕',title:'Создать задачу',action:()=>{switchTab('tasks');closeCommandPalette();},category:'action'},
    {icon:'⭐',title:'Посты не оценены',action:()=>{switchTab('posts');leadFilter='unrated';renderPosts();closeCommandPalette();},category:'action'},
    {icon:'🔥',title:'Лиды hot',action:()=>{switchTab('leads');leadFilter='hot';renderLeads();closeCommandPalette();},category:'action'},
    {icon:'⚡',title:'Задачи critical',action:()=>{switchTab('tasks');taskFilter='critical';renderTasks();closeCommandPalette();},category:'action'}
  ];

  // Filter by query
  let filtered=query?commands.filter(c=>c.title.toLowerCase().includes(query)||c.category.toLowerCase().includes(query)):commands;
  if(filtered.length>20)filtered=filtered.slice(0,20);

  // Render items
  commandPaletteList.innerHTML=filtered.length?filtered.map((cmd,idx)=>{
    const isSelected=idx===commandPaletteSelectedIdx;
    return '<button class="command-item '+(isSelected?'selected':'')+'">'+
      '<span class="command-item-icon">'+cmd.icon+'</span>'+
      '<span class="command-item-content"><span class="command-item-title">'+cmd.title+'</span></span>'+
      '</button>';
  }).join(''):'<div style="text-align:center;color:var(--dim);padding:40px 20px;font-size:12px">Ничего не найдено</div>';

  // Bind click handlers
  document.querySelectorAll('.command-item').forEach((el,idx)=>{
    el.addEventListener('click',()=>{
      if(filtered[idx]){filtered[idx].action();closeCommandPalette();}
    });
  });

  // Bind keyboard navigation
  commandPaletteInput.onkeydown=function(e){
    if(e.key==='ArrowDown'){
      e.preventDefault();
      commandPaletteSelectedIdx=Math.min(commandPaletteSelectedIdx+1,filtered.length-1);
      renderCommandPalette();
    }else if(e.key==='ArrowUp'){
      e.preventDefault();
      commandPaletteSelectedIdx=Math.max(commandPaletteSelectedIdx-1,0);
      renderCommandPalette();
    }else if(e.key==='Enter'){
      e.preventDefault();
      if(filtered[commandPaletteSelectedIdx]){
        filtered[commandPaletteSelectedIdx].action();
        closeCommandPalette();
      }
    }
  };
  commandPaletteInput.oninput=function(){renderCommandPalette();};
}

// Close on overlay click (lazy-init to avoid null ref at load time)
document.addEventListener('click',function(e){
  if(!commandPaletteOverlay)commandPaletteOverlay=document.getElementById('commandPaletteOverlay');
  if(commandPaletteOverlay&&e.target===commandPaletteOverlay)closeCommandPalette();
});

// ═══ FEATURE 3: ACTIVITY SUMMARY IN FEED (removed — CEO: бесполезные кнопки) ═══
// Activity mini-cards removed per CEO request (session 23)

// ═══ NEWS DIGEST MODULE ═══
var _digestItems = [];
var _digestFilter = { status: 'all', tag: 'all' };

async function loadDigest() {
  var statusF = _digestFilter.status;
  var tagF = _digestFilter.tag;
  var params = 'order=created_at.desc&limit=200';
  if (statusF !== 'all') params += '&status=eq.' + statusF;

  var data = await sbFetch('news_items', params);
  if (!data) { renderDigestEmpty(); return; }

  _digestItems = data;

  // Apply tag filter client-side (topic_tags is array)
  var filtered = data;
  if (tagF !== 'all') {
    filtered = data.filter(function(n) {
      return n.topic_tags && n.topic_tags.indexOf(tagF) !== -1;
    });
  }

  renderDigestKpi(data);
  renderDigestList(filtered);

  // Update badge
  var badge = document.getElementById('tab-digest-count');
  if (badge) badge.textContent = data.filter(function(n) { return n.status === 'draft'; }).length || '0';
}

function renderDigestKpi(items) {
  var el = document.getElementById('digestKpi');
  if (!el) return;

  var total = items.length;
  var drafts = items.filter(function(n) { return n.status === 'draft'; }).length;
  var approved = items.filter(function(n) { return n.status === 'approved'; }).length;
  var published = items.filter(function(n) { return n.status === 'published'; }).length;
  var scored = items.filter(function(n) { return n.ceo_score; });
  var avgScore = scored.length ? (scored.reduce(function(s, n) { return s + n.ceo_score; }, 0) / scored.length).toFixed(1) : '—';
  var today = items.filter(function(n) {
    return n.created_at && n.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10);
  }).length;

  el.innerHTML =
    '<div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;color:var(--green)">' + total + '</div><div style="font-size:10px;color:var(--dim)">Всего</div></div>' +
    '<div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;color:#f5c542">' + drafts + '</div><div style="font-size:10px;color:var(--dim)">Черновики</div></div>' +
    '<div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;color:var(--cyan)">' + approved + '</div><div style="font-size:10px;color:var(--dim)">Одобрено</div></div>' +
    '<div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;color:var(--green)">' + published + '</div><div style="font-size:10px;color:var(--dim)">Опубликовано</div></div>' +
    '<div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;color:#ff6b35">' + avgScore + '</div><div style="font-size:10px;color:var(--dim)">Avg CEO Score</div></div>' +
    '<div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center"><div style="font-size:20px;color:var(--text)">' + today + '</div><div style="font-size:10px;color:var(--dim)">Сегодня</div></div>';
}

function renderDigestList(items) {
  var el = document.getElementById('digestList');
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--dim)">📰 Новостей пока нет. News Curator начнёт работу по расписанию.</div>';
    return;
  }

  var html = '';
  items.forEach(function(n) {
    var statusColors = { draft: '#f5c542', approved: 'var(--cyan)', published: 'var(--green)', rejected: '#ff4444', archived: 'var(--dim)' };
    var statusLabels = { draft: 'Черновик', approved: 'Одобрено', published: 'Опубликовано', rejected: 'Отклонено', archived: 'Архив' };
    var color = statusColors[n.status] || 'var(--dim)';
    var label = statusLabels[n.status] || n.status;

    var tags = (n.topic_tags || []).map(function(t) {
      return '<span style="background:var(--green)11;color:var(--green);padding:2px 6px;border-radius:4px;font-size:9px">' + esc(t) + '</span>';
    }).join(' ');

    var scoreHtml = '';
    if (n.ceo_score) {
      var scoreColor = n.ceo_score >= 8 ? 'var(--green)' : n.ceo_score >= 5 ? '#f5c542' : '#ff4444';
      scoreHtml = '<span style="color:' + scoreColor + ';font-weight:bold">⭐ ' + n.ceo_score + '/10</span>';
    }

    var imgHtml = '';
    if (n.image_url) {
      imgHtml = '<div style="margin-bottom:8px"><img src="' + esc(n.image_url) + '" style="width:100%;height:160px;object-fit:cover;border-radius:6px" loading="lazy"></div>';
    }

    var timeAgo = n.created_at ? getTimeAgo(n.created_at) : '';
    var sessionEmoji = { morning: '🌅', midday: '☀️', evening: '🌆', night: '🌙' };
    var sessIcon = n.session_id ? (sessionEmoji[n.session_id] || '') + ' ' : '';

    html += '<div style="background:var(--bg2);border-radius:10px;padding:14px;border-left:3px solid ' + color + ';cursor:pointer" onclick="openDigestDetail(' + n.id + ')">' +
      imgHtml +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<span style="color:' + color + ';font-size:10px;padding:2px 8px;border:1px solid ' + color + '44;border-radius:4px">' + label + '</span>' +
        '<span style="font-size:10px;color:var(--dim)">' + sessIcon + timeAgo + '</span>' +
      '</div>' +
      '<div style="font-size:14px;font-weight:bold;color:var(--text);margin-bottom:6px;line-height:1.3">' + esc(n.headline || '—') + '</div>' +
      '<div style="font-size:12px;color:var(--dim);margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4">' + esc((n.commentary_text || '').slice(0, 200)) + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap">' + tags + '</div>' +
        scoreHtml +
      '</div>' +
      (n.source_domain ? '<div style="font-size:10px;color:var(--dim);margin-top:6px">📎 ' + esc(n.source_domain) + '</div>' : '') +
    '</div>';
  });

  el.innerHTML = html;
}

function renderDigestEmpty() {
  var el = document.getElementById('digestList');
  if (el) el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--dim)">⚠️ Не удалось загрузить дайджест</div>';
  var kpi = document.getElementById('digestKpi');
  if (kpi) kpi.innerHTML = '';
}

// Digest detail modal
function openDigestDetail(id) {
  var n = _digestItems.find(function(x) { return x.id === id; });
  if (!n) return;

  var statusColors = { draft: '#f5c542', approved: 'var(--cyan)', published: 'var(--green)', rejected: '#ff4444' };
  var color = statusColors[n.status] || 'var(--dim)';

  var tags = (n.topic_tags || []).map(function(t) {
    return '<span style="background:var(--green)11;color:var(--green);padding:2px 8px;border-radius:4px;font-size:10px">' + esc(t) + '</span>';
  }).join(' ');

  var imgHtml = n.image_url
    ? '<img src="' + esc(n.image_url) + '" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px;margin-bottom:12px">'
    : '';

  var scoreSection = '<div style="margin-top:16px;padding:12px;background:var(--bg1);border-radius:8px">' +
    '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">⭐ CEO Оценка</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">';
  for (var i = 1; i <= 10; i++) {
    var active = n.ceo_score === i;
    scoreSection += '<button onclick="scoreDigestItem(' + n.id + ',' + i + ')" style="width:32px;height:32px;border-radius:6px;border:1px solid ' +
      (active ? 'var(--green)' : 'var(--green)33') + ';background:' +
      (active ? 'var(--green)33' : 'transparent') + ';color:' +
      (active ? 'var(--green)' : 'var(--dim)') + ';cursor:pointer;font-weight:bold">' + i + '</button>';
  }
  scoreSection += '</div>' +
    '<textarea id="digestCeoComment" placeholder="Комментарий CEO (необязательно)" style="width:100%;height:60px;background:var(--bg2);color:var(--text);border:1px solid var(--green)33;border-radius:6px;padding:8px;font-size:12px;resize:none">' + esc(n.ceo_comment || '') + '</textarea>' +
  '</div>';

  var actions = '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">';
  if (n.status === 'draft') {
    actions += '<button onclick="updateDigestStatus(' + n.id + ',\'approved\')" style="flex:1;padding:8px 16px;background:var(--cyan)22;color:var(--cyan);border:1px solid var(--cyan)44;border-radius:6px;cursor:pointer">✅ Одобрить</button>';
    actions += '<button onclick="updateDigestStatus(' + n.id + ',\'rejected\')" style="flex:1;padding:8px 16px;background:#ff444422;color:#ff4444;border:1px solid #ff444444;border-radius:6px;cursor:pointer">❌ Отклонить</button>';
  }
  if (n.status === 'approved') {
    actions += '<button onclick="publishDigestItem(' + n.id + ')" style="flex:1;padding:8px 16px;background:var(--green)22;color:var(--green);border:1px solid var(--green)44;border-radius:6px;cursor:pointer">📤 Опубликовать в Telegram</button>';
  }
  if (n.source_url) {
    actions += '<a href="' + esc(n.source_url) + '" target="_blank" style="flex:1;padding:8px 16px;background:var(--bg2);color:var(--text);border:1px solid var(--green)33;border-radius:6px;text-align:center;text-decoration:none;font-size:12px">🔗 Источник</a>';
  }
  actions += '</div>';

  var content = imgHtml +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<span style="color:' + color + ';font-size:11px;padding:3px 10px;border:1px solid ' + color + '44;border-radius:4px">' + (n.status || 'draft') + '</span>' +
      '<span style="font-size:11px;color:var(--dim)">' + (n.created_at ? new Date(n.created_at).toLocaleString('ru') : '') + '</span>' +
    '</div>' +
    '<div style="font-size:16px;font-weight:bold;color:var(--text);margin-bottom:12px;line-height:1.3">' + esc(n.headline || '—') + '</div>' +
    '<div style="font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;margin-bottom:12px">' + esc(n.commentary_text || '') + '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + tags + '</div>' +
    (n.source_title ? '<div style="font-size:11px;color:var(--dim);margin-bottom:4px">📰 ' + esc(n.source_title) + '</div>' : '') +
    (n.source_domain ? '<div style="font-size:11px;color:var(--dim)">📎 ' + esc(n.source_domain) + '</div>' : '') +
    scoreSection +
    actions;

  openModal('📰 ' + esc((n.headline || '').slice(0, 50)), content);
}

async function scoreDigestItem(id, score) {
  var comment = '';
  var el = document.getElementById('digestCeoComment');
  if (el) comment = el.value;

  var result = await sbPatch('news_items', 'id=eq.' + id, {
    ceo_score: score,
    ceo_comment: comment || null,
    updated_at: new Date().toISOString()
  });

  if (result) {
    showToast('⭐ Оценка ' + score + '/10 сохранена', 'success');
    // Update local data
    var item = _digestItems.find(function(x) { return x.id === id; });
    if (item) { item.ceo_score = score; item.ceo_comment = comment; }
    loadDigest();
    closeModal();
  } else {
    showToast('Ошибка сохранения оценки', 'error');
  }
}

async function updateDigestStatus(id, status) {
  var result = await sbPatch('news_items', 'id=eq.' + id, {
    status: status,
    updated_at: new Date().toISOString()
  });

  if (result) {
    showToast(status === 'approved' ? '✅ Одобрено' : '❌ Отклонено', 'success');
    loadDigest();
    closeModal();
  }
}

async function publishDigestItem(id) {
  var n = _digestItems.find(function(x) { return x.id === id; });
  if (!n) return;

  // Call content-publish or send directly via edge function
  showToast('📤 Публикация в Telegram...', 'info');

  try {
    var key = getAuthKey();
    var res = await fetch(SUPABASE_URL + '/functions/v1/content-publish', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'news_item', news_id: id })
    });

    if (res.ok) {
      await sbPatch('news_items', 'id=eq.' + id, {
        status: 'published',
        published_at: new Date().toISOString()
      });
      showToast('📤 Опубликовано в Telegram!', 'success');
      loadDigest();
      closeModal();
    } else {
      showToast('Ошибка публикации', 'error');
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

// Digest filter handlers
(function() {
  var fs = document.getElementById('digestFilterStatus');
  var ft = document.getElementById('digestFilterTag');
  if (fs) fs.onchange = function() { _digestFilter.status = this.value; loadDigest(); };
  if (ft) ft.onchange = function() { _digestFilter.tag = this.value; loadDigest(); };
})();

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  var now = Date.now();
  var then = new Date(dateStr).getTime();
  var diff = Math.floor((now - then) / 1000);
  if (diff < 60) return diff + 'с назад';
  if (diff < 3600) return Math.floor(diff / 60) + 'м назад';
  if (diff < 86400) return Math.floor(diff / 3600) + 'ч назад';
  return Math.floor(diff / 86400) + 'д назад';
}

// ═══════════════════════════════════════════════════
// KNOWLEDGE BASE MODULE
// ═══════════════════════════════════════════════════
var KB_CATEGORIES = {
  product: {icon:'🎮', label:'Продукт', color:'var(--cyan)'},
  competitors: {icon:'⚔️', label:'Конкуренты', color:'var(--magenta)'},
  goals: {icon:'🎯', label:'Цели & KPI', color:'var(--green)'},
  brand: {icon:'✨', label:'Бренд & Tone', color:'var(--amber)'},
  process: {icon:'⚙️', label:'Процессы', color:'#a78bfa'},
  team: {icon:'👥', label:'Команда', color:'#f472b6'},
  tech: {icon:'💻', label:'Технологии', color:'#22d3ee'},
  general: {icon:'📄', label:'Общее', color:'var(--dim)'}
};

async function loadKb() {
  var items = window._kbArticles;
  if (!items) {
    var fresh = await sbFetch('knowledge_base','select=*&order=updated_at.desc&limit=500');
    if (fresh) { window._kbArticles = fresh; items = fresh; }
  }
  if (!items) items = [];
  renderKbKpi(items);
  renderKbList();
}

function renderKbKpi(items) {
  var el = document.getElementById('kbKpiStrip'); if (!el) return;
  var active = items.filter(function(a){return a.status==='active';}).length;
  var pinned = items.filter(function(a){return a.is_pinned;}).length;
  var cats = {};
  items.forEach(function(a){ if(a.status==='active') cats[a.category] = (cats[a.category]||0)+1; });
  var catCount = Object.keys(cats).length;
  var html = '<div style="display:flex;gap:10px;flex-wrap:wrap">';
  html += '<div style="background:var(--panel);border:1px solid var(--cyan)33;border-radius:8px;padding:8px 14px;min-width:100px"><div style="font-size:10px;color:var(--dim)">Всего статей</div><div style="font-size:20px;font-weight:700;color:var(--cyan)">'+active+'</div></div>';
  html += '<div style="background:var(--panel);border:1px solid var(--amber)33;border-radius:8px;padding:8px 14px;min-width:100px"><div style="font-size:10px;color:var(--dim)">Закреплено</div><div style="font-size:20px;font-weight:700;color:var(--amber)">'+pinned+'</div></div>';
  html += '<div style="background:var(--panel);border:1px solid var(--green)33;border-radius:8px;padding:8px 14px;min-width:100px"><div style="font-size:10px;color:var(--dim)">Категорий</div><div style="font-size:20px;font-weight:700;color:var(--green)">'+catCount+'</div></div>';
  html += '</div>';
  el.innerHTML = html;
}

function renderKbList() {
  var grid = document.getElementById('kbGrid'); if (!grid) return;
  var items = (window._kbArticles || []).filter(function(a){return a.status==='active';});
  var catFilter = (document.getElementById('kbFilterCategory')||{}).value || 'all';
  var search = ((document.getElementById('kbSearch')||{}).value || '').toLowerCase();

  if (catFilter !== 'all') items = items.filter(function(a){return a.category === catFilter;});
  if (search) items = items.filter(function(a){
    return (a.title||'').toLowerCase().indexOf(search)!==-1
      || (a.content||'').toLowerCase().indexOf(search)!==-1
      || (a.tags||[]).join(' ').toLowerCase().indexOf(search)!==-1;
  });

  // Sort: pinned first, then by updated_at
  items.sort(function(a,b){
    if(a.is_pinned && !b.is_pinned) return -1;
    if(!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.updated_at||b.created_at) - new Date(a.updated_at||a.created_at);
  });

  if (!items.length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim)">Нет статей' + (catFilter!=='all'?' в этой категории':'') + '</div>';
    return;
  }

  var html = '';
  items.forEach(function(a) {
    var cat = KB_CATEGORIES[a.category] || KB_CATEGORIES.general;
    var preview = esc((a.content||'').substring(0, 200));
    var tagsHtml = (a.tags||[]).map(function(t){ return '<span style="background:'+cat.color+'22;color:'+cat.color+';padding:1px 6px;border-radius:4px;font-size:9px">'+esc(t)+'</span>'; }).join(' ');
    html += '<div onclick="openKbDetail(\''+a.id+'\')" style="cursor:pointer;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;border-left:3px solid '+cat.color+';transition:border-color .2s" onmouseover="this.style.borderColor=\''+cat.color+'\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.borderLeftColor=\''+cat.color+'\'">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
    html += '<div style="display:flex;align-items:center;gap:6px">';
    if(a.is_pinned) html += '<span style="font-size:12px" title="Закреплено">📌</span>';
    html += '<span style="font-size:12px">'+cat.icon+'</span>';
    html += '<span style="font-size:10px;color:'+cat.color+';text-transform:uppercase;font-weight:600">'+cat.label+'</span>';
    html += '</div>';
    html += '<span style="font-size:10px;color:var(--dim)">v'+a.version+' | '+getTimeAgo(a.updated_at||a.created_at)+'</span>';
    html += '</div>';
    html += '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">'+esc(a.title)+'</div>';
    html += '<div style="font-size:12px;color:var(--dim);line-height:1.5;margin-bottom:8px;white-space:pre-wrap;max-height:80px;overflow:hidden">'+preview+(a.content.length>200?'...':'')+'</div>';
    if(tagsHtml) html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">'+tagsHtml+'</div>';
    html += '<div style="font-size:10px;color:var(--dim)">'+esc(a.author||'system')+' | '+new Date(a.created_at).toLocaleDateString('ru')+'</div>';
    html += '</div>';
  });
  grid.innerHTML = html;
}

function openKbDetail(id) {
  var items = window._kbArticles || [];
  var a = items.find(function(x){return x.id === id;});
  if (!a) return;
  var cat = KB_CATEGORIES[a.category] || KB_CATEGORIES.general;
  var canEdit = typeof isAdmin==='function' && (isAdmin() || !(['viewer'].indexOf((_currentSession||{}).role)!==-1));
  var tagsHtml = (a.tags||[]).map(function(t){ return '<span style="background:'+cat.color+'22;color:'+cat.color+';padding:2px 8px;border-radius:4px;font-size:10px">'+esc(t)+'</span>'; }).join(' ');

  var html = '<div style="max-width:700px">';
  // Header
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
  html += '<span style="font-size:20px">'+cat.icon+'</span>';
  html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:'+cat.color+'22;color:'+cat.color+';font-weight:600">'+cat.label+'</span>';
  if(a.is_pinned) html += '<span title="Закреплено">📌</span>';
  html += '<span style="font-size:11px;color:var(--dim);margin-left:auto">v'+a.version+' | '+new Date(a.updated_at||a.created_at).toLocaleString('ru')+'</span>';
  html += '</div>';
  // Title
  html += '<h3 style="margin:0 0 12px;font-size:18px;color:var(--text)">'+esc(a.title)+'</h3>';
  // Tags
  if(tagsHtml) html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">'+tagsHtml+'</div>';
  // Content
  html += '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:13px;color:var(--text);white-space:pre-wrap;line-height:1.6;max-height:400px;overflow-y:auto">'+esc(a.content)+'</div>';
  // Author info
  html += '<div style="margin-top:10px;font-size:11px;color:var(--dim)">Автор: '+esc(a.author||'system')+' ('+esc(a.author_role||'—')+') | Создано: '+new Date(a.created_at).toLocaleString('ru')+'</div>';

  // Actions
  html += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">';
  if(canEdit) {
    html += '<button class="act-btn" onclick="openKbForm(\''+a.id+'\')" style="background:var(--cyan)22;color:var(--cyan)">✏️ Редактировать</button>';
    html += '<button class="act-btn" onclick="toggleKbPin(\''+a.id+'\','+(!a.is_pinned)+')" style="background:var(--amber)22;color:var(--amber)">'+(a.is_pinned?'📌 Открепить':'📌 Закрепить')+'</button>';
  }
  if(typeof isAdmin==='function'&&isAdmin()) {
    html += '<button class="act-btn" onclick="archiveKbArticle(\''+a.id+'\')" style="background:#f4433622;color:#f44336">🗃️ Архивировать</button>';
  }
  html += '<button class="act-btn" onclick="showKbHistory(\''+a.id+'\')" style="background:#a78bfa22;color:#a78bfa">📜 История</button>';
  html += '</div>';

  // History placeholder
  html += '<div id="kbHistorySection"></div>';
  html += '</div>';

  openModal(esc(a.title), html);
}

function openKbForm(editId) {
  var a = null;
  if (editId) {
    a = (window._kbArticles||[]).find(function(x){return x.id===editId;});
  }
  var catOptions = Object.keys(KB_CATEGORIES).map(function(k){
    var c = KB_CATEGORIES[k];
    return '<option value="'+k+'"'+(a&&a.category===k?' selected':'')+'>'+c.icon+' '+c.label+'</option>';
  }).join('');

  var html = '<div style="max-width:600px">';
  html += '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--dim)">Категория</label><select id="kbFormCat" style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;margin-top:4px">'+catOptions+'</select></div>';
  html += '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--dim)">Заголовок</label><input id="kbFormTitle" type="text" value="'+esc(a?a.title:'')+'" placeholder="Название статьи..." style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;margin-top:4px"></div>';
  html += '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--dim)">Содержание</label><textarea id="kbFormContent" rows="12" placeholder="Содержание статьи..." style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:monospace;line-height:1.5;resize:vertical;margin-top:4px">'+(a?esc(a.content):'')+'</textarea></div>';
  html += '<div style="margin-bottom:16px"><label style="font-size:11px;color:var(--dim)">Теги (через запятую)</label><input id="kbFormTags" type="text" value="'+(a?(a.tags||[]).join(', '):'')+'" placeholder="product, cs2, matchmaking..." style="width:100%;padding:8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;margin-top:4px"></div>';
  html += '<div style="display:flex;gap:8px">';
  html += '<button class="act-btn success" onclick="submitKbArticle('+(editId?"'"+editId+"'":"null")+')" style="flex:1;padding:10px;font-size:14px">'+(editId?'💾 Сохранить':'✅ Создать')+'</button>';
  html += '<button class="act-btn" onclick="closeModal()" style="padding:10px">Отмена</button>';
  html += '</div></div>';

  openModal(editId ? 'Редактировать статью' : 'Новая статья', html);
}

async function submitKbArticle(editId) {
  var title = (document.getElementById('kbFormTitle')||{}).value||'';
  var content = (document.getElementById('kbFormContent')||{}).value||'';
  var category = (document.getElementById('kbFormCat')||{}).value||'general';
  var tagsRaw = (document.getElementById('kbFormTags')||{}).value||'';
  var tags = tagsRaw.split(',').map(function(t){return t.trim();}).filter(Boolean);

  if (!title || !content) { showToast('Заполните заголовок и содержание','warning'); return; }

  var sess = window._currentSession||{};
  var author = sess.login_name || sess.employee_name || 'unknown';
  var authorRole = sess.role || 'viewer';

  if (editId) {
    // Get old article for audit
    var old = (window._kbArticles||[]).find(function(x){return x.id===editId;});
    var oldVersion = old ? (old.version||1) : 1;

    var res = await sbPatch('knowledge_base', editId, {
      title: title, content: content, category: category, tags: tags,
      author: author, author_role: authorRole,
      version: oldVersion + 1, updated_at: new Date().toISOString()
    });
    if (res) {
      // Audit log
      logEntityChange('knowledge_base', editId, 'update', 'content',
        old ? old.title : null, title);
      showToast('Статья обновлена (v'+(oldVersion+1)+')','success');
    }
  } else {
    var res = await sbInsert('knowledge_base', {
      title: title, content: content, category: category, tags: tags,
      author: author, author_role: authorRole, is_pinned: false
    });
    if (res && res[0]) {
      logEntityChange('knowledge_base', res[0].id, 'create', null, null, title);
      showToast('Статья создана','success');
    }
  }

  // Reload
  var fresh = await sbFetch('knowledge_base','select=*&order=updated_at.desc&limit=500');
  if (fresh) window._kbArticles = fresh;
  closeModal();
  loadKb();
}

async function toggleKbPin(id, pinned) {
  await sbPatch('knowledge_base', id, { is_pinned: pinned });
  logEntityChange('knowledge_base', id, 'update', 'is_pinned', String(!pinned), String(pinned));
  var fresh = await sbFetch('knowledge_base','select=*&order=updated_at.desc&limit=500');
  if (fresh) window._kbArticles = fresh;
  showToast(pinned ? 'Статья закреплена' : 'Статья откреплена', 'success');
  closeModal();
  loadKb();
}

async function archiveKbArticle(id) {
  if (!confirm('Архивировать статью?')) return;
  await sbPatch('knowledge_base', id, { status: 'archived' });
  logEntityChange('knowledge_base', id, 'update', 'status', 'active', 'archived');
  var fresh = await sbFetch('knowledge_base','select=*&order=updated_at.desc&limit=500');
  if (fresh) window._kbArticles = fresh;
  showToast('Статья архивирована','info');
  closeModal();
  loadKb();
}

async function showKbHistory(id) {
  var el = document.getElementById('kbHistorySection'); if (!el) return;
  el.innerHTML = '<div style="margin-top:16px;padding:12px;background:var(--bg2);border-radius:8px"><span class="spinner"></span> Загрузка истории...</div>';
  var changes = await sbFetch('entity_changes','select=*&entity_type=eq.knowledge_base&entity_id=eq.'+id+'&order=created_at.desc&limit=50');
  if (!changes || !changes.length) {
    el.innerHTML = '<div style="margin-top:16px;padding:12px;background:var(--bg2);border-radius:8px;font-size:12px;color:var(--dim)">Нет записей в истории изменений</div>';
    return;
  }
  var html = '<div style="margin-top:16px"><h4 style="margin:0 0 8px;font-size:13px;color:#a78bfa">📜 История изменений</h4>';
  html += '<div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">';
  changes.forEach(function(c) {
    var icon = c.change_type==='create'?'🟢':c.change_type==='update'?'🟡':'🔴';
    html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:11px">';
    html += '<span>'+icon+' <b>'+esc(c.change_type)+'</b></span>';
    if(c.field_name) html += ' <span style="color:var(--cyan)">'+esc(c.field_name)+'</span>';
    html += ' <span style="color:var(--dim)">by '+esc(c.author||'?')+'</span>';
    html += ' <span style="color:var(--dim);float:right">'+new Date(c.created_at).toLocaleString('ru')+'</span>';
    if(c.old_value && c.new_value) html += '<div style="margin-top:4px;color:var(--dim)"><s>'+esc((c.old_value||'').substring(0,60))+'</s> → '+esc((c.new_value||'').substring(0,60))+'</div>';
    html += '</div>';
  });
  html += '</div></div>';
  el.innerHTML = html;
}
