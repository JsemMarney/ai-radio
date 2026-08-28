export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { cleanupStaleBroadcastLock } = await import("@/lib/radio-state");
    const { getRadioStation } = await import("@/lib/radio");
    await cleanupStaleBroadcastLock();
    void getRadioStation().start();
  }
}
