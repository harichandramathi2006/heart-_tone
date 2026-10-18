/**
 * Now-Playing notification – shown when the app goes to the background
 * so the user can see what's playing from the notification shade.
 */
import { LocalNotifications } from "@capacitor/local-notifications";
import { isNative } from "../utils/platform";
import { bestImg, getArtists } from "../lib/helpers";

const NOTIFICATION_ID = 1001;

export async function showNowPlayingNotification(
  song: any,
  _isPlaying: boolean,
) {
  if (!isNative()) return;

  try {
    // Request permission (Android 13+ requires POST_NOTIFICATIONS)
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return;

    const title = song.name || "Unknown";
    const body = getArtists(song) || "Unknown artist";
    const largeIcon = bestImg(song.image, "150x150") || undefined;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIFICATION_ID,
          title,
          body,
          largeIcon,
          smallIcon: "ic_notification",
          iconColor: "#1db954",
          ongoing: true,
          autoCancel: false,
          extra: { songId: song.id, action: "now_playing" },
        },
      ],
    });
  } catch {
    // Swallow – notification is non-critical
  }
}

export async function dismissNowPlayingNotification() {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: NOTIFICATION_ID }],
    });
  } catch {}
}

/**
 * Register handlers for notification action taps (play / pause / next / prev).
 */
export function registerNotificationListeners(callbacks: {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  if (!isNative()) return;

  LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (action) => {
      switch (action.actionId) {
        case "play":
          callbacks.onPlay();
          break;
        case "pause":
          callbacks.onPause();
          break;
        case "next":
          callbacks.onNext();
          break;
        case "prev":
          callbacks.onPrev();
          break;
      }
    },
  );
}

/**
 * Trigger notification when a chat message or voice note is received.
 * Works natively on Android APK via LocalNotifications, and in browsers via Web Notifications API.
 */
let nextMessageNotificationId = 2000;

export async function triggerChatMessageNotification(msg: {
  fromName: string;
  text?: string;
  type?: string;
}) {
  const sender = msg.fromName || "HeartLink Partner";
  const body = msg.type === "voice" ? "🎤 Sent a voice message" : msg.text || "Sent a message";

  if (isNative()) {
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return;

      const notifId = ++nextMessageNotificationId;
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: `HeartLink • ${sender}`,
            body,
            smallIcon: "ic_notification",
            iconColor: "#1db954",
            autoCancel: true,
            extra: { action: "chat_message" },
          },
        ],
      });
    } catch (e) {
      console.warn("[Notification] Native chat notification error:", e);
    }
  } else if (typeof window !== "undefined" && "Notification" in window) {
    try {
      if (Notification.permission === "granted") {
        new Notification(`HeartLink • ${sender}`, {
          body,
          icon: "/icon.png",
        });
      } else if (Notification.permission !== "denied") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") {
          new Notification(`HeartLink • ${sender}`, {
            body,
            icon: "/icon.png",
          });
        }
      }
    } catch (e) {
      console.warn("[Notification] Web chat notification error:", e);
    }
  }
}

