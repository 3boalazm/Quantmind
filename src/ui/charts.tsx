"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx, IconButton } from "@/ui";
import { addMonths, monthGrid, toISODate } from "@/lib/dates";

type Locale = "ar" | "en";

/* ---------- Pill bar chart ---------- */
export interface BarDatum {
  label: string;
  value: number;
  inner?: number;
  /** Tooltip text; defaults to the raw numbers. */
  title?: string;
}

export function PillBars({ data, hot }: { data: BarDatum[]; hot?: number }) {
  const max = Math.max(1, ...data.map((item) => Math.max(item.value, item.inner ?? 0)));
  return (
    <div className="bars">
      {data.map((item, index) => (
        <div
          key={item.label}
          className={cx("bars__col", index === hot && "bars__col--hot")}
          title={item.title ?? `${item.label}: ${item.value}${item.inner !== undefined ? ` / ${item.inner}` : ""}`}
        >
          <div className="bars__track">
            <div className="bars__fill" style={{ height: `${(item.value / max) * 100}%` }} />
            {item.inner !== undefined ? (
              <div
                className="bars__fill bars__fill--inner"
                style={{ height: `${(item.inner / max) * 100}%` }}
              />
            ) : null}
          </div>
          <span className="bars__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Semi-circle gauge ---------- */
export function Gauge({ value, children }: { value: number; children?: React.ReactNode }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 84;
  const length = Math.PI * radius;
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 112" aria-hidden>
        <path
          d="M 16 100 A 84 84 0 0 1 184 100"
          fill="none"
          stroke="var(--well)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 16 100 A 84 84 0 0 1 184 100"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * length} ${length}`}
        />
      </svg>
      <div className="gauge__value">{children}</div>
    </div>
  );
}

/* ---------- Ring ---------- */
export function Ring({ value, size = 56 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 22;
  const length = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--well)" strokeWidth="6" />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * length} ${length}`}
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}

/* ---------- Mini calendar ---------- */
export function MiniCalendar({
  month,
  selected,
  today,
  counts,
  locale,
  dayLabels,
  onSelect,
  onMonthChange,
  labels,
}: {
  month: string;
  selected: string;
  today: string;
  counts: Record<string, number>;
  locale: Locale;
  dayLabels: readonly string[];
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
  labels: { previous: string; next: string };
}) {
  const cells = monthGrid(month);
  const title = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T12:00:00`));
  const dayNumber = new Intl.NumberFormat("en-US");

  return (
    <div className="cal">
      <div className="row row--between" style={{ marginBottom: 6 }}>
        <b className="card__title">{title}</b>
        <div className="row" style={{ gap: 6 }}>
          <IconButton
            label={labels.previous}
            size="sm"
            variant="soft"
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft className="flip" />
          </IconButton>
          <IconButton
            label={labels.next}
            size="sm"
            variant="soft"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight className="flip" />
          </IconButton>
        </div>
      </div>
      <div className="cal__grid">
        {dayLabels.map((day) => (
          <span key={day} className="cal__dow">
            {day.slice(0, locale === "ar" ? 20 : 2)}
          </span>
        ))}
        {cells.map((date) => {
          const iso = toISODate(date);
          return (
            <button
              key={iso}
              type="button"
              className={cx(
                "cal__day",
                iso.slice(0, 7) !== month && "cal__day--out",
                iso === today && "cal__day--today",
                counts[iso] > 0 && "cal__day--busy",
              )}
              aria-pressed={iso === selected}
              onClick={() => onSelect(iso)}
            >
              {dayNumber.format(date.getUTCDate())}
            </button>
          );
        })}
      </div>
    </div>
  );
}
