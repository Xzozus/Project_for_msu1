"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { isMsuEmail } from "@/lib/auth";
import { getAvatarById } from "@/lib/avatars";
import { COURSES, findCourseByCode, type Course } from "@/lib/courses";
import { auth, db } from "@/lib/firebase";

type SavedFilter = {
  courseCode: string;
  courseName: string;
  section: string;
};

type UserProfile = {
  uid: string;
  studentId: string;
  email: string;
  nickname: string;
  year: number;
  faculty: string;
  major: string;
  personality: string;
  avatarId: string;
  savedFilters: SavedFilter[];
  boostCount?: number;
  lastBoostDate?: string;
};

type Listing = {
  id: string;
  uid: string;
  courseCode: string;
  courseName: string;
  section: string;
  note?: string;
  nickname: string;
  year: number;
  faculty: string;
  major: string;
  personality: string;
  avatarId: string;
  createdAt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  boostedAt?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type GroupPost = {
  id: string;
  uid: string;
  courseCode: string;
  courseName: string;
  section: string;
  mode: "need_members" | "need_group";
  description: string;
  spotsNeeded: number | null;
  nickname: string;
  year: number;
  faculty: string;
  major: string;
  avatarId: string;
  createdAt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  boostedAt?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type ChatRequest = {
  id: string;
  fromUid: string;
  toUid: string;
  sourceType: "listing" | "groupPost";
  sourceId: string;
  status: "pending" | "accepted" | "rejected";
  chatId: string | null;
  createdAt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  expireAt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type ChatSession = {
  id: string;
  participants: string[];
  createdAt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  otherUser?: UserProfile;
  lastMessage?: string;
};

function getTodayDateString(): string {
  return new Date().toLocaleDateString("sv-SE"); // Returns YYYY-MM-DD
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Authentication & Profile States
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // User Profile Cache for live syncing posts
  const [userCache, setUserCache] = useState<Record<string, UserProfile>>({});

  // Layout & Navigation State
  const viewParam = searchParams.get("view");
  const chatIdParam = searchParams.get("chatId");

  const activeTab = (viewParam === "inbox" || viewParam === "chats") ? viewParam : "search";
  const activeChatId = viewParam === "chats" ? chatIdParam : null;

  function setActiveTab(tab: "search" | "inbox" | "chats") {
    router.push(`/dashboard?view=${tab}`);
  }

  function setActiveChatId(chatId: string | null) {
    setChatMessages([]);
    if (chatId) {
      router.push(`/dashboard?view=chats&chatId=${chatId}`);
    } else {
      router.push(`/dashboard?view=chats`);
    }
  }

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Search & Inputs State
  const [searchTab, setSearchTab] = useState<"classmate" | "group">("classmate");
  const [courseCodeInput, setCourseCodeInput] = useState("");
  const [courseName, setCourseName] = useState("");
  const [courseError, setCourseError] = useState("");
  const [sectionInput, setSectionInput] = useState("");
  const [classmateNote, setClassmateNote] = useState("");
  const [showCourseSuggestions, setShowCourseSuggestions] = useState(false);

  // Group specific inputs
  const [groupMode, setGroupMode] = useState<"need_members" | "need_group">("need_members");
  const [groupDescription, setGroupDescription] = useState("");
  const [spotsNeeded, setSpotsNeeded] = useState("1");

  // Search Results
  const [listings, setListings] = useState<Listing[]>([]);
  const [groupPosts, setGroupPosts] = useState<GroupPost[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchedCourse, setSearchedCourse] = useState<{ code: string; section: string } | null>(null);

  // Requests and Messaging States
  const [incomingRequests, setIncomingRequests] = useState<(ChatRequest & { senderProfile?: UserProfile; courseDetails?: string })[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Record<string, ChatRequest>>({});
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessageText, setNewMessageText] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Boost Modal State
  const [boostTarget, setBoostTarget] = useState<{ type: "classmate" | "group"; item: Listing | GroupPost } | null>(null);
  const [boostText, setBoostText] = useState("");
  const [isBoosting, setIsBoosting] = useState(false);

  // Rate Limiting Refs
  const lastButtonClickTime = useRef<number>(0);
  const buttonCooldownEnd = useRef<number>(0);
  const lastChatMsgTime = useRef<number>(0);
  const chatCooldownEnd = useRef<number>(0);

  // UI Toast Message
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  function showToast(text: string, type: "success" | "error") {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  }

  // General Button Rate Limit Check (1 click / 0.5 sec, 2 sec cooldown on spam)
  function checkButtonRateLimit(): boolean {
    const now = Date.now();
    if (now < buttonCooldownEnd.current) {
      const secondsLeft = Math.ceil((buttonCooldownEnd.current - now) / 1000);
      showToast(`กดปุ่มรัวเกินไป กรุณารอ ${secondsLeft} วินาทีก่อนลองใหม่`, "error");
      return false;
    }

    if (now - lastButtonClickTime.current < 500) {
      buttonCooldownEnd.current = now + 2000;
      showToast("กดปุ่มรัวเกินไป กรุณารอ 2 วินาทีก่อนลองใหม่", "error");
      return false;
    }

    lastButtonClickTime.current = now;
    return true;
  }

  // Render Avatar circle
  function renderAvatar(avatarId: string, sizeClass = "size-10", labelSize = "text-xs") {
    const avatar = getAvatarById(avatarId);
    return (
      <div className={`relative flex items-center justify-center overflow-hidden rounded-full border-2 border-white shadow-[0_4px_10px_rgba(0,0,0,0.1)] font-black text-[#171717] select-none ${sizeClass} ${avatar.color} ${labelSize}`}>
        <img
          src={avatar.src}
          alt={avatar.label}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <span className="absolute">{avatar.label}</span>
      </div>
    );
  }

  // Fetch Course Suggestions
  const courseSuggestions = useMemo(() => {
    if (!courseCodeInput.trim()) return [];
    const queryStr = courseCodeInput.trim().toLowerCase();
    return COURSES.filter(
      (course) =>
        course.code.includes(queryStr) ||
        course.name.toLowerCase().includes(queryStr)
    ).slice(0, 5);
  }, [courseCodeInput]);

  // Auth Observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.replace("/login");
        return;
      }

      if (!isMsuEmail(firebaseUser.email)) {
        await signOut(auth);
        router.replace("/login");
        return;
      }

      setCurrentUser(firebaseUser);

      // Fetch User Profile
      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          router.replace("/profile/setup");
          return;
        }

        const profileData = userSnap.data() as UserProfile;
        setProfile({ ...profileData, uid: firebaseUser.uid });
      } catch (err) {
        console.error("Error fetching profile", err);
        showToast("ไม่สามารถดึงข้อมูลผู้ใช้ได้", "error");
      } finally {
        setIsLoadingAuth(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Real-time listener for Requests sent by the current user
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, "requests"),
      where("fromUid", "==", currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reqMap: Record<string, ChatRequest> = {};
      snapshot.forEach((doc) => {
        const req = doc.data() as ChatRequest;
        reqMap[`${req.fromUid}_${req.toUid}_${req.sourceId}`] = {
          ...req,
          id: doc.id,
        };
      });
      setOutgoingRequests(reqMap);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Real-time listener for Incoming Requests
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, "requests"),
      where("toUid", "==", currentUser.uid),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const reqList: (ChatRequest & { senderProfile?: UserProfile; courseDetails?: string })[] = [];

      for (const d of snapshot.docs) {
        const data = d.data() as ChatRequest;
        const reqObj: ChatRequest & { senderProfile?: UserProfile; courseDetails?: string } = {
          ...data,
          id: d.id,
        };

        // Fetch sender profile
        try {
          const senderSnap = await getDoc(doc(db, "users", data.fromUid));
          if (senderSnap.exists()) {
            reqObj.senderProfile = senderSnap.data() as UserProfile;
          }
        } catch (e) {
          console.error("Failed to load sender profile", e);
        }

        // Try to fetch source details
        try {
          const sourceColl = data.sourceType === "listing" ? "listings" : "groupPosts";
          const sourceSnap = await getDoc(doc(db, sourceColl, data.sourceId));
          if (sourceSnap.exists()) {
            const src = sourceSnap.data();
            reqObj.courseDetails = `${src.courseCode} ${src.courseName} (Sec ${src.section})`;
          } else {
            const parts = data.sourceId.split("_");
            if (parts.length >= 3) {
              const code = parts[1];
              const sec = parts[2];
              const c = findCourseByCode(code);
              reqObj.courseDetails = `${code} ${c ? c.name : ""} (Sec ${sec})`;
            }
          }
        } catch (e) {
          console.error("Failed to load source doc", e);
        }

        reqList.push(reqObj);
      }
      setIncomingRequests(reqList);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Real-time listener for Active Chats
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const chatList: ChatSession[] = [];

      for (const d of snapshot.docs) {
        const chatData = d.data() as ChatSession;
        const chatObj: ChatSession = {
          ...chatData,
          id: d.id,
        };

        const otherUid = chatData.participants.find((uid) => uid !== currentUser.uid);
        if (otherUid) {
          try {
            const otherSnap = await getDoc(doc(db, "users", otherUid));
            if (otherSnap.exists()) {
              chatObj.otherUser = { ...(otherSnap.data() as UserProfile), uid: otherUid };
            }
          } catch (e) {
            console.error("Failed to fetch chat participant info", e);
          }
        }

        chatList.push(chatObj);
      }

      setChats(chatList);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Real-time listener for Chat Messages
  useEffect(() => {
    if (!activeChatId) return;

    const q = query(
      collection(db, "chats", activeChatId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        messages.push({
          ...(doc.data() as ChatMessage),
          id: doc.id,
        });
      });
      setChatMessages(messages);

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    });

    return () => unsubscribe();
  }, [activeChatId]);

  // Helper to fetch live user profile for post author rendering
  async function getLiveUserProfile(uid: string): Promise<UserProfile | null> {
    if (userCache[uid]) return userCache[uid];
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (userSnap.exists()) {
        const uData = { ...(userSnap.data() as UserProfile), uid };
        setUserCache((prev) => ({ ...prev, [uid]: uData }));
        return uData;
      }
    } catch (e) {
      console.error("Error fetching user profile:", e);
    }
    return null;
  }

  // Handle course input typing (ONLY NUMBERS, max 10 chars)
  function handleCourseCodeChange(value: string) {
    const digitsOnly = value.replace(/[^0-9]/g, "").slice(0, 10);
    setCourseCodeInput(digitsOnly);
    setCourseName("");
    setCourseError("");
    setShowCourseSuggestions(true);

    const exactMatch = findCourseByCode(digitsOnly);
    if (exactMatch) {
      setCourseName(exactMatch.name);
      setShowCourseSuggestions(false);
    }
  }

  // Handle section input typing (ONLY NUMBERS, max 2 chars)
  function handleSectionChange(value: string) {
    const digitsOnly = value.replace(/[^0-9]/g, "").slice(0, 2);
    setSectionInput(digitsOnly);
  }

  // Handle course suggestion selection
  function handleSelectCourse(course: Course) {
    setCourseCodeInput(course.code);
    setCourseName(course.name);
    setCourseError("");
    setShowCourseSuggestions(false);
  }

  // Search & Register Submit handler
  async function handleSearchRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!checkButtonRateLimit()) return;
    if (!currentUser || !profile) return;

    const trimmedCode = courseCodeInput.trim();
    const sec = sectionInput.trim();

    if (!trimmedCode) {
      setCourseError("กรุณากรอกรหัสวิชาเป็นตัวเลข (ไม่เกิน 10 หลัก)");
      return;
    }

    const exactMatch = findCourseByCode(trimmedCode);
    if (!exactMatch) {
      setCourseError("ไม่พบวิชาตามรหัสที่ผู้ใช้กรอก");
      return;
    }

    if (!sec) {
      showToast("กรุณาระบุกลุ่มเรียน (Section เป็นตัวเลขไม่เกิน 2 หลัก)", "error");
      return;
    }

    setIsSearching(true);
    setSearchedCourse({ code: trimmedCode, section: sec });

    try {
      // Rule 8 Check: Total posts across user's listings and groupPosts <= 15
      const userListingsQ = query(collection(db, "listings"), where("uid", "==", currentUser.uid));
      const userGroupPostsQ = query(collection(db, "groupPosts"), where("uid", "==", currentUser.uid));

      const [userListingsSnap, userGroupPostsSnap] = await Promise.all([
        getDocs(userListingsQ),
        getDocs(userGroupPostsQ),
      ]);

      const existingPostIds = new Set<string>();
      userListingsSnap.forEach((d) => existingPostIds.add(d.id));
      userGroupPostsSnap.forEach((d) => existingPostIds.add(d.id));

      const targetPostId = searchTab === "classmate"
        ? `${currentUser.uid}_${trimmedCode}_${sec}`
        : `${currentUser.uid}_${trimmedCode}_${sec}_group`;

      if (!existingPostIds.has(targetPostId) && existingPostIds.size >= 15) {
        showToast("คุณไม่สามารถสร้างโพสต์หาเพื่อนและหากลุ่มเรียนเกิน 15 วิชาได้", "error");
        setIsSearching(false);
        return;
      }

      // Update saved filters in user profile
      const filterExists = profile.savedFilters.some(
        (f) => f.courseCode === trimmedCode && f.section === sec
      );

      const updatedFilters = [...profile.savedFilters];
      if (!filterExists) {
        updatedFilters.push({
          courseCode: trimmedCode,
          courseName: exactMatch.name,
          section: sec,
        });
        await updateDoc(doc(db, "users", currentUser.uid), {
          savedFilters: updatedFilters,
        });
        setProfile({ ...profile, savedFilters: updatedFilters });
      }

      if (searchTab === "classmate") {
        const listingId = `${currentUser.uid}_${trimmedCode}_${sec}`;
        await setDoc(
          doc(db, "listings", listingId),
          {
            uid: currentUser.uid,
            courseCode: trimmedCode,
            courseName: exactMatch.name,
            section: sec,
            note: classmateNote.trim().slice(0, 100),
            nickname: profile.nickname,
            year: profile.year,
            faculty: profile.faculty,
            major: profile.major,
            personality: profile.personality,
            avatarId: profile.avatarId,
            createdAt: serverTimestamp(),
            boostedAt: serverTimestamp(),
          },
          { merge: true }
        );

        // Fetch matching listings
        await fetchListingsForCourse(trimmedCode, sec);
        showToast("ลงทะเบียนและค้นหาเพื่อนร่วมวิชาสำเร็จ!", "success");
      } else {
        if (groupMode === "need_members" && (!spotsNeeded || Number(spotsNeeded) <= 0)) {
          showToast("กรุณาระบุจำนวนคนที่ต้องการให้ถูกต้อง", "error");
          setIsSearching(false);
          return;
        }

        if (!groupDescription.trim()) {
          showToast("กรุณากรอกรายละเอียดประกอบประกาศ", "error");
          setIsSearching(false);
          return;
        }

        if (groupDescription.trim().length > 100) {
          showToast("ข้อความรายละเอียดต้องไม่เกิน 100 ตัวอักษร", "error");
          setIsSearching(false);
          return;
        }

        const postId = `${currentUser.uid}_${trimmedCode}_${sec}_group`;
        await setDoc(
          doc(db, "groupPosts", postId),
          {
            uid: currentUser.uid,
            courseCode: trimmedCode,
            courseName: exactMatch.name,
            section: sec,
            mode: groupMode,
            description: groupDescription.trim().slice(0, 100),
            spotsNeeded: groupMode === "need_members" ? Number(spotsNeeded) : null,
            nickname: profile.nickname,
            year: profile.year,
            faculty: profile.faculty,
            major: profile.major,
            avatarId: profile.avatarId,
            createdAt: serverTimestamp(),
            boostedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await fetchGroupPostsForCourse(trimmedCode, sec);
        showToast("ลงประกาศกลุ่มเรียนสำเร็จ!", "success");
      }
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการดำเนินการ", "error");
    } finally {
      setIsSearching(false);
    }
  }

  // Fetch Listings for Course & Section
  async function fetchListingsForCourse(code: string, sec: string) {
    const q = query(
      collection(db, "listings"),
      where("courseCode", "==", code),
      where("section", "==", sec)
    );
    const querySnap = await getDocs(q);
    const results: Listing[] = [];
    querySnap.forEach((docSnap) => {
      results.push({ ...(docSnap.data() as Listing), id: docSnap.id });
    });

    // Sort by boostedAt desc, createdAt desc
    results.sort((a, b) => {
      const timeA = a.boostedAt?.toMillis ? a.boostedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
      const timeB = b.boostedAt?.toMillis ? b.boostedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
      return timeB - timeA;
    });

    setListings(results);

    // Hydrate user cache for live profiles
    for (const item of results) {
      getLiveUserProfile(item.uid);
    }
  }

  // Fetch Group Posts for Course & Section
  async function fetchGroupPostsForCourse(code: string, sec: string) {
    const q = query(
      collection(db, "groupPosts"),
      where("courseCode", "==", code),
      where("section", "==", sec)
    );
    const querySnap = await getDocs(q);
    const results: GroupPost[] = [];
    querySnap.forEach((docSnap) => {
      results.push({ ...(docSnap.data() as GroupPost), id: docSnap.id });
    });

    // Sort by boostedAt desc, createdAt desc
    results.sort((a, b) => {
      const timeA = a.boostedAt?.toMillis ? a.boostedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
      const timeB = b.boostedAt?.toMillis ? b.boostedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
      return timeB - timeA;
    });

    setGroupPosts(results);

    for (const item of results) {
      getLiveUserProfile(item.uid);
    }
  }

  // Saved Filter click execution
  async function handleExecuteSavedFilter(filter: SavedFilter) {
    if (!checkButtonRateLimit()) return;
    setCourseCodeInput(filter.courseCode);
    setCourseName(filter.courseName);
    setSectionInput(filter.section);
    setCourseError("");
    setMobileMenuOpen(false);

    setIsSearching(true);
    setSearchedCourse({ code: filter.courseCode, section: filter.section });

    try {
      if (searchTab === "classmate") {
        await fetchListingsForCourse(filter.courseCode, filter.section);
      } else {
        await fetchGroupPostsForCourse(filter.courseCode, filter.section);
      }
    } catch (err) {
      console.error(err);
      showToast("ค้นหาล้มเหลว", "error");
    } finally {
      setIsSearching(false);
    }
  }

  // Send Request action handler (Prevent self-requests & check rate limits)
  async function handleSendRequest(targetUid: string, sourceId: string) {
    if (!checkButtonRateLimit()) return;
    if (!currentUser) return;

    if (targetUid === currentUser.uid) {
      showToast("คุณไม่สามารถส่งคำขอหาตัวเองได้", "error");
      return;
    }

    const requestId = `${currentUser.uid}_${targetUid}_${sourceId}`;

    try {
      const reqRef = doc(db, "requests", requestId);
      const reqSnap = await getDoc(reqRef);

      if (reqSnap.exists()) {
        const currentStatus = reqSnap.data().status;
        if (currentStatus === "pending") {
          showToast("ส่งคำขอแล้วและกำลังรอการตอบกลับ", "error");
          return;
        }
      }

      await setDoc(reqRef, {
        fromUid: currentUser.uid,
        toUid: targetUid,
        sourceType: searchTab === "classmate" ? "listing" : "groupPost",
        sourceId: sourceId,
        status: "pending",
        chatId: null,
        createdAt: serverTimestamp(),
      });

      showToast("ส่งคำขอคุยด้วยแล้ว!", "success");
    } catch (e) {
      console.error("Error sending request", e);
      showToast("ไม่สามารถส่งคำขอได้", "error");
    }
  }

  // Open Boost Post Modal
  function handleOpenBoostModal(type: "classmate" | "group", item: Listing | GroupPost) {
    if (!checkButtonRateLimit()) return;
    setBoostTarget({ type, item });
    setBoostText(type === "classmate" ? (item as Listing).note || "" : (item as GroupPost).description || "");
  }

  // Confirm Post Boost Execution
  async function handleConfirmBoost() {
    if (!checkButtonRateLimit()) return;
    if (!currentUser || !boostTarget || !profile) return;

    const todayStr = getTodayDateString();
    const currentBoostCount = profile.lastBoostDate === todayStr ? (profile.boostCount || 0) : 0;

    if (currentBoostCount >= 15) {
      showToast("ผู้ใช้ไม่สามารถดันโพสต์เกิน 15 ครั้งต่อวัน", "error");
      return;
    }

    if (boostText.trim().length > 100) {
      showToast("ข้อความต้องไม่เกิน 100 ตัวอักษร", "error");
      return;
    }

    setIsBoosting(true);

    try {
      const newBoostCount = currentBoostCount + 1;

      // Update user profile boost count
      await updateDoc(doc(db, "users", currentUser.uid), {
        boostCount: newBoostCount,
        lastBoostDate: todayStr,
      });

      setProfile({
        ...profile,
        boostCount: newBoostCount,
        lastBoostDate: todayStr,
      });

      // Update target post timestamp and description
      const collectionName = boostTarget.type === "classmate" ? "listings" : "groupPosts";
      const postRef = doc(db, collectionName, boostTarget.item.id);

      if (boostTarget.type === "classmate") {
        await updateDoc(postRef, {
          note: boostText.trim().slice(0, 100),
          boostedAt: serverTimestamp(),
        });
        if (searchedCourse) {
          await fetchListingsForCourse(searchedCourse.code, searchedCourse.section);
        }
      } else {
        await updateDoc(postRef, {
          description: boostText.trim().slice(0, 100),
          boostedAt: serverTimestamp(),
        });
        if (searchedCourse) {
          await fetchGroupPostsForCourse(searchedCourse.code, searchedCourse.section);
        }
      }

      showToast(`ดันโพสต์สำเร็จ! (ใช้สิทธิ์ไป ${newBoostCount}/15 ครั้งในวันนี้)`, "success");
      setBoostTarget(null);
    } catch (e) {
      console.error("Boost post error:", e);
      showToast("ดันโพสต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsBoosting(false);
    }
  }

  // Accept Request handler
  async function handleAcceptRequest(request: ChatRequest) {
    if (!checkButtonRateLimit()) return;
    if (!currentUser) return;

    try {
      const participants = [currentUser.uid, request.fromUid].sort();
      const chatId = `chat_${participants.join("_")}`;

      await setDoc(doc(db, "chats", chatId), {
        participants,
        createdAt: serverTimestamp(),
      }, { merge: true });

      await updateDoc(doc(db, "requests", request.id), {
        status: "accepted",
        chatId: chatId,
      });

      showToast("ตอบรับคำขอคุยด้วยแล้ว เริ่มต้นคุยได้เลย!", "success");
      setActiveChatId(chatId);
      setActiveTab("chats");
    } catch (e) {
      console.error(e);
      showToast("เกิดข้อผิดพลาดในการตอบรับคำขอ", "error");
    }
  }

  // Reject Request handler
  async function handleRejectRequest(requestId: string) {
    if (!checkButtonRateLimit()) return;
    try {
      await updateDoc(doc(db, "requests", requestId), {
        status: "rejected",
      });
      showToast("ปฏิเสธคำขอเรียบร้อยแล้ว", "success");
    } catch (e) {
      console.error(e);
      showToast("เกิดข้อผิดพลาดในการปฏิเสธคำขอ", "error");
    }
  }

  // Send message handler (Rate limit 1 msg/0.5 sec, 2s cooldown on spam, max 1000 chars)
  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !activeChatId || !newMessageText.trim() || isSendingMessage) return;

    const now = Date.now();

    // Check cooldown
    if (now < chatCooldownEnd.current) {
      const secondsLeft = Math.ceil((chatCooldownEnd.current - now) / 1000);
      showToast(`ส่งรัวเกินไป! กรุณารอ ${secondsLeft} วินาทีก่อนส่งข้อความอีกครั้ง`, "error");
      return;
    }

    // Check 0.5 sec rate limit
    if (now - lastChatMsgTime.current < 500) {
      chatCooldownEnd.current = now + 2000;
      showToast("ส่งรัวเกินไป! กรุณารอ 2 วินาทีก่อนส่งข้อความอีกครั้ง", "error");
      return;
    }

    lastChatMsgTime.current = now;

    if (newMessageText.trim().length > 1000) {
      showToast("ความยาวข้อความต้องไม่เกิน 1000 ตัวอักษร", "error");
      return;
    }

    setIsSendingMessage(true);

    try {
      const expireAtDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const msgRef = doc(collection(db, "chats", activeChatId, "messages"));
      await setDoc(msgRef, {
        senderId: currentUser.uid,
        text: newMessageText.trim().slice(0, 1000),
        createdAt: serverTimestamp(),
        expireAt: expireAtDate,
      });

      setNewMessageText("");
    } catch (e) {
      console.error("Failed to send message", e);
      showToast("ส่งข้อความไม่สำเร็จ", "error");
    } finally {
      setIsSendingMessage(false);
    }
  }

  // Logout handler
  async function handleSignOut() {
    if (!checkButtonRateLimit()) return;
    await signOut(auth);
    router.replace("/login");
  }

  if (isLoadingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff8db] px-5 text-[#171717]">
        <div className="rounded-[28px] border border-[#f2e7b5] bg-white px-8 py-6 text-sm font-semibold text-[#7a650e] shadow-[0_18px_50px_rgba(90,72,13,0.12)] animate-pulse">
          กำลังดาวน์โหลดข้อมูลโปรเจกต์...
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen bg-[#fffdf5] text-[#171717]">
      {/* Toast Alert */}
      {toastMessage && (
        <div className={`fixed right-5 top-5 z-50 rounded-2xl px-6 py-4 text-sm font-semibold shadow-[0_12px_32px_rgba(0,0,0,0.15)] border transition-all duration-300 transform translate-y-0 ${toastMessage.type === "success"
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-rose-50 border-rose-200 text-rose-800"
          }`}>
          {toastMessage.text}
        </div>
      )}

      {/* Boost Post Modal */}
      {boostTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-[#f2e7b5] bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#f2e7b5] pb-3">
              <h3 className="text-xl font-bold text-[#171717]">
                🚀 ดันโพสต์เดิมขึ้นด้านบน
              </h3>
              <button
                onClick={() => setBoostTarget(null)}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[#5f5a48] leading-relaxed">
              คุณสามารถแก้ไข/เติมแต่งข้อความเดิมก่อนกดดันโพสต์ได้ โพสต์ของคุณจะถูกดันขึ้นไปแสดงอยู่อันดับบนสุดทันที (จำกัด 15 ครั้ง/วัน)
            </p>

            <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
              <div className="flex justify-between">
                <span>ข้อความในโพสต์</span>
                <span className="text-xs font-normal text-[#5f5a48]">
                  {boostText.length}/100
                </span>
              </div>
              <textarea
                value={boostText}
                maxLength={100}
                onChange={(e) => setBoostText(e.target.value)}
                className="min-h-24 resize-none rounded-2xl border border-[#e5d48d] bg-[#fffdf9] p-3 text-sm outline-none focus:border-[#FFCD22]"
                placeholder="กรอกข้อความปรับแต่ง..."
              />
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBoostTarget(null)}
                className="h-11 rounded-full border border-gray-300 bg-white px-5 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isBoosting}
                onClick={handleConfirmBoost}
                className="h-11 rounded-full bg-[#FFCD22] px-6 text-sm font-bold text-[#221b00] shadow-[0_4px_14px_rgba(255,205,34,0.3)] hover:bg-[#ebd034] disabled:opacity-50"
              >
                {isBoosting ? "กำลังดันโพสต์..." : "🚀 ยืนยันดันโพสต์"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Drawer Sidebar */}
      <nav className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-white border-r border-[#f2e7b5] p-6 shadow-xl transition-transform duration-300 md:relative md:translate-x-0 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:flex flex-col justify-between"
        }`}>
        <div className="flex h-full flex-col justify-between">
          <div className="space-y-8">
            {/* Header / Logo */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#9b7a00]">MSU COURSE MATCH</span>
                <h1 className="text-xl font-black text-[#171717] mt-1">ห้องจัดคู่เรียนและกลุ่ม</h1>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-full p-2 bg-[#fffdf5] text-[#171717] hover:bg-[#fff8db] md:hidden"
              >
                ✕
              </button>
            </div>

            {/* Profile Info */}
            {profile && (
              <div className="flex items-center gap-3 rounded-2xl bg-[#fff8db]/60 border border-[#f2e7b5] p-3">
                {renderAvatar(profile.avatarId, "size-12", "text-sm")}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold">{profile.nickname}</p>
                  <p className="truncate text-xs text-[#5f5a48]">ปี {profile.year} - {profile.major}</p>
                  <p className="text-[10px] font-bold text-[#9b7a00] uppercase mt-0.5">ID: {profile.studentId}</p>
                </div>
              </div>
            )}

            {/* Nav Menu */}
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => { if (checkButtonRateLimit()) { setActiveTab("search"); setMobileMenuOpen(false); } }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition ${activeTab === "search"
                    ? "bg-[#FFCD22] text-[#221b00] shadow-[0_8px_20px_rgba(255,205,34,0.3)]"
                    : "text-[#5f5a48] hover:bg-[#fff8db]/50 hover:text-[#171717]"
                    }`}
                >
                  ค้นหาเพื่อน / จัดกลุ่ม
                </button>
              </li>
              <li>
                <button
                  onClick={() => { if (checkButtonRateLimit()) { setActiveTab("inbox"); setMobileMenuOpen(false); } }}
                  className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${activeTab === "inbox"
                    ? "bg-[#FFCD22] text-[#221b00] shadow-[0_8px_20px_rgba(255,205,34,0.3)]"
                    : "text-[#5f5a48] hover:bg-[#fff8db]/50 hover:text-[#171717]"
                    }`}
                >
                  <span className="flex items-center gap-3">กล่องคำขอ</span>
                  {incomingRequests.length > 0 && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                      {incomingRequests.length}
                    </span>
                  )}
                </button>
              </li>
              <li>
                <button
                  onClick={() => { if (checkButtonRateLimit()) { setActiveTab("chats"); setMobileMenuOpen(false); } }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition ${activeTab === "chats"
                    ? "bg-[#FFCD22] text-[#221b00] shadow-[0_8px_20px_rgba(255,205,34,0.3)]"
                    : "text-[#5f5a48] hover:bg-[#fff8db]/50 hover:text-[#171717]"
                    }`}
                >
                  ห้องแชทส่วนตัว ({chats.length})
                </button>
              </li>
              <li>
                <button
                  onClick={() => { if (checkButtonRateLimit()) router.push("/profile/setup"); }}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-[#5f5a48] hover:bg-[#fff8db]/50 hover:text-[#171717] transition"
                >
                  แก้ไขโปรไฟล์
                </button>
              </li>
            </ul>

            {/* Saved Filters */}
            {profile && profile.savedFilters && profile.savedFilters.length > 0 && (
              <div className="pt-4 border-t border-[#f2e7b5]">
                <p className="text-xs font-bold text-[#9b7a00] uppercase px-4 mb-2">วิชาที่เคยค้นหา</p>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {profile.savedFilters.map((filter, index) => (
                    <button
                      key={index}
                      onClick={() => handleExecuteSavedFilter(filter)}
                      className="flex w-full flex-col text-left rounded-xl px-4 py-2 hover:bg-[#fff8db]/50 transition border border-transparent hover:border-[#f2e7b5]"
                    >
                      <span className="text-sm font-bold truncate text-[#171717]">{filter.courseCode}</span>
                      <span className="text-xs text-[#5f5a48] truncate">{filter.courseName} (Sec {filter.section})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-6 border-t border-[#f2e7b5]">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-[#e5d48d] bg-white h-11 text-sm font-bold text-[#5f4a00] shadow-[0_6px_15px_rgba(90,72,13,0.06)] hover:bg-[#fff8db] transition"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </nav>

      {/* Main Workspace container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Mobile Header bar */}
        <header className="flex items-center justify-between border-b border-[#f2e7b5] bg-white px-5 py-4 md:hidden">
          <h2 className="text-lg font-bold text-[#171717]">MSU Course Match</h2>
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-full bg-[#FFCD22] p-2 font-bold text-[#221b00] shadow"
          >
            ☰ เมนู
          </button>
        </header>

        {/* Dynamic Inner views */}
        <div className="flex-1 p-5 md:p-8 overflow-y-auto">
          {/* SEARCH & REGISTER VIEW */}
          {activeTab === "search" && (
            <div className="mx-auto max-w-5xl space-y-6">
              {/* Form card wrapper */}
              <div className="rounded-[28px] border border-[#f2e7b5] bg-white p-6 shadow-[0_15px_45px_rgba(90,72,13,0.06)]">
                {/* Search tab switcher */}
                <div className="flex rounded-2xl bg-[#fffdf5] border border-[#f2e7b5] p-1.5 max-w-md">
                  <button
                    onClick={() => { if (checkButtonRateLimit()) setSearchTab("classmate"); }}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${searchTab === "classmate"
                      ? "bg-[#FFCD22] text-[#221b00] shadow"
                      : "text-[#5f5a48] hover:text-[#171717]"
                      }`}
                  >
                    หาเพื่อนเรียนร่วมวิชา
                  </button>
                  <button
                    onClick={() => { if (checkButtonRateLimit()) setSearchTab("group"); }}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${searchTab === "group"
                      ? "bg-[#FFCD22] text-[#221b00] shadow"
                      : "text-[#5f5a48] hover:text-[#171717]"
                      }`}
                  >
                    หาเพื่อนร่วมกลุ่ม (GE)
                  </button>
                </div>

                {/* Form starts */}
                <form onSubmit={handleSearchRegister} className="mt-6 space-y-5">
                  {/* Course Search Box */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="relative">
                      <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
                        <div className="flex justify-between">
                          <span>รหัสวิชา</span>
                          <span className="text-xs font-normal text-[#5f5a48]">
                            {courseCodeInput.length}/10
                          </span>
                        </div>
                        <input
                          type="text"
                          value={courseCodeInput}
                          maxLength={10}
                          onChange={(e) => handleCourseCodeChange(e.target.value)}
                          onFocus={() => setShowCourseSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowCourseSuggestions(false), 200)}
                          className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25"
                          placeholder="เช่น 0041001"
                        />
                      </label>

                      {/* Autocomplete Dropdown list */}
                      {showCourseSuggestions && courseSuggestions.length > 0 && (
                        <ul className="absolute z-20 mt-1 w-full rounded-2xl border border-[#e5d48d] bg-white p-2 shadow-2xl">
                          {courseSuggestions.map((course) => (
                            <li key={course.code}>
                              <button
                                type="button"
                                onMouseDown={() => handleSelectCourse(course)}
                                className="w-full text-left rounded-xl px-4 py-2 text-sm hover:bg-[#fff8db] transition font-medium"
                              >
                                <span className="font-bold text-[#9b7a00] mr-2">{course.code}</span>
                                {course.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {courseName && (
                        <p className="mt-2 text-xs font-bold text-emerald-600">
                          ✓ เลือกวิชา: {courseName}
                        </p>
                      )}
                      {courseError && (
                        <p className="mt-2 text-xs font-bold text-rose-500">
                          ⚠ {courseError}
                        </p>
                      )}
                    </div>

                    <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
                      <div className="flex justify-between">
                        <span>กลุ่มเรียน / Section</span>
                        <span className="text-xs font-normal text-[#5f5a48]">
                          {sectionInput.length}/2
                        </span>
                      </div>
                      <input
                        type="text"
                        value={sectionInput}
                        maxLength={2}
                        onChange={(e) => handleSectionChange(e.target.value)}
                        className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25"
                        placeholder="เช่น 1 หรือ 12"
                      />
                    </label>
                  </div>

                  {/* Classmate Mode Specific Note Field */}
                  {searchTab === "classmate" && (
                    <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
                      <div className="flex justify-between">
                        <span>ข้อความทิ้งไว้ถึงเพื่อนร่วมวิชา (ไม่เกิน 100 ตัวอักษร)</span>
                        <span className="text-xs font-normal text-[#5f5a48]">
                          {classmateNote.length}/100
                        </span>
                      </div>
                      <input
                        type="text"
                        value={classmateNote}
                        maxLength={100}
                        onChange={(e) => setClassmateNote(e.target.value)}
                        className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22] focus:ring-4 focus:ring-[#FFCD22]/25"
                        placeholder="เช่น หาเพื่อนช่วยเรียน ทบทวนบทเรียน หรือนั่งเรียนด้วยกันครับ"
                      />
                    </label>
                  )}

                  {/* Group Mode parameters */}
                  {searchTab === "group" && (
                    <div className="space-y-4 rounded-2xl bg-[#fffdf5] border border-[#f2e7b5] p-4">
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm font-bold text-[#3a3218]">
                          <input
                            type="radio"
                            checked={groupMode === "need_members"}
                            onChange={() => setGroupMode("need_members")}
                            className="accent-[#FFCD22]"
                          />
                          หาคนเข้ากลุ่ม (Need members)
                        </label>
                        <label className="flex items-center gap-2 text-sm font-bold text-[#3a3218]">
                          <input
                            type="radio"
                            checked={groupMode === "need_group"}
                            onChange={() => setGroupMode("need_group")}
                            className="accent-[#FFCD22]"
                          />
                          หาลงกลุ่ม (Need group)
                        </label>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        {groupMode === "need_members" && (
                          <label className="grid gap-2 text-sm font-bold text-[#3a3218]">
                            จำนวนคนที่ต้องการเพิ่ม
                            <input
                              type="number"
                              min="1"
                              value={spotsNeeded}
                              onChange={(e) => setSpotsNeeded(e.target.value)}
                              className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22]"
                            />
                          </label>
                        )}
                        <label className={`grid gap-2 text-sm font-bold text-[#3a3218] ${groupMode === "need_group" ? "sm:col-span-2" : ""}`}>
                          <div className="flex justify-between">
                            <span>รายละเอียด (ทักษะที่เสนอ / หน้าที่ต้องการ)</span>
                            <span className="text-xs font-normal text-[#5f5a48]">
                              {groupDescription.length}/100
                            </span>
                          </div>
                          <input
                            type="text"
                            value={groupDescription}
                            maxLength={100}
                            onChange={(e) => setGroupDescription(e.target.value)}
                            className="h-12 rounded-2xl border border-[#e5d48d] bg-white px-4 text-base font-medium outline-none transition focus:border-[#FFCD22]"
                            placeholder={
                              groupMode === "need_members"
                                ? "เช่น ต้องการคนทำสไลด์และพรีเซนต์ 1 คน"
                                : "เช่น ถนัดโค้ด เขียนสรุปงาน ทำฟอนต์ได้หมดครับ"
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Search Button */}
                  <button
                    type="submit"
                    disabled={isSearching || !courseCodeInput.trim() || !sectionInput.trim()}
                    className="h-13 w-full rounded-full bg-[#171717] text-white font-bold shadow-[0_8px_25px_rgba(0,0,0,0.15)] hover:bg-[#2b2b2b] transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSearching ? "กำลังทำงาน..." : "ค้นหา และลงทะเบียนวิชานี้"}
                  </button>
                </form>
              </div>

              {/* Listings Result list section */}
              {searchedCourse && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="text-lg font-black text-[#171717]">
                      ผลการค้นหา: {searchedCourse.code} (Sec {searchedCourse.section})
                    </h3>
                    <span className="text-sm font-semibold text-[#5f5a48]">
                      พบ {searchTab === "classmate" ? listings.length : groupPosts.length} รายการ
                    </span>
                  </div>

                  {searchTab === "classmate" ? (
                    listings.length > 0 ? (
                      <div className="grid gap-5 md:grid-cols-2">
                        {listings.map((item) => {
                          const liveUser = userCache[item.uid] || item;
                          const isOwnPost = item.uid === currentUser?.uid;
                          const reqId = `${currentUser?.uid}_${item.uid}_${item.id}`;
                          const existingReq = outgoingRequests[reqId];
                          const isPending = existingReq?.status === "pending";
                          const isAccepted = existingReq?.status === "accepted";

                          return (
                            <div key={item.id} className="rounded-3xl border border-[#f2e7b5] bg-white p-5 shadow-[0_12px_32px_rgba(90,72,13,0.04)] flex flex-col justify-between gap-4">
                              <div className="space-y-3">
                                {/* Header */}
                                <div className="flex items-center gap-3">
                                  {renderAvatar(liveUser.avatarId, "size-11", "text-xs")}
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-lg leading-tight">{liveUser.nickname}</h4>
                                      {isOwnPost && (
                                        <span className="rounded-full bg-[#FFCD22]/30 px-2 py-0.5 text-[10px] font-bold text-[#5f4a00]">
                                          คุณ (เจ้าของโพสต์)
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-[#5f5a48]">ปี {liveUser.year} - คณะ{liveUser.faculty} สาขา{liveUser.major}</p>
                                  </div>
                                </div>
                                <hr className="border-[#f2e7b5]" />
                                {/* Detailed attributes */}
                                <div className="space-y-2 text-sm leading-relaxed text-[#171717]">
                                  {item.note ? (
                                    <p className="bg-[#fffdf5] border border-[#f2e7b5] p-3 rounded-2xl italic">
                                      &quot;{item.note}&quot;
                                    </p>
                                  ) : null}
                                  <p><strong>ลักษณะนิสัย:</strong> {liveUser.personality}</p>
                                </div>
                              </div>

                              {/* Button interaction */}
                              {isOwnPost ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenBoostModal("classmate", item)}
                                  className="h-11 w-full rounded-full bg-[#FFCD22] text-[#221b00] font-bold shadow-[0_6px_15px_rgba(255,205,34,0.25)] transition hover:translate-y-[-1px] active:translate-y-0 flex items-center justify-center gap-2"
                                >
                                  ดันโพสต์ / แก้ไขข้อความ
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSendRequest(item.uid, item.id)}
                                  disabled={isPending || isAccepted}
                                  className={`h-11 w-full rounded-full font-bold transition flex items-center justify-center gap-2 ${isAccepted
                                    ? "bg-emerald-100 text-emerald-800 cursor-default"
                                    : isPending
                                      ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-default"
                                      : "bg-[#FFCD22] text-[#221b00] shadow-[0_6px_15px_rgba(255,205,34,0.25)] hover:translate-y-[-1px] active:translate-y-0"
                                    }`}
                                >
                                  {isAccepted ? "✓ เชื่อมต่อกันแล้ว" : isPending ? "⏳ รอการตอบกลับ..." : "👋 ขอร่วมคุย / เรียนด้วย"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-[#f2e7b5] bg-white py-12 text-center text-[#5f5a48] font-bold shadow-[0_12px_32px_rgba(90,72,13,0.04)]">
                        ยังไม่มีเพื่อนลงทะเบียนในเซกชั่นนี้
                      </div>
                    )
                  ) : (
                    groupPosts.length > 0 ? (
                      <div className="grid gap-5 md:grid-cols-2">
                        {groupPosts.map((item) => {
                          const liveUser = userCache[item.uid] || item;
                          const isOwnPost = item.uid === currentUser?.uid;
                          const reqId = `${currentUser?.uid}_${item.uid}_${item.id}`;
                          const existingReq = outgoingRequests[reqId];
                          const isPending = existingReq?.status === "pending";
                          const isAccepted = existingReq?.status === "accepted";

                          return (
                            <div key={item.id} className="rounded-3xl border border-[#f2e7b5] bg-white p-5 shadow-[0_12px_32px_rgba(90,72,13,0.04)] flex flex-col justify-between gap-4">
                              <div className="space-y-3">
                                {/* Header */}
                                <div className="flex items-center gap-3">
                                  {renderAvatar(liveUser.avatarId, "size-11", "text-xs")}
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-lg leading-tight">{liveUser.nickname}</h4>
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.mode === "need_members"
                                        ? "bg-amber-100 text-amber-800 border border-amber-200"
                                        : "bg-blue-100 text-blue-800 border border-blue-200"
                                        }`}>
                                        {item.mode === "need_members" ? `หาคนเพิ่ม (ขาดอีก ${item.spotsNeeded} คน)` : "หาเข้ากลุ่ม"}
                                      </span>
                                      {isOwnPost && (
                                        <span className="rounded-full bg-[#FFCD22]/30 px-2 py-0.5 text-[10px] font-bold text-[#5f4a00]">
                                          คุณ
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-[#5f5a48]">ปี {liveUser.year} - คณะ{liveUser.faculty} สาขา{liveUser.major}</p>
                                  </div>
                                </div>
                                <hr className="border-[#f2e7b5]" />
                                {/* Detailed attributes */}
                                <div className="text-sm bg-[#fffdf5] border border-[#f2e7b5] p-3 rounded-2xl text-[#171717] italic">
                                  &quot;{item.description}&quot;
                                </div>
                              </div>

                              {/* Button interaction */}
                              {isOwnPost ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenBoostModal("group", item)}
                                  className="h-11 w-full rounded-full bg-[#FFCD22] text-[#221b00] font-bold shadow-[0_6px_15px_rgba(255,205,34,0.25)] transition hover:translate-y-[-1px] active:translate-y-0 flex items-center justify-center gap-2"
                                >
                                  ดันโพสต์ / แก้ไขข้อความ
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSendRequest(item.uid, item.id)}
                                  disabled={isPending || isAccepted}
                                  className={`h-11 w-full rounded-full font-bold transition flex items-center justify-center gap-2 ${isAccepted
                                    ? "bg-emerald-100 text-emerald-800 cursor-default"
                                    : isPending
                                      ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-default"
                                      : "bg-[#FFCD22] text-[#221b00] shadow-[0_6px_15px_rgba(255,205,34,0.25)] hover:translate-y-[-1px] active:translate-y-0"
                                    }`}
                                >
                                  {isAccepted ? "✓ เชื่อมต่อกันแล้ว" : isPending ? "⏳ รอการตอบกลับ..." : "🤝 ขอยื่นคำร้องเข้าร่วม"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-[#f2e7b5] bg-white py-12 text-center text-[#5f5a48] font-bold shadow-[0_12px_32px_rgba(90,72,13,0.04)]">
                        ยังไม่มีเพื่อนประกาศหากลุ่มในเซกชั่นนี้
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* INBOX VIEW */}
          {activeTab === "inbox" && (
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="border-b border-[#f2e7b5] pb-4">
                <h3 className="text-2xl font-black">กล่องข้อความคำขอร้องเรียน / กลุ่ม</h3>
                <p className="text-sm text-[#5f5a48] mt-1">จัดการคำขอคุยด้วยจากนิสิตคนอื่นๆ เพื่อเปิดห้องสนทนาแลกเปลี่ยนรายละเอียด</p>
              </div>

              <div className="space-y-4">
                <h4 className="text-lg font-bold text-[#9b7a00]">📥 คำขอเข้าหาคุณ ({incomingRequests.length})</h4>

                {incomingRequests.length > 0 ? (
                  <div className="grid gap-4">
                    {incomingRequests.map((req) => (
                      <div key={req.id} className="rounded-3xl border border-[#f2e7b5] bg-white p-5 shadow-[0_8px_25px_rgba(90,72,13,0.03)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex gap-3 min-w-0">
                          {req.senderProfile && renderAvatar(req.senderProfile.avatarId, "size-12", "text-sm")}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h5 className="font-bold text-base">{req.senderProfile?.nickname ?? "ไม่ทราบชื่อ"}</h5>
                              <span className="text-[10px] bg-[#fff8db] border border-[#e5d48d] px-2 py-0.5 rounded-full font-bold text-[#5f4a00]">
                                {req.sourceType === "listing" ? "หาเพื่อนเรียน" : "หาเพื่อนร่วมกลุ่ม"}
                              </span>
                            </div>
                            <p className="text-xs text-[#5f5a48] truncate">
                              ปี {req.senderProfile?.year} คณะ{req.senderProfile?.faculty} สาขา{req.senderProfile?.major}
                            </p>
                            <p className="text-xs font-bold text-[#171717] mt-1">
                              วิชา: {req.courseDetails ?? "ไม่พบข้อมูลวิชา"}
                            </p>
                          </div>
                        </div>

                        {/* Accept / Reject actions */}
                        <div className="flex gap-2 w-full sm:w-auto">
                          <button
                            onClick={() => handleAcceptRequest(req)}
                            className="flex-1 sm:flex-initial h-10 px-5 rounded-full bg-emerald-500 text-white text-xs font-bold shadow-[0_4px_12px_rgba(16,185,129,0.2)] hover:bg-emerald-600 transition"
                          >
                            ✓ ยอมรับ
                          </button>
                          <button
                            onClick={() => handleRejectRequest(req.id)}
                            className="flex-1 sm:flex-initial h-10 px-5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition"
                          >
                            ✕ ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-[#f2e7b5] bg-white py-10 text-center text-[#5f5a48] font-bold">
                    ไม่มีคำขอเข้าใหม่ในขณะนี้
                  </div>
                )}
              </div>
            </div>
          )}

          {/* REAL-TIME CHAT VIEW */}
          {activeTab === "chats" && (
            <div className="mx-auto max-w-5xl h-[calc(100vh-140px)] md:h-[calc(100vh-100px)] flex border border-[#f2e7b5] rounded-3xl overflow-hidden bg-white shadow-xl">
              {/* Chats side panel */}
              <div className="w-80 border-r border-[#f2e7b5] flex flex-col bg-white">
                <div className="p-4 border-b border-[#f2e7b5] bg-[#fffdf5]">
                  <h4 className="font-black text-lg text-[#171717]">ห้องแชทของคุณ</h4>
                  <p className="text-xs text-[#5f5a48] mt-0.5">ข้อความจะหมดอายุและลบเองใน 24 ชั่วโมง</p>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#fff8db]">
                  {chats.length > 0 ? (
                    chats.map((chat) => {
                      const isActive = chat.id === activeChatId;
                      return (
                        <button
                          key={chat.id}
                          onClick={() => { if (checkButtonRateLimit()) setActiveChatId(chat.id); }}
                          className={`w-full flex items-center gap-3 p-4 text-left transition ${isActive ? "bg-[#fff8db] border-l-4 border-[#FFCD22]" : "hover:bg-[#fffdf5]"
                            }`}
                        >
                          {chat.otherUser && renderAvatar(chat.otherUser.avatarId, "size-11", "text-xs")}
                          <div className="min-w-0 flex-1">
                            <h5 className="font-bold text-sm truncate text-[#171717]">
                              {chat.otherUser?.nickname ?? "ห้องสนทนา"}
                            </h5>
                            <p className="text-xs text-[#5f5a48] truncate mt-0.5">
                              คณะ{chat.otherUser?.faculty ?? "ไม่ระบุ"} สาขา{chat.otherUser?.major ?? "ไม่ระบุ"}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-xs font-bold text-[#5f5a48]">
                      ยังไม่มีประวัติแชทกับเพื่อนร่วมชั้นเรียน
                    </div>
                  )}
                </div>
              </div>

              {/* Chat window panel */}
              <div className="flex-1 flex flex-col justify-between bg-[#fffdfa]">
                {activeChatId && chats.find((c) => c.id === activeChatId) ? (
                  (() => {
                    const currentChat = chats.find((c) => c.id === activeChatId)!;
                    return (
                      <>
                        {/* Chat Header */}
                        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#f2e7b5] bg-white shadow-sm">
                          {currentChat.otherUser && renderAvatar(currentChat.otherUser.avatarId, "size-10", "text-xs")}
                          <div>
                            <h4 className="font-bold text-base text-[#171717]">
                              {currentChat.otherUser?.nickname ?? "ห้องสนทนา"}
                            </h4>
                            <p className="text-xs text-[#5f5a48] mt-0.5">
                              ปี {currentChat.otherUser?.year} คณะ{currentChat.otherUser?.faculty} สาขา{currentChat.otherUser?.major}
                            </p>
                          </div>
                        </div>

                        {/* Chat Messages */}
                        <div className="flex-1 p-6 overflow-y-auto space-y-4">
                          {chatMessages.length > 0 ? (
                            chatMessages.map((msg) => {
                              const isMe = msg.senderId === currentUser?.uid;
                              return (
                                <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                                  <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm text-sm relative ${isMe
                                    ? "bg-[#FFCD22] text-[#221b00] rounded-tr-none"
                                    : "bg-white border border-[#f2e7b5] text-[#171717] rounded-tl-none"
                                    }`}>
                                    <p className="break-words font-medium">{msg.text}</p>
                                    <span className="block text-[8px] text-right mt-1 opacity-70">
                                      {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-center py-10 text-xs font-bold text-[#5f5a48]">
                              ยังไม่มีการส่งข้อความ ยินดีต้อนรับสู่ห้องแชท!
                            </div>
                          )}
                          <div ref={messagesEndRef} />
                        </div>

                        {/* Chat input box */}
                        <form onSubmit={handleSendMessage} className="p-4 border-t border-[#f2e7b5] bg-white flex gap-3">
                          <input
                            type="text"
                            value={newMessageText}
                            maxLength={1000}
                            onChange={(e) => setNewMessageText(e.target.value)}
                            placeholder="พิมพ์ข้อความที่นี่ (ไม่เกิน 1000 ตัวอักษร)..."
                            disabled={isSendingMessage}
                            className="flex-1 h-12 rounded-full border border-[#e5d48d] bg-[#fffdf9] px-5 text-sm font-medium outline-none focus:border-[#FFCD22] transition"
                          />
                          <button
                            type="submit"
                            disabled={!newMessageText.trim() || isSendingMessage}
                            className="size-12 rounded-full bg-[#171717] text-white flex items-center justify-center font-bold shadow hover:bg-[#2b2b2b] transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            ➤
                          </button>
                        </form>
                      </>
                    );
                  })()
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#5f5a48] font-medium">
                    <span className="text-5xl mb-4">💬</span>
                    <p className="text-base font-bold">กรุณาเลือกห้องแชทการสนทนา</p>
                    <p className="text-xs max-w-sm mt-1">คุณสามารถคุยโต้ตอบกับคู่เรียนได้ทันทีหลังจากยอมรับคำขอในกล่องข้อความ</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-[#fff8db] px-5 text-[#171717]">
        <div className="rounded-[28px] border border-[#f2e7b5] bg-white px-8 py-6 text-sm font-semibold text-[#7a650e] shadow-[0_18px_50px_rgba(90,72,13,0.12)]">
          กำลังเตรียมหน้าแดชบอร์ด...
        </div>
      </main>
    }>
      <DashboardContent />
    </Suspense>
  );
}
