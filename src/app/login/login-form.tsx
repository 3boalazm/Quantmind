"use client";

import { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { Card, Field, Input, Notice } from "@/ui";

export function LoginForm({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        window.location.assign("/");
        return;
      }
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "تعذر تسجيل الدخول.");
    } catch {
      setError("مفيش اتصال بالخادم.");
    }
    setBusy(false);
  };

  return (
    <Card className="auth__card">
      <div className="row">
        <span className="rail__logo">Q</span>
        <div>
          <b className="rail__name">QuantMind</b>
          <p className="t-small t-muted">محفظة متوافقة مع الشريعة</p>
        </div>
      </div>
      <div>
        <h1 className="t-title">تسجيل الدخول</h1>
        <p className="card__hint">التطبيق خاص بمستخدم واحد. اكتب كلمة السر للمتابعة.</p>
      </div>
      {!configured ? (
        <Notice icon={<KeyRound />}>كلمة السر لسه متضبطتش: أضف المتغير APP_PASSWORD في إعدادات المشروع على Vercel ثم أعد النشر.</Notice>
      ) : null}
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <Field label="كلمة السر" error={error ?? undefined}>
          <Input
            type="password"
            dir="ltr"
            autoComplete="current-password"
            autoFocus
            required
            aria-invalid={error ? true : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn--ink btn--arrow" disabled={busy || !configured}>
          {busy ? "جاري الدخول…" : "دخول"}
          <span className="btn__arrow">
            <ArrowRight className="flip" />
          </span>
        </button>
      </form>
    </Card>
  );
}
