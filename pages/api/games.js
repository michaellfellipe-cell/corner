/**
 * pages/api/games.js — v31 (Hybrid: ESPN lista + AF enriquece)
 *
 * ARQUITETURA HÍBRIDA:
 *   ESPN Scoreboard  → descoberta gratuita (20-50 jogos ao vivo, sem quota AF)
 *   AF /fixtures?live=all → fixture IDs + eventos inline (1 req, cache 30s)
 *   AF /fixtures/statistics → stats reais por jogo matched (cache 4min)
 *   AF /fixtures/lineups   → formações (cache 4h)
 *   AF histórico           → apenas top leagues (cache 8h)
 *
 * Quota estimada (AF Pro 7.500/dia):
 *   ESPN: GRÁTIS, zero impacto na quota AF
 *   AF live=all (cache 30s):           120/h
 *   AF stats  (30 jogos, cache 4min):  450/h pico
 *   AF lineups (cache 4h):              ~1/h
 *   AF upcoming (cache 15min):           4/h
 *   AF histórico (cache 8h):             ~2/h
 *   Total pico estimado:               ~577/h = ~5.500/dia abaixo de 7.500
 */

import {
  getLiveFixtures, getFixtureStats, getLineups,
  getTeamCornerHistory, getH2H,
  matchAFFixture,
  parseFormations, parseH2HCorners,
  detectOffensiveSubs, formationAttackScore,
} from "../../lib/apifootball.js";

// ── Cache in-memory ─────────────────────────────────────────────────────────
const _cache = new Map();
const cacheGet = (k) => {
  const v = _cache.get(k);
  if (!v || Date.now() > v.exp) { _cache.delete(k); return null; }
  return v.data;
};
const cacheSet = (k, data, ttl) => _cache.set(k, { data, exp: Date.now() + ttl });

// ── Bandeiras ───────────────────────────────────────────────────────────────
const FLAGS = {
  "England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","Wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "Spain":"🇪🇸","Germany":"🇩🇪","Italy":"🇮🇹","France":"🇫🇷",
  "Portugal":"🇵🇹","Netherlands":"🇳🇱","Belgium":"🇧🇪","Turkey":"🇹🇷",
  "Brazil":"🇧🇷","Argentina":"🇦🇷","Mexico":"🇲🇽","Colombia":"🇨🇴",
  "Chile":"🇨🇱","Uruguay":"🇺🇾","Peru":"🇵🇪","Ecuador":"🇪🇨",
  "USA":"🇺🇸","Canada":"🇨🇦","Australia":"🇦🇺","Japan":"🇯🇵",
  "South Korea":"🇰🇷","China":"🇨🇳","India":"🇮🇳",
  "Russia":"🇷🇺","Ukraine":"🇺🇦","Poland":"🇵🇱","Czech Republic":"🇨🇿",
  "Romania":"🇷🇴","Greece":"🇬🇷","Croatia":"🇭🇷","Serbia":"🇷🇸",
  "Sweden":"🇸🇪","Norway":"🇳🇴","Denmark":"🇩🇰","Finland":"🇫🇮",
  "Switzerland":"🇨🇭","Austria":"🇦🇹","Hungary":"🇭🇺","Slovakia":"🇸🇰",
  "Bulgaria":"🇧🇬","Israel":"🇮🇱","Saudi Arabia":"🇸🇦","UAE":"🇦🇪",
  "Egypt":"🇪🇬","Nigeria":"🇳🇬","South Africa":"🇿🇦","Morocco":"🇲🇦",
  "Ghana":"🇬🇭","Ivory Coast":"🇨🇮","Cameroon":"🇨🇲",
  "Paraguay":"🇵🇾","Bolivia":"🇧🇴","Venezuela":"🇻🇪",
  "Guatemala":"🇬🇹","Honduras":"🇭🇳","Costa Rica":"🇨🇷",
  "Panama":"🇵🇦","Jamaica":"🇯🇲","Trinidad And Tobago":"🇹🇹",
  "Malta":"🇲🇹","Cyprus":"🇨🇾","Ireland":"🇮🇪",
  "World":"🌍","Europe":"🌍",
};
const flag = (country) => FLAGS[country] || "🏳️";

// ── Normaliza string para matching fuzzy ────────────────────────────────────
function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|ac|afc|bfc|sfc|rc|rcd|sd|ud|cd|if|sk|bk|fk|atletico|athletic|sporting)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Status AF → formato interno ─────────────────────────────────────────────
function parseAFStatus(fixture) {
  const s       = fixture.status?.short;
  const elapsed = fixture.status?.elapsed || 0;
  const extra   = fixture.status?.extra   || 0;
  if (["FT","AET","PEN","AWD"].includes(s)) return { type:"done",     minute:elapsed, period:elapsed>45?2:1 };
  if (["HT"].includes(s))                   return { type:"halftime", minute:45,      period:1 };
  if (["1H","2H","ET","P","BT","INT"].includes(s))
    return { type:"live", minute:elapsed+extra, period:s==="2H"||s==="ET"?2:1 };
  return { type:"upcoming", minute:0, period:0 };
}

// ── Stats AF ────────────────────────────────────────────────────────────────
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

// ── Eventos inline AF ───────────────────────────────────────────────────────
function buildEventsFromFixture(events) {
  if (!Array.isArray(events))
    return { substitutions:[], goalEvents:[] };
  const substitutions = events
    .filter(e => e.type === "subst")
    .map(e => ({
      minute:    e.time?.elapsed || 0,
      extra:     e.time?.extra   || 0,
      teamName:  e.team?.name    || "",
      teamId:    e.team?.id      || 0,
      playerIn:  e.player?.name  || "",
      playerOut: e.assist?.name  || "",
    }));
  return { substitutions, goalEvents: events.filter(e => e.type === "Goal") };
}

// ── Normaliza fixture AF → objeto canônico ──────────────────────────────────
// espnStats: stats básicas da ESPN como fallback quando AF stats são null
function normalizeAFGame(fix, stats, lineups, isUpcoming = false, espnStats = null) {
  const homeId = fix.teams?.home?.id;
  const awayId = fix.teams?.away?.id;
  const status = parseAFStatus(fix.fixture);
  const events = fix.events || [];
  const { substitutions } = buildEventsFromFixture(events);

  const yellowCards = {
    home: events.filter(e => e.type==="Card" && e.detail?.includes("Yellow") && e.team?.id===homeId).length,
    away: events.filter(e => e.type==="Card" && e.detail?.includes("Yellow") && e.team?.id===awayId).length,
  };
  const redCards = {
    home: events.filter(e => e.type==="Card" && (e.detail?.includes("Red")||e.detail?.includes("red")) && e.team?.id===homeId).length,
    away: events.filter(e => e.type==="Card" && (e.detail?.includes("Red")||e.detail?.includes("red")) && e.team?.id===awayId).length,
  };

  const gameStats  = stats   ? buildGameStats(stats)   : null;
  const formations = lineups ? parseFormations(lineups) : null;

  const homeShort = fix.teams?.home?.name?.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4) || "HOM";
  const awayShort = fix.teams?.away?.name?.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4) || "AWY";

  return {
    id:            String(fix.fixture?.id),
    afFixtureId:   fix.fixture?.id,
    home:          fix.teams?.home?.name  || "?",
    away:          fix.teams?.away?.name  || "?",
    homeShort,
    awayShort,
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

    // Stats: AF primeiro, ESPN como fallback, default neutro
    // es_ = espnStats helper
    possession:    gameStats?.possession    ?? (espnStats ? { home: espnStats.home.possession ?? 50, away: espnStats.away.possession ?? 50 } : { home:50, away:50 }),
    shots:         gameStats?.shots         ?? (espnStats ? { home: espnStats.home.shots ?? 0,       away: espnStats.away.shots ?? 0       } : { home:0, away:0 }),
    onTarget:      gameStats?.onTarget      ?? (espnStats ? { home: espnStats.home.onTarget ?? 0,    away: espnStats.away.onTarget ?? 0    } : { home:0, away:0 }),
    corners:       gameStats?.corners       ?? (espnStats ? { home: espnStats.home.corners ?? 0,     away: espnStats.away.corners ?? 0     } : { home:0, away:0 }),
    fouls:         gameStats?.fouls         ?? (espnStats ? { home: espnStats.home.fouls ?? 0,       away: espnStats.away.fouls ?? 0       } : { home:0, away:0 }),
    yellowCards,
    redCards,
    dangerousAttacks:     gameStats?.dangerousAttacks    ?? { home:0, away:0 },
    dangerousAttacksReal: !!gameStats,
    saves:         gameStats?.saves         ?? (espnStats ? { home: espnStats.home.saves ?? 0,       away: espnStats.away.saves ?? 0       } : { home:0, away:0 }),
    offsides:      gameStats?.offsides      ?? (espnStats ? { home: espnStats.home.offsides ?? 0,    away: espnStats.away.offsides ?? 0    } : { home:0, away:0 }),
    blockedShots:  gameStats?.blockedShots  ?? (espnStats ? { home: espnStats.home.blockedShots ?? 0,away: espnStats.away.blockedShots ?? 0} : { home:0, away:0 }),
    // AF-exclusive: ESPN não tem estes campos
    crosses:       gameStats?.crosses       ?? null,
    passes:        gameStats?.passes        ?? { home:0,  away:0  },
    accuratePasses:gameStats?.accuratePasses?? { home:0,  away:0  },
    shotsInsideBox:  gameStats?.shotsInsideBox  ?? null,
    shotsOutsideBox: gameStats?.shotsOutsideBox ?? null,

    substitutions,
    offensiveSubs: substitutions.length ? detectOffensiveSubs(substitutions, {
      home:  fix.teams?.home?.name, away: fix.teams?.away?.name,
      score: { home: fix.goals?.home ?? 0, away: fix.goals?.away ?? 0 },
    }, status.minute) : { home:0, away:0 },
    formations: formations ? {
      home: formations.home?.formation || null,
      away: formations.away?.formation || null,
      homeAttackScore: formationAttackScore(formations.home?.formation),
      awayAttackScore: formationAttackScore(formations.away?.formation),
    } : null,

    venue:      fix.fixture?.venue?.name || null,
    // hasStats: AF stats reais OU ESPN stats como fallback
    hasStats:   !!(gameStats || espnStats),
    dataSource: gameStats ? "af" : (espnStats ? "espn-stats" : "af-no-stats"),
  };
}

// ── Normaliza jogo ESPN sem match AF — usa stats ESPN quando disponíveis ──────
function normalizeEspnOnlyGame(eg) {
  const homeShort = (eg.homeName||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4)||"HOM";
  const awayShort = (eg.awayName||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase().slice(0,4)||"AWY";

  const es = eg.espnStats; // { home, away } ou null
  const h  = es?.home;
  const a  = es?.away;

  // Helper: retorna valor ESPN ou default
  const ev = (val, def) => (val !== null && val !== undefined) ? val : def;

  return {
    id:            `espn_${eg.id}`,
    afFixtureId:   null,
    home:          eg.homeName || "?",
    away:          eg.awayName || "?",
    homeShort,
    awayShort,
    homeId:        null,
    awayId:        null,
    league:        eg.leagueName || "?",
    leagueId:      `espn_${eg.leagueSlug || "?"}`,
    leagueCountry: "🏳️",
    leagueAfId:    null,
    season:        null,
    score:         { home: eg.homeScore ?? 0, away: eg.awayScore ?? 0 },
    minute:        eg.minute  ?? 0,
    period:        eg.period  ?? 1,
    clock:         eg.minute  ? `${eg.minute}'` : "?",
    startTime:     eg.startTime || null,
    statusDetail:  eg.statusDetail || "",
    isUpcoming:    false,
    isDemo:        false,

    // Stats: ESPN quando disponível, fallback neutro quando não
    possession:    { home: ev(h?.possession, 50),  away: ev(a?.possession, 50)  },
    shots:         { home: ev(h?.shots, 0),         away: ev(a?.shots, 0)         },
    onTarget:      { home: ev(h?.onTarget, 0),      away: ev(a?.onTarget, 0)      },
    corners:       { home: ev(h?.corners, 0),       away: ev(a?.corners, 0)       },
    fouls:         { home: ev(h?.fouls, 0),         away: ev(a?.fouls, 0)         },
    yellowCards:   { home: ev(h?.yellowCards, 0),   away: ev(a?.yellowCards, 0)   },
    redCards:      { home: ev(h?.redCards, 0),      away: ev(a?.redCards, 0)      },
    saves:         { home: ev(h?.saves, 0),         away: ev(a?.saves, 0)         },
    offsides:      { home: ev(h?.offsides, 0),      away: ev(a?.offsides, 0)      },
    blockedShots:  { home: ev(h?.blockedShots, 0),  away: ev(a?.blockedShots, 0)  },
    // Campos que ESPN não fornece — nulos (AF exclusive)
    dangerousAttacks:     { home:0, away:0 },
    dangerousAttacksReal: false,
    crosses:       null,
    passes:        { home:0, away:0 },
    accuratePasses:{ home:0, away:0 },
    shotsInsideBox: null,
    shotsOutsideBox: null,
    substitutions: [], offensiveSubs: { home:0, away:0 },
    formations:    null,
    venue:         null,
    // hasStats: true se ESPN retornou algum dado real
    hasStats:      !!es,
    dataSource:    es ? "espn-stats" : "espn-only",
  };
}

// ── Ligas top para histórico AF ─────────────────────────────────────────────
const TOP_LEAGUES_HIST = new Set([
  39,40,41, 61,62, 135,136, 140,141, 78,79,
  94,95, 88,89, 203, 2,3,4,
  128, 71,72, 262,239, 253, 106,
]);

// ── Ligas principais para upcoming (equivalente ao escopo das ~110 da ESPN) ──
const MAIN_LEAGUES = new Set([
  39,40,41,45,48,       // Inglaterra 1/2/3/FA Cup/League Cup
  140,141,142,           // Espanha 1/2/3
  135,136,               // Itália 1/2
  78,79,                 // Alemanha 1/2
  61,62,66,              // França 1/2/3
  94,95,                 // Portugal 1/2
  88,89,                 // Holanda 1/2
  144,143,               // Bélgica 1/2
  179,180,               // Escócia 1/2
  203,204,               // Turquia 1/2
  197,198,               // Grécia 1/2
  235,236,               // Rússia 1/2
  113,114,               // Suécia 1/2
  103,104,               // Noruega 1/2
  119,120,               // Dinamarca 1/2
  207,208,               // Suíça 1/2
  218,219,               // Áustria 1/2
  106,107,               // Polônia 1/2
  345,346,               // Rep. Checa 1/2
  283,284,               // Romênia 1/2
  169,170,               // Croácia 1/2
  167,168,               // Sérvia 1/2
  382,                   // Ucrânia
  2,3,4,531,848,         // Champions/Europa/Conference/Supercopas
  71,72,73,              // Brasil 1/2/3
  128,131,               // Argentina 1/2
  262,239,               // México 1/2
  253,256,               // MLS/USL
  265,266,               // Chile 1/2
  268,269,               // Uruguai 1/2
  240,                   // Colômbia 2
  11,13,                 // Libertadores/Sul-Americana
  98,99,                 // Japão 1/2
  292,293,               // Coreia 1/2
  307,308,               // Arábia Saudita 1/2
  233,                   // Egito
  1,5,6,8,9,10,15,      // Copas do Mundo/Eliminatórias/Nations League
]);

// ── ESPN Scoreboard — hoje + amanhã (cache 30s para live, 10min para upcoming)
async function fetchEspnScoreboard() {
  const ck  = "espn_scoreboard";
  const hit = cacheGet(ck);
  if (hit) return hit;

  try {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const yyyymmdd = tomorrow.toISOString().slice(0,10).replace(/-/g,"");

    // Busca hoje (live + upcoming do dia) e amanhã em paralelo
    const [r1, r2] = await Promise.all([
      fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=200",
        { signal: AbortSignal.timeout(7000) }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=200&dates=${yyyymmdd}`,
        { signal: AbortSignal.timeout(7000) }),
    ]);

    const [j1, j2] = await Promise.all([
      r1.ok ? r1.json() : { events: [] },
      r2.ok ? r2.json() : { events: [] },
    ]);

    const events = [...(j1.events || []), ...(j2.events || [])];

    const live     = [];
    const upcoming = [];

    for (const ev of events) {
      const comp   = ev.competitions?.[0];
      const state  = comp?.status?.type?.state;
      if (state !== "in" && state !== "pre") continue;

      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      if (!home || !away) continue;

      // Minuto: parse de displayClock "88:00" → 88
      let minute = 0;
      let period = comp?.status?.period ?? 1;
      const clockStr = comp?.status?.displayClock || "";
      if (state === "in") {
        const m = clockStr.match(/^(\d+)/);
        if (m) {
          minute = parseInt(m[1]);
        } else if (/HT|halftime/i.test(clockStr)) {
          minute = 45; period = 1;
        }
        // Período 2 com minuto baixo → adiciona base 45
        if (period === 2 && minute > 0 && minute < 46) minute = 45 + minute;
      }

      // Extrai stats básicas ESPN do array statistics dos competitors
      // ESPN retorna: possessionPct, shots, shotsOnTarget, fouls,
      //               yellowCards, redCards, corners, offsides, saves
      const espnStat = (competitor, name) => {
        const s = competitor.statistics?.find(x =>
          x.name === name || x.abbreviation === name
        );
        if (!s || s.displayValue === "--") return null;
        const v = parseFloat(s.displayValue);
        return isNaN(v) ? null : v;
      };

      const homeStats = {
        possession: espnStat(home, "possessionPct"),
        shots:      espnStat(home, "shots"),
        onTarget:   espnStat(home, "shotsOnTarget"),
        fouls:      espnStat(home, "fouls"),
        yellowCards:espnStat(home, "yellowCards"),
        redCards:   espnStat(home, "redCards"),
        corners:    espnStat(home, "corners"),
        offsides:   espnStat(home, "offsides"),
        saves:      espnStat(home, "saves"),
        blockedShots: espnStat(home, "blockedShots"),
      };
      const awayStats = {
        possession: espnStat(away, "possessionPct"),
        shots:      espnStat(away, "shots"),
        onTarget:   espnStat(away, "shotsOnTarget"),
        fouls:      espnStat(away, "fouls"),
        yellowCards:espnStat(away, "yellowCards"),
        redCards:   espnStat(away, "redCards"),
        corners:    espnStat(away, "corners"),
        offsides:   espnStat(away, "offsides"),
        saves:      espnStat(away, "saves"),
        blockedShots: espnStat(away, "blockedShots"),
      };

      // hasEspnStats: true se ao menos shots ou possession veio preenchido
      const hasEspnStats = homeStats.shots !== null || homeStats.possession !== null;

      const parsed = {
        id:           ev.id,
        homeName:     home.team?.displayName || "?",
        awayName:     away.team?.displayName || "?",
        homeScore:    parseInt(home.score || "0"),
        awayScore:    parseInt(away.score || "0"),
        leagueName:   ev.league?.name || ev.league?.abbreviation || "?",
        leagueSlug:   ev.league?.slug || "",
        minute,
        period,
        statusDetail: comp?.status?.type?.description || "",
        startTime:    ev.date || null,
        // Stats ESPN (nulas quando não disponíveis — não zeros)
        espnStats: hasEspnStats ? { home: homeStats, away: awayStats } : null,
      };

      if (state === "in")  live.push(parsed);
      if (state === "pre") upcoming.push(parsed);
    }

    const result = { live, upcoming };
    cacheSet(ck, result, 30_000); // 30s
    return result;
  } catch {
    return { live:[], upcoming:[] };
  }
}

// ── AF Upcoming — hoje + amanhã (cache 15min) ──────────────────────────────
// Busca dois dias para cobrir madrugada quando jogos do dia acabaram
async function getUpcomingAF() {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) return [];

  const ck  = "af_upcoming";
  const hit = cacheGet(ck);
  if (hit) return hit;

  try {
    const today    = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const fmt = (d) => d.toISOString().slice(0, 10);

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

    const fixtures = [...(d1.response || []), ...(d2.response || [])];
    cacheSet(ck, fixtures, 900_000); // 15min
    return fixtures;
  } catch {
    return [];
  }
}

// ── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const hasAF = !!process.env.APIFOOTBALL_KEY;
  if (!hasAF) return sendFallback(res);

  try {
    // PASSO 1 — ESPN (grátis) + AF live + AF upcoming em paralelo
    const [espnBoard, afLiveRaw, afUpcomingArr] = await Promise.all([
      fetchEspnScoreboard().catch(() => ({ live:[], upcoming:[] })),
      getLiveFixtures().catch(() => []),
      getUpcomingAF().catch(() => []),
    ]);

    const espnLive     = espnBoard.live     || [];
    const espnUpcoming = espnBoard.upcoming || [];
    const afLiveArr    = afLiveRaw          || [];

    // PASSO 2 — Match ESPN ao vivo ↔ AF fixture
    // Mapa de espnStats por nome normalizado para fallback af-no-stats
    const espnStatsMap = {};
    for (const eg of espnLive) {
      if (eg.espnStats) {
        const key = normName(eg.homeName) + "_" + normName(eg.awayName);
        espnStatsMap[key] = eg.espnStats;
      }
    }

    const espnWithAF = espnLive.map(eg => ({
      espnGame:  eg,
      afFixture: matchAFFixture(afLiveArr, eg.homeName, eg.awayName) || null,
    }));

    const matched   = espnWithAF.filter(x => x.afFixture !== null);
    const espnOnly  = espnWithAF.filter(x => x.afFixture === null);

    // ESPN é a fonte de verdade: AF só enriquece os jogos que ESPN trouxe
    // Jogos AF sem match ESPN (ligas fora do ESPN) são ignorados intencionalmente
    const liveActive = matched
      .map(x => x.afFixture)
      .filter(f => ["1H","2H","ET","HT"].includes(f.fixture?.status?.short));

    // PASSO 3 — Stats + Lineups + Histórico em paralelo (só fixtures AF)
    const [statsArr, lineupsArr, historicalArr] = await Promise.all([

      // Stats (cache 4min — aumentado de 3min para poupar quota)
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const ck  = `af_stats_${id}`;
        const hit = cacheGet(ck);
        if (hit) return { id, stats: hit };
        const stats = await getFixtureStats(id).catch(() => null);
        if (stats) cacheSet(ck, stats, 240_000); // 4min
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

      // Histórico: só top leagues, last=5, cache 8h
      Promise.all(liveActive.map(async f => {
        const id  = f.fixture?.id;
        const hId = f.teams?.home?.id;
        const aId = f.teams?.away?.id;
        if (!hId || !aId || !TOP_LEAGUES_HIST.has(f.league?.id)) return { id, historical: null };

        const [homeHist, awayHist, h2h] = await Promise.all([
          (async () => {
            const ck = `af_corner_hist_${hId}_5`;
            const hit = cacheGet(ck); if (hit) return hit;
            return getTeamCornerHistory(hId, 5).catch(() => null);
          })(),
          (async () => {
            const ck = `af_corner_hist_${aId}_5`;
            const hit = cacheGet(ck); if (hit) return hit;
            return getTeamCornerHistory(aId, 5).catch(() => null);
          })(),
          getH2H(hId, aId).catch(() => null),
        ]);

        const toCorner = hist => hist ? {
          forHome:     +(hist.avg * 1.10).toFixed(2),
          forAway:     +(hist.avg * 0.94).toFixed(2),
          againstHome: 0, againstAway: 0,
          avg: hist.avg, games: hist.games,
          variance: hist.variance, min: hist.min, max: hist.max,
        } : null;

        const hc      = toCorner(homeHist);
        const ac      = toCorner(awayHist);
        const h2hData = parseH2HCorners(h2h);

        return {
          id,
          historical: (hc || ac || h2hData) ? {
            homeCornerAvgHome:  hc?.forHome  ?? null,
            homeCornerAvgAway:  hc?.forAway  ?? null,
            awayCornerAvgHome:  ac?.forHome  ?? null,
            awayCornerAvgAway:  ac?.forAway  ?? null,
            homeCornerAgstHome: 0, awayCornerAgstAway: 0,
            homeAvgRaw:   homeHist?.avg      ?? null,
            awayAvgRaw:   awayHist?.avg      ?? null,
            homeGames:    homeHist?.games    ?? 0,
            awayGames:    awayHist?.games    ?? 0,
            homeVariance: homeHist?.variance ?? null,
            awayVariance: awayHist?.variance ?? null,
            homeMin:      homeHist?.min      ?? null,
            homeMax:      homeHist?.max      ?? null,
            awayMin:      awayHist?.min      ?? null,
            awayMax:      awayHist?.max      ?? null,
            h2hAvgGoals:   h2hData?.avgGoals        ?? null,
            h2hEstCorners: h2hData?.estimatedCorners ?? null,
            h2hGames:      h2hData?.games            ?? 0,
            homeForm: null, awayForm: null,
          } : null,
        };
      })),

    ]); // fim Promise.all geral

    const statsMap      = Object.fromEntries(statsArr    .map(({id,stats})     => [id, stats]));
    const lineupsMap    = Object.fromEntries(lineupsArr  .map(({id,lineups})   => [id, lineups]));
    const historicalMap = Object.fromEntries(historicalArr.map(({id,historical})=> [id, historical]));

    // PASSO 4 — Monta jogos ao vivo

    // 4a. Matched ESPN + AF (dados completos com stats)
    // Quando AF stats são null, usa ESPN stats como fallback
    const gamesMatched = matched.map(({ espnGame, afFixture }) => {
      const id   = afFixture.fixture?.id;
      const key  = normName(espnGame.homeName) + "_" + normName(espnGame.awayName);
      const eStats = espnStatsMap[key] || null;
      const game = normalizeAFGame(afFixture, statsMap[id]||null, lineupsMap[id]||null, false, eStats);
      if (historicalMap[id]) game.historical = historicalMap[id];
      return game;
    });

    // 4b. Só ESPN (sem match AF) — mostra jogo, sem análise de stats
    const gamesEspnOnly = espnOnly.map(({ espnGame }) => normalizeEspnOnlyGame(espnGame));

    // Ordem: matched primeiro (dados completos AF) → ESPN-only (básicos, sem AF)
    const allLiveGames = [...gamesMatched, ...gamesEspnOnly];

    // PASSO 5 — Upcoming
    // AF é a fonte primária (não tem problema de fuso como a ESPN)
    // filtrada pelas MAIN_LEAGUES (equivalente ao escopo da ESPN)
    // ESPN enriquece com dados onde possível
    const now = Date.now();

    // Mapa de jogos ESPN upcoming para enriquecimento por nome
    const espnUpcomingByKey = {};
    for (const eg of espnUpcoming) {
      if (!eg.startTime) continue;
      const kick = new Date(eg.startTime).getTime();
      if (kick <= now || kick > now + 36 * 3_600_000) continue;
      const key = normName(eg.homeName) + "_" + normName(eg.awayName);
      espnUpcomingByKey[key] = eg;
    }

    // AF upcoming filtrado a MAIN_LEAGUES → base confiável independente de fuso
    const upcomingFromAF = afUpcomingArr
      .filter(f => {
        if (!MAIN_LEAGUES.has(f.league?.id)) return false;
        const kick = (f.fixture?.timestamp || 0) * 1000;
        return kick > now && kick < now + 36 * 3_600_000;
      })
      .map(f => {
        const game = normalizeAFGame(f, null, null, true);
        // Enriquece com dado ESPN se tiver (startTime local, leagueName curto)
        const key = normName(game.home) + "_" + normName(game.away);
        const eg  = espnUpcomingByKey[key];
        if (eg) game.dataSource = "hybrid";
        return game;
      });

    const upcoming = upcomingFromAF
      .sort((a, b) => new Date(a.startTime||0) - new Date(b.startTime||0))
      .slice(0, 100);

    // PASSO 6 — Resposta
    return res.status(200).json({
      games:         allLiveGames,
      upcoming,
      liveCount:     allLiveGames.length,
      upcomingCount: upcoming.length,
      afPrimary:     true,
      afEnriched:    true,
      hybrid:        true,
      demo:          false,
      timestamp:     new Date().toISOString(),
      meta: {
        espnLive:  espnLive.length,
        afLive:    afLiveArr.length,
        matched:   matched.length,
        espnOnly:  espnOnly.length,
      },
    });

  } catch (err) {
    console.error("[games.js v31 error]", err.message);
    return sendFallback(res);
  }
}

// ── Fallback sem AF ──────────────────────────────────────────────────────────
function sendFallback(res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    games:[], upcoming:[], liveCount:0, upcomingCount:0,
    demo:true, afPrimary:false, hybrid:false,
    timestamp: new Date().toISOString(),
  });
}
