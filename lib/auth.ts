import { MSU_EMAIL_SUFFIX } from "@/lib/firebase";

export const DOMAIN_ERROR = "กรุณาใช้อีเมลมหาวิทยาลัยเท่านั้น";

export function isMsuEmail(email: string | null): boolean {
  return email?.toLowerCase().endsWith(MSU_EMAIL_SUFFIX) ?? false;
}

export function getStudentIdFromEmail(email: string): string {
  return email.split("@")[0] ?? "";
}
