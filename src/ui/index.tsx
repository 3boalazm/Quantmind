"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "mint" | "sky" | "lilac" | "peach" | "sand" | "lime" | "ink";

/* ---------- Button ---------- */
type ButtonVariant = "default" | "ink" | "lime" | "soft" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  arrow?: boolean;
  href?: string;
  icon?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  arrow,
  href,
  icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = cx(
    "btn",
    variant !== "default" && `btn--${variant}`,
    size === "sm" && "btn--sm",
    arrow && "btn--arrow",
    className,
  );
  const content = (
    <>
      {icon}
      {children}
      {arrow ? (
        <span className="btn__arrow">
          <ArrowRight className="flip" />
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes} style={rest.style}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {content}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: "default" | "soft" | "ink";
  size?: "md" | "sm";
  href?: string;
}

export function IconButton({
  label,
  variant = "default",
  size = "md",
  href,
  className,
  children,
  ...rest
}: IconButtonProps) {
  const classes = cx(
    "icon-btn",
    variant !== "default" && `icon-btn--${variant}`,
    size === "sm" && "icon-btn--sm",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label} title={label}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
interface CardProps {
  tone?: Tone | "soft";
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ tone, flush, className, children }: CardProps) {
  return (
    <section className={cx("card", tone && `card--${tone}`, flush && "card--flush", className)}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  hint,
  actions,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="card__head">
      <div>
        <h2 className="card__title">{title}</h2>
        {hint ? <p className="card__hint">{hint}</p> : null}
      </div>
      {actions ? <div className="card__actions">{actions}</div> : null}
    </header>
  );
}

export function Bubble({
  tone,
  children,
}: {
  tone?: "ink" | "lime" | "glass";
  children: ReactNode;
}) {
  return <span className={cx("bubble", tone && `bubble--${tone}`)}>{children}</span>;
}

/* ---------- Badge ---------- */
export function Badge({
  tone,
  plain,
  children,
}: {
  tone?: Tone | "outline";
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx("badge", tone && `badge--${tone}`, plain && "badge--plain")}>
      {children}
    </span>
  );
}

/* ---------- Tabs ---------- */
export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  filled,
  label,
}: {
  value: T;
  options: Array<TabOption<T>>;
  onChange: (value: T) => void;
  filled?: boolean;
  label?: string;
}) {
  return (
    <div className={cx("tabs", filled && "tabs--filled")} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Form ---------- */
export function Field({
  label,
  optional,
  error,
  className,
  children,
}: {
  label: string;
  optional?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx("field", className)}>
      <span className="field__label">
        {label} {optional ? <i>· {optional}</i> : null}
      </span>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("input", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("select", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("textarea", className)} {...rest} />;
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search">
      <Search />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------- Avatar ---------- */
const AVATAR_TONES = ["sky", "mint", "lilac", "peach", "lime"] as const;

export function Avatar({ name, size }: { name: string; size?: "lg" }) {
  const words = name.trim().split(/\s+/).slice(0, 2);
  const initials = words.map((word) => word[0] ?? "").join("").toUpperCase();
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  return (
    <span className={cx("avatar", `avatar--${tone}`, size === "lg" && "avatar--lg")} aria-hidden>
      {initials}
    </span>
  );
}

/* ---------- Page header ---------- */
export function PageHead({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head__text">
        {eyebrow ? <div className="page-head__eyebrow">{eyebrow}</div> : null}
        <h1 className="t-display">{title}</h1>
        {subtitle ? <p className="page-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

/* ---------- Feedback ---------- */
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Bubble>{icon}</Bubble>
      <b>{title}</b>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

/** `block` is for a notice that holds a list: squared corners and the icon aligned to the first line. */
export function Notice({ icon, block, children }: { icon?: ReactNode; block?: boolean; children: ReactNode }) {
  return (
    <div className={cx("notice", block && "notice--block")} role="note">
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="toast" role="status">
      {children}
    </div>
  );
}

export function Progress({ value, lime }: { value: number; lime?: boolean }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className={cx("progress", lime && "progress--lime")} role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${width}%` }} />
    </div>
  );
}

/* ---------- Stat tile ---------- */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone | "soft";
  className?: string;
}) {
  return (
    <Card tone={tone} className={cx('stat-card', className)}>
      <div className="row row--between">
        <span className="t-label">{label}</span>
        {icon ? <Bubble tone={tone && tone !== "soft" ? "glass" : undefined}>{icon}</Bubble> : null}
      </div>
      <div className="card__grow" />
      <div className="num num--md">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {hint ? <p className="t-small t-muted">{hint}</p> : null}
    </Card>
  );
}
