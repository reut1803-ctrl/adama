"use client";

import { useState } from "react";
import { NotebookPen, PlayCircle, FileDown, Check, X, Sparkles } from "lucide-react";
import { useCrmStore } from "@/lib/crm/store";
import {
  monthKey, monthLabel, saveMonthlyReflection, reflectionFor, REFLECTION_QUESTIONS,
} from "@/lib/crm/ambassadorHub";

// לשונית "אני כשגריר": מרכז ההכשרה (קופסאות המתנה) והסיכום החודשי.
// אין כאן תלות במועמדים כלל, ולכן הלשונית תקינה ומלאה גם למנהלת וגם
// למי שאין לה אף מועמד משויך.

// נתיב התמונה חייב לכלול את הקידומת של GitHub Pages, שבה האתר יושב תחת
// /adama. ב-Vercel הקידומת ריקה ולכן אותו קוד עובד בשני האתרים.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const KRAFT = `${BASE}/assets/gift-kraft.jpg`;

const GIFTS = [
  { id: "g1", label: "איך לנהל שיחת שגריר", sub: "סרטון הדרכה", pdf: "מדריך השגריר.pdf" },
  { id: "g2", label: "כרטיסיות ותרגילים להורדה", sub: "כלים מעשיים", pdf: "כרטיסיית שאלות פתיחה.pdf" },
];

/* ───────── קופסת מתנה ─────────
   קרטון טבעי קשור בחוט פשתן, עם ענף אקליפטוס. התווית יושבת מעל הקופסה
   בכרטיסייה בגוון חום-יין עמוק עם מסגרת זהב עמום. */
function GiftBox({ gift, open, onToggle }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-[#CCBDAB] bg-white shadow-[0_4px_18px_rgba(58,51,53,0.06)]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="relative block w-full text-right">
        <div className="relative h-[210px] w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={KRAFT}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full select-none object-cover"
          />
          {/* הצללה עדינה בתחתית, כדי שהתווית תישב על רקע רגוע */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
          <div className="absolute inset-x-0 bottom-4 flex justify-center px-5">
            <span className="rounded-2xl border border-[#CBB089] bg-[#5E2F2D] px-4 py-2.5 text-center shadow-[0_8px_22px_rgba(58,46,38,0.35)]">
              <span className="block text-[14px] font-bold leading-snug text-[#F8F2E9]">{gift.label}</span>
              <span className="mt-0.5 block text-[11px] tracking-wide text-[#D9C7A0]">
                {gift.sub} · לחיצה לפתיחה
              </span>
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="space-y-3 p-4">
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-[#3A2E26] text-white/85">
            <span className="flex items-center gap-2 text-[12px]">
              <PlayCircle size={22} strokeWidth={1.5} /> כאן יוטמע סרטון ההדרכה
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#844442] py-2.5 text-[13px] font-semibold text-white transition active:scale-95"
            >
              <FileDown size={14} strokeWidth={1.9} /> {gift.pdf}
            </button>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-2xl border border-[#CCBDAB] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#3A2E26] transition active:scale-95"
            >
              סגירה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── הסיכום החודשי ───────── */
function ReflectionModal({ existing, onClose }) {
  const currentUser = useCrmStore((s) => s.currentUser);
  const showToast = useCrmStore((s) => s.showToast);
  const me = currentUser();
  const month = monthKey();
  const [answers, setAnswers] = useState(existing?.answers || {});
  const [state, setState] = useState("idle");

  const canSave = REFLECTION_QUESTIONS.some((q) => (answers[q.id] || "").trim());

  const save = async () => {
    if (!canSave || state === "saving") return;
    setState("saving");
    try {
      const clean = {};
      REFLECTION_QUESTIONS.forEach((q) => {
        clean[q.id] = (answers[q.id] || "").trim();
      });
      await saveMonthlyReflection(me?.email, { month, answers: clean, byName: me?.name || "" });
      setState("saved");
      showToast("הסיכום נשמר, תודה!");
      setTimeout(onClose, 700);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-[16px] font-bold text-[#3A2E26]">איך עבר החודש? · {monthLabel(month)}</h2>
          <button onClick={onClose} aria-label="סגירה" className="rounded-full p-1 text-[#7C6E60] active:scale-90">
            <X size={18} />
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-[#7C6E60]">
          שלוש שאלות, שתי דקות. הסיכום מגיע להנהלה ועוזר לנו לדעת איפה לעזור.
        </p>

        <div className="mt-3 space-y-3">
          {REFLECTION_QUESTIONS.map((q) => (
            <div key={q.id}>
              <label className="field-label">{q.label}</label>
              <textarea
                className="field-input min-h-[90px] text-sm"
                placeholder={q.hint}
                value={answers[q.id] || ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        {existing && (
          <p className="mt-2 text-[12px] text-[#7C6E60]">
            כבר מילאת החודש — אפשר לעדכן, והגרסה החדשה תחליף את הקודמת.
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={save}
            disabled={!canSave || state === "saving"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#844442] py-3 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-40"
          >
            {state === "saving" ? "שומר…" : state === "saved" ? (<><Check size={15} strokeWidth={2.4} /> נשמר</>) : "שמירה"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-[#CCBDAB] bg-white py-3 text-sm font-semibold text-[#3A2E26] transition active:scale-95"
          >
            ביטול
          </button>
        </div>

        {state === "error" && (
          <p className="mt-2 text-[13px] text-[#C24545]">
            השמירה נכשלה. בדקי חיבור לאינטרנט ונסי שוב — מה שכתבת לא נמחק.
          </p>
        )}
      </div>
    </div>
  );
}

export default function AmbassadorTab() {
  const currentUser = useCrmStore((s) => s.currentUser);
  const telemetry = useCrmStore((s) => s.telemetry);
  const [openGift, setOpenGift] = useState(null);
  const [reflecting, setReflecting] = useState(false);

  const me = currentUser();
  const month = monthKey();
  const existing = reflectionFor(telemetry?.[me?.email], month);

  return (
    <div className="mt-4 space-y-4">
      {/* הסיכום החודשי */}
      <button
        type="button"
        onClick={() => setReflecting(true)}
        className="flex w-full items-center gap-3 rounded-3xl border border-[#CBB089] p-4 text-right shadow-[0_8px_24px_rgba(58,46,38,0.18)] transition active:scale-[0.99]"
        style={{ background: "linear-gradient(150deg,#844442,#5E2F2D)" }}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#CBB089]/70 bg-white/10">
          <NotebookPen size={21} strokeWidth={1.6} className="text-[#E6CF9F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-bold text-[#F8F2E9]">איך עבר החודש?</span>
          <span className="mt-0.5 block text-[12px] text-[#D9C7A0]">
            {existing
              ? `מילאת את הסיכום של ${monthLabel(month)} ✓ · לחיצה לעדכון`
              : `סיכום קצר ל${monthLabel(month)} · שלוש שאלות, שתי דקות`}
          </span>
        </span>
      </button>

      {/* מרכז הכשרה */}
      <div className="pt-1 text-center">
        <h2 className="flex items-center justify-center gap-1.5 text-[16px] font-bold text-[#3A2E26]">
          <Sparkles size={17} strokeWidth={1.8} className="text-[#D9A441]" /> מרכז הכשרה וקהילה
        </h2>
        <p className="mt-1 text-[12px] text-[#7C6E60]">מתנה קטנה מאיתנו לכל שגריר/ה — לחיצה על קופסה פותחת אותה</p>
      </div>

      {GIFTS.map((g) => (
        <GiftBox key={g.id} gift={g} open={openGift === g.id} onToggle={() => setOpenGift((v) => (v === g.id ? null : g.id))} />
      ))}

      {reflecting && <ReflectionModal existing={existing} onClose={() => setReflecting(false)} />}
    </div>
  );
}
