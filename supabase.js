// ═══ SUPABASE CONFIG ═══
const SUPABASE_URL='https://cuvmjkavluixkbzblcie.supabase.co';
const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1dm1qa2F2bHVpeGtiemJsY2llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NDg4ODgsImV4cCI6MjA4OTMyNDg4OH0.Ie1xGbB45nELK0PbwnKgDu56yxhZugVEdXYoUQT7TG4';
let SUPABASE_LIVE=false;

// ═══ AUTH JWT (role-based access) ═══
// After login: auth-login Edge Function returns signed JWT with user_role claim
// This JWT is used for ALL API calls (instead of anon key)
// Anon key is ONLY used on login screen to call auth-login
window._authJWT=null;
function getAuthKey(){
  // If we have a signed JWT from auth-login, use it (role-based RLS)
  // Otherwise fall back to anon key (only works for auth_tokens SELECT)
  return window._authJWT || SUPABASE_ANON;
}
function setAuthJWT(jwt){
  window._authJWT=jwt;
  if(jwt){localStorage.setItem('f2f_jwt',jwt);}
  else{localStorage.removeItem('f2f_jwt');}
}
// Restore JWT from localStorage on page load
(function(){
  var saved=localStorage.getItem('f2f_jwt');
  if(saved){
    // Check if JWT is expired
    try{
      var parts=saved.split('.');
      var payload=JSON.parse(atob(parts[1]));
      if(payload.exp && payload.exp*1000 > Date.now()){
        window._authJWT=saved;
      } else {
        localStorage.removeItem('f2f_jwt');
      }
    }catch(e){localStorage.removeItem('f2f_jwt');}
  }
})();

// ═══ ERROR TRACKER ═══
window._sbErrors={count:0,last:null,tables:{}};
var _sbErrorToastLast=0;
function trackSbError(table,op,err){
  window._sbErrors.count++;
  window._sbErrors.last={table:table,op:op,error:String(err),time:new Date().toISOString()};
  if(!window._sbErrors.tables[table])window._sbErrors.tables[table]=0;
  window._sbErrors.tables[table]++;
  var now=Date.now();
  if(now-_sbErrorToastLast>10000&&typeof showToast==='function'){
    showToast('⚠️ Ошибка сохранения ('+table+'). Данные могут быть не сохранены.','warning');
    _sbErrorToastLast=now;
  }
}

// ═══ EDGE FUNCTION HEALTH CHECK ═══
window._edgeFuncStatus={ok:[],fail:[]};
async function checkEdgeFunctions(){
  var funcs=['agent-chat','quality-review','smm-generate','coordinator-briefing','agent-autonomous-cycle'];
  for(var i=0;i<funcs.length;i++){
    try{
      var r=await fetch(SUPABASE_URL+'/functions/v1/'+funcs[i],{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+SUPABASE_ANON},
        body:JSON.stringify({health_check:true}),
        signal:AbortSignal.timeout(8000)
      });
      if(r.ok||r.status===400)window._edgeFuncStatus.ok.push(funcs[i]);
      else window._edgeFuncStatus.fail.push(funcs[i]);
    }catch(e){window._edgeFuncStatus.fail.push(funcs[i]);}
  }
  if(window._edgeFuncStatus.fail.length>0){
    addFeed('coordinator','⚠️ '+window._edgeFuncStatus.fail.length+' Edge Functions недоступны: '+window._edgeFuncStatus.fail.join(', '));
  }
  console.log('🏥 Edge Functions:',window._edgeFuncStatus);
}

// ═══ FEED MEMORY LIMIT ═══
var _feedMemoryLimit=200;
function trimFeedMemory(){
  if(window._notifiedFeedIds&&window._notifiedFeedIds.size>_feedMemoryLimit){
    var arr=Array.from(window._notifiedFeedIds);
    window._notifiedFeedIds=new Set(arr.slice(arr.length-100));
  }
}

// Map Supabase agent slugs → dashboard agent IDs
const SB_SLUG_TO_DASH={
  'smm':'content','analyst':'market','bizdev':'leads',
  'outreach':'outreach','community':'social','coordinator':'coordinator',
  'lead_finder':'lead_finder','followup':'followup','art_director':'art_director','quality_controller':'quality_controller'
};
const DASH_TO_SB_SLUG={};
Object.keys(SB_SLUG_TO_DASH).forEach(k=>{DASH_TO_SB_SLUG[SB_SLUG_TO_DASH[k]]=k;});
// Store Supabase agents by slug for UUID lookup
window._sbAgents={};

// Generic Supabase REST fetch (10s timeout)
// Uses getAuthKey() — returns JWT after login, anon key before login
async function sbFetch(table,params=''){
  try{
    var key=getAuthKey();
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table+(params?'?'+params:''),{
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(10000)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase fetch error ('+table+'):',e);return null;}
}
async function sbPatch(table,filter,data){
  try{
    var key=getAuthKey();
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+filter,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify(data),
      signal:AbortSignal.timeout(10000)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase patch error ('+table+'):',e);trackSbError(table,'patch',e);return null;}
}
async function sbInsert(table,data){
  try{
    var key=getAuthKey();
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify(data),
      signal:AbortSignal.timeout(10000)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase insert error ('+table+'):',e);trackSbError(table,'insert',e);return null;}
}
// Upsert — insert or update on conflict
async function sbUpsert(table,data,onConflict){
  try{
    var key=getAuthKey();
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':'Bearer '+key,
        'Content-Type':'application/json',
        'Prefer':'return=representation,resolution=merge-duplicates'
      },
      body:JSON.stringify(data),
      signal:AbortSignal.timeout(10000)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase upsert error ('+table+'):',e);trackSbError(table,'upsert',e);return null;}
}
// Delete row
async function sbDelete(table,filter){
  try{
    var key=getAuthKey();
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+filter,{
      method:'DELETE',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'return=representation'},
      signal:AbortSignal.timeout(10000)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase delete error ('+table+'):',e);trackSbError(table,'delete',e);return null;}
}

// Fetch and merge Supabase data
async function syncSupabaseData(){
  // Fetch agents with their IDs for UUID→slug mapping
  const agents=await sbFetch('agents','select=id,slug,name,color,make_scenario_id,status,system_prompt&limit=20');
  if(!agents||agents.length===0)return false;

  window._sbAgents={};
  window._sbAgentById={};
  agents.forEach(a=>{window._sbAgents[a.slug]=a;window._sbAgentById[a.id]=a;});

  // Fetch agent memory WITH agent slug (join via agent_id)
  const memory=await sbFetch('agent_memory','select=agent_id,state,last_output,insights,next_action,tasks_done,cycle_number,created_at&order=created_at.desc');
  if(memory){
    // Group by agent_id, keep only latest per agent
    const latest={};
    memory.forEach(m=>{
      if(!latest[m.agent_id])latest[m.agent_id]=m;
    });
    // Enrich with slug
    window._sbMemory=Object.values(latest).map(m=>{
      const ag=window._sbAgentById[m.agent_id];
      return {...m, slug:ag?ag.slug:'unknown', dashId:ag?SB_SLUG_TO_DASH[ag.slug]:null};
    });
  }

  // Content queue
  const content=await sbFetch('content_queue','select=*&order=created_at.desc&limit=1000');
  if(content){
    window._sbContent=content;
    window._sbContentMerged=false;
  }

  // Partner pipeline
  const partners=await sbFetch('partner_pipeline','select=*&order=created_at.desc&limit=500');
  if(partners)window._sbPartners=partners;

  // Events
  const events=await sbFetch('events','select=*&order=created_at.desc&limit=500');
  if(events)window._sbEvents=events;

  // Metrics
  const metrics=await sbFetch('metrics','select=name,value,unit&order=recorded_at.desc');
  if(metrics){
    window._sbMetrics={};
    metrics.forEach(m=>{if(!window._sbMetrics[m.name])window._sbMetrics[m.name]=m;});
  }

  // Directives
  const dirs=await sbFetch('directives','select=key,value_json,active&active=eq.true');
  if(dirs)window._sbDirectives=dirs;

  // Reports
  const reports=await sbFetch('reports','select=id,agent_id,type_ab,summary,results,theses,metrics_json,approved_by_ceo,created_at&order=created_at.desc&limit=500');
  if(reports)window._sbReports=reports;

  // Actions (tasks)
  const actions=await sbFetch('actions','select=id,agent_id,type,payload_json,created_at&order=created_at.desc&limit=1000');
  if(actions)window._sbActions=actions;

  // Finance (legacy)
  const finance=await sbFetch('finance','select=*&order=created_at.desc&limit=500');
  if(finance)window._sbFinance=finance;

  // Finance Ledger v2 (new immutable ledger)
  const ledger=await sbFetch('finance_ledger','select=*&order=created_at.desc&limit=500');
  if(ledger)window._financeLedger=ledger;

  // AI Credits
  const credits=await sbFetch('ai_credits','select=agent_id,tokens_input,tokens_output,cost_usd,model,task_type,created_at&order=created_at.desc&limit=500');
  if(credits)window._sbCredits=credits;

  // Expense Entries (all roles can see own; admin sees all via RLS)
  const expenses=await sbFetch('expense_entries','select=*&order=created_at.desc&limit=500');
  if(expenses)window._expenses=expenses;

  // Team (only active — dismissed filtered on server side)
  const team=await sbFetch('team','select=*&order=id.asc');
  if(team)window._sbTeam=team;
  // Debug: log dismissed count
  if(team){var dismissed=team.filter(function(t){return t.status==='dismissed';});if(dismissed.length)console.log('📋 Team: '+team.length+' total, '+dismissed.length+' dismissed (filtered in UI)');}

  return true;
}

// Refresh UI after Supabase sync — SUPABASE-FIRST architecture
function refreshAfterSync(){
  // ═══ 1. LEADS: Replace mock D.leads with Supabase partner_pipeline ═══
  if(window._sbPartners&&window._sbPartners.length>0){
    // Reset merge flag so renderLeads re-processes
    window._sbPartnersMerged=false;
    // Remove ALL mock leads (keep only those with sbId OR localCreated from previous merge)
    D.leads=D.leads.filter(function(l){return l.sbId||l.localCreated;});
    // Re-merge from Supabase (renderLeads will add them)
  }

  // ═══ 2. POSTS: Reset merge flag so renderPosts re-merges fresh SB data ═══
  if(window._sbContent&&window._sbContent.length>0){
    window._sbContentMerged=false;
    // renderPosts() already removes non-SB posts when SB data exists
  }

  // ═══ 3. REPORTS: Merge Supabase reports into D.reports ═══
  if(window._sbReports&&window._sbReports.length>0){
    // Remove mock reports, keep only SB-sourced or local
    D.reports=D.reports.filter(function(r){return r.sbId||r.localCreated;});
    window._sbReports.forEach(function(r,i){
      if(D.reports.find(function(x){return x.sbId===r.id;}))return;
      var ag=window._sbAgentById&&r.agent_id?window._sbAgentById[r.agent_id]:null;
      var dashId=ag?SB_SLUG_TO_DASH[ag.slug]:'coordinator';
      // Parse JSON results from autonomous cycles/briefings
      var parsed=null;
      try{
        parsed=typeof r.results==='string'?JSON.parse(r.results):r.results;
      }catch(e){parsed=null;}
      // Build readable content from JSON
      var content='';
      var actionItems=[];
      if(parsed&&typeof parsed==='object'){
        if(parsed.title)content+='<b>'+parsed.title+'</b><br><br>';
        if(parsed.summary)content+=parsed.summary+'<br><br>';
        // Briefing sections
        if(parsed.sections){
          parsed.sections.forEach(function(s){content+='<b>'+s.heading+'</b><br>'+s.content+'<br><br>';});
        }
        // Insights/recommendations → content
        if(parsed.insights){content+='<b>Инсайты:</b><br>'+parsed.insights.map(function(x){return '• '+x;}).join('<br>')+'<br><br>';}
        if(parsed.competitor_updates){content+='<b>Конкуренты:</b><br>'+parsed.competitor_updates.map(function(x){return '• '+x.name+': '+x.update;}).join('<br>')+'<br><br>';}
        if(parsed.kpi_assessment)content+='<b>Оценка KPI:</b> '+parsed.kpi_assessment+'<br><br>';
        if(parsed.pipeline_review)content+='<b>Pipeline:</b> '+parsed.pipeline_review+'<br><br>';
        if(parsed.community_health)content+='<b>Сообщество:</b> '+parsed.community_health+'<br><br>';
        if(parsed.ai_spend_summary)content+='<b>AI расходы:</b> '+parsed.ai_spend_summary+'<br>';
        // Action items from various fields
        if(parsed.priorities)actionItems=actionItems.concat(parsed.priorities);
        if(parsed.recommendations)actionItems=actionItems.concat(parsed.recommendations);
        if(parsed.action_plan)actionItems=actionItems.concat(parsed.action_plan);
        if(parsed.followup_actions)actionItems=actionItems.concat(parsed.followup_actions.map(function(x){return (x.partner||'')+': '+x.action+' ['+x.priority+']';}));
        if(parsed.blockers)actionItems=actionItems.concat(parsed.blockers.map(function(b){return '⚠️ '+b;}));
      }
      if(!content)content=r.results||r.summary||'';
      if(!actionItems.length&&r.theses)actionItems=r.theses.split('\n').filter(function(t){return t.trim();});
      // Map type
      var rType='daily';
      if(r.type_ab==='morning')rType='morning';
      else if(r.type_ab==='evening')rType='evening';
      else if(r.type_ab==='weekly')rType='weekly';
      D.reports.push({
        id:7000+i, sbId:r.id, title:parsed&&parsed.title?parsed.title:(r.summary||'Отчёт'),
        type:rType,
        agentId:dashId, date:(r.created_at||'').slice(0,10),
        content:content,
        actionItems:actionItems,
        reviewed:r.approved_by_ceo||false, isLive:true
      });
    });
  }

  // ═══ 4. TASKS: Merge Supabase actions into D.tasks ═══
  if(window._sbActions&&window._sbActions.length>0){
    D.tasks=D.tasks.filter(function(t){return t.sbId||t.localCreated;});
    window._sbActions.forEach(function(a,i){
      if(D.tasks.find(function(x){return x.sbId===a.id;}))return;
      var ag=window._sbAgentById&&a.agent_id?window._sbAgentById[a.agent_id]:null;
      var dashId=ag?SB_SLUG_TO_DASH[ag.slug]:'coordinator';
      var p=a.payload_json||{};
      // Auto-triage: map action types to kanban statuses
      var autoKanban=p.kanban_status||p.status||'done';
      var autoStatus=p.status||'done';
      if(autoKanban==='pending'||autoKanban==='backlog'){
        var at=(a.type||'').toLowerCase();
        if(at.includes('lead_suggested')){autoKanban='backlog';autoStatus='pending';}
        else if(at.includes('email_template')){autoKanban='planned';autoStatus='pending';}
        else if(at.includes('task_from_chat')){autoKanban='backlog';autoStatus='pending';}
        else{autoKanban='backlog';autoStatus='pending';}
      }
      D.tasks.push({
        id:6000+i, sbId:a.id, title:p.title||p.description||a.type||'Действие',
        assignedTo:dashId, dept:ag?'':AGENTS[dashId]?.dept||'cmd',
        status:autoStatus, priority:p.priority||'normal',
        kanbanStatus:autoKanban,
        description:p.description||'', deadline:p.deadline||'', estimate:p.estimate||'',
        tags:p.tags||[], subtasks:p.subtasks||[], reworkCount:p.rework_count||0,
        reworkNotes:p.rework_notes||'',
        createdDate:(a.created_at||'').slice(0,10), completedDate:p.completed_at||(a.created_at||'').slice(0,10),
        result:p.result||null, isLive:true,
        _actionType:a.type||'', _payload:p
      });
    });
  }

  // ═══ 5. FINANCE: Use new finance_ledger v2 if available ═══
  // Legacy finance table support removed — using finance_ledger now

  // ═══ 6. KPI: Populate D.kpi from Supabase metrics ═══
  if(window._sbMetrics){
    var m=window._sbMetrics;
    if(m.leads_found) D.kpi.leadsFound=m.leads_found.value;
    if(m.posts_created) D.kpi.postsCreated=m.posts_created.value;
    if(m.partnerships_found) D.kpi.partnershipsFound=m.partnerships_found.value;
    if(m.partnerships) D.kpi.partnershipsFound=m.partnerships.value;
    if(m.mau) D.kpi.mau=m.mau.value;
    if(m.dau) D.kpi.dau=m.dau.value;
    if(m.revenue) D.kpi.revenue=m.revenue.value;
    if(m.registrations_monthly) D.kpi.registrations=m.registrations_monthly.value;
    if(m.cac) D.kpi.cac=m.cac.value;
    if(m.retention_d7) D.kpi.retentionD7=m.retention_d7.value;
    if(m.telegram_subscribers) D.kpi.tgSubs=m.telegram_subscribers.value;
  }
  // Always override counts from live arrays
  if(SUPABASE_LIVE){
    if(window._sbPartners) D.kpi.leadsFound=window._sbPartners.length;
    if(window._sbContent) D.kpi.postsCreated=window._sbContent.length;
  }

  // ═══ 6b. TEAM: Load from Supabase team table (with salary fields) ═══
  if(window._sbTeam&&window._sbTeam.length>0){
    var allTeam=window._sbTeam.map(function(t){
      return {
        id:t.id, name:t.name, role:t.role, category:t.category,
        dept:t.dept, isHead:t.is_head, status:t.status||'active',
        startDate:t.start_date, sbId:t.id,
        salary_usdt:t.salary_usdt||0, salary_rub:t.salary_rub||0,
        payment_type:t.payment_type||'usdt', payroll_start:t.payroll_start||null,
        dismissDate:t.dismiss_date||null, dismissReason:t.dismiss_reason||null, dismissComment:t.dismiss_comment||null
      };
    });
    D.team=allTeam.filter(function(t){return t.status==='active';});
    D.dismissed=allTeam.filter(function(t){return t.status==='dismissed';}).map(function(t){
      return {id:t.id, name:t.name, reason:t.dismissReason||'Уволен', dept:t.dept,
              dismissDate:t.dismissDate||'—', comment:t.dismissComment||''};
    });
    // Re-render team UI with fresh Supabase data
    if(typeof renderTeam==='function')renderTeam();
  }

  // ═══ 7. STRATEGY: Load from directives ═══
  if(window._sbDirectives){
    var strat=window._sbDirectives.find(function(d){return d.key==='company_strategy';});
    if(strat&&strat.value_json){
      var sv=typeof strat.value_json==='string'?JSON.parse(strat.value_json):strat.value_json;
      var el=document.getElementById('strategyText');
      if(el&&sv.mission_vision)el.value=sv.mission_vision;
    }
    // Load exchange rate from directives into financeExchangeRate
    if(typeof loadExchangeRateFromDirectives==='function')loadExchangeRateFromDirectives();
    // Load AI credit budget from directives
    if(typeof loadCreditBudgetFromDirectives==='function')loadCreditBudgetFromDirectives();
  }

  // ═══ 7b. AI CREDITS: Calculate real usage from ai_credits table ═══
  if(typeof calcCreditsFromSupabase==='function')calcCreditsFromSupabase();

  // ═══ 8. FEED: Loaded via section 5b (enriched events with dedup) ═══
  // REMOVED: old section 8 duplicated events from section 5b below

  // ═══ 8b. AGENT PROMPTS: Load from agents.system_prompt ═══
  if(typeof loadAgentPromptsFromSupabase==='function')loadAgentPromptsFromSupabase();

  // ═══ 9. Render everything (with error boundaries) ═══
  var _sr=typeof safeRender==='function'?safeRender:function(fn){fn();};
  if(typeof renderLeads==='function'){_sr(renderLeads,'leads');}
  if(typeof renderPosts==='function'){_sr(renderPosts,'posts');}
  if(typeof renderPostsAnalytics==='function'){_sr(renderPostsAnalytics,'postsAnalytics');}
  if(typeof renderReports==='function'){_sr(renderReports,'reports');}
  if(typeof renderTasks==='function'){_sr(renderTasks,'tasks');}
  if(typeof renderFinance==='function'){_sr(renderFinance,'finance');}
  if(typeof updateKPI==='function'){_sr(updateKPI,'kpi');}
  if(typeof renderAgentsPanel==='function'){_sr(renderAgentsPanel,'agents');}
  if(typeof renderIntegrations==='function'){_sr(renderIntegrations,'integrations');}
  if(typeof renderExpenses==='function'){_sr(renderExpenses,'expenses');}
  if(typeof renderAnalytics==='function'){_sr(renderAnalytics,'analytics');}
  if(typeof loadStrategy==='function'&&!window._stratLoaded){window._stratLoaded=true;_sr(loadStrategy,'strategy');}
  if(typeof renderStrategyProgress==='function'){_sr(renderStrategyProgress,'strategyProgress');}

  // Add meaningful Supabase events to feed (NOT raw post spam)
  if(SUPABASE_LIVE&&!window._sbFeedEnriched){
    window._sbFeedEnriched=true;

    // 1. Summary: how many posts are pending/approved (ONE line, not per-post)
    if(window._sbContent&&window._sbContent.length>0){
      var pending=window._sbContent.filter(c=>c.status==='pending_approval').length;
      var approved=window._sbContent.filter(c=>c.status==='approved').length;
      var published=window._sbContent.filter(c=>c.status==='published').length;
      if(pending>0) addFeed('content','⏳ '+pending+' постов ждут одобрения → перейди в "Посты"');
      if(approved>0) addFeed('content','✅ '+approved+' постов одобрено и готово к публикации');
      if(published>0) addFeed('content','📢 '+published+' постов опубликовано');
    }

    // 2. Recent partner activity
    if(window._sbPartners&&window._sbPartners.length>0){
      var newLeads=window._sbPartners.filter(p=>p.stage==='identified'||p.stage==='lead'||p.stage==='new').length;
      var contacted=window._sbPartners.filter(p=>p.stage==='contacted').length;
      if(newLeads>0) addFeed('leads','🆕 '+newLeads+' новых лидов в пайплайне');
      if(contacted>0) addFeed('outreach','📧 '+contacted+' лидов на стадии контакта');
    }

    // 3. Recent reports (last 10 only, not all 126)
    if(window._sbReports&&window._sbReports.length>0){
      var recentReports=window._sbReports.slice(0,10);
      recentReports.forEach(r=>{
        var ago=window._sbAgentById&&r.agent_id?window._sbAgentById[r.agent_id]:null;
        var dashId=ago?SB_SLUG_TO_DASH[ago.slug]:'coordinator';
        addFeed(dashId,'📋 Отчёт: '+(r.summary||r.type_ab||'').slice(0,80));
      });
    }

    // 4. Tasks/Actions summary
    if(window._sbActions&&window._sbActions.length>0){
      var pendingActions=window._sbActions.filter(a=>{
        var p=typeof a.payload_json==='string'?JSON.parse(a.payload_json):a.payload_json;
        return p&&p.status!=='executed';
      }).length;
      if(pendingActions>0) addFeed('coordinator','📌 '+pendingActions+' действий ожидают выполнения');
    }

    // 5. Agent health: list active agents
    var activeAgents=Object.keys(window._sbAgents||{}).length;
    if(activeAgents>0) addFeed('watchdog','🟢 '+activeAgents+' агентов онлайн | Supabase подключён');

    // 5b. Real Supabase events from events table (with full metadata for drill-down)
    // FIXED: 24h filter + dedup + max 30 items (was loading ALL 500 events with duplicates)
    if(window._sbEvents&&window._sbEvents.length>0){
      var now24=Date.now()-24*3600000;
      var seenTexts=new Set();
      // Collect existing feed texts for dedup
      feedItems.forEach(function(f){seenTexts.add(f.text.slice(0,50));});
      var addedCount=0;
      window._sbEvents.forEach(function(ev){
        if(addedCount>=30)return; // max 30 events in feed
        if(ev.created_at&&new Date(ev.created_at).getTime()<now24)return; // 24h only
        var m=typeof ev.metadata_json==='string'?JSON.parse(ev.metadata_json||'{}'):ev.metadata_json||{};
        if(m.source==='dashboard')return; // skip our own feed events
        var text=m.text||m.summary||ev.type||'Событие';
        if(text.length>120)text=text.slice(0,120)+'...';
        var textKey=text.slice(0,50);
        if(seenTexts.has(textKey))return; // dedup
        seenTexts.add(textKey);
        var agSlug=null;
        if(ev.agent_id&&window._sbAgentById&&window._sbAgentById[ev.agent_id])agSlug=window._sbAgentById[ev.agent_id].slug;
        var dashId=(agSlug&&SB_SLUG_TO_DASH[agSlug])?SB_SLUG_TO_DASH[agSlug]:'coordinator';
        var ago=ev.created_at?timeSince(ev.created_at):'';
        feedItems.push({
          id:++feedIdCounter,agentId:dashId,text:text,
          time:ago,fullTime:ev.created_at,color:(AGENTS[dashId]||{}).color||'#64748b',
          sbEvent:ev,sbMeta:m
        });
        addedCount++;
      });
      // Trim total feed to 50 max
      if(feedItems.length>50)feedItems.length=50;
      renderFeed();
    }

    // 6. Metrics highlights
    if(window._sbMetrics){
      var m=window._sbMetrics;
      if(m.dau) addFeed('kpi_updater','📊 DAU: '+m.dau.value+(m.dau.unit?' '+m.dau.unit:''));
      if(m.registrations) addFeed('kpi_updater','👤 Регистрации: '+m.registrations.value+'/мес');
      if(m.retention_d7) addFeed('market','📈 Retention D7: '+m.retention_d7.value+'%');
    }
  }
  // Update sync badge with count
  const liveCount=window._sbMemory?window._sbMemory.filter(m=>m.state==='working').length:0;
  const contentCount=window._sbContent?window._sbContent.length:0;
  const partnerCount=window._sbPartners?window._sbPartners.length:0;
  document.getElementById('syncBadge').textContent='● LIVE ('+partnerCount+' leads, '+contentCount+' posts)';
  document.getElementById('syncBadge').style.color='#00ff88';
}

// ═══ OFFICE LIVE STATUS SYNC ═══
// Reads Supabase events + content + agent_memory and maps to office agent visual statuses
function syncOfficeLiveStatus(){
  if(typeof setAgentLiveStatus!=='function')return;
  var now=Date.now();
  var recentWindow=30*60*1000; // 30 min window for "recent"

  // 1. Check events for recent activity per agent
  if(window._sbEvents&&window._sbEvents.length>0){
    // Build: agentSlug → latest event
    var agentLatest={};
    window._sbEvents.forEach(function(ev){
      var meta=ev.metadata_json;
      if(typeof meta==='string'){try{meta=JSON.parse(meta);}catch(e){meta={};}}
      if(!meta)meta={};
      var slug=meta.agent_slug||ev.agent_slug||'';
      var dashId=meta.agent_dash_id||(slug&&SB_SLUG_TO_DASH[slug])||'';
      if(!dashId)return;
      if(!agentLatest[dashId]){
        agentLatest[dashId]={type:ev.type||'',time:new Date(ev.created_at).getTime(),desc:((meta&&meta.description)||ev.type||'').slice(0,80)};
      }
    });
    Object.keys(agentLatest).forEach(function(dashId){
      var ev=agentLatest[dashId];
      var age=now-ev.time;
      if(age>recentWindow)return; // too old
      var type=ev.type||'';
      if(type.indexOf('error')!==-1||type.indexOf('fail')!==-1){
        setAgentLiveStatus(dashId,'error',ev.desc);
      }else if(type.indexOf('publish')!==-1){
        setAgentLiveStatus(dashId,'publishing',ev.desc);
      }else if(type.indexOf('approved')!==-1){
        setAgentLiveStatus(dashId,'approved',ev.desc);
      }else if(type.indexOf('rework')!==-1){
        setAgentLiveStatus(dashId,'rework',ev.desc);
      }else if(type.indexOf('cycle')!==-1||type.indexOf('run')!==-1){
        setAgentLiveStatus(dashId,'active',ev.desc);
      }
    });
  }

  // 2. Check agent_memory for working state
  if(window._sbMemory&&window._sbMemory.length>0){
    window._sbMemory.forEach(function(m){
      if(!m.dashId)return;
      var existing=window._agentLiveStatus?window._agentLiveStatus[m.dashId]:null;
      if(existing&&(now-existing.ts)<5000)return; // don't overwrite fresh event-based status
      if(m.state==='working'||m.state==='active'){
        setAgentLiveStatus(m.dashId,'active',(m.last_output||'').slice(0,60));
      }else if(m.state==='error'){
        setAgentLiveStatus(m.dashId,'error',(m.last_output||'').slice(0,60));
      }
    });
  }

  // 3. Check recent content queue for SMM agent
  if(window._sbContent&&window._sbContent.length>0){
    var recent=window._sbContent.filter(function(c){return (now-new Date(c.created_at).getTime())<recentWindow;});
    var published=recent.filter(function(c){return c.status==='published';});
    var rework=recent.filter(function(c){return c.status==='needs_rework';});
    if(published.length>0){
      var existing=window._agentLiveStatus?window._agentLiveStatus['content']:null;
      if(!existing||existing.status!=='publishing'){
        setAgentLiveStatus('content','publishing',published.length+' post(s) published');
      }
    }else if(rework.length>0){
      setAgentLiveStatus('content','rework',rework.length+' post(s) need rework');
    }
  }
}

async function initSupabase(){
  const ok=await syncSupabaseData();
  if(ok){
    SUPABASE_LIVE=true;
    console.log('✅ Supabase LIVE — agents: '+Object.keys(window._sbAgents).join(', '));
    refreshAfterSync();
    syncOfficeLiveStatus();
    setupRealtimeNotifications();
  }else{
    console.warn('⚠️ Supabase not reachable or empty — using f2f_data.js fallback');
    document.getElementById('syncBadge').textContent='● LOCAL DATA';
    document.getElementById('syncBadge').style.color='#ffb800';
  }
}

// Run after DOM ready + auto-refresh every 30s
// SECURITY: Only init Supabase if user is authenticated
function isAuthenticated(){
  var s=JSON.parse(localStorage.getItem('f2f_session')||'null')||JSON.parse(sessionStorage.getItem('f2f_session')||'null');
  return !!(s&&s.token);
}
window.addEventListener('load',()=>{
  if(isAuthenticated()){
    setTimeout(initSupabase,500);
  } else {
    console.log('🔒 Not authenticated — skipping Supabase init');
    document.getElementById('syncBadge').textContent='● OFFLINE';
    document.getElementById('syncBadge').style.color='#666';
  }
  setInterval(async()=>{
    if(!SUPABASE_LIVE||!isAuthenticated())return;
    try{
      await syncSupabaseData();
      refreshAfterSync();
      syncOfficeLiveStatus();
      console.log('🔄 Supabase auto-refresh OK — '+new Date().toLocaleTimeString('ru'));
      trimFeedMemory();
    }catch(e){console.warn('Auto-refresh error:',e);}
  },30000);
  // Health check edge functions on first load
  checkEdgeFunctions();
});

// ═══ REALTIME NOTIFICATIONS ═══
// Informative toasts for: posts, leads, events, errors
function setupRealtimeNotifications(){
  window._lastRealtimeCheck=new Date(Date.now()-60000).toISOString();
  window._notifiedIds=new Set();
  setInterval(async function(){
    if(!SUPABASE_LIVE||!isAuthenticated())return;
    try{
      var lastCheck=window._lastRealtimeCheck||new Date(Date.now()-60000).toISOString();
      var lc=encodeURIComponent(lastCheck);
      var toast=typeof showToast==='function'?showToast:function(){};

      // 1. ПОСТЫ — одобрены, опубликованы, на доработке
      var posts=await sbFetch('content_queue','select=id,status,content_text,qa_score,platform,created_at&created_at=gt.'+lc+'&order=created_at.desc&limit=5');
      if(posts&&posts.length>0){
        posts.forEach(function(p){
          if(window._notifiedIds.has('p_'+p.id))return;
          window._notifiedIds.add('p_'+p.id);
          var preview=(p.content_text||'').slice(0,50).replace(/\n/g,' ');
          if(p.status==='approved')toast('✅ Пост одобрен (QA: '+p.qa_score+'): «'+preview+'…»','success');
          else if(p.status==='published')toast('📢 Опубликован в '+((p.platform||'TG').toUpperCase())+': «'+preview+'…»','success');
          else if(p.status==='needs_rework')toast('🔄 На доработке (QA: '+p.qa_score+'): «'+preview+'…»','warning');
          else if(p.status==='rejected')toast('❌ Отклонён (QA: '+p.qa_score+'): «'+preview+'…»','error');
          else if(p.status==='pending_approval')toast('📝 Новый пост: «'+preview+'…»','info');
        });
      }

      // 2. ЛИДЫ — новые лиды в pipeline
      var leads=await sbFetch('partner_pipeline','select=id,company,name,stage,created_at&created_at=gt.'+lc+'&order=created_at.desc&limit=5');
      if(leads&&leads.length>0){
        leads.forEach(function(l){
          if(window._notifiedIds.has('l_'+l.id))return;
          window._notifiedIds.add('l_'+l.id);
          var comp=l.company||l.name||'Unknown';
          var stg=l.stage||'found';
          toast('🎯 Новый лид: '+comp+' ('+stg+')','info');
        });
      }

      // 3. ОШИБКИ — из events table
      var errs=await sbFetch('events','select=id,type,agent_id,metadata_json,created_at&type=like.*error*&created_at=gt.'+lc+'&order=created_at.desc&limit=5');
      if(errs&&errs.length>0){
        errs.forEach(function(ev){
          if(window._notifiedIds.has('e_'+ev.id))return;
          window._notifiedIds.add('e_'+ev.id);
          var m=ev.metadata_json;if(typeof m==='string'){try{m=JSON.parse(m);}catch(e){m={};}}if(!m)m={};
          var agName=m.agent_name||m.agent_slug||'Agent';
          var detail=(m.error||m.description||ev.type||'').slice(0,60);
          toast('❌ Ошибка ['+agName+']: '+detail,'error');
        });
      }

      // 4. МЕРОПРИЯТИЯ — новые или обновлённые
      var evts=await sbFetch('f2f_events','select=id,title,status,date,updated_at&updated_at=gt.'+lc+'&order=updated_at.desc&limit=3');
      if(evts&&evts.length>0){
        evts.forEach(function(ev){
          if(window._notifiedIds.has('ev_'+ev.id))return;
          window._notifiedIds.add('ev_'+ev.id);
          toast('📅 Мероприятие: '+ev.title+' ('+ev.date+') — '+(ev.status||'idea'),'info');
        });
      }

      // Visual effects on canvas for events
      var allEvs=await sbFetch('events','select=id,type,agent_id,metadata_json,created_at&created_at=gt.'+lc+'&order=created_at.desc&limit=5');
      if(allEvs&&allEvs.length>0&&typeof setAgentLiveStatus==='function'){
        allEvs.forEach(function(ev){
          var meta=ev.metadata_json;if(typeof meta==='string'){try{meta=JSON.parse(meta);}catch(e){meta={};}}if(!meta)meta={};
          var dashId=(meta.agent_dash_id)||(meta.agent_slug&&SB_SLUG_TO_DASH[meta.agent_slug])||'';
          if(dashId){
            var t=ev.type||'';
            var msg=(meta.description||t).slice(0,60);
            if(t.indexOf('publish')!==-1)setAgentLiveStatus(dashId,'publishing',msg);
            else if(t.indexOf('error')!==-1)setAgentLiveStatus(dashId,'error',msg);
            else if(t.indexOf('approved')!==-1)setAgentLiveStatus(dashId,'approved',msg);
            else if(t.indexOf('rework')!==-1)setAgentLiveStatus(dashId,'rework',msg);
            else setAgentLiveStatus(dashId,'active',msg);
          }
        });
      }

      // Cleanup notified IDs (keep last 200)
      if(window._notifiedIds.size>200){
        var arr=Array.from(window._notifiedIds);
        window._notifiedIds=new Set(arr.slice(arr.length-100));
      }
      window._lastRealtimeCheck=new Date().toISOString();
    }catch(e){
      console.warn('Realtime notification error:',e);
    }
  },30000);
}
