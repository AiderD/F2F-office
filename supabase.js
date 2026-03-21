// ═══ SUPABASE CONFIG ═══
const SUPABASE_URL='https://cuvmjkavluixkbzblcie.supabase.co';
const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1dm1qa2F2bHVpeGtiemJsY2llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NDg4ODgsImV4cCI6MjA4OTMyNDg4OH0.Ie1xGbB45nELK0PbwnKgDu56yxhZugVEdXYoUQT7TG4';
let SUPABASE_LIVE=false;

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

// Generic Supabase REST fetch
async function sbFetch(table,params=''){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table+(params?'?'+params:''),{
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,'Content-Type':'application/json'}
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase fetch error ('+table+'):',e);return null;}
}
async function sbPatch(table,filter,data){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+filter,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify(data)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase patch error ('+table+'):',e);return null;}
}
async function sbInsert(table,data){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table,{
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify(data)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase insert error ('+table+'):',e);return null;}
}
// Upsert — insert or update on conflict
async function sbUpsert(table,data,onConflict){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,
        'Content-Type':'application/json',
        'Prefer':'return=representation,resolution=merge-duplicates'
      },
      body:JSON.stringify(data)
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase upsert error ('+table+'):',e);return null;}
}
// Delete row
async function sbDelete(table,filter){
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+filter,{
      method:'DELETE',
      headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+SUPABASE_ANON,'Content-Type':'application/json','Prefer':'return=representation'}
    });
    if(!r.ok)throw new Error(r.status);
    return await r.json();
  }catch(e){console.warn('Supabase delete error ('+table+'):',e);return null;}
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
  const content=await sbFetch('content_queue','select=*&order=created_at.desc&limit=30');
  if(content){
    window._sbContent=content;
    window._sbContentMerged=false;
  }

  // Partner pipeline
  const partners=await sbFetch('partner_pipeline','select=*&order=created_at.desc&limit=20');
  if(partners)window._sbPartners=partners;

  // Events
  const events=await sbFetch('events','select=*&order=created_at.desc&limit=50');
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
  const reports=await sbFetch('reports','select=id,agent_id,type_ab,summary,results,theses,metrics_json,approved_by_ceo,created_at&order=created_at.desc&limit=50');
  if(reports)window._sbReports=reports;

  // Actions (tasks)
  const actions=await sbFetch('actions','select=id,agent_id,type,payload_json,created_at&order=created_at.desc&limit=50');
  if(actions)window._sbActions=actions;

  // Finance (legacy)
  const finance=await sbFetch('finance','select=*&order=created_at.desc&limit=50');
  if(finance)window._sbFinance=finance;

  // Finance Ledger v2 (new immutable ledger)
  const ledger=await sbFetch('finance_ledger','select=*&order=created_at.desc&limit=500');
  if(ledger)window._financeLedger=ledger;

  // AI Credits
  const credits=await sbFetch('ai_credits','select=agent_id,tokens_input,tokens_output,cost_usd,model,task_type,created_at&order=created_at.desc&limit=30');
  if(credits)window._sbCredits=credits;

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
    // Remove ALL mock leads (keep only those with sbId from previous merge)
    D.leads=D.leads.filter(function(l){return l.sbId;});
    // Re-merge from Supabase (renderLeads will add them)
  }

  // ═══ 2. POSTS: Reset merge flag so renderPosts re-merges fresh SB data ═══
  if(window._sbContent&&window._sbContent.length>0){
    window._sbContentMerged=false;
    // renderPosts() already removes non-SB posts when SB data exists
  }

  // ═══ 3. REPORTS: Merge Supabase reports into D.reports ═══
  if(window._sbReports&&window._sbReports.length>0){
    // Remove mock reports, keep only SB-sourced
    D.reports=D.reports.filter(function(r){return r.sbId;});
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
    D.tasks=D.tasks.filter(function(t){return t.sbId;});
    window._sbActions.forEach(function(a,i){
      if(D.tasks.find(function(x){return x.sbId===a.id;}))return;
      var ag=window._sbAgentById&&a.agent_id?window._sbAgentById[a.agent_id]:null;
      var dashId=ag?SB_SLUG_TO_DASH[ag.slug]:'coordinator';
      var p=a.payload_json||{};
      D.tasks.push({
        id:6000+i, sbId:a.id, title:p.title||p.description||a.type||'Действие',
        assignedTo:dashId, dept:ag?'':AGENTS[dashId]?.dept||'cmd',
        status:p.status||'done', priority:p.priority||'normal',
        kanbanStatus:p.kanban_status||p.status||'done',
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

  // ═══ 8. FEED: Restore from Supabase events ═══
  if(window._sbEvents&&window._sbEvents.length>0&&typeof feedItems!=='undefined'){
    // Only load once per session (don't re-add on auto-refresh)
    if(!window._sbFeedLoaded){
      window._sbFeedLoaded=true;
      window._sbEvents.forEach(function(ev){
        if(!ev.metadata_json)return;
        var meta=typeof ev.metadata_json==='string'?JSON.parse(ev.metadata_json):ev.metadata_json;
        if(!meta.text)return;
        var agId=meta.agent_dash_id||'coordinator';
        var ag=AGENTS[agId]||{color:'#64748b'};
        var t=new Date(ev.created_at);
        feedItems.push({
          id:feedItems.length+1,agentId:agId,text:meta.text,
          time:t.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}),
          fullTime:ev.created_at,color:ag.color
        });
      });
      if(typeof renderFeed==='function')renderFeed();
    }
  }

  // ═══ 8b. AGENT PROMPTS: Load from agents.system_prompt ═══
  if(typeof loadAgentPromptsFromSupabase==='function')loadAgentPromptsFromSupabase();

  // ═══ 9. Render everything ═══
  if(typeof renderLeads==='function'){renderLeads();}
  if(typeof renderPosts==='function'){renderPosts();}
  if(typeof renderReports==='function'){renderReports();}
  if(typeof renderTasks==='function'){renderTasks();}
  if(typeof renderFinance==='function'){renderFinance();}
  if(typeof updateKPI==='function'){updateKPI();}
  if(typeof renderAgentsPanel==='function'){renderAgentsPanel();}
  if(typeof renderIntegrations==='function'){renderIntegrations();}
  if(typeof renderAnalytics==='function'){renderAnalytics();}

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
      var newLeads=window._sbPartners.filter(p=>p.status==='lead'||p.status==='new').length;
      var contacted=window._sbPartners.filter(p=>p.status==='contacted').length;
      if(newLeads>0) addFeed('leads','🆕 '+newLeads+' новых лидов в пайплайне');
      if(contacted>0) addFeed('outreach','📧 '+contacted+' лидов на стадии контакта');
    }

    // 3. Recent reports
    if(window._sbReports&&window._sbReports.length>0){
      var recent=window._sbReports.slice(0,3);
      recent.forEach(r=>{
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

async function initSupabase(){
  const ok=await syncSupabaseData();
  if(ok){
    SUPABASE_LIVE=true;
    console.log('✅ Supabase LIVE — agents: '+Object.keys(window._sbAgents).join(', '));
    refreshAfterSync();
  }else{
    console.warn('⚠️ Supabase not reachable or empty — using f2f_data.js fallback');
    document.getElementById('syncBadge').textContent='● LOCAL DATA';
    document.getElementById('syncBadge').style.color='#ffb800';
  }
}

// Run after DOM ready + auto-refresh every 30s
// SECURITY: Only init Supabase if user is authenticated
function isAuthenticated(){
  var s=JSON.parse(sessionStorage.getItem('f2f_session')||'null');
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
      console.log('🔄 Supabase auto-refresh OK — '+new Date().toLocaleTimeString('ru'));
    }catch(e){console.warn('Auto-refresh error:',e);}
  },30000);
});
