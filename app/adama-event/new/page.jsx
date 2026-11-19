"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, Printer, Sparkles, Clock, Video, CalendarDays, Loader2, Plus, UserPlus, Heart,
  MapPin, Navigation, CalendarPlus, Share2, Backpack, ChevronDown, ArrowDown,
} from "lucide-react";
import {
  EVENT, saveRsvp, saveLeads, PITCH_GUIDE, loadEventDetails, loadEventPhotos, resolveEvent, eventTimes,
} from "@/lib/crm/eventStore";

// ============================================================================
//  דף נחיתה עצמאי למפגש המשדכים - גרסת התצוגה המקדימה.
//
//  עותק עצמאי לחלוטין של /adama-event, בנתיב /adama-event/new, שנבנה
//  כדי לבדוק עליו שפה עיצובית חדשה בלי לגעת בדף שאנשים נרשמים אליו.
//  הזרימה, השדות והאוספים זהים לחלוטין למקור. מה שהשתנה הוא השכבה
//  החיצונית בלבד: סדר הקטעים, התנועה והצבע.
//
//  הזיכרון המקומי יושב תחת מפתחות נפרדים משל המקור, ולכן בדיקה כאן
//  אינה נוגעת במצב של אף אדם שנרשם בדף האמיתי.
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

// שלב 3 (המלצת חברים) נשמר במאגר ולכן מבנה השדות שלו אינו משתנה.
const EMPTY_ROW = { name: "", phone: "", note: "" };

// שלב 2: תיאור מלא של מועמד/ת, לדף ההכנה המודפס בלבד. אינו נשמר בשום מקום.
// במקום "שורת מחץ" אחת שקשה לנסח - שאלות מכוונות, אחת אחת.
const CANDIDATE_QUESTIONS = [
  { key: "occupation", label: "מה הוא/היא עושה בחיים", placeholder: "עיסוק, לימודים, מה ממלא את היום" },
  { key: "appreciate", label: "מה אנחנו מעריכים בו/בה", placeholder: "התכונה שגורמת לך לכבד אותו/ה" },
  { key: "fun", label: "מה כיף בו/בה", placeholder: "מה עושה את הזמן איתו/ה נעים" },
  { key: "comfort", label: "אילו תכונות יפתחו אותו/ה ויתנו לו/לה להרגיש בנוח", placeholder: "מה הוא/היא צריך/ה מהצד השני" },
  { key: "succeed", label: "בזכות אילו תכונות יצליח/תצליח בקשר", placeholder: "מה הוא/היא מביא/ה לזוגיות" },
  { key: "brings", label: "מה הכי מביא לקשר", placeholder: "הדבר האחד שאי אפשר לוותר עליו" },
];

const EMPTY_CANDIDATE = {
  name: "",
  age: "",
  phone: "",
  ...Object.fromEntries(CANDIDATE_QUESTIONS.map((q) => [q.key, ""])),
};

// רשומה שנשמרה בדפדפן לפני השינוי הזה נשאה "note" בודד. היא נטענת
// לשדה הראשון במקום להיאבד.
const normalizeCandidate = (r) => ({
  ...EMPTY_CANDIDATE,
  ...Object.fromEntries(
    Object.keys(EMPTY_CANDIDATE).map((k) => [k, typeof r?.[k] === "string" ? r[k] : ""])
  ),
  appreciate: typeof r?.appreciate === "string" && r.appreciate ? r.appreciate : String(r?.note || ""),
});

const hasCandidate = (r) => String(r?.name || "").trim().length >= 2;

// ארבעת השלבים של הבוקר, לכרטיסים שנפתחים
const MEETUP_STEPS = [
  {
    title: "באים מוכנים",
    body: "עם דף ההכנה מודפס ועם שמות שחשבת עליהם מראש. לא מגיעים לחשוב — מגיעים להציע.",
  },
  {
    title: "מספרים",
    body: "כל אחד מציג את מי שהביא. לא קורות חיים: מה אנחנו מעריכים בו, מה כיף איתו, ומה הוא צריך מהצד השני.",
  },
  {
    title: "מחברים",
    body: "השמות נפגשים על השולחן. מה שנראה מתאים נרשם בטבלה, עם איש קשר לכל צד, כדי שיהיה למי לפנות.",
  },
  {
    title: "ממשיכים מכאן",
    body: "כל מה שיוצא מהבוקר הזה נכנס למאגר אדמה ואנחנו לוקחים את זה הלאה. זה לא נשאר על דף בתיק.",
  },
];

const FOR_WHO = [
  "למי שמכיר רווקים ורווקות בחוות ובגבעות",
  "למי שכבר ניסה לשדך פעם, ונתקע באמצע",
  "למי שיש לו שם בראש ולא יודע למי למסור אותו",
  "למי שרוצה שגם החבר שלו יימצא",
];

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

  // ספארי בטלפון לא תמיד מוריד קבצים, ושם עדיף לפתוח את הקובץ עצמו -
  // אייפון מזהה אותו כאירוע ומציע להוסיף ליומן.
  const iOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (iOS || typeof a.download === "undefined") {
    window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return;
  }

  a.href = url;
  a.download = "adama-event.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function shareText(ev) {
  const { where } = eventSummary(ev);
  const url = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
  return `${ev.title}\n${ev.dateLabel} · ${ev.dateShort} · ${ev.time}\n${where}\n\nנרשמים כאן:\n${url}`;
}

// זיכרון מקומי בדפדפן של המשתמש בלבד. נשמר רק במכשיר שלו, לא אצלנו
// ולא במסד הנתונים, ומפתח נפרד לכל אירוע כדי שאירוע חדש יתחיל מאפס.
const STORAGE_PREFIX = "adama-event-preview:";
const storageKey = (ev) => `${STORAGE_PREFIX}${ev?.id || EVENT.id}`;

// עותק מקומי של פרטי האירוע האחרון שנטען במכשיר הזה. בזכותו ביקור חוזר
// מצייר מיד את האירוע הנכון, במקום להמתין לתשובה מהרשת ואז להחליף מולה
// את המסך. המפתח בכוונה בלי נקודתיים, כדי שניקוי האירועים לא ימחק אותו.
const CACHE_KEY = "adama-last-event-preview";

// גרסת העותק המקומי. העותק הוא תוצאה מוגמרת של מיזוג ההגדרות, ולכן
// כשהקוד משנה את האופן שבו פרטי המפגש נגזרים מהן, עותק שנשמר בגרסה
// קודמת יצייר לרגע טקסט ישן לפני שהרשת מתקנת אותו. המספר הזה עולה
// יחד עם שינוי כזה, וכל עותק ישן נפסל מיד בכל המכשירים.
const CACHE_VERSION = 2;

function readCache() {
  try {
    const c = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
    return c && typeof c === "object" && c.id && c.v === CACHE_VERSION ? c : null;
  } catch {
    return null;
  }
}

function writeCache(ev) {
  // שלוש רמות, מהשלמה לדלילה. חשוב שהתמונה הראשית תישמר גם כשאין מקום
  // לכולן: היא זו שמצוירת ראשונה בביקור הבא.
  const stamped = { ...ev, v: CACHE_VERSION };
  const tries = [
    stamped,
    { ...stamped, gallery: [] },
    { ...stamped, heroImage: "", gallery: [] },
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
  // הפרטים שכבר נרשמו בפועל מהמכשיר הזה. אם לוחצים שוב על אותם
  // פרטים בדיוק, אין טעם ליצור רישום כפול במאגר.
  const [savedMe, setSavedMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // שלב 2 — הכנה אישית בלבד. נשאר בזיכרון הדפדפן ולא נשמר בשום מקום.
  const [rows, setRows] = useState([{ ...EMPTY_CANDIDATE }]);

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

  // התמונות לקיר ולקטע הסגירה. מה שהועלה בלוח הבקרה קודם, ומה שחסר
  // מושלם מהתמונות המובנות, כדי שהדף לעולם לא ייראה חצי ריק.
  // החתימה נמדדת באורכי המחרוזות ולא בהן עצמן: הן עלולות להיות כבדות.
  const photoSig = `${ev.heroImage ? ev.heroImage.length : 0}|${(ev.gallery || []).map((g) => g.length).join(",")}`;
  const photoPool = useMemo(() => {
    const uploaded = [ev.heroImage, ...(ev.gallery || [])].filter(Boolean);
    const builtin = [img("shepherd.jpg"), img("flock.jpg"), img("work.jpg"), img("wedding.webp")];
    return [...uploaded, ...builtin].slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSig]);
  const mosaicPhotos = photoPool.slice(0, 6);
  const closingPhoto = photoPool[photoPool.length - 1] || "";

  const faqItems = useMemo(
    () => [
      {
        q: "אני לא שדכן/ית. זה בכלל בשבילי?",
        a: "בדיוק בשבילך. המפגש הוא לחברים שמכירים אנשים, לא לאנשי מקצוע. אם יש מישהו שאת/ה חושב/ת עליו — יש לך מה להביא.",
      },
      { q: "מה צריך להביא?", a: ev.bring },
      {
        q: "כמה זמן זה לוקח?",
        a: `${ev.time}. אפשר להגיע ולצאת באמצע, אבל שווה להישאר עד הסוף — שם נסגרים החיבורים.`,
      },
      {
        q: "ואם אין לי מישהו ספציפי בראש?",
        a: "בוא/י בכל זאת. רוב השמות הטובים עולים דווקא תוך כדי, כששומעים על מישהו אחר.",
      },
      {
        q: "מה קורה עם השמות אחרי המפגש?",
        a: "כל מה שנאסף נכנס למאגר אדמה ואנחנו ממשיכים מכאן, בלי שזה נשאר על דף בתיק.",
      },
    ],
    [ev.bring, ev.time]
  );

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

  // שחזור.
  //
  // כלל ברזל: מי שנכנס לקישור נוחת תמיד במסך הפתיחה ובטופס שריון המקום.
  // לא בטבלאות, לא בדף ההדפסה ולא בשלב שבו היה בפעם הקודמת. מה שכן
  // נשמר הוא מה שהוקלד - השם, הטלפון והמועמדים - כדי שלא יאבד,
  // והטופס פשוט מגיע מלא מראש.
  const restore = (forEvent) => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey(forEvent)) || "null");
      // שחזור רק אם הרשומה שייכת בוודאות לאירוע הנוכחי
      if (saved && typeof saved === "object" && (!saved.evId || saved.evId === forEvent.id)) {
        if (saved.me) setMe({ name: saved.me.name || "", phone: saved.me.phone || "" });
        if (saved.savedMe) setSavedMe(saved.savedMe);
        if (saved.rsvpId) setRsvpId(saved.rsvpId);
        if (Array.isArray(saved.rows) && saved.rows.length) {
          setRows(saved.rows.map(normalizeCandidate));
        }
        if (saved.printed) setPrinted(true);
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
        JSON.stringify({ evId: ev.id, me, savedMe, rsvpId, rows, printed })
      );
    } catch {}
  }, [ready, trusted, ev, me, savedMe, rsvpId, rows, printed]);

  // איפוס כל שדות הזרימה למצב התחלתי
  const resetFlow = () => {
    setStep("rsvp");
    setMe({ name: "", phone: "" });
    setRsvpId(null);
    setSavedMe(null);
    setRows([{ ...EMPTY_CANDIDATE }]);
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
    setSavedMe(null);
    setRows([{ ...EMPTY_CANDIDATE }]);
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
    const same =
      savedMe && rsvpId && savedMe.name === me.name.trim() && savedMe.phone === me.phone.trim();
    if (same) {
      // כבר נרשמנו מהמכשיר הזה עם בדיוק אותם פרטים
      goTo("leads");
      return;
    }
    setBusy(true);
    try {
      setRsvpId(await saveRsvp(me, ev.id));
      setSavedMe({ name: me.name.trim(), phone: me.phone.trim() });
      goTo("leads");
    } catch {
      setErr("ההרשמה לא נשמרה. אפשר לנסות שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  const filled = rows.filter(hasCandidate).length;
  const addRow = () => setRows((rs) => [...rs, { ...EMPTY_CANDIDATE }]);

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
      <PremiumStyles />

      {/* ====================== המסך (מוסתר בהדפסה) ====================== */}
      <div className="ev-screen">
        <Curtain />
        <ScrollProgress />
        <StickyBar ev={ev} show={ready && step === "rsvp" && !formVisible} onCta={scrollToForm} />

        <Hero ev={ev} known={known} photosReady={photosReady} times={times} onCta={scrollToForm} />

        {/* כרטיס ההרשמה עולה על שולי הירו. השכבות האלה הן מה שנותן
            לדף את התחושה שהוא בנוי לעומק ולא נערם לאורך. */}
        <main
          className={`relative z-10 mx-auto -mt-16 w-full max-w-xl px-5 ${
            step === "rsvp" ? "pb-10" : "pb-24"
          }`}
        >
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

                </Card>

                <Reveal>
                  <EventDetails ev={ev} times={times} />
                </Reveal>
              </>
            )}

            {step === "leads" && (
              <Card>
                <Eyebrow icon={Sparkles}>שלב שני</Eyebrow>
                <h2 className="mt-2 text-[26px] font-bold leading-tight text-[#3A2E26]">מי את/ה מביא/ה למפגש?</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[#7C6E60]">
                  ככל שנדע עליו/ה יותר, כך קל יותר לחבר. התשובות נשארות אצלך בלבד —
                  הן בונות את דף ההכנה שתדפיס/י, ואינן נשמרות אצלנו בשום מקום.
                </p>

                <div className="mt-6 space-y-5">
                  {rows.map((r, i) => (
                    <div key={i} className="rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#844442] text-[13px] font-bold text-white">
                          {i + 1}
                        </span>
                        <span className="text-[13px] font-semibold text-[#7C6E60]">מועמד/ת {i + 1}</span>
                      </div>

                      <div className="space-y-2.5">
                        <div className="grid grid-cols-[1fr_88px] gap-2">
                          <Field label="שם" value={r.name} onChange={(v) => setRow(i, { name: v })} placeholder="שם מלא" compact />
                          <Field
                            label="גיל"
                            value={r.age}
                            onChange={(v) => setRow(i, { age: v.replace(/[^0-9]/g, "").slice(0, 2) })}
                            placeholder="26"
                            type="tel"
                            inputMode="numeric"
                            compact
                          />
                        </div>
                        <Field label="טלפון" value={r.phone} onChange={(v) => setRow(i, { phone: v })} placeholder="050-0000000" type="tel" dir="ltr" inputMode="numeric" compact />

                        {CANDIDATE_QUESTIONS.map((q) => (
                          <Field
                            key={q.key}
                            label={q.label}
                            value={r[q.key]}
                            onChange={(v) => setRow(i, { [q.key]: v })}
                            placeholder={q.placeholder}
                            compact
                            area
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addRow}
                  className="mt-4 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#D9CBB8] py-3.5 text-[14px] font-bold text-[#844442] transition hover:border-[#844442] hover:bg-[#FBF7F1] active:scale-[0.99]"
                >
                  <Plus size={18} strokeWidth={2.6} /> מועמד/ת נוסף/ת
                </button>

                {err && <ErrorLine>{err}</ErrorLine>}

                <PrimaryButton onClick={continueToPrep} busy={busy} disabled={filled === 0}>
                  {filled === 0 ? "הזינו לפחות שם אחד" : `המשך לדף ההכנה (${filled})`}
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
                      שמרנו לך מקום. כל הפרטים מופיעים כאן למטה.
                    </p>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#7C6E60]">
                      {filled > 0
                        ? `דף ההכנה שלך מוכן, עם ${filled} המועמדים שהזנת בפנים.`
                        : "דף ההכנה שלך מוכן להדפסה."}
                    </p>
                  </div>

                  <EventDetails ev={ev} times={times} tone="inline" />

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

        {/* ===== מכאן ומטה: הסיפור. מופיע רק במסך ההרשמה, כדי שמי
             שכבר באמצע המילוי לא יגלוש דרך דף שיווקי. ===== */}
        {step === "rsvp" && (
          <>
            {/* כהה: המשפט שמחזיק את כל העניין, שורה אחרי שורה */}
            <Band tone="deep">
              <Lines
                lines={["כל אחד מאיתנו", "מכיר מישהו."]}
                gold={1}
                className="text-center text-[34px] leading-[1.18]"
              />
              <Reveal delay={420}>
                <p className="mx-auto mt-6 max-w-[32ch] text-center text-[16px] leading-[1.9] text-[#C9BBA9]">
                  ורובם לא יגיעו לשום מאגר, לשום שדכנית ולשום טופס. הם יגיעו רק דרך
                  מי שמכיר אותם באמת — ובוקר אחד בשנה, כולנו יושבים יחד ואומרים את
                  השמות בקול.
                </p>
              </Reveal>
              <Mosaic photos={mosaicPhotos} />
            </Band>

            {/* בהיר: מה באמת קורה שם, בכרטיסים שנפתחים */}
            <Band tone="light">
              <Reveal>
                <p className="text-center text-[13px] font-bold tracking-[0.18em] text-[#C9A35B]">
                  המפגש
                </p>
              </Reveal>
              <Lines
                lines={["מה קורה שם", "בשלוש שעות"]}
                className="mt-3 text-center text-[30px] leading-[1.2] text-[#3A2E26]"
              />
              <ExpandCards items={MEETUP_STEPS} />
            </Band>

            {/* כהה: למי זה מתאים */}
            <Band tone="dark">
              <Lines
                lines={["זה מפגש", "לחברים. לא למקצוענים."]}
                gold={1}
                className="text-[28px] leading-[1.25]"
              />
              <ul className="mt-8 space-y-3.5">
                {FOR_WHO.map((line, i) => (
                  <Reveal key={line} delay={i * 110}>
                    <li className="flex items-start gap-3 text-[16px] leading-[1.7] text-[#E4D6C2]">
                      <Check size={18} strokeWidth={2.6} className="mt-1 shrink-0 text-[#DEB86E]" />
                      <span>{line}</span>
                    </li>
                  </Reveal>
                ))}
              </ul>
            </Band>

            {/* בהיר: שאלות ותשובות */}
            <Band tone="light">
              <Lines
                lines={["שאלות ותשובות"]}
                className="text-center text-[28px] leading-[1.2] text-[#3A2E26]"
              />
              <Faq items={faqItems} />
            </Band>

            {/* סגירה: תמונה מלאה, משפט אחד, וכפתור */}
            <section className="relative overflow-hidden bg-[#1E1610]">
              {closingPhoto && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={closingPhoto}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover opacity-45"
                />
              )}
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(30,22,16,0.72) 0%, rgba(30,22,16,0.52) 50%, rgba(30,22,16,0.88) 100%)",
                }}
              />
              <div className="relative mx-auto w-full max-w-xl px-5 py-20 text-center">
                <Lines
                  lines={["הבוקר הזה קורה פעם.", "בוא/י בשביל מישהו."]}
                  gold={1}
                  className="text-[30px] leading-[1.25] text-white"
                />
                <Reveal delay={360}>
                  <p className="mx-auto mt-5 max-w-[30ch] text-[15.5px] leading-[1.8] text-[#C9BBA9]">
                    {ev.dateLabel} · {ev.dateShort} · {ev.time}
                    <br />
                    {ev.place}
                  </p>
                </Reveal>
                <Reveal delay={480}>
                  <button
                    onClick={scrollToForm}
                    className="mt-8 inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-[#DEB86E] px-9 text-[17px] font-bold text-[#2A1F16] shadow-[0_18px_40px_-14px_rgba(222,184,110,0.6)] transition hover:bg-[#EBCB87] active:scale-[0.97]"
                  >
                    אני מגיע/ה <ArrowLeft size={18} strokeWidth={2.4} />
                  </button>
                </Reveal>
                <Reveal delay={580}>
                  <span className="mx-auto mt-10 flex w-fit flex-col items-center">
                    <span
                      className="text-[26px] font-bold leading-none text-[#DEB86E]"
                      style={{ letterSpacing: "0.14em", paddingInlineStart: "0.14em" }}
                    >
                      אדמה
                    </span>
                    <span aria-hidden="true" className="mt-2 h-px w-10 bg-[#DEB86E]/60" />
                  </span>
                </Reveal>
              </div>
            </section>
          </>
        )}
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
function Reveal({ children, className = "", delay = 0 }) {
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
      className={`transition-all duration-[650ms] ease-[cubic-bezier(.22,.61,.36,1)] ${className}`}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(22px)",
        transitionDelay: shown ? `${delay}ms` : "0ms",
      }}
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
    } catch (e) {
      // ביטול של המשתמש הוא לא תקלה. כל שגיאה אחרת - ממשיכים לוואטסאפ,
      // כדי שהכפתור אף פעם לא ייראה כאילו הוא לא עושה כלום.
      if (e && e.name === "AbortError") return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  const base =
    "flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-[14px] font-bold transition active:scale-[0.97] min-h-[50px]";

  return (
    <div className="grid grid-cols-3 gap-2">
      {!hideNav && ev.navUrl && (
        <a
          href={ev.navUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} border-[#4E6B56] bg-[#62826B] text-white hover:bg-[#4E6B56]`}
        >
          {/* הכיתוב הולך אחרי הקישור עצמו: קישור וויז אומר וויז, וכל
              קישור ניווט אחר (למשל נקודה ממפות גוגל) אומר ניווט. */}
          <Navigation size={16} /> {/waze\.com/i.test(ev.navUrl) ? "נווטו ב-Waze" : "ניווט למקום"}
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
      <button
        onClick={share}
        className={`${base} border-[#D9CBB8] bg-white text-[#4A6552] hover:bg-[#EFF4EF]`}
      >
        <Share2 size={16} /> {shared ? "נפתח" : "שיתוף"}
      </button>
    </div>
  );
}

// כל פרטי המפגש במקום אחד: מתי, איפה, מה להביא, וכפתורי הפעולה.
// מופיע פעם אחת בכל מסך, כדי שלא יהיו שתי גרסאות של אותו מידע.
function EventDetails({ ev, times, tone = "panel" }) {
  const Wrapper = tone === "panel" ? Panel : "div";
  const where = ev.mode === "place" ? ev.placeName || ev.place : ev.place;
  const showAddress = ev.mode === "place" && ev.address && ev.address !== where;

  return (
    <Wrapper className={tone === "panel" ? undefined : "mt-6 rounded-3xl border border-[#E2D5C4] bg-[#FBF7F1] p-5"}>
      <Eyebrow icon={CalendarDays}>פרטי המפגש</Eyebrow>

      <dl className="mt-3 space-y-2.5">
        <DetailRow icon={CalendarDays} label="מתי">
          {ev.dateLabel} · {ev.dateShort}
        </DetailRow>
        <DetailRow icon={Clock} label="שעה">{ev.time}</DetailRow>
        <DetailRow icon={ev.mode === "place" ? MapPin : Video} label="איפה">
          {where}
          {showAddress && <span className="block text-[13px] font-normal text-[#A2937F]">{ev.address}</span>}
        </DetailRow>
        {ev.bring && (
          <DetailRow icon={Backpack} label="מה להביא">{ev.bring}</DetailRow>
        )}
      </dl>

      <div className="mt-4">
        <ActionButtons ev={ev} times={times} />
      </div>
      {times && (
        <a
          href={googleCalendarUrl(ev, times)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 block text-center text-[12.5px] font-semibold text-[#A2937F] underline underline-offset-2 transition hover:text-[#844442]"
        >
          או להוסיף ליומן גוגל
        </a>
      )}
    </Wrapper>
  );
}

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={16} className="mt-0.5 shrink-0 text-[#A8865A]" strokeWidth={2} />
      <div className="min-w-0">
        <dt className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[#A2937F]">{label}</dt>
        <dd className="text-[15px] font-bold leading-relaxed text-[#3A2E26]">{children}</dd>
      </div>
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

function Hero({ ev, known, photosReady, times, onCta }) {
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

  // גובה הירו נמדד ב-svh כדי שסרגל הכתובת בנייד לא יקפיץ אותו.
  // דפדפן שאינו מכיר את היחידה פשוט נשאר עם vh שבמחלקה.
  const tall = "min-h-[86vh]";

  return (
    <header className={`relative ${tall} overflow-hidden bg-[#1E1610]`} style={{ minHeight: "86svh" }}>
      <div
        className="absolute inset-0 bg-[#1E1610] will-change-transform"
        style={{ transform: `translate3d(0, ${shift}px, 0) scale(1.1)` }}
      >
        {slides.map((src, n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={n}
            src={src}
            alt=""
            aria-hidden="true"
            className={`ev-ken absolute inset-0 h-full w-full object-cover transition-opacity duration-[1400ms] ease-in-out ${
              n === current ? "ev-ken-on" : ""
            }`}
            style={{ opacity: n === current ? 1 : 0 }}
          />
        ))}
        {/* שכבת קריאוּת: כהה בראש ובתחתית, פתוחה באמצע על התמונה עצמה,
            ובסוף נמסה אל צבע הדף כדי שכרטיס ההרשמה ינחת עליה נקי */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(245,239,230,0) 86%, rgba(245,239,230,0.5) 95%, #F5EFE6 100%)," +
              "linear-gradient(to bottom, rgba(26,18,12,0.62) 0%, rgba(26,18,12,0.34) 38%, rgba(26,18,12,0.40) 70%, rgba(26,18,12,0.66) 100%)",
          }}
        />
      </div>

      <div className={`relative mx-auto flex ${tall} w-full max-w-xl flex-col items-center justify-center px-5 pb-24 pt-14 text-center`} style={{ minHeight: "86svh" }}>
        {/* הלוגו של אדמה, בזהב של הפלייר המודפס */}
        <span className="ev-rise mx-auto flex w-fit flex-col items-center" style={{ animationDelay: "120ms" }}>
          <span
            className="text-[34px] font-bold leading-none text-[#DEB86E]"
            style={{
              letterSpacing: "0.14em",
              paddingInlineStart: "0.14em",
              textShadow: "0 2px 18px rgba(26,18,12,0.75), 0 1px 3px rgba(26,18,12,0.65)",
            }}
          >
            אדמה
          </span>
          <span aria-hidden="true" className="mt-2.5 h-px w-14 bg-[#DEB86E]/70" />
        </span>

        <div
          className="relative mt-7 w-full transition-opacity duration-500"
          style={{ opacity: known ? 1 : 0 }}
          aria-hidden={known ? undefined : "true"}
        >
          <h1
            className={`ev-rise mx-auto max-w-[18ch] text-balance font-bold text-white ${titleSize}`}
            style={{ animationDelay: "240ms", textShadow: "0 2px 20px rgba(26,18,12,0.62), 0 1px 3px rgba(26,18,12,0.6)" }}
          >
            {ev.title}
          </h1>
          <p
            className="ev-rise mx-auto mt-4 max-w-[34ch] text-balance text-[16px] font-medium leading-[1.75] text-[#F4E6D2]"
            style={{ animationDelay: "380ms", textShadow: "0 2px 14px rgba(26,18,12,0.72)" }}
          >
            {ev.tagline}
          </p>

          <div className="ev-rise mx-auto mt-7 flex max-w-sm flex-wrap items-center justify-center gap-2" style={{ animationDelay: "500ms" }}>
            <Pill icon={CalendarDays}>{ev.dateLabel} · {ev.dateShort}</Pill>
            <Pill icon={Clock}>{ev.time}</Pill>
            <Pill icon={PlaceIcon}>{ev.place}</Pill>
          </div>

          <div className="ev-rise" style={{ animationDelay: "600ms" }}>
            <Countdown times={times} />
          </div>

          <button
            onClick={onCta}
            className="ev-rise mt-8 inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-[#DEB86E] px-9 text-[17px] font-bold text-[#2A1F16] shadow-[0_18px_40px_-14px_rgba(222,184,110,0.7)] transition hover:bg-[#EBCB87] active:scale-[0.97]"
            style={{ animationDelay: "700ms" }}
          >
            אני מגיע/ה <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
        </div>

        {/* נקודות הקרוסלה. שומרות על גובה קבוע גם לפני שהן מופיעות */}
        <div
          className="mx-auto mt-8 flex h-2 items-center justify-center gap-2 transition-opacity duration-300"
          style={{ opacity: known && slides.length > 1 ? 1 : 0 }}
          aria-hidden={known && slides.length > 1 ? undefined : "true"}
        >
          {slides.length > 1 &&
            slides.map((_, n) => (
              <button
                key={n}
                onClick={() => setSlide(n)}
                aria-label={`תמונה ${n + 1}`}
                className={`h-2 rounded-full transition-all duration-500 ${
                  n === current ? "w-7 bg-[#DEB86E]" : "w-2 bg-white/45 hover:bg-white/70"
                }`}
              />
            ))}
        </div>

        {/* רמז גלילה. נעלם ברגע שזזים, כדי שלא ירדוף אחרי העין */}
        <span
          aria-hidden="true"
          className="ev-cue pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 text-[#DEB86E]/80 transition-opacity duration-300"
          style={{ opacity: shift > 6 ? 0 : 1 }}
        >
          <ArrowDown size={20} strokeWidth={2.2} />
        </span>
      </div>
    </header>
  );
}

/* ═══════════════ השכבה החדשה: קצב, שכבות ותנועה ═══════════════ */

// מסך פתיחה. נפתח על כהה עם הלוגו בלבד ונמס אל הדף, בדיוק כמו
// בסרטון ההשראה. כולו CSS: גם אם שום קוד לא ירוץ הוא ייעלם לבד,
// ולכן הוא לא יכול להשאיר את הדף חסום.
function Curtain() {
  return (
    <div className="ev-curtain pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-[#1E1610]">
      <span
        className="text-[38px] font-bold leading-none text-[#DEB86E]"
        style={{ letterSpacing: "0.16em", paddingInlineStart: "0.16em" }}
      >
        אדמה
      </span>
    </div>
  );
}

// קו התקדמות דק בראש הדף
function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const h = document.documentElement.scrollHeight - window.innerHeight;
        setP(h > 0 ? Math.min(1, window.scrollY / h) : 0);
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
    <div aria-hidden="true" className="ev-sticky pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
      <div
        className="h-full origin-right bg-[#DEB86E] transition-transform duration-150 ease-out"
        style={{ transform: `scaleX(${p})` }}
      />
    </div>
  );
}

// סרגל עליון שנכנס אחרי הירו: הלוגו, התאריך, וכפתור הרשמה תמיד בהישג יד
function StickyBar({ ev, show, onCta }) {
  return (
    <div
      className="ev-sticky fixed inset-x-0 top-0 z-40 border-b border-[#DEB86E]/20 bg-[#1E1610]/90 backdrop-blur-md transition-all duration-300"
      style={{ opacity: show ? 1 : 0, transform: show ? "none" : "translateY(-100%)" }}
      aria-hidden={show ? undefined : "true"}
    >
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex items-baseline gap-2.5 overflow-hidden">
          <span className="text-[17px] font-bold leading-none text-[#DEB86E]" style={{ letterSpacing: "0.1em" }}>
            אדמה
          </span>
          <span className="truncate text-[12px] font-semibold text-[#C9BBA9]">
            {ev.dateShort} · {ev.time}
          </span>
        </span>
        <button
          onClick={onCta}
          tabIndex={show ? 0 : -1}
          className="hidden shrink-0 rounded-full bg-[#DEB86E] px-4 py-2 text-[13px] font-bold text-[#2A1F16] transition active:scale-95 sm:inline-flex"
        >
          אני מגיע/ה
        </button>
      </div>
    </div>
  );
}

// פס רוחב מלא. זה הקצב של הדף: בהיר, כהה, בהיר - כמו בסרטון.
function Band({ tone = "dark", children, className = "" }) {
  const skin =
    tone === "dark"
      ? "bg-[#241B14] text-[#F4E6D2]"
      : tone === "deep"
      ? "bg-[#1E1610] text-[#F4E6D2]"
      : "bg-[#F5EFE6] text-[#3A2E26]";
  return (
    <section className={`relative overflow-hidden ${skin} ${className}`}>
      <div className="mx-auto w-full max-w-xl px-5 py-16">{children}</div>
    </section>
  );
}

// כותרת שנחשפת שורה אחרי שורה
function Lines({ lines, className = "", gold = -1 }) {
  return (
    <h2 className={`font-bold ${className}`}>
      {lines.map((line, i) => (
        <Reveal key={i} delay={i * 160}>
          <span className={`block ${i === gold ? "text-[#DEB86E]" : ""}`}>{line}</span>
        </Reveal>
      ))}
    </h2>
  );
}

// תמונה בקשת, עם מסגרת זהב דקה - הצורה מהפלייר המודפס
function ArchPhoto({ src, className = "", style }) {
  if (!src) return null;
  return (
    <span
      className={`block overflow-hidden rounded-t-full ring-1 ring-[#DEB86E]/45 ${className}`}
      style={style}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden="true" className="h-full w-full object-cover" />
    </span>
  );
}

// קיר התמונות. נע לאט יותר מהדף, ולכן נותן עומק בלי לגזול תשומת לב.
function Mosaic({ photos }) {
  const [shift, setShift] = useState(0);
  const ref = useRef(null);

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
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const mid = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        setShift(Math.max(-26, Math.min(26, -mid * 34)));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (!photos.length) return null;
  // שלוש עמודות, וכל עמודה זזה בקצב משלה
  const cols = [[], [], []];
  photos.forEach((src, i) => cols[i % 3].push(src));

  return (
    <div ref={ref} className="mt-10 grid grid-cols-3 gap-2.5" aria-hidden="true">
      {cols.map((col, c) => (
        <div
          key={c}
          className="flex flex-col gap-2.5 will-change-transform"
          style={{ transform: `translate3d(0, ${shift * (c === 1 ? -1 : 1) * (c === 2 ? 0.6 : 1)}px, 0)` }}
        >
          {col.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              className="h-28 w-full rounded-2xl object-cover ring-1 ring-[#DEB86E]/20"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// הכרטיסים שנפתחים. זה הרגע שעושה "וואו" בסרטון: כרטיס אחד פתוח
// בכל רגע, והמעבר ביניהם רך. בלי ספרייה - רק גובה שנפתח ב-CSS.
function ExpandCards({ items }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="mt-9 space-y-3">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <Reveal key={it.title} delay={i * 110}>
            <button
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className={`w-full overflow-hidden rounded-3xl border text-right transition-all duration-500 ${
                isOpen
                  ? "border-[#DEB86E]/60 bg-[#2E231A]"
                  : "border-[#DEB86E]/15 bg-[#241B14] hover:border-[#DEB86E]/35"
              }`}
            >
              <span className="flex items-center gap-3 px-5 py-4">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors duration-300 ${
                    isOpen ? "bg-[#DEB86E] text-[#2A1F16]" : "bg-[#DEB86E]/15 text-[#DEB86E]"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-[17px] font-bold text-[#F4E6D2]">{it.title}</span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-[#DEB86E] transition-transform duration-500 ${isOpen ? "rotate-180" : ""}`}
                />
              </span>
              <span
                className="grid transition-all duration-500 ease-[cubic-bezier(.22,.61,.36,1)]"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <span className="overflow-hidden">
                  <span className="block px-5 pb-5 pr-16 text-[15px] leading-[1.8] text-[#C9BBA9]">
                    {it.body}
                  </span>
                </span>
              </span>
            </button>
          </Reveal>
        );
      })}
    </div>
  );
}

// שאלות ותשובות
function Faq({ items }) {
  const [open, setOpen] = useState(-1);
  return (
    <div className="mt-8 space-y-2.5">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <Reveal key={it.q} delay={i * 90}>
            <button
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className={`w-full overflow-hidden rounded-2xl border text-right transition-colors duration-300 ${
                isOpen ? "border-[#C9A35B] bg-white" : "border-[#E2D5C4] bg-white/70 hover:border-[#C9A35B]/60"
              }`}
            >
              <span className="flex items-center gap-2.5 px-4 py-3.5">
                <span className="flex-1 text-[15px] font-bold text-[#3A2E26]">{it.q}</span>
                <ChevronDown
                  size={17}
                  className={`shrink-0 text-[#A2937F] transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                />
              </span>
              <span
                className="grid transition-all duration-400 ease-out"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <span className="overflow-hidden">
                  <span className="block px-4 pb-4 text-[14.5px] leading-[1.8] text-[#7C6E60]">{it.a}</span>
                </span>
              </span>
            </button>
          </Reveal>
        );
      })}
    </div>
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
  const list = (rows || []).filter(hasCandidate);

  return (
    <div className="ev-print" aria-hidden="true">
      <div className="ev-sheet">
        <div className="ev-head">
          <div className="ev-headline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ev-logo" src={`${BASE}/icons/icon-192.png`} alt="" />
            <div>
              <p className="ev-brand">אדמה · מאגר השידוכים לחוות גבעות</p>
              <h1 className="ev-title">{ev.title}</h1>
            </div>
          </div>
          <div className="ev-when">
            <p><b>{ev.dateLabel}</b></p>
            <p>{ev.dateShort} · {ev.time}</p>
            <p>{ev.mode === "place" ? ev.placeName || ev.place : ev.place}</p>
          </div>
        </div>

        <div className="ev-meta">
          {owner?.name ? <p><b>דף העבודה של</b> {owner.name}</p> : null}
          {ev?.bring ? <p><b>מה להביא</b> {ev.bring}</p> : null}
        </div>

        <h2 className="ev-h2">איך מציגים מועמד/ת בדקה</h2>
        <ol className="ev-guide">
          {PITCH_GUIDE.map((g, i) => (
            <li key={g.t}>
              <span className="ev-num">{i + 1}</span>
              <span><b>{g.t}.</b> {g.d}</span>
            </li>
          ))}
        </ol>

        {/* דף קריא לכל מועמד/ת, שאלה־תשובה. לא טבלה. */}
        <h2 className="ev-h2">המועמדים שלי</h2>
        {list.length === 0 ? (
          <p className="ev-empty">עוד לא הוזנו מועמדים. אפשר למלא ביד על הדף המודפס.</p>
        ) : (
          list.map((r, i) => (
            <section key={i} className="ev-person">
              <header className="ev-person-top">
                <h3>
                  <span className="ev-chip">{i + 1}</span>
                  {r.name}
                  {String(r.age || "").trim() ? <span className="ev-age">בן/בת {r.age}</span> : null}
                </h3>
                {String(r.phone || "").trim() ? (
                  <span className="ev-phone" dir="ltr">{r.phone}</span>
                ) : null}
              </header>
              <dl className="ev-qa">
                {CANDIDATE_QUESTIONS.map((q) => {
                  const value = String(r[q.key] || "").trim();
                  return (
                    <div key={q.key} className="ev-qa-row">
                      <dt>{q.label}</dt>
                      <dd>{value || <span className="ev-blank" />}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))
        )}

        {/* טבלת התיאום - נפרדת לגמרי מתיאור המועמדים */}
        <h2 className="ev-h2 ev-break">טבלת תיאום · מה סוכם במפגש</h2>
        <table className="ev-table">
          <thead>
            <tr>
              <th style={{ width: "32%" }}>המשודך/ת שלי</th>
              <th style={{ width: "32%" }}>המשודך/ת שלה</th>
              <th>איש קשר לפניות</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
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


// התנועה של הדף. הכול CSS טהור: אין כאן שום ספריית אנימציה, ולכן
// אין מה שיתקע את הטעינה בנייד ואין גרם אחד של קוד נוסף להוריד.
// כל כלל יושב תחת ev-root, ולכן אינו יכול לדלוף לשום מסך אחר.
function PremiumStyles() {
  return (
    <style jsx global>{`
      @keyframes evRise {
        from { opacity: 0; transform: translate3d(0, 20px, 0); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes evCurtain {
        from { opacity: 1; }
        99%  { opacity: 0; visibility: visible; }
        to   { opacity: 0; visibility: hidden; }
      }
      @keyframes evKen {
        from { transform: scale(1); }
        to   { transform: scale(1.09); }
      }
      @keyframes evCue {
        0%, 100% { transform: translate(-50%, 0); }
        50%      { transform: translate(-50%, 7px); }
      }

      .ev-root .ev-rise {
        animation: evRise 760ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      }
      .ev-root .ev-curtain {
        /* קצר בכוונה: אנשים מגיעים לכאן מקישור בוואטסאפ כדי להירשם,
           ומסך פתיחה ארוך הוא המתנה, לא רושם. */
        animation: evCurtain 620ms cubic-bezier(0.4, 0, 0.2, 1) 160ms both;
      }
      /* הזום האיטי רץ רק על התמונה שנראית כרגע, ולכן אין עבודה מיותרת
         על תמונות שממילא שקופות */
      .ev-root .ev-ken-on {
        animation: evKen 9000ms ease-out both;
      }
      .ev-root .ev-cue {
        animation: evCue 2200ms ease-in-out infinite;
      }

      /* מי שביקש במכשיר שלו להפחית תנועה מקבל דף שקט לגמרי.
         שימו לב: וילון הפתיחה נעלם כאן לגמרי ולא רק מפסיק לזוז,
         אחרת הוא היה נשאר פרוש על המסך. */
      @media (prefers-reduced-motion: reduce) {
        .ev-root .ev-curtain { display: none; }
        .ev-root .ev-rise,
        .ev-root .ev-ken-on,
        .ev-root .ev-cue { animation: none; }
      }
    `}</style>
  );
}

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
      .ev-headline { display: flex; align-items: center; gap: 10px; }
      .ev-logo { width: 42px; height: 42px; border-radius: 10px; object-fit: cover; }
      .ev-brand { margin: 0; font-size: 8.5pt; font-weight: 700; letter-spacing: .08em; color: #A8865A; }
      .ev-title { margin: 2px 0 0; font-size: 14pt; font-weight: 700; color: #844442; line-height: 1.2; }
      .ev-meta { margin: 8px 0 0; font-size: 9.5pt; color: #4A3F37; }
      .ev-meta p { margin: 0 0 2px; }
      .ev-meta b { color: #844442; }
      .ev-empty { font-size: 9.5pt; color: #8A7A6B; margin: 4px 0 0; }

      /* דף המועמד/ת: שאלה ותשובה, אוורירי וקריא */
      .ev-person {
        break-inside: avoid; page-break-inside: avoid;
        border: 1px solid #D9CBB8; border-radius: 8px;
        padding: 9px 11px; margin-bottom: 9px; background: #FDFBF8;
      }
      .ev-person-top {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 10px; border-bottom: 1px solid #E8DCCB; padding-bottom: 5px; margin-bottom: 6px;
      }
      .ev-person-top h3 {
        margin: 0; font-size: 12.5pt; font-weight: 700; color: #3A2E26;
        display: flex; align-items: baseline; gap: 7px;
      }
      .ev-chip {
        display: inline-block; min-width: 17px; height: 17px; line-height: 17px;
        border-radius: 999px; background: #844442; color: #fff;
        font-size: 8pt; font-weight: 700; text-align: center;
      }
      .ev-age { font-size: 9.5pt; font-weight: 500; color: #7C6E60; }
      .ev-phone { font-size: 10pt; font-weight: 700; color: #844442; direction: ltr; }
      .ev-qa { margin: 0; }
      .ev-qa-row { margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
      .ev-qa dt {
        font-size: 8.5pt; font-weight: 700; color: #A8865A; margin-bottom: 1px;
      }
      .ev-qa dd {
        margin: 0; font-size: 10pt; line-height: 1.45; color: #2F261F;
        white-space: pre-line;
      }
      .ev-blank {
        display: block; border-bottom: 1px dotted #CCBDAB; height: 13px; width: 100%;
      }
      .ev-break { break-before: auto; page-break-before: auto; }
      .ev-when {
        text-align: left; font-size: 9.5pt; line-height: 1.5; color: #6B5C50;
        flex: 0 0 auto; min-width: 150px;
      }
      .ev-when p:first-child, .ev-when p:nth-child(2) { white-space: nowrap; }
      .ev-when b { color: #3A2E26; }
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
