/**
 * lib/predictor.js — Algoritmo de predição de escanteios v3
 *
 * FILOSOFIA:
 * Analisamos os DOIS times separadamente e combinamos.
 * A taxa de escanteios nos próximos 10min é calculada a partir de:
 *   1. Taxa histórica do jogo (escanteios/min até agora)
 *   2. Multiplicadores de pressão atual (cada dado ESPN tem um papel)
 *   3. Contexto de jogo (placar, minuto, período)
 *
 * DADOS ESPN DISPONÍVEIS E SEU PAPEL:
 *   wonCorners     → base rate — quantos escanteios já saíram
 *   totalCrosses   → FORTE indicador — cruzamentos frequentemente viram escanteios
 *   shotsOnTarget  → pressão real sobre o goleiro → clearances → escanteios
 *   totalShots     → volume geral de ataque
 *   saves          → goleiro trabalhando = time atacando = mais escanteios
 *   effectiveClearance → defesa sob pressão = corners
 *   foulsCommitted → jogo físico + interrupções = bola parada = corners
 *   possessionPct  → controle territorial
 *   totalPasses    → volume de construção
 *   offsides       → ataque em profundidade, linhas adiantadas
 *   blockedShots   → bola parando na área = possível corner
 *   yellowCards    → jogo nervoso, mais faltas, mais bola parada
 */

// ── Utilitários ──────────────────────────────────────────────────────────────
const safe = (v, def = 0) => (v !== undefined && v !== null && !isNaN(v) ? Number(v) : def);
const rate = (val, min) => min > 0 ? val / min : 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Análise individual de um time ────────────────────────────────────────────
function analyzeTeam(stats, min) {
  const corners      = safe(stats.wonCorners);
  const crosses      = safe(stats.totalCrosses);
  const shotsOnTgt   = safe(stats.shotsOnTarget, safe(stats.shotsOnGoal));
  const totalShots   = safe(stats.totalShots, safe(stats.shots));
  const saves        = safe(stats.saves);
  const clearances   = safe(stats.effectiveClearance, safe(stats.effectiveClearances));
  const fouls        = safe(stats.foulsCommitted, safe(stats.fouls));
  const possession   = safe(stats.possessionPct, safe(stats.possession, 50));
  const blocked      = safe(stats.blockedShots);
  const offsides     = safe(stats.offsides);
  const longBalls    = safe(stats.totalLongBalls);
  const accPasses    = safe(stats.accuratePasses);
  const totalPasses  = safe(stats.totalPasses, 1);
  const passAcc      = totalPasses > 0 ? accPasses / totalPasses : 0.7;

  // Taxa de cruzamentos por minuto (cross_rate > 0.2/min é alta)
  const crossRate    = rate(crosses, min);
  // Taxa de escanteios já saídos (base histórica do jogo)
  const cornerRate   = rate(corners, min);
  // Taxa de chutes no alvo
  const onTgtRate    = rate(shotsOnTgt, min);
  // Índice de pressão ofensiva: chutes + cruzamentos + bolas longas
  const offPressure  = totalShots + crosses * 1.5 + blocked * 1.2;
  // Índice defensivo do adversário: defesas + clearances (indica quem está sob pressão)
  const defLoad      = saves + clearances * 0.5;

  return {
    corners, crosses, shotsOnTgt, totalShots, saves,
    clearances, fouls, possession, blocked, offsides,
    crossRate, cornerRate, onTgtRate, offPressure, defLoad,
    passAcc, longBalls,
  };
}

// ── Multiplicador de pressão (ambos os times) ─────────────────────────────────
function calcPressureMultiplier(home, away, game) {
  let mult = 1.0;
  const factors = [];

  // ── Fatores de VOLUME OFENSIVO (ambos os lados) ──────────────────────────
  // Taxa de cruzamentos combinada — cruzamentos são o melhor preditor de corners
  const totalCrossRate = home.crossRate + away.crossRate;
  if (totalCrossRate > 0.35) { mult += 0.45; factors.push({ text: "Volume alto de cruzamentos", detail: `${(totalCrossRate * 10).toFixed(1)}/10min`, impact: "high" }); }
  else if (totalCrossRate > 0.20) { mult += 0.22; factors.push({ text: "Cruzamentos frequentes", detail: `${(totalCrossRate * 10).toFixed(1)}/10min`, impact: "medium" }); }

  // Chutes bloqueados (bola não saiu = pode virar corner)
  const totalBlocked = home.blocked + away.blocked;
  if (totalBlocked >= 4) { mult += 0.20; factors.push({ text: "Muitos chutes bloqueados", detail: `${totalBlocked} bloqueios`, impact: "medium" }); }

  // Goleiros trabalhando (defesas = ataque real)
  const totalSaves = home.saves + away.saves;
  if (totalSaves >= 5) { mult += 0.25; factors.push({ text: "Goleiros muito exigidos", detail: `${totalSaves} defesas`, impact: "high" }); }
  else if (totalSaves >= 3) { mult += 0.12; factors.push({ text: "Goleiros ativos", detail: `${totalSaves} defesas`, impact: "medium" }); }

  // ── Desequilíbrio de PRESSÃO (um time dominando) ─────────────────────────
  const totalShots = home.totalShots + away.totalShots;
  if (totalShots >= 12) { mult += 0.18; factors.push({ text: "Alto volume de chutes total", detail: `${totalShots} chutes`, impact: "medium" }); }

  const onTgtTotal = home.shotsOnTgt + away.shotsOnTgt;
  if (onTgtTotal >= 6 && (game.score.home + game.score.away) <= 1) {
    mult += 0.30;
    factors.push({ text: "Pressão sem conversão — frustração acumulada", detail: `${onTgtTotal} no alvo, ${game.score.home + game.score.away} gol(s)`, impact: "high" });
  }

  // ── CONTEXTO DO JOGO ─────────────────────────────────────────────────────
  // Time perdendo tende a avançar e criar mais corners
  const diff = game.score.home - game.score.away;
  if (Math.abs(diff) >= 1) {
    if (game.minute >= 60) { mult += 0.35; factors.push({ text: `Time perdendo ${diff < 0 ? "(casa)" : "(visitante)"} em pressão final`, detail: `${game.minute}' · placar ${game.score.home}-${game.score.away}`, impact: "high" }); }
    else if (game.minute >= 40) { mult += 0.18; factors.push({ text: "Time em desvantagem adiantando linhas", detail: `${game.minute}' · placar ${game.score.home}-${game.score.away}`, impact: "medium" }); }
  } else if (diff === 0 && game.minute >= 70) {
    mult += 0.20; factors.push({ text: "Empate no final — busca pela virada", detail: `${game.minute}' empatado`, impact: "medium" });
  }

  // Minuto do jogo — pressão crescente
  if (game.minute >= 80)      { mult += 0.40; factors.push({ text: "Últimos minutos — pressão máxima", detail: `${game.minute}'`, impact: "high" }); }
  else if (game.minute >= 70) { mult += 0.22; factors.push({ text: "Final de jogo — ritmo intensificado", detail: `${game.minute}'`, impact: "medium" }); }
  else if (game.minute >= 55) { mult += 0.10; factors.push({ text: "2º tempo avançado", detail: `${game.minute}'`, impact: "low" }); }

  // Faltas elevadas (jogo físico = mais interrupções perto da área = corners)
  const totalFouls = home.fouls + away.fouls;
  if (totalFouls >= 18) { mult += 0.15; factors.push({ text: "Jogo muito disputado fisicamente", detail: `${totalFouls} faltas`, impact: "medium" }); }
  else if (totalFouls >= 12) { mult += 0.08; factors.push({ text: "Jogo físico", detail: `${totalFouls} faltas`, impact: "low" }); }

  // Domínio territorial extremo (>65% posse)
  const maxPoss = Math.max(home.possession, away.possession);
  if (maxPoss >= 65) { mult += 0.12; factors.push({ text: "Domínio territorial absoluto", detail: `${maxPoss.toFixed(0)}% de posse`, impact: "medium" }); }

  // Offsides (linhas adiantadas = ataque em profundidade)
  const totalOffsides = home.offsides + away.offsides;
  if (totalOffsides >= 4) { mult += 0.10; factors.push({ text: "Linhas ofensivas muito adiantadas", detail: `${totalOffsides} impedimentos`, impact: "low" }); }

  // ── RITMO ATUAL DE ESCANTEIOS (o mais importante) ────────────────────────
  const totalCorners     = home.corners + away.corners;
  const baseCornerRate   = rate(totalCorners, game.minute);
  // Ritmo alto já estabelecido = tende a continuar
  if (baseCornerRate > 0.25) { mult += 0.30; factors.push({ text: "Ritmo muito alto de escanteios no jogo", detail: `${(baseCornerRate * 10).toFixed(1)}/10min`, impact: "high" }); }
  else if (baseCornerRate > 0.16) { mult += 0.15; factors.push({ text: "Ritmo moderado de escanteios", detail: `${(baseCornerRate * 10).toFixed(1)}/10min`, impact: "medium" }); }

  return { mult: clamp(mult, 0.5, 3.5), factors };
}

// ── Projeção de escanteios nos próximos 10 minutos ───────────────────────────
function projectCorners(game) {
  const min = Math.max(1, game.minute);

  // Analisa cada time individualmente
  const homeStats = buildStatObj(game, "home");
  const awayStats = buildStatObj(game, "away");
  const H = analyzeTeam(homeStats, min);
  const A = analyzeTeam(awayStats, min);

  // Taxa base combinada
  const totalCorners   = H.corners + A.corners;
  const baseRate       = rate(totalCorners, min);

  // Multiplica pela pressão atual
  const { mult, factors } = calcPressureMultiplier(H, A, game);
  const adjustedRate   = baseRate * mult;

  // Projeção absoluta para os próximos 10 minutos
  // Usa taxa ajustada mas também âncora na média histórica de corners/jogo por liga
  // Média geral europeia: ~10 corners/90min = 0.111/min
  const LEAGUE_AVG_RATE = 0.111;
  const blendedRate = adjustedRate * 0.6 + LEAGUE_AVG_RATE * mult * 0.4;
  const projected10  = clamp(blendedRate * 10, 0, 6);

  // Sugestão de mercado
  const market = suggestMarket(projected10, totalCorners, game.minute);

  // Confiança = quão forte é o sinal (0-100)
  const confidence = calcConfidence(projected10, factors, mult, game);
  const signal     = confidence >= 68 ? "STRONG" : confidence >= 48 ? "MODERATE" : "WEAK";

  return {
    projected10:    +projected10.toFixed(1),
    baseRate:       +baseRate.toFixed(3),
    adjustedRate:   +adjustedRate.toFixed(3),
    pressureMult:   +mult.toFixed(2),
    confidence,
    signal,
    factors,
    market,
    homeAnalysis: H,
    awayAnalysis: A,
    totalCorners,
  };
}

// ── Sugestão de mercado ──────────────────────────────────────────────────────
function suggestMarket(projected, cornersAlready, minute) {
  // Faixa de escanteios para o jogo INTEIRO projetado
  const minsLeft   = Math.max(0, 90 - minute);
  const projFull   = cornersAlready + projected; // só próximos 10min
  const projGame   = cornersAlready + (projected / 10) * minsLeft;

  // Mercado de próximos 10min
  let line, direction, label, betRange;
  if (projected >= 2.5) {
    line = 2.5; direction = "over"; label = "Over 2.5 escanteios/10min";
    betRange = "3+ corners nos próximos 10min";
  } else if (projected >= 1.8) {
    line = 1.5; direction = "over"; label = "Over 1.5 escanteios/10min";
    betRange = "2+ corners nos próximos 10min";
  } else if (projected >= 1.2) {
    line = 0.5; direction = "over"; label = "Over 0.5 escanteios/10min";
    betRange = "1+ corner nos próximos 10min";
  } else {
    line = 0.5; direction = "under"; label = "Under 1.5 escanteios/10min";
    betRange = "0-1 corners nos próximos 10min";
  }

  // Faixa de escanteios totais do jogo (para mercado de total do jogo)
  const totalLow  = Math.floor(projGame);
  const totalHigh = Math.ceil(projGame);
  const gameRange = `${totalLow}-${totalHigh} escanteios no jogo`;

  return { line, direction, label, betRange, gameRange, projGame: +projGame.toFixed(1) };
}

// ── Confiança numérica (0-97) ────────────────────────────────────────────────
function calcConfidence(projected10, factors, mult, game) {
  // Base: projeção normalizada
  let conf = clamp(projected10 / 3.5 * 70, 0, 70);

  // Bonus por quantidade e qualidade de fatores
  const highFactors = factors.filter(f => f.impact === "high").length;
  const medFactors  = factors.filter(f => f.impact === "medium").length;
  conf += highFactors * 7 + medFactors * 3;

  // Penalty se poucas estatísticas disponíveis (início do jogo)
  if (game.minute < 15) conf *= 0.6;
  else if (game.minute < 25) conf *= 0.8;

  // Bonus se pressão é muito alta
  if (mult >= 2.0) conf += 8;

  return Math.round(clamp(conf, 0, 97));
}

// ── Monta objeto de stats por lado (home/away) ───────────────────────────────
function buildStatObj(game, side) {
  return {
    wonCorners:        game.corners?.[side],
    totalCrosses:      game.crosses?.[side],
    shotsOnTarget:     game.onTarget?.[side],
    shotsOnGoal:       game.onTarget?.[side],
    totalShots:        game.shots?.[side],
    shots:             game.shots?.[side],
    saves:             game.saves?.[side],
    effectiveClearance: game.clearances?.[side],
    effectiveClearances: game.clearances?.[side],
    foulsCommitted:    game.fouls?.[side],
    fouls:             game.fouls?.[side],
    possessionPct:     game.possession?.[side],
    possession:        game.possession?.[side],
    blockedShots:      game.blockedShots?.[side],
    offsides:          game.offsides?.[side],
    totalLongBalls:    game.longBalls?.[side],
    accuratePasses:    game.accuratePasses?.[side],
    totalPasses:       game.passes?.[side],
  };
}

// ── Demo ─────────────────────────────────────────────────────────────────────
export function generateDemoGame(id) {
  const TEAMS = [
    { home: "Manchester City", away: "Arsenal",     league: "Premier League",  leagueCountry: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { home: "Real Madrid",     away: "Barcelona",   league: "La Liga",         leagueCountry: "🇪🇸" },
    { home: "Bayern München",  away: "B. Dortmund", league: "Bundesliga",      leagueCountry: "🇩🇪" },
    { home: "Inter Milan",     away: "AC Milan",    league: "Serie A",         leagueCountry: "🇮🇹" },
    { home: "PSG",             away: "Lyon",        league: "Ligue 1",         leagueCountry: "🇫🇷" },
  ];
  const t = TEAMS[id % TEAMS.length];
  const minute = 25 + Math.floor(Math.random() * 60);
  const possession = 35 + Math.floor(Math.random() * 30);
  const cornersH = Math.floor(Math.random() * 7);
  const cornersA = Math.floor(Math.random() * 6);
  return {
    id: `demo-${id}`, ...t,
    score: { home: Math.floor(Math.random() * 3), away: Math.floor(Math.random() * 3) },
    minute, period: minute > 45 ? 2 : 1, clock: `${minute}'`,
    possession: { home: possession, away: 100 - possession },
    shots:      { home: 2 + Math.floor(Math.random() * 9), away: 1 + Math.floor(Math.random() * 8) },
    onTarget:   { home: 1 + Math.floor(Math.random() * 5), away: 0 + Math.floor(Math.random() * 4) },
    corners:    { home: cornersH, away: cornersA },
    fouls:      { home: 3 + Math.floor(Math.random() * 8), away: 2 + Math.floor(Math.random() * 7) },
    saves:      { home: 1 + Math.floor(Math.random() * 4), away: 1 + Math.floor(Math.random() * 3) },
    crosses:    { home: 2 + Math.floor(Math.random() * 10), away: 1 + Math.floor(Math.random() * 8) },
    offsides:   { home: Math.floor(Math.random() * 5), away: Math.floor(Math.random() * 4) },
    blockedShots: { home: Math.floor(Math.random() * 4), away: Math.floor(Math.random() * 3) },
    clearances: { home: Math.floor(Math.random() * 15), away: Math.floor(Math.random() * 12) },
    longBalls:  { home: Math.floor(Math.random() * 20), away: Math.floor(Math.random() * 18) },
    passes:     { home: 100 + Math.floor(Math.random() * 200), away: 80 + Math.floor(Math.random() * 180) },
    accuratePasses: { home: 80 + Math.floor(Math.random() * 160), away: 60 + Math.floor(Math.random() * 140) },
    dangerousAttacks: { home: 20 + Math.floor(Math.random() * 40), away: 15 + Math.floor(Math.random() * 35) },
    isDemo: true,
  };
}

export { projectCorners };
