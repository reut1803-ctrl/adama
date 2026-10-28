"use client";

import { useState } from "react";
import { MessageCircleHeart, Check, X } from "lucide-react";
import { useCrmStore } from "@/lib/crm/store";
import { addContactUpdate, updatesOf, daysSince, QUICK_UPDATES } from "@/lib/crm/ambassadorHub";

// "עדכון אחרי שיחה" - שורה בתחתית כרטיס המועמד/ת במסך השגריר/ה, והמודאל
// שנפתח ממנה. העדכון נשמר על מסמך המועמד/ת עצמו, ולכן ההנהלה רואה אותו
// בלי שום אוסף חדש ובלי שינוי בכללי האבטחה.

function fmt(iso) {
  try {
    return new Date(iso).toLocaleDateString("he-IL");
  } catch {
    return "";
  }
}

/** התגית שמראה מתי עודכן לאחרונה. */
export function LastUpdateBadge({ candidate }) {
  const last = updatesOf(candidate)[0];
  if (!last) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#F0E2DE] px-2 py-0.5 text-[11px] font-semibold text-[#844442]">
        טרם עודכן
      </span>
    );
  }
  const d = daysSince(last.at);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E6EFE8] px-2 py-0.5 text-[11px] font-semibold text-[#4A6552]">
      <Check size={11} strokeWidth={2.5} />
      עודכן {d === 0 ? "היום" : d === 1 ? "אתמול" : `לפני ${d} ימים`}
    </span>
  );
}

/** הכפתור שפותח את המודאל. */
export default function UpdateAfterCall({ candidate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border-t border-[#E8DCCB] bg-[#FBF5F3] px-3 py-2.5 text-[13px] font-bold text-[#844442] transition active:scale-[0.98]"
      >
        <MessageCircleHeart size={15} strokeWidth={1.9} /> עדכון אחרי שיחה — מה שלומו/ה?
      </button>
      {open && <UpdateModal candidate={candidate} onClose={() => setOpen(false)} />}
    </>
  );
}

function UpdateModal({ candidate, onClose }) {
  const currentUser = useCrmStore((s) => s.currentUser);
  const showToast = useCrmStore((s) => s.showToast);
  const [text, setText] = useState("");
  const [state, setState] = useState("idle"); // idle | saving | saved | error
  const history = updatesOf(candidate);
  const me = currentUser();

  const addQuick = (q) => setText((t) => (t.trim() ? `${t.trim()} · ${q}` : q));

  const save = async () => {
    if (!text.trim() || state === "saving") return;
    setState("saving");
    try {
      await addContactUpdate(candidate.id, {
        text,
        byName: me?.name || "",
        byEmail: me?.email || "",
      });
      setState("saved");
      showToast("העדכון נשמר ומגיע להנהלה");
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
          <h2 className="text-[16px] font-bold text-[#3A2E26]">מה שלום {candidate.name}?</h2>
          <button onClick={onClose} aria-label="סגירה" className="rounded-full p-1 text-[#7C6E60] active:scale-90">
            <X size={18} />
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-[#7C6E60]">
          כמה מילים על מה שעלה בשיחה. העדכון נשמר על הכרטיס ומגיע להנהלה.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_UPDATES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => addQuick(q)}
              className="rounded-full border border-[#CCBDAB] bg-white px-3 py-1 text-[12px] font-medium text-[#844442] transition active:scale-95"
            >
              {q}
            </button>
          ))}
        </div>

        <textarea
          className="field-input mt-3 min-h-[110px] text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="למשל: דיברנו היום, במצב רוח טוב, מבקש/ת הצעות מאזור הצפון…"
        />

        {history.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-2xl bg-[#F0E2DE] p-3">
            <p className="text-[12px] font-bold text-[#844442]">עדכונים קודמים</p>
            {history.slice(0, 3).map((u) => (
              <p key={u.id} className="text-[12px] leading-relaxed text-[#3A2E26]">
                <span className="text-[#7C6E60]">
                  {fmt(u.at)} · {u.byName || "צוות"}:
                </span>{" "}
                {u.text}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={save}
            disabled={!text.trim() || state === "saving"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#844442] py-3 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-40"
          >
            {state === "saving" ? "שולח…" : state === "saved" ? (<><Check size={15} strokeWidth={2.4} /> נשמר</>) : "שמירת העדכון"}
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
