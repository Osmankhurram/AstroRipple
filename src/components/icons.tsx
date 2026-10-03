/** Inline 16px stroke icons (currentColor) — no reliance on font glyph coverage. */
type P = { size?: number; className?: string };
const S = ({ size = 16, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    {children}
  </svg>
);

export const IconPlay = (p: P) => (
  <S {...p}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </S>
);
export const IconPause = (p: P) => (
  <S {...p}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
  </S>
);
export const IconSkipBack = (p: P) => (
  <S {...p}>
    <path d="M4 3.5v9" />
    <path d="M12 3.5v9L6 8z" fill="currentColor" stroke="none" />
  </S>
);
export const IconUndo = (p: P) => (
  <S {...p}>
    <path d="M5.5 4 2.5 7l3 3" />
    <path d="M2.5 7h7a4 4 0 0 1 0 8H7" />
  </S>
);
export const IconReset = (p: P) => (
  <S {...p}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
    <path d="M2.5 2.5v3h3" />
  </S>
);
export const IconGear = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" />
  </S>
);
export const IconHelp = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.8.7-.8 1.3v.3" />
    <circle cx="8" cy="11.6" r=".6" fill="currentColor" />
  </S>
);
export const IconMore = (p: P) => (
  <S {...p}>
    <circle cx="3.5" cy="8" r="1" fill="currentColor" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1" fill="currentColor" />
  </S>
);
export const IconOverview = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M2.4 8h11.2" opacity=".6" />
  </S>
);
export const IconSite = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="4.2" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" />
  </S>
);
export const IconPlane = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="3.4" />
    <ellipse cx="8" cy="8" rx="7" ry="2.3" transform="rotate(-25 8 8)" />
  </S>
);
export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </S>
);
export const IconSend = (p: P) => (
  <S {...p}>
    <path d="M2.5 8h10M8.5 4l4 4-4 4" />
  </S>
);
export const IconRestart = IconReset;
