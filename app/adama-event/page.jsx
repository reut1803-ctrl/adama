"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Check, Printer, Sparkles, Clock, Video, CalendarDays, Loader2, Plus, UserPlus, Heart,
  MapPin, Navigation,
} from "lucide-react";
import {
  EVENT, saveRsvp, saveLeads, PITCH_GUIDE, loadEventDetails, loadEventPhotos, resolveEvent,
} from "@/lib/crm/eventStore";

// ============================================================================
//  "ערב משדכים" — דף נחיתה עצמאי.
//
//  יחידה סגורה: נתיב משלה, אוספים משלה, וקובץ אחד שמכיל את כל הזרימה.
//  אינה מייבאת דבר מהמערכת חוץ משכבת הנתונים הייעודית שלה, ולכן אינה
//  יכולה לשבור שום מסך קיים.
//
//  שלבי הזרימה:
//   1. הרשמה לערב      -> נשמרת באוסף event_rsvps.
//   2. דף הכנה אישי    -> נשאר במחשב של המשתמש בלבד (Client-side),
//                          משמש רק ליצירת דף ההדפסה ואינו נשמר בשום מסד נתונים.
//   3. המלצת חברים     -> רק לאחר ההדפסה. כל חבר נשמר כמסמך נפרד
//                          באוסף event_leads, עם שדה referred_by.
// ============================================================================

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const img = (n) => `${BASE}/assets/event/${n}`;

const EMPTY_ROW = { name: "", phone: "", note: "" };

// זיכרון מקומי בדפדפן של המשתמש בלבד. נשמר רק במכשיר שלו, לא אצלנו
// ולא במסד הנתונים, ומפתח נפרד לכל אירוע כדי שאירוע חדש יתחיל מאפס.
const STORAGE_PREFIX = "adama-event:";
const storageKey = (ev) => `${STORAGE_PREFIX}${ev?.id || EVENT.id}`;

// עותק מקומי של פרטי האירוע האחרון שנטען במכשיר הזה. בזכותו ביקור חוזר
// מצייר מיד את האירוע הנכון, במקום להמתין לתשובה מהרשת ואז להחליף מולה
// את המסך. המפתח בכוונה בלי נקודתיים, כדי שניקוי האירועים לא ימחק אותו.
const CACHE_KEY = "adama-last-event";

function readCache() {
  try {
    const c = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
    return c && typeof c === "object" && c.id ? c : null;
  } catch {
    return null;
  }
}

function writeCache(ev) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(ev));
    return;
  } catch {}
  // אין מקום לתמונות: שומרים לפחות את הטקסט
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...ev, heroImage: "", gallery: [] }));
  } catch {}
}

// useLayoutEffect רץ לפני הציור, ולכן העותק המקומי נכנס בלי הבהוב.
// בבנייה הסטטית אין window, ושם נופלים ל-useEffect כדי לא להזהיר.
const useBeforePaint = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ניקוי שאריות של אירועים קודמים מהמכשיר. בלי זה, מי שנרשם לאירוע קודם
// נושא אותו איתו לנצח, ועלול לנחות במסך סיום ישן במקום בטופס של היום.
function forgetOtherEvents(current) {
  try {
    const keep = storageKey(current);
    const drop = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX) && k !== keep) drop.push(k);
    }
    drop.forEach((k) => window.localStorage.removeItem(k));
  } catch {}
}

export default function AdamaEventPage() {
  // פרטי האירוע. מתחילים מברירת המחדל המובנית, ואם יש הגדרות שמורות
  // בלוח הבקרה הן מחליפות אותה. כך הדף עובד גם אם אין הגדרות בכלל.
  const [ev, setEv] = useState(EVENT);

  const [step, setStep] = useState("rsvp"); // rsvp | leads | done
  const [leaving, setLeaving] = useState(false);
  const [me, setMe] = useState({ name: "", phone: "" });
  const [rsvpId, setRsvpId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // שלב 2 — הכנה אישית בלבד. נשאר בזיכרון הדפדפן ולא נשמר בשום מקום.
  const [rows, setRows] = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);

  // שלב 3 — המלצת חברים למאגר. נפתח רק אחרי ההדפסה.
  const [printed, setPrinted] = useState(false);
  const [friends, setFriends] = useState([{ ...EMPTY_ROW }]);
  const [refBusy, setRefBusy] = useState(false);
  const [refErr, setRefErr] = useState("");
  const [refSaved, setRefSaved] = useState(0);
  const [refDone, setRefDone] = useState(false);

  // ready נדלק אחרי ניסיון השחזור, כדי שלא נדרוס את מה ששמור
  // בכתיבה הראשונה, ושלא יהבהב מסך שלב 1 למי שכבר נרשם.
  const [ready, setReady] = useState(false);
  // trusted = ידוע בוודאות איזה אירוע פעיל. בלי זה לא משחזרים ולא שומרים,
  // כדי שלא נכתוב מצב תחת מזהה של אירוע ישן.
  const [trusted, setTrusted] = useState(false);
  // known = יש לנו פרטי אירוע אמיתיים להציג. עד אז לא מציירים את
  // הכותרת והתגיות, כדי שלא יופיע לרגע אירוע ישן ואז יתחלף.
  const [known, setKnown] = useState(false);

  // ציור מיידי מהעותק המקומי, לפני כל פנייה לרשת
  useBeforePaint(() => {
    const cached = readCache();
    if (!cached) return;
    setEv(cached);
    setKnown(true);
    restore(cached);
    setReady(true);
  }, []);

  // טעינת ההגדרות, ואחריה שחזור: מי שרענן, סגר וחזר, או נכנס שוב
  // מהקישור - נוחת בדיוק במסך שבו היה, בלי להקליד שום דבר מחדש.
  useEffect(() => {
    let alive = true;
    (async () => {
      // שתי הקריאות יוצאות יחד, אבל הדף אינו ממתין לתמונות: ברגע
      // שפרטי האירוע חוזרים הוא כבר מצויר במלואו, והתמונות נכנסות
      // אחר כך ברכות אל הרקע.
      const photosPromise = loadEventPhotos().catch(() => ({}));

      let resolved = EVENT;
      let ok = false;
      let settings = null;
      try {
        const details = await loadEventDetails();
        settings = details.settings;
        resolved = resolveEvent(settings, {});
        // ok = באמת יודעים איזה אירוע פעיל עכשיו. אם הקריאה נחסמה
        // או נכשלה, אסור לשחזר מצב ישן: עדיף טופס נקי מאשר אירוע שגוי.
        ok = !details.blocked;
      } catch {
        // אין הגדרות או שהקריאה נכשלה - ממשיכים עם ברירת המחדל
      }
      if (!alive) return;

      // התמונות שכבר מצוירות מהעותק המקומי נשארות על המסך, כדי שהרקע
      // לא יקפוץ לרגע לתמונה המובנית בזמן שהתמונות האמיתיות בדרך
      const cached = readCache();
      const cachedId = cached?.id || null;
      if (cached && cached.id === resolved.id) {
        resolved = { ...resolved, heroImage: cached.heroImage || "", gallery: cached.gallery || [] };
      }

      setEv(resolved);
      setTrusted(ok);
      if (ok) {
        forgetOtherEvents(resolved);
        if (cachedId !== resolved.id) {
          // אירוע אחר ממה שהיה שמור כאן: מתחילים נקי ומשחזרים את החדש
          if (cachedId) resetFlow();
          restore(resolved);
        }
      }
      setKnown(true);
      setReady(true);

      // שלב שני: התמונות נכנסות אל הרקע כשהן מוכנות
      const photos = await photosPromise;
      if (!alive || !ok) return;
      const withPhotos = resolveEvent(settings, photos);
      setEv(withPhotos);
      writeCache(withPhotos);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const restore = (forEvent) => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey(forEvent)) || "null");
      // שחזור רק אם הרשומה שייכת בוודאות לאירוע הנוכחי
      if (saved && typeof saved === "object" && (!saved.evId || saved.evId === forEvent.id)) {
        if (saved.step === "leads" || saved.step === "done") setStep(saved.step);
        if (saved.me) setMe({ name: saved.me.name || "", phone: saved.me.phone || "" });
        if (saved.rsvpId) setRsvpId(saved.rsvpId);
        if (Array.isArray(saved.rows) && saved.rows.length) {
          setRows(saved.rows.map((r) => ({ name: r?.name || "", phone: r?.phone || "", note: r?.note || "" })));
        }
        if (saved.printed) setPrinted(true);
        if (saved.refDone) {
          setRefDone(true);
          setRefSaved(Number(saved.refSaved) || 0);
        }
      }
    } catch {
      // גלישה פרטית או חסימת אחסון - פשוט מתחילים רגיל
    }
  };

  // שמירה שוטפת. try/catch כי בגלישה פרטית הכתיבה עלולה להיכשל,
  // ואסור שזה יפיל את הדף.
  useEffect(() => {
    if (!ready || !trusted) return;
    try {
      window.localStorage.setItem(
        storageKey(ev),
        JSON.stringify({ evId: ev.id, step, me, rsvpId, rows, printed, refDone, refSaved })
      );
    } catch {}
  }, [ready, trusted, ev, step, me, rsvpId, rows, printed, refDone, refSaved]);

  // איפוס כל שדות הזרימה למצב התחלתי
  const resetFlow = () => {
    setStep("rsvp");
    setMe({ name: "", phone: "" });
    setRsvpId(null);
    setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);
    setPrinted(false);
    setFriends([{ ...EMPTY_ROW }]);
    setRefDone(false);
    setRefSaved(0);
    setRefErr("");
    setErr("");
  };

  // התחלה נקייה, למי שרוצה לרשום מישהו אחר מאותו מכשיר
  const startOver = () => {
    try {
      window.localStorage.removeItem(storageKey(ev));
    } catch {}
    setMe({ name: "", phone: "" });
    setRsvpId(null);
    setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);
    setPrinted(false);
    setFriends([{ ...EMPTY_ROW }]);
    setRefDone(false);
    setRefSaved(0);
    setRefErr("");
    setErr("");
    goTo("rsvp");
  };

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
      setRsvpId(await saveRsvp(me, ev.id));
      goTo("leads");
    } catch {
      setErr("ההרשמה לא נשמרה. אפשר לנסות שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  const filled = rows.filter((r) => r.name.trim().length >= 2).length;

  // שלב 2 אינו שומר שום דבר. הנתונים נשארים בזיכרון הדפדפן ומשמשים
  // אך ורק להרכבת דף ההדפסה האישי של המשתמש.
  const continueToPrep = () => {
    setErr("");
    goTo("done");
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // ההדפסה היא מה שפותח את שלב 3
  const handlePrint = () => {
    setPrinted(true);
    setTimeout(() => window.print(), 80);
  };

  /* ---------- שלב 3: המלצת חברים למאגר אדמה ---------- */

  const setFriend = (i, patch) => setFriends((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const addFriend = () => setFriends((fs) => [...fs, { ...EMPTY_ROW }]);
  const friendsFilled = friends.filter((f) => f.name.trim().length >= 2).length;

  const submitFriends = async () => {
    setRefErr("");
    if (friendsFilled === 0) return setRefErr("צריך לפחות שם אחד");
    setRefBusy(true);
    try {
      // saveLeads יוצר מסמך נפרד לכל חבר באוסף event_leads, עם referred_by
      const n = await saveLeads(rsvpId, friends, me, ev.id);
      setRefSaved(n);
      setRefDone(true);
      setFriends([{ ...EMPTY_ROW }]);
    } catch {
      setRefErr("השליחה לא הצליחה. אפשר לנסות שוב בעוד רגע.");
    } finally {
      setRefBusy(false);
    }
  };

  return (
    <div dir="rtl" className="ev-root min-h-screen bg-[#F5EFE6]">
      <PrintStyles />

      {/* ====================== המסך (מוסתר בהדפסה) ====================== */}
      <div className="ev-screen">
        <Hero ev={ev} known={known} />

        <main className="mx-auto w-full max-w-xl px-5 pb-24">
          <div
            className="transition-all duration-300"
            style={{
              opacity: leaving || !ready ? 0 : 1,
              transform: leaving ? "translateY(14px)" : "none",
              visibility: ready ? "visible" : "hidden",
            }}
            aria-hidden={ready ? undefined : "true"}
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
                  שלושה מועמדים שתרצה/י להציג. השמות האלה נשארים אצלך בלבד — הם משמשים רק
                  להרכבת דף ההכנה להדפסה, ואינם נשמרים אצלנו בשום מקום.
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

                <PrimaryButton onClick={continueToPrep} busy={busy} disabled={filled === 0}>
                  {filled === 0 ? "הזינו לפחות מועמד/ת אחד/ת" : `המשך לדף ההכנה (${filled})`}
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
              <>
                <Card>
                  <div className="flex flex-col items-center text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DDE6DF]">
                      <Check size={26} className="text-[#4A6552]" strokeWidth={2.4} />
                    </span>
                    <h2 className="mt-4 text-[26px] font-bold text-[#3A2E26]">נרשמת. נתראה בערב.</h2>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                      {filled > 0
                        ? `דף ההכנה שלך מוכן, עם ${filled} המועמדים שהזנת בפנים.`
                        : "דף ההכנה שלך מוכן להדפסה."}
                    </p>
                  </div>

                  <div className="mt-6 rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-5">
                    <Eyebrow icon={ev.mode === "place" ? MapPin : Video}>
                      {ev.mode === "place" ? "איפה נפגשים" : "הכניסה לערב"}
                    </Eyebrow>

                    {ev.mode === "place" ? (
                      <>
                        <p className="mt-2 text-[15px] font-bold leading-relaxed text-[#3A2E26]">
                          {ev.placeName || ev.place}
                        </p>
                        {ev.address && (
                          <p className="mt-0.5 text-[14px] leading-relaxed text-[#7C6E60]">{ev.address}</p>
                        )}
                        {ev.navUrl && (
                          <a
                            href={ev.navUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-[#62826B] py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_26px_-14px_rgba(98,130,107,0.9)] transition hover:bg-[#4E6B56] active:scale-95"
                          >
                            <Navigation size={17} /> ניווט ב-Waze
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="mt-2 text-[14px] leading-relaxed text-[#7C6E60]">
                          הערב מתקיים בזום. אפשר להיכנס מכאן ישירות, וכדאי לשמור את הקישור.
                        </p>
                        {ev.zoomUrl && (
                          <a
                            href={ev.zoomUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-[#62826B] py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_26px_-14px_rgba(98,130,107,0.9)] transition hover:bg-[#4E6B56] active:scale-95"
                          >
                            <Video size={17} /> כניסה לזום
                          </a>
                        )}
                      </>
                    )}
                  </div>

                  <button
                    onClick={handlePrint}
                    className="group mt-5 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#844442] py-4 text-[16px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(132,68,66,0.75)] transition hover:bg-[#5E2F2D] active:scale-[0.98]"
                  >
                    <Printer size={19} className="transition-transform group-hover:-translate-y-0.5" />
                    הדפיסו את דף העבודה שלכם
                  </button>
                  <p className="mt-2 text-center text-[12px] text-[#A2937F]">
                    דף A4 אחד · המדריך והמועמדים שלך, מוכן לשולחן
                  </p>

                  {!printed && (
                    <button
                      onClick={() => setPrinted(true)}
                      className="mt-3 w-full rounded-2xl py-2.5 text-[13px] font-semibold text-[#7C6E60] transition hover:text-[#844442]"
                    >
                      אדפיס אחר כך
                    </button>
                  )}

                  <button
                    onClick={startOver}
                    className="mt-4 w-full py-1 text-[12px] text-[#BCAC97] underline underline-offset-2 transition hover:text-[#844442]"
                  >
                    לרשום מישהו אחר מהמכשיר הזה
                  </button>
                </Card>

                {/* ---------- שלב 3: נפתח רק אחרי ההדפסה ---------- */}
                {printed && !refDone && (
                  <Panel>
                    <Eyebrow icon={UserPlus}>שלב שלישי</Eyebrow>
                    <h2 className="mt-2 text-[24px] font-bold leading-tight text-[#3A2E26]">
                      רוצים להוסיף חברים למאגר אדמה?
                    </h2>
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#EFF4EF] px-3 py-1 text-[12px] font-bold text-[#4A6552]">
                      <Heart size={13} strokeWidth={2.4} /> ללא עלות
                    </p>
                    <p className="mt-3 text-[15px] leading-relaxed text-[#7C6E60]">
                      כל שם שתוסיפו נכנס למאגר ואנחנו ממשיכים מכאן. אפשר להוסיף כמה שרוצים —
                      לוחצים על הפלוס ומקבלים כרטיס נוסף.
                    </p>

                    <div className="mt-6 space-y-5">
                      {friends.map((f, i) => (
                        <div key={i} className="rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-4">
                          <div className="mb-3 flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#844442] text-[13px] font-bold text-white">
                              {i + 1}
                            </span>
                            <span className="text-[13px] font-semibold text-[#7C6E60]">חבר/ה {i + 1}</span>
                          </div>
                          <div className="space-y-2.5">
                            <Field label="שם" value={f.name} onChange={(v) => setFriend(i, { name: v })} placeholder="שם מלא" compact />
                            <Field label="טלפון" value={f.phone} onChange={(v) => setFriend(i, { phone: v })} placeholder="050-0000000" type="tel" dir="ltr" compact />
                            <Field
                              label="כמה מילים עליו/עליה"
                              value={f.note}
                              onChange={(v) => setFriend(i, { note: v })}
                              placeholder="מי זה בשתי שורות"
                              compact
                              area
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={addFriend}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#D9CBB8] py-3.5 text-[14px] font-bold text-[#844442] transition hover:border-[#844442] hover:bg-[#FBF7F1] active:scale-[0.99]"
                    >
                      <Plus size={18} strokeWidth={2.6} /> הוספת חבר/ה נוסף/ת
                    </button>

                    {refErr && <ErrorLine>{refErr}</ErrorLine>}

                    <PrimaryButton onClick={submitFriends} busy={refBusy} disabled={friendsFilled === 0}>
                      {friendsFilled === 0 ? "הזינו לפחות שם אחד" : `שליחה למאגר (${friendsFilled})`}
                      {friendsFilled > 0 && <ArrowLeft size={17} />}
                    </PrimaryButton>
                  </Panel>
                )}

                {refDone && (
                  <Panel>
                    <div className="flex flex-col items-center text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F4EADF]">
                        <Heart size={22} className="text-[#844442]" strokeWidth={2.4} />
                      </span>
                      <h2 className="mt-3 text-[22px] font-bold text-[#3A2E26]">
                        {refSaved === 1 ? "חבר/ה אחד/ת נוסף/ה למאגר. תודה!" : `${refSaved} חברים נוספו למאגר. תודה!`}
                      </h2>
                      <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                        אנחנו ממשיכים מכאן. אם עולים לך עוד שמות — אפשר להוסיף גם עכשיו.
                      </p>
                      <button
                        onClick={() => {
                          setRefDone(false);
                          setRefErr("");
                          setFriends([{ ...EMPTY_ROW }]);
                        }}
                        className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-[#D9CBB8] px-5 py-3 text-[14px] font-bold text-[#844442] transition hover:bg-[#FBF7F1] active:scale-[0.98]"
                      >
                        <Plus size={17} strokeWidth={2.6} /> להוסיף עוד חברים
                      </button>
                    </div>
                  </Panel>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* ====================== דף ההדפסה (מוסתר על המסך) ====================== */}
      <PrepSheet rows={rows} owner={me} ev={ev} />
    </div>
  );
}

/* ───────────────────────── חלקי הדף ───────────────────────── */

function Hero({ ev, known }) {
  const PlaceIcon = ev.mode === "place" ? MapPin : Video;

  // כל התמונות שהועלו, לפי הסדר. אם אין אף אחת - התמונה המובנית.
  // חתימה יציבה: אותן תמונות בדיוק = אותה רשימה, ולכן הקרוסלה אינה
  // מתאפסת כשפרטי האירוע נטענים מחדש מהשרת ומחליפים את העותק המקומי.
  const sig = `${ev.heroImage ? ev.heroImage.length : 0}|${(ev.gallery || []).map((g) => g.length).join(",")}`;
  const slides = useMemo(() => {
    const all = [ev.heroImage, ...(ev.gallery || [])].filter(Boolean);
    return all.length ? all : [img("shepherd.jpg")];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const [slide, setSlide] = useState(0);

  // החלפה אוטומטית רכה. תמונה אחת = רקע קבוע, בדיוק כמו קודם.
  // מי שביקש במכשיר שלו להפחית תנועה מקבל רקע קבוע.
  useEffect(() => {
    setSlide(0);
    if (slides.length < 2) return undefined;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
    if (reduced) return undefined;
    const t = setInterval(() => setSlide((n) => (n + 1) % slides.length), 5200);
    return () => clearInterval(t);
  }, [slides]);

  const current = Math.min(slide, slides.length - 1);

  return (
    <header className="relative min-h-[54vh] overflow-hidden">
      <div className="absolute inset-0">
        {slides.map((src, n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={n}
            src={src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out"
            style={{ opacity: n === current ? 1 : 0 }}
          />
        ))}
        {/* מעבר רך: כהה רק בראש, בשביל קריאוּת הכותרת, מתבהר על הרועה
            והכבשים, ונמס אל צבע הרקע של הדף בתחתית */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(58,46,38,0.74) 0%, rgba(58,46,38,0.46) 24%, rgba(58,46,38,0.16) 50%, rgba(58,46,38,0.04) 64%, rgba(245,239,230,0.32) 78%, rgba(245,239,230,0.86) 92%, #F5EFE6 100%)",
          }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-xl px-5 pb-28 pt-14 text-center">
        <p className="text-[13px] font-semibold tracking-[0.22em] text-[#E6CF9F]">א ד מ ה</p>

        {/* עד שידועים פרטי האירוע האמיתיים לא מציירים כותרת ותגיות,
            כדי שלא יופיע לרגע אירוע קודם ואז יוחלף מול העיניים */}
        <div
          className="relative transition-opacity duration-300"
          style={{ opacity: known ? 1 : 0 }}
          aria-hidden={known ? undefined : "true"}
        >
          {/* הצללה רכה מאחורי הטקסט בלבד. רדיאלית ובלי שוליים חדים,
              ולכן היא לא נראית כקופסה ואינה מכהה את שאר התמונה. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 -top-8 bottom-[-18px] w-screen -translate-x-1/2"
            style={{
              background:
                "radial-gradient(58% 78% at 50% 44%, rgba(38,29,23,0.58) 0%, rgba(38,29,23,0.44) 40%, rgba(38,29,23,0.18) 66%, rgba(38,29,23,0) 84%)",
            }}
          />

          <div className="relative">
            <h1
              className="mt-3 text-[40px] font-bold leading-[1.1] text-white"
              style={{ textShadow: "0 2px 16px rgba(30,22,17,0.6), 0 1px 3px rgba(30,22,17,0.55)" }}
            >
              {ev.title}
            </h1>
            <p
              className="mx-auto mt-3 max-w-sm text-[16px] font-medium leading-relaxed text-white"
              style={{ textShadow: "0 2px 14px rgba(30,22,17,0.72), 0 1px 2px rgba(30,22,17,0.6)" }}
            >
              {ev.tagline}
            </p>

            <div className="mx-auto mt-6 flex max-w-sm flex-wrap items-center justify-center gap-2">
              <Pill icon={CalendarDays}>{ev.dateLabel} · {ev.dateShort}</Pill>
              <Pill icon={Clock}>{ev.time}</Pill>
              <Pill icon={PlaceIcon}>{ev.place}</Pill>
            </div>
          </div>

        </div>

        {/* שורת הנקודות שומרת על גובה קבוע גם לפני שהיא מופיעה,
            כדי ששום דבר מתחתיה לא יזוז כשהיא נכנסת */}
        <div
          className="mx-auto mt-7 flex h-2 items-center justify-center gap-2 transition-opacity duration-300"
          style={{ opacity: known && slides.length > 1 ? 1 : 0 }}
          aria-hidden={known && slides.length > 1 ? undefined : "true"}
        >
          {slides.length > 1 &&
            slides.map((_, n) => (
              <button
                key={n}
                onClick={() => setSlide(n)}
                aria-label={`תמונה ${n + 1}`}
                className={`h-2 rounded-full transition-all duration-300 ${
                  n === current ? "w-7 bg-white" : "w-2 bg-white/45 hover:bg-white/70"
                }`}
              />
            ))}
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
    <section className="mt-5 rounded-[30px] border border-[#E2D5C4] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(58,46,38,0.35)]">
      {children}
    </section>
  );
}

// כרטיס המשך — זהה ל-Card אבל ממוקם מתחת לכרטיס שלפניו ולא נצמד לכותרת
function Panel({ children }) {
  return (
    <section className="mt-5 rounded-[30px] border border-[#E2D5C4] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(58,46,38,0.35)]">
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

function PrepSheet({ rows, owner, ev }) {
  const list = rows.filter((r) => r.name.trim().length >= 2);
  const shown = list.length ? list : [{ name: "", phone: "", note: "" }, { name: "", phone: "", note: "" }, { name: "", phone: "", note: "" }];

  return (
    <div className="ev-print" aria-hidden="true">
      <div className="ev-sheet">
        <div className="ev-head">
          <div>
            <p className="ev-brand">א ד מ ה</p>
            <h1 className="ev-title">דף העבודה שלי · {ev.title}</h1>
          </div>
          <div className="ev-when">
            <p>{ev.dateLabel}</p>
            <p>{ev.dateShort} · {ev.time}</p>
            <p>{ev.mode === "place" ? ev.placeName || ev.place : "בזום"}</p>
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
