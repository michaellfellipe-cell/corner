# CornerEdge v36

App Next.js de previsão de escanteios ao vivo para apostas. Mobile-first, deploy Vercel.

## Stack
- **Frontend**: Next.js 14, React 18, mobile-first
- **Dados ao vivo**: API-Football (AF) Pro — 7.500 req/dia
- **Persistência**: Supabase (PostgreSQL) — plano gratuito
- **Cron**: GitHub Actions a cada 5 minutos (gratuito)

## Arquitetura

```
AF /fixtures?live=all  → filtra MAIN_LEAGUES → stats por jogo → predictor
AF /fixtures?date=NS   → upcoming próximas 36h → filtrado por MAIN_LEAGUES
GitHub Actions cron    → /api/cron a cada 5min → snapshots + verificação
```

## Variáveis de Ambiente (Vercel)

| Variável | Descrição |
|---|---|
| `APIFOOTBALL_KEY` | Chave da API-Football (Pro) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_KEY` | service_role key do Supabase |
| `CRON_SECRET` | String aleatória para autenticar o cron |

## Secret GitHub Actions

Adicionar em **Repo → Settings → Secrets → Actions**:
- `CRON_SECRET` = mesmo valor do Vercel

## Deploy

```bash
git add -A
git commit -m "v35"
git push
```

## Como funciona a verificação automática

1. Jogo ao vivo → sinal STRONG/MODERATE → `logPrediction()` salva no Supabase
2. A cada 5 min → GitHub Actions → `/api/cron` → busca stats AF → `logSnapshot()` salva corners por minuto
3. Jogo encerra (FT) → cron detecta → `verifyPredictionsForFixture()` compara snapshots
4. Resultado calculado: corners na janela ≥ min_corners_needed → `win`, caso contrário `loss`
5. Aba 🏆 STATS no app exibe taxa de acerto por faixa de confiança

## Estrutura de arquivos

```
pages/
  index.jsx              ← Frontend mobile-first, poll 60s
  api/
    games.js             ← Handler principal AF v35
    cron.js              ← Cron: snapshots + verificação automática
    bets.js              ← API: consulta stats de performance
    analyze.js
    debug.js
lib/
  predictor.js           ← Algoritmo v10 com melhorias 1-5,7
  apifootball.js         ← Cliente AF + cache
  supabase.js            ← Cliente Supabase REST
.github/
  workflows/
    cron.yml             ← GitHub Actions cron a cada 5min
vercel.json
```
