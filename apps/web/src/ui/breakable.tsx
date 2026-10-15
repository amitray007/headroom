import { Fragment } from "react";

/** The parts of an email between its break points: after "@" and before each ".". Other text stays whole. */
export function breakParts(text: string): string[] {
  return text.split(/(?<=@)|(?=\.)/);
}

/**
 * Text that wraps after "@" and before each "." instead of mid-word, so a long email on a phone breaks between
 * its parts. The break points are <wbr>, so a copied address has no extra characters.
 */
export function Breakable(props: { readonly text: string }) {
  let at = 0;
  return breakParts(props.text).map((part) => {
    const key = at;
    at += part.length;
    return (
      <Fragment key={key}>
        {key > 0 ? <wbr /> : null}
        {part}
      </Fragment>
    );
  });
}
