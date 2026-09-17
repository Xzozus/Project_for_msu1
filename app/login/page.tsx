"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { DOMAIN_ERROR, isMsuEmail } from "@/lib/auth";
import { auth, db, googleProvider, MSU_EMAIL_SUFFIX } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const sendToProfileSetupIfNeeded = useCallback(async (currentUser: User) => {
    const profileSnapshot = await getDoc(doc(db, "users", currentUser.uid));

    if (!profileSnapshot.exists()) {
      router.replace("/profile/setup");
      return;
    }

    router.replace("/dashboard");
  }, [router]);

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setErrorMessage("");

      try {
        if (currentUser && !isMsuEmail(currentUser.email)) {
          await signOut(auth);
          setUser(null);
          setErrorMessage(DOMAIN_ERROR);
          return;
        }

        setUser(currentUser);

        if (currentUser) {
          await sendToProfileSetupIfNeeded(currentUser);
        }
      } catch (error) {
        console.error("Auth session check error:", error);
      } finally {
        setIsCheckingSession(false);
      }
    });
  }, [sendToProfileSetupIfNeeded]);

  async function handleGoogleSignIn() {
    setIsSigningIn(true);
    setErrorMessage("");

    try {
      const result = await signInWithPopup(auth, googleProvider);

      if (!isMsuEmail(result.user.email)) {
        await signOut(auth);
        setUser(null);
        setErrorMessage(DOMAIN_ERROR);
        return;
      }

      setUser(result.user);
      await sendToProfileSetupIfNeeded(result.user);
    } catch (error) {
      console.error("Google Sign-In error:", error);
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "auth/popup-closed-by-user"
      ) {
        setErrorMessage("ปิดหน้าต่างเข้าสู่ระบบก่อนดำเนินการเสร็จ");
      } else {
        setErrorMessage("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    setErrorMessage("");
    await signOut(auth);
    setUser(null);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8db] px-5 py-10 text-[#171717]">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#f2e7b5] bg-white shadow-[0_22px_70px_rgba(90,72,13,0.16)] md:grid-cols-[1.05fr_0.95fr]">
        <div className="flex min-h-[520px] flex-col justify-center bg-[#FFCD22] p-8 text-[#221b00] sm:p-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em]">
              MSU Course Match
            </p>
            <h1 className="mt-8 max-w-md text-4xl font-bold leading-tight sm:text-5xl">
              พอกันทีกับการไม่มีเพื่อนเรียนวิชาเดียวกัน
            </h1>
          </div>
        </div>

        <div className="flex min-h-[520px] flex-col justify-center p-8 sm:p-10">
          <div className="mx-auto w-full max-w-sm">
            <p className="text-sm font-semibold text-[#9b7a00]">
              เข้าสู่ระบบสำหรับนักศึกษา
            </p>
            <h2 className="mt-3 text-3xl font-bold text-[#171717]">
              ใช้บัญชี Google ของมหาวิทยาลัย
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5f5a48]">
              ระบบอนุญาตเฉพาะอีเมลที่ลงท้ายด้วย {MSU_EMAIL_SUFFIX}
            </p>

            <div className="mt-8">
              {isCheckingSession ? (
                <div className="rounded-2xl border border-[#f2e7b5] bg-[#fffdf5] px-5 py-4 text-sm font-medium text-[#7a650e]">
                  กำลังตรวจสอบสถานะเข้าสู่ระบบ
                </div>
              ) : user ? (
                <div className="space-y-4 rounded-3xl border border-[#f2e7b5] bg-[#fffdf5] p-5 shadow-[0_12px_28px_rgba(90,72,13,0.08)]">
                  <div>
                    <p className="text-sm font-semibold text-[#7a650e]">
                      เข้าสู่ระบบสำเร็จ
                    </p>
                    <p className="mt-1 break-words text-lg font-bold text-[#171717]">
                      {user.displayName ?? user.email}
                    </p>
                    <p className="mt-1 break-words text-sm text-[#5f5a48]">
                      {user.email}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="h-12 w-full rounded-full border border-[#e5d48d] bg-white px-5 text-sm font-bold text-[#5f4a00] shadow-[0_8px_18px_rgba(90,72,13,0.1)] transition hover:bg-[#fff8db] focus:outline-none focus:ring-4 focus:ring-[#FFCD22]/35"
                  >
                    ออกจากระบบ
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isSigningIn}
                  className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#171717] px-5 text-base font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.2)] transition hover:translate-y-[-1px] hover:bg-[#2b2b2b] focus:outline-none focus:ring-4 focus:ring-[#FFCD22]/45 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-white text-base font-black text-[#171717]">
                    G
                  </span>
                  {isSigningIn ? "กำลังเข้าสู่ระบบ" : "เข้าสู่ระบบด้วย Google"}
                </button>
              )}
            </div>

            {errorMessage ? (
              <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
