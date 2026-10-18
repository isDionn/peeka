import { Battery, BatteryCharging, Bell, Bluetooth, Calendar, Camera, Check, CircleAlert, Clock, Code, Download, Folder, Headphones, Heart, Info, Mail, MapPin, MessageSquare, Mic, Music, Phone, RefreshCw, Star, Ticket, Timer, TriangleAlert, Upload, Video, Volume2, VolumeX, Wifi, type LucideIcon } from "lucide-react";

// ADR-0060'ın simge adları; adı olmayan tek karakter (emoji) olduğu gibi yazılır. Tek renk kare: renk yalnız yazı rengidir (karar 14).
const ICONS: Record<string, LucideIcon> = {
  bell: Bell, chat: MessageSquare, mail: Mail, call: Phone, download: Download, upload: Upload, timer: Timer, clock: Clock, calendar: Calendar, check: Check,
  error: CircleAlert, warning: TriangleAlert, info: Info, code: Code, sync: RefreshCw, heart: Heart, star: Star, mic: Mic, camera: Camera, location: MapPin,
  wifi: Wifi, bluetooth: Bluetooth, music: Music, volume: Volume2, mute: VolumeX, battery: Battery, charging: BatteryCharging, headphones: Headphones, folder: Folder, ticket: Ticket, video: Video,
};

/** Eklentiden gelen simge adı: yalnız bu kümeden ad ya da tek karakter; başka her şey null (simge gönderilemez). */
export const safeIcon = (n: unknown): string | null => (typeof n === "string" && (n in ICONS || Array.from(n).length === 1) ? n : null);

export function AlertIcon({ name }: { name: string | null }) {
  const I = name ? ICONS[name] : undefined;
  return I ? <I /> : name ? <span aria-hidden="true">{name}</span> : <Bell />;
}
