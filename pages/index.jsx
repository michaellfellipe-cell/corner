import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import { predictCorners, generateDemoGame } from "../lib/predictor";

// ─── Constants ────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL = 30000; // 30s para não sobrecarregar ESPN
const DEMO_GAME_COUNT = 5;

// ─── Utility ──────────────────────────────────────────────────────────────────
const sigColor = (sig) => sig === "STRONG" ? "#00e5a0" : sig === "MODERATE" ? "#f0c040" : "#3d4f6b";

// ─── Sub-Components ───────────────────────────────────────────────────────────
function StatBar({ label, homeVal, awayVal }) {
  const total = (homeVal || 0) + (awayVal || 0);
  const homePct = total > 0 ? (homeVal / total) * 100 : 50;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)", marginBottom: 4 }}>
        <span style={{ color: "#00e5a0", minWidth: 28 }}>{homeVal ?? "—"}</span>
        <span style={{ color: "#3d4f6b", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
        <span style={{ color: "#f0c040", minWidth: 28, textAlign: "right" }}>{awayVal ?? "—"}</span>
      </div>
      <div style={{ height: 5, background: "#1a2235", borderRadius: 3, overflow: "hidden", display: "flex" }}>
        <div style={{ width: `${homePct}%`, background: "#00e5a0", borderRadius: "3px 0 0 3px", transition: "width .8s" }} />
        <div style={{ flex: 1, background: "#f0c040", borderRadius: "0 3px 3px 0" }} />
      </div>
    </div>
  );
}

function ConfidenceRing({ value, signal }) {
  const color = sigColor(signal);
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div style={{ position: "relative", width: 100, height: 100, margin: "0 auto" }}>
      <svg width="100" height="100" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1a2235" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease", filter: `drop-shadow(0 0 6px ${color})` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: 28, color, lineHeight: 1 }}>{value}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b" }}>CONF%</span>
      </div>
    </div>
  );
}

function LiveDot() {
  return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#00e5a0", animation: "pulse 1.2s infinite", verticalAlign: "middle" }} />;
}

function GameCard({ game, onSelect, isSelected }) {
  const pred = predictCorners(game);
  const sc = sigColor(pred.signal);
  return (
    <div onClick={() => onSelect(game)}
      style={{
        background: isSelected ? "#0d1a2e" : "#0d1117",
        border: `1px solid ${isSelected ? "#00e5a0" : "#1c2333"}`,
        borderLeft: `3px solid ${sc}`,
        borderRadius: 8, padding: "13px 15px", cursor: "pointer",
        marginBottom: 8, transition: "all .2s",
        boxShadow: pred.signal === "STRONG" ? `0 0 14px ${sc}30` : "none",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 14, color: "#c9d6e3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {game.home} <span style={{ color: "#3d4f6b" }}>×</span> {game.away}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#3d4f6b", marginTop: 1 }}>
            {game.leagueCountry} {game.league}
            {game.isDemo && <span style={{ color: "#f0c040", marginLeft: 6 }}>[DEMO]</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
          <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: 20, color: "#c9d6e3", lineHeight: 1 }}>
            {game.score.home}–{game.score.away}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end", marginTop: 2 }}>
            <LiveDot />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#00e5a0" }}>{game.minute}'</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#3d4f6b" }}>
          ESC {game.corners.home}–{game.corners.away}
        </span>
        <span style={{
          fontFamily: "var(--display)", fontWeight: 700, fontSize: 11, letterSpacing: 1,
          color: sc, background: `${sc}18`, padding: "2px 8px", borderRadius: 4,
        }}>{pred.signal} · {pred.confidence}%</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [games, setGames] = useState([]);
  const [selected, setSelected] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const prevSignals = useRef({});

  // ── Fetch real ESPN data ─────────────────────────────────────────────
  const fetchGames = useCallback(async () => {
    try {
      const res = await fetch("/api/games");
      const data = await res.json();
      let list = data.games || [];

      if (list.length === 0) {
        list = Array.from({ length: DEMO_GAME_COUNT }, (_, i) => generateDemoGame(i));
        setIsDemo(true);
      } else {
        setIsDemo(false);
        // Ordena por confiança — STRONG primeiro
        list.sort((a, b) => predictCorners(b).confidence - predictCorners(a).confidence);
      }

      // Detecta novos sinais fortes para alertas
      list.forEach(g => {
        const pred = predictCorners(g);
        const prev = prevSignals.current[g.id];
        if (pred.signal === "STRONG" && prev !== "STRONG") {
          setAlerts(a => [
            { id: Date.now(), game: `${g.home} × ${g.away}`, minute: g.minute, conf: pred.confidence },
            ...a,
          ].slice(0, 5));
        }
        prevSignals.current[g.id] = pred.signal;
      });

      setGames(list);
      setLastUpdate(new Date());
      setLoading(false);

      // Auto-seleciona o mais forte
      if (!selected) {
        const strongest = list.reduce((best, g) => {
          const p = predictCorners(g);
          const bp = predictCorners(best);
          return p.confidence > bp.confidence ? g : best;
        }, list[0]);
        if (strongest) {
          setSelected(strongest);
          setPrediction(predictCorners(strongest));
        }
      } else {
        // Atualiza jogo selecionado
        const updated = list.find(g => g.id === selected.id);
        if (updated) {
          setSelected(updated);
          setPrediction(predictCorners(updated));
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
      // fallback demo
      const demo = Array.from({ length: DEMO_GAME_COUNT }, (_, i) => generateDemoGame(i));
      setGames(demo);
      setIsDemo(true);
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchGames]);

  // ── Select game & run AI ─────────────────────────────────────────────
  const handleSelect = useCallback(async (game) => {
    const pred = predictCorners(game);
    setSelected(game);
    setPrediction(pred);
    setAiAnalysis("");
    setAiLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game, prediction: pred }),
      });
      const data = await res.json();
      setAiAnalysis(data.analysis || data.error || "Sem resposta.");
    } catch {
      setAiAnalysis("Erro ao conectar com análise de IA.");
    }
    setAiLoading(false);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ background: "#080b10", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ fontSize: 32 }}>⚽</div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#00e5a0" }}>Buscando jogos ao vivo ESPN...</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#00e5a0", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
      </div>
    </div>
  );

  const sc = prediction ? sigColor(prediction.signal) : "#3d4f6b";

  return (
    <>
      <Head>
        <title>CornerEdge — Predição de Escanteios ao Vivo</title>
        <meta name="description" content="Análise em tempo real de escanteios via ESPN API + IA" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@300;500;700;900&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ background: "#080b10", minHeight: "100vh", color: "#c9d6e3" }}>

        {/* ── Header ── */}
        <header style={{ background: "#060910", borderBottom: "1px solid #1c2333", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, background: "#00e5a0", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚽</div>
            <div>
              <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: 18, letterSpacing: 2 }}>
                CORNER<span style={{ color: "#00e5a0" }}>EDGE</span>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 2 }}>LIVE CORNER PREDICTOR · ESPN API</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {isDemo && (
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#f0c040", background: "#f0c04015", padding: "4px 10px", borderRadius: 4, border: "1px solid #f0c04044" }}>
                ⚠ MODO DEMO — Sem jogos ao vivo agora
              </div>
            )}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b" }}>JOGOS</div>
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 20, color: "#00e5a0" }}>{games.length}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b" }}>ALERTAS</div>
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 20, color: "#f0c040" }}>{alerts.length}</div>
            </div>
            <button onClick={fetchGames} style={{
              fontFamily: "var(--mono)", fontSize: 10, color: "#00e5a0", background: "#00e5a011",
              border: "1px solid #00e5a033", borderRadius: 5, padding: "5px 10px", cursor: "pointer",
            }}>↻ REFRESH</button>
          </div>
        </header>

        {/* ── Alerts bar ── */}
        {alerts.length > 0 && (
          <div style={{ background: "#0d1a0d", borderBottom: "1px solid #00e5a033", padding: "8px 20px", display: "flex", gap: 10, overflowX: "auto" }}>
            {alerts.map(a => (
              <div key={a.id} style={{ flexShrink: 0, fontFamily: "var(--mono)", fontSize: 10, color: "#00e5a0", background: "#00e5a00d", padding: "4px 10px", borderRadius: 4, border: "1px solid #00e5a033" }}>
                🚨 {a.game} · {a.minute}' · {a.conf}%
              </div>
            ))}
          </div>
        )}

        {/* ── Main layout ── */}
        <div style={{ display: "flex", gap: 0, maxWidth: 1200, margin: "0 auto", padding: 16 }}>

          {/* Left: game list */}
          <div style={{ width: 300, flexShrink: 0, marginRight: 16 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 2, marginBottom: 10 }}>
              ▸ JOGOS AO VIVO · {lastUpdate ? `ATT ${lastUpdate.toLocaleTimeString("pt-BR")}` : ""}
            </div>
            {games.map(g => (
              <GameCard key={g.id} game={g} onSelect={handleSelect} isSelected={selected?.id === g.id} />
            ))}
          </div>

          {/* Right: detail */}
          {selected && prediction && (
            <div style={{ flex: 1, minWidth: 0 }}>

              {/* Match header */}
              <div style={{ background: "#0d1117", border: "1px solid #1c2333", borderRadius: 10, padding: "16px 20px", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: 22, letterSpacing: 1 }}>
                      {selected.home} <span style={{ color: "#3d4f6b", fontWeight: 300 }}>×</span> {selected.away}
                    </div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#3d4f6b", marginTop: 3 }}>
                      {selected.leagueCountry} {selected.league}&nbsp;·&nbsp;
                      <LiveDot />&nbsp;
                      <span style={{ color: "#00e5a0" }}>AO VIVO {selected.minute}'</span>
                      {selected.isDemo && <span style={{ color: "#f0c040", marginLeft: 8 }}>[SIMULAÇÃO]</span>}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: 48, letterSpacing: -2, lineHeight: 1 }}>
                    {selected.score.home}<span style={{ color: "#3d4f6b", fontSize: 28 }}>–</span>{selected.score.away}
                  </div>
                </div>
              </div>

              {/* Prediction + Factors grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 14 }}>

                {/* Confidence */}
                <div style={{ background: "#0d1117", border: `1px solid ${sc}44`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 2, marginBottom: 14 }}>▸ PREDIÇÃO ESCANTEIOS</div>
                  <ConfidenceRing value={prediction.confidence} signal={prediction.signal} />
                  <div style={{ textAlign: "center", marginTop: 14 }}>
                    <div style={{
                      fontFamily: "var(--display)", fontWeight: 900, fontSize: 18, letterSpacing: 1,
                      color: sc, background: `${sc}12`, padding: "7px 18px", borderRadius: 6,
                      display: "inline-block", border: `1px solid ${sc}44`,
                    }}>{prediction.recommendation}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#3d4f6b", marginTop: 6 }}>Janela: {prediction.predictedWindow}</div>
                  </div>
                </div>

                {/* Factors */}
                <div style={{ background: "#0d1117", border: "1px solid #1c2333", borderRadius: 10, padding: 18 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 2, marginBottom: 14 }}>▸ FATORES ATIVOS ({prediction.factors.length})</div>
                  {prediction.factors.length === 0 ? (
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#3d4f6b" }}>Nenhum fator ativo</div>
                  ) : prediction.factors.map((f, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#c9d6e3" }}>{f.label}</span>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#00e5a0" }}>+{f.weight}</span>
                      </div>
                      <div style={{ height: 3, background: "#1a2235", borderRadius: 2 }}>
                        <div style={{ height: "100%", width: `${(f.weight / 25) * 100}%`, background: "#00e5a0", borderRadius: 2, transition: "width 1s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div style={{ background: "#0d1117", border: "1px solid #1c2333", borderRadius: 10, padding: 18, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 2 }}>▸ ESTATÍSTICAS AO VIVO</div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#00e5a0" }}>{selected.homeShort || selected.home}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#f0c040" }}>{selected.awayShort || selected.away}</span>
                  </div>
                </div>
                <StatBar label="Posse (%)" homeVal={selected.possession.home} awayVal={selected.possession.away} />
                <StatBar label="Ataques Perigosos" homeVal={selected.dangerousAttacks.home} awayVal={selected.dangerousAttacks.away} />
                <StatBar label="Chutes no Alvo" homeVal={selected.onTarget.home} awayVal={selected.onTarget.away} />
                <StatBar label="Total Chutes" homeVal={selected.shots.home} awayVal={selected.shots.away} />
                <StatBar label="Escanteios" homeVal={selected.corners.home} awayVal={selected.corners.away} />
                <StatBar label="Faltas" homeVal={selected.fouls?.home ?? "—"} awayVal={selected.fouls?.away ?? "—"} />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
                  {[
                    { label: "PRESSÃO", value: `${selected.pressureIndex ?? "—"}%`, color: (selected.pressureIndex ?? 0) > 70 ? "#00e5a0" : "#c9d6e3" },
                    { label: "ESCANTEIOS", value: `${selected.corners.home + selected.corners.away}`, color: "#f0c040" },
                    { label: "MINUTO", value: `${selected.minute}'`, color: selected.minute >= 75 ? "#ff4560" : "#c9d6e3" },
                  ].map((s, i) => (
                    <div key={i} style={{ background: "#0a0f18", borderRadius: 8, padding: "10px 12px", border: "1px solid #1c2333" }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Analysis */}
              <div style={{ background: "#0d1117", border: "1px solid #00e5a022", borderRadius: 10, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 2 }}>▸ ANÁLISE IA — CLAUDE</div>
                  <button onClick={() => handleSelect(selected)} style={{
                    fontFamily: "var(--mono)", fontSize: 10, color: "#00e5a0", background: "#00e5a011",
                    border: "1px solid #00e5a033", borderRadius: 4, padding: "4px 10px", cursor: "pointer",
                  }}>↻ ATUALIZAR</button>
                </div>
                {aiLoading ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e5a0", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#3d4f6b" }}>Claude analisando jogo...</span>
                  </div>
                ) : aiAnalysis ? (
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#c9d6e3", lineHeight: 1.8, background: "#060a14", borderRadius: 6, padding: "12px 14px", borderLeft: "3px solid #00e5a0" }}>
                    {aiAnalysis}
                  </div>
                ) : (
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#3d4f6b" }}>
                    Clique em um jogo ou em Atualizar para análise da IA.
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{ borderTop: "1px solid #1c2333", padding: "12px 20px", textAlign: "center" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#3d4f6b", letterSpacing: 1 }}>
            CORNEREDGE v2.0 · ESPN API + ANTHROPIC CLAUDE · APOSTAS ENVOLVEM RISCO FINANCEIRO · USO RESPONSÁVEL
          </span>
        </footer>
      </div>
    </>
  );
}
