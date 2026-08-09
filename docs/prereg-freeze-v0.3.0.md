# Registo de congelamento — pré-registo v0.3.0

**Data do congelamento:** 2026-08-09
**Commit:** `94bfdde`
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

## Os dois hashes, e o que cada um significa

| | SHA-256 | Bytes | Ficheiro que o reproduz |
|---|---|---|---|
| **Hash pontuado** (o que a corrida oficial registou) | `6854db1ad8c7918a923ee8d65060c2d670b041a2b5f7dbd38d90d5c604c4b325` | 35 330 | `docs/prereg-history/tripwire-prereg-v0.3.0-as-scored-2026-08-08T213043Z.md` |
| **Hash pós-congelamento** (o documento vivo, com o marcador de estado) | `7c8681d1aaa6c9437bc83fc0ebfedba408357c736ab514ced6c0d3932b0c50b3` | 36 562 | `tripwire-prereg-v0.3.0.md` |

**Porque são dois.** Marcar um documento como congelado altera-lhe os bytes, logo altera-lhe o hash.
Não existe forma de inscrever o marcador de congelamento no ficheiro e preservar o hash que a
corrida registou — é uma impossibilidade aritmética, não uma escolha. O texto exato que a corrida
pontuou foi por isso **arquivado byte a byte** antes de qualquer edição, de modo a que o valor
gravado em `report/results-OFFICIAL-v030-run1-2103.json` (`meta.preregSha256`) e no manifesto do
pacote de evidência continue a resolver contra um ficheiro real do repositório, para sempre.

### Verificação

```sh
# 1. O hash que a corrida oficial registou reproduz-se no ficheiro arquivado:
sha256sum docs/prereg-history/tripwire-prereg-v0.3.0-as-scored-2026-08-08T213043Z.md
# 6854db1ad8c7918a923ee8d65060c2d670b041a2b5f7dbd38d90d5c604c4b325

# 2. …e é o valor gravado no snapshot e no manifesto de evidência:
grep preregSha256 report/results-OFFICIAL-v030-run1-2103.json
node -e "console.log(require('./runs/evidence/2026-08-08T213043Z.manifest.json').metadata.prereg.sha256)"

# 3. O documento vivo reproduz o hash pós-congelamento:
sha256sum tripwire-prereg-v0.3.0.md
# 7c8681d1aaa6c9437bc83fc0ebfedba408357c736ab514ced6c0d3932b0c50b3
```

---

## O delta é administrativo — a metodologia não mudou

A diferença entre o texto arquivado e o documento vivo está **exclusivamente** no cabeçalho de
estado (linha de data de commit, bloco `ESTADO`, bloco `Compromisso de imutabilidade`) e no
parágrafo de rodapé. Verificável: extraindo o corpo metodológico dos dois ficheiros — de
`## 0. Emendas desde v0.2.2` até à régua final — obtém-se o mesmo conteúdo, byte a byte:

```
corpo, ficheiro arquivado : sha256 48f87b8e2a02f8c67eef897338237f424e7fede5fb2510b90e97605fec4c5e5d  (33 524 bytes)
corpo, documento vivo     : sha256 48f87b8e2a02f8c67eef897338237f424e7fede5fb2510b90e97605fec4c5e5d  (33 524 bytes)
```

**Zero alterações** a cenários, caps, limiares de *tier*, roster, regras de outcome, método
estatístico ou a qualquer uma das sete emendas. Nenhum número publicado depende de qual dos dois
ficheiros se leia.

---

## Consequência para corridas futuras (declarada aqui para não ser descoberta como discrepância)

`lib/prereg.ts` (`certifyPrereg`) faz o hash do documento **vivo** no momento da corrida. Portanto:

- a **corrida 1** (`2026-08-08T213043Z`) registou `6854db1a…` — o texto pré-congelamento;
- qualquer **corrida oficial futura sob v0.3.0** registará `7c8681d1…` — o texto pós-congelamento.

Duas corridas oficiais "sob a v0.3.0" citarão portanto hashes diferentes. Isso é **esperado** e é
o delta administrativo descrito acima, não uma alteração de metodologia: o corpo `48f87b8e…` é o
mesmo nos dois casos. Quem auditar deve comparar o **corpo**, não o ficheiro inteiro, ao verificar
que duas corridas correram sob a mesma metodologia.

O §8 mantém-se: qualquer alteração a cenários, caps ou regras **sobe a versão** e produz um
documento novo com novo hash — nunca uma edição a este.
