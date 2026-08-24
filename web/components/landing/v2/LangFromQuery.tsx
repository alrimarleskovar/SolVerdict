// SPDX-License-Identifier: Apache-2.0
/**
 * Makes `?lang=pt` / `?lang=en` a real, shareable entry point into a language.
 *
 * The site stores language in a cookie, which is the right default (it survives
 * navigation and the EN|PT toggle keeps working) but has one gap: there is no
 * URL you can SEND someone that opens in their language. That gap matters
 * exactly once — handing a Portuguese-language reviewer a link — and it is the
 * whole reason the PT-or-EN question looked like it needed a default change.
 * It does not: it needed a linkable override.
 *
 * The page has already server-rendered in the requested language by the time
 * this mounts, so there is nothing to re-render. All that is left is to make
 * the rest of the session agree with what is on screen:
 *
 *   1. Persist the choice to the cookie, so it survives the next navigation.
 *   2. Fix <html lang>, which the root layout rendered from the OLD cookie.
 *   3. DROP the parameter from the URL.
 *
 * Step 3 is not tidying. `?lang=` is an entry point, not state: left in place it
 * outranks the cookie on every subsequent render, so clicking EN|PT would write
 * a cookie the query immediately overrode and the toggle would look broken.
 * Once it is gone the cookie governs again and the control behaves normally.
 * (Cost: a recipient who copies the cleaned URL passes on a link without the
 * language. Their own cookie is set, so the page they see is unaffected.)
 *
 * Deliberately does NOT go through LangProvider.setLang, which calls
 * router.refresh(). A refresh buys nothing here — the server already produced
 * the right language — and it remounts the client tree, which visibly restarts
 * the Stats count-up from zero.
 */
"use client";

import { useEffect } from "react";
import { LANG_COOKIE, type Lang } from "../../../lib/i18n";

export function LangFromQuery({ lang }: { lang: Lang }) {
  useEffect(() => {
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = lang;

    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.delete("lang");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [lang]);

  return null;
}
