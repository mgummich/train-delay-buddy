// icons.jsx — minimal stroke icons for VerspätungsBegleiter
// Exported to window. All inherit currentColor.

const Svg = ({ size = 20, children, sw = 1.75, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {children}
  </svg>
);

const IconSettings = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

const IconTrain = (p) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="13" rx="3" />
    <path d="M5 11h14" />
    <circle cx="8.5" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
    <path d="M7 20l2-3M17 20l-2-3" />
  </Svg>
);

const IconPin = (p) => (
  <Svg {...p}>
    <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
    <circle cx="12" cy="11" r="2.2" />
  </Svg>
);

const IconArrow = (p) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

const IconBack = (p) => (
  <Svg {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Svg>
);

const IconFilter = (p) => (
  <Svg {...p}>
    <path d="M3 5h18M6 12h12M10 19h4" />
  </Svg>
);

const IconBolt = (p) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
  </Svg>
);

const IconShield = (p) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

const IconAlert = (p) => (
  <Svg {...p}>
    <path d="M12 4 2 20h20L12 4z" />
    <path d="M12 10v4M12 17.5v.5" />
  </Svg>
);

const IconChevDown = (p) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
);

const IconClock = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

const IconCheck = (p) => (
  <Svg {...p}><path d="M5 12l4.5 4.5L19 7" /></Svg>
);

const IconNow = (p) => (
  <Svg {...p}>
    <path d="M12 5v9M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </Svg>
);

const IconPlatform = (p) => (
  <Svg {...p} sw={1.6}>
    <path d="M4 18h16M6 18V8h7l3 3v7" />
    <path d="M9 11h3" />
  </Svg>
);

Object.assign(window, {
  IconSettings, IconTrain, IconPin, IconArrow, IconBack, IconFilter,
  IconBolt, IconShield, IconAlert, IconChevDown, IconClock, IconCheck,
  IconNow, IconPlatform,
});
