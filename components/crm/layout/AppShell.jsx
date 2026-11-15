"use client";

import { useEffect, useRef } from "react";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import FabButtons from "./FabButtons";
import TermsGate from "./TermsGate";
import Toast from "./Toast";
import SignInGate from "./SignInGate";
import StaffTour from "@/components/crm/tour/StaffTour";
import AccessDeniedGate from "./AccessDeniedGate";
import { useScrollRestoration } from "@/lib/crm/useScrollRestoration";
import { useCrmStore } from "@/lib/crm/store";

export default function AppShell({ children }) {
  const scrollRef = useRef(null);
  const googleUser = useCrmStore((s) => s.googleUser);
  const authLoading = useCrmStore((s) => s.authLoading);
  const role = useCrmStore((s) => s.role);
  const allowlistLoaded = useCrmStore((s) => s.allowlistLoaded);
  const allowlistError = useCrmStore((s) => s.allowlistError);
  useScrollRestoration(scrollRef);

  useEffect(() => {
    useCrmStore.getState().initCrmFirebase();
  }, []);

  if (authLoading) return <div className="h-dvh bg-[#E8DCCB]" />;
  if (!googleUser) return <SignInGate />;
  // מציגים את מסך "אין הרשאה" רק אחרי שרשימת ההרשאות נבדקה מול השרת,
  // כדי שאיש/אשת צוות מאושר/ת לא יראה/תראה אותו להרף עין בזמן הטעינה.
  // בדיקה שנכשלה אינה "אין הרשאה": מציגים מסך אחר, עם בדיקה חוזרת,
  // כדי שאיש/אשת צוות מאושר/ת לא יקבל/תקבל הודעה שגויה.
  if (allowlistLoaded && allowlistError && role !== "admin" && role !== "staff")
    return <AccessDeniedGate reason="checkFailed" />;
  if (allowlistLoaded && role === "unauthorized") return <AccessDeniedGate />;

  return (
    <div className="flex h-dvh flex-col bg-[#E8DCCB] text-[#3A2E26]" dir="rtl">
      <TopBar />
      <main ref={scrollRef} className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>
      <FabButtons />
      <BottomNav />
      <TermsGate />
      <Toast />
      <StaffTour />
    </div>
  );
}
