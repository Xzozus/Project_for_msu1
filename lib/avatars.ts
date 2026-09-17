export type AvatarOption = {
  id: string;
  label: string;
  color: string;
  src: string;
};

export const AVATAR_OPTIONS: AvatarOption[] = [
  { id: "sun-01", label: "", color: "bg-[#FFCD22]", src: "/avatars/IMG_20260725_225606.png" },
  { id: "mint-02", label: "", color: "bg-[#9AE6B4]", src: "/avatars/IMG_20260725_225622.png" },
  { id: "sky-03", label: "", color: "bg-[#90CDF4]", src: "/avatars/IMG_20260725_225646.png" },
  { id: "rose-04", label: "", color: "bg-[#FEB2B2]", src: "/avatars/IMG_20260725_225702.png" },
  { id: "lime-05", label: "", color: "bg-[#D9F99D]", src: "/avatars/IMG_20260725_225718.png" },
  { id: "coral-06", label: "", color: "bg-[#FDBA74]", src: "/avatars/IMG_20260725_225737.png" },
  { id: "aqua-07", label: "", color: "bg-[#67E8F9]", src: "/avatars/IMG_20260725_225753.png" },
  { id: "leaf-08", label: "", color: "bg-[#86EFAC]", src: "/avatars/IMG_20260725_225803.png" },
  { id: "gold-09", label: "", color: "bg-[#FDE68A]", src: "/avatars/IMG_20260725_225842.png" },
  { id: "berry-10", label: "", color: "bg-[#F0ABFC]", src: "/avatars/IMG_20260725_225858.png" },
  { id: "cloud-11", label: "", color: "bg-[#CBD5E1]", src: "/avatars/IMG_20260725_225914.png" },
  { id: "peach-12", label: "", color: "bg-[#FED7AA]", src: "/avatars/IMG_20260725_225958.png" },
];

export function getAvatarById(id: string): AvatarOption {
  return AVATAR_OPTIONS.find((a) => a.id === id) || AVATAR_OPTIONS[0];
}
