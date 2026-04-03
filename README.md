# ⚽ CornerEdge — Live Corner Bet Predictor

Aplicação Next.js que monitora jogos ao vivo via **ESPN API** e usa **Claude (Anthropic)** para recomendar entradas no mercado de escanteios nos próximos 10 minutos.

---

## 🚀 Deploy no Vercel (5 minutos)

### 1. Clone / Fork o repositório

```bash
git clone https://github.com/SEU_USUARIO/corneredge.git
cd corneredge
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Edite `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-SUA_CHAVE_AQUI
```

Obtenha sua chave em: [console.anthropic.com](https://console.anthropic.com/)

### 4. Rode localmente

```bash
npm run dev
# Acesse: http://localhost:3000
```

### 5. Deploy no Vercel

```bash
npm install -g vercel
vercel

# Quando perguntar sobre variáveis de ambiente:
# ANTHROPIC_API_KEY = sk-ant-SUA_CHAVE_AQUI
```

**Ou via interface web:**
1. Acesse [vercel.com](https://vercel.com) → New Project
2. Conecte seu repositório GitHub
3. Em **Environment Variables**, adicione:
   - `ANTHROPIC_API_KEY` = `sk-ant-SUA_CHAVE_AQUI`
4. Clique em **Deploy**

---

## 🏗️ Arquitetura

```
corneredge/
├── pages/
│   ├── index.jsx          # Frontend principal (React)
│   ├── _app.js            # Entry point Next.js
│   └── api/
│       ├── games.js       # Proxy ESPN API (server-side, sem CORS)
│       └── analyze.js     # Proxy Anthropic API (server-side, chave segura)
├── lib/
│   └── predictor.js       # Algoritmo de predição de escanteios
├── styles/
│   └── globals.css        # CSS global + variáveis
├── .env.local.example     # Template de variáveis
├── vercel.json            # Config Vercel
└── package.json
```

### Por que usar rotas de API no servidor?

| Problema | Solução |
|----------|---------|
| ESPN bloqueia requests do browser (CORS) | `/api/games.js` faz a chamada no servidor |
| Chave Anthropic não pode ficar no browser | `/api/analyze.js` usa `process.env` no servidor |

---

## 📡 ESPN API — Ligas Suportadas

| Liga | ID |
|------|----|
| Premier League | `eng.1` |
| La Liga | `esp.1` |
| Bundesliga | `ger.1` |
| Serie A | `ita.1` |
| Ligue 1 | `fra.1` |
| Primeira Liga (Portugal) | `por.1` |
| Brasileirão | `bra.1` |
| Champions League | `uefa.champions` |

Para adicionar mais ligas, edite o array `LEAGUES` em `pages/api/games.js`.

**Endpoint ESPN (público, sem autenticação):**
```
https://site.api.espn.com/apis/site/v2/sports/soccer/{league_id}/scoreboard
```

---

## 🧠 Algoritmo de Predição

O algoritmo em `lib/predictor.js` pontua cada jogo com base em 8 fatores:

| Fator | Peso máx |
|-------|----------|
| Pressão na zona final (>75%) | +25 |
| Domínio ataques perigosos | +20 |
| Chutes sem gol (pressão acumulada) | +15 |
| Chutes no alvo sem conversão | +12 |
| Ritmo de escanteios (>0.18/min) | +14 |
| Placar em desequilíbrio + fase final | +14 |
| Minuto do jogo (80'+) | +15 |
| Posse dominante + finalizações | +12 |

**Classificação:**
- `STRONG` (≥68%) → ✅ ENTRAR AGORA
- `MODERATE` (≥48%) → ⏳ AGUARDAR
- `WEAK` (<48%) → ❌ EVITAR

---

## 🔄 Modo Demo

Quando não há jogos ao vivo na ESPN (comum fora dos horários de jogo), o app entra em **modo demo** automaticamente com dados simulados realistas.

---

## ⚠️ Aviso Legal

> Este aplicativo é para fins educacionais e de análise. Apostas esportivas envolvem risco financeiro real. Jogue com responsabilidade. Nenhum algoritmo garante resultados.

---

## 📄 Licença

MIT
