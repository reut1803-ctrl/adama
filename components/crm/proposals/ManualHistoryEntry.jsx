"use client";

// "הזנת התאמה מהעבר".
//
// זוגות שהוצעו עוד לפני שהמערכת קמה וירדו מהפרק. הרשומה נשמרת
// כהיסטוריה בלבד, לא נכנסת ללוח הפעיל, ומרגע השמירה הצוות יקבל
// התראה אם ינסה להציע את הזוג הזה שוב.
//
// הרכיב יושב בתוך קטע ההיסטוריה ואינו מוסיף שום נתיב או אוסף חדש:
// הוא יוצר מסמך proposals רגיל, בדיוק כמו כל הצעה אחרת.

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import SearchableSelect from "@/components/crm/ui/SearchableSelect";
import { useCrmStore } from "@/lib/crm/store";
import { pastProposalsForPair } from "@/lib/crm/attention";

export default function ManualHistoryEntry() {
  const allCandidates = useCrmStore((s) => s.allCandidates);
  const candidates_ = useCrmStore((s) => s.candidates);
  const proposals = useCrmStore((s) => s.proposals);
  const createHistoricalProposal = useCrmStore((s) => s.createHistoricalProposal);
  const showToast = useCrmStore((s) => s.showToast);

  const males = useMemo(
    () => allCandidates("male").map((c) => ({ value: c.id, label: c.name })),
    [allCandidates, candidates_]
  );
  const females = useMemo(
    () => allCandidates("female").map((c) => ({ value: c.id, label: c.name })),
    [allCandidates, candidates_]
  );

  const [male, setMale] = useState("");
  const [female, setFemale] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // הזוג כבר מוכר למערכת. אין טעם ברשומה שנייה: ההתראה כבר תעבוד.
  const alreadyKnown = Boolean(male && female && pastProposalsForPair(proposals, male, female).length > 0);
  const ready = Boolean(male && female) && !alreadyKnown;

  const save = async () => {
    if (!ready || busy) return;
    setErr("");
    setBusy(true);
    try {
      await createHistoricalProposal(male, female, note);
      setMale("");
      setFemale("");
      setNote("");
      showToast("ההתאמה נשמרה בהיסטוריה");
    } catch {
      setErr("השמירה נכשלה. אפשר לנסות שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-2 rounded-2xl border border-[#D9CBB8] bg-white/70 p-3.5 backdrop-blur-sm">
      <h3 className="text-[12.5px] font-bold text-[#3A2E26]">הזנת התאמה מהעבר</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[#7C6E60]">
        זוגות שהוצעו עוד לפני שהמערכת קמה וירדו מהפרק. הרשומה נשמרת כהיסטוריה בלבד, לא
        נכנסת ללוח הפעיל, ומרגע השמירה הצוות יקבל התראה אם ינסה להציע את הזוג הזה שוב.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#5E5048]">בחור</span>
          <SearchableSelect
            value={male}
            onChange={setMale}
            options={males}
            placeholder="בחירת בחור..."
            searchPlaceholder="הקלידו שם..."
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-[#5E5048]">בחורה</span>
          <SearchableSelect
            value={female}
            onChange={setFemale}
            options={females}
            placeholder="בחירת בחורה..."
            searchPlaceholder="הקלידו שם..."
          />
        </label>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="מה קרה שם? (לא חובה)"
        className="mt-2 w-full rounded-2xl border border-[#D9CBB8] bg-white/80 px-3.5 py-2.5 text-[12.5px] text-[#3A2E26] outline-none transition placeholder:text-[#BCAC97] focus:border-[#844442]"
      />

      {alreadyKnown && (
        <p className="mt-2 rounded-xl bg-[#FDF6E7] px-3 py-2 text-[11px] leading-relaxed text-[#7A5A18]">
          הזוג הזה כבר מוכר למערכת, וההתראה עליו תעבוד ממילא. אין צורך להזין אותו שוב.
        </p>
      )}
      {err && (
        <p className="mt-2 rounded-xl bg-[#FBEDEC] px-3 py-2 text-[11px] font-semibold text-[#C24545]">{err}</p>
      )}

      <button
        onClick={save}
        disabled={!ready || busy}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-[#844442] py-2.5 text-[12.5px] font-bold text-white transition hover:bg-[#5E2F2D] active:scale-[0.99] disabled:bg-[#D8BDBC] disabled:text-white/90"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <><Plus size={15} /> שמירה בהיסטוריה</>}
      </button>
    </section>
  );
}
