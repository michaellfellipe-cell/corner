/**
 * lib/predictor.js — v4 CALIBRADO
 *
 * Médias reais de futebol europeu:
 *   ~10 escanteios/jogo = 0.111/min
 *   Jogos de alta pressão: até ~14 = 0.156/min
 *   Em 10 minutos, realista: 0.8 – 2.2 escanteios
 *   Máximo absoluto realista em 10min: 3.0
 *
 * Confiança 85%+ deve ser RARA — apenas quando há
 * múltiplos indicadores fortes E a taxa histórica do jogo já é alta.
 */

const safe = (v, def = 0) => (v !== undefined && v !== null && !isNaN(v) ? Number(v) : def);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rate  = (val, min)  => min > 1 ? val / min : 0;

// ── Análise por time ──────────────────────────────────────────────────────────
function analyzeTeam(s, min) {
  const corners    = safe(s.wonCorners);
  const crosses    = safe(s.totalCrosses);
  const onTarget   = safe(s.shotsOnTarget, safe(s.shotsOnGoal));
  const shots      = safe(s.totalShots, safe(s.shots));
  const saves      = safe(s.saves);
  const clearances = safe(s.effectiveClearance, safe(s.effectiveClearances));
  const fouls      = safe(s.foulsCommitted, safe(s.fouls));
  const possession = safe(s.possessionPct, safe(s.possession, 50));
  const blocked    = safe(s.blockedShots);
  const offsides   = safe(s.offsides);
  const longBalls  = safe(s.totalLongBalls);

  return {
    corners, crosses, onTarget, shots, saves,
    clearances, fouls, possession, blocked, offsides, longBalls,
    crossRate:  rate(crosses, min),
    cornerRate: rate(corners, min),
    onTgtRate:  rate(onTarget, min),
  };
}

// ── Multiplicador de pressão — CONSERVADOR ────────────────────────────────────
// Máximo real: 1.7× (não mais 3.5×)
function calcPressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };

  const min = game.minute;

  // Cruzamentos (melhor preditor de corner) — ambos os times
  const crossRate = H.crossRate + A.crossRate;
  if (crossRate > 0.40)      add("Volume alto de cruzamentos",  `${(crossRate*10).toFixed(1)}/10min`, "high",   0.18);
  else if (crossRate > 0.22) add("Cruzamentos frequentes",      `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.09);

  // Chutes bloqueados — podem virar corner
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)      add("Muitos chutes bloqueados", `${blocked} bloqueios`, "medium", 0.10);
  else if (blocked >= 3) add("Chutes bloqueados",        `${blocked} bloqueios`, "low",    0.05);

  // Goleiros exigidos
  const saves = H.saves + A.saves;
  if (saves >= 6)      add("Goleiros muito exigidos", `${saves} defesas`, "high",   0.14);
  else if (saves >= 4) add("Goleiros ativos",         `${saves} defesas`, "medium", 0.07);

  // Volume total de chutes
  const shots = H.shots + A.shots;
  if (shots >= 16)     add("Alto volume de chutes total", `${shots} chutes`, "medium", 0.09);
  else if (shots >= 10) add("Volume moderado de chutes",  `${shots} chutes`, "low",    0.04);

  // Pressão sem conversão (chutes no alvo mas poucas metas)
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  if (onTgt >= 7 && goals <= 1) add("Pressão sem conversão — frustração acumulada", `${onTgt} no alvo, ${goals} gol(s)`, "high", 0.14);
  else if (onTgt >= 5 && goals === 0) add("Sem gols apesar do volume", `${onTgt} chutes no alvo`, "medium", 0.08);

  // Contexto do placar — time perdendo pressiona mais
  const diff = game.score.home - game.score.away;
  if (Math.abs(diff) >= 1) {
    if (min >= 65)       add(`Time perdendo em pressão final`, `${min}' · ${game.score.home}-${game.score.away}`, "high",   0.15);
    else if (min >= 45)  add(`Time em desvantagem adiantando`, `${min}' · ${game.score.home}-${game.score.away}`, "medium", 0.08);
  } else if (diff === 0 && min >= 75) {
    add("Empate — busca pela virada", `${min}'`, "medium", 0.10);
  }

  // Minuto do jogo
  if (min >= 80)      add("Últimos minutos — pressão máxima", `${min}'`, "high",   0.15);
  else if (min >= 70) add("Final de jogo — ritmo intensificado", `${min}'`, "medium", 0.08);
  else if (min >= 55) add("2° tempo avançado",  `${min}'`, "low",    0.04);

  // Jogo físico
  const fouls = H.fouls + A.fouls;
  if (fouls >= 22)     add("Jogo muito disputado fisicamente", `${fouls} faltas`, "medium", 0.07);
  else if (fouls >= 15) add("Jogo físico", `${fouls} faltas`, "low", 0.03);

  // Domínio territorial
  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 68) add("Domínio territorial absoluto", `${maxPoss.toFixed(0)}%`, "medium", 0.06);

  // Ritmo de corners JÁ estabelecido no jogo
  const totalCorners  = H.corners + A.corners;
  const baseRate      = rate(totalCorners, min);
  if (baseRate > 0.22)      add("Ritmo muito alto de escanteios no jogo", `${(baseRate*10).toFixed(1)}/10min`, "high",   0.14);
  else if (baseRate > 0.15) add("Ritmo moderado de escanteios",            `${(baseRate*10).toFixed(1)}/10min`, "medium", 0.07);

  // Clamp conservador: 1.0 – 1.7
  return { mult: clamp(mult, 1.0, 1.70), factors };
}

// ── Projeção principal ────────────────────────────────────────────────────────
export function projectCorners(game) {
  const min = Math.max(2, game.minute);

  const H = analyzeTeam(buildSide(game, "home"), min);
  const A = analyzeTeam(buildSide(game, "away"), min);

  const totalCorners = H.corners + A.corners;

  // Taxa base real do jogo (escanteios/min)
  const baseRate = rate(totalCorners, min);

  // Média histórica europeia ponderada pelo minuto
  // Jogos evoluem: 2ºT costuma ter mais corners que 1ºT
  const leagueAvg = game.period === 2 ? 0.125 : 0.095;

  const { mult, factors } = calcPressure(H, A, game);

  // Taxa ajustada: blend conservador (60% league avg ajustada, 40% taxa real)
  const adjustedRate = (leagueAvg * mult * 0.60) + (baseRate * mult * 0.40);

  // Projeção em 10 min — CAPPED em 3.0 (realismo)
  const projected10 = clamp(adjustedRate * 10, 0.3, 3.0);

  // Total do jogo: escanteios até agora + projeção para os minutos restantes
  const minsLeft   = clamp(90 - min, 0, 90);
  const projGame   = totalCorners + (adjustedRate * minsLeft);
  // Realismo: máximo absoluto em um jogo profissional ≈ 20 corners
  const projGameCapped = clamp(projGame, totalCorners, 20);

  const market     = suggestMarket(projected10, totalCorners, projGameCapped);
  const confidence = calcConfidence(projected10, factors, mult, game, baseRate);
  const signal     = confidence >= 85 ? "STRONG" : confidence >= 65 ? "MODERATE" : "WEAK";

  return {
    projected10:  +projected10.toFixed(1),
    pressureMult: +mult.toFixed(2),
    confidence,
    signal,
    factors,
    market,
    totalCorners,
  };
}

// ── Mercado sugerido ──────────────────────────────────────────────────────────
function suggestMarket(proj10, cornersAlready, projGame) {
  let betRange;
  if (proj10 >= 2.5)      betRange = "3+ corners nos próximos 10min";
  else if (proj10 >= 1.6) betRange = "2+ corners nos próximos 10min";
  else if (proj10 >= 0.9) betRange = "1+ corner nos próximos 10min";
  else                    betRange = "Baixa probabilidade de corner";

  const lo = Math.floor(projGame);
  const hi = Math.ceil(projGame);
  const gameRange = lo === hi ? `${lo} escanteios no jogo` : `${lo}-${hi} escanteios no jogo`;

  return { betRange, gameRange, projGame: +projGame.toFixed(1) };
}

// ── Confiança — ESTRITA (85%+ deve ser rara) ──────────────────────────────────
function calcConfidence(proj10, factors, mult, game, baseRate) {
  // Base proporcional à projeção (máx 40pts)
  let conf = clamp((proj10 / 3.0) * 40, 0, 40);

  // Qualidade dos fatores (máx 30pts)
  const high = factors.filter(f => f.impact === "high").length;
  const med  = factors.filter(f => f.impact === "medium").length;
  conf += clamp(high * 7 + med * 3, 0, 30);

  // Taxa histórica do jogo já é alta (máx 15pts)
  if (baseRate > 0.20)      conf += 15;
  else if (baseRate > 0.14) conf += 8;
  else if (baseRate > 0.10) conf += 4;

  // Multiplicador elevado (máx 10pts)
  if (mult >= 1.5)      conf += 10;
  else if (mult >= 1.3) conf += 5;

  // Penalidade início do jogo (poucos dados = menos confiança)
  if (game.minute < 15)      conf *= 0.50;
  else if (game.minute < 25) conf *= 0.70;
  else if (game.minute < 35) conf *= 0.85;

  // Penalidade se taxa base é muito baixa (jogo com poucos corners até agora)
  if (baseRate < 0.06 && game.minute > 30) conf *= 0.70;

  return Math.round(clamp(conf, 5, 97));
}

// ── Helper ────────────────────────────────────────────────────────────────────
function buildSide(game, side) {
  return {
    wonCorners:          game.corners?.[side],
    totalCrosses:        game.crosses?.[side],
    shotsOnTarget:       game.onTarget?.[side],
    shotsOnGoal:         game.onTarget?.[side],
    totalShots:          game.shots?.[side],
    shots:               game.shots?.[side],
    saves:               game.saves?.[side],
    effectiveClearance:  game.clearances?.[side],
    effectiveClearances: game.clearances?.[side],
    foulsCommitted:      game.fouls?.[side],
    fouls:               game.fouls?.[side],
    possessionPct:       game.possession?.[side],
    possession:          game.possession?.[side],
    blockedShots:        game.blockedShots?.[side],
    offsides:            game.offsides?.[side],
    totalLongBalls:      game.longBalls?.[side],
    accuratePasses:      game.accuratePasses?.[side],
    totalPasses:         game.passes?.[side],
  };
}

// ── Demo ──────────────────────────────────────────────────────────────────────
export function generateDemoGame(id) {
  const TEAMS = [
    { home:"Manchester City", away:"Arsenal",      league:"Premier League",  leagueCountry:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { home:"Real Madrid",     away:"Barcelona",    league:"La Liga",         leagueCountry:"🇪🇸" },
    { home:"Bayern München",  away:"B. Dortmund",  league:"Bundesliga",      leagueCountry:"🇩🇪" },
    { home:"Inter Milan",     away:"AC Milan",     league:"Serie A",         leagueCountry:"🇮🇹" },
    { home:"PSG",             away:"Lyon",         league:"Ligue 1",         leagueCountry:"🇫🇷" },
  ];
  const t   = TEAMS[id % TEAMS.length];
  const min = 25 + Math.floor(Math.random() * 60);
  const pos = 38 + Math.floor(Math.random() * 24);
  return {
    id:`demo-${id}`, ...t,
    score:    { home:Math.floor(Math.random()*3), away:Math.floor(Math.random()*3) },
    minute:min, period:min>45?2:1, clock:`${min}'`,
    possession:    { home:pos,  away:100-pos },
    shots:         { home:2+Math.floor(Math.random()*8), away:1+Math.floor(Math.random()*7) },
    onTarget:      { home:Math.floor(Math.random()*5),   away:Math.floor(Math.random()*4) },
    corners:       { home:Math.floor(Math.random()*6),   away:Math.floor(Math.random()*5) },
    fouls:         { home:3+Math.floor(Math.random()*7), away:2+Math.floor(Math.random()*6) },
    saves:         { home:Math.floor(Math.random()*4),   away:Math.floor(Math.random()*3) },
    crosses:       { home:2+Math.floor(Math.random()*8), away:1+Math.floor(Math.random()*7) },
    offsides:      { home:Math.floor(Math.random()*4),   away:Math.floor(Math.random()*3) },
    blockedShots:  { home:Math.floor(Math.random()*3),   away:Math.floor(Math.random()*3) },
    clearances:    { home:Math.floor(Math.random()*12),  away:Math.floor(Math.random()*10) },
    longBalls:     { home:Math.floor(Math.random()*18),  away:Math.floor(Math.random()*16) },
    passes:        { home:80+Math.floor(Math.random()*180), away:60+Math.floor(Math.random()*160) },
    accuratePasses:{ home:60+Math.floor(Math.random()*140), away:50+Math.floor(Math.random()*120) },
    dangerousAttacks:{ home:15+Math.floor(Math.random()*35), away:10+Math.floor(Math.random()*30) },
    isDemo:true,
  };
}
