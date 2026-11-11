"use client";

// היסטוריית ההתאמות שירדו מהפרק.
//
// הצעה שירדה מהפרק נשארת בלוח הפעיל 48 שעות ואז עוברת לכאן. היא אינה
// נמחקת: כל הרשומות כאן הן מה שמזין את התראת הכפילות, ולכן מחיקה מכאן
// היא פעולה חריגה ששמורה למנהלת בלבד ומוצגת עם אזהרה מפורשת.
//
// הקטע סגור כברירת מחדל כדי לשמור על מסך נקי, ונפתח בלחיצה.

import { useState } from "react";
import { Archive, ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/crm/ui/ConfirmDialog";
import ManualHistoryEntry from "@/components/crm/proposals/ManualHistoryEntry";
import { useCrmStore, PROPOSAL_DROPPED } from "@/lib/crm/store";
import { lastDropInfo, toMillis } from "@/lib/crm/attention";

function ArchiveRow({ proposal }) {
  const role = useCrmStore((s) => s.role);
  const findCandidateById = useCrmStore((s) => s.findCandidateById);
  const restoreProposal = useCrmStore((s) => s.restoreProposal);
  const deleteProposal = useCrmStore((s) => s.deleteProposal);
  const showToast = useCrmStore((s) => s.showToast);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const maleName = findCandidateById(proposal.maleId)?.name || proposal.externalMale?.name || "מועמד שהוסר";
  const femaleName = findCandidateById(proposal.femaleId)?.name || proposal.externalFemale?.name || "מועמדת שהוסרה";
  const info = lastDropInfo(proposal, PROPOSAL_DROPPED);
  const dateMs = info?.dateMs || toMillis(proposal.createdAt);

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await restoreProposal(proposal.id);
      showToast("ההצעה חזרה ללוח הפעיל");
    } catch {
      showToast("החזרת ההצעה נכשלה, נסי שוב");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProposal(proposal.id);
      showToast("ההצעה נמחקה מההיסטוריה");
    } catch {
      showToast("המחיקה נכשלה, נסי שוב");
    }
    setConfirmingDelete(false);
  };

  return (
    <li className="rounded-2xl border border-[#CCBDAB] bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-[#3A2E26]">
            {maleName} ⚭ {femaleName}
          </p>
          <p className="mt-0.5 text-[11px] text-[#A2937F]">
            ירדה מהפרק ב-{dateMs ? new Date(dateMs).toLocaleDateString("he-IL") : "תאריך לא ידוע"}
            {info?.times > 1 ? ` · ${info.times} פעמים` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={handleRestore}
            disabled={busy}
            aria-label="החזרת ההצעה ללוח הפעיל"
            title="החזרה ללוח הפעיל"
            className="rounded-full p-1.5 text-[#4A6552] transition hover:bg-[#DDE6DF] active:scale-95 disabled:opacity-40"
          >
            <RotateCcw size={16} />
          </button>
          {role === "admin" && (
            <button
              onClick={() => setConfirmingDelete(true)}
              aria-label="מחיקת ההצעה מההיסטוריה"
              title="מחיקה לצמיתות"
              className="rounded-full p-1.5 text-[#C24545] transition hover:bg-red-50 active:scale-95"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {(info?.note || info?.rationale) && (
        <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#7C6E60]">
          {info.note ? `מה שנכתב אז: ${info.note}` : `הרציונל שנכתב אז: ${info.rationale}`}
        </p>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          message="מחיקה כאן היא לצמיתות, ואחריה המערכת לא תדע יותר להתריע שההתאמה הזו כבר נוסתה בעבר. למחוק בכל זאת?"
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </li>
  );
}

export default function DroppedArchive({ proposals }) {
  const [open, setOpen] = useState(false);

  // מהירידה האחרונה לישנה ביותר, כדי שמה שירד עכשיו יהיה ראשון ברשימה
  const rows = [...proposals].sort(
    (a, b) =>
      (lastDropInfo(b, PROPOSAL_DROPPED)?.dateMs || toMillis(b.createdAt)) -
      (lastDropInfo(a, PROPOSAL_DROPPED)?.dateMs || toMillis(a.createdAt))
  );

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl border border-[#CCBDAB] bg-[#E8DCCB] px-3.5 py-3 text-right transition active:scale-[0.99]"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#3A2E26]">
          <Archive size={15} /> היסטוריית התאמות שירדו מהפרק ({rows.length})
        </span>
        <ChevronDown size={18} className={`shrink-0 text-[#7C6E60] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <ManualHistoryEntry />

          <p className="mt-3 px-1 text-[11px] leading-relaxed text-[#7C6E60]">
            {rows.length === 0
              ? "עדיין לא ירדה מהפרק אף הצעה. כשהצעה תרד, היא תעבור לכאן מיד ותיעלם מהלוח הפעיל שלמעלה."
              : "ההצעות האלה ירדו מהפרק ולכן אינן מוצגות בלוח הפעיל. הן שמורות במערכת ומשמשות להתראת הכפילות. אפשר להחזיר כל אחת מהן ללוח בלחיצה על החץ המעגלי."}
          </p>
          {rows.length > 0 && (
            <ul className="mt-2 space-y-2">
              {rows.map((p) => (
                <ArchiveRow key={p.id} proposal={p} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
