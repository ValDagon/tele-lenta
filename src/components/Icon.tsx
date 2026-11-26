import type { JSX } from "preact";

export type IconName =
  | "search"
  | "filter"
  | "bookmark"
  | "sliders"
  | "more"
  | "chevron-left"
  | "chevron-down"
  | "refresh"
  | "pencil"
  | "trash"
  | "x"
  | "check"
  | "external-link"
  | "clock"
  | "map-pin"
  | "briefcase"
  | "calendar"
  | "image"
  | "alert-circle"
  | "wifi-off";

const paths: Record<IconName, JSX.Element> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  filter: <path d="M4.5 5.5h15l-5.8 6.8v5.5l-3.4 1.8v-7.3z" />,
  bookmark: <path d="M7 4.5h10v15l-5-3.5-5 3.5z" />,
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  "chevron-left": <path d="m14 6-6 6 6 6" />,
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  refresh: (
    <>
      <path d="M19 8a7.5 7.5 0 1 0 .5 7.5" />
      <path d="M19 4v4h-4" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5h4L19 9a2.12 2.12 0 0 0-3-3L5.5 16.5z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M10 4.5h4" />
      <path d="m7 7 .8 12.5h8.4L17 7" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  "external-link": (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="1.5" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="1.5" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m4.5 17 4.5-4 3 2.5 3-3 4.5 4.5" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v5" />
      <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3 5l18 14" />
      <path d="M8.5 12.5a5 5 0 0 1 5-.6M6 9.5a10 10 0 0 1 4.5-2.2M18 9.5a10 10 0 0 0-3.5-2.2" />
      <circle cx="12" cy="18" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
  label?: string;
}

export function Icon({ name, size = 20, class: className, label }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      {paths[name]}
    </svg>
  );
}
