"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, Printer, Sparkles, Clock, Video, CalendarDays, Loader2, Plus, UserPlus, Heart,
  MapPin, Navigation, CalendarPlus, Share2, Backpack,
} from "lucide-react";
import {
  EVENT, saveRsvp, saveLeads, PITCH_GUIDE, loadEventDetails, loadEventPhotos, resolveEvent, eventTimes,
} from "@/lib/crm/eventStore";

// ============================================================================
//  דף נחיתה עצמאי למפגש המשדכים.
//
//  יחידה סגורה: נתיב משלה, אוספים משלה, וקובץ אחד שמכיל את כל הזרימה.
//  אינה מייבאת דבר מהמערכת חוץ משכבת הנתונים הייעודית שלה, ולכן אינה
//  יכולה לשבור שום מסך קיים.
//
//  שלבי הזרימה:
//   1. הרשמה למפגש     -> נשמרת באוסף event_rsvps.
//   2. דף הכנה אישי    -> נשאר במחשב של המשתמש בלבד (Client-side),
//                          משמש רק ליצירת דף ההדפסה ואינו נשמר בשום מסד נתונים.
//   3. המלצת חברים     -> רק לאחר ההדפסה. כל חבר נשמר כמסמך נפרד
//                          באוסף event_leads, עם שדה referred_by.
// ============================================================================

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const img = (n) => `${BASE}/assets/event/${n}`;

const EMPTY_ROW = { name: "", phone: "", note: "" };

/* ─────────── עזרי תוכן: טלפון, יומן, שיתוף, ספירה לאחור ─────────── */

// מספר ישראלי תקין: נייד (05X) או קו נייח (02/03/04/08/09/072...).
// מקבלים גם רווחים, מקפים ו-+972, וקודם מנקים הכול לספרות בלבד.
export function normalizePhone(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+972")) d = "0" + d.slice(4);
  else if (d.startsWith("972")) d = "0" + d.slice(3);
  return d.replace(/\D/g, "");
}

export function isIsraeliPhone(raw) {
  const d = normalizePhone(raw);
  if (/^05\d{8}$/.test(d)) return true;        // נייד
  if (/^0(2|3|4|8|9)\d{7}$/.test(d)) return true; // קו נייח
  if (/^07\d{8}$/.test(d)) return true;        // 072/073/077 וכו'
  return false;
}

const pad = (n) => String(n).padStart(2, "0");
const toUtcStamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes()
  )}00Z`;

function eventSummary(ev) {
  const where = ev.mode === "place" ? ev.placeName || ev.place : "בזום";
  return { title: ev.title, where, details: `${ev.dateLabel} · ${ev.dateShort} · ${ev.time}` };
}

function googleCalendarUrl(ev, times) {
  const { title, where } = eventSummary(ev);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toUtcStamp(times.start)}/${toUtcStamp(times.end)}`,
    details: ev.tagline || "",
    location: ev.address || where,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// קובץ ics להורדה, לאייפון ולכל יומן אחר. נבנה בדפדפן, בלי שום ספרייה.
function downloadIcs(ev, times) {
  const { title, where } = eventSummary(ev);
  const esc = (v) => String(v || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//adama//event//HE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@adama`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(times.start)}`,
    `DTEND:${toUtcStamp(times.end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(ev.tagline)}`,
    `LOCATION:${esc(ev.address || where)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "adama-event.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function shareText(ev) {
  const { where } = eventSummary(ev);
  const url = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
  return `${ev.title}\n${ev.dateLabel} · ${ev.dateShort} · ${ev.time}\n${where}\n\nנרשמים כאן:\n${url}`;
}

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
  // שלוש רמות, מהשלמה לדלילה. חשוב שהתמונה הראשית תישמר גם כשאין מקום
  // לכולן: היא זו שמצוירת ראשונה בביקור הבא.
  const tries = [
    ev,
    { ...ev, gallery: [] },
    { ...ev, heroImage: "", gallery: [] },
  ];
  for (const attempt of tries) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(attempt));
      return;
    } catch {}
  }
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
  // photosReady = התמונות כבר נבדקו. רק אז מותר ליפול לתמונה המובנית,
  // אחרת היא מופיעה בחלון שבין טעינת הפרטים לטעינת התמונות.
  const [photosReady, setPhotosReady] = useState(false);

  // מועדי המפגש, לספירה לאחור ולכפתורי היומן
  const times = useMemo(() => eventTimes(ev), [ev]);

  // עוגן לכפתור ההרשמה עצמו: הכפתור הדביק בנייד מגלגל אליו ונעלם
  // ברגע שהוא על המסך. נמדד הכפתור ולא הכרטיס כולו, כי כרטיס גבוה
  // יכול להישאר "נראה" גם כשהכפתור כבר מתחת לקיפול.
  const formRef = useRef(null);
  const [formVisible, setFormVisible] = useState(true);

  // ציור מיידי מהעותק המקומי, לפני כל פנייה לרשת
  useBeforePaint(() => {
    const cached = readCache();
    if (!cached) return;
    setEv(cached);
    setKnown(true);
    if (cached.heroImage || (cached.gallery || []).length) setPhotosReady(true);
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
      if (!alive) return;
      setPhotosReady(true);
      if (!ok) return;
      const withPhotos = resolveEvent(settings, photos);
      setEv(withPhotos);
      writeCache(withPhotos);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // מעקב אחרי הטופס, בשביל הכפתור הדביק
  useEffect(() => {
    const el = formRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => setFormVisible(e.isIntersecting)), {
      rootMargin: "0px 0px -90px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ready, step]);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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
    if (!me.phone.trim()) return setErr("צריך מספר טלפון");
    if (!isIsraeliPhone(me.phone)) return setErr("מספר הטלפון לא נראה תקין. למשל 050-0000000");
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
        <Hero ev={ev} known={known} photosReady={photosReady} times={times} />

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
              <>
                <Card>
                  <div>
                    <Eyebrow icon={CalendarDays}>שריון מקום</Eyebrow>
                    <h2 className="mt-2 text-[26px] font-bold leading-tight text-[#3A2E26]">אני מגיע/ה</h2>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                      שם וטלפון, וזהו. הטלפון נשמר רק כדי שנוכל להגיע אלייך אם משהו משתנה ברגע האחרון.
                    </p>

                    <div className="mt-6 space-y-3">
                      <Field
                        label="שם מלא"
                        value={me.name}
                        onChange={(v) => setMe((m) => ({ ...m, name: v }))}
                        placeholder="איך קוראים לך?"
                        autoComplete="name"
                      />
                      <Field
                        label="טלפון"
                        value={me.phone}
                        onChange={(v) => setMe((m) => ({ ...m, phone: v }))}
                        placeholder="050-0000000"
                        type="tel"
                        dir="ltr"
                        inputMode="numeric"
                        autoComplete="tel"
                      />
                    </div>

                    {err && <ErrorLine>{err}</ErrorLine>}

                    <div ref={formRef}>
                      <PrimaryButton onClick={submitRsvp} busy={busy} busyLabel="שולח...">
                        אני מגיע/ה <ArrowLeft size={17} />
                      </PrimaryButton>
                    </div>
                  </div>

                  <BringNote ev={ev} />
                </Card>

                <Reveal>
                  <Panel>
                    <Eyebrow icon={MapPin}>הפרטים במקום אחד</Eyebrow>
                    <p className="mt-2 text-[15px] font-bold leading-relaxed text-[#3A2E26]">
                      {ev.dateLabel} · {ev.dateShort}
                    </p>
                    <p className="text-[15px] leading-relaxed text-[#7C6E60]">
                      {ev.time} · {ev.mode === "place" ? ev.placeName || ev.place : ev.place}
                    </p>
                    {ev.mode === "place" && ev.address && ev.address !== (ev.placeName || "") && (
                      <p className="mt-0.5 text-[14px] leading-relaxed text-[#A2937F]">{ev.address}</p>
                    )}
                    <div className="mt-4">
                      <ActionButtons ev={ev} times={times} />
                    </div>
                  </Panel>
                </Reveal>
              </>
            )}

            {step === "leads" && (
              <Card>
                <Eyebrow icon={Sparkles}>שלב שני</Eyebrow>
                <h2 className="mt-2 text-[26px] font-bold leading-tight text-[#3A2E26]">מי את/ה מביא/ה למפגש?</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                  שלושה מועמדים שתרצה/י להציג במפגש. השמות האלה נשארים אצלך בלבד — הם משמשים רק
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
                    <h2 className="mt-4 text-[26px] font-bold text-[#3A2E26]">נרשמת. איזה כיף שאת/ה בא/ה.</h2>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                      שמרנו לך מקום. {ev.dateLabel} · {ev.dateShort}, {ev.time}, {ev.mode === "place" ? ev.placeName || ev.place : ev.place}.
                    </p>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#7C6E60]">
                      {filled > 0
                        ? `דף ההכנה שלך מוכן, עם ${filled} המועמדים שהזנת בפנים.`
                        : "דף ההכנה שלך מוכן להדפסה."}
                    </p>
                  </div>

                  <div className="mt-6 rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-5">
                    <Eyebrow icon={ev.mode === "place" ? MapPin : Video}>
                      {ev.mode === "place" ? "איפה נפגשים" : "הכניסה למפגש"}
                    </Eyebrow>

                    {ev.mode === "place" ? (
                      <>
                        <p className="mt-2 text-[15px] font-bold leading-relaxed text-[#3A2E26]">
                          {ev.placeName || ev.place}
                        </p>
                        {ev.address && ev.address !== (ev.placeName || ev.place) && (
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
                          המפגש מתקיים בזום. אפשר להיכנס מכאן ישירות, וכדאי לשמור את הקישור.
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

                  <div className="mt-5">
                    <ActionButtons ev={ev} times={times} hideNav />
                  </div>

                  <BringNote ev={ev} />

                  <button
                    onClick={handlePrint}
                    className="group mt-5 flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[#844442] py-4 text-[16px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(132,68,66,0.75)] transition hover:bg-[#5E2F2D] active:scale-[0.98]"
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

      {/* כפתור דביק בנייד: מופיע רק בשלב ההרשמה וכשהטופס אינו על המסך */}
      <div
        className="ev-sticky pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(14px,env(safe-area-inset-bottom))] transition-all duration-300 sm:hidden"
        style={{
          opacity: ready && step === "rsvp" && !formVisible ? 1 : 0,
          transform: ready && step === "rsvp" && !formVisible ? "none" : "translateY(120%)",
        }}
        aria-hidden={ready && step === "rsvp" && !formVisible ? undefined : "true"}
      >
        <button
          onClick={scrollToForm}
          tabIndex={ready && step === "rsvp" && !formVisible ? 0 : -1}
          className="pointer-events-auto flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-[#844442] text-[17px] font-bold text-white shadow-[0_14px_36px_-10px_rgba(58,46,38,0.6)] transition active:scale-[0.98]"
        >
          אני מגיע/ה <ArrowLeft size={18} />
        </button>
      </div>

      {/* ====================== דף ההדפסה (מוסתר על המסך) ====================== */}
      <PrepSheet rows={rows} owner={me} ev={ev} />
    </div>
  );
}

/* ───────────────────────── חלקי הדף ───────────────────────── */

// הופעה רכה בגלילה. אם הדפדפן אינו תומך, או שהמשתמש ביקש להפחית
// תנועה, התוכן פשוט מוצג - אף פעם לא נשאר מוסתר.
function Reveal({ children, className = "" }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setShown(true)),
      { rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${className}`}
      style={{ opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(14px)" }}
    >
      {children}
    </div>
  );
}

// ספירה לאחור עדינה. נעלמת לגמרי ברגע שהמפגש התחיל.
function Countdown({ times }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  if (!times) return null;
  const left = times.start.getTime() - now;
  if (left <= 0) return null;
  const days = Math.floor(left / 86400000);
  const hours = Math.floor((left % 86400000) / 3600000);
  const text =
    days > 0
      ? `עוד ${days} ${days === 1 ? "יום" : "ימים"}${hours > 0 ? ` ו-${hours} שעות` : ""}`
      : hours > 0
      ? `עוד ${hours} ${hours === 1 ? "שעה" : "שעות"}`
      : "מתחילים עוד מעט";
  return (
    <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/25 px-3.5 py-1.5 text-[13px] font-semibold text-white backdrop-blur-sm">
      <Clock size={13} strokeWidth={2.2} /> {text}
    </p>
  );
}

// כפתורי פעולה על המפגש: ניווט, יומן ושיתוף. חוזרים בכמה מקומות בדף.
function ActionButtons({ ev, times, hideNav }) {
  const [shared, setShared] = useState(false);

  const share = async () => {
    const text = shareText(ev);
    try {
      if (navigator.share) {
        await navigator.share({ title: ev.title, text });
        return;
      }
    } catch {
      return; // המשתמש ביטל
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  const base =
    "flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-[14px] font-bold transition active:scale-[0.97] min-h-[48px]";

  return (
    <div className="grid grid-cols-2 gap-2">
      {!hideNav && ev.navUrl && (
        <a
          href={ev.navUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} border-[#4E6B56] bg-[#62826B] text-white hover:bg-[#4E6B56]`}
        >
          <Navigation size={16} /> נווטו ב-Waze
        </a>
      )}
      {times && (
        <button
          onClick={() => downloadIcs(ev, times)}
          className={`${base} border-[#D9CBB8] bg-white text-[#844442] hover:bg-[#FBF7F1]`}
        >
          <CalendarPlus size={16} /> הוסף ליומן
        </button>
      )}
      {times && (
        <a
          href={googleCalendarUrl(ev, times)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} border-[#D9CBB8] bg-white text-[#844442] hover:bg-[#FBF7F1]`}
        >
          <CalendarDays size={16} /> יומן גוגל
        </a>
      )}
      <button
        onClick={share}
        className={`${base} border-[#D9CBB8] bg-white text-[#4A6552] hover:bg-[#EFF4EF]`}
      >
        <Share2 size={16} /> {shared ? "נפתח וואטסאפ" : "שתפו בוואטסאפ"}
      </button>
    </div>
  );
}

// מה להביא
function BringNote({ ev }) {
  if (!ev.bring) return null;
  return (
    <p className="mt-4 flex items-start gap-2 rounded-2xl border border-[#E2D5C4] bg-[#FBF7F1] px-3.5 py-3 text-[14px] leading-relaxed text-[#5E5048]">
      <Backpack size={16} className="mt-0.5 shrink-0 text-[#A8865A]" />
      <span>
        <b className="font-bold text-[#3A2E26]">מה להביא:</b> {ev.bring}
      </span>
    </p>
  );
}

function Hero({ ev, known, photosReady, times }) {
  const PlaceIcon = ev.mode === "place" ? MapPin : Video;

  // כותרת ארוכה יורדת בגודל במקום להישבר לשורות דחוסות.
  // text-balance מחלק את השורות באופן שווה, ולכן אין שבירה באמצע משפט.
  const titleLen = (ev.title || "").length;
  const titleSize =
    titleLen > 44 ? "text-[26px] leading-[1.22]"
    : titleLen > 30 ? "text-[30px] leading-[1.2]"
    : titleLen > 18 ? "text-[34px] leading-[1.15]"
    : "text-[40px] leading-[1.1]";

  // כל התמונות שהועלו, לפי הסדר.
  //
  // כל עוד לא ידוע מה האירוע הפעיל לא מציגים שום תמונה. התמונה המובנית
  // היא התמונה של האירוע הראשון, ואם מציירים אותה בזמן הטעינה היא
  // נראית לרגע כמו האירוע הקודם ואז מתחלפת. עדיף רקע נקי עד שיודעים.
  //
  // חתימה יציבה: אותן תמונות בדיוק = אותה רשימה, ולכן הקרוסלה אינה
  // מתאפסת כשפרטי האירוע נטענים מחדש מהשרת ומחליפים את העותק המקומי.
  const sig = `${known ? 1 : 0}|${photosReady ? 1 : 0}|${ev.heroImage ? ev.heroImage.length : 0}|${(ev.gallery || []).map((g) => g.length).join(",")}`;
  const slides = useMemo(() => {
    const all = [ev.heroImage, ...(ev.gallery || [])].filter(Boolean);
    if (all.length) return all;
    // אין תמונות שהועלו: נופלים לתמונה המובנית, אבל רק אחרי שידוע
    // שזה באמת המצב ולא רק שעוד לא נטען
    return known && photosReady ? [img("shepherd.jpg")] : [];
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

  const current = Math.min(slide, Math.max(0, slides.length - 1));

  // עומק עדין: התמונה זזה לאט יותר מהדף בזמן גלילה. מתבצע ב-transform
  // בלבד, בלי חישוב פריסה מחדש, ומכובה למי שביקש להפחית תנועה.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {}
    if (reduced) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setShift(Math.min(60, window.scrollY * 0.12));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header className="relative min-h-[54vh] overflow-hidden">
      <div
        className="absolute inset-0 bg-[#B5A590] will-change-transform"
        style={{ transform: `translate3d(0, ${shift}px, 0) scale(1.1)` }}
      >
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
              "linear-gradient(to bottom, rgba(42,32,26,0.82) 0%, rgba(42,32,26,0.66) 26%, rgba(42,32,26,0.46) 46%, rgba(42,32,26,0.26) 62%, rgba(245,239,230,0.30) 80%, rgba(245,239,230,0.86) 93%, #F5EFE6 100%)",
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
                "radial-gradient(62% 80% at 50% 44%, rgba(30,23,18,0.52) 0%, rgba(30,23,18,0.38) 42%, rgba(30,23,18,0.16) 68%, rgba(30,23,18,0) 86%)",
            }}
          />

          <div className="relative">
            <h1
              className={`mx-auto mt-3 max-w-[18ch] text-balance font-bold text-white ${titleSize}`}
              style={{ textShadow: "0 2px 16px rgba(30,22,17,0.6), 0 1px 3px rgba(30,22,17,0.55)" }}
            >
              {ev.title}
            </h1>
            <p
              className="mx-auto mt-3.5 max-w-[34ch] text-balance text-[16px] font-medium leading-[1.7] text-white"
              style={{ textShadow: "0 2px 14px rgba(30,22,17,0.72), 0 1px 2px rgba(30,22,17,0.6)" }}
            >
              {ev.tagline}
            </p>

            <div className="mx-auto mt-6 flex max-w-sm flex-wrap items-center justify-center gap-2">
              <Pill icon={CalendarDays}>{ev.dateLabel} · {ev.dateShort}</Pill>
              <Pill icon={Clock}>{ev.time}</Pill>
              <Pill icon={PlaceIcon}>{ev.place}</Pill>
            </div>

            <Countdown times={times} />
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

function Field({ label, value, onChange, placeholder, type = "text", dir, compact, area, inputMode, autoComplete }) {
  const cls =
    "w-full rounded-2xl border border-[#D9CBB8] bg-white px-4 text-[15px] text-[#3A2E26] outline-none transition placeholder:text-[#BCAC97] focus:border-[#844442] focus:ring-2 focus:ring-[#844442]/15";
  return (
    <label className="block">
      <span className={`mb-1.5 block font-semibold text-[#5E5048] ${compact ? "text-[12px]" : "text-[13px]"}`}>{label}</span>
      {area ? (
        <textarea rows={2} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-none py-2.5`} />
      ) : (
        <input
          type={type}
          dir={dir}
          inputMode={inputMode}
          autoComplete={autoComplete}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${cls} ${compact ? "py-2.5" : "py-3"}`}
        />
      )}
    </label>
  );
}

function ErrorLine({ children }) {
  return <p className="mt-4 rounded-2xl bg-[#FBEDEC] px-4 py-2.5 text-[13px] font-semibold text-[#C24545]">{children}</p>;
}

function PrimaryButton({ onClick, busy, disabled, children, busyLabel }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#844442] py-4 text-[16px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(132,68,66,0.7)] transition hover:bg-[#5E2F2D] active:scale-[0.98] disabled:opacity-45 disabled:shadow-none"
    >
      {busy ? (
        <>
          <Loader2 size={18} className="animate-spin" /> {busyLabel || "רגע..."}
        </>
      ) : (
        children
      )}
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
        {ev?.bring ? <p className="ev-bring">מה להביא: {ev.bring}</p> : null}

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
              <th style={{ width: "22%" }}>למי זה מתאים? (למילוי במפגש)</th>
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

        <h2 className="ev-h2">שמות שעלו במפגש</h2>
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
        .ev-root .ev-screen,
        .ev-root .ev-sticky { display: none !important; }
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
      .ev-bring { margin: 3px 0 0; font-size: 9.5pt; color: #6B5C50; }

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
