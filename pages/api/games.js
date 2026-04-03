/**
 * /pages/api/games.js
 * Proxy server-side para ESPN API (evita CORS no browser)
 * Agrega múltiplas ligas e normaliza os dados
 */

const LEAGUES = [
  { id: "eng.1",         name: "Premier League",    country: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "esp.1",         name: "La Liga",            country: "🇪🇸" },
  { id: "ger.1",         name: "Bundesliga",         country: "🇩🇪" },
  { id: "ita.1",         name: "Serie A",            country: "🇮🇹" },
  { id: "fra.1",         name: "Ligue 1",            country: "🇫🇷" },
  { id: "por.1",         name: "Primeira Liga",      country: "🇵🇹" },
  { id: "bra.1",         name: "Brasileirão",        country: "🇧🇷" },
  { id: "uefa.champions",name: "Champions League",   country: "🌍" },
];

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

async function fetchLeague(league) {
  const url = `${ESPN_BASE}/${league.id}/scoreboard`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    next: { revalidate: 30 }, // cache 30s no Next.js
  });
  if (!res.ok) return [];

  const data = await res.json();
  const events = data.events || [];

  // Filtra apenas jogos ao vivo
  const liveGames = events.filter(e => {
    const state = e?.status?.type?.state;
    return state === "in";
  });

  return liveGames.map(event => normalizeGame(event, league));
}

function normalizeGame(event, league) {
  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === "home") || {};
  const away = competitors.find(c => c.homeAway === "away") || {};

  // Situação / estatísticas (nem sempre disponível)
  const situation = comp.situation || {};
  const stats = extractStats(comp.statistics || []);

  const minuteRaw = event.status?.clock || 0;
  // ESPN clock conta regressivamente; converte para minuto jogado
  const minute = Math.max(1, Math.round((45 * 60 - minuteRaw) / 60)) || 
                 parseInt(event.status?.displayClock) || 45;

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
    minute: Math.min(90, minute),
    period: event.status?.period || 1,
    clock: event.status?.displayClock || "0:00",
    // Stats — ESPN retorna quando disponível
    possession: {
      home: stats.possessionHome ?? 50,
      away: stats.possessionAway ?? 50,
    },
    shots: {
      home: stats.shotsHome ?? 0,
      away: stats.shotsAway ?? 0,
    },
    onTarget: {
      home: stats.onTargetHome ?? 0,
      away: stats.onTargetAway ?? 0,
    },
    corners: {
      home: stats.cornersHome ?? 0,
      away: stats.cornersAway ?? 0,
    },
    fouls: {
      home: stats.foulsHome ?? 0,
      away: stats.foulsAway ?? 0,
    },
    yellowCards: {
      home: stats.yellowHome ?? 0,
      away: stats.yellowAway ?? 0,
    },
    dangerousAttacks: {
      home: stats.dangerousAttacksHome ?? estimateDangerousAttacks(stats.shotsHome ?? 0, stats.possessionHome ?? 50),
      away: stats.dangerousAttacksAway ?? estimateDangerousAttacks(stats.shotsAway ?? 0, 100 - (stats.possessionHome ?? 50)),
    },
    // Campos derivados para o algoritmo
    espnRaw: {
      statusDetail: event.status?.type?.detail,
      venue: comp.venue?.fullName,
    },
  };
}

/** Extrai estatísticas do array stats do ESPN */
function extractStats(statsArray) {
  const result = {};
  // ESPN retorna um array de objetos { label, stats: [{homeValue, awayValue}] }
  statsArray.forEach(group => {
    (group.stats || []).forEach(s => {
      const label = (s.label || s.name || "").toLowerCase().replace(/\s+/g, "_");
      switch (label) {
        case "possession":
        case "ball_possession":
          result.possessionHome = parseFloat(s.homeValue) || undefined;
          result.possessionAway = parseFloat(s.awayValue) || undefined;
          break;
        case "shots":
        case "total_shots":
          result.shotsHome = parseInt(s.homeValue) || undefined;
          result.shotsAway = parseInt(s.awayValue) || undefined;
          break;
        case "shots_on_target":
        case "on_target":
          result.onTargetHome = parseInt(s.homeValue) || undefined;
          result.onTargetAway = parseInt(s.awayValue) || undefined;
          break;
        case "corner_kicks":
        case "corners":
          result.cornersHome = parseInt(s.homeValue) || undefined;
          result.cornersAway = parseInt(s.awayValue) || undefined;
          break;
        case "fouls":
        case "fouls_committed":
          result.foulsHome = parseInt(s.homeValue) || undefined;
          result.foulsAway = parseInt(s.awayValue) || undefined;
          break;
        case "yellow_cards":
          result.yellowHome = parseInt(s.homeValue) || undefined;
          result.yellowAway = parseInt(s.awayValue) || undefined;
          break;
        case "dangerous_attacks":
          result.dangerousAttacksHome = parseInt(s.homeValue) || undefined;
          result.dangerousAttacksAway = parseInt(s.awayValue) || undefined;
          break;
        default:
          break;
      }
    });
  });
  return result;
}

/** Estima ataques perigosos quando ESPN não fornece */
function estimateDangerousAttacks(shots, possession) {
  return Math.round(shots * 3.5 + (possession / 100) * 20);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Busca todas as ligas em paralelo
    const results = await Promise.allSettled(LEAGUES.map(l => fetchLeague(l)));

    const games = results
      .filter(r => r.status === "fulfilled")
      .flatMap(r => r.value);

    // Se não há jogos ao vivo, retorna dados de demo para não travar o app
    if (games.length === 0) {
      return res.status(200).json({ games: [], liveCount: 0, demo: true });
    }

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ games, liveCount: games.length, demo: false });
  } catch (err) {
    console.error("ESPN fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch ESPN data", details: err.message });
  }
}
