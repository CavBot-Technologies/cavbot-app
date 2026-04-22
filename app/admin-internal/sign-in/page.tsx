import "@/components/CavBotLoadingScreen.css";
import AdminSignInClient from "./AdminSignInClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AdminSignInPage() {
  return <AdminSignInClient />;
}
