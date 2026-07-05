// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal i18n for the SaaS front end (Sprint 6). No i18next / next-intl — just
 * a flat dictionary + a `t(lang, key)` lookup. Language is persisted in the
 * `solverdict_lang` cookie: server components read it via next/headers cookies()
 * and client components read it from the LangProvider context.
 *
 * We deliberately do NOT translate technical strings: scenario IDs, placard tier
 * names, protocol JSON, or code samples. Those stay verbatim in both languages.
 */

export type Lang = "en" | "pt";

export const LANG_COOKIE = "solverdict_lang";

export function parseLang(v: string | null | undefined): Lang {
  return v === "pt" ? "pt" : "en";
}

const en = {
  // nav
  "nav.pricing": "Pricing",
  "nav.docs": "Docs",
  "nav.github": "GitHub",
  "nav.dashboard": "Dashboard",
  "nav.leaderboard": "Leaderboard",
  "nav.menu": "Menu",

  // back link
  "back.home": "← Back to home",

  // home
  "home.title.suffix": "— audit your Solana agent's safety",
  "home.hero.lead":
    "SolVerdict runs your Solana agent through 14 adversarial scenarios in 5 categories and scores every run with an objective, machine-checkable rule on a local mainnet fork — no real funds.",
  "home.hero.sub.a": "It measures one thing: when the agent meets a dangerous situation, does it",
  "home.hero.sub.contain": "contain",
  "home.hero.sub.b": "the wallet action or",
  "home.hero.sub.execute": "execute",
  "home.hero.sub.c": "it. You get a private verdict placard you can share by link.",
  "home.cta.start": "Start audit →",
  "home.cta.method": "View methodology (pre-registered)",
  "home.cta.repo": "GitHub repo",
  "home.how": "How it works",
  "home.step1.a": "Submit your agent's framework, model provider, and endpoint or repo on the",
  "home.step1.link": "audit page",
  "home.step2": "We queue the run and bench it against the pre-registered SolVerdict rubric.",
  "home.step3.a": "You get a private link —",
  "home.step3.b": "— that shows the verdict placard when the run finishes.",
  "home.note": "No login. The audit id is an unguessable UUID, so the link is the only key to your result.",

  // submit
  "submit.h1": "Start an audit",
  "submit.intro.a": "Your agent must implement the",
  "submit.intro.protocol": "SolVerdict Audit Protocol",
  "submit.intro.b": "See",
  "submit.intro.pricing": "pricing",
  "submit.intro.c": "for Free vs Paid.",
  "submit.connect": "Connect a wallet to submit an audit.",
  "submit.connect.note":
    "Your wallet identifies your submission (and signs the USDC payment for a paid audit). It never signs anything for the audit run itself.",
  "submit.tier.legend": "Audit tier",
  "submit.tier.free.name": "Free",
  "submit.tier.free.desc": "— N=1 per scenario, quick validation. One per wallet / 24h.",
  "submit.tier.paid.name": "Paid — 10 USDC",
  "submit.tier.paid.desc": "— N=20 per scenario, statistically robust.",
  "submit.field.endpoint": "Agent endpoint URL",
  "submit.field.endpoint.hint": "Must be HTTPS and publicly reachable. localhost / private IPs are rejected.",
  "submit.field.framework": "Framework name",
  "submit.field.model": "Model name",
  "submit.field.email": "Contact email",
  "submit.field.optional": "(optional)",
  "submit.field.email.hint": "We email you when the audit finishes (done or failed).",
  "submit.confirm.a": "I confirm my agent implements the",
  "submit.leaderboard": "Include this audit in the public leaderboard",
  "submit.leaderboard.hint": "If checked, the result (framework, model, containment rate) appears on the public leaderboard.",
  "submit.btn.paid": "Pay 10 USDC & queue audit",
  "submit.btn.free": "Queue free audit",
  "submit.busy.queuing": "Queuing…",
  "submit.busy.paying": "Confirm the USDC payment in your wallet…",
  "submit.busy.verifying": "Verifying payment on-chain…",
  "submit.done.badge": "Audit queued",
  "submit.done.h1": "Save this link",
  "submit.done.note": "It's the key to your result — no login required to view it.",
  "submit.done.cta": "View audit status →",

  // pricing
  "pricing.h1": "Pricing",
  "pricing.intro":
    "Both tiers run the same 14 adversarial scenarios against your live agent. They differ only in how many times each scenario runs — which determines the statistical confidence of the verdict.",
  "pricing.free.name": "Free",
  "pricing.free.p1": "N=1 per scenario",
  "pricing.free.p2": "Quick validation of protocol conformance + obvious failures",
  "pricing.free.p3": "One audit per wallet per 24h",
  "pricing.paid.name": "Paid",
  "pricing.paid.p1": "N=20 per scenario (280 runs)",
  "pricing.paid.p2": "Statistically robust — Wilson 95% CIs, official-style depth",
  "pricing.paid.p3": "No 24h limit",
  "pricing.paid.p4": "Pay in USDC on Solana mainnet",
  "pricing.how": "How payment works",
  "pricing.cta": "Start an audit →",

  // audit status
  "audit.h1": "Audit verdict",
  "audit.tested": "This audit tested:",
  "audit.framework": "framework:",
  "audit.model": "model:",
  "audit.refreshing": "Auto-refreshing…",
  "audit.loading": "Loading…",
  "audit.reason": "Reason:",
  "audit.share": "Share",
  "audit.share.copy": "Copy link",
  "audit.share.copied": "Copied!",
  "audit.share.x": "Share on X",
  "audit.share.farcaster": "Share on Farcaster",
  "audit.share.close": "Close",
  "audit.embed": "Embed badge",
  "audit.embed.markdown": "Markdown (for your README)",
  "audit.embed.html": "HTML",
  "audit.pdf": "Download PDF",
  "status.awaiting_payment": "Awaiting payment",
  "status.queued": "Queued",
  "status.running": "Running",
  "status.done": "Done",
  "status.failed": "Failed",
  "status.payment_failed": "Payment failed",

  // dashboard
  "dash.h1": "Your audits",
  "dash.connect": "Connect your wallet to see your audit history.",
  "dash.empty": "You haven't submitted any audits yet.",
  "dash.col.date": "Date",
  "dash.col.endpoint": "Endpoint",
  "dash.col.framework": "Framework",
  "dash.col.tier": "Tier",
  "dash.col.status": "Status",
  "dash.col.link": "",
  "dash.view": "View →",
  "dash.prev": "← Prev",
  "dash.next": "Next →",
  "dash.newaudit": "Start a new audit →",

  // leaderboard
  "lb.h1": "Public leaderboard",
  "lb.intro":
    "Audits whose submitters opted in to publish. Ranked by containment rate (contained scenarios out of those with valid runs).",
  "lb.empty": "No public audits yet. Submit one and opt in on the form.",
  "lb.col.rank": "#",
  "lb.col.framework": "Framework",
  "lb.col.model": "Model",
  "lb.col.tier": "Tier",
  "lb.col.rate": "Contained",
  "lb.col.wallet": "Wallet",
  "lb.col.date": "Date",
  "lb.col.link": "",
} as const;

export type TKey = keyof typeof en;

const pt: Record<TKey, string> = {
  "nav.pricing": "Preços",
  "nav.docs": "Docs",
  "nav.github": "GitHub",
  "nav.dashboard": "Painel",
  "nav.leaderboard": "Ranking",
  "nav.menu": "Menu",

  "back.home": "← Voltar ao início",

  "home.title.suffix": "— audite a segurança do seu agente Solana",
  "home.hero.lead":
    "O SolVerdict submete seu agente Solana a 14 cenários adversariais em 5 categorias e pontua cada execução com uma regra objetiva e verificável por máquina em um fork local da mainnet — sem fundos reais.",
  "home.hero.sub.a": "Ele mede uma coisa: quando o agente enfrenta uma situação perigosa, ele",
  "home.hero.sub.contain": "contém",
  "home.hero.sub.b": "a ação na carteira ou a",
  "home.hero.sub.execute": "executa",
  "home.hero.sub.c": ". Você recebe um placar de veredito privado que pode compartilhar por link.",
  "home.cta.start": "Iniciar auditoria →",
  "home.cta.method": "Ver metodologia (pré-registrada)",
  "home.cta.repo": "Repositório GitHub",
  "home.how": "Como funciona",
  "home.step1.a": "Envie o framework, o provedor de modelo e o endpoint ou repositório do seu agente na",
  "home.step1.link": "página de auditoria",
  "home.step2": "Colocamos a execução na fila e a avaliamos com a rubrica pré-registrada do SolVerdict.",
  "home.step3.a": "Você recebe um link privado —",
  "home.step3.b": "— que mostra o placar do veredito quando a execução termina.",
  "home.note": "Sem login. O id da auditoria é um UUID impossível de adivinhar, então o link é a única chave para o seu resultado.",

  "submit.h1": "Iniciar uma auditoria",
  "submit.intro.a": "Seu agente deve implementar o",
  "submit.intro.protocol": "Protocolo de Auditoria SolVerdict",
  "submit.intro.b": "Veja",
  "submit.intro.pricing": "preços",
  "submit.intro.c": "para Grátis vs Pago.",
  "submit.connect": "Conecte uma carteira para enviar uma auditoria.",
  "submit.connect.note":
    "Sua carteira identifica seu envio (e assina o pagamento em USDC para uma auditoria paga). Ela nunca assina nada para a execução da auditoria em si.",
  "submit.tier.legend": "Tipo de auditoria",
  "submit.tier.free.name": "Grátis",
  "submit.tier.free.desc": "— N=1 por cenário, validação rápida. Uma por carteira / 24h.",
  "submit.tier.paid.name": "Pago — 10 USDC",
  "submit.tier.paid.desc": "— N=20 por cenário, estatisticamente robusto.",
  "submit.field.endpoint": "URL do endpoint do agente",
  "submit.field.endpoint.hint": "Deve ser HTTPS e acessível publicamente. localhost / IPs privados são rejeitados.",
  "submit.field.framework": "Nome do framework",
  "submit.field.model": "Nome do modelo",
  "submit.field.email": "E-mail de contato",
  "submit.field.optional": "(opcional)",
  "submit.field.email.hint": "Avisamos por e-mail quando a auditoria terminar (concluída ou com falha).",
  "submit.confirm.a": "Confirmo que meu agente implementa o",
  "submit.leaderboard": "Incluir esta auditoria no ranking público",
  "submit.leaderboard.hint": "Se marcado, o resultado (framework, modelo, taxa de contenção) aparece no ranking público.",
  "submit.btn.paid": "Pagar 10 USDC e enfileirar",
  "submit.btn.free": "Enfileirar auditoria grátis",
  "submit.busy.queuing": "Enfileirando…",
  "submit.busy.paying": "Confirme o pagamento em USDC na sua carteira…",
  "submit.busy.verifying": "Verificando o pagamento on-chain…",
  "submit.done.badge": "Auditoria na fila",
  "submit.done.h1": "Salve este link",
  "submit.done.note": "É a chave para o seu resultado — nenhum login é necessário para vê-lo.",
  "submit.done.cta": "Ver status da auditoria →",

  "pricing.h1": "Preços",
  "pricing.intro":
    "Ambos os planos executam os mesmos 14 cenários adversariais contra seu agente ao vivo. Diferem apenas em quantas vezes cada cenário roda — o que determina a confiança estatística do veredito.",
  "pricing.free.name": "Grátis",
  "pricing.free.p1": "N=1 por cenário",
  "pricing.free.p2": "Validação rápida de conformidade com o protocolo + falhas óbvias",
  "pricing.free.p3": "Uma auditoria por carteira a cada 24h",
  "pricing.paid.name": "Pago",
  "pricing.paid.p1": "N=20 por cenário (280 execuções)",
  "pricing.paid.p2": "Estatisticamente robusto — ICs de Wilson 95%, profundidade de nível oficial",
  "pricing.paid.p3": "Sem limite de 24h",
  "pricing.paid.p4": "Pague em USDC na mainnet Solana",
  "pricing.how": "Como funciona o pagamento",
  "pricing.cta": "Iniciar uma auditoria →",

  "audit.h1": "Veredito da auditoria",
  "audit.tested": "Esta auditoria testou:",
  "audit.framework": "framework:",
  "audit.model": "modelo:",
  "audit.refreshing": "Atualizando…",
  "audit.loading": "Carregando…",
  "audit.reason": "Motivo:",
  "audit.share": "Compartilhar",
  "audit.share.copy": "Copiar link",
  "audit.share.copied": "Copiado!",
  "audit.share.x": "Compartilhar no X",
  "audit.share.farcaster": "Compartilhar no Farcaster",
  "audit.share.close": "Fechar",
  "audit.embed": "Selo para incorporar",
  "audit.embed.markdown": "Markdown (para o seu README)",
  "audit.embed.html": "HTML",
  "audit.pdf": "Baixar PDF",
  "status.awaiting_payment": "Aguardando pagamento",
  "status.queued": "Na fila",
  "status.running": "Executando",
  "status.done": "Concluída",
  "status.failed": "Falhou",
  "status.payment_failed": "Pagamento falhou",

  "dash.h1": "Suas auditorias",
  "dash.connect": "Conecte sua carteira para ver seu histórico de auditorias.",
  "dash.empty": "Você ainda não enviou nenhuma auditoria.",
  "dash.col.date": "Data",
  "dash.col.endpoint": "Endpoint",
  "dash.col.framework": "Framework",
  "dash.col.tier": "Plano",
  "dash.col.status": "Status",
  "dash.col.link": "",
  "dash.view": "Ver →",
  "dash.prev": "← Anterior",
  "dash.next": "Próxima →",
  "dash.newaudit": "Iniciar nova auditoria →",

  "lb.h1": "Ranking público",
  "lb.intro":
    "Auditorias cujos autores optaram por publicar. Ordenadas pela taxa de contenção (cenários contidos entre os que tiveram execuções válidas).",
  "lb.empty": "Nenhuma auditoria pública ainda. Envie uma e marque a opção no formulário.",
  "lb.col.rank": "#",
  "lb.col.framework": "Framework",
  "lb.col.model": "Modelo",
  "lb.col.tier": "Plano",
  "lb.col.rate": "Contido",
  "lb.col.wallet": "Carteira",
  "lb.col.date": "Data",
  "lb.col.link": "",
};

export const translations: Record<Lang, Record<TKey, string>> = { en, pt };

export function t(lang: Lang, key: TKey): string {
  return translations[lang][key] ?? en[key];
}
