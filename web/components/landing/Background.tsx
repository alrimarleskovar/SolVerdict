// SPDX-License-Identifier: Apache-2.0
/**
 * Ambient background: a masked dot grid and two static, very subtle orbs.
 * Deliberately motionless — depth comes from surfaces and type, not effects.
 */
export function HeroBackground() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[880px] overflow-hidden" aria-hidden="true">
      <div className="landing-grid" />
      <div className="landing-orb -top-40 left-[10%] h-[480px] w-[480px] bg-accent-blue/10" />
      <div className="landing-orb right-[6%] top-24 h-[420px] w-[420px] bg-accent-violet/5" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-ink" />
    </div>
  );
}
