"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Heart, AlertTriangle, X } from "lucide-react";
import Button from "@/components/crm/ui/Button";
import SearchableSelect from "@/components/crm/ui/SearchableSelect";
import ExternalCandidatePanel from "@/components/crm/proposals/ExternalCandidatePanel";
import { isOnActiveBoard, lastDropInfo, pastProposalsForPair, toMillis } from "@/lib/crm/attention";
import ProposalCard from "@/components/crm/proposals/ProposalCard";
import DroppedArchive from "@/components/crm/proposals/DroppedArchive";
import FrozenShelf from "@/components/crm/proposals/FrozenShelf";
import ConfirmDialog from "@/components/crm/ui/ConfirmDialog";
import { useCrmStore, PROPOSAL_DROPPED, PROPOSAL_FROZEN } from "@/lib/crm/store";

// מזהה הבחירה "מישהו מהמעגל שלי". יושב כאן ולא בתוך הרכיב, כדי שיהיה
// זמין גם לחישוב שרץ לפני בדיקת ההרשאה.
const EXTERNAL = "__external__";

function PreselectFromQuery() {
  const searchParams = useSearchParams();
  const setSelection = useCrmStore((s) => s.setProposalSelection);
  const findCandidateById = useCrmStore((s) => s.findCandidateById);

  useEffect(() => {
    const selectId = searchParams.get("select");
    if (!selectId) return;
    const candidate = findCandidateById(selectId);
    if (candidate) setSelection(candidate.gender, candidate.id);
  }, [searchParams, setSelection, findCandidateById]);

  return null;
}

export default function ProposalsPage() {
  const role = useCrmStore((s) => s.role);
  const selection = useCrmStore((s) => s.proposalSelection);
  const setSelection = useCrmStore((s) => s.setProposalSelection);
  const createProposal = useCrmStore((s) => s.createProposal);
  const proposals = useCrmStore((s) => s.proposals);
  const allCandidates = useCrmStore((s) => s.allCandidates);
  const candidates_ = useCrmStore((s) => s.candidates);
  const maleCandidates = useMemo(() => allCandidates("male"), [allCandidates, candidates_]);
  const femaleCandidates = useMemo(() => allCandidates("female"), [allCandidates, candidates_]);
  const [rationale, setRationale] = useState("");
  // מועמד/ת "חיצוני/ת" - מישהו מהמעגל האישי של השדכנית, שאינו/ה במאגר.
  // הפרטים נשמרים בתוך ההצעה בלבד ולא נוצר מהם כרטיס במאגר.
  const [externalMale, setExternalMale] = useState(null);
  const [externalFemale, setExternalFemale] = useState(null);
  // אישור לפני הקמה חוזרת של הצעה בין זוג שכבר נוסה בעבר
  const [confirmingRepeat, setConfirmingRepeat] = useState(false);

  // התראת הכפילות.
  //
  // קודם היא נגזרה ישירות מהבחירה הנוכחית, ולכן ברגע שההצעה הוקמה
  // הבחירה התנקתה וההתראה נעלמה מעצמה - לפני שהספיקו לקרוא אותה.
  // עכשיו היא נשמרת במצב משלה ויורדת מהמסך רק בשתי דרכים: סגירה ידנית,
  // או בחירת זוג אחר שאין בו היסטוריה. אין כאן שום מונה זמן.
  const [duplicateNotice, setDuplicateNotice] = useState(null);
  const [dismissedPair, setDismissedPair] = useState("");

  useEffect(() => {
    const { male, female } = selection;

    // ההתראה שייכת לזוג מסוים אחד, ולכן היא יורדת מהמסך ברגע שצד שנבחר
    // עכשיו סותר את הזוג שהיא מתארת.
    //
    // בלי הבדיקה הזו התראה של זוג קודם נשארה על המסך בזמן שמרכיבים זוג
    // חדש לגמרי, והציגה תאריך של הצעה שאין לה שום קשר לשני האנשים
    // שנבחרו - אזעקת שווא.
    //
    // בחירה ריקה אינה סתירה. זה בדיוק המצב שמיד אחרי ההקמה, ושם ההתראה
    // חייבת להישאר עד שסוגרים אותה ידנית או מתחילים זוג אחר.
    setDuplicateNotice((prev) => {
      if (!prev) return prev;
      const contradicts = (side, belongsTo) => !!side && side !== belongsTo;
      return contradicts(male, prev.male) || contradicts(female, prev.female) ? null : prev;
    });

    if (!male || !female || male === EXTERNAL || female === EXTERNAL) return;

    const pairKey = `${male}|${female}`;
    // הזוג הזה נסגר ידנית - לא מציגים עליו התראה, וגם לא משאירים התראה
    // קודמת תלויה על המסך.
    if (pairKey === dismissedPair) {
      setDuplicateNotice(null);
      return;
    }

    const past = pastProposalsForPair(proposals, male, female);
    if (past.length === 0) {
      setDuplicateNotice(null);
      return;
    }
    const dropped = past.filter((x) => x.status === PROPOSAL_DROPPED);
    setDuplicateNotice({
      pairKey,
      // שני הצדדים נשמרים בנפרד, כדי שאפשר יהיה להצליב כל צד לחוד מול
      // הבחירה הנוכחית ולא רק את המפתח המחובר.
      male,
      female,
      isDropped: dropped.length > 0,
      dateMs: toMillis((dropped[0] || past[0]).createdAt),
      rationale: dropped.length > 0 ? lastDropInfo(dropped[0], PROPOSAL_DROPPED)?.rationale || "" : "",
    });
  }, [selection, proposals, dismissedPair]);

  if (role !== "staff" && role !== "admin") {
    return <p className="px-4 py-10 text-center text-sm text-[#7C6E60]">אזור זה זמין לצוות בלבד</p>;
  }

  const externalOption = [{ value: EXTERNAL, label: "מישהו מהמעגל שלי...", highlight: true }];
  const toOptions = (list) => list.map((c) => ({ value: c.id, label: c.name }));

  const pickMale = (v) => {
    setSelection("male", v);
    setExternalMale(v === EXTERNAL ? { name: "", notes: "", audioUrl: null, photoUrl: null, phone: "" } : null);
  };
  const pickFemale = (v) => {
    setSelection("female", v);
    setExternalFemale(v === EXTERNAL ? { name: "", notes: "", audioUrl: null, photoUrl: null, phone: "" } : null);
  };

  const sideReady = (sel, ext) => (sel === EXTERNAL ? !!ext?.name.trim() : !!sel);
  const canCreate = sideReady(selection.male, externalMale) && sideReady(selection.female, externalFemale);

  const submitProposal = () => {
    createProposal(selection.male, selection.female, rationale.trim(), {
      male: selection.male === EXTERNAL ? externalMale : null,
      female: selection.female === EXTERNAL ? externalFemale : null,
    });
    setRationale("");
    setExternalMale(null);
    setExternalFemale(null);
  };

  // הצעה שירדה מהפרק יורדת מהלוח הפעיל מיד ועוברת להיסטוריה שבתחתית המסך.
  // היא נשמרת במסד הנתונים לתמיד, וזה מה שמאפשר את התראת הכפילות שמתחת.
  // חלון 48 השעות אינו כאן אלא בכרטיס המועמד/ת בלבד.
  const visibleProposals = proposals.filter((p) => isOnActiveBoard(p, PROPOSAL_DROPPED));
  // מוקפאים ומה שירד מהפרק יורדים שניהם מהלוח, אך לאזורים נפרדים:
  // מוקפא ממתין וחוזר, ומה שירד מהפרק נסגר ונשמר להתראת הכפילות.
  const frozenProposals = proposals.filter((p) => p.status === PROPOSAL_FROZEN);
  const archivedProposals = proposals.filter(
    (p) => !isOnActiveBoard(p, PROPOSAL_DROPPED) && p.status !== PROPOSAL_FROZEN
  );

  // חגורת ביטחון שנייה להתראת הכפילות: גם אם משהו ישתנה בעתיד בלוגיקה
  // שלמעלה, ההתראה לעולם לא תוצג לצד זוג שסותר אותה. בחירה ריקה אינה
  // סתירה, ולכן ההתראה שורדת את ניקוי הבחירה שאחרי ההקמה.
  const noticeMatchesSelection =
    !!duplicateNotice &&
    (!selection.male || selection.male === duplicateNotice.male) &&
    (!selection.female || selection.female === duplicateNotice.female);

  // התראת כפילות: נבדקת מול כל ההיסטוריה, כולל הצעות שכבר אינן מוצגות
  const pastForSelection =
    selection.male && selection.female && selection.male !== EXTERNAL && selection.female !== EXTERNAL
      ? pastProposalsForPair(proposals, selection.male, selection.female)
      : [];

  return (
    <div className="px-4 py-6">
      <Suspense fallback={null}>
        <PreselectFromQuery />
      </Suspense>

      <h1 className="text-xl font-bold text-[#3A2E26]">הצעת התאמה</h1>
      <p className="mt-1 text-[13px] text-[#7C6E60]">בחרו בחור ובחורה והציעו התאמה ביניהם</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-[#3A2E26]">בחור</p>
          <SearchableSelect
            value={selection.male || ""}
            onChange={pickMale}
            options={toOptions(maleCandidates)}
            extraOptions={externalOption}
            placeholder="בחירת בחור..."
            searchPlaceholder="הקלידו שם..."
          />
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-[#3A2E26]">בחורה</p>
          <SearchableSelect
            value={selection.female || ""}
            onChange={pickFemale}
            options={toOptions(femaleCandidates)}
            extraOptions={externalOption}
            placeholder="בחירת בחורה..."
            searchPlaceholder="הקלידו שם..."
          />
        </div>
      </div>

      {selection.male === EXTERNAL && (
        <ExternalCandidatePanel value={externalMale} onChange={setExternalMale} genderLabel="בחור" />
      )}
      {selection.female === EXTERNAL && (
        <ExternalCandidatePanel value={externalFemale} onChange={setExternalFemale} genderLabel="בחורה" />
      )}

      <div className="mt-3">
        <p className="mb-1.5 text-[12px] font-semibold text-[#3A2E26]">הרציונל (הניצוץ) - למה זה מתאים?</p>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={2}
          placeholder="מה משלים בין הצדדים, למה נוצר החיבור..."
          className="w-full resize-none rounded-2xl border border-[#CCBDAB] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#844442]"
        />
      </div>

      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={!canCreate}
        onClick={() => {
          // זוג שכבר נוסה בעבר לא מוקם בלחיצה אחת: המערכת מבקשת אישור
          if (pastForSelection.length > 0) {
            setConfirmingRepeat(true);
            return;
          }
          submitProposal();
        }}
      >
        <Heart size={16} /> הצע התאמה
      </Button>

      {confirmingRepeat && (
        <ConfirmDialog
          message="הצעה בין השניים האלה כבר עלתה בעבר. אפשר להמשיך ולהציע שוב - להקים את ההצעה?"
          confirmLabel="להקים בכל זאת"
          tone="primary"
          onConfirm={() => {
            setConfirmingRepeat(false);
            submitProposal();
          }}
          onCancel={() => setConfirmingRepeat(false)}
        />
      )}

      {/* התראת כפילות - נשענת על ההיסטוריה המלאה במסד הנתונים, גם על הצעות
          שכבר ירדו מהתצוגה. זו הסיבה שהצעות שירדו מהפרק לעולם אינן נמחקות.
          ההתראה נשארת על המסך עד סגירה ידנית, גם אחרי שההצעה הוקמה. */}
      {duplicateNotice && noticeMatchesSelection && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border-2 border-[#D9A441] bg-[#FDF6E7] px-3.5 py-3">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#7A5A18]" />
          <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-[#7A5A18]">
            <p className="font-bold">שימו לב - ההתאמה הזו כבר עלתה בעבר</p>
            <p className="mt-0.5">
              {duplicateNotice.isDropped
                ? `הצעה בין השניים האלה כבר הוצעה וירדה מהפרק (${new Date(
                    duplicateNotice.dateMs
                  ).toLocaleDateString("he-IL")}).`
                : `קיימת כבר הצעה פעילה בין השניים האלה (${new Date(
                    duplicateNotice.dateMs
                  ).toLocaleDateString("he-IL")}).`}
              {" "}
              אפשר להמשיך ולהציע שוב, אבל המערכת תבקש אישור לפני ההקמה.
            </p>
            {duplicateNotice.isDropped && duplicateNotice.rationale && (
              <p className="mt-1">
                הרציונל שנכתב אז: <span className="font-semibold">{duplicateNotice.rationale}</span>
              </p>
            )}
            <button
              onClick={() => {
                setDismissedPair(duplicateNotice.pairKey);
                setDuplicateNotice(null);
              }}
              className="mt-2 rounded-xl border border-[#D9A441] bg-white px-3 py-1.5 text-[12px] font-bold text-[#7A5A18] transition active:scale-95"
            >
              הבנתי
            </button>
          </div>
          <button
            onClick={() => {
              setDismissedPair(duplicateNotice.pairKey);
              setDuplicateNotice(null);
            }}
            aria-label="סגירת ההתראה"
            title="סגירה"
            className="-mt-1 shrink-0 rounded-full p-1 text-[#7A5A18] transition hover:bg-white active:scale-90"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-[15px] font-bold text-[#3A2E26]">הצעות פעילות ({visibleProposals.length})</h2>
        {visibleProposals.length === 0 ? (
          <p className="text-center text-sm text-[#7C6E60]">עדיין לא הוצעו התאמות</p>
        ) : (
          <div className="space-y-3">
            {visibleProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
        <FrozenShelf proposals={frozenProposals} />
        <DroppedArchive proposals={archivedProposals} />
      </div>
    </div>
  );
}
