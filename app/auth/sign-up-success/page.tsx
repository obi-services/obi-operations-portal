import { redirect } from "next/navigation";

export default function SignUpSuccessPage() {
  redirect("/auth/login");
}