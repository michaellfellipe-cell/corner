/**
 * /pages/api/games.js — ESPN proxy com jogos ao vivo E próximos jogos
 */

const LEAGUES = [
  { id: "eng.1",              name: "Premier League",       country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.1",              name: "La Liga",              country: "🇪🇸" },
  { id: "ger.1",              name: "Bundesliga",           country: "🇩🇪" },
  { id: "ita.1",              name: "Serie A",              country: "🇮🇹" },
  { id: "fra.1",              name: "Ligue 1",              country: "🇫🇷" },
  { id: "eng.2",              name: "Championship",         country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.3",              name: "League One",           country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.2",              name: "La Liga 2",            country: "🇪🇸" },
  { id: "ger.2",              name: "2. Bundesliga",        country: "🇩🇪" },
  { id: "ita.2",              name: "Serie B",              country: "🇮🇹" },
  { id: "fra.2",              name: "Ligue 2",              country: "🇫🇷" },
  { id: "por.1",              name: "Primeira Liga",        country: "🇵🇹" },
  { id: "ned.1",              name: "Eredivisie",           country: "🇳🇱" },
  { id: "bel.1",              name: "Pro League",           country: "🇧🇪" },
  { id: "tur.1",              name: "Süper Lig",            country: "🇹🇷" },
  { id: "sco.1",              name: "Scottish Prem",        country: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { id: "gre.1",              name: "Super League GR",      country: "🇬🇷" },
  { id: "aut.1",              name: "Bundesliga AT",        country: "🇦🇹" },
  { id: "sui.1",              name: "Super League CH",      country: "🇨🇭" },
  { id: "den.1",              name: "Superliga DK",         country: "🇩🇰" },
  { id: "swe.1",              name: "Allsvenskan",          country: "🇸🇪" },
  { id: "nor.1",              name: "Eliteserien",          country: "🇳🇴" },
  { id: "pol.1",              name: "Ekstraklasa",          country: "🇵🇱" },
  { id: "rou.1",              name: "Liga I",               country: "🇷🇴" },
  { id: "rus.1",              name: "Premier League RU",    country: "🇷🇺" },
  { id: "srb.1",              name: "SuperLiga RS",         country: "🇷🇸" },
  { id: "hrv.1",              name: "HNL Croatia",          country: "🇭🇷" },
  { id: "cze.1",              name: "Fortuna Liga",         country: "🇨🇿" },
  { id: "isr.1",              name: "Ligat Ha'Al",          country: "🇮🇱" },
  { id: "uefa.champions",     name: "Champions League",     country: "⭐" },
  { id: "uefa.europa",        name: "Europa League",        country: "🟠" },
  { id: "uefa.europa.conf",   name: "Conference League",    country: "🟢" },
  { id: "fifa.worldq.conmebol", name: "Eliminatórias SUL",  country: "🌎" },
  { id: "bra.1",              name: "Brasileirão Série A",  country: "🇧🇷" },
  { id: "bra.2",              name: "Brasileirão Série B",  country: "🇧🇷" },
  { id: "bra.3",              name: "Brasileirão Série C",  country: "🇧🇷" },
  { id: "bra.copa_brasil",    name: "Copa do Brasil",       country: "🇧🇷" },
  { id: "arg.1",              name: "Liga Profesional AR",  country: "🇦🇷" },
  { id: "mex.1",              name: "Liga MX",              country: "🇲🇽" },
  { id: "usa.1",              name: "MLS",                  country: "🇺🇸" },
  { id: "col.1",              name: "Liga BetPlay CO",      country: "🇨🇴" },
  { id: "chi.1",              name: "Primera CL",           country: "🇨🇱" },
  { id: "ecu.1",              name: "LigaPro Ecuador",      country: "🇪🇨" },
  { id: "per.1",              name: "Liga 1 Perú",          country: "🇵🇪" },
  { id: "uru.1",              name: "Primera UY",           country: "🇺🇾" },
  { id: "ven.1",              name: "Liga FUTVE",           country: "🇻🇪" },
  { id: "bol.1",              name: "Div. Profesional BO",  country: "🇧🇴" },
  { id: "conmebol.libertadores", name: "Libertadores",      country: "🏆" },
  { id: "conmebol.sudamericana", name: "Sul-Americana",     country: "🏆" },
  { id: "concacaf.champions", name: "CONCACAF CL",          country: "🌎" },
  { id: "jpn.1",              name: "J1 League",            country: "🇯🇵" },
  { id: "kor.1",              name: "K League 1",           country: "🇰🇷" },
  { id: "sau.1",              name: "Saudi Pro League",     country: "🇸🇦" },
  { id: "aus.1",              name: "A-League",             country: "🇦🇺" },
];

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

function isLive(event) {
  const state = (event?.status?.type?.state || "").toLowerCase();
  const name  = (event?.status?.type?.name  || "").toLowerCase();
  const desc  = (event?.status?.type?.description || "").toLowerCase();
  return state === "in" || state === "halftime" ||
    name.includes("inprogress") || name.includes("halftime") ||
    desc.includes("progress") || desc.includes(" half");
}

function isUpcoming(event) {
  return (event?.status?.type?.state || "").toLowerCase() === "pre";
}

function getStartTime(event) {
  return event.date || event.competitions?.[0]?.date || null;
}

async function fetchLeague(league) {
  try {
    const res = await fetch(`${ESPN_BASE}/${league.id}/scoreboard`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return { league, live: [], upcoming: [] };

    const data  = await res.json();
    const events = data.events || [];

    return {
      league,
      live:     events.filter(isLive).map(e => normalizeGame(e, league, false)),
      upcoming: events.filter(isUpcoming).map(e => normalizeGame(e, league, true)),
    };
  } catch {
    return { league, live: [], upcoming: [] };
  }
}

function normalizeGame(event, league, isUpcomingGame) {
  const comp        = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home        = competitors.find(c => c.homeAway === "home") || {};
  const away        = competitors.find(c => c.homeAway === "away") || {};
  const period      = event.status?.period || 1;
  const rawClock    = event.status?.clock ?? 0;
  const displayClock = event.status?.displayClock || "";

  let minute = 0;
  const m = displayClock.match(/^(\d+)/);
  if (m) minute = parseInt(m[1], 10);
  else if (rawClock > 0) minute = period === 1 ? Math.max(1, Math.round((2700 - rawClock) / 60)) : Math.max(46, Math.round((5400 - rawClock) / 60));
  else minute = isUpcomingGame ? 0 : (period === 2 ? 55 : 25);
  minute = Math.min(90, Math.max(0, minute));

  const stats = extractStats(comp.statistics || []);

  return {
    id:           event.id,
    league:       league.name,
    leagueCountry: league.country,
    home:         home.team?.displayName || home.team?.shortDisplayName || "Home",
    homeShort:    home.team?.abbreviation || "HME",
    away:         away.team?.displayName  || away.team?.shortDisplayName  || "Away",
    awayShort:    away.team?.abbreviation || "AWY",
    score:        { home: parseInt(home.score) || 0, away: parseInt(away.score) || 0 },
    minute,
    period,
    clock:        displayClock,
    startTime:    getStartTime(event),
    statusDetail: event.status?.type?.description || "",
    isUpcoming:   isUpcomingGame,
    isDemo:       false,
    possession:       { home: stats.possessionHome  ?? 50, away: stats.possessionAway  ?? 50 },
    shots:            { home: stats.shotsHome        ?? 0,  away: stats.shotsAway        ?? 0  },
    onTarget:         { home: stats.onTargetHome     ?? 0,  away: stats.onTargetAway     ?? 0  },
    corners:          { home: stats.cornersHome      ?? 0,  away: stats.cornersAway      ?? 0  },
    fouls:            { home: stats.foulsHome        ?? 0,  away: stats.foulsAway        ?? 0  },
    dangerousAttacks: {
      home: stats.dangerousAttacksHome ?? estimateDA(stats.shotsHome ?? 0, stats.possessionHome ?? 50),
      away: stats.dangerousAttacksAway ?? estimateDA(stats.shotsAway ?? 0, stats.possessionAway ?? 50),
    },
    pressureIndex: null,
  };
}

function extractStats(arr) {
  const r = {};
  const MAP = {
    "possession": ["possessionHome","possessionAway"], "ball possession": ["possessionHome","possessionAway"],
    "shots": ["shotsHome","shotsAway"], "total shots": ["shotsHome","shotsAway"],
    "shots on target": ["onTargetHome","onTargetAway"], "shots on goal": ["onTargetHome","onTargetAway"],
    "corner kicks": ["cornersHome","cornersAway"], "corners": ["cornersHome","cornersAway"],
    "fouls": ["foulsHome","foulsAway"],
    "dangerous attacks": ["dangerousAttacksHome","dangerousAttacksAway"],
  };
  for (const g of arr) {
    for (const s of (g.stats || [])) {
      const label = (s.label || s.name || "").toLowerCase().trim();
      const keys = MAP[label];
      if (!keys) continue;
      const h = parseFloat(s.homeValue ?? s.home);
      const a = parseFloat(s.awayValue ?? s.away);
      if (!isNaN(h)) r[keys[0]] = h;
      if (!isNaN(a)) r[keys[1]] = a;
    }
  }
  if (r.possessionHome !== undefined && r.possessionAway === undefined) r.possessionAway = 100 - r.possessionHome;
  return r;
}

function estimateDA(shots, possession) {
  return Math.round(shots * 3.2 + (possession / 100) * 16);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const settled = await Promise.allSettled(LEAGUES.map(fetchLeague));

  const liveGames     = [];
  const upcomingGames = [];

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    liveGames.push(...r.value.live);
    upcomingGames.push(...r.value.upcoming);
  }

  // Ordena upcoming por horário de início
  upcomingGames.sort((a, b) => {
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return new Date(a.startTime) - new Date(b.startTime);
  });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games:          liveGames,
    upcoming:       upcomingGames.slice(0, 30), // próximos 30 jogos
    liveCount:      liveGames.length,
    upcomingCount:  upcomingGames.length,
    leaguesQueried: LEAGUES.length,
    demo:           false,
    timestamp:      new Date().toISOString(),
  });
}
