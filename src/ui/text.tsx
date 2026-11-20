import { bidiParts } from "@/lib/format";

/**
 * A number (or date) that must read left-to-right inside Arabic text: keeps signs and % on the right side.
 * Rendered as <bdi>, not <span>, so the design system's `.x span` rules (small grey captions) never restyle it.
 */
export function N({ children }: { children: string | number }) {
  return (
    <bdi dir="ltr" className="ltr">
      {children}
    </bdi>
  );
}

/** Arabic sentence with the numbers inside it isolated. */
export function Mixed({ text }: { text: string }) {
  return (
    <>
      {bidiParts(text).map((part, index) =>
        part.ltr ? (
          <bdi key={index} dir="ltr" className="ltr">
            {part.text}
          </bdi>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** A formatted Arabic date: kept on one line and isolated, but left in its natural right-to-left order. */
export function D({ children }: { children: string }) {
  return <bdi className="nowrap">{children}</bdi>;
}
