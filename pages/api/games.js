/**
 * /pages/api/games.js
 * Proxy ESPN API — 50 ligas, detecção robusta de jogos ao vivo
 */

const LEAGUES = [
  // ── Europa Top 5 ──────────────────────────────────────────────────────────
  { id: "eng.1",              name: "Premier League",       country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.1",              name: "La Liga",              country: "🇪🇸" },
  { id: "ger.1",              name: "Bundesliga",           country: "🇩🇪" },
  { id: "ita.1",              name: "Serie A",              country: "🇮🇹" },
  { id: "fra.1",              name: "Ligue 1",              country: "🇫🇷" },
  // ── Europa Divisões 2 ─────────────────────────────────────────────────────
  { id: "eng.2",              name: "Championship",         country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "eng.3",              name: "League One",           country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.2",              name: "La Liga 2",            country: "🇪🇸" },
  { id: "ger.2",              name: "2. Bundesliga",        country: "🇩🇪" },
  { id: "ita.2",              name: "Serie B",              country: "🇮🇹" },
  { id: "fra.2",              name: "Ligue 2",              country: "🇫🇷" },
  // ── Europa Outras ─────────────────────────────────────────────────────────
  { id: "por.1",              name: "Primeira Liga",        country: "🇵🇹" },
  { id: "ned.1",              name: "Eredivisie",           country: "🇳🇱" },
  { id: "bel.1",              name: "Pro League",           country: "🇧🇪" },
  { id: "tur.1",              name: "Süper Lig",            country: "🇹🇷" },
  { id: "sco.1",              name: "Scottish Premiership", country: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { id: "gre.1",              name: "Super League GR",      country: "🇬🇷" },
  { id: "aut.1",              name: "Bundesliga AT",        country: "🇦🇹" },
  { id: "sui.1",              name: "Super League CH",      country: "🇨🇭" },
  { id: "den.1",              name: "Superliga DK",         country: "🇩🇰" },
  { id: "swe.1",              name: "Allsvenskan",          country: "🇸🇪" },
  { id: "nor.1",              name: "Eliteserien",          country: "🇳🇴" },
  { id: "pol.1",              name: "Ekstraklasa",          country: "🇵🇱" },
  { id: "rou.1",              name: "Liga I",               country: "🇷🇴" },
  { id: "rus.1",              name: "Premier League RU",    country: "🇷🇺" },
  { id: "ukr.1",              name: "Premier League UA",    country: "🇺🇦" },
  { id: "srb.1",              name: "SuperLiga RS",         country: "🇷🇸" },
  { id: "hrv.1",              name: "HNL Croatia",          country: "🇭🇷" },
  { id: "cze.1",              name: "Fortuna Liga",         country: "🇨🇿" },
  { id: "hun.1",              name: "OTP Bank Liga",        country: "🇭🇺" },
  { id: "isr.1",              name: "Ligat Ha'Al",          country: "🇮🇱" },
  { id: "kaz.1",              name: "Premier League KZ",    country: "🇰🇿" },
  // ── UEFA / FIFA ───────────────────────────────────────────────────────────
  { id: "uefa.champions",     name: "Champions League",     country: "⭐" },
  { id: "uefa.europa",        name: "Europa League",        country: "🟠" },
  { id: "uefa.europa.conf",   name: "Conference League",    country: "🟢" },
  { id: "fifa.worldq.conmebol", name: "Eliminatórias SUL",  country: "🌎" },
  { id: "fifa.worldq.uefa",   name: "Eliminatórias UEFA",   country: "🌍" },
  // ── Brasil e América do Sul ───────────────────────────────────────────────
  { id: "bra.1",              name: "Brasileirão Série A",  country: "🇧🇷" },
  { id: "bra.2",              name: "Brasileirão Série B",  country: "🇧🇷" },
  { id: "bra.3",              name: "Brasileirão Série C",  country: "🇧🇷" },
  { id: "bra.copa_brasil",    name: "Copa do Brasil",       country: "🇧🇷" },
  { id: "arg.1",              name: "Liga Profesional AR",  country: "🇦🇷" },
  { id: "col.1",              name: "Liga BetPlay CO",      country: "🇨🇴" },
  { id: "chi.1",              name: "Primera División CL",  country: "🇨🇱" },
  { id: "ecu.1",              name: "LigaPro Ecuador",      country: "🇪🇨" },
  { id: "per.1",              name: "Liga 1 Perú",          country: "🇵🇪" },
  { id: "uru.1",              name: "Primera División UY",   country: "🇺🇾" },
  { id: "ven.1",              name: "Liga FUTVE",           country: "🇻🇪" },
  { id: "bol.1",              name: "División Profesional", country: "🇧🇴" },
  { id: "par.1",              name: "División Profesional PY", country: "🇵🇾" },
  { id: "conmebol.libertadores", name: "Libertadores",      country: "🏆" },
  { id: "conmebol.sudamericana", name: "Sul-Americana",     country: "🏆" },
  // ── América do Norte / Central ────────────────────────────────────────────
  { id: "usa.1",              name: "MLS",                  country: "🇺🇸" },
  { id: "usa.open",           name: "US Open Cup",          country: "🇺🇸" },
  { id: "mex.1",              name: "Liga MX",              country: "🇲🇽" },
  { id: "mex.2",              name: "Expansión MX",         country: "🇲🇽" },
  { id: "concacaf.champions", name: "CONCACAF Champions",   country: "🌎" },
  // ── Ásia ─────────────────────────────────────────────────────────────────
  { id: "jpn.1",              name: "J1 League",            country: "🇯🇵" },
  { id: "kor.1",              name: "K League 1",           country: "🇰🇷" },
  { id: "chn.1",              name: "Chinese Super League", country: "🇨🇳" },
  { id: "sau.1",              name: "Saudi Pro League",     country: "🇸🇦" },
  { id: "uae.pro",            name: "UAE Pro League",       country: "🇦🇪" },
  { id: "aus.1",              name: "A-League",             country: "🇦🇺" },
];

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// Todos os states/descriptions que indicam jogo em andamento
function isLive(event) {
  const state = (event?.status?.type?.state || "").toLowerCase();
  const desc  = (event?.status?.type?.description || "").toLowerCase();
  const name  = (event?.status?.type?.name || "").toLowerCase();
  
  if (state === "in") return true;
  if (state === "halftime") return true;
  if (desc.includes("progress") || desc.includes("half") || desc.includes("live")) return true;
  if (name.includes("inprogress") || name.includes("halftime")) return true;
  return false;
}

async function fetchLeague(league) {
  const url = `${ESPN_BASE}/${league.id}/scoreboard`;
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { league, games: [], raw: res.status };

    const data = await res.json();
    const events = data.events || [];
    const live = events.filter(isLive);
    return {
      league,
      games: live.map(e => normalizeGame(e, league)),
      total: events.length,
      live: live.length,
    };
  } catch (err) {
    return { league, games: [], error: err.message };
  }
}

function normalizeGame(event, league) {
  const comp        = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home        = competitors.find(c => c.homeAway === "home") || {};
  const away        = competitors.find(c => c.homeAway === "away") || {};

  const displayClock = event.status?.displayClock || "";
  const period       = event.status?.period || 1;
  const rawClock     = event.status?.clock ?? 0;

  // Extrai minuto de forma robusta
  let minute = 0;
  const m = displayClock.match(/^(\d+)/);
  if (m) {
    minute = parseInt(m[1], 10);
    // ESPN às vezes retorna tempo regressivo — detecta se rawClock indica isso
    if (rawClock > 60 && minute < rawClock / 60 - 2) {
      minute = period === 1
        ? Math.round(45 - rawClock / 60)
        : Math.round(90 - rawClock / 60);
    }
  } else if (rawClock > 0) {
    minute = period === 1
      ? Math.max(1, Math.round((45 * 60 - rawClock) / 60))
      : Math.max(46, Math.round((90 * 60 - rawClock) / 60));
  } else {
    minute = period === 2 ? 55 : 25; // fallback razoável
  }
  minute = Math.min(90, Math.max(1, minute));

  const stats = extractStats(comp.statistics || []);

  return {
    id: event.id,
    league: league.name,
    leagueCountry: league.country,
    home: home.team?.displayName || home.team?.shortDisplayName || "Home",
    homeShort: home.team?.abbreviation || "HME",
    away: away.team?.displayName || away.team?.shortDisplayName || "Away",
    awayShort: away.team?.abbreviation || "AWY",
    score: {
      home: parseInt(home.score) || 0,
      away: parseInt(away.score) || 0,
    },
    minute,
    period,
    clock: displayClock,
    statusDetail: event.status?.type?.description || "",
    possession:   { home: stats.possessionHome  ?? 50, away: stats.possessionAway  ?? 50 },
    shots:        { home: stats.shotsHome        ?? 0,  away: stats.shotsAway        ?? 0  },
    onTarget:     { home: stats.onTargetHome     ?? 0,  away: stats.onTargetAway     ?? 0  },
    corners:      { home: stats.cornersHome      ?? 0,  away: stats.cornersAway      ?? 0  },
    fouls:        { home: stats.foulsHome        ?? 0,  away: stats.foulsAway        ?? 0  },
    yellowCards:  { home: stats.yellowHome       ?? 0,  away: stats.yellowAway       ?? 0  },
    dangerousAttacks: {
      home: stats.dangerousAttacksHome ?? estimateDA(stats.shotsHome ?? 0, stats.possessionHome ?? 50),
      away: stats.dangerousAttacksAway ?? estimateDA(stats.shotsAway ?? 0, stats.possessionAway ?? 50),
    },
    pressureIndex: stats.pressureIndex ?? null,
    venue: comp.venue?.fullName || null,
    isDemo: false,
  };
}

function extractStats(statsArray) {
  const r = {};
  const KEYS = {
    "possession":           ["possessionHome",      "possessionAway"],
    "ball possession":      ["possessionHome",      "possessionAway"],
    "shots":                ["shotsHome",           "shotsAway"],
    "total shots":          ["shotsHome",           "shotsAway"],
    "shots on target":      ["onTargetHome",        "onTargetAway"],
    "shots on goal":        ["onTargetHome",        "onTargetAway"],
    "on target":            ["onTargetHome",        "onTargetAway"],
    "corner kicks":         ["cornersHome",         "cornersAway"],
    "corners":              ["cornersHome",         "cornersAway"],
    "fouls":                ["foulsHome",           "foulsAway"],
    "fouls committed":      ["foulsHome",           "foulsAway"],
    "yellow cards":         ["yellowHome",          "yellowAway"],
    "dangerous attacks":    ["dangerousAttacksHome","dangerousAttacksAway"],
    "attacks":              ["attacksHome",         "attacksAway"],
  };

  for (const group of statsArray) {
    for (const s of (group.stats || [])) {
      const label = (s.label || s.name || s.shortDisplayName || "").toLowerCase().trim();
      const keys = KEYS[label];
      if (!keys) continue;
      const hv = parseFloat(s.homeValue ?? s.home);
      const av = parseFloat(s.awayValue ?? s.away);
      if (!isNaN(hv)) r[keys[0]] = hv;
      if (!isNaN(av)) r[keys[1]] = av;
    }
  }

  if (r.possessionHome !== undefined && r.possessionAway === undefined) {
    r.possessionAway = 100 - r.possessionHome;
  }
  return r;
}

function estimateDA(shots, possession) {
  return Math.round(shots * 3.2 + (possession / 100) * 16);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const t0 = Date.now();

  // Busca todas as ligas em paralelo
  const settled = await Promise.allSettled(LEAGUES.map(fetchLeague));

  const allGames = [];
  const debug    = [];

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { league, games, total, live, error } = r.value;
    allGames.push(...games);
    if (total > 0 || error) {
      debug.push({ league: league.name, total: total ?? 0, live: live ?? 0, error: error ?? null });
    }
  }

  res.setHeader("Cache-Control", "s-maxage=25, stale-while-revalidate=50");
  return res.status(200).json({
    games:          allGames,
    liveCount:      allGames.length,
    leaguesQueried: LEAGUES.length,
    elapsedMs:      Date.now() - t0,
    demo:           false,
    timestamp:      new Date().toISOString(),
    // Só inclui debug info se não houver jogos (para diagnóstico)
    ...(allGames.length === 0 ? { debug } : {}),
  });
}
