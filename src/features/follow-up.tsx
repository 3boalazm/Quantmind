"use client";

import { useState } from "react";
import { CalendarClock, Check, CheckCheck, ChevronDown, ClipboardCheck, Eye, History, TriangleAlert, Undo2 } from "lucide-react";
import { MAX_NEXT_DAYS, nextDue, pending, type ReviewResult, type ReviewState, type ReviewStatus, type ReviewsView } from "@/lib/followup";
import { formatDate } from "@/lib/format";
import { useReviews } from "@/state/reviews";
import { Badge, Bubble, Button, Card, CardHead, Empty, Field, Input, Notice, PageHead, StatCard, Textarea, cx } from "@/ui";
import type { Tone } from "@/ui";
import { D, Mixed, N } from "@/ui/text";

const STATUS: Record<ReviewStatus, { label: string; tone: Tone | "outline" }> = {
  problem: { label: "مشكلة مفتوحة", tone: "peach" },
  due: { label: "مستحقة", tone: "lime" },
  watch: { label: "متابعة", tone: "sky" },
  soon: { label: "قريبة", tone: "sand" },
  ok: { label: "تمام", tone: "mint" },
  closed: { label: "اتقفلت", tone: "outline" },
  inactive: { label: "لسه مش مفعّلة", tone: "outline" },
};

const RESULT: Record<ReviewResult, { label: string; hint: string; tone: Tone | "outline" }> = {
  ok: { label: "تمام", hint: "راجعتها ومفيش حاجة مطلوبة", tone: "mint" },
  watch: { label: "محتاج متابعة", hint: "لسه مستني رد أو الصورة مش واضحة", tone: "sky" },
  problem: { label: "مشكلة", hint: "لقيت حاجة غلط أو الرد جه سلبي", tone: "peach" },
};

const RESULTS: ReviewResult[] = ["ok", "watch", "problem"];

/** Where a review stands, in words. */
function when(state: ReviewState): string {
  if (state.late === null || state.due === null) return "";
  if (state.late === 0) return "مستحقة النهارده";
  if (state.late > 0) return `متأخرة ${state.late} يوم`;
  return `بعد ${-state.late} يوم`;
}

function whyInactive(state: ReviewState, names: Record<string, string>): string {
  const { item } = state;
  if (item.needs_holding && item.instrument) return `بتتفعّل لما يبقى معاك ${names[item.instrument] ?? item.instrument}.`;
  if (item.from_value !== undefined) return `بتتفعّل لما المحفظة توصل ${item.from_value.toLocaleString("en-US")} جنيه.`;
  return "";
}

export function FollowUpScreen() {
  const { data, error, reload } = useReviews();

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <ClipboardCheck /> متابعة دورية
          </>
        }
        title="المتابعة"
        subtitle="كل فرصة استثمارية ليها بنود مراجعة بدورية خاصة بيها. لما ميعاد بند ييجي بيظهر هنا وفي اللوحة، وانت بتراجعه وتسجّل النتيجة، والموعد الجاي بيتحسب منها."
      />
      {error && !data ? (
        <Card>
          <Empty
            icon={<TriangleAlert />}
            title="تعذر تحميل المراجعات"
            description={error}
            action={
              <Button variant="ink" onClick={() => void reload()}>
                حاول تاني
              </Button>
            }
          />
        </Card>
      ) : !data ? (
        <div className="bento">
          <div className="card card--soft skeleton span-12" role="status" aria-label="جاري تحميل المراجعات" style={{ minHeight: 220 }} />
        </div>
      ) : (
        <Reviews data={data} />
      )}
    </>
  );
}

function Reviews({ data }: { data: ReviewsView }) {
  const { counts } = data;
  const [openId, setOpenId] = useState<string | null>(null);
  const active = data.states.filter((s) => s.status !== "closed" && s.status !== "inactive");
  const closed = data.states.filter((s) => s.status === "closed");
  const inactive = data.states.filter((s) => s.status === "inactive");

  // One card per investment, the one with the most urgent item first (the list is already in urgency order).
  const groups: Array<{ key: string; name: string; states: ReviewState[] }> = [];
  for (const state of active) {
    const key = state.item.instrument ?? "";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, name: key ? (data.names[key] ?? key) : "الخطة ككل", states: [] };
      groups.push(group);
    }
    group.states.push(state);
  }

  return (
    <div className="bento">
      <StatCard className="span-3" tone={counts.due ? "lime" : undefined} label="مستحقة" value={<N>{counts.due}</N>} icon={<CalendarClock />} hint="ميعادها جه أو عدّى" />
      <StatCard className="span-3" tone={counts.problem ? "peach" : undefined} label="مشاكل مفتوحة" value={<N>{counts.problem}</N>} icon={<TriangleAlert />} hint="لحد ما تسجّل مراجعة بنتيجة تانية" />
      <StatCard className="span-3" label="في متابعة" value={<N>{counts.watch}</N>} icon={<Eye />} hint="مستني رد أو توضيح" />
      <StatCard className="span-3" label={`خلال ${data.soon_days} أيام`} value={<N>{counts.soon}</N>} icon={<CheckCheck />} hint="ميعادها قرّب" />

      {groups.length === 0 ? (
        <div className="span-12">
          <Card>
            <Empty icon={<CheckCheck />} title="مفيش مراجعات شغالة" description="كل البنود اتقفلت أو لسه ماتفعّلتش." />
          </Card>
        </div>
      ) : (
        groups.map((group) => {
          const urgent = group.states.filter((s) => s.status === "problem" || s.status === "due").length;
          return (
            <Card key={group.key || "plan"} className="span-12">
              <CardHead
                title={group.name}
                hint={`${group.states.length} بند`}
                actions={urgent ? <Badge tone="lime">{`${urgent} محتاجة مراجعة`}</Badge> : <Badge tone="mint">تمام</Badge>}
              />
              <div className="review-list">
                {group.states.map((state) => (
                  <ReviewRow
                    key={state.item.id}
                    state={state}
                    today={data.today}
                    open={openId === state.item.id}
                    onToggle={() => setOpenId(openId === state.item.id ? null : state.item.id)}
                    onDone={() => setOpenId(null)}
                  />
                ))}
              </div>
            </Card>
          );
        })
      )}

      {inactive.length ? (
        <Card className="span-6">
          <CardHead title="لسه مش مفعّلة" hint="بتبدأ لوحدها لما شرطها يتحقق" />
          <div className="list list--wrap">
            {inactive.map((state) => (
              <div key={state.item.id} className="list__row">
                <div className="list__main">
                  <b>{state.item.title}</b>
                  <span>
                    {state.item.instrument ? `${data.names[state.item.instrument] ?? state.item.instrument}. ` : ""}
                    <Mixed text={whyInactive(state, data.names)} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {closed.length ? (
        <Card className="span-6">
          <CardHead title="اتقفلت" hint="اتراجعت وخلصت" />
          <div className="list list--wrap">
            {closed.map((state) => (
              <div key={state.item.id} className="list__row">
                <div className="list__main">
                  <b>{state.item.title}</b>
                  <span>
                    {state.last ? (
                      <>
                        <D>{formatDate(state.last.date)}</D>
                        {state.last.note ? <> · <Mixed text={state.last.note} /></> : null}
                      </>
                    ) : null}
                  </span>
                </div>
                <Badge tone="outline">اتقفلت</Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ReviewRow({ state, today, open, onToggle, onDone }: { state: ReviewState; today: string; open: boolean; onToggle: () => void; onDone: () => void }) {
  const { item, last } = state;
  const status = STATUS[state.status];
  const [showHistory, setShowHistory] = useState(false);
  const panel = `review-${item.id}`;

  return (
    <div className="review">
      <div className="review__head">
        <div className="list__main">
          <b className="review__title">{item.title}</b>
          <div className="review__meta">
            <Badge tone={status.tone}>{status.label}</Badge>
            {state.due ? (
              <>
                {" "}
                {when(state)} · <D>{formatDate(state.due)}</D>
              </>
            ) : null}
          </div>
          {last ? (
            <div className="review__last">
              آخر مراجعة <D>{formatDate(last.date)}</D>: {RESULT[last.result].label}
              {last.note ? <> · <Mixed text={last.note} /></> : null}
            </div>
          ) : (
            <div className="review__last">لسه ماتراجعتش.</div>
          )}
        </div>
        <Button variant={state.status === "due" || state.status === "problem" ? "ink" : "soft"} size="sm" aria-expanded={open} aria-controls={panel} onClick={onToggle} icon={<ChevronDown className={cx("review__chev", open && "review__chev--open")} />}>
          {open ? "إغلاق" : "راجع وسجّل"}
        </Button>
      </div>

      {open ? (
        <div id={panel} className="review__form">
          <div>
            <span className="t-label">اللي تراجعه</span>
            <ul className="review__checks">
              {item.checks.map((check) => (
                <li key={check}>
                  <Mixed text={check} />
                </li>
              ))}
            </ul>
          </div>
          <RecordForm state={state} today={today} onDone={onDone} />
          {state.history.length ? (
            <div>
              <button type="button" className="review__link" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
                <History /> السجل ({state.history.length})
              </button>
              {showHistory ? (
                <div className="list list--wrap review__history">
                  {state.history.slice(0, 8).map((row) => (
                    <div key={row.id} className="list__row">
                      <div className="list__main">
                        <b>
                          <D>{formatDate(row.date)}</D> · {RESULT[row.result].label}
                        </b>
                        {row.note ? (
                          <span>
                            <Mixed text={row.note} />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RecordForm({ state, today, onDone }: { state: ReviewState; today: string; onDone: () => void }) {
  const { item } = state;
  const reviews = useReviews();
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const parsed = days.trim() === "" ? null : Number(days);
  const daysOk = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_NEXT_DAYS);
  const needsNote = result !== null && result !== "ok" && note.trim() === "";
  const next = result && daysOk ? nextDue(item, result, today, parsed) : undefined;
  const blocked = !result ? "اختار نتيجة المراجعة الأول." : needsNote ? "اكتب الملاحظة عشان تقدر تسجّل." : !daysOk ? "صحّح عدد الأيام عشان تقدر تسجّل." : "";

  const save = async () => {
    if (!result || !daysOk || needsNote || busy) return;
    setBusy(true);
    try {
      const done = await reviews.record(item.id, { result, note: note.trim(), next_in_days: parsed });
      if (done) onDone();
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await reviews.undo(item.id)) onDone();
    } finally {
      setBusy(false);
      setConfirmUndo(false);
    }
  };

  return (
    <div className="stack">
      <div role="group" aria-label="نتيجة المراجعة" className="review__results">
        {RESULTS.map((value) => (
          <Button key={value} variant={result === value ? "ink" : "soft"} size="sm" aria-pressed={result === value} icon={result === value ? <Check /> : undefined} onClick={() => setResult(value)}>
            {RESULT[value].label}
          </Button>
        ))}
      </div>
      {result ? <p className="t-small t-muted">{RESULT[result].hint}</p> : null}

      <Field label="ملاحظة" optional={result === "ok" || result === null ? "اختياري" : undefined} error={needsNote ? "اكتب ملاحظة قصيرة: إيه اللي لقيته أو إيه اللي مستنيه." : undefined}>
        <Textarea rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="الرد اللي وصلك، أو إيه اللي لقيته" />
      </Field>

      <Field label="راجعني تاني بعد (يوم)" optional="اختياري" error={daysOk ? undefined : `رقم صحيح من 1 لـ ${MAX_NEXT_DAYS}.`}>
        <Input type="number" inputMode="numeric" min={1} max={MAX_NEXT_DAYS} value={days} onChange={(e) => setDays(e.target.value)} placeholder={defaultDays(item, result)} />
      </Field>

      {result && daysOk ? (
        <Notice icon={<CalendarClock />}>
          {next ? (
            <>
              المراجعة الجاية: <D>{formatDate(next)}</D>
            </>
          ) : (
            "البند هيتقفل ومش هيظهر تاني."
          )}
        </Notice>
      ) : null}

      {blocked ? (
        <p id={`why-${item.id}`} className="t-small t-muted">
          {blocked}
        </p>
      ) : null}

      <div className="review__actions">
        <Button variant="ink" disabled={Boolean(blocked) || busy} aria-describedby={blocked ? `why-${item.id}` : undefined} onClick={() => void save()}>
          {busy ? "جاري الحفظ…" : "سجّل المراجعة"}
        </Button>
        {state.last ? (
          confirmUndo ? (
            <>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void undo()}>
                أيوه، شيل آخر مراجعة
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmUndo(false)}>
                لأ
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" icon={<Undo2 />} disabled={busy} onClick={() => setConfirmUndo(true)}>
              تراجع عن آخر مراجعة
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

function defaultDays(item: ReviewState["item"], result: ReviewResult | null): string {
  if (result === "watch") return String(item.watch_days ?? 14);
  if (result === "problem") return String(item.problem_days ?? 7);
  return item.every_days === null ? "مفيش (البند بيتقفل)" : String(item.every_days);
}

/** Dashboard card: what waits on a review today, with a way in. */
export function ReviewsCard() {
  const { data, error, reload } = useReviews();
  if (!data) {
    // never silent: a failed load would hide a review that is due
    return error ? (
      <Card className="span-12">
        <CardHead title="المراجعات" hint="بنود المتابعة الدورية لكل استثمار" />
        <Empty
          icon={<TriangleAlert />}
          title="تعذر تحميل المراجعات"
          description={error}
          action={
            <Button variant="soft" size="sm" onClick={() => void reload()}>
              حاول تاني
            </Button>
          }
        />
      </Card>
    ) : (
      <div className="card card--soft skeleton span-12" role="status" aria-label="جاري تحميل المراجعات" style={{ minHeight: 160 }} />
    );
  }
  const waiting = pending(data.states);
  const shown = waiting.slice(0, 5);
  const nextUp = data.states.find((s) => s.status === "soon" || s.status === "watch" || s.status === "ok");

  return (
    <Card className="span-12">
      <CardHead
        title="المراجعات"
        hint="بنود المتابعة الدورية لكل استثمار"
        actions={
          <>
            <Badge tone={waiting.length ? "lime" : "mint"} plain>
              <N>{waiting.length}</N>
            </Badge>
            <Button variant="soft" size="sm" href="/follow-up">
              افتح المتابعة
            </Button>
          </>
        }
      />
      {waiting.length === 0 ? (
        <Empty
          icon={<CheckCheck />}
          title="مفيش مراجعات مستحقة"
          description={nextUp?.due ? `الجاية: ${nextUp.item.title}، ${when(nextUp)}.` : "كل البنود متراجعة."}
        />
      ) : (
        <div className="list">
          {shown.map((state) => (
            <div key={state.item.id} className="list__row">
              <Bubble tone={state.status === "problem" ? "ink" : undefined}>
                {state.status === "problem" ? <TriangleAlert /> : <CalendarClock />}
              </Bubble>
              <div className="list__main">
                <b>{state.item.title}</b>
                <span>
                  {state.item.instrument ? `${data.names[state.item.instrument] ?? state.item.instrument} · ` : ""}
                  {state.status === "problem" ? "مشكلة مفتوحة" : when(state)}
                </span>
              </div>
              <Badge tone={STATUS[state.status].tone}>{STATUS[state.status].label}</Badge>
            </div>
          ))}
          {waiting.length > shown.length ? <p className="t-small t-muted">و{waiting.length - shown.length} كمان في المتابعة.</p> : null}
        </div>
      )}
    </Card>
  );
}
