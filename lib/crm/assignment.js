// מי רשאי/ת לשחרר שיוך של הצעה.
//
// הכלל: התיק שייך למי שלקח/ה אותו. רק היא משחררת אותו בחזרה למאגר,
// ורק אז מישהי אחרת יכולה לקחת אותו. לחיצה אקראית של מישהי אחרת על
// "שחרור שיוך" שיבשה עד היום את רצף העבודה בלי שאיש ישים לב.
//
// למנהלת נשמרת יכולת שחרור, אחרת תיק של אשת צוות שיצאה מהתמונה היה
// נשאר נעול לנצח. אבל אצלה זו פעולה מודעת: המסך מבקש ממנה אישור
// מפורש לפני השחרור, ולכן אין לחיצה בטעות.

const clean = (value) =>
  String(value || "")
    // תווי כיווניות נדבקים לפעמים בהעתקה, ומשווים שתי כתובות זהות כשונות
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .trim()
    .toLowerCase();

const sameEmail = (a, b) => !!clean(a) && clean(a) === clean(b);
const sameName = (a, b) => !!clean(a) && clean(a) === clean(b);

// האם המשתמש/ת הנוכחי/ת הוא/היא מי שהתיק משויך אליו/ה.
//
// המייל הוא הזיהוי המדויק. הצעות ותיקות נשמרו עם שם בלבד, לפני שהמייל
// נוסף לשיוך, ולכן יש נפילה אחורה להשוואת שם - אחרת הן היו ננעלות
// בפני מי שבאמת מטפל/ת בהן.
export function isAssignedTo(proposal, user) {
  if (!proposal?.assignee) return false;
  if (proposal.assigneeEmail) return sameEmail(proposal.assigneeEmail, user?.email);
  return sameName(proposal.assignee, user?.name);
}

// מצב כפתור "שחרור שיוך":
//   "unassigned" - אין שיוך כלל, ולכן אין מה לשחרר
//   "owner"      - התיק שלי, שחרור רגיל
//   "admin"      - מנהלת ששאינה בעלת התיק, שחרור אחרי אישור
//   "blocked"    - התיק של מישהי אחרת, הכפתור נעול
export function releaseAssignmentMode(proposal, user, role) {
  if (!proposal?.assignee) return "unassigned";
  if (isAssignedTo(proposal, user)) return "owner";
  if (role === "admin") return "admin";
  return "blocked";
}

export const canReleaseAssignment = (proposal, user, role) =>
  ["owner", "admin"].includes(releaseAssignmentMode(proposal, user, role));
