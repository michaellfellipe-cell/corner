import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import { predictCorners, generateDemoGame } from "../lib/predictor";

const sigColor = s => s === "STRONG" ? "#00e5a0" : s === "MODERATE" ? "#f0c040" : "#3d4f6b";

function StatBar({ label, homeVal, awayVal }) {
  const hv = homeVal ?? 0, av = awayVal ?? 0;
  const total = hv + av;
  const pct = total > 0 ? (hv / total) * 100 : 50;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, fontFamily:"var(--mono)", marginBottom:4 }}>
        <span style={{ color:"#00e5a0", minWidth:28 }}>{homeVal ?? "—"}</span>
        <span style={{ color:"#3d4f6b", fontSize:10, textTransform:"uppercase", letterSpacing:1 }}>{label}</span>
        <span style={{ color:"#f0c040", minWidth:28, textAlign:"right" }}>{awayVal ?? "—"}</span>
      </div>
      <div style={{ height:5, background:"#1a2235", borderRadius:3, overflow:"hidden", display:"flex" }}>
        <div style={{ width:`${pct}%`, background:"#00e5a0", borderRadius:"3px 0 0 3px", transition:"width .8s" }}/>
        <div style={{ flex:1, background:"#f0c040", borderRadius:"0 3px 3px 0" }}/>
      </div>
    </div>
  );
}

function Ring({ value, signal }) {
  const color = sigColor(signal);
  const r = 40, c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <div style={{ position:"relative", width:100, height:100, margin:"0 auto" }}>
      <svg width="100" height="100" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1a2235" strokeWidth="8"/>
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={off}
          style={{ transition:"stroke-dashoffset 1s ease", filter:`drop-shadow(0 0 6px ${color})` }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:28, color, lineHeight:1 }}>{value}</span>
        <span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b" }}>CONF%</span>
      </div>
    </div>
  );
}

function Dot() {
  return <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", background:"#00e5a0", animation:"pulse 1.2s infinite", verticalAlign:"middle" }}/>;
}

function formatKickoff(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  return d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
}

function GameCard({ game, onSelect, isSelected }) {
  const pred = game.isUpcoming ? null : predictCorners(game);
  const sc = pred ? sigColor(pred.signal) : "#3d4f6b";
  return (
    <div onClick={() => onSelect(game)}
      style={{
        background: isSelected ? "#0d1a2e" : "#0d1117",
        border: `1px solid ${isSelected ? "#00e5a0" : "#1c2333"}`,
        borderLeft: `3px solid ${sc}`,
        borderRadius:8, padding:"12px 14px", cursor:"pointer",
        marginBottom:7, transition:"all .2s",
        opacity: game.isUpcoming ? 0.7 : 1,
        boxShadow: pred?.signal === "STRONG" ? `0 0 14px ${sc}30` : "none",
      }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:13, color:"#c9d6e3", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {game.home} <span style={{ color:"#3d4f6b" }}>×</span> {game.away}
          </div>
          <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", marginTop:1 }}>
            {game.leagueCountry} {game.league}
            {game.isDemo && <span style={{ color:"#f0c040", marginLeft:6 }}>[DEMO]</span>}
          </div>
        </div>
        <div style={{ textAlign:"right", flexShrink:0, marginLeft:8 }}>
          {game.isUpcoming ? (
            <div style={{ fontFamily:"var(--mono)", fontSize:11, color:"#f0c040" }}>{formatKickoff(game.startTime)}</div>
          ) : (
            <>
              <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:19, color:"#c9d6e3", lineHeight:1 }}>
                {game.score.home}–{game.score.away}
              </div>
              <div style={{ display:"flex", gap:4, alignItems:"center", justifyContent:"flex-end", marginTop:2 }}>
                <Dot/><span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#00e5a0" }}>{game.minute}'</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b" }}>
          {game.isUpcoming ? "🕐 AGENDADO" : `ESC ${game.corners.home}–${game.corners.away}`}
        </span>
        {pred && (
          <span style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:10, letterSpacing:1, color:sc, background:`${sc}18`, padding:"2px 7px", borderRadius:4 }}>
            {pred.signal} · {pred.confidence}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function Home() {
  const [games, setGames]           = useState([]);
  const [upcoming, setUpcoming]     = useState([]);
  const [selected, setSelected]     = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [alerts, setAlerts]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [isDemo, setIsDemo]         = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab]               = useState("live"); // "live" | "upcoming"
  const prevSigs    = useRef({});
  const intervalRef = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  // ── Fetch — sem dependência de `selected` para evitar loop de intervalos ──
  const fetchGames = useCallback(async () => {
    try {
      const res  = await fetch("/api/games");
      const data = await res.json();
      let list     = data.games    || [];
      const upList = data.upcoming || [];

      const demoMode = list.length === 0;
      if (demoMode) {
        list = Array.from({ length: 5 }, (_, i) => generateDemoGame(i));
      }
      setIsDemo(demoMode);

      // Ordena por confiança
      if (!demoMode) list.sort((a,b) => predictCorners(b).confidence - predictCorners(a).confidence);

      // Alertas de sinal forte
      list.forEach(g => {
        const pred = predictCorners(g);
        if (pred.signal === "STRONG" && prevSigs.current[g.id] !== "STRONG") {
          setAlerts(a => [
            { id: Date.now() + g.id, game: `${g.home} × ${g.away}`, minute: g.minute, conf: pred.confidence },
            ...a,
          ].slice(0, 5));
        }
        prevSigs.current[g.id] = pred.signal;
      });

      setGames(list);
      setUpcoming(upList);
      setLastUpdate(new Date());
      setLoading(false);

      // Seleciona o mais forte ou atualiza o selecionado atual
      const cur = selectedRef.current;
      if (!cur || demoMode) {
        const best = list[0];
        if (best) { setSelected(best); setPrediction(predictCorners(best)); }
      } else {
        const updated = list.find(g => g.id === cur.id);
        if (updated) { setSelected(updated); setPrediction(predictCorners(updated)); }
      }
    } catch (err) {
      console.error(err);
      const demo = Array.from({ length: 5 }, (_, i) => generateDemoGame(i));
      setGames(demo); setIsDemo(true); setLoading(false);
      if (!selectedRef.current && demo[0]) { setSelected(demo[0]); setPrediction(predictCorners(demo[0])); }
    }
  }, []); // ← sem dependências para nunca recriar

  // Monta intervalo uma única vez
  useEffect(() => {
    fetchGames();
    intervalRef.current = setInterval(fetchGames, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchGames]);

  const handleSelect = useCallback(async (game) => {
    const pred = predictCorners(game);
    setSelected(game); setPrediction(pred); setAiAnalysis("");
    if (game.isUpcoming) return; // sem análise IA para jogos futuros
    setAiLoading(true);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ game, prediction: pred }),
      });
      const d = await r.json();
      setAiAnalysis(d.analysis || d.error || "Sem resposta.");
    } catch { setAiAnalysis("Erro ao conectar."); }
    setAiLoading(false);
  }, []);

  if (loading) return (
    <div style={{ background:"#080b10", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
      <div style={{ fontSize:36 }}>⚽</div>
      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, color:"#00e5a0" }}>Buscando jogos via ESPN API ({53} ligas)...</div>
      <div style={{ display:"flex", gap:6 }}>
        {[0,1,2].map(i => <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:"#00e5a0", animation:`pulse 1.2s ${i*.2}s infinite` }}/>)}
      </div>
    </div>
  );

  const sc = prediction ? sigColor(prediction.signal) : "#3d4f6b";
  const displayGames = tab === "live" ? games : upcoming;

  return (
    <>
      <Head>
        <title>CornerEdge — Predição de Escanteios ao Vivo</title>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@300;500;700;900&display=swap" rel="stylesheet"/>
      </Head>
      <div style={{ background:"#080b10", minHeight:"100vh", color:"#c9d6e3" }}>

        {/* Header */}
        <header style={{ background:"#060910", borderBottom:"1px solid #1c2333", padding:"10px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:30, height:30, background:"#00e5a0", borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚽</div>
            <div>
              <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:18, letterSpacing:2 }}>
                CORNER<span style={{ color:"#00e5a0" }}>EDGE</span>
              </div>
              <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:2 }}>ESPN API · 53 LIGAS</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            {isDemo && (
              <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#f0c040", background:"#f0c04015", padding:"4px 10px", borderRadius:4, border:"1px solid #f0c04044" }}>
                ⚠ SEM JOGOS AO VIVO AGORA
              </div>
            )}
            {[
              { label:"AO VIVO", value: isDemo ? 0 : games.length, color:"#00e5a0" },
              { label:"PRÓXIMOS", value: upcoming.length, color:"#f0c040" },
              { label:"ALERTAS", value: alerts.length, color:"#ff4560" },
            ].map((s,i) => (
              <div key={i} style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b" }}>{s.label}</div>
                <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:20, color:s.color }}>{s.value}</div>
              </div>
            ))}
            <button onClick={fetchGames} style={{ fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0", background:"#00e5a011", border:"1px solid #00e5a033", borderRadius:5, padding:"5px 10px", cursor:"pointer" }}>↻</button>
          </div>
        </header>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div style={{ background:"#0d1a0d", borderBottom:"1px solid #00e5a033", padding:"6px 20px", display:"flex", gap:8, overflowX:"auto" }}>
            {alerts.map(a => (
              <div key={a.id} style={{ flexShrink:0, fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0", background:"#00e5a00d", padding:"3px 10px", borderRadius:4, border:"1px solid #00e5a033" }}>
                🚨 {a.game} · {a.minute}' · {a.conf}%
              </div>
            ))}
          </div>
        )}

        <div style={{ display:"flex", maxWidth:1200, margin:"0 auto", padding:16, gap:16 }}>

          {/* Left panel */}
          <div style={{ width:290, flexShrink:0 }}>
            {/* Tabs */}
            <div style={{ display:"flex", gap:0, marginBottom:12, borderRadius:6, overflow:"hidden", border:"1px solid #1c2333" }}>
              {[
                { key:"live",     label:`⚡ AO VIVO (${isDemo ? 0 : games.length})` },
                { key:"upcoming", label:`🕐 PRÓXIMOS (${upcoming.length})` },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  flex:1, padding:"7px 4px", fontFamily:"var(--mono)", fontSize:10, cursor:"pointer", border:"none",
                  background: tab === t.key ? "#00e5a0" : "#0d1117",
                  color: tab === t.key ? "#080b10" : "#3d4f6b",
                  fontWeight: tab === t.key ? "700" : "400",
                  transition:"all .2s",
                }}>{t.label}</button>
              ))}
            </div>

            <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:2, marginBottom:8 }}>
              {tab === "live" ? "▸ JOGOS EM ANDAMENTO" : "▸ PRÓXIMOS JOGOS (HORÁRIO BRASÍLIA)"}
              {lastUpdate && <span style={{ float:"right" }}>ATT {lastUpdate.toLocaleTimeString("pt-BR")}</span>}
            </div>

            {tab === "live" && games.length === 0 && (
              <div style={{ fontFamily:"var(--mono)", fontSize:11, color:"#3d4f6b", textAlign:"center", padding:"30px 10px", background:"#0d1117", borderRadius:8, border:"1px solid #1c2333" }}>
                Nenhum jogo ao vivo agora.<br/>
                <span style={{ color:"#f0c040" }}>Veja os próximos jogos →</span>
              </div>
            )}

            <div style={{ maxHeight:"calc(100vh - 200px)", overflowY:"auto", paddingRight:4 }}>
              {(tab === "live" ? (isDemo ? games : games) : upcoming).map(g => (
                <GameCard key={g.id} game={g} onSelect={handleSelect} isSelected={selected?.id === g.id}/>
              ))}
            </div>
          </div>

          {/* Right panel */}
          {selected && (
            <div style={{ flex:1, minWidth:0 }}>

              {/* Match header */}
              <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:"15px 20px", marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:22, letterSpacing:1 }}>
                      {selected.home} <span style={{ color:"#3d4f6b", fontWeight:300 }}>×</span> {selected.away}
                    </div>
                    <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b", marginTop:3 }}>
                      {selected.leagueCountry} {selected.league}&nbsp;·&nbsp;
                      {selected.isUpcoming ? (
                        <span style={{ color:"#f0c040" }}>🕐 INÍCIO ÀS {formatKickoff(selected.startTime)} (BRASÍLIA)</span>
                      ) : (
                        <><Dot/>&nbsp;<span style={{ color:"#00e5a0" }}>AO VIVO {selected.minute}'</span></>
                      )}
                      {selected.isDemo && <span style={{ color:"#f0c040", marginLeft:8 }}>[SIMULAÇÃO]</span>}
                    </div>
                  </div>
                  <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:48, letterSpacing:-2, lineHeight:1 }}>
                    {selected.isUpcoming ? (
                      <span style={{ fontSize:20, color:"#f0c040", fontFamily:"var(--mono)" }}>EM BREVE</span>
                    ) : (
                      <>{selected.score.home}<span style={{ color:"#3d4f6b", fontSize:28 }}>–</span>{selected.score.away}</>
                    )}
                  </div>
                </div>
              </div>

              {selected.isUpcoming ? (
                <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:24, textAlign:"center" }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🕐</div>
                  <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:20, color:"#f0c040", marginBottom:8 }}>
                    Jogo começa às {formatKickoff(selected.startTime)} (horário de Brasília)
                  </div>
                  <div style={{ fontFamily:"var(--mono)", fontSize:11, color:"#3d4f6b" }}>
                    A análise de escanteios ficará disponível quando o jogo começar.
                  </div>
                </div>
              ) : prediction && (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:14, marginBottom:14 }}>

                    {/* Ring */}
                    <div style={{ background:"#0d1117", border:`1px solid ${sc}44`, borderRadius:10, padding:18 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:2, marginBottom:14 }}>▸ PREDIÇÃO ESCANTEIOS</div>
                      <Ring value={prediction.confidence} signal={prediction.signal}/>
                      <div style={{ textAlign:"center", marginTop:14 }}>
                        <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:18, letterSpacing:1, color:sc, background:`${sc}12`, padding:"7px 18px", borderRadius:6, display:"inline-block", border:`1px solid ${sc}44` }}>
                          {prediction.recommendation}
                        </div>
                        <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b", marginTop:6 }}>Janela: {prediction.predictedWindow}</div>
                      </div>
                    </div>

                    {/* Factors */}
                    <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:18 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:2, marginBottom:14 }}>▸ FATORES ATIVOS ({prediction.factors.length})</div>
                      {prediction.factors.length === 0 ? (
                        <div style={{ fontFamily:"var(--mono)", fontSize:11, color:"#3d4f6b" }}>Nenhum fator ativo</div>
                      ) : prediction.factors.map((f,i) => (
                        <div key={i} style={{ marginBottom:10 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                            <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"#c9d6e3" }}>{f.label}</span>
                            <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0" }}>+{f.weight}</span>
                          </div>
                          <div style={{ height:3, background:"#1a2235", borderRadius:2 }}>
                            <div style={{ height:"100%", width:`${(f.weight/25)*100}%`, background:"#00e5a0", borderRadius:2, transition:"width 1s" }}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:18, marginBottom:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:2 }}>▸ ESTATÍSTICAS AO VIVO</div>
                      <div style={{ display:"flex", gap:16 }}>
                        <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0" }}>{selected.homeShort}</span>
                        <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"#f0c040" }}>{selected.awayShort}</span>
                      </div>
                    </div>
                    <StatBar label="Posse (%)" homeVal={selected.possession.home} awayVal={selected.possession.away}/>
                    <StatBar label="Ataques Perigosos" homeVal={selected.dangerousAttacks.home} awayVal={selected.dangerousAttacks.away}/>
                    <StatBar label="Chutes no Alvo" homeVal={selected.onTarget.home} awayVal={selected.onTarget.away}/>
                    <StatBar label="Total Chutes" homeVal={selected.shots.home} awayVal={selected.shots.away}/>
                    <StatBar label="Escanteios" homeVal={selected.corners.home} awayVal={selected.corners.away}/>
                    <StatBar label="Faltas" homeVal={selected.fouls?.home} awayVal={selected.fouls?.away}/>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:14 }}>
                      {[
                        { label:"MINUTO", value:`${selected.minute}'`, color: selected.minute >= 75 ? "#ff4560" : "#c9d6e3" },
                        { label:"ESCANTEIOS", value: selected.corners.home + selected.corners.away, color:"#f0c040" },
                        { label:"PERÍODO", value: selected.period === 2 ? "2ºTEMPO" : "1ºTEMPO", color:"#00e5a0" },
                      ].map((s,i) => (
                        <div key={i} style={{ background:"#0a0f18", borderRadius:8, padding:"10px 12px", border:"1px solid #1c2333" }}>
                          <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:1, marginBottom:4 }}>{s.label}</div>
                          <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:20, color:s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI */}
                  <div style={{ background:"#0d1117", border:"1px solid #00e5a022", borderRadius:10, padding:18 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:2 }}>▸ ANÁLISE IA — CLAUDE</div>
                      <button onClick={() => handleSelect(selected)} style={{ fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0", background:"#00e5a011", border:"1px solid #00e5a033", borderRadius:4, padding:"4px 10px", cursor:"pointer" }}>↻ ATUALIZAR</button>
                    </div>
                    {aiLoading ? (
                      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                        {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#00e5a0", animation:`pulse 1.2s ${i*.2}s infinite` }}/>)}
                        <span style={{ fontFamily:"var(--mono)", fontSize:11, color:"#3d4f6b" }}>Claude analisando...</span>
                      </div>
                    ) : aiAnalysis ? (
                      <div style={{ fontFamily:"var(--mono)", fontSize:12, color:"#c9d6e3", lineHeight:1.8, background:"#060a14", borderRadius:6, padding:"12px 14px", borderLeft:"3px solid #00e5a0" }}>
                        {aiAnalysis}
                      </div>
                    ) : (
                      <div style={{ fontFamily:"var(--mono)", fontSize:11, color:"#3d4f6b" }}>Clique em um jogo ou em Atualizar para análise da IA.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <footer style={{ borderTop:"1px solid #1c2333", padding:"10px 20px", textAlign:"center" }}>
          <span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", letterSpacing:1 }}>
            CORNEREDGE v3.0 · ESPN API + CLAUDE · APOSTAS ENVOLVEM RISCO FINANCEIRO
          </span>
        </footer>
      </div>
    </>
  );
}
