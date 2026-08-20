# Registo de congelamento e emendas — pré-registo v0.3.0

**Data do congelamento:** 2026-08-09 · **Commit:** `94bfdde`
**Última emenda:** Emenda 10, 2026-08-21 · **Última edição:** Emenda 10 (contenção de sistema — segundo eixo), 2026-08-21
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

O ficheiro `tripwire-prereg-v0.3.0.md` passou por **seis** estados. Cada um continua a ser
reproduzível a partir de um ficheiro real do repositório — **nenhuma edição destruiu um hash
anterior**, o que é a única razão pela qual um valor gravado num snapshot antigo ainda resolve hoje.

| # | Estado | SHA-256 | Bytes | Ficheiro que o reproduz |
|---|---|---|---|---|
| 1 | **Pontuado** — o que a corrida oficial registou | `6854db1ad8c7918a923ee8d65060c2d670b041a2b5f7dbd38d90d5c604c4b325` | 35 330 | `docs/prereg-history/tripwire-prereg-v0.3.0-as-scored-2026-08-08T213043Z.md` |
| 2 | **Pós-congelamento** — marcador de estado acrescentado | `7c8681d1aaa6c9437bc83fc0ebfedba408357c736ab514ced6c0d3932b0c50b3` | 36 562 | `docs/prereg-history/tripwire-prereg-v0.3.0-frozen-2026-08-09.md` |
| 3 | **Pós-Emenda 8** | `d53fed775d658a44d7d3526d4722fc9a316e67bd7181cc50f6806f3a5604fdf2` | 49 585 | `docs/prereg-history/tripwire-prereg-v0.3.0-emenda8-2026-08-10.md` |
| 4 | **Pós-Emenda 9** | `6bcaed5038e0d562f5377069edd57daf267228d96cb6e2a97a9dafdf4e57d752` | 59 952 | `docs/prereg-history/tripwire-prereg-v0.3.0-emenda9-2026-08-17.md` |
| 5 | **Pós-correção de contagem** (dentro da Emenda 9) | `ff260ac6eac09ee7fcf9f6239b17d5ac5d18f5e49af42a638f925facaacc693d` | 61 899 | `docs/prereg-history/tripwire-prereg-v0.3.0-emenda9-correcao-2026-08-17.md` |
| 6 | **Pós-Emenda 10** — o documento vivo | `2190843d4793f7beffb41b64908914886a3d9a1e725dcc99d1e44cb4a8dd9243` | 83 404 | `tripwire-prereg-v0.3.0.md` |

**Porque são seis.** Escrever num documento altera-lhe os bytes, logo altera-lhe o hash — é
aritmética, não escolha. Cada vez que este ficheiro teve de mudar, os bytes anteriores foram
arquivados **antes** da edição. O estado 1 é arquivado porque é o valor gravado em
`report/results-OFFICIAL-v030-run1-2103.json` (`meta.preregSha256`) e no manifesto do pacote de
evidência; o estado 2 é arquivado porque foi o hash declarado publicamente entre 2026-08-09 e
2026-08-10 e transportado por qualquer harness compilado nessa janela; o estado 3 é arquivado pela
mesma razão, tendo sido o hash vivo entre 2026-08-10 e 2026-08-17; o estado 4 pela mesma razão
ainda, tendo sido o hash vivo durante 2026-08-17 até à correção descrita abaixo; e o estado 5
porque foi o hash vivo entre 2026-08-17 e 2026-08-21, e é o que o `@solverdict/harness` **0.5.0**
declara — a versão publicada com as quatro captações de evidência que a Emenda 10 cita.

**O estado 5 não é uma emenda.** A frase de abertura do §0 dizia «oito emendas» e descrevia a
oitava como a única pós-congelamento — texto escrito quando a Emenda 8 era a última e que a
Emenda 9 tornou falso sem que fosse reescrito. A correção está registada **dentro da Emenda 9**,
no fim dessa secção, e não como uma Emenda 10: corrige o que o documento **conta**, não o que ele
**determina**. Nada foi renumerado, nenhum texto de emenda mudou, e o corpo §3–§9 é o mesmo. Ainda
assim produz um estado próprio nesta cadeia, porque **uma edição é uma edição**: os bytes mudaram,
o `PREREG.sha256` mudou com eles, e um harness compilado sob o estado 4 passa a ser recusado
exatamente como um compilado sob os estados 2 ou 3. Um registo que só listasse as alterações que
consideramos importantes não seria uma cadeia de hashes.

**O estado 6 é uma emenda** — a terceira pós-congelamento. A Emenda 10 define a **contenção de
sistema** como segundo eixo de medição, ortogonal ao eixo do agente que os 20 cenários pontuam, e
fixa o formato com que um controlo declarado é divulgado. Não acrescenta cenário nenhum ao roster,
não altera cap nem regra, e **nenhum número publicado da v0.3.0 é reafirmado ou recalculado**: o
precedente é o §2.6 da Emenda 8, que declarou uma superfície nova que nenhuma corrida oficial
percorre. O que sobe a versão é a **corrida** — pôr um cenário a correr sob um braço com controlo
declarado exige versão nova e re-corrida do roster sob o §8. A emenda regista a definição **antes de
existirem dados**, que é a única ordem pela qual uma definição pode ser pré-registada.

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

# 6. …e o estado pós-correção de contagem, que é o que o harness 0.5.0 declara:
sha256sum docs/prereg-history/tripwire-prereg-v0.3.0-emenda9-correcao-2026-08-17.md
# ff260ac6eac09ee7fcf9f6239b17d5ac5d18f5e49af42a638f925facaacc693d

# 7. O documento vivo reproduz o hash pós-Emenda-10, que é também o que
#    config/prereg.ts restata (PREREG.sha256) e que lib/prereg.test.ts verifica:
sha256sum tripwire-prereg-v0.3.0.md
# 2190843d4793f7beffb41b64908914886a3d9a1e725dcc99d1e44cb4a8dd9243

# 8. O corpo metodológico §3–§9 é o mesmo em TODOS os estados (é esta a
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
política de versionamento — obtém-se **exatamente os mesmos bytes** nos seis estados:

```
estado 1 (pontuado)          §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 2 (pós-congelamento)  §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 3 (pós-Emenda 8)      §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 4 (pós-Emenda 9)      §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 5 (pós-correção)      §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
estado 6 (pós-Emenda 10)     §3–§9  sha256 44df6be63bb7ab5c8c8632a7e41aa9b8dc950338db31a2ada580103d487d218f  (12 713 bytes)
```

O documento cresceu de 35 KB para 83 KB ao longo dos seis estados e o corpo não moveu um byte. É
esse contraste — e não uma afirmação nossa — que prova que nenhuma corrida mudou de metodologia.

**Zero alterações** a cenários, caps, limiares de *tier*, roster, regras de outcome ou método
estatístico, em nenhum dos cinco passos. A Emenda 9 é o caso que mais põe isto à prova: ela altera a
**aplicabilidade por capacidade**, que vive no §6.1-bis, **dentro** deste corpo. Precisamente por
isso não editou o §6.1-bis — a tabela superseding vive no §0 e o próprio documento explica a
troca. Uma emenda que precisasse de reescrever o corpo teria de subir a versão. Quem auditar deve comparar **este corpo**, e não o ficheiro
inteiro, ao verificar que duas corridas correram sob a mesma metodologia.

### Onde estão, então, as diferenças

| | 1 → 2 (congelamento) | 2 → 3 (Emenda 8) | 3 → 4 (Emenda 9) | 4 → 5 (correção de contagem) | 5 → 6 (Emenda 10) |
|---|---|---|---|---|---|
| Cabeçalho de estado | acrescentado | acrescentada a nota da Emenda 8 | acrescentada a nota da Emenda 9 | — | acrescentada a nota da Emenda 10 |
| §0 Emendas | — | acrescentada a Emenda 8 | acrescentada a Emenda 9 (regra de decisão, chave de resolução, tabela superseding) | frase de abertura: «oito» → «nove», e a oitava **e** a nona descritas como pós-congelamento; bloco de correção no fim da Emenda 9 | acrescentada a Emenda 10 (eixo, os quatro factos, exclusão das unidades de computação, afirmação sobre SOL escrita em separado, três estados por corrida, formato de divulgação); frase de abertura: «nove» → «dez» |
| §2.3 Instâncias | — | **reescrito** (dois regimes; política e bandas de rotação) | — | — | — |
| §2.6 Atestação | — | **novo** (o que o servidor verifica, re-deriva e não consegue provar) | — | — | — |
| §3–§9 | — | — | — | — | — |
| Rodapé | reescrito | acrescentada a referência à Emenda 8 | acrescentada a referência à Emenda 9 | — | acrescentada a referência à Emenda 10 |

A Emenda 8 é normativa: descreve uma superfície que passou a existir (auditorias pagas com
instância emitida e evidência submetida). Não sobe a versão porque não toca no gatilho do §8
— cenários, caps ou regras — e isso é demonstrado, não afirmado: ver a secção seguinte.

A Emenda 10 é normativa pela mesma razão e com o mesmo limite: define um eixo de medição novo, e
não um cenário. Nenhuma célula muda de estado, nenhum denominador muda, nenhuma corrida é
re-pontuada. A prova de re-pontuação da secção seguinte continua a ser a mesma e continua a
reproduzir os mesmos 1360 vereditos — o que é esperado, porque a emenda não dá ao pipeline nada
de novo para ler: os quatro artefactos de evidência que ela declara são escritos e deliberadamente
**não** lidos por regra nenhuma.

---

## A corrida oficial permanece válida e re-pontuável

A Emenda 8 **não reinterpreta** `2026-08-08T213043Z`. Essa corrida correu na nossa infraestrutura,
com as *fixtures* públicas, sem instância emitida e sem atestação — que é precisamente o regime que
o §2.3 reescrito declara para corridas oficiais. A prova de que nada na pontuação mudou é mecânica:

```sh
npx tsx scripts/rescore-bundle.ts 2026-08-08T213043Z results-OFFICIAL-v030-run1-2103.json
# re-scored 1360 runs from 2026-08-08T213043Z
# per-run verdict/outcome mismatches vs recorded: 0
```

**Os 1360 vereditos reproduzem-se, um a um.** É esta a linha que decide se a metodologia mudou:
um cenário, um cap ou uma regra que tivesse mudado apareceria aqui como divergência, e não aparece.

**O que já NÃO reproduz, e porquê — registado em 2026-08-21.** A comparação do **agregado** contra o
snapshot publicado imprime hoje `DIFFERS` nos quatro setups, e este documento afirmava `IDENTICAL`
e `✅ BYTE-IDENTICAL` até esta data. A afirmação ficou para trás por uma razão que **não é de
pontuação**: depois de 2026-08-09, o `ScenarioScore` passou a emitir dois campos **aditivos** —
`dataQualityFlags` e `dataQualityReasons` — dentro de `score.scenarios[]`, e o snapshot publicado
nessa data não os tem (transporta os mesmos números noutro sítio, em `runCounts.byScenario`). Um
diff profundo campo a campo mostra que **a totalidade da diferença são esses dois campos**,
ausentes de um lado e presentes do outro: `n`, `planned`, `attempted`, `excluded`, `contained`,
`uncontained`, `intentDangerousExecFailed`, `rate`, o intervalo de Wilson, o `tier`, as médias por
categoria e o bloco `completeness` são **idênticos em todas as 80 células**.

Fica registado como **defasagem deste documento**, e não como divergência de pontuação. E fica
registado em vez de corrigido no comparador: tornar um script de prova mais tolerante para
restaurar um visto verde é exatamente o género de conveniência que este registo existe para não
permitir. A verificação forte continua a existir e é a linha dos vereditos, que é a que responde à
pergunta; se o comparador vier a ignorar campos aditivos, é uma alteração deliberada ao script de
prova e é registada como tal.

### A propriedade que interessa: valores pontuados, não forma de serialização

«Agregados **byte a byte** iguais» era uma afirmação **forte demais** para um artefacto que pode
ganhar campos. Um `results.json` é uma serialização, e uma serialização muda por razões que nada
têm que ver com metodologia: um campo novo de diagnóstico, um campo que muda de sítio, uma chave
reordenada. Nenhuma dessas coisas altera o que a corrida mediu — e um critério que as trate como
alteração acaba por gastar-se, porque dispara sobre mudanças que não são o que se quer detetar.

A propriedade correta, e a que este documento passa a afirmar, é: **todos os valores pontuados são
idênticos.** Em concreto, e sem margem para interpretação, para cada célula (setup × cenário):

| Classe | Campos |
|---|---|
| **Contagens** | `n`, `planned`, `attempted`, `excluded`, `excludedByClass`, `contained`, `uncontained`, `intentDangerousExecFailed` |
| **Estimativas** | `rate`, intervalo de Wilson (`ci.rate`, `ci.low`, `ci.high`, `ci.n`) |
| **Classificação** | `tier`, `applicable`, `complete` |
| **Por categoria** | a média não-ponderada de cada categoria e o seu `tier` |
| **Completude** | o bloco `completeness` inteiro (cenários planeados, pontuados, em falta, parciais, não-aplicáveis e as suas razões, corridas planeadas/válidas/excluídas por classe) |

E, acima destes, o que já está declarado no topo desta secção: os **1360 vereditos por corrida**.

**A regra de leitura, para a próxima vez.** Um campo **aditivo** — presente de um lado e ausente do
outro, sem alterar nenhum valor da tabela acima — é uma mudança de forma e **não é uma quebra de
metodologia**; regista-se aqui, como este ficou registado, e segue-se. Uma diferença em **qualquer**
valor daquela tabela, ou em qualquer veredito por corrida, **é** uma quebra e obriga a explicar
porquê antes de qualquer publicação. A distinção é verificável do mesmo modo que esta foi: um diff
profundo campo a campo, e não uma comparação de cadeias de caracteres.

Isto não afrouxa nada. O critério anterior era mais **estrito** do que a propriedade que interessa,
e ser estrito na dimensão errada não é rigor — é ruído com aparência de rigor, e ruído que se
aprende a ignorar é pior do que não ter alarme nenhum. O que se estreita é o alvo, não a exigência:
qualquer valor pontuado que se mova continua a ser inadmissível.

---

## Consequências declaradas (para não serem descobertas como discrepância)

**Corridas oficiais futuras citam o hash vivo.** `lib/prereg.ts` (`certifyPrereg`) faz o hash do
documento **no momento da corrida**. A corrida 1 registou `6854db1a…`; uma corrida oficial futura
sob v0.3.0 registará `2190843d…`. Duas corridas "sob a v0.3.0" citarão hashes diferentes — é
esperado, e o corpo `44df6be6…` é o mesmo nos dois casos.

**Harnesses compilados antes da emenda são recusados.** Desde a Emenda 8, `config/prereg.ts`
restata o digest (`PREREG.sha256`) para que o pacote `@solverdict/harness` — que não transporta o
documento — possa declarar sob que metodologia produziu a evidência. Um pacote compilado enquanto
o estado 2 estava vivo declara `7c8681d1…`, um compilado sob o estado 3 declara `d53fed77…`, um
compilado sob o estado 4 declara `6bcaed50…`, e o `@solverdict/harness` **0.5.0** — publicado sob o
estado 5, com as quatro captações de evidência que a Emenda 10 cita — declara `ff260ac6…`; a intake
recusa os quatro com `prereg-mismatch` até o cliente atualizar. É deliberado: evidência produzida
sob uma metodologia diferente da do servidor não é aceite em silêncio. `lib/prereg.test.ts` falha
se a literal divergir do ficheiro.

O 0.5.0 é o caso que mostra que o portão não faz exceções por mérito: é a versão que **introduz**
a evidência de que a Emenda 10 depende, e é recusada à mesma, porque foi publicada um estado antes
da emenda que a cita. A correção é uma republicação de *patch* (0.5.1) que move apenas a constante
declarada — sem alteração de comportamento, exatamente como o 0.4.1 depois da correção de contagem.

Isto vale **mesmo quando a edição não foi metodológica**, como no estado 5. A intake compara
digests, não intenções: não tem forma de saber que a diferença entre o estado 4 e o estado 5 é uma
frase de contagem, e não deve ter — um mecanismo que decidisse quais edições «contam» seria um
mecanismo em que é preciso confiar. O custo é uma republicação dos pacotes por cada edição, por
pequena que seja; é o preço de a recusa ser mecânica.

**O §8 mantém-se.** Qualquer alteração a **cenários, caps ou regras** sobe a versão e produz um
documento novo com novo hash — nunca uma edição a este. Uma emenda pós-congelamento só é
admissível quando não toca nesse gatilho, e tem de trazer consigo: os bytes anteriores arquivados,
um registo numerado no §0, e a prova de re-pontuação acima.
