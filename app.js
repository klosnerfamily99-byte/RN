/* =========================================================
   RNFL — real NFL teams, rosters, player stats & schedule
   Data source: ESPN's public site API (no key required)
   ========================================================= */

const API_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const API_WEB_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl";
const SEASON_YEAR = 2026;      // season this schedule belongs to
const MAX_WEEK = 18;           // regular season goes through week 18
const REFRESH_MS = 30000;      // 30 second auto-refresh

/* ---------------- state ---------------- */
const state = {
  currentView: "view-home",
  teams: [],                 // [{id, name, logo, abbreviation}]
  rosterCache: new Map(),    // teamId -> array of player objects
  statsCache: new Map(),     // playerId -> stats object
  gamesCache: new Map(),     // eventId -> event object
  currentTeamId: null,
  currentPlayerId: null,
  currentGameId: null,
  weeksLoaded: 0,
  loadingWeek: false,
};

/* ---------------- helpers ---------------- */
function $(id){ return document.getElementById(id); }

async function fetchJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error("Network response was not ok (" + res.status + ")");
  return res.json();
}

function showLoadError(container, message){
  container.innerHTML = `<div class="loading">${message || "Couldn't load data. Check your connection and try again."}</div>`;
}

function formatDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}
function formatTime(iso){
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
}

/* ---------------- navigation ---------------- */
function showView(id){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(id).classList.add("active");
  state.currentView = id;

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const navMap = { "view-home":"view-home", "view-teams":"view-teams", "view-roster":"view-teams",
                    "view-player":"view-teams", "view-games":"view-games", "view-game":"view-games" };
  const navTarget = navMap[id];
  const navBtn = document.querySelector(`.nav-btn[data-target="${navTarget}"]`);
  if(navBtn) navBtn.classList.add("active");

  // lazy-load content the first time a view is opened
  if(id === "view-teams" && state.teams.length === 0) loadTeams();
  if(id === "view-games" && state.weeksLoaded === 0) loadNextWeek();
}

document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.addEventListener("click", ()=> showView(btn.dataset.target));
});
document.querySelectorAll(".back-btn").forEach(btn=>{
  btn.addEventListener("click", ()=> showView(btn.dataset.back));
});

/* ---------------- home clock ---------------- */
function tickClock(){
  const el = $("home-clock");
  if(el) el.textContent = new Date().toLocaleTimeString();
}
setInterval(tickClock, 1000);
tickClock();

/* =========================================================
   TEAMS
   ========================================================= */
async function loadTeams(){
  const container = $("teams-list");
  try{
    const data = await fetchJSON(`${API_BASE}/teams?limit=32`);
    const items = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    state.teams = items.map(it => it.team).sort((a,b)=> a.displayName.localeCompare(b.displayName));
    renderTeams();
  }catch(err){
    console.error(err);
    showLoadError(container, "Couldn't load NFL teams. Check your connection and pull down to try again.");
  }
}

function renderTeams(){
  const container = $("teams-list");
  container.innerHTML = "";
  state.teams.forEach(team=>{
    const logo = team.logos?.[0]?.href || "";
    const card = document.createElement("div");
    card.className = "team-card";
    card.innerHTML = `
      <img src="${logo}" alt="${team.displayName} logo" loading="lazy">
      <span class="team-name">${team.displayName}</span>
    `;
    card.addEventListener("click", ()=> openRoster(team));
    container.appendChild(card);
  });
}

/* =========================================================
   ROSTER
   ========================================================= */
async function openRoster(team){
  state.currentTeamId = team.id;
  $("roster-team-name").textContent = team.displayName;
  $("roster-team-logo").src = team.logos?.[0]?.href || "";
  showView("view-roster");

  const container = $("roster-list");
  container.innerHTML = `<div class="loading">Loading roster…</div>`;

  if(state.rosterCache.has(team.id)){
    renderRoster(team.id);
    return;
  }

  try{
    const data = await fetchJSON(`${API_BASE}/teams/${team.id}/roster`);
    const groups = data?.athletes || [];
    const players = [];
    groups.forEach(group=>{
      (group.items || []).forEach(p=>{
        players.push({
          id: p.id,
          name: p.displayName || p.fullName,
          jersey: p.jersey || "--",
          position: p.position?.abbreviation || "--",
          headshot: p.headshot?.href || "",
          age: p.age,
          height: p.displayHeight,
          weight: p.displayWeight,
          experience: p.experience?.years,
          status: p.status?.name || p.status?.type || "Active",
          groupName: group.position || "Roster",
        });
      });
    });
    state.rosterCache.set(team.id, players);
    renderRoster(team.id);
    // warm the stats cache in the background for the 30s auto-refresh
    refreshTeamStats(team.id);
  }catch(err){
    console.error(err);
    showLoadError(container, "Couldn't load this roster. Check your connection and try again.");
  }
}

function renderRoster(teamId){
  const container = $("roster-list");
  const players = state.rosterCache.get(teamId) || [];
  if(players.length === 0){
    showLoadError(container, "No roster data available for this team right now.");
    return;
  }
  container.innerHTML = "";
  let lastGroup = null;
  players.forEach(p=>{
    if(p.groupName !== lastGroup){
      const h = document.createElement("div");
      h.className = "roster-groupheading";
      h.textContent = p.groupName;
      container.appendChild(h);
      lastGroup = p.groupName;
    }
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <img src="${p.headshot}" alt="${p.name}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="player-info">
        <div class="player-name">${p.name}</div>
        <div class="player-sub">${p.position} · ${p.status}</div>
      </div>
      <div class="jersey">${p.jersey !== "--" ? "#"+p.jersey : ""}</div>
    `;
    row.addEventListener("click", ()=> openPlayer(p, teamId));
    container.appendChild(row);
  });
}

/* =========================================================
   PLAYER STATS
   ========================================================= */
function openPlayer(player, teamId){
  state.currentPlayerId = player.id;
  state.currentTeamId = teamId;

  $("player-name").textContent = player.name;
  $("player-meta").textContent = `${player.position} · #${player.jersey}`;
  $("player-headshot").src = player.headshot;

  showView("view-player");
  renderPlayerDetail(player);

  if(!state.statsCache.has(player.id)){
    fetchPlayerStats(player.id).then(()=> {
      if(state.currentPlayerId === player.id) renderPlayerDetail(player);
    });
  }
}

async function fetchPlayerStats(playerId){
  try{
    const data = await fetchJSON(`${API_WEB_BASE}/athletes/${playerId}/stats`);
    const categories = data?.statistics?.splits?.categories || [];
    state.statsCache.set(playerId, { categories, updated: Date.now() });
  }catch(err){
    console.error("stats fetch failed for", playerId, err);
    // keep whatever was cached before; don't wipe good data on a transient failure
  }
}

async function refreshTeamStats(teamId){
  const players = state.rosterCache.get(teamId) || [];
  // update every player's stats on this roster, not just the one being viewed
  await Promise.all(players.map(p => fetchPlayerStats(p.id)));
  if(state.currentView === "view-player" && state.currentPlayerId){
    const current = players.find(p => p.id === state.currentPlayerId);
    if(current) renderPlayerDetail(current);
  }
  pulseRefreshDot();
}

function pulseRefreshDot(){
  const dot = $("refresh-dot");
  if(!dot) return;
  dot.style.background = "#5FE08C";
  setTimeout(()=>{ dot.style.background = ""; }, 600);
}

function renderPlayerDetail(player){
  const container = $("player-detail");
  const statsEntry = state.statsCache.get(player.id);

  let statsHtml = "";
  if(statsEntry && statsEntry.categories.length){
    statsEntry.categories.slice(0,3).forEach(cat=>{
      const stats = (cat.stats || []).slice(0,6);
      if(!stats.length) return;
      statsHtml += `
        <div class="stat-card">
          <h3>${cat.displayName || cat.name}</h3>
          <div class="stat-grid">
            ${stats.map(s=>`
              <div class="stat-item">
                <div class="stat-value">${s.displayValue ?? "--"}</div>
                <div class="stat-label">${s.shortDisplayName || s.name}</div>
              </div>
            `).join("")}
          </div>
        </div>`;
    });
  }
  if(!statsHtml){
    statsHtml = `<div class="stat-card"><h3>Season Stats</h3><p style="color:var(--gray);font-size:0.85rem;margin:0;">No stats available yet for this player this season.</p></div>`;
  }

  const isActive = /active/i.test(player.status);

  container.innerHTML = `
    <div class="stat-card">
      <h3>Condition</h3>
      <span class="status-pill ${isActive ? "status-active" : "status-inactive"}">${player.status}</span>
    </div>
    <div class="stat-card">
      <h3>Player Info</h3>
      <div class="bio-row"><span class="bio-label">Position</span><span>${player.position}</span></div>
      <div class="bio-row"><span class="bio-label">Age</span><span>${player.age ?? "--"}</span></div>
      <div class="bio-row"><span class="bio-label">Height</span><span>${player.height ?? "--"}</span></div>
      <div class="bio-row"><span class="bio-label">Weight</span><span>${player.weight ?? "--"}</span></div>
      <div class="bio-row"><span class="bio-label">Experience</span><span>${player.experience !== undefined ? player.experience + " yrs" : "--"}</span></div>
    </div>
    ${statsHtml}
  `;
}

/* =========================================================
   GAMES / SCHEDULE
   ========================================================= */
const gamesList = $("games-list");
let sentinel = null;

function ensureSentinel(){
  if(sentinel) sentinel.remove();
  sentinel = document.createElement("div");
  sentinel.style.height = "1px";
  gamesList.appendChild(sentinel);
  const observer = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting) loadNextWeek();
    });
  }, { root: gamesList, threshold: 0 });
  observer.observe(sentinel);
}

async function loadNextWeek(){
  if(state.loadingWeek || state.weeksLoaded >= MAX_WEEK) return;
  state.loadingWeek = true;
  const week = state.weeksLoaded + 1;

  if(week === 1){ gamesList.innerHTML = ""; }
  else{ const l = gamesList.querySelector(".loading"); if(l) l.remove(); }

  const loadingRow = document.createElement("div");
  loadingRow.className = "loading";
  loadingRow.textContent = "Loading more games…";
  gamesList.appendChild(loadingRow);

  try{
    const data = await fetchJSON(`${API_BASE}/scoreboard?week=${week}&seasontype=2&year=${SEASON_YEAR}`);
    loadingRow.remove();

    const heading = document.createElement("div");
    heading.className = "week-heading";
    heading.textContent = `Week ${week}`;
    gamesList.appendChild(heading);

    const events = data?.events || [];
    if(events.length === 0){
      const none = document.createElement("div");
      none.className = "loading";
      none.textContent = "No games scheduled for this week.";
      gamesList.appendChild(none);
    }
    events.forEach(ev=>{
      state.gamesCache.set(ev.id, ev);
      gamesList.appendChild(renderGameCard(ev));
    });

    state.weeksLoaded = week;
    ensureSentinel();
  }catch(err){
    console.error(err);
    loadingRow.textContent = "Couldn't load more games. Scroll to try again.";
  }finally{
    state.loadingWeek = false;
  }
}

function renderGameCard(ev){
  const comp = ev.competitions?.[0];
  const competitors = comp?.competitors || [];
  const home = competitors.find(c=>c.homeAway === "home") || competitors[0];
  const away = competitors.find(c=>c.homeAway === "away") || competitors[1];
  const state_ = comp?.status?.type?.state; // 'pre' | 'in' | 'post'

  const card = document.createElement("div");
  card.className = "game-card";
  card.innerHTML = `
    <div class="game-time">
      <span>${formatDate(ev.date)} · ${formatTime(ev.date)}</span>
      ${state_ === "in" ? '<span class="live-tag">● LIVE</span>' : ""}
    </div>
    <div class="matchup">
      <div class="matchup-team">
        <img src="${away?.team?.logo || ""}" alt="">
        <span>${away?.team?.shortDisplayName || away?.team?.displayName || "TBD"}</span>
      </div>
      <div class="matchup-score">${state_ === "pre" ? "" : (away?.score ?? "")}</div>
      <span class="matchup-at">@</span>
      <div class="matchup-score">${state_ === "pre" ? "" : (home?.score ?? "")}</div>
      <div class="matchup-team" style="justify-content:flex-end;text-align:right;flex-direction:row-reverse;">
        <img src="${home?.team?.logo || ""}" alt="">
        <span>${home?.team?.shortDisplayName || home?.team?.displayName || "TBD"}</span>
      </div>
    </div>
  `;
  card.addEventListener("click", ()=> openGame(ev.id));
  return card;
}

function openGame(eventId){
  state.currentGameId = eventId;
  showView("view-game");
  renderGameDetail(eventId);
}

async function refreshGame(eventId){
  try{
    // find which week this event belongs to isn't tracked directly, so
    // refresh via the scoreboard endpoint using the event's own date-based week isn't reliable;
    // instead do a light re-fetch of the whole scoreboard for the week we already have cached.
    const ev = state.gamesCache.get(eventId);
    if(!ev) return;
    const week = ev.week?.number;
    if(!week) return;
    const data = await fetchJSON(`${API_BASE}/scoreboard?week=${week}&seasontype=2&year=${SEASON_YEAR}`);
    const fresh = (data?.events || []).find(e=> e.id === eventId);
    if(fresh) state.gamesCache.set(eventId, fresh);
  }catch(err){
    console.error("game refresh failed", err);
  }
}

function renderGameDetail(eventId){
  const container = $("game-detail");
  const ev = state.gamesCache.get(eventId);
  if(!ev){
    showLoadError(container, "Couldn't find this game.");
    return;
  }
  const comp = ev.competitions?.[0];
  const competitors = comp?.competitors || [];
  const home = competitors.find(c=>c.homeAway === "home") || competitors[0];
  const away = competitors.find(c=>c.homeAway === "away") || competitors[1];
  const statusState = comp?.status?.type?.state;
  const statusDetail = comp?.status?.type?.detail || comp?.status?.type?.description || "";

  let statusLine = statusDetail;
  if(statusState === "pre") statusLine = `${formatDate(ev.date)} · ${formatTime(ev.date)}`;
  if(statusState === "in") statusLine = `LIVE · ${statusDetail}`;

  container.innerHTML = `
    <div class="game-detail-hero">
      <div class="status-line">${statusLine}</div>
      <div class="game-detail-matchup">
        <div class="gd-team">
          <img src="${away?.team?.logo || ""}" alt="">
          <span>${away?.team?.displayName || "TBD"}</span>
        </div>
        <div class="gd-score">
          ${statusState === "pre" ? '<span class="gd-vs">VS</span>' : `${away?.score ?? "-"} : ${home?.score ?? "-"}`}
        </div>
        <div class="gd-team">
          <img src="${home?.team?.logo || ""}" alt="">
          <span>${home?.team?.displayName || "TBD"}</span>
        </div>
      </div>
    </div>
    ${statusState === "pre" ? `<div class="not-started-note">Game hasn't started yet.</div>` : ""}
  `;
}

/* =========================================================
   30-SECOND GLOBAL AUTO-REFRESH
   Refreshes stats for every player on the currently loaded
   roster (not just the one open) and the open game's score.
   ========================================================= */
setInterval(()=>{
  if(state.currentTeamId && state.rosterCache.has(state.currentTeamId)){
    refreshTeamStats(state.currentTeamId);
  }
  if(state.currentView === "view-game" && state.currentGameId){
    refreshGame(state.currentGameId).then(()=> renderGameDetail(state.currentGameId));
  }
}, REFRESH_MS);

/* ---------------- init ---------------- */
showView("view-home");
