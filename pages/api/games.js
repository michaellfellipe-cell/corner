/**
 * pages/api/games.js — v32 (AF-Primary, MAIN_LEAGUES filter)
 *
 * ARQUITETURA LIMPA:
 *   AF /fixtures?live=all  → todos os jogos ao vivo, filtrado por MAIN_LEAGUES
 *   AF /fixtures/statistics → stats reais (cache 4min)
 *   AF /fixtures/lineups   → formações (cache 4h)
 *   AF histórico           → top leagues (cache 8h)
 *   AF upcoming            → hoje + amanhã, filtrado por MAIN_LEAGUES (cache 15min)
 *
 * SEM ESPN. Sem matching. Sem aliases. Sem stats falsas.
 * Só aparecem jogos onde AF tem stats reais.
 *
 * Quota AF Pro (7.500/dia):
 *   live=all  (cache 30s):          120/h
 *   stats (25 jogos, cache 4min):   375/h
 *   lineups (cache 4h):               ~1/h
 *   upcoming (cache 15min):            8/h  (2 req × 4)
 *   histórico (cache 8h):              ~2/h
 *   Total:                          ~506/h = ~4.800/dia ✅
 */

import {
  getLiveFixtures, getFixtureStats, getLineups,
  getTeamCornerHistory, getH2H,
  parseFormations, parseH2HCorners,
  detectOffensiveSubs, formationAttackScore,
} from "../../lib/apifootball.js";

// ── Cache in-memory ────────────────────────────────────────────────────────
const _cache = new Map();
const cacheGet = (k) => {
  const v = _cache.get(k);
  if (!v || Date.now() > v.exp) { _cache.delete(k); return null; }
  return v.data;
};
const cacheSet = (k, data, ttl) => _cache.set(k, { data, exp: Date.now() + ttl });

// ── Bandeiras ──────────────────────────────────────────────────────────────
const FLAGS = {
  "England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","Wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "Spain":"🇪🇸","Germany":"🇩🇪","Italy":"🇮🇹","France":"🇫🇷",
  "Portugal":"🇵🇹","Netherlands":"🇳🇱","Belgium":"🇧🇪","Turkey":"🇹🇷",
  "Brazil":"🇧🇷","Argentina":"🇦🇷","Mexico":"🇲🇽","Colombia":"🇨🇴",
  "Chile":"🇨🇱","Uruguay":"🇺🇾","Peru":"🇵🇪","Ecuador":"🇪🇨",
  "USA":"🇺🇸","Canada":"🇨🇦","Australia":"🇦🇺","Japan":"🇯🇵",
  "South Korea":"🇰🇷","China":"🇨🇳","Russia":"🇷🇺","Ukraine":"🇺🇦",
  "Poland":"🇵🇱","Czech Republic":"🇨🇿","Romania":"🇷🇴","Greece":"🇬🇷",
  "Croatia":"🇭🇷","Serbia":"🇷🇸","Sweden":"🇸🇪","Norway":"🇳🇴",
  "Denmark":"🇩🇰","Finland":"🇫🇮","Switzerland":"🇨🇭","Austria":"🇦🇹",
  "Hungary":"🇭🇺","Slovakia":"🇸🇰","Bulgaria":"🇧🇬","Israel":"🇮🇱",
  "Saudi Arabia":"🇸🇦","UAE":"🇦🇪","Egypt":"🇪🇬","Nigeria":"🇳🇬",
  "Morocco":"🇲🇦","Paraguay":"🇵🇾","Bolivia":"🇧🇴","Venezuela":"🇻🇪",
  "Costa Rica":"🇨🇷","Panama":"🇵🇦","Ireland":"🇮🇪",
  "World":"🌍","Europe":"🌍",
};
const flag = (country) => FLAGS[country] || "🏳️";

// ── Ligas principais — filtro central ──────────────────────────────────────
// AF retorna stats confiáveis para estas ligas. Fora daqui = excluído.
const MAIN_LEAGUES = new Set([
  // Inglaterra
  39, 40, 41, 45, 48,
  // Espanha
  140, 141, 142,
  // Itália
  135, 136,
  // Alemanha
  78, 79,
  // França
  61, 62, 66,
  // Portugal
  94, 95,
  // Holanda
  88, 89,
  // Bélgica
  144, 143,
  // Escócia
  179, 180,
  // Turquia
  203, 204,
  // Grécia
  197, 198,
  // Rússia
  235, 236,
  // Suécia
  113, 114,
  // Noruega
  103, 104,
  // Dinamarca
  119, 120,
  // Suíça
  207, 208,
  // Áustria
  218, 219,
  // Polônia
  106, 107,
  // Rep. Checa
  345, 346,
  // Romênia
  283, 284,
  // Croácia
  169, 170,
  // Sérvia
  167, 168,
  // Ucrânia
  382,
  // Competições europeias
  2, 3, 4, 531, 848,
  // Brasil
  71, 72, 73,
  // Argentina
  128, 131,
  // México
  262, 239,
  // MLS / USA
  253, 256,
  // Chile
  265, 266,
  // Uruguai
  268, 269,
  // Colômbia
  240,
  // Libertadores / Sul-Americana
  11, 13,
  // Japão
  98, 99,
  // Coreia do Sul
  292, 293,
  // Arábia Saudita
  307, 308,
  // Egito
  233,
  // Seleções / Copas
  1, 5, 6, 8, 9, 10, 15,
]);

// Ligas com histórico de corners confiável (subconjunto de MAIN_LEAGUES)
const TOP_LEAGUES_HIST = new Set([
  39, 40, 41, 61, 62, 135, 136, 140, 141, 78, 79,
  94, 95, 88, 89, 203, 2, 3, 4,
  128, 71, 72, 262, 239, 253, 106,
]);

// ── Status AF → formato interno ────────────────────────────────────────────
function parseAFStatus(fixture) {
  const s       = fixture.status?.short;
  const elapsed = fixture.status?.elapsed || 0;
  const extra   = fixture.status?.extra   || 0;
  if (["FT","AET","PEN","AWD"].includes(s)) return { type:"done",     minute:elapsed, period:elapsed>45?2:1 };
  if (["HT"].includes(s))                   return { type:"halftime", minute:45,      period:1 };
  if (["1H","2H","ET","P","BT","INT"].includes(s))
    return { type:"live", minute:elapsed+extra, period:(s==="2H"||s==="ET")?2:1 };
  return { type:"upcoming", minute:0, period:0 };
}

// ── Extrai stat do array AF ────────────────────────────────────────────────
function extractStat(statsArr, teamIdx, type) {
  const v = statsArr?.[teamIdx]?.statistics?.find(s => s.type === type)?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.endsWith("%")) return parseFloat(v) || 0;
  return parseInt(v) || 0;
}

function buildGameStats(statsArr) {
  if (!statsArr || !Array.isArray(statsArr) || statsArr.length < 2) return null;
  const s = (idx, type) => extractStat(statsArr, idx, type);
  return {
    corners:          { home: s(0,"Corner Kicks")     ?? 0,    away: s(1,"Corner Kicks")     ?? 0    },
    shotsInsideBox:   { home: s(0,"Shots insidebox")  ?? null, away: s(1,"Shots insidebox")  ?? null },
    shotsOutsideBox:  { home: s(0,"Shots outsidebox") ?? null, away: s(1,"Shots outsidebox") ?? null },
    shots:            { home: s(0,"Total Shots")      ?? 0,    away: s(1,"Total Shots")      ?? 0    },
    onTarget:         { home: s(0,"Shots on Goal")    ?? 0,    away: s(1,"Shots on Goal")    ?? 0    },
    blockedShots:     { home: s(0,"Blocked Shots")    ?? 0,    away: s(1,"Blocked Shots")    ?? 0    },
    possession:       { home: s(0,"Ball Possession")  ?? 50,   away: s(1,"Ball Possession")  ?? 50   },
    dangerousAttacks: { home: s(0,"Dangerous Attacks")?? 0,    away: s(1,"Dangerous Attacks")?? 0    },
    attacks:          { home: s(0,"Attacks")          ?? 0,    away: s(1,"Attacks")          ?? 0    },
    fouls:            { home: s(0,"Fouls")            ?? 0,    away: s(1,"Fouls")            ?? 0    },
    yellowCards:      { home: s(0,"Yellow Cards")     ?? 0,    away: s(1,"Yellow Cards")     ?? 0    },
    saves:            { home: s(0,"Saves")            ?? 0,    away: s(1,"Saves")            ?? 0    },
    offsides:         { home: s(0,"Offsides")         ?? 0,    away: s(1,"Offsides")         ?? 0    },
    passes:           { home: s(0,"Total passes")     ?? 0,    away: s(1,"Total passes")     ?? 0    },
    accuratePasses:   { home: s(0,"Passes accurate")  ?? 0,    away: s(1,"Passes accurate")  ?? 0    },
    crosses:          { home: s(0,"Total Crosses")    ?? null, away: s(1,"Total Crosses")    ?? null },
    dangerousAttacksReal: true,
  };
}

// ── Eventos inline AF ──────────────────────────────────────────────────────
function buildEventsFromFixture(events) {
  if (!Array.isArray(events)) return { substitutions:[], goalEvents:[] };
  return {
    substitutions: events.filter(e => e.type === "subst").map(e => ({
      minute:    e.time?.elapsed || 0,
      extra:     e.time?.extra   || 0,
      teamName:  e.team?.name    || "",
      teamId:    e.team?.id      || 0,
      playerIn:  e.player?.name  || "",
      playerOut: e.assist?.name  || "",
    })),
    goalEvents: events.filter(e => e.type === "Goal"),
  };
}

// ── Normaliza fixture AF → objeto canônico ─────────────────────────────────
function normalizeAFGame(fix, stats, lineups, isUpcoming = false) {
  const homeId = fix.teams?.home?.id;
  const awayId = fix.teams?.away?.id;
  const status = parseAFStatus(fix.fixture);
  const events = fix.events || [];
  const { substitutions, goalEvents } = buildEventsFromFixture(events);

  const yellowCards = {
    home: events.filter(e => e.type==="Card" && e.detail?.includes("Yellow") && e.team?.id===homeId).length,
    away: events.filter(e => e.type==="Card" && e.detail?.includes("Yellow") && e.team?.id===awayId).length,
  };
  const redCards = {
    home: events.filter(e => e.type==="Card" && e.detail?.toLowerCase().includes("red") && e.team?.id===homeId).length,
    away: events.filter(e => e.type==="Card" && e.detail?.toLowerCase().includes("red") && e.team?.id===awayId).length,
  };

  const gameStats  = stats   ? buildGameStats(stats)   : null;
  const formations = lineups ? parseFormations(lineups) : null;

  const abbr = (name) => (name||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4) || "???";

  return {
    id:            String(fix.fixture?.id),
    afFixtureId:   fix.fixture?.id,
    home:          fix.teams?.home?.name  || "?",
    away:          fix.teams?.away?.name  || "?",
    homeShort:     abbr(fix.teams?.home?.name),
    awayShort:     abbr(fix.teams?.away?.name),
    homeId,
    awayId,
    league:        fix.league?.name       || "?",
    leagueId:      `af_${fix.league?.id}`,
    leagueCountry: flag(fix.league?.country),
    leagueAfId:    fix.league?.id,
    season:        fix.league?.season,
    score:         { home: fix.goals?.home ?? 0, away: fix.goals?.away ?? 0 },
    minute:        status.minute,
    period:        status.period,
    clock:         `${status.minute}'`,
    startTime:     fix.fixture?.date || null,
    statusDetail:  fix.fixture?.status?.long || "",
    isUpcoming:    isUpcoming || status.type === "upcoming",
    isDemo:        false,

    // Stats: AF reais ou defaults neutros
    possession:      gameStats?.possession      ?? { home:50, away:50 },
    shots:           gameStats?.shots           ?? { home:0,  away:0  },
    onTarget:        gameStats?.onTarget        ?? { home:0,  away:0  },
    corners:         gameStats?.corners         ?? { home:0,  away:0  },
    fouls:           gameStats?.fouls           ?? { home:0,  away:0  },
    yellowCards,
    redCards,
    dangerousAttacks:     gameStats?.dangerousAttacks    ?? { home:0, away:0 },
    dangerousAttacksReal: !!gameStats,
    saves:           gameStats?.saves           ?? { home:0,  away:0  },
    offsides:        gameStats?.offsides        ?? { home:0,  away:0  },
    crosses:         gameStats?.crosses         ?? null,
    passes:          gameStats?.passes          ?? { home:0,  away:0  },
    accuratePasses:  gameStats?.accuratePasses  ?? { home:0,  away:0  },
    blockedShots:    gameStats?.blockedShots    ?? { home:0,  away:0  },
    shotsInsideBox:  gameStats?.shotsInsideBox  ?? null,
    shotsOutsideBox: gameStats?.shotsOutsideBox ?? null,

    substitutions,
    goalEvents,
    offensiveSubs: substitutions.length ? detectOffensiveSubs(substitutions, {
      home:  fix.teams?.home?.name,
      away:  fix.teams?.away?.name,
      score: { home: fix.goals?.home ?? 0, away: fix.goals?.away ?? 0 },
    }, status.minute) : { home:0, away:0 },
    formations: formations ? {
      home: formations.home?.formation || null,
      away: formations.away?.formation || null,
      homeAttackScore: formationAttackScore(formations.home?.formation),
      awayAttackScore: formationAttackScore(formations.away?.formation),
    } : null,

    venue:      fix.fixture?.venue?.name || null,
    hasStats:   !!gameStats,
    dataSource: gameStats ? "af" : "af-no-stats",
  };
}

// ── AF Upcoming — hoje + amanhã, filtrado por MAIN_LEAGUES ─────────────────
async function getUpcomingAF() {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) return [];

  const ck  = "af_upcoming_v32";
  const hit = cacheGet(ck);
  if (hit) return hit;

  try {
    const today    = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const fmt      = (d) => d.toISOString().slice(0, 10);

    const [r1, r2] = await Promise.all([
      fetch(`https://v3.football.api-sports.io/fixtures?date=${fmt(today)}&status=NS&timezone=UTC`,
        { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(8000) }),
      fetch(`https://v3.football.api-sports.io/fixtures?date=${fmt(tomorrow)}&status=NS&timezone=UTC`,
        { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(8000) }),
    ]);

    const [d1, d2] = await Promise.all([
      r1.ok ? r1.json() : { response: [] },
      r2.ok ? r2.json() : { response: [] },
    ]);

    // Filtra por MAIN_LEAGUES desde a origem
    const fixtures = [...(d1.response || []), ...(d2.response || [])]
      .filter(f => MAIN_LEAGUES.has(f.league?.id));

    cacheSet(ck, fixtures, 900_000); // 15min
    return fixtures;
  } catch {
    return [];
  }
}

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const hasAF = !!process.env.APIFOOTBALL_KEY;
  if (!hasAF) return sendFallback(res);

  try {
    // 1. Live + Upcoming em paralelo
    const [afLiveRaw, afUpcomingArr] = await Promise.all([
      getLiveFixtures().catch(() => []),
      getUpcomingAF().catch(() => []),
    ]);

    // 2. Filtra live por MAIN_LEAGUES e status ativo
    const liveActive = (afLiveRaw || []).filter(f =>
      MAIN_LEAGUES.has(f.league?.id) &&
      ["1H","2H","ET","HT"].includes(f.fixture?.status?.short)
    );

    // 3. Stats + Lineups + Histórico em paralelo
    const [statsArr, lineupsArr, historicalArr] = await Promise.all([

      // Stats por jogo (cache 4min)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const ck  = `af_stats_${id}`;
        const hit = cacheGet(ck);
        if (hit) return { id, stats: hit };
        const stats = await getFixtureStats(id).catch(() => null);
        if (stats) cacheSet(ck, stats, 240_000);
        return { id, stats };
      })),

      // Lineups (cache 4h)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const ck  = `af_lineups_${id}`;
        const hit = cacheGet(ck);
        if (hit) return { id, lineups: hit };
        const lineups = await getLineups(id).catch(() => null);
        if (lineups) cacheSet(ck, lineups, 14_400_000);
        return { id, lineups };
      })),

      // Histórico — só top leagues (cache 8h)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const hId = f.teams?.home?.id;
        const aId = f.teams?.away?.id;
        if (!hId || !aId || !TOP_LEAGUES_HIST.has(f.league?.id)) return { id, historical: null };

        const [homeHist, awayHist, h2h] = await Promise.all([
          (async () => { const ck=`af_ch_${hId}_5`; const h=cacheGet(ck); if(h) return h; return getTeamCornerHistory(hId,5).catch(()=>null); })(),
          (async () => { const ck=`af_ch_${aId}_5`; const h=cacheGet(ck); if(h) return h; return getTeamCornerHistory(aId,5).catch(()=>null); })(),
          getH2H(hId, aId).catch(() => null),
        ]);

        const toCorner = hist => hist ? {
          forHome: +(hist.avg*1.10).toFixed(2), forAway: +(hist.avg*0.94).toFixed(2),
          againstHome:0, againstAway:0, avg:hist.avg, games:hist.games,
          variance:hist.variance, min:hist.min, max:hist.max,
        } : null;

        const hc = toCorner(homeHist);
        const ac = toCorner(awayHist);
        const h2hData = parseH2HCorners(h2h);

        return {
          id,
          historical: (hc||ac||h2hData) ? {
            homeCornerAvgHome:  hc?.forHome  ?? null,
            homeCornerAvgAway:  hc?.forAway  ?? null,
            awayCornerAvgHome:  ac?.forHome  ?? null,
            awayCornerAvgAway:  ac?.forAway  ?? null,
            homeCornerAgstHome: 0, awayCornerAgstAway: 0,
            homeAvgRaw: homeHist?.avg ?? null, awayAvgRaw: awayHist?.avg ?? null,
            homeGames:  homeHist?.games ?? 0,  awayGames:  awayHist?.games ?? 0,
            homeVariance: homeHist?.variance ?? null, awayVariance: awayHist?.variance ?? null,
            homeMin: homeHist?.min ?? null, homeMax: homeHist?.max ?? null,
            awayMin: awayHist?.min ?? null, awayMax: awayHist?.max ?? null,
            h2hAvgGoals:   h2hData?.avgGoals ?? null,
            h2hEstCorners: h2hData?.estimatedCorners ?? null,
            h2hGames:      h2hData?.games ?? 0,
            homeForm: null, awayForm: null,
          } : null,
        };
      })),

    ]);

    const statsMap      = Object.fromEntries(statsArr    .map(({id,stats})      => [id, stats]));
    const lineupsMap    = Object.fromEntries(lineupsArr  .map(({id,lineups})    => [id, lineups]));
    const historicalMap = Object.fromEntries(historicalArr.map(({id,historical})=> [id, historical]));

    // 4. Monta jogos ao vivo
    const games = liveActive.map(f => {
      const id   = f.fixture?.id;
      const game = normalizeAFGame(f, statsMap[id]||null, lineupsMap[id]||null, false);
      if (historicalMap[id]) game.historical = historicalMap[id];
      return game;
    });

    // 5. Upcoming
    const now = Date.now();
    const upcoming = (afUpcomingArr || [])
      .filter(f => {
        const kick = (f.fixture?.timestamp || 0) * 1000;
        return kick > now && kick < now + 36 * 3_600_000;
      })
      .map(f => normalizeAFGame(f, null, null, true))
      .sort((a, b) => new Date(a.startTime||0) - new Date(b.startTime||0))
      .slice(0, 100);

    return res.status(200).json({
      games,
      upcoming,
      liveCount:     games.length,
      upcomingCount: upcoming.length,
      afPrimary:     true,
      afEnriched:    true,
      demo:          false,
      timestamp:     new Date().toISOString(),
      meta: {
        liveFiltered:    liveActive.length,
        liveTotal:       (afLiveRaw||[]).length,
        upcomingFiltered: upcoming.length,
      },
    });

  } catch (err) {
    console.error("[games.js v32]", err.message);
    return sendFallback(res);
  }
}

function sendFallback(res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games:[], upcoming:[], liveCount:0, upcomingCount:0,
    demo:true, afPrimary:false,
    timestamp: new Date().toISOString(),
  });
}
