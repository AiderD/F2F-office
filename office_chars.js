// ═══ F2F Office Character Engine v12 ═══
// Features: Walking, waypoints, boss office, click cards, LIVE STATUS,
//           particle effects, status indicators, hover tooltips, event animations

const FRAME_W = 32, FRAME_H = 64;           // 32x32 sit sprites (32w × 64h frames)
const RUN_FW = 16, RUN_FH = 32, RUN_SC = 2; // 16x16 run/idle sprites, draw at 2×

// ─── SPRITE LOADER ───
const charImages = {};
function loadCharSprite(name) {
  if (charImages[name]) return charImages[name];
  const img = new Image();
  img.src = 'chars/' + name + '.png';
  charImages[name] = img;
  return img;
}

// Load sit sprites (32x32 custom Character Generator)
['coord_sit', 'morning_sit', 'analyst_sit', 'smm_sit', 'community_sit',
 'bizdev_sit', 'outreach_sit', 'leadfind_sit', 'followup_sit',
 'processor_sit', 'watchdog_sit', 'kpi_sit', 'outreach_idle'
].forEach(n => loadCharSprite(n + '_32x32'));

// Load run sprites (16x16 LimeZu) — 384×32, 24 frames = 4 dirs × 6
['Adam_run', 'Alex_run', 'Amelia_run', 'Bob_run'].forEach(n => loadCharSprite(n + '_16x16'));
// Load idle sprites (16x16) — 64×32, 4 frames = 4 dirs × 1
['Adam_idle', 'Alex_idle', 'Amelia_idle', 'Bob_idle'].forEach(n => loadCharSprite(n + '_16x16'));
// Load idle_anim sprites (16x16) — 384×32, 24 frames = 4 dirs × 6
['Adam_idle_anim', 'Alex_idle_anim', 'Amelia_idle_anim', 'Bob_idle_anim'].forEach(n => loadCharSprite(n + '_16x16'));

// Agent → base LimeZu character name
const AGENT_BASE = {
  coordinator:'Adam', briefing:'Amelia', market:'Alex', content:'Bob',
  social:'Amelia', leads:'Adam', outreach:'Alex', lead_finder:'Bob',
  followup:'Amelia', processor:'Adam', watchdog:'Alex', kpi_updater:'Bob'
};

// ─── DRAWING HELPERS ───

// Draw 32x32 sit sprite (native 32×64, anchor = center-bottom)
function drawSitFrame(ctx, spriteName, frameIdx, x, y) {
  const img = charImages[spriteName];
  if (!img || !img.complete || img.width === 0) return;
  const total = Math.floor(img.width / FRAME_W);
  const idx = Math.min(Math.max(0, frameIdx), total - 1);
  const sh = Math.min(FRAME_H, img.height);
  ctx.drawImage(img,
    idx * FRAME_W, 0, FRAME_W, sh,
    Math.round(x - FRAME_W / 2), Math.round(y - 48),
    FRAME_W, sh
  );
}

// Draw 16x16 run sprite at 2× (directions: 0=DOWN, 1=UP, 2=LEFT, 3=RIGHT, 6 frames each)
function drawRunFrame(ctx, charName, dir, frame, x, y) {
  const img = charImages[charName + '_run_16x16'];
  if (!img || !img.complete || img.width === 0) return;
  const fpd = 6;
  const srcIdx = Math.min(dir * fpd + (frame % fpd), Math.floor(img.width / RUN_FW) - 1);
  ctx.drawImage(img,
    srcIdx * RUN_FW, 0, RUN_FW, RUN_FH,
    Math.round(x - RUN_FW * RUN_SC / 2), Math.round(y - RUN_FH * RUN_SC + 8),
    RUN_FW * RUN_SC, RUN_FH * RUN_SC
  );
}

// Draw 16x16 idle_anim sprite at 2× (standing animated, same layout as run)
function drawIdleAnimFrame(ctx, charName, dir, frame, x, y) {
  const img = charImages[charName + '_idle_anim_16x16'];
  if (!img || !img.complete || img.width === 0) {
    return drawIdleFrame(ctx, charName, dir, x, y);
  }
  const fpd = 6;
  const srcIdx = Math.min(dir * fpd + (frame % fpd), Math.floor(img.width / RUN_FW) - 1);
  ctx.drawImage(img,
    srcIdx * RUN_FW, 0, RUN_FW, RUN_FH,
    Math.round(x - RUN_FW * RUN_SC / 2), Math.round(y - RUN_FH * RUN_SC + 8),
    RUN_FW * RUN_SC, RUN_FH * RUN_SC
  );
}

// Draw 16x16 static idle (1 frame per direction)
function drawIdleFrame(ctx, charName, dir, x, y) {
  const img = charImages[charName + '_idle_16x16'];
  if (!img || !img.complete || img.width === 0) return;
  const srcIdx = Math.min(dir, Math.floor(img.width / RUN_FW) - 1);
  ctx.drawImage(img,
    srcIdx * RUN_FW, 0, RUN_FW, RUN_FH,
    Math.round(x - RUN_FW * RUN_SC / 2), Math.round(y - RUN_FH * RUN_SC + 8),
    RUN_FW * RUN_SC, RUN_FH * RUN_SC
  );
}

// ─── WAYPOINT GRAPH ───
const WP = {
  c0: {x:50, y:215},  c1: {x:100,y:215}, c2: {x:160,y:215}, c3: {x:200,y:215},
  c4: {x:260,y:215}, c5: {x:300,y:215}, c6: {x:365,y:215}, c7: {x:410,y:215},
  c8: {x:470,y:215},
  pass_top: {x:175, y:280},
  pass_mid: {x:175, y:310},
  pass_bot: {x:175, y:345},
  hall_l: {x:80,  y:380},
  hall_cl:{x:175, y:380},
  hall_c: {x:260, y:380},
  hall_cr:{x:340, y:380},
  hall_r: {x:430, y:380},
  cooler:  {x:240, y:405},
  coffee:  {x:215, y:445},
  plants:  {x:285, y:435},
  sofa:    {x:340, y:440},
  vending: {x:430, y:420},
  boss_entry: {x:80, y:380},
  boss_chair: {x:90, y:430},
};

const WP_EDGES = [
  ['c0','c1'],['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5'],['c5','c6'],['c6','c7'],['c7','c8'],
  ['c2','pass_top'],['c3','pass_top'],
  ['pass_top','pass_mid'],['pass_mid','pass_bot'],
  ['pass_bot','hall_cl'],
  ['hall_l','hall_cl'],['hall_cl','hall_c'],['hall_c','hall_cr'],['hall_cr','hall_r'],
  ['hall_c','cooler'],['cooler','coffee'],['cooler','plants'],
  ['hall_cr','sofa'],['hall_cr','plants'],
  ['hall_r','vending'],
  ['hall_l','boss_entry'],['boss_entry','boss_chair'],
];

const wpAdj = {};
Object.keys(WP).forEach(k => wpAdj[k] = []);
WP_EDGES.forEach(([a, b]) => { wpAdj[a].push(b); wpAdj[b].push(a); });

function wpPath(from, to) {
  if (from === to) return [from];
  const visited = new Set([from]);
  const queue = [[from]];
  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    for (const nb of (wpAdj[node] || [])) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      const np = [...path, nb];
      if (nb === to) return np;
      queue.push(np);
    }
  }
  return null;
}

function nearestCorridorWP(seatX) {
  let best = 'c3', bestD = Infinity;
  for (const k of Object.keys(WP)) {
    if (!k.startsWith('c') || k.includes('_') || k.length > 2) continue;
    const d = Math.abs(WP[k].x - seatX);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
}

// ═══ PARTICLE SYSTEM ═══
// Lightweight particles for event animations on the canvas
const _officeParticles = [];
const MAX_PARTICLES = 120;

function spawnParticles(x, y, color, count, opts) {
  opts = opts || {};
  var type = opts.type || 'burst'; // burst, rise, ring, spark
  var life = opts.life || 60;
  for (var i = 0; i < count && _officeParticles.length < MAX_PARTICLES; i++) {
    var angle, speed, p;
    if (type === 'burst') {
      angle = Math.random() * Math.PI * 2;
      speed = 0.5 + Math.random() * 2;
      p = {x:x, y:y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed-0.5,
           life:life, maxLife:life, color:color, size:1+Math.random()*2, type:'burst'};
    } else if (type === 'rise') {
      p = {x:x-6+Math.random()*12, y:y, vx:(Math.random()-0.5)*0.3, vy:-0.4-Math.random()*0.8,
           life:life, maxLife:life, color:color, size:1.5+Math.random()*1.5, type:'rise'};
    } else if (type === 'ring') {
      angle = (i / count) * Math.PI * 2;
      p = {x:x, y:y, vx:Math.cos(angle)*1.5, vy:Math.sin(angle)*1.5,
           life:life*0.6, maxLife:life*0.6, color:color, size:2, type:'ring'};
    } else if (type === 'spark') {
      angle = Math.random() * Math.PI * 2;
      speed = 1 + Math.random() * 3;
      p = {x:x, y:y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed,
           life:life*0.4, maxLife:life*0.4, color:color, size:1+Math.random(), type:'spark'};
    }
    if (p) _officeParticles.push(p);
  }
}

function updateAndDrawParticles(ctx) {
  for (var i = _officeParticles.length - 1; i >= 0; i--) {
    var p = _officeParticles[i];
    p.life--;
    if (p.life <= 0) { _officeParticles.splice(i, 1); continue; }
    p.x += p.vx;
    p.y += p.vy;
    if (p.type === 'burst') p.vy += 0.02; // gravity
    if (p.type === 'spark') { p.vx *= 0.96; p.vy *= 0.96; }
    var alpha = Math.min(1, p.life / p.maxLife * 1.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if (p.type === 'spark') {
      // Trail line
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(Math.round(p.x), Math.round(p.y), p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
    // Glow for ring/spark
    if (p.type === 'ring' || p.type === 'spark') {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      ctx.fill();
    }
    ctx.restore();
  }
}

// ═══ FLOATING TEXT SYSTEM ═══
// Short text animations that float up from agents
const _floatingTexts = [];

function spawnFloatingText(x, y, text, color) {
  _floatingTexts.push({
    x: x, y: y, text: text, color: color || '#00ff88',
    life: 90, maxLife: 90, vy: -0.4
  });
  if (_floatingTexts.length > 10) _floatingTexts.shift();
}

function updateAndDrawFloatingTexts(ctx) {
  for (var i = _floatingTexts.length - 1; i >= 0; i--) {
    var ft = _floatingTexts[i];
    ft.life--;
    if (ft.life <= 0) { _floatingTexts.splice(i, 1); continue; }
    ft.y += ft.vy;
    var alpha = Math.min(1, ft.life / ft.maxLife * 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 8px system-ui';
    ctx.textAlign = 'center';
    // Shadow for readability
    ctx.fillStyle = '#000';
    ctx.fillText(ft.text, Math.round(ft.x) + 1, Math.round(ft.y) + 1);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, Math.round(ft.x), Math.round(ft.y));
    ctx.restore();
  }
}

// ═══ LIVE STATUS SYSTEM ═══
// Maps agent IDs to their live operational status from Supabase
const _agentLiveStatus = {};
// Status types: 'active' (ran recently), 'idle' (no activity), 'error' (last run had error), 'publishing' (content published)

function setAgentLiveStatus(agentId, status, detail) {
  var prev = _agentLiveStatus[agentId];
  _agentLiveStatus[agentId] = {status: status, detail: detail || '', ts: Date.now()};
  // Trigger visual effect on status change
  var agent = officeAgents.find(function(a){ return a.id === agentId; });
  if (!agent) return;
  if (status === 'active' && (!prev || prev.status !== 'active')) {
    // Green burst when agent starts working
    spawnParticles(agent.seatX, agent.seatY - 30, '#00ff88', 8, {type:'rise', life:50});
    spawnFloatingText(agent.seatX, agent.seatY - 50, detail ? detail.slice(0,20) : 'Working...', '#00ff88');
  } else if (status === 'error') {
    // Red sparks on error
    spawnParticles(agent.seatX, agent.seatY - 20, '#ff4444', 12, {type:'spark', life:40});
    spawnFloatingText(agent.seatX, agent.seatY - 50, '⚠ Error', '#ff4444');
  } else if (status === 'publishing') {
    // Cyan ring + burst on publish
    spawnParticles(agent.seatX, agent.seatY - 25, '#00e5ff', 16, {type:'ring', life:50});
    spawnParticles(agent.seatX, agent.seatY - 25, '#00e5ff', 8, {type:'rise', life:60});
    spawnFloatingText(agent.seatX, agent.seatY - 55, '📢 Published!', '#00e5ff');
  } else if (status === 'rework') {
    // Orange spark on rework
    spawnParticles(agent.seatX, agent.seatY - 25, '#ffb800', 10, {type:'burst', life:45});
    spawnFloatingText(agent.seatX, agent.seatY - 50, '✏ Rework', '#ffb800');
  } else if (status === 'approved') {
    // Green ring on approval
    spawnParticles(agent.seatX, agent.seatY - 25, '#00ff88', 12, {type:'ring', life:50});
    spawnFloatingText(agent.seatX, agent.seatY - 55, '✅ Approved', '#00ff88');
  }
}

// Trigger a global office event animation (e.g. new lead, daily report)
function triggerOfficeEvent(type, agentId) {
  var agent = agentId ? officeAgents.find(function(a){ return a.id === agentId; }) : null;
  if (type === 'new_lead' && agent) {
    spawnParticles(agent.seatX, agent.seatY - 20, '#00ff88', 10, {type:'burst', life:50});
    spawnFloatingText(agent.seatX, agent.seatY - 50, '🆕 New Lead', '#00ff88');
  } else if (type === 'email_sent' && agent) {
    spawnParticles(agent.seatX, agent.seatY - 20, '#a78bfa', 6, {type:'rise', life:40});
    spawnFloatingText(agent.seatX, agent.seatY - 50, '📧 Email', '#a78bfa');
  } else if (type === 'report' && agent) {
    spawnParticles(agent.seatX, agent.seatY - 20, '#00e5ff', 8, {type:'rise', life:45});
    spawnFloatingText(agent.seatX, agent.seatY - 50, '📋 Report', '#00e5ff');
  } else if (type === 'morning_briefing') {
    // Broadcast: particles from all agents
    officeAgents.forEach(function(a) {
      spawnParticles(a.seatX, a.seatY - 30, '#ffb800', 4, {type:'rise', life:60});
    });
    spawnFloatingText(256, 150, '☀ Morning Briefing', '#ffb800');
  }
}

// ─── AGENT STATE MACHINE ───
const ST = { SIT:'sit', WALK:'walk', BREAK:'break' };
const BREAK_SPOTS = ['cooler','coffee','plants','sofa','vending'];

class OfficeAgent {
  constructor(id, name, color, sprite, x, y, frame, opts) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.sprite = sprite;
    this.seatX = x; this.seatY = y;
    this.seatFrame = frame;
    this.x = x; this.y = y;
    this.frame = frame;
    this.baseChar = AGENT_BASE[id] || 'Adam';

    // State
    this.state = ST.SIT;
    this.canBreak = !(opts && opts.noBreak);

    // Walk
    this.path = [];
    this.pathIdx = 0;
    this.pathProg = 0;
    this.walkDir = 0;
    this.walkFrame = 0;
    this.walkSpeed = 1.0 + Math.random() * 0.4;
    this._returning = false;
    this._breakWP = null;

    // Break timer
    this.nextBreak = Date.now() + 25000 + Math.random() * 55000;
    this.breakEnd = 0;
    this.idleFrame = 0;

    // Visual
    this.selected = false;
    this.hovered = false;
    this._glowPhase = Math.random() * Math.PI * 2;
    this._statusPulse = 0; // for status indicator animation
  }

  goBreak() {
    const corridorWP = nearestCorridorWP(this.seatX);
    const spot = BREAK_SPOTS[Math.floor(Math.random() * BREAK_SPOTS.length)];
    const route = wpPath(corridorWP, spot);
    if (!route || route.length < 2) return;
    this.path = [
      {x: this.seatX, y: this.seatY},
      WP[corridorWP],
      ...route.slice(1).map(k => WP[k])
    ];
    this.pathIdx = 0;
    this.pathProg = 0;
    this.walkFrame = 0;
    this.state = ST.WALK;
    this._returning = false;
    this._breakWP = spot;
  }

  goBack() {
    const spot = this._breakWP || 'cooler';
    const corridorWP = nearestCorridorWP(this.seatX);
    const route = wpPath(spot, corridorWP);
    if (!route || route.length < 2) {
      this.state = ST.SIT; this.x = this.seatX; this.y = this.seatY;
      return;
    }
    this.path = [
      WP[spot],
      ...route.slice(1).map(k => WP[k]),
      {x: this.seatX, y: this.seatY}
    ];
    this.pathIdx = 0;
    this.pathProg = 0;
    this.walkFrame = 0;
    this.state = ST.WALK;
    this._returning = true;
  }

  update() {
    const now = Date.now();
    this._statusPulse += 0.03;

    if (this.state === ST.SIT) {
      if (this.canBreak && now >= this.nextBreak) this.goBreak();
      return;
    }

    if (this.state === ST.BREAK) {
      this.idleFrame = (this.idleFrame + 0.06) % 6;
      if (now >= this.breakEnd) this.goBack();
      return;
    }

    // ST.WALK
    if (this.pathIdx >= this.path.length - 1) {
      if (this._returning) {
        this.state = ST.SIT;
        this.x = this.seatX; this.y = this.seatY;
        this._returning = false;
        this.nextBreak = now + 30000 + Math.random() * 60000;
      } else {
        this.state = ST.BREAK;
        this.breakEnd = now + 5000 + Math.random() * 10000;
        this.idleFrame = 0;
      }
      return;
    }

    const from = this.path[this.pathIdx];
    const to = this.path[this.pathIdx + 1];
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) { this.pathIdx++; return; }

    this.pathProg += this.walkSpeed / len;
    if (this.pathProg >= 1) {
      this.pathProg = 0;
      this.pathIdx++;
      this.x = to.x; this.y = to.y;
    } else {
      this.x = from.x + dx * this.pathProg;
      this.y = from.y + dy * this.pathProg;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      this.walkDir = dx > 0 ? 3 : 2;
    } else {
      this.walkDir = dy > 0 ? 0 : 1;
    }
    this.walkFrame = (this.walkFrame + 0.18) % 6;
  }

  // ── Get live status color + label ──
  _getLiveStatus() {
    var ls = _agentLiveStatus[this.id];
    if (!ls) return {color: '#00ff88', label: 'Online', status: 'idle'};
    var age = (Date.now() - ls.ts) / 1000;
    // Active decays to idle after 5 min
    if (ls.status === 'active' && age > 300) return {color: '#64748b', label: 'Idle', status: 'idle'};
    switch (ls.status) {
      case 'active':     return {color: '#00ff88', label: 'Active', status: 'active'};
      case 'error':      return {color: '#ff4444', label: 'Error',  status: 'error'};
      case 'publishing': return {color: '#00e5ff', label: 'Publishing', status: 'publishing'};
      case 'rework':     return {color: '#ffb800', label: 'Rework', status: 'rework'};
      case 'approved':   return {color: '#00ff88', label: 'Approved', status: 'approved'};
      default:           return {color: '#64748b', label: 'Idle', status: 'idle'};
    }
  }

  draw(ctx) {
    ctx.imageSmoothingEnabled = false;
    var ls = this._getLiveStatus();

    // ── Status ground indicator (subtle glow circle under agent) ──
    if (this.state === ST.SIT) {
      var pulse = 0.3 + Math.sin(this._statusPulse) * 0.15;
      ctx.save();
      ctx.globalAlpha = pulse;
      var grad = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, 18);
      grad.addColorStop(0, ls.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y + 2), 18, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Error flicker effect ──
    if (ls.status === 'error' && this.state === ST.SIT) {
      var flicker = Math.sin(this._statusPulse * 4) > 0.3;
      if (flicker) {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.ellipse(Math.round(this.x), Math.round(this.y - 20), 20, 32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ── Active agent "working" shimmer ──
    if (ls.status === 'active' && this.state === ST.SIT) {
      var shimmer = 0.1 + Math.sin(this._statusPulse * 2) * 0.08;
      ctx.save();
      ctx.globalAlpha = shimmer;
      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y - 20), 16, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Sprite
    if (this.state === ST.SIT) {
      drawSitFrame(ctx, this.sprite, this.frame, this.x, this.y);
    } else if (this.state === ST.WALK) {
      drawRunFrame(ctx, this.baseChar, this.walkDir, Math.floor(this.walkFrame), this.x, this.y);
    } else if (this.state === ST.BREAK) {
      drawIdleAnimFrame(ctx, this.baseChar, 0, Math.floor(this.idleFrame), this.x, this.y);
    }

    // Name label pill (with live status dot)
    this._drawLabel(ctx, ls);

    // Selection glow
    if (this.selected) {
      this._glowPhase += 0.04;
      const glow = 6 + Math.sin(this._glowPhase) * 3;
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = glow;
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y - 20), 18, 30, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Hover ring
    if (this.hovered && !this.selected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.33)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y - 20), 16, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  _drawLabel(ctx, ls) {
    const name = this.name;
    ctx.font = 'bold 7px system-ui';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(name).width;
    const lx = this.x, ly = this.y + 4;
    const px = Math.round(lx - tw / 2 - 3), py = Math.round(ly);
    const w = tw + 6, h = 11, r = 3;

    // Pill background
    ctx.fillStyle = this.color + 'dd';
    ctx.beginPath();
    ctx.moveTo(px+r,py); ctx.lineTo(px+w-r,py);
    ctx.arcTo(px+w,py,px+w,py+r,r); ctx.lineTo(px+w,py+h-r);
    ctx.arcTo(px+w,py+h,px+w-r,py+h,r); ctx.lineTo(px+r,py+h);
    ctx.arcTo(px,py+h,px,py+h-r,r); ctx.lineTo(px,py+r);
    ctx.arcTo(px,py,px+r,py,r);
    ctx.fill();

    // Text
    ctx.fillStyle = '#000';
    ctx.fillText(name, Math.round(lx), Math.round(ly + 8));

    // Live status dot (pulsing)
    var dotPulse = 2 + Math.sin(this._statusPulse * 2) * 0.8;
    var dotColor = ls ? ls.color : '#00ff88';
    ctx.beginPath();
    ctx.arc(Math.round(lx + tw/2 + 5), Math.round(ly + 5), dotPulse, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    // Dot glow
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.restore();
  }

  hitTest(px, py) {
    return Math.hypot(px - this.x, py - (this.y - 20)) < 28;
  }
}

// ─── CREATE AGENTS ───
const officeAgents = [
  new OfficeAgent('briefing',    'Morning',    '#ffb800', 'morning_sit_32x32',   100, 178, 6),
  new OfficeAgent('market',      'Analyst',    '#00e5ff', 'analyst_sit_32x32',   200, 178, 6),
  new OfficeAgent('content',     'SMM',        '#ff2d78', 'smm_sit_32x32',       300, 178, 6),
  new OfficeAgent('social',      'Community',  '#ff2d78', 'community_sit_32x32', 400, 178, 6),
  new OfficeAgent('leads',       'BizDev',     '#00ff88', 'bizdev_sit_32x32',    100, 268, 0),
  new OfficeAgent('lead_finder', 'LeadFind',   '#00ff88', 'leadfind_sit_32x32',  200, 268, 0),
  new OfficeAgent('followup',    'Follow-Up',  '#00ff88', 'followup_sit_32x32',  260, 276, 0),
  new OfficeAgent('processor',   'Processor',  '#a78bfa', 'processor_sit_32x32', 300, 276, 0),
  new OfficeAgent('watchdog',    'Watchdog',   '#a78bfa', 'watchdog_sit_32x32',  365, 276, 0),
  new OfficeAgent('kpi_updater', 'KPI',        '#a78bfa', 'kpi_sit_32x32',       410, 276, 3),
  new OfficeAgent('outreach',    'Outreach',   '#00ff88', 'outreach_idle_32x32', 470, 170, 6, {noBreak:true}),
  new OfficeAgent('coordinator', 'Coordinator','#ffb800', 'coord_sit_32x32',     90, 430, 9, {noBreak:true}),
];

// ─── MAIN DRAW LOOP ───
function drawOfficeAgents(ctx) {
  ctx.imageSmoothingEnabled = false;
  // Y-sort for depth
  const sorted = [...officeAgents].sort((a, b) => a.y - b.y);
  sorted.forEach(a => { a.update(); a.draw(ctx); });
  // Draw particles on top of agents
  updateAndDrawParticles(ctx);
  // Draw floating texts on top of everything
  updateAndDrawFloatingTexts(ctx);
}

// ─── CLICK / HOVER API ───
let _selectedAgent = null;
let _hoveredAgent = null;

function officeHitTest(imgX, imgY) {
  let best = null, bestD = 28;
  officeAgents.forEach(a => {
    if (a.hitTest(imgX, imgY)) {
      const d = Math.hypot(imgX - a.x, imgY - (a.y - 20));
      if (d < bestD) { best = a; bestD = d; }
    }
  });
  return best;
}

function officeSelectAgent(agent) {
  if (_selectedAgent) _selectedAgent.selected = false;
  _selectedAgent = agent;
  if (agent) agent.selected = true;
}

function officeHoverUpdate(imgX, imgY) {
  if (_hoveredAgent) _hoveredAgent.hovered = false;
  _hoveredAgent = officeHitTest(imgX, imgY);
  if (_hoveredAgent) _hoveredAgent.hovered = true;
  return _hoveredAgent;
}

// ─── FLOATING CARD (positioned in screen space) ───
function showAgentCard(agent, screenX, screenY, wrapRect) {
  let card = document.getElementById('agentFloatCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'agentFloatCard';
    card.style.cssText = 'position:absolute;z-index:50;pointer-events:auto;' +
      'background:linear-gradient(145deg,#0f1923,#0a1420);border:1px solid #1a2d3d;' +
      'border-radius:12px;padding:14px 16px;min-width:240px;max-width:300px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.6);opacity:0;transition:opacity .2s,transform .2s;' +
      'transform:translateY(8px);font-family:system-ui,sans-serif';
    document.getElementById('officeCanvasWrap').appendChild(card);
  }

  // State info
  var ls = agent._getLiveStatus();
  const stateLabel = agent.state === ST.SIT ? '💻 Работает' :
                     agent.state === ST.WALK ? '🚶 Идёт на перерыв' : '☕ На перерыве';
  const stateColor = agent.state === ST.SIT ? ls.color :
                     agent.state === ST.WALK ? '#ffb800' : '#00e5ff';

  // Supabase live info
  let liveHtml = '';
  const sbSlug = window.DASH_TO_SB_SLUG ? window.DASH_TO_SB_SLUG[agent.id] : null;
  const sbMem = window._sbMemory ? window._sbMemory.find(m => m.slug === sbSlug || m.dashId === agent.id) : null;

  // Live status badge
  var statusBadge = '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;' +
    'background:' + ls.color + '22;color:' + ls.color + ';border:1px solid ' + ls.color + '44">' +
    ls.label + '</span>';

  if (sbMem && window.SUPABASE_LIVE) {
    if (sbMem.last_output) {
      liveHtml += '<div style="font-size:11px;color:#cbd5e1;margin-top:8px;line-height:1.4;' +
        'background:rgba(0,229,255,0.05);border-left:2px solid #00e5ff44;padding:6px 8px;border-radius:0 6px 6px 0">' +
        '<span style="color:#00e5ff">📡</span> ' + sbMem.last_output.slice(0, 120) +
        (sbMem.last_output.length > 120 ? '...' : '') + '</div>';
    }
    if (sbMem.next_action) {
      liveHtml += '<div style="font-size:10px;color:#64748b;margin-top:4px;padding-left:10px">' +
        '→ ' + sbMem.next_action.slice(0, 80) + '</div>';
    }
    if (sbMem.cycle_number) {
      liveHtml += '<div style="font-size:9px;color:#475569;margin-top:2px;padding-left:10px">' +
        'Цикл #' + sbMem.cycle_number + (sbMem.tasks_done ? ' • ' + sbMem.tasks_done + ' задач' : '') + '</div>';
    }
  }

  // Live status detail
  var lsData = _agentLiveStatus[agent.id];
  if (lsData && lsData.detail) {
    liveHtml += '<div style="font-size:10px;color:' + ls.color + ';margin-top:4px;padding-left:10px;font-style:italic">' +
      lsData.detail.slice(0, 80) + '</div>';
  }

  card.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
      '<div style="width:36px;height:36px;border-radius:50%;background:' + agent.color + '22;' +
        'border:2px solid ' + agent.color + ';display:flex;align-items:center;justify-content:center;font-size:18px">' +
        (window.AGENTS && window.AGENTS[agent.id] ? window.AGENTS[agent.id].emoji : '🤖') +
      '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:14px;font-weight:700;color:#e2e8f0">' + agent.name + '</div>' +
        '<div style="font-size:10px;color:' + stateColor + ';font-weight:600">' + stateLabel + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        statusBadge +
        '<div style="width:8px;height:8px;border-radius:50%;background:' + stateColor +
          ';box-shadow:0 0 8px ' + stateColor + ';margin:6px 0 0 auto"></div>' +
      '</div>' +
    '</div>' +
    liveHtml +
    '<div style="display:flex;gap:6px;margin-top:10px">' +
      '<button onclick="if(typeof showAgentDetail===\'function\')showAgentDetail(\'' + agent.id + '\')" ' +
        'style="flex:1;padding:6px;border-radius:6px;border:1px solid #1a2d3d;background:#0a111899;' +
        'color:#00e5ff;font-size:11px;cursor:pointer;font-weight:600;transition:all .15s"' +
        ' onmouseover="this.style.borderColor=\'#00e5ff\';this.style.background=\'#00e5ff11\'"' +
        ' onmouseout="this.style.borderColor=\'#1a2d3d\';this.style.background=\'#0a111899\'">' +
        '📋 Подробнее</button>' +
      '<button onclick="if(typeof agentQuickAction===\'function\')agentQuickAction(\'' + agent.id + '\',\'status\')" ' +
        'style="flex:1;padding:6px;border-radius:6px;border:1px solid #1a2d3d;background:#0a111899;' +
        'color:#00ff88;font-size:11px;cursor:pointer;font-weight:600;transition:all .15s"' +
        ' onmouseover="this.style.borderColor=\'#00ff88\';this.style.background=\'#00ff8811\'"' +
        ' onmouseout="this.style.borderColor=\'#1a2d3d\';this.style.background=\'#0a111899\'">' +
        '💬 Статус</button>' +
    '</div>';

  card.style.borderColor = agent.color + '66';
  card.style.borderTopColor = agent.color;

  const cw = 280;
  let cx = screenX - cw / 2;
  let cy = screenY - 200;
  if (wrapRect) {
    if (cx < 8) cx = 8;
    if (cx + cw > wrapRect.width - 8) cx = wrapRect.width - cw - 8;
    if (cy < 8) cy = screenY + 40;
  }
  card.style.left = cx + 'px';
  card.style.top = cy + 'px';

  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  });
}

function hideAgentCard() {
  const card = document.getElementById('agentFloatCard');
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
  }
}

// ═══ HOVER TOOLTIP (lightweight, follows cursor) ═══
// Shows quick status on hover without clicking
function showHoverTooltip(agent, screenX, screenY) {
  var tip = document.getElementById('agentHoverTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'agentHoverTip';
    tip.style.cssText = 'position:absolute;z-index:45;pointer-events:none;' +
      'background:rgba(10,20,32,0.92);border:1px solid #1a2d3d;' +
      'border-radius:8px;padding:6px 10px;font-family:system-ui,sans-serif;' +
      'font-size:10px;color:#e2e8f0;white-space:nowrap;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.5);transition:opacity .15s;opacity:0';
    document.getElementById('officeCanvasWrap').appendChild(tip);
  }

  var ls = agent._getLiveStatus();
  var emoji = (window.AGENTS && window.AGENTS[agent.id]) ? window.AGENTS[agent.id].emoji : '🤖';
  var lsDetail = _agentLiveStatus[agent.id];
  var detail = lsDetail && lsDetail.detail ? ' — ' + lsDetail.detail.slice(0, 40) : '';

  tip.innerHTML = emoji + ' <b>' + agent.name + '</b> ' +
    '<span style="color:' + ls.color + '">' + ls.label + '</span>' + detail;
  tip.style.borderColor = agent.color + '66';

  tip.style.left = (screenX + 12) + 'px';
  tip.style.top = (screenY - 30) + 'px';
  tip.style.opacity = '1';
}

function hideHoverTooltip() {
  var tip = document.getElementById('agentHoverTip');
  if (tip) tip.style.opacity = '0';
}

// ─── EXPORTS ───
window.officeAgents = officeAgents;
window.drawOfficeAgents = drawOfficeAgents;
window.officeHitTest = officeHitTest;
window.officeSelectAgent = officeSelectAgent;
window.officeHoverUpdate = officeHoverUpdate;
window.showAgentCard = showAgentCard;
window.hideAgentCard = hideAgentCard;
window.showHoverTooltip = showHoverTooltip;
window.hideHoverTooltip = hideHoverTooltip;
window.setAgentLiveStatus = setAgentLiveStatus;
window.triggerOfficeEvent = triggerOfficeEvent;
window.spawnParticles = spawnParticles;
window.spawnFloatingText = spawnFloatingText;
window._agentLiveStatus = _agentLiveStatus;

console.log('Office Chars v12: Live Status + Particles + Tooltips — ' + officeAgents.length + ' agents loaded');
