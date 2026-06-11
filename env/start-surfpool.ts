// SPDX-License-Identifier: Apache-2.0
/** `npm run surfpool:start` — launch (or attach to) the local surfnet. */
import { ensureSurfpool } from "./surfpool.js";

const slot = await ensureSurfpool();
console.log(`[surfpool] up; pinned fork slot = ${slot}`);
