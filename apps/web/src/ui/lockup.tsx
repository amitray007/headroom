/** Headroom logo and wordmark, as in the top bar. */
export function Lockup(props: { readonly href?: string }) {
  const fill = { fill: "var(--background)" };
  return (
    <a className="lockup" href={props.href ?? "#/"}>
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="18" fill="currentColor" />
        <rect x="14" y="16" width="36" height="4" rx="2" style={fill} opacity=".55" />
        <rect x="14" y="30" width="26" height="8" rx="4" style={fill} />
        <rect x="14" y="42" width="16" height="8" rx="4" style={fill} />
      </svg>
      Headroom
    </a>
  );
}
