/**
 * lib/predictor.js — v9
 *
 * NOVOS DADOS DA API-FOOTBALL (quando APIFOOTBALL_KEY configurado):
 *   - shotsInsideBox:   chutes dentro da área (muito mais preditivo que totalShots)
 *   - dangerousAttacks: ataques perigosos REAIS (não mais estimados)
 *   - substitutions:    substituições ofensivas detectadas
 *   - historical:       média de corners por time/confronto → calibra leagueAvg
 *   - formations:       formação tática → fator de pressão pré-jogo
 *   - liveCornerOdds:   odds ao vivo → validação do sinal
 *
 * ALINHAMENTO COM JANELAS DE APOSTAS DAS CASAS:
 *   0-9 | 10-19 | 20-29 | 30-39 | 40-49 | 50-59 | 60-69 | 70-79 | 80-FIM
 *   Estratégia: sinal 1-2min antes da virada → aposta na próxima faixa
 *
 * FASES:
 *   1A (1-27') | 1B (28-37') | 1C (38-44')
 *   2A (45-57') → faixa 60-69 | 2B (58-67') → 70-79 | 2C (68-79') → 80-FIM
 */

const safe  = (v, def = 0) => (v !== undefined && v !== null && !isNaN(v) ? Number(v) : def);
const clamp = (v, lo, hi)  => Math.max(lo, Math.min(hi, v));
const rate  = (val, min)   => min > 1 ? val / min : 0;

/**
 * Detecta se o dado de cruzamentos está ausente.
 * Critérios: crosses = 0 para AMBOS os times E o jogo tem atividade real
 * (corners, chutes, passes) — evidência de que o jogo acontece mas a liga
 * não reporta cruzamentos via API-Football.
 */
function isCrossDataMissing(game, H, A) {
  const totalCrosses = safe(game.crosses?.home) + safe(game.crosses?.away);
  if (totalCrosses > 0) return false; // tem dado → não está faltando

  // Evidências de que o jogo tem atividade real
  const totalCorners = H.corners + A.corners;
  const totalShots   = H.shots   + A.shots;
  const totalPasses  = safe(game.passes?.home) + safe(game.passes?.away);

  // Se tem corners reais OU muitos chutes OU muitos passes → dado faltando
  return totalCorners >= 3 || totalShots >= 8 || totalPasses >= 100;
}

const LATE_START      = 45;
const BLOCK_ALERTS    = 83;
const MAX_MULT_EARLY  = 1.40;
const MAX_MULT_LATE   = 1.75;
const LEAGUE_AVG_EARLY = 0.090; // genérico quando liga não está na tabela
const LEAGUE_AVG_LATE  = 0.130;

// ── Melhoria 2: Médias históricas de corners por liga ────────────────────────
// Fonte: dados públicos ~3 temporadas. early=1ºT/45min, late=2ºT/45min
// Fórmula: avg_total × split_periodo / 45
const LEAGUE_CORNER_AVGS = {
  // Inglaterra
  39:  { early: 0.099, late: 0.143 }, // Premier League ~11.0/jogo
  40:  { early: 0.093, late: 0.135 }, // Championship ~10.3
  41:  { early: 0.088, late: 0.128 }, // League One ~9.7
  // Espanha
  140: { early: 0.091, late: 0.132 }, // La Liga ~10.0
  141: { early: 0.085, late: 0.124 }, // La Liga 2 ~9.3
  // Itália
  135: { early: 0.082, late: 0.118 }, // Serie A ~9.0
  136: { early: 0.079, late: 0.114 }, // Serie B ~8.7
  // Alemanha
  78:  { early: 0.092, late: 0.133 }, // Bundesliga ~10.1
  79:  { early: 0.086, late: 0.124 }, // 2. Bundesliga ~9.5
  // França
  61:  { early: 0.075, late: 0.108 }, // Ligue 1 ~8.2
  62:  { early: 0.072, late: 0.104 }, // Ligue 2 ~7.9
  // Portugal
  94:  { early: 0.086, late: 0.124 }, // Primeira Liga ~9.5
  // Holanda
  88:  { early: 0.093, late: 0.134 }, // Eredivisie ~10.2
  // Turquia
  203: { early: 0.088, late: 0.127 }, // Süper Lig ~9.7
  204: { early: 0.083, late: 0.120 }, // 1. Lig ~9.1
  // Brasil
  71:  { early: 0.082, late: 0.118 }, // Brasileirão ~9.0
  72:  { early: 0.079, late: 0.114 }, // Série B ~8.7
  // Argentina
  128: { early: 0.083, late: 0.120 }, // Liga Profesional ~9.1
  // México
  262: { early: 0.084, late: 0.122 }, // Liga MX ~9.2
  // MLS
  253: { early: 0.087, late: 0.126 }, // MLS ~9.6
  // Champions/Europa
  2:   { early: 0.097, late: 0.140 }, // Champions League ~10.7
  3:   { early: 0.093, late: 0.134 }, // Europa League ~10.2
  4:   { early: 0.089, late: 0.129 }, // Conference League ~9.8
  // Escócia
  179: { early: 0.083, late: 0.120 }, // Premiership ~9.1
  180: { early: 0.079, late: 0.114 }, // Championship ~8.7
  // Bélgica
  144: { early: 0.085, late: 0.123 }, // Pro League ~9.3
  // Grécia
  197: { early: 0.080, late: 0.116 }, // Super League ~8.8
  // Turquia 2ª
  // Suécia
  113: { early: 0.082, late: 0.118 }, // Allsvenskan ~9.0
  114: { early: 0.077, late: 0.111 }, // Superettan ~8.5
  // Noruega  ← Eliteserien é onde estava o bug
  103: { early: 0.075, late: 0.107 }, // Eliteserien ~8.2
  104: { early: 0.072, late: 0.103 }, // 1. divisjon ~7.9
  // Dinamarca ← Superliga é onde FC Nordsjaelland x Brondby joga
  119: { early: 0.078, late: 0.112 }, // Superliga ~8.6
  120: { early: 0.074, late: 0.107 }, // 1. Division ~8.1
  // Suíça
  207: { early: 0.081, late: 0.116 }, // Super League ~8.9
  // Áustria
  218: { early: 0.079, late: 0.114 }, // Bundesliga ~8.7
  // Polônia ← Ekstraklasa
  106: { early: 0.083, late: 0.120 }, // Ekstraklasa ~9.1
  107: { early: 0.079, late: 0.114 }, // I liga ~8.7
  // Rep. Checa
  345: { early: 0.080, late: 0.115 }, // Fortuna Liga ~8.8
  // Romênia
  283: { early: 0.078, late: 0.112 }, // Liga 1 ~8.6
  // Croácia
  169: { early: 0.080, late: 0.115 }, // HNL ~8.8
  // Sérvia
  167: { early: 0.079, late: 0.113 }, // SuperLiga ~8.7
  // Chile
  265: { early: 0.080, late: 0.115 }, // Primera ~8.8
  // Colômbia
  240: { early: 0.082, late: 0.118 }, // Liga ~9.0
  // Japão
  98:  { early: 0.085, late: 0.123 }, // J1 League ~9.3
  // Coreia
  292: { early: 0.083, late: 0.119 }, // K League 1 ~9.1
  // Arábia Saudita
  307: { early: 0.086, late: 0.124 }, // Pro League ~9.5
  // Egito
  233: { early: 0.065, late: 0.093 }, // Premier League ~7.1/jogo
  // Israel
  382: { early: 0.070, late: 0.100 }, // Liga Leumit ~7.7
  // Uruguai
  268: { early: 0.072, late: 0.103 }, // Primera División ~7.9
  // Venezuela / outros sul-americanos lentos
  265: { early: 0.075, late: 0.108 }, // Chile Primera ~8.3
  266: { early: 0.071, late: 0.103 }, // Chile Segunda ~7.9
};

function getLeagueAvg(leagueAfId, isEarly) {
  const avg = LEAGUE_CORNER_AVGS[leagueAfId];
  if (avg) return isEarly ? avg.early : avg.late;
  return isEarly ? LEAGUE_AVG_EARLY : LEAGUE_AVG_LATE;
}

const STRONG_LATE     = 60; // calibrado: 62 era excessivamente conservador para 2ºT
const STRONG_EARLY    = 72;
const MODERATE_THRESH = 48;

// ── Janelas de apostas das casas ──────────────────────────────────────────────
// Retorna a janela ALVO para aposta baseada no minuto atual
// Antecipa 4 minutos antes da virada — tempo suficiente para abrir a aposta
function getTargetBetWindow(minute) {
  const decadeRemainder = minute % 10;
  const currentDecade   = Math.floor(minute / 10) * 10;
  const nextDecade      = currentDecade + 10;

  // Nos últimos 4 minutos de cada faixa (x6,x7,x8,x9) já aponta para a PRÓXIMA
  // Ex: 6,7,8,9 → aponta para 10-19min | 66,67,68,69 → aponta para 70-79
  const isPreTransition = decadeRemainder >= 6 && nextDecade <= 90;

  let targetStart, targetEnd, targetLabel, isNext;

  if (isPreTransition) {
    targetStart = nextDecade;
    targetEnd   = nextDecade >= 80 ? 90 : nextDecade + 9;
    targetLabel = nextDecade >= 80 ? "80-FIM" : `${nextDecade}-${nextDecade + 9}min`;
    isNext = true;
  } else {
    targetStart = currentDecade;
    targetEnd   = currentDecade >= 80 ? 90 : currentDecade + 9;
    targetLabel = currentDecade >= 80 ? "80-FIM" : `${currentDecade}-${currentDecade + 9}min`;
    isNext = false;
  }

  const minsToWindowStart = isNext ? (10 - decadeRemainder) : 0;

  return {
    label: targetLabel,
    start: targetStart,
    end:   targetEnd,
    isNext,
    minsToWindowStart,
    minsLeftInWindow: isNext ? minsToWindowStart : (10 - decadeRemainder),
    actionLabel: isNext
      ? `ENTRAR EM ~${minsToWindowStart}min na faixa ${targetLabel}`
      : `FAIXA ATIVA: ${targetLabel}`,
  };
}

// ── Calibração histórica com peso por amostra e variância ────────────────────
function calcHistoricalLeagueAvg(game, isEarly) {
  const h = game.historical;
  if (!h) return null;

  const homeRaw = h.homeAvgRaw;
  const awayRaw = h.awayAvgRaw;
  const homeN   = h.homeGames || 0;
  const awayN   = h.awayGames || 0;
  const homeVar = h.homeVariance ?? 4;
  const awayVar = h.awayVariance ?? 4;

  // Peso por tamanho da amostra: 2j=0.50, 5j=0.78, 8j=1.00
  const wN  = (n) => Math.min(1.0, (n / 8) * 0.6 + 0.4);
  // Peso por variância: baixa = mais confiável
  const wVar = (v) => v <= 1 ? 1.0 : v <= 2 ? 0.85 : v <= 4 ? 0.70 : 0.55;
  // Peso total combinado
  const weight = (n, v) => wN(n) * wVar(v);

  let expected = null;

  if (homeRaw && homeN >= 2 && awayRaw && awayN >= 2) {
    const wH = weight(homeN, homeVar);
    const wA = weight(awayN, awayVar);
    const hExp = homeRaw * 1.10;
    const aExp = awayRaw * 0.92;
    expected = ((hExp * wH) + (aExp * wA)) / (wH + wA);
  } else if (homeRaw && homeN >= 2) {
    const w = weight(homeN, homeVar);
    expected = (homeRaw * 1.10 * w) + (5.0 * (1 - w));
  } else if (awayRaw && awayN >= 2) {
    const w = weight(awayN, awayVar);
    expected = (5.5 * (1 - w)) + (awayRaw * 0.92 * w);
  }

  // Fallback H2H ponderado
  if (!expected && h.h2hEstCorners && h.h2hGames >= 3) {
    const h2wH = Math.min(0.70, h.h2hGames / 10 * 0.7);
    const gen  = isEarly ? 8.1 : 10.4;
    expected   = (h.h2hEstCorners * h2wH) + (gen * (1 - h2wH));
  }

  if (!expected) return null;
  expected = clamp(expected, 4, 18);
  return isEarly ? (expected * 0.44) / 45 : (expected * 0.56) / 45;
}

// ── Validação pelas odds ao vivo ───────────────────────────────────────────────
function calcOddsBoost(game) {
  const odds = game.liveCornerOdds;
  if (!odds?.overOdd) return 1.0;

  const o = odds.overOdd;
  // Odds baixas = casas com alta convicção de que vai ter corner
  // Over 0.5 corners em faixa de 10min:
  //   < 1.25 → casas muito confiantes → boost forte
  //   1.25-1.50 → boost moderado
  //   1.50-1.80 → neutro/leve
  //   > 1.80 → casas céticas → leve redução
  if (o < 1.20) return 1.12;
  if (o < 1.30) return 1.08;
  if (o < 1.50) return 1.04;
  if (o < 1.80) return 1.00;
  if (o < 2.20) return 0.94;
  return 0.88;
}

// ── Fator de formação tática ───────────────────────────────────────────────────
function calcFormationFactor(game) {
  const f = game.formations;
  if (!f) return { delta: 0, label: null };

  const ha = f.homeAttackScore ?? 0;
  const aa = f.awayAttackScore ?? 0;
  const combined = ha + aa;

  // Ambos ofensivos (ex: 4-3-3 vs 4-3-3) → jogo aberto, mais corners
  if (combined >= 3)  return { delta: 0.08, label: `Ambos ofensivos (${f.home} × ${f.away})` };
  if (combined >= 1)  return { delta: 0.04, label: `Formação equilibrada (${f.home} × ${f.away})` };
  // Defensivo vs defensivo → blocos baixos = menos corners
  if (combined <= -2) return { delta: -0.06, label: `Ambos defensivos (${f.home} × ${f.away})` };
  return { delta: 0, label: null };
}

// ── Fator de substituição ofensiva ─────────────────────────────────────────────
function calcSubstitutionFactor(game, min) {
  const subs = game.offensiveSubs;
  if (!subs) return { deltaH: 0, deltaA: 0, labels: [] };

  const labels = [];
  let deltaH = 0, deltaA = 0;

  if (subs.home >= 1) {
    deltaH += subs.home >= 2 ? 0.15 : 0.09;
    labels.push(`Sub ofensiva casa (${subs.home}x) ↑pressão`);
  }
  if (subs.away >= 1) {
    deltaA += subs.away >= 2 ? 0.15 : 0.09;
    labels.push(`Sub ofensiva fora (${subs.away}x) ↑pressão`);
  }

  return { deltaH, deltaA, labels };
}

// ── Fator Shots Inside Box com proporção inside/total ─────────────────────────
function calcInsideBoxFactor(game, min, isEarly) {
  const sib = game.shotsInsideBox;
  if (!sib) return { delta: 0, label: null };

  const inside  = safe(sib.home) + safe(sib.away);
  const outside = safe(game.shotsOutsideBox?.home) + safe(game.shotsOutsideBox?.away);
  const total   = inside + outside;
  const sibRate = rate(inside, min);

  let delta = 0, label = null, impact = "low";

  if (sibRate > 0.22)      { delta = 0.18; label = `Pressão concentrada na área (${inside} inside)`; impact = "high"; }
  else if (sibRate > 0.15) { delta = 0.10; label = `Chutes na área frequentes (${inside})`; impact = "medium"; }
  else if (sibRate > 0.08) { delta = 0.05; label = `Chutes na área moderados (${inside})`; impact = "low"; }

  // Proporção inside/total — qualidade da pressão
  if (total >= 6 && inside / total >= 0.70) {
    delta += 0.07;
    label  = `${label || `Chutes inside box (${inside})`} — ${Math.round(inside/total*100)}% concentrados na área`;
    impact = impact === "low" ? "medium" : impact;
  }

  return { delta, label, impact };
}

// ── Fator Dangerous Attacks REAL com assimetria direcional ────────────────────
function calcRealDAFactor(game, min) {
  const da = game.dangerousAttacks;
  if (!da || !game.dangerousAttacksReal) return { delta: 0, label: null };

  const homeDA = safe(da.home);
  const awayDA = safe(da.away);
  const total  = homeDA + awayDA;
  const daRate = rate(total, min);

  let delta = 0, label = null, impact = "low";

  if (daRate > 5.0)      { delta = 0.12; label = `Ataques perigosos muito altos (${total})`; impact = "high"; }
  else if (daRate > 3.5) { delta = 0.07; label = `Ataques perigosos elevados (${total})`; impact = "medium"; }
  else if (daRate > 2.0) { delta = 0.03; label = `Ataques perigosos moderados (${total})`; impact = "low"; }

  // Assimetria: time perdendo domina os DA → pressão direcionada = mais corners
  const diff = Math.abs(game.score.home - game.score.away);
  if (diff >= 1 && total >= 20) {
    const losingDA  = game.score.home < game.score.away ? homeDA : awayDA;
    const dominacao = losingDA / total;
    if (dominacao > 0.65) {
      delta += 0.08;
      label  = `${label || "Ataques"} — time perdendo domina pressão (${Math.round(dominacao*100)}% DA)`;
      impact = impact === "high" ? "high" : "medium";
    }
  }

  return { delta, label, impact };
}

// ── Melhoria 1: Assimetria direcional — time perdedor dominando o ataque ────────
// DA já tem assimetria individual; aqui unificamos crosses + SIB também
function calcDirectionalPressure(game, H, A, min) {
  const diff = game.score.home - game.score.away;
  if (diff === 0 || min < 20) return { delta: 0, label: null }; // empate ou cedo demais

  const losingHome = diff < 0; // casa está perdendo
  let delta = 0, label = null;

  // Assimetria de cruzamentos
  const totalCross = H.crosses + A.crosses;
  if (totalCross >= 5) {
    const losingCross = losingHome ? H.crosses : A.crosses;
    if (losingCross / totalCross > 0.70) {
      delta += 0.10;
      label = `Cruzamentos do time perdedor (${Math.round(losingCross/totalCross*100)}%) — pressão unilateral`;
    }
  }

  // Assimetria de shots inside box
  const sibH = safe(game.shotsInsideBox?.home);
  const sibA = safe(game.shotsInsideBox?.away);
  const totalSIB = sibH + sibA;
  if (totalSIB >= 5) {
    const losingSIB = losingHome ? sibH : sibA;
    if (losingSIB / totalSIB > 0.70) {
      delta += 0.08;
      const lbl = `SIB concentrados no time perdedor (${Math.round(losingSIB/totalSIB*100)}%)`;
      label = label ? `${label} + ${lbl}` : lbl;
    }
  }

  if (delta === 0) return { delta: 0, label: null };
  return { delta: clamp(delta, 0, 0.18), label, impact: "medium" };
}

// ── Fator cartão vermelho ──────────────────────────────────────────────────────
function calcRedCardFactor(game) {
  const redH = safe(game.redCards?.home);
  const redA = safe(game.redCards?.away);
  if (redH === 0 && redA === 0) return { delta: 0, label: null };

  const diff = game.score.home - game.score.away;
  let delta = 0, label = null;

  if (redH > 0 && diff > 0) {
    delta = 0.18; label = `Casa com ${redH} expulso(s) e perdendo — pressão desesperada`;
  } else if (redA > 0 && diff < 0) {
    delta = 0.18; label = `Visitante com ${redA} expulso(s) e perdendo — pressão desesperada`;
  } else if (redH > 0 && diff <= 0) {
    delta = -0.12; label = `Casa com ${redH} expulso(s) — tende a fechar o jogo`;
  } else if (redA > 0 && diff >= 0) {
    delta = -0.12; label = `Visitante com ${redA} expulso(s) — defensivo`;
  }

  return { delta, label, impact: Math.abs(delta) >= 0.15 ? "high" : "medium" };
}

// ── Fator offsides — linha alta ofensiva ──────────────────────────────────────
function calcOffsidesFactor(game, min) {
  const total   = safe(game.offsides?.home) + safe(game.offsides?.away);
  if (total < 3) return { delta: 0, label: null };
  const offRate = rate(total, min);
  if (offRate > 0.12) return { delta: 0.06, label: `Linhas muito avançadas (${total} impedimentos)`, impact: "low" };
  if (offRate > 0.07) return { delta: 0.03, label: `Impedimentos frequentes (${total}) — ataque avançado`, impact: "low" };
  return { delta: 0, label: null };
}

// ── Detector de gol recente — retorna contexto do gol ────────────────────────
// Retorna null (sem gol recente) ou objeto com { scoredTeamId, wasLosingTeam }
function detectRecentGoal(game) {
  if (!Array.isArray(game.goalEvents) || !game.goalEvents.length) return null;
  const min = game.minute;
  const recent = game.goalEvents.find(e => {
    const gMin = e.time?.elapsed || 0;
    return (min - gMin) >= 0 && (min - gMin) <= 5;
  });
  if (!recent) return null;

  const scoredTeamId  = recent.team?.id || null;
  const homeScore     = game.score?.home ?? 0;
  const awayScore     = game.score?.away ?? 0;
  const diff          = homeScore - awayScore;

  // O time que marcou ainda está perdendo?
  // Se home marcou (scoredTeamId === homeId) e diff < 0 → home ainda perde
  // Se away marcou e diff > 0 → away ainda perde
  const homeId = game.homeId;
  const awayId = game.awayId;
  let scoredIsLosingTeam = false;

  if (scoredTeamId && homeId && awayId) {
    if (scoredTeamId === homeId && diff < 0) scoredIsLosingTeam = true;
    if (scoredTeamId === awayId && diff > 0) scoredIsLosingTeam = true;
  }

  return { scoredTeamId, scoredIsLosingTeam, diff: Math.abs(diff) };
}

// ── Melhoria 3: Momentum de corners — jogo já acelerado? ─────────────────────
// Sem snapshots históricos, usamos a relação entre taxa atual e média da liga
// Se taxa atual > 1.4× média esperada da liga = jogo acelerado, padrão tende a continuar
function calcCornerMomentum(leagueAfId, baseRate, isEarly, game) {
  if (baseRate === 0) return { delta: 0, label: null };
  const expectedRate = getLeagueAvg(leagueAfId, isEarly);
  const ratio = baseRate / expectedRate;

  // FIX C: threshold menor para ligas sem crosses — compensa ausência dos fatores
  // cross_missing é passado pelo contexto do jogo ao chamar calcCornerMomentum
  const crossMissingCtx = game?._crossMissing ?? false;
  const momentumThresh  = crossMissingCtx ? 1.15 : 1.25;

  if (ratio >= 1.8)                  return { delta: 0.10, label: `Jogo muito acima da média (${ratio.toFixed(1)}× ritmo da liga)`, impact: "high" };
  if (ratio >= momentumThresh)       return { delta: 0.06, label: `Ritmo acima da média da liga (${ratio.toFixed(1)}×)`, impact: "medium" };
  if (ratio <= 0.55 && baseRate > 0) return { delta: -0.06, label: `Ritmo abaixo da média da liga (${ratio.toFixed(1)}×)`, impact: "low" };
  return { delta: 0, label: null };
}

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

// ── Detector pós-gol (proxy) ──────────────────────────────────────────────────
// NUNCA aplica cooldown se o jogo tem evidências concretas de estar ativo.
// Corners já acontecidos, SIB alto e chutes bloqueados são fatos — não esfriamento.
function detectPostGoalCooldown(game, H, A) {
  const goals = game.score.home + game.score.away;
  if (goals === 0) return false;
  const min = game.minute;

  // Se o jogo tem evidências fortes de atividade, NÃO É cooldown
  const totalCorners = (H.corners || 0) + (A.corners || 0);
  const totalSIB     = safe(game.shotsInsideBox?.home) + safe(game.shotsInsideBox?.away);
  const totalBlocked = H.blocked + A.blocked;
  const totalOnTarget = H.onTarget + A.onTarget;

  // Evidência >= 7/10: jogo claramente ativo — sem cooldown
  const evidence = Math.min(10,
    totalCorners * 2.0 + totalBlocked * 1.5 + totalOnTarget * 1.0
  );
  if (evidence >= 7)   return false; // jogo quente, não há cooldown
  if (totalSIB >= 5)   return false; // muita pressão na área
  if (totalCorners >= 4) return false; // corners acumulados provam atividade

  const expectedShots = min * 0.35;
  const totalShots    = H.shots + A.shots;
  const lowShots      = totalShots < expectedShots * 0.6;

  const crossMissing = isCrossDataMissing(game, H, A);
  if (crossMissing) {
    return (min < 45 && Math.abs(game.score.home - game.score.away) >= 1 && lowShots);
  }

  const expectedCrosses = min * 0.20;
  const totalCrosses    = H.crosses + A.crosses;
  const lowActivity     = lowShots && (totalCrosses < expectedCrosses * 0.6);
  return (min < 45 && Math.abs(game.score.home - game.score.away) >= 1 && lowActivity);
}

// ── MODO EARLY: 1º tempo — 5 sub-fases alinhadas com janelas de apostas ─────────
//
// ALINHAMENTO COMPLETO COM JANELAS:
//   P0 (1-9')   → aponta 10-19min  (sinal antecipado para abertura da faixa)
//   P1 (10-19') → aponta 20-29min
//   P2 (20-29') → aponta 30-39min
//   P3 (30-39') → aponta 40-49min
//   P4 (38-44') → aponta 50-59min  (sobrepõe P3 nos últimos minutos → intervalo)
//
// Antes: fases 1A/1B/1C deixavam as janelas 10-19, 20-29 e 30-39 invisíveis.
// Agora: cada janela do 1ºT tem uma fase correspondente.
//
// Anti-falso-positivo: penalidade de confiança é dinâmica e reduz progressivamente.
// A chave é que corners JÁ ACONTECIDOS são dados consumados — mais confiáveis
// que cruzamentos (que são "intenção") nos primeiros minutos.
function calcEarlyPressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // Sub-fases alinhadas às janelas de apostas
  const phaseP0 = min < 10;                     // 1-9':   → alvo 10-19min
  const phaseP1 = min >= 10 && min < 20;        // 10-19': → alvo 20-29min
  const phaseP2 = min >= 20 && min < 30;        // 20-29': → alvo 30-39min
  const phaseP3 = min >= 30 && min < 38;        // 30-37': → alvo 40-49min
  const phaseP4 = min >= 38;                    // 38-44': → alvo 50-59min

  const crossRate   = H.crossRate + A.crossRate;
  const crossMissing = isCrossDataMissing(game, H, A);

  // ── 1. Cruzamentos ─────────────────────────────────────────────────────────
  if (!crossMissing) {
    if (phaseP0) {
      // P0: thresholds altíssimos — dados diluídos, só explosão real conta
      if (crossRate > 0.55) add("Cruzamentos explosivos (início)",     `${(crossRate*10).toFixed(1)}/10min`, "high",   0.22);
      else if (crossRate > 0.40) add("Cruzamentos muito altos",        `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.12);
    } else if (phaseP1) {
      if (crossRate > 0.45) add("Cruzamentos muito frequentes",        `${(crossRate*10).toFixed(1)}/10min`, "high",   0.22);
      else if (crossRate > 0.30) add("Cruzamentos frequentes",         `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.12);
      else if (crossRate > 0.20) add("Cruzamentos moderados",          `${(crossRate*10).toFixed(1)}/10min`, "low",    0.06);
    } else if (phaseP2) {
      if (crossRate > 0.40) add("Cruzamentos muito frequentes",        `${(crossRate*10).toFixed(1)}/10min`, "high",   0.22);
      else if (crossRate > 0.28) add("Cruzamentos frequentes",         `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.13);
      else if (crossRate > 0.18) add("Cruzamentos moderados",          `${(crossRate*10).toFixed(1)}/10min`, "low",    0.06);
    } else {
      // P3/P4: dados maduros
      const threshold = phaseP3 ? 0.38 : 0.30;
      if (crossRate > threshold + 0.10) add("Cruzamentos muito frequentes", `${(crossRate*10).toFixed(1)}/10min`, "high",   0.22);
      else if (crossRate > threshold)   add("Cruzamentos frequentes",       `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.13);
      else if (crossRate > threshold - 0.10) add("Cruzamentos moderados",  `${(crossRate*10).toFixed(1)}/10min`, "low",    0.06);
    }
  }

  // ── 2. Chutes bloqueados — corners latentes ────────────────────────────────
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)      add("Muitos chutes bloqueados — corners latentes", `${blocked} bloqueios`, "high",   0.20);
  else if (blocked >= 3) add("Chutes bloqueados — bola na área",            `${blocked} bloqueios`, "medium", 0.11);
  else if (blocked >= 2) add("Bloqueios presentes",                          `${blocked} bloqueios`, "low",    0.05);

  // ── 3. Defesas do goleiro ──────────────────────────────────────────────────
  const saves = H.saves + A.saves;
  const savesThreshold = (phaseP0 || phaseP1) ? 5 : (phaseP2 ? 4 : 3);
  if (saves >= savesThreshold + 1)  add("Goleiros muito exigidos",  `${saves} defesas`, "high",   0.17);
  else if (saves >= savesThreshold) add("Goleiros ativos",          `${saves} defesas`, "medium", 0.10);
  else if (saves >= 2)              add("Pressão sobre goleiros",   `${saves} defesas`, "low",    0.04);

  // ── 4. Volume de chutes ────────────────────────────────────────────────────
  const shots = H.shots + A.shots;
  const shotsThresh = (phaseP0||phaseP1) ? 14 : (phaseP2 ? 12 : (phaseP3 ? 10 : 8));
  if (shots >= shotsThresh)          add("Alto volume de chutes",   `${shots} chutes`, "medium", 0.11);
  else if (shots >= shotsThresh - 4) add("Volume moderado de chutes", `${shots} chutes`, "low",  0.05);

  // ── 5. Pressão sem gol ─────────────────────────────────────────────────────
  const onTgt  = H.onTarget + A.onTarget;
  const goals  = game.score.home + game.score.away;
  const onTgtThresh = (phaseP0||phaseP1) ? 6 : 4;
  if (onTgt >= onTgtThresh && goals === 0)          add("Pressão sem gol — frustração",    `${onTgt} no alvo`, "high",   0.16);
  else if (onTgt >= onTgtThresh - 1 && goals === 0) add("Chutes no alvo sem conversão",    `${onTgt} no alvo`, "medium", 0.09);

  // ── 6. Domínio territorial ─────────────────────────────────────────────────
  const maxPoss    = Math.max(H.possession, A.possession);
  const totalShots = H.shots + A.shots;
  const totalCross = H.crosses + A.crosses;
  if (maxPoss >= 68 && (totalShots >= 6 || totalCross >= 3)) {
    add("Domínio territorial com pressão real", `${maxPoss.toFixed(0)}%`, "low", 0.05);
  }

  // ── 7. Placar desequilibrado ───────────────────────────────────────────────
  const diff = Math.abs(game.score.home - game.score.away);
  if (!phaseP0 && min >= 15 && diff >= 1) add("Time perdendo avança no 1ºT", `${game.score.home}-${game.score.away}`, "medium", 0.09);

  // ── 9. Assimetria de corners — um time domina completamente ───────────────
  // Se um time tem >75% dos corners, está em pressão direcional intensa
  // Isso é especialmente preditivo em ligas sem crosses/DA
  const cornersHome = H.corners;
  const cornersAway = A.corners;
  const cornersTotal = cornersHome + cornersAway;
  if (cornersTotal >= 4) {
    const maxShare = Math.max(cornersHome, cornersAway) / cornersTotal;
    if (maxShare >= 0.80) add("Domínio absoluto de escanteios", `${Math.round(maxShare*100)}% dos corners`, "medium", 0.09);
    else if (maxShare >= 0.70) add("Domínio de escanteios", `${Math.round(maxShare*100)}% dos corners`, "low", 0.05);
  }

  // ── 8. Taxa de corners — proxy de pressão real ────────────────────────────
  // Corner é dado consumado — mais confiável que cross nos primeiros minutos
  // Thresholds: 0.17/min = 2× média das ligas | 0.13/min = 1.6× média
  const totalCornersE = H.corners + A.corners;
  const cornerRateE   = rate(totalCornersE, min);

  if (phaseP0) {
    // P0: apenas confirmação de explosão real (≥2 corners + ritmo >0.22)
    if (totalCornersE >= 2 && cornerRateE > 0.22)
      add("Ritmo explosivo de escanteios",      `${totalCornersE} corners em ${min}'`, "low", 0.06);
  } else if (phaseP1) {
    if (cornerRateE > 0.17)                     add("Ritmo alto de escanteios",            `${(cornerRateE*10).toFixed(1)}/10min`, "medium", 0.08);
    else if (cornerRateE > 0.13)                add("Ritmo acima da média",                `${(cornerRateE*10).toFixed(1)}/10min`, "low",    0.04);
    else if (cornerRateE > 0.10 && crossMissing) add("Escanteios frequentes (sem crosses)", `${(cornerRateE*10).toFixed(1)}/10min`, "low",    0.04);
  } else if (phaseP2) {
    if (cornerRateE > 0.15)                     add("Ritmo alto de escanteios",            `${(cornerRateE*10).toFixed(1)}/10min`, "medium", 0.09);
    else if (cornerRateE > 0.11)                add("Bom ritmo de escanteios",             `${(cornerRateE*10).toFixed(1)}/10min`, "low",    0.05);
    else if (cornerRateE > 0.09 && crossMissing) add("Escanteios frequentes (sem crosses)", `${(cornerRateE*10).toFixed(1)}/10min`, "low",    0.05);
  } else {
    // P3/P4: dados maduros
    if (cornerRateE > 0.15)                     add("Ritmo alto de escanteios no 1ºT",    `${(cornerRateE*10).toFixed(1)}/10min`, "medium", 0.09);
    else if (cornerRateE > 0.11)                add("Bom ritmo de escanteios",             `${(cornerRateE*10).toFixed(1)}/10min`, "low",    0.05);
    else if (cornerRateE > 0.09 && crossMissing) add("Escanteios frequentes (sem crosses)", `${(cornerRateE*10).toFixed(1)}/10min`, "low",    0.05);
  }

  return { mult: clamp(mult, 1.0, MAX_MULT_EARLY), factors, crossRate, blocked };
}

// ── MODO LATE: 2º tempo — 3 sub-fases alinhadas às janelas ───────────────────
function calcLatePressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // Sub-fases alinhadas às faixas das casas de apostas
  const phase2A = min < 58;   // 45-57': preparação → alvo faixa 60-69
  const phase2B = min >= 58 && min < 68; // 58-67': transição → alvo faixa 70-79
  const phase2C = min >= 68;  // 68-83': pressão final → alvo faixa 80-FIM

  // ── 1. Cruzamentos (indicador mais preditivo) ──────────────────────────────
  // SKIP se dado ausente — liga não reporta cruzamentos
  const crossRate = H.crossRate + A.crossRate;
  const crossMissing = isCrossDataMissing(game, H, A);
  if (!crossMissing) {
    if (phase2A) {
      if (crossRate > 0.28)      add("Cruzamentos frequentes (início 2ºT)",     `${(crossRate*10).toFixed(1)}/10min`, "high",   0.20);
      else if (crossRate > 0.18) add("Cruzamentos moderados",                   `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.11);
      else if (crossRate > 0.12) add("Cruzamentos presentes",                   `${(crossRate*10).toFixed(1)}/10min`, "low",    0.05);
    } else if (phase2B) {
      if (crossRate > 0.34)      add("Volume alto de cruzamentos",              `${(crossRate*10).toFixed(1)}/10min`, "high",   0.19);
      else if (crossRate > 0.22) add("Cruzamentos frequentes",                  `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.10);
      else if (crossRate > 0.14) add("Cruzamentos presentes",                   `${(crossRate*10).toFixed(1)}/10min`, "low",    0.05);
    } else {
      // phase2C: limiares normais — dados maduros
      if (crossRate > 0.40)      add("Volume alto de cruzamentos",              `${(crossRate*10).toFixed(1)}/10min`, "high",   0.18);
      else if (crossRate > 0.25) add("Cruzamentos frequentes",                  `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.09);
    }
  }

  // ── 2. Chutes bloqueados ────────────────────────────────────────────────────
  const blocked = H.blocked + A.blocked;
  const blockedThresh = phase2A ? 3 : phase2B ? 4 : 5;
  if (blocked >= blockedThresh + 2)  add("Muitos chutes bloqueados",          `${blocked} bloqueios`, "high",   0.14);
  else if (blocked >= blockedThresh) add("Chutes bloqueados",                 `${blocked} bloqueios`, "medium", 0.08);
  else if (blocked >= 2)             add("Bloqueios presentes",               `${blocked} bloqueios`, "low",    0.04);

  // ── 3. Defesas do goleiro ───────────────────────────────────────────────────
  const saves = H.saves + A.saves;
  const savesThresh = phase2A ? 3 : phase2B ? 4 : 6;
  if (saves >= savesThresh + 2)  add("Goleiros muito exigidos",               `${saves} defesas`, "high",   0.15);
  else if (saves >= savesThresh) add("Goleiros ativos",                       `${saves} defesas`, "medium", 0.08);
  else if (saves >= 2)           add("Pressão sobre goleiros",                `${saves} defesas`, "low",    0.04);

  // ── 4. Volume de chutes ─────────────────────────────────────────────────────
  const shots = H.shots + A.shots;
  const shotsThresh = phase2A ? 10 : phase2B ? 13 : 16;
  if (shots >= shotsThresh)      add("Alto volume de chutes",                 `${shots} chutes`, "medium", 0.09);
  else if (shots >= shotsThresh - 4) add("Volume de chutes",                 `${shots} chutes`, "low",    0.04);

  // ── 5. Pressão sem conversão ────────────────────────────────────────────────
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  const scoreDiffAbs = Math.abs(game.score.home - game.score.away);
  const onTgtThresh = phase2A ? 4 : phase2B ? 5 : 7;
  // FIX C: usar diff_absoluto em vez de goals_total
  // 1-1 com 8 no alvo = ambos os times ainda querendo marcar → frustração real
  if (onTgt >= onTgtThresh && scoreDiffAbs <= 1)
    add("Pressão sem conversão — frustração", `${onTgt} no alvo`, "high", 0.14);
  else if (onTgt >= onTgtThresh - 1 && goals === 0)
    add("Chutes no alvo sem gol", `${onTgt} no alvo`, "medium", 0.08);

  // ── 6. Contexto de placar ───────────────────────────────────────────────────
  const diff = game.score.home - game.score.away;
  if (Math.abs(diff) >= 1) {
    if (min >= 65)             add("Time perdendo — pressão final",           `${min}' · ${game.score.home}-${game.score.away}`, "high",   0.16);
    else if (min >= 55)        add("Time em desvantagem — pressão crescente", `${min}' · ${game.score.home}-${game.score.away}`, "high",   0.13);
    else if (min >= 48)        add("Time em desvantagem avança",              `${min}' · ${game.score.home}-${game.score.away}`, "medium", 0.09);
    else                       add("Desequilíbrio no placar",                 `${game.score.home}-${game.score.away}`,           "low",    0.05);
  } else if (diff === 0 && min >= 65) {
    add("Empate — ambos buscam virada",                                       `${min}'`, "medium", 0.10);
  } else if (diff === 0 && min >= 52) {
    add("Jogo empatado em aberto",                                            `${min}'`, "low",    0.06);
  }

  // ── 7. Fator minuto CONDICIONAL (evita sinal tardio em jogo morto) ─────────
  const realGameMult = mult;
  if (min >= 78) {
    // Faixa 80-FIM: condicional estrito
    if (realGameMult >= 1.12) add("Pressão máxima final + dados sólidos",    `${min}'`, "high",   0.15);
    else                      add("Final de jogo (pressão limitada)",         `${min}'`, "low",    0.05);
  } else if (min >= 68) {
    // Faixa 70-79: condicional moderado
    if (realGameMult >= 1.08) add("Final de jogo — pressão crescente",       `${min}'`, "medium", 0.10);
    else                      add("Final de jogo",                            `${min}'`, "low",    0.04);
  } else if (min >= 58) {
    // Faixa 60-69: suave — dados ainda em construção
    if (realGameMult >= 1.05) add("2º tempo avançado — jogo aberto",         `${min}'`, "low",    0.06);
  }
  // Fase2A (45-57'): SEM fator de minuto — dados insuficientes para justificar

  // ── 8. Complementares ──────────────────────────────────────────────────────
  const fouls = H.fouls + A.fouls;
  if (fouls >= 20)             add("Jogo muito físico",                       `${fouls} faltas`, "medium", 0.07);
  else if (fouls >= 14)        add("Jogo físico",                            `${fouls} faltas`, "low",    0.03);

  // Posse só conta se acompanhada de volume de chutes — sozinha não gera corner
  const maxPoss = Math.max(H.possession, A.possession);
  const totalShotsLate = H.shots + A.shots;
  if (maxPoss >= 68 && totalShotsLate >= 8) {
    add("Domínio com volume de chutes", `${maxPoss.toFixed(0)}%`, "low", 0.04);
  }

  // Taxa de corners — disponível a partir de 52' no 2ºT (dados maduros suficientes)
  // Para ligas sem crosses (crossMissing), a taxa de corners é o principal proxy
  // de pressão disponível → thresholds menores e mais sensíveis
  const totalCorners2 = H.corners + A.corners;
  const cRate2 = rate(totalCorners2, min);
  const crossMissing2 = isCrossDataMissing(game, H, A);
  if (phase2A) {
    if (min >= 47 && cRate2 > 0.25) {
      // Início do 2ºT com ritmo explosivo — threshold alto para evitar FP
      add("Início do 2ºT explosivo — corners acumulados", `${(cRate2*10).toFixed(1)}/10min`, "medium", 0.09);
    } else if (min >= 52 && cRate2 > 0.22) {
      add("Ritmo alto de escanteios no início do 2ºT", `${(cRate2*10).toFixed(1)}/10min`, "medium", 0.09);
    } else if (min >= 52 && cRate2 > 0.16) {
      add("Ritmo moderado de escanteios",              `${(cRate2*10).toFixed(1)}/10min`, "low",    0.05);
    } else if (min >= 52 && cRate2 > 0.13 && crossMissing2) {
      add("Taxa de escanteios elevada (liga sem cruzamentos)", `${(cRate2*10).toFixed(1)}/10min`, "medium", 0.09);
    } else if (min >= 52 && cRate2 > 0.10 && crossMissing2) {
      add("Ritmo de escanteios acima do normal",        `${(cRate2*10).toFixed(1)}/10min`, "low",    0.05);
    }
  } else if (!phase2A) {
    const cThresh = phase2B ? 0.18 : 0.22;
    if (cRate2 > cThresh + 0.06) {
      add("Ritmo alto de escanteios",            `${(cRate2*10).toFixed(1)}/10min`, "high",   0.14);
    } else if (cRate2 > cThresh) {
      add("Ritmo moderado de escanteios",        `${(cRate2*10).toFixed(1)}/10min`, "medium", 0.07);
    } else if (cRate2 > cThresh - 0.04 && crossMissing2) {
      // FIX B: proxy para fases 2B/2C em ligas sem crosses
      add("Taxa de escanteios relevante (liga sem cruzamentos)", `${(cRate2*10).toFixed(1)}/10min`, "medium", 0.07);
    }
  }

  return { mult: clamp(mult, 1.0, MAX_MULT_LATE), factors };
}

// ── Fast Track: padrão de alta convicção precoce ──────────────────────────────
// Condição original: crossRate alto + bloqueados (ligas com crosses)
// Condição nova: corners acumulados + ritmo alto (ligas sem crosses)
function checkFastTrack(crossRate, blocked, minute, totalCorners, cornerRate, crossMissing) {
  if (minute > 25) return false;

  // Condição 1 (original): explosão de cruzamentos + bloqueados
  if (crossRate > 0.42 && blocked >= 3) return true;

  // Condição 2 (nova): para ligas sem crosses — ritmo de corners muito alto
  // Exige ≥4 corners E ritmo >0.19/min E pelo menos 1 fator confirmador (blocked ou saves)
  if (crossMissing && totalCorners >= 4 && cornerRate > 0.19 && (blocked >= 2)) return true;

  return false;
}

// ── ANÁLISE ESPECIAL: FAIXA 80-FIM ───────────────────────────────────────────
// A casa só disponibiliza OVER 1.5 corners nesta faixa (não existe Over 0.5).
//
// Over 1.5 exige λ ≥ 2.5 para ser viável (>70% de probabilidade).
// Isso é ~2.5x mais difícil que Over 0.5 — exige condições específicas.
//
// Thresholds de viabilidade (Poisson):
//   λ=1.5 → P(≥2) = 44%  → EVITAR
//   λ=2.0 → P(≥2) = 59%  → MARGINAL
//   λ=2.5 → P(≥2) = 71%  → VIÁVEL
//   λ=3.0 → P(≥2) = 80%  → BOM
//   λ=3.5 → P(≥2) = 86%  → MUITO BOM
//
// Condições que justificam Over 1.5 em 80-FIM:
//   1. Time perdendo (pressão máxima)
//   2. Cruzamentos altos (>0.22/min)
//   3. Jogo já gerou muitos corners (taxa > 0.17/min)
//   4. Acréscimos elevados (muito tempo extra disponível)
export function analyzeFinalWindow(game) {
  const min = game.minute;
  if (min < 78) return null; // Só ativa na aproximação da faixa 80-FIM

  const H = analyzeSide(buildSide(game, "home"), min);
  const A = analyzeSide(buildSide(game, "away"), min);

  const totalCorners = H.corners + A.corners;
  const baseRate     = rate(totalCorners, min);
  const crossRate    = H.crossRate + A.crossRate;
  const blocked      = H.blocked + A.blocked;
  const saves        = H.saves + A.saves;
  const scoreDiff    = Math.abs(game.score.home - game.score.away);
  const totalGoals   = game.score.home + game.score.away;
  const totalYellows = (game.yellowCards?.home ?? 0) + (game.yellowCards?.away ?? 0);

  const gameIsSettled = scoreDiff >= 2;  // líder gerencia o jogo
  const losingByOne   = scoreDiff === 1; // time perdendo por 1
  const itsATie       = scoreDiff === 0; // empate — ambos atacam

  // ── 1. Estimativa de acréscimos ──────────────────────────────────────────
  // Over 1.5 se beneficia MUITO de mais tempo — cada minuto extra importa
  // Base 3min + eventos que causam paralisação
  const estimatedStoppage = clamp(3 + (totalGoals * 0.5) + (totalYellows * 0.3), 2, 7);
  const minsFrom90        = Math.max(0, 90 - min);
  const effectiveMins     = minsFrom90 + estimatedStoppage;

  // ── 2. Multiplicador de pressão final (calibrado para Over 1.5) ──────────
  // Over 1.5 precisa de pressão sustentada — não basta pressão esporádica
  let finalMult = 1.0;
  const reasons = [];

  // FATOR CRÍTICO 1: Estado do placar
  if (losingByOne) {
    finalMult += 0.45; // Pressão máxima — time perde por 1
    reasons.push({ text: `Time perdendo por 1 (${game.score.home}-${game.score.away}) — pressão máxima e sustentada`, color: "#00e5a0", strong: true });
  } else if (itsATie) {
    finalMult += 0.25;
    reasons.push({ text: `Empate — ambos buscam gol, ambos criam corners`, color: "#00e5a0", strong: true });
  } else if (gameIsSettled) {
    finalMult -= 0.40; // Jogo definido reduz muito a probabilidade
    reasons.push({ text: `Jogo definido ${game.score.home}-${game.score.away} — time líder gerencia, poucos corners`, color: "#ff4560", strong: true });
  }

  // FATOR CRÍTICO 2: Cruzamentos (preditor direto de corners)
  // Se a liga não reporta cruzamentos, usa corners e shots inside box como proxy
  const crossMissing = isCrossDataMissing(game, H, A);
  if (crossMissing) {
    // Dado ausente: usa taxa de corners e shots inside box como substituto
    const sibTotal = safe(game.shotsInsideBox?.home) + safe(game.shotsInsideBox?.away);
    const sibRate  = min > 0 ? sibTotal / min : 0;
    if (sibRate > 0.15 || baseRate > 0.15) {
      finalMult += 0.10;
      reasons.push({ text: "Pressão na área confirmada (cruzamentos não reportados pela liga)", color: "#f0c040", strong: false });
    } else {
      reasons.push({ text: "Dado de cruzamentos não disponível para esta liga", color: "#3d4f6b", strong: false });
    }
  } else if (crossRate > 0.28) {
    finalMult += 0.25;
    reasons.push({ text: `Cruzamentos muito frequentes (${(crossRate*10).toFixed(1)}/10min) — geração constante de corners`, color: "#00e5a0", strong: true });
  } else if (crossRate > 0.18) {
    finalMult += 0.14;
    reasons.push({ text: `Cruzamentos ativos (${(crossRate*10).toFixed(1)}/10min)`, color: "#00e5a0", strong: false });
  } else if (crossRate > 0.10) {
    finalMult += 0.05;
    reasons.push({ text: `Cruzamentos moderados (${(crossRate*10).toFixed(1)}/10min)`, color: "#f0c040", strong: false });
  } else {
    finalMult -= 0.20;
    reasons.push({ text: `Cruzamentos baixos (${(crossRate*10).toFixed(1)}/10min) — poucos corners esperados`, color: "#ff4560", strong: false });
  }

  // FATOR CRÍTICO 3: Taxa histórica de corners no jogo
  // Para Over 1.5 funcionar, o jogo já deve ter estabelecido um ritmo alto
  if (baseRate > 0.20) {
    finalMult += 0.20;
    reasons.push({ text: `Ritmo alto de corners no jogo (${(baseRate*10).toFixed(1)}/10min) — padrão continuará`, color: "#00e5a0", strong: true });
  } else if (baseRate > 0.15) {
    finalMult += 0.12;
    reasons.push({ text: `Ritmo moderado de corners (${(baseRate*10).toFixed(1)}/10min)`, color: "#f0c040", strong: false });
  } else if (baseRate > 0.10) {
    finalMult += 0.04;
    reasons.push({ text: `Ritmo baixo de corners (${(baseRate*10).toFixed(1)}/10min) — dificulta Over 1.5`, color: "#f0c040", strong: false });
  } else {
    finalMult -= 0.18;
    reasons.push({ text: `Jogo com poucos corners (${totalCorners} no total) — Over 1.5 improvável`, color: "#ff4560", strong: true });
  }

  // FATOR 4: Goleiros exigidos (pressão real)
  if (saves >= 5) {
    finalMult += 0.14;
    reasons.push({ text: `Goleiros muito exigidos (${saves} defesas) — ataque dominante`, color: "#00e5a0", strong: false });
  } else if (saves >= 3) {
    finalMult += 0.08;
    reasons.push({ text: `Goleiros ativos (${saves} defesas)`, color: "#f0c040", strong: false });
  }

  // FATOR 5: Chutes bloqueados
  if (blocked >= 5) {
    finalMult += 0.12;
    reasons.push({ text: `Muitos chutes bloqueados (${blocked}) — bola parando na área`, color: "#00e5a0", strong: false });
  } else if (blocked >= 3) {
    finalMult += 0.06;
    reasons.push({ text: `Chutes bloqueados (${blocked})`, color: "#f0c040", strong: false });
  }

  // FATOR 6: Melhoria 5 — Se 2ºT inteiro foi abaixo da média = ritmo não vai mudar
  // Um jogo que chegou ao 80' com poucos corners dificilmente explode no final
  const leagueExpRate = getLeagueAvg(game.leagueAfId, false);
  if (baseRate < leagueExpRate * 0.45 && !losingByOne && !itsATie) {
    finalMult -= 0.15;
    reasons.push({ text: `Jogo consistentemente abaixo da média de corners da liga`, color: "#ff4560", strong: false });
  } else if (baseRate > leagueExpRate * 1.5) {
    finalMult += 0.08;
    reasons.push({ text: `Jogo acima da média da liga (${(baseRate/leagueExpRate).toFixed(1)}×) — padrão tende a continuar`, color: "#00e5a0", strong: false });
  }

  // FATOR 7: Acréscimos elevados = mais tempo para 2 corners acontecerem
  if (estimatedStoppage >= 5) {
    finalMult += 0.10;
    reasons.push({ text: `Acréscimos elevados estimados (~${estimatedStoppage}min) — mais tempo disponível`, color: "#00e5a0", strong: false });
  } else if (estimatedStoppage >= 4) {
    finalMult += 0.05;
    reasons.push({ text: `Acréscimos moderados (~${estimatedStoppage}min)`, color: "#f0c040", strong: false });
  }

  // ── 3. Poisson — foco em Over 1.5 ────────────────────────────────────────
  // Taxa final: base × mult × 1.3 (ritmo sobe no final)
  // Cap conservador: 0.40/min (realismo — 4 corners em 10min é o máximo usual)
  const finalRate   = clamp(baseRate * clamp(finalMult, 0.4, 2.0) * 1.3, 0.03, 0.40);
  const lambda      = finalRate * effectiveMins;

  // P(X ≥ 1) = 1 - e^(-λ)
  // P(X ≥ 2) = 1 - e^(-λ) - λ*e^(-λ)  ← ESTE É O NOSSO ALVO (Over 1.5)
  const probOver05  = 1 - Math.exp(-lambda);
  const probOver15  = Math.max(0, 1 - Math.exp(-lambda) - lambda * Math.exp(-lambda));
  const projCorners = +lambda.toFixed(1);

  // ── 4. Veredito focado em Over 1.5 ───────────────────────────────────────
  // Thresholds calibrados pela dificuldade real do mercado
  let verdict, verdictColor, verdictIcon, verdictDetail;

  if (gameIsSettled && crossRate < 0.12) {
    verdict       = "EVITAR — Over 1.5";
    verdictDetail = "Jogo gerenciado. Time líder vai atrasar, não criar corners.";
    verdictColor  = "#ff4560";
    verdictIcon   = "❌";
  } else if (probOver15 >= 0.80) {
    verdict       = "MUITO BOM — Over 1.5";
    verdictDetail = "Alta probabilidade. Condições ideais para 2+ corners.";
    verdictColor  = "#00e5a0";
    verdictIcon   = "✅";
  } else if (probOver15 >= 0.70) {
    verdict       = "VIÁVEL — Over 1.5";
    verdictDetail = "Probabilidade favorável. Pressão sustentada confirma.";
    verdictColor  = "#00e5a0";
    verdictIcon   = "✅";
  } else if (probOver15 >= 0.58) {
    verdict       = "MARGINAL — Avaliar com cuidado";
    verdictDetail = "Probabilidade próxima do equilíbrio. Só entra se pressão clara.";
    verdictColor  = "#f0c040";
    verdictIcon   = "⚠️";
  } else {
    verdict       = "EVITAR — Over 1.5";
    verdictDetail = "Probabilidade insuficiente para justificar o risco.";
    verdictColor  = "#ff4560";
    verdictIcon   = "❌";
  }

  // ── 5. Contexto adicional: o que falta para Over 1.5 ser viável ──────────
  let missingFor15 = null;
  if (probOver15 < 0.70) {
    const neededLambda = 2.5; // λ necessário para 71%
    const neededRate   = neededLambda / effectiveMins;
    const gapRate      = neededRate - finalRate;
    if (gapRate > 0.03) {
      missingFor15 = `Faltam ~${(gapRate * effectiveMins).toFixed(1)} corners para atingir viabilidade`;
    }
  }

  return {
    isActive:          true,
    effectiveMins:     +effectiveMins.toFixed(0),
    estimatedStoppage: +estimatedStoppage.toFixed(0),
    lambda:            +lambda.toFixed(2),
    probOver05:        Math.round(probOver05 * 100),
    probOver15:        Math.round(probOver15 * 100),
    projCorners,
    finalRate:         +finalRate.toFixed(3),
    finalMult:         +clamp(finalMult, 0.4, 2.0).toFixed(2),
    reasons,
    verdict,
    verdictDetail,
    verdictColor,
    verdictIcon,
    gameIsSettled,
    losingByOne,
    itsATie,
    missingFor15,
    totalCorners,
  };
}

// ── Janela de entrada ─────────────────────────────────────────────────────────
function calcEntryWindow(minute, targetBetWindow) {
  const isTooLate = minute > BLOCK_ALERTS;

  if (isTooLate) {
    return { minsLeft: 0, label: "Tarde demais para entrar", urgency: "blocked", isTooLate: true };
  }

  // Se está apontando para a PRÓXIMA faixa, mostra tempo até ela começar
  if (targetBetWindow?.isNext) {
    const minsTo = targetBetWindow.minsToWindowStart;
    if (minsTo <= 1) {
      return { minsLeft: minsTo, label: `Faixa ${targetBetWindow.label} abre em ~${minsTo}min`, urgency: "danger",  isTooLate: false };
    }
    if (minsTo <= 3) {
      return { minsLeft: minsTo, label: `Entrar em ~${minsTo}min — faixa ${targetBetWindow.label}`, urgency: "warning", isTooLate: false };
    }
    return { minsLeft: minsTo, label: `~${minsTo}min para faixa ${targetBetWindow.label}`, urgency: "good", isTooLate: false };
  }

  // Se está na faixa ativa, mostra tempo restante nela
  const minsLeftInWindow = targetBetWindow?.minsLeftInWindow ?? Math.max(0, 90 - minute);
  if (minsLeftInWindow <= 2) {
    return { minsLeft: minsLeftInWindow, label: `${minsLeftInWindow}min restantes na faixa`, urgency: "danger",  isTooLate: false };
  }
  if (minsLeftInWindow <= 5) {
    return { minsLeft: minsLeftInWindow, label: `${minsLeftInWindow}min restantes — entrar agora`, urgency: "warning", isTooLate: false };
  }
  return { minsLeft: minsLeftInWindow, label: `${minsLeftInWindow}min na faixa atual`, urgency: "good", isTooLate: false };
}

// ── Indicador de possível gol ────────────────────────────────────────────────
// Ativa quando confiança ≥ 70% + contexto de pressão ofensiva específico
// Retorna null ou objeto com label e intensidade
export function calcGoalPressureSignal(game, prediction) {
  if (!prediction || prediction.confidence < 70) return null;
  if (!game.hasStats) return null;

  const min       = game.minute;
  const isEarly   = min < 45;
  const scoreDiff = Math.abs((game.score?.home ?? 0) - (game.score?.away ?? 0));
  const onTarget  = (game.onTarget?.home ?? 0) + (game.onTarget?.away ?? 0);
  const sibTotal  = (game.shotsInsideBox?.home ?? 0) + (game.shotsInsideBox?.away ?? 0);
  const blocked   = (game.blockedShots?.home ?? 0) + (game.blockedShots?.away ?? 0);
  const goals     = (game.score?.home ?? 0) + (game.score?.away ?? 0);

  // Contextos que combinam pressão de corner com alta probabilidade de gol:

  // 1. Chutes no alvo altos sem gol → frustração acumulada
  const highOnTarget   = onTarget >= (isEarly ? 5 : 6);
  const lowGoals       = goals <= 1;

  // 2. SIB alto → bola chegando perto
  const sibRate        = min > 0 ? sibTotal / min : 0;
  const highSIB        = sibRate > 0.18;

  // 3. Time perdendo com pressão máxima (≥65')
  const losingLate     = !isEarly && scoreDiff >= 1 && min >= 65;

  // 4. Mult alto → pressão sustentada real
  const highMult       = prediction.pressureMult >= 1.35;

  // Precisa de ao menos 2 condições para disparar
  let conditions = 0;
  if (highOnTarget && lowGoals) conditions++;
  if (highSIB)                  conditions++;
  if (losingLate)               conditions++;
  if (highMult)                 conditions++;
  if (blocked >= 5)             conditions++;

  if (conditions < 2) return null;

  // Intensidade baseada no número de condições
  if (conditions >= 4) return {
    label: "⚽ Pressão extrema — alta probabilidade de gol",
    intensity: "high",
    color: "#ff4560",
  };
  if (conditions >= 3) return {
    label: "⚽ Alta pressão — possível gol próximos 10min",
    intensity: "medium",
    color: "#f0c040",
  };
  return {
    label: "⚽ Pressão ofensiva — fique atento ao gol",
    intensity: "low",
    color: "#f0c04088",
  };
}

// ── Projeção principal ────────────────────────────────────────────────────────
export function projectCorners(game) {
  const min     = Math.max(2, game.minute);
  const isEarly = min < LATE_START;

  // Quando AF não tem stats para este jogo (liga não reporta), não usar zeros
  // como dados reais — tratar como jogo sem dados estatísticos
  const hasStats = game.hasStats !== false; // true por default para compatibilidade

  const H = analyzeSide(buildSide(game, "home"), min);
  const A = analyzeSide(buildSide(game, "away"), min);

  const totalCorners = H.corners + A.corners;
  // baseRate: usa corners totais / minutos totais
  // No 2ºT fase 2A, o halftime reset é tratado pela penalidade de evidência
  // (não estimamos corners do 2ºT porque a estimativa pode ser catastroficamente errada)
  const baseRate = rate(totalCorners, min);

  // ── leagueAvg: histórico do time → tabela por liga → genérico ──────────
  const historicalAvg = calcHistoricalLeagueAvg(game, isEarly);
  const leagueAvg = historicalAvg
    ? historicalAvg
    : getLeagueAvg(game.leagueAfId, isEarly);

  // Flag de qualidade da projeção
  const hasHistoricalData = !!historicalAvg;

  // Sem stats reais: usa só leagueAvg, mult fixo em 1.0, confiança baixa
  if (!hasStats) {
    const projected10 = clamp(leagueAvg * 10, 0.2, 2.0);
    const totalCornersGame = (game.corners?.home ?? 0) + (game.corners?.away ?? 0);
    const minsLeft = clamp(90 - min, 0, 90);
    const projGame = clamp(totalCornersGame + leagueAvg * minsLeft, totalCornersGame, 15);
    const targetBetWindow = getTargetBetWindow(min);
    const entryWindow = calcEntryWindow(min, targetBetWindow);
    const subPhase = isEarly
      ? (min < 28 ? "1A" : min < 38 ? "1B" : "1C")
      : (min < 56 ? "2A" : min < 66 ? "2B" : "2C");
    return {
      projected10: +projected10.toFixed(1),
      pressureMult: 1.0,
      confidence: 5,
      signal: "WEAK",
      factors: [{ text: "Estatísticas não disponíveis para esta liga", detail: "", impact: "low" }],
      market: {
        betRange: "Dados insuficientes para análise",
        gameRange: `${Math.floor(projGame)}-${Math.ceil(projGame)} escanteios no jogo`,
        projGame: +projGame.toFixed(1),
      },
      totalCorners: totalCornersGame,
      entryWindow,
      targetBetWindow,
      isEarly,
      isFastTrack: false,
      isPostGoalCooldown: false,
      subPhase,
      phase: isEarly ? "1ºT" : "2ºT",
      pesoReal: 0,
      hasHistoricalData,
      leagueAvgUsed: +leagueAvg.toFixed(4),
      oddsBoost: 1.0,
      afEnriched: false,
    };
  }

  const pressureResult = isEarly
    ? calcEarlyPressure(H, A, game)
    : calcLatePressure(H, A, game);
  const { mult: baseMult, factors } = pressureResult;

  // ── Fatores extras da API-Football ──────────────────────────────────────
  let mult = baseMult;

  // 1. Shots Inside Box (com proporção inside/total)
  const sibFactor = calcInsideBoxFactor(game, min, isEarly);
  if (sibFactor.delta !== 0 && sibFactor.label) {
    mult += sibFactor.delta;
    factors.push({ text: sibFactor.label, detail: "", impact: sibFactor.impact || "medium" });
  }

  // 2. Dangerous Attacks reais com assimetria
  const daFactor = calcRealDAFactor(game, min);
  if (daFactor.delta !== 0 && daFactor.label) {
    mult += daFactor.delta;
    factors.push({ text: daFactor.label, detail: "", impact: daFactor.impact || "medium" });
  }

  // 3. Formação tática
  const formFactor = calcFormationFactor(game);
  if (formFactor.delta !== 0 && formFactor.label) {
    mult += formFactor.delta;
    factors.push({ text: formFactor.label, detail: "", impact: formFactor.delta > 0.05 ? "medium" : "low" });
  }

  // 4. Substituições ofensivas (2ºT)
  if (!isEarly) {
    const subFactor = calcSubstitutionFactor(game, min);
    const subDelta = Math.min(subFactor.deltaH + subFactor.deltaA, 0.25);
    if (subDelta > 0) {
      mult += subDelta;
      subFactor.labels.forEach(l => factors.push({ text: l, detail: "", impact: "high" }));
    }
  }

  // 5. NOVO: Cartão vermelho — muda a dinâmica completamente
  const redFactor = calcRedCardFactor(game);
  if (redFactor.delta !== 0 && redFactor.label) {
    mult += redFactor.delta;
    factors.push({ text: redFactor.label, detail: "", impact: redFactor.impact });
  }

  // 6. Offsides — linhas ofensivas avançadas
  const offFactor = calcOffsidesFactor(game, min);
  if (offFactor.delta !== 0 && offFactor.label) {
    mult += offFactor.delta;
    factors.push({ text: offFactor.label, detail: "", impact: "low" });
  }

  // 7. Melhoria 1: Assimetria direcional (time perdedor dominando crosses/SIB)
  const dirFactor = calcDirectionalPressure(game, H, A, min);
  if (dirFactor.delta !== 0 && dirFactor.label) {
    mult += dirFactor.delta;
    factors.push({ text: dirFactor.label, detail: "", impact: dirFactor.impact || "medium" });
  }

  // 8. Melhoria 3: Momentum — ritmo atual vs média histórica da liga
  // Passa flag cross_missing para calibrar threshold (Fix C)
  const _crossMissingForMomentum = isCrossDataMissing(game, H, A);
  const momentumFactor = calcCornerMomentum(
    game.leagueAfId, baseRate, isEarly,
    { _crossMissing: _crossMissingForMomentum }
  );
  if (momentumFactor.delta !== 0 && momentumFactor.label) {
    mult += momentumFactor.delta;
    factors.push({ text: momentumFactor.label, detail: "", impact: momentumFactor.impact || "medium" });
  }

  // Aplica caps
  const maxMult = isEarly ? MAX_MULT_EARLY : MAX_MULT_LATE;
  mult = clamp(mult, 1.0, maxMult);

  // ── Peso dinâmico na projeção ─────────────────────────────────────────
  const pesoReal     = clamp(0.30 + (mult - 1.0) * 0.45, 0.30, 0.70);
  const adjustedRate = (leagueAvg * mult * (1 - pesoReal)) + (baseRate * mult * pesoReal);
  const projected10  = clamp(adjustedRate * 10, 0.2, 3.0);
  const minsLeft_    = clamp(90 - min, 0, 90);
  const projGame     = clamp(totalCorners + (adjustedRate * minsLeft_), totalCorners, 20);

  const market = suggestMarket(projected10, totalCorners, projGame);

  const crossRateCombined = H.crossRate + A.crossRate;
  const blockedTotal      = H.blocked + A.blocked;
  const totalCornersEarly = H.corners + A.corners;
  const cornerRateEarly   = rate(totalCornersEarly, min);
  const crossMissingEarly = isCrossDataMissing(game, H, A);
  const isFastTrack       = isEarly && checkFastTrack(crossRateCombined, blockedTotal, min, totalCornersEarly, cornerRateEarly, crossMissingEarly);
  const isPostGoalCooldown = isEarly && detectPostGoalCooldown(game, H, A);

  // ── Confiança com validação de odds ──────────────────────────────────
  let confidence = calcConfidence(projected10, factors, mult, game, baseRate, isEarly, isFastTrack, isPostGoalCooldown);

  // Boost/redução baseado em odds ao vivo (API-Football)
  const oddsBoost = calcOddsBoost(game);
  if (oddsBoost !== 1.0) {
    confidence = Math.round(clamp(confidence * oddsBoost, 5, 97));
  }

  const strongThresh = isEarly ? STRONG_EARLY : STRONG_LATE;
  const signal = confidence >= strongThresh   ? "STRONG"   :
                 confidence >= MODERATE_THRESH ? "MODERATE" : "WEAK";

  const targetBetWindow = getTargetBetWindow(min);
  const entryWindow     = calcEntryWindow(min, targetBetWindow);

  let subPhase;
  if (isEarly) {
    subPhase = min < 10 ? "P0" : min < 20 ? "P1" : min < 30 ? "P2" : min < 38 ? "P3" : "P4";
  } else {
    // Sub-fases alinhadas: termina 4min antes da virada (quando já aponta para próxima)
    subPhase = min < 56 ? "2A" : min < 66 ? "2B" : "2C";
  }

  return {
    projected10:       +projected10.toFixed(1),
    pressureMult:      +mult.toFixed(2),
    confidence,
    signal,
    factors,
    market,
    totalCorners,
    entryWindow,
    targetBetWindow,
    isEarly,
    isFastTrack,
    isPostGoalCooldown,
    subPhase,
    phase: isEarly ? "1ºT" : "2ºT",
    pesoReal:          +pesoReal.toFixed(2),
    // Meta
    hasHistoricalData,
    leagueAvgUsed:     +leagueAvg.toFixed(4),
    oddsBoost:         +oddsBoost.toFixed(2),
    afEnriched:        !!(game.afFixtureId && game.hasStats),
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
    projGame:  +projGame.toFixed(1),
  };
}

// ── Confiança ─────────────────────────────────────────────────────────────────
function calcConfidence(proj10, factors, mult, game, baseRate, isEarly, isFastTrack, isPostGoalCooldown) {
  let conf = clamp((proj10 / 3.0) * 40, 0, 40);

  const high = factors.filter(f => f.impact === "high").length;
  const med  = factors.filter(f => f.impact === "medium").length;
  conf += clamp(high * 7 + med * 3, 0, 30);

  if (baseRate > 0.20)      conf += 15;
  else if (baseRate > 0.14) conf += 8;
  else if (baseRate > 0.10) conf += 4;

  if (mult >= 1.30)         conf += 10;
  else if (mult >= 1.15)    conf += 5;

  if (isEarly) {
    // ── Penalidade baseada em evidência concreta ──────────────────────────
    // Filosofia: corners, bloqueados e chutes no alvo são FATOS, não previsões.
    // Quanto mais evidências reais existem, menos precisamos descontar a confiança.
    //
    // Score de evidência (0-10 pontos):
    //   Corner (aconteceu)      = +2.0 pts  ← dado consumado, peso máximo
    //   Chute bloqueado         = +1.5 pts  ← pressão real na área
    //   Chute no alvo           = +1.0 pts  ← intenção executada
    //
    // Cada ponto de evidência sobe a penalidade final em +2.5%
    // (max +25% com 10 pontos de evidência)
    const totalCornersC  = safe(game.corners?.home)     + safe(game.corners?.away);
    const totalBlockedC  = safe(game.blockedShots?.home) + safe(game.blockedShots?.away);
    const totalOnTargetC = safe(game.onTarget?.home)    + safe(game.onTarget?.away);

    // ── Bônus de ratio: quanto o jogo está acima da média da liga ──────────
    // ratio = corners_por_min / média_da_liga
    // Um jogo 3× acima da média já é excepcional — reduz penalidade agressivamente
    const leagueAvgForPenalty = getLeagueAvg(game.leagueAfId, true);
    const cornerRateNow       = totalCornersC > 0 && game.minute > 1
      ? totalCornersC / game.minute : 0;
    const cornerRatio = leagueAvgForPenalty > 0
      ? cornerRateNow / leagueAvgForPenalty : 0;
    const ratioBonus  = cornerRatio >= 3.0 ? 5
                      : cornerRatio >= 2.5 ? 3
                      : cornerRatio >= 2.0 ? 2
                      : 0;

    const evidenceScore = Math.min(10,
      totalCornersC  * 2.0 +
      totalBlockedC  * 1.5 +
      totalOnTargetC * 1.0 +
      ratioBonus               // bônus por ritmo excepcional
    );
    const evidenceBoost = evidenceScore * 0.035; // 0.025→0.035: mais sensível

    // Penalidade base por fase — reduzida para capturar janelas iniciais do 1ºT
    let basePenalty;
    if      (game.minute < 10) basePenalty = 0.45; // P0: muito cedo
    else if (game.minute < 20) basePenalty = 0.58; // P1: reduzida (era 0.65)
    else if (game.minute < 30) basePenalty = 0.72; // P2: reduzida (era 0.78)
    else if (game.minute < 38) basePenalty = 0.86; // P3
    else                       basePenalty = 0.94; // P4

    // Fator dinâmico do mult (pressão confirmada reduz penalidade extra)
    const multFactor = 1 / (1 + (mult - 1) * 2);
    // Com evidence máxima (10/10) em P4 (>=38min): sem penalidade significativa
    const rawPenalty = basePenalty + evidenceBoost + (1 - basePenalty) * (1 - multFactor);
    const finalPenalty = Math.min(0.98, rawPenalty);
    conf *= finalPenalty;

    const totalCrosses = safe(game.crosses?.home) + safe(game.crosses?.away);
    // Só aplica penalidade de "sem cruzamentos" se o dado realmente existe
    // (liga pode não reportar cruzamentos via AF)
    const H2 = analyzeSide(buildSide(game, "home"), Math.max(2, game.minute));
    const A2 = analyzeSide(buildSide(game, "away"), Math.max(2, game.minute));
    if (totalCrosses === 0 && game.minute > 20 && !isCrossDataMissing(game, H2, A2)) conf *= 0.65;
    if (isPostGoalCooldown)  conf *= 0.60;
    if (isFastTrack)         conf = Math.max(conf, 72);

  } else {
    // 2ºT: penalidade suave se taxa base muito baixa
    if (baseRate < 0.06 && game.minute > 55) conf *= 0.72;

    // Fase 2A (45-57'): penalidade com "halftime reset"
    // FILOSOFIA: no intervalo, times se reorganizam. Corners do 1ºT NÃO garantem
    // que o 2ºT continuará no mesmo ritmo — especialmente porque times trocam
    // de lado, o time que sofria pressão pode ter feito ajustes táticos.
    //
    // Evidence no 2A usa peso REDUZIDO para corners (eram do 1ºT em sua maioria)
    // e peso NORMAL para bloqueados e no alvo (mais recentes e relevantes)
    if (game.minute < 58) {
      const totalCornersLate  = safe(game.corners?.home)      + safe(game.corners?.away);
      const totalBlockedLate  = safe(game.blockedShots?.home) + safe(game.blockedShots?.away);
      const totalOnTargetLate = safe(game.onTarget?.home)     + safe(game.onTarget?.away);

      // Corners com peso reduzido: 1.0 em vez de 2.0 no início do 2T
      // Aumenta para 1.4 depois de 52' quando 2T já está rodando
      const cornerW = game.minute < 52 ? 1.0 : 1.4;
      const evidenceLate = Math.min(10,
        totalCornersLate  * cornerW +
        totalBlockedLate  * 1.5 +
        totalOnTargetLate * 1.0
      );
      const evBoostLate = evidenceLate * 0.018; // mais conservador

      // Penalidade base mantida — evidência reduz levemente
      const basePenLate = game.minute < 52 ? 0.90 : 0.93;
      const mfLate = 1 / (1 + (mult - 1) * 2);
      const finalPenLate = Math.min(0.96,
        basePenLate + evBoostLate + (1 - basePenLate) * (1 - mfLate)
      );
      conf *= finalPenLate;
    }

    // Gol recente no 2ºT — penalidade contextual:
    //   Gol do time GANHANDO → jogo esfria → ×0.75 (reorganização real)
    //   Gol do time PERDENDO mas ainda atrás → pressão mantém → ×0.95
    //   Gol que EMPATOU → momento de incerteza → ×0.82
    const recentGoal = detectRecentGoal(game);
    if (recentGoal) {
      if (recentGoal.scoredIsLosingTeam && recentGoal.diff >= 1) {
        conf *= 0.95; // time marcou mas ainda perde — pressão não cai
      } else if (recentGoal.diff === 0) {
        conf *= 0.82; // empatou — momento de reorganização mútua
      } else {
        conf *= 0.75; // time ganhando marcou — jogo esfria
      }
    }

    // Melhoria 4: jogo claramente gerenciado no 2ºT
    // Vencendo por 2+ E taxa de corners abaixo de 50% da média da liga
    const scoreDiff = Math.abs(game.score.home - game.score.away);
    const leagueExpectedRate = getLeagueAvg(game.leagueAfId, false);
    if (scoreDiff >= 2 && baseRate < leagueExpectedRate * 0.50 && game.minute > 60) {
      conf *= 0.70; // jogo morto — time vencendo administra tempo
    }
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
    score:    { home:Math.floor(Math.random()*3), away:Math.floor(Math.random()*3) },
    minute:min, period:min>45?2:1, clock:`${min}'`,
    possession:     { home:pos,  away:100-pos },
    shots:          { home:2+Math.floor(Math.random()*9),  away:1+Math.floor(Math.random()*8) },
    onTarget:       { home:Math.floor(Math.random()*6),    away:Math.floor(Math.random()*5) },
    corners:        { home:Math.floor(Math.random()*7),    away:Math.floor(Math.random()*6) },
    fouls:          { home:3+Math.floor(Math.random()*8),  away:2+Math.floor(Math.random()*7) },
    saves:          { home:Math.floor(Math.random()*5),    away:Math.floor(Math.random()*4) },
    crosses:        { home:1+Math.floor(Math.random()*10), away:1+Math.floor(Math.random()*9) },
    offsides:       { home:Math.floor(Math.random()*5),    away:Math.floor(Math.random()*4) },
    blockedShots:   { home:Math.floor(Math.random()*5),    away:Math.floor(Math.random()*4) },
    clearances:     { home:Math.floor(Math.random()*14),   away:Math.floor(Math.random()*12) },
    longBalls:      { home:Math.floor(Math.random()*20),   away:Math.floor(Math.random()*18) },
    passes:         { home:80+Math.floor(Math.random()*200), away:60+Math.floor(Math.random()*180) },
    accuratePasses: { home:60+Math.floor(Math.random()*160), away:50+Math.floor(Math.random()*140) },
    dangerousAttacks:{ home:15+Math.floor(Math.random()*40), away:10+Math.floor(Math.random()*35) },
    isDemo:true,
  };
}
