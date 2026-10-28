// ============================================================================
//  שכבת הנתונים של מסך השגריר/ה: "עדכון אחרי שיחה" ו"איך עבר החודש?".
//
//  למה הנתונים יושבים כאן ולא באוספים חדשים משלהם:
//  כללי האבטחה של המערכת מונים את האוספים המותרים אחד-אחד, וכל אוסף שאינו
//  מופיע שם נחסם בשרת. פתיחת אוסף חדש הייתה מחייבת שינוי בכללי האבטחה -
//  וזה אסור. לכן שתי היכולות נשמרות על מסמכים שכבר קיימים ושההרשאות
//  עליהם כבר נכונות בדיוק:
//
//    עדכון אחרי שיחה  ->  שדה contactUpdates על מסמך המועמד/ת.
//                         כללי candidates כבר מתירים עדכון לצוות, וההנהלה
//                         ממילא קוראת את כל המועמדים - כך העדכון מגיע אליה.
//
//    סיכום חודשי      ->  שדה monthlyReflections על telemetry/{email}.
//                         הכלל שם הוא בדיוק מה שצריך: כל אשת צוות כותבת רק
//                         את המסמך שלה, וכל הצוות (כולל ההנהלה) קורא.
//                         הכתיבה היא merge, ולכן היא אינה דורסת את מוני
//                         הפעילות השבועיים שכבר יושבים על אותו מסמך.
//
//  אין כאן שום שינוי בכללי האבטחה, בהרשאות או בהתחברות.
// ============================================================================

import { doc, updateDoc, setDoc, arrayUnion } from "firebase/firestore";
import { crmDb } from "./firebaseClient";

export const MAX_UPDATES_KEPT = 40;

/** מפתח חודש בפורמט YYYY-MM */
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTHS_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

export function monthLabel(key) {
  const [y, m] = (key || "").split("-");
  const i = Number(m) - 1;
  return MONTHS_HE[i] ? `${MONTHS_HE[i]} ${y}` : key;
}

/** העדכונים של מועמד/ת, מהחדש לישן. בטוח גם לכרטיס שאין בו שדה כזה. */
export function updatesOf(candidate) {
  const list = Array.isArray(candidate?.contactUpdates) ? candidate.contactUpdates : [];
  return [...list].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

/** מספר הימים שחלפו מאז חותמת זמן. null אם אין חותמת תקינה. */
export function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/**
 * שמירת עדכון אחרי שיחה על כרטיס המועמד/ת.
 * arrayUnion מוסיף בלי לקרוא קודם את המסמך, ולכן שני אנשי צוות שכותבים
 * באותו רגע אינם דורסים זה את זה.
 */
export async function addContactUpdate(candidateId, { text, byName, byEmail }) {
  const clean = (text || "").trim();
  if (!candidateId || !clean) throw new Error("חסר טקסט לעדכון");
  await updateDoc(doc(crmDb, "candidates", candidateId), {
    contactUpdates: arrayUnion({
      id: `u-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      at: new Date().toISOString(),
      text: clean,
      byName: byName || "",
      byEmail: byEmail || "",
    }),
  });
}

/**
 * שמירת הסיכום החודשי. נשמר לפי חודש, כך שמילוי חוזר באותו חודש מעדכן
 * ואינו יוצר רשומה כפולה. חודשים קודמים נשארים כפי שהם.
 */
export async function saveMonthlyReflection(staffEmail, { month, answers, byName }) {
  if (!staffEmail) throw new Error("חסר מזהה משתמש");
  const key = month || monthKey();
  await setDoc(
    doc(crmDb, "telemetry", staffEmail),
    {
      monthlyReflections: {
        [key]: {
          month: key,
          answers: answers || {},
          byName: byName || "",
          updatedAt: new Date().toISOString(),
        },
      },
    },
    { merge: true }
  );
}

/** הסיכום של החודש הנוכחי, אם כבר מולא. */
export function reflectionFor(telemetryEntry, month = monthKey()) {
  return telemetryEntry?.monthlyReflections?.[month] || null;
}

/** שאלות הסיכום החודשי. */
export const REFLECTION_QUESTIONS = [
  { id: "went_well", label: "מה עבד טוב החודש?", hint: "שיחה שהצליחה, מועמד/ת שהתקדם/ה, משהו שעשית אחרת…" },
  { id: "stuck", label: "איפה נתקעת?", hint: "מה היה קשה, ואיפה היית צריכה עזרה…" },
  { id: "need", label: "במה נוכל לעזור לך בחודש הבא?", hint: "כלים, ליווי, הכשרה, או כל דבר אחר…" },
];

/** כפתורי הסטטוס המהירים במודאל העדכון. */
export const QUICK_UPDATES = [
  "דיברנו, הכול טוב",
  "לא ענה/תה — אנסה שוב",
  "ביקש/ה הפסקה זמנית",
  "בקשר עם מישהו/י כרגע",
  "מחפש/ת באופן פעיל",
];
