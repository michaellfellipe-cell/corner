# CornerEdge v31

App Next.js de previsão de escanteios ao vivo. Mobile-first, deploy no Vercel.

## Novidades v31 (Hybrid: ESPN + API-Football)

### Arquitetura Híbrida
- **ESPN Scoreboard** (gratuito, sem quota) → descoberta de jogos ao vivo (20-50+)
- **API-Football** → estatísticas reais (crosses, DA, shots inside box)
- Anteriormente: AF retornava ~9 jogos; agora ESPN expande o pool para 20-50+

### Correções
- Textos "ESPN indisponível" removidos do predictor → mensagem correta por liga
- Label "ESPN · 110+ LIGAS" → "AF · 1200+ LIGAS" no cabeçalho

### Quota AF (Pro 7.500 req/dia)
| Chamada | Cache | Req/h pico |
|---|---|---|
| ESPN scoreboard | 30s | 0 (grátis) |
| AF live=all | 30s | 120 |
| AF stats (30 jogos) | **4min** (era 3min) | 450 |
| AF lineups | 4h | ~1 |
| AF upcoming | 15min | 4 |
| AF histórico | 8h | ~2 |
| **Total** | | **~577/h ≈ 5.500/dia** ✅ |

### Tipos de jogo
- `dataSource: "af"` — matched ESPN + AF, stats completas
- `dataSource: "espn-only"` — ESPN descobriu, AF não mapeou (stats nulas)
- `dataSource: "hybrid"` — upcoming enriquecido com ambas as fontes

## Variáveis de Ambiente
```
APIFOOTBALL_KEY=sua_chave_aqui
```

## Estrutura
```
pages/
  index.jsx              ← Frontend mobile-first, poll 60s
  api/
    games.js             ← Handler principal v31 (Hybrid)
    apifootball.js       ← Proxy AF
    analyze.js
lib/
  predictor.js           ← Algoritmo v10 (corrigido labels ESPN)
  apifootball.js         ← Cliente AF + matchAFFixture
```

## Deploy
```bash
git add -A && git commit -m "v31: hybrid ESPN+AF, more games, fix crosses label"
git push
```
