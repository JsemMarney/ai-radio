export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getRadioStation } = await import("@/lib/radio");
    void getRadioStation().start();
  }
}
