import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import { projectCorners, generateDemoGame } from "../lib/predictor";

const ALERT_THRESHOLD = 85;

const sigColor = s => s === "STRONG" ? "#00e5a0" : s === "MODERATE" ? "#f0c040" : "#3d4f6b";
const impactColor = i => i === "high" ? "#00e5a0" : i === "medium" ? "#f0c040" : "#4a6070";

function StatBar({ label, homeVal, awayVal, highlight }) {
  const hv = Number(homeVal) || 0, av = Number(awayVal) || 0;
  const total = hv + av;
  const pct = total > 0 ? (hv / total) * 100 : 50;
  return (
    <div style={{ marginBottom:9, background: highlight ? "#00e5a00a" : "transparent", borderRadius:4, padding: highlight ? "2px 4px" : 0 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, fontFamily:"var(--mono)", marginBottom:3 }}>
        <span style={{ color: highlight ? "#00e5a0" : "#c9d6e3", minWidth:28, fontWeight: highlight ? 700 : 400 }}>{homeVal ?? "—"}</span>
        <span style={{ color: highlight ? "#c9d6e3" : "#3d4f6b", fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>{label}</span>
        <span style={{ color: highlight ? "#f0c040" : "#c9d6e3", minWidth:28, textAlign:"right", fontWeight: highlight ? 700 : 400 }}>{awayVal ?? "—"}</span>
      </div>
      <div style={{ height:4, background:"#1a2235", borderRadius:3, overflow:"hidden", display:"flex" }}>
        <div style={{ width:`${pct}%`, background: highlight ? "#00e5a0" : "#253550", borderRadius:"3px 0 0 3px", transition:"width .8s" }}/>
        <div style={{ flex:1, background: highlight ? "#f0c040" : "#253550", borderRadius:"0 3px 3px 0" }}/>
      </div>
    </div>
  );
}

function Ring({ value, signal }) {
  const color = sigColor(signal);
  const r = 44, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  return (
    <div style={{ position:"relative", width:108, height:108, margin:"0 auto" }}>
      <svg width="108" height="108" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="54" cy="54" r={r} fill="none" stroke="#1a2235" strokeWidth="9"/>
        <circle cx="54" cy="54" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={c} strokeDashoffset={off}
          style={{ transition:"stroke-dashoffset 1.2s ease", filter:`drop-shadow(0 0 8px ${color})` }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:30, color, lineHeight:1 }}>{value}</span>
        <span style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:1 }}>CONF%</span>
      </div>
    </div>
  );
}

function Dot() {
  return <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", background:"#00e5a0", animation:"pulse 1.2s infinite", verticalAlign:"middle" }}/>;
}

function formatKickoff(isoDate) {
  if (!isoDate) return "—";
  return new Date(isoDate).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
}

function ProjectionBar({ value }) {
  const pct = Math.min(100, (value / 3.0) * 100);
  const color = value >= 2.0 ? "#00e5a0" : value >= 1.2 ? "#f0c040" : "#4a6070";
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"var(--mono)", fontSize:10, marginBottom:4 }}>
        <span style={{ color:"#3d4f6b" }}>0</span>
        <span style={{ color, fontWeight:700, fontSize:18 }}>{value.toFixed(1)}</span>
        <span style={{ color:"#3d4f6b" }}>3+</span>
      </div>
      <div style={{ height:10, background:"#1a2235", borderRadius:5, overflow:"hidden", position:"relative" }}>
        <div style={{ position:"absolute", left:"33%", top:0, bottom:0, width:1, background:"#2a3a50" }}/>
        <div style={{ position:"absolute", left:"66%", top:0, bottom:0, width:1, background:"#2a3a50" }}/>
        <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,#1a4060,${color})`, borderRadius:5, transition:"width 1.2s", boxShadow:`0 0 10px ${color}66` }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-around", fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", marginTop:3 }}>
        <span>1.0</span><span>2.0</span>
      </div>
    </div>
  );
}

// ── GameCard — verde só se ≥ 85% ────────────────────────────────────────────
function GameCard({ game, onSelect, isSelected }) {
  if (game.isUpcoming) {
    return (
      <div onClick={() => onSelect(game)} style={{ background: isSelected ? "#0d1a2e" : "#0d1117", border:`1px solid ${isSelected ? "#1c4060" : "#1c2333"}`, borderLeft:"3px solid #3d4f6b", borderRadius:8, padding:"11px 14px", cursor:"pointer", marginBottom:7, opacity:0.65 }}>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:13, color:"#c9d6e3", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{game.home} × {game.away}</div>
            <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b" }}>{game.leagueCountry} {game.league}</div>
          </div>
          <div style={{ fontFamily:"var(--mono)", fontSize:11, color:"#f0c040", flexShrink:0, marginLeft:8 }}>{formatKickoff(game.startTime)}</div>
        </div>
        <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", marginTop:4 }}>🕐 AGENDADO</div>
      </div>
    );
  }

  const pred = projectCorners(game);
  const isStrong = pred.confidence >= ALERT_THRESHOLD;
  // Verde APENAS se ≥ 85%, amarelo se ≥ 65%, cinza abaixo
  const sc = isStrong ? "#00e5a0" : pred.signal === "MODERATE" ? "#f0c040" : "#2a3a50";
  const borderColor = isSelected ? "#00e5a0" : sc;

  return (
    <div onClick={() => onSelect(game)} style={{
      background: isSelected ? "#0d1a2e" : "#0d1117",
      border:`1px solid ${isSelected ? "#00e5a0" : "#1c2333"}`,
      borderLeft:`3px solid ${borderColor}`,
      borderRadius:8, padding:"11px 14px", cursor:"pointer", marginBottom:7, transition:"all .2s",
      boxShadow: isStrong ? `0 0 14px ${sc}30` : "none",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:13, color:"#c9d6e3", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {game.home} <span style={{ color:"#3d4f6b" }}>×</span> {game.away}
          </div>
          <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", marginTop:1 }}>
            {game.leagueCountry} {game.league}
            {game.isDemo && <span style={{ color:"#f0c040", marginLeft:5 }}>[DEMO]</span>}
          </div>
        </div>
        <div style={{ textAlign:"right", flexShrink:0, marginLeft:8 }}>
          <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:19, color:"#c9d6e3", lineHeight:1 }}>{game.score.home}–{game.score.away}</div>
          <div style={{ display:"flex", gap:4, alignItems:"center", justifyContent:"flex-end", marginTop:2 }}>
            <Dot/><span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#00e5a0" }}>{game.minute}'</span>
          </div>
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b" }}>
          ESC {game.corners?.home??0}–{game.corners?.away??0} · CRZ {(game.crosses?.home??0)+(game.crosses?.away??0)}
        </span>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#4a6070" }}>~{pred.projected10}/10m</span>
          <span style={{
            fontFamily:"var(--display)", fontWeight:700, fontSize:10, letterSpacing:1,
            color: isStrong ? "#080b10" : sc,
            background: isStrong ? "#00e5a0" : `${sc}22`,
            padding:"2px 7px", borderRadius:4,
          }}>
            {isStrong ? `✓ ${pred.confidence}%` : `${pred.confidence}%`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── AlertBanner — só ≥ 85% ───────────────────────────────────────────────────
function AlertBanner({ alerts, onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div style={{ background:"#051209", borderBottom:"1px solid #00e5a044", padding:"0 16px", display:"flex", alignItems:"center", gap:0, minHeight:42 }}>
      <div style={{ flexShrink:0, display:"flex", alignItems:"center", paddingRight:10, borderRight:"1px solid #00e5a022", marginRight:10 }}>
        <span style={{ fontFamily:"var(--mono)", fontSize:8, color:"#00e5a0", letterSpacing:2, animation:"pulse 2s infinite" }}>🔔 ALERTAS</span>
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center", overflowX:"auto", flex:1 }}>
        {alerts.map(a => (
          <div key={a.id} onClick={a.onClick} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6,
            fontFamily:"var(--mono)", fontSize:9, background:"#00e5a00d", padding:"5px 10px",
            borderRadius:5, border:"1px solid #00e5a033", cursor:"pointer", whiteSpace:"nowrap" }}>
            <span style={{ color:"#00e5a0", fontWeight:700 }}>{a.game}</span>
            <span style={{ color:"#3d4f6b" }}>·</span>
            <span style={{ color:"#f0c040" }}>{a.minute}'</span>
            <span style={{ color:"#3d4f6b" }}>·</span>
            <span style={{ color:"#c9d6e3" }}>{a.market}</span>
            <span style={{ background:"#00e5a0", color:"#080b10", padding:"1px 5px", borderRadius:3, fontSize:8, fontWeight:700 }}>{a.confidence}%</span>
          </div>
        ))}
      </div>
      <button onClick={onDismiss} style={{ flexShrink:0, background:"none", border:"none", color:"#3d4f6b", cursor:"pointer", fontSize:14, padding:"0 8px" }}>✕</button>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [games, setGames]           = useState([]);
  const [upcoming, setUpcoming]     = useState([]);
  const [selected, setSelected]     = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [alerts, setAlerts]         = useState([]);
  const [alertsVisible, setAlertsVisible] = useState(true);
  const [loading, setLoading]       = useState(true);
  const [isDemo, setIsDemo]         = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab]               = useState("live");
  const prevSigs    = useRef({});
  const intervalRef = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  const handleSelect = useCallback((game) => {
    setSelected(game);
    setPrediction(game.isUpcoming ? null : projectCorners(game));
  }, []);
  const handleSelectRef = useRef(handleSelect);
  handleSelectRef.current = handleSelect;

  const fetchGames = useCallback(async () => {
    try {
      const res  = await fetch("/api/games");
      const data = await res.json();
      let list   = data.games    || [];
      const upList = data.upcoming || [];
      const demo = list.length === 0;

      if (demo) list = Array.from({ length:5 }, (_,i) => generateDemoGame(i));
      setIsDemo(demo);

      // Ordena: ≥85% primeiro, depois por confiança
      if (!demo) list.sort((a,b) => {
        const pa = projectCorners(a).confidence;
        const pb = projectCorners(b).confidence;
        return pb - pa;
      });

      // Alertas somente para ≥ ALERT_THRESHOLD
      list.forEach(g => {
        const pred = projectCorners(g);
        if (pred.confidence >= ALERT_THRESHOLD && prevSigs.current[g.id] !== "ALERTED") {
          setAlerts(a => [{
            id: `${g.id}-${Date.now()}`,
            game: `${g.homeShort || g.home.split(" ").pop()} × ${g.awayShort || g.away.split(" ").pop()}`,
            minute: g.minute,
            market: pred.market.betRange,
            confidence: pred.confidence,
            onClick: () => handleSelectRef.current(g),
          }, ...a].slice(0, 5));
          setAlertsVisible(true);
        }
        if (pred.confidence >= ALERT_THRESHOLD) prevSigs.current[g.id] = "ALERTED";
        else if (pred.confidence < 70) prevSigs.current[g.id] = "reset";
      });

      setGames(list);
      setUpcoming(upList);
      setLastUpdate(new Date());
      setLoading(false);

      const cur = selectedRef.current;
      if (!cur || demo) {
        if (list[0]) { setSelected(list[0]); setPrediction(projectCorners(list[0])); }
      } else {
        const upd = list.find(g => g.id === cur.id);
        if (upd) { setSelected(upd); setPrediction(projectCorners(upd)); }
      }
    } catch {
      const demo = Array.from({ length:5 }, (_,i) => generateDemoGame(i));
      setGames(demo); setIsDemo(true); setLoading(false);
      if (!selectedRef.current && demo[0]) { setSelected(demo[0]); setPrediction(projectCorners(demo[0])); }
    }
  }, []);

  useEffect(() => {
    fetchGames();
    intervalRef.current = setInterval(fetchGames, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchGames]);

  if (loading) return (
    <div style={{ background:"#080b10", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
      <div style={{ fontSize:36 }}>⚽</div>
      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:12, color:"#00e5a0" }}>Conectando ESPN · 53 ligas...</div>
      <div style={{ display:"flex", gap:6 }}>
        {[0,1,2].map(i=><div key={i} style={{ width:8, height:8, borderRadius:"50%", background:"#00e5a0", animation:`pulse 1.2s ${i*.2}s infinite` }}/>)}
      </div>
    </div>
  );

  const pred = prediction;
  const sc   = pred ? sigColor(pred.signal) : "#3d4f6b";
  const isStrong = pred?.confidence >= ALERT_THRESHOLD;

  return (
    <>
      <Head>
        <title>CornerEdge — Predição de Escanteios ao Vivo</title>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@300;500;700;900&display=swap" rel="stylesheet"/>
      </Head>
      <div style={{ background:"#080b10", minHeight:"100vh", color:"#c9d6e3" }}>

        {/* Header */}
        <header style={{ background:"#060910", borderBottom:"1px solid #1c2333", padding:"9px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:28, height:28, background:"#00e5a0", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>⚽</div>
            <div>
              <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:17, letterSpacing:2 }}>CORNER<span style={{ color:"#00e5a0" }}>EDGE</span></div>
              <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2 }}>ESPN · 53 LIGAS · ANÁLISE BILATERAL</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            {isDemo && <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#f0c040", background:"#f0c04012", padding:"3px 8px", borderRadius:4, border:"1px solid #f0c04033" }}>⚠ DEMO</div>}
            {[
              { label:"AO VIVO",  value: isDemo ? 0 : games.length,    color:"#00e5a0" },
              { label:"PRÓXIMOS", value: upcoming.length,              color:"#f0c040" },
              { label:"≥85%",     value: games.filter(g => projectCorners(g).confidence >= ALERT_THRESHOLD).length, color:"#00e5a0" },
            ].map((s,i) => (
              <div key={i} style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b" }}>{s.label}</div>
                <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:20, color:s.color }}>{s.value}</div>
              </div>
            ))}
            <button onClick={fetchGames} style={{ fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0", background:"#00e5a011", border:"1px solid #00e5a033", borderRadius:5, padding:"5px 10px", cursor:"pointer" }}>↻</button>
          </div>
        </header>

        {/* Alerts */}
        {alertsVisible && <AlertBanner alerts={alerts} onDismiss={() => setAlertsVisible(false)}/>}

        <div style={{ display:"flex", maxWidth:1280, margin:"0 auto", padding:14, gap:14 }}>

          {/* ── Sidebar ── */}
          <div style={{ width:285, flexShrink:0 }}>
            <div style={{ display:"flex", gap:0, marginBottom:10, borderRadius:6, overflow:"hidden", border:"1px solid #1c2333" }}>
              {[{ key:"live", label:`⚡ AO VIVO (${isDemo ? 0 : games.length})` }, { key:"upcoming", label:`🕐 PRÓXIMOS (${upcoming.length})` }].map(t => (
                <button key={t.key} onClick={()=>setTab(t.key)} style={{ flex:1, padding:"7px 4px", fontFamily:"var(--mono)", fontSize:9, cursor:"pointer", border:"none",
                  background: tab===t.key ? "#00e5a0" : "#0d1117", color: tab===t.key ? "#080b10" : "#3d4f6b",
                  fontWeight: tab===t.key ? "700" : "400", transition:"all .2s" }}>{t.label}</button>
              ))}
            </div>
            <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, marginBottom:8 }}>
              {tab==="live" ? "▸ EM ANDAMENTO" : "▸ PRÓXIMOS (BRASÍLIA)"}
              {lastUpdate && <span style={{ float:"right" }}>{lastUpdate.toLocaleTimeString("pt-BR")}</span>}
            </div>
            {tab==="live" && games.length===0 && (
              <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b", textAlign:"center", padding:"24px 10px", background:"#0d1117", borderRadius:8, border:"1px solid #1c2333" }}>
                Nenhum jogo ao vivo.<br/><span style={{ color:"#f0c040" }}>Ver próximos →</span>
              </div>
            )}
            <div style={{ maxHeight:"calc(100vh - 185px)", overflowY:"auto", paddingRight:3 }}>
              {(tab==="live" ? games : upcoming).map(g=>(
                <GameCard key={g.id} game={g} onSelect={handleSelect} isSelected={selected?.id===g.id}/>
              ))}
            </div>
          </div>

          {/* ── Detail ── */}
          {selected && (
            <div style={{ flex:1, minWidth:0 }}>

              {/* Match header */}
              <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:"14px 18px", marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:20, letterSpacing:1 }}>
                      {selected.home} <span style={{ color:"#3d4f6b", fontWeight:300 }}>×</span> {selected.away}
                    </div>
                    <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", marginTop:2 }}>
                      {selected.leagueCountry} {selected.league} ·&nbsp;
                      {selected.isUpcoming
                        ? <span style={{ color:"#f0c040" }}>🕐 {formatKickoff(selected.startTime)}</span>
                        : <><Dot/>&nbsp;<span style={{ color:"#00e5a0" }}>AO VIVO {selected.minute}' · {selected.period===2?"2ºT":"1ºT"}</span></>}
                      {selected.isDemo && <span style={{ color:"#f0c040", marginLeft:6 }}>[DEMO]</span>}
                    </div>
                  </div>
                  <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:44, letterSpacing:-2, lineHeight:1 }}>
                    {selected.isUpcoming
                      ? <span style={{ fontSize:15, color:"#f0c040", fontFamily:"var(--mono)" }}>EM BREVE</span>
                      : <>{selected.score.home}<span style={{ color:"#3d4f6b", fontSize:26 }}>–</span>{selected.score.away}</>}
                  </div>
                </div>
              </div>

              {selected.isUpcoming ? (
                <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:24, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>🕐</div>
                  <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:17, color:"#f0c040" }}>Início às {formatKickoff(selected.startTime)} (Brasília)</div>
                  <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b", marginTop:5 }}>Análise disponível quando o jogo começar.</div>
                </div>
              ) : pred && (
                <>
                  {/* Predição + Fatores */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>

                    <div style={{ background:"#0d1117", border:`1px solid ${isStrong ? "#00e5a044" : "#1c2333"}`, borderRadius:10, padding:18 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, marginBottom:12 }}>▸ PROJEÇÃO ESCANTEIOS · PRÓXIMOS 10MIN</div>
                      <Ring value={pred.confidence} signal={pred.signal}/>
                      <div style={{ marginTop:14 }}>
                        <ProjectionBar value={pred.projected10}/>
                      </div>
                      <div style={{ marginTop:14, textAlign:"center" }}>
                        <div style={{
                          fontFamily:"var(--display)", fontWeight:900, fontSize:18, letterSpacing:1,
                          color: isStrong ? "#080b10" : sc,
                          background: isStrong ? "#00e5a0" : `${sc}15`,
                          padding:"8px 16px", borderRadius:6, display:"inline-block",
                          border: isStrong ? "none" : `1px solid ${sc}44`,
                        }}>{pred.market.betRange}</div>
                        <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", marginTop:5 }}>
                          ~{pred.projected10} proj · pressão {pred.pressureMult}× · {pred.totalCorners} esc até agora
                        </div>
                      </div>
                    </div>

                    <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:18 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, marginBottom:12 }}>▸ FATORES ATIVOS ({pred.factors.length})</div>
                      {pred.factors.length === 0
                        ? <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b" }}>Sem fatores de pressão detectados</div>
                        : <div style={{ overflowY:"auto", maxHeight:240 }}>
                          {pred.factors.map((f,i) => (
                            <div key={i} style={{ marginBottom:9, paddingBottom:9, borderBottom:"1px solid #1a2235" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontFamily:"var(--mono)", fontSize:10, color: impactColor(f.impact), flex:1 }}>{f.text}</span>
                                <span style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", marginLeft:8, whiteSpace:"nowrap" }}>{f.detail}</span>
                              </div>
                              <div style={{ height:2, background:"#1a2235", borderRadius:1 }}>
                                <div style={{ height:"100%", width: f.impact==="high"?"100%":f.impact==="medium"?"60%":"30%", background:impactColor(f.impact), borderRadius:1 }}/>
                              </div>
                            </div>
                          ))}
                        </div>}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ background:"#0d1117", border:"1px solid #1c2333", borderRadius:10, padding:18, marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                      <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2 }}>▸ ESTATÍSTICAS BILATERAIS</div>
                      <div style={{ display:"flex", gap:14 }}>
                        <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0", fontWeight:700 }}>{selected.homeShort}</span>
                        <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"#f0c040", fontWeight:700 }}>{selected.awayShort}</span>
                      </div>
                    </div>
                    <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, marginBottom:8 }}>— INDICADORES DIRETOS —</div>
                    <StatBar label="Escanteios ⭐" homeVal={selected.corners?.home} awayVal={selected.corners?.away} highlight/>
                    <StatBar label="Cruzamentos ⭐" homeVal={selected.crosses?.home} awayVal={selected.crosses?.away} highlight/>
                    <StatBar label="Chutes Bloqueados" homeVal={selected.blockedShots?.home} awayVal={selected.blockedShots?.away}/>
                    <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, margin:"10px 0 8px" }}>— PRESSÃO E VOLUME —</div>
                    <StatBar label="Posse (%)" homeVal={selected.possession?.home?.toFixed(0)} awayVal={selected.possession?.away?.toFixed(0)}/>
                    <StatBar label="Chutes no Alvo" homeVal={selected.onTarget?.home} awayVal={selected.onTarget?.away}/>
                    <StatBar label="Total Chutes" homeVal={selected.shots?.home} awayVal={selected.shots?.away}/>
                    <StatBar label="Defesas Goleiro" homeVal={selected.saves?.home} awayVal={selected.saves?.away}/>
                    <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, margin:"10px 0 8px" }}>— CONTEXTO —</div>
                    <StatBar label="Faltas" homeVal={selected.fouls?.home} awayVal={selected.fouls?.away}/>
                    <StatBar label="Impedimentos" homeVal={selected.offsides?.home} awayVal={selected.offsides?.away}/>
                    <StatBar label="Cartões Amarelos" homeVal={selected.yellowCards?.home} awayVal={selected.yellowCards?.away}/>

                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:12 }}>
                      {[
                        { label:"MINUTO",     value:`${selected.minute}'`, color: selected.minute>=75?"#ff4560":"#c9d6e3" },
                        { label:"ESC TOTAL",  value:`${(selected.corners?.home??0)+(selected.corners?.away??0)}`, color:"#00e5a0" },
                        { label:"CRUZAMENTOS",value:`${(selected.crosses?.home??0)+(selected.crosses?.away??0)}`, color:"#f0c040" },
                        { label:"PROJ 10MIN", value:`~${pred.projected10}`, color: pred.projected10>=1.5?"#00e5a0":"#f0c040" },
                      ].map((s,i)=>(
                        <div key={i} style={{ background:"#0a0f18", borderRadius:7, padding:"9px 10px", border:"1px solid #1c2333" }}>
                          <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:1, marginBottom:3 }}>{s.label}</div>
                          <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:18, color:s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Mercados */}
                  <div style={{ background:"#0d1117", border:`1px solid ${isStrong ? "#00e5a033" : "#1c2333"}`, borderRadius:10, padding:18 }}>
                    <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:2, marginBottom:12 }}>▸ MERCADOS SUGERIDOS</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <div style={{ background: isStrong ? "#00e5a00d" : "#0a0f18", border:`1px solid ${isStrong ? "#00e5a044" : "#1c2333"}`, borderRadius:8, padding:"12px 14px" }}>
                        <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", marginBottom:4 }}>PRÓXIMOS 10 MINUTOS</div>
                        <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:15, color: isStrong ? "#00e5a0" : "#c9d6e3" }}>{pred.market.betRange}</div>
                        <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#4a6070", marginTop:3 }}>Projeção: ~{pred.projected10} esc</div>
                      </div>
                      <div style={{ background:"#0a0f18", border:"1px solid #1c2333", borderRadius:8, padding:"12px 14px" }}>
                        <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", marginBottom:4 }}>TOTAL DO JOGO</div>
                        <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:15, color:"#f0c040" }}>{pred.market.gameRange}</div>
                        <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#4a6070", marginTop:3 }}>Projeção final: {pred.market.projGame}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <footer style={{ borderTop:"1px solid #1c2333", padding:"10px 20px", textAlign:"center" }}>
          <span style={{ fontFamily:"var(--mono)", fontSize:8, color:"#3d4f6b", letterSpacing:1 }}>
            CORNEREDGE v4.1 · ESPN API · APOSTAS ENVOLVEM RISCO FINANCEIRO
          </span>
        </footer>
      </div>
    </>
  );
}
