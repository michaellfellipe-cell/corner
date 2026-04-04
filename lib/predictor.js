/**
 * lib/predictor.js — v6
 * 4 melhorias implementadas (validadas vs sugestões do Grok):
 *
 * 1. PENALIDADE DINÂMICA — penalidade do 1ºT cai automaticamente quando mult é alto
 *    penalty = base × (1 / (1 + (mult - 1) × 2))
 *
 * 2. FAST TRACK — cruzamentos >0.40/min + bloqueados ≥3 antes dos 20'
 *    → confiança mínima de 72%, ignora penalidade de minuto
 *
 * 3. CONDICIONAL FATOR MINUTO 2ºT — 80'+ só pesa +0.15 se pressão real ≥ 1.15
 *    senão máximo +0.06 (evita sinais por relógio em jogos travados)
 *
 * 4. PESO DINÂMICO NA PROJEÇÃO — quanto maior o mult, mais confia na taxa real
 *    peso_real = 0.30 + (mult - 1.0) × 0.45, cap 0.70
 */

const safe  = (v, def = 0) => (v !== undefined && v !== null && !isNaN(v) ? Number(v) : def);
const clamp = (v, lo, hi)  => Math.max(lo, Math.min(hi, v));
const rate  = (val, min)   => min > 1 ? val / min : 0;

const LATE_START     = 45;
const BLOCK_ALERTS   = 82;
const MAX_MULT_EARLY = 1.40;
const MAX_MULT_LATE  = 1.70;
const LEAGUE_AVG_EARLY = 0.090;
const LEAGUE_AVG_LATE  = 0.130;

// ── Análise por time ──────────────────────────────────────────────────────────
function analyzeSide(s, min) {
  const corners    = safe(s.wonCorners);
  const crosses    = safe(s.totalCrosses);
  const onTarget   = safe(s.shotsOnTarget, safe(s.shotsOnGoal));
  const shots      = safe(s.totalShots, safe(s.shots));
  const saves      = safe(s.saves);
  const fouls      = safe(s.foulsCommitted, safe(s.fouls));
  const possession = safe(s.possessionPct, safe(s.possession, 50));
  const blocked    = safe(s.blockedShots);
  const offsides   = safe(s.offsides);
  return {
    corners, crosses, onTarget, shots, saves,
    fouls, possession, blocked, offsides,
    crossRate:  rate(crosses, min),
    cornerRate: rate(corners, min),
    onTgtRate:  rate(onTarget, min),
  };
}

// ── MODO EARLY: 1º tempo (1'–44') ─────────────────────────────────────────────
function calcEarlyPressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // 1. Cruzamentos — melhor sinal precoce
  const crossRate = H.crossRate + A.crossRate;
  if (crossRate > 0.45)      add("Taxa alta de cruzamentos (1ºT)",          `${(crossRate*10).toFixed(1)}/10min`, "high",   0.20);
  else if (crossRate > 0.28) add("Cruzamentos frequentes (1ºT)",            `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.11);
  else if (crossRate > 0.18) add("Cruzamentos moderados",                   `${(crossRate*10).toFixed(1)}/10min`, "low",    0.05);

  // 2. Chutes bloqueados — pressão real sendo contida
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)          add("Muitos chutes bloqueados — pressão real", `${blocked} bloqueios`,               "high",   0.18);
  else if (blocked >= 3)     add("Chutes bloqueados — bola na área",        `${blocked} bloqueios`,               "medium", 0.10);
  else if (blocked >= 2)     add("Bloqueios presentes",                     `${blocked} bloqueios`,               "low",    0.05);

  // 3. Defesas goleiro — ataque dominante
  const saves = H.saves + A.saves;
  if (saves >= 4)            add("Goleiros muito exigidos (1ºT)",           `${saves} defesas`,                   "high",   0.16);
  else if (saves >= 3)       add("Goleiros ativos (1ºT)",                   `${saves} defesas`,                   "medium", 0.09);
  else if (saves >= 2)       add("Pressão sobre goleiros",                  `${saves} defesas`,                   "low",    0.04);

  // 4. Volume de chutes
  const shots = H.shots + A.shots;
  if (shots >= 12)           add("Alto volume de chutes (1ºT)",             `${shots} chutes`,                    "medium", 0.10);
  else if (shots >= 8)       add("Volume moderado de chutes",               `${shots} chutes`,                    "low",    0.05);

  // 5. Chutes no alvo sem gol — frustração
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  if (onTgt >= 5 && goals === 0) add("Pressão sem gol — frustração (1ºT)", `${onTgt} no alvo, 0 gol`,            "high",   0.15);
  else if (onTgt >= 3 && goals === 0) add("Chutes no alvo sem conversão",  `${onTgt} no alvo`,                   "medium", 0.08);

  // 6. Domínio territorial
  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 68)         add("Domínio territorial absoluto",            `${maxPoss.toFixed(0)}%`,             "medium", 0.08);

  // 7. Placar desequilibrado no 1ºT
  const diff = Math.abs(game.score.home - game.score.away);
  if (diff >= 1 && min >= 25) add("Time perdendo pressiona no 1ºT",        `${game.score.home}-${game.score.away}`, "medium", 0.09);

  // 8. Ritmo de corners (peso baixo no 1ºT)
  const totalCorners = H.corners + A.corners;
  const cRate = rate(totalCorners, min);
  if (cRate > 0.22)          add("Ritmo alto de escanteios (1ºT)",         `${(cRate*10).toFixed(1)}/10min`,     "medium", 0.10);
  else if (cRate > 0.15)     add("Escanteios frequentes (1ºT)",            `${(cRate*10).toFixed(1)}/10min`,     "low",    0.05);

  return { mult: clamp(mult, 1.0, MAX_MULT_EARLY), factors, crossRate, blocked };
}

// ── MODO LATE: 2º tempo (45'–82') ─────────────────────────────────────────────
function calcLatePressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // Cruzamentos
  const crossRate = H.crossRate + A.crossRate;
  if (crossRate > 0.40)      add("Volume alto de cruzamentos",              `${(crossRate*10).toFixed(1)}/10min`, "high",   0.18);
  else if (crossRate > 0.22) add("Cruzamentos frequentes",                  `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.09);

  // Chutes bloqueados
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)          add("Muitos chutes bloqueados",                `${blocked} bloqueios`,               "medium", 0.10);
  else if (blocked >= 3)     add("Chutes bloqueados",                       `${blocked} bloqueios`,               "low",    0.05);

  // Defesas
  const saves = H.saves + A.saves;
  if (saves >= 6)            add("Goleiros muito exigidos",                 `${saves} defesas`,                   "high",   0.14);
  else if (saves >= 4)       add("Goleiros ativos",                         `${saves} defesas`,                   "medium", 0.07);

  // Volume de chutes
  const shots = H.shots + A.shots;
  if (shots >= 16)           add("Alto volume de chutes total",             `${shots} chutes`,                    "medium", 0.09);
  else if (shots >= 10)      add("Volume moderado de chutes",               `${shots} chutes`,                    "low",    0.04);

  // Pressão sem conversão
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  if (onTgt >= 7 && goals <= 1) add("Pressão sem conversão — frustração",  `${onTgt} no alvo, ${goals} gol(s)`, "high",   0.14);
  else if (onTgt >= 5 && goals === 0) add("Chutes no alvo sem gol",        `${onTgt} no alvo`,                   "medium", 0.08);

  // Placar
  const diff = game.score.home - game.score.away;
  if (Math.abs(diff) >= 1) {
    if (min >= 65)           add("Time perdendo em pressão final",          `${min}' · ${game.score.home}-${game.score.away}`, "high",   0.15);
    else if (min >= 45)      add("Time em desvantagem avança",              `${min}' · ${game.score.home}-${game.score.away}`, "medium", 0.08);
  } else if (diff === 0 && min >= 70) {
    add("Empate — ambos buscam virada",                                     `${min}'`,                            "medium", 0.10);
  }

  // ── MELHORIA 3: Fator minuto condicional ──────────────────────────────────
  // Calcula pressão real de jogo (excluindo fator minuto)
  // O fator minuto só pesa totalmente se houver pressão real sustentando
  const realGameMult = mult; // mult antes de adicionar fator minuto
  if (min >= 80) {
    if (realGameMult >= 1.15) add("Últimos minutos + pressão real",        `${min}'`,                            "high",   0.15);
    else                      add("Últimos minutos (jogo travado)",         `${min}'`,                            "low",    0.06);
  } else if (min >= 70) {
    if (realGameMult >= 1.10) add("Final de jogo — ritmo intenso",         `${min}'`,                            "medium", 0.08);
    else                      add("Final de jogo (pressão limitada)",       `${min}'`,                            "low",    0.04);
  } else if (min >= 55) {
    add("2º tempo avançado",                                                `${min}'`,                            "low",    0.04);
  }

  // Faltas
  const fouls = H.fouls + A.fouls;
  if (fouls >= 22)           add("Jogo muito físico",                       `${fouls} faltas`,                    "medium", 0.07);
  else if (fouls >= 15)      add("Jogo físico",                            `${fouls} faltas`,                    "low",    0.03);

  // Posse
  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 68)         add("Domínio territorial absoluto",            `${maxPoss.toFixed(0)}%`,             "medium", 0.06);

  // Ritmo corners (peso maior no 2ºT)
  const totalCorners = H.corners + A.corners;
  const cRate = rate(totalCorners, min);
  if (cRate > 0.22)          add("Ritmo alto de escanteios no jogo",       `${(cRate*10).toFixed(1)}/10min`,     "high",   0.14);
  else if (cRate > 0.15)     add("Ritmo moderado de escanteios",           `${(cRate*10).toFixed(1)}/10min`,     "medium", 0.07);

  return { mult: clamp(mult, 1.0, MAX_MULT_LATE), factors };
}

// ── Janela de entrada ─────────────────────────────────────────────────────────
function calcEntryWindow(minute) {
  const minsLeft  = Math.max(0, 90 - minute);
  const isTooLate = minute > BLOCK_ALERTS;
  let label, urgency;
  if (isTooLate)         { label = "Tarde demais para entrar";        urgency = "blocked"; }
  else if (minsLeft > 20){ label = `~${minsLeft} minutos disponíveis`;urgency = "good";    }
  else if (minsLeft > 10){ label = `~${minsLeft} min — entrar agora`; urgency = "warning"; }
  else                   { label = `~${minsLeft} min — último momento`;urgency = "danger";  }
  return { minsLeft, label, urgency, isTooLate };
}

// ── MELHORIA 2: Fast Track detector ──────────────────────────────────────────
// Se cruzamentos >0.40/min E bloqueados ≥3 nos primeiros 20' → confiança mínima 72%
function checkFastTrack(crossRate, blocked, minute) {
  if (minute > 20) return false;
  return crossRate > 0.40 && blocked >= 3;
}

// ── Projeção principal ────────────────────────────────────────────────────────
export function projectCorners(game) {
  const min     = Math.max(2, game.minute);
  const isEarly = min < LATE_START;
  const H = analyzeSide(buildSide(game, "home"), min);
  const A = analyzeSide(buildSide(game, "away"), min);

  const totalCorners = H.corners + A.corners;
  const baseRate     = rate(totalCorners, min);
  const leagueAvg    = isEarly ? LEAGUE_AVG_EARLY : LEAGUE_AVG_LATE;

  const pressureResult = isEarly
    ? calcEarlyPressure(H, A, game)
    : calcLatePressure(H, A, game);

  const { mult, factors } = pressureResult;

  // ── MELHORIA 4: Peso dinâmico na projeção ────────────────────────────────
  // quanto maior o mult (pressão real), mais confiamos na taxa real do jogo
  // e menos na média histórica da liga
  const rawPesoReal = 0.30 + (mult - 1.0) * 0.45;
  const pesoReal    = clamp(rawPesoReal, 0.30, 0.70);
  const pesoLiga    = 1.0 - pesoReal;
  const adjustedRate = (leagueAvg * mult * pesoLiga) + (baseRate * mult * pesoReal);

  const projected10 = clamp(adjustedRate * 10, 0.2, 3.0);
  const minsLeft    = clamp(90 - min, 0, 90);
  const projGame    = clamp(totalCorners + (adjustedRate * minsLeft), totalCorners, 20);

  const market     = suggestMarket(projected10, totalCorners, projGame);

  // Fast Track check
  const crossRateCombined = H.crossRate + A.crossRate;
  const blockedTotal = H.blocked + A.blocked;
  const isFastTrack = isEarly && checkFastTrack(crossRateCombined, blockedTotal, min);

  const confidence = calcConfidence(projected10, factors, mult, game, baseRate, isEarly, isFastTrack);

  const strongThresh   = isEarly ? 78 : 80;
  const moderateThresh = isEarly ? 60 : 65;
  const signal = confidence >= strongThresh  ? "STRONG"   :
                 confidence >= moderateThresh ? "MODERATE" : "WEAK";

  const entryWindow = calcEntryWindow(min);

  return {
    projected10:   +projected10.toFixed(1),
    pressureMult:  +mult.toFixed(2),
    confidence,
    signal,
    factors,
    market,
    totalCorners,
    entryWindow,
    isEarly,
    isFastTrack,
    phase: isEarly ? "1ºT" : "2ºT",
    pesoReal: +pesoReal.toFixed(2),
  };
}

// ── Mercado sugerido ──────────────────────────────────────────────────────────
function suggestMarket(proj10, cornersAlready, projGame) {
  let betRange;
  if (proj10 >= 2.5)      betRange = "3+ corners nos próximos 10min";
  else if (proj10 >= 1.6) betRange = "2+ corners nos próximos 10min";
  else if (proj10 >= 0.9) betRange = "1+ corner nos próximos 10min";
  else                    betRange = "Baixa probabilidade de corner";
  const lo = Math.floor(projGame), hi = Math.ceil(projGame);
  return {
    betRange,
    gameRange: lo === hi ? `${lo} escanteios no jogo` : `${lo}-${hi} escanteios no jogo`,
    projGame: +projGame.toFixed(1),
  };
}

// ── Confiança ─────────────────────────────────────────────────────────────────
function calcConfidence(proj10, factors, mult, game, baseRate, isEarly, isFastTrack) {
  // Base: projeção (máx 40pts)
  let conf = clamp((proj10 / 3.0) * 40, 0, 40);

  // Qualidade dos fatores (máx 30pts)
  const high = factors.filter(f => f.impact === "high").length;
  const med  = factors.filter(f => f.impact === "medium").length;
  conf += clamp(high * 7 + med * 3, 0, 30);

  // Taxa histórica do jogo (máx 15pts)
  if (baseRate > 0.20)      conf += 15;
  else if (baseRate > 0.14) conf += 8;
  else if (baseRate > 0.10) conf += 4;

  // Multiplicador elevado (máx 10pts)
  if (mult >= 1.30)         conf += 10;
  else if (mult >= 1.15)    conf += 5;

  if (isEarly) {
    // ── MELHORIA 1: Penalidade dinâmica ──────────────────────────────────
    // A penalidade cai automaticamente quando mult é alto (pressão real confirmada)
    // penalty = base × (1 / (1 + (mult - 1) × 2))
    // Exemplo mult 1.30: fator = 1/(1 + 0.30×2) = 1/1.6 = 0.625 → menos severo
    // Exemplo mult 1.00: fator = 1/(1 + 0) = 1.0 → penalidade cheia
    const multFactor = 1 / (1 + (mult - 1) * 2);
    let basePenalty;
    if (game.minute < 15)      basePenalty = 0.45;
    else if (game.minute < 25) basePenalty = 0.78; // Grok sugere 0.78 (era 0.65)
    else if (game.minute < 35) basePenalty = 0.85; // era 0.82
    else                       basePenalty = 0.94; // era 0.92

    const dynamicPenalty = basePenalty + (1 - basePenalty) * (1 - multFactor);
    conf *= dynamicPenalty;

    // Sem cruzamentos após 20' = sinal fraco
    const totalCrosses = safe(game.crosses?.home) + safe(game.crosses?.away);
    if (totalCrosses === 0 && game.minute > 20) conf *= 0.70;

    // ── MELHORIA 2: Fast Track — ignora penalidade de minuto ─────────────
    // Se padrão raramente falso positivo → garante mínimo de 72%
    if (isFastTrack) conf = Math.max(conf, 72);

  } else {
    // 2ºT: penalidade se taxa base muito baixa (jogo não está gerando corners)
    if (baseRate < 0.06 && game.minute > 50) conf *= 0.70;
  }

  return Math.round(clamp(conf, 5, 97));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildSide(game, side) {
  return {
    wonCorners:         game.corners?.[side],
    totalCrosses:       game.crosses?.[side],
    shotsOnTarget:      game.onTarget?.[side],
    shotsOnGoal:        game.onTarget?.[side],
    totalShots:         game.shots?.[side],
    shots:              game.shots?.[side],
    saves:              game.saves?.[side],
    effectiveClearance: game.clearances?.[side],
    foulsCommitted:     game.fouls?.[side],
    fouls:              game.fouls?.[side],
    possessionPct:      game.possession?.[side],
    possession:         game.possession?.[side],
    blockedShots:       game.blockedShots?.[side],
    offsides:           game.offsides?.[side],
    totalLongBalls:     game.longBalls?.[side],
    accuratePasses:     game.accuratePasses?.[side],
    totalPasses:        game.passes?.[side],
  };
}

// ── Demo ──────────────────────────────────────────────────────────────────────
export function generateDemoGame(id) {
  const TEAMS = [
    { home:"Manchester City", away:"Arsenal",     league:"Premier League", leagueCountry:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { home:"Real Madrid",     away:"Barcelona",   league:"La Liga",        leagueCountry:"🇪🇸" },
    { home:"Bayern München",  away:"B. Dortmund", league:"Bundesliga",     leagueCountry:"🇩🇪" },
    { home:"Inter Milan",     away:"AC Milan",    league:"Serie A",        leagueCountry:"🇮🇹" },
    { home:"PSG",             away:"Lyon",        league:"Ligue 1",        leagueCountry:"🇫🇷" },
  ];
  const t   = TEAMS[id % TEAMS.length];
  const min = 10 + Math.floor(Math.random() * 75);
  const pos = 38 + Math.floor(Math.random() * 24);
  return {
    id:`demo-${id}`, ...t,
    score:   { home:Math.floor(Math.random()*3), away:Math.floor(Math.random()*3) },
    minute:min, period:min>45?2:1, clock:`${min}'`,
    possession:     { home:pos,  away:100-pos },
    shots:          { home:2+Math.floor(Math.random()*8),  away:1+Math.floor(Math.random()*7) },
    onTarget:       { home:Math.floor(Math.random()*5),    away:Math.floor(Math.random()*4) },
    corners:        { home:Math.floor(Math.random()*6),    away:Math.floor(Math.random()*5) },
    fouls:          { home:3+Math.floor(Math.random()*7),  away:2+Math.floor(Math.random()*6) },
    saves:          { home:Math.floor(Math.random()*4),    away:Math.floor(Math.random()*3) },
    crosses:        { home:1+Math.floor(Math.random()*9),  away:1+Math.floor(Math.random()*8) },
    offsides:       { home:Math.floor(Math.random()*4),    away:Math.floor(Math.random()*3) },
    blockedShots:   { home:Math.floor(Math.random()*4),    away:Math.floor(Math.random()*3) },
    clearances:     { home:Math.floor(Math.random()*12),   away:Math.floor(Math.random()*10) },
    longBalls:      { home:Math.floor(Math.random()*18),   away:Math.floor(Math.random()*16) },
    passes:         { home:80+Math.floor(Math.random()*180), away:60+Math.floor(Math.random()*160) },
    accuratePasses: { home:60+Math.floor(Math.random()*140), away:50+Math.floor(Math.random()*120) },
    dangerousAttacks:{ home:15+Math.floor(Math.random()*35), away:10+Math.floor(Math.random()*30) },
    isDemo:true,
  };
}
