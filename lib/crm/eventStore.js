// ============================================================================
//  "ערב משדכים" — שכבת הנתונים של דף הנחיתה.
//
//  יחידה עצמאית לחלוטין:
//   · אוספים חדשים משלה, event_rsvps, event_leads ו-event_settings.
//   · אינה נוגעת באוסף המועמדים ולא בשום אוסף קיים אחר.
//   · מייבאת את crmDb ישירות ולכן אינה נוגעת ב-lib/crm/store.js.
//
//  הדף פתוח בלי התחברות, בדיוק כמו טופס ההרשמה, ולכן הכתיבה נעשית
//  כאורח. כללי האבטחה של האוספים מופיעים ב-firestore.rules.
// ============================================================================

import {
  collection, addDoc, onSnapshot, query, orderBy,
  doc, getDoc, setDoc, deleteDoc,
} from "firebase/firestore";
import { crmDb } from "./firebaseClient";

// ברירת המחדל המובנית. זו רשת הביטחון: אם אין עדיין הגדרות שמורות,
// או שהקריאה אליהן נכשלה, הדף מציג בדיוק את מה שהציג תמיד.
export const EVENT = {
  id: "adama-event-20-11-09-00-12-00",
  title: "נפגשים לשדך את החבר'ה של החוות והגבעות",
  tagline: "עבור היקרים לנו נבוא מוכנים ונצא עם חיבורים משמחים",
  dateLabel: "יום שישי · י׳ כסלו",
  dateShort: "20.11",
  time: "09:00-12:00",
  mode: "place", // zoom | place
  place: "עגלת קפה עין סאמיה",
  zoomUrl: "",
  placeName: "עגלת קפה עין סאמיה",
  address: "עגלת קפה עין סאמיה",
  wazeUrl: "",
  navUrl: "",
  bring: "חיוך, אמונה בלב ודף ההכנה מודפס",
  heroImage: "",
  gallery: [],
};

// ארבע משבצות תמונה: ראשית ועוד שלוש. כל תמונה יושבת במסמך משלה,
// כי מסמך ב-Firestore מוגבל למגה-בייט אחד.
export const EVENT_PHOTO_SLOTS = ["hero", "photo1", "photo2", "photo3"];

const SETTINGS_COLLECTION = "event_settings";
const SETTINGS_DOC = "current";
const photoDocId = (slot) => `photo_${slot}`;

const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);

/* ───────────────────────── הגדרות האירוע ───────────────────────── */

/** מזהה אירוע יציב, נגזר מהתאריך והשעה. אירוע חדש = מזהה חדש. */
export function makeEventId({ dateShort, time } = {}) {
  const slug = `${dateShort || ""}-${time || ""}`
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `adama-event-${slug}` : EVENT.id;
}

/**
 * מיזוג ההגדרות השמורות עם ברירת המחדל.
 * כל שדה ריק נופל חזרה לערך המובנה, ולכן אי אפשר לרוקן את הדף בטעות.
 */
export function resolveEvent(settings, photos) {
  const s = settings && typeof settings === "object" ? settings : {};
  const p = photos && typeof photos === "object" ? photos : {};
  const saved = Boolean(s.updatedAt || s.dateShort || s.mode);

  const mode = s.mode === "place" ? "place" : "zoom";
  const placeName = clean(s.placeName, 120);
  const address = clean(s.address, 300);
  const wazeUrl = clean(s.wazeUrl, 600);

  const ev = {
    ...EVENT,
    title: clean(s.title, 120) || EVENT.title,
    tagline: saved ? clean(s.tagline, 400) : EVENT.tagline,
    bring: saved ? clean(s.bring, 200) : EVENT.bring,
    dateLabel: clean(s.dateLabel, 120) || EVENT.dateLabel,
    dateShort: clean(s.dateShort, 40) || EVENT.dateShort,
    time: clean(s.time, 40) || EVENT.time,
    mode,
    // אחרי שנשמרו הגדרות, קישור זום ריק הוא בחירה מפורשת ולא חוסר מידע
    zoomUrl: saved ? clean(s.zoomUrl, 600) : EVENT.zoomUrl,
    placeName,
    address,
    wazeUrl,
    heroImage: typeof p.hero === "string" ? p.hero : "",
    gallery: ["photo1", "photo2", "photo3"]
      .map((k) => (typeof p[k] === "string" ? p[k] : ""))
      .filter(Boolean),
  };

  ev.id = clean(s.eventId, 120) || (saved ? makeEventId(ev) : EVENT.id);
  ev.place =
    mode === "place"
      ? placeName || address || "מפגש פיזי"
      : clean(s.place, 80) || "בזום";

  // קישור ניווט: מה שהוזן ידנית, ואם לא הוזן - נבנה מהכתובת
  ev.navUrl =
    mode === "place"
      ? wazeUrl ||
        (address ? `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes` : "")
      : "";

  return ev;
}

// --- שעון ישראל ---
//
// השעה שהמנהלת מזינה היא שעה בישראל, ולא שעה אצל מי שפותח את הדף.
// בלי התרגום הזה, מי שפותח את הדף מחוץ לישראל - או שרת שרץ ב-UTC -
// היה מקבל ביומן שעה אחרת לגמרי. Intl יודע לבד מתי יש שעון קיץ.
const IL = "Asia/Jerusalem";

function israelParts(date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: IL,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out = {};
  f.formatToParts(date).forEach((p) => {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (out.hour === "24") out.hour = "00";
  return out;
}

function israelOffsetMs(date) {
  const p = israelParts(date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - date.getTime();
}

// שעה על השעון בישראל -> הרגע המדויק בציר הזמן, בכל אזור זמן שהוא
function israelTime(year, month, day, hour, minute) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const first = new Date(guess.getTime() - israelOffsetMs(guess));
  // מעבר שעון קיץ בדיוק בתאריך הזה: סיבוב שני מדייק
  return new Date(guess.getTime() - israelOffsetMs(first));
}

/**
 * מועדי ההתחלה והסיום של המפגש, נגזרים מהתאריך והשעה שהוזנו.
 * dateShort הוא "20.11" והשעה היא "09:00-12:00" או "20:45".
 * השנה נבחרת כך שהתאריך יהיה הקרוב ביותר להיום, קדימה או אחורה.
 * מחזיר null אם אי אפשר לפענח - ואז פשוט לא מציגים ספירה או יומן.
 */
export function eventTimes(ev) {
  const d = /^(\d{1,2})[.\/-](\d{1,2})$/.exec(String(ev?.dateShort || "").trim());
  if (!d) return null;
  const day = Number(d[1]);
  const month = Number(d[2]);
  if (!day || !month || month > 12 || day > 31) return null;

  const t = String(ev?.time || "").replace(/[\u2013\u2014]/g, "-");
  const hm = /(\d{1,2}):(\d{2})/.exec(t);
  if (!hm) return null;
  const startH = Number(hm[1]);
  const startM = Number(hm[2]);
  const second = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(t);
  const endH = second ? Number(second[3]) : startH + 2;
  const endM = second ? Number(second[4]) : startM;

  const now = new Date();
  let start = null;
  for (const year of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const cand = israelTime(year, month, day, startH, startM);
    if (!start || Math.abs(cand - now) < Math.abs(start - now)) start = cand;
  }
  let end = israelTime(
    Number(israelParts(start).year),
    Number(israelParts(start).month),
    Number(israelParts(start).day),
    endH,
    endM
  );
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end };
}

/**
 * קריאת פרטי האירוע בלבד, בלי התמונות. זו הקריאה הקצרה, והיא מספיקה
 * כדי לצייר את הדף: הכותרת, התאריך והמקום. לעולם אינה זורקת.
 */
export async function loadEventDetails() {
  try {
    const snap = await getDoc(doc(crmDb, SETTINGS_COLLECTION, SETTINGS_DOC));
    return { settings: snap.exists() ? snap.data() : null, blocked: false };
  } catch {
    return { settings: null, blocked: true };
  }
}

/** קריאת התמונות בלבד. כולן במקביל. לעולם אינה זורקת. */
export async function loadEventPhotos() {
  const photos = {};
  await Promise.all(
    EVENT_PHOTO_SLOTS.map(async (slot) => {
      try {
        const snap = await getDoc(doc(crmDb, SETTINGS_COLLECTION, photoDocId(slot)));
        if (snap.exists()) photos[slot] = String(snap.data().dataUrl || "");
      } catch {
        // תמונה בודדת שלא נקראה אינה שוברת כלום
      }
    })
  );
  return photos;
}

/** קריאה מלאה. שתי הקריאות יוצאות יחד, ולא אחת אחרי השנייה. */
export async function loadEventSettings() {
  const [details, photos] = await Promise.all([loadEventDetails(), loadEventPhotos()]);
  return { settings: details.settings, photos, blocked: details.blocked };
}

/** שמירת הגדרות האירוע. מותרת למנהלת בלבד לפי כללי האבטחה. */
export async function saveEventSettings(data = {}) {
  const payload = {
    title: clean(data.title, 120),
    tagline: clean(data.tagline, 400),
    bring: clean(data.bring, 200),
    dateLabel: clean(data.dateLabel, 120),
    dateShort: clean(data.dateShort, 40),
    time: clean(data.time, 40),
    mode: data.mode === "place" ? "place" : "zoom",
    zoomUrl: clean(data.zoomUrl, 600),
    place: clean(data.place, 80),
    placeName: clean(data.placeName, 120),
    address: clean(data.address, 300),
    wazeUrl: clean(data.wazeUrl, 600),
  };
  payload.eventId = makeEventId(payload);
  payload.updatedAt = new Date().toISOString();
  await setDoc(doc(crmDb, SETTINGS_COLLECTION, SETTINGS_DOC), payload, { merge: true });
  return payload;
}

/** שמירת תמונה במשבצת אחת. */
export async function saveEventPhoto(slot, dataUrl) {
  if (!EVENT_PHOTO_SLOTS.includes(slot)) throw new Error("משבצת לא מוכרת");
  await setDoc(doc(crmDb, SETTINGS_COLLECTION, photoDocId(slot)), {
    dataUrl: String(dataUrl || ""),
    updatedAt: new Date().toISOString(),
  });
}

/** הסרת תמונה ממשבצת אחת. */
export async function removeEventPhoto(slot) {
  if (!EVENT_PHOTO_SLOTS.includes(slot)) throw new Error("משבצת לא מוכרת");
  await deleteDoc(doc(crmDb, SETTINGS_COLLECTION, photoDocId(slot)));
}

/* ───────────────────────── הרשמות ולידים ───────────────────────── */

/** שמירת הרשמה לאירוע. מחזירה את מזהה המסמך. */
export async function saveRsvp({ name, phone }, eventId = EVENT.id) {
  const n = clean(name, 120);
  const p = clean(phone, 40);
  if (n.length < 2) throw new Error("חסר שם מלא");
  if (p.length < 6) throw new Error("חסר מספר טלפון");
  const ref = await addDoc(collection(crmDb, "event_rsvps"), {
    status: "pending",
    eventId: eventId || EVENT.id,
    name: n,
    phone: p,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

/**
 * שמירת חברים שהומלצו למאגר אדמה (שלב 3).
 *
 * שתי הבטחות שחשוב לשמור עליהן:
 *  1. כל חבר נשמר כמסמך נפרד ועצמאי משלו באוסף event_leads, ולא כמערך
 *     בתוך מסמך אחד. כך אפשר לטפל בכל אחד בנפרד בלוח הבקרה.
 *  2. השמירות רצות במקביל ובנפרד, ולכן שורה אחת שנכשלת אינה מפילה
 *     את השאר. מוחזר מספר החברים שנשמרו בפועל.
 *
 * שימו לב: המועמדים שמוזנים בשלב ההכנה (שלב 2) אינם עוברים דרך כאן
 * ואינם נשמרים בשום מקום - הם נועדו אך ורק לדף ההדפסה של המשתמש.
 */
export async function saveLeads(rsvpId, rows, owner = {}, eventId = EVENT.id) {
  const valid = (rows || [])
    .map((r) => ({ name: clean(r.name, 120), phone: clean(r.phone, 40), note: clean(r.note, 400) }))
    .filter((r) => r.name.length >= 2);
  if (valid.length === 0) return 0;

  const results = await Promise.allSettled(
    valid.map((r) =>
      addDoc(collection(crmDb, "event_leads"), {
        status: "pending",
        eventId: eventId || EVENT.id,
        rsvpId: rsvpId || null,
        // מי המליץ. נשמר גם בשם המפורש שביקשת וגם בשדות הקיימים,
        // כדי שלוח הבקרה שכבר קורא אותם ימשיך לעבוד בלי שינוי.
        referred_by: clean(owner.name, 120),
        ownerName: clean(owner.name, 120),
        ownerPhone: clean(owner.phone, 40),
        name: r.name,
        phone: r.phone,
        note: r.note,
        createdAt: new Date().toISOString(),
      })
    )
  );
  return results.filter((x) => x.status === "fulfilled").length;
}

/** מנוי לקריאה בלוח הבקרה. מחזיר פונקציית ביטול. */
export function subscribeEvent(onData) {
  const unsubs = [];
  const pull = (name, key) =>
    onSnapshot(
      query(collection(crmDb, name), orderBy("createdAt", "desc")),
      (snap) => onData(key, snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => onData(key, null) // null = הקריאה נחסמה או נכשלה
    );
  unsubs.push(pull("event_rsvps", "rsvps"));
  unsubs.push(pull("event_leads", "leads"));
  return () => unsubs.forEach((u) => u());
}

/** המדריך שמודפס בדף ההכנה. */
export const PITCH_GUIDE = [
  { t: "פתחו בשם ובגיל", d: "משפט אחד יבש. \"יוסי, בן 26, מירושלים.\" בלי הקדמות." },
  { t: "תנו תמונה, לא רשימה", d: "במקום \"חרוץ, נחמד, רציני\" — \"קם כל בוקר בחמש לעבודה בשטח, ובערב יושב ללמוד.\"" },
  { t: "שורת המחץ", d: "המשפט שגורם למישהו להרים ראש. מה מיוחד בו/בה שאי אפשר לשכוח." },
  { t: "אמרו מה מחפשים", d: "שני קריטריונים, לא שבעה. מה באמת חייב להיות שם." },
  { t: "סיימו בשאלה", d: "\"למי זה מזכיר מישהו?\" — ותנו לחדר לחשוב." },
];
