import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import { projectCorners, generateDemoGame, analyzeFinalWindow } from "../lib/predictor";

// ── Thresholds ────────────────────────────────────────────────────────────────
const ALERT_THRESHOLD = 62;
const RED_THRESHOLD   = 75;
const BLOCK_ALERTS    = 82;

const confColor = (c, isEarly) => {
  if (isEarly) return c >= 72 ? "#f0c040" : c >= 55 ? "#f0c04088" : "#2a3a50";
  return c >= RED_THRESHOLD ? "#ff4560" : c >= ALERT_THRESHOLD ? "#00e5a0" : c >= 45 ? "#f0c040" : "#2a3a50";
};

// ── Responsive hook ───────────────────────────────────────────────────────────
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    fn();
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
}

// ── Money sound ───────────────────────────────────────────────────────────────
function playMoneySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [
      { f: 1200, t: 0.00, d: 0.08 },
      { f: 1400, t: 0.10, d: 0.08 },
      { f: 1600, t: 0.18, d: 0.10 },
      { f: 1900, t: 0.28, d: 0.14 },
    ].forEach(({ f, t, d }) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), n = ctx.currentTime + t;
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.setValueAtTime(f, n);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, n + d);
      g.gain.setValueAtTime(0, n);
      g.gain.linearRampToValueAtTime(0.35, n + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, n + d);
      o.start(n); o.stop(n + d + 0.05);
    });
    const c = ctx.createOscillator(), gc = ctx.createGain();
    c.connect(gc); gc.connect(ctx.destination);
    c.type = "triangle";
    c.frequency.setValueAtTime(800, ctx.currentTime + 0.42);
    c.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.70);
    gc.gain.setValueAtTime(0, ctx.currentTime + 0.42);
    gc.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.44);
    gc.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.70);
    c.start(ctx.currentTime + 0.42); c.stop(ctx.currentTime + 0.75);
    setTimeout(() => ctx.close(), 1000);
  } catch (e) {}
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const safe = (v, d = 0) => (v !== undefined && v !== null && !isNaN(v) ? Number(v) : d);

function formatKickoff(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
}

function Dot() {
  return <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:"#00e5a0", animation:"pulse 2s infinite", verticalAlign:"middle" }}/>;
}

// ── StatRow: compact bilateral stat ──────────────────────────────────────────
function StatRow({ label, h, a, accent }) {
  const hv = safe(h), av = safe(a), tot = hv + av;
  const pct = tot > 0 ? (hv / tot) * 100 : 50;
  const c = accent ? "#00e5a0" : "#3a4f60";
  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"'Space Mono',monospace", fontSize:10, marginBottom:2 }}>
        <span style={{ color: accent ? "#00e5a0" : "#c9d6e3", fontWeight: accent ? 700 : 400, minWidth:22 }}>{h ?? "—"}</span>
        <span style={{ color:"#3d4f6b", fontSize:9, textTransform:"uppercase", letterSpacing:.8 }}>{label}</span>
        <span style={{ color: accent ? "#f0c040" : "#c9d6e3", textAlign:"right", minWidth:22, fontWeight: accent ? 700 : 400 }}>{a ?? "—"}</span>
      </div>
      <div style={{ height:3, background:"#0f1825", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg, ${c}aa, ${c})`, borderRadius:2 }}/>
      </div>
    </div>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────
function Section({ title, badge, children, defaultOpen = true, accent }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border:"1px solid #1a2535", borderRadius:10, overflow:"hidden", marginBottom:10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 14px", background:"#0d1420", border:"none", cursor:"pointer",
        fontFamily:"'Space Mono',monospace", fontSize:9, color: accent || "#4a6070",
        letterSpacing:1.5, textTransform:"uppercase",
      }}>
        <span>{title} {badge && <span style={{ background:"#1a2535", padding:"1px 6px", borderRadius:3, marginLeft:6, color:"#3d4f6b" }}>{badge}</span>}</span>
        <span style={{ color:"#2a3a50", transition:"transform .2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
      </button>
      {open && <div style={{ padding:"12px 14px", background:"#080d16" }}>{children}</div>}
    </div>
  );
}

// ── Confidence ring ───────────────────────────────────────────────────────────
function ConfRing({ value, color }) {
  const r = 42, circ = 2 * Math.PI * r;
  const fill = circ - (circ * Math.min(value, 97) / 100);
  return (
    <div style={{ position:"relative", width:100, height:100, margin:"0 auto" }}>
      <svg width={100} height={100} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="#0f1825" strokeWidth={8}/>
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={fill}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s ease" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:28, lineHeight:1, color }}>{value}</div>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", letterSpacing:1 }}>CONF%</div>
      </div>
    </div>
  );
}

// ── Game Card ─────────────────────────────────────────────────────────────────
function GameCard({ game, onSelect, isSelected }) {
  if (game.isUpcoming) return (
    <div onClick={() => onSelect(game)} style={{
      background: isSelected ? "#0d1a2e" : "#090e18",
      border:`1px solid ${isSelected ? "#1e3a5f" : "#141e2e"}`,
      borderRadius:8, padding:"10px 12px", cursor:"pointer", marginBottom:6,
      transition:"all .15s",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:13, color:"#8a9ab0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {game.home} × {game.away}
          </div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", marginTop:2 }}>{game.leagueCountry} {game.league}</div>
        </div>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#f0c040", marginLeft:8, flexShrink:0 }}>{formatKickoff(game.startTime)}</div>
      </div>
    </div>
  );

  const pred = projectCorners(game);
  const { confidence: conf, isEarly, isFastTrack, entryWindow, subPhase, targetBetWindow } = pred;
  const isTooLate = entryWindow.isTooLate;
  const isStrong  = conf >= ALERT_THRESHOLD && !isTooLate;
  const isHot     = conf >= RED_THRESHOLD && !isTooLate;
  const sc        = isTooLate ? "#2a3a50" : confColor(conf, isEarly);
  const corners   = (game.corners?.home ?? 0) + (game.corners?.away ?? 0);

  return (
    <div onClick={() => onSelect(game)} style={{
      background: isSelected ? "#0b1625" : "#090e18",
      border:`1px solid ${isSelected ? sc + "66" : isHot ? sc + "33" : "#141e2e"}`,
      borderLeft:`3px solid ${isSelected ? sc : isStrong ? sc : "#1a2535"}`,
      borderRadius:8, padding:"10px 12px", cursor:"pointer", marginBottom:6,
      transition:"all .15s",
      boxShadow: isHot && !isTooLate ? `0 0 12px ${sc}22` : "none",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:13, color: isStrong ? "#e0eaf5" : "#6a7a90", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {game.home} × {game.away}
          </div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", marginTop:1 }}>
            {game.leagueCountry} {game.league}
          </div>
        </div>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:20, color: isStrong ? "#e0eaf5" : "#3a4f60", letterSpacing:-0.5, marginLeft:8, flexShrink:0 }}>
          {game.score.home}<span style={{ color:"#2a3a50", fontWeight:300 }}>-</span>{game.score.away}
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50" }}>{game.minute}'</span>
          <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50" }}>ESC:{corners}</span>
          {isFastTrack && <span style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#f0c040", background:"#f0c04015", padding:"1px 4px", borderRadius:3 }}>⚡FT</span>}
          {isTooLate && <span style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50" }}>⏰</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          {!isTooLate && targetBetWindow.isNext && (
            <span style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#00e5a0", background:"#00e5a010", padding:"1px 5px", borderRadius:3, border:"1px solid #00e5a022" }}>
              →{targetBetWindow.label}
            </span>
          )}
          <div style={{
            fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:14, letterSpacing:.5,
            color: isHot ? "#080d16" : isTooLate ? "#2a3a50" : sc,
            background: isHot && !isTooLate ? sc : isTooLate ? "#0f1825" : `${sc}18`,
            padding:"2px 8px", borderRadius:4, minWidth:40, textAlign:"center",
          }}>
            {isFastTrack && !isTooLate ? `⚡${conf}` : `${conf}%`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Alert Banner ──────────────────────────────────────────────────────────────
function AlertBanner({ alerts, onDismiss, soundOn, onToggleSound }) {
  if (!alerts.length) return null;
  return (
    <div style={{ background:"#030a06", borderBottom:"1px solid #00e5a033", padding:"0 14px", display:"flex", alignItems:"center", gap:8, minHeight:40, position:"sticky", top:50, zIndex:90 }}>
      <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#00e5a0", letterSpacing:1.5, flexShrink:0 }}>🔔</span>
      <div style={{ display:"flex", gap:6, flex:1, overflowX:"auto", alignItems:"center" }}>
        {alerts.map(a => (
          <button key={a.id} onClick={a.onClick} style={{
            flexShrink:0, display:"flex", alignItems:"center", gap:5,
            fontFamily:"'Space Mono',monospace", fontSize:8, background:"#00e5a00a",
            padding:"4px 8px", borderRadius:5, border:"1px solid #00e5a033",
            cursor:"pointer", whiteSpace:"nowrap", color:"#c9d6e3",
          }}>
            <span style={{ color:"#00e5a0", fontWeight:700 }}>{a.game}</span>
            <span style={{ color:"#2a3a50" }}>·</span>
            <span style={{ color:"#f0c040" }}>{a.minute}'</span>
            <span style={{
              background: a.confidence >= RED_THRESHOLD ? "#ff4560" : "#00e5a0",
              color:"#080d16", padding:"1px 5px", borderRadius:3, fontSize:7, fontWeight:700,
            }}>{a.confidence}%</span>
            {a.isNextWindow && (
              <span style={{ color:"#080d16", background:"#00e5a0", padding:"1px 4px", borderRadius:3, fontSize:7, fontWeight:700 }}>→{a.targetWindow}</span>
            )}
          </button>
        ))}
      </div>
      <button onClick={onToggleSound} style={{
        flexShrink:0, background:"none", border:"none", cursor:"pointer",
        fontSize:12, color: soundOn ? "#00e5a0" : "#2a3a50", padding:"0 4px",
      }}>{soundOn ? "🔊" : "🔇"}</button>
      <button onClick={onDismiss} style={{ flexShrink:0, background:"none", border:"none", color:"#2a3a50", cursor:"pointer", fontSize:13, padding:"0 4px" }}>✕</button>
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
function DetailPanel({ selected, prediction: pred, isMobile, onBack }) {
  if (!selected) return null;

  const isRed   = (pred?.confidence ?? 0) >= RED_THRESHOLD;
  const isGreen = (pred?.confidence ?? 0) >= ALERT_THRESHOLD;
  const isStrong = isRed || isGreen;
  const sc = pred ? confColor(pred.confidence, pred.isEarly) : "#2a3a50";
  const isTooLate = pred?.entryWindow?.isTooLate;
  const fw = !selected.isUpcoming ? analyzeFinalWindow(selected) : null;

  return (
    <div style={{ flex:1, minWidth:0, overflowY: isMobile ? "auto" : "visible" }}>
      {/* Match header */}
      <div style={{
        background:"#0d1420", border:"1px solid #1a2535", borderRadius:10,
        padding:"12px 14px", marginBottom:10,
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
          <div style={{ flex:1, minWidth:0 }}>
            {isMobile && (
              <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", color:"#3d4f6b", fontFamily:"'Space Mono',monospace", fontSize:9, padding:0, marginBottom:6, display:"flex", alignItems:"center", gap:4 }}>
                ← VOLTAR
              </button>
            )}
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize: isMobile ? 18 : 22, letterSpacing:.5, color:"#e0eaf5", lineHeight:1.1 }}>
              {selected.home}
              <span style={{ color:"#2a3a50", fontWeight:300 }}> × </span>
              {selected.away}
            </div>
            <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b", marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <span>{selected.leagueCountry} {selected.league}</span>
              {!selected.isUpcoming && (
                <><span style={{ color:"#1a2535" }}>·</span><span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Dot/><span style={{ color:"#00e5a0" }}>AO VIVO {selected.minute}' {selected.period===2?"2ºT":"1ºT"}</span></span></>
              )}
              {selected.isUpcoming && <span style={{ color:"#f0c040" }}>🕐 {formatKickoff(selected.startTime)}</span>}
            </div>
          </div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize: isMobile ? 36 : 44, letterSpacing:-2, lineHeight:1, flexShrink:0 }}>
            {selected.isUpcoming
              ? <span style={{ fontSize:13, color:"#f0c040", fontFamily:"'Space Mono',monospace", fontWeight:400 }}>EM BREVE</span>
              : <><span style={{ color:"#e0eaf5" }}>{selected.score.home}</span><span style={{ color:"#1a2535", fontSize:isMobile?22:28 }}>–</span><span style={{ color:"#e0eaf5" }}>{selected.score.away}</span></>
            }
          </div>
        </div>
      </div>

      {selected.isUpcoming ? (
        <div style={{ background:"#0d1420", border:"1px solid #1a2535", borderRadius:10, padding:24, textAlign:"center" }}>
          <div style={{ fontSize:28, marginBottom:8 }}>🕐</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:16, color:"#f0c040" }}>Início às {formatKickoff(selected.startTime)} (Brasília)</div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#3d4f6b", marginTop:4 }}>Análise disponível quando o jogo começar.</div>
        </div>
      ) : pred && (
        <>
          {/* ── SINAL PRINCIPAL ── */}
          <div style={{
            background:"#080d16", border:`1px solid ${isStrong && !isTooLate ? sc + "44" : "#1a2535"}`,
            borderRadius:10, padding:"14px", marginBottom:10,
            boxShadow: isHot(pred) && !isTooLate ? `0 0 20px ${sc}15` : "none",
          }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", flexWrap: isMobile ? "wrap" : "nowrap" }}>
              {/* Ring */}
              <div style={{ flexShrink:0 }}>
                <ConfRing value={pred.confidence} color={isTooLate ? "#2a3a50" : sc}/>
                <div style={{ textAlign:"center", marginTop:4, fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50" }}>
                  {pred.phase} · {pred.subPhase}
                  {pred.isFastTrack && <span style={{ color:"#f0c040", marginLeft:4 }}>⚡</span>}
                </div>
              </div>

              {/* Right side */}
              <div style={{ flex:1, minWidth:0 }}>
                {/* Mercado */}
                <div style={{
                  fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900,
                  fontSize: isMobile ? 16 : 18, letterSpacing:.5,
                  color: isStrong && !isTooLate ? "#080d16" : sc,
                  background: isStrong && !isTooLate ? sc : `${sc}15`,
                  padding:"7px 12px", borderRadius:6, marginBottom:8,
                  border: isStrong && !isTooLate ? "none" : `1px solid ${sc}33`,
                  display:"inline-block",
                }}>{pred.market.betRange}</div>

                {/* Janela alvo */}
                {(() => {
                  const tbw = pred.targetBetWindow;
                  const c2 = tbw.isNext ? "#00e5a0" : "#f0c040";
                  return (
                    <div style={{ background:`${c2}0d`, border:`1px solid ${c2}33`, borderRadius:7, padding:"8px 10px" }}>
                      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", letterSpacing:1.5, marginBottom:3 }}>
                        {tbw.isNext ? "APOSTAR NA PRÓXIMA FAIXA" : "FAIXA ATIVA"}
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:22, color:c2 }}>{tbw.label}</div>
                        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b" }}>{tbw.actionLabel}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Tempo e pós-gol */}
                <div style={{ marginTop:6, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  {(() => {
                    const w = pred.entryWindow;
                    const wc = w.urgency==="blocked"?"#2a3a50":w.urgency==="good"?"#00e5a0":w.urgency==="warning"?"#f0c040":"#ff4560";
                    const wi = w.urgency==="blocked"?"🚫":w.urgency==="good"?"✅":w.urgency==="warning"?"⚠️":"⏰";
                    return <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:wc }}>{wi} {w.label}</span>;
                  })()}
                  {pred.isPostGoalCooldown && (
                    <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#f0c040", background:"#f0c04010", padding:"2px 6px", borderRadius:4, border:"1px solid #f0c04033" }}>
                      ⚡ Reorg pós-gol — aguardar
                    </span>
                  )}
                </div>

                {/* Mini stats + AF status */}
                <div style={{ marginTop:8, fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                  <span>proj: ~{pred.projected10}/10min</span>
                  <span>pressão: {pred.pressureMult}×</span>
                  <span>esc: {pred.totalCorners}</span>
                  {pred.afEnriched && (
                    <span style={{ color:"#00e5a088", background:"#00e5a010", padding:"1px 5px", borderRadius:3, border:"1px solid #00e5a022" }}>
                      ● AF
                    </span>
                  )}
                  {!pred.afEnriched && selected.afFixtureId && (
                    <span style={{
                      color: selected.dataSource === "af-loading" ? "#2a7fff88" : "#f0c04088",
                      background: selected.dataSource === "af-loading" ? "#2a7fff10" : "#f0c04010",
                      padding:"1px 5px", borderRadius:3,
                      border: `1px solid ${selected.dataSource === "af-loading" ? "#2a7fff22" : "#f0c04022"}`,
                    }} title={selected.dataSource === "af-loading" ? "Stats chegando (jogo recém-iniciado)" : "Liga não reporta estatísticas em tempo real"}>
                      {selected.dataSource === "af-loading" ? "⏳ carregando" : "⚠ sem stats"}
                    </span>
                  )}
                  {pred.hasHistoricalData && (
                    <span style={{ color:"#f0c04088", background:"#f0c04010", padding:"1px 5px", borderRadius:3, border:"1px solid #f0c04022" }}>
                      hist
                    </span>
                  )}
                  {pred.oddsBoost !== 1.0 && pred.oddsBoost && (
                    <span style={{ color: pred.oddsBoost > 1 ? "#00e5a0" : "#ff4560", fontSize:7 }}>
                      odds {pred.oddsBoost > 1 ? "↑" : "↓"}{Math.round(Math.abs(pred.oddsBoost - 1) * 100)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── FATORES ── */}
          {pred.factors.length > 0 && (
            <Section title="Fatores ativos" badge={pred.factors.length} accent="#00e5a0" defaultOpen>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {pred.factors.map((f, i) => (
                  <div key={i} style={{
                    display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"6px 10px", background:"#0d1420", borderRadius:6,
                    borderLeft:`3px solid ${f.impact==="high"?"#00e5a0":f.impact==="medium"?"#f0c040":"#2a3a50"}`,
                  }}>
                    <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color: f.impact==="high"?"#00e5a0":f.impact==="medium"?"#f0c040":"#4a6070", flex:1 }}>{f.text}</span>
                    <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b", marginLeft:8, flexShrink:0 }}>{f.detail}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── ESTATÍSTICAS ── */}
          <Section title="Estatísticas" defaultOpen={!isMobile}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px", marginBottom:8 }}>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#00e5a0", fontWeight:700, textAlign:"left" }}>{selected.homeShort}</div>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#f0c040", fontWeight:700, textAlign:"right", gridColumn:"2" }}>{selected.awayShort}</div>
            </div>
            <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", letterSpacing:1.2, marginBottom:6 }}>DIRETOS</div>
            <StatRow label="Escanteios ★" h={selected.corners?.home} a={selected.corners?.away} accent/>
            <StatRow label="Cruzamentos ★" h={selected.crosses?.home} a={selected.crosses?.away} accent/>
            {selected.shotsInsideBox && (
              <StatRow label="Chutes Inside Box ★" h={selected.shotsInsideBox?.home} a={selected.shotsInsideBox?.away} accent/>
            )}
            <StatRow label="Chutes Bloq." h={selected.blockedShots?.home} a={selected.blockedShots?.away}/>
            <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", letterSpacing:1.2, margin:"8px 0 6px" }}>PRESSÃO</div>
            <StatRow label="Defesas" h={selected.saves?.home} a={selected.saves?.away}/>
            <StatRow label="No Alvo" h={selected.onTarget?.home} a={selected.onTarget?.away}/>
            <StatRow label="Chutes" h={selected.shots?.home} a={selected.shots?.away}/>
            {selected.dangerousAttacksReal && selected.dangerousAttacks && (
              <StatRow label="Ataques Perig. ★" h={selected.dangerousAttacks?.home} a={selected.dangerousAttacks?.away} accent/>
            )}
            <StatRow label="Posse %" h={selected.possession?.home?.toFixed(0)} a={selected.possession?.away?.toFixed(0)}/>
            <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", letterSpacing:1.2, margin:"8px 0 6px" }}>CONTEXTO</div>
            <StatRow label="Faltas" h={selected.fouls?.home} a={selected.fouls?.away}/>
            <StatRow label="Amarelos" h={selected.yellowCards?.home} a={selected.yellowCards?.away}/>
            <StatRow label="Impedimentos" h={selected.offsides?.home} a={selected.offsides?.away}/>

            {/* Dados históricos REAIS (API-Football) */}
            {(selected.historical?.homeAvgRaw || selected.historical?.awayAvgRaw || selected.historical?.h2hEstCorners) && (
              <>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", letterSpacing:1.2, margin:"8px 0 6px" }}>
                  HISTÓRICO REAL · API-FOOTBALL
                </div>
                {/* Cards de média */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                  {selected.historical.homeAvgRaw && (
                    <div style={{ background:"#0d1420", borderRadius:6, padding:"8px 10px", border:"1px solid #1a2535" }}>
                      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", marginBottom:2 }}>
                        {selected.homeShort} · últimos {selected.historical.homeGames} jogos
                      </div>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:20, color:"#00e5a0", lineHeight:1 }}>
                        {selected.historical.homeAvgRaw.toFixed(1)}
                        <span style={{ fontFamily:"'Space Mono',monospace", fontWeight:400, fontSize:9, color:"#3d4f6b", marginLeft:4 }}>esc/jogo</span>
                      </div>
                      {selected.historical.homeMin !== null && (
                        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", marginTop:2 }}>
                          min {selected.historical.homeMin} · max {selected.historical.homeMax}
                          {selected.historical.homeVariance < 2 && <span style={{ color:"#00e5a088", marginLeft:4 }}>↑ previsível</span>}
                        </div>
                      )}
                    </div>
                  )}
                  {selected.historical.awayAvgRaw && (
                    <div style={{ background:"#0d1420", borderRadius:6, padding:"8px 10px", border:"1px solid #1a2535" }}>
                      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", marginBottom:2 }}>
                        {selected.awayShort} · últimos {selected.historical.awayGames} jogos
                      </div>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:20, color:"#f0c040", lineHeight:1 }}>
                        {selected.historical.awayAvgRaw.toFixed(1)}
                        <span style={{ fontFamily:"'Space Mono',monospace", fontWeight:400, fontSize:9, color:"#3d4f6b", marginLeft:4 }}>esc/jogo</span>
                      </div>
                      {selected.historical.awayMin !== null && (
                        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", marginTop:2 }}>
                          min {selected.historical.awayMin} · max {selected.historical.awayMax}
                          {selected.historical.awayVariance < 2 && <span style={{ color:"#f0c04088", marginLeft:4 }}>↑ previsível</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Linha inferior: esperado + H2H + leagueAvg */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
                  {selected.historical.homeAvgRaw && selected.historical.awayAvgRaw && (
                    <div style={{ background:"#0d1420", borderRadius:6, padding:"6px 8px", border:"1px solid #1a2535", textAlign:"center" }}>
                      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", marginBottom:2 }}>ESPERADO/JOGO</div>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, color:"#c9d6e3" }}>
                        ~{(selected.historical.homeAvgRaw * 1.10 + selected.historical.awayAvgRaw * 0.92).toFixed(1)}
                      </div>
                    </div>
                  )}
                  {selected.historical.h2hEstCorners && (
                    <div style={{ background:"#0d1420", borderRadius:6, padding:"6px 8px", border:"1px solid #1a2535", textAlign:"center" }}>
                      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", marginBottom:2 }}>H2H ({selected.historical.h2hGames}j)</div>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, color:"#c9d6e3" }}>
                        ~{selected.historical.h2hEstCorners}
                      </div>
                    </div>
                  )}
                  {pred.leagueAvgUsed && (
                    <div style={{ background:"#0d1420", borderRadius:6, padding:"6px 8px", border:"1px solid #1a2535", textAlign:"center" }}>
                      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", marginBottom:2 }}>BASE/10MIN</div>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, color: pred.hasHistoricalData ? "#00e5a0" : "#3d4f6b" }}>
                        {(pred.leagueAvgUsed * 10).toFixed(2)}
                        {pred.hasHistoricalData && <span style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#00e5a066", marginLeft:2 }}>★</span>}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Formações e substituições */}
            {(selected.formations || (selected.substitutions?.length > 0)) && (
              <>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#2a3a50", letterSpacing:1.2, margin:"8px 0 6px" }}>
                  TÁTICA
                </div>
                {selected.formations && (
                  <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                    {[
                      { side: "Casa", form: selected.formations.home, score: selected.formations.homeAttackScore },
                      { side: "Fora", form: selected.formations.away, score: selected.formations.awayAttackScore },
                    ].map((f,i) => (
                      <div key={i} style={{ flex:1, background:"#0d1420", borderRadius:6, padding:"6px 8px", border:"1px solid #1a2535", textAlign:"center" }}>
                        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50" }}>{f.side}</div>
                        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:16, color: f.score>=2?"#00e5a0":f.score>0?"#f0c040":"#c9d6e3" }}>
                          {f.form || "—"}
                        </div>
                        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color: f.score>=2?"#00e5a0":f.score>0?"#f0c040":"#3d4f6b" }}>
                          {f.score>=2?"ofensivo":f.score>0?"equilibrado":"defensivo"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {selected.substitutions?.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    {selected.substitutions.slice(0, 5).map((s,i) => (
                      <div key={i} style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b", display:"flex", gap:6, alignItems:"center" }}>
                        <span style={{ color:"#2a3a50" }}>{s.minute}'</span>
                        <span style={{ color:"#00e5a0" }}>↑{s.playerIn}</span>
                        <span style={{ color:"#2a3a50" }}>↓{s.playerOut}</span>
                        <span style={{ color:"#2a3a50", fontSize:7 }}>{s.teamName?.split(" ").slice(0,2).join(" ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Grid de números rápidos */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginTop:10 }}>
              {[
                { l:"MINUTO", v:`${selected.minute}'`, c: selected.minute>=75?"#ff4560":"#c9d6e3" },
                { l:"ESCANTEIOS", v:`${(selected.corners?.home??0)+(selected.corners?.away??0)}`, c:"#00e5a0" },
                { l:"CRUZAMENTOS", v:`${(selected.crosses?.home??0)+(selected.crosses?.away??0)}`, c:"#f0c040" },
                { l:"PROJ 10MIN", v:`~${pred.projected10}`, c: pred.projected10>=1.5?"#00e5a0":"#f0c040" },
              ].map((s,i) => (
                <div key={i} style={{ background:"#0d1420", borderRadius:7, padding:"8px 8px", border:"1px solid #1a2535", textAlign:"center" }}>
                  <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", letterSpacing:.8, marginBottom:3 }}>{s.l}</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:16, color:s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── MERCADOS ── */}
          <Section title="Mercados sugeridos" defaultOpen={false}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div style={{ background:"#0d1420", border:`1px solid ${isStrong ? "#00e5a033" : "#1a2535"}`, borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", marginBottom:3 }}>PRÓXIMOS 10MIN</div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, color: isStrong ? "#00e5a0" : "#c9d6e3" }}>{pred.market.betRange}</div>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b", marginTop:2 }}>~{pred.projected10} esc</div>
              </div>
              <div style={{ background:"#0d1420", border:"1px solid #1a2535", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", marginBottom:3 }}>TOTAL DO JOGO</div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, color:"#f0c040" }}>{pred.market.gameRange}</div>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b", marginTop:2 }}>proj: {pred.market.projGame}</div>
              </div>
            </div>
          </Section>

          {/* ── 80-FIM ── */}
          {fw && (
            <div style={{ background: fw.gameIsSettled ? "#100608" : "#060d0c", border:`2px solid ${fw.verdictColor}55`, borderRadius:10, padding:14, marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", letterSpacing:1.5 }}>ANÁLISE 80-FIM · MERCADO DISPONÍVEL</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:20, color:fw.verdictColor, marginTop:2 }}>
                    {fw.verdictIcon} OVER 1.5 CORNERS
                  </div>
                  <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:fw.verdictColor, marginTop:2 }}>{fw.verdict}</div>
                  <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#3d4f6b", marginTop:1 }}>{fw.verdictDetail}</div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0, marginLeft:12 }}>
                  <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b" }}>TEMPO EFETIVO</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:24, color:"#f0c040", lineHeight:1 }}>~{fw.effectiveMins}min</div>
                  <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b" }}>+{fw.estimatedStoppage}min acrés.</div>
                </div>
              </div>

              {/* Prob bar */}
              <div style={{ background:"#0a0f18", borderRadius:8, padding:"12px 12px", marginBottom:10, border:`1px solid ${fw.verdictColor}33` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <div>
                    <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", marginBottom:2 }}>P(OVER 1.5 CORNERS)</div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:900, fontSize:40, color:fw.verdictColor, lineHeight:1 }}>{fw.probOver15}%</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b", marginBottom:2 }}>PROJ CORNERS</div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:26, color:"#c9d6e3" }}>~{fw.projCorners}</div>
                    <div style={{ fontFamily:"'Space Mono',monospace", fontSize:7, color:"#3d4f6b" }}>λ={fw.lambda}</div>
                  </div>
                </div>
                <div style={{ height:6, background:"#0f1825", borderRadius:3, overflow:"hidden", position:"relative" }}>
                  <div style={{ position:"absolute", left:"70%", top:0, bottom:0, width:2, background:"#2a3a50", zIndex:2 }}/>
                  <div style={{ width:`${fw.probOver15}%`, height:"100%", background:`linear-gradient(90deg, #1a4060, ${fw.verdictColor})`, transition:"width 1.2s", borderRadius:3 }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"'Space Mono',monospace", fontSize:7, color:"#2a3a50", marginTop:2 }}>
                  <span>0%</span><span>70% mínimo viável</span><span>100%</span>
                </div>
              </div>

              {fw.missingFor15 && (
                <div style={{ background:"#ff456010", border:"1px solid #ff456022", borderRadius:6, padding:"6px 10px", marginBottom:8, fontFamily:"'Space Mono',monospace", fontSize:8, color:"#ff4560" }}>
                  ⚠️ {fw.missingFor15}
                </div>
              )}

              {/* Fatores 80-FIM */}
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {fw.reasons.map((r, i) => (
                  <div key={i} style={{ padding:"5px 8px", background:"#0d1420", borderRadius:5, borderLeft:`3px solid ${r.color}` }}>
                    <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:r.color, fontWeight:r.strong?700:400 }}>{r.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function isHot(pred) {
  return pred && pred.confidence >= RED_THRESHOLD && !pred.entryWindow?.isTooLate;
}

// ── Main ──────────────────────────────────────────────────────────────────────
// ── StatsPanel: Dashboard de performance do Supabase ─────────────────────────
function StatsPanel({ data, loading }) {
  if (loading) return (
    <div style={{ textAlign:"center", padding:40, fontFamily:"var(--mono)", fontSize:10, color:"#2a3a50" }}>
      Carregando estatísticas...
    </div>
  );
  if (!data) return (
    <div style={{ textAlign:"center", padding:40, fontFamily:"var(--mono)", fontSize:10, color:"#2a3a50" }}>
      Supabase não configurado ou sem dados ainda.
    </div>
  );

  const summary = data.summary || [];
  const byLeague = data.byLeague || [];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:14, letterSpacing:2, color:"#f0c040" }}>
        PERFORMANCE
      </div>

      {/* Por faixa de confiança */}
      <div style={{ background:"#060a14", borderRadius:10, padding:14, border:"1px solid #141e2e" }}>
        <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#2a3a50", marginBottom:10, letterSpacing:1.5 }}>
          POR FAIXA DE CONFIANÇA
        </div>
        {summary.length === 0 && (
          <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#2a3a50" }}>Sem dados ainda</div>
        )}
        {summary.map((row, i) => (
          <div key={i} style={{
            display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"6px 0", borderBottom:"1px solid #0d1420",
          }}>
            <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b" }}>{row.confidence_range}</div>
            <div style={{ display:"flex", gap:16, alignItems:"center" }}>
              <span style={{ fontFamily:"var(--mono)", fontSize:8, color:"#2a3a50" }}>{row.total} jogos</span>
              <span style={{
                fontFamily:"var(--display)", fontWeight:700, fontSize:13,
                color: row.win_rate_pct >= 65 ? "#00e5a0" : row.win_rate_pct >= 50 ? "#f0c040" : "#ff4560",
              }}>
                {row.win_rate_pct ?? "—"}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Por liga */}
      {byLeague.length > 0 && (
        <div style={{ background:"#060a14", borderRadius:10, padding:14, border:"1px solid #141e2e" }}>
          <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#2a3a50", marginBottom:10, letterSpacing:1.5 }}>
            TOP LIGAS
          </div>
          {byLeague.slice(0, 8).map((row, i) => (
            <div key={i} style={{
              display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"5px 0", borderBottom:"1px solid #0d1420",
            }}>
              <div style={{ fontFamily:"var(--mono)", fontSize:9, color:"#3d4f6b", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {row.league_name}
              </div>
              <div style={{ display:"flex", gap:12, alignItems:"center", flexShrink:0 }}>
                <span style={{ fontFamily:"var(--mono)", fontSize:8, color:"#2a3a50" }}>{row.total}</span>
                <span style={{
                  fontFamily:"var(--display)", fontWeight:700, fontSize:12,
                  color: row.win_rate_pct >= 65 ? "#00e5a0" : row.win_rate_pct >= 50 ? "#f0c040" : "#ff4560",
                }}>
                  {row.win_rate_pct ?? "—"}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontFamily:"var(--mono)", fontSize:7, color:"#1a2535", textAlign:"center", paddingTop:4 }}>
        Registre resultados via app para acumular dados
      </div>
    </div>
  );
}

export default function Home() {
  const [games, setGames]       = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [selected, setSelected] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [alerts, setAlerts]     = useState([]);
  const [alertsVisible, setAlertsVisible] = useState(true);
  const [soundOn, setSoundOn]   = useState(true);
  const [loading, setLoading]   = useState(true);
  const [isDemo, setIsDemo]     = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab]           = useState("live");
  const [mobileView, setMobileView] = useState("list"); // "list" | "detail"
  const [statsData,    setStatsData]    = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const isMobile = useIsMobile();
  const prevSigs    = useRef({});
  const intervalRef = useRef(null);
  const selectedRef = useRef(null);
  const soundOnRef  = useRef(true);
  selectedRef.current = selected;

  const handleSelect = useCallback((game) => {
    setSelected(game);
    setPrediction(game.isUpcoming ? null : projectCorners(game));
    if (isMobile) setMobileView("detail");
  }, [isMobile]);
  const handleSelectRef = useRef(handleSelect);
  handleSelectRef.current = handleSelect;

  const handleBack = useCallback(() => {
    setMobileView("list");
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await fetch("/api/bets?action=stats");
      const d = await r.json();
      setStatsData(d);
    } catch {}
    setStatsLoading(false);
  }, []);

  const fetchGames = useCallback(async () => {
    try {
      const res = await fetch("/api/games");
      if (!res.ok) throw new Error();
      const data = await res.json();
      const demo = data.demo || false;
      setIsDemo(demo);
      const list = (data.games || []).sort((a, b) => {
        const pa = projectCorners(a).confidence, pb = projectCorners(b).confidence;
        return pb - pa;
      });
      const upList = data.upcoming || [];

      let newAlertFired = false;
      list.forEach(g => {
        const pred = projectCorners(g);
        const canAlert = pred.confidence >= ALERT_THRESHOLD
          && !pred.entryWindow.isTooLate
          && prevSigs.current[g.id] !== "ALERTED";
        if (canAlert) {
          setAlerts(a => [{
            id: `${g.id}-${Date.now()}`,
            game: `${g.homeShort||g.home.split(" ").pop()} × ${g.awayShort||g.away.split(" ").pop()}`,
            minute: g.minute,
            market: pred.market.betRange,
            confidence: pred.confidence,
            phase: pred.phase,
            subPhase: pred.subPhase,
            minsLeft: pred.entryWindow.minsLeft,
            targetWindow: pred.targetBetWindow.label,
            isNextWindow: pred.targetBetWindow.isNext,
            onClick: () => handleSelectRef.current(g),
          }, ...a].slice(0, 5));
          setAlertsVisible(true);
          newAlertFired = true;
        }
        if (pred.confidence >= ALERT_THRESHOLD) prevSigs.current[g.id] = "ALERTED";
        else if (pred.confidence < 55) prevSigs.current[g.id] = "reset";
      });

      if (newAlertFired && soundOnRef.current) playMoneySound();
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
    intervalRef.current = setInterval(fetchGames, 60000); // OTIMIZADO: 60s (era 30s)
    return () => clearInterval(intervalRef.current);
  }, [fetchGames]);

  // Stats for header
  const hotCount = games.filter(g => !g.isUpcoming && projectCorners(g).confidence >= RED_THRESHOLD && !projectCorners(g).entryWindow.isTooLate).length;
  const warmCount = games.filter(g => !g.isUpcoming && projectCorners(g).confidence >= ALERT_THRESHOLD && projectCorners(g).confidence < RED_THRESHOLD && !projectCorners(g).entryWindow.isTooLate).length;

  if (loading) return (
    <div style={{ background:"#040810", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
      <div style={{ fontSize:32 }}>⚽</div>
      <div style={{ fontFamily:"'Space Mono',monospace", fontSize:11, color:"#00e5a0", letterSpacing:1 }}>Conectando · 110+ ligas...</div>
      <div style={{ display:"flex", gap:6 }}>
        {[0,1,2].map(i => <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"#00e5a0", animation:`pulse 1.2s ${i*.2}s infinite` }}/>)}
      </div>
    </div>
  );

  return (
    <>
      <Head>
        <title>CornerEdge</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@300;500;700;900&display=swap" rel="stylesheet"/>
        <style>{`
          * { box-sizing:border-box; margin:0; padding:0; }
          body { background:#040810; }
          :root { --mono:'Space Mono',monospace; --display:'Barlow Condensed',sans-serif; }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
          ::-webkit-scrollbar { width:4px; }
          ::-webkit-scrollbar-track { background:#080d16; }
          ::-webkit-scrollbar-thumb { background:#1a2535; border-radius:2px; }
        `}</style>
      </Head>

      <div style={{ background:"#040810", minHeight:"100vh", color:"#c9d6e3" }}>

        {/* Header */}
        <header style={{
          background:"#060a14", borderBottom:"1px solid #141e2e",
          padding: isMobile ? "8px 12px" : "8px 20px",
          display:"flex", justifyContent:"space-between", alignItems:"center",
          position:"sticky", top:0, zIndex:100,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:26, height:26, background:"#00e5a0", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>⚽</div>
            <div>
              <div style={{ fontFamily:"var(--display)", fontWeight:900, fontSize:16, letterSpacing:2 }}>CORNER<span style={{ color:"#00e5a0" }}>EDGE</span></div>
              {!isMobile && <div style={{ fontFamily:"var(--mono)", fontSize:7, color:"#2a3a50", letterSpacing:1.5 }}>AF · 1200+ LIGAS</div>}
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 16 }}>
            {isDemo && <div style={{ fontFamily:"var(--mono)", fontSize:8, color:"#f0c040", background:"#f0c04012", padding:"2px 7px", borderRadius:4, border:"1px solid #f0c04033" }}>DEMO</div>}
            <div style={{ display:"flex", gap: isMobile ? 8 : 14 }}>
              {[
                { l: isMobile ? "AO VIVO" : "AO VIVO", v: games.length, c:"#00e5a0" },
                { l: isMobile ? "PRÓX" : "PRÓXIMOS", v: upcoming.length, c:"#f0c040" },
                { l:"🔴", v: hotCount, c:"#ff4560" },
                { l:"✓", v: warmCount, c:"#00e5a0" },
              ].map((s,i) => (
                <div key={i} style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"var(--mono)", fontSize:7, color:"#2a3a50" }}>{s.l}</div>
                  <div style={{ fontFamily:"var(--display)", fontWeight:700, fontSize:18, color:s.c, lineHeight:1 }}>{s.v}</div>
                </div>
              ))}
            </div>
            <button onClick={fetchGames} style={{
              fontFamily:"var(--mono)", fontSize:10, color:"#00e5a0",
              background:"#00e5a010", border:"1px solid #00e5a025",
              borderRadius:5, padding:"4px 9px", cursor:"pointer",
            }}>↻</button>
          </div>
        </header>

        {/* Alert banner */}
        {alertsVisible && (
          <AlertBanner
            alerts={alerts}
            onDismiss={() => setAlertsVisible(false)}
            soundOn={soundOn}
            onToggleSound={() => { const n = !soundOn; setSoundOn(n); soundOnRef.current = n; }}
          />
        )}

        {/* Body */}
        {isMobile ? (
          /* MOBILE: single column with view toggle */
          <div style={{ padding:"10px 12px", paddingBottom:80 }}>
            {mobileView === "list" ? (
              <>
                {/* Tabs */}
                <div style={{ display:"flex", gap:0, marginBottom:10, borderRadius:7, overflow:"hidden", border:"1px solid #141e2e" }}>
                  {[
                    { k:"live", l:`⚡ AO VIVO (${games.length})` },
                    { k:"upcoming", l:`🕐 PRÓXIMOS (${upcoming.length})` },
                  ].map(t => (
                    <button key={t.k} onClick={() => setTab(t.k)} style={{
                      flex:1, padding:"8px 4px", fontFamily:"var(--mono)", fontSize:9,
                      cursor:"pointer", border:"none",
                      background: tab===t.k ? "#00e5a0" : "#0d1420",
                      color: tab===t.k ? "#040810" : "#3d4f6b",
                      fontWeight: tab===t.k ? "700" : "400",
                    }}>{t.l}</button>
                  ))}
                </div>
                <div style={{ fontFamily:"var(--mono)", fontSize:7, color:"#2a3a50", letterSpacing:1.5, marginBottom:8, display:"flex", justifyContent:"space-between" }}>
                  <span>{tab==="live" ? "EM ANDAMENTO" : "PRÓXIMOS"}</span>
                  {lastUpdate && <span>{lastUpdate.toLocaleTimeString("pt-BR")}</span>}
                </div>
                {tab==="live" && games.length===0 && (
                  <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b", textAlign:"center", padding:20, background:"#0d1420", borderRadius:8 }}>
                    Nenhum jogo ao vivo.
                  </div>
                )}
                {(tab==="live" ? games : upcoming).map(g => (
                  <GameCard key={g.id} game={g} onSelect={handleSelect} isSelected={selected?.id===g.id}/>
                ))}
              </>
            ) : (
              <DetailPanel
                selected={selected}
                prediction={prediction}
                isMobile={isMobile}
                onBack={handleBack}
              />
            )}
          </div>
        ) : (
          /* DESKTOP: 2-column */
          <div style={{ display:"flex", maxWidth:1300, margin:"0 auto", padding:"14px 16px", gap:14 }}>

            {/* Sidebar */}
            <div style={{ width:280, flexShrink:0 }}>
              <div style={{ display:"flex", gap:0, marginBottom:10, borderRadius:7, overflow:"hidden", border:"1px solid #141e2e" }}>
                {[
                  { k:"live",     l:`⚡ AO VIVO (${games.length})` },
                  { k:"upcoming", l:`🕐 PRÓXIMOS (${upcoming.length})` },
                ].map(t => (
                  <button key={t.k} onClick={() => setTab(t.k)} style={{
                    flex:1, padding:"7px 4px", fontFamily:"var(--mono)", fontSize:8.5,
                    cursor:"pointer", border:"none",
                    background: tab===t.k ? "#00e5a0" : "#0d1420",
                    color: tab===t.k ? "#040810" : "#3d4f6b",
                    fontWeight: tab===t.k ? "700" : "400", transition:"all .15s",
                  }}>{t.l}</button>
                ))}
              </div>
              <div style={{ fontFamily:"var(--mono)", fontSize:7.5, color:"#2a3a50", letterSpacing:1.5, marginBottom:8, display:"flex", justifyContent:"space-between" }}>
                <span>{tab==="live" ? "EM ANDAMENTO" : "PRÓXIMOS"}</span>
                {lastUpdate && <span>{lastUpdate.toLocaleTimeString("pt-BR")}</span>}
              </div>
              {tab==="live" && games.length===0 && (
                <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#3d4f6b", textAlign:"center", padding:20, background:"#0d1420", borderRadius:8, border:"1px solid #141e2e" }}>
                  Nenhum jogo ao vivo.
                </div>
              )}
              <div style={{ maxHeight:"calc(100vh - 180px)", overflowY:"auto", paddingRight:2 }}>
                {(tab==="live" ? games : upcoming).map(g => (
                  <GameCard key={g.id} game={g} onSelect={handleSelect} isSelected={selected?.id===g.id}/>
                ))}
              </div>
            </div>

            {/* Detail */}
            <div style={{ flex:1, minWidth:0, maxHeight:"calc(100vh - 80px)", overflowY:"auto", paddingRight:2 }}>
              {selected ? (
                <DetailPanel selected={selected} prediction={prediction} isMobile={false} onBack={() => {}}/>
              ) : (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", flexDirection:"column", gap:12 }}>
                  <div style={{ fontSize:32 }}>⚽</div>
                  <div style={{ fontFamily:"var(--mono)", fontSize:10, color:"#2a3a50" }}>Selecione um jogo para ver a análise</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats Panel — mobile */}
        {isMobile && mobileView === "stats" && (
          <div style={{ padding:"16px 12px 100px", maxHeight:"calc(100vh - 80px)", overflowY:"auto" }}>
            <StatsPanel data={statsData} loading={statsLoading} />
          </div>
        )}

        {/* Mobile bottom bar */}
        {isMobile && (
          <div style={{
            position:"fixed", bottom:0, left:0, right:0,
            background:"#060a14", borderTop:"1px solid #141e2e",
            padding:"8px 20px", display:"flex", justifyContent:"center", gap:40,
            zIndex:200,
          }}>
            <button onClick={() => setMobileView("list")} style={{
              background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3,
              color: mobileView==="list" ? "#00e5a0" : "#2a3a50",
            }}>
              <span style={{ fontSize:16 }}>☰</span>
              <span style={{ fontFamily:"var(--mono)", fontSize:7 }}>JOGOS</span>
            </button>
            <button onClick={() => selected && setMobileView("detail")} style={{
              background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3,
              color: mobileView==="detail" ? "#00e5a0" : selected ? "#3d4f6b" : "#1a2535",
              opacity: selected ? 1 : 0.4,
            }}>
              <span style={{ fontSize:16 }}>📊</span>
              <span style={{ fontFamily:"var(--mono)", fontSize:7 }}>ANÁLISE</span>
            </button>
            <button onClick={() => { setMobileView("stats"); fetchStats(); }} style={{
              background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3,
              color: mobileView==="stats" ? "#f0c040" : "#2a3a50",
            }}>
              <span style={{ fontSize:16 }}>🏆</span>
              <span style={{ fontFamily:"var(--mono)", fontSize:7 }}>STATS</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
