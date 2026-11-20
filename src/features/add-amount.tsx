"use client";

import { useEffect, useState } from "react";
import { usePortfolio } from "@/state/portfolio-provider";
import { Input } from "@/ui";

/** The "how much am I adding now" box. The plan recalculates when you leave the field or press Enter. */
export function AddAmount() {
  const app = usePortfolio();
  const current = app.data?.add ?? 0;
  const [text, setText] = useState(String(current));

  useEffect(() => {
    setText(String(current));
  }, [current]);

  const commit = () => {
    const value = text.trim() === "" ? 0 : Number(text);
    if (!Number.isFinite(value) || value < 0) {
      setText(String(current));
      return;
    }
    if (value !== current) app.setAdd(value);
  };

  return (
    <Input
      className="input--sm input--mini"
      type="number"
      inputMode="decimal"
      min={0}
      step={100}
      dir="ltr"
      aria-label="مبلغ الإضافة بالجنيه"
      title="مبلغ الإضافة بالجنيه"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}
