export async function register() {
  // Broadcast běží ve standalone procesu (npm run dev:radio).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getStudioPasswordProblem } = await import("@/lib/studio-auth");
  const problem = getStudioPasswordProblem();
  if (problem) {
    const prod = process.env.NODE_ENV === "production";
    console.warn(
      `[security] ${problem} ${
        prod ? "Studio je zamčené, dokud ho nezměníš." : "Před zveřejněním ho změň."
      }`,
    );
  }
}
