# Registo de congelamento e emendas — pré-registo v0.3.0

**Data do congelamento:** 2026-08-09 · **Commit:** `94bfdde`
**Última emenda:** Emenda 9, 2026-08-17 · **Última edição:** correção de contagem do §0 (dentro da Emenda 9), 2026-08-17
**Documento:** `tripwire-prereg-v0.3.0.md`

Este ficheiro cumpre o §9.5 do pré-registo ("Publicar hash + commit no repositório").
Vive **fora** do documento porque nenhum documento pode conter o seu próprio hash.

---

## Corrida que desencadeou o congelamento

| | |
|---|---|
| `runId` | `2026-08-08T213043Z` |
| Seed de ordem de execução | `778906133` |
| Fingerprint do plano | `sha256:60b68e4e0f0303ea0f02724e7de3364d7df32a5f038055a2e54812baef2b3099` |
| Corridas planeadas | 1360 |
| Snapshot publicado | `report/results-OFFICIAL-v030-run1-2103.json` |
| Pacote de evidência | `runs/evidence/2026-08-08T213043Z.tar.gz` |

---

## A cadeia de hashes

O ficheiro `tripwire-prereg-v0.3.0.md` passou por **cinco** estados. Cada um continua a ser
reproduzível a partir de um ficheiro real do repositório — **nenhuma edição destruiu um hash
anterior**, o que é a única razão pela qual um valor gravado num snapshot antigo ainda resolve hoje.

| # | Estado | SHA-256 | Bytes | Ficheiro que o reproduz |
|---|---|---|---|---|
| 1 | **Pontuado** — o que a corrida oficial registou | `6854db1ad8c7918a923ee8d65060c2d670b041a2b5f7dbd38d90d5c604c4b325` | 35 330 | `docs/prereg-history/tripwire-prereg-v0.3.0-as-scored-2026-08-08T213043Z.md` |
| 2 | **Pós-congelamento** — marcador de estado acrescentado | `7c8681d1aaa6c9437bc83fc0ebfedba408357c736ab514ced6c0d3932b0c50b3` | 36 562 | `docs/prereg-history/tripwire-prereg-v0.3.0-frozen-2026-08-09.md` |
| 3 | **Pós-Emenda 8** | `d53fed775d658a44d7d3526d4722fc9a316e67bd7181cc50f6806f3a5604fdf2` | 49 585 | `docs/prereg-history/tripwire-prereg-v0.3.0-emenda8-2026-08-10.md` |
| 4 | **Pós-Emenda 9** | `6bcaed5038e0d562f5377069edd57daf267228d96cb6e2a97a9dafdf4e57d752` | 59 952 | `docs/prereg-history/tripwire-prereg-v0.3.0-emenda9-2026-08-17.md` |
| 5 | **Pós-correção de contagem** (dentro da Emenda 9) — o documento vivo | `ff260ac6eac09ee7fcf9f6239b17d5ac5d18f5e49af42a638f925facaacc693d` | 61 899 | `tripwire-prereg-v0.3.0.md` |

**Porque são cinco.** Escrever num documento altera-lhe os bytes, logo altera-lhe o hash — é
aritmética, não escolha. Cada vez que este ficheiro teve de mudar, os bytes anteriores foram
arquivados **antes** da edição. O estado 1 é arquivado porque é o valor gravado em
`report/results-OFFICIAL-v030-run1-2103.json` (`meta.preregSha256`) e no manifesto do pacote de
evidência; o estado 2 é arquivado porque foi o hash declarado publicamente entre 2026-08-09 e
2026-08-10 e transportado por qualquer harness compilado nessa janela; o estado 3 é arquivado pela
mesma razão, tendo sido o hash vivo entre 2026-08-10 e 2026-08-17; e o estado 4 pela mesma razão
ainda, tendo sido o hash vivo durante 2026-08-17 até à correção abaixo.

**O estado 5 não é uma emenda.** A frase de abertura do §0 dizia «oito emendas» e descrevia a
oitava como a única pós-congelamento — texto escrito quando a Emenda 8 era a última e que a
Emenda 9 tornou falso sem que fosse reescrito. A correção está registada **dentro da Emenda 9**,
no fim dessa secção, e não como uma Emenda 10: corrige o que o documento **conta**, não o que ele
**determina**. Nada foi renumerado, nenhum texto de emenda mudou, e o corpo §3–§9 é o mesmo. Ainda
assim produz um estado próprio nesta cadeia, porque **uma edição é uma edição**: os bytes mudaram,
o `PREREG.sha256` mudou com eles, e um harness compilado sob o estado 4 passa a ser recusado
exatamente como um compilado sob os estados 2 ou 3. Um registo que só listasse as alterações que
consideramos importantes não seria uma cadeia de hashes.

### Verificação

```sh
# 1. O hash que a corrida oficial registou reproduz-se no ficheiro arquivado:
sha256sum docs/prereg-history/tripwire-prereg-v0.3.0-as-scored-2026-08-08T213043Z.md
# 6854db1ad8c7918a923ee8d65060c2d670b041a2b5f7dbd38d90d5c604c4b325

# 2. …e é o valor gravado no snapshot e no manifesto de evidência:
grep preregSha256 report/results-OFFICIAL-v030-run1-2103.json
node -e "console.log(require('./runs/evidence/2026-08-08T213043Z.manifest.json').metadata.prereg.sha256)"

# 3. O hash pós-congelamento reproduz-se no seu próprio arquivo:
sha256sum docs/prereg-history/tripwire-prereg-v0.3.0-frozen-2026-08-09.md
# 7c8681d1aaa6c9437bc83fc0ebfedba408357c736ab514ced6c0d3932b0c50b3

# 4. O estado pós-Emenda-8 reproduz-se no seu próprio arquivo:
sha256sum docs/prereg-history/tripwire-prereg-v0.3.0-emenda8-2026-08-10.md
# d53fed775d658a44d7d3526d4722fc9a316e67bd7181cc50f6806f3a5604fdf2

# 5. …e o estado pós-Emenda-9, idem:
sha256sum docs/prereg-history/tripwire-prereg-v0.3.0-emenda9-2026-08-17.md
# 6bcaed5038e0d562f5377069edd57daf267228d96cb6e2a97a9dafdf4e57d752

# 6. O documento vivo reproduz o hash pós-correção, que é também o que
#    config/prereg.ts restata (PREREG.sha256) e que lib/prereg.test.ts verifica:
sha256sum tripwire-prereg-v0.3.0.md
# ff260ac6eac09ee7fcf9f6239b17d5ac5d18f5e49af42a638f925facaacc693d

# 7. O corpo metodológico §3–§9 é o mesmo em TODOS os estados (é esta a
#    comparação que decide se duas corridas correram sob a mesma metodologia):
awk '/^## 3\. Ambiente de teste/{b=1} b{print} /^Qualquer pessoa pode depois verificar/{if(b)exit}' \
  tripwire-prereg-v0.3.0.md | sha256sum
# 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
```

---

## O corpo metodológico nunca mudou

Este é o ponto que decide se duas corridas correram sob a mesma metodologia, e é **mecanicamente
verificável**: extraindo o corpo de `## 3. Ambiente de teste` até ao fim do §9 — ambiente, método
estatístico, categorias, rubric, regra dos três outcomes, aplicabilidade por capacidade, roster e
política de versionamento — obtém-se **exatamente os mesmos bytes** nos cinco estados:

```
estado 1 (pontuado)          §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 2 (pós-congelamento)  §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 3 (pós-Emenda 8)      §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 4 (pós-Emenda 9)      §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 5 (pós-correção)      §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
```

**Zero alterações** a cenários, caps, limiares de *tier*, roster, regras de outcome ou método
estatístico, em nenhum dos quatro passos. A Emenda 9 é o caso que mais põe isto à prova: ela altera a
**aplicabilidade por capacidade**, que vive no §6.1-bis, **dentro** deste corpo. Precisamente por
isso não editou o §6.1-bis — a tabela superseding vive no §0 e o próprio documento explica a
troca. Uma emenda que precisasse de reescrever o corpo teria de subir a versão. Quem auditar deve comparar **este corpo**, e não o ficheiro
inteiro, ao verificar que duas corridas correram sob a mesma metodologia.

### Onde estão, então, as diferenças

| | 1 → 2 (congelamento) | 2 → 3 (Emenda 8) | 3 → 4 (Emenda 9) | 4 → 5 (correção de contagem) |
|---|---|---|---|---|
| Cabeçalho de estado | acrescentado | acrescentada a nota da Emenda 8 | acrescentada a nota da Emenda 9 | — |
| §0 Emendas | — | acrescentada a Emenda 8 | acrescentada a Emenda 9 (regra de decisão, chave de resolução, tabela superseding) | frase de abertura: «oito» → «nove», e a oitava **e** a nona descritas como pós-congelamento; bloco de correção no fim da Emenda 9 |
| §2.3 Instâncias | — | **reescrito** (dois regimes; política e bandas de rotação) | — | — |
| §2.6 Atestação | — | **novo** (o que o servidor verifica, re-deriva e não consegue provar) | — | — |
| §3–§9 | — | — | — | — |
| Rodapé | reescrito | acrescentada a referência à Emenda 8 | acrescentada a referência à Emenda 9 | — |

A Emenda 8 é normativa: descreve uma superfície que passou a existir (auditorias pagas com
instância emitida e evidência submetida). Não sobe a versão porque não toca no gatilho do §8
— cenários, caps ou regras — e isso é demonstrado, não afirmado: ver a secção seguinte.

---

## A corrida oficial permanece válida e re-pontuável

A Emenda 8 **não reinterpreta** `2026-08-08T213043Z`. Essa corrida correu na nossa infraestrutura,
com as *fixtures* públicas, sem instância emitida e sem atestação — que é precisamente o regime que
o §2.3 reescrito declara para corridas oficiais. A prova de que nada na pontuação mudou é mecânica:

```sh
npx tsx scripts/rescore-bundle.ts 2026-08-08T213043Z results-OFFICIAL-v030-run1-2103.json
# re-scored 1360 runs from 2026-08-08T213043Z
# per-run verdict/outcome mismatches vs recorded: 0
#   IDENTICAL  baseline-scripted / model-only-claude / sak+claude / sak+gpt
# ✅ BYTE-IDENTICAL — server-side re-scoring reproduces the published verdict exactly.
```

Um cenário, um cap ou uma regra que tivesse mudado apareceria aqui como divergência.

---

## Consequências declaradas (para não serem descobertas como discrepância)

**Corridas oficiais futuras citam o hash vivo.** `lib/prereg.ts` (`certifyPrereg`) faz o hash do
documento **no momento da corrida**. A corrida 1 registou `6854db1a…`; uma corrida oficial futura
sob v0.3.0 registará `ff260ac6…`. Duas corridas "sob a v0.3.0" citarão hashes diferentes — é
esperado, e o corpo `44df6be6…` é o mesmo nos dois casos.

**Harnesses compilados antes da emenda são recusados.** Desde a Emenda 8, `config/prereg.ts`
restata o digest (`PREREG.sha256`) para que o pacote `@solverdict/harness` — que não transporta o
documento — possa declarar sob que metodologia produziu a evidência. Um pacote compilado enquanto
o estado 2 estava vivo declara `7c8681d1…`, um compilado sob o estado 3 declara `d53fed77…`, e um
compilado sob o estado 4 declara `6bcaed50…`; a intake recusa os três com `prereg-mismatch` até o
cliente atualizar. É deliberado: evidência produzida sob uma metodologia diferente da do servidor
não é aceite em silêncio. `lib/prereg.test.ts` falha se a literal divergir do ficheiro.

Isto vale **mesmo quando a edição não foi metodológica**, como no estado 5. A intake compara
digests, não intenções: não tem forma de saber que a diferença entre o estado 4 e o estado 5 é uma
frase de contagem, e não deve ter — um mecanismo que decidisse quais edições «contam» seria um
mecanismo em que é preciso confiar. O custo é uma republicação dos pacotes por cada edição, por
pequena que seja; é o preço de a recusa ser mecânica.

**O §8 mantém-se.** Qualquer alteração a **cenários, caps ou regras** sobe a versão e produz um
documento novo com novo hash — nunca uma edição a este. Uma emenda pós-congelamento só é
admissível quando não toca nesse gatilho, e tem de trazer consigo: os bytes anteriores arquivados,
um registo numerado no §0, e a prova de re-pontuação acima.
