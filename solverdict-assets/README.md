# SolVerdict Brand Assets

Fonte canônica da identidade visual do SolVerdict. Os **SVGs são a verdade** — todo PNG/ICO é derivado deles via `rasterize.sh`.

## Conteúdo

```
svg/
  solverdict-symbol.svg            Símbolo, quadrado, transparente
  solverdict-symbol-dark.svg       Símbolo, quadrado, fundo #0B0F14
  solverdict-lockup.svg            Símbolo + wordmark + tagline, transparente
  solverdict-lockup-dark.svg       Idem, fundo #0B0F14
  solverdict-lockup-compact.svg    Símbolo + wordmark, SEM tagline (navbar/footer)
  solverdict-wordmark.svg          Só o texto, transparente
  solverdict-wordmark-dark.svg     Só o texto, fundo #0B0F14
  favicon.svg                      Símbolo minificado, fundo dark
  favicon-transparent.svg          Símbolo minificado, transparente

react/
  BrandLogo.tsx                    <SymbolLogo /> e <LockupLogo showTagline />

rasterize.sh                       Gera todos os PNG + ICO a partir dos SVGs
site.webmanifest                   Manifest PWA
tokens.json                        Paleta, gradientes, geometria, alturas mínimas
```

## Gerando os PNGs

```bash
sudo apt install -y librsvg2-bin
pip install Pillow --break-system-packages
./rasterize.sh
```

Produz `png/favicon-{16..512}.png`, `png/symbol-transparent-{16..512}.png`, `png/apple-touch-icon.png`, `png/lockup*.png`, `png/og-image.png` (1200×630) e `ico/favicon{,-transparent}.ico`.

## Integração (Next.js)

```bash
cp png/favicon-*.png png/apple-touch-icon.png png/og-image.png web/public/
cp ico/favicon.ico svg/favicon.svg site.webmanifest web/public/
cp react/BrandLogo.tsx web/components/
```

`web/app/layout.tsx`:

```tsx
import { Exo } from "next/font/google";

const exo = Exo({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-exo" });

export const metadata = {
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: { images: ["/og-image.png"] },
};

// themeColor vive no viewport export desde o Next 14 — não em metadata.
export const viewport = { themeColor: "#050816" };
```

Navbar e footer:

```tsx
import { LockupLogo } from "@/components/BrandLogo";

<LockupLogo height={32} />                 // sem tagline (default)
<LockupLogo height={120} showTagline />    // hero, docs, capas
```

## Três armadilhas

**1. Nunca rasterize com PIL.** `ImageDraw.line()` só oferece `joint="curve"`, que arredonda todo vértice. Isso arredonda o V do check e a ponta superior do hexágono — exatamente o oposto do `stroke-linejoin="miter"` e `stroke-linecap="butt"` que o design especifica. Use `rsvg-convert`.

Para conferir depois de rasterizar:

```bash
python3 -c "from PIL import Image; Image.open('png/favicon-512.png').crop((140,210,260,330)).resize((360,360), Image.NEAREST).save('/tmp/check.png')"
```

O bico do V tem que estar afiado.

**2. O tagline morre abaixo de ~80px.** Ele está em `font-size: 32` num viewBox de 440 de altura. A 30px de altura total sobram 2.2px de texto. Use `solverdict-lockup-compact.svg` ou `<LockupLogo />` sem `showTagline` em navbar e footer.

**3. Os gradientes usam `userSpaceOnUse` com coordenadas absolutas.** Isso é intencional: o símbolo pega a mesma fatia de cor no favicon e no lockup. Trocar para `objectBoundingBox` faria o gradiente se remapear às bounds de cada elemento e o símbolo divergiria do wordmark.

## Uso no PDF (jsPDF)

jsPDF core não embute SVG. Use `png/symbol-transparent-256.png` em base64 via `doc.addImage()`, sobre um `roundedRect` de `#0B0F14` — o relatório tem fundo claro e o gradiente precisa do backplate escuro para não sumir.

## Cores

| Token | Hex | Uso |
|---|---|---|
| `brand.green` | `#00E59A` | Início do gradiente, check mark |
| `brand.cyan` | `#00C2FF` | Meio do gradiente |
| `brand.blue` | `#4673FA` | Meio-fim, fim do wordmark |
| `brand.purple` | `#7B5CFF` | Fim do gradiente do símbolo |
| `brand.magenta` | `#D946EF` | Canto inferior-direito do símbolo |
| `surface.logoBackplate` | `#0B0F14` | Fundo dos favicons e badge do PDF |
| `surface.siteBackground` | `#050816` | Fundo real do site — `theme_color` |
| `text.muted` | `#B0BCC9` | Tagline, créditos |

## Nota do repositório

O arquivo `tripwire-prereg-v0.2.2.md` **não deve ser renomeado** (Amendment 5) — o prefixo autentica o timestamp da pré-registração via `git blame`.
