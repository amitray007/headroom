import { LogoMark } from "./logo-mark.tsx";

/** Headroom logo and wordmark, as in the top bar. */
export function Lockup(props: { readonly href?: string }) {
  return (
    <a className="lockup" href={props.href ?? "#/"}>
      <LogoMark />
      <span className="lockup-name">Headroom</span>
    </a>
  );
}
