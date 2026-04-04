/**
 * lib/predictor.js — v5 com modo EARLY (1'–44') e LATE (45'–90')
 *
 * FILOSOFIA:
 * 1º TEMPO (Early): poucos dados acumulados → foca em indicadores de RITMO
 *   Principais: cruzamentos/min + chutes bloqueados + defesas goleiro
 *   Taxa de corners tem peso baixo (ainda não acumulou)
 *   Multiplicador máximo conservador: 1.4×
 *
 * 2º TEMPO (Late): dados suficientes → algoritmo completo
 *   Taxa de corners + todos os fatores
 *   Multiplicador máximo: 1.70×
 *   BLOQUEIO de notificações após 82' (tarde demais para entrar)
 *
 * JANELA DE ENTRADA: calculada e exibida em tela
 */

const safe  = (v, def = 0) => (v !== undefined && v !== null && !isNaN(v) ? Number(v) : def);
const clamp = (v, lo, hi)  => Math.max(lo, Math.min(hi, v));
const rate  = (val, min)   => min > 1 ? val / min : 0;

// ── Constantes de fase ────────────────────────────────────────────────────────
const LATE_START    = 45;   // minuto que inicia o modo Late
const BLOCK_ALERTS  = 82;   // após esse minuto bloqueia notificações
const MAX_MULT_EARLY = 1.40;
const MAX_MULT_LATE  = 1.70;
const LEAGUE_AVG_EARLY = 0.090; // corners/min no 1ºT (histórico europeu)
const LEAGUE_AVG_LATE  = 0.130; // corners/min no 2ºT (ritmo maior)

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
// Foco em ritmo precoce — cruzamentos, bloqueios e pressão inicial
function calcEarlyPressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // ── INDICADORES PRECOCES PRINCIPAIS ──────────────────────────────────────
  // 1. Taxa de cruzamentos combinada — melhor sinal no 1ºT
  const crossRate = H.crossRate + A.crossRate;
  if (crossRate > 0.45)      add("Taxa alta de cruzamentos (1ºT)",   `${(crossRate*10).toFixed(1)}/10min`, "high",   0.20);
  else if (crossRate > 0.28) add("Cruzamentos frequentes (1ºT)",     `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.11);
  else if (crossRate > 0.18) add("Cruzamentos moderados",            `${(crossRate*10).toFixed(1)}/10min`, "low",    0.05);

  // 2. Chutes bloqueados — pressão real sendo contida (corners latentes)
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)          add("Muitos chutes bloqueados — pressão real", `${blocked} bloqueios`, "high",   0.18);
  else if (blocked >= 3)     add("Chutes bloqueados — bola na área",         `${blocked} bloqueios`, "medium", 0.10);
  else if (blocked >= 2)     add("Bloqueios presentes",                       `${blocked} bloqueios`, "low",    0.05);

  // 3. Defesas do goleiro — ataque dominante
  const saves = H.saves + A.saves;
  if (saves >= 4)            add("Goleiros muito exigidos (1ºT)",   `${saves} defesas`, "high",   0.16);
  else if (saves >= 3)       add("Goleiros ativos (1ºT)",           `${saves} defesas`, "medium", 0.09);
  else if (saves >= 2)       add("Pressão sobre goleiros",          `${saves} defesas`, "low",    0.04);

  // 4. Volume de chutes — jogo aberto
  const shots = H.shots + A.shots;
  if (shots >= 12)           add("Alto volume de chutes (1ºT)",     `${shots} chutes`, "medium", 0.10);
  else if (shots >= 8)       add("Volume moderado de chutes",        `${shots} chutes`, "low",    0.05);

  // 5. Chutes no alvo sem gol — frustração acumulando
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  if (onTgt >= 5 && goals === 0) add("Pressão sem gol — frustração acumulando", `${onTgt} no alvo, 0 gol`, "high", 0.15);
  else if (onTgt >= 3 && goals === 0) add("Chutes no alvo sem conversão",       `${onTgt} no alvo`,        "medium", 0.08);

  // 6. Domínio territorial claro
  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 68)         add("Domínio territorial absoluto",    `${maxPoss.toFixed(0)}%`, "medium", 0.08);

  // 7. Desequilíbrio no placar já no 1ºT
  const diff = Math.abs(game.score.home - game.score.away);
  if (diff >= 1 && min >= 25) add("Time perdendo pressiona no 1ºT", `${game.score.home}-${game.score.away}`, "medium", 0.09);

  // 8. Ritmo de corners do 1ºT (peso baixo — poucos dados ainda)
  const totalCorners = H.corners + A.corners;
  const cRate = rate(totalCorners, min);
  if (cRate > 0.22)          add("Ritmo alto de escanteios (1ºT)",  `${(cRate*10).toFixed(1)}/10min`, "medium", 0.10);
  else if (cRate > 0.15)     add("Escanteios frequentes (1ºT)",     `${(cRate*10).toFixed(1)}/10min`, "low",    0.05);

  return { mult: clamp(mult, 1.0, MAX_MULT_EARLY), factors };
}

// ── MODO LATE: 2º tempo (45'–90') ─────────────────────────────────────────────
// Algoritmo completo com todos os fatores
function calcLatePressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // Cruzamentos
  const crossRate = H.crossRate + A.crossRate;
  if (crossRate > 0.40)      add("Volume alto de cruzamentos",       `${(crossRate*10).toFixed(1)}/10min`, "high",   0.18);
  else if (crossRate > 0.22) add("Cruzamentos frequentes",           `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.09);

  // Chutes bloqueados
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)          add("Muitos chutes bloqueados",         `${blocked} bloqueios`, "medium", 0.10);
  else if (blocked >= 3)     add("Chutes bloqueados",                `${blocked} bloqueios`, "low",    0.05);

  // Defesas
  const saves = H.saves + A.saves;
  if (saves >= 6)            add("Goleiros muito exigidos",          `${saves} defesas`, "high",   0.14);
  else if (saves >= 4)       add("Goleiros ativos",                  `${saves} defesas`, "medium", 0.07);

  // Volume de chutes
  const shots = H.shots + A.shots;
  if (shots >= 16)           add("Alto volume de chutes total",      `${shots} chutes`, "medium", 0.09);
  else if (shots >= 10)      add("Volume moderado de chutes",        `${shots} chutes`, "low",    0.04);

  // Pressão sem conversão
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  if (onTgt >= 7 && goals <= 1) add("Pressão sem conversão — frustração", `${onTgt} no alvo, ${goals} gol(s)`, "high", 0.14);
  else if (onTgt >= 5 && goals === 0) add("Chutes no alvo sem gol",       `${onTgt} no alvo`, "medium", 0.08);

  // Placar — time perdendo
  const diff = game.score.home - game.score.away;
  if (Math.abs(diff) >= 1) {
    if (min >= 65)           add(`Time perdendo em pressão final`,   `${min}' · ${game.score.home}-${game.score.away}`, "high",   0.15);
    else if (min >= 45)      add(`Time em desvantagem avança`,       `${min}' · ${game.score.home}-${game.score.away}`, "medium", 0.08);
  } else if (diff === 0 && min >= 70) {
    add("Empate — busca pela virada", `${min}'`, "medium", 0.10);
  }

  // Minuto do jogo
  if (min >= 80)             add("Últimos minutos — pressão máxima", `${min}'`, "high",   0.15);
  else if (min >= 70)        add("Final de jogo — ritmo intenso",   `${min}'`, "medium", 0.08);
  else if (min >= 55)        add("2º tempo avançado",               `${min}'`, "low",    0.04);

  // Faltas
  const fouls = H.fouls + A.fouls;
  if (fouls >= 22)           add("Jogo muito físico",               `${fouls} faltas`, "medium", 0.07);
  else if (fouls >= 15)      add("Jogo físico",                     `${fouls} faltas`, "low",    0.03);

  // Posse
  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 68)         add("Domínio territorial absoluto",    `${maxPoss.toFixed(0)}%`, "medium", 0.06);

  // Ritmo de corners (peso maior no 2ºT — dados mais confiáveis)
  const totalCorners = H.corners + A.corners;
  const cRate = rate(totalCorners, min);
  if (cRate > 0.22)          add("Ritmo alto de escanteios no jogo", `${(cRate*10).toFixed(1)}/10min`, "high",   0.14);
  else if (cRate > 0.15)     add("Ritmo moderado de escanteios",    `${(cRate*10).toFixed(1)}/10min`, "medium", 0.07);

  return { mult: clamp(mult, 1.0, MAX_MULT_LATE), factors };
}

// ── Janela de entrada ─────────────────────────────────────────────────────────
function calcEntryWindow(minute, period) {
  const minsLeft = Math.max(0, 90 - minute);
  const isTooLate = minute > BLOCK_ALERTS;

  let label, urgency;
  if (isTooLate) {
    label = "Tarde demais para entrar"; urgency = "blocked";
  } else if (minsLeft > 20) {
    label = `~${minsLeft} minutos disponíveis`;    urgency = "good";
  } else if (minsLeft > 10) {
    label = `~${minsLeft} minutos — entrar agora`; urgency = "warning";
  } else {
    label = `~${minsLeft} min — último momento`;   urgency = "danger";
  }

  return { minsLeft, label, urgency, isTooLate };
}

// ── Projeção principal ────────────────────────────────────────────────────────
export function projectCorners(game) {
  const min    = Math.max(2, game.minute);
  const isEarly = min < LATE_START;
  const H = analyzeSide(buildSide(game, "home"), min);
  const A = analyzeSide(buildSide(game, "away"), min);

  const totalCorners = H.corners + A.corners;
  const baseRate     = rate(totalCorners, min);
  const leagueAvg    = isEarly ? LEAGUE_AVG_EARLY : LEAGUE_AVG_LATE;

  const { mult, factors } = isEarly
    ? calcEarlyPressure(H, A, game)
    : calcLatePressure(H, A, game);

  // Taxa ajustada: blend entre média histórica e taxa real do jogo
  // Early: mais peso na média (dados do jogo ainda escassos)
  // Late: mais peso no jogo real
  const blendGame = isEarly ? 0.30 : 0.40;
  const blendAvg  = 1 - blendGame;
  const adjustedRate = (leagueAvg * mult * blendAvg) + (baseRate * mult * blendGame);

  // Projeção 10 min — cap realista
  const projected10 = clamp(adjustedRate * 10, 0.2, 3.0);

  // Projeção total do jogo
  const minsLeft   = clamp(90 - min, 0, 90);
  const projGame   = clamp(totalCorners + (adjustedRate * minsLeft), totalCorners, 20);

  const market     = suggestMarket(projected10, totalCorners, projGame);
  const confidence = calcConfidence(projected10, factors, mult, game, baseRate, isEarly);

  // Thresholds adaptados por fase
  // Early: mais exigente (menos dados = exige mais evidência)
  const strongThresh    = isEarly ? 78 : 80;
  const moderateThresh  = isEarly ? 60 : 65;
  const signal = confidence >= strongThresh  ? "STRONG"   :
                 confidence >= moderateThresh ? "MODERATE" : "WEAK";

  const entryWindow = calcEntryWindow(min, game.period);

  return {
    projected10:  +projected10.toFixed(1),
    pressureMult: +mult.toFixed(2),
    confidence,
    signal,
    factors,
    market,
    totalCorners,
    entryWindow,
    isEarly,
    phase: isEarly ? "1ºT" : "2ºT",
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

// ── Confiança ─────────────────────────────────────────────────────────────────
function calcConfidence(proj10, factors, mult, game, baseRate, isEarly) {
  // Base proporcional à projeção (máx 40pts)
  let conf = clamp((proj10 / 3.0) * 40, 0, 40);

  // Qualidade dos fatores (máx 30pts)
  const high = factors.filter(f => f.impact === "high").length;
  const med  = factors.filter(f => f.impact === "medium").length;
  conf += clamp(high * 7 + med * 3, 0, 30);

  // Taxa histórica real do jogo (máx 15pts)
  if (baseRate > 0.20)      conf += 15;
  else if (baseRate > 0.14) conf += 8;
  else if (baseRate > 0.10) conf += 4;

  // Multiplicador elevado (máx 10pts)
  if (mult >= 1.30)         conf += 10;
  else if (mult >= 1.15)    conf += 5;

  // Penalidades por fase
  if (isEarly) {
    // 1ºT: mais conservador — poucos dados
    if (game.minute < 15)      conf *= 0.45; // muito cedo
    else if (game.minute < 25) conf *= 0.65;
    else if (game.minute < 35) conf *= 0.82;
    else                       conf *= 0.92; // 35-44' — razoável

    // Sem cruzamentos no 1ºT = sinal fraco
    const totalCrosses = safe(game.crosses?.home) + safe(game.crosses?.away);
    if (totalCrosses === 0 && game.minute > 20) conf *= 0.70;
  } else {
    // 2ºT: penalidade se taxa base muito baixa
    if (baseRate < 0.06 && game.minute > 50) conf *= 0.70;
  }

  return Math.round(clamp(conf, 5, 97));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    { home:"Manchester City", away:"Arsenal",     league:"Premier League",  leagueCountry:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    { home:"Real Madrid",     away:"Barcelona",   league:"La Liga",         leagueCountry:"🇪🇸" },
    { home:"Bayern München",  away:"B. Dortmund", league:"Bundesliga",      leagueCountry:"🇩🇪" },
    { home:"Inter Milan",     away:"AC Milan",    league:"Serie A",         leagueCountry:"🇮🇹" },
    { home:"PSG",             away:"Lyon",        league:"Ligue 1",         leagueCountry:"🇫🇷" },
  ];
  const t   = TEAMS[id % TEAMS.length];
  const min = 10 + Math.floor(Math.random() * 75);
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
    crosses:       { home:1+Math.floor(Math.random()*9), away:1+Math.floor(Math.random()*8) },
    offsides:      { home:Math.floor(Math.random()*4),   away:Math.floor(Math.random()*3) },
    blockedShots:  { home:Math.floor(Math.random()*4),   away:Math.floor(Math.random()*3) },
    clearances:    { home:Math.floor(Math.random()*12),  away:Math.floor(Math.random()*10) },
    longBalls:     { home:Math.floor(Math.random()*18),  away:Math.floor(Math.random()*16) },
    passes:        { home:80+Math.floor(Math.random()*180), away:60+Math.floor(Math.random()*160) },
    accuratePasses:{ home:60+Math.floor(Math.random()*140), away:50+Math.floor(Math.random()*120) },
    dangerousAttacks:{ home:15+Math.floor(Math.random()*35), away:10+Math.floor(Math.random()*30) },
    isDemo:true,
  };
}
