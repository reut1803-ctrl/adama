// ============================================================================
//  "ערב משדכים" — שכבת הנתונים של דף הנחיתה.
//
//  יחידה עצמאית לחלוטין:
//   · שני אוספים חדשים משלה, event_rsvps ו-event_leads.
//   · אינה נוגעת באוסף המועמדים ולא בשום אוסף קיים אחר.
//   · מייבאת את crmDb ישירות ולכן אינה נוגעת ב-lib/crm/store.js.
//
//  הדף פתוח בלי התחברות, בדיוק כמו טופס ההרשמה, ולכן הכתיבה נעשית
//  כאורח. כללי האבטחה של שני האוספים מופיעים ב-firestore.rules.
// ============================================================================

import { collection, addDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { crmDb } from "./firebaseClient";

export const EVENT = {
  id: "mesadchim-2026-10-31",
  title: "ערב משדכים",
  dateLabel: "מוצאי שבת · ל׳ בתשרי",
  dateShort: "31.10",
  time: "20:45",
  place: "בזום",
  // קישור הזום יוזן כאן. עד שיוזן, מסך הסיום מציג הודעה במקום קישור שבור.
  zoomUrl: "",
};

const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);

/** שמירת הרשמה לאירוע. מחזירה את מזהה המסמך. */
export async function saveRsvp({ name, phone }) {
  const n = clean(name, 120);
  const p = clean(phone, 40);
  if (n.length < 2) throw new Error("חסר שם מלא");
  if (p.length < 6) throw new Error("חסר מספר טלפון");
  const ref = await addDoc(collection(crmDb, "event_rsvps"), {
    status: "pending",
    eventId: EVENT.id,
    name: n,
    phone: p,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

/**
 * שמירת המועמדים שהשגריר/ה מביא/ה לערב.
 * כל מועמד נשמר כמסמך נפרד, כדי ששורה אחת שנכשלת לא תפיל את השאר.
 * מוחזר מספר המועמדים שנשמרו בפועל.
 */
export async function saveLeads(rsvpId, rows, owner = {}) {
  const valid = (rows || [])
    .map((r) => ({ name: clean(r.name, 120), phone: clean(r.phone, 40), note: clean(r.note, 400) }))
    .filter((r) => r.name.length >= 2);
  if (valid.length === 0) return 0;

  const results = await Promise.allSettled(
    valid.map((r) =>
      addDoc(collection(crmDb, "event_leads"), {
        status: "pending",
        eventId: EVENT.id,
        rsvpId: rsvpId || null,
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
