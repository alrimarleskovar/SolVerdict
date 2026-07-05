// SPDX-License-Identifier: Apache-2.0
"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, t as translate, type Lang, type TKey } from "../lib/i18n";

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => translate("en", key),
});

/** Client-side language state. Seeded from the server-read cookie so the first
 *  client render matches SSR (no hydration flash). Changing the language writes
 *  the cookie and calls router.refresh() so server components re-read it too. */
export function LangProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const router = useRouter();

  const setLang = useCallback(
    (l: Lang) => {
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
      setLangState(l);
      router.refresh();
    },
    [router],
  );

  const value: LangContextValue = { lang, setLang, t: (key) => translate(lang, key) };
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
