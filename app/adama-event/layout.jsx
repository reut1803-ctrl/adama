import { SITE_URL_PAGES, SITE_URL_VERCEL } from "../../lib/appConfig";

// תצוגה מקדימה של הקישור בוואטסאפ ובפייסבוק.
//
// הדף עצמו הוא רכיב לקוח ולכן אינו יכול לייצא metadata. השכבה הזו היא
// רכיב שרת שיושב סביבו רק כדי לתת לו כותרת, תיאור ותמונת שיתוף משלו,
// במקום אלה של האתר כולו. היא אינה עוטפת שום לוגיקה ואינה נוגעת בדף.
//
// פרטי המפגש כתובים כאן במפורש: תצוגה מקדימה נקראת על ידי וואטסאפ
// מהשרת, בלי להריץ קוד, ולכן אי אפשר למשוך אותם מההגדרות שבמסד הנתונים.

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
const siteUrl = base ? SITE_URL_PAGES : SITE_URL_VERCEL;

const TITLE = "נפגשים לשדך את החבר'ה של החוות והגבעות";
const DESCRIPTION = "יום שישי · י׳ כסלו · 20.11 · 09:00-12:00 · עגלת קפה עין סאמיה. באים מוכנים, יוצאים עם חיבורים.";
const SHARE_IMAGE = `${siteUrl}/assets/event/flock.jpg`;

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "he_IL",
    title: TITLE,
    description: DESCRIPTION,
    url: `${siteUrl}/adama-event`,
    images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

export default function AdamaEventLayout({ children }) {
  return children;
}
