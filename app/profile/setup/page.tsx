"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { DOMAIN_ERROR, getStudentIdFromEmail, isMsuEmail } from "@/lib/auth";
import { auth, db } from "@/lib/firebase";
import { getMajorsByFaculty, MSU_FACULTIES } from "@/lib/msuData";
import { AVATAR_OPTIONS } from "@/lib/avatars";

type AvatarId = string;

type ProfileForm = {
  nickname: string;
  year: string;
  faculty: string;
  major: string;
  personality: string;
  avatarId: AvatarId;
};

type StoredProfile = Partial<{
  nickname: string;
  year: number;
  faculty: string;
  major: string;
  personality: string;
  avatarId: string;
  savedFilters: unknown[];
}>;

const DEFAULT_FORM: ProfileForm = {
  nickname: "",
  year: "",
  faculty: "",
  major: "",
  personality: "",
  avatarId: "sun-01",
};

function isAvatarId(value: unknown): value is AvatarId {
  return AVATAR_OPTIONS.some((avatar) => avatar.id === value);
}

function getText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function ProfileSetupPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [form, setForm] = useState<ProfileForm>(DEFAULT_FORM);
  const [savedFilters, setSavedFilters] = useState<unknown[]>([]);
  const [hasExistingProfile, setHasExistingProfile] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const studentId = useMemo(() => {
    return currentUser?.email ? getStudentIdFromEmail(currentUser.email) : "";
  }, [currentUser]);

  const availableMajors = useMemo(() => {
    return getMajorsByFaculty(form.faculty);
  }, [form.faculty]);

  const isFormValid =
    Boolean(currentUser?.email) &&
    form.nickname.trim().length > 0 &&
    form.nickname.trim().length <= 50 &&
    form.year.length > 0 &&
    form.faculty.trim().length > 0 &&
    form.major.trim().length > 0 &&
    form.personality.trim().length > 0 &&
    form.personality.trim().length <= 100;

  useEffect(() => {
    let isActive = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setErrorMessage("");

      if (!firebaseUser) {
        router.replace("/login");
        return;
      }

      if (!isMsuEmail(firebaseUser.email)) {
        await signOut(auth);
        router.replace("/login");
        return;
      }

      try {
        const profileRef = doc(db, "users", firebaseUser.uid);
        const profileSnapshot = await getDoc(profileRef);

        if (!isActive) {
          return;
        }

        setCurrentUser(firebaseUser);

        if (profileSnapshot.exists()) {
          const data = profileSnapshot.data() as StoredProfile;

          setHasExistingProfile(true);
          setSavedFilters(Array.isArray(data.savedFilters) ? data.savedFilters : []);
          setForm({
            nickname: getText(data.nickname),
            year: typeof data.year === "number" ? String(data.year) : "",
            faculty: getText(data.faculty),
            major: getText(data.major),
            personality: getText(data.personality),
            avatarId: isAvatarId(data.avatarId) ? data.avatarId : "sun-01",
          });
        }
      } catch {
        if (isActive) {
          setErrorMessage("โหลดข้อมูลโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [router]);

  function updateField(field: keyof ProfileForm, value: string) {
    setSuccessMessage("");
    if (field === "faculty") {
      const newMajors = getMajorsByFaculty(value);
      setForm((currentForm) => ({
        ...currentForm,
        faculty: value,
        major: newMajors.includes(currentForm.major) ? currentForm.major : "",
      }));
    } else {
      setForm((currentForm) => ({
        ...currentForm,
        [field]: value,
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (form.nickname.trim().length > 50) {
      setErrorMessage("ชื่อเล่นต้องไม่เกิน 50 ตัวอักษร");
      return;
    }

    if (form.personality.trim().length > 100) {
      setErrorMessage("ลักษณะนิสัยต้องไม่เกิน 100 ตัวอักษร");
      return;
    }

    if (!currentUser?.email || !isFormValid) {
      setErrorMessage("กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน");
      return;
    }

    setIsSaving(true);

    try {
      const profileRef = doc(db, "users", currentUser.uid);
      const updatedNickname = form.nickname.trim().slice(0, 50);
      const updatedYear = Number(form.year);
      const updatedFaculty = form.faculty.trim();
      const updatedMajor = form.major.trim();
      const updatedPersonality = form.personality.trim().slice(0, 100);
      const updatedAvatarId = form.avatarId;

      const baseProfile = {
        studentId,
        email: currentUser.email,
        nickname: updatedNickname,
        year: updatedYear,
        faculty: updatedFaculty,
        major: updatedMajor,
        personality: updatedPersonality,
        avatarId: updatedAvatarId,
        savedFilters,
      };

      await setDoc(
        profileRef,
        hasExistingProfile
          ? baseProfile
          : {
              ...baseProfile,
              createdAt: serverTimestamp(),
            },
        { merge: true },
      );

      // Sync updated profile fields to existing user listings and groupPosts
      try {
        const batch = writeBatch(db);

        // Update listings
        const listingsQ = query(
          collection(db, "listings"),
          where("uid", "==", currentUser.uid)
        );
        const listingsSnap = await getDocs(listingsQ);
        listingsSnap.forEach((d) => {
          batch.update(d.ref, {
            nickname: updatedNickname,
            year: updatedYear,
            faculty: updatedFaculty,
            major: updatedMajor,
            personality: updatedPersonality,
            avatarId: updatedAvatarId,
          });
        });

        // Update groupPosts
        const groupPostsQ = query(
          collection(db, "groupPosts"),
          where("uid", "==", currentUser.uid)
        );
        const groupPostsSnap = await getDocs(groupPostsQ);
        groupPostsSnap.forEach((d) => {
          batch.update(d.ref, {
            nickname: updatedNickname,
            year: updatedYear,
            faculty: updatedFaculty,
            major: updatedMajor,
            avatarId: updatedAvatarId,
          });
        });

        await batch.commit();
      } catch (syncErr) {
        console.error("Failed to sync profile to existing posts:", syncErr);
      }

      setHasExistingProfile(true);
      setSuccessMessage("บันทึกโปรไฟล์เรียบร้อยแล้ว");
      router.replace("/dashboard");
    } catch {
      setErrorMessage("บันทึกโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff8db] px-5 text-[#171717]">
        <div className="rounded-[28px] border border-[#f2e7b5] bg-white px-8 py-6 text-sm font-semibold text-[#7a650e] shadow-[0_18px_50px_rgba(90,72,13,0.12)]">
          กำลังเตรียมหน้าโปรไฟล์
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff8db] px-5 py-8 text-[#171717]">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 rounded-[28px] bg-[#FFCD22] px-6 py-6 text-[#221b00] shadow-[0_18px_45px_rgba(90,72,13,0.12)] sm:flex-row sm:items-center sm:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em]">
              MSU Course Match
            </p>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
              ตั้งค่าโปรไฟล์
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6">
              จัดการข้อมูลโปรไฟล์ของคุณเพื่อแสดงในประกาศหาเพื่อนและหากลุ่ม
            </p>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="h-11 rounded-full bg-white px-5 text-sm font-bold text-[#5f4a00] shadow-[0_8px_18px_rgba(90,72,13,0.12)] transition hover:bg-[#fff8db] focus:outline-none focus:ring-4 focus:ring-white/50"
          >
            ออกจากระบบ
          </button>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid gap-6 rounded-[28px] border border-[#f2e7b5] bg-white p-5 shadow-[0_22px_70px_rgba(90,72,13,0.12)] lg:grid-cols-[0.9fr_1.1fr] lg:p-8"
        >
          <aside className="space-y-5">
            <div className="rounded-3xl border border-[#f2e7b5] bg-[#fffdf5] p-5">
              <p className="text-sm font-semibold text-[#9b7a00]">
                บัญชีที่ใช้เข้าสู่ระบบ
              </p>
              <p className="mt-2 break-words text-xl font-bold">
                {currentUser?.displayName ?? currentUser?.email}
              </p>
              <p className="mt-1 break-words text-sm text-[#5f5a48]">
                {currentUser?.email}
              </p>
              <p className="mt-4 rounded-full bg-[#FFCD22]/30 px-4 py-2 text-sm font-bold text-[#5f4a00]">
                รหัสนิสิต: {studentId}
              </p>
            </div>

            <div>
              <p className="text-sm font-bold text-[#5f4a00]">เลือก avatar</p>
              <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-4">
                {AVATAR_OPTIONS.map((avatar) => {
                  const isSelected = form.avatarId === avatar.id;

                  return (
                    <button
                      key={avatar.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => updateField("avatarId", avatar.id)}
                      className={`aspect-square rounded-3xl border-2 p-1 transition focus:outline-none focus:ring-4 focus:ring-[#FFCD22]/40 ${
                        isSelected
                          ? "border-[#171717] shadow-[0_10px_22px_rgba(0,0,0,0.16)]"
                          : "border-[#f2e7b5] hover:border-[#d6b21c]"
                      }`}
                    >
                      <span
                        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-[20px] ${avatar.color} text-xs font-black text-[#171717]`}
                      >
                        <img
                          src={avatar.src}
                          alt={avatar.label}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        <span className="absolute">{avatar.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <div className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
                <div className="flex justify-between">
                  <span>ชื่อเล่น</span>
                  <span className="text-xs font-normal text-[#5f5a48]">
                    {form.nickname.length}/50
                  </span>
                </div>
                <input
                  value={form.nickname}
                  maxLength={50}
                  onChange={(event) => updateField("nickname", event.target.value)}
                  className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25"
                  placeholder="เช่น นนท์"
                />
              </label>

              <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
                ชั้นปี
                <select
                  value={form.year}
                  onChange={(event) => updateField("year", event.target.value)}
                  className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25"
                >
                  <option value="">เลือกชั้นปี</option>
                  <option value="1">ปี 1</option>
                  <option value="2">ปี 2</option>
                  <option value="3">ปี 3</option>
                  <option value="4">ปี 4</option>
                </select>
              </label>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="min-w-0 grid gap-2 text-sm font-bold text-[#3a3218]">
                คณะ
                <select
                  value={form.faculty}
                  onChange={(event) => updateField("faculty", event.target.value)}
                  className="h-12 w-full min-w-0 truncate rounded-2xl border border-[#e5d48d] bg-white px-4 text-sm font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25 cursor-pointer"
                >
                  <option value="">เลือกคณะ</option>
                  {MSU_FACULTIES.map((fac) => (
                    <option key={fac.name} value={fac.name}>
                      {fac.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 grid gap-2 text-sm font-bold text-[#3a3218]">
                สาขา
                <select
                  value={form.major}
                  disabled={!form.faculty}
                  onChange={(event) => updateField("major", event.target.value)}
                  className="h-12 w-full min-w-0 truncate rounded-2xl border border-[#e5d48d] bg-white px-4 text-sm font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25 disabled:bg-gray-100 disabled:cursor-not-allowed cursor-pointer"
                >
                  <option value="">
                    {form.faculty ? "เลือกสาขา" : "กรุณาเลือกคณะก่อน"}
                  </option>
                  {availableMajors.map((major) => (
                    <option key={major} value={major}>
                      {major}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
              <div className="flex justify-between">
                <span>ลักษณะนิสัย</span>
                <span className="text-xs font-normal text-[#5f5a48]">
                  {form.personality.length}/100
                </span>
              </div>
              <textarea
                value={form.personality}
                maxLength={100}
                onChange={(event) => updateField("personality", event.target.value)}
                className="min-h-28 resize-none rounded-2xl border border-[#e5d48d] bg-white px-4 py-3 text-base font-medium leading-7 outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25"
                placeholder="เช่น คุยง่าย ตรงเวลา ชอบแบ่งงานชัดเจน"
              />
            </label>

            {errorMessage ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {errorMessage === DOMAIN_ERROR ? DOMAIN_ERROR : errorMessage}
              </p>
            ) : null}

            {successMessage ? (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                {successMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={!isFormValid || isSaving}
              className="h-14 rounded-full bg-[#171717] px-6 text-base font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px] hover:bg-[#2b2b2b] focus:outline-none focus:ring-4 focus:ring-[#FFCD22]/45 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isSaving ? "กำลังบันทึกโปรไฟล์..." : "บันทึกโปรไฟล์"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
