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

const LATE_START      = 45;
const BLOCK_ALERTS    = 83;
const MAX_MULT_EARLY  = 1.40; // ligeiramente aumentado com dados AF mais precisos
const MAX_MULT_LATE   = 1.75;
const LEAGUE_AVG_EARLY = 0.090;
const LEAGUE_AVG_LATE  = 0.130;

const STRONG_LATE     = 62;
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
  // Ex: 66,67,68,69 → aponta para 70-79
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

// ── Calibração histórica do leagueAvg (API-Football) ─────────────────────────
// Usa médias REAIS de corners das últimas partidas de cada time
function calcHistoricalLeagueAvg(game, isEarly) {
  const h = game.historical;
  if (!h) return null;

  // Prioridade 1: médias reais de corners coletadas via getTeamCornerHistory
  // homeAvgRaw = média de corners do time da casa nas últimas 8 partidas
  // awayAvgRaw = média de corners do time de fora nas últimas 8 partidas
  const homeRaw = h.homeAvgRaw;
  const awayRaw = h.awayAvgRaw;

  let expected = null;

  if (homeRaw && awayRaw) {
    // Melhor cenário: temos corners reais de ambos
    // Casa gera ~10% mais corners jogando em casa
    const homeExpected = homeRaw * 1.10;
    const awayExpected = awayRaw * 0.92;
    expected = homeExpected + awayExpected;
  } else if (homeRaw) {
    expected = homeRaw * 1.10 + 5.0; // complementa com média genérica do adversário
  } else if (awayRaw) {
    expected = 5.5 + awayRaw * 0.92;
  }

  // Prioridade 2: fallback — estimativa via H2H (gols como proxy)
  if (!expected && h.h2hEstCorners && h.h2hGames >= 3) {
    expected = h.h2hEstCorners;
  }

  if (!expected) return null;

  // Limita para faixa realista: 4-18 corners/jogo
  expected = clamp(expected, 4, 18);

  // Converte para corners/min por tempo
  return isEarly
    ? (expected * 0.44) / 45  // 44% dos corners no 1ºT
    : (expected * 0.56) / 45; // 56% no 2ºT
}

// ── Validação pelas odds ao vivo ───────────────────────────────────────────────
// Se casas estão com odds baixas (favoráveis), é sinal que também veem pressão
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

// ── Fator Shots Inside Box (API-Football) ──────────────────────────────────────
// Chute dentro da área é MUITO mais preditivo de corner do que chute total
function calcInsideBoxFactor(game, min, isEarly) {
  const sib = game.shotsInsideBox;
  if (!sib) return { delta: 0, label: null };

  const total = safe(sib.home) + safe(sib.away);
  const sibRate = rate(total, min);

  // ~1 chute/3min dentro da área é considerado alto
  if (sibRate > 0.22)     return { delta: 0.18, label: `Pressão concentrada na área (${total} chutes inside)`, impact: "high" };
  if (sibRate > 0.15)     return { delta: 0.10, label: `Chutes na área frequentes (${total})`, impact: "medium" };
  if (sibRate > 0.08)     return { delta: 0.05, label: `Chutes na área moderados (${total})`, impact: "low" };
  return { delta: 0, label: null };
}

// ── Fator Dangerous Attacks REAL ───────────────────────────────────────────────
function calcRealDAFactor(game, min) {
  const da = game.dangerousAttacks;
  if (!da || !game.dangerousAttacksReal) return { delta: 0, label: null }; // só usa dado real AF

  const total = safe(da.home) + safe(da.away);
  const daRate = rate(total, min);

  // Escala: jogos europeus de alto nível têm ~5-8 DA/min
  if (daRate > 5.0) return { delta: 0.12, label: `Ataques perigosos muito altos (${total})`, impact: "high" };
  if (daRate > 3.5) return { delta: 0.07, label: `Ataques perigosos elevados (${total})`, impact: "medium" };
  if (daRate > 2.0) return { delta: 0.03, label: `Ataques perigosos moderados (${total})`, impact: "low" };
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
function detectPostGoalCooldown(game, H, A) {
  const goals = game.score.home + game.score.away;
  if (goals === 0) return false;
  const min = game.minute;
  const expectedShots   = min * 0.35;
  const expectedCrosses = min * 0.20;
  const totalShots   = H.shots   + A.shots;
  const totalCrosses = H.crosses + A.crosses;
  const lowActivity  = (totalShots < expectedShots * 0.6) && (totalCrosses < expectedCrosses * 0.6);
  return (min < 45 && Math.abs(game.score.home - game.score.away) >= 1 && lowActivity);
}

// ── MODO EARLY: 1º tempo — 3 sub-fases ───────────────────────────────────────
// Foco exclusivo em pressão SUSTENTADA (cornerRate REMOVIDO — causa falsos positivos)
function calcEarlyPressure(H, A, game) {
  let mult = 1.0;
  const factors = [];
  const add = (text, detail, impact, delta) => { mult += delta; factors.push({ text, detail, impact }); };
  const min = game.minute;

  // Sub-fases do 1ºT
  const phase1A = min < 28;   // 1-27': muito cedo, muito conservador
  const phase1B = min >= 28 && min < 38; // 28-37': alvo faixa 40-49
  const phase1C = min >= 38;  // 38-44': transição → intervalo

  // 1. Cruzamentos — melhor indicador precoce sustentado
  const crossRate = H.crossRate + A.crossRate;
  if (phase1A) {
    if (crossRate > 0.50)      add("Cruzamentos muito altos (início)",        `${(crossRate*10).toFixed(1)}/10min`, "high",   0.22);
    else if (crossRate > 0.35) add("Cruzamentos frequentes (início)",         `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.12);
    else if (crossRate > 0.22) add("Cruzamentos moderados",                   `${(crossRate*10).toFixed(1)}/10min`, "low",    0.06);
  } else {
    // Limiares progressivamente menores conforme avança no 1ºT
    const threshold = phase1B ? 0.38 : 0.30;
    if (crossRate > threshold + 0.10) add("Cruzamentos muito frequentes",     `${(crossRate*10).toFixed(1)}/10min`, "high",   0.22);
    else if (crossRate > threshold)   add("Cruzamentos frequentes",           `${(crossRate*10).toFixed(1)}/10min`, "medium", 0.13);
    else if (crossRate > threshold - 0.10) add("Cruzamentos moderados",      `${(crossRate*10).toFixed(1)}/10min`, "low",    0.06);
  }

  // 2. Chutes bloqueados — pressão real → corners latentes
  const blocked = H.blocked + A.blocked;
  if (blocked >= 5)            add("Muitos chutes bloqueados — corners latentes", `${blocked} bloqueios`, "high",   0.20);
  else if (blocked >= 3)       add("Chutes bloqueados — bola na área",            `${blocked} bloqueios`, "medium", 0.11);
  else if (blocked >= 2)       add("Bloqueios presentes",                          `${blocked} bloqueios`, "low",    0.05);

  // 3. Defesas do goleiro
  const saves = H.saves + A.saves;
  const savesThreshold = phase1A ? 5 : phase1B ? 4 : 3;
  if (saves >= savesThreshold + 1)  add("Goleiros muito exigidos",            `${saves} defesas`, "high",   0.17);
  else if (saves >= savesThreshold) add("Goleiros ativos",                    `${saves} defesas`, "medium", 0.10);
  else if (saves >= 2)              add("Pressão sobre goleiros",             `${saves} defesas`, "low",    0.04);

  // 4. Volume de chutes
  const shots = H.shots + A.shots;
  const shotsThresh = phase1A ? 14 : phase1B ? 12 : 10;
  if (shots >= shotsThresh)         add("Alto volume de chutes",              `${shots} chutes`, "medium", 0.11);
  else if (shots >= shotsThresh - 4) add("Volume moderado de chutes",        `${shots} chutes`, "low",    0.05);

  // 5. Pressão sem gol
  const onTgt = H.onTarget + A.onTarget;
  const goals = game.score.home + game.score.away;
  const onTgtThresh = phase1A ? 6 : 4;
  if (onTgt >= onTgtThresh && goals === 0)     add("Pressão sem gol — frustração",    `${onTgt} no alvo`, "high",   0.16);
  else if (onTgt >= onTgtThresh - 1 && goals === 0) add("Chutes no alvo sem conversão", `${onTgt} no alvo`, "medium", 0.09);

  // 6. Domínio territorial
  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 70)            add("Domínio territorial forte",              `${maxPoss.toFixed(0)}%`, "medium", 0.08);
  else if (maxPoss >= 63)       add("Controle territorial",                   `${maxPoss.toFixed(0)}%`, "low",    0.04);

  // 7. Placar desequilibrado (só relevante após dados suficientes)
  const diff = Math.abs(game.score.home - game.score.away);
  if (!phase1A && diff >= 1)    add("Time perdendo avança no 1ºT",           `${game.score.home}-${game.score.away}`, "medium", 0.09);

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
  // Importante: na fase2A, a taxa é calculada sobre todo o jogo (inclui 1ºT)
  // então usa limiares menores para compensar a diluição
  const crossRate = H.crossRate + A.crossRate;
  if (phase2A) {
    // Limiares reduzidos — stats diluídas pelo 1ºT ainda
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
  const onTgtThresh = phase2A ? 4 : phase2B ? 5 : 7;
  if (onTgt >= onTgtThresh && goals <= 1)     add("Pressão sem conversão — frustração", `${onTgt} no alvo, ${goals} gol(s)`, "high", 0.14);
  else if (onTgt >= onTgtThresh - 1 && goals === 0) add("Chutes no alvo sem gol",       `${onTgt} no alvo`,                  "medium", 0.08);

  // ── 6. Contexto de placar ───────────────────────────────────────────────────
  const diff = game.score.home - game.score.away;
  if (Math.abs(diff) >= 1) {
    if (min >= 65)             add("Time perdendo — pressão final",           `${min}' · ${game.score.home}-${game.score.away}`, "high",   0.16);
    else if (min >= 55)        add("Time em desvantagem avança",              `${min}' · ${game.score.home}-${game.score.away}`, "medium", 0.10);
    else                       add("Desequilíbrio no placar",                 `${game.score.home}-${game.score.away}`,           "low",    0.06);
  } else if (diff === 0 && min >= 65) {
    add("Empate — ambos buscam virada",                                       `${min}'`, "medium", 0.10);
  } else if (diff === 0 && min >= 50) {
    add("Jogo empatado em aberto",                                            `${min}'`, "low",    0.05);
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

  const maxPoss = Math.max(H.possession, A.possession);
  if (maxPoss >= 68)           add("Domínio territorial absoluto",            `${maxPoss.toFixed(0)}%`, "medium", 0.06);

  // Taxa de corners (usa apenas nas fases com dados maduros — phase2B e 2C)
  if (!phase2A) {
    const totalCorners = H.corners + A.corners;
    const cRate = rate(totalCorners, min);
    const cThresh = phase2B ? 0.18 : 0.22;
    if (cRate > cThresh + 0.06)  add("Ritmo alto de escanteios",             `${(cRate*10).toFixed(1)}/10min`, "high",   0.14);
    else if (cRate > cThresh)    add("Ritmo moderado de escanteios",         `${(cRate*10).toFixed(1)}/10min`, "medium", 0.07);
  }

  return { mult: clamp(mult, 1.0, MAX_MULT_LATE), factors };
}

// ── Fast Track: padrão de alta convicção precoce ──────────────────────────────
function checkFastTrack(crossRate, blocked, minute) {
  if (minute > 22) return false;
  return crossRate > 0.42 && blocked >= 3;
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
  if (crossRate > 0.28) {
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

  // FATOR 6: Acréscimos elevados = mais tempo para 2 corners acontecerem
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

// ── Projeção principal ────────────────────────────────────────────────────────
export function projectCorners(game) {
  const min     = Math.max(2, game.minute);
  const isEarly = min < LATE_START;
  const H = analyzeSide(buildSide(game, "home"), min);
  const A = analyzeSide(buildSide(game, "away"), min);

  const totalCorners = H.corners + A.corners;
  const baseRate     = rate(totalCorners, min);

  // ── leagueAvg personalizado (API-Football histórico) ────────────────────
  const historicalAvg = calcHistoricalLeagueAvg(game, isEarly);
  const leagueAvg = historicalAvg
    ? historicalAvg
    : (isEarly ? LEAGUE_AVG_EARLY : LEAGUE_AVG_LATE);

  // Flag de qualidade da projeção
  const hasHistoricalData = !!historicalAvg;

  const pressureResult = isEarly
    ? calcEarlyPressure(H, A, game)
    : calcLatePressure(H, A, game);
  const { mult: baseMult, factors } = pressureResult;

  // ── Fatores extras da API-Football ──────────────────────────────────────
  let mult = baseMult;

  // 1. Shots Inside Box
  const sibFactor = calcInsideBoxFactor(game, min, isEarly);
  if (sibFactor.delta !== 0) {
    mult += sibFactor.delta;
    factors.push({ text: sibFactor.label, detail: "", impact: sibFactor.impact || "medium" });
  }

  // 2. Dangerous Attacks reais
  const daFactor = calcRealDAFactor(game, min);
  if (daFactor.delta !== 0) {
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
  const isFastTrack       = isEarly && checkFastTrack(crossRateCombined, blockedTotal, min);
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
    subPhase = min < 28 ? "1A" : min < 38 ? "1B" : "1C";
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
    afEnriched:        !!(game.afFixtureId),
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
    // Penalidade dinâmica (reduz conforme mult é maior)
    const multFactor = 1 / (1 + (mult - 1) * 2);
    let basePenalty;
    if (game.minute < 15)      basePenalty = 0.45;
    else if (game.minute < 28) basePenalty = 0.78;
    else if (game.minute < 38) basePenalty = 0.86;
    else                       basePenalty = 0.94;
    conf *= basePenalty + (1 - basePenalty) * (1 - multFactor);

    const totalCrosses = safe(game.crosses?.home) + safe(game.crosses?.away);
    if (totalCrosses === 0 && game.minute > 20) conf *= 0.65;
    if (isPostGoalCooldown)  conf *= 0.60;
    if (isFastTrack)         conf = Math.max(conf, 72);

  } else {
    // 2ºT: penalidade suave se taxa base muito baixa
    if (baseRate < 0.06 && game.minute > 55) conf *= 0.72;

    // Fase 2A (45-57'): penalidade extra — dados ainda diluídos pelo 1ºT
    if (game.minute < 58) conf *= 0.90;
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
