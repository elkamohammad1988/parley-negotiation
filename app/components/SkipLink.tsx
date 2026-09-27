"use client";
import { SIGNAL, FONT } from "@/lib/design";

export default function SkipLink() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'absolute',
        top: '-40px',
        left: '0',
        background: SIGNAL.clay,
        // Not '#fff': white on clay is 3.5:1 and fails AA at this size. This is
        // the one control where that matters most — it exists solely for
        // keyboard and screen-reader users. SIGNAL.onClay is 5.0:1 and is what
        // every other clay fill in the product already uses.
        color: SIGNAL.onClay,
        padding: '8px 16px',
        borderRadius: '0 0 8px 0',
        fontFamily: FONT.sans,
        fontSize: '14px',
        fontWeight: 500,
        zIndex: 9999,
        textDecoration: 'none',
        transition: 'top 0.15s ease',
      }}
      onFocus={e => e.currentTarget.style.top = '0'}
      onBlur={e => e.currentTarget.style.top = '-40px'}
    >
      Skip to main content
    </a>
  );
}
