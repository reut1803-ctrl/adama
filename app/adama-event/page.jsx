"use client";

import { useState } from "react";
import { ArrowLeft, Check, Printer, Users, Sparkles, Clock, Video, CalendarDays, Loader2 } from "lucide-react";
import { EVENT, saveRsvp, saveLeads, PITCH_GUIDE } from "@/lib/crm/eventStore";

// ============================================================================
//  "ערב משדכים" — דף נחיתה עצמאי.
//
//  יחידה סגורה: נתיב משלה, אוספים משלה, וקובץ אחד שמכיל את כל הזרימה.
//  אינה מייבאת דבר מהמערכת חוץ משכבת הנתונים הייעודית שלה, ולכן אינה
//  יכולה לשבור שום מסך קיים.
//
//  שלושה שלבים: הרשמה -> שלושה מועמדים -> מסך סיום עם דף הכנה להדפסה.
// ============================================================================

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const img = (n) => `${BASE}/assets/event/${n}`;

const EMPTY_ROW = { name: "", phone: "", note: "" };

export default function AdamaEventPage() {
  const [step, setStep] = useState("rsvp"); // rsvp | leads | done
  const [leaving, setLeaving] = useState(false);
  const [me, setMe] = useState({ name: "", phone: "" });
  const [rsvpId, setRsvpId] = useState(null);
  const [rows, setRows] = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  // מעבר בין שלבים עם דעיכה קצרה, כדי שהחלפת המסך תרגיש רציפה
  const goTo = (next) => {
    setLeaving(true);
    setTimeout(() => {
      setStep(next);
      setLeaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 260);
  };

  const submitRsvp = async () => {
    setErr("");
    if (me.name.trim().length < 2) return setErr("צריך שם מלא");
    if (me.phone.trim().length < 6) return setErr("צריך מספר טלפון");
    setBusy(true);
    try {
      setRsvpId(await saveRsvp(me));
      goTo("leads");
    } catch {
      setErr("ההרשמה לא נשמרה. אפשר לנסות שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  const filled = rows.filter((r) => r.name.trim().length >= 2).length;

  const submitLeads = async () => {
    setErr("");
    setBusy(true);
    try {
      setSavedCount(await saveLeads(rsvpId, rows, me));
      goTo("done");
    } catch {
      setErr("השמירה לא הצליחה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div dir="rtl" className="ev-root min-h-screen bg-[#F5EFE6]">
      <PrintStyles />

      {/* ====================== המסך (מוסתר בהדפסה) ====================== */}
      <div className="ev-screen">
        <Hero />

        <main className="mx-auto w-full max-w-xl px-5 pb-24">
          <div
            className="transition-all duration-300"
            style={{ opacity: leaving ? 0 : 1, transform: leaving ? "translateY(14px)" : "none" }}
          >
            {step === "rsvp" && (
              <Card>
                <Eyebrow icon={CalendarDays}>שריון מקום</Eyebrow>
                <h2 className="mt-2 text-[26px] font-bold leading-tight text-[#3A2E26]">אני מגיע/ה</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                  שם וטלפון, וזהו. הטלפון נשמר רק כדי שנוכל להגיע אלייך אם משהו משתנה ברגע האחרון.
                </p>

                <div className="mt-6 space-y-3">
                  <Field label="שם מלא" value={me.name} onChange={(v) => setMe((m) => ({ ...m, name: v }))} placeholder="איך קוראים לך?" />
                  <Field label="טלפון" value={me.phone} onChange={(v) => setMe((m) => ({ ...m, phone: v }))} placeholder="050-0000000" type="tel" dir="ltr" />
                </div>

                {err && <ErrorLine>{err}</ErrorLine>}

                <PrimaryButton onClick={submitRsvp} busy={busy}>
                  אני מגיע/ה <ArrowLeft size={17} />
                </PrimaryButton>
              </Card>
            )}

            {step === "leads" && (
              <Card>
                <Eyebrow icon={Sparkles}>שלב שני</Eyebrow>
                <h2 className="mt-2 text-[26px] font-bold leading-tight text-[#3A2E26]">מי את/ה מביא/ה לערב?</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                  שלושה מועמדים שתרצה/י להציג. נגיע מוכנים, ותקבל/י בסוף דף הכנה מודפס עם השמות האלה כבר בפנים.
                </p>

                <div className="mt-6 space-y-5">
                  {rows.map((r, i) => (
                    <div key={i} className="rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#844442] text-[13px] font-bold text-white">{i + 1}</span>
                        <span className="text-[13px] font-semibold text-[#7C6E60]">מועמד/ת {i + 1}</span>
                      </div>
                      <div className="space-y-2.5">
                        <Field label="שם" value={r.name} onChange={(v) => setRow(i, { name: v })} placeholder="שם מלא" compact />
                        <Field label="טלפון" value={r.phone} onChange={(v) => setRow(i, { phone: v })} placeholder="050-0000000" type="tel" dir="ltr" compact />
                        <Field
                          label="שורת מחץ על האופי"
                          value={r.note}
                          onChange={(v) => setRow(i, { note: v })}
                          placeholder="המשפט שגורם למישהו להרים ראש"
                          compact
                          area
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {err && <ErrorLine>{err}</ErrorLine>}

                <PrimaryButton onClick={submitLeads} busy={busy} disabled={filled === 0}>
                  {filled === 0 ? "הזינו לפחות מועמד/ת אחד/ת" : `שמירה והמשך (${filled})`}
                  {filled > 0 && <ArrowLeft size={17} />}
                </PrimaryButton>

                <button
                  onClick={() => goTo("done")}
                  className="mt-3 w-full rounded-2xl py-2.5 text-[13px] font-semibold text-[#7C6E60] transition hover:text-[#844442]"
                >
                  אמלא אחר כך
                </button>
              </Card>
            )}

            {step === "done" && (
              <Card>
                <div className="flex flex-col items-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DDE6DF]">
                    <Check size={26} className="text-[#4A6552]" strokeWidth={2.4} />
                  </span>
                  <h2 className="mt-4 text-[26px] font-bold text-[#3A2E26]">נרשמת. נתראה בערב.</h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                    {savedCount > 0
                      ? `${savedCount} מועמדים נשמרו ומחכים לך בדף ההכנה.`
                      : "אפשר להוסיף מועמדים גם בערב עצמו."}
                  </p>
                </div>

                <div className="mt-6 rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-5">
                  <Eyebrow icon={Video}>הכניסה לערב</Eyebrow>
                  {EVENT.zoomUrl ? (
                    <a
                      href={EVENT.zoomUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-[#62826B] py-3.5 text-[15px] font-semibold text-white transition active:scale-95"
                    >
                      <Video size={17} /> כניסה לזום
                    </a>
                  ) : (
                    <p className="mt-2 text-[14px] leading-relaxed text-[#7C6E60]">
                      קישור הזום יישלח אלייך בוואטסאפ למספר שהשארת, לקראת הערב.
                    </p>
                  )}
                </div>

                <button
                  onClick={() => window.print()}
                  className="group mt-5 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#844442] py-4 text-[16px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(132,68,66,0.75)] transition hover:bg-[#5E2F2D] active:scale-[0.98]"
                >
                  <Printer size={19} className="transition-transform group-hover:-translate-y-0.5" />
                  הדפיסו את דף העבודה שלכם
                </button>
                <p className="mt-2 text-center text-[12px] text-[#A2937F]">
                  דף A4 אחד · המדריך והמועמדים שלך, מוכן לשולחן
                </p>
              </Card>
            )}
          </div>
        </main>
      </div>

      {/* ====================== דף ההדפסה (מוסתר על המסך) ====================== */}
      <PrepSheet rows={rows} owner={me} />
    </div>
  );
}

/* ───────────────────────── חלקי הדף ───────────────────────── */

function Hero() {
  return (
    <header className="relative overflow-hidden">
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img("shepherd.jpg")} alt="" aria-hidden="true" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#3A2E26]/75 via-[#3A2E26]/55 to-[#F5EFE6]" />
      </div>

      <div className="relative mx-auto w-full max-w-xl px-5 pb-14 pt-16 text-center">
        <p className="text-[13px] font-semibold tracking-[0.22em] text-[#E6CF9F]">א ד מ ה</p>
        <h1 className="mt-3 text-[40px] font-bold leading-[1.1] text-white drop-shadow-sm">ערב משדכים</h1>
        <p className="mx-auto mt-3 max-w-sm text-[16px] leading-relaxed text-white/85">
          ערב אחד, חדר אחד, וכל השמות שאנחנו נושאים בלב. באים מוכנים — ויוצאים עם התאמות.
        </p>

        <div className="mx-auto mt-7 flex max-w-sm flex-wrap items-center justify-center gap-2">
          <Pill icon={CalendarDays}>{EVENT.dateLabel} · {EVENT.dateShort}</Pill>
          <Pill icon={Clock}>{EVENT.time}</Pill>
          <Pill icon={Video}>{EVENT.place}</Pill>
        </div>
      </div>
    </header>
  );
}

function Pill({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3.5 py-1.5 text-[13px] font-semibold text-white backdrop-blur-sm">
      <Icon size={14} strokeWidth={2} /> {children}
    </span>
  );
}

function Card({ children }) {
  return (
    <section className="-mt-8 rounded-[30px] border border-[#E2D5C4] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(58,46,38,0.35)]">
      {children}
    </section>
  );
}

function Eyebrow({ icon: Icon, children }) {
  return (
    <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-[#A8865A]">
      <Icon size={14} strokeWidth={2} /> {children}
    </p>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", dir, compact, area }) {
  const cls =
    "w-full rounded-2xl border border-[#D9CBB8] bg-white px-4 text-[15px] text-[#3A2E26] outline-none transition placeholder:text-[#BCAC97] focus:border-[#844442] focus:ring-2 focus:ring-[#844442]/15";
  return (
    <label className="block">
      <span className={`mb-1.5 block font-semibold text-[#5E5048] ${compact ? "text-[12px]" : "text-[13px]"}`}>{label}</span>
      {area ? (
        <textarea rows={2} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-none py-2.5`} />
      ) : (
        <input type={type} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} ${compact ? "py-2.5" : "py-3"}`} />
      )}
    </label>
  );
}

function ErrorLine({ children }) {
  return <p className="mt-4 rounded-2xl bg-[#FBEDEC] px-4 py-2.5 text-[13px] font-semibold text-[#C24545]">{children}</p>;
}

function PrimaryButton({ onClick, busy, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#844442] py-4 text-[16px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(132,68,66,0.7)] transition hover:bg-[#5E2F2D] active:scale-[0.98] disabled:opacity-45 disabled:shadow-none"
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : children}
    </button>
  );
}

/* ───────────────────────── דף ההכנה להדפסה ───────────────────────── */

function PrepSheet({ rows, owner }) {
  const list = rows.filter((r) => r.name.trim().length >= 2);
  const shown = list.length ? list : [{ name: "", phone: "", note: "" }, { name: "", phone: "", note: "" }, { name: "", phone: "", note: "" }];

  return (
    <div className="ev-print" aria-hidden="true">
      <div className="ev-sheet">
        <div className="ev-head">
          <div>
            <p className="ev-brand">א ד מ ה</p>
            <h1 className="ev-title">דף העבודה שלי · ערב משדכים</h1>
          </div>
          <div className="ev-when">
            <p>{EVENT.dateLabel}</p>
            <p>{EVENT.dateShort} · {EVENT.time}</p>
          </div>
        </div>

        {owner?.name ? <p className="ev-owner">{owner.name}</p> : null}

        <h2 className="ev-h2">איך מציגים מועמד ב־60 שניות?</h2>
        <ol className="ev-guide">
          {PITCH_GUIDE.map((g, i) => (
            <li key={g.t}>
              <span className="ev-num">{i + 1}</span>
              <span>
                <b>{g.t}.</b> {g.d}
              </span>
            </li>
          ))}
        </ol>

        <h2 className="ev-h2">המועמדים שלי</h2>
        <table className="ev-table">
          <thead>
            <tr>
              <th style={{ width: "6%" }}>#</th>
              <th style={{ width: "24%" }}>שם</th>
              <th style={{ width: "20%" }}>טלפון</th>
              <th>שורת המחץ</th>
              <th style={{ width: "22%" }}>למי זה מתאים? (למילוי בערב)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td className="ev-c">{i + 1}</td>
                <td>{r.name}</td>
                <td dir="ltr" className="ev-ltr">{r.phone}</td>
                <td>{r.note}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="ev-h2">שמות שעלו בערב</h2>
        <table className="ev-table">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>שם</th>
              <th style={{ width: "24%" }}>מי הציג/ה</th>
              <th>למה זה מדבר אליי</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <tr key={i}>
                <td />
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>

        <p className="ev-foot">אדמה · מאגר השידוכים לחוות גבעות</p>
      </div>
    </div>
  );
}

/* ───────────────────────── עיצוב ההדפסה ─────────────────────────
   כל הכללים מקוננים תחת .ev-root, ולכן הם חלים אך ורק על הדף הזה
   ואינם יכולים להשפיע על שום מסך אחר במערכת. */

function PrintStyles() {
  return (
    <style>{`
      .ev-root .ev-print { display: none; }

      @media print {
        .ev-root .ev-screen { display: none !important; }
        .ev-root .ev-print { display: block; }
        .ev-root { background: #fff !important; }
      }

      @page { size: A4 portrait; margin: 14mm 13mm; }

      .ev-sheet {
        font-family: Heebo, system-ui, sans-serif;
        color: #2F261F;
        direction: rtl;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .ev-head {
        display: flex; align-items: flex-end; justify-content: space-between;
        gap: 12px; border-bottom: 2.5px solid #844442; padding-bottom: 9px;
      }
      .ev-brand { margin: 0; font-size: 9.5pt; font-weight: 700; letter-spacing: .3em; color: #A8865A; }
      .ev-title { margin: 3px 0 0; font-size: 17pt; font-weight: 700; color: #844442; }
      .ev-when { text-align: left; font-size: 9.5pt; line-height: 1.45; color: #6B5C50; }
      .ev-when p { margin: 0; }
      .ev-owner { margin: 7px 0 0; font-size: 10.5pt; font-weight: 600; color: #3A2E26; }

      .ev-h2 {
        margin: 15px 0 7px; font-size: 12pt; font-weight: 700; color: #3A2E26;
        border-right: 3.5px solid #D9A441; padding-right: 8px;
      }

      .ev-guide { margin: 0; padding: 0; list-style: none; }
      .ev-guide li {
        display: flex; gap: 8px; align-items: flex-start;
        font-size: 9.7pt; line-height: 1.5; margin-bottom: 5px; color: #4A3F37;
      }
      .ev-num {
        flex: 0 0 auto; width: 16px; height: 16px; margin-top: 1px;
        border-radius: 999px; background: #F0E2DE; color: #844442;
        font-size: 8pt; font-weight: 700; text-align: center; line-height: 16px;
      }
      .ev-guide b { color: #3A2E26; }

      .ev-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
      .ev-table th {
        background: #F5EFE6; color: #5E4A3C; font-weight: 700; font-size: 9pt;
        text-align: right; padding: 6px 7px; border: 1px solid #CCBDAB;
      }
      .ev-table td {
        border: 1px solid #D9CBB8; padding: 9px 7px; height: 30px;
        vertical-align: top; line-height: 1.4;
      }
      .ev-c { text-align: center; color: #A8865A; font-weight: 700; }
      .ev-ltr { direction: ltr; text-align: right; }

      .ev-foot {
        margin-top: 14px; padding-top: 7px; border-top: 1px solid #E2D5C4;
        text-align: center; font-size: 8pt; color: #A2937F;
      }
    `}</style>
  );
}
