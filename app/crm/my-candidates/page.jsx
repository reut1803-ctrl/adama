"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Phone, MessageCircle, MessageSquare, ChevronLeft, UserCheck, Sparkles } from "lucide-react";
import { useCrmStore, normalizeEmail } from "@/lib/crm/store";
import { waDigits } from "@/components/crm/profiles/ProfileCard";
import { prettyPhone } from "@/components/crm/ui/CopyStaffButton";
import UpdateAfterCall, { LastUpdateBadge } from "@/components/crm/ambassador/UpdateAfterCall";
import AmbassadorTab from "@/components/crm/ambassador/AmbassadorTab";

// "המועמדים שלי" - רשימה אישית לכל אשת צוות, של המועמדים שהיא הנציגה
// המלווה שלהם. מנהלת רואה את כל המשויכים, מקובצים לפי נציגה.
export default function MyCandidatesPage() {
  const role = useCrmStore((s) => s.role);
  const googleUser = useCrmStore((s) => s.googleUser);
  const candidates = useCrmStore((s) => s.candidates);

  // "שלי" פירושו שלי, גם למנהלת: המסך מציג אך ורק מועמדים ששויכו אליי אישית.
  // המעקב הרחב על שיוכי כל הצוות נמצא בלוח הבקרה, ואין טעם לשכפל אותו כאן.
  //
  // ההשוואה נעשית מול המייל שאיתו נכנסתי, ולא מול currentStaffEmail: לחשבון
  // מנהלת השדה הזה ריק בכוונה, ולכן סינון לפיו היה מרוקן את המסך לגמרי.
  // הלשונית הפעילה. "אני כשגריר" אינה תלויה במועמדים כלל, ולכן היא עובדת
  // במלואה גם למנהלת וגם למי שאין לה אף מועמד משויך.
  const [tab, setTab] = useState("cands");
  const myEmail = normalizeEmail(googleUser?.email);
  const mine = useMemo(
    () => candidates.filter((c) => c.contactStaffEmail && normalizeEmail(c.contactStaffEmail) === myEmail),
    [candidates, myEmail]
  );

  if (role !== "staff" && role !== "admin") {
    return <p className="px-4 py-10 text-center text-sm text-[#7C6E60]">אזור זה זמין לצוות בלבד</p>;
  }

  return (
    <div className="px-4 py-6">
      {/* שתי לשוניות עליונות. סרגל הניווט התחתון של המערכת אינו מושפע מהן
          כלל ונשאר בדיוק כפי שהיה. */}
      <div className="mb-4 flex rounded-2xl border border-[#CCBDAB] bg-white p-1" role="tablist">
        {[
          ["cands", "המועמדים שלי", UserCheck],
          ["me", "אני כשגריר", Sparkles],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-bold transition ${
              tab === id ? "bg-[#844442] text-white shadow-sm" : "text-[#844442]"
            }`}
          >
            <Icon size={15} strokeWidth={1.9} /> {label}
          </button>
        ))}
      </div>

      {tab === "me" ? (
        <AmbassadorTab />
      ) : (
        <>
      <h1 className="flex items-center gap-2 text-xl font-bold text-[#3A2E26]">
        <UserCheck size={20} /> המועמדים שלי
      </h1>
      <p className="mt-1 text-[13px] text-[#7C6E60]">
        {mine.length} מועמדים שאת/ה הנציג/ה המלווה שלהם
      </p>

      {mine.length === 0 ? (
        <p className="mt-16 text-center text-sm leading-relaxed text-[#7C6E60]">
          {role === "admin"
            ? "לא שויכו אלייך מועמדים באופן אישי. המעקב אחרי השיוכים של כל הצוות נמצא בלוח הבקרה."
            : "עדיין לא שויכו אלייך מועמדים. המנהלת משייכת נציג/ה מלווה מתוך הכרטיס."}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {mine.map((c) => {
            return (
              <div
                key={c.id}
                className="rounded-2xl border border-[#CCBDAB] bg-white p-3 shadow-[0_2px_10px_rgba(58,51,53,0.05)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/crm?openCandidate=${c.id}`}
                    className="flex items-center gap-1 text-[13px] font-semibold text-[#844442]"
                  >
                    לכרטיס <ChevronLeft size={13} />
                  </Link>
                  <div className="min-w-0 text-right">
                    <p className="truncate text-[14px] font-bold text-[#3A2E26]">{c.name}</p>
                    <div className="mt-1 flex justify-end">
                      <LastUpdateBadge candidate={c} />
                    </div>
                  </div>
                </div>

                {/* יצירת קשר ישירה בקליק אחד: חיוג ווואטסאפ ככפתורים מלאים,
                    כדי שהשגריר/ה לא יצטרך/תצטרך לחפש את המספר במקום אחר. */}
                {c.phone ? (
                  <div className="mt-2 border-t border-[#E8DCCB] pt-2">
                    <p dir="ltr" className="mb-2 text-right text-[12px] font-semibold text-[#7C6E60]">
                      {prettyPhone(c.phone)}
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href={`tel:${c.phone}`}
                        aria-label={`חיוג ל${c.name}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#844442] px-3 py-2.5 text-[13px] font-semibold text-white transition active:scale-95"
                      >
                        <Phone size={15} /> חיוג
                      </a>
                      <a
                        href={`https://wa.me/${waDigits(c.phone)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`וואטסאפ ל${c.name}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#62826B] px-3 py-2.5 text-[13px] font-semibold text-white transition active:scale-95"
                      >
                        <MessageCircle size={15} /> וואטסאפ
                      </a>
                      <a
                        href={`sms:${c.phone}`}
                        aria-label={`הודעת SMS ל${c.name}`}
                        title="הודעת SMS"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#CCBDAB] bg-white text-[#7C6E60] transition active:scale-95"
                      >
                        <MessageSquare size={16} />
                      </a>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 border-t border-[#E8DCCB] pt-2 text-[11px] text-[#A2937F]">
                    לא הוזן טלפון בכרטיס הזה
                  </p>
                )}

                <UpdateAfterCall candidate={c} />
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
}
