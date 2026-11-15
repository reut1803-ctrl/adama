"use client";

import { useState } from "react";
import { ShieldAlert, Copy, Check, LogOut, RefreshCw, Loader2 } from "lucide-react";
import { useCrmStore } from "@/lib/crm/store";

// מסך ברור למי שנכנס/ה עם גוגל אבל עדיין לא ברשימת ההרשאות.
//
// שימו לב להבחנה: "לא ברשימה" ו"לא הצלחנו לבדוק" הם שני מצבים שונים
// לגמרי. בעבר שניהם הציגו את אותה הודעה, ולכן אשת צוות מאושרת שהבדיקה
// שלה נכשלה לרגע קיבלה הודעה שגויה שהכתובת שלה אינה מאושרת.
export default function AccessDeniedGate({ reason = "notListed" }) {
  const googleUser = useCrmStore((s) => s.googleUser);
  const signOutGoogle = useCrmStore((s) => s.signOutGoogle);
  const retryAccessCheck = useCrmStore((s) => s.retryAccessCheck);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const email = googleUser?.email || "";
  const checkFailed = reason === "checkFailed";

  const retry = async () => {
    setChecking(true);
    try {
      await retryAccessCheck();
    } finally {
      setChecking(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-[#E8DCCB] px-6 safe-top safe-bottom" dir="rtl">
      <div className="w-full max-w-xs text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F0E2DE]">
          <ShieldAlert size={26} className="text-[#844442]" />
        </div>
        <h1 className="text-[19px] font-bold text-[#3A2E26]">
          {checkFailed ? "לא הצלחנו לבדוק את ההרשאות" : "החשבון עדיין לא מאושר לכניסה"}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[#7C6E60]">
          {checkFailed
            ? "ההתחברות לגוגל הצליחה, אבל לא קיבלנו תשובה מהשרת על ההרשאות. זה קורה לרוב בחיבור איטי או ברגעים הראשונים אחרי שהכתובת נוספה. לחצו לבדיקה חוזרת."
            : "ההתחברות לגוגל הצליחה, אבל הכתובת הזו עדיין לא נמצאת ברשימת ההרשאות של הצוות. שלחו את הכתובת שמופיעה כאן למנהלת, והיא תאשר אותה תוך רגע."}
        </p>

        <button
          onClick={retry}
          disabled={checking}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#62826B] py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
        >
          {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {checking ? "בודק..." : "בדיקה חוזרת"}
        </button>

        <div className="mt-5 rounded-2xl border border-[#CCBDAB] bg-white p-3 shadow-sm">
          <p className="mb-1 text-[11px] font-semibold text-[#7C6E60]">הכתובת שאיתה נכנסת:</p>
          <p dir="ltr" className="break-all text-left text-[13px] font-bold text-[#3A2E26]">
            {email}
          </p>
          <button
            onClick={handleCopy}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#844442] py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.98]"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "הכתובת הועתקה" : "העתקת הכתובת"}
          </button>
        </div>

        <button
          onClick={signOutGoogle}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#CCBDAB] bg-white py-2.5 text-[13px] font-semibold text-[#3A2E26] transition active:scale-[0.98]"
        >
          <LogOut size={15} /> כניסה עם חשבון אחר
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-[#A2937F]">
          {checkFailed
            ? "אם זה חוזר שוב ושוב, כדאי לבדוק את החיבור לאינטרנט ולנסות שוב בעוד דקה."
            : "אם המנהלת כבר אישרה את הכתובת - לחצו על בדיקה חוזרת. חשוב שהכתובת ברשימה תהיה בדיוק אותה כתובת גוגל."}
        </p>
      </div>
    </div>
  );
}
